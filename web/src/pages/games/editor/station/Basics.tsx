/**
 * Paket C: Grunddaten einer Station – Name, Ort (Mini-Karte oder Koordinaten), Finale (es gibt nur
 * eines: Rückfrage beim zweiten) und „Abseits der Wege“. Die Kennung steht nur in der Expertenansicht.
 */

import { useId } from "preact/hooks";
import { finalStation } from "../../../../lib/editor/fragments.ts";
import { setFinal } from "../../../../lib/editor/stations.ts";
import { useEditorSelect, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { formatCoord } from "../../../../lib/format.ts";
import { href } from "../../../../lib/router.ts";
import { confirm, Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { Collapsible } from "../ui/Collapsible.tsx";
import { describedBy, hasError } from "../ui/FieldFrame.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { LocationField, stationPath, store, useSectionState } from "./common.tsx";

export function Basics({ gameId, station, index }: { gameId: string; station: Station; index: number }) {
  const p = stationPath(index);
  const expert = useEditorSelect((s) => s.expert);
  const gps = station.triggers?.find((t) => t?.type === "gps");
  const gpsIndex = station.triggers?.findIndex((t) => t?.type === "gps") ?? -1;
  const state = useSectionState([`${p}/name`, `${p}/location`, `${p}/final`, `${p}/offPath`], true);
  const loc = station.location;
  const summary = [loc ? formatCoord(loc.lat, loc.lon) : "ohne Ort", station.final ? "Finale" : "", station.offPath ? "abseits der Wege" : ""].filter(Boolean).join(" · ");
  return (
    <Collapsible title="Grunddaten" summary={summary} state={state} open feld="grunddaten">
      <TextField path={`${p}/name`} label="Name" required hint="Teams sehen ihn in der App." />
      <LocationField
        path={`${p}/location`}
        label="Ort"
        hint="Koordinaten lassen sich auch einfügen, z. B. aus einer Karten-App."
        radius={gps?.type === "gps" ? (gps.radius ?? 20) : undefined}
        onRadius={gpsIndex >= 0 ? (r) => store().setField(`${p}/triggers/${gpsIndex}/radius`, Math.round(r), "GPS-Radius geändert", { coalesce: true }) : undefined}
        extra={
          <Link to={href("editorSection", { gameId, section: "karte" }, { objekt: station.id })} class="btn small ghost">
            <Icon name="map" /> Auf großer Karte zeigen
          </Link>
        }
      />
      <FinalToggle station={station} p={p} />
      <Toggle path={`${p}/offPath`} label="Abseits der Wege" hint="Braucht ein Knicklicht oder einen Reflektor als Markierung. Kommt automatisch in die Materialliste." />
      {expert && (
        <p class="small muted">
          Kennung <code>{station.id}</code> – umbenennen in der Expertenansicht unten.
        </p>
      )}
    </Collapsible>
  );
}

/** Schalter „Finale-Station“: ein zweites Finale ersetzt nach Rückfrage das erste (ein Schritt). */
function FinalToggle({ station, p }: { station: Station; p: string }) {
  const id = useId();
  const on = useFieldValue<boolean>(`${p}/final`) === true;
  const other = useEditorSelect((s) => {
    const f = finalStation(s.game);
    return f && f.id !== station.id ? readText(f.name as never, s.lang) || f.id : null;
  });
  const issues = useIssuesAt(`${p}/final`);
  const name = useEditorSelect((s) => readText(station.name as never, s.lang));
  const change = async (next: boolean) => {
    if (next && other) {
      const r = await confirm({ title: "Finale wechseln?", body: <p>„{other}“ ist schon das Finale. Stattdessen diese Station?</p>, confirm: "Diese Station ist das Finale" });
      if (!r.ok) return;
    }
    store().update(next ? `„${name || "Station"}“ ist das Finale` : "Finale aufgehoben", (g) => setFinal(g, station.id, next));
    store().touch(`${p}/final`);
  };
  return (
    <div class={`field ed-field ed-toggle${hasError(issues) ? " invalid" : ""}`} data-feld="final">
      <label class="check" for={id}>
        <input id={id} type="checkbox" checked={on} aria-describedby={describedBy(id, true, issues.length > 0)} onChange={(e) => void change(e.currentTarget.checked)} />
        <span>Finale-Station</span>
      </label>
      <small id={`${id}-hinweis`}>Öffnet sich erst, wenn ein Team alle Codeteile hat. Es gibt nur ein Finale.</small>
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </div>
  );
}

