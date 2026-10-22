import { describe, expect, it } from "vitest";
import { getAt, isTextObject, joinPointer, lastKey, parentPointer, parsePointer, prune, removeAt, setAt } from "../src/lib/editor/paths.ts";

describe("JSON-Pointer im Entwurf", () => {
  it("zerlegt und baut Pfade, auch mit maskierten Schlüsseln", () => {
    expect(parsePointer("")).toEqual([]);
    expect(parsePointer("/")).toEqual([]);
    expect(parsePointer("/stations/1/task/answers/0")).toEqual(["stations", "1", "task", "answers", "0"]);
    expect(parsePointer("/sound/ui/a~1b~0c")).toEqual(["sound", "ui", "a/b~c"]);
    expect(joinPointer(["sound", "ui", "a/b~c"])).toBe("/sound/ui/a~1b~0c");
    expect(joinPointer([])).toBe("");
    expect(lastKey("/stations/1/name")).toBe("name");
    expect(parentPointer("/stations/1/name")).toBe("/stations/1");
    expect(parentPointer("/stations")).toBe("");
  });

  it("liest tolerant", () => {
    const g = { stations: [{ name: { de: "Baum" } }] };
    expect(getAt(g, "/stations/0/name/de")).toBe("Baum");
    expect(getAt(g, "/stations/3/name")).toBeUndefined();
    expect(getAt(g, "/stations/0/name/de/x")).toBeUndefined();
    expect(getAt(null, "/a")).toBeUndefined();
    expect(getAt(g, "")).toBe(g);
  });

  it("legt beim Schreiben Zwischenobjekte und Listen an", () => {
    const g: Record<string, unknown> = {};
    setAt(g, "/settings/teamSize/min", 2);
    setAt(g, "/stations/0/name", { de: "A" });
    setAt(g, "/stations/0/hints/1/text", { de: "B" });
    expect(g).toEqual({ settings: { teamSize: { min: 2 } }, stations: [{ name: { de: "A" }, hints: [undefined, { text: { de: "B" } }] }] });
    setAt(g, "/settings/teamSize/min", undefined);
    expect(g.settings).toEqual({ teamSize: {} });
    expect(() => setAt(g, "", 1)).toThrow();
  });

  it("entfernt Felder und lässt Listen nachrücken", () => {
    const g = { a: { b: 1 }, list: [1, 2, 3] };
    expect(removeAt(g, "/a/b")).toBe(true);
    expect(removeAt(g, "/a/b")).toBe(false);
    expect(removeAt(g, "/list/1")).toBe(true);
    expect(g.list).toEqual([1, 3]);
    expect(removeAt(g, "/list/9")).toBe(false);
    expect(removeAt(g, "")).toBe(false);
  });

  it("erkennt Übersetzungsobjekte", () => {
    expect(isTextObject({ de: "x" })).toBe(true);
    expect(isTextObject({ de: "", en: "" })).toBe(true);
    expect(isTextObject({ "de-CH": "x" })).toBe(true);
    expect(isTextObject({ mid: "id" }, "approach")).toBe(false);
    expect(isTextObject({ deutsch: "x" })).toBe(false);
    expect(isTextObject({})).toBe(false);
    expect(isTextObject("x")).toBe(false);
  });
});

describe("prune räumt Leeres aus dem Teilbaum", () => {
  it("entfernt leere Strings, Objekte, Listen, null und undefined", () => {
    const g = { meta: { title: { de: "T" }, summary: "", authors: [] }, settings: {}, story: { intro: { media: [] }, hq: {} }, items: null, x: undefined };
    const out = prune(g, "");
    expect(out).toEqual({ meta: { title: { de: "T" } }, settings: {} });
  });

  it("lässt Pflichtobjekte wie settings stehen und Listeneinträge unangetastet", () => {
    expect(prune({ settings: { time: {} } }, "")).toEqual({ settings: {} });
    expect(prune({}, "/settings")).toEqual({});
    expect(prune({}, "/safety/emergency")).toEqual({});
    // Ein frisch angelegter Eintrag darf leer sein: props[0] mit leerem Namen bleibt.
    expect(prune({ props: [{ name: "" }], hints: [{ text: { de: "" } }] }, "/stations/0")).toEqual({ props: [{}], hints: [{ text: { de: "" } }] });
    expect(prune({ name: "" }, "/stations/0/props/0")).toEqual({});
    expect(prune(["", "x"], "/stations/0/task/answers")).toEqual(["", "x"]);
  });

  it("behält Übersetzungsobjekte, auch leere Pflichttexte", () => {
    expect(prune({ name: { de: "" } }, "/stations/0")).toEqual({ name: { de: "" } });
    expect(prune({ title: { de: "A", en: "" } }, "/meta")).toEqual({ title: { de: "A", en: "" } });
    // Annäherungssprüche sind keine Übersetzung: leere Stufe fällt weg.
    expect(prune({ approach: { mid: "", near: { de: "Nah" } } }, "/stations/0")).toEqual({ approach: { near: { de: "Nah" } } });
    expect(prune({ mid: "" }, "/stations/0/approach")).toBeUndefined();
    // Die Station selbst ist ein Listeneintrag und bleibt, auch leer.
    expect(prune({ approach: { mid: "" } }, "/stations/0")).toEqual({});
  });

  it("kennt ambience ohne Klang und match aus Standardwerten", () => {
    expect(prune({ ambience: { volume: 0.5 }, solved: "x" }, "/stations/0/sound")).toEqual({ solved: "x" });
    expect(prune({ sound: { ambience: { audio: "" } } }, "")).toEqual({});
    expect(prune({ match: { ignoreCase: true, ignoreWhitespace: true, maxTypos: 1 }, answers: ["a"] }, "/stations/0/task")).toEqual({ answers: ["a"] });
    expect(prune({ match: { ignoreCase: false }, answers: ["a"] }, "/stations/0/task")).toEqual({ match: { ignoreCase: false }, answers: ["a"] });
  });

  it("behält Zahlen und false", () => {
    expect(prune({ points: 0, final: false, enabled: false }, "/x")).toEqual({ points: 0, final: false, enabled: false });
  });
});
