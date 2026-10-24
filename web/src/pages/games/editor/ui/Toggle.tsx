/**
 * Paket A: Ja/Nein-Schalter an einem Pfad. Mit `defaultValue` wird der Standard nicht geschrieben,
 * sondern das Feld entfernt (Standardwerte stehen nur im Spiel, wenn jemand sie setzt).
 */

import { useId } from "preact/hooks";
import { editor, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { JsonPointer } from "../../../../lib/editor/types.ts";
import { IssueList } from "./IssueList.tsx";
import { describedBy, hasError, useFeld } from "./FieldFrame.tsx";

export function Toggle({ path, label, hint, defaultValue }: { path: JsonPointer; label: string; hint?: string; defaultValue?: boolean }) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const value = useFieldValue<boolean>(path);
  const issues = useIssuesAt(path);
  const checked = typeof value === "boolean" ? value : (defaultValue ?? false);
  return (
    <div class={`field ed-field ed-toggle${hasError(issues) ? " invalid" : ""}`} data-feld={feld}>
      <label class="check" for={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-invalid={hasError(issues) || undefined}
          aria-describedby={describedBy(id, !!hint, issues.length > 0)}
          onChange={(e) => {
            const next = e.currentTarget.checked;
            store?.setField(path, defaultValue !== undefined && next === defaultValue ? undefined : next, `${label} ${next ? "an" : "aus"}`);
            store?.touch(path);
          }}
        />
        <span>{label}</span>
      </label>
      {hint && <small id={`${id}-hinweis`}>{hint}</small>}
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </div>
  );
}
