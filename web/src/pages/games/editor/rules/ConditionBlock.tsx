/**
 * Paket D: Bedingung einer Regel (SOBALD/UND) – Art wählen, dann den Wert: Station gelöst, Gegenstand
 * im Inventar, Codeteile, Spielzeit in Minuten oder Nähe zu einem Ort (Mini-Karte, Name nur im Baukasten).
 * Das Menü macht eine UND-Bedingung zur Sobald-Bedingung oder entfernt sie.
 */

import { useId } from "preact/hooks";
import { CONDITION_KINDS, CONDITION_LABELS, conditionKind, conditionPointer, missingOf, newCondition, type Condition, type ConditionKind } from "../../../../lib/editor/rules.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { createItem, LocationField, Menu } from "../station/common.tsx";
import { DurationInput } from "../ui/DurationInput.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { store, useLiveIssues } from "../story/shared.tsx";
import { editRule } from "./edit.ts";
import { RefPick } from "./RefPick.tsx";

export function ConditionBlock({ index, j, condition, count }: { index: number; j: number; condition: Condition; count: number }) {
  const p = conditionPointer(index, j);
  const kind = conditionKind(condition);
  const kindId = useId();
  const lang = useEditorSelect((s) => s.lang);
  const fragments = useEditorSelect((s) => (s.game.fragments ?? []).length);
  const issues = [...useLiveIssues([p]), ...useLiveIssues([`${p}/fragments_collected`], { field: true })];
  const unset = !!missingOf(condition, lang);
  const what = j === 0 ? "Sobald-Bedingung" : "Und-Bedingung";

  const setKind = (k: ConditionKind) => editRule(index, `${what}: ${CONDITION_LABELS[k]}`, (r) => void (r.when[j] = newCondition(k)));

  return (
    <div class={`d-block${unset ? " d-unset" : ""}`}>
      <div class="d-block-head">
        <label class="sr-only" for={kindId}>
          Art der {what}
        </label>
        <select id={kindId} class="d-kind" value={kind ?? ""} onChange={(e) => setKind(e.currentTarget.value as ConditionKind)}>
          {!kind && <option value="">Unfertige Bedingung</option>}
          {CONDITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONDITION_LABELS[k]}
            </option>
          ))}
        </select>
        {(j > 0 || count > 1) && (
          <Menu label={`${what}: weitere Aktionen`}>
            {(close) => (
              <>
                {j > 0 && (
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        editRule(index, "Zur Sobald-Bedingung gemacht", (r) => {
                          const [c] = r.when.splice(j, 1);
                          r.when.unshift(c!);
                        });
                      }}
                    >
                      Zur Sobald-Bedingung machen
                    </button>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      editRule(index, `${what} entfernt`, (r) => void r.when.splice(j, 1));
                    }}
                  >
                    Bedingung entfernen
                  </button>
                </li>
              </>
            )}
          </Menu>
        )}
      </div>
      {kind === "station_solved" && (
        <div class="d-sentence">
          <RefPick path={`${p}/station_solved`} kind="station" label="Station" missing="station" />
          <span class="d-word">ist gelöst</span>
        </div>
      )}
      {kind === "has_item" && (
        <div class="d-sentence">
          <span class="d-word">Team hat</span>
          <RefPick path={`${p}/has_item`} kind="gegenstand" label="Gegenstand" missing="item" onCreate={() => createItem("object")} />
        </div>
      )}
      {kind === "fragments_collected" && (
        <NumberInput
          path={`${p}/fragments_collected`}
          label="Team hat mindestens … Codeteile"
          integer
          min={1}
          max={Math.max(1, fragments)}
          required
          hint={fragments ? `Im Spiel gibt es ${fragments} ${fragments === 1 ? "Codeteil" : "Codeteile"}.` : "Noch keine Codeteile angelegt (Belohnungen › Finalcode)."}
        />
      )}
      {kind === "elapsed" && <DurationInput path={`${p}/elapsed`} label="Team spielt seit" required hint="Geprüft wird bei der nächsten Aktion des Teams, nicht auf die Sekunde." />}
      {kind === "near" && <Near index={index} j={j} condition={condition} />}
      <IssueList issues={issues} />
    </div>
  );
}

/** „Team ist im Umkreis von r m um [Ort]“: Ort auf der Mini-Karte, Name nur im Baukasten. */
function Near({ index, j, condition }: { index: number; j: number; condition: Condition }) {
  const p = conditionPointer(index, j);
  const id = useId();
  const radius = "near" in condition ? condition.near?.radius : undefined;
  const name = useEditorSelect((s) => s.meta.placeNames?.[p] ?? "");
  const setName = (next: string) =>
    store().update(
      "Name des Regelorts geändert",
      (_g, meta) => {
        const names = { ...(meta.placeNames ?? {}) };
        if (next.trim()) names[p] = next;
        else delete names[p];
        if (Object.keys(names).length) meta.placeNames = names;
        else delete meta.placeNames;
      },
      { coalesce: `ort:${p}` },
    );
  return (
    <div class="stack tight">
      <div class="grid-2">
        <div class="field ed-field">
          <label for={id}>Name des Orts</label>
          <input id={id} value={name} placeholder="z. B. Alte Brücke" onInput={(e) => setName(e.currentTarget.value)} />
          <small>Nur für euch im Baukasten; Teams sehen ihn nicht.</small>
        </div>
        <NumberInput path={`${p}/near/radius`} label="Umkreis" unit="m" integer min={5} required />
      </div>
      <LocationField
        path={`${p}/near/location`}
        label="Ort"
        required
        radius={typeof radius === "number" ? radius : undefined}
        onRadius={(r) => store().setField(`${p}/near/radius`, r, "Umkreis des Regelorts geändert")}
        hint="Geprüft wird die letzte Position, die das Team mitschickt – bei seiner nächsten Aktion."
      />
    </div>
  );
}
