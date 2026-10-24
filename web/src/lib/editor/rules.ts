/**
 * Paket D: Regeln als Sätze aus Bausteinen (UX §11). Eine Regel hat feste Zeilen SOBALD (erste
 * Bedingung), UND (weitere), DANN und SONST; darüber steht der fertige Satz. Neue Bausteine sind
 * absichtlich unfertig (Station noch nicht gewählt) – die Prüfung meldet das als incomplete_rule.
 * Dazu die Wirkungen aus den Stationsbelohnungen („Außerdem passiert“) und die Rezepte für „+ Neue Regel“.
 */

import { readText } from "./text.ts";
import type { EditorMeta, Game } from "./types.ts";

export type Rule = NonNullable<Game["rules"]>[number];
export type Condition = Rule["when"][number];
export type Action = Rule["then"][number];
export type ConditionKind = "station_solved" | "has_item" | "fragments_collected" | "elapsed" | "near";
export type ActionKind = "reveal_station" | "give_item" | "add_points" | "message" | "start_chapter";
export type Sender = "hq" | "narrator" | "npc";

export const CONDITION_KINDS: ConditionKind[] = ["station_solved", "has_item", "fragments_collected", "elapsed", "near"];
export const ACTION_KINDS: ActionKind[] = ["reveal_station", "give_item", "add_points", "message", "start_chapter"];

export const CONDITION_LABELS: Record<ConditionKind, string> = {
  station_solved: "Station gelöst",
  has_item: "Team hat Gegenstand",
  fragments_collected: "Codeteile gesammelt",
  elapsed: "Spielzeit",
  near: "In der Nähe",
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  reveal_station: "Station erscheint",
  give_item: "Gegenstand geben",
  add_points: "Punkte",
  message: "Funkspruch",
  start_chapter: "Kapitel beginnt",
};

export const SENDER_LABELS: Record<Sender, string> = { hq: "Zentrale", narrator: "Erzähler", npc: "Figur" };

/** Standardwerte neuer Bausteine: 30 Minuten Spielzeit, 30 m Umkreis, 50 Punkte, ein Codeteil. */
export const DEFAULT_ELAPSED = 1800;
export const DEFAULT_NEAR_RADIUS = 30;
export const DEFAULT_POINTS = 50;

/** Art einer Bedingung; null bei unbekannter oder unfertiger (kein oder mehr als ein Schlüssel). */
export function conditionKind(c: unknown): ConditionKind | null {
  const keys = c && typeof c === "object" ? Object.keys(c) : [];
  return keys.length === 1 && CONDITION_KINDS.includes(keys[0] as ConditionKind) ? (keys[0] as ConditionKind) : null;
}

export function actionKind(a: unknown): ActionKind | null {
  const keys = a && typeof a === "object" ? Object.keys(a) : [];
  return keys.length === 1 && ACTION_KINDS.includes(keys[0] as ActionKind) ? (keys[0] as ActionKind) : null;
}

/** Neue Bedingung; Verweise bleiben leer (unfertig), „In der Nähe“ noch ohne Ort. */
export function newCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case "station_solved":
      return { station_solved: "" };
    case "has_item":
      return { has_item: "" };
    case "fragments_collected":
      return { fragments_collected: 1 };
    case "elapsed":
      return { elapsed: DEFAULT_ELAPSED };
    case "near":
      return { near: { radius: DEFAULT_NEAR_RADIUS } } as Condition;
  }
}

/** Neue Aktion; Funksprüche kommen ausdrücklich von der Zentrale (nur sie erscheint sauber im Funk-Protokoll). */
export function newAction(kind: ActionKind, lang = "de"): Action {
  switch (kind) {
    case "reveal_station":
      return { reveal_station: "" };
    case "give_item":
      return { give_item: "" };
    case "add_points":
      return { add_points: DEFAULT_POINTS };
    case "message":
      return { message: { from: "hq", text: { [lang]: "" } } };
    case "start_chapter":
      return { start_chapter: "" };
  }
}

export interface Recipe {
  id: string;
  label: string;
  when: ConditionKind;
  then: ActionKind;
}

/** „+ Neue Regel ▾“: Rezepte, die die Bausteine vorausfüllen. */
export const RECIPES: Recipe[] = [
  { id: "leer", label: "Leere Regel", when: "station_solved", then: "message" },
  { id: "zeigen", label: "Versteckte Station nach einer anderen zeigen", when: "station_solved", then: "reveal_station" },
  { id: "funken", label: "Nach … Minuten etwas funken", when: "elapsed", then: "message" },
  { id: "gegenstand", label: "Wer einen Gegenstand hat, bekommt eine Station", when: "has_item", then: "reveal_station" },
  { id: "kapitel", label: "Nach … Codeteilen ein neues Kapitel", when: "fragments_collected", then: "start_chapter" },
  { id: "naehe", label: "Nachricht, wenn ein Team in die Nähe kommt", when: "near", then: "message" },
];

/** Kennung regel-<n> (kleinstes freies n); sie ändert sich nie mehr, der Satz dient als Name. */
export function newRuleId(game: Game | undefined): string {
  const taken = new Set((game?.rules ?? []).map((r) => r?.id));
  for (let n = 1; ; n++) if (!taken.has(`regel-${n}`)) return `regel-${n}`;
}

/** Neue, noch unfertige Regel: SOBALD „Station … ist gelöst“, DANN Funkspruch der Zentrale. */
export function newRule(game?: Game, lang = "de", recipe: Recipe = RECIPES[0]!): Rule {
  return { id: newRuleId(game), when: [newCondition(recipe.when)], then: [newAction(recipe.then, lang)] };
}

// Unfertige Bausteine

export type Missing = "station" | "item" | "chapter" | "text" | "place";

/** Was ein Baustein noch braucht, als Satz für das Feld. */
export const MISSING_TEXT: Record<Missing, string> = {
  station: "Wähl eine Station.",
  item: "Wähl einen Gegenstand.",
  chapter: "Wähl ein Kapitel.",
  text: "Schreib, was gefunkt wird.",
  place: "Setz den Ort auf der Karte.",
};

const REF_MISSING: Partial<Record<ConditionKind | ActionKind, Missing>> = {
  station_solved: "station",
  has_item: "item",
  reveal_station: "station",
  give_item: "item",
  start_chapter: "chapter",
};

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Was einem Baustein fehlt (null = fertig); unbekannte Arten meldet das Schema. */
export function missingOf(block: unknown, lang: string): { at: string; missing: Missing } | null {
  const kind = conditionKind(block) ?? actionKind(block);
  if (!kind) return null;
  const value = (block as Record<string, unknown>)[kind];
  const ref = REF_MISSING[kind];
  if (ref) return filled(value) ? null : { at: kind, missing: ref };
  if (kind === "near") {
    const loc = (value as { location?: unknown } | undefined)?.location;
    return loc && typeof loc === "object" ? null : { at: "near/location", missing: "place" };
  }
  if (kind === "message") {
    const text = (value as { text?: unknown } | undefined)?.text;
    return readText(text as never, lang).trim() ? null : { at: "message/text", missing: "text" };
  }
  return null;
}

/** Alle unfertigen Bausteine einer Regel mit Pfad relativ zur Regel, z. B. "when/0/station_solved". */
export function incompleteParts(rule: Rule, lang: string): { path: string; missing: Missing }[] {
  const out: { path: string; missing: Missing }[] = [];
  for (const key of ["when", "then", "else"] as const) {
    const list: unknown = rule[key];
    if (!Array.isArray(list)) continue;
    list.forEach((block, j) => {
      const m = missingOf(block, lang);
      if (m) out.push({ path: `${key}/${j}/${m.at}`, missing: m.missing });
    });
  }
  return out;
}

// Sätze

const q = (s: string) => `„${s}“`;
const GAP = "…";

function nameIn(list: { id?: string; name?: unknown; title?: unknown }[] | undefined, id: unknown, lang: string): string {
  if (typeof id !== "string" || !id) return GAP;
  const e = (list ?? []).find((x) => x?.id === id);
  return readText((e?.name ?? e?.title) as never, lang) || id;
}

const stationName = (g: Game, id: unknown, lang: string) => nameIn(g.stations, id, lang);
const itemName = (g: Game, id: unknown, lang: string) => nameIn(g.items, id, lang);
const chapterName = (g: Game, id: unknown, lang: string) => nameIn(g.story?.chapters, id, lang);

/** Minuten in Worten: 1800 → „30“, 90 → „1,5“. */
export function minutesText(seconds: number): string {
  return String(Math.round(seconds / 6) / 10).replace(".", ",");
}

function excerpt(value: string, max = 60): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Bedingung als Nebensatz (Verb am Ende): „„Die Kiste“ gelöst ist“. placeName: Name des Regelorts. */
export function conditionClause(c: Condition, game: Game, lang: string, placeName?: string): string {
  const kind = conditionKind(c);
  const v = kind ? (c as Record<string, unknown>)[kind] : undefined;
  switch (kind) {
    case "station_solved":
      return `${q(stationName(game, v, lang))} gelöst ist`;
    case "has_item":
      return `das Team ${q(itemName(game, v, lang))} hat`;
    case "fragments_collected": {
      const n = typeof v === "number" ? v : 0;
      return `das Team mindestens ${n} ${n === 1 ? "Codeteil" : "Codeteile"} hat`;
    }
    case "elapsed":
      return `das Team ${typeof v === "number" ? minutesText(v) : GAP} Minuten spielt`;
    case "near": {
      const r = (v as { radius?: number } | undefined)?.radius;
      const radius = typeof r === "number" ? `${r} m` : `${GAP} m`;
      return placeName ? `das Team in der Nähe von ${q(placeName)} ist (${radius})` : `das Team im Umkreis von ${radius} um den Regelort ist`;
    }
    default:
      return "eine unfertige Bedingung zutrifft";
  }
}

/**
 * Aktion als Satzteil. first: direkt nach dem Sobald-Satz oder „Sonst“ steht das Verb vorn
 * („erscheint „Versteck““), danach das Subjekt („und die Zentrale funkt: …“).
 */
export function actionClause(a: Action, game: Game, lang: string, first: boolean): string {
  const kind = actionKind(a);
  const v = kind ? (a as Record<string, unknown>)[kind] : undefined;
  const say = (subject: string, verb: string, rest: string) => (first ? `${verb} ${subject}${rest}` : `${subject} ${verb}${rest}`);
  switch (kind) {
    case "reveal_station":
      return say(q(stationName(game, v, lang)), "erscheint", "");
    case "give_item":
      return say("das Team", "bekommt", ` ${q(itemName(game, v, lang))}`);
    case "add_points": {
      const n = typeof v === "number" ? v : 0;
      const points = `${Math.abs(n)} ${Math.abs(n) === 1 ? "Punkt" : "Punkte"}`;
      return say("das Team", n < 0 ? "verliert" : "bekommt", ` ${points}`);
    }
    case "message": {
      const m = (v ?? {}) as { from?: Sender; text?: unknown };
      const text = q(excerpt(readText(m.text as never, lang)) || GAP);
      if (m.from === "narrator") return say("der Erzähler", "sagt", `: ${text}`);
      if (m.from === "npc") return say("eine Figur", "sagt", `: ${text}`);
      return say("die Zentrale", "funkt", `: ${text}`);
    }
    case "start_chapter":
      return say(`Kapitel ${q(chapterName(game, v, lang))}`, "beginnt", "");
    default:
      return first ? "passiert etwas Unfertiges" : "etwas Unfertiges passiert";
  }
}

const joinAnd = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`);

function actionsText(list: Action[] | undefined, game: Game, lang: string): string {
  const actions = (list ?? []).filter((a) => a && typeof a === "object");
  if (!actions.length) return "passiert noch nichts";
  return joinAnd(actions.map((a, i) => actionClause(a, game, lang, i === 0)));
}

/** Pointer einer Bedingung, Schlüssel für meta.placeNames. */
export const conditionPointer = (ruleIndex: number, j: number) => `/rules/${ruleIndex}/when/${j}`;

/**
 * Die Regel als Satz – zugleich ihr Name im Baukasten:
 * „Sobald „Die Kiste“ gelöst ist, erscheint „Das Versteck“ und die Zentrale funkt: „Neue Spur!““
 */
export function ruleSentence(rule: Rule, game: Game, lang: string, opts: { meta?: EditorMeta; index?: number } = {}): string {
  const when = (rule?.when ?? []).filter((c) => c && typeof c === "object");
  const place = (j: number) => (opts.index === undefined ? undefined : opts.meta?.placeNames?.[conditionPointer(opts.index, j)]);
  const conditions = when.length ? joinAnd(when.map((c, j) => conditionClause(c, game, lang, place(j)))) : GAP;
  let out = `Sobald ${conditions}, ${actionsText(rule?.then, game, lang)}.`;
  if (rule?.else?.length) out += ` Sonst ${actionsText(rule.else, game, lang)}.`;
  return out;
}

/**
 * Regelorte (meta.placeNames, Schlüssel = Pointer der Bedingung) über eine Umbau-Mutation retten:
 * Namen hängen vorher am Bedingungsobjekt und bekommen danach den neuen Pointer. Entfallene Bedingungen
 * verlieren ihren Namen.
 */
export function keepPlaceNames(game: Game, meta: EditorMeta, mutate: () => void): void {
  const names = new Map<object, string>();
  (game.rules ?? []).forEach((r, i) =>
    (r?.when ?? []).forEach((c, j) => {
      const name = meta.placeNames?.[conditionPointer(i, j)];
      if (name && c) names.set(c, name);
    }),
  );
  mutate();
  const next: Record<string, string> = {};
  (game.rules ?? []).forEach((r, i) =>
    (r?.when ?? []).forEach((c, j) => {
      const name = c ? names.get(c) : undefined;
      if (name) next[conditionPointer(i, j)] = name;
    }),
  );
  if (Object.keys(next).length) meta.placeNames = next;
  else delete meta.placeNames;
}

// Außerdem passiert (aus den Stationen)

/** Wirkungen aus Stationsbelohnungen als Lesesätze: „„Briefing“ gelöst → Kapitel „Die Spur“ beginnt, „UV-Lampe““. */
export function alsoHappens(game: Game, lang: string): { stationId: string; text: string }[] {
  const out: { stationId: string; text: string }[] = [];
  for (const s of game.stations ?? []) {
    const r = s?.rewards;
    if (!r) continue;
    const parts: string[] = [];
    if (r.chapter) parts.push(`Kapitel ${q(chapterName(game, r.chapter, lang))} beginnt`);
    for (const id of r.reveal ?? []) parts.push(`${q(stationName(game, id, lang))} erscheint`);
    for (const id of r.items ?? []) parts.push(`das Team bekommt ${q(itemName(game, id, lang))}`);
    if (parts.length) out.push({ stationId: s.id, text: `${q(stationName(game, s.id, lang))} gelöst → ${parts.join(", ")}` });
  }
  return out;
}
