/**
 * Paket C: Weg zur Station – was das Peilgerät beim Annähern sagt (vier Stufen, alle optional).
 * Der Platzhalter zeigt den Standardspruch der App, der Gerätename kommt aus der Spielwelt.
 */

import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { Collapsible } from "../ui/Collapsible.tsx";
import { TextField } from "../ui/TextField.tsx";
import { stationPath, useSectionState } from "./common.tsx";
import { worldOf } from "./world.ts";

/** Stufen des Peilers mit Abstand und Standardspruch der App (peiler_view.dart). */
export const APPROACH_STAGES = [
  { key: "far", label: "Weit weg (über 150 m)", fallback: "Kaum ein Signal. Folgt dem Weg und achtet auf die Stufe." },
  { key: "mid", label: "Unterwegs (bis 150 m)", fallback: "Das Signal wird stärker. Ihr seid auf dem richtigen Weg." },
  { key: "near", label: "Nah (bis 60 m)", fallback: "Ganz nah. Schaut euch genau um." },
  { key: "here", label: "Am Ort (im Auslöse-Radius)", fallback: "Hier muss es sein. Weckt die Station." },
] as const;

export function Approach({ station, index }: { station: Station; index: number }) {
  const p = stationPath(index);
  const device = useEditorSelect((s) => worldOf(s.game).device);
  const filled = APPROACH_STAGES.filter((st) => station.approach?.[st.key] !== undefined).length;
  const state = useSectionState([`${p}/approach`], filled > 0);
  const ambience = useEditorSelect((s) => {
    const id = s.game.stations?.[index]?.sound?.ambience?.audio;
    const m = id ? (s.game.media ?? []).find((x) => x?.id === id) : undefined;
    return id ? readText(m?.alt as never, s.lang) || id : "";
  });
  const summary = [`Peiler: ${filled} von 4 Texten`, ambience ? `Atmosphäre „${ambience}“` : ""].filter(Boolean).join(" · ");
  return (
    <Collapsible title="Weg zur Station" summary={summary} state={state} feld="approach">
      <p class="small muted">Was das Gerät „{device}“ beim Annähern sagt. Alles optional – leer sagt die App ihren Standardspruch.</p>
      <div data-block="approach" class="stack tight">
        {APPROACH_STAGES.map((st) => (
          <TextField key={st.key} path={`${p}/approach/${st.key}`} label={st.label} placeholder={st.fallback} />
        ))}
      </div>
    </Collapsible>
  );
}
