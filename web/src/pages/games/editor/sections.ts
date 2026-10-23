/**
 * Paket A: Verzeichnis der Bereiche des Baukastens. EditorShell lädt einen Bereich erst, wenn er
 * aufgerufen wird; bis die Pakete B–E liefern, steht ein Platzhalter „Bereich folgt“. Die Pakete
 * ersetzen nur ihren Eintrag, z. B. `karte: () => import("./map/MapSection.tsx").then((m) => m.MapSection)`.
 * Dazu die Stellen, an denen B seine Stationsliste und seine Mini-Karte einhängt, und die Seiten
 * außerhalb des Rahmens (Assistent von E, Vor-Ort-Modus von B), die app.tsx über dieses Verzeichnis lädt.
 */

import type { ComponentType } from "preact";
import type { Section } from "../../../lib/editor/types.ts";
import type { StationListProps } from "./EditorNav.tsx";

export interface SectionProps {
  gameId: string;
  /** nur im Bereich „stationen“ */
  stationId?: string;
}

export type SectionLoader = () => Promise<ComponentType<SectionProps>>;

export const SECTION_TITLES: Record<Section, string> = {
  uebersicht: "Übersicht",
  karte: "Karte & Stationen",
  stationen: "Station",
  raetsel: "Rätsel & Aufgaben",
  geschichte: "Geschichte",
  belohnungen: "Belohnungen",
  regeln: "Regeln",
  sicherheit: "Sicherheit",
  medien: "Medien",
  klang: "Klang",
  einstellungen: "Einstellungen",
  veroeffentlichen: "Veröffentlichen",
};

/** Bereich → Komponente; die Übersicht (uebersicht) gehört zum Rahmen und steht nicht hier. */
export const SECTION_LOADERS: Record<Exclude<Section, "uebersicht">, SectionLoader> = {
  karte: () => import("./map/MapSection.tsx").then((m) => m.MapSection),
  stationen: () => import("./station/StationEditor.tsx").then((m) => m.StationEditor),
  raetsel: () => import("./station/TasksSection.tsx").then((m) => m.TasksSection),
  geschichte: () => import("./story/StorySection.tsx").then((m) => m.StorySection),
  belohnungen: () => import("./rewards/RewardsSection.tsx").then((m) => m.RewardsSection),
  regeln: () => import("./rules/RulesSection.tsx").then((m) => m.RulesSection),
  sicherheit: () => import("./safety/SafetySection.tsx").then((m) => m.SafetySection),
  medien: () => import("./MediaSection.tsx").then((m) => m.MediaSection),
  klang: () => import("./SoundSection.tsx").then((m) => m.SoundSection),
  einstellungen: () => import("./SettingsSection.tsx").then((m) => m.SettingsSection),
  veroeffentlichen: () => import("./publish/PublishSection.tsx").then((m) => m.PublishSection),
};

/** Stationsliste in der Navigation: null = einfache Liste aus EditorNav; Paket B trägt hier seine sortierbare ein. */
import { StationList } from "./map/StationList.tsx";
export const stationList: ComponentType<StationListProps> | null = StationList;

/** Mini-Karte in der Übersicht (EditorMap, nur lesen): null = keine; Paket B trägt sie hier ein. */
import { OverviewMap } from "./map/OverviewMap.tsx";
export const overviewMap: ComponentType<{ gameId: string }> | null = OverviewMap;

/** Seiten neben dem Rahmen, die app.tsx über dieses Verzeichnis lädt: Assistent (E) und Vor-Ort-Modus (B). */
export const PAGES = {
  gameNew: (): Promise<ComponentType<Record<string, never>>> => import("../GameNew.tsx").then((m) => m.GameNewPage),
  onSite: (): Promise<ComponentType<{ gameId: string }>> => import("../onsite/OnSitePage.tsx").then((m) => m.OnSitePage),
};
