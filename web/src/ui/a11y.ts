/**
 * Reine Hilfen für Bedienung per Tastatur und für ARIA-Verdrahtung. Ohne DOM, damit sie sich testen lassen
 * (test/ui-logic.test.ts); die Bausteine rufen sie nur auf.
 */

/** Neuer Index für Reiter, Radiogruppen und Segmentleisten (roving tabindex); null = Taste gehört nicht dazu. */
export function rovingNext(
  key: string,
  index: number,
  count: number,
  opts: { orientation?: "horizontal" | "vertical" | "both"; disabled?: readonly boolean[] } = {},
): number | null {
  if (count <= 0) return null;
  const { orientation = "horizontal", disabled = [] } = opts;
  const forward = orientation === "vertical" ? ["ArrowDown"] : orientation === "both" ? ["ArrowRight", "ArrowDown"] : ["ArrowRight"];
  const backward = orientation === "vertical" ? ["ArrowUp"] : orientation === "both" ? ["ArrowLeft", "ArrowUp"] : ["ArrowLeft"];
  const free = (i: number) => !disabled[i];
  const walk = (from: number, step: 1 | -1): number => {
    for (let n = 1; n <= count; n++) {
      const i = (from + step * n + count * n) % count;
      if (free(i)) return i;
    }
    return from;
  };
  if (forward.includes(key)) return walk(index, 1);
  if (backward.includes(key)) return walk(index, -1);
  if (key === "Home") return free(0) ? 0 : walk(0, 1);
  if (key === "End") return free(count - 1) ? count - 1 : walk(count - 1, -1);
  return null;
}

export type MenuAction = { type: "move"; index: number } | { type: "close"; refocus: boolean } | { type: "select" } | null;

/** Tasten im offenen Menü: Pfeile mit Umlauf, Home/End, Enter und Leertaste wählen, Escape schließt, Tab schließt ohne Rückfokus. */
export function menuKeyAction(key: string, active: number, count: number, disabled: readonly boolean[] = []): MenuAction {
  if (key === "Escape") return { type: "close", refocus: true };
  if (key === "Tab") return { type: "close", refocus: false };
  if (key === "Enter" || key === " ") return { type: "select" };
  const next = rovingNext(key, active, count, { orientation: "vertical", disabled });
  return next === null ? null : { type: "move", index: next };
}

/**
 * Index des Eintrags, der mit der getippten Zeichenfolge beginnt (Tippsuche im Menü). Ein einzelner oder
 * mehrfach getippter Buchstabe springt von Eintrag zu Eintrag; eine längere Folge sucht ab dem aktuellen.
 */
export function typeaheadIndex(labels: readonly string[], typed: string, from: number, disabled: readonly boolean[] = []): number | null {
  const q = typed.toLocaleLowerCase("de");
  if (!q || labels.length === 0) return null;
  const repeated = [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0]! : q;
  const start = repeated ? from + 1 : from;
  for (let n = 0; n < labels.length; n++) {
    const i = (((start + n) % labels.length) + labels.length) % labels.length;
    if (!disabled[i] && labels[i]!.toLocaleLowerCase("de").startsWith(needle)) return i;
  }
  return null;
}

/** Tab am Rand eines Bereichs: wohin springt der Fokus, damit er ihn nicht verlässt? null = der Browser darf entscheiden. */
export function trapTab(active: unknown, first: unknown, last: unknown, shift: boolean): "first" | "last" | null {
  if (shift && active === first) return "last";
  if (!shift && active === last) return "first";
  return null;
}

// Felder

export interface FieldIds {
  control: string;
  hint: string;
  error: string;
}

export function fieldIds(id: string): FieldIds {
  return { control: id, hint: `${id}-hinweis`, error: `${id}-fehler` };
}

/** Attribute für das Eingabeelement eines Feldes: Beschriftung per id, Hinweis und Fehler per aria-describedby. */
export function fieldControlProps(
  id: string,
  state: { hint?: boolean; error?: boolean; required?: boolean; describedBy?: string },
): { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined; "aria-required": true | undefined } {
  const ids = fieldIds(id);
  const described = [state.describedBy, state.hint ? ids.hint : "", state.error ? ids.error : ""].filter(Boolean).join(" ");
  return {
    id,
    "aria-describedby": described || undefined,
    "aria-invalid": state.error ? true : undefined,
    "aria-required": state.required ? true : undefined,
  };
}

// Fokus

/** Reihenfolge, in der ein Dialog seinen ersten Fokus sucht: ausdrücklich markiert, erstes Feld, Hauptaktion, erstes Bedienelement. */
export const INITIAL_FOCUS_SELECTORS = [
  "[data-autofocus]",
  ".dialog-scroll :is(input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled))",
  ".dialog-foot :is(.btn--primary,.btn.primary,.btn--danger,.btn--safety,.btn.safety):not(:disabled)",
  ".dialog-scroll :is(.btn--primary,.btn.primary,.btn--safety,.btn.safety):not(:disabled)",
  ".dialog-scroll :is(button,[href],[tabindex]):not(:disabled):not([tabindex='-1'])",
  ".dialog-foot :is(button,[href]):not(:disabled)",
  ".dialog-close",
] as const;

export function pickInitialFocus<T>(query: (selector: string) => T | null): T | null {
  for (const sel of INITIAL_FOCUS_SELECTORS) {
    const el = query(sel);
    if (el) return el;
  }
  return null;
}

/** Elemente, die ein Fokus-Rücksprung noch erreichen kann. */
export function canRestoreFocus(el: { isConnected?: boolean; focus?: unknown } | null | undefined): boolean {
  return !!el && el.isConnected !== false && typeof el.focus === "function";
}

// Schwebende Flächen (Menü, Popover, Tooltip)

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "top" | "bottom";
}

/**
 * Ort einer schwebenden Fläche (position: fixed): unter dem Anker, bei Platzmangel darüber,
 * ausgerichtet am Anfang oder Ende des Ankers und immer im Fenster.
 */
export function placeFloating(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { side?: "top" | "bottom"; align?: "start" | "end" | "center"; gap?: number; margin?: number } = {},
): Placement {
  const { side: preferred = "bottom", align = "start", gap = 4, margin = 8 } = opts;
  const below = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const above = anchor.top - gap - margin;
  let side = preferred;
  if (preferred === "bottom" && size.height > below && above > below) side = "top";
  else if (preferred === "top" && size.height > above && below > above) side = "bottom";
  const top = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - size.height - gap;
  let left = align === "end" ? anchor.left + anchor.width - size.width : align === "center" ? anchor.left + (anchor.width - size.width) / 2 : anchor.left;
  left = Math.max(margin, Math.min(left, viewport.width - size.width - margin));
  return { top: Math.max(margin, top), left, side };
}
