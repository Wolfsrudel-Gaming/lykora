import { describe, expect, it } from "vitest";
import { href, matchRoute } from "../src/lib/router.ts";

describe("Router", () => {
  it("erkennt alle Seiten", () => {
    expect(matchRoute("/")).toEqual({ name: "home", params: {} });
    expect(matchRoute("/anmelden")?.name).toBe("login");
    expect(matchRoute("/events")?.name).toBe("events");
    expect(matchRoute("/events/neu")?.name).toBe("eventNew");
    expect(matchRoute("/events/abc")).toEqual({ name: "event", params: { eventId: "abc" } });
    expect(matchRoute("/events/abc/leitstand")).toEqual({ name: "control", params: { eventId: "abc" } });
    expect(matchRoute("/events/abc/betreuer")?.name).toBe("supervisor");
    expect(matchRoute("/spiele/g1")).toEqual({ name: "game", params: { gameId: "g1" } });
    expect(matchRoute("/spiele/g1/medien")?.name).toBe("gameMedia");
    expect(matchRoute("/spiele/g1/klang")?.name).toBe("gameSound");
    expect(matchRoute("/spiele/g1/material")?.name).toBe("gameMaterials");
    expect(matchRoute("/mitglieder")?.name).toBe("members");
    expect(matchRoute("/konto")?.name).toBe("account");
    expect(matchRoute("/einstellungen")?.name).toBe("settings");
    expect(matchRoute("/organisation")?.name).toBe("orgs");
  });

  it("nimmt die Spieler-Landeseite unter /join/:code, auch mit Schrägstrich am Ende", () => {
    expect(matchRoute("/join/K7M2QX")).toEqual({ name: "join", params: { code: "K7M2QX" } });
    expect(matchRoute("/join/K7M2QX/")).toEqual({ name: "join", params: { code: "K7M2QX" } });
  });

  it("kennt unbekannte Pfade nicht", () => {
    expect(matchRoute("/gibtsnicht")).toBeNull();
    expect(matchRoute("/events/a/b/c")).toBeNull();
  });

  it("baut Pfade mit Parametern und Suchteil", () => {
    expect(href("control", { eventId: "e 1" })).toBe("/events/e%201/leitstand");
    expect(href("eventNew", {}, { spiel: "g1", leer: undefined })).toBe("/events/neu?spiel=g1");
    expect(href("login", {}, { weiter: "/events/1?tab=funk" })).toBe("/anmelden?weiter=%2Fevents%2F1%3Ftab%3Dfunk");
  });
});
