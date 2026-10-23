import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateGame } from "@lykora/spec";
import { assignFragment, coupleFinal, finalCode, fragmentGiver, isCoupled, setFinalCode, sortedFragments, splitCode, splitMode } from "../src/lib/editor/fragments.ts";
import type { Game } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
const st = (g: Game, id: string) => g.stations.find((s) => s.id === id)!;
const answers = (g: Game) => (st(g, "finale").task as { answers: string[] }).answers;

/** Beispielspiel ohne Codeteile; das Finale prüft weiter „191“. */
function withoutFragments(): Game {
  const g = load();
  delete g.fragments;
  for (const s of g.stations) {
    if (s.rewards?.fragments) delete s.rewards.fragments;
    if (s.rewards && !Object.keys(s.rewards).length) delete s.rewards;
  }
  return g;
}

describe("Finalcode lesen", () => {
  it("setzt die Teile nach Position zusammen und erkennt die Kopplung", () => {
    const g = load();
    g.fragments!.reverse();
    expect(finalCode(g)).toBe("191");
    expect(sortedFragments(g).map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(isCoupled(g)).toBe(true);
    expect(splitMode(g)).toBe("chars");
    expect(fragmentGiver(g, "f2")?.id).toBe("schloss");
  });

  it("gilt als entkoppelt, wenn die Antwort abweicht oder es kein Code-Rätsel ist", () => {
    const g = load();
    answers(g)[0] = "4711";
    expect(isCoupled(g)).toBe(false);
    const h = load();
    st(h, "finale").task = { type: "photo", prompt: { de: "Foto" } };
    expect(isCoupled(h)).toBe(false);
  });

  it("teilt Codes in Zeichen oder eigene Teile", () => {
    expect(splitCode("191", "chars")).toEqual(["1", "9", "1"]);
    expect(splitCode("191", ["19", "", "1"])).toEqual(["19", "1"]);
  });
});

describe("setFinalCode", () => {
  it("legt aus „191“ drei Teile an, Positionen 1 bis 3, und das gekoppelte Finale folgt", () => {
    const g = withoutFragments();
    setFinalCode(g, "191", "chars");
    expect(g.fragments).toEqual([
      { id: "teil-1", position: 1, value: "1" },
      { id: "teil-2", position: 2, value: "9" },
      { id: "teil-3", position: 3, value: "1" },
    ]);
    expect(finalCode(g)).toBe("191");
    // Das Finale prüfte schon „191“: gekoppelt, solange niemand etwas anderes sagt.
    setFinalCode(g, "4711", "chars");
    expect(answers(g)).toEqual(["4711"]);
    expect(g.fragments!.map((f) => [f.id, f.position, f.value])).toEqual([
      ["teil-1", 1, "4"],
      ["teil-2", 2, "7"],
      ["teil-3", 3, "1"],
      ["teil-4", 4, "1"],
    ]);
  });

  it("behält Kennung und Vergabe vorhandener Teile", () => {
    const g = load();
    setFinalCode(g, "1925", "chars");
    expect(g.fragments!.map((f) => f.id)).toEqual(["f1", "f2", "f3", "teil-1"]);
    expect(st(g, "baum").rewards?.fragments).toEqual(["f1"]);
    expect(answers(g)).toEqual(["1925"]);
  });

  it("entfernt beim Kürzen die überzähligen Teile samt Verweisen", () => {
    const g = load();
    setFinalCode(g, "19", "chars");
    expect(g.fragments!.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(st(g, "versteck").rewards).toBeUndefined();
    expect(answers(g)).toEqual(["19"]);
    expect(validateGame(g).errors).toEqual([]);
  });

  it("leerer Code entfernt alle Teile, das Finale behält seine Antwort", () => {
    const g = load();
    setFinalCode(g, "", "chars");
    expect(g.fragments).toBeUndefined();
    expect(g.stations.some((s) => s.rewards?.fragments)).toBe(false);
    expect(answers(g)).toEqual(["191"]);
  });

  it("nimmt eigene Teile", () => {
    const g = load();
    setFinalCode(g, "191", ["19", "1"]);
    expect(g.fragments!.map((f) => [f.id, f.position, f.value])).toEqual([
      ["f1", 1, "19"],
      ["f2", 2, "1"],
    ]);
    expect(splitMode(g)).toBe("custom");
    expect(answers(g)).toEqual(["191"]);
  });

  it("zieht ein entkoppeltes Finale nicht mit", () => {
    const g = load();
    setFinalCode(g, "777", "chars", { follow: false });
    expect(answers(g)).toEqual(["191"]);
    expect(isCoupled(g)).toBe(false);
    answers(g)[0] = "4711";
    setFinalCode(g, "123", "chars");
    expect(answers(g)).toEqual(["4711"]);
  });

  it("ergibt mit vergebenen Teilen ein gültiges Spiel", () => {
    const g = load();
    setFinalCode(g, "1914", "chars");
    assignFragment(g, "teil-1", "briefing");
    expect(validateGame(g).errors).toEqual([]);
    expect(answers(g)).toEqual(["1914"]);
  });
});

describe("assignFragment", () => {
  it("vergibt ein Teil an genau eine Station", () => {
    const g = load();
    assignFragment(g, "f1", "schloss");
    expect(st(g, "baum").rewards).toBeUndefined();
    expect(st(g, "schloss").rewards?.fragments).toEqual(["f2", "f1"]);
    assignFragment(g, "f1", "schloss");
    expect(st(g, "schloss").rewards?.fragments).toEqual(["f2", "f1"]);
    assignFragment(g, "f1", null);
    expect(st(g, "schloss").rewards?.fragments).toEqual(["f2"]);
    expect(fragmentGiver(g, "f1")).toBeUndefined();
  });
});

describe("coupleFinal", () => {
  it("legt am Finale ohne Rätsel ein Code-Rätsel an", () => {
    const g = load();
    delete st(g, "finale").task;
    expect(coupleFinal(g, true)).toBe(true);
    expect(st(g, "finale").task).toEqual({ type: "code", question: { de: "Setzt eure Codeteile ein." }, answers: ["191"] });
  });

  it("übernimmt den Code als einzige Antwort, nicht bei Foto oder ohne Code", () => {
    const g = load();
    answers(g).splice(0, 1, "4711", "0815");
    expect(coupleFinal(g, true)).toBe(true);
    expect(answers(g)).toEqual(["191"]);
    st(g, "finale").task = { type: "photo", prompt: { de: "Foto" } };
    expect(coupleFinal(g, true)).toBe(false);
    const h = withoutFragments();
    expect(coupleFinal(h, true)).toBe(false);
    expect(coupleFinal(load(), false)).toBe(false);
  });
});
