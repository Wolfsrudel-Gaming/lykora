#!/usr/bin/env node
// Ende-zu-Ende-Lauf des Dashboards mit echtem Server und echtem Browser.
//
// Startet den Server auf Port 3100 (Datenbank lykora_e2e, wird geleert), baut das Dashboard,
// startet die Vite-Vorschau mit Proxy auf den Server und spielt mit Playwright einen Abend durch:
// anmelden, Organisation anlegen, Spiel hochladen, Medien und Klänge, Event anlegen und starten,
// ein Team per API beitreten lassen, Funk, Abriss der Live-Verbindung, Klang, Rückruf, SOS und
// eine abgelaufene Sitzung. Bildschirmfotos landen in web/e2e/screenshots/.
//
// Aufruf: node web/e2e/run.mjs [--no-build] [--keep] [--direkt]
//   --no-build  vorhandenen Build in web/dist nutzen
//   --keep      Server und Vorschau nach dem Lauf weiterlaufen lassen
//   --direkt    ohne Vite-Vorschau: der Server liefert das Dashboard selbst aus (WEB_DIR)
// Umgebung: E2E_DATABASE_URL, PLAYWRIGHT_MODULE, PLAYWRIGHT_BROWSERS_PATH

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const root = join(web, "..");
const shots = join(here, "screenshots");
const args = new Set(process.argv.slice(2));

const SERVER_PORT = 3100;
const PREVIEW_PORT = 4173;
const SERVER = `http://localhost:${SERVER_PORT}/lykora`;
const APP = args.has("--direkt") ? SERVER : `http://localhost:${PREVIEW_PORT}/lykora`;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://lykora@localhost:5432/lykora_e2e";
const ADMIN = { email: "admin@example.org", password: "geheim-geheim" };

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/pw-browsers";
const requireRoot = createRequire(join(root, "package.json"));
// Vite gibt seine Startdatei nicht über "exports" frei; der Pfad steht in "bin".
const viteBin = join(dirname(requireRoot.resolve("vite/package.json")), "bin/vite.js");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");

const checks = [];
const notes = [];
const children = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
  if (!ok) throw new Error(`Prüfung fehlgeschlagen: ${name} ${detail}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, label, timeout = 40_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // läuft noch nicht
    }
    await sleep(300);
  }
  throw new Error(`${label} antwortet nicht unter ${url}`);
}

function start(cmd, argv, opts, label) {
  const child = spawn(cmd, argv, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  child.on("exit", (code) => {
    if (code && !child.stopping) console.error(`${label} beendet mit Code ${code}\n${log.join("").slice(-3000)}`);
  });
  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) {
    c.stopping = true;
    c.kill("SIGTERM");
  }
}

// Kleine Dateien für Upload und Karte, ohne Abhängigkeiten erzeugt.

/** Kurzer Ton als WAV (mono, 16 bit, 22,05 kHz). */
function wav(seconds = 0.6, freq = 440) {
  const rate = 22050;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 9000 * fade), 44 + i * 2);
  }
  return buf;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Kartenkachel als PNG: heller Grund mit feinem Raster, damit die Karte offline nicht leer wirkt. */
function tile() {
  const size = 256;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const line = x % 64 === 0 || y % 64 === 0;
      const v = line ? 0xc9 : 0xe4;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = v;
      raw[o + 1] = line ? 0xc4 : 0xdf;
      raw[o + 2] = line ? 0xb6 : 0xd2;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// API für die Seite der Teams (das macht sonst die App)

async function api(method, path, body, token) {
  const res = await fetch(`${SERVER}/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return data;
}

const now = (offsetSec = 0) => new Date(Date.now() + offsetSec * 1000).toISOString();
let seq = 0;
const cid = (p) => `${p}-${Date.now()}-${++seq}`;

// Stand der Klangbibliothek der Absprache, falls der Server sie noch nicht mitbringt.
const LIBRARY_STUB = [
  ["wald-nacht", "Wald bei Nacht", "ambience", 48],
  ["wind", "Wind in den Bäumen", "ambience", 40],
  ["regen", "Regen", "ambience", 45],
  ["funkrauschen", "Funkrauschen", "ambience", 30],
  ["eule", "Eule ruft", "sfx", 2.1],
  ["donner", "Donner", "sfx", 5.5],
  ["tuer-knarzt", "Tür knarzt", "sfx", 1.8],
  ["schritte-laub", "Schritte im Laub", "sfx", 3],
  ["wolf-heulen", "Wolf heult", "sfx", 4.2],
].map(([id, title, category, duration]) => ({
  id,
  title,
  category,
  loop: category === "ambience",
  duration,
  src: `media/lib/${id}.ogg`,
  url: `${APP}/media/lib/${id}.ogg`,
  license: "CC0-1.0",
  credit: "Lykora-Klangbibliothek, erzeugt mit server/tool/sound_library.py",
}));

async function resetDatabase() {
  const pg = requireRoot("pg");
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.end();
}

async function main() {
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });

  if (!args.has("--no-build")) {
    const build = spawnSync(process.execPath, [viteBin, "build"], { cwd: web, encoding: "utf8" });
    if (build.status !== 0) throw new Error(`Build fehlgeschlagen:\n${build.stdout}\n${build.stderr}`);
  }
  await resetDatabase();
  const dataDir = mkdtempSync(join(tmpdir(), "lykora-e2e-"));
  start(
    process.execPath,
    ["src/server.ts"],
    {
      cwd: join(root, "server"),
      env: {
        ...process.env,
        DATABASE_URL: DB,
        PORT: String(SERVER_PORT),
        BASE_PATH: "/lykora",
        PUBLIC_URL: APP,
        ADMIN_EMAIL: ADMIN.email,
        ADMIN_PASSWORD: ADMIN.password,
        DATA_DIR: dataDir,
        LOG_LEVEL: "warn",
      },
    },
    "Server",
  );
  await waitFor(`${SERVER}/api/health`, "Server");
  check("Server läuft auf Port 3100", true);

  if (args.has("--direkt")) {
    const html = await (await fetch(`${APP}/events/beliebig`)).text();
    check("Server liefert das Dashboard mit eingesetztem Basispfad", /<base href="\/lykora\/"\s*\/?>/.test(html));
  } else {
    start(process.execPath, [viteBin, "preview", "--port", String(PREVIEW_PORT), "--strictPort"], { cwd: web, env: { ...process.env, LYKORA_SERVER: `http://localhost:${SERVER_PORT}` } }, "Vorschau");
    await waitFor(`${APP}/`, "Vite-Vorschau");
    check("Vite-Vorschau mit Proxy läuft", true);
  }

  // Was der Server von der Absprache schon kann; der Rest wird im Browser nachgestellt.
  const admin = await api("POST", "/auth/login", ADMIN);
  const libraryRes = await fetch(`${SERVER}/api/library/sounds`);
  const library = libraryRes.ok ? await libraryRes.json() : [];
  const stubLibrary = !libraryRes.ok || library.length === 0;
  if (stubLibrary) notes.push(`GET /library/sounds liefert ${libraryRes.ok ? "eine leere Liste" : libraryRes.status} (Klangbibliothek fehlt noch): im Browser durch Daten nach Absprache ersetzt`);

  const browser = await chromium.launch();
  const errors = [];
  const tilePng = tile();
  const silence = wav(0.4, 330);

  async function newPage(options) {
    const context = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", ...options });
    // Offline-tauglich: OSM-Kacheln kommen aus dem Lauf selbst.
    await context.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: tilePng }));
    if (stubLibrary) {
      await context.route("**/lykora/api/library/sounds", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LIBRARY_STUB) }));
      await context.route("**/lykora/media/lib/*.ogg", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: silence }));
    }
    const page = await context.newPage();
    page.on("pageerror", (err) => errors.push(`Seitenfehler: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      // Fehlende Bibliotheksdateien, bewusst abgelehnte Anfragen und der gespielte Serverausfall (503) sind kein Fehler der Seite.
      if (/Failed to load resource/.test(text) && /401|404|400|409|503/.test(text)) return;
      errors.push(`Konsole: ${text}`);
    });
    return { context, page };
  }

  async function shot(page, name, opts = {}) {
    if (opts.fullPage) await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: opts.fullPage ?? false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`Bildschirmfoto ${name}.png ohne waagrechtes Scrollen`, overflow <= 0, overflow > 0 ? `${overflow}px zu breit` : "");
  }

  const toast = (page, text) => page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 10_000 });

  // 1. Anmelden
  const { page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${APP}/`);
  await page.locator("#login-title").waitFor();
  check("Ohne Anmeldung geht es zur Anmeldung", page.url().includes("/lykora/anmelden"));
  await shot(page, "anmeldung");
  await page.getByLabel("E-Mail").fill(ADMIN.email);
  await page.getByLabel("Passwort").fill("falsch-falsch");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByRole("alert").filter({ hasText: "E-Mail oder Passwort falsch" }).waitFor();
  check("Falsches Passwort zeigt die Meldung des Servers", true);
  await page.getByLabel("Passwort").fill(ADMIN.password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByRole("navigation", { name: "Bereiche" }).waitFor();
  check("Anmeldung", true);

  // 2. Organisation anlegen
  await page.getByRole("link", { name: /Standard|Organisation/ }).first().click();
  await page.getByRole("heading", { name: "Neue Organisation" }).waitFor();
  await page.getByLabel("Name").fill("Pfadfinder Hennef");
  check("Kürzel wird aus dem Namen vorgeschlagen", (await page.getByLabel("Kürzel").inputValue()) === "pfadfinder-hennef");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await toast(page, "Organisation „Pfadfinder Hennef“ angelegt");
  check("Organisation angelegt und gewählt", true);
  const me = await api("GET", "/me", undefined, admin.token);
  const org = me.orgs.find((o) => o.name === "Pfadfinder Hennef");

  // 3. Spiel hochladen
  await page.getByRole("link", { name: "Spiele" }).click();
  await page.getByRole("button", { name: "Spiel hochladen" }).click();
  // Erst ein kaputtes Spiel: die Fehlerliste muss verständlich sein.
  const broken = JSON.parse(readFileSync(join(root, "spec/v0.1/examples/testspiel.json"), "utf8"));
  delete broken.meta.title;
  broken.stations[1].sound.solved = "gibtsnicht";
  await page.locator('input[type="file"]').setInputFiles({ name: "kaputt.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(broken)) });
  await page.locator(".notice.error", { hasText: "Pflichtangabe „Titel“ fehlt" }).waitFor();
  check("Ungültiges Spiel zeigt deutsche Fehlerliste", true);
  await page.locator('input[type="file"]').setInputFiles(join(root, "spec/v0.1/examples/testspiel.json"));
  await page.getByText("Gültig: „Sturmnacht: Das verschwundene Funkgerät“").waitFor();
  await page.getByLabel("Kommentar zur Version (optional)").fill("Erste Fassung");
  await page.getByRole("button", { name: "Spiel speichern" }).click();
  await page.getByRole("heading", { name: "Sturmnacht: Das verschwundene Funkgerät" }).waitFor();
  check("Spiel hochgeladen", true);
  await page.locator(".solution", { hasText: "Eule · Uhu" }).waitFor();
  check("Übersicht zeigt Lösungen", true);
  await shot(page, "spiel-uebersicht");
  const gameId = page.url().split("/spiele/")[1].split(/[/?]/)[0];
  await page.getByRole("link", { name: "Spiele" }).first().click();
  await page.getByRole("link", { name: "Sturmnacht: Das verschwundene Funkgerät" }).waitFor();
  await shot(page, "spiele");

  // 4. Medien: eigene Aufnahme hochladen und ins Spiel übernehmen
  await page.goto(`${APP}/spiele/${gameId}/medien`);
  await page.getByRole("heading", { name: "Hochladen" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "Tür knarzt.wav", mimeType: "audio/wav", buffer: wav(0.8, 220) },
    { name: "Stimme Försterin.wav", mimeType: "audio/wav", buffer: wav(1.2, 300) },
  ]);
  await page.locator(".media-row", { hasText: "Tür knarzt.wav" }).waitFor();
  await page.locator(".media-row", { hasText: "Stimme Försterin.wav" }).waitFor();
  check("Zwei Dateien hochgeladen", true);
  const row = page.locator(".media-row", { hasText: "Tür knarzt.wav" });
  await row.getByRole("button", { name: "Ins Spiel übernehmen" }).click();
  check("ID aus dem Dateinamen vorgeschlagen", (await row.getByLabel("ID im Spiel").inputValue()) === "tuer-knarzt");
  await row.getByLabel("Urheber und Lizenz").fill("Aufnahme: Lykora-Team, CC0");
  await row.getByRole("button", { name: /Neue Version mit/ }).click();
  await toast(page, "„tuer-knarzt“ ist im Spiel");
  await row.getByText("Im Spiel als „tuer-knarzt“").waitFor();
  const voiceRow = page.locator(".media-row", { hasText: "Stimme Försterin.wav" });
  await voiceRow.getByRole("button", { name: "Ins Spiel übernehmen" }).click();
  check("ID mit Umlaut-Ersatz vorgeschlagen", (await voiceRow.getByLabel("ID im Spiel").inputValue()) === "stimme-foersterin");
  await voiceRow.getByLabel("Beschreibung").fill("Försterin Brandt spricht");
  await voiceRow.getByRole("button", { name: /Neue Version mit/ }).click();
  await voiceRow.getByText("Im Spiel als „stimme-foersterin“").waitFor();
  const libRow = page.locator(".media-row", { hasText: "Wolf heult" });
  if (await libRow.count()) {
    await libRow.getByRole("button", { name: "Ins Spiel übernehmen" }).click();
    await libRow.getByText("Im Spiel als „wolf-heulen“").waitFor();
    check("Bibliotheksklang ins Spiel übernommen", true);
  }
  const afterMedia = await api("GET", `/games/${gameId}`, undefined, admin.token);
  const tuer = afterMedia.content.media.find((m) => m.id === "tuer-knarzt");
  check("media-Eintrag in neuer Version", !!tuer && /^media\/[0-9a-f]{64}\.wav$/.test(tuer.src) && tuer.credit === "Aufnahme: Lykora-Team, CC0", JSON.stringify(tuer));
  const audioRes = await fetch(`${SERVER}/${tuer.src}`, { headers: { range: "bytes=0-99" } });
  check("Hochgeladene Datei öffentlich mit Range abrufbar", audioRes.status === 206, String(audioRes.status));
  await shot(page, "medien", { fullPage: true });

  // 5. Klänge zuordnen ohne JSON
  await page.getByRole("link", { name: "Klänge zuordnen" }).click();
  const briefing = page.getByRole("region", { name: "Station Sicherheits-Briefing" });
  await briefing.getByLabel("Beim Lösen").selectOption("tuer-knarzt");
  await briefing.getByLabel("Atmosphäre", { exact: true }).selectOption("wald-nacht");
  await briefing.getByLabel("Atmosphäre ab Stufe").selectOption("here");
  // Die Försterin spricht ihren Text in der Szene an der Kiste selbst.
  const chest = page.getByRole("region", { name: "Station Die verschlossene Kiste" });
  await chest.getByText(/^Szene: Stimmen und Geräusche/).click();
  const dialogue = chest.locator(".beat").filter({ has: page.locator(".label", { hasText: "Ankunft · Dialog · Försterin Brandt" }) });
  await dialogue.getByLabel("Aufnahme (z. B. Stimme)").selectOption("stimme-foersterin");
  await dialogue.getByLabel("Geräusch dazu").selectOption("lib:schritte-laub");
  await page.getByRole("button", { name: "Als neue Version speichern" }).click();
  await toast(page, "Klänge gespeichert");
  const afterSound = await api("GET", `/games/${gameId}`, undefined, admin.token);
  const bs = afterSound.content.stations.find((s) => s.id === "briefing").sound;
  check("Zuordnung im Spiel gespeichert", bs?.solved === "tuer-knarzt" && bs?.ambience?.from === "here", JSON.stringify(bs));
  const beat = afterSound.content.stations.find((s) => s.id === "schloss").scene.arrival[0];
  check(
    "Stimme und Geräusch im Szenen-Takt gespeichert",
    beat.audio === "stimme-foersterin" && beat.sfx === "schritte-laub" && afterSound.content.media.some((m) => m.id === "schritte-laub" && m.src === "media/lib/schritte-laub.ogg"),
    JSON.stringify({ audio: beat.audio, sfx: beat.sfx }),
  );
  await shot(page, "klang-zuordnen");

  await page.getByRole("link", { name: "Materialliste" }).click();
  await page.locator(".checklist", { hasText: "Schild mit Eule" }).waitFor();
  check("Materialliste aus den Requisiten", true);
  await shot(page, "materialliste");

  // Neue Version durch Einfügen: das Versteck wird sichtbar und braucht eine Foto-Prüfung von Hand.
  const latest = (await api("GET", `/games/${gameId}`, undefined, admin.token)).content;
  const hideout = latest.stations.find((st) => st.id === "versteck");
  hideout.visibility = "visible";
  hideout.task.review = "live";
  await page.getByRole("link", { name: "Übersicht" }).click();
  await page.getByRole("tab", { name: "Neue Version" }).click();
  await page.getByRole("tab", { name: "Einfügen" }).click();
  await page.getByLabel("Spiel im JSON-Format").fill(JSON.stringify(latest, null, 2));
  await page.getByRole("button", { name: "Prüfen" }).click();
  await page.getByText(/^Gültig:/).waitFor();
  await page.getByLabel("Kommentar zur Version (optional)").fill("Versteck mit Foto-Prüfung");
  await page.getByRole("button", { name: "Als neue Version speichern" }).click();
  await toast(page, "gespeichert");
  await page.getByRole("tab", { name: /Versionen/ }).click();
  await page.getByRole("cell", { name: "Versteck mit Foto-Prüfung" }).waitFor();
  check("Neue Version per Einfügen gespeichert und im Verlauf", true);
  await shot(page, "spiel-versionen");

  // 6. Event anlegen
  await page.getByRole("link", { name: "Events" }).click();
  await page.getByRole("link", { name: "Event anlegen" }).click();
  await page.getByLabel("Name des Events").fill("Nachtwanderung Hennef");
  await page.getByLabel("Termin").fill("2027-10-19T19:30");
  await page.getByRole("button", { name: "Event anlegen" }).click();
  await page.locator(".join-code").waitFor();
  const code = (await page.locator(".join-code").innerText()).trim();
  const pin = (await page.locator(".pin").innerText()).trim();
  const eventId = page.url().split("/events/")[1].split(/[/?]/)[0];
  check("Event angelegt mit Code und PIN", /^[A-Z0-9]{6}$/.test(code) && pin.length >= 4, `${code} / ${pin}`);
  await page.locator(".qr img").waitFor();
  await shot(page, "event");

  // 7. Leitstand: starten
  await page.getByRole("link", { name: "Leitstand öffnen" }).click();
  await page.locator(".conn.open").waitFor();
  check("Leitstand ist live verbunden", true);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Starten" }).click();
  await page.locator(".control-status .badge", { hasText: "Läuft" }).waitFor();
  check("Event gestartet", true);
  // Aktionen vor dem Start lehnt die Spiellogik ab; die Uhr des Servers soll sicher weiter sein.
  await sleep(1500);

  // 8. Teams treten per API bei und melden Positionen
  const fox = await api("POST", "/join", { code, device: "E2E", team: { name: "Füchse", color: "orange", members: ["Mia", "Ben"], emergencyPhone: "+49 170 1234567", supervisorPin: pin } });
  const owls = await api("POST", "/join", { code, device: "E2E", team: { name: "Eulenwacht", color: "blue", members: ["Lea"] } });
  await page.locator(".team-row", { hasText: "Füchse" }).waitFor();
  check("Beigetretenes Team erscheint live im Leitstand", true);
  await api(
    "POST",
    "/play/sync",
    {
      deviceTime: now(),
      battery: 0.62,
      actions: [
        { id: cid("a"), type: "start", time: now(-0.8) },
        { id: cid("a"), type: "trigger", time: now(-0.6), payload: { station: "briefing", method: "qr" } },
        { id: cid("a"), type: "answer", time: now(-0.4), payload: { station: "briefing", choice: [0] } },
        { id: cid("a"), type: "heartbeat", time: now(-0.2) },
      ],
      positions: [
        { lat: 50.8152, lon: 7.1546, accuracy: 12, time: now(-100) },
        { lat: 50.8155, lon: 7.1551, accuracy: 9, time: now(-60) },
        { lat: 50.8158, lon: 7.1557, accuracy: 8, time: now(-5) },
      ],
    },
    fox.token,
  );
  await api("POST", "/play/sync", { deviceTime: now(), battery: 0.14, positions: [{ lat: 50.8163, lon: 7.1534, accuracy: 25, time: now(-3) }] }, owls.token);
  await api("POST", "/play/messages", { id: cid("m"), body: "Uns ist mulmig.", kind: "predefined" }, fox.token);
  await page.locator(".team-row", { hasText: "Füchse" }).getByText("1/5 Stationen").waitFor();
  check("Fortschritt des Teams live aktualisiert", true);
  await page.locator(".mk-team", { hasText: "Füchse" }).waitFor();
  check("Team auf der Karte", true);
  await shot(page, "leitstand");

  // 9. Team-Detail mit Laufspur
  await page.locator(".team-row", { hasText: "Füchse" }).click();
  await page.locator("#team-title", { hasText: "Füchse" }).waitFor();
  await page.getByText("+49 170 1234567").waitFor();
  await page.getByRole("button", { name: "Laufspur" }).click();
  await page.locator("path.lf-track").waitFor();
  check("Team-Detail mit Notfallnummer und Laufspur", true);
  await page.getByLabel("Punkte (minus zieht ab)").fill("25");
  await page.getByRole("button", { name: "Punkte buchen" }).click();
  await toast(page, "Füchse: Punkte – +25 Punkte");
  await shot(page, "team-detail");

  // 10. Funk: Eingang und Antwort
  await page.getByRole("tab", { name: /Funk/ }).click();
  await page.locator(".msg.in.tone-uneasy", { hasText: "Uns ist mulmig." }).waitFor();
  check("„Uns ist mulmig“ im Eingang hervorgehoben", true);
  await page.locator(".msg.in", { hasText: "Uns ist mulmig." }).getByRole("button", { name: "Antworten" }).click();
  check("„Antworten“ öffnet den Verlauf des Teams", (await page.getByLabel("Verlauf").inputValue()) === fox.team.id);
  await page.getByLabel("Absender").selectOption("brandt");
  await page.getByPlaceholder("Funkspruch …").fill("Bleibt, wo ihr seid. Ich komme mit der Lampe zu euch.");
  await page.getByRole("button", { name: "Senden" }).click();
  await toast(page, "An Füchse gesendet");
  await page.locator(".msg.out", { hasText: "Ich komme mit der Lampe" }).waitFor();
  check("Nachricht gesendet", true);
  await shot(page, "funk");

  // Verbindung reißt ab: Der Leitstand zeigt das, verbindet neu und holt Verpasstes nach.
  await page.context().setOffline(true);
  await page.locator(".conn.closed").waitFor();
  check("Abriss der Live-Verbindung wird angezeigt", true);
  await api("POST", "/play/messages", { id: cid("m"), body: "Station 3 ist kaputt?", kind: "predefined" }, owls.token);
  await page.context().setOffline(false);
  await page.locator(".conn.open").waitFor();
  await page.getByLabel("Verlauf").selectOption("inbox");
  await page.locator(".msg.in.tone-broken", { hasText: "Station 3 ist kaputt?" }).waitFor();
  check("Nach dem Neuverbinden lädt der Leitstand Verpasstes nach", true);

  // 11. Klangpult
  await page.getByRole("tab", { name: "Klang" }).click();
  await page.locator(".soundboard").getByLabel("Ziel").selectOption({ label: "Füchse" });
  await page.getByLabel("Funkspruch dazu (optional)").fill("Hört ihr das auch?");
  await page.getByRole("region", { name: "Klänge im Spiel" }).locator(".sound", { hasText: "Ruf einer Eule" }).getByRole("button", { name: "Einspielen" }).click();
  await toast(page, "eingespielt");
  await page.getByRole("region", { name: "Klänge im Spiel" }).locator(".sound", { hasText: "tuer-knarzt" }).getByRole("button", { name: "Einspielen" }).click();
  await toast(page, "„tuer-knarzt“ bei Füchse eingespielt");
  await page.locator(".soundboard .list-item", { hasText: "Hört ihr das auch?" }).waitFor();
  check("Klang eingespielt und unter „Zuletzt eingespielt“", true);
  await shot(page, "klangpult");

  // Die App bekommt Cue und Funkspruch beim nächsten Abgleich.
  const synced = await api("POST", "/play/sync", { deviceTime: now() }, fox.token);
  const cues = synced.messages.filter((m) => m.kind === "cue").map((m) => JSON.parse(m.body));
  check("Team erhält die Cues", cues.some((c) => c.audio === "eule" && c.src === "media/lib/eule.ogg" && c.text === "Hört ihr das auch?"), JSON.stringify(cues));

  // Foto-Prüfung: Team löst das Versteck mit einem Foto, die Spielleitung gibt frei.
  const uploadId = crypto.randomUUID();
  const up = await fetch(`${SERVER}/api/play/uploads?id=${uploadId}`, { method: "POST", headers: { "content-type": "image/png", authorization: `Bearer ${fox.token}` }, body: tilePng });
  check("Team lädt ein Foto hoch", up.status === 201, String(up.status));
  await api(
    "POST",
    "/play/sync",
    {
      deviceTime: now(),
      actions: [
        { id: cid("a"), type: "trigger", time: now(-0.3), payload: { station: "versteck", method: "gps" } },
        { id: cid("a"), type: "answer", time: now(-0.1), payload: { station: "versteck", upload: uploadId } },
      ],
    },
    fox.token,
  );
  await page.getByRole("tab", { name: /Prüfungen/ }).click();
  const review = page.locator(".review", { hasText: "Füchse" });
  await review.locator("img").waitFor();
  check("Foto der Prüfung mit Token geladen", await review.locator("img").evaluate((img) => img.naturalWidth === 256));
  await shot(page, "pruefungen");
  await review.getByRole("button", { name: "Freigeben" }).click();
  await toast(page, "für Füchse freigegeben");
  await review.waitFor({ state: "detached" });
  await page.locator(".team-row", { hasText: "Füchse" }).getByText("2/5 Stationen").waitFor();
  check("Freigabe zählt die Station als gelöst", true);

  // 12. Rückruf
  await page.getByRole("button", { name: "Rückruf" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Grund (geht an alle Teams)").fill("Gewitter zieht auf");
  await dialog.getByRole("button", { name: "Rückruf senden" }).click();
  await page.locator(".control-status .badge", { hasText: "Rückruf" }).waitFor();
  await page.locator(".recall", { hasText: "0 von 2" }).waitFor();
  check("Rückruf aktiv mit Banner", true);
  const recalled = await api("POST", "/play/sync", { deviceTime: now() }, owls.token);
  check("Teams bekommen den Rückruf", recalled.recall !== null && recalled.messages.some((m) => m.body.includes("Gewitter zieht auf")));

  // 13. SOS vom Team, im Leitstand bestätigen
  await api("POST", "/play/sos", { id: cid("sos"), time: now(), lat: 50.8164, lon: 7.1531, accuracy: 15, message: "Lea ist umgeknickt" }, owls.token);
  const sosItem = page.locator(".sos-item", { hasText: "Eulenwacht" });
  await sosItem.waitFor();
  await sosItem.getByText("„Lea ist umgeknickt“").waitFor();
  check("SOS erscheint sofort im Leitstand", true);
  await page.locator(".mk-sos-point").waitFor();
  await sosItem.getByRole("button", { name: "Bestätigen" }).click();
  await sosItem.getByText(/^Bestätigt von Admin/).waitFor();
  check("SOS bestätigt", true);
  await page.locator(".team-row.sos", { hasText: "Eulenwacht" }).waitFor();
  await page.locator(".warn-safety", { hasText: "Eulenwacht hat SOS ausgelöst" }).waitFor();
  check("SOS steht vorn in Teamliste und Assistent", (await page.title()).startsWith("SOS (1) · "), await page.title());
  const sosSync = await api("POST", "/play/sync", { deviceTime: now() }, owls.token);
  if (Array.isArray(sosSync.sos)) check("Team sieht die Bestätigung beim Abgleich", sosSync.sos.some((s) => s.acknowledgedAt && s.acknowledgedBy));
  else notes.push("POST /play/sync liefert noch kein sos-Feld (Absprache Punkt 6); nicht geprüft");
  await shot(page, "leitstand-sos");

  // 14. Rangliste und Export
  await page.getByRole("tab", { name: "Rangliste" }).click();
  await page.locator(".standings", { hasText: "Füchse" }).waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Ergebnisse (CSV)" }).click()]);
  const csv = readFileSync(await download.path(), "utf8");
  check("Export results.csv per fetch und Blob", download.suggestedFilename() === "results.csv" && csv.includes("Füchse"), download.suggestedFilename());
  await page.getByRole("tab", { name: "Logbuch" }).click();
  await page.locator(".log-row.safety", { hasText: "SOS" }).first().waitFor();
  check("Logbuch live mit SOS", true);
  await shot(page, "logbuch");

  // 15. Tablet und Tag-Thema
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("tab", { name: "Teams" }).click();
  await page.getByRole("button", { name: "Tag-Thema einschalten" }).click();
  await page.locator('html[data-theme="day"]').waitFor();
  await shot(page, "leitstand-tablet-tag");
  await page.getByRole("button", { name: "Nacht-Thema einschalten" }).click();

  // 16. Betreuer anlegen (Mitgliederverwaltung) und Ansicht am Handy
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Mitglieder" }).click();
  await page.getByRole("heading", { name: "Mitglied hinzufügen" }).waitFor();
  await page.getByLabel("E-Mail").fill("betreuer@example.org");
  await page.getByLabel("Rolle", { exact: true }).selectOption("supervisor");
  await page.getByLabel("Name (neues Konto)").fill("Jonas Betreuer");
  await page.getByLabel("Startpasswort (neues Konto)").fill("betreuer-geheim");
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await toast(page, "Jonas Betreuer hinzugefügt");
  await page.getByRole("cell", { name: "Jonas Betreuer", exact: true }).waitFor();
  check("Mitglied mit Rolle Betreuer angelegt", true);
  await shot(page, "mitglieder");
  const phone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.page.goto(`${APP}/events/${eventId}/leitstand`);
  await phone.page.getByLabel("E-Mail").fill("betreuer@example.org");
  await phone.page.getByLabel("Passwort").fill("betreuer-geheim");
  await phone.page.getByRole("button", { name: "Anmelden" }).click();
  await phone.page.locator(".supervisor").waitFor();
  check("Betreuer landen nach der Anmeldung in der einfachen Ansicht", phone.page.url().includes(`/events/${eventId}/betreuer`), phone.page.url());
  await phone.page.locator(".sv-team", { hasText: "Eulenwacht" }).waitFor();
  check("Betreuer sehen keine Spielsteuerung", (await phone.page.getByRole("button", { name: "Beenden" }).count()) === 0);
  check("Betreuer sehen keine Eingriffe", (await phone.page.getByText("Eingriffe").count()) === 0);
  await phone.page.locator(".sv-team", { hasText: "Eulenwacht" }).getByRole("button", { name: "Betreuer bestätigen" }).waitFor();
  await shot(phone.page, "betreuer-handy");
  await phone.page.locator(".sv-team", { hasText: "Eulenwacht" }).getByRole("button", { name: "Angekommen" }).click();
  await toast(phone.page, "Eulenwacht am Sammelpunkt");
  check("Betreuer erfasst Ankunft am Sammelpunkt", true);
  await phone.page.getByRole("tab", { name: /Funk/ }).click();
  await phone.page.locator(".msg", { hasText: "Uns ist mulmig." }).waitFor();
  await shot(phone.page, "betreuer-funk");
  await phone.page.getByRole("tab", { name: "Karte" }).click();
  await phone.page.locator(".mk-team").first().waitFor();
  await shot(phone.page, "betreuer-karte");

  // Das SOS als erledigt markieren (Betreuer dürfen das).
  await phone.page.locator(".sos-item", { hasText: "Eulenwacht" }).getByRole("button", { name: "Erledigt" }).click();
  await phone.page.locator(".sos-panel").waitFor({ state: "detached" });
  check("Betreuer setzt SOS auf erledigt", true);

  // 17. Spieler-Landeseite ohne Anmeldung
  const player = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await player.page.goto(`${APP}/join/${code}`);
  await player.page.getByRole("link", { name: "Lykora-App öffnen" }).waitFor();
  const href = await player.page.getByRole("link", { name: "Lykora-App öffnen" }).getAttribute("href");
  check("Join-Seite verlinkt die App mit Server und Code", href === `lykora://join?server=${encodeURIComponent(APP)}&code=${code}`, href ?? "");
  await shot(player.page, "join");

  // 18. Handy-Leitstand für die Spielleitung (gleiche Seite, eine Spalte)
  const gmPhone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await gmPhone.context.addInitScript((t) => localStorage.setItem("lykora.token", t), admin.token);
  await gmPhone.page.goto(`${APP}/events/${eventId}/leitstand?tab=teams`);
  await gmPhone.page.locator(".team-row", { hasText: "Füchse" }).waitFor();
  await shot(gmPhone.page, "leitstand-handy");

  // Sitzung läuft ab: Das Dashboard schickt zur Anmeldung und danach zurück in den Leitstand.
  await api("POST", "/auth/logout", undefined, admin.token);
  await gmPhone.page.getByRole("tab", { name: "Rangliste" }).click();
  await gmPhone.page.locator("#login-title").waitFor();
  await toast(gmPhone.page, "Sitzung abgelaufen");
  check("Abgelaufene Sitzung führt zur Anmeldung", gmPhone.page.url().includes("/lykora/anmelden?weiter="), gmPhone.page.url());
  await gmPhone.page.getByLabel("E-Mail").fill(ADMIN.email);
  await gmPhone.page.getByLabel("Passwort").fill(ADMIN.password);
  await gmPhone.page.getByRole("button", { name: "Anmelden" }).click();
  await gmPhone.page.locator(".standings", { hasText: "Füchse" }).waitFor();
  check("Nach erneuter Anmeldung zurück an derselben Stelle", gmPhone.page.url().includes(`/events/${eventId}/leitstand`), gmPhone.page.url());

  // Server beim Öffnen nicht erreichbar: Die gespeicherte Anmeldung bleibt, ein neuer Versuch genügt.
  const token = await gmPhone.page.evaluate(() => localStorage.getItem("lykora.token"));
  const restart = await newPage({ viewport: { width: 1024, height: 768 } });
  await restart.context.addInitScript((t) => localStorage.setItem("lykora.token", t), token);
  await restart.context.route("**/lykora/api/me", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable", message: "Server startet gerade neu." }) }));
  await restart.page.goto(`${APP}/events/${eventId}/leitstand`);
  await restart.page.getByText("Server startet gerade neu. Die Anmeldung bleibt gespeichert").waitFor();
  check("Ohne Server bleibt die Anmeldung gespeichert", (await restart.page.evaluate(() => localStorage.getItem("lykora.token"))) === token);
  await restart.context.unroute("**/lykora/api/me");
  await restart.page.getByRole("button", { name: "Erneut versuchen" }).click();
  await restart.page.locator(".team-row", { hasText: "Füchse" }).waitFor();
  check("Nach erneutem Versuch geht es ohne neue Anmeldung weiter", true);

  check("Keine Fehler in der Browser-Konsole", errors.length === 0, errors.join(" | "));
  await browser.close();
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\nFehler: ${err.stack ?? err}`);
} finally {
  if (!args.has("--keep")) stopAll();
}
console.log(`\n${checks.filter((c) => c.ok).length} Prüfungen bestanden${failed ? ", Lauf abgebrochen" : ""}. Bildschirmfotos: ${shots}`);
for (const n of notes) console.log(`Hinweis: ${n}`);
writeFileSync(join(shots, "ergebnis.json"), JSON.stringify({ checks, notes, failed }, null, 2));
process.exit(failed ? 1 : 0);
