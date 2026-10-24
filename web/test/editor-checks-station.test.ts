import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EditorIssue, Game } from "../src/lib/editor/types.ts";
import { validateDraft } from "../src/lib/editor/validation.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
type Loose = Record<string, any>;
const st = (g: Loose, id: string): Loose => g.stations.find((s: Loose) => s.id === id)!;
const find = (g: Loose, code: string) => validateDraft(g as Game, {}).filter((i) => i.code === code);

/** Je Code ein Positiv- und ein Negativfall; das Beispielspiel ist der Negativfall, wenn nichts anderes steht. */
const CASES: [string, (g: Loose) => void, { path: string; text?: string; negative?: (g: Loose) => void }][] = [
  [
    "reveal_radius_ineffective",
    (g) => (st(g, "baum").revealRadius = 40),
    { path: "/stations/1/revealRadius", text: "Der Annäherungs-Radius wirkt nur bei versteckten Stationen mit Ort und GPS.", negative: (g) => Object.assign(st(g, "versteck"), { revealRadius: 40 }) },
  ],
  ["reveal_radius_ineffective", (g) => Object.assign(st(g, "versteck"), { revealRadius: 40, triggers: [{ type: "qr", code: "LYK-X" }] }), { path: "/stations/3/revealRadius" }],
  ["reveal_radius_ineffective", (g) => { delete st(g, "versteck").location; st(g, "versteck").revealRadius = 40; }, { path: "/stations/3/revealRadius" }],
  [
    "reveal_visible",
    (g) => (st(g, "baum").rewards.reveal = ["schloss"]),
    { path: "/stations/1/rewards/reveal/0", text: "Station „Die verschlossene Kiste“ ist schon sichtbar.", negative: (g) => (st(g, "baum").rewards.reveal = ["versteck"]) },
  ],
  ["reveal_visible", (g) => (st(g, "versteck").rewards = { reveal: ["versteck"] }), { path: "/stations/3/rewards/reveal/0" }],
  [
    "find_location_trigger",
    (g) => Object.assign(st(g, "schloss"), { task: { type: "find_location", prompt: { de: "Findet die Bank." }, location: { lat: 50.8, lon: 7.1 } }, triggers: [{ type: "gps" }] }),
    { path: "/stations/2/triggers", negative: (g) => (st(g, "schloss").task = { type: "find_location", prompt: { de: "Findet die Bank." }, location: { lat: 50.8, lon: 7.1 } }) },
  ],
  [
    "photo_fragment_manual",
    (g) => (st(g, "versteck").task.review = "live"),
    { path: "/stations/3/rewards/fragments", text: "Das Codeteil kommt erst, wenn die Spielleitung das Foto annimmt.", negative: (g) => (st(g, "versteck").task.review = "auto_accept") },
  ],
  ["photo_review_unsupported", (g) => (st(g, "versteck").task.review = "vote"), { path: "/stations/3/task/review", negative: (g) => (st(g, "versteck").task.review = "live") }],
  ["photo_review_unsupported", (g) => (st(g, "versteck").task.review = "after_game"), { path: "/stations/3/task/review" }],
  [
    "no_hints",
    (g) => delete st(g, "baum").hints,
    { path: "/stations/1/hints", text: "Station „Der alte Baum“ hat keine Tipps – ein Team, das nicht weiterkommt, muss die Spielleitung rufen.", negative: (g) => { delete st(g, "baum").hints; g.settings.hints.enabled = false; } },
  ],
  [
    "no_scene",
    (g) => { delete st(g, "schloss").scene; },
    { path: "/stations/2/scene", negative: (g) => { delete st(g, "schloss").scene; st(g, "schloss").story = { text: { de: "Eine Kiste." } }; } },
  ],
];

describe("Prüfungen des Stationseditors", () => {
  for (const [code, mutate, want] of CASES) {
    it(`${code}: ${want.path}`, () => {
      const g = load() as Loose;
      mutate(g);
      const hit = find(g, code).find((i) => i.at.path === want.path);
      expect(hit, `Meldung ${code} an ${want.path}`).toBeDefined();
      expect(hit!.severity).toBe<EditorIssue["severity"]>("hint");
      expect(hit!.source).toBe("editor");
      expect(hit!.dismissable).toBe(true);
      expect(hit!.at.section).toBe("stationen");
      if (want.text) expect(hit!.message).toBe(want.text);
      const ok = load() as Loose;
      want.negative?.(ok);
      expect(find(ok, code).filter((i) => i.at.path === want.path)).toEqual([]);
    });
  }

  it("no_hints nur bei Stationen mit Rätsel, no_scene nicht bei Altdaten", () => {
    const g = load() as Loose;
    delete st(g, "finale").task;
    delete st(g, "finale").hints;
    expect(find(g, "no_hints").map((i) => i.at.objectId)).not.toContain("finale");
    expect(find(g, "no_hints").map((i) => i.at.objectId)).toEqual(["briefing", "schloss", "versteck"]);
  });

  it("hält kaputte Entwürfe aus", () => {
    const g = load() as Loose;
    g.stations.push(null, { id: "leer" }, { id: "x", triggers: [null], task: { type: "photo" }, rewards: { reveal: [null] } });
    expect(() => validateDraft(g as Game, {})).not.toThrow();
    expect(find(g, "no_scene").map((i) => i.at.objectId)).toContain("leer");
  });
});
