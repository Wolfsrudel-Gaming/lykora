import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, exampleGame, setup, type TestContext } from "./helpers.ts";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx?.close();
});

let n = 0;
const iso = (offsetSec = 0) => new Date(Date.now() + offsetSec * 1000).toISOString();
const action = (type: string, payload: Record<string, unknown> = {}, offsetSec = 0) => ({ id: `act-${++n}`, type, time: iso(offsetSec), payload });

async function createEvent(game = exampleGame()) {
  const orga = client(ctx);
  const g = await orga.post(`/orgs/${ctx.orgId}/games`, { content: game, comment: "erste Fassung" });
  expect(g.status).toBe(201);
  const e = await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: g.body.id, name: "Testlauf" });
  expect(e.status).toBe(201);
  return { gameId: g.body.id as string, event: e.body };
}

async function joinTeam(code: string, name: string, supervisorPin?: string) {
  const res = await client(ctx, "").post("/join", { code, team: { name, members: ["Anna", "Ben"], emergencyPhone: "+49 170 1234567", supervisorPin } });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, team: res.body.team };
}

describe("Anmeldung und Rechte", () => {
  it("lehnt falsche Passwörter und fehlende Tokens ab", async () => {
    expect((await client(ctx, "").post("/auth/login", { email: "admin@example.org", password: "falsch-falsch" })).status).toBe(401);
    expect((await client(ctx, "").get("/me")).status).toBe(401);
    expect((await client(ctx, "kaputt").get("/me")).status).toBe(401);
  });

  it("liefert den Gesundheitsstatus unter dem Basispfad", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/lykora/api/health" });
    expect(res.json()).toMatchObject({ status: "ok" });
    expect((await ctx.app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(404);
  });

  it("veröffentlicht die OpenAPI-Doku", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/lykora/api/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain("/lykora/api/play/sync");
  });

  it("beschränkt Rollen: Autoren dürfen keine Events anlegen", async () => {
    const admin = client(ctx);
    const add = await admin.post(`/orgs/${ctx.orgId}/members`, { email: "autorin@example.org", name: "Autorin", password: "autorin-passwort", role: "author" });
    expect(add.status).toBe(201);
    const login = await client(ctx, "").post("/auth/login", { email: "autorin@example.org", password: "autorin-passwort" });
    const author = client(ctx, login.body.token);
    const g = await author.post(`/orgs/${ctx.orgId}/games`, { content: exampleGame() });
    expect(g.status).toBe(201);
    const e = await author.post(`/orgs/${ctx.orgId}/events`, { gameId: g.body.id, name: "Nicht erlaubt" });
    expect(e.status).toBe(403);
  });
});

describe("Spiele", () => {
  it("lehnt ungültige Spiele mit Fehlerliste ab", async () => {
    const game = exampleGame();
    game.stations[1]!.rewards = { fragments: ["gibtsnicht"] };
    const res = await client(ctx).post(`/orgs/${ctx.orgId}/games`, { content: game });
    expect(res.status).toBe(400);
    expect(res.body.errors.join()).toContain("gibtsnicht");
  });

  it("legt Versionen an und erstellt die Materialliste", async () => {
    const orga = client(ctx);
    const { gameId } = await createEvent();
    const game = exampleGame();
    game.meta.title = "Neuer Titel";
    const put = await orga.put(`/games/${gameId}`, { content: game, comment: "Titel geändert" });
    expect(put.body.version).toBe(2);
    const got = await orga.get(`/games/${gameId}`);
    expect(got.body.title).toBe("Neuer Titel");
    expect(got.body.versions.map((v: any) => v.version)).toEqual([2, 1]);
    const materials = await orga.get(`/games/${gameId}/materials`);
    expect(materials.body.items.map((i: any) => i.name)).toContain("Kiste mit Zahlenschloss");
    expect(materials.body.teamGear.map((g: any) => g.name)).toEqual(["Lampe", "Warnweste"]);
  });
});

describe("Ein Event von Anfang bis Ende", () => {
  it("spielt, synchronisiert offline Aktionen und wertet aus", async () => {
    const orga = client(ctx);
    const { event } = await createEvent();
    expect(event.join.qr).toContain("server=https%3A%2F%2Fexample.org%2Flykora");

    const a = await joinTeam(event.join.code, "Füchse", event.supervisorPin);
    const b = await joinTeam(event.join.code, "Eulen");
    expect((await client(ctx, "").post("/join", { code: event.join.code, team: { name: "Füchse" } })).status).toBe(409);

    // Zweites Handy für Team A
    const second = await client(ctx, "").post("/join", { code: event.join.code, deviceCode: a.team.deviceCode });
    expect(second.body.team.id).toBe(a.team.id);

    const teamA = client(ctx, a.token);
    const pkg = await teamA.get("/play/game");
    expect(pkg.body.game.stations).toHaveLength(5);
    expect(pkg.body.supervisorRequired).toBe(true);

    // Vor dem Start zählt nichts.
    const early = await teamA.post("/play/sync", { actions: [action("trigger", { station: "briefing", method: "qr" })] });
    expect(early.body.outcomes[0]).toMatchObject({ status: "rejected", reason: "not_started" });

    expect((await orga.post(`/events/${event.id}/start`)).body.status).toBe("running");

    const run = [
      action("start", {}, 1),
      action("trigger", { station: "briefing", method: "qr" }, 2),
      action("answer", { station: "briefing", choice: [0] }, 3),
      action("trigger", { station: "baum", method: "gps", location: { lat: 50.816, lon: 7.1565 } }, 4),
      action("answer", { station: "baum", text: "Uhu" }, 5),
      action("trigger", { station: "schloss", method: "gps" }, 6),
      action("answer", { station: "schloss", text: "111" }, 7),
      action("answer", { station: "schloss", text: "372" }, 8),
      action("heartbeat", {}, 9),
    ];
    // Handy geht 10 Minuten nach; der Server gleicht das über deviceTime aus.
    const skew = -600;
    const shifted = run.map((x) => ({ ...x, time: new Date(Date.parse(x.time) + skew * 1000).toISOString() }));
    const sync = await teamA.post("/play/sync", {
      deviceTime: iso(skew),
      actions: shifted,
      positions: [{ lat: 50.8155, lon: 7.155, accuracy: 8, time: iso(skew + 1) }],
      battery: 0.8,
    });
    expect(sync.status).toBe(200);
    expect(sync.body.outcomes.every((o: any) => o.status === "ok")).toBe(true);
    expect(sync.body.state.solved).toEqual(["briefing", "baum", "schloss"]);
    expect(sync.body.state.revealed).toContain("versteck");
    expect(sync.body.state.timePenalty).toBe(30);
    expect(sync.body.messages.map((m: any) => m.body)).toContain("Neue Spur! Auf eurer Karte ist ein Versteck aufgetaucht.");
    expect(sync.body.leaderboard[0]).toMatchObject({ name: "Füchse", own: true });

    // Gleiche Aktionen noch einmal: werden nicht doppelt gezählt, Nachricht kommt nicht doppelt.
    const again = await teamA.post("/play/sync", { actions: shifted, messagesAfter: sync.body.messages.at(-1).id });
    expect(again.body.accepted).toBe(0);
    expect(again.body.state.points).toBe(sync.body.state.points);
    expect(again.body.messages).toEqual([]);

    // Team B ohne Betreuer darf nicht starten.
    const teamB = client(ctx, b.token);
    const blocked = await teamB.post("/play/sync", { actions: [action("start")] });
    expect(blocked.body.outcomes[0]).toMatchObject({ status: "rejected", reason: "supervisor_required" });
    const blocked2 = await teamB.post("/play/sync", { actions: [action("trigger", { station: "briefing", method: "qr" })] });
    expect(blocked2.body.outcomes[0]).toMatchObject({ status: "rejected", reason: "supervisor_required" });
    // Betreuer kommt dazu: die gespeicherte Aktion zählt jetzt.
    await orga.patch(`/events/${event.id}/teams/${b.team.id}`, { supervisorPresent: true });
    const unblocked = await teamB.post("/play/sync", {});
    expect(unblocked.body.state.triggered).toEqual(["briefing"]);

    // Foto-Aufgabe: Upload, dann Antwort
    const upload = await ctx.app.inject({
      method: "POST",
      url: `${ctx.api}/play/uploads`,
      headers: { authorization: `Bearer ${a.token}`, "content-type": "image/jpeg" },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(upload.statusCode).toBe(201);
    const uploadId = upload.json().id;
    const photo = await teamA.post("/play/sync", {
      actions: [action("trigger", { station: "versteck", method: "gps" }, 20), action("answer", { station: "versteck", upload: uploadId }, 21)],
    });
    expect(photo.body.state.fragments.sort()).toEqual(["f1", "f2", "f3"]);
    const file = await ctx.app.inject({ method: "GET", url: `${ctx.api}/events/${event.id}/uploads/${uploadId}`, headers: { authorization: `Bearer ${ctx.token}` } });
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.rawPayload.length).toBe(4);

    // Hinweis über die Spielleitung und Eingriff
    const msg = await orga.post(`/events/${event.id}/messages`, { teamId: b.team.id, body: "Schaut beim Schild nach.", kind: "hint" });
    expect(msg.status).toBe(201);
    const bMessages = await teamB.post("/play/sync", {});
    expect(bMessages.body.messages.map((m: any) => m.body)).toContain("Schaut beim Schild nach.");
    const points = await orga.post(`/events/${event.id}/teams/${b.team.id}/actions`, { type: "staff_points", payload: { amount: 25 }, note: "Fairplay" });
    expect(points.body.state.points).toBe(25);

    // Finale
    const finale = await teamA.post("/play/sync", {
      actions: [action("trigger", { station: "finale", method: "qr" }, 30), action("answer", { station: "finale", text: "191" }, 31)],
    });
    expect(finale.body.state.finishedAt).not.toBeNull();

    const overview = await orga.get(`/events/${event.id}/overview`);
    const fuchs = overview.body.teams.find((t: any) => t.name === "Füchse");
    expect(fuchs.progress).toMatchObject({ solved: 5, fragments: 3, rank: 1 });
    expect(fuchs.position).toMatchObject({ lat: 50.8155, lon: 7.155 });
    expect(fuchs.battery).toBeCloseTo(0.8);

    const standings = await orga.get(`/events/${event.id}/standings`);
    expect(standings.body.map((r: any) => r.name)).toEqual(["Füchse", "Eulen"]);

    const results = await ctx.app.inject({ method: "GET", url: `${ctx.api}/events/${event.id}/export/results.csv`, headers: { authorization: `Bearer ${ctx.token}` } });
    expect(results.body).toContain("1;Füchse;");
    const log = await orga.get(`/events/${event.id}/log`);
    const kinds = log.body.map((l: any) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(["event_created", "team_joined", "event_start", "team_answer", "staff_points", "message_sent"]));

    expect((await orga.post(`/events/${event.id}/end`)).body.status).toBe("ended");
    const late = await teamB.post("/play/sync", { actions: [action("answer", { station: "briefing", choice: [0] }, 60)] });
    expect(late.body.outcomes[0]).toMatchObject({ status: "rejected", reason: "ended" });
    expect(late.body.leaderboard).toHaveLength(2);
  });
});

describe("Sicherheit", () => {
  it("nimmt SOS an, auch nachgeholt und per SMS, und meldet es live", async () => {
    const orga = client(ctx);
    const { event } = await createEvent();
    const a = await joinTeam(event.join.code, "Wölfe", event.supervisorPin);
    await orga.post(`/events/${event.id}/start`);

    const sos = await client(ctx, a.token).post("/play/sos", { id: "sos-1", time: iso(-30), lat: 50.81, lon: 7.15, message: "Knöchel", deferred: true });
    expect(sos.status).toBe(201);
    expect(sos.body.emergency.gameMasterPhone).toBe("+49 170 0000000");
    // Doppelt gesendet: kein zweiter Alarm
    expect((await client(ctx, a.token).post("/play/sos", { id: "sos-1", time: iso(-30) })).status).toBe(200);

    const forbidden = await ctx.app.inject({ method: "POST", url: `${ctx.api}/integrations/sms`, payload: { text: "x" }, headers: { "x-lykora-secret": "falsch" } });
    expect(forbidden.statusCode).toBe(403);
    const sms = await ctx.app.inject({
      method: "POST",
      url: `${ctx.api}/integrations/sms`,
      headers: { "x-lykora-secret": "sms-secret" },
      payload: { from: "+491701234567", text: `LYKORA SOS ${event.join.code} ${a.team.deviceCode} 50.8150,7.1540 Hilfe` },
    });
    expect(sms.statusCode).toBe(201);

    const list = await orga.get(`/events/${event.id}/sos`);
    expect(list.body.map((s: any) => s.channel).sort()).toEqual(["deferred", "sms"]);
    const overview = await orga.get(`/events/${event.id}/overview`);
    expect(overview.body.warnings.map((w: any) => w.kind)).toContain("sos");

    const ack = await orga.post(`/events/${event.id}/sos/${list.body[0].id}/resolve`);
    expect(ack.body.resolved_at).not.toBeNull();
  });

  it("ruft alle zurück und pausiert das Spiel", async () => {
    const orga = client(ctx);
    const { event } = await createEvent();
    const a = await joinTeam(event.join.code, "Luchse", event.supervisorPin);
    await orga.post(`/events/${event.id}/start`);
    const recall = await orga.post(`/events/${event.id}/recall`, { reason: "Gewitter" });
    expect(recall.body.status).toBe("recalled");
    const sync = await client(ctx, a.token).post("/play/sync", { actions: [action("trigger", { station: "briefing", method: "qr" }, 1)] });
    expect(sync.body.recall.assemblyPoint.id).toBe("sammelpunkt");
    expect(sync.body.outcomes[0]).toMatchObject({ status: "rejected", reason: "paused" });
    expect(sync.body.messages.at(-1).body).toBe("Alle zurück zum Sammelpunkt! Gewitter");
    const arrived = await client(ctx, a.token).post("/play/sync", { actions: [action("arrived", {}, 2)] });
    expect(arrived.status).toBe(200);
    const detail = await orga.get(`/events/${event.id}/teams/${a.team.id}`);
    expect(detail.body.arrivedAt).not.toBeNull();
  });

  it("warnt bei Annäherung an eine Sperrzone", async () => {
    const orga = client(ctx);
    const { event } = await createEvent();
    const a = await joinTeam(event.join.code, "Dachse", event.supervisorPin);
    await orga.post(`/events/${event.id}/start`);
    await client(ctx, a.token).post("/play/sync", { actions: [action("start", {}, 1)], positions: [{ lat: 50.8166, lon: 7.155, time: iso(1) }] });
    const overview = await orga.get(`/events/${event.id}/overview`);
    expect(overview.body.warnings.map((w: any) => w.kind)).toContain("near_restricted_zone");
  });
});

describe("Live-Verbindung", () => {
  it("schickt Ereignisse an das Dashboard", async () => {
    const { event } = await createEvent();
    const ws = await ctx.app.injectWS(`${ctx.api}/events/${event.id}/live?access_token=${ctx.token}`);
    const received: any[] = [];
    const hello = new Promise<void>((resolve) =>
      ws.on("message", (data: Buffer) => {
        received.push(JSON.parse(data.toString()));
        if (received.some((m) => m.type === "team_joined")) resolve();
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    await joinTeam(event.join.code, "Biber");
    await hello;
    ws.terminate();
    expect(received.map((m) => m.type)).toEqual(expect.arrayContaining(["hello", "team_joined", "log"]));
  });
});

describe("NFC-Armbänder", () => {
  it("registriert Betreuer-Armbänder, bestätigt damit Stationen und prüft Vollzähligkeit", async () => {
    const { tagHash } = await import("../src/lib/crypto.ts");
    const orga = client(ctx);
    const game = exampleGame();
    game.safety.headcount = { enabled: true };
    const { event } = await createEvent(game);

    const reg = await orga.post(`/events/${event.id}/tags`, { uid: "04:A1:B2:C3:D4:E5:F6", role: "supervisor", label: "Jens" });
    expect(reg.status).toBe(201);
    const supervisorHash = tagHash(event.id, "04a1b2c3d4e5f6");
    expect(reg.body.tag_hash).toBe(supervisorHash);

    // Beitritt mit Betreuer-Armband statt PIN
    const join = await client(ctx, "").post("/join", { code: event.join.code, team: { name: "Igel", supervisorTag: supervisorHash } });
    expect(join.body.team.supervisorPresent).toBe(true);
    const team = client(ctx, join.body.token);

    const pkg = await team.get("/play/game");
    expect(pkg.body.staffTags).toEqual([{ hash: supervisorHash, role: "supervisor" }]);

    const m1 = tagHash(event.id, "01"), m2 = tagHash(event.id, "02");
    const put = await team.put("/play/team", { members: [{ name: "Anna", tag: m1 }, { name: "Ben", tag: m2 }, "Cem"] });
    expect(put.body.wristbands).toBe(2);
    expect((await team.put("/play/team", { members: [{ name: "A", tag: m1 }, { name: "B", tag: m1 }] })).status).toBe(400);

    await orga.post(`/events/${event.id}/start`);
    const sync = await team.post("/play/sync", {
      actions: [
        action("tag_solve", { station: "baum", tag: supervisorHash }, 1),
        action("headcount", { tags: [m1], reason: "start" }, 2),
      ],
    });
    expect(sync.body.outcomes.map((o: any) => o.status)).toEqual(["ok", "ok"]);
    expect(sync.body.state.solved).toEqual(["baum"]);

    const overview = await orga.get(`/events/${event.id}/overview`);
    const igel = overview.body.teams[0];
    expect(igel.lastHeadcount).toMatchObject({ present: 1, total: 2, complete: false });
    expect(igel.warnings.map((w: any) => w.kind)).toContain("headcount_incomplete");
    expect(igel.members).toEqual(["Anna", "Ben", "Cem"]);

    await team.post("/play/sync", { actions: [action("headcount", { tags: [m1, m2] }, 3)] });
    const after = await orga.get(`/events/${event.id}/overview`);
    expect(after.body.teams[0].lastHeadcount.complete).toBe(true);
  });
});
