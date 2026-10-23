import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateGame } from "@lykora/spec";
import {
  ACTION_KINDS,
  actionClause,
  actionKind,
  alsoHappens,
  CONDITION_KINDS,
  conditionClause,
  conditionKind,
  incompleteParts,
  keepPlaceNames,
  newAction,
  newCondition,
  newRule,
  RECIPES,
  ruleSentence,
  type Action,
  type Condition,
  type Rule,
} from "../src/lib/editor/rules.ts";
import type { EditorMeta, Game } from "../src/lib/editor/types.ts";
import { validateDraft } from "../src/lib/editor/validation.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

describe("Bausteine", () => {
  it("erkennt Art von Bedingung und Aktion, unfertige Objekte ohne Art", () => {
    for (const kind of CONDITION_KINDS) expect(conditionKind(newCondition(kind))).toBe(kind);
    for (const kind of ACTION_KINDS) expect(actionKind(newAction(kind))).toBe(kind);
    expect(conditionKind({})).toBeNull();
    expect(actionKind({ reveal_station: "a", give_item: "b" })).toBeNull();
    expect(conditionKind(null)).toBeNull();
  });

  it("legt neue Bausteine unfertig an, Funksprüche von der Zentrale", () => {
    expect(newCondition("station_solved")).toEqual({ station_solved: "" });
    expect(newCondition("near")).toEqual({ near: { radius: 30 } });
    expect(newCondition("elapsed")).toEqual({ elapsed: 1800 });
    expect(newAction("message", "en")).toEqual({ message: { from: "hq", text: { en: "" } } });
    expect(newAction("add_points")).toEqual({ add_points: 50 });
  });
});

describe("newRule", () => {
  it("ist unfertig und meldet incomplete_rule, nach der Auswahl ist sie gültig", () => {
    const g = load();
    const rule = newRule(g, "de");
    expect(rule).toEqual({ id: "regel-1", when: [{ station_solved: "" }], then: [{ message: { from: "hq", text: { de: "" } } }] });
    expect(incompleteParts(rule, "de")).toEqual([
      { path: "when/0/station_solved", missing: "station" },
      { path: "then/0/message/text", missing: "text" },
    ]);
    g.rules!.push(rule);
    const before = validateDraft(g, {}).filter((i) => i.at.path.startsWith("/rules/1"));
    expect(before.some((i) => i.code === "incomplete_rule" && i.at.path === "/rules/1/then/0/message/text")).toBe(true);
    expect(before.some((i) => i.severity === "error" && i.at.path === "/rules/1/when/0/station_solved")).toBe(true);

    const r = g.rules![1]!;
    r.when[0] = { station_solved: "baum" };
    r.then[0] = { message: { from: "hq", text: { de: "Gut gemacht!" } } };
    expect(incompleteParts(r, "de")).toEqual([]);
    expect(validateDraft(g, {}).filter((i) => i.at.path.startsWith("/rules/1") && i.severity === "error")).toEqual([]);
    expect(validateGame(g).errors).toEqual([]);
  });

  it("vergibt regel-<n> und folgt dem Rezept", () => {
    const g = load();
    g.rules!.push({ id: "regel-1", when: [{ elapsed: 60 }], then: [{ add_points: 5 }] });
    const recipe = RECIPES.find((r) => r.id === "naehe")!;
    expect(newRule(g, "de", recipe)).toEqual({ id: "regel-2", when: [{ near: { radius: 30 } }], then: [{ message: { from: "hq", text: { de: "" } } }] });
    expect(incompleteParts(newRule(g, "de", recipe), "de").map((p) => p.missing)).toEqual(["place", "text"]);
    expect(newRule(undefined).id).toBe("regel-1");
  });

  it("baut die Regel des Beispielspiels nach (deep-equal rules[0])", () => {
    const g = load();
    const expected = load().rules![0]!;
    g.rules = [];
    const rule = newRule(g, "de", RECIPES.find((r) => r.id === "zeigen")!);
    rule.when[0] = { station_solved: "schloss" };
    rule.then[0] = { reveal_station: "versteck" };
    const message = newAction("message", "de");
    if ("message" in message) message.message.text = { de: "Neue Spur! Auf eurer Karte ist ein Versteck aufgetaucht." };
    rule.then.push(message);
    expect({ ...rule, id: expected.id }).toEqual(expected);
    expect(incompleteParts(rule, "de")).toEqual([]);
  });
});

describe("ruleSentence", () => {
  const g = load();
  g.items!.push({ id: "karte", name: { de: "Schatzkarte" } });

  it("liest die Regel des Beispielspiels als Satz", () => {
    expect(ruleSentence(g.rules![0]!, g, "de")).toBe("Sobald „Die verschlossene Kiste“ gelöst ist, erscheint „Das Versteck“ und die Zentrale funkt: „Neue Spur! Auf eurer Karte ist ein Versteck aufgetaucht.“.");
  });

  it("hat einen Satzteil für jede Bedingung", () => {
    const cases: [Condition, string][] = [
      [{ station_solved: "baum" }, "„Der alte Baum“ gelöst ist"],
      [{ station_solved: "" }, "„…“ gelöst ist"],
      [{ has_item: "uv-lampe" }, "das Team „UV-Lampe“ hat"],
      [{ fragments_collected: 1 }, "das Team mindestens 1 Codeteil hat"],
      [{ fragments_collected: 2 }, "das Team mindestens 2 Codeteile hat"],
      [{ elapsed: 3600 }, "das Team 60 Minuten spielt"],
      [{ elapsed: 90 }, "das Team 1,5 Minuten spielt"],
      [{ near: { location: { lat: 50, lon: 7 }, radius: 25 } }, "das Team im Umkreis von 25 m um den Regelort ist"],
    ];
    for (const [c, text] of cases) expect(conditionClause(c, g, "de")).toBe(text);
    expect(conditionClause({ near: { location: { lat: 50, lon: 7 }, radius: 30 } }, g, "de", "Brücke")).toBe("das Team in der Nähe von „Brücke“ ist (30 m)");
    expect(conditionClause({} as Condition, g, "de")).toBe("eine unfertige Bedingung zutrifft");
  });

  it("hat für jede Aktion zwei Wortstellungen", () => {
    const cases: [Action, string, string][] = [
      [{ reveal_station: "versteck" }, "erscheint „Das Versteck“", "„Das Versteck“ erscheint"],
      [{ give_item: "karte" }, "bekommt das Team „Schatzkarte“", "das Team bekommt „Schatzkarte“"],
      [{ add_points: 50 }, "bekommt das Team 50 Punkte", "das Team bekommt 50 Punkte"],
      [{ add_points: -1 }, "verliert das Team 1 Punkt", "das Team verliert 1 Punkt"],
      [{ message: { text: { de: "Los!" } } }, "funkt die Zentrale: „Los!“", "die Zentrale funkt: „Los!“"],
      [{ message: { from: "narrator", text: { de: "Still." } } }, "sagt der Erzähler: „Still.“", "der Erzähler sagt: „Still.“"],
      [{ message: { from: "npc", text: { de: "" } } }, "sagt eine Figur: „…“", "eine Figur sagt: „…“"],
      [{ start_chapter: "kapitel-3" }, "beginnt Kapitel „Das Signal“", "Kapitel „Das Signal“ beginnt"],
    ];
    for (const [a, first, later] of cases) {
      expect(actionClause(a, g, "de", true)).toBe(first);
      expect(actionClause(a, g, "de", false)).toBe(later);
    }
  });

  it("verbindet UND, mehrere Aktionen und Sonst", () => {
    const rule: Rule = {
      id: "r",
      when: [{ station_solved: "baum" }, { has_item: "uv-lampe" }, { elapsed: 600 }],
      then: [{ start_chapter: "kapitel-2" }, { add_points: 20 }, { give_item: "karte" }],
      else: [{ add_points: -10 }],
    };
    expect(ruleSentence(rule, g, "de")).toBe(
      "Sobald „Der alte Baum“ gelöst ist, das Team „UV-Lampe“ hat und das Team 10 Minuten spielt, beginnt Kapitel „Die Spur im Wald“, das Team bekommt 20 Punkte und das Team bekommt „Schatzkarte“. Sonst verliert das Team 10 Punkte.",
    );
    expect(ruleSentence({ id: "x", when: [], then: [] } as unknown as Rule, g, "de")).toBe("Sobald …, passiert noch nichts.");
  });

  it("nennt den Regelort aus meta.placeNames", () => {
    const rule: Rule = { id: "n", when: [{ near: { location: { lat: 50, lon: 7 }, radius: 40 } }], then: [{ add_points: 5 }] };
    const meta: EditorMeta = { placeNames: { "/rules/3/when/0": "Alte Mühle" } };
    expect(ruleSentence(rule, g, "de", { meta, index: 3 })).toBe("Sobald das Team in der Nähe von „Alte Mühle“ ist (40 m), bekommt das Team 5 Punkte.");
  });

  it("kürzt lange Funksprüche", () => {
    const text = "Achtung, alle Teams: Der Sturm zieht schneller auf als gedacht, sucht sofort Schutz an der Hütte.";
    expect(actionClause({ message: { text: { de: text } } }, g, "de", true)).toBe("funkt die Zentrale: „Achtung, alle Teams: Der Sturm zieht schneller auf als geda…“");
  });
});

describe("keepPlaceNames", () => {
  it("lässt Namen beim Umbau mit ihrer Bedingung wandern", () => {
    const g = load();
    const near = (lat: number): Condition => ({ near: { location: { lat, lon: 7 }, radius: 30 } });
    g.rules!.push({ id: "orte", when: [near(50), near(51)], then: [{ add_points: 1 }] });
    const meta: EditorMeta = { placeNames: { "/rules/1/when/0": "Mühle", "/rules/1/when/1": "Brücke" } };
    keepPlaceNames(g, meta, () => {
      g.rules![1]!.when.splice(0, 1);
      g.rules!.splice(0, 1);
    });
    expect(meta.placeNames).toEqual({ "/rules/0/when/0": "Brücke" });
    keepPlaceNames(g, meta, () => g.rules!.splice(0, 1));
    expect(meta.placeNames).toBeUndefined();
  });
});

describe("alsoHappens", () => {
  it("nennt die Wirkungen aus den Stationsbelohnungen", () => {
    expect(alsoHappens(load(), "de")).toEqual([
      { stationId: "briefing", text: "„Sicherheits-Briefing“ gelöst → Kapitel „Die Spur im Wald“ beginnt, das Team bekommt „UV-Lampe“" },
      { stationId: "schloss", text: "„Die verschlossene Kiste“ gelöst → Kapitel „Das Signal“ beginnt" },
    ]);
    const g = load();
    g.stations.find((s) => s.id === "baum")!.rewards = { reveal: ["versteck"], fragments: ["f1"] };
    expect(alsoHappens(g, "de")[1]).toEqual({ stationId: "baum", text: "„Der alte Baum“ gelöst → „Das Versteck“ erscheint" });
  });
});
