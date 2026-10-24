/**
 * Klänge eines Spiels ohne JSON-Kenntnisse zuordnen: Das Formular hält je Spiel, Kapitel,
 * Station und Szenen-Takt die gewählten Klänge; applySoundForm schreibt sie ins Spielformat zurück.
 * Klänge aus der Bibliothek, die noch nicht im Spiel stehen, tragen den Wert „lib:<id>“
 * und landen beim Speichern als media-Eintrag im Spiel.
 */

import { kebabId, text, uniqueId } from "./format.ts";
import type { Game, LibrarySound, MediaFile } from "./types.ts";

type Media = NonNullable<Game["media"]>[number];
type StationSound = NonNullable<Game["stations"][number]["sound"]>;
type Scene = NonNullable<Game["stations"][number]["scene"]>;
type Beat = NonNullable<Scene["arrival"]>[number];

export const LIB_PREFIX = "lib:";
/** Standardlautstärke laut Spielformat */
export const DEFAULT_VOLUME = 0.6;

export type Stage = "mid" | "near" | "here";
export const STAGES: Stage[] = ["mid", "near", "here"];
export const STAGE_LABELS: Record<Stage, string> = { mid: "Mittel", near: "Nah", here: "Am Ort" };

export const UI_KEYS = ["arrival", "solved", "wrong", "chapter", "radio", "hint", "key"] as const;
export type UiKey = (typeof UI_KEYS)[number];
export const UI_LABELS: Record<UiKey, string> = {
  arrival: "Ankunft an einer Station",
  solved: "Rätsel gelöst",
  wrong: "Falsche Antwort",
  chapter: "Neues Kapitel",
  radio: "Funkspruch",
  hint: "Hinweis",
  key: "Gegenstand erhalten",
};

export interface AmbienceField {
  /** Medien-ID, „lib:<id>“ oder leer für keine */
  audio: string;
  volume: number;
}

export interface StationAmbienceField extends AmbienceField {
  from: Stage;
}

export const SCENE_PARTS = ["arrival", "beats", "afterSolve"] as const;
export type ScenePart = (typeof SCENE_PARTS)[number];
export const SCENE_PART_LABELS: Record<ScenePart, string> = { arrival: "Ankunft", beats: "Vor dem Rätsel", afterSolve: "Nach dem Lösen" };

export const BEAT_LABELS: Record<Beat["kind"], string> = {
  narration: "Erzähler",
  radio: "Funkspruch",
  document: "Fundstück",
  dialogue: "Dialog",
  group: "Anweisung an alle",
  chapter: "Kapitelkarte",
  image: "Bild",
};

/** Ein Takt der Szene: Aufnahme (meist eine Stimme) und Geräusch dazu. */
export interface BeatSoundForm {
  part: ScenePart;
  index: number;
  kind: Beat["kind"];
  /** Wer spricht, als Name */
  speaker: string;
  /** Anfang des Textes zum Wiedererkennen */
  excerpt: string;
  audio: string;
  sfx: string;
}

export interface StationSoundForm {
  id: string;
  name: string;
  ambience: StationAmbienceField;
  approach: Record<Stage, string>;
  solved: string;
  beats: BeatSoundForm[];
}

export interface SoundForm {
  ambience: AmbienceField;
  ui: Record<UiKey, string>;
  chapters: { id: string; title: string; ambience: AmbienceField }[];
  stations: StationSoundForm[];
}

const field = (a: { audio: string; volume?: number } | undefined): AmbienceField => ({
  audio: a?.audio ?? "",
  volume: a?.volume ?? DEFAULT_VOLUME,
});

/** Kürzt einen Text auf eine Zeile zum Wiedererkennen. */
function excerpt(value: string, max = 70): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function beatForms(game: Game, scene: Scene | undefined, lang: string): BeatSoundForm[] {
  const speaker = (id: string | undefined) => {
    if (!id) return "";
    const c = game.characters?.find((ch) => ch.id === id);
    return c ? text(c.name, lang) || id : id;
  };
  return SCENE_PARTS.flatMap((part) =>
    (scene?.[part] ?? []).map((b, index) => ({
      part,
      index,
      kind: b.kind,
      speaker: speaker(b.speaker),
      excerpt: excerpt(text(b.title, lang) || text(b.text, lang)),
      audio: b.audio ?? "",
      sfx: b.sfx ?? "",
    })),
  );
}

export function soundFormFromGame(game: Game): SoundForm {
  const lang = game.meta.languages[0] ?? "de";
  const ui = Object.fromEntries(UI_KEYS.map((k) => [k, game.sound?.ui?.[k] ?? ""])) as Record<UiKey, string>;
  return {
    ambience: field(game.sound?.ambience),
    ui,
    chapters: (game.story?.chapters ?? []).map((c) => ({ id: c.id, title: text(c.title, lang) || c.id, ambience: field(c.ambience) })),
    stations: game.stations.map((s) => ({
      id: s.id,
      name: text(s.name, lang) || s.id,
      ambience: { ...field(s.sound?.ambience), from: s.sound?.ambience?.from ?? "near" },
      approach: { mid: s.sound?.approach?.mid ?? "", near: s.sound?.approach?.near ?? "", here: s.sound?.approach?.here ?? "" },
      solved: s.sound?.solved ?? "",
      beats: beatForms(game, s.scene, lang),
    })),
  };
}

/** media-Eintrag für einen Bibliotheksklang. */
export function libraryMedia(sound: LibrarySound, id: string, lang: string): Media {
  return { id, type: "audio", src: sound.src, alt: { [lang]: sound.title }, credit: sound.credit };
}

/** media-Eintrag für eine hochgeladene Datei. */
export function uploadedMedia(file: Pick<MediaFile, "type" | "src">, id: string, credit?: string): Media {
  const entry: Media = { id, type: file.type, src: file.src };
  if (credit?.trim()) entry.credit = credit.trim();
  return entry;
}

/** Vorschlag für die Medien-ID einer hochgeladenen Datei. */
export function suggestMediaId(game: Game, filename: string): string {
  return uniqueId(kebabId(filename), (game.media ?? []).map((m) => m.id));
}

/**
 * Nimmt einen Eintrag in media auf. Gibt es die Datei (gleiche src) schon, bleibt das Spiel
 * unverändert und die vorhandene ID gilt; eine belegte ID bekommt eine Endung.
 */
export function addMedia(game: Game, entry: Media): { game: Game; id: string; added: boolean } {
  const existing = (game.media ?? []).find((m) => m.src === entry.src);
  if (existing) return { game, id: existing.id, added: false };
  const id = uniqueId(entry.id, (game.media ?? []).map((m) => m.id));
  return { game: { ...game, media: [...(game.media ?? []), { ...entry, id }] }, id, added: true };
}

export function mediaBySrc(game: Game, src: string): Media | undefined {
  return (game.media ?? []).find((m) => m.src === src);
}

export interface AudioChoice {
  value: string;
  label: string;
}

/** Wählbare Klänge: zuerst die des Spiels, dann Bibliotheksklänge, die noch nicht im Spiel sind. */
export function audioChoices(game: Game, library: LibrarySound[]): { game: AudioChoice[]; library: AudioChoice[] } {
  const lang = game.meta.languages[0] ?? "de";
  const audio = (game.media ?? []).filter((m) => m.type === "audio");
  const inGame = new Set(audio.map((m) => m.src));
  return {
    game: audio.map((m) => ({ value: m.id, label: text(m.alt, lang) ? `${m.id} – ${text(m.alt, lang)}` : m.id })),
    library: library.filter((s) => !inGame.has(s.src)).map((s) => ({ value: LIB_PREFIX + s.id, label: `${s.title} (Bibliothek)` })),
  };
}

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

/** Schreibt das Formular in eine Kopie des Spiels. Leere Felder entfernen den jeweiligen Klang. */
export function applySoundForm(source: Game, form: SoundForm, library: LibrarySound[]): Game {
  const game = structuredClone(source);
  const lang = game.meta.languages[0] ?? "de";
  const libById = new Map(library.map((s) => [s.id, s]));
  let media = game.media;

  // Löst eine Auswahl auf: Bibliotheksklänge werden bei Bedarf ins Spiel übernommen.
  const resolve = (value: string): string | undefined => {
    if (!value) return undefined;
    if (!value.startsWith(LIB_PREFIX)) return value;
    const libId = value.slice(LIB_PREFIX.length);
    const sound = libById.get(libId);
    if (!sound) throw new Error(`Bibliotheksklang „${libId}“ ist unbekannt`);
    const result = addMedia({ ...game, media }, libraryMedia(sound, libId, lang));
    media = result.game.media;
    return result.id;
  };

  const ambience = resolve(form.ambience.audio);
  const ui: Partial<Record<UiKey, string>> = {};
  for (const k of UI_KEYS) {
    const id = resolve(form.ui[k]);
    if (id) ui[k] = id;
  }
  const sound: NonNullable<Game["sound"]> = {};
  if (ambience) sound.ambience = { audio: ambience, volume: round(form.ambience.volume) };
  if (Object.keys(ui).length) sound.ui = ui;
  if (Object.keys(sound).length) game.sound = sound;
  else delete game.sound;

  const chapterForm = new Map(form.chapters.map((c) => [c.id, c]));
  if (game.story?.chapters) {
    game.story.chapters = game.story.chapters.map((c) => {
      const f = chapterForm.get(c.id);
      if (!f) return c;
      const { ambience: _old, ...rest } = c;
      const audio = resolve(f.ambience.audio);
      return audio ? { ...rest, ambience: { audio, volume: round(f.ambience.volume) } } : rest;
    });
  }

  const stationForm = new Map(form.stations.map((s) => [s.id, s]));
  game.stations = game.stations.map((station) => {
    const f = stationForm.get(station.id);
    if (!f) return station;
    const s = station.scene ? { ...station, scene: applyBeats(station.scene, f.beats, resolve) } : station;
    const { sound: _old, ...rest } = s;
    const next: StationSound = {};
    const amb = resolve(f.ambience.audio);
    if (amb) next.ambience = { audio: amb, volume: round(f.ambience.volume), from: f.ambience.from };
    const approach: NonNullable<StationSound["approach"]> = {};
    for (const stage of STAGES) {
      const id = resolve(f.approach[stage]);
      if (id) approach[stage] = id;
    }
    if (Object.keys(approach).length) next.approach = approach;
    const solved = resolve(f.solved);
    if (solved) next.solved = solved;
    return Object.keys(next).length ? { ...rest, sound: next } : rest;
  });

  if (media) game.media = media;
  return game;
}

/**
 * Schreibt Aufnahme und Geräusch je Takt zurück. Ein Takt gilt nur als derselbe, wenn Teil,
 * Stelle und Art übereinstimmen; hat jemand die Szene inzwischen umgebaut, bleibt der Takt, wie er ist.
 */
function applyBeats(scene: Scene, beats: BeatSoundForm[], resolve: (value: string) => string | undefined): Scene {
  const out: Scene = { ...scene };
  for (const part of SCENE_PARTS) {
    const list = scene[part];
    if (!list) continue;
    out[part] = list.map((b, index) => {
      const f = beats.find((x) => x.part === part && x.index === index && x.kind === b.kind);
      if (!f) return b;
      const { audio: _audio, sfx: _sfx, ...rest } = b;
      const audio = resolve(f.audio);
      const sfx = resolve(f.sfx);
      return { ...rest, ...(audio ? { audio } : {}), ...(sfx ? { sfx } : {}) };
    });
  }
  return out;
}

/** Wie oft ein Klang im Spiel verwendet wird (Atmosphäre, Geräusche, Szenen); für Hinweise beim Löschen. */
export function audioUsage(game: Game, mediaId: string): number {
  let n = 0;
  const hit = (v: string | undefined) => {
    if (v === mediaId) n++;
  };
  hit(game.sound?.ambience?.audio);
  for (const v of Object.values(game.sound?.ui ?? {})) hit(v);
  for (const c of game.story?.chapters ?? []) hit(c.ambience?.audio);
  for (const s of game.stations) {
    hit(s.sound?.ambience?.audio);
    for (const v of Object.values(s.sound?.approach ?? {})) hit(v);
    hit(s.sound?.solved);
    for (const b of [...(s.scene?.arrival ?? []), ...(s.scene?.beats ?? []), ...(s.scene?.afterSolve ?? [])]) {
      hit(b.audio);
      hit(b.sfx);
    }
  }
  return n;
}
