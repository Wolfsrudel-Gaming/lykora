import { describe, expect, it, vi } from "vitest";
import { canRestoreFocus, fieldControlProps, fieldIds, INITIAL_FOCUS_SELECTORS, menuKeyAction, pickInitialFocus, placeFloating, rovingNext, trapTab, typeaheadIndex } from "../src/ui/a11y.ts";

// Die Tests der Bausteine laufen hier an der Logik, die sie benutzen (ohne DOM): Reiter, Menü, Dialog-Fokus, Feld-Verdrahtung.

describe("Reiter und Gruppen (roving tabindex)", () => {
  it("Pfeil rechts und links wandern mit Umlauf", () => {
    expect(rovingNext("ArrowRight", 0, 4)).toBe(1);
    expect(rovingNext("ArrowRight", 3, 4)).toBe(0);
    expect(rovingNext("ArrowLeft", 0, 4)).toBe(3);
    expect(rovingNext("ArrowLeft", 2, 4)).toBe(1);
  });

  it("Home und Ende springen an die Ränder", () => {
    expect(rovingNext("Home", 2, 5)).toBe(0);
    expect(rovingNext("End", 2, 5)).toBe(4);
  });

  it("andere Tasten gehören nicht dazu", () => {
    expect(rovingNext("a", 1, 3)).toBeNull();
    expect(rovingNext("ArrowDown", 1, 3)).toBeNull();
    expect(rovingNext("ArrowRight", 0, 0)).toBeNull();
  });

  it("gesperrte Reiter werden übersprungen", () => {
    expect(rovingNext("ArrowRight", 0, 4, { disabled: [false, true, true, false] })).toBe(3);
    expect(rovingNext("ArrowLeft", 3, 4, { disabled: [false, true, true, false] })).toBe(0);
    expect(rovingNext("Home", 2, 4, { disabled: [true, false, false, false] })).toBe(1);
    expect(rovingNext("End", 0, 4, { disabled: [false, false, false, true] })).toBe(2);
  });

  it("senkrechte Gruppen nehmen oben und unten, Radiogruppen beides", () => {
    expect(rovingNext("ArrowDown", 0, 3, { orientation: "vertical" })).toBe(1);
    expect(rovingNext("ArrowRight", 0, 3, { orientation: "vertical" })).toBeNull();
    expect(rovingNext("ArrowDown", 0, 3, { orientation: "both" })).toBe(1);
    expect(rovingNext("ArrowLeft", 0, 3, { orientation: "both" })).toBe(2);
  });

  it("bleibt stehen, wenn alles andere gesperrt ist", () => {
    expect(rovingNext("ArrowRight", 1, 3, { disabled: [true, false, true] })).toBe(1);
  });
});

describe("Menü: Tastatur", () => {
  it("Pfeile bewegen mit Umlauf, Gesperrtes wird übersprungen", () => {
    expect(menuKeyAction("ArrowDown", 0, 3)).toEqual({ type: "move", index: 1 });
    expect(menuKeyAction("ArrowDown", 2, 3)).toEqual({ type: "move", index: 0 });
    expect(menuKeyAction("ArrowUp", 0, 3)).toEqual({ type: "move", index: 2 });
    expect(menuKeyAction("ArrowDown", 0, 3, [false, true, false])).toEqual({ type: "move", index: 2 });
  });

  it("Home und Ende", () => {
    expect(menuKeyAction("Home", 2, 4)).toEqual({ type: "move", index: 0 });
    expect(menuKeyAction("End", 0, 4)).toEqual({ type: "move", index: 3 });
  });

  it("Enter und Leertaste wählen, Escape schließt mit Rückfokus, Tab schließt ohne", () => {
    expect(menuKeyAction("Enter", 1, 3)).toEqual({ type: "select" });
    expect(menuKeyAction(" ", 1, 3)).toEqual({ type: "select" });
    expect(menuKeyAction("Escape", 1, 3)).toEqual({ type: "close", refocus: true });
    expect(menuKeyAction("Tab", 1, 3)).toEqual({ type: "close", refocus: false });
    expect(menuKeyAction("x", 1, 3)).toBeNull();
  });

  it("Tippsuche: Anfangsbuchstabe, nächster Treffer, mehrere Buchstaben", () => {
    const labels = ["Bearbeiten", "Duplizieren", "Archivieren", "Löschen", "Löschen für alle"];
    expect(typeaheadIndex(labels, "a", 0)).toBe(2);
    expect(typeaheadIndex(labels, "l", 0)).toBe(3);
    expect(typeaheadIndex(labels, "l", 3)).toBe(4);
    expect(typeaheadIndex(labels, "ll", 3)).toBe(4);
    expect(typeaheadIndex(labels, "lö", 3)).toBe(3);
    expect(typeaheadIndex(labels, "lösch", 0)).toBe(3);
    expect(typeaheadIndex(labels, "q", 0)).toBeNull();
    expect(typeaheadIndex(labels, "", 0)).toBeNull();
    expect(typeaheadIndex(labels, "d", 0, [false, true, false, false, false])).toBeNull();
  });
});

describe("Fokus im Dialog", () => {
  it("Tab am Rand springt auf die andere Seite", () => {
    expect(trapTab("b", "a", "b", false)).toBe("first");
    expect(trapTab("a", "a", "b", true)).toBe("last");
    expect(trapTab("a", "a", "b", false)).toBeNull();
    expect(trapTab("b", "a", "b", true)).toBeNull();
  });

  it("erster Fokus: markiert, dann erstes Feld, dann Hauptaktion, nie zuerst der Schließen-Knopf", () => {
    const present = (sels: string[]) => (sel: string) => (sels.includes(sel) ? sel : null);
    expect(INITIAL_FOCUS_SELECTORS[0]).toBe("[data-autofocus]");
    expect(INITIAL_FOCUS_SELECTORS.at(-1)).toBe(".dialog-close");
    expect(pickInitialFocus(present(["[data-autofocus]", INITIAL_FOCUS_SELECTORS[1]]))).toBe("[data-autofocus]");
    expect(pickInitialFocus(present([INITIAL_FOCUS_SELECTORS[1], INITIAL_FOCUS_SELECTORS[2]]))).toBe(INITIAL_FOCUS_SELECTORS[1]);
    expect(pickInitialFocus(present([INITIAL_FOCUS_SELECTORS[2], ".dialog-close"]))).toBe(INITIAL_FOCUS_SELECTORS[2]);
    expect(pickInitialFocus(present([".dialog-close"]))).toBe(".dialog-close");
    expect(pickInitialFocus(present([]))).toBeNull();
  });

  it("Fokus geht nur zurück, wenn das Element noch im Dokument ist", () => {
    expect(canRestoreFocus({ isConnected: true, focus: () => undefined })).toBe(true);
    expect(canRestoreFocus({ isConnected: false, focus: () => undefined })).toBe(false);
    expect(canRestoreFocus(null)).toBe(false);
    expect(canRestoreFocus({ isConnected: true })).toBe(false);
  });
});

describe("Feld: Beschriftung, Hinweis, Fehler", () => {
  it("Hinweis und Fehler haben feste Namen aus der Feld-id", () => {
    expect(fieldIds("name")).toEqual({ control: "name", hint: "name-hinweis", error: "name-fehler" });
  });

  it("ohne Hinweis und Fehler hängt nichts am Feld", () => {
    expect(fieldControlProps("f", {})).toEqual({ id: "f", "aria-describedby": undefined, "aria-invalid": undefined, "aria-required": undefined });
  });

  it("Hinweis wird beschreibend verbunden", () => {
    expect(fieldControlProps("f", { hint: true })["aria-describedby"]).toBe("f-hinweis");
  });

  it("Fehler macht das Feld ungültig und wird beschreibend verbunden", () => {
    const p = fieldControlProps("f", { error: true });
    expect(p["aria-invalid"]).toBe(true);
    expect(p["aria-describedby"]).toBe("f-fehler");
  });

  it("Pflicht setzt aria-required, eine fremde Beschreibung bleibt erhalten", () => {
    const p = fieldControlProps("f", { required: true, error: true, describedBy: "extern" });
    expect(p["aria-required"]).toBe(true);
    expect(p["aria-describedby"]).toBe("extern f-fehler");
  });
});

describe("Schwebende Flächen", () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 200, height: 120 };

  it("öffnet unter dem Anker, am Anfang ausgerichtet", () => {
    expect(placeFloating({ top: 100, left: 50, width: 80, height: 40 }, size, vp)).toEqual({ top: 144, left: 50, side: "bottom" });
  });

  it("richtet am Ende aus", () => {
    expect(placeFloating({ top: 100, left: 500, width: 80, height: 40 }, size, vp, { align: "end" }).left).toBe(380);
  });

  it("klappt nach oben, wenn unten kein Platz ist und oben mehr", () => {
    const p = placeFloating({ top: 700, left: 50, width: 80, height: 40 }, size, vp);
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - 120 - 4);
  });

  it("bleibt unten, wenn oben noch weniger Platz ist", () => {
    expect(placeFloating({ top: 20, left: 50, width: 80, height: 40 }, { width: 200, height: 900 }, vp).side).toBe("bottom");
  });

  it("bleibt im Fenster", () => {
    expect(placeFloating({ top: 100, left: 950, width: 40, height: 40 }, size, vp).left).toBe(1000 - 200 - 8);
    expect(placeFloating({ top: 100, left: -30, width: 40, height: 40 }, size, vp).left).toBe(8);
  });

  it("Tooltip mittig über dem Anker", () => {
    const p = placeFloating({ top: 300, left: 400, width: 100, height: 40 }, { width: 60, height: 24 }, vp, { side: "top", align: "center", gap: 6 });
    expect(p).toEqual({ top: 300 - 24 - 6, left: 420, side: "top" });
  });
});

describe("Auslöser rufen Handler nur einmal", () => {
  it("fieldControlProps ist rein", () => {
    const spy = vi.fn(fieldControlProps);
    spy("a", { hint: true });
    spy("a", { hint: true });
    expect(spy.mock.results[0]!.value).toEqual(spy.mock.results[1]!.value);
  });
});
