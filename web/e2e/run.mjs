#!/usr/bin/env node
// Ende-zu-Ende-Lauf des Dashboards mit echtem Server und echtem Browser.
//
// Startet den Server auf Port 3100 (Datenbank lykora_e2e, wird geleert), baut das Dashboard,
// startet die Vite-Vorschau mit Proxy auf den Server und spielt mit Playwright einen Abend durch:
// anmelden, Organisation anlegen, Spiel importieren, im Baukasten ein Spiel aus der Vorlage bauen,
// veröffentlichen und spielen (Abschnitt 3b), Medien und Klänge im Entwurf, Event anlegen und
// starten, ein Team per API beitreten lassen, Funk, Abriss der Live-Verbindung, Klang, Rückruf, SOS
// und eine abgelaufene Sitzung. Bildschirmfotos landen in web/e2e/screenshots/.
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
import { fileURLToPath, pathToFileURL } from "node:url";
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

/** Luftlinie in Metern (Haversine), für die Orte im Baukasten. */
function distM(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Abschnitte, die abgebrochen sind, ohne den ganzen Lauf anzuhalten (3b. Baukasten). */
const brokenSections = [];

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
      const url = msg.location()?.url;
      errors.push(`Konsole: ${text}${url ? ` (${url})` : ""}`);
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

  // 3. Spiel importieren (Expertenweg neben „+ Neues Spiel“); danach geht es in den Baukasten.
  await page.getByRole("link", { name: "Spiele" }).click();
  await page.getByRole("button", { name: "Importieren" }).click();
  // Erst ein kaputtes Spiel: die Fehlerliste muss verständlich sein.
  const example = JSON.parse(readFileSync(join(root, "spec/v0.1/examples/testspiel.json"), "utf8"));
  const broken = structuredClone(example);
  delete broken.meta.title;
  broken.stations[1].sound.solved = "gibtsnicht";
  await page.locator('input[type="file"]').setInputFiles({ name: "kaputt.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(broken)) });
  await page.locator(".notice.error", { hasText: "Pflichtangabe „Titel“ fehlt" }).waitFor();
  check("Ungültiges Spiel zeigt deutsche Fehlerliste", true);
  check("Fehlerhafte Datei lässt sich als Entwurf öffnen", await page.getByRole("button", { name: /Trotzdem als Entwurf öffnen/ }).isVisible());
  // Der Baukasten verlangt eine echte Chip-Kennung (UID) statt „lyk-baum“, sonst ließe sich nicht veröffentlichen.
  const sturmnacht = structuredClone(example);
  sturmnacht.stations.find((s) => s.id === "baum").triggers.find((t) => t.type === "nfc").tag = "04:A1:B2:C3:D4:E5:F6";
  await page.locator('input[type="file"]').setInputFiles({ name: "testspiel.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sturmnacht)) });
  await page.getByText("Gültig: „Sturmnacht: Das verschwundene Funkgerät“").waitFor();
  await page.getByLabel("Kommentar zur Version (optional)").fill("Erste Fassung");
  await page.getByRole("button", { name: "Spiel speichern" }).click();
  await page.waitForURL(/\/spiele\/[^/]+\/baukasten$/);
  await page.locator(".editor-title").waitFor({ timeout: 20_000 });
  check("Spiel importiert, weiter im Baukasten", (await page.locator(".editor-title").inputValue()) === "Sturmnacht: Das verschwundene Funkgerät");
  const gameId = page.url().split("/spiele/")[1].split(/[/?]/)[0];
  await page.goto(`${APP}/spiele/${gameId}`);
  await page.getByRole("heading", { name: "Sturmnacht: Das verschwundene Funkgerät" }).waitFor();
  await page.locator(".solution", { hasText: "Eule · Uhu" }).waitFor();
  check("Übersicht zeigt Lösungen", true);
  await shot(page, "spiel-uebersicht");
  await page.getByRole("link", { name: "Spiele" }).first().click();
  await page.getByRole("link", { name: "Sturmnacht: Das verschwundene Funkgerät" }).waitFor();
  await shot(page, "spiele");

  // 3b. Baukasten: ein Spiel aus der Vorlage bis zum Team in der App (design.md Abschnitt 10).
  // Bricht ein Schritt ab, steht er in der Liste; die übrigen Abschnitte laufen trotzdem weiter.
  const draftOf = (id) => api("GET", `/games/${id}/draft`, undefined, admin.token);
  const saved = async (p = page) => {
    // Erst nach Prüfung und lokaler Sicherung (300 ms) speichern, sonst bleibt die Sicherung neben dem Server-Stand liegen.
    await p.waitForTimeout(500);
    await p.keyboard.press("Control+s");
    await p.locator(".save-status", { hasText: "Gespeichert" }).first().waitFor({ timeout: 10_000 });
    await p.waitForTimeout(200);
  };
  const baukasten = async () => {
    // 1. Neues Spiel aus Vorlage
    await page.getByRole("link", { name: "Neues Spiel" }).click();
    await page.getByRole("heading", { name: "Womit willst du anfangen?" }).waitFor();
    await page.getByLabel(/Outdoor-Escape für Jugendliche/).check();
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Name des Spiels").fill("Agenten im Stadtpark");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("heading", { name: "In welcher Welt spielt ihr?" }).waitFor();
    check("Assistent: Spielwelt Agenten vorbelegt", await page.getByLabel(/^Agenten/).isChecked());
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("heading", { name: "Wer spielt mit?" }).waitFor();
    check("Assistent: Zielgruppe 14–17 vorbelegt", await page.getByLabel("14–17 Jahre").isChecked());
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("heading", { name: "Wo wird gespielt?" }).waitFor();
    await page.getByRole("button", { name: "Koordinaten …" }).click();
    await page.getByLabel("Koordinaten", { exact: true }).fill("50.7374, 7.0982");
    await page.getByRole("button", { name: "Übernehmen" }).click();
    await page.locator('input[type="range"]').evaluate((el) => {
      el.value = "400";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByText("Spielfeld: Kreis mit 400 m Radius").waitFor();
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("heading", { name: "Wie lange, und wer hilft im Notfall?" }).waitFor();
    check(
      "Assistent: 60 Minuten, Zeitlimit je Team, Telefon später",
      (await page.getByText("Geplante Dauer: 60 Minuten").count()) === 1 && (await page.getByLabel(/^je Team/).isChecked()) && (await page.getByLabel("Telefon der Spielleitung").inputValue()) === "",
    );
    await page.getByRole("button", { name: "Spiel anlegen" }).click();
    await page.waitForURL(/\/spiele\/[^/]+\/baukasten$/);
    await toast(page, "Spiel angelegt");
    const agentId = page.url().split("/spiele/")[1].split("/")[0];
    const fresh = await api("GET", `/games/${agentId}`, undefined, admin.token);
    let d = await draftOf(agentId);
    check("Neues Spiel ohne Version, mit Entwurf", fresh.latest_version === null && d.revision >= 1, `Revision ${d.revision}`);
    const bonn = { lat: 50.7374, lon: 7.0982 };
    check("Sammelpunkt am gewählten Ort", distM(d.content.field.assemblyPoint.location, bonn) < 12);
    check("6 Stationen innerhalb 400 m", d.content.stations.length === 6 && d.content.stations.every((s) => distM(s.location, bonn) < 400));
    const qrCodes = d.content.stations.flatMap((s) => s.triggers.filter((t) => t.type === "qr").map((t) => t.code));
    check("QR-Codes neu, zufällig und verschieden", qrCodes.every((c) => /^LYK-[A-HJ-NP-Z2-9]{4}$/.test(c)) && new Set(qrCodes).size === qrCodes.length, qrCodes.join(" "));
    const nav = page.getByRole("navigation", { name: "Bereiche des Baukastens" });
    await nav.getByRole("link", { name: /Sicherheit/ }).waitFor();
    check("Übersicht: „✗ 1“ an Sicherheit (Telefon fehlt)", (await nav.getByRole("link", { name: /Sicherheit/ }).innerText()).includes("✗ 1"));
    await shot(page, "baukasten-uebersicht");

    // 2. Karte: Station verschieben, Station anlegen, Sperrzone zeichnen
    await nav.getByRole("link", { name: /Karte & Stationen/ }).click();
    const mapEl = page.locator(".ed-map-main .leaflet-container");
    await mapEl.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(600);
    const before = d.content.stations[1].location;
    await page.getByTitle(/^Station 2: /).click();
    const panel = page.locator(".ed-map-panel");
    await panel.getByText("steht noch am Platz aus der Vorlage").waitFor();
    for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
    await saved();
    d = await draftOf(agentId);
    const moved = distM(before, d.content.stations[1].location);
    check("Karte: 10× Umschalt+Pfeil rechts ≈ 100 m nach Osten", moved > 95 && moved < 105 && d.content.stations[1].location.lon > before.lon, `${moved.toFixed(1)} m`);
    check("Karte: Warnung „Platz aus der Vorlage“ an Station 2 verschwindet", (await panel.getByText("steht noch am Platz aus der Vorlage").count()) === 0);
    await page.getByRole("button", { name: "+ Station", exact: true }).first().click();
    let box = await mapEl.boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.56);
    await page.locator("#neue-station-name").fill("Die Brücke");
    await page.keyboard.press("Enter");
    await panel.locator("h3", { hasText: "Die Brücke" }).waitFor();
    // An eine freie Stelle 150 m südöstlich des Sammelpunkts, weg von Sperrzonen und GPS-Kreisen.
    const coords = panel.locator(".ed-coords input");
    await coords.fill(`${(bonn.lat - 150 / 111_195).toFixed(6)}, ${(bonn.lon + 150 / (111_195 * Math.cos((bonn.lat * Math.PI) / 180))).toFixed(6)}`);
    await coords.press("Enter");
    await saved();
    d = await draftOf(agentId);
    const bridge = d.content.stations.at(-1);
    check(
      "Karte: „Die Brücke“ als 7. Station mit GPS, QR und Notfall-Code",
      d.content.stations.length === 7 && bridge.id === "die-bruecke" && ["gps", "qr", "manual"].every((t) => bridge.triggers.some((x) => x.type === t)),
      `${bridge.id}: ${bridge.triggers.map((t) => t.type)}`,
    );
    await page.getByRole("button", { name: "Sperrzone" }).click();
    await page.getByRole("menuitem", { name: /Vieleck zeichnen/ }).click();
    box = await mapEl.boundingBox();
    for (const [fx, fy] of [
      [0.06, 0.82],
      [0.16, 0.82],
      [0.11, 0.94],
    ]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(150);
    }
    await page.keyboard.press("Enter");
    await panel.locator("h3", { hasText: "Sperrzone" }).waitFor();
    await page.waitForTimeout(200);
    await page.keyboard.type("Straße");
    await panel.locator("select").first().selectOption("road");
    await saved();
    d = await draftOf(agentId);
    const zone = d.content.field.restrictedZones[1];
    check("Karte: Sperrzone „Straße“ als Vieleck mit 3 Ecken", zone?.area?.polygon?.length === 3 && zone.kind === "road", JSON.stringify({ name: zone?.name, kind: zone?.kind, ecken: zone?.area?.polygon?.length }));
    await shot(page, "baukasten-karte");

    // Eigene Karte: settings.map.tiles ersetzt OpenStreetMap durch die Kacheln des Servers
    const packs = await (await fetch(`${SERVER}/api/tiles`)).json();
    check("Server listet das Kartenpaket „sieglar“ samt Nachtvariante", ["sieglar", "sieglar-nacht"].every((n) => packs.some((p) => p.name === n)), packs.map((p) => p.name).join(", "));
    const packTile = await fetch(`${SERVER}/tiles/sieglar/16/34065/21995.png`);
    check("Kachel des Pakets kommt ohne Anmeldung als PNG", packTile.ok && packTile.headers.get("content-type") === "image/png", String(packTile.status));
    const karteUrl = new URL(page.url());
    await page.goto(`${karteUrl.origin}${karteUrl.pathname}?experte=1`);
    await page.locator("summary", { hasText: "Felder ohne Wirkung" }).click();
    const ownTile = page.waitForRequest((r) => /\/lykora\/tiles\/sieglar-nacht\/\d+\/\d+\/\d+\.png$/.test(new URL(r.url()).pathname), { timeout: 15_000 }).catch(() => null);
    const tilesField = page.getByLabel("Kartenkacheln (Adresse)");
    await tilesField.fill("tiles/sieglar-nacht/{z}/{x}/{y}.png");
    await saved();
    await nav.getByRole("link", { name: /Karte & Stationen/ }).click();
    await page.locator(".ed-map-main .leaflet-container").waitFor({ timeout: 15_000 });
    check("Karte: Kacheln aus settings.map.tiles vom eigenen Server", !!(await ownTile));
    check("Karte: Zuschreibung „OpenStreetMap-Mitwirkende“ bleibt sichtbar", (await page.locator(".ed-map-main .leaflet-control-attribution").innerText()).includes("OpenStreetMap"));
    await page.goto(`${karteUrl.origin}${karteUrl.pathname}?experte=1`);
    await page.locator("summary", { hasText: "Felder ohne Wirkung" }).click();
    await page.getByLabel("Kartenkacheln (Adresse)").fill("");
    await saved();
    await page.goto(`${karteUrl.origin}${karteUrl.pathname}`);
    await page.locator(".ed-map-main .leaflet-container").waitFor({ timeout: 15_000 });

    // 3. Stationseditor: Rätsel mit Tipps, Funkspruch, neues Codeteil
    await page.locator(".editor-nav .ed-st-link", { hasText: "Die Brücke" }).click();
    await page.getByRole("heading", { level: 2, name: /Die Brücke/ }).waitFor({ timeout: 15_000 });
    const st = page.locator('[data-objekt="die-bruecke"]');
    await st.locator('[data-feld="task.type"] select').selectOption("text");
    await st.getByLabel(/^Frage/).fill("Wie viele Bögen hat die Brücke?");
    const answers = st.getByLabel(/^Richtige Antworten/);
    for (const a of ["drei", "3"]) {
      await answers.fill(a);
      await answers.press("Enter");
    }
    while ((await st.getByRole("textbox", { name: /^Tipp \d/ }).count()) < 2) await st.locator(".st-hints").getByRole("button", { name: "Tipp", exact: true }).click();
    await st.getByRole("textbox", { name: /^Tipp 1/ }).fill("Zählt die Bögen von unten.");
    await st.getByRole("textbox", { name: /^Tipp 2/ }).fill("Es sind mehr als zwei.");
    const cost = st.locator('[data-feld="hints.1.cost"]');
    await cost.locator("select").selectOption("time");
    await cost.locator('input[type="number"]').fill("2");
    const arrival = st.locator('section.st-lane[data-feld="scene.arrival"]');
    await arrival.getByRole("button", { name: "+ Block" }).click();
    await page.getByRole("menuitem", { name: /Funkspruch/ }).click();
    await arrival.locator("[data-block^='arrival-'] textarea").last().fill("Hier spricht die Zentrale. Zählt die Bögen der Brücke.");
    const newPart = st.getByRole("button", { name: "neues Codeteil" });
    if (!(await newPart.isVisible())) await st.locator("summary", { hasText: "Belohnung" }).click();
    await newPart.click();
    await saved();
    d = await draftOf(agentId);
    const b = d.content.stations.find((s) => s.id === "die-bruecke");
    const finalCode = [...d.content.fragments].sort((x, y) => x.position - y.position).map((f) => f.value).join("");
    check("Station: „Antwort eintippen“ mit den Antworten drei und 3", b.task?.type === "text" && JSON.stringify(b.task.answers) === '["drei","3"]', JSON.stringify(b.task));
    check("Station: Tipp 2 kostet 2 Minuten", JSON.stringify(b.hints?.[1]?.cost) === '{"type":"time","amount":120}', JSON.stringify(b.hints));
    check("Station: Funkspruch bei der Ankunft", b.scene?.arrival?.[0]?.kind === "radio");
    check(
      "Station: neues Codeteil 5, Finalcode 5-stellig, Finale folgt",
      d.content.fragments.length === 5 && JSON.stringify(b.rewards?.fragments) === '["teil-5"]' && finalCode.length === 5 && d.content.stations.find((s) => s.final)?.task?.answers?.[0] === finalCode,
      finalCode,
    );
    await shot(page, "baukasten-station");

    // 4. Regel: Sobald „Die Brücke“ gelöst ist, funkt die Zentrale
    await nav.getByRole("link", { name: /Regeln/ }).click();
    await page.getByRole("heading", { name: "Regeln", level: 2 }).waitFor();
    await page.getByRole("button", { name: /Neue Regel/ }).click();
    await page.getByRole("menuitem", { name: "Leere Regel" }).click();
    const card = page.locator("details.d-rule").last();
    await card.getByLabel("Station", { exact: true }).selectOption("die-bruecke");
    await card.getByLabel(/^Text/).fill("Gut gemacht, weiter zum Finale!");
    await saved();
    const sentence = await card.locator(".d-rule-sentence").innerText();
    check("Regel: Satz nennt Station und Funkspruch", sentence.startsWith("Sobald „Die Brücke“ gelöst ist") && sentence.includes("Gut gemacht, weiter zum Finale!"), sentence);
    d = await draftOf(agentId);
    const rule = d.content.rules.at(-1);
    check(
      "Regel im Entwurf",
      JSON.stringify(rule.when) === '[{"station_solved":"die-bruecke"}]' && (rule.then[0]?.message?.from ?? "hq") === "hq" && rule.then[0]?.message?.text?.de === "Gut gemacht, weiter zum Finale!",
      JSON.stringify(rule),
    );

    // 5. Sicherheit: Telefon und Warnweste
    await nav.getByRole("link", { name: /Sicherheit/ }).click();
    await page.getByRole("heading", { name: "Sicherheit", level: 2 }).waitFor();
    const phoneField = page.getByRole("textbox", { name: /Telefon der Spielleitung/ });
    await phoneField.fill("+49 170 1234567");
    await phoneField.blur();
    await page.getByRole("button", { name: "+ Warnweste" }).click();
    await page.waitForTimeout(600);
    check("Sicherheit: ✓ in der Navigation", (await nav.getByRole("link", { name: /Sicherheit/ }).innerText()).includes("✓"));
    check("Kopf: Veröffentlichen ohne Fehlerzahl", (await page.locator(".editor-head .count", { hasText: "✗" }).count()) === 0);

    // 6. Rückgängig, Speichern und Konflikt mit einem zweiten Tab
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "+ Warnweste" }).waitFor();
    await page.keyboard.press("Control+Shift+z");
    await page.getByRole("button", { name: "+ Warnweste" }).waitFor({ state: "detached" });
    await saved();
    d = await draftOf(agentId);
    check("Strg+Z und Strg+Umschalt+Z; gespeichert mit Warnweste", d.content.safety.requiredGear.some((g) => g.de === "Warnweste"));
    const second = await page.context().newPage();
    second.on("pageerror", (err) => errors.push(`Seitenfehler (Tab 2): ${err.message}`));
    await second.goto(`${APP}/spiele/${agentId}/baukasten`);
    await second.locator(".editor-title").waitFor({ timeout: 20_000 });
    await second.locator(".editor-title").fill("Agenten im Stadtpark (Tab 2)");
    await second.locator(".editor-title").press("Enter");
    await saved(second);
    await second.close();
    await page.locator(".editor-title").fill("Agenten im Stadtpark (Tab 1)");
    await page.locator(".editor-title").press("Enter");
    await page.keyboard.press("Control+s");
    const conflict = page.getByRole("dialog", { name: /hat den Entwurf auch geändert/ });
    await conflict.waitFor();
    await shot(page, "baukasten-konflikt");
    await conflict.getByLabel(/^Stand von .* laden/).check();
    const [backup] = await Promise.all([page.waitForEvent("download"), conflict.getByRole("button", { name: "Weiter" }).click()]);
    check("Konflikt: eigener Stand als Datei gesichert", /-entwurf-.*\.json$/.test(backup.suggestedFilename()), backup.suggestedFilename());
    await page.waitForTimeout(300);
    check("Konflikt: Titel aus dem zweiten Tab steht", (await page.locator(".editor-title").inputValue()) === "Agenten im Stadtpark (Tab 2)");
    await page.locator(".editor-title").fill("Agenten im Stadtpark");
    await page.locator(".editor-title").press("Enter");
    await saved();

    // 7. Veröffentlichen
    await nav.getByRole("link", { name: /Veröffentlichen/ }).click();
    await page.getByText("Muss erledigt sein (0)").waitFor();
    check("Checkliste: nichts mehr, was erledigt sein muss", true);
    await page.getByLabel("Kommentar zur Version").fill("Erste Fassung");
    await page.getByRole("button", { name: "Als Version 1 veröffentlichen" }).click();
    const published = page.getByRole("dialog", { name: "Version 1 ist veröffentlicht" });
    await published.waitFor();
    await shot(page, "baukasten-veroeffentlichen");
    await published.getByRole("button", { name: "Schließen", exact: true }).click();
    const v1 = await api("GET", `/games/${agentId}`, undefined, admin.token);
    check("Version 1 veröffentlicht, Entwurf ohne Änderungen", v1.latest_version === 1 && v1.draft?.changed === false);
    const v1content = (await api("GET", `/games/${agentId}/versions/1`, undefined, admin.token)).content;
    const { validateGame } = await import(pathToFileURL(join(root, "spec/validate.mjs")).href);
    const v1check = validateGame(v1content);
    check("Version 1 ist gültig und hat 7 Stationen", v1check.errors.length === 0 && v1content.stations.length === 7, v1check.errors.join(" | "));

    // 8. Probelauf
    await page.locator(".editor-head").getByRole("link", { name: "Probelauf" }).click();
    const testRun = page.getByRole("dialog", { name: "Probelauf" });
    await testRun.locator(".join-code").waitFor({ timeout: 15_000 });
    const testCode = (await testRun.locator(".join-code").innerText()).trim();
    check("Probelauf mit Event-Code und PIN", /^[A-Z0-9]{6}$/.test(testCode) && (await testRun.locator(".pin").innerText()).trim().length >= 4, testCode);
    await testRun.getByRole("button", { name: "Stations-Codes zeigen" }).click();
    const codes = page.getByRole("dialog", { name: "Stations-Codes" });
    await codes.locator(".qr img").first().waitFor();
    // 7 Stationen; „Toter Briefkasten“ hat keinen QR-Code (nur GPS und Notfall-Code).
    check("Stations-Codes: 7 Stationen mit 6 QR-Codes", (await codes.locator(".pub-code").count()) === 7 && (await codes.locator(".qr img").count()) === 6);
    await codes.getByRole("button", { name: "Schließen", exact: true }).click();
    await testRun.getByRole("button", { name: "Schließen", exact: true }).last().click();
    const orgEvents = await api("GET", `/orgs/${org.id}/events`, undefined, admin.token);
    check("Probelauf als Test-Event", orgEvents.some((e) => e.test && e.join.code === testCode));

    // 9. Event anlegen, Team spielt die veröffentlichte Version
    await page.getByRole("link", { name: "Events" }).click();
    await page.getByRole("link", { name: "Event anlegen" }).click();
    await page.getByLabel("Spiel").selectOption({ label: "Agenten im Stadtpark" });
    await page.getByLabel("Version").locator("option", { hasText: "Version 1" }).waitFor({ state: "attached" });
    await page.getByLabel("Name des Events").fill("Agenten-Abend");
    await page.getByRole("button", { name: "Event anlegen" }).click();
    await page.locator(".join-code").waitFor();
    const agentCode = (await page.locator(".join-code").innerText()).trim();
    const agentPin = (await page.locator(".pin").innerText()).trim();
    const agentEvent = page.url().split("/events/")[1].split(/[/?]/)[0];
    const agents = await api("POST", "/join", { code: agentCode, device: "E2E", team: { name: "Falken", color: "blue", members: ["Kim"], supervisorPin: agentPin } });
    const played = await api("GET", "/play/game", undefined, agents.token);
    check("App lädt die Version: 7 Stationen, Kennung aus dem Titel", played.game.stations.length === 7 && played.game.id === "agenten-im-stadtpark", played.game.id);
    await api("POST", `/events/${agentEvent}/start`, {}, admin.token);
    await sleep(1500);
    const manual = played.game.stations.find((s) => s.id === "die-bruecke").triggers.find((t) => t.type === "manual").code;
    const synced = await api(
      "POST",
      "/play/sync",
      {
        deviceTime: now(),
        actions: [
          { id: cid("a"), type: "start", time: now(-0.6) },
          { id: cid("a"), type: "trigger", time: now(-0.4), payload: { station: "die-bruecke", method: "manual", code: manual } },
          { id: cid("a"), type: "answer", time: now(-0.2), payload: { station: "die-bruecke", text: "Drei" } },
        ],
      },
      agents.token,
    );
    check("Engine: Start, Notfall-Code und Antwort angenommen", synced.outcomes.every((o) => o.status === "ok"), JSON.stringify(synced.outcomes));
    check("Engine: „Die Brücke“ gelöst, die Regel funkt", JSON.stringify(synced.state.solved).includes("die-bruecke") && synced.messages.some((m) => m.body.includes("Gut gemacht, weiter zum Finale!")));

    // 10. Nach dem Veröffentlichen ändern: geplantes Event umstellen, laufendes nicht
    const planned = await api("POST", `/orgs/${org.id}/events`, { gameId: agentId, version: 1, name: "Agenten-Morgen" }, admin.token);
    await page.goto(`${APP}/spiele/${agentId}/baukasten/stationen/einsatz`);
    await page.getByRole("heading", { level: 2, name: /Einsatzort/ }).waitFor({ timeout: 20_000 });
    await page.locator('[data-objekt="einsatz"]').getByLabel(/^Name/).first().fill("Einsatzort am Tor");
    await saved();
    d = await draftOf(agentId);
    check("Station im Entwurf umbenannt", d.content.stations[0].name.de === "Einsatzort am Tor", JSON.stringify(d.content.stations[0].name));
    await page.goto(`${APP}/spiele`);
    await page.getByText("● Änderungen seit Version 1, noch nicht veröffentlicht").waitFor();
    check("Liste: Änderungen seit Version 1", true);
    await page.goto(`${APP}/spiele/${agentId}/baukasten/veroeffentlichen`);
    await page.getByText("Station „Einsatzort am Tor“ geändert").waitFor();
    await page.getByRole("button", { name: "Als Version 2 veröffentlichen" }).click();
    const after = page.getByRole("dialog", { name: "Version 2 ist veröffentlicht" });
    await after.waitFor();
    const offered = await after.innerText();
    check("Dialog bietet nur das geplante Event an", offered.includes("Agenten-Morgen") && !offered.includes("Agenten-Abend"));
    await after.getByRole("button", { name: "Umstellen und schließen" }).click();
    await toast(page, "jetzt Version 2");
    const switched = await api("GET", `/events/${planned.id}`, undefined, admin.token);
    check("Geplantes Event spielt Version 2, Code bleibt", switched.gameVersion === 2 && switched.join.code === planned.join.code);

    // 11. Handy: Bereichsauswahl und Vor-Ort-Modus
    const mobile = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 50.7368, longitude: 7.0975, accuracy: 6 }, permissions: ["geolocation"] });
    await mobile.context.addInitScript(([t, o]) => {
      localStorage.setItem("lykora.token", t);
      localStorage.setItem("lykora.org", o);
    }, [admin.token, org.id]);
    await mobile.page.goto(`${APP}/spiele/${agentId}/baukasten`);
    await mobile.page.getByRole("link", { name: /Vor Ort arbeiten/ }).waitFor({ timeout: 20_000 });
    check("Handy: Bereichsauswahl und „Vor Ort arbeiten“", (await mobile.page.locator(".editor-nav-select select, .editor-nav select").count()) > 0);
    await mobile.page.goto(`${APP}/spiele/${agentId}/vor-ort`);
    await mobile.page.getByRole("heading", { name: "Vor Ort" }).waitFor({ timeout: 15_000 });
    await mobile.page.getByRole("button", { name: /Standort freigeben/ }).tap();
    await mobile.page.getByRole("button", { name: /Station hier anlegen/ }).tap();
    await mobile.page.getByRole("button", { name: "Sofort übernehmen" }).tap();
    await mobile.page.locator("#vor-ort-name").fill("Am Tor");
    await mobile.page.getByRole("dialog").getByRole("button", { name: "Speichern", exact: true }).tap();
    await mobile.page.getByText("„Am Tor“ angelegt").waitFor();
    await shot(mobile.page, "vor-ort");
    await mobile.page.waitForTimeout(2500);
    await mobile.page.locator(".save-status", { hasText: "Gespeichert" }).first().waitFor({ timeout: 10_000 });
    d = await draftOf(agentId);
    const here = d.content.stations.find((s) => s.id === "am-tor");
    check("Vor Ort: neue Station am Standort, als vor Ort gesetzt gemerkt", !!here && distM(here.location, { lat: 50.7368, lon: 7.0975 }) < 5 && !!d.meta.onSite?.["am-tor"]);
    await mobile.context.close();

    // 12. Medien landen im Entwurf, nicht in einer neuen Version
    await page.goto(`${APP}/spiele/${agentId}/medien`);
    await page.waitForURL(/\/baukasten\/medien$/);
    await page.locator('input[type="file"]').setInputFiles({ name: "Stimme.wav", mimeType: "audio/wav", buffer: wav(1, 260) });
    const voice = page.locator(".media-row", { hasText: "Stimme.wav" });
    await voice.getByRole("button", { name: "Ins Spiel übernehmen" }).click();
    await voice.getByRole("button", { name: "Übernehmen", exact: true }).click();
    await voice.getByText("Im Spiel als „stimme“").waitFor();
    await saved();
    const v2 = await api("GET", `/games/${agentId}`, undefined, admin.token);
    d = await draftOf(agentId);
    check("Medium im Entwurf, keine neue Version", v2.latest_version === 2 && d.content.media.some((m) => m.id === "stimme"));
  };
  try {
    await baukasten();
  } catch (err) {
    brokenSections.push(`3b. Baukasten: ${err.message.split("\n")[0]}`);
    console.log(`✗ Abschnitt 3b. Baukasten abgebrochen – ${err.message.split("\n")[0]}`);
    await page.screenshot({ path: join(shots, "baukasten-abbruch.png"), fullPage: true }).catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  // 4. Medien: eigene Aufnahme hochladen und in den Entwurf übernehmen (die alte Seite leitet in den Baukasten)
  await page.goto(`${APP}/spiele/${gameId}/medien`);
  await page.waitForURL(/\/baukasten\/medien$/);
  check("Alte Medien-Seite leitet in den Baukasten", true);
  // Mit Expertenansicht, damit die Kennung im Spiel zu sehen ist.
  await page.goto(`${APP}/spiele/${gameId}/baukasten/medien?experte=1`);
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
  check("Kennung aus dem Dateinamen vorgeschlagen", (await row.getByLabel("Kennung im Spiel").inputValue()) === "tuer-knarzt");
  await row.getByLabel("Urheber und Lizenz").fill("Aufnahme: Lykora-Team, CC0");
  await row.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await toast(page, "„Tür knarzt.wav“ ist im Spiel");
  await row.getByText("Im Spiel als „tuer-knarzt“").waitFor();
  const voiceRow = page.locator(".media-row", { hasText: "Stimme Försterin.wav" });
  await voiceRow.getByRole("button", { name: "Ins Spiel übernehmen" }).click();
  check("Kennung mit Umlaut-Ersatz vorgeschlagen", (await voiceRow.getByLabel("Kennung im Spiel").inputValue()) === "stimme-foersterin");
  await voiceRow.getByLabel("Beschreibung").fill("Försterin Brandt spricht");
  await voiceRow.getByRole("button", { name: "Übernehmen", exact: true }).click();
  // In der Expertenansicht nennt das Abzeichen die Kennung, sonst die Beschreibung.
  await voiceRow.getByText("Im Spiel als „stimme-foersterin“").waitFor();
  const libRow = page.locator(".media-row", { hasText: "Wolf heult" });
  if (await libRow.count()) {
    await libRow.getByRole("button", { name: "Ins Spiel übernehmen" }).click();
    await libRow.getByText(/^Im Spiel als/).waitFor();
    check("Bibliotheksklang ins Spiel übernommen", true);
  }
  await saved();
  const afterMedia = await draftOf(gameId);
  const tuer = afterMedia.content.media.find((m) => m.id === "tuer-knarzt");
  check("media-Eintrag im Entwurf", !!tuer && /^media\/[0-9a-f]{64}\.wav$/.test(tuer.src) && tuer.credit === "Aufnahme: Lykora-Team, CC0", JSON.stringify(tuer));
  check("Keine neue Version durch Medien", (await api("GET", `/games/${gameId}`, undefined, admin.token)).latest_version === 1);
  const audioRes = await fetch(`${SERVER}/${tuer.src}`, { headers: { range: "bytes=0-99" } });
  check("Hochgeladene Datei öffentlich mit Range abrufbar", audioRes.status === 206, String(audioRes.status));
  await shot(page, "medien", { fullPage: true });

  // 5. Klänge zuordnen ohne JSON, im Entwurf; danach als Version 2 veröffentlichen
  await page.goto(`${APP}/spiele/${gameId}/klang`);
  await page.waitForURL(/\/baukasten\/klang$/);
  const briefing = page.getByRole("region", { name: "Station Sicherheits-Briefing" });
  // Stationen ohne Klang sind eingeklappt; erst aufklappen, dann zuordnen.
  const openStation = async (region) => {
    const details = region.locator(":scope > details");
    if (!(await details.evaluate((d) => d.open))) await details.locator(":scope > summary").click();
  };
  await openStation(briefing);
  await briefing.getByLabel("Beim Lösen").selectOption("tuer-knarzt");
  await briefing.getByLabel("Atmosphäre", { exact: true }).selectOption("wald-nacht");
  await briefing.getByLabel("Atmosphäre ab Stufe").selectOption("here");
  // Die Försterin spricht ihren Text in der Szene an der Kiste selbst.
  const chest = page.getByRole("region", { name: "Station Die verschlossene Kiste" });
  await openStation(chest);
  await chest.getByText(/^Szene: Stimmen und Geräusche/).click();
  const dialogue = chest.locator(".beat").filter({ has: page.locator(".label", { hasText: "Ankunft · Dialog · Försterin Brandt" }) });
  await dialogue.getByLabel("Aufnahme (z. B. Stimme)").selectOption("stimme-foersterin");
  await dialogue.getByLabel("Geräusch dazu").selectOption("lib:schritte-laub");
  await saved();
  await shot(page, "klang-zuordnen");
  await page.goto(`${APP}/spiele/${gameId}/baukasten/veroeffentlichen`);
  await page.getByText("Muss erledigt sein (0)").waitFor();
  await page.getByLabel("Kommentar zur Version").fill("Klänge zugeordnet");
  await page.getByRole("button", { name: "Als Version 2 veröffentlichen" }).click();
  await page.getByRole("dialog", { name: "Version 2 ist veröffentlicht" }).getByRole("button", { name: "Schließen", exact: true }).click();
  const afterSound = await api("GET", `/games/${gameId}`, undefined, admin.token);
  check("Klänge als Version 2 veröffentlicht", afterSound.latest_version === 2);
  const bs = afterSound.content.stations.find((s) => s.id === "briefing").sound;
  check("Zuordnung im Spiel gespeichert", bs?.solved === "tuer-knarzt" && bs?.ambience?.from === "here", JSON.stringify(bs));
  const beat = afterSound.content.stations.find((s) => s.id === "schloss").scene.arrival[0];
  check(
    "Stimme und Geräusch im Szenen-Takt gespeichert",
    beat.audio === "stimme-foersterin" && beat.sfx === "schritte-laub" && afterSound.content.media.some((m) => m.id === "schritte-laub" && m.src === "media/lib/schritte-laub.ogg"),
    JSON.stringify({ audio: beat.audio, sfx: beat.sfx }),
  );

  await page.goto(`${APP}/spiele/${gameId}/material`);
  await page.locator(".checklist", { hasText: "Schild mit Eule" }).waitFor();
  check("Materialliste aus den Requisiten", true);
  await shot(page, "materialliste");

  // Stationsschilder im Druck: jedes Schild auf eigener A5-Seite in voller Breite, kein Baukasten-Rahmen
  await page.goto(`${APP}/spiele/${gameId}/baukasten/veroeffentlichen?drucken=schilder`);
  await page.locator(".pub-sign .qr img").first().waitFor();
  await page.emulateMedia({ media: "print" });
  const signs = await page.locator(".pub-sign").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const q = el.querySelector(".qr")?.getBoundingClientRect();
      const c = el.querySelector(".pub-sign-code")?.getBoundingClientRect();
      return { w: r.width, inside: !!q && !!c && q.left >= r.left && q.right <= r.right && c.right <= r.right + 1 };
    }),
  );
  check("Schilder im Druck breit genug, QR-Code und Code im Rahmen", signs.length > 0 && signs.every((x) => x.w > 400 && x.inside), JSON.stringify(signs));
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const pdfText = pdf.toString("latin1");
  const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check("Je Schild genau eine Seite im PDF, keine Leerseite", pages === signs.length, `${pages} Seiten für ${signs.length} Schilder`);
  check("Schild-Seiten im Format A5", /\/MediaBox\s*\[\s*0\s+0\s+(419\.\d+|420)\s+59[45]\.\d+/.test(pdfText));
  await page.emulateMedia({ media: null });

  // Neue Version durch Einfügen: das Versteck wird sichtbar und braucht eine Foto-Prüfung von Hand.
  const latest = (await api("GET", `/games/${gameId}`, undefined, admin.token)).content;
  const hideout = latest.stations.find((st) => st.id === "versteck");
  hideout.visibility = "visible";
  hideout.task.review = "live";
  await page.goto(`${APP}/spiele/${gameId}`);
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
  const replaced = await draftOf(gameId);
  check("Version aus Datei ersetzt auch den Entwurf", replaced.content.stations.find((st) => st.id === "versteck").visibility === "visible");
  await shot(page, "spiel-versionen");

  // 6. Event anlegen
  await page.getByRole("link", { name: "Events" }).click();
  await page.getByRole("link", { name: "Event anlegen" }).click();
  await page.getByLabel("Spiel").selectOption({ label: "Sturmnacht: Das verschwundene Funkgerät" });
  await page.getByLabel("Version").locator("option", { hasText: "Version 3" }).waitFor({ state: "attached" });
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

  // 16a. Einstellungen: Zahnrad in der Kopfzeile, Darstellung; ohne LYKORA_IMAGE sind Updates nicht eingerichtet.
  await page.getByRole("link", { name: /^Einstellungen/ }).click();
  await page.getByRole("heading", { name: "Darstellung" }).waitFor();
  await page.getByRole("heading", { name: "Server und Updates" }).waitFor();
  await page.getByText("Updates sind nicht eingerichtet").waitFor();
  await page.getByRole("heading", { name: "Verlauf" }).waitFor();
  check("Admin der Instanz sieht „Server und Updates“; ohne LYKORA_IMAGE nicht eingerichtet", true);
  await page.getByRole("radio", { name: /^Tag/ }).check();
  await page.locator('html[data-theme="day"]').waitFor();
  await page.getByRole("radio", { name: /^Nacht/ }).check();
  await page.locator('html[data-theme="night"]').waitFor();
  check("Darstellung in den Einstellungen schaltet das Thema", true);
  await shot(page, "einstellungen", { fullPage: true });

  // Versionshinweis: Nach dem Wiederverbinden der Live-Verbindung meldet der Server eine andere Version.
  await page.goto(`${APP}/events/${eventId}/leitstand`);
  await page.locator(".conn.open").waitFor();
  const newBuild = { version: "999", commit: "0123456789abcdef0123456789abcdef01234567", builtAt: "2026-10-21T09:30:00Z" };
  await page.context().route("**/lykora/api/system/version", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(newBuild) }));
  await page.context().setOffline(true);
  await page.locator(".conn.closed").waitFor();
  await page.context().setOffline(false);
  await page.locator(".conn.open").waitFor();
  await page.locator(".version-band", { hasText: "Lykora wurde aktualisiert (Build 999)" }).waitFor();
  check("Band „Lykora wurde aktualisiert“ nach dem Wiederverbinden, ohne selbst neu zu laden", page.url().includes("/leitstand"));
  await shot(page, "version-band");
  await page.getByRole("button", { name: "Hinweis ausblenden" }).click();
  await page.locator(".version-band").waitFor({ state: "detached" });
  await page.context().unroute("**/lykora/api/system/version");

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

  // Einstellungen am Handy: eine Spalte, nichts läuft über.
  await gmPhone.page.goto(`${APP}/einstellungen`);
  await gmPhone.page.getByRole("heading", { name: "Server und Updates" }).waitFor();
  await shot(gmPhone.page, "einstellungen-handy", { fullPage: true });
  await gmPhone.page.goto(`${APP}/events/${eventId}/leitstand?tab=teams`);
  await gmPhone.page.locator(".team-row", { hasText: "Füchse" }).waitFor();

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

  // 19. Entwurfsseite /_design: ohne Anmeldung, Bausteine per Tastatur, Themen
  const ds = await newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const dp = ds.page;
  await dp.goto(`${APP}/_design?thema=night`);
  await dp.locator(".ds-section").first().waitFor();
  check("Entwurfsseite: zehn Abschnitte, ohne Anmeldung erreichbar", (await dp.locator(".ds-section").count()) === 10 && dp.url().includes("/_design"));
  check("Entwurfsseite erscheint nicht in der Navigation", (await page.getByRole("link", { name: /Entwurf/ }).count()) === 0);
  await dp.locator('html[data-theme="night"]').waitFor();
  await shot(dp, "entwurf-nacht", { fullPage: true });
  const bodyBg = () => dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("Thema Nacht: Seitengrund #0b0c0e", (await bodyBg()) === "rgb(11, 12, 14)");
  await dp.getByRole("radio", { name: "Tag", exact: true }).click();
  await dp.locator('html[data-theme="day"]').waitFor();
  check("Thema Tag: Seitengrund #f3eee4", (await bodyBg()) === "rgb(243, 238, 228)");
  check("Thema Tag: Primärknopf bleibt Laternen-Amber mit dunkler Schrift", await dp.evaluate(() => {
    const b = document.querySelector(".btn--primary");
    const c = getComputedStyle(b);
    return c.backgroundColor === "rgb(242, 163, 58)" && c.color === "rgb(26, 17, 4)";
  }));
  await shot(dp, "entwurf-tag", { fullPage: true });
  await dp.getByRole("radio", { name: "System", exact: true }).click();
  await dp.locator('html[data-theme="system"]').waitFor();
  check("Thema System folgt dem Gerät (dunkel)", (await bodyBg()) === "rgb(11, 12, 14)");
  await dp.emulateMedia({ colorScheme: "light" });
  await dp.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(243, 238, 228)");
  check("Thema System folgt dem Gerät (hell)", true);
  check("Thema System wird gespeichert", (await dp.evaluate(() => localStorage.getItem("lykora.theme"))) === "system");
  await dp.getByRole("radio", { name: "Nacht", exact: true }).click();
  await dp.emulateMedia({ colorScheme: "dark" });

  // Reiter: Pfeile, Home, Ende, gesperrte werden übersprungen, ein Tabstopp
  const tab = (name) => dp.getByRole("tab", { name, exact: false });
  await tab(/^Teams/).focus();
  await dp.keyboard.press("ArrowRight");
  check("Reiter: Pfeil rechts wählt den nächsten", (await tab(/^Funk/).getAttribute("aria-selected")) === "true");
  await dp.keyboard.press("End");
  check("Reiter: Ende wählt den letzten", (await tab(/^Und noch einer/).getAttribute("aria-selected")) === "true");
  await dp.keyboard.press("Home");
  check("Reiter: Home wählt den ersten", (await tab(/^Teams/).getAttribute("aria-selected")) === "true");
  await tab(/^Logbuch/).click();
  await dp.keyboard.press("ArrowRight");
  check("Reiter: gesperrter Reiter wird übersprungen", (await tab(/^Noch ein Reiter/).getAttribute("aria-selected")) === "true");
  check("Reiter: genau ein Tabstopp", (await dp.locator('[role="tab"][tabindex="0"]').count()) === 1);

  // Menü: Pfeil öffnet, Pfeile wandern (Gesperrtes überspringen), Tippsuche, Escape gibt den Fokus zurück
  const menuBtn = dp.getByRole("button", { name: "Weitere Aktionen" });
  await menuBtn.focus();
  await dp.keyboard.press("ArrowDown");
  const menu = dp.getByRole("menu", { name: "Weitere Aktionen" });
  await menu.waitFor();
  check("Menü: Pfeil unten öffnet und fokussiert den ersten Eintrag", await dp.evaluate(() => document.activeElement?.textContent?.includes("Bearbeiten") === true));
  await dp.keyboard.press("ArrowDown");
  await dp.keyboard.press("ArrowDown");
  check("Menü: gesperrter Eintrag wird übersprungen", await dp.evaluate(() => document.activeElement?.textContent?.includes("Löschen") === true));
  await dp.keyboard.type("d");
  check("Menü: Tippsuche springt zum Eintrag", await dp.evaluate(() => document.activeElement?.textContent?.includes("Duplizieren") === true));
  await dp.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  check("Menü: Escape schließt und gibt den Fokus an den Knopf zurück", await dp.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Weitere Aktionen"));
  await menuBtn.click();
  await dp.getByRole("menuitem", { name: "Duplizieren" }).click();
  await toast(dp, "Dupliziert");
  check("Menü: Wählen löst die Aktion aus und schließt", (await dp.getByRole("menu").count()) === 0);

  // Dialog: erstes Feld hat den Fokus, Tab bleibt im Dialog, Escape schließt, Fokus kehrt zurück
  const dlgBtn = dp.getByRole("button", { name: "Dialog", exact: true });
  await dlgBtn.focus();
  await dp.keyboard.press("Enter");
  const dlg = dp.getByRole("dialog", { name: "Spiel umbenennen" });
  await dlg.waitFor();
  check("Dialog: der Fokus liegt im ersten Feld, nicht auf dem Schließen-Knopf", await dp.evaluate(() => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest("dialog")));
  let inside = true;
  for (let i = 0; i < 6; i++) {
    await dp.keyboard.press("Tab");
    inside &&= await dp.evaluate(() => !!document.activeElement?.closest("dialog"));
  }
  check("Dialog: Tab bleibt im Dialog", inside);
  await dp.keyboard.press("Escape");
  await dlg.waitFor({ state: "hidden" });
  check("Dialog: Escape schließt, der Fokus kehrt zum Auslöser zurück", await dp.evaluate(() => document.activeElement?.textContent?.trim() === "Dialog"));
  await dlgBtn.click();
  await dlg.getByRole("button", { name: "Dialog schließen" }).click();
  await dlg.waitFor({ state: "hidden" });
  check("Dialog: Schließen-Knopf mit Namen", true);

  // Feld: Beschriftung, Fehler verbunden, Passwort-Auge, Radiogruppe per Pfeil
  const pw = dp.getByLabel("Passwort", { exact: true });
  check("Feld: Beschriftung führt zum Eingabefeld", (await pw.count()) === 1);
  check("Feld: Fehler macht das Feld ungültig und ist als Beschreibung verbunden", await pw.evaluate((el) => {
    const id = el.getAttribute("aria-describedby");
    return el.getAttribute("aria-invalid") === "true" && !!id && document.getElementById(id.split(" ").pop()).textContent.includes("zu kurz");
  }));
  const eye = dp.getByLabel("Passwort mit Auge", { exact: true });
  const eyeGroup = dp.locator(".input-group").filter({ has: eye });
  await eyeGroup.getByRole("button", { name: "Passwort anzeigen" }).click();
  check("Passwort-Auge zeigt die Eingabe", (await eye.getAttribute("type")) === "text");
  await eyeGroup.getByRole("button", { name: "Passwort verbergen" }).click();
  check("Passwort-Auge verbirgt sie wieder", (await eye.getAttribute("type")) === "password");
  await dp.getByRole("radio", { name: /^Versteckt/ }).focus();
  await dp.keyboard.press("ArrowDown");
  check("Radiogruppe: Pfeil unten springt über den gesperrten Eintrag zum ersten", await dp.getByRole("radio", { name: /^Immer sichtbar/ }).isChecked());

  // Tooltip: Hover nach 400 ms, Escape blendet aus; Fokus per Tastatur zeigt sofort
  await dp.getByRole("button", { name: "Mit Tooltip" }).hover();
  await dp.getByRole("tooltip").waitFor({ timeout: 3000 });
  check("Tooltip erscheint beim Überfahren", (await dp.getByRole("tooltip").innerText()) === "Speichert den Entwurf");
  await dp.keyboard.press("Escape");
  await dp.getByRole("tooltip").waitFor({ state: "detached" });
  await dp.mouse.move(5, 5);

  // Meldung: Restzeit hält bei Hover an
  await dp.getByRole("button", { name: "Info", exact: true }).click();
  const t = dp.locator(".toast", { hasText: "Meldung gesendet." });
  await t.waitFor();
  await t.hover();
  await dp.waitForTimeout(4600);
  check("Meldung bleibt bei Hover stehen", (await t.count()) === 1);
  await dp.mouse.move(5, 5);
  await t.waitFor({ state: "detached", timeout: 8000 });
  check("Meldung verschwindet nach dem Wegnehmen der Maus", true);

  // Handy: nichts läuft über, Tabelle wird zur Karte
  await dp.setViewportSize({ width: 390, height: 844 });
  await shot(dp, "entwurf-handy", { fullPage: true });
  check("Tabelle schmal als Karten (Container-Query)", await dp.evaluate(() => getComputedStyle(document.querySelector(".table--cards thead")).display === "none"));

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
if (brokenSections.length) failed = true;
console.log(`\n${checks.filter((c) => c.ok).length} Prüfungen bestanden${failed ? ", Lauf abgebrochen" : ""}. Bildschirmfotos: ${shots}`);
for (const b of brokenSections) console.log(`Abgebrochen: ${b}`);
for (const n of notes) console.log(`Hinweis: ${n}`);
writeFileSync(join(shots, "ergebnis.json"), JSON.stringify({ checks, notes, brokenSections, failed }, null, 2));
process.exit(failed ? 1 : 0);
