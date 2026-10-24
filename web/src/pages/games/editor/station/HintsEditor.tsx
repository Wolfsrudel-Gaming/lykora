/**
 * Paket C: Tipps zum Rätsel in Stufen (Schubs, deutlicher Tipp, fast die Lösung) mit Kosten:
 * „Standard“ zeigt den Wert aus den Einstellungen, eigene Kosten als Strafe. Sind Tipps in den
 * Einstellungen aus, ist der Block ausgegraut.
 */

import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { penaltyLabel } from "../../../../lib/game.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { PenaltyInput } from "../ui/PenaltyInput.tsx";
import { SortableList } from "../ui/SortableList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { stationPath, store, useListKeys } from "./common.tsx";

const PLACEHOLDERS = ["Schubs: ein sanfter Hinweis", "Deutlicher Tipp", "Fast die Lösung"];

type Hint = NonNullable<Station["hints"]>[number];

export function HintsEditor({ gameId, station, index }: { gameId: string; station: Station; index: number }) {
  const p = stationPath(index);
  const hints = (station.hints ?? []) as Hint[];
  const enabled = useEditorSelect((s) => s.game.settings?.hints?.enabled !== false);
  const defaults = useEditorSelect((s) => s.game.settings?.hints?.defaultCost ?? [], (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const lang = useEditorSelect((s) => s.lang);
  const [keys, moveKey] = useListKeys(hints);
  const listIssues = useIssuesAt(`${p}/hints`).filter((i) => i.at.path === `${p}/hints`);

  const mutate = (undo: string, fn: (list: Hint[]) => void) =>
    store().update(undo, (g) => {
      const s = g.stations[index]!;
      const list = [...(s.hints ?? [])];
      fn(list);
      if (list.length) s.hints = list;
      else delete s.hints;
    });

  const items = hints.map((h, k) => ({ key: keys[k]!, hint: h, k }));
  return (
    <div class={`st-hints stack tight${enabled ? "" : " st-off"}`} data-feld="hints" data-block="hints">
      <h4 class="st-lane-title">Tipps</h4>
      {!enabled && (
        <p class="small">
          Tipps sind in den Einstellungen ausgeschaltet.{" "}
          <Link to={href("editorSection", { gameId, section: "einstellungen" }, { feld: "settings.hints.enabled" })}>In den Einstellungen einschalten</Link>
        </p>
      )}
      {items.length > 0 && (
        <SortableList
          items={items}
          keyOf={(i) => i.key}
          nameOf={(i) => `Tipp ${i.k + 1}`}
          label="Tipps"
          class="st-sortable"
          onMove={(from, to) => {
            moveKey(from, to);
            mutate(`Tipp ${from + 1} verschoben`, (l) => l.splice(to, 0, l.splice(from, 1)[0]!));
          }}
          render={(i) => (
            <div class="st-hint" data-feld={`hints.${i.k}`} data-block="hints">
              <TextField path={`${p}/hints/${i.k}/text`} label={`Tipp ${i.k + 1}`} required placeholder={PLACEHOLDERS[i.k] ?? "Weiterer Tipp"} />
              <PenaltyInput path={`${p}/hints/${i.k}/cost`} label="Kosten" optional hint={defaults[i.k] ? `Standard: ${penaltyLabel(defaults[i.k])}` : "Standard: kostenlos"} />
              <button type="button" class="btn small ghost st-self-end" aria-label={`Tipp ${i.k + 1} entfernen`} onClick={() => mutate(`Tipp ${i.k + 1} entfernt`, (l) => l.splice(i.k, 1))}>
                <Icon name="trash" />
              </button>
            </div>
          )}
        />
      )}
      <IssueList issues={listIssues} />
      <button type="button" class="btn small st-self-start" onClick={() => mutate("Tipp hinzugefügt", (l) => l.push({ text: { [lang]: "" } }))}>
        <Icon name="plus" /> Tipp
      </button>
    </div>
  );
}
