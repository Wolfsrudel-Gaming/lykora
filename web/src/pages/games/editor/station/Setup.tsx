/**
 * Paket C: Aufbau der Station – Requisiten für die Materialliste (Name, Anzahl, Art, Notiz; beim
 * Zahlenschloss „Code aus dem Rätsel übernehmen“) und die Notiz für Spielleitung und Aufbau.
 */

import { useEditorSelect } from "../../../../lib/editor/store.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { Collapsible } from "../ui/Collapsible.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { TextField } from "../ui/TextField.tsx";
import { stationPath, store, useSectionState } from "./common.tsx";

type Prop = NonNullable<Station["props"]>[number];
type PropKind = NonNullable<Prop["kind"]>;

export const PROP_KINDS: Record<PropKind, string> = {
  lock: "Zahlenschloss",
  uv_message: "UV-Botschaft",
  puzzle: "Puzzle",
  hidden_object: "Versteckter Gegenstand",
  marker: "Markierung",
  document: "Dokument",
  box: "Kiste",
  other: "Sonstiges",
};

export function Setup({ station, index }: { station: Station; index: number }) {
  const p = stationPath(index);
  const props = (station.props ?? []) as Prop[];
  const code = useEditorSelect((s) => {
    const t = s.game.stations?.[index]?.task;
    return t && (t.type === "code" || t.type === "text") ? (t.answers?.[0] ?? "") : "";
  });
  const state = useSectionState([`${p}/props`, `${p}/notes`], props.length > 0 || !!station.notes);
  const summary = [props.length === 1 ? "1 Requisite" : props.length ? `${props.length} Requisiten` : "", station.notes ? "Notiz für die Spielleitung" : ""].filter(Boolean).join(" · ");

  const mutate = (undo: string, fn: (list: Prop[]) => void) =>
    store().update(undo, (g) => {
      const s = g.stations[index]!;
      const list = [...(s.props ?? [])];
      fn(list);
      if (list.length) s.props = list;
      else delete s.props;
    });

  return (
    <Collapsible title="Aufbau" summary={summary || "nichts zu tun"} state={state} feld="props">
      <div class="stack tight" data-feld="props">
        <h4 class="st-lane-title">Requisiten</h4>
        <p class="small muted">Kommt in die Materialliste.</p>
        {props.map((prop, k) => (
          <div key={k} class="st-prop" data-feld={`props.${k}`}>
            <TextField path={`${p}/props/${k}/name`} label="Name" plain required />
            <NumberInput path={`${p}/props/${k}/quantity`} label="Anzahl" integer min={1} placeholder="1" />
            <label class="field" data-feld={`props.${k}.kind`}>
              <span class="label">Art</span>
              <select value={prop?.kind ?? ""} onChange={(e) => store().setField(`${p}/props/${k}/kind`, e.currentTarget.value || undefined, "Art der Requisite geändert")}>
                <option value="">–</option>
                {(Object.keys(PROP_KINDS) as PropKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {PROP_KINDS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <TextField path={`${p}/props/${k}/note`} label="Notiz" plain placeholder={prop?.kind === "lock" ? "z. B. Code 372" : undefined} />
            <span class="row nowrap st-self-end">
              {prop?.kind === "lock" && code && (
                <button type="button" class="btn small" onClick={() => store().setField(`${p}/props/${k}/note`, `Code ${code}`, "Code aus dem Rätsel übernommen")}>
                  Code aus dem Rätsel übernehmen
                </button>
              )}
              <button type="button" class="btn small ghost" aria-label={`Requisite ${k + 1} entfernen`} onClick={() => mutate(`Requisite ${k + 1} entfernt`, (l) => l.splice(k, 1))}>
                <Icon name="trash" />
              </button>
            </span>
          </div>
        ))}
        <button type="button" class="btn small st-self-start" onClick={() => mutate("Requisite hinzugefügt", (l) => l.push({ name: "" }))}>
          <Icon name="plus" /> Requisite
        </button>
      </div>
      <TextField path={`${p}/notes`} label="Notiz für Spielleitung und Aufbau" plain multiline rows={3} hint="Teams sehen das nie." placeholder="z. B. Kiste hinter der Bank, Schloss auf 000 drehen" />
    </Collapsible>
  );
}
