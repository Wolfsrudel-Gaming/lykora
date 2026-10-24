/**
 * Paket E: Aus einer Vorlage und den Antworten des Assistenten wird ein Entwurf (UX §4.3):
 * Umzug an den Ort, Titel und Kennung, Spielwelt, Zielgruppe, Dauer und Telefon, neue Codes.
 * Dazu die Merker der Vorlage (Orte und ortsbezogene Rätsel), damit der Baukasten erkennt, was
 * noch angepasst werden muss. Auch fürs Duplizieren: Kopie mit neuer Kennung und neuen Codes.
 */

import { distanceM, stationPoint } from "../geo.ts";
import { newGameId, newManualCode, newQrCode } from "../ids.ts";
import { relocateGame, TEMPLATE_ORIGIN, TEMPLATE_RADIUS } from "../relocate.ts";
import { readText, writeText } from "../text.ts";
import type { EditorMeta, Game, Point } from "../types.ts";

export type Genre = NonNullable<Game["meta"]["genre"]>;
export type AgeGroup = NonNullable<Game["meta"]["ageGroups"]>[number];
export type MapStyle = "standard" | "topo" | "treasure";
export type TimeLimit = "per_team" | "global" | "none";

export interface WizardChoices {
  title: string;
  summary: string;
  genre: Genre;
  night: boolean;
  scareLevel: number;
  mapStyle: MapStyle;
  ageGroups: AgeGroup[];
  teamMin: number;
  teamMax: number;
  /** Sammelpunkt; null = noch nicht gesetzt */
  place: Point | null;
  placeName: string;
  /** Spielfeld-Radius in Metern */
  radius: number;
  /** geplante Dauer in Sekunden */
  duration: number;
  limit: TimeLimit;
  /** leer = „Später eintragen“ */
  phone: string;
}

export const MINORS: AgeGroup[] = ["6-9", "10-13", "14-17"];
export const GENRE_LABELS: Record<Genre, string> = { other: "Abenteuer", crime: "Krimi", mystery: "Mystery", agents: "Agenten", rescue: "Rettungseinsatz" };
export const AGE_LABELS: Record<AgeGroup, string> = { "6-9": "6–9 Jahre", "10-13": "10–13 Jahre", "14-17": "14–17 Jahre", adult: "Erwachsene" };
export const RADIUS_MIN = 100;
export const RADIUS_MAX = 1000;

const lang = (g: Game) => g.meta?.languages?.[0] ?? "de";

/** Sammelpunkt und Spielfeld-Radius einer Vorlage (Bezugsort, falls etwas fehlt). */
function originOf(game: Game): { point: Point; radius: number } {
  const b = game.field?.boundary;
  const point = game.field?.assemblyPoint?.location ?? (b && "center" in b ? b.center : TEMPLATE_ORIGIN);
  return { point, radius: b && "center" in b ? b.radius : TEMPLATE_RADIUS };
}

/** Vorgaben des Assistenten aus der Vorlage. */
export function defaultChoices(game: Game): WizardChoices {
  const l = lang(game);
  const s = game.settings ?? {};
  const duration = game.meta?.expectedDuration ?? s.time?.duration ?? 3600;
  return {
    title: readText(game.meta?.title as never, l),
    summary: readText(game.meta?.summary as never, l),
    genre: game.meta?.genre ?? "other",
    night: game.meta?.night === true,
    scareLevel: game.meta?.scareLevel ?? 0,
    mapStyle: s.map?.style ?? "standard",
    ageGroups: [...(game.meta?.ageGroups ?? [])],
    teamMin: s.teamSize?.min ?? 2,
    teamMax: s.teamSize?.max ?? 6,
    place: null,
    placeName: readText(game.field?.assemblyPoint?.name as never, l) || "Sammelpunkt",
    radius: originOf(game).radius,
    duration,
    limit: s.time?.limit ?? "per_team",
    phone: "",
  };
}

/** Alle QR- und Notfall-Codes neu würfeln (NFC-Werte sind Kennungen echter Anhänger und bleiben). */
export function renewCodes(game: Game): void {
  const taken = new Set<string>();
  for (const s of game.stations ?? []) for (const t of s?.triggers ?? []) if (t?.type === "nfc" && t.tag) taken.add(t.tag);
  for (const s of game.stations ?? []) {
    for (const t of s?.triggers ?? []) {
      if (t?.type === "qr") taken.add((t.code = newQrCode(taken)));
      else if (t?.type === "manual") taken.add((t.code = newManualCode(taken)));
    }
  }
}

/** Geplante Dauer → Zeitlimit: das Verhältnis der Vorlage bleibt (Nachtwanderung: 100 Min Limit bei 90 Min Spiel). */
function limitDuration(template: Game, duration: number): number {
  const planned = template.meta?.expectedDuration;
  const limit = template.settings?.time?.duration;
  if (!planned || !limit) return duration;
  return Math.max(300, Math.round((duration * limit) / planned / 300) * 300);
}

/**
 * Entwurf aus Vorlage und Antworten. Der Sammelpunkt muss gesetzt sein; ohne Telefon fehlt das
 * Pflichtfeld (Fehler in der Checkliste, das Spiel ist trotzdem angelegt).
 */
export function buildGame(template: Game, choices: WizardChoices & { place: Point }, opts: { templateId: string; localTasks?: string[]; now?: Date }): { game: Game; meta: EditorMeta } {
  const from = originOf(template);
  const game = relocateGame(template, from.point, choices.place, choices.radius / from.radius);
  const l = lang(game);
  const title = choices.title.trim() || "Neues Spiel";
  delete (game as { $schema?: string }).$schema;
  game.id = newGameId(title);

  game.meta.title = writeText(game.meta.title as never, l, title) ?? { [l]: title };
  const summary = writeText(game.meta.summary as never, l, choices.summary.trim());
  if (summary === undefined) delete game.meta.summary;
  else game.meta.summary = summary;
  game.meta.genre = choices.genre;
  game.meta.night = choices.night;
  game.meta.scareLevel = choices.scareLevel;
  game.meta.expectedDuration = choices.duration;
  if (choices.ageGroups.length) game.meta.ageGroups = [...choices.ageGroups];
  else delete game.meta.ageGroups;

  const settings = (game.settings ??= {});
  if (choices.mapStyle === "standard") {
    if (settings.map) delete settings.map.style;
    if (settings.map && !Object.keys(settings.map).length) delete settings.map;
  } else settings.map = { ...settings.map, style: choices.mapStyle };
  if (choices.night) settings.scoring = { ...settings.scoring, speedBonus: false };
  settings.teamSize = { min: Math.min(choices.teamMin, choices.teamMax), max: Math.max(choices.teamMin, choices.teamMax) };
  settings.time = choices.limit === "none" ? { limit: "none" } : { limit: choices.limit, duration: limitDuration(template, choices.duration) };

  game.field.boundary = { center: { ...choices.place }, radius: choices.radius };
  game.field.start = { ...choices.place };
  const name = writeText(game.field.assemblyPoint?.name as never, l, choices.placeName.trim());
  game.field.assemblyPoint = { ...game.field.assemblyPoint, location: { ...choices.place }, ...(name ? { name } : {}) };
  if (!name) delete game.field.assemblyPoint.name;

  const emergency = game.safety.emergency;
  if (choices.phone.trim()) emergency.gameMasterPhone = choices.phone.trim();
  else delete (emergency as { gameMasterPhone?: string }).gameMasterPhone;
  if (choices.ageGroups.some((a) => MINORS.includes(a))) game.safety.requireSupervisor = true;

  renewCodes(game);

  // Merker: Stationen am Platz der Vorlage (außer denen am Sammelpunkt) und ortsbezogene Rätsel.
  const stations: Record<string, Point> = {};
  const tasks: Record<string, string> = {};
  const local = new Set(opts.localTasks ?? []);
  for (const s of game.stations) {
    const p = stationPoint(s);
    if (p && distanceM(p, choices.place) >= 1) stations[s.id] = p;
    if (local.has(s.id) && s.task) tasks[s.id] = JSON.stringify(s.task);
  }
  const meta: EditorMeta = { template: { id: opts.templateId, stations, tasks, createdAt: (opts.now ?? new Date()).toISOString() } };
  return { game, meta };
}

/** Kopie eines Spiels: neuer Titel, neue Kennung, neue Codes; Orte und Inhalte bleiben. */
export function duplicateGame(source: Game, title: string): Game {
  const game = JSON.parse(JSON.stringify(source)) as Game;
  const l = lang(game);
  game.id = newGameId(title);
  game.meta.title = writeText(game.meta.title as never, l, title) ?? { [l]: title };
  renewCodes(game);
  return game;
}

/** Vorschlag für den Titel der Kopie: „… (Kopie)“. */
export function copyTitle(source: Game): string {
  return `${readText(source.meta?.title as never, lang(source)) || "Spiel"} (Kopie)`;
}
