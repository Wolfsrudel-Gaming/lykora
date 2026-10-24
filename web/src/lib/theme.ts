/**
 * Thema: Nacht (Standard), Tag, System. „System“ folgt dem Gerät (prefers-color-scheme).
 * Reine Funktionen; Speichern und Anwenden steht in session.ts, das Vorab-Skript in index.html.
 */

export type Theme = "night" | "day" | "system";
export type ResolvedTheme = "night" | "day";

export const THEMES: readonly Theme[] = ["night", "day", "system"];

/** Unbekanntes oder fehlendes wird Nacht: so war es immer, und so blendet nichts im Gelände. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "day" || raw === "system" || raw === "night" ? raw : "night";
}

export function resolveTheme(theme: Theme, prefersLight: boolean): ResolvedTheme {
  if (theme === "system") return prefersLight ? "day" : "night";
  return theme;
}

/** Farbe der Browserleiste (meta theme-color), passend zu --ground. */
export function themeColor(resolved: ResolvedTheme): string {
  return resolved === "day" ? "#F3EEE4" : "#0B0C0E";
}

export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Hört auf Wechsel der Geräteeinstellung; liefert die Abmeldefunktion. Ohne matchMedia (Tests, alte Browser) passiert nichts. */
export function watchSystemTheme(onChange: (prefersLight: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(LIGHT_QUERY);
  const handler = () => onChange(mq.matches);
  mq.addEventListener?.("change", handler);
  return () => mq.removeEventListener?.("change", handler);
}

export function prefersLight(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(LIGHT_QUERY).matches;
}
