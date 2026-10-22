/**
 * Paket A: Verzeichnis der Bereiche des Baukastens. EditorShell lädt einen Bereich erst, wenn er
 * aufgerufen wird; bis die Pakete B–E liefern, steht ein Platzhalter „Bereich folgt“. Die Pakete
 * ersetzen nur ihren Eintrag, z. B. `karte: () => import("./map/MapSection.tsx").then((m) => m.MapSection)`.
 * Dazu die Stellen, an denen B seine Stationsliste und seine Mini-Karte einhängt, und die Seiten
 * außerhalb des Rahmens (Assistent von E, Vor-Ort-Modus von B), die app.tsx über dieses Verzeichnis lädt.
 */

import { h, type ComponentType } from "preact";
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

/** Platzhalter, bis das zuständige Paket den Bereich liefert. */
function placeholder(section: Section, paket: string): ComponentType<SectionProps> {
  const title = SECTION_TITLES[section];
  const Placeholder = () =>
    h("section", { class: "card stack editor-placeholder", "aria-labelledby": `bereich-${section}` }, [
      h("h2", { id: `bereich-${section}`, tabIndex: -1 }, title),
      h("p", { class: "muted" }, `Bereich folgt (Paket ${paket}).`),
    ]);
  Placeholder.displayName = `Platzhalter(${section})`;
  return Placeholder;
}

/** Bereich → Komponente; die Übersicht (uebersicht) gehört zum Rahmen und steht nicht hier. */
export const SECTION_LOADERS: Record<Exclude<Section, "uebersicht">, SectionLoader> = {
  karte: async () => placeholder("karte", "B"),
  stationen: async () => placeholder("stationen", "C"),
  raetsel: async () => placeholder("raetsel", "C"),
  geschichte: async () => placeholder("geschichte", "D"),
  belohnungen: async () => placeholder("belohnungen", "D"),
  regeln: async () => placeholder("regeln", "D"),
  sicherheit: async () => placeholder("sicherheit", "B"),
  medien: async () => placeholder("medien", "D"),
  klang: async () => placeholder("klang", "D"),
  einstellungen: async () => placeholder("einstellungen", "D"),
  veroeffentlichen: async () => placeholder("veroeffentlichen", "E"),
};

/** Stationsliste in der Navigation: null = einfache Liste aus EditorNav; Paket B trägt hier seine sortierbare ein. */
export const stationList: ComponentType<StationListProps> | null = null;

/** Mini-Karte in der Übersicht (EditorMap, nur lesen): null = keine; Paket B trägt sie hier ein. */
export const overviewMap: ComponentType<{ gameId: string }> | null = null;

function pagePlaceholder(title: string, paket: string): ComponentType<Record<string, unknown>> {
  const Placeholder = () => h("div", { class: "page stack" }, [h("h1", null, title), h("p", { class: "muted" }, `Seite folgt (Paket ${paket}).`)]);
  Placeholder.displayName = `Platzhalter(${title})`;
  return Placeholder;
}

/** Seiten neben dem Rahmen, die app.tsx über dieses Verzeichnis lädt: Assistent (E) und Vor-Ort-Modus (B). */
export const PAGES = {
  gameNew: async (): Promise<ComponentType<Record<string, never>>> => pagePlaceholder("Neues Spiel", "E"),
  onSite: async (): Promise<ComponentType<{ gameId: string }>> => pagePlaceholder("Vor Ort", "B"),
};
