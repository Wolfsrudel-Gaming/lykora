/**
 * Paket D: Verweis in einem Regelbaustein (Station, Gegenstand, Kapitel). Solange nichts gewählt ist,
 * steht der Baustein gestrichelt da und sagt, was fehlt („Wähl eine Station.“) – statt der
 * Schema-Meldung über Kennungen. Hinweise zum Verweis (Station schon sichtbar …) erscheinen sofort.
 */

import { useId } from "preact/hooks";
import { MISSING_TEXT, type Missing } from "../../../../lib/editor/rules.ts";
import { useEditorSelect, useFieldValue } from "../../../../lib/editor/store.ts";
import type { IdKind, JsonPointer } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { feldFromPath, refOptions, type RefOption } from "../ui/RefSelect.tsx";
import { store, useLiveIssues } from "../story/shared.tsx";

/** Meldungen, die der Baustein selbst in Worten sagt. */
const OWN = new Set(["pattern", "incomplete_rule", "unknown_station", "unknown_item", "unknown_chapter"]);

/** Stationen für „erscheint“: versteckte zuerst, sichtbare mit Zusatz. */
function revealOptions(options: RefOption[], hidden: Set<string>): RefOption[] {
  return [...options.filter((o) => hidden.has(o.value)), ...options.filter((o) => !hidden.has(o.value)).map((o) => ({ ...o, label: `${o.label} (ist schon sichtbar)` }))];
}

export function RefPick({
  path,
  kind,
  label,
  missing,
  reveal,
  onCreate,
}: {
  path: JsonPointer;
  kind: IdKind;
  label: string;
  missing: Missing;
  /** Auswahl für „Station erscheint“ */
  reveal?: boolean;
  onCreate?: () => Promise<string | null>;
}) {
  const id = useId();
  const value = useFieldValue<string>(path);
  const options = useEditorSelect(
    (s) => {
      const all = refOptions(s.game, kind, s.lang, s.expert);
      if (!reveal) return all;
      return revealOptions(all, new Set((s.game.stations ?? []).filter((st) => st?.visibility === "hidden").map((st) => st.id)));
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const issues = useLiveIssues([path]).filter((i) => !OWN.has(i.code));
  const unset = typeof value !== "string" || !value.trim();
  const known = !unset && options.some((o) => o.value === value);
  const set = (next: string) => {
    const o = options.find((x) => x.value === next);
    store().setField(path, next, o ? `${label}: ${o.label}` : `${label} abgewählt`);
    store().touch(path);
  };
  const create = async () => {
    const created = await onCreate?.();
    if (created) set(created);
  };
  const problem = unset ? MISSING_TEXT[missing] : known ? null : "Das gibt es nicht mehr – bitte neu wählen.";
  return (
    <div class={`field ed-field d-ref${problem ? " d-unset" : ""}`} data-feld={feldFromPath(path)}>
      <label for={id}>{label}</label>
      <span class="ed-unit">
        <select id={id} value={unset ? "" : value} aria-invalid={!!problem || undefined} aria-describedby={problem ? `${id}-fehlt` : undefined} onChange={(e) => set(e.currentTarget.value)}>
          <option value="">– bitte wählen –</option>
          {!unset && !known && <option value={value}>Unbekannt</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {onCreate && (
          <button type="button" class="btn small" onClick={() => void create()}>
            <Icon name="plus" /> Neu
          </button>
        )}
      </span>
      {problem && (
        <small id={`${id}-fehlt`} class="d-missing">
          <span aria-hidden="true">✗ </span>
          <span class="sr-only">Fehler: </span>
          {problem}
        </small>
      )}
      <IssueList issues={issues} />
    </div>
  );
}
