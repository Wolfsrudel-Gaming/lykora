/**
 * Paket A: Querverweise im Spiel (Inventar §18). usagesOf zählt sie für den Lösch-Dialog,
 * removeWithReferences löscht Eintrag und Verweise, renameId zieht beim Umbenennen einer ID
 * (nur Expertenansicht) alle Verweise mit. Alle drei laufen auf dem Entwurf in place –
 * also innerhalb einer update-Mutation.
 */

import { readText } from "./text.ts";
import type { EditorMeta, Game, IdKind, JsonPointer } from "./types.ts";

type Json = Record<string, unknown>;

export interface Usage {
  path: JsonPointer;
  /** wer verweist: Station, Regel, Kapitel, Gegenstand, Figur oder das Spiel selbst */
  owner: { kind: IdKind | "spiel"; id?: string; name: string };
  /** was der Verweis ist, z. B. „Belohnung“, „Sprecher im Takt“ */
  what: string;
}

interface Site extends Usage {
  kind: IdKind;
  id: string;
  remove(): void;
  rename(to: string): void;
}

const lang = (g: Game) => g.meta?.languages?.[0] ?? "de";
const list = <T>(x: T[] | undefined | null): T[] => (Array.isArray(x) ? x : []);

/** Alle Verweisstellen des Spiels, jede mit Löschen und Umbenennen. */
function sites(game: Game): Site[] {
  const out: Site[] = [];
  const l = lang(game);
  const spiel = { kind: "spiel" as const, name: "Spiel" };

  const inList = (owner: Usage["owner"], what: string, kind: IdKind, holder: Json | undefined, key: string, path: JsonPointer) => {
    const arr = holder?.[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((id, j) => {
      if (typeof id !== "string") return;
      out.push({
        kind,
        id,
        path: `${path}/${j}`,
        owner,
        what,
        remove: () => {
          const i = arr.indexOf(id);
          if (i >= 0) arr.splice(i, 1);
          if (!arr.length) delete holder![key];
        },
        rename: (to) => {
          const i = arr.indexOf(id);
          if (i >= 0) arr[i] = to;
        },
      });
    });
  };
  const inField = (owner: Usage["owner"], what: string, kind: IdKind, holder: Json | undefined, key: string, path: JsonPointer, remove?: () => void) => {
    const id = holder?.[key];
    if (typeof id !== "string" || !id) return;
    out.push({ kind, id, path, owner, what, remove: remove ?? (() => delete holder![key]), rename: (to) => (holder![key] = to) });
  };
  const beats = (owner: Usage["owner"], part: string, holder: Json | undefined, path: JsonPointer) => {
    list(holder?.[part] as Json[] | undefined).forEach((b, j) => {
      const p = `${path}/${part}/${j}`;
      inField(owner, "Sprecher im Takt", "figur", b, "speaker", `${p}/speaker`);
      inField(owner, "Fundstück im Takt", "gegenstand", b, "item", `${p}/item`);
      inField(owner, "Aufnahme im Takt", "medium", b, "audio", `${p}/audio`);
      inField(owner, "Geräusch im Takt", "medium", b, "sfx", `${p}/sfx`);
      inField(owner, "Bild im Takt", "medium", b, "image", `${p}/image`);
    });
  };
  const ambience = (owner: Usage["owner"], holder: Json | undefined, path: JsonPointer) => {
    const amb = holder?.ambience as Json | undefined;
    inField(owner, "Atmosphäre", "medium", amb, "audio", `${path}/ambience/audio`, () => delete holder!.ambience);
  };

  const story = game.story as Json | undefined;
  inList(spiel, "Einsatzbefehl", "medium", story?.intro as Json | undefined, "media", "/story/intro/media");
  inList(spiel, "Auflösung", "medium", story?.outro as Json | undefined, "media", "/story/outro/media");
  inField(spiel, "Bild der Zentrale", "medium", story?.hq as Json | undefined, "avatar", "/story/hq/avatar");
  list(game.story?.chapters).forEach((c, i) => {
    const owner = { kind: "kapitel" as const, id: c?.id, name: readText(c?.title, l) || c?.id || `Kapitel ${i + 1}` };
    inList(owner, "Medien des Kapitels", "medium", c?.piece as Json | undefined, "media", `/story/chapters/${i}/piece/media`);
    ambience(owner, c as unknown as Json, `/story/chapters/${i}`);
  });
  list(game.items).forEach((it, i) => {
    const owner = { kind: "gegenstand" as const, id: it?.id, name: readText(it?.name, l) || it?.id || `Gegenstand ${i + 1}` };
    inField(owner, "Symbol", "medium", it as unknown as Json, "icon", `/items/${i}/icon`);
    inField(owner, "Bild", "medium", it as unknown as Json, "image", `/items/${i}/image`);
  });
  list(game.characters).forEach((c, i) => {
    const owner = { kind: "figur" as const, id: c?.id, name: readText(c?.name, l) || c?.id || `Figur ${i + 1}` };
    inField(owner, "Porträt", "medium", c as unknown as Json, "portrait", `/characters/${i}/portrait`);
  });
  ambience(spiel, game.sound as Json | undefined, "/sound");
  for (const k of Object.keys(game.sound?.ui ?? {})) inField(spiel, "Geräusch der App", "medium", game.sound?.ui as Json, k, `/sound/ui/${k}`);

  list(game.stations).forEach((s, i) => {
    const owner = { kind: "station" as const, id: s?.id, name: readText(s?.name, l) || s?.id || `Station ${i + 1}` };
    const p = `/stations/${i}`;
    const st = s as unknown as Json;
    inList(owner, "Erzählstück", "medium", st.story as Json | undefined, "media", `${p}/story/media`);
    inList(owner, "Medien der Aufgabe", "medium", st.task as Json | undefined, "media", `${p}/task/media`);
    for (const part of ["arrival", "beats", "afterSolve"]) beats(owner, part, st.scene as Json | undefined, `${p}/scene`);
    const sound = st.sound as Json | undefined;
    ambience(owner, sound, `${p}/sound`);
    for (const k of Object.keys((sound?.approach as Json | undefined) ?? {})) inField(owner, "Annäherungsgeräusch", "medium", sound?.approach as Json, k, `${p}/sound/approach/${k}`);
    inField(owner, "Lösungsgeräusch", "medium", sound, "solved", `${p}/sound/solved`);
    const rewards = st.rewards as Json | undefined;
    inList(owner, "Belohnung: Codeteil", "teil", rewards, "fragments", `${p}/rewards/fragments`);
    inList(owner, "Belohnung: Gegenstand", "gegenstand", rewards, "items", `${p}/rewards/items`);
    inList(owner, "Danach erscheint", "station", rewards, "reveal", `${p}/rewards/reveal`);
    inField(owner, "Belohnung: Kapitel", "kapitel", rewards, "chapter", `${p}/rewards/chapter`);
  });

  list(game.rules).forEach((rule, i) => {
    const owner = { kind: "regel" as const, id: rule?.id, name: rule?.id || `Regel ${i + 1}` };
    const r = rule as unknown as Json;
    const block = (key: "when" | "then" | "else", what: string) => {
      const arr = r[key];
      if (!Array.isArray(arr)) return;
      arr.forEach((entry: Json, j) => {
        for (const [field, kind] of [["station_solved", "station"], ["has_item", "gegenstand"], ["reveal_station", "station"], ["give_item", "gegenstand"], ["start_chapter", "kapitel"]] as const) {
          inField(owner, what, kind, entry, field, `/rules/${i}/${key}/${j}/${field}`, () => {
            const at = arr.indexOf(entry);
            if (at >= 0) arr.splice(at, 1);
          });
        }
      });
    };
    block("when", "Bedingung");
    block("then", "Dann-Aktion");
    block("else", "Sonst-Aktion");
  });

  return out;
}

const own = (kind: IdKind, id: string) => (s: Site) => s.kind === kind && s.id === id;

/** Wo eine ID benutzt wird – für „wird von 2 Stationen und 1 Regel benutzt“. */
export function usagesOf(game: Game, kind: IdKind, id: string): Usage[] {
  return sites(game)
    .filter(own(kind, id))
    .map(({ path, owner, what }) => ({ path, owner, what }));
}

/** Zusammenfassung für den Dialog: „2 Stationen und 1 Regel“. */
export function describeUsages(usages: Usage[]): string {
  const names: Record<string, [string, string]> = { station: ["Station", "Stationen"], regel: ["Regel", "Regeln"], kapitel: ["Kapitel", "Kapitel"], gegenstand: ["Gegenstand", "Gegenstände"], figur: ["Figur", "Figuren"], spiel: ["das Spiel", "das Spiel"] };
  const counts = new Map<string, Set<string>>();
  for (const u of usages) {
    const key = u.owner.kind;
    if (!counts.has(key)) counts.set(key, new Set());
    counts.get(key)!.add(u.owner.id ?? "");
  }
  const parts = [...counts].map(([kind, ids]) => (kind === "spiel" ? "das Spiel selbst" : `${ids.size} ${names[kind]![ids.size === 1 ? 0 : 1]}`));
  return parts.length ? parts.join(", ").replace(/, ([^,]*)$/, " und $1") : "nichts";
}

function listOf(game: Game, kind: IdKind): { id?: string }[] | undefined {
  switch (kind) {
    case "station":
      return game.stations;
    case "figur":
      return game.characters;
    case "gegenstand":
      return game.items;
    case "kapitel":
      return game.story?.chapters;
    case "regel":
      return game.rules;
    case "zone":
      return game.field?.restrictedZones;
    case "teil":
      return game.fragments;
    case "medium":
      return game.media;
    case "punkt":
      return undefined;
  }
}

/** Leere Regeln (ohne Bedingung oder ohne Dann) fallen weg; ein leeres Sonst wird entfernt. */
function tidyRules(game: Game): void {
  if (!Array.isArray(game.rules)) return;
  for (let i = game.rules.length - 1; i >= 0; i--) {
    const r = game.rules[i]!;
    if (Array.isArray(r.else) && !r.else.length) delete r.else;
    if (!r.when?.length || !r.then?.length) game.rules.splice(i, 1);
  }
  if (!game.rules.length) delete game.rules;
}

/** Codeteile lückenlos 1…n nach bisheriger Reihenfolge der Positionen. */
export function renumberFragments(game: Game): void {
  if (!Array.isArray(game.fragments)) return;
  [...game.fragments].sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0)).forEach((f, i) => {
    if (f && typeof f === "object") f.position = i + 1;
  });
}

/**
 * Entfernt den Eintrag und alle Verweise darauf (Inventar §18); leere Regeln und leere ambience
 * verschwinden, Takte bleiben ohne Sprecher. Liefert die bereinigten Verweise.
 */
export function removeWithReferences(game: Game, kind: IdKind, id: string, meta?: EditorMeta): Usage[] {
  const hits = sites(game).filter(own(kind, id));
  for (const s of hits) s.remove();
  tidyRules(game);
  const arr = listOf(game, kind);
  if (arr) {
    const i = arr.findIndex((x) => x?.id === id);
    if (i >= 0) arr.splice(i, 1);
  } else if (kind === "punkt") {
    for (const key of ["rescuePoints", "supplyPoints"] as const) {
      const points = game.field?.[key];
      const i = points?.findIndex((p) => p?.id === id) ?? -1;
      if (points && i >= 0) points.splice(i, 1);
    }
  }
  if (kind === "teil") renumberFragments(game);
  if (kind === "station" && meta) {
    delete meta.onSite?.[id];
    delete meta.template?.stations[id];
    delete meta.template?.tasks[id];
  }
  return hits.map(({ path, owner, what }) => ({ path, owner, what }));
}

/** Benennt die ID eines Eintrags um und zieht alle Verweise mit. Liefert die Zahl der geänderten Verweise. */
export function renameId(game: Game, kind: IdKind, from: string, to: string, meta?: EditorMeta): number {
  if (from === to) return 0;
  const hits = sites(game).filter(own(kind, from));
  for (const s of hits) s.rename(to);
  const entries = kind === "punkt" ? [game.field?.assemblyPoint, ...(game.field?.rescuePoints ?? []), ...(game.field?.supplyPoints ?? [])] : (listOf(game, kind) ?? []);
  for (const e of entries) if (e?.id === from) e.id = to;
  if (kind === "station" && meta) {
    for (const map of [meta.onSite, meta.template?.stations, meta.template?.tasks] as (Record<string, unknown> | undefined)[]) {
      if (map && Object.hasOwn(map, from)) {
        map[to] = map[from];
        delete map[from];
      }
    }
  }
  return hits.length;
}
