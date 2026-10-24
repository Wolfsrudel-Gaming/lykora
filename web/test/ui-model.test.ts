import { describe, expect, it } from "vitest";
import { buttonClass } from "../src/ui/Button.tsx";
import { initials, teamColor, teamTone, teamVar } from "../src/ui/badge.tsx";
import { nextSort } from "../src/ui/table.tsx";

describe("Knopf-Klassen", () => {
  it("Standard ist secondary in mittlerer Größe", () => {
    expect(buttonClass()).toBe("btn btn--secondary");
  });

  it("Variante, Größe, nur Symbol, volle Breite und eigene Klasse", () => {
    expect(buttonClass({ variant: "primary", size: "sm", icon: true, block: true, class: "x" })).toBe("btn btn--primary btn--sm btn--icon btn--block x");
    expect(buttonClass({ variant: "danger-quiet", size: "lg" })).toBe("btn btn--danger-quiet btn--lg");
  });
});

describe("Sortierung", () => {
  it("aufsteigend, absteigend, aus", () => {
    const a = nextSort(null, "name");
    expect(a).toEqual({ key: "name", dir: "asc" });
    const b = nextSort(a, "name");
    expect(b).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(b, "name")).toBeNull();
  });

  it("eine andere Spalte beginnt aufsteigend", () => {
    expect(nextSort({ key: "a", dir: "desc" }, "b")).toEqual({ key: "b", dir: "asc" });
  });
});

describe("Avatar-Initialen", () => {
  it("zwei Wörter: erster und letzter Anfangsbuchstabe", () => {
    expect(initials("Pfadfinder Hennef")).toBe("PH");
    expect(initials("Max von Muster")).toBe("MM");
  });

  it("ein Wort: die ersten zwei Buchstaben; leer: Fragezeichen", () => {
    expect(initials("Admin")).toBe("AD");
    expect(initials("  ")).toBe("?");
    expect(initials("Ärger")).toBe("ÄR");
  });
});

describe("Teamfarben", () => {
  it("bekannte Namen werden Tokens, Nachtwerte bleiben als Hex erreichbar", () => {
    expect(teamVar("blue", "x")).toBe("var(--team-blue)");
    expect(teamColor("blue", "x")).toBe("#4A90E2");
    expect(teamTone("red", "x")).toBe("red");
  });

  it("eigene Hex-Farben aus den Daten bleiben unverändert", () => {
    expect(teamVar("#ff0000", "x")).toBe("#ff0000");
    expect(teamColor("#ff0000", "x")).toBe("#ff0000");
  });

  it("ohne Farbe entscheidet die Team-Id, stabil", () => {
    const a = teamTone(null, "team-1");
    expect(teamTone(null, "team-1")).toBe(a);
    expect(teamVar(null, "team-1")).toBe(`var(--team-${a})`);
    // Reihenfolge wie vor der Umstellung: Hash 0 wäre Blau
    expect(["blue", "green", "yellow", "purple", "orange", "teal", "pink", "olive"]).toContain(a);
  });
});
