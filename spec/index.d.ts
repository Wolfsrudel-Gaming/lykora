import type { LykoraSpielformatV01 } from "./v0.1/game.js";

export type * from "./v0.1/game.js";

/** Ein Spiel im Lykora-Spielformat. */
export type Game = LykoraSpielformatV01;

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateGame(game: unknown): ValidationResult;

// Strukturierte Meldungen des Validator-Kerns (validate-core.mjs). path ist ein JSON-Pointer ("/stations/1/task/answers/0").

/** Meldung des Schema-Prüfers (Ajv) oder die Pseudo-Meldung keyword "formatVersion" bei unbekannter Formatversion. */
export interface SchemaIssue {
  kind: "schema";
  path: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
  schemaPath: string;
}

export type ReferenceCode =
  | "duplicate_id"
  | "unknown_media"
  | "not_audio"
  | "unknown_character"
  | "unknown_item"
  | "unknown_fragment"
  | "unknown_station"
  | "unknown_chapter"
  | "gps_without_location"
  | "fragment_gap"
  | "multiple_finals"
  | "fragments_without_final"
  | "hidden_unreachable";

/** Meldung der Querverweis-Prüfung; where ist die bisherige Bezeichnung ("stations[baum].rewards"). */
export interface ReferenceIssue {
  kind: "reference";
  code: ReferenceCode;
  where: string;
  path: string;
  message: string;
  params: Record<string, unknown>;
}

export interface DetailedResult {
  ok: boolean;
  schema: SchemaIssue[];
  /** Querverweis-Fehler; nur geprüft, wenn das Schema passt. */
  references: ReferenceIssue[];
  warnings: ReferenceIssue[];
}

/** Schema-Prüfer je Formatversion, z. B. createValidator({ "0.1": schema }). */
export function createValidator(schemas: Record<string, object>): (game: unknown) => DetailedResult;
/** Querverweise unabhängig vom Schema; nimmt auch unvollständige Entwürfe an und wirft nicht. */
export function checkReferences(game: unknown): { errors: ReferenceIssue[]; warnings: ReferenceIssue[] };
/** Bisherige Zeichenkette zu einer Meldung. */
export function formatIssue(issue: SchemaIssue | ReferenceIssue): string;
/** Ergebnis wie validateGame; gleiche Fehlertexte nur einmal. */
export function toLegacy(result: DetailedResult): ValidationResult;
