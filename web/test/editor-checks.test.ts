import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKS } from "../src/lib/editor/checks.ts";
import type { EditorIssue, EditorMeta, Game } from "../src/lib/editor/types.ts";
import { validateDraft } from "../src/lib/editor/validation.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
type Loose = Record<string, any>;
/** Station ohne enge Typen: die Fälle verbiegen absichtlich Rätsel und Auslöser. */
const st = (g: Game, id: string): Loose => g.stations.find((s) => s.id === id)!;

const codes = (g: Game, meta: EditorMeta = {}) => validateDraft(g, meta).map((i) => i.code);
const find = (g: Game, code: string, meta: EditorMeta = {}) => validateDraft(g, meta).filter((i) => i.code === code);

/** Je Code ein Positiv- und ein Negativfall; das Beispielspiel ist der Negativfall, wenn nichts anderes steht. */
const CASES: [string, (g: Loose) => void, { severity: EditorIssue["severity"]; path?: string; negative?: (g: Loose) => void; text?: string }][] = [
  ["empty_required_text", (g) => (g.meta.title = { de: "  " }), { severity: "error", path: "/meta/title", text: "Der Titel ist leer." }],
  ["empty_required_text", (g) => (st(g as Game, "baum").hints![1]!.text = { de: "" }), { severity: "error", path: "/stations/1/hints/1/text", text: "Tipp 2 ist leer." }],
  ["empty_required_text", (g) => (g.field.restrictedZones[0].name = ""), { severity: "error", path: "/field/restrictedZones/0/name" }],
  ["empty_answer", (g) => (st(g as Game, "baum").task!.answers = ["Eule", "   "]), { severity: "error", path: "/stations/1/task/answers/1" }],
  ["choice_no_correct", (g) => st(g as Game, "briefing").task!.options.forEach((o: Loose) => (o.correct = false)), { severity: "error", path: "/stations/0/task/options", text: "Bei Station „Sicherheits-Briefing“ ist keine Antwort als richtig markiert – so ist die Aufgabe unlösbar." }],
  ["lock_not_numeric", (g) => { st(g as Game, "schloss").task!.input = "lock"; st(g as Game, "schloss").task!.answers = ["ABC"]; }, { severity: "error", path: "/stations/2/task/answers", negative: (g) => { st(g as Game, "schloss").task!.input = "lock"; st(g as Game, "schloss").task!.answers = ["372", "123"]; } }],
  ["lock_not_numeric", (g) => { st(g as Game, "schloss").task!.input = "lock"; st(g as Game, "schloss").task!.answers = ["372", "12"]; }, { severity: "error" }],
  ["fragment_unassigned", (g) => (st(g as Game, "versteck").rewards = {}), { severity: "error", path: "/fragments/2", text: "Codeteil 3 bekommt man nirgends – das Finale öffnet sich nie." }],
  ["final_without_task", (g) => delete st(g as Game, "finale").task, { severity: "error", path: "/stations/4/task" }],
  ["final_hidden_unreachable", (g) => (st(g as Game, "finale").visibility = "hidden"), { severity: "error", path: "/stations/4/visibility", negative: (g) => { st(g as Game, "finale").visibility = "hidden"; st(g as Game, "finale").revealRadius = 30; } }],
  ["duplicate_code", (g) => (st(g as Game, "schloss").triggers[1] = { type: "qr", code: "LYK-BRIEFING" }), { severity: "error", path: "/stations/2/triggers/1/code", text: "Der Code LYK-BRIEFING gehört zu zwei Stationen – die App öffnet immer die erste." }],
  ["duplicate_code", (g) => (st(g as Game, "schloss").triggers[1] = { type: "qr", code: "4711" }), { severity: "error", path: "/stations/2/triggers/1/code" }],
  ["nfc_not_uid", () => undefined, { severity: "error", path: "/stations/1/triggers/1/tag", negative: (g) => (st(g as Game, "baum").triggers[1] = { type: "nfc", tag: "04:A1:B2:C3:D4:E5:F6" }) }],
  ["media_wrong_type", (g) => { g.media.push({ id: "bild", type: "image", src: "m.jpg" }); st(g as Game, "baum").scene!.beats![0]!.image = "wind"; }, { severity: "error", path: "/stations/1/scene/beats/0/image", text: "Hier passt nur ein Bild." }],
  ["media_wrong_type", (g) => { g.media.push({ id: "bild", type: "image", src: "m.jpg" }); g.story.intro.media = ["bild"]; }, { severity: "error", path: "/story/intro/media/0", text: "Hier passt nur ein Klang." }],
  ["media_wrong_type", (g) => { g.media.push({ id: "bild", type: "image", src: "m.jpg" }); g.characters[1].portrait = "wind"; g.items[0].image = "bild"; }, { severity: "error", path: "/characters/1/portrait" }],
  ["team_size_order", (g) => (g.settings.teamSize = { min: 6, max: 2 }), { severity: "error", path: "/settings/teamSize/min" }],
  ["final_code_mismatch", (g) => (st(g as Game, "finale").task!.answers = ["999"]), { severity: "warning", path: "/stations/4/task/answers", text: "Die Antwort des Finales ist nicht der Code aus den Teilen (191). Dann zeigt die App kein „Letztes Schloss“." }],
  ["no_final", (g) => { st(g as Game, "finale").final = false; g.fragments = []; g.stations.forEach((s: Loose) => delete s.rewards?.fragments); }, { severity: "hint", path: "/stations" }],
  ["station_no_task", (g) => delete st(g as Game, "baum").task, { severity: "hint", path: "/stations/1/task" }],
  ["gps_only", (g) => (st(g as Game, "baum").triggers = [{ type: "gps" }]), { severity: "warning", path: "/stations/1/triggers" }],
  ["no_location", (g) => { delete st(g as Game, "baum").location; st(g as Game, "baum").triggers = [{ type: "manual", code: "4711" }]; }, { severity: "hint", path: "/stations/1/location", negative: (g) => { delete st(g as Game, "baum").location; st(g as Game, "baum").triggers = [{ type: "gps", location: { lat: 1, lon: 2 } }]; } }],
  ["time_limit_no_duration", (g) => delete g.settings.time.duration, { severity: "hint", path: "/settings/time/duration", negative: (g) => (g.settings.time = { limit: "none" }) }],
  ["hint_free", (g) => st(g as Game, "baum").hints!.push({ text: { de: "Vierter" } }), { severity: "hint", path: "/stations/1/hints/3", text: "Tipp 4 ist kostenlos, weil keine Kosten für diese Stufe festgelegt sind.", negative: (g) => st(g as Game, "baum").hints!.push({ text: { de: "Vierter" }, cost: { type: "time", amount: 60 } }) }],
  ["no_age_group", (g) => (g.meta.ageGroups = []), { severity: "hint", path: "/meta/ageGroups", negative: (g) => { g.meta.ageGroups = []; g.safety.requireSupervisor = false; } }],
  ["supervisor_off_minors", (g) => (g.safety.requireSupervisor = false), { severity: "warning", path: "/safety/requireSupervisor", negative: (g) => { g.safety.requireSupervisor = false; g.meta.ageGroups = ["adult"]; } }],
  ["languages_extra", () => undefined, { severity: "hint", path: "/meta/languages", negative: (g) => (g.meta.languages = ["de"]) }],
  ["short_answer", (g) => (st(g as Game, "baum").task!.answers = ["Uhu"]), { severity: "hint", path: "/stations/1/task/answers", negative: (g) => (st(g as Game, "baum").task!.answers = ["Eule"]) }],
];

describe("Baukasten-Prüfungen", () => {
  for (const [code, mutate, want] of CASES) {
    it(`${code}: ${want.path ?? "Positivfall"}`, () => {
      const g = load() as Loose;
      mutate(g);
      const hits = find(g as Game, code);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      const hit = want.path ? hits.find((i) => i.at.path === want.path) : hits[0];
      expect(hit, `Meldung ${code} an ${want.path}`).toBeDefined();
      expect(hit!.severity).toBe(want.severity);
      expect(hit!.source).toBe("editor");
      expect(hit!.dismissable).toBe(want.severity !== "error");
      if (want.text) expect(hit!.message).toBe(want.text);
      const ok = load() as Loose;
      want.negative?.(ok);
      expect(codes(ok as Game)).not.toContain(code);
    });
  }

  it("Sofort-Lösungen: Teamgröße tauschen und Finalcode übernehmen", () => {
    const g = load();
    g.settings.teamSize = { min: 6, max: 2 };
    st(g, "finale").task!.answers = ["999"];
    const fixes = validateDraft(g, {}).filter((i) => i.fix);
    expect(fixes.map((i) => [i.code, i.fix!.label])).toEqual([
      ["final_code_mismatch", "Antwort übernehmen"],
      ["team_size_order", "Werte tauschen"],
    ]);
    for (const i of fixes) i.fix!.apply(g, {});
    expect(g.settings.teamSize).toEqual({ min: 2, max: 6 });
    expect(st(g, "finale").task!.answers).toEqual(["191"]);
    expect(codes(g)).not.toContain("team_size_order");
    expect(codes(g)).not.toContain("final_code_mismatch");
  });

  it("Finale versteckt: der Baukasten-Fehler ersetzt die Kern-Warnung", () => {
    const g = load();
    st(g, "finale").visibility = "hidden";
    const c = codes(g);
    expect(c).toContain("final_hidden_unreachable");
    expect(c).not.toContain("hidden_unreachable");
  });

  it("halten kaputte Entwürfe aus", () => {
    const broken = { format: { name: "lykora-game", version: "0.1" }, stations: [null, { id: "x", triggers: [null, { type: "qr" }], hints: [null], scene: { beats: [null, { kind: "radio", responses: [null] }] }, task: { type: "choice", options: [null] } }], fragments: [null], rules: [null, { id: "r", then: [null], when: [null] }], media: [null], items: [null], characters: [null], story: { chapters: [null] }, field: { restrictedZones: [null] } } as unknown as Game;
    for (const check of CHECKS) expect(() => check(broken, {}, "de")).not.toThrow();
    expect(() => validateDraft(broken, {})).not.toThrow();
  });
});
