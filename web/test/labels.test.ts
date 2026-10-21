import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaBounds, penaltyLabel, stationSoundLines, taskSummary, triggerLabel } from "../src/lib/game.ts";
import { detailText, isSafetyLog, logLabel } from "../src/lib/labels.ts";
import type { Game } from "../src/lib/types.ts";

const testspiel = JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

describe("Logbuch und Aktionen", () => {
  it("benennt Einträge auf Deutsch", () => {
    expect(logLabel("event_recall")).toBe("Rückruf: Alle zurück");
    expect(logLabel("team_answer")).toBe("Antwort");
    expect(logLabel("staff_solve")).toBe("Als gelöst gewertet");
    expect(logLabel("cue_sent")).toBe("Klang eingespielt");
    expect(logLabel("neu_im_server")).toBe("neu_im_server");
  });

  it("fasst Daten kurz zusammen", () => {
    expect(detailText("team_answer", { station: "baum", text: "Uhu", outcome: { status: "ok", verdict: "correct" } }, testspiel)).toBe("Der alte Baum · „Uhu“ · richtig");
    expect(detailText("team_trigger", { station: "baum", method: "nfc", outcome: { status: "rejected", reason: "paused" } }, testspiel)).toBe("Der alte Baum · NFC · Event pausiert");
    expect(detailText("staff_time", { seconds: -120, note: "Hilfe vor Ort" }, testspiel)).toBe("2 Min gutgeschrieben · Notiz: Hilfe vor Ort");
    expect(detailText("staff_item", { item: "uv-lampe" }, testspiel)).toBe("UV-Lampe gegeben");
    expect(detailText("staff_points", { amount: -20 }, testspiel)).toBe("−20 Punkte");
    expect(detailText("cue_sent", { audio: "eule", text: "Pst!" }, testspiel)).toBe("„eule“: Pst!");
    expect(detailText("event_recall", { reason: "Gewitter" }, null)).toBe("Gewitter");
  });

  it("hebt SOS und Rückruf hervor", () => {
    expect(isSafetyLog({ kind: "sos" })).toBe(true);
    expect(isSafetyLog({ kind: "event_recall" })).toBe(true);
    expect(isSafetyLog({ kind: "team_hint" })).toBe(false);
  });
});

describe("Spielübersicht", () => {
  it("beschreibt Auslöser und Aufgaben mit Lösung", () => {
    const baum = testspiel.stations[1]!;
    expect(baum.triggers.map(triggerLabel)).toEqual(["GPS (25 m)", "NFC-Tag „lyk-baum“", "Notfall-Code 4711"]);
    expect(taskSummary(baum.task!, "de")).toEqual({ kind: "Antwort eintippen", question: "Welches Tier ist auf dem Schild am Baum abgebildet?", solution: ["Eule", "Uhu"] });
    expect(taskSummary(testspiel.stations[0]!.task!, "de").solution).toEqual(["SOS drücken und bei der Person bleiben"]);
  });

  it("beschreibt Strafen und Klänge", () => {
    expect(penaltyLabel({ type: "time", amount: 60 })).toBe("+60 s");
    expect(penaltyLabel({ type: "points", amount: 20 })).toBe("−20 Punkte");
    expect(penaltyLabel(undefined)).toBe("keine Strafe");
    expect(stationSoundLines(testspiel.stations[1]!)).toEqual(["Atmosphäre „wald-nacht“ aus der Nähe", "Annäherung nah: „eule“", "Beim Lösen: „ast-knackt“"]);
  });

  it("berechnet den Kartenausschnitt für Kreis und Vieleck", () => {
    const [[s, w], [n, e]] = areaBounds({ center: { lat: 50.8155, lon: 7.155 }, radius: 300 });
    expect(n - s).toBeCloseTo((2 * 300) / 111_320, 6);
    expect(e - w).toBeGreaterThan(n - s);
    expect(areaBounds({ polygon: [{ lat: 1, lon: 2 }, { lat: 3, lon: 1 }, { lat: 2, lon: 5 }] })).toEqual([
      [1, 1],
      [3, 5],
    ]);
  });
});
