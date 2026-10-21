import { describe, expect, it, vi } from "vitest";
import { Api, ApiError, latestUpload, mediaContentType, queryString } from "../src/lib/api.ts";
import type { ActionRow } from "../src/lib/types.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function client(respond: (call: Call) => Response | Promise<Response>, token: string | null = "geheim") {
  const f = fakeFetch(respond);
  const onUnauthorized = vi.fn();
  const api = new Api({ root: "/lykora/api", token: () => token, fetch: f.fn, onUnauthorized });
  return { api, calls: f.calls, onUnauthorized };
}

const headers = (c: Call) => c.init.headers as Record<string, string>;

describe("API-Client", () => {
  it("meldet sich an, ohne Token mitzuschicken", async () => {
    const { api, calls } = client(() => json({ token: "t", expiresAt: "x", user: { id: "u", email: "a@b", name: "A" } }), null);
    const r = await api.login("a@b", "pw");
    expect(r.token).toBe("t");
    expect(calls[0]!.url).toBe("/lykora/api/auth/login");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: "a@b", password: "pw" });
    expect(headers(calls[0]!).authorization).toBeUndefined();
    expect(headers(calls[0]!)["content-type"]).toBe("application/json");
  });

  it("schickt den Token als Bearer und ohne Body keinen Content-Type", async () => {
    const { api, calls } = client(() => new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
    expect(headers(calls[0]!).authorization).toBe("Bearer geheim");
    expect(headers(calls[0]!)["content-type"]).toBeUndefined();
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("schickt bei Statuswechseln immer ein JSON-Objekt, damit Fastify den Body annimmt", async () => {
    const { api, calls } = client(() => json({ id: "e", status: "running" }));
    await api.eventAction("e", "start");
    await api.eventAction("e", "recall", "Gewitter");
    expect(calls[0]!.url).toBe("/lykora/api/events/e/start");
    expect(calls[0]!.init.body).toBe("{}");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ reason: "Gewitter" });
  });

  it("hängt Suchparameter an und lässt leere weg", async () => {
    const { api, calls } = client(() => json([]));
    await api.log("e", 42, 100);
    await api.messages("e");
    expect(calls[0]!.url).toBe("/lykora/api/events/e/log?after=42&limit=100");
    expect(calls[1]!.url).toBe("/lykora/api/events/e/messages?after=0");
    expect(queryString({ a: "", b: null, c: undefined, d: 0 })).toBe("?d=0");
    expect(queryString(undefined)).toBe("");
  });

  it("übernimmt Code, Meldung und Details aus Fehlern des Servers", async () => {
    const { api } = client(() => json({ error: "invalid_game", message: "Spiel ist ungültig", errors: ["/id must be string"], warnings: [] }, 400));
    const err = await api.validate({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(400);
    expect(e.code).toBe("invalid_game");
    expect(e.message).toBe("Spiel ist ungültig");
    expect(e.details).toEqual({ errors: ["/id must be string"], warnings: [] });
  });

  it("nimmt eine deutsche Standardmeldung, wenn der Server keine schickt", async () => {
    const { api } = client(() => new Response("kaputt", { status: 403 }));
    await expect(api.me()).rejects.toMatchObject({ status: 403, message: "Keine Berechtigung" });
  });

  it("meldet abgelaufene Sitzungen, aber nicht bei falschem Passwort", async () => {
    const { api, onUnauthorized } = client(() => json({ error: "unauthorized", message: "Sitzung abgelaufen" }, 401));
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(api.login("a@b", "falsch")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("macht aus Netzfehlern eine verständliche Meldung", async () => {
    const { api } = client(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.overview("e")).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("lädt Exporte und Uploads als Blob", async () => {
    const { api, calls } = client(() => new Response("Platz;Team\n1;Füchse\n", { status: 200, headers: { "content-type": "text/csv" } }));
    const blob = await api.exportFile("e", "results.csv");
    expect(await blob.text()).toContain("Füchse");
    expect(calls[0]!.url).toBe("/lykora/api/events/e/export/results.csv");
    expect(headers(calls[0]!).authorization).toBe("Bearer geheim");
  });

  it("spielt Klänge mit Ziel, Lautstärke und Text ein", async () => {
    const { api, calls } = client(() => json({ id: 7, kind: "cue" }, 201));
    await api.sendCue("e", { teamId: null, audio: "lib:eule", volume: 0.8, text: "Hört ihr das?" });
    expect(calls[0]!.url).toBe("/lykora/api/events/e/cues");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ teamId: null, audio: "lib:eule", volume: 0.8, text: "Hört ihr das?" });
  });

  it("schickt Eingriffe mit Notiz nur, wenn es eine gibt", async () => {
    const { api, calls } = client(() => json({ state: {} }));
    await api.staffAction("e", "t", "staff_points", { amount: 50 }, "");
    await api.staffAction("e", "t", "staff_solve", { station: "baum" }, "vor Ort geprüft");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ type: "staff_points", payload: { amount: 50 } });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ type: "staff_solve", payload: { station: "baum" }, note: "vor Ort geprüft" });
  });
});

describe("Dateitypen", () => {
  it("leitet den Content-Type aus der Endung ab", () => {
    expect(mediaContentType({ name: "eule.OGG", type: "" })).toBe("audio/ogg");
    expect(mediaContentType({ name: "stimme.m4a", type: "audio/x-m4a" })).toBe("audio/mp4");
    expect(mediaContentType({ name: "tuer.wav", type: "audio/x-wav" })).toBe("audio/wav");
    expect(mediaContentType({ name: "karte.jpeg", type: "" })).toBe("image/jpeg");
    expect(mediaContentType({ name: "ohne", type: "audio/flac" })).toBe("audio/flac");
    expect(mediaContentType({ name: "x.zip", type: "" })).toBe("application/octet-stream");
  });
});

describe("Foto-Prüfung", () => {
  const action = (type: string, payload: Record<string, unknown>): ActionRow => ({ client_id: Math.random().toString(), source: "team", type, payload, client_time: "", received_at: "" });

  it("findet den neuesten Upload einer Station", () => {
    const actions = [
      action("answer", { station: "versteck", upload: "u1" }),
      action("answer", { station: "baum", text: "Eule" }),
      action("answer", { station: "versteck", upload: "u2" }),
      action("hint", { station: "versteck" }),
    ];
    expect(latestUpload(actions, "versteck")).toBe("u2");
    expect(latestUpload(actions, "baum")).toBeNull();
  });
});
