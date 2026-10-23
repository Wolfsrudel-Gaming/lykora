/**
 * Paket A: Lokale Sicherung des Entwurfs in localStorage – nur für das zuletzt geöffnete Spiel.
 * Fängt Verluste bei Netzausfall und Sitzungsende ab; beim Öffnen wird eine jüngere Sicherung angeboten.
 * Zugriffe sind geschützt (private Fenster, gesperrte Website-Daten): dann gibt es eben keine Sicherung.
 */

import type { EditorMeta, Game, LocalBackup } from "./types.ts";

const PREFIX = "lykora.entwurf.";
/** Darüber wird nicht gesichert; der Kopf sagt „Zu groß für die lokale Sicherung“. */
export const MAX_BACKUP_CHARS = 4 * 1024 * 1024;

export type BackupResult = "ok" | "too_large" | "failed";

const key = (gameId: string) => PREFIX + gameId;

export function readBackup(gameId: string): LocalBackup | null {
  try {
    const raw = localStorage.getItem(key(gameId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LocalBackup>;
    if (typeof data.revision !== "number" || !data.game || typeof data.game !== "object" || typeof data.at !== "string") return null;
    return { revision: data.revision, game: data.game, meta: data.meta && typeof data.meta === "object" ? data.meta : {}, at: data.at };
  } catch {
    return null;
  }
}

export function writeBackup(gameId: string, backup: LocalBackup): BackupResult {
  let raw: string;
  try {
    raw = JSON.stringify(backup);
  } catch {
    return "failed";
  }
  if (raw.length > MAX_BACKUP_CHARS) return "too_large";
  try {
    localStorage.setItem(key(gameId), raw);
    return "ok";
  } catch {
    return "failed";
  }
}

export function clearBackup(gameId: string): void {
  try {
    localStorage.removeItem(key(gameId));
  } catch {
    // nichts zu löschen
  }
}

/** Nur das zuletzt geöffnete Spiel behält seine Sicherung; alle anderen werden entfernt. */
export function keepOnlyBackup(gameId: string): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== key(gameId)) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // kein Zugriff
  }
}

/** JSON mit sortierten Schlüsseln: Postgres (jsonb) liefert Objekte in anderer Reihenfolge zurück. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

/** Gleicher Inhalt, ohne Rücksicht auf die Reihenfolge der Schlüssel. */
export function sameContent(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** Unterscheidet sich die Sicherung vom gegebenen Stand? Die Reihenfolge der Schlüssel zählt nicht. */
export function backupDiffers(backup: LocalBackup, game: Game, meta: EditorMeta): boolean {
  return canonical(backup.game) !== canonical(game) || canonical(backup.meta ?? {}) !== canonical(meta ?? {});
}
