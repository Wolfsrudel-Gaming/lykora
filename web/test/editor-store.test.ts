import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editorPath, targetOf } from "../src/lib/editor/jump.ts";
import { COALESCE_MS, HISTORY_LIMIT, createEditorStore, editor, isTouched, normalizeGame, visibleIssuesAt, type EditorInit } from "../src/lib/editor/store.ts";
import type { EditorIssue, Game } from "../src/lib/editor/types.ts";
import { addressOf, validateDraft } from "../src/lib/editor/validation.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

/** Store ohne Server und ohne lokale Sicherung; die Uhr ist von Hand stellbar. */
function make(init: Partial<EditorInit> = {}) {
  const clock = { now: 1_000_000 };
  const store = createEditorStore({ gameId: "g1", game: load(), localBackup: false, now: () => clock.now, ...init });
  return { store, clock };
}

describe("Store: Änderungen und Verlauf", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("update arbeitet auf Kopien und erzeugt neue Objekte", () => {
    const { store } = make();
    const before = store.get().game;
    store.update("Titel geändert", (g) => {
      g.meta.title = { de: "Neu" };
    });
    const after = store.get().game;
    expect(after).not.toBe(before);
    expect(after.stations).not.toBe(before.stations);
    expect(before.meta.title).toEqual({ de: "Sturmnacht: Das verschwundene Funkgerät", en: "Storm Night: The Missing Radio" });
    expect(after.meta.title).toEqual({ de: "Neu" });
    expect(store.get().undo.map((e) => e.label)).toEqual(["Titel geändert"]);
    expect(store.get().undo[0]!.game).toBe(before);
    expect(store.get().redo).toEqual([]);
  });

  it("verschmilzt Tipp-Schritte innerhalb einer Sekunde", () => {
    const { store, clock } = make();
    const start = store.get().game;
    store.update("Titel", (g) => void (g.meta.title = { de: "N" }), { coalesce: "/meta/title" });
    clock.now += 400;
    store.update("Titel", (g) => void (g.meta.title = { de: "Ne" }), { coalesce: "/meta/title" });
    clock.now += 900;
    store.update("Titel", (g) => void (g.meta.title = { de: "Neu" }), { coalesce: "/meta/title" });
    expect(store.get().undo).toHaveLength(1);
    expect(store.get().undo[0]!.game).toBe(start);
    clock.now += COALESCE_MS;
    store.update("Titel", (g) => void (g.meta.title = { de: "Neue" }), { coalesce: "/meta/title" });
    expect(store.get().undo).toHaveLength(2);
    store.update("Anderes Feld", (g) => void (g.meta.summary = { de: "x" }), { coalesce: "/meta/summary" });
    expect(store.get().undo).toHaveLength(3);
    expect(store.undo()!.label).toBe("Anderes Feld");
    expect(store.undo()!.label).toBe("Titel");
    expect(store.get().game.meta.title).toEqual({ de: "Neu" });
    expect(store.undo()).not.toBeNull();
    expect(store.get().game).toBe(start);
    expect(store.undo()).toBeNull();
  });

  it("hält höchstens 200 Schritte", () => {
    const { store, clock } = make();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      clock.now += 2000;
      store.update(`Schritt ${i}`, (g) => void (g.meta.summary = { de: String(i) }));
    }
    expect(store.get().undo).toHaveLength(HISTORY_LIMIT);
    expect(store.get().undo[0]!.label).toBe("Schritt 5");
  });

  it("undo und redo stellen die Referenzen wieder her; dirty vergleicht per Referenz", () => {
    const { store } = make();
    const saved = store.get().saved.game;
    expect(store.get().game).toBe(saved);
    store.update("A", (g) => void (g.meta.summary = { de: "a" }), { focus: { section: "geschichte", field: "meta.summary", path: "/meta/summary" } });
    const a = store.get().game;
    store.update("B", (g) => void (g.meta.summary = { de: "b" }));
    const entry = store.undo();
    expect(entry?.label).toBe("B");
    expect(store.get().game).toBe(a);
    expect(store.get().redo).toHaveLength(1);
    expect(store.undo()!.focus).toEqual({ section: "geschichte", field: "meta.summary", path: "/meta/summary" });
    expect(store.get().game).toBe(saved);
    expect(store.redo()!.label).toBe("A");
    expect(store.get().game).toBe(a);
    expect(store.redo()!.label).toBe("B");
    expect(store.redo()).toBeNull();
    expect(store.get().game.meta.summary).toEqual({ de: "b" });
    expect(store.get().undo).toHaveLength(2);
  });

  it("setField schreibt, entfernt und räumt leere Eltern auf", () => {
    const { store } = make();
    store.setField("/stations/1/revealRadius", 30, "Radius gesetzt");
    expect(store.get().game.stations[1]!.revealRadius).toBe(30);
    store.setField("/stations/1/revealRadius", undefined, "Radius entfernt");
    expect(store.get().game.stations[1]!.revealRadius).toBeUndefined();
    store.setField("/stations/1/sound/solved", undefined, "Lösungsgeräusch entfernt");
    store.setField("/stations/1/sound/approach/near", undefined, "Annäherung entfernt");
    expect(store.get().game.stations[1]!.sound).toEqual({ ambience: { audio: "wald-nacht", volume: 0.7, from: "near" } });
    store.setField("/stations/1/sound/ambience/audio", undefined, "Atmosphäre entfernt");
    expect(store.get().game.stations[1]!.sound).toBeUndefined();
    // Ein Listeneintrag bleibt, auch wenn er leer wird.
    store.setField("/stations/1/hints/0/text", undefined, "Tipp geleert");
    expect(store.get().game.stations[1]!.hints).toHaveLength(3);
    store.setField("/settings/time/duration", undefined, "Dauer entfernt");
    expect(store.get().game.settings.time).toEqual({ limit: "per_team" });
    store.setField("/meta/title", { de: "a" }, "Tippen", { coalesce: true });
    store.setField("/meta/title", { de: "ab" }, "Tippen", { coalesce: true });
    expect(store.get().undo.filter((e) => e.label === "Tippen")).toHaveLength(1);
  });

  it("metaOnly erzeugt keinen Undo-Eintrag; dismissIssue blendet aus", () => {
    const { store } = make();
    store.update("Abgehakt", (_g, m) => void (m.checklist = { telefon: "jetzt" }), { metaOnly: true });
    expect(store.get().undo).toEqual([]);
    expect(store.get().meta.checklist).toEqual({ telefon: "jetzt" });
    const hint = store.get().issues.find((i) => i.code === "languages_extra")!;
    store.dismissIssue(hint.id);
    store.dismissIssue(hint.id);
    expect(store.get().meta.dismissed).toEqual([hint.id]);
    expect(store.get().undo).toEqual([]);
    expect(visibleIssuesAt({ ...store.get(), showAll: true }, "/meta/languages")).toEqual([]);
  });

  it("replace ersetzt den Entwurf mit Undo-Schritt und normalisiert", () => {
    const { store } = make();
    const other = load();
    other.meta.title = { de: "Anderes Spiel" };
    other.fragments![2]!.position = 7;
    store.replace(other, { noZones: true }, "Datei importiert");
    expect(store.get().game).toBe(other);
    expect(store.get().game.fragments!.map((f) => f.position)).toEqual([1, 2, 3]);
    expect(store.get().meta).toEqual({ noZones: true });
    expect(store.undo()!.label).toBe("Datei importiert");
    expect(store.get().game.meta.title).toMatchObject({ de: "Sturmnacht: Das verschwundene Funkgerät" });
  });

  it("prüft 300 ms nach der Änderung und sofort auf Wunsch", () => {
    const validate = vi.fn((g: Game) => validateDraft(g, {}));
    const { store } = make({ validate });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(store.get().issues.map((i) => i.code)).toContain("nfc_not_uid");
    store.update("Titel", (g) => void (g.meta.title = { de: "" }));
    expect(validate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(299);
    expect(validate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(store.get().issues.map((i) => i.code)).toContain("empty_required_text");
    store.update("Titel", (g) => void (g.meta.title = { de: "x" }));
    expect(store.validateNow().map((i) => i.code)).not.toContain("empty_required_text");
    expect(validate).toHaveBeenCalledTimes(3);
  });

  it("touch, showAll und Sichtbarkeit am Feld", () => {
    const { store } = make();
    store.update("Titel", (g) => void (g.meta.title = { de: "" }));
    store.validateNow();
    expect(visibleIssuesAt(store.get(), "/meta/title")).toEqual([]);
    store.touch("/meta/title");
    store.touch("/meta/title");
    expect(visibleIssuesAt(store.get(), "/meta/title").map((i) => i.code)).toEqual(["empty_required_text"]);
    expect(isTouched(new Set(["/stations/1"]), "/stations/1/name")).toBe(true);
    expect(isTouched(new Set(["/stations/1/task/answers/0"]), "/stations/1/task")).toBe(true);
    expect(isTouched(new Set(["/stations/1"]), "/stations/10")).toBe(false);
    store.showAllIssues(true);
    expect(visibleIssuesAt(store.get(), "/meta/languages").map((i) => i.code)).toEqual(["languages_extra"]);
    store.setExpert(true);
    expect(store.get().expert).toBe(true);
  });

  it("normalizeGame: Sprache nie leer, Codeteile lückenlos", () => {
    const g = load();
    g.meta.languages = [];
    g.fragments![1]!.position = 5;
    normalizeGame(g, "de");
    expect(g.meta.languages).toEqual(["de"]);
    expect(g.fragments!.map((f) => f.position)).toEqual([1, 3, 2]);
  });

  it("editor-Singleton und close", () => {
    const { store } = make();
    editor.set({ current: store });
    store.close();
    expect(editor.get().current).toBeNull();
  });
});

describe("Store: Tempo", () => {
  it("eine Änderung an einem Spiel mit 200 Stationen braucht unter 50 ms", () => {
    const g = load();
    const [, baum] = g.stations;
    g.stations = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(baum!), id: `s${i}`, name: { de: `Station ${i}` }, triggers: [{ type: "gps" as const }, { type: "qr" as const, code: `LYK-${i}` }] }));
    const store = createEditorStore({ gameId: "g1", game: g, localBackup: false, validate: () => [] });
    const runs = 30;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) store.update("Name", (game) => void (game.stations[i]!.name = { de: `Neu ${i}` }));
    const perUpdate = (performance.now() - t0) / runs;
    // Großzügig: auf einem belasteten Rechner darf der Test nicht kippen, ein O(n²)-Fehler bleibt weit darüber.
    expect(perUpdate).toBeLessThan(50);
    expect(store.get().undo).toHaveLength(runs);
  });
});

describe("Sprung zum Feld", () => {
  it("baut die Zieladresse aus Bereich, Objekt und Feld", () => {
    const g = load();
    expect(targetOf(addressOf("/stations/1/task/answers/0", g), "spiel 1")).toBe("/spiele/spiel%201/baukasten/stationen/baum?feld=task.answers.0");
    expect(targetOf(addressOf("/rules/0/then/1/message/text", g), "g1")).toBe("/spiele/g1/baukasten/regeln?objekt=versteck-freischalten&feld=then.1.message.text");
    expect(targetOf(addressOf("/meta/languages", g), "g1")).toBe("/spiele/g1/baukasten/einstellungen?feld=meta.languages");
    expect(targetOf(addressOf("/stations", g), "g1")).toBe("/spiele/g1/baukasten/karte?feld=stations");
    expect(targetOf(addressOf("/stations/9/name", g), "g1")).toBe("/spiele/g1/baukasten/karte?objekt=%239&feld=name");
    expect(targetOf(addressOf("", g), "g1")).toBe("/spiele/g1/baukasten/einstellungen");
    expect(editorPath("g1")).toBe("/spiele/g1/baukasten");
    expect(editorPath("g1", "klang", undefined, { experte: "1" })).toBe("/spiele/g1/baukasten/klang?experte=1");
  });
});

/** Sicherheitsnetz für die Hooks: sie bauen auf diesen reinen Funktionen auf. */
describe("Sichtbare Meldungen", () => {
  it("filtert ausgeblendete und unberührte", () => {
    const issue: EditorIssue = { id: "x", severity: "warning", code: "c", message: "m", at: { section: "karte", field: "field.boundary", path: "/field/boundary" }, source: "editor", dismissable: true };
    const base = { issues: [issue], touched: new Set<string>(), showAll: false, meta: {} };
    expect(visibleIssuesAt(base as never, "/field/boundary")).toEqual([]);
    expect(visibleIssuesAt({ ...base, showAll: true } as never, "/field/boundary")).toEqual([issue]);
    expect(visibleIssuesAt({ ...base, touched: new Set(["/field/boundary/radius"]) } as never, "/field")).toEqual([issue]);
    expect(visibleIssuesAt({ ...base, showAll: true, meta: { dismissed: ["x"] } } as never, "/field/boundary")).toEqual([]);
  });
});
