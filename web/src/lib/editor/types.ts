/**
 * Paket A: Typen des Baukastens – Bereiche, Feldadressen, Meldungen, Editor-Merker und die
 * Entwurfs-Antworten des Servers. Der Entwurf selbst ist ein Game aus dem Spielformat und darf
 * während des Bearbeitens ungültig sein; alles, was nur der Editor braucht, steht in EditorMeta.
 */

import type { Game, Point } from "@lykora/spec";

export type { Game, Point };
export type Station = Game["stations"][number];

/** Technische Adresse im Spiel, z. B. "/stations/1/task/answers/0"; die Wurzel ist "". */
export type JsonPointer = string;

export type Section =
  | "uebersicht"
  | "karte"
  | "stationen"
  | "raetsel"
  | "geschichte"
  | "belohnungen"
  | "regeln"
  | "sicherheit"
  | "medien"
  | "klang"
  | "einstellungen"
  | "veroeffentlichen";

export const SECTIONS: Section[] = ["uebersicht", "karte", "stationen", "raetsel", "geschichte", "belohnungen", "regeln", "sicherheit", "medien", "klang", "einstellungen", "veroeffentlichen"];

/**
 * Stabile Adresse für Navigation und Meldungen: Bereich, Objekt-ID (Station, Regel, Figur, Kapitel,
 * Gegenstand, Codeteil, Sperrzone, Medium) und Feldname als Punkt-Pfad relativ zum Objekt
 * ("task.answers.0"); ohne Objekt relativ zur Wurzel ("settings.teamSize.min"). Überlebt Umsortieren.
 */
export interface FieldAddress {
  section: Section;
  objectId?: string;
  field?: string;
  path: JsonPointer;
}

/** Editor-Merker; gespeichert in game_drafts.meta, nie im Spiel. */
export interface EditorMeta {
  /** aus welcher Vorlage; Orte und Aufgaben der Stationen beim Anlegen, um „noch wie in der Vorlage“ zu erkennen */
  template?: { id: string; stations: Record<string, Point>; tasks: Record<string, string>; createdAt: string };
  /** vor Ort gesetzt oder bestätigt, je Station */
  onSite?: Record<string, { accuracy: number; at: string }>;
  /** ausgeblendete Warnungen („Passt so“), Schlüssel = EditorIssue.id */
  dismissed?: string[];
  /** Checkliste „Vor dem Spieltag“: Schlüssel → Zeitpunkt des Abhakens */
  checklist?: Record<string, string>;
  /** „Gibt es nicht“ bei der Sperrzonen-Warnung */
  noZones?: boolean;
  /** letzter Probelauf */
  lastTestRun?: { eventId: string; at: string };
  /** Namen für Regelorte (near), Schlüssel = JSON-Pointer der Bedingung */
  placeNames?: Record<string, string>;
}

export type Severity = "error" | "warning" | "hint";

/** Sofort-Lösung an einer Meldung; apply arbeitet wie eine update-Mutation auf Kopien. */
export interface QuickFix {
  label: string;
  apply: (game: Game, meta: EditorMeta) => void;
  undoLabel: string;
}

export interface EditorIssue {
  /** stabil: `${code}:${section}:${objectId}:${field}:${paramKey}` */
  id: string;
  severity: Severity;
  /** Schema-Keyword, ReferenceCode oder Baukasten-Code (checks.ts) */
  code: string;
  /** deutsch, höchstens zwei Sätze, Objekte mit Namen in „…“ */
  message: string;
  at: FieldAddress;
  source: "schema" | "reference" | "editor" | "server";
  fix?: QuickFix;
  /** nur warning/hint */
  dismissable: boolean;
}

export type IdKind = "station" | "figur" | "gegenstand" | "kapitel" | "regel" | "zone" | "teil" | "medium" | "punkt";

export type SaveStatus = "saved" | "pending" | "saving" | "offline" | "error" | "conflict" | "unauthorized";

/** Ein Schritt im Verlauf: der Stand vor der Änderung und ihr Rückgängig-Text. */
export interface HistoryEntry {
  label: string;
  game: Game;
  meta: EditorMeta;
  at: number;
  coalesce?: string;
  focus?: FieldAddress;
}

/** Zustand eines geöffneten Spiels im Baukasten (store.ts). */
export interface EditorState {
  gameId: string;
  /** Entwurf, evtl. ungültig */
  game: Game;
  meta: EditorMeta;
  /** game.meta.languages[0] ?? "de" */
  lang: string;
  /** Server-Revision des Standes in saved */
  revision: number;
  /** Version, aus der der Entwurf stammt */
  baseVersion: number | null;
  /** neueste veröffentlichte Version */
  latestVersion: number | null;
  /** zuletzt vom Server bestätigt (Vergleich per Referenz) */
  saved: { game: Game; meta: EditorMeta };
  save: { status: SaveStatus; at: string | null; error: string | null; conflict: DraftDto | null };
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  /** Ergebnis der letzten Prüfung */
  issues: EditorIssue[];
  /** Felder, an denen Meldungen gezeigt werden dürfen */
  touched: ReadonlySet<JsonPointer>;
  /** nach „Veröffentlichen“/„Probelauf“: alle Meldungen zeigen */
  showAll: boolean;
  expert: boolean;
  /** Ergebnis der letzten lokalen Sicherung; null = noch keine */
  backup: "ok" | "too_large" | "failed" | null;
  /** jüngere Sicherung auf diesem Gerät, die beim Öffnen gefunden wurde (Dialog) */
  pendingBackup: LocalBackup | null;
  /** wer den Entwurf zuletzt auf dem Server geändert hat (Hinweis beim Öffnen) */
  lastEditor: { id: string; name: string; at: string } | null;
}

// Entwürfe auf dem Server (contracts.md Abschnitt 3)

export interface DraftSummary {
  revision: number;
  updated_at: string;
  updated_by: string | null;
  base_version: number | null;
  changed: boolean;
}

export interface DraftDto {
  gameId: string;
  revision: number;
  content: unknown;
  meta: EditorMeta;
  base_version: number | null;
  updated_at: string;
  updated_by: { id: string; name: string } | null;
}

export interface PlannedEvent {
  id: string;
  name: string;
  gameVersion: number;
  scheduledAt: string | null;
}

export interface PublishResult {
  version: number;
  draft: DraftSummary;
  plannedEvents: PlannedEvent[];
}

/** Lokale Sicherung eines Entwurfs in localStorage. */
export interface LocalBackup {
  revision: number;
  game: Game;
  meta: EditorMeta;
  at: string;
}
