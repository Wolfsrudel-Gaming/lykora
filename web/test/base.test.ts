import { describe, expect, it } from "vitest";
import { apiUrl, appJoinLink, mediaUrl, pagePath, resolveBase, routeOf, serverUrl, wsUrl } from "../src/lib/base.ts";

describe("Basispfad", () => {
  it("liest den Basispfad aus <base href>", () => {
    const b = resolveBase("https://riegel-troisdorf.de/lykora/");
    expect(b).toEqual({ origin: "https://riegel-troisdorf.de", path: "/lykora/", api: "/lykora/api" });
  });

  it("nimmt die Wurzel bei leerem Basispfad und bei nicht ersetztem Platzhalter", () => {
    expect(resolveBase("http://localhost:3000/").path).toBe("/");
    expect(resolveBase("http://localhost:3000/").api).toBe("/api");
    expect(resolveBase("http://localhost:4173/__LYKORA_BASE__/").path).toBe("/");
  });

  it("schneidet einen Dateinamen ab, falls baseURI keine Basis hat", () => {
    expect(resolveBase("http://localhost/lykora/index.html").path).toBe("/lykora/");
  });

  it("baut Seitenpfade und liest sie zurück", () => {
    const b = resolveBase("http://x/lykora/");
    expect(pagePath(b, "/events/1/leitstand")).toBe("/lykora/events/1/leitstand");
    expect(pagePath(b, "/")).toBe("/lykora/");
    expect(routeOf(b, "/lykora/events/1")).toBe("/events/1");
    expect(routeOf(b, "/lykora")).toBe("/");
    expect(routeOf(b, "/lykora/")).toBe("/");
    expect(routeOf(b, "/anderswo")).toBeNull();
    expect(routeOf(resolveBase("http://x/"), "/spiele")).toBe("/spiele");
  });

  it("baut API-, WebSocket- und Medienadressen", () => {
    const b = resolveBase("https://riegel-troisdorf.de/lykora/");
    expect(apiUrl(b, "/events/1")).toBe("/lykora/api/events/1");
    expect(apiUrl(b, "me")).toBe("/lykora/api/me");
    expect(wsUrl(b, "/events/1/live", "a b")).toBe("wss://riegel-troisdorf.de/lykora/api/events/1/live?access_token=a%20b");
    expect(wsUrl(resolveBase("http://localhost:3000/"), "/x?y=1", "t")).toBe("ws://localhost:3000/api/x?y=1&access_token=t");
    expect(mediaUrl(b, "media/lib/wind.ogg")).toBe("/lykora/media/lib/wind.ogg");
    expect(mediaUrl(b, "https://example.org/a.mp3")).toBe("https://example.org/a.mp3");
  });

  it("baut den Einstiegslink wie der Server (routes/events.ts joinInfo)", () => {
    const b = resolveBase("https://riegel-troisdorf.de/lykora/");
    expect(serverUrl(b)).toBe("https://riegel-troisdorf.de/lykora");
    expect(serverUrl(resolveBase("http://localhost:3000/"))).toBe("http://localhost:3000");
    expect(appJoinLink(serverUrl(b), "K7M2QX")).toBe("lykora://join?server=https%3A%2F%2Friegel-troisdorf.de%2Flykora&code=K7M2QX");
  });
});
