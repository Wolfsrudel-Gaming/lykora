import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKS } from "../src/lib/editor/checks.ts";
import type { EditorIssue, Game } from "../src/lib/editor/types.ts";
import { validateDraft } from "../src/lib/editor/validation.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
type Loose = Record<string, any>;
const st = (g: Loose, id: string): Loose => g.stations.find((s: Loose) => s.id === id)!;
const find = (g: Loose, code: string) => validateDraft(g as Game, {}).filter((i) => i.code === code);
const rule = (g: Loose, r: Loose) => g.rules.push({ id: `r${g.rules.length}`, ...r });

const CODES = [
  "incomplete_rule",
  "rule_else_once",
  "rule_repeat",
  "rule_message_from",
  "rule_has_item_document",
  "rule_elapsed_near",
  "rule_fragments_too_many",
  "rule_reveal_visible",
  "chapter_never_starts",
  "item_never_given",
  "character_silent",
  "scare_too_high",
  "night_speed_bonus",
  "no_intro",
];

/** Je Code ein Positiv- und ein Negativfall; das Beispielspiel ist der Negativfall, wenn nichts anderes steht. */
const CASES: [string, (g: Loose) => void, { path: string; severity: EditorIssue["severity"]; text?: string; negative?: (g: Loose) => void }][] = [
  [
    "incomplete_rule",
    (g) => rule(g, { when: [{ station_solved: "baum" }], then: [{ message: { from: "hq", text: { de: "" } } }] }),
    { path: "/rules/1/then/0/message/text", severity: "error", text: "Der Regelbaustein ist unvollständig – bitte Station, Gegenstand, Kapitel oder Text wählen." },
  ],
  [
    "incomplete_rule",
    (g) => rule(g, { when: [{ station_solved: "baum" }, { has_item: "uv-lampe" }], then: [{ add_points: 5 }], else: [{ message: { text: { de: "  " } } }] }),
    { path: "/rules/1/else/0/message/text", severity: "error" },
  ],
  [
    "rule_else_once",
    (g) => rule(g, { when: [{ station_solved: "baum" }, { has_item: "uv-lampe" }], then: [{ add_points: 10 }], else: [{ add_points: -10 }] }),
    { path: "/rules/1/else", severity: "hint", negative: (g) => rule(g, { when: [{ station_solved: "baum" }], then: [{ add_points: 10 }], else: [], once: false }) },
  ],
  ["rule_repeat", (g) => (g.rules[0].once = false), { path: "/rules/0/once", severity: "warning", negative: (g) => (g.rules[0].once = true) }],
  [
    "rule_message_from",
    (g) => (g.rules[0].then[1].message.from = "narrator"),
    { path: "/rules/0/then/1/message/from", severity: "hint", negative: (g) => (g.rules[0].then[1].message.from = "hq") },
  ],
  [
    "rule_has_item_document",
    (g) => rule(g, { when: [{ has_item: "zettel" }], then: [{ add_points: 5 }] }),
    {
      path: "/rules/1/when/0/has_item",
      severity: "warning",
      text: "Dieses Schriftstück kommt nur über einen Szenentakt und landet nie im Inventar – die Bedingung greift nicht.",
      negative: (g) => rule(g, { when: [{ has_item: "uv-lampe" }], then: [{ add_points: 5 }] }),
    },
  ],
  ["rule_elapsed_near", (g) => rule(g, { when: [{ station_solved: "baum" }, { elapsed: 600 }], then: [{ add_points: 5 }] }), { path: "/rules/1/when/1", severity: "hint" }],
  ["rule_elapsed_near", (g) => rule(g, { when: [{ near: { location: { lat: 50.7, lon: 7.1 }, radius: 30 } }], then: [{ add_points: 5 }] }), { path: "/rules/1/when/0", severity: "hint" }],
  [
    "rule_fragments_too_many",
    (g) => rule(g, { when: [{ fragments_collected: 4 }], then: [{ add_points: 5 }] }),
    { path: "/rules/1/when/0/fragments_collected", severity: "warning", negative: (g) => rule(g, { when: [{ fragments_collected: 3 }], then: [{ add_points: 5 }] }) },
  ],
  [
    "rule_reveal_visible",
    (g) => (g.rules[0].then[0].reveal_station = "baum"),
    { path: "/rules/0/then/0/reveal_station", severity: "hint", text: "Station „Der alte Baum“ ist schon sichtbar – „erscheint“ bewirkt nichts." },
  ],
  [
    "chapter_never_starts",
    (g) => delete st(g, "schloss").rewards.chapter,
    {
      path: "/story/chapters/2",
      severity: "warning",
      text: "Kapitel „Das Signal“ beginnt nie – keine Station und keine Regel startet es.",
      negative: (g) => {
        delete st(g, "schloss").rewards.chapter;
        g.rules[0].then.push({ start_chapter: "kapitel-3" });
      },
    },
  ],
  [
    "item_never_given",
    (g) => g.items.push({ id: "kompass", name: { de: "Kompass" } }),
    { path: "/items/2", severity: "warning", text: "Gegenstand „Kompass“ bekommt kein Team – keine Station und keine Regel vergibt ihn.", negative: (g) => {
      g.items.push({ id: "kompass", name: { de: "Kompass" } });
      g.rules[0].then.push({ give_item: "kompass" });
    } },
  ],
  [
    "character_silent",
    (g) => g.characters.push({ id: "wirt", name: { de: "Wirt" } }),
    { path: "/characters/3", severity: "hint", text: "Figur „Wirt“ kommt in keiner Szene vor.", negative: (g) => g.characters.push({ id: "zentrale-2", kind: "hq", name: { de: "Zweite Zentrale" } }) },
  ],
  ["character_silent", (g) => (st(g, "baum").scene.beats[0].kind = "group", st(g, "versteck").scene.arrival[0].kind = "group", st(g, "baum").scene.beats.forEach((b: Loose) => delete b.speaker), st(g, "versteck").scene.arrival.forEach((b: Loose) => delete b.speaker)), { path: "/characters/2", severity: "hint" }],
  [
    "scare_too_high",
    (g) => Object.assign(g.meta, { scareLevel: 2, ageGroups: ["6-9"] }),
    { path: "/meta/scareLevel", severity: "warning", negative: (g) => Object.assign(g.meta, { scareLevel: 1, ageGroups: ["6-9"] }) },
  ],
  ["night_speed_bonus", (g) => (g.settings.scoring.speedBonus = true), { path: "/settings/scoring/speedBonus", severity: "warning", negative: (g) => Object.assign(g.meta, { night: false }, (g.settings.scoring.speedBonus = true) && {}) }],
  ["no_intro", (g) => delete g.story.intro, { path: "/story/intro/text", severity: "hint", negative: (g) => (g.story.intro.text = { de: "Los geht's." }) }],
];

describe("Prüfungen Geschichte und Regeln (Paket D)", () => {
  it("das Beispielspiel löst keine davon aus", () => {
    const issues = validateDraft(load(), {});
    expect(issues.filter((i) => CODES.includes(i.code)).map((i) => i.code)).toEqual([]);
  });

  for (const [code, mutate, expected] of CASES) {
    it(`${code} an ${expected.path}`, () => {
      const g = load() as Loose;
      mutate(g);
      const hits = find(g, code);
      expect(hits.map((i) => i.at.path)).toContain(expected.path);
      const hit = hits.find((i) => i.at.path === expected.path)!;
      expect(hit.severity).toBe(expected.severity);
      if (expected.text) expect(hit.message).toBe(expected.text);
      if (expected.negative) {
        const n = load() as Loose;
        expected.negative(n);
        expect(find(n, code)).toEqual([]);
      }
    });
  }

  it("unfertige Verweise und Texte meldet der Baukasten, nicht das Schema", () => {
    const g = load() as Loose;
    rule(g, { when: [{ station_solved: "" }], then: [{ message: { from: "hq", text: { de: "" } } }] });
    const issues = validateDraft(g as Game, {}).filter((i) => i.at.path.startsWith("/rules/1"));
    expect(issues.filter((i) => i.severity === "error").map((i) => i.at.path).sort()).toEqual(["/rules/1/then/0/message/text", "/rules/1/when/0/station_solved"]);
    expect(issues.find((i) => i.at.path === "/rules/1/then/0/message/text")?.at).toMatchObject({ section: "regeln", objectId: "r1", field: "then.0.message.text" });
    // Am leeren Verweis ersetzt der Baukasten-Satz den Kennungs-Satz des Schemas (ein Problem, eine Meldung).
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["incomplete_rule", "incomplete_rule"]);
    const own = CHECKS.flatMap((c) => c(g as Game, {}, "de")).filter((i) => i.code === "incomplete_rule");
    expect(own.map((i) => i.at.path)).toEqual(["/rules/1/when/0/station_solved", "/rules/1/then/0/message/text"]);
  });

  it("Sofort-Lösungen: Absender Zentrale, einmal je Team, Schnelligkeitspunkte aus", () => {
    const g = load() as Loose;
    g.rules[0].then[1].message.from = "npc";
    g.rules[0].once = false;
    g.settings.scoring.speedBonus = true;
    for (const code of ["rule_message_from", "rule_repeat", "night_speed_bonus"]) {
      const issue = find(g, code)[0]!;
      expect(issue.fix).toBeDefined();
      issue.fix!.apply(g as Game, {});
    }
    expect(g.rules[0].then[1].message.from).toBe("hq");
    expect("once" in g.rules[0]).toBe(false);
    expect("speedBonus" in g.settings.scoring).toBe(false);
    expect(validateDraft(g as Game, {}).filter((i) => ["rule_message_from", "rule_repeat", "night_speed_bonus"].includes(i.code))).toEqual([]);
  });
});
