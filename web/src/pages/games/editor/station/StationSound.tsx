/**
 * Paket C: Klang der Station wie die Stationskarte in „Klänge zuordnen“ – Atmosphäre mit Lautstärke
 * und „ab Peilstufe“, Geräusche beim Annähern und beim Lösen. Die Auswahl hat Vorhören; Klänge aus
 * der Bibliothek kommen beim Wählen als Medium in den Entwurf.
 */

import { useId } from "preact/hooks";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { formatPercent } from "../../../../lib/format.ts";
import { DEFAULT_VOLUME, STAGE_LABELS, STAGES, type Stage } from "../../../../lib/sound.ts";
import { Collapsible } from "../ui/Collapsible.tsx";
import { MediaSlot, stationPath, store, useSectionState } from "./common.tsx";

export function StationSound({ station, index }: { station: Station; index: number }) {
  const p = stationPath(index);
  const id = useId();
  const snd = station.sound;
  const amb = snd?.ambience;
  const names = useEditorSelect(
    (s) => Object.fromEntries((s.game.media ?? []).filter((m) => m?.id).map((m) => [m.id, readText(m.alt as never, s.lang) || m.id])),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const state = useSectionState([`${p}/sound`], !!snd);
  const summary = [
    amb ? `Atmosphäre „${names[amb.audio] ?? amb.audio}“ ab ${STAGE_LABELS[amb.from ?? "near"].toLowerCase()}` : "",
    snd?.approach && Object.keys(snd.approach).length ? "Annäherung" : "",
    snd?.solved ? "Lösen" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const volume = amb?.volume ?? DEFAULT_VOLUME;

  const clearAmbience = () =>
    store().update("Atmosphäre entfernt", (g) => {
      const s = g.stations[index]!;
      if (!s.sound) return;
      delete s.sound.ambience;
      if (!Object.keys(s.sound).length) delete s.sound;
    });

  return (
    <Collapsible title="Klang" summary={summary || "kein Klang"} state={state} feld="sound">
      <div class="sound-grid">
        <MediaSlot
          path={`${p}/sound/ambience/audio`}
          label="Atmosphäre"
          accept="audio"
          onClear={clearAmbience}
          hint="Läuft beim Peilen ab der gewählten Stufe und während der Szene."
        />
        {amb && (
          <>
            <div class="field" data-feld="sound.ambience.volume">
              <label for={`${id}-lautstaerke`}>Lautstärke</label>
              <span class="volume">
                <input
                  id={`${id}-lautstaerke`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-valuetext={formatPercent(volume)}
                  onInput={(e) => store().setField(`${p}/sound/ambience/volume`, Math.round(Number(e.currentTarget.value) * 100) / 100, "Lautstärke der Atmosphäre geändert", { coalesce: true })}
                />
                <span class="num" aria-hidden="true">
                  {formatPercent(volume)}
                </span>
              </span>
            </div>
            <label class="field" data-feld="sound.ambience.from">
              <span class="label">Ab Peilstufe</span>
              <select value={amb.from ?? "near"} onChange={(e) => store().setField(`${p}/sound/ambience/from`, e.currentTarget.value as Stage, "Peilstufe der Atmosphäre geändert")}>
                {STAGES.map((st) => (
                  <option key={st} value={st}>
                    {STAGE_LABELS[st]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div class="sound-grid">
        {STAGES.map((st) => (
          <MediaSlot key={st} path={`${p}/sound/approach/${st}`} label={`Annäherung: ${STAGE_LABELS[st]}`} accept="audio" />
        ))}
        <MediaSlot path={`${p}/sound/solved`} label="Beim Lösen" accept="audio" />
      </div>
    </Collapsible>
  );
}
