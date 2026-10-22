/**
 * Paket A: Meldungen unter einem Feld oder in einer Liste – Symbol je Stufe (✗ ! ○), Satz,
 * Sofort-Lösung als Knopf, „Beheben ›“ (Sprung) und „Passt so“ für ausblendbare Warnungen.
 * Rot gibt es hier nie; Fehler tragen die Bernstein-Kante.
 */

import { jumpTo } from "../../../../lib/editor/jump.ts";
import { editor } from "../../../../lib/editor/store.ts";
import type { EditorIssue, Severity } from "../../../../lib/editor/types.ts";
import { notify } from "../../../../lib/session.ts";

export const SEVERITY_MARK: Record<Severity, { mark: string; text: string }> = {
  error: { mark: "✗", text: "Fehler" },
  warning: { mark: "!", text: "Warnung" },
  hint: { mark: "○", text: "Tipp" },
};

/** Sofort-Lösung anwenden: ein Schritt im Verlauf mit dem Text der Lösung. */
export function applyFix(issue: EditorIssue): void {
  const store = editor.get().current;
  if (!store || !issue.fix) return;
  store.update(issue.fix.undoLabel, issue.fix.apply, { focus: issue.at });
  notify(issue.fix.undoLabel, "ok");
}

export function IssueList({
  issues,
  id,
  jump = false,
  dismiss = true,
}: {
  issues: EditorIssue[];
  id?: string;
  /** „Beheben ›“ zeigen (Checkliste, Übersicht); am Feld selbst nicht nötig */
  jump?: boolean;
  /** „Passt so“ bei ausblendbaren Meldungen */
  dismiss?: boolean;
}) {
  if (!issues.length) return null;
  const store = editor.get().current;
  return (
    <ul class="issues" id={id}>
      {issues.map((i) => {
        const m = SEVERITY_MARK[i.severity];
        return (
          <li key={i.id} class={`issue ${i.severity}`}>
            <span class="issue-mark" aria-hidden="true">
              {m.mark}
            </span>
            <span class="issue-text">
              <span class="sr-only">{m.text}: </span>
              {i.message}
              {i.source === "server" && <span class="muted"> (vom Server gemeldet)</span>}
            </span>
            {(i.fix || jump || (dismiss && i.dismissable)) && (
              <span class="issue-actions">
                {i.fix && (
                  <button type="button" class="btn small" onClick={() => applyFix(i)}>
                    {i.fix.label}
                  </button>
                )}
                {jump && (
                  <button type="button" class="btn small ghost" onClick={() => jumpTo(i.at)}>
                    Beheben ›
                  </button>
                )}
                {dismiss && i.dismissable && (
                  <button type="button" class="btn small ghost" onClick={() => store?.dismissIssue(i.id)}>
                    Passt so
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
