import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateGame } from "@lykora/spec";
import type { Game } from "../src/lib/types.ts";
import { describeError, describePath, jsonErrorAt, parseJson, translateMessage } from "../src/lib/validation.ts";

const testspiel = JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

describe("Prüfergebnisse lesbar machen", () => {
  it("benennt Pfade mit Namen aus dem Spiel", () => {
    expect(describePath("/stations/1/task", testspiel)).toBe("Station „Der alte Baum“ (baum) › Aufgabe");
    expect(describePath("/stations/1/triggers/2", testspiel)).toBe("Station „Der alte Baum“ (baum) › Auslöser 3");
    expect(describePath("/story/chapters/2/ambience", testspiel)).toBe("Geschichte › Kapitel „Das Signal“ (kapitel-3) › Atmosphäre");
    expect(describePath("/meta/title", testspiel)).toBe("Angaben › Titel");
    expect(describePath("/", testspiel)).toBe("Spiel");
    expect(describePath("/stations/9/name", testspiel)).toBe("Station 10 › Name");
  });

  it("übersetzt die Meldungen des Schema-Prüfers", () => {
    expect(translateMessage("must have required property 'title'")).toBe("Pflichtangabe „Titel“ fehlt");
    expect(translateMessage("must NOT have additional properties")).toBe("enthält ein Feld, das es im Spielformat nicht gibt");
    expect(translateMessage("must be number")).toBe("muss eine Zahl sein");
    expect(translateMessage("must be string,object")).toBe("hat den falschen Typ");
    expect(translateMessage("must NOT have fewer than 1 items")).toBe("braucht mindestens 1 Eintrag");
    expect(translateMessage("must be <= 1")).toBe("darf höchstens 1 sein");
    expect(translateMessage('must match pattern "^[a-z0-9][a-z0-9_-]{0,63}$"')).toMatch(/Kleinbuchstaben/);
    expect(translateMessage("must match exactly one schema in oneOf")).toBe("passt zu keiner der erlaubten Formen");
    expect(translateMessage("etwas Neues")).toBe("etwas Neues");
  });

  it("macht jede Meldung des echten Validators lesbar", () => {
    const broken = structuredClone(testspiel) as unknown as Record<string, any>;
    delete broken.meta.title;
    broken.stations[1].sound.ambience.volume = 3;
    broken.stations[2].id = "Schloss Nr. 1";
    const { errors } = validateGame(broken);
    expect(errors.length).toBeGreaterThan(0);
    const described = errors.map((e) => describeError(e, broken));
    expect(described).toContainEqual(expect.objectContaining({ where: "Angaben", message: "Pflichtangabe „Titel“ fehlt" }));
    expect(described).toContainEqual(expect.objectContaining({ where: "Station „Der alte Baum“ (baum) › Klang › Atmosphäre › volume", message: "darf höchstens 1 sein" }));
    for (const d of described) expect(d.message).not.toMatch(/^must /);
  });

  it("zerlegt Querverweis-Fehler", () => {
    const g = structuredClone(testspiel);
    g.stations[1]!.sound!.solved = "gibtsnicht";
    const { errors } = validateGame(g);
    expect(errors).toEqual(["stations[baum].sound.solved: unbekannte Medien-ID „gibtsnicht“"]);
    expect(describeError(errors[0]!, g)).toEqual({ where: "Stationen › baum › Klang › Lösungsgeräusch", message: "unbekannte Medien-ID „gibtsnicht“", raw: errors[0] });
    expect(describeError("Unbekannte Formatversion „0.2“")).toEqual({ where: "Spiel", message: "Unbekannte Formatversion „0.2“", raw: "Unbekannte Formatversion „0.2“" });
  });

  it("nennt Zeile und Spalte bei kaputtem JSON", () => {
    expect(parseJson('{"a": 1}').value).toEqual({ a: 1 });
    const r = parseJson('{\n  "a": 1,\n  "b": }');
    expect(r.error).toMatch(/^Kein gültiges JSON: Zeile 3, Spalte \d+$/);
    expect(parseJson("  ").error).toBe("Keine Daten");
  });
});

describe("JSON-Fehlerstelle", () => {
  it("findet die erste falsche Stelle", () => {
    expect(jsonErrorAt('{"a": tru}')).toBe(9);
    expect(jsonErrorAt('{"a": 1,}')).toBe(8);
    expect(jsonErrorAt('[1, 2')).toBe(5);
    expect(jsonErrorAt('{"a": "x\\q"}')).toBe(9);
    expect(jsonErrorAt('{"a": 1} x')).toBe(9);
    expect(jsonErrorAt('{"a": [1, {"b": null}], "c": -1.5e3}')).toBe(-1);
  });

  it("meldet ein zu frühes Ende", () => {
    expect(parseJson('{"a": [1, 2').error).toBe("Kein gültiges JSON: Zeile 1, Spalte 12 (Text endet zu früh)");
  });
});
