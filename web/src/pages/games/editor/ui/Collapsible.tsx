/**
 * Paket A: Zuklappbarer Abschnitt (details/summary) mit Zusammenfassung und Zustand – für die
 * Abschnitte des Stationseditors. Der Sprung zu einem Feld klappt ihn selbst auf (jump.ts).
 */

import type { ComponentChildren } from "preact";

export type CollapsibleState = "ok" | "warning" | "error" | "empty";

const STATE: Record<CollapsibleState, { mark: string; text: string }> = {
  ok: { mark: "✓", text: "in Ordnung" },
  warning: { mark: "!", text: "mit Warnung" },
  error: { mark: "✗", text: "mit Fehler" },
  empty: { mark: "○", text: "noch leer" },
};

export function Collapsible({
  title,
  summary,
  state,
  open,
  feld,
  id,
  onToggle,
  children,
}: {
  title: string;
  /** kurze Zusammenfassung neben dem Titel, z. B. „GPS 20 m, QR-Code“ */
  summary?: string;
  state?: CollapsibleState;
  /** zu Beginn offen */
  open?: boolean;
  /** data-feld des Abschnitts, damit der Sprung ihn findet */
  feld?: string;
  id?: string;
  onToggle?: (open: boolean) => void;
  children: ComponentChildren;
}) {
  const s = state ? STATE[state] : null;
  return (
    <details class={`collapsible${state ? ` ${state}` : ""}`} open={open} data-feld={feld} id={id} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary>
        <span class="collapsible-title">{title}</span>
        {summary && <span class="collapsible-summary small muted">{summary}</span>}
        {s && (
          <span class={`mark ${state}`} aria-label={s.text}>
            {s.mark}
          </span>
        )}
      </summary>
      <div class="collapsible-body stack">{children}</div>
    </details>
  );
}
