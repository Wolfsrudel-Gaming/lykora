// Startet eine eigene Instanz für den Prüfstand: Server aus server/src mit dem Build aus web/dist.
//   node web/e2e/visual/instance.mjs [--reset] [--freeze]      (läuft bis Strg+C / SIGTERM)
//   --reset   leert die Datenbank vorher (drop schema public cascade). Nur mit einer eigenen Prüfstand-Datenbank benutzen!
//   --freeze  friert die Uhr des Servers auf Säzeitpunkt + 10 min (aus state.json) ein, passend zur Uhr der Seiten.
//             Erst nach seed.mjs benutzen: Instanz ohne --freeze starten, säen, beenden, mit --freeze neu starten.
// Umgebung: VISUAL_DB (Standard postgres://lykora@localhost:5432/lykora_visual, muss existieren), VISUAL_PORT (3200).
// Danach in einem zweiten Terminal: seed.mjs, fingerprint.mjs, shots.mjs.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HERE, loadState, ROOT, sleep } from "./lib.mjs";

const DB = process.env.VISUAL_DB ?? "postgres://lykora@localhost:5432/lykora_visual";
const PORT = process.env.VISUAL_PORT ?? "3200";
if (process.argv.includes("--reset")) {
  const pg = createRequire(join(ROOT, "package.json"))("pg");
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.end();
}
const dataDir = mkdtempSync(join(tmpdir(), "lykora-visual-"));
const freeze = process.argv.includes("--freeze");
const nodeArgs = freeze ? ["--import", join(HERE, "freeze-clock.mjs")] : [];
const child = spawn(process.execPath, [...nodeArgs, "src/server.ts"], {
  cwd: join(ROOT, "server"),
  stdio: "inherit",
  env: {
    ...process.env, DATABASE_URL: DB, PORT, BASE_PATH: "/lykora", WEB_DIR: join(ROOT, "web/dist"), DATA_DIR: dataDir,
    PUBLIC_URL: `http://localhost:${PORT}/lykora`, ADMIN_EMAIL: "admin@example.org", ADMIN_PASSWORD: "geheim-geheim", LOG_LEVEL: "warn",
    ...(freeze ? { VISUAL_NOW: String(loadState().seededAt + 10 * 60_000) } : {}),
  },
});
const stop = () => { child.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/lykora/api/health`)).ok) { console.log(`Instanz läuft auf http://localhost:${PORT}/lykora`); break; } } catch { /* startet noch */ }
  await sleep(300);
}
await new Promise((r) => child.on("exit", r));
rmSync(dataDir, { recursive: true, force: true });
