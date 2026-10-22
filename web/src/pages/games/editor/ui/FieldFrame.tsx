/**
 * Paket A: Rahmen aller Formularbausteine des Baukastens – Beschriftung, Hinweis, Meldungen
 * darunter (IssueList) und die Pflichtattribute: data-feld am Rahmen (Sprungziel), aria-invalid
 * und aria-describedby am Feld. Die Bausteine setzen die Attribute über describedBy/hasError.
 */

import type { ComponentChildren } from "preact";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import type { EditorIssue, JsonPointer } from "../../../../lib/editor/types.ts";
import { addressOf } from "../../../../lib/editor/validation.ts";
import { IssueList } from "./IssueList.tsx";

/** data-feld eines Pfads: Feldname relativ zum Objekt, sonst Punkt-Pfad ab Wurzel. */
export function useFeld(path: JsonPointer): string {
  return useEditorSelect((s) => addressOf(path, s.game).field ?? "");
}

export function hasError(issues: EditorIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Wert für aria-describedby: Hinweis und Meldungen, soweit vorhanden. */
export function describedBy(id: string, hint: boolean, issues: boolean): string | undefined {
  const ids: string[] = [];
  if (hint) ids.push(`${id}-hinweis`);
  if (issues) ids.push(`${id}-meldungen`);
  return ids.length ? ids.join(" ") : undefined;
}

export function FieldFrame({
  id,
  label,
  hint,
  required,
  issues,
  feld,
  inline,
  children,
}: {
  id: string;
  label: string;
  hint?: ComponentChildren;
  required?: boolean;
  issues: EditorIssue[];
  feld: string;
  /** Beschriftung neben dem Feld statt darüber (Schalter) */
  inline?: boolean;
  children: ComponentChildren;
}) {
  return (
    <div class={`field ed-field${inline ? " inline" : ""}${hasError(issues) ? " invalid" : ""}`} data-feld={feld}>
      <label for={id}>
        {label}
        {required && <span class="muted"> (Pflicht)</span>}
      </label>
      {children}
      {hint && <small id={`${id}-hinweis`}>{hint}</small>}
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </div>
  );
}
