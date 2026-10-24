/**
 * Paket A: Texte des Spiels einsprachig bearbeiten. Bearbeitet wird game.meta.languages[0];
 * geschrieben wird immer als { "<lang>": "…" }, andere Übersetzungen bleiben unangetastet.
 */

import { text } from "../format.ts";

export type TextValue = string | Record<string, string>;

/** Text in der Sprache, sonst in der ersten vorhandenen (wie die App und der Server). */
export function readText(value: TextValue | undefined, lang: string): string {
  return text(value, lang);
}

export function hasText(value: TextValue | undefined, lang: string): boolean {
  return readText(value, lang).trim().length > 0;
}

/**
 * Neuer Wert für ein Textfeld. next leer: andere Sprachen bleiben, sonst undefined (Feld entfernen;
 * bei Pflichtfeldern schreibt der Aufrufer { [lang]: "" }). String oder fehlend: { [lang]: next }.
 * Objekt: Kopie mit [lang] = next.
 */
export function writeText(value: TextValue | undefined, lang: string, next: string): TextValue | undefined {
  if (next === "") {
    if (value && typeof value === "object") {
      const rest = Object.fromEntries(Object.entries(value).filter(([k]) => k !== lang));
      return Object.keys(rest).length ? rest : undefined;
    }
    return undefined;
  }
  if (value && typeof value === "object") return { ...value, [lang]: next };
  return { [lang]: next };
}

/** Zählt Texte, die in einer anderen Sprache fehlen würden (Warnung vor dem Wechsel der Standardsprache). */
export function countMissing(root: unknown, lang: string): number {
  let missing = 0;
  const walk = (value: unknown, key: string) => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, ""));
      return;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length && key !== "approach" && key !== "ui" && keys.every((k) => /^[a-z]{2,3}(-[A-Z]{2})?$/.test(k)) && Object.values(obj).every((v) => typeof v === "string")) {
      if (!(obj[lang] as string | undefined)?.trim()) missing++;
      return;
    }
    for (const k of keys) walk(obj[k], k);
  };
  walk(root, "");
  return missing;
}
