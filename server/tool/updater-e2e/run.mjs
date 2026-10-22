#!/usr/bin/env node
// Ende-zu-Ende-Probe der automatischen Updates mit echtem Docker: compose.yaml aus dem Repo, echter
// Server, echter Updater, Test-Registry. Docker Hub ist rate-limitiert, darum kommen die Test-Images
// FROM lykora-server:latest mit frisch gebautem server/dist, web/dist, spec und Migrationen; Basis-Images
// werden nie gezogen. Die Registry (registry.mjs) liefert sie als localhost:5000/lykora:testbuild aus.
//
// Ablauf:
//   1. Compose-Projekt lykora-e2e-update mit v1; Admin angemeldet, instanceAdmin, Updater verbunden,
//      ohne Opt-in wartet der Plan
//   2. v2 in der Registry, Prüfung findet sie; Opt-in → Server und Updater laufen mit v2 (Selbst-Update),
//      Verlauf „succeeded“, Daten bleiben, keine Reste (-alt/-neu)
//   3. Laufendes Event hält v3 auf (blockedBy event_running); nach dem Ende startet v3 nicht gesund →
//      Rückfall auf v2, Verlauf „rolled_back“
//   4. Opt-in aus, „Jetzt aktualisieren“ → v4
//   5. Ziel-Container mit lokalem Image → „unsupported“; ohne ihn klappt der Auftrag → v5
// Danach: compose down -v, Registry aus, alle Test-Images weg (nie lykora-server:latest, postgres:16-alpine).
//
// Aufruf: node server/tool/updater-e2e/run.mjs [--no-build] [--keep]
//   --no-build  vorhandene server/dist und web/dist nutzen
//   --keep      nichts aufräumen (zum Nachsehen); Umgebung dann von Hand mit
//               docker compose -p lykora-e2e-update down -v entfernen
// Braucht: Docker-Daemon, Images lykora-server:latest und postgres:16-alpine, freie Ports 5000 und 3200.
// Dauer: gut eine Minute mit vorhandenem Build. Der Abbruch mitten im Update steht in updater-only.mjs.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const args = new Set(process.argv.slice(2));

const PROJECT = "lykora-e2e-update";
const REGISTRY_PORT = 5000;
const REGISTRY = `http://127.0.0.1:${REGISTRY_PORT}`;
const REPO = `localhost:${REGISTRY_PORT}/lykora`;
const REF = `${REPO}:testbuild`;
const PORT = 3200;
const SERVER = `http://127.0.0.1:${PORT}/lykora`;
const ADMIN = { email: "admin@example.org", password: "geheim-geheim" };
const NAMES = { server: `${PROJECT}-server-1`, updater: `${PROJECT}-updater-1`, local: `${PROJECT}-lokal` };
const LOCAL_IMAGE = `${PROJECT}-lokal:latest`;

const work = mkdtempSync(join(tmpdir(), "lykora-update-e2e-"));
const envFile = join(work, "e2e.env");
const overrideFile = join(work, "compose.e2e.yaml");
const imageIds = new Set();
const children = [];
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0).padStart(3)} s`;

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` – ${detail}` : ""}`);
  if (!ok) throw new Error(`Prüfung fehlgeschlagen: ${name} ${detail}`);
}

const step = (title) => console.log(`\n[${elapsed()}] ${title}`);

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
const healthy = (name) => inspect(name)?.State.Health?.Status === "healthy";
const projectContainers = () =>
  quiet("ps", "-a", "--filter", `name=^${PROJECT}-`, "--format", "{{.Names}}").stdout.split("\n").filter(Boolean).sort();

/** Compose mit Projektname, Umgebungsdatei und der Ergänzung für die Probe; Ausgabe läuft durch. */
function compose(...argv) {
  const res = spawnSync("docker", ["compose", "-p", PROJECT, "--env-file", envFile, "-f", join(root, "compose.yaml"), "-f", overrideFile, ...argv], {
    cwd: root,
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error(`docker compose ${argv.join(" ")} scheitert`);
}

async function until(fn, label, timeout = 120_000) {
  const end = Date.now() + timeout;
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value) return value;
    if (Date.now() >= end) throw new Error(`Zeit abgelaufen (${timeout / 1000} s): ${label}`);
    await sleep(500);
  }
}

// ---------- HTTP ----------

/** Ruft die API; Verbindungsfehler (Server startet gerade neu) werfen. */
async function api(method, path, body, token) {
  const res = await fetch(`${SERVER}/api${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Wie api, aber mit erwartetem Status; sonst Abbruch mit der Antwort. */
async function expectApi(method, path, body, token, status) {
  const res = await api(method, path, body, token);
  if (res.status !== status) throw new Error(`${method} ${path}: HTTP ${res.status} statt ${status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

// ---------- Images ----------

/**
 * Test-Image mit eigener Version aus dem aktuellen Build; „broken“ bekommt einen Healthcheck, der nie
 * klappt (der Server selbst startet). Ein kurzer Healthcheck hält die Probe kurz.
 */
function buildImage(version, { broken = false } = {}) {
  const commit = createHash("sha1").update(`v${version}-${Date.now()}`).digest("hex");
  const builtAt = new Date().toISOString();
  const dir = join(work, `ctx-v${version}`);
  // Dieselben Ordner wie im Dockerfile; spec ganz, weil validate.mjs weitere Module daneben lädt.
  for (const path of ["server/dist", "server/migrations", "server/media-library", "web/dist", "spec"]) {
    cpSync(join(root, path), join(dir, path), { recursive: true, filter: (src) => basename(src) !== "node_modules" });
  }
  const health = broken
    ? "HEALTHCHECK --interval=1s --timeout=2s --retries=2 CMD exit 1"
    : `HEALTHCHECK --interval=2s --timeout=3s --start-period=60s --start-interval=1s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:3000/lykora/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
  writeFileSync(
    join(dir, "Dockerfile"),
    [
      "FROM lykora-server:latest",
      "COPY spec /app/spec",
      "COPY server/dist /app/server/dist",
      "COPY server/migrations /app/server/migrations",
      "COPY server/media-library /app/server/media-library",
      "COPY web/dist /app/web/dist",
      "ENV WEB_DIR=/app/web/dist MEDIA_LIBRARY_DIR=/app/server/media-library \\",
      `    LYKORA_VERSION=${version} LYKORA_COMMIT=${commit} LYKORA_BUILT_AT=${builtAt}`,
      `LABEL org.opencontainers.image.version=${version} org.opencontainers.image.revision=${commit} \\`,
      `      org.opencontainers.image.created=${builtAt} org.opencontainers.image.source=https://github.com/Wolfsrudel-Gaming/lykora`,
      health,
      "",
    ].join("\n"),
  );
  const tag = `${PROJECT}-build:v${version}`;
  docker("build", "-q", "-t", tag, dir);
  imageIds.add(imageId(tag));
  const tar = join(work, `v${version}.tar`);
  docker("save", "-o", tar, tag);
  // Ohne lokale Kopie muss Docker die neuen Schichten wirklich aus der Registry holen.
  docker("rmi", tag);
  rmSync(dir, { recursive: true, force: true });
  console.log(`  v${version}: Commit ${commit.slice(0, 7)}${broken ? " (kaputt)" : ""}`);
  return { version: String(version), commit, tar };
}

/** Registry als eigener Prozess auf allen Adressen: Der Server im Container erreicht sie über das Docker-Gateway. */
async function startRegistry() {
  if (await fetch(`${REGISTRY}/v2/`).then(() => true, () => false)) throw new Error(`Port ${REGISTRY_PORT} ist schon belegt`);
  const child = spawn(process.execPath, [join(here, "registry.mjs"), "--port", String(REGISTRY_PORT), "--host", "0.0.0.0"], { stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", (d) => output.push(String(d)));
  child.stderr.on("data", (d) => output.push(String(d)));
  children.push(child);
  await until(() => fetch(`${REGISTRY}/v2/`).then((r) => r.ok), "Registry", 10_000).catch((err) => {
    throw child.exitCode !== null ? new Error(`Registry startet nicht: ${output.join("").trim()}`) : err;
  });
  return {
    /** Lässt den Tag auf ein anderes Archiv zeigen und gibt den Digest zurück. */
    async setTag(tar) {
      const res = await fetch(`${REGISTRY}/-/tags/lykora:testbuild`, { method: "PUT", body: tar });
      if (!res.ok) throw new Error(`Registry: ${await res.text()}`);
      return (await res.json()).digest;
    },
  };
}

// ---------- Ablauf ----------

async function main() {
  if (!args.has("--no-build")) {
    step("Baue Server und Web-Dashboard");
    for (const pkg of ["@lykora/server", "@lykora/web"]) {
      const res = spawnSync("npm", ["run", "build", "-w", pkg], { cwd: root, stdio: "inherit" });
      if (res.status !== 0) throw new Error(`Build von ${pkg} gescheitert`);
    }
  }
  for (const path of ["server/dist/server.js", "server/dist/updater.js", "web/dist/index.html"]) {
    if (!existsSync(join(root, path))) throw new Error(`${path} fehlt; ohne --no-build aufrufen`);
  }
  for (const image of ["lykora-server:latest", "postgres:16-alpine"]) {
    if (quiet("image", "inspect", image).status !== 0) throw new Error(`Image ${image} fehlt lokal`);
  }

  step("Baue Test-Images");
  const v1 = buildImage(1);
  const v2 = buildImage(2);
  const v3 = buildImage(3, { broken: true });
  const v4 = buildImage(4);
  const v5 = buildImage(5);

  const registry = await startRegistry();
  await registry.setTag(v1.tar);
  const pull = spawnSync("docker", ["pull", REF], { encoding: "utf8" });
  check("docker pull aus der Test-Registry", pull.status === 0, pull.stderr.trim());
  const v1Id = imageId(REF);
  imageIds.add(v1Id);

  step("Starte compose.yaml als Projekt " + PROJECT);
  writeFileSync(
    envFile,
    [
      "POSTGRES_PASSWORD=e2e-geheim",
      `LYKORA_IMAGE=${REF}`,
      `PORT=${PORT}`,
      "BIND_ADDRESS=127.0.0.1",
      "BASE_PATH=/lykora",
      `PUBLIC_URL=${SERVER}`,
      `ADMIN_EMAIL=${ADMIN.email}`,
      `ADMIN_PASSWORD=${ADMIN.password}`,
      "UPDATE_TIMEZONE=Europe/Berlin",
      "",
    ].join("\n"),
  );
  // Nur für die Probe: kurze Abstände, und der Server erreicht die Registry auf dem Host über das Docker-Gateway.
  writeFileSync(
    overrideFile,
    [
      "services:",
      "  server:",
      "    environment:",
      '      UPDATE_CHECK_MINUTES: "1"',
      '      UPDATER_POLL_SECONDS: "3"',
      `      LYKORA_REGISTRY_URL: http://host.docker.internal:${REGISTRY_PORT}`,
      "    extra_hosts:",
      '      - "host.docker.internal:host-gateway"',
      "  updater:",
      "    environment:",
      '      UPDATER_POLL_SECONDS: "3"',
      "",
    ].join("\n"),
  );
  compose("up", "-d", "--no-build", "--pull", "never");
  await until(() => fetch(`${SERVER}/api/health`).then((r) => r.ok), "Server antwortet", 120_000);
  check("drei Container des Projekts laufen", projectContainers().join(",") === [`${PROJECT}-db-1`, NAMES.server, NAMES.updater].join(","), projectContainers().join(","));
  const server1 = inspect(NAMES.server);
  check("Server-Container läuft mit v1 aus der Registry", server1.Config.Image === REF && server1.Image === v1Id);

  step("1. Anmeldung, Stand der Updates, Updater verbunden");
  const login = await expectApi("POST", "/auth/login", ADMIN, undefined, 200);
  const token = login.token;
  const me = await expectApi("GET", "/me", undefined, token, 200);
  check("Admin ist Instanz-Admin", me.instanceAdmin === true);
  const orgId = me.orgs[0].id;
  const version = () => api("GET", "/system/version", undefined, token).then((r) => (r.status === 200 ? r.body : null));
  const status = () => expectApi("GET", "/system/update", undefined, token, 200);
  check("Version v1", (await version()).version === "1" && (await version()).commit === v1.commit);
  let s = await status();
  check("Update-Stand: konfiguriert, aktuell v1, Opt-in aus", s.configured && s.image === REF && s.current.commit === v1.commit && s.settings.auto === false, JSON.stringify(s.current));
  await until(async () => (await status()).upToDate === true, "Prüfung der Registry beim Start", 60_000);
  s = await until(async () => {
    const st = await status();
    return st.updater.connected ? st : null;
  }, "Updater verbunden", 90_000);
  check("Updater verbunden, nichts anstehend", s.updater.connected && s.pending === null && s.history.length === 0 && s.checkError === null, JSON.stringify(s.updater));
  const updaterToken = (await until(() => quiet("exec", NAMES.updater, "cat", "/data/updater.token").stdout.trim() || null, "Token des Updaters")).trim();
  const plan = async () => {
    const res = await fetch(`${SERVER}/api/updater/plan`, { headers: { authorization: `Bearer ${updaterToken}` } });
    return res.ok ? res.json() : null;
  };
  let p = await plan();
  check("Plan ohne neue Version: warten", p?.action === "wait" && p.pollSeconds === 3, JSON.stringify(p));
  const betreuer = await expectApi("POST", `/orgs/${orgId}/members`, { email: "betreuer@example.org", name: "Betreuer", password: "test-passwort-123", role: "supervisor" }, token, 201);
  const updater1 = inspect(NAMES.updater);

  step("2. v2 in der Registry, Opt-in, automatisches Update");
  const v2Digest = await registry.setTag(v2.tar);
  s = await expectApi("POST", "/system/update/check", undefined, token, 200);
  check("Prüfung findet v2 mit passendem Digest", s.available?.commit === v2.commit && s.available.version === "2" && s.available.digest === v2Digest && s.upToDate === false, JSON.stringify(s.available));
  p = await plan();
  check("Plan ohne Opt-in: warten", p?.action === "wait" && p.reason === "Automatische Updates sind aus", JSON.stringify(p));
  await sleep(7_000);
  s = await status();
  check("ohne Opt-in passiert nichts", s.history.length === 0 && s.pending === null && (await version()).version === "1" && inspect(NAMES.server).Id === server1.Id);
  s = await expectApi("PUT", "/system/update/settings", { auto: true }, token, 200);
  check("Opt-in gespeichert", s.settings.auto === true && s.blockedBy === null);
  await until(async () => (await version())?.version === "2", "Server läuft mit v2", 240_000);
  console.log(`  [${elapsed()}] v2 antwortet`);
  s = await until(async () => {
    const st = await status();
    return st.history[0]?.state === "succeeded" && st.updater.state === "idle" ? st : null;
  }, "Verlauf „succeeded“ und Updater wieder da", 120_000);
  check("Verlauf: automatisches Update v1 → v2 eingespielt", s.history.length === 1 && s.history[0].trigger === "auto" && s.history[0].from.commit === v1.commit && s.history[0].to.commit === v2.commit && s.history[0].message === "Update eingespielt" && s.history[0].finishedAt, JSON.stringify(s.history[0]));
  check("Stand: aktuell v2, nichts verfügbar", s.current.commit === v2.commit && s.available === null && s.upToDate === true && s.pending === null);
  check("Updater meldet „Update eingespielt“", s.updater.connected && s.updater.message === "Update eingespielt", JSON.stringify(s.updater));
  const members = await expectApi("GET", `/orgs/${orgId}/members`, undefined, token, 200);
  check("Daten bleiben: Mitglied von vorher und Sitzung gelten noch", members.some((m) => m.id === betreuer.id || m.email === "betreuer@example.org"));
  const v2Id = imageId(REF);
  imageIds.add(v2Id);
  const server2 = inspect(NAMES.server);
  check("neuer Server-Container unter altem Namen mit v2", server2.Id !== server1.Id && server2.Image === v2Id && server2.Config.Labels["org.opencontainers.image.revision"] === v2.commit);
  check("gesund, Compose-Labels und Port bleiben", healthy(NAMES.server) && server2.Config.Labels["com.docker.compose.project"] === PROJECT && server2.Config.Labels["com.docker.compose.image"] === v2Id && JSON.stringify(server2.HostConfig.PortBindings) === JSON.stringify(server1.HostConfig.PortBindings));
  check("alte Version als lykora-rollback markiert", imageId(`${REPO}:lykora-rollback`) === v1Id);
  const updater2 = await until(() => {
    const u = inspect(NAMES.updater);
    return u && u.Id !== updater1.Id && u.State.Running && u.Image === v2Id && !inspect(`${NAMES.updater}-neu`) ? u : null;
  }, "Updater erneuert sich selbst", 120_000);
  check("Updater läuft mit v2 und hat den Vorgänger abgelöst", updater2.Config.Env.includes(`LYKORA_UPDATER_REPLACES=${updater1.Id}`) && inspect(updater1.Id) === null && updater2.Config.Labels["io.lykora.updater"] === "true" && updater2.Config.Labels["com.docker.compose.service"] === "updater");
  check("keine Reste (-alt/-neu)", projectContainers().join(",") === [`${PROJECT}-db-1`, NAMES.server, NAMES.updater].join(","), projectContainers().join(","));
  await until(async () => (await status()).updater.connected, "neuer Updater fragt", 60_000);

  step("3. Laufendes Event hält auf; kaputte v3 wird zurückgerollt");
  const testspiel = JSON.parse(readFileSync(join(root, "spec/v0.1/examples/testspiel.json"), "utf8"));
  const game = await expectApi("POST", `/orgs/${orgId}/games`, { content: testspiel }, token, 201);
  const event = await expectApi("POST", `/orgs/${orgId}/events`, { gameId: game.id, name: "Probelauf" }, token, 201);
  check("Event läuft", (await expectApi("POST", `/events/${event.id}/start`, null, token, 200)).status === "running");
  await registry.setTag(v3.tar);
  s = await expectApi("POST", "/system/update/check", undefined, token, 200);
  check("Prüfung findet v3", s.available?.commit === v3.commit);
  check("blockedBy event_running mit dem Event", s.blockedBy?.reason === "event_running" && s.blockedBy.events.some((e) => e.id === event.id && e.status === "running"), JSON.stringify(s.blockedBy));
  p = await plan();
  check("Plan während des Events: warten", p?.action === "wait" && p.reason.startsWith("Event läuft"), JSON.stringify(p));
  const apply = await api("POST", "/system/update/apply", undefined, token);
  check("„Jetzt aktualisieren“ während des Events: 409 event_running", apply.status === 409 && apply.body.error === "event_running" && apply.body.events?.[0]?.id === event.id, JSON.stringify(apply.body));
  await sleep(8_000);
  s = await status();
  check("während des Events passiert nichts", s.history.length === 1 && s.pending === null && (await version()).version === "2" && inspect(NAMES.server).Id === server2.Id);
  check("Event beendet", (await expectApi("POST", `/events/${event.id}/end`, null, token, 200)).status === "ended");
  s = await until(async () => {
    const st = await status();
    return st.history[0]?.state === "rolled_back" ? st : null;
  }, "Rückfall im Verlauf", 300_000);
  console.log(`  [${elapsed()}] Rückfall gemeldet`);
  check("Verlauf: v3 zurückgerollt mit Grund", s.history[0].trigger === "auto" && s.history[0].to.commit === v3.commit && /nicht gesund/.test(s.history[0].message ?? ""), s.history[0].message?.split("\n")[0]);
  check("Updater meldet rolled_back", s.updater.state === "rolled_back" && s.updater.message === s.history[0].message);
  check("Server läuft wieder mit v2", (await version()).version === "2" && s.current.commit === v2.commit);
  // Das Tag zeigt lokal wieder auf v2; das Image von v3 räumt am Ende sein Build-Tag weg.
  check("Tag zeigt nach dem Rückfall wieder auf v2", imageId(REF) === server2.Image, imageId(REF));
  await until(() => healthy(NAMES.server), "v2 wieder gesund", 60_000);
  check("derselbe v2-Container, keine Reste", inspect(NAMES.server).Id === server2.Id && projectContainers().join(",") === [`${PROJECT}-db-1`, NAMES.server, NAMES.updater].join(","), projectContainers().join(","));
  // Darum geht es beim Zurücksetzen des Tags und beim Label com.docker.compose.image: Compose legt den
  // Server nicht mit der kaputten v3 neu an und lässt auch die vom Updater angelegten Container stehen.
  const updater2 = inspect(NAMES.updater);
  compose("up", "-d", "--no-build", "--pull", "never");
  check("„docker compose up -d“ lässt die Container von Server und Updater stehen", inspect(NAMES.server).Id === server2.Id && inspect(NAMES.updater).Id === updater2.Id);
  p = await until(() => plan(), "Plan nach dem Rückfall");
  check("automatisch erst nach einer Pause erneut", p.action === "wait" && /gescheitert/.test(p.reason), JSON.stringify(p));
  // Vor dem nächsten Selbst-Update, danach ist dieses Log weg.
  console.log(`  Log des Updaters:\n${containerLog(NAMES.updater, 40)}`);

  step("4. Opt-in aus, „Jetzt aktualisieren“ auf v4");
  s = await expectApi("PUT", "/system/update/settings", { auto: false }, token, 200);
  check("Opt-in aus", s.settings.auto === false);
  await registry.setTag(v4.tar);
  s = await expectApi("POST", "/system/update/check", undefined, token, 200);
  check("Prüfung findet v4", s.available?.commit === v4.commit);
  s = await expectApi("POST", "/system/update/apply", undefined, token, 202);
  check("Auftrag angenommen", s.pending?.trigger === "manual" && s.pending.to.commit === v4.commit, JSON.stringify(s.pending));
  await until(async () => (await version())?.version === "4", "Server läuft mit v4", 240_000);
  console.log(`  [${elapsed()}] v4 antwortet`);
  s = await until(async () => {
    const st = await status();
    return st.history[0]?.state === "succeeded" && st.updater.state === "idle" ? st : null;
  }, "Verlauf „succeeded“ für v4", 120_000);
  check("Verlauf: manuelles Update v2 → v4 eingespielt", s.history[0].trigger === "manual" && s.history[0].from.commit === v2.commit && s.history[0].to.commit === v4.commit && s.pending === null, JSON.stringify(s.history[0]));
  check("Verlauf hat drei Einträge", s.history.map((h) => h.state).join(",") === "succeeded,rolled_back,succeeded", s.history.map((h) => h.state).join(","));
  const v4Id = imageId(REF);
  imageIds.add(v4Id);
  const server4 = inspect(NAMES.server);
  check("Server-Container mit v4, Updater erneuert sich", server4.Image === v4Id && healthy(NAMES.server));
  await until(() => {
    const u = inspect(NAMES.updater);
    return u && u.Image === v4Id && u.State.Running && !inspect(`${NAMES.updater}-neu`);
  }, "Updater mit v4", 120_000);
  await until(async () => (await status()).updater.connected, "neuer Updater fragt", 60_000);
  check("keine Reste", projectContainers().join(",") === [`${PROJECT}-db-1`, NAMES.server, NAMES.updater].join(","), projectContainers().join(","));

  step("5. Ziel mit lokalem Image → unsupported");
  docker("tag", REF, LOCAL_IMAGE);
  docker("run", "-d", "--name", NAMES.local, "--label", "io.lykora.autoupdate=true", "--no-healthcheck", LOCAL_IMAGE, "node", "-e", "setInterval(() => {}, 1 << 30)");
  await registry.setTag(v5.tar);
  s = await expectApi("POST", "/system/update/check", undefined, token, 200);
  check("Prüfung findet v5", s.available?.commit === v5.commit);
  await expectApi("POST", "/system/update/apply", undefined, token, 202);
  s = await until(async () => {
    const st = await status();
    return st.updater.state === "unsupported" ? st : null;
  }, "Updater meldet unsupported", 90_000);
  check("Hinweis nennt das lokale Image und .env", /lokal gebauten Image/.test(s.updater.message) && s.updater.message.includes(NAMES.local) && s.updater.message.includes("LYKORA_IMAGE"), s.updater.message);
  check("Verlauf: gescheitert, Auftrag verfallen, Server unverändert", s.history[0].state === "failed" && s.history[0].message === s.updater.message && s.pending === null && inspect(NAMES.server).Id === server4.Id && (await version()).version === "4");
  // Mit -v, sonst bleibt das anonyme Volume für /data aus dem Image zurück.
  docker("rm", "-f", "-v", NAMES.local);
  await expectApi("POST", "/system/update/apply", undefined, token, 202);
  await until(async () => (await version())?.version === "5", "Server läuft mit v5", 240_000);
  s = await until(async () => {
    const st = await status();
    return st.history[0]?.state === "succeeded" && st.updater.state === "idle" ? st : null;
  }, "Verlauf „succeeded“ für v5", 120_000);
  check("ohne den lokalen Container klappt der Auftrag: v5", s.current.commit === v5.commit && s.history[0].to.commit === v5.commit && s.history[0].trigger === "manual");
  imageIds.add(imageId(REF));
  await until(() => inspect(NAMES.updater)?.Image === imageId(REF) && !inspect(`${NAMES.updater}-neu`), "Updater mit v5", 120_000);
  check("keine Reste", projectContainers().join(",") === [`${PROJECT}-db-1`, NAMES.server, NAMES.updater].join(","), projectContainers().join(","));

  console.log(`\n[${elapsed()}] Alles bestanden.`);
}

/** Die letzten Zeilen eines Containers, eingerückt; der Updater schreibt sie ohne JSON. */
const containerLog = (name, tail) => {
  const res = quiet("logs", "--tail", String(tail), name);
  return `${res.stdout}${res.stderr}`.trimEnd().split("\n").map((l) => `    ${l}`).join("\n");
};

function cleanup(failed) {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  if (failed) {
    for (const name of [NAMES.server, NAMES.updater]) if (inspect(name)) console.log(`\n  Log von ${name}:\n${containerLog(name, 40)}`);
  }
  if (args.has("--keep")) return console.log(`Nicht aufgeräumt (--keep); Arbeitsordner ${work}`);
  step("Aufräumen");
  if (existsSync(envFile) && existsSync(overrideFile)) {
    spawnSync("docker", ["compose", "-p", PROJECT, "--env-file", envFile, "-f", join(root, "compose.yaml"), "-f", overrideFile, "down", "-v", "--remove-orphans", "--timeout", "10"], { cwd: root, stdio: "inherit" });
  }
  const rest = projectContainers();
  if (rest.length) quiet("rm", "-f", "-v", ...rest);
  quiet("network", "rm", `${PROJECT}_default`);
  quiet("volume", "rm", `${PROJECT}_db`, `${PROJECT}_data`);
  const refs = [REPO, LOCAL_IMAGE, `${PROJECT}-build`]
    .flatMap((ref) => quiet("image", "ls", "--format", "{{.Repository}}:{{.Tag}}", "--filter", `reference=${ref}`).stdout.split("\n"))
    .filter(Boolean);
  if (refs.length) quiet("rmi", "-f", ...refs);
  for (const id of imageIds) quiet("rmi", "-f", id);
  rmSync(work, { recursive: true, force: true });
}

let failed = false;
try {
  mkdirSync(work, { recursive: true });
  await main();
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  failed = true;
  process.exitCode = 1;
} finally {
  cleanup(failed);
}
