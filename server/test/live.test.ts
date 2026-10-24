import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { redactTokens } from "../src/app.ts";
import { badRequest, notFound, unauthorized } from "../src/lib/errors.ts";
import { LiveHub, PING_INTERVAL_MS, closeWithError } from "../src/lib/live.ts";
import { client, createEvent, joinTeam, setup, type TestContext } from "./helpers.ts";

/** Ersatz für eine WebSocket-Verbindung, der mitschreibt, was gesendet wird. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: any[] = [];
  pings = 0;
  closedWith?: { code?: number; reason?: string };
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  ping() {
    this.pings++;
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit("close");
  }
}
const fake = () => new FakeSocket() as FakeSocket & WebSocket;

describe("LiveHub", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stupst nur das gemeinte Team oder alle Teams eines Events an", () => {
    const hub = new LiveHub();
    const [a1, a2, b, other, dashboard] = [fake(), fake(), fake(), fake(), fake()];
    hub.subscribeTeam("e1", "a", a1);
    hub.subscribeTeam("e1", "a", a2);
    hub.subscribeTeam("e1", "b", b);
    hub.subscribeTeam("e2", "x", other);
    hub.subscribe("e1", dashboard, true);

    hub.poke("e1", "a", "message");
    expect(a1.sent).toEqual([{ type: "poke", reason: "message" }]);
    expect(a2.sent).toEqual([{ type: "poke", reason: "message" }]);
    expect(b.sent).toEqual([]);

    hub.poke("e1", null, "status");
    expect(a1.sent.at(-1)).toEqual({ type: "poke", reason: "status" });
    expect(b.sent).toEqual([{ type: "poke", reason: "status" }]);
    expect(other.sent).toEqual([]);
    expect(dashboard.sent).toEqual([]);

    // Unbekannte Teams und Events sind kein Fehler.
    hub.poke("e1", "gibtsnicht", "cue");
    hub.poke("e9", null, "cue");
    expect(hub.teamCount("e1")).toBe(3);
    expect(hub.teamCount("e1", "a")).toBe(2);
  });

  it("räumt geschlossene Verbindungen auf und nimmt bereits geschlossene gar nicht erst auf", () => {
    const hub = new LiveHub();
    const [a, b] = [fake(), fake()];
    hub.subscribeTeam("e1", "a", a);
    hub.subscribeTeam("e1", "b", b);
    a.close();
    expect(hub.teamCount("e1", "a")).toBe(0);
    hub.poke("e1", null, "status");
    expect(a.sent).toEqual([]);
    b.close();
    expect(hub.teamCount("e1")).toBe(0);

    const closed = fake();
    closed.readyState = 3;
    hub.subscribeTeam("e1", "a", closed);
    hub.subscribe("e1", closed, false);
    expect(hub.teamCount("e1")).toBe(0);
    expect(hub.count("e1")).toBe(0);
  });

  it("schickt Teams alle 25 s ein ping und hält Dashboards mit Ping-Frames wach", () => {
    vi.useFakeTimers();
    const hub = new LiveHub();
    const [team, dashboard] = [fake(), fake()];
    hub.subscribeTeam("e1", "a", team);
    hub.subscribe("e1", dashboard, false);
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(team.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(PING_INTERVAL_MS).toBe(25_000);
    expect(team.sent).toEqual([{ type: "ping" }]);
    expect(dashboard.pings).toBe(1);
    expect(dashboard.sent).toEqual([]);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(team.sent).toHaveLength(2);

    team.close();
    dashboard.close();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(team.sent).toHaveLength(2);
    expect(dashboard.pings).toBe(2);
  });

  it("schließt nach gescheiterter Anmeldung mit 4000 + Status, ohne interne Fehler zu verraten", () => {
    const logged: unknown[] = [];
    const log = { error: (obj: unknown) => logged.push(obj) };
    const close = (err: unknown) => {
      const socket = fake();
      closeWithError(socket, err, log);
      return socket.closedWith;
    };
    expect(close(unauthorized("Gerät ist keinem Team zugeordnet"))).toEqual({ code: 4401, reason: "Gerät ist keinem Team zugeordnet" });
    expect(close(notFound("Event"))).toEqual({ code: 4404, reason: "Event nicht gefunden" });
    expect(logged).toEqual([]);

    const internal = new Error('password authentication failed for user "lykora"');
    expect(close(internal)).toEqual({ code: 4500, reason: "Interner Fehler" });
    expect(logged).toEqual([internal]);

    // Längere Gründe lässt das Protokoll nicht zu; ws würde sonst werfen.
    const long = close(badRequest("x", "Überlänge ".repeat(30)));
    expect(long!.code).toBe(4400);
    expect(Buffer.byteLength(long!.reason!)).toBeLessThanOrEqual(123);
    expect(long!.reason!.startsWith("Überlänge Überlänge")).toBe(true);
  });
});

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx?.close();
});

/** Verbindet ein Handy mit /play/live und sammelt alle Nachrichten. */
async function connectTeam(token: string) {
  const received: any[] = [];
  const waiters: { match: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  const ws = await ctx.app.injectWS(`${ctx.api}/play/live?access_token=${encodeURIComponent(token)}`, {}, {
    onInit: (socket) =>
      socket.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        for (const w of [...waiters]) {
          if (w.match(msg)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(msg);
          }
        }
      }),
  });
  /** Wartet auf die nächste passende Nachricht, auch wenn sie schon da ist. */
  const next = (match: (m: any) => boolean, seen = received.length) =>
    new Promise<any>((resolve, reject) => {
      const already = received.slice(seen).find(match);
      if (already) return resolve(already);
      const timer = setTimeout(() => reject(new Error(`Keine passende Nachricht, bisher: ${JSON.stringify(received)}`)), 3000);
      waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  return { ws, received, next };
}

const poke = (reason: string) => (m: any) => m.type === "poke" && m.reason === reason;

describe("Anstupsen der App", () => {
  it("stupst das Team bei allem an, was es gleich wissen soll", async () => {
    const orga = client(ctx);
    const { event } = await createEvent(ctx);
    const a = await joinTeam(ctx, event.join.code, "Füchse", event.supervisorPin);
    const b = await joinTeam(ctx, event.join.code, "Eulen", event.supervisorPin);
    const appA = await connectTeam(a.token);
    const appB = await connectTeam(b.token);
    await appA.next((m) => m.type === "hello");
    await appB.next((m) => m.type === "hello");
    expect(ctx.app.deps.live.teamCount(event.id)).toBe(2);

    // Statuswechsel erreicht alle Teams
    let seenA = appA.received.length;
    let seenB = appB.received.length;
    await orga.post(`/events/${event.id}/start`);
    await appA.next(poke("status"), seenA);
    await appB.next(poke("status"), seenB);

    seenA = appA.received.length;
    await orga.post(`/events/${event.id}/messages`, { teamId: a.team.id, body: "Nur für euch" });
    await appA.next(poke("message"), seenA);

    seenA = appA.received.length;
    seenB = appB.received.length;
    await orga.post(`/events/${event.id}/messages`, { body: "An alle" });
    await appA.next(poke("message"), seenA);
    await appB.next(poke("message"), seenB);

    seenA = appA.received.length;
    expect((await orga.post(`/events/${event.id}/cues`, { teamId: a.team.id, audio: "eule" })).status).toBe(201);
    await appA.next(poke("cue"), seenA);

    seenA = appA.received.length;
    await orga.post(`/events/${event.id}/teams/${a.team.id}/actions`, { type: "staff_points", payload: { amount: 5 } });
    await appA.next(poke("action"), seenA);

    await client(ctx, a.token).post("/play/sos", { id: "sos-live", time: new Date().toISOString() });
    const sos = await orga.get(`/events/${event.id}/sos`);
    seenA = appA.received.length;
    await orga.post(`/events/${event.id}/sos/${sos.body[0].id}/ack`);
    await appA.next(poke("sos"), seenA);
    seenA = appA.received.length;
    await orga.post(`/events/${event.id}/sos/${sos.body[0].id}/resolve`);
    await appA.next(poke("sos"), seenA);

    seenA = appA.received.length;
    await orga.patch(`/events/${event.id}/teams/${a.team.id}`, { color: "#ff8800" });
    await appA.next(poke("team"), seenA);

    // SOS per SMS: ein anderes Handy des Teams mit Netz sieht gleich, dass die SMS angekommen ist.
    seenA = appA.received.length;
    const sms = await ctx.app.inject({
      method: "POST",
      url: `${ctx.api}/integrations/sms`,
      headers: { "x-lykora-secret": "sms-secret" },
      payload: { text: `LYKORA SOS ${event.join.code} ${a.team.deviceCode} Hilfe` },
    });
    expect(sms.statusCode).toBe(201);
    await appA.next(poke("sos"), seenA);

    // Eine letzte Nachricht an alle zeigt, dass B bis hierhin nichts für A bekommen hat.
    seenB = appB.received.length;
    await orga.post(`/events/${event.id}/pause`);
    await appB.next(poke("status"), seenB);
    expect(appA.received.map((m) => m.reason ?? m.type)).toEqual(["hello", "status", "message", "message", "cue", "action", "sos", "sos", "team", "sos", "status"]);
    expect(appB.received.map((m) => m.reason ?? m.type)).toEqual(["hello", "status", "message", "status"]);

    appA.ws.terminate();
    appB.ws.terminate();
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.app.deps.live.teamCount(event.id)).toBe(0);
  });

  it("schließt die Verbindung bei ungültigem Token mit 4401", async () => {
    for (const url of [`${ctx.api}/play/live?access_token=kaputt`, `${ctx.api}/play/live`, `${ctx.api}/play/live?access_token=${ctx.token}`]) {
      let closed!: (code: number) => void;
      const code = new Promise<number>((resolve) => (closed = resolve));
      await ctx.app.injectWS(url, {}, { onInit: (socket) => socket.on("close", (c: number) => closed(c)) });
      expect(await code, url).toBe(4401);
    }
  });

  it("trennt Verbindungen, die große Nachrichten schicken", async () => {
    const { event } = await createEvent(ctx);
    const a = await joinTeam(ctx, event.join.code, "Dachse", event.supervisorPin);
    const app = await connectTeam(a.token);
    await app.next((m) => m.type === "hello");
    const code = new Promise<number>((resolve) => app.ws.on("close", resolve));
    app.ws.send("x".repeat(64 * 1024));
    // 1009: Nachricht zu groß
    expect(await code).toBe(1009);
  });
});

describe("Log", () => {
  it("schreibt Tokens aus WebSocket-Adressen nicht mit", () => {
    expect(redactTokens("/lykora/api/play/live?access_token=abc.def-123")).toBe("/lykora/api/play/live?access_token=***");
    expect(redactTokens("/lykora/api/events/1/live?x=1&access_token=geheim&y=2")).toBe("/lykora/api/events/1/live?x=1&access_token=***&y=2");
    expect(redactTokens("/lykora/api/health")).toBe("/lykora/api/health");
  });
});

describe("SOS-Stand im Abgleich", () => {
  it("zeigt dem Team, ob die Spielleitung den Alarm gesehen hat", async () => {
    const orga = client(ctx);
    const { event } = await createEvent(ctx);
    const a = await joinTeam(ctx, event.join.code, "Wölfe", event.supervisorPin);
    const team = client(ctx, a.token);
    await orga.post(`/events/${event.id}/start`);

    expect((await team.post("/play/sync", {})).body.sos).toEqual([]);
    await team.post("/play/sos", { id: "sos-1", time: new Date(Date.now() - 60_000).toISOString(), message: "Knöchel" });
    const open = await team.post("/play/sync", {});
    expect(open.body.sos).toEqual([{ id: expect.any(String), clientId: "sos-1", channel: "app", acknowledgedAt: null, resolvedAt: null, acknowledgedBy: null }]);

    await orga.post(`/events/${event.id}/sos/${open.body.sos[0].id}/ack`);
    const acked = await team.post("/play/sync", {});
    expect(acked.body.sos[0]).toMatchObject({ clientId: "sos-1", acknowledgedBy: "Admin", resolvedAt: null });
    expect(Date.parse(acked.body.sos[0].acknowledgedAt)).not.toBeNaN();

    await orga.post(`/events/${event.id}/sos/${open.body.sos[0].id}/resolve`);
    const resolved = await team.post("/play/sync", {});
    expect(Date.parse(resolved.body.sos[0].resolvedAt)).not.toBeNaN();

    // SOS per SMS gehört genauso dazu; die neueste Meldung steht vorn.
    await ctx.app.inject({
      method: "POST",
      url: `${ctx.api}/integrations/sms`,
      headers: { "x-lykora-secret": "sms-secret" },
      payload: { text: `LYKORA SOS ${event.join.code} ${a.team.deviceCode} Hilfe` },
    });
    const both = await team.post("/play/sync", {});
    expect(both.body.sos.map((s: any) => [s.channel, s.clientId])).toEqual([
      ["sms", null],
      ["app", "sos-1"],
    ]);

    // Höchstens die 20 neuesten; SOS anderer Teams tauchen nicht auf.
    for (let i = 0; i < 25; i++) {
      await team.post("/play/sos", { id: `viele-${i}`, time: new Date(Date.now() - (30 - i) * 1000).toISOString() });
    }
    const b = await joinTeam(ctx, event.join.code, "Luchse", event.supervisorPin);
    await client(ctx, b.token).post("/play/sos", { id: "sos-b", time: new Date().toISOString() });
    const many = await team.post("/play/sync", {});
    expect(many.body.sos).toHaveLength(20);
    expect(many.body.sos[0].channel).toBe("sms");
    expect(many.body.sos.map((s: any) => s.clientId)).not.toContain("sos-b");
  });
});
