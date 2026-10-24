import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeDiff, diffSummary } from "../src/lib/editor/diff.ts";
import type { Game } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

describe("Unterschiede zweier Stände", () => {
  it("nichts geändert: leer", () => {
    expect(diffSummary(load(), load())).toEqual([]);
    expect(describeDiff([])).toBe("nichts");
  });

  it("nennt Objekte mit Namen und Bereiche", () => {
    const a = load();
    const b = load();
    b.stations[1]!.name = { de: "Die alte Eiche" };
    b.stations.push({ id: "neu", name: { de: "Neue Station" }, triggers: [{ type: "gps" }] });
    b.rules = [];
    b.items!.splice(0, 1);
    b.safety.emergency.gameMasterPhone = "+49 1";
    b.settings.teamSize = { min: 1, max: 9 };
    b.field.restrictedZones![0]!.name = { de: "Landstraße" };
    b.story!.chapters![0]!.title = { de: "Stille" };
    b.fragments![0]!.value = "2";
    const d = diffSummary(a, b);
    expect(d.map((e) => e.text)).toEqual([
      "Station „Die alte Eiche“ geändert",
      "Station „Neue Station“ hinzugefügt",
      "Regel „versteck-freischalten“ entfernt",
      "Kapitel „Stille“ geändert",
      "Gegenstand „UV-Lampe“ entfernt",
      "Codeteil „1“ geändert",
      "Sperrzone „Landstraße“ geändert",
      "Grundregeln geändert",
      "Sicherheit geändert",
    ]);
    expect(d[0]).toMatchObject({ section: "stationen", objectId: "baum", kind: "changed" });
    expect(d[2]).toMatchObject({ section: "regeln", objectId: "versteck-freischalten", kind: "removed" });
    expect(d.find((e) => e.text.startsWith("Spielfeld"))).toBeUndefined();
    expect(describeDiff(d)).toBe("2 Stationen, 1 Regel, 1 Kapitel, 1 Gegenstand, 1 Codeteil, 1 Sperrzone, die Grundregeln und die Sicherheit");
  });

  it("Spielfeld ohne Sperrzonen, Geschichte ohne Kapitel", () => {
    const a = load();
    const b = load();
    b.field.boundary = { center: { lat: 1, lon: 2 }, radius: 100 };
    b.story!.intro!.text = { de: "Neu" };
    b.sound = {};
    b.meta.title = { de: "T" };
    expect(diffSummary(a, b).map((e) => `${e.section}: ${e.text}`)).toEqual(["geschichte: Angaben zum Spiel geändert", "karte: Spielfeld geändert", "geschichte: Geschichte geändert", "klang: Klang geändert"]);
    expect(describeDiff(diffSummary(a, b))).toBe("die Angaben zum Spiel, das Spielfeld, die Geschichte und der Klang");
  });

  it("hält unvollständige Stände aus", () => {
    expect(() => diffSummary({} as Game, load())).not.toThrow();
    expect(diffSummary({} as Game, load()).some((e) => e.kind === "added")).toBe(true);
  });
});
