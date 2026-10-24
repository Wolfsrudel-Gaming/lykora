#!/usr/bin/env node
// Probe des Updaters allein mit dem echten Docker-Daemon. Der Lykora-Server wird dafür nicht
// gebraucht: Ein kleiner Plan-Server hier im Skript sagt „update“ oder „wait“. Das ganze Zusammenspiel
// mit Server und compose.yaml prüft run.mjs; dieses Skript ergänzt den Abbruch mitten im Update.
//
// Baut Test-Images FROM lykora-server:latest mit frisch gebautem server/dist und eigenen
// LYKORA_COMMIT-Labels, liefert sie über registry.mjs als localhost:5000/lykora-upd:testbuild aus und
// spielt durch:
//   1. Ziel-Container läuft mit v1, Registry zeigt v2 → ersetzt, gesund, gleicher Name, Netze, Env
//   2. v3 mit kaputtem Healthcheck → zurück auf v2
//   3. Abbruch mitten im Update (Container nur noch als -alt, gestoppt) → beim Start wiederhergestellt
//   4. Updater als Container, v4 → Server ersetzt, Updater erneuert sich selbst
// Danach sind alle Container, Netze, Volumes und Images des Laufs wieder weg.
//
// Aufruf: node server/tool/updater-e2e/updater-only.mjs [--no-build] [--keep]
//   --no-build  vorhandenes server/dist nutzen
//   --keep      nichts aufräumen (zum Nachsehen)

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "..");
const root = join(server, "..");
const args = new Set(process.argv.slice(2));

const PREFIX = "lykora-upd";
const REGISTRY = "http://127.0.0.1:5000";
const REPO = "localhost:5000/lykora-upd";
const REF = `${REPO}:testbuild`;
const NET = `${PREFIX}-net`;
const NET2 = `${PREFIX}-net2`;
const VOLUME = `${PREFIX}-data`;
const TOKEN = "e2e-updater-token";
const TARGET = `${PREFIX}-server`;

const work = mkdtempSync(join(tmpdir(), "lykora-upd-e2e-"));
const imageIds = new Set();
const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
  if (!ok) throw new Error(`Prüfung fehlgeschlagen: ${name} ${detail}`);
}

function docker(...argv) {
  const res = spawnSync("docker", argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`docker ${argv.join(" ")}: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

const quiet = (...argv) => spawnSync("docker", argv, { encoding: "utf8" });
const inspect = (name) => {
  const res = quiet("container", "inspect", name);
  return res.status === 0 ? JSON.parse(res.stdout)[0] : null;
};
const imageId = (ref) => docker("image", "inspect", "--format", "{{.Id}}", ref);

async function until(fn, label, timeout = 120_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(500);
  }
  throw new Error(`Zeit abgelaufen: ${label}`);
}

/** Test-Image: Server aus server/dist mit eigener Version; „broken“ hat einen Healthcheck, der nie klappt. */
function buildImage(version, { broken = false } = {}) {
  const commit = createHash("sha1").update(`v${version}-${Date.now()}`).digest("hex");
  const builtAt = new Date().toISOString();
  const dir = join(work, `ctx-v${version}`);
  cpSync(join(server, "dist"), join(dir, "dist"), { recursive: true });
  cpSync(join(server, "migrations"), join(dir, "migrations"), { recursive: true });
  const health = broken
    ? "HEALTHCHECK --interval=1s --timeout=2s --retries=2 CMD exit 1"
    : `HEALTHCHECK --interval=2s --timeout=3s --start-period=60s --start-interval=1s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:3000/lykora/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
  writeFileSync(
    join(dir, "Dockerfile"),
    [
      "FROM lykora-server:latest",
      "COPY dist /app/server/dist",
      "COPY migrations /app/server/migrations",
      `ENV LYKORA_VERSION=${version} LYKORA_COMMIT=${commit} LYKORA_BUILT_AT=${builtAt}`,
      `LABEL org.opencontainers.image.version=${version} org.opencontainers.image.revision=${commit} org.opencontainers.image.created=${builtAt}`,
      health,
      "",
    ].join("\n"),
  );
  const tag = `${PREFIX}-build:v${version}`;
  docker("build", "-q", "-t", tag, dir);
  imageIds.add(imageId(tag));
  const tar = join(work, `v${version}.tar`);
  docker("save", "-o", tar, tag);
  // Ohne lokale Kopie muss Docker die neuen Schichten wirklich aus der Registry holen.
  docker("rmi", tag);
  return { version: String(version), commit, tar };
}

/**
 * Registry als eigener Prozess: Dieses Skript blockiert bei jedem docker-Aufruf (spawnSync), und
 * der Docker-Daemon holt die Images bei der Registry ab.
 */
async function startRegistryProcess() {
  const child = spawn(process.execPath, [join(here, "registry.mjs"), "--port", "5000"], { stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", (d) => output.push(String(d)));
  child.stderr.on("data", (d) => output.push(String(d)));
  children.push(child);
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`Registry startet nicht auf Port 5000: ${output.join("").trim()}`);
    return (await fetch(`${REGISTRY}/v2/`).catch(() => null))?.ok;
  }, "Registry", 10_000);
  return {
    /** Lässt den Tag auf ein anderes Archiv zeigen und gibt den Digest zurück. */
    async setTag(ref, tar) {
      const res = await fetch(`${REGISTRY}/-/tags/${ref}`, { method: "PUT", body: tar });
      if (!res.ok) throw new Error(`Registry: ${await res.text()}`);
      return (await res.json()).digest;
    },
  };
}

/** Plan-Server wie der echte: Bearer-Token, GET /updater/plan, POST /updater/report. */
async function startPlanServer() {
  const plan = { action: "wait", reason: "Nichts Neues", pollSeconds: 2 };
  const reports = [];
  let asked = 0;
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
    if (req.method === "GET" && req.url === "/lykora/api/updater/plan") {
      asked++;
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(plan));
    }
    if (req.method === "POST" && req.url === "/lykora/api/updater/report") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const report = JSON.parse(body);
      reports.push(report);
      console.log(`  Bericht: ${report.state}${report.message ? ` – ${report.message.split("\n")[0]}` : ""}`);
      return void res.writeHead(204).end();
    }
    res.writeHead(404).end();
  });
  // Auf allen Adressen, damit der Updater im Container (Schritt 4) über host-gateway herankommt
  await new Promise((r) => http.listen(0, "0.0.0.0", r));
  return {
    port: http.address().port,
    plan,
    reports,
    asked: () => asked,
    update(target) {
      Object.assign(plan, { action: "update", reason: `Test: ${target.version}`, target });
    },
    wait() {
      Object.assign(plan, { action: "wait", reason: "Nichts Neues" });
      delete plan.target;
    },
    /** Wartet auf den nächsten Endzustand nach Bericht Nummer „from“. */
    async final(from, timeout = 300_000) {
      let found;
      await until(() => (found = reports.slice(from).find((r) => !["pulling", "updating", "restarting"].includes(r.state))), "Endzustand des Updaters", timeout);
      return found;
    },
    close: () => new Promise((r) => http.close(r)),
  };
}

function startUpdater(planUrl) {
  const child = spawn(process.execPath, [join(server, "dist", "updater.js")], {
    env: { ...process.env, LYKORA_SERVER_URL: planUrl, UPDATER_TOKEN: TOKEN, UPDATER_POLL_SECONDS: "2", DOCKER_SOCKET: "/var/run/docker.sock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (d) => String(d).trimEnd().split("\n").forEach((line) => console.log(`  [updater] ${line}`));
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  children.push(child);
  return child;
}

async function stopUpdater(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
}

const healthy = (name) => inspect(name)?.State.Health?.Status === "healthy";
const revision = (info) => info.Config.Labels["org.opencontainers.image.revision"];

async function main() {
  if (!args.has("--no-build")) {
    console.log("Baue server/dist …");
    const res = spawnSync("npm", ["run", "build", "-w", "@lykora/server"], { cwd: root, stdio: "inherit" });
    if (res.status !== 0) throw new Error("Build des Servers gescheitert");
  }
  console.log("Baue Test-Images v1 bis v4 …");
  const v1 = buildImage(1);
  const v2 = buildImage(2);
  const v3 = buildImage(3, { broken: true });
  const v4 = buildImage(4);

  const registry = await startRegistryProcess();
  await registry.setTag("lykora-upd:testbuild", v1.tar);
  const pull = spawnSync("docker", ["pull", REF], { encoding: "utf8" });
  check("docker pull aus der Test-Registry", pull.status === 0, (pull.stdout.trim().split("\n").at(-1) ?? "") + pull.stderr.trim());
  const v1Id = imageId(REF);
  imageIds.add(v1Id);
  check("gezogenes Image ist v1", revision({ Config: JSON.parse(docker("image", "inspect", REF))[0].Config }) === v1.commit);

  // Umgebung wie bei Compose: Netz mit Alias, zweites Netz, Volume, Datenbank, fremder Container
  docker("network", "create", NET);
  docker("network", "create", NET2);
  docker("volume", "create", VOLUME);
  docker("run", "-d", "--name", `${PREFIX}-db`, "--network", NET, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_USER=lykora", "-e", "POSTGRES_DB=lykora", "postgres:16-alpine");
  await until(
    () => docker("logs", `${PREFIX}-db`).includes("PostgreSQL init process complete") || quiet("logs", `${PREFIX}-db`).stderr.includes("PostgreSQL init process complete"),
    "Datenbank",
  );
  await until(() => quiet("exec", `${PREFIX}-db`, "pg_isready", "-U", "lykora", "-d", "lykora").status === 0, "Datenbank bereit");

  docker(
    "run", "-d", "--name", TARGET, "--network", NET, "--network-alias", "server",
    "--label", "io.lykora.autoupdate=true", "--restart", "unless-stopped",
    "-e", `DATABASE_URL=postgres://lykora@${PREFIX}-db:5432/lykora`, "-e", "BASE_PATH=/lykora", "-e", "LYKORA_E2E=bleibt",
    "-v", `${VOLUME}:/data`, REF,
  );
  docker("network", "connect", "--alias", "zweitname", NET2, TARGET);
  docker("run", "-d", "--name", `${PREFIX}-fremd`, "--network", NET, "--no-healthcheck", REF, "node", "-e", "setInterval(() => {}, 1 << 30)");
  await until(() => healthy(TARGET), "v1 gesund");
  const before = inspect(TARGET);
  const fremd = inspect(`${PREFIX}-fremd`);
  check("v1 läuft gesund", revision(before) === v1.commit);

  const plan = await startPlanServer();
  children.push({ close: () => plan.close() });
  const planUrl = `http://127.0.0.1:${plan.port}/lykora`;
  let updater = startUpdater(planUrl);
  await until(() => plan.asked() > 0, "Updater fragt den Plan-Server");

  // 1. Update auf v2
  console.log("\n1. Update auf v2");
  let mark = plan.reports.length;
  plan.update({ commit: v2.commit, version: v2.version, digest: await registry.setTag("lykora-upd:testbuild", v2.tar) });
  let result = await plan.final(mark);
  plan.wait();
  check("Updater meldet „Update eingespielt“", result.state === "idle" && result.message === "Update eingespielt", JSON.stringify(result));
  check("Ablauf pulling → updating → restarting → idle", plan.reports.slice(mark).map((r) => r.state).join(",") === "pulling,updating,restarting,idle");
  const v2Id = imageId(REF);
  imageIds.add(v2Id);
  const after = inspect(TARGET);
  check("neuer Container unter altem Namen", after.Id !== before.Id && after.Name === `/${TARGET}`);
  check("läuft mit v2 und meldet dessen Image-ID", after.Image === v2Id && revision(after) === v2.commit && result.imageId === v2Id);
  check("gesund", after.State.Health?.Status === "healthy");
  const env = after.Config.Env;
  check(
    "eigene Umgebung bleibt, die des Images ist neu",
    env.includes("LYKORA_E2E=bleibt") && env.includes(`DATABASE_URL=postgres://lykora@${PREFIX}-db:5432/lykora`) && env.includes(`LYKORA_COMMIT=${v2.commit}`) && !env.includes(`LYKORA_COMMIT=${v1.commit}`),
  );
  const nets = after.NetworkSettings.Networks;
  check("beide Netze mit Aliasen", nets[NET]?.Aliases?.includes("server") && nets[NET2]?.Aliases?.includes("zweitname"), JSON.stringify(Object.keys(nets)));
  check(
    "Volume und Neustart-Regel bleiben",
    JSON.stringify(after.HostConfig.Binds) === JSON.stringify(before.HostConfig.Binds) && after.HostConfig.RestartPolicy.Name === "unless-stopped",
  );
  check("kein -alt übrig", inspect(`${TARGET}-alt`) === null);
  check("alte Version als lykora-rollback markiert", imageId(`${REPO}:lykora-rollback`) === v1Id);
  const fremdNow = inspect(`${PREFIX}-fremd`);
  check("Container ohne Label unberührt", fremdNow.Id === fremd.Id && fremdNow.Image === v1Id && fremdNow.State.Running);
  const viaAlias = quiet("exec", `${PREFIX}-fremd`, "node", "-e", "fetch('http://server:3000/lykora/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))");
  check("Server über den Alias „server“ erreichbar", viaAlias.status === 0);

  // 2. Kaputte Version v3
  console.log("\n2. Kaputte Version v3");
  mark = plan.reports.length;
  plan.update({ commit: v3.commit, version: v3.version, digest: await registry.setTag("lykora-upd:testbuild", v3.tar) });
  result = await plan.final(mark);
  plan.wait();
  imageIds.add(imageId(REF));
  check("Updater rollt zurück", result.state === "rolled_back", result.message.split("\n")[0]);
  check("Grund und Log stehen im Bericht", result.message.includes("Healthcheck schlägt fehl") && result.message.includes("Letzte Zeilen"));
  const back = inspect(TARGET);
  check("wieder der v2-Container", back.Id === after.Id && back.Image === v2Id && back.State.Running);
  await until(() => healthy(TARGET), "v2 nach Rückfall gesund", 60_000);
  const leftovers = docker("ps", "-a", "--filter", `name=${TARGET}`, "--format", "{{.Names}}").split("\n");
  check("kein v3-Container und kein -alt übrig", leftovers.join(",") === TARGET, leftovers.join(","));

  // 3. Abbruch mitten im Update
  console.log("\n3. Abbruch mitten im Update");
  await stopUpdater(updater);
  docker("rename", TARGET, `${TARGET}-alt`);
  docker("stop", `${TARGET}-alt`);
  mark = plan.reports.length;
  updater = startUpdater(planUrl);
  await until(() => inspect(TARGET)?.State.Running && !inspect(`${TARGET}-alt`), "Wiederherstellung", 60_000);
  check("Container unter altem Namen wieder da und gestartet", inspect(TARGET).Id === after.Id);
  await until(() => plan.reports.length > mark, "Bericht nach Wiederherstellung", 30_000);
  check("Bericht „rolled_back“ nach Abbruch", plan.reports[mark].state === "rolled_back", plan.reports[mark].message);
  await until(() => healthy(TARGET), "gesund nach Wiederherstellung", 60_000);
  await stopUpdater(updater);

  // 4. Updater als Container erneuert sich selbst
  console.log("\n4. Updater als Container, Selbst-Update auf v4");
  const oldUpdater = docker(
    "run", "-d", "--name", `${PREFIX}-updater`, "--label", "io.lykora.updater=true", "--user", "0",
    "--restart", "unless-stopped", "--no-healthcheck", "--add-host", "host.docker.internal:host-gateway",
    // Volume nur lesend wie in compose.yaml; ohne Einbindung bekäme jeder Updater ein anonymes Volume für /data.
    "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", `${VOLUME}:/data:ro`,
    "-e", `LYKORA_SERVER_URL=http://host.docker.internal:${plan.port}/lykora`, "-e", `UPDATER_TOKEN=${TOKEN}`, "-e", "UPDATER_POLL_SECONDS=2",
    REF, "node", "dist/updater.js",
  );
  const asked = plan.asked();
  await until(() => plan.asked() > asked, "Updater im Container fragt den Plan-Server", 60_000);
  mark = plan.reports.length;
  plan.update({ commit: v4.commit, version: v4.version, digest: await registry.setTag("lykora-upd:testbuild", v4.tar) });
  result = await plan.final(mark);
  plan.wait();
  const v4Id = imageId(REF);
  imageIds.add(v4Id);
  check("Server auf v4", result.state === "idle" && result.message === "Update eingespielt" && inspect(TARGET).Image === v4Id, JSON.stringify(result));
  await until(() => {
    const u = inspect(`${PREFIX}-updater`);
    return u && u.Id !== oldUpdater && u.State.Running && !inspect(`${PREFIX}-updater-neu`);
  }, "neuer Updater übernimmt", 120_000);
  const fresh = inspect(`${PREFIX}-updater`);
  check("neuer Updater unter altem Namen mit v4", fresh.Image === v4Id && fresh.Config.Env.includes(`LYKORA_UPDATER_REPLACES=${oldUpdater}`));
  check("alter Updater gelöscht", inspect(oldUpdater) === null);
  check(
    "neuer Updater behält Label, Socket, Volume und Plan-Adresse",
    fresh.Config.Labels["io.lykora.updater"] === "true" &&
      fresh.HostConfig.Binds.includes("/var/run/docker.sock:/var/run/docker.sock") &&
      fresh.HostConfig.Binds.includes(`${VOLUME}:/data:ro`) &&
      fresh.Config.Env.some((e) => e.startsWith("LYKORA_SERVER_URL=http://host.docker.internal")),
  );
  const asked2 = plan.asked();
  await until(() => plan.asked() > asked2, "neuer Updater fragt den Plan-Server", 30_000);
  console.log(`\n  Log des neuen Updaters:\n${docker("logs", `${PREFIX}-updater`).split("\n").map((l) => `    ${l}`).join("\n")}`);
  console.log("\nAlles bestanden.");
}

function cleanup() {
  for (const child of children) child.close ? child.close() : child.exitCode === null && child.kill("SIGTERM");
  if (args.has("--keep")) return console.log(`Nicht aufgeräumt (--keep); Arbeitsordner ${work}`);
  const names = quiet("ps", "-a", "--filter", `name=^${PREFIX}-`, "--format", "{{.Names}}").stdout.split("\n").filter(Boolean);
  if (names.length) quiet("rm", "-f", "-v", ...names);
  quiet("network", "rm", NET, NET2);
  quiet("volume", "rm", VOLUME);
  const refs = quiet("image", "ls", "--format", "{{.Repository}}:{{.Tag}}", "--filter", `reference=${REPO}`).stdout.split("\n").filter(Boolean);
  if (refs.length) quiet("rmi", "-f", ...refs);
  for (const id of imageIds) quiet("rmi", "-f", id);
  rmSync(work, { recursive: true, force: true });
}

try {
  await main();
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
