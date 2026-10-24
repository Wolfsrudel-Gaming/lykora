import { describe, expect, it } from "vitest";
import { countMissing, hasText, readText, writeText } from "../src/lib/editor/text.ts";

describe("Texte einsprachig lesen und schreiben", () => {
  it("liest in der Sprache, sonst in der ersten vorhandenen", () => {
    expect(readText({ de: "Hallo", en: "Hello" }, "de")).toBe("Hallo");
    expect(readText({ en: "Hello" }, "de")).toBe("Hello");
    expect(readText("Roh", "de")).toBe("Roh");
    expect(readText(undefined, "de")).toBe("");
    expect(hasText({ de: "  " }, "de")).toBe(false);
    expect(hasText({ de: "x" }, "de")).toBe(true);
    expect(hasText(undefined, "de")).toBe(false);
  });

  it("Regel 1: leerer Text lässt andere Sprachen stehen, sonst fällt das Feld weg", () => {
    expect(writeText({ de: "Hallo", en: "Hello" }, "de", "")).toEqual({ en: "Hello" });
    expect(writeText({ de: "Hallo" }, "de", "")).toBeUndefined();
    expect(writeText("Roh", "de", "")).toBeUndefined();
    expect(writeText(undefined, "de", "")).toBeUndefined();
  });

  it("Regel 2: String oder fehlend wird zum Übersetzungsobjekt", () => {
    expect(writeText(undefined, "de", "Neu")).toEqual({ de: "Neu" });
    expect(writeText("Roh", "de", "Neu")).toEqual({ de: "Neu" });
  });

  it("Regel 3: Objekt wird kopiert, andere Sprachen bleiben", () => {
    const before = { de: "Alt", en: "Old" };
    const after = writeText(before, "de", "Neu");
    expect(after).toEqual({ de: "Neu", en: "Old" });
    expect(before).toEqual({ de: "Alt", en: "Old" });
    expect(after).not.toBe(before);
  });

  it("zählt fehlende Texte für den Sprachwechsel", () => {
    const game = { meta: { title: { de: "T" } }, stations: [{ name: { de: "A", en: "A" }, approach: { mid: "roh" } }], items: [{ name: { en: "x" } }] };
    expect(countMissing(game, "en")).toBe(1);
    expect(countMissing(game, "de")).toBe(1);
    expect(countMissing(game, "fr")).toBe(3);
  });
});
