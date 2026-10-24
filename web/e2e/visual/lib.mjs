// Gemeinsame Helfer des visuellen Prüfstands: Browser, Kontext, Kachel-Attrappe, Zustandsdatei.
// Alles Konfigurierbare kommt aus der Umgebung (siehe README.md); geschrieben wird nur nach VISUAL_OUT.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { encodeRgb } from "./png.mjs";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/pw-browsers";
export const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../../..");
/** Ausgabeordner; Standard ist web/e2e/visual/out (in .gitignore). */
export const OUT = resolve(process.env.VISUAL_OUT ?? join(HERE, "out"));
/** Basis-URL der laufenden Instanz inklusive Basispfad. */
export const APP = (process.env.VISUAL_URL ?? "http://localhost:3200/lykora").replace(/\/+$/, "");
export const STATE_FILE = join(OUT, "state.json");
export const VPS = { d: { width: 1440, height: 900 }, t: { width: 1024, height: 768 }, m: { width: 390, height: 844 }, p: { width: 794, height: 1123 } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starten mit festen Raster-Optionen: ohne sie wechselt das Rasterrauschen (±1/255 an Rundungen) von Lauf zu Lauf. */
export const launch = () =>
  chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text", "--font-render-hinting=none", "--disable-partial-raster", "--num-raster-threads=1", "--disable-skia-runtime-opts"] });

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Zustand der gesäten Instanz (Token, Ids, Zeitpunkt des Säens). Fehlt er: seed.mjs ausführen. */
export function loadState() {
  if (!existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} fehlt: erst "node web/e2e/visual/seed.mjs" gegen die Instanz ausführen`);
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

/** Löst ein Label (z. B. "vorher") oder einen Pfad zu einem Ordner/einer Datei auf. */
export function resolveOut(arg, prefix, ext = "") {
  if (arg.includes("/") || existsSync(arg)) return resolve(arg);
  return join(OUT, `${prefix}-${arg}${ext}`);
}

// Kachel-Attrappe: deterministische Karten ohne Netz.
function tile() {
  const size = 256, rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const line = x % 64 === 0 || y % 64 === 0, o = (y * size + x) * 3;
    rgb[o] = line ? 0xc9 : 0xe4; rgb[o + 1] = line ? 0xc4 : 0xdf; rgb[o + 2] = line ? 0xb6 : 0xd2;
  }
  return encodeRgb(size, size, rgb);
}
const tilePng = tile();

/**
 * Öffnet einen frischen Kontext. vpKey: d (1440x900), t (1024x768), m (390x844), p (A4 für Druck).
 * theme: "night" oder "light". Die Uhr der Seite steht fest auf Säzeitpunkt + 10 Minuten,
 * damit relative Zeitangaben und Marker nicht vom Wanduhrzeit-Verlauf abhängen.
 */
export async function open(browser, S, vpKey, theme, { auth = true, org = S.org.id } = {}) {
  const context = await browser.newContext({
    locale: "de-DE", timezoneId: "Europe/Berlin", viewport: VPS[vpKey], deviceScaleFactor: 1,
    isMobile: vpKey === "m", hasTouch: vpKey === "m" || vpKey === "t",
  });
  await context.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: tilePng }));
  await context.addInitScript(([a, t, o, th]) => {
    try {
      if (a) { localStorage.setItem("lykora.token", t); localStorage.setItem("lykora.org", o); }
      localStorage.setItem("lykora.theme", th);
    } catch { /* ohne Speicher läuft die Seite im Standardthema */ }
  }, [auth, S.token, org, theme === "light" ? "day" : "night"]);
  const page = await context.newPage();
  if (S.seededAt) await page.clock.setFixedTime(S.seededAt + 10 * 60_000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return { context, page };
}
