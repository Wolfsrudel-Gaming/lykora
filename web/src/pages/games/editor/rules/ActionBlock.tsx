/**
 * Paket D: Aktion einer Regel (DANN/SONST) – Art wählen, dann den Wert: Station erscheint (versteckte
 * zuerst), Gegenstand geben, Punkte (+/−), Funkspruch mit Absender und Text, Kapitel beginnt.
 */

import { useId } from "preact/hooks";
import { ACTION_KINDS, ACTION_LABELS, actionKind, missingOf, MISSING_TEXT, newAction, SENDER_LABELS, type Action, type ActionKind, type Sender } from "../../../../lib/editor/rules.ts";
import { getAt } from "../../../../lib/editor/paths.ts";
import { isTouched, useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import { createChapter, createItem } from "../station/common.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { parseNumber } from "../ui/NumberInput.tsx";
import { feldFromPath } from "../ui/RefSelect.tsx";
import { TextField } from "../ui/TextField.tsx";
import { store, useLiveIssues } from "../story/shared.tsx";
import { editRule } from "./edit.ts";
import { RefPick } from "./RefPick.tsx";

export type ActionList = "then" | "else";

export function ActionBlock({ index, list, j, action, removable }: { index: number; list: ActionList; j: number; action: Action; removable: boolean }) {
  const p = `/rules/${index}/${list}/${j}`;
  const kind = actionKind(action);
  const kindId = useId();
  const lang = useEditorSelect((s) => s.lang);
  const issues = useLiveIssues([p, `${p}/message/from`]);
  const unset = !!missingOf(action, lang);
  const what = list === "then" ? "Dann-Aktion" : "Sonst-Aktion";

  const setKind = (k: ActionKind) => editRule(index, `${what}: ${ACTION_LABELS[k]}`, (r, g) => void (r[list]![j] = newAction(k, g.meta?.languages?.[0] ?? "de")));
  const remove = () =>
    editRule(index, `${what} entfernt`, (r) => {
      r[list]!.splice(j, 1);
      if (list === "else" && !r.else!.length) delete r.else;
    });

  return (
    <div class={`d-block${unset ? " d-unset" : ""}`}>
      <div class="d-block-head">
        <label class="sr-only" for={kindId}>
          Art der {what}
        </label>
        <select id={kindId} class="d-kind" value={kind ?? ""} onChange={(e) => setKind(e.currentTarget.value as ActionKind)}>
          {!kind && <option value="">Unfertige Aktion</option>}
          {ACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACTION_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="btn small ghost d-remove"
          aria-label={`${what} entfernen`}
          title={removable ? `${what} entfernen` : "Eine Regel braucht mindestens eine Dann-Aktion."}
          disabled={!removable}
          onClick={remove}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {kind === "reveal_station" && (
        <div class="d-sentence">
          <RefPick path={`${p}/reveal_station`} kind="station" label="Station" missing="station" reveal />
          <span class="d-word">erscheint auf der Karte</span>
        </div>
      )}
      {kind === "give_item" && (
        <div class="d-sentence">
          <span class="d-word">Team bekommt</span>
          <RefPick path={`${p}/give_item`} kind="gegenstand" label="Gegenstand" missing="item" onCreate={() => createItem("object")} />
        </div>
      )}
      {kind === "add_points" && "add_points" in action && <Points path={`${p}/add_points`} value={action.add_points} />}
      {kind === "message" && "message" in action && <Message path={`${p}/message`} from={action.message?.from} />}
      {kind === "start_chapter" && (
        <div class="d-sentence">
          <span class="d-word">Kapitel</span>
          <RefPick path={`${p}/start_chapter`} kind="kapitel" label="Kapitel" missing="chapter" onCreate={createChapter} />
          <span class="d-word">beginnt</span>
        </div>
      )}
      <IssueList issues={issues} />
    </div>
  );
}

/** „Team [bekommt|verliert] [n] Punkte“: Vorzeichen als Auswahl, Betrag als Zahl. */
function Points({ path, value }: { path: string; value: number }) {
  const id = useId();
  const n = typeof value === "number" ? value : 0;
  const sign = n < 0 ? -1 : 1;
  const write = (s: number, raw: string) => {
    const amount = parseNumber(raw);
    if (amount === null) return;
    store().setField(path, s * Math.abs(Math.round(amount)), "Punkte der Regel geändert", { coalesce: true });
  };
  return (
    <div class="d-sentence">
      <span class="d-word">Team</span>
      <label class="sr-only" for={`${id}-vz`}>
        bekommt oder verliert
      </label>
      <select id={`${id}-vz`} value={String(sign)} onChange={(e) => write(Number(e.currentTarget.value), String(Math.abs(n)))}>
        <option value="1">bekommt</option>
        <option value="-1">verliert</option>
      </select>
      <label class="sr-only" for={id}>
        Punkte
      </label>
      <input id={id} type="number" inputMode="numeric" class="d-points-input" min={0} step={1} value={Math.abs(n)} onInput={(e) => write(sign, e.currentTarget.value)} onBlur={() => store().touch(path)} />
      <span class="d-word">Punkte</span>
    </div>
  );
}

/** Funkspruch: Absender (Zentrale ist Standard) und Text. */
function Message({ path, from }: { path: string; from: Sender | undefined }) {
  const id = useId();
  // Bis das Feld berührt ist, sagt der Baustein selbst, was fehlt; danach die Meldung am Feld.
  const empty = useEditorSelect((s) => !readText(getAt(s.game, `${path}/text`) as never, s.lang).trim() && !(s.showAll || isTouched(s.touched, `${path}/text`)));
  return (
    <div class="stack tight">
      <div class="field ed-field" data-feld={feldFromPath(`${path}/from`)}>
        <label for={id}>Funkspruch von</label>
        <select
          id={id}
          value={from ?? "hq"}
          onChange={(e) => {
            const next = e.currentTarget.value as Sender;
            store().setField(`${path}/from`, next, `Absender: ${SENDER_LABELS[next]}`);
            store().touch(`${path}/from`);
          }}
        >
          {(Object.keys(SENDER_LABELS) as Sender[]).map((s) => (
            <option key={s} value={s}>
              {SENDER_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <TextField path={`${path}/text`} label="Text" required multiline rows={2} placeholder="z. B. Gut gemacht, weiter zum Finale!" />
      {empty && (
        <small class="d-missing">
          <span aria-hidden="true">✗ </span>
          {MISSING_TEXT.text}
        </small>
      )}
    </div>
  );
}
