/**
 * Paket B: Formular einer Sperrzone (UX §6.2): Name (Pflicht), Art mit Symbol (schlägt den Namen
 * vor, solange er noch der vorgeschlagene ist), Warnung ab (0–50 m), Fläche; Strafe und „Spielleitung
 * alarmieren“ aufgeklappt mit dem Hinweis, dass die App sie derzeit nicht auswertet. Löschen räumt
 * Verweise mit auf.
 */

import { useId } from "preact/hooks";
import { getAt } from "../../../../lib/editor/paths.ts";
import { editor, useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Point } from "../../../../lib/editor/types.ts";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { describedBy, FieldFrame, hasError, useFeld } from "../ui/FieldFrame.tsx";
import { PenaltyInput } from "../ui/PenaltyInput.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { ZONE_KINDS, type Zone, type ZoneKind } from "./actions.ts";
import { AreaEditor } from "./AreaEditor.tsx";

/** Ist der Name noch ein Vorschlag (leer, „Sperrzone 2“, „Straße“ …)? Dann darf die Art ihn ersetzen. */
export function suggestedName(name: string): boolean {
  const base = name.replace(/\s+\d+$/, "").trim();
  return !base || base === "Sperrzone" || Object.values(ZONE_KINDS).some((k) => k.label === base);
}

export function ZonePanel({ id, onRedraw, onShow, onClose }: { id: string; onRedraw: (shape: "circle" | "polygon") => void; onShow: (p: Point) => void; onClose: () => void }) {
  const store = editor.get().current;
  const index = useEditorSelect((s) => s.game.field?.restrictedZones?.findIndex((z) => z?.id === id) ?? -1);
  const zone = useEditorSelect((s) => (index >= 0 ? getAt<Zone>(s.game, `/field/restrictedZones/${index}`) : undefined));
  const lang = useEditorSelect((s) => s.lang);
  if (index < 0 || !zone) return <p class="muted">Diese Sperrzone gibt es nicht mehr.</p>;
  const path = `/field/restrictedZones/${index}`;
  const name = readText(zone.name as never, lang);

  const setKind = (kind: ZoneKind | "") => {
    store?.update(`Sperrzone „${name || id}“: Art ${kind ? ZONE_KINDS[kind].label : "entfernt"}`, (g) => {
      const z = g.field?.restrictedZones?.[index];
      if (!z) return;
      if (kind) z.kind = kind;
      else delete z.kind;
      // Der Name folgt der Art, solange niemand einen eigenen vergeben hat.
      if (kind && suggestedName(readText(z.name as never, lang))) z.name = { ...(typeof z.name === "object" ? z.name : {}), [lang]: ZONE_KINDS[kind].label };
    });
    store?.touch(`${path}/kind`);
  };

  return (
    <div class="stack" data-objekt={id}>
      <header class="row between">
        <h3>
          <span aria-hidden="true">{ZONE_KINDS[zone.kind ?? "other"].symbol} </span>Sperrzone
        </h3>
        <button type="button" class="btn small ghost" onClick={onClose}>
          Schließen
        </button>
      </header>
      <TextField path={`${path}/name`} label="Name" required hint={`Die App warnt: „Achtung: ${name || "Sperrzone"} in 12 m. Umkehren.“`} />
      <KindSelect path={`${path}/kind`} value={zone.kind ?? ""} onChange={setKind} />
      <WarnSlider path={`${path}/warnDistance`} />
      <section class="stack tight" aria-label="Fläche der Sperrzone">
        <h4 class="label">Fläche</h4>
        <AreaEditor path={`${path}/area`} label={`Sperrzone „${name || id}“`} onRedraw={onRedraw} onShow={onShow} />
      </section>
      <details class="ed-more">
        <summary>Mehr (derzeit ohne Wirkung in der App)</summary>
        <div class="stack tight">
          <PenaltyInput path={`${path}/penalty`} label="Strafe beim Betreten" optional hint="Die App wertet sie derzeit nicht aus." />
          <Toggle path={`${path}/alertGameMaster`} label="Spielleitung alarmieren" defaultValue={true} hint="Der Leitstand warnt ohnehin bei jeder Sperrzone." />
        </div>
      </details>
      <span class="row">
        <button type="button" class="btn small" onClick={() => void deleteWithReferences("zone", id, name).then((ok) => ok && onClose())}>
          Sperrzone löschen
        </button>
      </span>
    </div>
  );
}

function KindSelect({ path, value, onChange }: { path: string; value: ZoneKind | ""; onChange: (k: ZoneKind | "") => void }) {
  const id = useId();
  const feld = useFeld(path);
  const issues = useIssuesAt(path);
  return (
    <FieldFrame id={id} label="Art" issues={issues} feld={feld} hint="Schlägt den Namen vor.">
      <select
        id={id}
        value={value}
        aria-invalid={hasError(issues) || undefined}
        aria-describedby={describedBy(id, true, issues.length > 0)}
        onChange={(e) => onChange(e.currentTarget.value as ZoneKind | "")}
      >
        <option value="">– nicht angegeben –</option>
        {(Object.keys(ZONE_KINDS) as ZoneKind[]).map((k) => (
          <option key={k} value={k}>
            {ZONE_KINDS[k].symbol} {ZONE_KINDS[k].label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/** Warnabstand als Schieber 0–50 m; der Standard 15 m wird nicht geschrieben. */
function WarnSlider({ path }: { path: string }) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const value = useEditorSelect((s) => getAt<number>(s.game, path));
  const issues = useIssuesAt(path);
  const shown = typeof value === "number" ? value : 15;
  return (
    <FieldFrame id={id} label={`Warnung ab ${shown} m`} issues={issues} feld={feld} hint="Teams bekommen in diesem Abstand eine Warnung. Standard 15 m.">
      <input
        id={id}
        type="range"
        min={0}
        max={50}
        step={1}
        value={shown}
        aria-valuetext={`${shown} Meter`}
        aria-describedby={describedBy(id, true, issues.length > 0)}
        onInput={(e) => {
          const n = Number(e.currentTarget.value);
          store?.setField(path, n === 15 ? undefined : n, `Warnabstand ${n} m`, { coalesce: true });
        }}
        onBlur={() => store?.touch(path)}
      />
    </FieldFrame>
  );
}
