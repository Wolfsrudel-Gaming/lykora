import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allCodes, isWeakCode, newGameId, newId, newManualCode, newQrCode, slugId, takenIds } from "../src/lib/editor/ids.ts";
import type { Game } from "../src/lib/editor/types.ts";
import { kebabId } from "../src/lib/format.ts";

const testspiel = JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

describe("Kennungen", () => {
  it("macht aus Namen lesbare IDs ohne Dateiendung abzuschneiden", () => {
    expect(slugId("Akt 1.2", "x")).toBe("akt-1-2");
    expect(slugId("Der alte Baum", "station")).toBe("der-alte-baum");
    expect(slugId("Größe & Übermut", "x")).toBe("groesse-uebermut");
    expect(slugId("", "station")).toBe("station");
    expect(slugId("!!!", "figur")).toBe("figur");
    expect(slugId("a".repeat(80), "x")).toHaveLength(64);
    // kebabId schneidet weiterhin die Dateiendung ab.
    expect(kebabId("Wind im Wald.ogg")).toBe("wind-im-wald");
    expect(kebabId("Akt 1.2")).toBe("akt-1");
  });

  it("erzeugt eindeutige IDs je Art mit Rückfall", () => {
    expect(newId("station", "Baum", ["baum"])).toBe("baum-2");
    expect(newId("station", "", [])).toBe("station");
    expect(newId("station", "", ["station"])).toBe("station-2");
    expect(newId("figur", "Försterin Brandt", [])).toBe("foersterin-brandt");
    expect(newId("teil", "egal", [])).toBe("teil-1");
    expect(newId("teil", "", ["teil-1", "teil-2"])).toBe("teil-3");
    expect(newId("teil", "", ["teil-2"])).toBe("teil-1");
    expect(newGameId("Sturmnacht: Das verschwundene Funkgerät")).toBe("sturmnacht-das-verschwundene-funkgeraet");
    expect(newGameId("")).toBe("spiel");
  });

  it("kennt die vergebenen IDs je Liste", () => {
    expect(takenIds(testspiel, "station")).toEqual(["briefing", "baum", "schloss", "versteck", "finale"]);
    expect(takenIds(testspiel, "kapitel")).toEqual(["kapitel-1", "kapitel-2", "kapitel-3"]);
    expect(takenIds(testspiel, "teil")).toEqual(["f1", "f2", "f3"]);
    expect(takenIds(testspiel, "zone")).toEqual(["strasse"]);
    expect(takenIds(testspiel, "punkt")).toEqual(["sammelpunkt", "rp1"]);
    expect(takenIds({ ...testspiel, rules: undefined }, "regel")).toEqual([]);
  });
});

describe("Codes", () => {
  it("QR-Codes: LYK- plus 4 Zeichen ohne 0, O, 1, I; eindeutig", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = newQrCode(taken);
      expect(code).toMatch(/^LYK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
  });

  it("Notfall-Codes: 4 Ziffern, nicht trivial, nicht vergeben", () => {
    expect(isWeakCode("0000")).toBe(true);
    expect(isWeakCode("1234")).toBe(true);
    expect(isWeakCode("4321")).toBe(true);
    expect(isWeakCode("7777")).toBe(true);
    expect(isWeakCode("4711")).toBe(false);
    expect(isWeakCode("12")).toBe(true);
    const taken = new Set(["4711"]);
    for (let i = 0; i < 300; i++) {
      const code = newManualCode(taken);
      expect(code).toMatch(/^\d{4}$/);
      expect(isWeakCode(code)).toBe(false);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
  });

  it("sammelt alle Codes des Spiels", () => {
    expect(allCodes(testspiel)).toEqual(["LYK-BRIEFING", "lyk-baum", "4711", "LYK-SCHLOSS", "LYK-FINALE"]);
    expect(allCodes({ stations: [{ triggers: [null, { type: "gps" }] }] } as unknown as Game)).toEqual([]);
  });
});
