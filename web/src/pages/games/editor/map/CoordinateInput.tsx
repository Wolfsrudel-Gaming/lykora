/**
 * Paket B: Ort als Koordinaten – der Weg ohne Karte (UX §6.5). Zeigt den Punkt mit 5 Nachkommastellen
 * und in Grad/Minuten/Sekunden; nimmt dezimal („50.8155, 7.155“, auch mit Komma) oder Grad/Minuten/
 * Sekunden an. Übernommen wird mit Enter oder beim Verlassen; Unlesbares bleibt stehen und wird erklärt.
 */

import { useEffect, useId, useState } from "preact/hooks";
import { formatDms, formatPoint, parseCoordinates } from "../../../../lib/editor/geo.ts";
import type { EditorIssue, Point } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { describedBy, hasError } from "../ui/FieldFrame.tsx";
import { IssueList } from "../ui/IssueList.tsx";

export function CoordinateInput({
  value,
  onChange,
  label = "Ort",
  feld,
  issues = [],
  required,
  onShow,
  onBlur,
}: {
  value: Point | null | undefined;
  onChange: (p: Point) => void;
  label?: string;
  /** data-feld (Sprungziel), z. B. "location" */
  feld?: string;
  issues?: EditorIssue[];
  required?: boolean;
  /** „Auf der Karte zeigen“ */
  onShow?: () => void;
  onBlur?: () => void;
}) {
  const id = useId();
  const shown = value ? formatPoint(value) : "";
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(shown);
    setError("");
  }, [shown]);

  const commit = () => {
    if (draft.trim() === shown) return setError("");
    if (!draft.trim()) {
      setDraft(shown);
      return setError("");
    }
    const p = parseCoordinates(draft);
    if (!p) return setError("Das sind keine Koordinaten. Beispiel: 50.81550, 7.15500 oder 50° 48′ 55″ N, 7° 9′ 18″ O.");
    setError("");
    onChange(p);
  };

  const invalid = !!error || hasError(issues);
  return (
    <div class={`field ed-field ed-coords${invalid ? " invalid" : ""}`} data-feld={feld}>
      <label for={id}>
        {label}
        {required && <span class="muted"> (Pflicht)</span>}
      </label>
      <span class="row nowrap">
        <input
          id={id}
          class="mono"
          value={draft}
          placeholder="Breite, Länge – z. B. 50.81550, 7.15500"
          autoComplete="off"
          spellcheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy(id, true, issues.length > 0 || !!error)}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && draft !== shown) {
              e.preventDefault();
              e.stopPropagation();
              setDraft(shown);
              setError("");
            }
          }}
          onBlur={() => {
            commit();
            onBlur?.();
          }}
        />
        {onShow && value && (
          <button type="button" class="btn small ghost" onClick={onShow} title="Auf der Karte zeigen" aria-label={`${label} auf der Karte zeigen`}>
            <Icon name="map" />
          </button>
        )}
      </span>
      <small id={`${id}-hinweis`}>{value ? formatDms(value) : "Noch kein Ort. Koordinaten einfügen oder in die Karte klicken."}</small>
      <div id={`${id}-meldungen`}>
        {error && (
          <ul class="issues">
            <li class="issue error">
              <span class="issue-mark" aria-hidden="true">
                ✗
              </span>
              <span class="issue-text">{error}</span>
            </li>
          </ul>
        )}
        <IssueList issues={issues} />
      </div>
    </div>
  );
}
