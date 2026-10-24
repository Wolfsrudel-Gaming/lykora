/**
 * Paket A: Was sich zwischen zwei Ständen geändert hat, in deutschen Sätzen – für den
 * Konfliktdialog („Anna hat 2 Stationen geändert“) und „Was ist neu“ vor dem Veröffentlichen.
 * Verglichen wird je Station, Regel, Figur, Kapitel, Gegenstand, Codeteil, Sperrzone, Medium
 * und je Bereich per JSON.stringify.
 */

import { readText } from "./text.ts";
import type { Game, Section } from "./types.ts";

export interface DiffEntry {
  section: Section;
  objectId?: string;
  kind: "added" | "removed" | "changed";
  /** z. B. „Station „Baum“ geändert“ */
  text: string;
}

type Json = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const list = (x: unknown): Json[] => (Array.isArray(x) ? x.filter((e) => e && typeof e === "object") : []);

const VERBS = { added: "hinzugefügt", removed: "entfernt", changed: "geändert" } as const;

interface ListSpec {
  section: Section;
  noun: string;
  get: (g: Game) => unknown;
  name: (e: Json, lang: string) => string;
}

const byName = (e: Json, lang: string) => readText((e.name ?? e.title) as never, lang) || String(e.id ?? "");
const LISTS: ListSpec[] = [
  { section: "stationen", noun: "Station", get: (g) => g.stations, name: byName },
  { section: "regeln", noun: "Regel", get: (g) => g.rules, name: (e) => String(e.id ?? "") },
  { section: "geschichte", noun: "Figur", get: (g) => g.characters, name: byName },
  { section: "geschichte", noun: "Kapitel", get: (g) => g.story?.chapters, name: byName },
  { section: "belohnungen", noun: "Gegenstand", get: (g) => g.items, name: byName },
  { section: "belohnungen", noun: "Codeteil", get: (g) => g.fragments, name: (e) => `${typeof e.position === "number" ? e.position : "?"}` },
  { section: "karte", noun: "Sperrzone", get: (g) => g.field?.restrictedZones, name: byName },
  { section: "medien", noun: "Medium", get: (g) => g.media, name: (e) => String(e.id ?? "") },
];

/** Bereiche ohne eigene IDs; die Listen oben sind herausgerechnet. */
const AREAS: { section: Section; label: string; get: (g: Game) => unknown }[] = [
  { section: "einstellungen", label: "Kennung und Format", get: (g) => [g.id, g.format] },
  { section: "geschichte", label: "Angaben zum Spiel", get: (g) => [g.meta, g.presentation] },
  { section: "einstellungen", label: "Grundregeln", get: (g) => g.settings },
  { section: "karte", label: "Spielfeld", get: (g) => ({ ...(g.field ?? {}), restrictedZones: undefined }) },
  { section: "geschichte", label: "Geschichte", get: (g) => ({ ...(g.story ?? {}), chapters: undefined }) },
  { section: "sicherheit", label: "Sicherheit", get: (g) => g.safety },
  { section: "klang", label: "Klang", get: (g) => g.sound },
];

/** Unterschiede von a nach b, Listen zuerst (Objekte mit Namen), dann die Bereiche. */
export function diffSummary(a: Game, b: Game): DiffEntry[] {
  const out: DiffEntry[] = [];
  const lang = b?.meta?.languages?.[0] ?? a?.meta?.languages?.[0] ?? "de";
  for (const spec of LISTS) {
    const before = new Map(list(spec.get(a)).map((e) => [String(e.id ?? ""), e]));
    const after = new Map(list(spec.get(b)).map((e) => [String(e.id ?? ""), e]));
    for (const [id, e] of after) {
      const old = before.get(id);
      const kind = old === undefined ? "added" : same(old, e) ? null : "changed";
      if (kind) out.push({ section: spec.section, objectId: id || undefined, kind, text: `${spec.noun} „${spec.name(e, lang)}“ ${VERBS[kind]}` });
    }
    for (const [id, e] of before) if (!after.has(id)) out.push({ section: spec.section, objectId: id || undefined, kind: "removed", text: `${spec.noun} „${spec.name(e, lang)}“ entfernt` });
  }
  for (const area of AREAS) {
    if (!same(area.get(a), area.get(b))) out.push({ section: area.section, kind: "changed", text: `${area.label} geändert` });
  }
  return out;
}

/** Kurzfassung für einen Dialogsatz: „2 Stationen, 1 Regel und die Sicherheit“. */
export function describeDiff(entries: DiffEntry[]): string {
  if (!entries.length) return "nichts";
  const counts = new Map<string, number>();
  const plural: Record<string, string> = { Station: "Stationen", Regel: "Regeln", Figur: "Figuren", Kapitel: "Kapitel", Gegenstand: "Gegenstände", Codeteil: "Codeteile", Sperrzone: "Sperrzonen", Medium: "Medien" };
  const article: Record<string, string> = { "Kennung und Format": "die", "Angaben zum Spiel": "die", Grundregeln: "die", Spielfeld: "das", Geschichte: "die", Sicherheit: "die", Klang: "der" };
  const areas: string[] = [];
  for (const e of entries) {
    const noun = /^(\S+) „/.exec(e.text)?.[1];
    if (noun && plural[noun]) counts.set(noun, (counts.get(noun) ?? 0) + 1);
    else {
      const label = e.text.replace(/ geändert$/, "");
      areas.push(`${article[label] ?? "der Bereich"} ${label}`);
    }
  }
  const parts = [...[...counts].map(([noun, n]) => `${n} ${n === 1 ? noun : plural[noun]}`), ...areas];
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}
