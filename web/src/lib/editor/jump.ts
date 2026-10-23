/**
 * Paket A: Sprung zu einem Feld. jumpTo navigiert in den Bereich (Station: eigene Seite) mit
 * ?feld= (und ?objekt= für Objekte außerhalb der Stationen); focusField sucht danach das Element
 * [data-feld] im Container [data-objekt], klappt zu, scrollt in die Mitte, setzt den Fokus und
 * hebt es 1,5 s hervor (.jump-flash). EditorShell ruft focusField nach dem Rendern.
 */

import { href, location, navigate } from "../router.ts";
import { editor } from "./store.ts";
import type { FieldAddress, Section } from "./types.ts";

export const FLASH_MS = 1500;

/** Pfad in den Baukasten (Routen editor, editorSection, editorStation). */
export function editorPath(gameId: string, section: Section = "uebersicht", stationId?: string, query: Record<string, string | undefined> = {}): string {
  if (section === "stationen" && stationId) return href("editorStation", { gameId, stationId }, query);
  if (section !== "uebersicht") return href("editorSection", { gameId, section }, query);
  return href("editor", { gameId }, query);
}

/** Ziel einer Adresse: Station mit ID → Stationsseite, sonst der Bereich mit objekt/feld als Suchparameter. */
export function targetOf(address: FieldAddress, gameId: string): string {
  const station = address.section === "stationen" && address.objectId && !address.objectId.startsWith("#");
  if (station) return editorPath(gameId, "stationen", address.objectId, { feld: address.field });
  const section = address.section === "stationen" ? "karte" : address.section;
  return editorPath(gameId, section, undefined, { objekt: address.objectId, feld: address.field });
}

/** Element zu einer Adresse im gerenderten Bereich. */
export function findField(address: FieldAddress, root: ParentNode = document): HTMLElement | null {
  const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));
  const scope = address.objectId ? root.querySelector(`[data-objekt="${esc(address.objectId)}"]`) : root;
  if (!scope) return null;
  if (!address.field) return scope === root ? null : (scope as HTMLElement);
  // Erst das genaue Feld, dann der nächstgrößere Behälter (task.answers.0 → task.answers → task).
  const parts = address.field.split(".");
  for (let n = parts.length; n > 0; n--) {
    const el = scope.querySelector<HTMLElement>(`[data-feld="${esc(parts.slice(0, n).join("."))}"]`);
    if (el) return el;
  }
  return null;
}

/** Fokus und Hervorhebung; liefert, ob das Feld gefunden wurde. */
export function focusField(address: FieldAddress, root: ParentNode = document): boolean {
  const el = findField(address, root);
  if (!el) return false;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  const focusable = el.matches("input, textarea, select, button, [tabindex]") ? el : el.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]");
  (focusable ?? el).focus?.({ preventScroll: true });
  el.classList.add("jump-flash");
  setTimeout(() => el.classList.remove("jump-flash"), FLASH_MS);
  return true;
}

/** Zum Feld springen: navigiert, dann versucht es den Fokus, sobald der Bereich gerendert ist. */
export function jumpTo(address: FieldAddress, opts: { replace?: boolean } = {}): boolean {
  const gameId = editor.get().current?.get().gameId;
  if (!gameId) return false;
  const to = targetOf(address, gameId);
  const { path, query } = location.get();
  const here = `${path}${query.toString() ? `?${query}` : ""}`;
  navigate(to, { replace: opts.replace ?? here.split("?")[0] === to.split("?")[0] });
  if (typeof document !== "undefined") {
    // Erst nach dem nächsten Rendern, bei trägen Bereichen (Karte) noch einmal kurz danach.
    const attempt = () => focusField(address);
    (globalThis.requestAnimationFrame ?? ((fn: () => void) => setTimeout(fn, 0)))(() => {
      if (!attempt()) setTimeout(attempt, 300);
    });
  }
  return true;
}
