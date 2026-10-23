/**
 * Paket C: Ablauf an der Station als senkrechter Zeitstrahl – Ankunft, Vor dem Rätsel, das Rätsel mit
 * Tipps als fester Block, Nach dem Lösen. Blöcke lassen sich sortieren (≡, Alt+↑/↓) und über ⋯ in
 * eine andere Spur legen. Altdaten (nur story) erscheinen als „Erzähltext (einfach)“ mit Umwandeln.
 */

import { BEAT_KIND_INFO, BEAT_KINDS, convertStoryToScene, newBeat, SCENE_PARTS, TASK_TYPE_LABELS, type Beat, type BeatKind, type ScenePart } from "../../../../lib/editor/stations.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { Collapsible } from "../ui/Collapsible.tsx";
import { SortableList } from "../ui/SortableList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { BeatCard, beatTitle } from "./BeatCard.tsx";
import { HintsEditor } from "./HintsEditor.tsx";
import { Menu, stationPath, store, useListKeys, useSectionState } from "./common.tsx";
import { TaskEditor } from "./TaskEditor.tsx";

const LANES: Record<ScenePart, { title: string; hint?: string }> = {
  arrival: { title: "Ankunft – sobald das Team da ist" },
  beats: { title: "Vor dem Rätsel", hint: "In der App laufen Ankunft und Vor dem Rätsel direkt nacheinander." },
  afterSolve: { title: "Nach dem Lösen" },
};

export function Flow({ gameId, station, index }: { gameId: string; station: Station; index: number }) {
  const p = stationPath(index);
  const count = SCENE_PARTS.reduce((n, part) => n + (station.scene?.[part]?.length ?? 0), 0);
  const state = useSectionState([`${p}/scene`, `${p}/story`, `${p}/task`, `${p}/hints`], count > 0 || !!station.task);
  const summary = [count === 1 ? "1 Block" : `${count} Blöcke`, station.task ? `Rätsel: ${TASK_TYPE_LABELS[station.task.type] ?? "?"}` : "ohne Rätsel", station.hints?.length ? `${station.hints.length} Tipps` : ""].filter(Boolean).join(" · ");
  const legacy = !!station.story && !station.scene;
  return (
    <Collapsible title="Ablauf an der Station" summary={summary} state={state} open feld="scene">
      {legacy && <LegacyStory p={p} index={index} />}
      <Lane station={station} index={index} part="arrival" />
      <Lane station={station} index={index} part="beats" />
      <div class="st-puzzle stack">
        <TaskEditor station={station} index={index} />
        {station.task && <HintsEditor gameId={gameId} station={station} index={index} />}
      </div>
      <Lane station={station} index={index} part="afterSolve" />
    </Collapsible>
  );
}

function Lane({ station, index, part }: { station: Station; index: number; part: ScenePart }) {
  const beats = (station.scene?.[part] ?? []).filter((b): b is Beat => !!b && typeof b === "object");
  const [keys, moveKey] = useListKeys(beats.length);
  const lang = useEditorSelect((s) => s.lang);
  const names = useEditorSelect(
    (s) => Object.fromEntries((s.game.characters ?? []).filter((c) => c?.id).map((c) => [c.id, readText(c.name as never, s.lang) || c.id])),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const lane = LANES[part];

  const add = (kind: BeatKind) =>
    store().update(`Block „${BEAT_KIND_INFO[kind].label}“ hinzugefügt`, (g) => {
      // Altdaten zuerst umwandeln, sonst verdeckte die neue Szene den alten Erzähltext.
      if (g.stations[index]!.story && !g.stations[index]!.scene) g.stations[index] = convertStoryToScene(g.stations[index]!);
      const s = g.stations[index]!;
      s.scene ??= {};
      s.scene[part] = [...(s.scene[part] ?? []), newBeat(kind, lang)];
    });

  const move = (from: number, to: number) => {
    moveKey(from, to);
    store().update("Block verschoben", (g) => {
      const list = g.stations[index]!.scene![part]!;
      list.splice(to, 0, list.splice(from, 1)[0]!);
    });
  };

  const items = beats.map((beat, i) => ({ key: keys[i]!, beat, i }));
  return (
    <section class="st-lane stack tight" aria-label={lane.title} data-feld={`scene.${part}`}>
      <h4 class="st-lane-title">{lane.title}</h4>
      {lane.hint && beats.length > 0 && <p class="small muted">{lane.hint}</p>}
      {items.length > 0 && (
        <SortableList
          items={items}
          keyOf={(x) => x.key}
          nameOf={(x) => beatTitle(x.beat, names[x.beat.speaker ?? ""] ?? "", lang)}
          label={lane.title}
          onMove={move}
          render={(x) => <BeatCard stationIndex={index} part={part} index={x.i} count={beats.length} beat={x.beat} />}
          class="st-beats st-sortable"
        />
      )}
      <Menu label={`Block zu „${lane.title}“ hinzufügen`} text={<>+ Block</>}>
        {(close) =>
          BEAT_KINDS.map((kind) => (
            <li key={kind}>
              <button
                type="button"
                role="menuitem"
                class="st-menu-kind"
                onClick={() => {
                  close();
                  add(kind);
                }}
              >
                <span>
                  <strong>{BEAT_KIND_INFO[kind].label}</strong>
                  <span class="small muted"> – {BEAT_KIND_INFO[kind].hint}</span>
                </span>
              </button>
            </li>
          ))
        }
      </Menu>
    </section>
  );
}

/** Altes Erzählstück: bearbeitbar wie bisher, „In Szene umwandeln“ macht Blöcke daraus (wie die App). */
function LegacyStory({ p, index }: { p: string; index: number }) {
  const convert = () =>
    store().update("Erzähltext in Szene umgewandelt", (g) => {
      g.stations[index] = convertStoryToScene(g.stations[index]!);
    });
  return (
    <div class="st-beat stack tight" data-feld="story" data-block="story">
      <h4 class="st-lane-title">Erzähltext (einfach)</h4>
      <TextField path={`${p}/story/text`} label="Text" multiline rows={3} />
      <p class="small muted">Die App macht daraus einen Block bei der Ankunft. Als Szene kannst du Sprecher, Bilder und weitere Blöcke ergänzen.</p>
      <button type="button" class="btn small st-self-start" onClick={convert}>
        In Szene umwandeln
      </button>
    </div>
  );
}
