import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeUsages, removeWithReferences, renameId, renumberFragments, usagesOf } from "../src/lib/editor/references.ts";
import type { EditorMeta, Game } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
const st = (g: Game, id: string) => g.stations.find((s) => s.id === id)!;

describe("Verwendungen zählen", () => {
  it("findet Verweise auf eine Station in Belohnung und Regeln", () => {
    const g = load();
    st(g, "baum").rewards!.reveal = ["versteck"];
    const u = usagesOf(g, "station", "versteck");
    expect(u.map((x) => x.path)).toEqual(["/stations/1/rewards/reveal/0", "/rules/0/then/0/reveal_station"]);
    expect(u[0]!.owner).toEqual({ kind: "station", id: "baum", name: "Der alte Baum" });
    expect(u[1]!.owner).toEqual({ kind: "regel", id: "versteck-freischalten", name: "versteck-freischalten" });
    expect(describeUsages(u)).toBe("1 Station und 1 Regel");
    expect(describeUsages([])).toBe("nichts");
  });

  it("findet Medien in Klang, Takten, Belohnungen und Geschichte", () => {
    const g = load();
    const u = usagesOf(g, "medium", "funk-knacken");
    expect(u.map((x) => x.path).sort()).toEqual(["/sound/ui/radio", "/stations/0/scene/beats/0/sfx", "/stations/4/sound/approach/here"].sort());
    expect(usagesOf(g, "medium", "sturm").map((x) => `${x.owner.name}: ${x.what}`)).toEqual(["Das Signal: Atmosphäre"]);
    expect(usagesOf(g, "figur", "zentrale")).toHaveLength(7);
    expect(usagesOf(g, "gegenstand", "zettel").map((x) => x.what)).toEqual(["Fundstück im Takt"]);
    expect(usagesOf(g, "kapitel", "kapitel-2").map((x) => x.path)).toEqual(["/stations/0/rewards/chapter"]);
    expect(usagesOf(g, "teil", "f2").map((x) => x.path)).toEqual(["/stations/2/rewards/fragments/0"]);
    expect(usagesOf(g, "zone", "strasse")).toEqual([]);
  });
});

describe("Löschen mit Verweisen", () => {
  it("Station: reveal, station_solved, reveal_station und leere Regel verschwinden", () => {
    const g = load();
    st(g, "baum").rewards!.reveal = ["schloss", "versteck"];
    const meta: EditorMeta = { onSite: { schloss: { accuracy: 4, at: "x" } }, template: { id: "t", stations: { schloss: { lat: 1, lon: 2 } }, tasks: { schloss: "{}" }, createdAt: "x" } };
    const removed = removeWithReferences(g, "station", "schloss", meta);
    expect(g.stations.map((s) => s.id)).toEqual(["briefing", "baum", "versteck", "finale"]);
    expect(st(g, "baum").rewards!.reveal).toEqual(["versteck"]);
    // Die Regel hatte nur diese Bedingung und fällt weg.
    expect(g.rules).toBeUndefined();
    expect(removed.map((r) => r.path)).toEqual(["/stations/1/rewards/reveal/0", "/rules/0/when/0/station_solved"]);
    expect(meta.onSite).toEqual({});
    expect(meta.template!.stations).toEqual({});
  });

  it("Station als Regelziel: nur die Aktion verschwindet, die Regel bleibt", () => {
    const g = load();
    removeWithReferences(g, "station", "versteck");
    expect(g.rules![0]!.then).toEqual([{ message: { from: "hq", text: { de: "Neue Spur! Auf eurer Karte ist ein Versteck aufgetaucht." } } }]);
  });

  it("Gegenstand: beat.item, give_item, has_item und Belohnung", () => {
    const g = load();
    g.rules!.push({ id: "r2", when: [{ has_item: "uv-lampe" }], then: [{ give_item: "zettel" }, { add_points: 5 }], else: [{ give_item: "zettel" }] });
    removeWithReferences(g, "gegenstand", "zettel");
    expect(st(g, "schloss").scene!.beats![0]!.item).toBeUndefined();
    expect(g.rules![1]).toEqual({ id: "r2", when: [{ has_item: "uv-lampe" }], then: [{ add_points: 5 }] });
    removeWithReferences(g, "gegenstand", "uv-lampe");
    expect(st(g, "briefing").rewards!.items).toBeUndefined();
    expect(g.rules!.map((r) => r.id)).toEqual(["versteck-freischalten"]);
    expect(g.items).toEqual([]);
  });

  it("Medium: Felder, Listeneinträge und ganze Atmosphären", () => {
    const g = load();
    removeWithReferences(g, "medium", "funk-knacken");
    expect(g.sound!.ui).toEqual({});
    expect(st(g, "briefing").scene!.beats![0]!.sfx).toBeUndefined();
    expect(st(g, "finale").sound!.approach).toEqual({ near: "donner" });
    removeWithReferences(g, "medium", "wald-nacht");
    expect(st(g, "baum").sound!.ambience).toBeUndefined();
    removeWithReferences(g, "medium", "sturm");
    expect(g.story!.chapters![2]!.ambience).toBeUndefined();
    expect(g.media!.map((m) => m.id)).not.toContain("sturm");
  });

  it("Kapitel und Codeteil; Codeteile werden neu nummeriert", () => {
    const g = load();
    removeWithReferences(g, "kapitel", "kapitel-2");
    expect(st(g, "briefing").rewards!.chapter).toBeUndefined();
    expect(g.story!.chapters!.map((c) => c.id)).toEqual(["kapitel-1", "kapitel-3"]);
    removeWithReferences(g, "teil", "f2");
    expect(st(g, "schloss").rewards!.fragments).toBeUndefined();
    expect(g.fragments!.map((f) => [f.id, f.position])).toEqual([
      ["f1", 1],
      ["f3", 2],
    ]);
  });

  it("Orte und Regeln ohne Verweise", () => {
    const g = load();
    removeWithReferences(g, "punkt", "rp1");
    expect(g.field.rescuePoints).toEqual([]);
    removeWithReferences(g, "regel", "versteck-freischalten");
    expect(g.rules).toEqual([]);
    expect(removeWithReferences(g, "station", "gibtsnicht")).toEqual([]);
  });

  it("nummeriert Lücken weg und hält Reihenfolge", () => {
    const g = load();
    g.fragments![2]!.position = 9;
    renumberFragments(g);
    expect(g.fragments!.map((f) => f.position)).toEqual([1, 2, 3]);
  });
});

describe("Umbenennen", () => {
  it("zieht alle Verweise mit und benennt den Eintrag um", () => {
    const g = load();
    const meta: EditorMeta = { onSite: { schloss: { accuracy: 3, at: "x" } } };
    expect(renameId(g, "station", "schloss", "kiste", meta)).toBe(1);
    expect(st(g, "kiste")).toBeDefined();
    expect(g.rules![0]!.when).toEqual([{ station_solved: "kiste" }]);
    expect(meta.onSite).toEqual({ kiste: { accuracy: 3, at: "x" } });
    expect(renameId(g, "figur", "zentrale", "hq", undefined)).toBe(7);
    expect(g.characters![0]!.id).toBe("hq");
    expect(st(g, "baum").scene!.arrival![0]!.speaker).toBe("hq");
    expect(renameId(g, "medium", "wind", "wind-2")).toBe(1);
    expect(g.sound!.ambience!.audio).toBe("wind-2");
    expect(renameId(g, "station", "x", "x")).toBe(0);
  });
});
