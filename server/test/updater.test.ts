import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerClient } from "../src/updater/docker.ts";
import { Updater } from "../src/updater/loop.ts";
import { ServerClient, type Plan, type UpdaterState } from "../src/updater/server.ts";
import { recover, RESTORE_ATTEMPTS, runUpdate, takeOver, type UpdateContext } from "../src/updater/update.ts";
import { FakeEngine } from "./updater-engine.ts";

const REF = "ghcr.io/wolfsrudel-gaming/lykora:testbuild";
const REPO = "ghcr.io/wolfsrudel-gaming/lykora";

const imageConfig = (commit: string, health = true) => ({
  Env: ["PATH=/usr/local/bin:/usr/bin", "NODE_ENV=production", `LYKORA_COMMIT=${commit}`],
  Labels: { "org.opencontainers.image.revision": commit },
  Cmd: ["node", "dist/server.js"],
  WorkingDir: "/app/server",
  User: "node",
  ...(health ? { Healthcheck: { Test: ["CMD-SHELL", "node -e 1"], Interval: 30_000_000_000 } } : {}),
  ExposedPorts: { "3000/tcp": {} },
  Volumes: { "/data": {} },
});

let engine: FakeEngine;
let reports: { state: UpdaterState; message?: string; imageId?: string }[];
let logs: string[];

beforeEach(async () => {
  engine = new FakeEngine();
  await engine.start();
  reports = [];
  logs = [];
});
afterEach(async () => {
  await engine.close();
});

function context(overrides: Partial<UpdateContext> = {}): UpdateContext {
  return {
    docker: new DockerClient(engine.socketPath),
    report: async (state, message, imageId) => void reports.push({ state, message, imageId }),
    log: (message) => logs.push(message),
    timings: { healthTimeoutMs: 500, settleMs: 50, intervalMs: 10, stopSeconds: 1, retryDelayMs: 1 },
    hostname: "host-ohne-container",
    ...overrides,
  };
}

/** Docker, bei dem das Starten eines bestimmten Containers die ersten Male scheitert (Aussetzer des Daemons). */
class FlakyDocker extends DockerClient {
  readonly failing: { id: string; times: number };

  constructor(socketPath: string, failing: { id: string; times: number }) {
    super(socketPath);
    this.failing = failing;
  }

  override async startContainer(id: string): Promise<void> {
    if (id === this.failing.id && this.failing.times > 0) {
      this.failing.times--;
      throw new Error("Docker: kurzer Aussetzer beim Start");
    }
    return super.startContainer(id);
  }
}

/** Wie nach „docker compose up“: Server mit Label, Datenbank und ein fremder Container ohne Label. */
function composeSetup() {
  const v1 = engine.addImage(REF, imageConfig("aaa"));
  const pg = engine.addImage("postgres:16-alpine", { Env: ["PGDATA=/var/lib/postgresql/data"] });
  const server = engine.addContainer("lykora-server-1", REF, {
    env: ["DATABASE_URL=postgres://lykora:geheim@db:5432/lykora", "BASE_PATH=/lykora"],
    labels: { "io.lykora.autoupdate": "true", "com.docker.compose.service": "server", "com.docker.compose.image": v1 },
    hostConfig: { NetworkMode: "lykora_default", Binds: ["lykora_data:/data"], RestartPolicy: { Name: "unless-stopped" } },
    networks: { lykora_default: { Aliases: ["lykora-server-1", "server"] }, lykora_extra: { Aliases: ["web"] } },
  });
  const db = engine.addContainer("lykora-db-1", "postgres:16-alpine", { labels: { "com.docker.compose.service": "db" } });
  // Gleiches Image, aber ohne Label: bleibt, wie es ist
  const other = engine.addContainer("probe", REF, { labels: {} });
  return { v1, pg, server, db, other };
}

/** Nach einem Abbruch: Der alte Server steht gestoppt als <name>-alt. */
function altSetup() {
  const { server } = composeSetup();
  server.Name = "/lykora-server-1-alt";
  server.State = { Status: "exited", Running: false, ExitCode: 0 };
  return server;
}

/** Wie composeSetup, mit einer kranken neuen Version in der Registry. */
function brokenSetup() {
  const { v1, server } = composeSetup();
  const v3 = engine.addImage("", imageConfig("ccc"));
  engine.registry.set(REF, { id: v3 });
  engine.behaviour.set(v3, "unhealthy");
  return { v1, server, v3 };
}

const states = () => reports.map((r) => r.state);
const touched = (id: string, name: string) => engine.calls.filter((c) => c.includes(id) || c.includes(`/${name}/`) || c.includes(`=${name}`));

describe("Update mit der Docker-Engine", () => {
  it("ersetzt das Ziel und behält Name, Netzwerke, Aliase und eigene Einstellungen", async () => {
    const { v1, server, db, other } = composeSetup();
    const v2 = engine.addImage("", imageConfig("bbb"));
    engine.registry.set(REF, { id: v2 });

    expect(await runUpdate(context())).toEqual({ ok: true });
    expect(states()).toEqual(["pulling", "updating", "restarting", "idle"]);
    expect(reports.at(-1)).toEqual({ state: "idle", message: "Update eingespielt", imageId: v2 });

    const next = engine.byName("lykora-server-1")!;
    expect(next.Id).not.toBe(server.Id);
    expect(next.Image).toBe(v2);
    expect(next.State.Running).toBe(true);
    expect(engine.containers.has(server.Id)).toBe(false);
    expect(engine.byName("lykora-server-1-alt")).toBeUndefined();
    // Eigene Werte bleiben, die des neuen Images gelten
    expect(next.Config.Env).toEqual(
      expect.arrayContaining(["DATABASE_URL=postgres://lykora:geheim@db:5432/lykora", "BASE_PATH=/lykora", "LYKORA_COMMIT=bbb"]),
    );
    expect(next.Config.Env).not.toContain("LYKORA_COMMIT=aaa");
    expect(next.Config.Labels).toMatchObject({
      "io.lykora.autoupdate": "true",
      "com.docker.compose.service": "server",
      "com.docker.compose.image": v2,
      "org.opencontainers.image.revision": "bbb",
    });
    expect(next.Config.Image).toBe(REF);
    expect(next.Config.Hostname).toBe(next.Id.slice(0, 12));
    expect(next.HostConfig).toEqual(server.HostConfig);
    expect(next.NetworkSettings.Networks.lykora_default!.Aliases).toEqual(["lykora-server-1", "server", next.Id.slice(0, 12)]);
    expect(next.NetworkSettings.Networks.lykora_extra!.Aliases).toEqual(["web", next.Id.slice(0, 12)]);
    // Angelegt nur mit dem Hauptnetz, das zweite danach verbunden
    expect(Object.keys((engine.created[0]!.NetworkingConfig as any).EndpointsConfig)).toEqual(["lykora_default"]);
    // Alte Version bleibt als Rückfall
    expect(engine.tags.get(`${REPO}:lykora-rollback`)).toBe(v1);

    // Nur das Image der Ziele gezogen; Container ohne Label nie angefasst
    expect(engine.calls.filter((c) => c.startsWith("POST /images/create"))).toEqual([
      `POST /images/create?fromImage=${encodeURIComponent(REPO)}&tag=testbuild`,
    ]);
    for (const c of [db, other]) {
      expect(touched(c.Id, c.Name.slice(1)).filter((call) => !call.startsWith("GET"))).toEqual([]);
      expect(engine.containers.get(c.Id)!.State.Running).toBe(true);
    }
    expect(engine.containers.get(other.Id)!.Image).toBe(v1);
    // Ausgehandelte Version an jedem Aufruf
    expect(new Set(engine.versions)).toEqual(new Set(["1.45"]));
  });

  it("schreibt in com.docker.compose.image, was Compose erwartet: den Digest des Manifests der eigenen Plattform", async () => {
    composeSetup();
    const arch = { x64: "amd64", arm64: "arm64" }[process.arch] ?? process.arch;
    const own = `sha256:${"1".repeat(64)}`;
    const foreign = `sha256:${"2".repeat(64)}`;
    const v2 = engine.addImage("", imageConfig("bbb"), [
      { ID: `sha256:${"3".repeat(64)}`, Kind: "attestation", Available: true },
      { ID: foreign, Kind: "image", Available: true, ImageData: { Platform: { os: "linux", architecture: arch === "amd64" ? "arm64" : "amd64" } } },
      { ID: own, Kind: "image", Available: true, ImageData: { Platform: { os: "linux", architecture: arch } } },
    ]);
    engine.registry.set(REF, { id: v2 });
    expect(await runUpdate(context())).toEqual({ ok: true });
    expect(engine.byName("lykora-server-1")!.Config.Labels).toMatchObject({ "com.docker.compose.image": own });
    expect(engine.calls).toContain(`GET /images/${v2}/json?manifests=1`);
  });

  it("meldet „Schon aktuell“, wenn das gezogene Image schon läuft", async () => {
    const { v1 } = composeSetup();
    engine.registry.set(REF, { id: v1 });
    expect(await runUpdate(context())).toEqual({ ok: true });
    expect(reports.at(-1)).toEqual({ state: "idle", message: "Schon aktuell", imageId: v1 });
    expect(engine.created).toEqual([]);
  });

  it("rollt zurück, wenn die neue Version nicht gesund startet, und meldet die letzten Log-Zeilen", async () => {
    const { v1, server, v3 } = brokenSetup();
    engine.logs.set(v3, "Lykora startet\nFehler: Migration 004 gescheitert\n");

    expect(await runUpdate(context())).toEqual({ ok: false });
    expect(states()).toEqual(["pulling", "updating", "restarting", "rolled_back"]);
    const last = reports.at(-1)!;
    expect(last.message).toContain("startete nicht gesund (Healthcheck schlägt fehl)");
    expect(last.message).toContain("Die alte Version läuft wieder.");
    expect(last.message).toContain("Fehler: Migration 004 gescheitert");

    const back = engine.byName("lykora-server-1")!;
    expect(back.Id).toBe(server.Id);
    expect(back.State.Running).toBe(true);
    expect([...engine.containers.values()].filter((c) => c.Image === v3)).toEqual([]);
    expect(engine.byName("lykora-server-1-alt")).toBeUndefined();
    // Das Tag zeigt wieder auf die alte Version: „docker compose up -d“ legt nicht die kaputte an.
    expect(engine.tags.get(REF)).toBe(v1);
    expect(engine.tags.get(`${REPO}:lykora-rollback`)).toBe(v1);
  });

  it("wiederholt beim Rückfall einen Schritt, den Docker gerade verweigert", async () => {
    const { server, v3 } = brokenSetup();
    const failing = { id: server.Id, times: RESTORE_ATTEMPTS - 1 };
    expect(await runUpdate(context({ docker: new FlakyDocker(engine.socketPath, failing) }))).toEqual({ ok: false });
    expect(reports.at(-1)).toMatchObject({ state: "rolled_back", message: expect.stringContaining("Die alte Version läuft wieder") });
    expect(failing.times).toBe(0);
    expect(logs.filter((l) => l.includes("Versuch 2 von"))).toHaveLength(1);
    const back = engine.byName("lykora-server-1")!;
    expect(back.Id).toBe(server.Id);
    expect(back.State.Running).toBe(true);
    expect(engine.byName("lykora-server-1-alt")).toBeUndefined();
    expect([...engine.containers.values()].filter((c) => c.Image === v3)).toEqual([]);
  });

  it("meldet einen unvollständigen Rückfall als failed und lässt den alten Container als -alt für recover stehen", async () => {
    const { server, v3 } = brokenSetup();
    const failing = { id: server.Id, times: RESTORE_ATTEMPTS };
    expect(await runUpdate(context({ docker: new FlakyDocker(engine.socketPath, failing) }))).toEqual({ ok: false });
    const last = reports.at(-1)!;
    expect(last.state).toBe("failed");
    expect(last.message).toContain("startete nicht gesund (Healthcheck schlägt fehl)");
    expect(last.message).toContain("Rückfall auf die alte Version ist unvollständig (lykora-server-1 starten: Docker: kurzer Aussetzer beim Start)");
    // Die kaputte Version ist weg, der alte Container wartet gestoppt unter -alt; recover holt ihn zurück.
    expect([...engine.containers.values()].filter((c) => c.Image === v3)).toEqual([]);
    expect(engine.byName("lykora-server-1")).toBeUndefined();
    expect(engine.byName("lykora-server-1-alt")).toMatchObject({ Id: server.Id, State: { Running: false } });
    reports = [];
    await recover(context());
    expect(engine.byName("lykora-server-1")).toMatchObject({ Id: server.Id, State: { Running: true } });
    expect(reports).toEqual([{ state: "rolled_back", message: expect.stringContaining("unterbrochen") }]);
  });

  it("rollt zurück, wenn die neue Version sofort endet oder nie gesund wird", async () => {
    const { server } = composeSetup();
    const v3 = engine.addImage("", imageConfig("ccc"));
    engine.registry.set(REF, { id: v3 });
    engine.behaviour.set(v3, "exit");
    expect(await runUpdate(context())).toEqual({ ok: false });
    expect(reports.at(-1)!.message).toContain("beendet mit Code 1");

    reports = [];
    engine.behaviour.set(v3, "starting");
    expect(await runUpdate(context())).toEqual({ ok: false });
    expect(reports.at(-1)!.message).toContain("nach 1 s nicht gesund");
    expect(engine.byName("lykora-server-1")!.Id).toBe(server.Id);
  });

  it("wartet ohne Healthcheck nur, bis der Container eine Weile läuft", async () => {
    engine.addImage(REF, imageConfig("aaa", false));
    engine.addContainer("lykora-server-1", REF, { labels: { "io.lykora.autoupdate": "true" } });
    const v2 = engine.addImage("", imageConfig("bbb", false));
    engine.registry.set(REF, { id: v2 });
    expect(await runUpdate(context())).toEqual({ ok: true });
    expect(engine.byName("lykora-server-1")!.Image).toBe(v2);
  });

  it("meldet „unsupported“ für lokal gebaute Images, ohne zu ziehen", async () => {
    engine.addImage("lykora-server:latest", imageConfig("dev"));
    const local = engine.addContainer("lykora-server-1", "lykora-server:latest", { labels: { "io.lykora.autoupdate": "true" } });
    expect(await runUpdate(context())).toEqual({ ok: false });
    expect(reports.at(-1)!.state).toBe("unsupported");
    expect(reports.at(-1)!.message).toContain("LYKORA_IMAGE=ghcr.io/wolfsrudel-gaming/lykora:testbuild");
    expect(engine.calls.some((c) => c.startsWith("POST /images/create"))).toBe(false);
    expect(engine.byName("lykora-server-1")!.Id).toBe(local.Id);
  });

  it("meldet „unsupported“, wenn die Registry das Image nicht herausgibt, und „failed“ bei anderen Fehlern", async () => {
    composeSetup();
    engine.registry.set(REF, { error: "pull access denied for ghcr.io/wolfsrudel-gaming/lykora, repository does not exist", status: 404 });
    await runUpdate(context());
    expect(reports.at(-1)!.state).toBe("unsupported");
    expect(reports.at(-1)!.message).toContain("LYKORA_REGISTRY_USER");

    engine.registry.set(REF, { error: "unauthorized: authentication required" });
    await runUpdate(context());
    expect(reports.at(-1)!.state).toBe("unsupported");

    engine.registry.set(REF, { error: "read tcp 10.0.0.2:443: connection reset by peer" });
    await runUpdate(context());
    expect(reports.at(-1)).toMatchObject({ state: "failed", message: expect.stringContaining("connection reset") });
    expect(engine.created).toEqual([]);
  });

  it("schickt den Registry-Zugang als X-Registry-Auth", async () => {
    const { v1 } = composeSetup();
    engine.registry.set(REF, { id: v1 });
    await runUpdate(context({ registry: { user: "wolf", token: "ghp_geheim" } }));
    const header = String(engine.pullHeaders[0]!["x-registry-auth"]);
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      username: "wolf",
      password: "ghp_geheim",
      serveraddress: "ghcr.io",
    });
  });

  it("findet kein Ziel ohne Label und meldet das", async () => {
    engine.addImage(REF, imageConfig("aaa"));
    engine.addContainer("lykora-server-1", REF, { labels: {} });
    await runUpdate(context());
    expect(reports.at(-1)).toMatchObject({ state: "unsupported", message: expect.stringContaining("io.lykora.autoupdate=true") });
  });
});

describe("Selbst-Update des Updaters", () => {
  it("startet einen Nachfolger, der den Vorgänger ablöst und dessen Namen übernimmt", async () => {
    const { v1 } = composeSetup();
    const self = engine.addContainer("lykora-updater-1", REF, {
      labels: { "io.lykora.updater": "true" },
      hostConfig: { NetworkMode: "lykora_default", Binds: ["/var/run/docker.sock:/var/run/docker.sock"] },
      networks: { lykora_default: { Aliases: ["updater"] } },
    });
    const v2 = engine.addImage("", imageConfig("bbb"));
    engine.registry.set(REF, { id: v2 });

    const result = await runUpdate(context({ hostname: self.Id.slice(0, 12) }));
    const successor = engine.byName("lykora-updater-1-neu")!;
    expect(result).toEqual({ ok: true, successor: successor.Id });
    expect(successor.Image).toBe(v2);
    expect(successor.State.Running).toBe(true);
    expect(successor.Config.Env).toContain(`LYKORA_UPDATER_REPLACES=${self.Id}`);
    expect(successor.Config.Labels).toMatchObject({ "io.lykora.updater": "true" });
    expect(engine.containers.get(self.Id)!.Image).toBe(v1);

    await takeOver(context({ hostname: successor.Id.slice(0, 12) }), self.Id);
    expect(engine.containers.has(self.Id)).toBe(false);
    expect(engine.byName("lykora-updater-1")!.Id).toBe(successor.Id);
  });

  it("lässt sich in Ruhe, wenn er schon die neue Fassung hat", async () => {
    composeSetup();
    const v2 = engine.addImage("", imageConfig("bbb"));
    engine.registry.set(REF, { id: v2 });
    engine.tags.set(REF, v2);
    const self = engine.addContainer("lykora-updater-1", REF, { labels: { "io.lykora.updater": "true" } });
    expect(await runUpdate(context({ hostname: self.Id.slice(0, 12) }))).toEqual({ ok: true });
    expect(engine.byName("lykora-updater-1-neu")).toBeUndefined();
  });
});

describe("Wiederherstellung nach Abbruch", () => {
  it("startet <name>-alt wieder unter altem Namen, wenn <name> fehlt", async () => {
    const old = altSetup();
    await recover(context());
    const back = engine.byName("lykora-server-1")!;
    expect(back.Id).toBe(old.Id);
    expect(back.State.Running).toBe(true);
    expect(reports).toEqual([{ state: "rolled_back", message: expect.stringContaining("unterbrochen") }]);
  });

  it("ersetzt einen angelegten, aber nicht laufenden Nachfolger durch den alten Container", async () => {
    const old = altSetup();
    const v2 = engine.addImage("", imageConfig("bbb"));
    engine.tags.set(REF, v2);
    const half = engine.addContainer("lykora-server-1", REF, { labels: { "io.lykora.autoupdate": "true" }, state: "created" });
    await recover(context());
    expect(engine.containers.has(half.Id)).toBe(false);
    expect(engine.byName("lykora-server-1")!.Id).toBe(old.Id);
  });

  it("rollt einen laufenden, aber kranken Nachfolger zurück und räumt bei gesundem nur auf", async () => {
    const old = altSetup();
    const v2 = engine.addImage("", imageConfig("bbb"));
    engine.tags.set(REF, v2);
    const sick = engine.addContainer("lykora-server-1", REF, { labels: { "io.lykora.autoupdate": "true" } });
    sick.State.Health = { Status: "unhealthy" };
    await recover(context());
    expect(engine.containers.has(sick.Id)).toBe(false);
    expect(engine.byName("lykora-server-1")!.Id).toBe(old.Id);

    // Jetzt umgekehrt: Nachfolger gesund, alter Container bleibt liegen
    const healthy = engine.addContainer("lykora-server-1-neu", REF, { labels: { "io.lykora.autoupdate": "true" } });
    engine.byName("lykora-server-1")!.Name = "/lykora-server-1-alt";
    engine.byName("lykora-server-1-alt")!.State = { Status: "exited", Running: false, ExitCode: 0 };
    healthy.Name = "/lykora-server-1";
    reports = [];
    await recover(context());
    expect(engine.containers.has(old.Id)).toBe(false);
    expect(engine.byName("lykora-server-1")!.Id).toBe(healthy.Id);
    expect(reports).toEqual([{ state: "idle", message: "Update eingespielt", imageId: v2 }]);
  });

  it("tut nichts ohne Reste", async () => {
    composeSetup();
    await recover(context());
    expect(engine.calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
  });
});

describe("Updater-Schleife", () => {
  const plan = (digest = "sha256:ziel"): Plan => ({ action: "update", reason: "Manueller Auftrag", pollSeconds: 30, target: { commit: "bbb", version: "58", digest } });

  function updater(plans: () => Plan, docker = new DockerClient(engine.socketPath)) {
    return new Updater({
      docker,
      server: { plan: async () => plans(), report: async (state, message, imageId) => void reports.push({ state, message, imageId }) },
      pollSeconds: 60,
      hostname: "host-ohne-container",
      timings: { healthTimeoutMs: 500, settleMs: 50, intervalMs: 10, stopSeconds: 1, retryDelayMs: 1, reportAttempts: 1 },
      log: (m) => logs.push(m),
    });
  }

  it("holt nach einem unvollständigen Rückfall den alten Container bei der nächsten Frage zurück", async () => {
    const { server } = brokenSetup();
    let action: Plan["action"] = "update";
    const u = updater(() => ({ ...plan("sha256:kaputt"), action }), new FlakyDocker(engine.socketPath, { id: server.Id, times: RESTORE_ATTEMPTS }));
    await u.tick();
    await u.running;
    expect(reports.at(-1)).toMatchObject({ state: "failed", message: expect.stringContaining("unvollständig") });
    expect(engine.byName("lykora-server-1")).toBeUndefined();
    expect(engine.byName("lykora-server-1-alt")).toMatchObject({ Id: server.Id, State: { Running: false } });

    // Die nächste Frage räumt zuerst auf: Der alte Container läuft wieder unter seinem Namen.
    reports = [];
    action = "wait";
    await u.tick();
    expect(u.running).toBeUndefined();
    expect(engine.byName("lykora-server-1")).toMatchObject({ Id: server.Id, State: { Running: true } });
    expect(engine.byName("lykora-server-1-alt")).toBeUndefined();
    expect(reports).toEqual([{ state: "rolled_back", message: expect.stringContaining("unterbrochen") }]);
    // Danach ist Ruhe: keine weiteren Eingriffe.
    const before = engine.calls.length;
    await u.tick();
    expect(engine.calls.slice(before).filter((c) => !c.startsWith("GET"))).toEqual([]);
  });

  it("räumt Reste auch auf, wenn der Server dreimal nacheinander nicht antwortet", async () => {
    const old = altSetup();
    const u = updater(() => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(await u.tick()).toBe(60);
    await u.tick();
    expect(engine.calls).toEqual([]);
    await u.tick();
    expect(engine.byName("lykora-server-1")).toMatchObject({ Id: old.Id, State: { Running: true } });
    expect(reports).toEqual([{ state: "rolled_back", message: expect.stringContaining("unterbrochen") }]);
    expect(logs.filter((l) => l.startsWith("Server nicht erreichbar"))).toHaveLength(1);
  });

  it("startet nie zwei Updates gleichzeitig und fragt währenddessen weiter", async () => {
    composeSetup();
    const v2 = engine.addImage("", imageConfig("bbb"));
    engine.registry.set(REF, { id: v2 });
    engine.pullDelayMs = 200;
    let asked = 0;
    const u = updater(() => (asked++, plan()));
    expect(await u.tick()).toBe(30);
    const first = u.running;
    expect(first).toBeDefined();
    await u.tick();
    await u.tick();
    expect(u.running).toBe(first);
    await first;
    expect(asked).toBe(3);
    expect(engine.calls.filter((c) => c.startsWith("POST /images/create"))).toHaveLength(1);
    expect(engine.byName("lykora-server-1")!.Image).toBe(v2);
  });

  it("überlässt dem Server, ob ein gescheitertes Ziel noch einmal versucht wird", async () => {
    const { server } = composeSetup();
    const v3 = engine.addImage("", imageConfig("ccc"));
    engine.registry.set(REF, { id: v3 });
    engine.behaviour.set(v3, "unhealthy");
    const u = updater(() => plan("sha256:kaputt"));
    await u.tick();
    await u.running;
    expect(reports.at(-1)!.state).toBe("rolled_back");
    // Der Server hat das Scheitern erfahren; sagt er trotzdem „update“ (Jetzt aktualisieren), geht es los.
    await u.tick();
    expect(u.running).toBeDefined();
    await u.running;
    expect(engine.byName("lykora-server-1")!.Id).toBe(server.Id);
  });

  it("versucht ein Ziel nicht gleich wieder, wenn der Server vom Scheitern nichts weiß, und meldet es nach", async () => {
    composeSetup();
    const v3 = engine.addImage("", imageConfig("ccc"));
    engine.registry.set(REF, { id: v3 });
    engine.behaviour.set(v3, "unhealthy");
    let digest = "sha256:kaputt";
    let reachable = true;
    const u = new Updater({
      docker: new DockerClient(engine.socketPath),
      server: {
        plan: async () => plan(digest),
        report: async (state, message, imageId) => {
          if (!reachable && state === "rolled_back") throw new Error("Server weg");
          reports.push({ state, message, imageId });
        },
      },
      pollSeconds: 60,
      hostname: "host-ohne-container",
      timings: { healthTimeoutMs: 500, settleMs: 50, intervalMs: 10, stopSeconds: 1, reportAttempts: 2, reportRetryMs: 1 },
      log: (m) => logs.push(m),
    });
    reachable = false;
    await u.tick();
    await u.running;
    expect(states()).not.toContain("rolled_back");

    reachable = true;
    await u.tick();
    expect(u.running).toBeUndefined();
    expect(reports.at(-1)).toMatchObject({ state: "rolled_back", message: expect.stringContaining("nicht gesund") });

    digest = "sha256:repariert";
    const v4 = engine.addImage("", imageConfig("ddd"));
    engine.registry.set(REF, { id: v4 });
    await u.tick();
    await u.running;
    expect(reports.at(-1)).toMatchObject({ state: "idle", message: "Update eingespielt" });
  });

  it("wartet bei „wait“ und nimmt den Takt des Servers", async () => {
    composeSetup();
    const u = updater(() => ({ action: "wait", reason: "Event läuft", pollSeconds: 15 }));
    expect(await u.tick()).toBe(15);
    expect(u.running).toBeUndefined();
    expect(engine.calls).toEqual([]);
  });
});

describe("Verbindung zum Server", () => {
  let server: Server;
  let token = "erster-token";
  const seen: { method: string; url: string; auth?: string; body: string }[] = [];

  beforeEach(async () => {
    seen.length = 0;
    server = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
      if (req.url === "/lykora/api/updater/plan") {
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ action: "wait", reason: "Nichts Neues", pollSeconds: 60 }));
      }
      res.writeHead(204).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  const url = () => `http://127.0.0.1:${(server.address() as { port: number }).port}/lykora/`;

  it("liest den Token aus der Datei, auch wenn sie erst später erscheint oder sich ändert", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "lykora-token-")), "updater.token");
    const client = new ServerClient({ url: url(), tokenFile: file });
    await expect(client.plan()).rejects.toThrow(/Kein Token/);

    writeFileSync(file, `${token}\n`);
    expect(await client.plan()).toEqual({ action: "wait", reason: "Nichts Neues", pollSeconds: 60 });

    // Server neu aufgesetzt, neuer Token: 401, Datei neu lesen, wiederholen
    token = "zweiter-token";
    writeFileSync(file, token);
    await client.report("idle", "Update eingespielt", "sha256:neu");
    expect(seen.slice(-2).map((s) => s.auth)).toEqual(["Bearer erster-token", "Bearer zweiter-token"]);
    expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/lykora/api/updater/report" });
    expect(JSON.parse(seen.at(-1)!.body)).toEqual({ state: "idle", message: "Update eingespielt", imageId: "sha256:neu" });
  });

  it("nimmt den festen Token aus UPDATER_TOKEN und meldet einen falschen", async () => {
    const client = new ServerClient({ url: url(), token: "falsch" });
    await expect(client.plan()).rejects.toThrow(/401/);
    expect(seen).toHaveLength(1);
  });
});
