/**
 * Paket E: Vorlagen für „Neues Spiel“. Jede Vorlage ist ein vollständiges, gültiges Spiel am
 * Bezugsort (relocate.ts: TEMPLATE_ORIGIN, Spielfeld 300 m); der Assistent zieht sie an den
 * gewählten Ort um. Die Dateien kommen erst beim Wählen (dynamischer Import).
 */

import type { Game } from "../types.ts";

export type TemplateId = "leer" | "kinder-schnitzeljagd" | "nachtwanderung" | "outdoor-escape";

export interface TemplateInfo {
  id: TemplateId;
  title: string;
  /** zweite Zeile der Karte, z. B. „für Kinder“ */
  subtitle: string;
  blurb: string;
  ageGroups: string;
  duration: string;
  stations: number;
  night: boolean;
  /** Stationen, deren Rätsel sich auf den Ort beziehen (Warnung „aus der Vorlage“, bis sie angepasst sind) */
  localTasks: string[];
  load(): Promise<Game>;
}

const json = (m: { default: unknown }) => m.default as Game;

/** Reihenfolge wie auf der leeren Spiele-Liste (W1b). */
export const TEMPLATES: TemplateInfo[] = [
  {
    id: "kinder-schnitzeljagd",
    title: "Schnitzeljagd",
    subtitle: "für Kinder",
    blurb: "5 Stationen, Eule Olga führt durch, Schatzkiste mit Zahlenschloss. Tipps kostenlos, kein Zeitdruck.",
    ageGroups: "6–9 Jahre",
    duration: "ca. 45 Min",
    stations: 5,
    night: false,
    localTasks: ["am-bach"],
    load: () => import("./kinder-schnitzeljagd.json").then(json),
  },
  {
    id: "nachtwanderung",
    title: "Nachtwanderung",
    subtitle: "mit Geschichte",
    blurb: "7 Stationen, 3 Kapitel, Waldklänge, Sicherheits-Briefing. Kein Wettrennen im Dunkeln.",
    ageGroups: "ab 10 Jahren",
    duration: "ca. 90 Min",
    stations: 7,
    night: true,
    localTasks: ["lichtung"],
    load: () => import("./nachtwanderung.json").then(json),
  },
  {
    id: "outdoor-escape",
    title: "Outdoor-Escape",
    subtitle: "für Jugendliche",
    blurb: "6 Stationen, Codeteile, UV-Lampe, toter Briefkasten, Zeitstrafen.",
    ageGroups: "14–17 Jahre",
    duration: "ca. 60 Min",
    stations: 6,
    night: false,
    localTasks: ["briefkasten"],
    load: () => import("./outdoor-escape.json").then(json),
  },
  {
    id: "leer",
    title: "Leeres Spiel",
    subtitle: "alles selbst",
    blurb: "1 Station, Sammelpunkt, Spielfeld. Alles andere baust du selbst.",
    ageGroups: "jedes Alter",
    duration: "Dauer nach Wahl",
    stations: 1,
    night: false,
    localTasks: [],
    load: () => import("./leer.json").then(json),
  },
];

/** Beispiel „Sturmnacht“ aus der Formatbeschreibung; zieht wie eine Vorlage an den gewählten Ort. */
export const EXAMPLE_GAME = (): Promise<Game> => import("../../../../../spec/v0.1/examples/testspiel.json").then(json);
