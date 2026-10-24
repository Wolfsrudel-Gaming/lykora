import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { inWindow, isNewer, nextWindowStart, parseImageRef, type UpdateStatus } from "../src/services/update.ts";
import { REPOSITORY, startFakeRegistry, type FakeRegistry } from "./fake-registry.ts";
import { client, createEvent, exampleGame, member, setup, tempDir, testConfig, type TestContext } from "./helpers.ts";

const OLD = "0123456789abcdef0123456789abcdef01234567";
const NEW = "fedcba9876543210fedcba9876543210fedcba98";
const BUILT_AT = "2026-10-01T08:00:00Z";
const LABELS = { version: "58", revision: NEW, created: "2026-10-20T12:00:00Z", source: "https://github.com/Wolfsrudel-Gaming/lykora" };
/** 12:00 Uhr in Berlin */
const NOON = new Date("2026-10-21T10:00:00Z");
const minutes = (n: number) => new Date(NOON.getTime() + n * 60_000);

let ctx: TestContext;
let registry: FakeRegistry;
let clock = NOON;
const apps: FastifyInstance[] = [];

// GitHub ist im Test nicht erreichbar; die Compare-API kommt aus dem Test, alles andere geht ins Netz (Fake-Registry).
const github = { calls: [] as string[], fail: false };
const testFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.github.com/")) return fetch(input, init);
  github.calls.push(url);
  if (github.fail) return Response.json({ message: "API rate limit exceeded" }, { status: 403 });
  return Response.json({
    commits: [
      { sha: "c1", html_url: "https://github.com/Wolfsrudel-Gaming/lykora/commit/c1", commit: { message: "Server: Updates prüfen\n\nLanger Text", author: { date: "2026-10-19T10:00:00Z" } } },
      { sha: "c2", html_url: "https://github.com/Wolfsrudel-Gaming/lykora/commit/c2", commit: { message: "Web: Einstellungen", author: { date: "2026-10-20T11:00:00Z" } } },
    ],
  });
};

beforeAll(async () => {
  ctx = await setup();
  registry = await startFakeRegistry();
});
afterAll(async () => {
  for (const app of apps) await app.close();
  await registry?.close();
  await ctx?.close();
});
beforeEach(async () => {
  await ctx.db.query("delete from system_updates; delete from system_settings; update events set status = 'ended' where status <> 'ended'");
  clock = NOON;
  github.calls.length = 0;
  github.fail = false;
  registry.reset();
  registry.publish(LABELS);
});

/** Server in Version 57 mit Image aus der Fake-Registry; Uhr, GitHub und Plattform kommen aus dem Test. */
async function updateApp(env: Record<string, string> = {}, arch = "x64") {
  const config = testConfig({ LYKORA_IMAGE: registry.image(), LYKORA_VERSION: "57", LYKORA_COMMIT: OLD, LYKORA_BUILT_AT: BUILT_AT, ...env });
  const app = await buildApp(config, ctx.db, { logger: false, updates: { fetch: testFetch, now: () => clock, arch } });
  await app.ready();
  apps.push(app);
  const service = app.deps.updates;
  // Ohne anlegbaren Token (DATA_DIR gesperrt) gibt es keinen; die Tests dazu geben ihren Header selbst an.
  const token = await service.updaterToken().catch(() => "");
  const updater = (method: "GET" | "POST", path: string, payload?: object, authorization: string | null = `Bearer ${token}`) =>
    app.inject({ method, url: `${ctx.api}/updater/${path}`, headers: authorization ? { authorization } : {}, ...(payload ? { payload } : {}) });
  const admin = client({ ...ctx, app });
  return {
    app,
    service,
    admin,
    as: (sessionToken: string) => client({ ...ctx, app }, sessionToken),
    updater,
    status: async (): Promise<UpdateStatus> => {
      const res = await admin.get("/system/update");
      expect(res.status).toBe(200);
      return res.body;
    },
    plan: async () => {
      const res = await updater("GET", "plan");
      expect(res.statusCode).toBe(200);
      return res.json();
    },
    report: async (body: object) => {
      const res = await updater("POST", "report", body);
      expect(res.statusCode).toBe(204);
    },
  };
}

/** Wie updateApp, mit gespeicherten Einstellungen und erledigter Prüfung. */
async function ready(settings: { auto: boolean; window?: { from: string; to: string } | null }, env: Record<string, string> = {}) {
  const u = await updateApp(env);
  expect((await u.admin.put("/system/update/settings", settings)).status).toBe(200);
  expect((await u.admin.post("/system/update/check")).status).toBe(200);
  return u;
}

describe("Instanz-Admin und Version", () => {
  it("nur Admins der ältesten Organisation verwalten den Server", async () => {
    const admin = client(ctx);
    expect((await admin.get("/me")).body.instanceAdmin).toBe(true);
    expect((await admin.get("/system/update")).status).toBe(200);

    const gamemaster = client(ctx, await member(ctx, "gamemaster", "spielleitung@example.org"));
    expect((await gamemaster.get("/me")).body.instanceAdmin).toBe(false);
    expect((await gamemaster.get("/system/update")).status).toBe(403);
    expect((await gamemaster.put("/system/update/settings", { auto: true })).status).toBe(403);
    expect((await gamemaster.post("/system/update/check")).status).toBe(403);
    expect((await gamemaster.post("/system/update/apply")).status).toBe(403);

    // Admin einer später angelegten Organisation ist kein Instanz-Admin.
    const org = await admin.post("/orgs", { name: "Zweite Orga", slug: "zweite-orga" });
    expect(org.status).toBe(201);
    const add = await admin.post(`/orgs/${org.body.id}/members`, { email: "zweite@example.org", name: "Zweite", password: "zweite-passwort", role: "admin" });
    expect(add.status).toBe(201);
    const login = await client(ctx, "").post("/auth/login", { email: "zweite@example.org", password: "zweite-passwort" });
    const other = client(ctx, login.body.token);
    expect((await other.get("/me")).body).toMatchObject({ instanceAdmin: false, orgs: [{ role: "admin" }] });
    const denied = await other.get("/system/update");
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("forbidden");

    expect((await client(ctx, "").get("/system/update")).status).toBe(401);
  });

  it("nennt allen Angemeldeten die Version", async () => {
    expect((await client(ctx).get("/system/version")).body).toEqual({ version: "dev", commit: null, builtAt: null });
    const u = await updateApp();
    const gamemaster = u.as(await member(ctx, "gamemaster", "version@example.org"));
    const res = await gamemaster.get("/system/version");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: "57", commit: OLD, builtAt: BUILT_AT });
    expect((await client(ctx, "").get("/system/version")).status).toBe(401);
  });

  it("dokumentiert die Schnittstelle unter dem Tag system", async () => {
    const doc = (await ctx.app.inject({ method: "GET", url: "/lykora/api/docs/json" })).json();
    for (const path of ["version", "update", "update/settings", "update/check", "update/apply"]) {
      expect(Object.keys(doc.paths)).toContain(`/lykora/api/system/${path}`);
    }
    expect(doc.paths["/lykora/api/updater/plan"].get.tags).toEqual(["system"]);
    expect(doc.components.securitySchemes.updater).toBeTruthy();
  });
});

describe("Einstellungen", () => {
  it("speichert Opt-in und Zeitfenster", async () => {
    const u = await updateApp();
    expect((await u.status()).settings).toEqual({ auto: false, window: null });
    const put = await u.admin.put("/system/update/settings", { auto: true, window: { from: "23:00", to: "05:00" } });
    expect(put.status).toBe(200);
    expect(put.body.settings).toEqual({ auto: true, window: { from: "23:00", to: "05:00" } });
    expect(put.body.timezone).toBe("Europe/Berlin");
    expect((await u.status()).settings).toEqual({ auto: true, window: { from: "23:00", to: "05:00" } });
    const row = await ctx.db.one("select s.updated_by, u.email from system_settings s join users u on u.id = s.updated_by where key = 'update'");
    expect(row.email).toBe("admin@example.org");

    expect((await u.admin.put("/system/update/settings", { auto: false, window: null })).body.settings).toEqual({ auto: false, window: null });
    expect((await u.admin.put("/system/update/settings", { auto: true })).body.settings).toEqual({ auto: true, window: null });
  });

  it("lehnt ungültige Zeitfenster ab", async () => {
    const u = await updateApp();
    const same = await u.admin.put("/system/update/settings", { auto: true, window: { from: "03:00", to: "03:00" } });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("invalid_window");
    for (const window of [{ from: "24:00", to: "05:00" }, { from: "3:00", to: "05:00" }, { from: "03:00" }, { from: "03:00", to: "05:00", tz: "UTC" }]) {
      const res = await u.admin.put("/system/update/settings", { auto: true, window });
      expect(res.status, JSON.stringify(window)).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    }
    expect((await u.admin.put("/system/update/settings", { window: null })).status).toBe(400);
    expect((await u.status()).settings).toEqual({ auto: false, window: null });
  });
});

describe("Prüfung der Registry", () => {
  it("findet eine neuere Version über die Token-Anmeldung und nimmt die eigene Plattform", async () => {
    const u = await updateApp();
    expect(await u.status()).toMatchObject({ configured: true, image: registry.image(), upToDate: null, lastCheckAt: null, available: null });
    const res = await u.admin.post("/system/update/check");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      current: { version: "57", commit: OLD, builtAt: BUILT_AT },
      available: { version: "58", commit: NEW, builtAt: LABELS.created, digest: registry.digests.index },
      upToDate: false,
      checkError: null,
      lastCheckAt: NOON.toISOString(),
    });
    expect(res.body.available).not.toHaveProperty("source");
    // Neueste Änderung zuerst, nur die erste Zeile der Commit-Nachricht.
    expect(res.body.changes).toEqual([
      { sha: "c2", title: "Web: Einstellungen", date: "2026-10-20T11:00:00Z", url: "https://github.com/Wolfsrudel-Gaming/lykora/commit/c2" },
      { sha: "c1", title: "Server: Updates prüfen", date: "2026-10-19T10:00:00Z", url: "https://github.com/Wolfsrudel-Gaming/lykora/commit/c1" },
    ]);
    expect(github.calls).toEqual([`https://api.github.com/repos/Wolfsrudel-Gaming/lykora/compare/${OLD}...${NEW}`]);

    // Erst 401, dann Token holen und mit Bearer erneut fragen.
    expect(registry.requests[0]).toMatchObject({ path: `/v2/${REPOSITORY}/manifests/testbuild`, status: 401, authorization: undefined });
    expect(registry.tokenRequests).toHaveLength(1);
    expect(registry.tokenRequests[0]!.authorization).toBeUndefined();
    expect(Object.fromEntries(registry.tokenRequests[0]!.query)).toEqual({ service: "fake-registry", scope: `repository:${REPOSITORY}:pull` });
    const fetched = registry.requests.filter((r) => r.status !== 401).map((r) => r.path);
    expect(fetched).toEqual([
      `/v2/${REPOSITORY}/manifests/testbuild`,
      `/v2/${REPOSITORY}/manifests/${registry.digests.amd64}`,
      `/v2/${REPOSITORY}/blobs/${registry.digests.amd64Config}`,
    ]);

    // Änderungen je Paar nur einmal von GitHub.
    await u.admin.post("/system/update/check");
    expect(github.calls).toHaveLength(1);
  });

  it("nimmt auf arm64 das arm64-Manifest und überspringt die Attestierung", async () => {
    const u = await updateApp({}, "arm64");
    expect((await u.admin.post("/system/update/check")).body.available.commit).toBe(NEW);
    const paths = registry.requests.map((r) => r.path);
    expect(paths).toContain(`/v2/${REPOSITORY}/manifests/${registry.digests.arm64}`);
    expect(paths).toContain(`/v2/${REPOSITORY}/blobs/${registry.digests.arm64Config}`);
    expect(paths).not.toContain(`/v2/${REPOSITORY}/manifests/${registry.digests.amd64}`);
    expect(paths).not.toContain(`/v2/${REPOSITORY}/manifests/${registry.digests.attestation}`);
  });

  it("meldet sich mit LYKORA_REGISTRY_USER und LYKORA_REGISTRY_TOKEN an", async () => {
    registry.options.requireBasic = { user: "bot", password: "ghp_geheim" };
    const anonymous = await updateApp();
    const denied = (await anonymous.admin.post("/system/update/check")).body;
    expect(denied).toMatchObject({ upToDate: null, available: null, checkError: "Image nicht gefunden oder nicht öffentlich" });

    const u = await updateApp({ LYKORA_REGISTRY_USER: "bot", LYKORA_REGISTRY_TOKEN: "ghp_geheim" });
    expect((await u.admin.post("/system/update/check")).body).toMatchObject({ available: { commit: NEW }, checkError: null });
    expect(registry.tokenRequests.at(-1)!.authorization).toBe(`Basic ${Buffer.from("bot:ghp_geheim").toString("base64")}`);
  });

  it("rechnet den Digest selbst, wenn die Registry ihn nicht nennt", async () => {
    registry.options.digestHeader = false;
    const u = await updateApp();
    const digest = `sha256:${createHash("sha256").update(registry.raw()).digest("hex")}`;
    expect((await u.admin.post("/system/update/check")).body.available.digest).toBe(digest);
  });

  it("meldet verständlich, wenn das Image fehlt oder die Registry nicht erreichbar ist", async () => {
    const missing = await updateApp({ LYKORA_IMAGE: registry.image("gibtsnicht") });
    expect((await missing.admin.post("/system/update/check")).body).toMatchObject({
      upToDate: null,
      checkError: "Image nicht gefunden oder nicht öffentlich",
      lastCheckAt: NOON.toISOString(),
    });
    const offline = await updateApp({ LYKORA_IMAGE: "127.0.0.1:1/wolfsrudel-gaming/lykora:testbuild" });
    expect((await offline.admin.post("/system/update/check")).body.checkError).toBe("Registry 127.0.0.1:1 ist nicht erreichbar");
    const broken = await updateApp({ LYKORA_IMAGE: "ghcr.io/Gross/Geschrieben" });
    expect((await broken.admin.post("/system/update/check")).body.checkError).toContain("ungültig");
  });

  it("behält eine bekannte neue Version, wenn die Registry später ausfällt", async () => {
    const u = await updateApp();
    await u.admin.post("/system/update/check");
    registry.options.failWith = 500;
    clock = minutes(30);
    const s = (await u.admin.post("/system/update/check")).body;
    expect(s).toMatchObject({ upToDate: null, checkError: "Registry antwortet mit HTTP 500", available: { commit: NEW }, lastCheckAt: clock.toISOString() });
  });

  it("fragt die Registry unter LYKORA_REGISTRY_URL, wenn der Server sie anders erreicht als Docker", async () => {
    // Das Image nennt ghcr.io, gefragt wird aber die Fake-Registry; der Pfad kommt weiter aus dem Image.
    const u = await updateApp({ LYKORA_IMAGE: `ghcr.io/${REPOSITORY}:testbuild`, LYKORA_REGISTRY_URL: `http://${registry.host}/` });
    const s = (await u.admin.post("/system/update/check")).body;
    expect(s).toMatchObject({ image: `ghcr.io/${REPOSITORY}:testbuild`, available: { commit: NEW }, checkError: null });
    expect(registry.requests.map((r) => r.path)).toContain(`/v2/${REPOSITORY}/manifests/testbuild`);

    const offline = await updateApp({ LYKORA_IMAGE: `ghcr.io/${REPOSITORY}:testbuild`, LYKORA_REGISTRY_URL: "http://127.0.0.1:1" });
    expect((await offline.admin.post("/system/update/check")).body.checkError).toBe("Registry 127.0.0.1:1 ist nicht erreichbar");
    expect(() => testConfig({ LYKORA_REGISTRY_URL: "registry:5000" })).toThrow("LYKORA_REGISTRY_URL");
  });

  it("nimmt das Repo für Änderungen aus GITHUB_REPO, sonst aus dem Label source", async () => {
    registry.publish({ ...LABELS, source: "https://github.com/Beispiel/lykora-fork.git" });
    await (await updateApp()).admin.post("/system/update/check");
    await (await updateApp({ GITHUB_REPO: "Wolfsrudel-Gaming/lykora" })).admin.post("/system/update/check");
    expect(github.calls).toEqual([
      `https://api.github.com/repos/Beispiel/lykora-fork/compare/${OLD}...${NEW}`,
      `https://api.github.com/repos/Wolfsrudel-Gaming/lykora/compare/${OLD}...${NEW}`,
    ]);
  });

  it("zeigt keine Änderungen, wenn GitHub nicht antwortet, und fragt beim nächsten Mal erneut", async () => {
    github.fail = true;
    const u = await updateApp();
    expect((await u.admin.post("/system/update/check")).body).toMatchObject({ available: { commit: NEW }, changes: [], checkError: null });
    github.fail = false;
    expect((await u.admin.post("/system/update/check")).body.changes).toHaveLength(2);
    expect(github.calls).toHaveLength(2);
  });

  it("zerlegt Image-Adressen; HTTP nur für localhost", () => {
    expect(parseImageRef("ghcr.io/wolfsrudel-gaming/lykora:testbuild")).toEqual({
      registry: "ghcr.io",
      repository: "wolfsrudel-gaming/lykora",
      reference: "testbuild",
      baseUrl: "https://ghcr.io",
    });
    expect(parseImageRef("ghcr.io/wolfsrudel-gaming/lykora").reference).toBe("latest");
    expect(parseImageRef("postgres:16-alpine")).toEqual({
      registry: "registry-1.docker.io",
      repository: "library/postgres",
      reference: "16-alpine",
      baseUrl: "https://registry-1.docker.io",
    });
    expect(parseImageRef("docker.io/wolfsrudel/lykora").repository).toBe("wolfsrudel/lykora");
    expect(parseImageRef("localhost:5000/lykora/server:sha-abc1234").baseUrl).toBe("http://localhost:5000");
    expect(parseImageRef("registry.example.org:8443/team/lykora:1.0").baseUrl).toBe("https://registry.example.org:8443");
    expect(parseImageRef("10.0.0.5:5000/team/lykora").baseUrl).toBe("https://10.0.0.5:5000");
    const digest = `sha256:${"a".repeat(64)}`;
    expect(parseImageRef(`127.0.0.1:5000/a/b@${digest}`)).toMatchObject({ reference: digest, baseUrl: "http://127.0.0.1:5000" });
    for (const bad of ["", "ghcr.io/Gross/Geschrieben", "http://ghcr.io/x/y", "ghcr.io/x/y:", "ghcr.io/x/y@sha256:kurz"]) {
      expect(() => parseImageRef(bad), bad).toThrow();
    }
  });
});

describe("Neuer, älter, gleich", () => {
  it("vergleicht Commit und Bauzeit", () => {
    const current = { version: "57", commit: OLD, builtAt: BUILT_AT };
    expect(isNewer(current, { version: "58", commit: NEW, builtAt: "2026-10-20T12:00:00Z" })).toBe(true);
    expect(isNewer(current, { version: "57", commit: OLD, builtAt: "2026-10-20T12:00:00Z" })).toBe(false);
    expect(isNewer(current, { version: "57", commit: OLD.slice(0, 7), builtAt: "2026-10-20T12:00:00Z" })).toBe(false);
    expect(isNewer(current, { version: "56", commit: NEW, builtAt: "2026-09-01T12:00:00Z" })).toBe(false);
    expect(isNewer(current, { version: "58", commit: NEW, builtAt: null })).toBe(false);
    expect(isNewer(current, { version: "58", commit: null, builtAt: "2026-10-20T12:00:00Z" })).toBe(false);
    // Lokaler Build ohne Bauzeit: jeder andere Commit gilt als neuer.
    expect(isNewer({ version: "dev", commit: null, builtAt: null }, { version: "58", commit: NEW, builtAt: null })).toBe(true);
  });

  it("meldet aktuell bei gleichem Commit und bei älterem Image", async () => {
    registry.publish({ ...LABELS, version: "57", revision: OLD, created: BUILT_AT });
    const same = await updateApp();
    expect((await same.admin.post("/system/update/check")).body).toMatchObject({ upToDate: true, available: null, changes: [], checkError: null });

    registry.publish({ ...LABELS, version: "56", revision: NEW, created: "2026-09-01T00:00:00Z" });
    const older = await updateApp();
    expect((await older.admin.post("/system/update/check")).body).toMatchObject({ upToDate: true, available: null });
    expect(github.calls).toEqual([]);
  });

  it("meldet einen Fehler, wenn das Image keine Versionsangaben trägt", async () => {
    registry.publish({});
    const u = await updateApp();
    expect((await u.admin.post("/system/update/check")).body.checkError).toContain("keine Versionsangaben");
  });
});

describe("Zeitfenster", () => {
  const tz = "Europe/Berlin";
  it("gilt in der eingestellten Zeitzone, auch über Mitternacht", () => {
    const night = { from: "03:00", to: "05:00" };
    expect(inWindow(new Date("2026-10-21T01:00:00Z"), night, tz)).toBe(true);
    expect(inWindow(new Date("2026-10-21T02:59:00Z"), night, tz)).toBe(true);
    expect(inWindow(new Date("2026-10-21T03:00:00Z"), night, tz)).toBe(false);
    expect(inWindow(NOON, night, tz)).toBe(false);
    const overMidnight = { from: "23:00", to: "05:00" };
    expect(inWindow(new Date("2026-10-21T21:00:00Z"), overMidnight, tz)).toBe(true);
    expect(inWindow(new Date("2026-10-21T22:30:00Z"), overMidnight, tz)).toBe(true);
    expect(inWindow(new Date("2026-10-21T02:59:00Z"), overMidnight, tz)).toBe(true);
    expect(inWindow(NOON, overMidnight, tz)).toBe(false);
    expect(inWindow(NOON, night, "UTC")).toBe(false);
    expect(inWindow(new Date("2026-10-21T04:00:00Z"), night, "UTC")).toBe(true);
  });

  it("berechnet den nächsten Beginn, auch über die Zeitumstellung", () => {
    expect(nextWindowStart(NOON, { from: "03:00", to: "05:00" }, tz).toISOString()).toBe("2026-10-22T01:00:00.000Z");
    expect(nextWindowStart(new Date("2026-10-21T10:00:42.5Z"), { from: "23:00", to: "05:00" }, tz).toISOString()).toBe("2026-10-21T21:00:00.000Z");
    // Herbst: 25.10.2026 gilt um 03:00 wieder MEZ.
    expect(nextWindowStart(new Date("2026-10-24T10:00:00Z"), { from: "03:00", to: "05:00" }, tz).toISOString()).toBe("2026-10-25T02:00:00.000Z");
    // Frühjahr: 28.03.2027 gilt um 03:00 schon MESZ.
    expect(nextWindowStart(new Date("2027-03-27T12:00:00Z"), { from: "03:00", to: "05:00" }, tz).toISOString()).toBe("2027-03-28T01:00:00.000Z");
  });
});

describe("Entscheidung für den Updater", () => {
  it("wartet ohne Opt-in und aktualisiert mit Opt-in; der Verlauf beginnt beim ersten update", async () => {
    const u = await ready({ auto: false });
    expect(await u.plan()).toEqual({ action: "wait", reason: "Automatische Updates sind aus", pollSeconds: 60 });
    let s = await u.status();
    expect(s.updater).toEqual({ connected: true, lastSeenAt: NOON.toISOString(), state: null, message: null });
    expect(s.blockedBy).toBeNull();
    expect(s.history).toEqual([]);

    await u.admin.put("/system/update/settings", { auto: true });
    const plan = await u.plan();
    expect(plan).toEqual({
      action: "update",
      reason: "Automatisches Update",
      pollSeconds: 60,
      target: { commit: NEW, version: "58", digest: registry.digests.index },
    });
    s = await u.status();
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({
      trigger: "auto",
      state: "running",
      from: { version: "57", commit: OLD },
      to: { version: "58", commit: NEW },
      message: null,
      startedAt: NOON.toISOString(),
      finishedAt: null,
    });
    expect(s.pending).toEqual({ trigger: "auto", requestedAt: NOON.toISOString(), to: { version: "58", commit: NEW, builtAt: null } });

    clock = minutes(1);
    expect((await u.plan()).action).toBe("update");
    expect((await u.status()).history).toHaveLength(1);
  });

  it("wartet ohne Image und ohne neue Version", async () => {
    const none = await updateApp({ LYKORA_IMAGE: "" });
    expect(await none.status()).toMatchObject({ configured: false, image: null, available: null, checkError: null });
    expect(await none.plan()).toMatchObject({ action: "wait", reason: expect.stringContaining("LYKORA_IMAGE ist nicht gesetzt") });

    const unchecked = await updateApp();
    expect(await unchecked.plan()).toMatchObject({ action: "wait", reason: "Noch nicht geprüft" });
    registry.publish({ ...LABELS, revision: OLD });
    await unchecked.admin.post("/system/update/check");
    expect(await unchecked.plan()).toMatchObject({ action: "wait", reason: "Keine neuere Version bekannt" });
  });

  it("gibt dem Updater den Abstand aus UPDATER_POLL_SECONDS vor", async () => {
    const u = await ready({ auto: true }, { UPDATER_POLL_SECONDS: "5" });
    expect(await u.plan()).toMatchObject({ action: "update", pollSeconds: 5 });
    expect(await u.plan()).toMatchObject({ action: "update", pollSeconds: 5 });
  });

  it("aktualisiert nie während eines Events", async () => {
    const u = await ready({ auto: true });
    const { event } = await createEvent(ctx);
    expect((await client(ctx).post(`/events/${event.id}/start`)).body.status).toBe("running");

    expect(await u.plan()).toMatchObject({ action: "wait", reason: "Event läuft: Testlauf" });
    expect((await u.status()).blockedBy).toEqual({ reason: "event_running", events: [{ id: event.id, name: "Testlauf", status: "running" }] });
    const apply = await u.admin.post("/system/update/apply");
    expect(apply.status).toBe(409);
    expect(apply.body).toMatchObject({ error: "event_running", events: [{ id: event.id, name: "Testlauf", status: "running" }] });

    for (const action of ["pause", "recall"]) {
      await client(ctx).post(`/events/${event.id}/${action}`);
      expect((await u.plan()).action, action).toBe("wait");
    }
    expect((await u.status()).blockedBy).toMatchObject({ reason: "event_running", events: [{ status: "recalled" }] });

    await client(ctx).post(`/events/${event.id}/end`);
    expect((await u.plan()).action).toBe("update");
    expect((await u.status()).blockedBy).toBeNull();
  });

  it("ignoriert Probeläufe aus dem Baukasten", async () => {
    const u = await ready({ auto: true });
    const orga = client(ctx);
    const game = await orga.post(`/orgs/${ctx.orgId}/games/drafts`, { content: exampleGame() });
    const probe = await orga.post(`/games/${game.body.id}/test-events`, { revision: 1 });
    expect(probe.body).toMatchObject({ test: true, status: "running" });

    expect((await u.status()).blockedBy).toBeNull();
    expect((await u.plan()).action).toBe("update");
    const apply = await u.admin.post("/system/update/apply");
    expect(apply.status).toBe(202);

    // Ein echtes Event hält weiter auf, auch neben dem Probelauf.
    const { event } = await createEvent(ctx);
    await client(ctx).post(`/events/${event.id}/start`);
    expect((await u.status()).blockedBy).toEqual({ reason: "event_running", events: [{ id: event.id, name: "Testlauf", status: "running" }] });
  });

  it("hält sich an das Zeitfenster", async () => {
    const u = await ready({ auto: true, window: { from: "03:00", to: "05:00" } });
    expect(await u.plan()).toMatchObject({ action: "wait", reason: "Außerhalb des Zeitfensters 03:00–05:00" });
    expect((await u.status()).blockedBy).toEqual({ reason: "outside_window", nextWindowAt: "2026-10-22T01:00:00.000Z" });

    clock = new Date("2026-10-22T01:30:00Z");
    expect((await u.status()).blockedBy).toBeNull();
    expect(await u.plan()).toMatchObject({ action: "update", target: { commit: NEW } });
    expect((await u.status()).history[0]).toMatchObject({ trigger: "auto", startedAt: clock.toISOString() });
  });

  it("hält sich an ein Zeitfenster über Mitternacht", async () => {
    const u = await ready({ auto: true, window: { from: "23:00", to: "05:00" } });
    expect((await u.plan()).action).toBe("wait");
    expect((await u.status()).blockedBy).toEqual({ reason: "outside_window", nextWindowAt: "2026-10-21T21:00:00.000Z" });
    // 05:00 Uhr gehört nicht mehr dazu.
    clock = new Date("2026-10-22T03:00:00Z");
    expect((await u.plan()).action).toBe("wait");
    expect((await u.status()).blockedBy).toEqual({ reason: "outside_window", nextWindowAt: "2026-10-22T21:00:00.000Z" });
    // 00:30 Uhr
    clock = new Date("2026-10-21T22:30:00Z");
    expect((await u.plan()).action).toBe("update");
  });

  it("führt einen manuellen Auftrag auch außerhalb des Fensters und ohne Opt-in aus", async () => {
    const u = await ready({ auto: false, window: { from: "03:00", to: "05:00" } });
    const offline = await u.admin.post("/system/update/apply");
    expect(offline.status).toBe(409);
    expect(offline.body.error).toBe("updater_offline");

    expect((await u.plan()).action).toBe("wait");
    clock = minutes(1);
    const apply = await u.admin.post("/system/update/apply");
    expect(apply.status).toBe(202);
    expect(apply.body.pending).toEqual({ trigger: "manual", requestedAt: clock.toISOString(), to: { version: "58", commit: NEW, builtAt: LABELS.created } });
    expect(apply.body.blockedBy).toMatchObject({ reason: "outside_window" });

    expect(await u.plan()).toMatchObject({ action: "update", reason: "Manueller Auftrag", target: { commit: NEW, digest: registry.digests.index } });
    expect((await u.status()).history[0]).toMatchObject({ trigger: "manual", state: "running" });

    // Länger als 3 Minuten nichts vom Updater: nicht verbunden.
    clock = minutes(5);
    expect((await u.status()).updater).toMatchObject({ connected: false, lastSeenAt: minutes(1).toISOString() });
    expect((await u.admin.post("/system/update/apply")).body.error).toBe("updater_offline");
  });

  it("sieht ein lokal gebautes Image als nicht eingerichtet an und fragt dafür keine Registry", async () => {
    // So empfiehlt es die README fürs Selbstbauen; Docker Hub kennt kein solches Image.
    const u = await updateApp({ LYKORA_IMAGE: "lykora-server:latest" });
    await u.service.start();
    u.service.stop();
    expect((await u.admin.post("/system/update/check")).status).toBe(200);
    const s = await u.status();
    expect(s).toMatchObject({ configured: false, image: "lykora-server:latest", available: null, upToDate: null, lastCheckAt: null });
    expect(s.checkError).toBe("LYKORA_IMAGE nennt das lokal gebaute Image lykora-server:latest, das in keiner Registry liegt; daraus gibt es keine Updates");
    expect(registry.requests).toEqual([]);
    expect(await u.plan()).toMatchObject({ action: "wait", reason: expect.stringContaining("lokal gebaute Image lykora-server:latest") });
    const apply = await u.admin.post("/system/update/apply");
    expect(apply.status).toBe(409);
    expect(apply.body).toMatchObject({ error: "not_configured", message: expect.stringContaining("lokal gebaute") });
    // Mit Namensraum oder Registry gilt das Image als entfernt.
    expect((await updateApp({ LYKORA_IMAGE: "wolfsrudel/lykora:latest" })).service.configured).toBe(true);
    expect((await updateApp({ LYKORA_IMAGE: "ghcr.io/wolfsrudel-gaming/lykora" })).service.configured).toBe(true);
  });

  it("lehnt Aufträge ohne Image und ohne neue Version ab", async () => {
    const none = await updateApp({ LYKORA_IMAGE: "" });
    const notConfigured = await none.admin.post("/system/update/apply");
    expect(notConfigured.status).toBe(409);
    expect(notConfigured.body.error).toBe("not_configured");

    registry.publish({ ...LABELS, revision: OLD, created: BUILT_AT });
    const current = await updateApp();
    await current.plan();
    // Ohne vorherige Prüfung prüft der Auftrag selbst.
    const upToDate = await current.admin.post("/system/update/apply");
    expect(upToDate.status).toBe(409);
    expect(upToDate.body.error).toBe("up_to_date");
    expect((await current.status()).upToDate).toBe(true);
  });
});

describe("Updater-Token", () => {
  it("lässt die Updater-Schnittstelle nur mit dem richtigen Token zu", async () => {
    const u = await updateApp();
    const token = await u.service.updaterToken();
    for (const auth of [null, "Bearer falsch", `Basic ${token}`, `Bearer ${token}x`, `Bearer ${ctx.token}`]) {
      const res = await u.updater("GET", "plan", undefined, auth);
      expect(res.statusCode, String(auth)).toBe(401);
      expect(res.json().error).toBe("unauthorized");
    }
    const query = await u.app.inject({ method: "GET", url: `${ctx.api}/updater/plan?access_token=${token}` });
    expect(query.statusCode).toBe(401);
    // Ohne Token kein Hinweis auf das erwartete Format.
    expect((await u.updater("POST", "report", { state: "kaputt" }, "Bearer falsch")).statusCode).toBe(401);
    expect((await u.updater("POST", "report", { state: "kaputt" })).statusCode).toBe(400);
    expect((await u.updater("GET", "plan")).statusCode).toBe(200);
    // Fehlversuche zählen nicht als Lebenszeichen.
    const fresh = await updateApp();
    await fresh.updater("GET", "plan", undefined, "Bearer falsch");
    expect((await fresh.status()).updater.lastSeenAt).toBeNull();
  });

  it("legt beim Start DATA_DIR/updater.token an und nimmt sonst UPDATER_TOKEN", async () => {
    const dataDir = tempDir("token");
    const u = await updateApp({ LYKORA_IMAGE: "", DATA_DIR: dataDir });
    await u.service.start();
    const file = join(dataDir, "updater.token");
    const token = readFileSync(file, "utf8").trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o640);
    expect((await u.updater("GET", "plan", undefined, `Bearer ${token}`)).statusCode).toBe(200);

    // Nach einem Neustart gilt derselbe Token.
    const again = await updateApp({ LYKORA_IMAGE: "", DATA_DIR: dataDir });
    expect(await again.service.updaterToken()).toBe(token);

    const otherDir = tempDir("token");
    const fixed = await updateApp({ UPDATER_TOKEN: "geheimer-updater-token", DATA_DIR: otherDir });
    await fixed.service.start();
    fixed.service.stop();
    expect((await fixed.updater("GET", "plan", undefined, "Bearer geheimer-updater-token")).statusCode).toBe(200);
    expect((await fixed.updater("GET", "plan", undefined, `Bearer ${token}`)).statusCode).toBe(401);
    expect(existsSync(join(otherDir, "updater.token"))).toBe(false);
  });

  it("startet auch, wenn DATA_DIR nicht beschreibbar ist, und hält die Schnittstelle bis dahin zu", async () => {
    // Ein Bind-Mount, der dem Server nicht gehört: Hier steht statt des Ordners eine Datei im Weg.
    const parent = tempDir("token");
    const blocker = join(parent, "data");
    writeFileSync(blocker, "");
    const dataDir = join(blocker, "unterordner");
    const u = await updateApp({ DATA_DIR: dataDir });
    const logged: string[] = [];
    await u.service.start((m) => logged.push(m));
    u.service.stop();
    expect(logged).toEqual([expect.stringMatching(/^Token des Updaters nicht verfügbar: .*ENOTDIR.*der Updater kann sich nicht anmelden$/)]);
    expect((await u.updater("GET", "plan", undefined, "Bearer irgendwas")).statusCode).toBe(401);
    expect((await u.status()).configured).toBe(true);

    // Sobald der Ordner beschreibbar ist, legt der nächste Aufruf den Token an; kein Neustart nötig.
    rmSync(blocker);
    const token = await u.service.updaterToken();
    expect(readFileSync(join(dataDir, "updater.token"), "utf8").trim()).toBe(token);
    expect((await u.updater("GET", "plan", undefined, `Bearer ${token}`)).statusCode).toBe(200);
  });
});

describe("Berichte und Verlauf", () => {
  it("schließt den Verlauf bei Fehler und Rückfall; automatisch erst nach einer Pause erneut", async () => {
    const u = await ready({ auto: true });
    expect((await u.plan()).action).toBe("update");
    await u.report({ state: "pulling" });
    expect((await u.status()).updater).toMatchObject({ connected: true, state: "pulling", message: null });

    clock = minutes(1);
    await u.report({ state: "failed", message: "Ziehen fehlgeschlagen: denied" });
    let s = await u.status();
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ trigger: "auto", state: "failed", message: "Ziehen fehlgeschlagen: denied", finishedAt: clock.toISOString() });
    expect(s.pending).toBeNull();
    expect(s.updater).toMatchObject({ state: "failed", message: "Ziehen fehlgeschlagen: denied", lastSeenAt: clock.toISOString() });
    expect(await u.plan()).toMatchObject({ action: "wait", reason: "Update auf diese Version ist gescheitert; automatisch erst nach 6 Stunden erneut" });

    // Manuell erneut: neuer Eintrag; der Rückfall schließt ihn, der Auftrag verfällt.
    clock = minutes(2);
    expect((await u.admin.post("/system/update/apply")).status).toBe(202);
    expect(await u.plan()).toMatchObject({ action: "update", reason: "Manueller Auftrag" });
    await u.report({ state: "updating" });
    await u.report({ state: "restarting" });
    await u.report({ state: "rolled_back", message: "Neue Version nicht gesund\nError: kaputt", imageId: "sha256:abc" });
    s = await u.status();
    expect(s.history.map((h) => [h.trigger, h.state])).toEqual([
      ["manual", "rolled_back"],
      ["auto", "failed"],
    ]);
    expect(s.history[0]!.message).toBe("Neue Version nicht gesund\nError: kaputt");
    expect(s.pending).toBeNull();
    expect((await u.plan()).action).toBe("wait");

    // Nach 6 Stunden versucht es das automatische Update erneut.
    clock = minutes(2 + 6 * 60 + 1);
    expect(await u.plan()).toMatchObject({ action: "update", reason: "Automatisches Update" });
    expect((await u.status()).history.map((h) => [h.trigger, h.state])).toEqual([
      ["auto", "running"],
      ["manual", "rolled_back"],
      ["auto", "failed"],
    ]);
  });

  it("wertet idle direkt nach pulling als nichts ersetzt und unsupported als gescheitert", async () => {
    const u = await ready({ auto: true });
    await u.plan();
    await u.report({ state: "pulling" });
    await u.report({ state: "idle", message: "Image ist schon aktuell" });
    expect((await u.status()).history[0]).toMatchObject({ state: "failed", message: "Image ist schon aktuell" });

    clock = minutes(1);
    await u.admin.post("/system/update/apply");
    await u.plan();
    // idle ohne vorheriges pulling, etwa nach dem Start des Updaters, lässt das Update laufen.
    await u.report({ state: "idle" });
    expect((await u.status()).history[0]).toMatchObject({ trigger: "manual", state: "running" });
    await u.report({ state: "unsupported", message: "Container läuft mit lokalem Image; LYKORA_IMAGE in .env setzen" });
    const s = await u.status();
    expect(s.history[0]).toMatchObject({ state: "failed", message: "Container läuft mit lokalem Image; LYKORA_IMAGE in .env setzen" });
    expect(s.updater.state).toBe("unsupported");
    expect(s.pending).toBeNull();
  });

  it("schließt nach dem Neustart mit dem Ziel-Commit das Update als eingespielt ab", async () => {
    const before = await ready({ auto: true });
    expect((await before.plan()).action).toBe("update");

    clock = minutes(2);
    const after = await updateApp({ LYKORA_VERSION: "58", LYKORA_COMMIT: NEW, LYKORA_BUILT_AT: LABELS.created });
    await after.service.start();
    await after.service.check();
    after.service.stop();
    const s = await after.status();
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({
      state: "succeeded",
      message: "Update eingespielt",
      from: { version: "57", commit: OLD },
      to: { version: "58", commit: NEW },
      finishedAt: clock.toISOString(),
    });
    expect(s).toMatchObject({ current: { version: "58", commit: NEW }, upToDate: true, available: null, pending: null });
  });

  it("wertet ein Update als liegengeblieben, wenn der Updater 15 Minuten nichts gemeldet hat", async () => {
    const before = await ready({ auto: true });
    await before.plan();

    // Alter Server nach dem Rückfall neu gestartet: Noch kein Urteil, der Updater meldet sich gleich.
    clock = minutes(5);
    const restarted = await updateApp();
    await restarted.service.reconcile();
    expect((await restarted.status()).history[0]).toMatchObject({ state: "running", finishedAt: null });

    // Ein langsames Ziehen zählt als Fortschritt: Der Zwischenstand hält das Update am Leben.
    clock = minutes(14);
    await before.report({ state: "updating" });
    clock = minutes(16);
    const patient = await updateApp();
    await patient.service.reconcile();
    expect((await patient.status()).history[0]).toMatchObject({ state: "running", finishedAt: null });

    clock = minutes(30);
    const late = await updateApp();
    await late.service.reconcile();
    expect((await late.status()).history[0]).toMatchObject({
      state: "failed",
      message: "Nicht abgeschlossen; der Server läuft noch mit der alten Version",
      finishedAt: clock.toISOString(),
    });
  });

  it("nimmt den Rückfall auch nach einem langen Update an, gerechnet ab dem Abschluss", async () => {
    const before = await ready({ auto: true });
    expect((await before.plan()).action).toBe("update");
    clock = minutes(20);
    await before.report({ state: "updating" });

    // Nach 25 Minuten hält sich die neue Version für eingespielt, läuft dann aber nicht gesund weiter.
    clock = minutes(25);
    const fresh = await updateApp({ LYKORA_VERSION: "58", LYKORA_COMMIT: NEW, LYKORA_BUILT_AT: LABELS.created });
    await fresh.service.reconcile();
    expect((await fresh.status()).history[0]).toMatchObject({ state: "succeeded", finishedAt: clock.toISOString() });

    clock = minutes(27);
    const back = await updateApp();
    await back.service.reconcile();
    await back.admin.post("/system/update/check");
    expect(await back.plan()).toMatchObject({ action: "wait", reason: "Voriges Update auf diese Version ist noch nicht abgeschlossen" });
    await back.report({ state: "rolled_back", message: "Neue Version startete nicht gesund" });
    expect((await back.status()).history).toEqual([
      expect.objectContaining({ state: "rolled_back", message: "Neue Version startete nicht gesund", finishedAt: clock.toISOString() }),
    ]);
    expect(await back.plan()).toMatchObject({ action: "wait", reason: expect.stringContaining("gescheitert") });

    // Ein Erfolg, der lange zurückliegt, bleibt bestehen.
    clock = minutes(27 + 16);
    await back.report({ state: "rolled_back", message: "verspätet" });
    expect((await back.status()).history[0]!.message).toBe("Neue Version startete nicht gesund");
  });

  it("nimmt den Rückfall auch an, wenn die neue Version sich beim Start schon als eingespielt vermerkt hat", async () => {
    const before = await ready({ auto: true });
    expect((await before.plan()).action).toBe("update");

    // Die neue Version startet, hält das Update für eingespielt, läuft dann aber nicht gesund weiter.
    clock = minutes(1);
    const fresh = await updateApp({ LYKORA_VERSION: "58", LYKORA_COMMIT: NEW, LYKORA_BUILT_AT: LABELS.created });
    await fresh.service.reconcile();
    expect((await fresh.status()).history[0]).toMatchObject({ state: "succeeded", to: { commit: NEW } });
    // Solange der Server mit dem Ziel läuft, bleibt ein Rückfall-Bericht ohne Wirkung.
    await fresh.report({ state: "rolled_back", message: "verspätet" });
    expect((await fresh.status()).history[0]).toMatchObject({ state: "succeeded", message: "Update eingespielt" });

    // Der alte Server kommt zurück: kein neuer Versuch, bevor der Updater berichtet hat.
    clock = minutes(2);
    const back = await updateApp();
    await back.service.reconcile();
    await back.admin.post("/system/update/check");
    expect(await back.plan()).toMatchObject({ action: "wait", reason: "Voriges Update auf diese Version ist noch nicht abgeschlossen" });
    expect((await back.status()).history).toHaveLength(1);

    await back.report({ state: "rolled_back", message: "Neue Version startete nicht gesund" });
    const s = await back.status();
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ state: "rolled_back", message: "Neue Version startete nicht gesund", to: { commit: NEW }, finishedAt: clock.toISOString() });
    expect(await back.plan()).toMatchObject({ action: "wait", reason: "Update auf diese Version ist gescheitert; automatisch erst nach 6 Stunden erneut" });
  });

  it("schließt ein offenes Update ab, wenn eine neuere Version erscheint", async () => {
    const u = await ready({ auto: true });
    await u.plan();
    const newer = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
    registry.publish({ ...LABELS, version: "59", revision: newer, created: "2026-10-21T09:00:00Z" });
    clock = minutes(30);
    await u.admin.post("/system/update/check");
    expect(await u.plan()).toMatchObject({ action: "update", target: { commit: newer, version: "59" } });
    const s = await u.status();
    expect(s.history.map((h) => [h.to.version, h.state])).toEqual([
      ["59", "running"],
      ["58", "failed"],
    ]);
    expect(s.history[1]!.message).toBe("Abgelöst durch eine neuere Version");
  });
});
