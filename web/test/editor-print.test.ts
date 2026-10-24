import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signsData, solutionSheet, stationsWithoutSign } from "../src/lib/editor/print.ts";
import type { Game } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

describe("signsData", () => {
  it("ein Schild je QR-Code mit Nummer und Name, Finale mit Stern", () => {
    expect(signsData(load())).toEqual([
      { stationId: "briefing", number: "1", name: "Sicherheits-Briefing", qr: "LYK-BRIEFING" },
      { stationId: "schloss", number: "3", name: "Die verschlossene Kiste", qr: "LYK-SCHLOSS" },
      { stationId: "finale", number: "★", name: "Finale: das Funkgerät", qr: "LYK-FINALE" },
    ]);
  });

  it("verrät weder Notfall-Codes noch NFC-Werte", () => {
    const text = JSON.stringify(signsData(load()));
    expect(text).not.toContain("4711");
    expect(text).not.toContain("lyk-baum");
  });

  it("nennt Stationen ohne Schild", () => {
    expect(stationsWithoutSign(load())).toEqual(["Der alte Baum", "Das Versteck"]);
  });
});

describe("solutionSheet", () => {
  it("Lösungen, Codes, Codeteile, Material und Notizen je Station", () => {
    const g = load();
    g.stations[1]!.notes = "Schild in 1,5 m Höhe";
    const sheet = solutionSheet(g);
    expect(sheet).toMatchObject({ title: "Sturmnacht: Das verschwundene Funkgerät", phone: "+49 170 0000000", emergencyNumber: "112", finalCode: "191" });
    expect(sheet.rows[1]).toEqual({
      stationId: "baum",
      number: "2",
      name: "Der alte Baum",
      hidden: false,
      task: { kind: "Antwort eintippen", question: "Welches Tier ist auf dem Schild am Baum abgebildet?", solution: ["Eule", "Uhu"] },
      qr: [],
      manual: ["4711"],
      nfc: ["lyk-baum"],
      fragments: ["1"],
      props: ["Schild mit Eule"],
      notes: "Schild in 1,5 m Höhe",
    });
    expect(sheet.rows[2]!.props).toEqual(["Kiste mit Zahlenschloss (Code 372)", "UV-Botschaft auf dem Deckel"]);
    expect(sheet.rows[3]).toMatchObject({ hidden: true, task: { solution: [] } });
  });

  it("hält unvollständige Entwürfe aus", () => {
    const sheet = solutionSheet({ meta: { title: { de: "" } }, stations: [null, { id: "x", triggers: [], task: { type: "choice" } }] } as unknown as Game);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({ stationId: "x", number: "2", name: "x" });
    expect(sheet.finalCode).toBe("");
  });
});
