// Entwürfe des Baukastens, Veröffentlichen, Probeläufe und Spiele ohne Version (Paket A, Teil 2).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeExpired } from "../src/services/retention.ts";
import { client, exampleGame, member, setup, type TestContext } from "./helpers.ts";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx?.close();
});

/** Beispielspiel ohne Sicherheitsangaben: im Lykora-Format, aber kein gültiges Spiel. */
function incompleteGame(title = "Unfertig") {
  const game = exampleGame() as unknown as Record<string, unknown>;
  delete game.safety;
  (game.meta as Record<string, unknown>).title = title;
  return game;
}

/** Gültiges Beispielspiel mit anderem Titel, um Stände zu unterscheiden. */
function withTitle(title: string) {
  const game = exampleGame();
  game.meta.title = title;
  return game;
}

/** Spiel per Import, also mit Version 1 und ohne Entwurf. */
async function importGame(game = exampleGame()): Promise<string> {
  const res = await client(ctx).post(`/orgs/${ctx.orgId}/games`, { content: game, comment: "Import" });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** Spiel nur als Entwurf, ohne Version. */
async function draftGame(content: unknown = incompleteGame()) {
  const res = await client(ctx).post(`/orgs/${ctx.orgId}/games/drafts`, { content });
  expect(res.status).toBe(201);
  return res.body;
}

const iso = () => new Date().toISOString();

describe("Spiele ohne Version", () => {
  it("legt ein Spiel als Entwurf an und zeigt es ohne Version", async () => {
    const orga = client(ctx);
    const created = await draftGame(incompleteGame("Entwurf eins"));
    expect(created).toMatchObject({
      title: "Entwurf eins",
      archived: false,
      latest_version: null,
      draft: { revision: 1, base_version: null, changed: true, updated_by: "Admin" },
    });
    const list = await orga.get(`/orgs/${ctx.orgId}/games`);
    expect(list.body.find((g: any) => g.id === created.id)).toMatchObject({ latest_version: null, draft: { revision: 1, changed: true } });
    const detail = await orga.get(`/games/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ latest_version: null, content: null, versions: [], draft: { revision: 1 } });
    // Importierte Spiele haben keinen Entwurf.
    const imported = await orga.get(`/games/${await importGame()}`);
    expect(imported.body).toMatchObject({ latest_version: 1, draft: null });
  });

  it("nimmt nur Spiele im Lykora-Format an", async () => {
    const orga = client(ctx);
    for (const content of [{ meta: { title: "Ohne Format" } }, { format: { name: "anderes-format" } }]) {
      const res = await orga.post(`/orgs/${ctx.orgId}/games/drafts`, { content });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("not_a_game");
    }
    expect((await orga.post(`/orgs/${ctx.orgId}/games/drafts`, { content: "text" })).status).toBe(400);
    // Ohne Titel heißt das Spiel „Neues Spiel“.
    const bare = await orga.post(`/orgs/${ctx.orgId}/games/drafts`, { content: { format: { name: "lykora-game", version: "0.1" } } });
    expect(bare.status).toBe(201);
    expect(bare.body.title).toBe("Neues Spiel");
  });

  it("lehnt Events für Spiele ohne Version ab", async () => {
    const orga = client(ctx);
    const created = await draftGame();
    const res = await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: created.id, name: "Zu früh" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_version");
    // Bei einem veröffentlichten Spiel bleibt eine unbekannte Version ein 404.
    const unknown = await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: await importGame(), version: 3, name: "Gibt es nicht" });
    expect(unknown.status).toBe(404);
  });
});

describe("Entwurf lesen und speichern", () => {
  it("liefert den Entwurf, zählt die Revision hoch und meldet Konflikte", async () => {
    const orga = client(ctx);
    const created = await draftGame(incompleteGame("Revisionen"));
    const got = await orga.get(`/games/${created.id}/draft`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ gameId: created.id, revision: 1, base_version: null, meta: {}, updated_by: { name: "Admin" } });
    expect(got.body.content.meta.title).toBe("Revisionen");

    const put = await orga.put(`/games/${created.id}/draft`, { content: incompleteGame("Umbenannt"), meta: { checklist: { telefon: iso() } }, revision: 1 });
    expect(put.status).toBe(200);
    expect(put.body.revision).toBe(2);
    expect(typeof put.body.updated_at).toBe("string");
    // Titel und Merker folgen dem Entwurf.
    expect((await orga.get(`/games/${created.id}`)).body.title).toBe("Umbenannt");
    const again = await orga.get(`/games/${created.id}/draft`);
    expect(again.body.revision).toBe(2);
    expect(again.body.content.meta.title).toBe("Umbenannt");
    expect(Object.keys(again.body.meta.checklist)).toEqual(["telefon"]);

    // Alte Revision: Konflikt mit dem gespeicherten Stand, nichts wird überschrieben.
    const stale = await orga.put(`/games/${created.id}/draft`, { content: incompleteGame("Veraltet"), meta: {}, revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("draft_conflict");
    expect(stale.body.draft).toMatchObject({ revision: 2, updated_by: { name: "Admin" } });
    expect(stale.body.draft.content.meta.title).toBe("Umbenannt");
    expect((await orga.get(`/games/${created.id}/draft`)).body.content.meta.title).toBe("Umbenannt");
  });

  it("legt den Entwurf eines importierten Spiels mit revision 0 an", async () => {
    const orga = client(ctx);
    const gameId = await importGame();
    const none = await orga.get(`/games/${gameId}/draft`);
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("no_draft");
    const wrong = await orga.put(`/games/${gameId}/draft`, { content: exampleGame(), meta: {}, revision: 5 });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ error: "draft_conflict", draft: null });

    const put = await orga.put(`/games/${gameId}/draft`, { content: exampleGame(), meta: {}, revision: 0 });
    expect(put.status).toBe(200);
    expect(put.body.revision).toBe(1);
    expect((await orga.get(`/games/${gameId}/draft`)).body).toMatchObject({ revision: 1, base_version: 1 });
    // Gleicher Inhalt wie Version 1: nicht geändert.
    expect((await orga.get(`/games/${gameId}`)).body).toMatchObject({ latest_version: 1, draft: { revision: 1, base_version: 1, changed: false } });
    const changed = await orga.put(`/games/${gameId}/draft`, { content: withTitle("Geändert"), meta: {}, revision: 1 });
    expect(changed.body.revision).toBe(2);
    expect((await orga.get(`/games/${gameId}`)).body.draft.changed).toBe(true);
  });

  it("verwirft den Entwurf nur bei einem Spiel mit Version", async () => {
    const orga = client(ctx);
    const created = await draftGame();
    const refused = await orga.del(`/games/${created.id}/draft`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("no_version");
    expect((await orga.get(`/games/${created.id}/draft`)).status).toBe(200);

    const gameId = await importGame();
    await orga.put(`/games/${gameId}/draft`, { content: withTitle("Verworfen"), meta: {}, revision: 0 });
    expect((await orga.del(`/games/${gameId}/draft`)).status).toBe(204);
    const gone = await orga.get(`/games/${gameId}/draft`);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("no_draft");
    expect((await orga.get(`/games/${gameId}`)).body.draft).toBeNull();
  });

  it("nimmt Entwürfe bis 5 MB an", async () => {
    const orga = client(ctx);
    const created = await draftGame();
    const padded = (bytes: number) => ({ ...incompleteGame(), notes: "x".repeat(bytes) });
    const ok = await orga.put(`/games/${created.id}/draft`, { content: padded(3 * 1024 * 1024), meta: {}, revision: 1 });
    expect(ok.status).toBe(200);
    const big = await orga.put(`/games/${created.id}/draft`, { content: padded(5 * 1024 * 1024), meta: {}, revision: 2 });
    expect(big.status).toBe(413);
    expect(big.body.error).toBe("too_large");
  });
});

describe("Veröffentlichen", () => {
  it("prüft den Entwurf und legt Versionen an", async () => {
    const orga = client(ctx);
    const created = await draftGame(incompleteGame("Noch unfertig"));
    const invalid = await orga.post(`/games/${created.id}/draft/publish`, { revision: 1 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_game");
    expect(invalid.body.errors.join()).toContain("safety");
    expect(Array.isArray(invalid.body.warnings)).toBe(true);
    expect((await orga.get(`/games/${created.id}`)).body.latest_version).toBeNull();

    const put = await orga.put(`/games/${created.id}/draft`, { content: withTitle("Fertig"), meta: {}, revision: 1 });
    expect(put.body.revision).toBe(2);
    const stale = await orga.post(`/games/${created.id}/draft/publish`, { revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("draft_conflict");
    expect(stale.body.draft.revision).toBe(2);

    const first = await orga.post(`/games/${created.id}/draft/publish`, { revision: 2, comment: "Erste Fassung" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ version: 1, draft: { revision: 2, base_version: 1, changed: false }, plannedEvents: [] });
    const detail = await orga.get(`/games/${created.id}`);
    expect(detail.body).toMatchObject({ title: "Fertig", latest_version: 1, draft: { base_version: 1, changed: false } });
    expect(detail.body.content.meta.title).toBe("Fertig");
    expect(detail.body.versions).toMatchObject([{ version: 1, comment: "Erste Fassung", created_by: "Admin" }]);
    // Der Entwurf bleibt und lässt sich weiter bearbeiten.
    expect((await orga.get(`/games/${created.id}/draft`)).body.revision).toBe(2);

    // Ein geplantes Event auf Version 1 taucht beim nächsten Veröffentlichen auf.
    const event = await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: created.id, name: "Geplant" });
    expect(event.status).toBe(201);
    expect(event.body.gameVersion).toBe(1);
    await orga.put(`/games/${created.id}/draft`, { content: withTitle("Zweite Fassung"), meta: {}, revision: 2 });
    const second = await orga.post(`/games/${created.id}/draft/publish`, { revision: 3 });
    expect(second.body).toMatchObject({ version: 2, draft: { base_version: 2, changed: false } });
    expect(second.body.plannedEvents).toEqual([{ id: event.body.id, name: "Geplant", gameVersion: 1, scheduledAt: null }]);
    expect((await orga.get(`/games/${created.id}`)).body.versions.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it("stellt geplante Events auf die neue Version um", async () => {
    const orga = client(ctx);
    const gameId = await importGame();
    const event = (await orga.post(`/orgs/${ctx.orgId}/events`, { gameId, name: "Umstellen" })).body;
    await orga.put(`/games/${gameId}/draft`, { content: withTitle("Version zwei"), meta: {}, revision: 0 });
    const published = await orga.post(`/games/${gameId}/draft/publish`, { revision: 1 });
    expect(published.body.version).toBe(2);
    expect(published.body.plannedEvents.map((e: any) => e.id)).toEqual([event.id]);

    expect((await orga.patch(`/events/${event.id}`, { version: 9 })).status).toBe(404);
    const moved = await orga.patch(`/events/${event.id}`, { version: 2, name: "Umgestellt" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ gameVersion: 2, name: "Umgestellt", join: { code: event.join.code }, supervisorPin: event.supervisorPin });
    expect((await orga.get(`/events/${event.id}/game`)).body.meta.title).toBe("Version zwei");
    const changes = async () => (await orga.get(`/events/${event.id}/log`)).body.filter((l: any) => l.kind === "event_version_changed");
    expect((await changes()).map((l: any) => l.data)).toEqual([{ from: 1, to: 2 }]);
    // Dieselbe Version noch einmal: kein weiterer Eintrag.
    await orga.patch(`/events/${event.id}`, { version: 2 });
    expect(await changes()).toHaveLength(1);

    expect((await orga.post(`/events/${event.id}/start`)).body.status).toBe("running");
    const started = await orga.patch(`/events/${event.id}`, { version: 1 });
    expect(started.status).toBe(409);
    expect(started.body.error).toBe("event_started");
    expect((await orga.get(`/events/${event.id}`)).body.gameVersion).toBe(2);
    // Andere Felder lassen sich weiterhin ändern.
    expect((await orga.patch(`/events/${event.id}`, { name: "Läuft" })).body.name).toBe("Läuft");
  });
});

describe("Probelauf", () => {
  it("startet ein Test-Event mit dem Entwurf und beendet den vorigen Probelauf", async () => {
    const orga = client(ctx);
    const gameId = await importGame(withTitle("Veröffentlicht"));
    await orga.put(`/games/${gameId}/draft`, { content: withTitle("Probe"), meta: {}, revision: 0 });
    const stale = await orga.post(`/games/${gameId}/test-events`, { revision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("draft_conflict");

    const first = await orga.post(`/games/${gameId}/test-events`, { revision: 1 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ test: true, status: "running", gameId, gameVersion: null, name: "Probelauf: Probe", retentionDays: 7 });
    expect(first.body.supervisorPin).toHaveLength(6);
    expect(first.body.startedAt).not.toBeNull();

    // Das Testhandy spielt sofort den Entwurf, nicht die veröffentlichte Version.
    const join = await client(ctx, "").post("/join", { code: first.body.join.code, team: { name: "Probierer", supervisorPin: first.body.supervisorPin } });
    expect(join.status).toBe(201);
    const team = client(ctx, join.body.token);
    const pkg = await team.get("/play/game");
    expect(pkg.status).toBe(200);
    expect(pkg.body.game.meta.title).toBe("Probe");
    const sync = await team.post("/play/sync", { actions: [{ id: "probe-1", type: "start", time: iso(), payload: {} }] });
    expect(sync.body.outcomes[0]).toMatchObject({ status: "ok" });

    // Die Liste zeigt den Probelauf als solchen.
    const list = await orga.get(`/orgs/${ctx.orgId}/events`);
    expect(list.body.find((e: any) => e.id === first.body.id)).toMatchObject({ test: true, status: "running" });
    expect(list.body.filter((e: any) => e.test)).toHaveLength(1);

    // Der nächste Probelauf beendet den laufenden.
    await orga.put(`/games/${gameId}/draft`, { content: withTitle("Probe zwei"), meta: {}, revision: 1 });
    const second = await orga.post(`/games/${gameId}/test-events`, { revision: 2 });
    expect(second.status).toBe(201);
    expect(second.body.name).toBe("Probelauf: Probe zwei");
    expect((await orga.get(`/events/${first.body.id}`)).body).toMatchObject({ status: "ended", test: true });
    expect((await orga.get(`/events/${second.body.id}`)).body.status).toBe("running");
    // Auf Probeläufe lässt sich keine Version umstellen.
    expect((await orga.patch(`/events/${second.body.id}`, { version: 1 })).body.error).toBe("event_started");
  });

  it("zeigt den Probestand nie als Version und wählt ihn nie für Events", async () => {
    const orga = client(ctx);
    const gameId = await importGame(withTitle("Veröffentlicht"));
    await orga.put(`/games/${gameId}/draft`, { content: withTitle("Nur Probe"), meta: {}, revision: 0 });
    expect((await orga.post(`/games/${gameId}/test-events`, { revision: 1 })).status).toBe(201);
    // Der Probestand liegt in game_versions, aber ohne Nummer; „order by version desc“ würde ihn ohne Filter zuerst liefern.
    const rows = await ctx.db.query("select kind, version from game_versions where game_id = $1 order by created_at", [gameId]);
    expect(rows).toEqual([
      { kind: "release", version: 1 },
      { kind: "test", version: null },
    ]);
    const detail = await orga.get(`/games/${gameId}`);
    expect(detail.body.latest_version).toBe(1);
    expect(detail.body.versions).toHaveLength(1);
    expect(detail.body.content.meta.title).toBe("Veröffentlicht");
    expect((await orga.get(`/orgs/${ctx.orgId}/games`)).body.find((g: any) => g.id === gameId).latest_version).toBe(1);
    expect((await orga.get(`/games/${gameId}/draft`)).body.base_version).toBe(1);
    expect((await orga.get(`/games/${gameId}/materials`)).body.items.length).toBeGreaterThan(0);

    const event = await orga.post(`/orgs/${ctx.orgId}/events`, { gameId, name: "Echt" });
    expect(event.status).toBe(201);
    expect(event.body).toMatchObject({ gameVersion: 1, test: false });
    expect((await orga.get(`/events/${event.body.id}/game`)).body.meta.title).toBe("Veröffentlicht");
    // Die nächste Version zählt vom Stand der Veröffentlichungen, nicht der Probestände.
    expect((await orga.post(`/games/${gameId}/draft/publish`, { revision: 1 })).body.version).toBe(2);

    // Ein Spiel nur mit Probestand gilt weiter als unveröffentlicht.
    const draftOnly = await draftGame(exampleGame());
    expect((await orga.post(`/games/${draftOnly.id}/test-events`, { revision: 1 })).status).toBe(201);
    expect((await orga.get(`/games/${draftOnly.id}`)).body).toMatchObject({ latest_version: null, content: null, versions: [] });
    expect((await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: draftOnly.id, name: "Zu früh" })).body.error).toBe("no_version");
    expect((await orga.del(`/games/${draftOnly.id}/draft`)).body.error).toBe("no_version");
    expect((await orga.get(`/games/${draftOnly.id}/materials`)).body.error).toBe("no_version");
  });

  it("prüft den Entwurf vor dem Probelauf", async () => {
    const created = await draftGame(incompleteGame());
    const res = await client(ctx).post(`/games/${created.id}/test-events`, { revision: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_game");
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(await ctx.db.one("select 1 from game_versions where game_id = $1", [created.id])).toBeUndefined();
  });

  it("löscht Probeläufe samt Probestand nach 7 Tagen", async () => {
    const orga = client(ctx);
    const created = await draftGame(exampleGame());
    const old = (await orga.post(`/games/${created.id}/test-events`, { revision: 1 })).body;
    expect((await client(ctx, "").post("/join", { code: old.join.code, team: { name: "Alt" } })).status).toBe(201);
    const fresh = (await orga.post(`/games/${created.id}/test-events`, { revision: 1 })).body;
    const real = (await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: await importGame(), name: "Bleibt" })).body;
    await ctx.db.query("update events set created_at = now() - interval '8 days' where id = any($1)", [[old.id, real.id]]);
    const testStands = async () => (await ctx.db.one<{ n: number }>("select count(*)::int as n from game_versions where kind = 'test' and game_id = $1", [created.id]))!.n;
    expect(await testStands()).toBe(2);

    const purged = await purgeExpired(ctx.db, ctx.app.deps.config.dataDir);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect((await orga.get(`/events/${old.id}`)).status).toBe(404);
    expect((await orga.get(`/events/${fresh.id}`)).status).toBe(200);
    // Ein echtes Event ist nur alt, nicht abgelaufen.
    expect((await orga.get(`/events/${real.id}`)).status).toBe(200);
    expect(await testStands()).toBe(1);
  });
});

describe("Materialliste", () => {
  it("liest die Materialliste aus dem Entwurf", async () => {
    const orga = client(ctx);
    const created = await draftGame(incompleteGame());
    const none = await orga.get(`/games/${created.id}/materials`);
    expect(none.status).toBe(409);
    expect(none.body.error).toBe("no_version");
    const draft = await orga.get(`/games/${created.id}/materials?source=draft`);
    expect(draft.status).toBe(200);
    expect(draft.body.items.map((i: any) => i.name)).toContain("Kiste mit Zahlenschloss");
    expect(draft.body.teamGear).toEqual([]);
    // Ein fast leerer Entwurf ergibt eine leere Liste statt eines Fehlers.
    await orga.put(`/games/${created.id}/draft`, { content: { format: { name: "lykora-game", version: "0.1" } }, meta: {}, revision: 1 });
    expect((await orga.get(`/games/${created.id}/materials?source=draft`)).body).toEqual({ items: [], teamGear: [] });

    const gameId = await importGame();
    const noDraft = await orga.get(`/games/${gameId}/materials?source=draft`);
    expect(noDraft.status).toBe(404);
    expect(noDraft.body.error).toBe("no_draft");
    expect((await orga.get(`/games/${gameId}/materials`)).body.teamGear.map((g: any) => g.name)).toEqual(["Lampe", "Warnweste"]);
  });
});

describe("Rechte", () => {
  it("Autoren bearbeiten und veröffentlichen, Spielleitung liest nur, Zuschauer gar nicht", async () => {
    const admin = client(ctx);
    const author = client(ctx, await member(ctx, "author", "autor@example.org"));
    const gamemaster = client(ctx, await member(ctx, "gamemaster", "leitung@example.org"));
    const viewer = client(ctx, await member(ctx, "viewer", "gast@example.org"));

    const created = await author.post(`/orgs/${ctx.orgId}/games/drafts`, { content: exampleGame() });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await author.get(`/games/${id}/draft`)).status).toBe(200);
    expect((await author.put(`/games/${id}/draft`, { content: withTitle("Autorin"), meta: {}, revision: 1 })).status).toBe(200);
    // Probeläufe gehören zum Spiel: Autoren dürfen sie anlegen, normale Events nicht.
    expect((await author.post(`/games/${id}/test-events`, { revision: 2 })).status).toBe(201);
    expect((await author.post(`/games/${id}/draft/publish`, { revision: 2 })).status).toBe(200);
    expect((await author.post(`/orgs/${ctx.orgId}/events`, { gameId: id, name: "Nicht erlaubt" })).status).toBe(403);

    expect((await gamemaster.get(`/games/${id}/draft`)).status).toBe(200);
    expect((await gamemaster.get(`/games/${id}/materials?source=draft`)).status).toBe(200);
    expect((await gamemaster.put(`/games/${id}/draft`, { content: withTitle("Leitung"), meta: {}, revision: 2 })).status).toBe(403);
    expect((await gamemaster.post(`/games/${id}/draft/publish`, { revision: 2 })).status).toBe(403);
    expect((await gamemaster.post(`/games/${id}/test-events`, { revision: 2 })).status).toBe(403);
    expect((await gamemaster.del(`/games/${id}/draft`)).status).toBe(403);
    expect((await gamemaster.post(`/orgs/${ctx.orgId}/games/drafts`, { content: exampleGame() })).status).toBe(403);

    expect((await viewer.get(`/games/${id}/draft`)).status).toBe(403);
    expect((await viewer.get(`/games/${id}/materials?source=draft`)).status).toBe(403);
    expect((await client(ctx, "").get(`/games/${id}/draft`)).status).toBe(401);

    // Der Konflikt nennt, wer zuletzt gespeichert hat.
    expect((await admin.put(`/games/${id}/draft`, { content: withTitle("Admin war hier"), meta: {}, revision: 2 })).body.revision).toBe(3);
    const stale = await author.put(`/games/${id}/draft`, { content: withTitle("Autorin nochmal"), meta: {}, revision: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.draft.updated_by.name).toBe("Admin");
  });
});

describe("OpenAPI", () => {
  it("beschreibt die Routen für Entwürfe und Probeläufe", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/lykora/api/docs/json" });
    const paths = res.json().paths;
    for (const p of [
      "/lykora/api/orgs/{orgId}/games/drafts",
      "/lykora/api/games/{gameId}/draft",
      "/lykora/api/games/{gameId}/draft/publish",
      "/lykora/api/games/{gameId}/test-events",
    ]) {
      expect(Object.keys(paths)).toContain(p);
    }
    expect(paths["/lykora/api/games/{gameId}/materials"].get.parameters.map((p: any) => p.name)).toContain("source");
    expect(Object.keys(paths["/lykora/api/events/{eventId}"].patch.requestBody.content["application/json"].schema.properties)).toContain("version");
  });
});
