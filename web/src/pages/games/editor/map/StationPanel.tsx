/**
 * Paket B: Station in der Seitenleiste der Karte – Name, Ort, GPS-Radius und die Meldungen der Karte;
 * „Bearbeiten“ führt in den Stationseditor. Dazu das Formular für eine neue Station: erst der Name,
 * dann entsteht sie (die ID kommt aus dem Namen und ändert sich danach nie).
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { formatPoint, gpsTrigger } from "../../../../lib/editor/geo.ts";
import { STATION_KINDS, type StationKind } from "../../../../lib/editor/stations.ts";
import { editor, shallowArray, useEditorSelect, useIssuesAt, useStation } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Point } from "../../../../lib/editor/types.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { TextField } from "../ui/TextField.tsx";
import { moveStationTo } from "./actions.ts";
import { CoordinateInput } from "./CoordinateInput.tsx";
import { duplicateInStore } from "./StationList.tsx";

/** Codes der Kartenprüfungen; ihre Meldungen stehen sofort da, nicht erst nach dem Berühren (UX §6.4). */
export const MAP_CODES = new Set([
  "station_in_zone",
  "assembly_in_zone",
  "station_outside_field",
  "station_near_zone",
  "gps_overlap",
  "gps_radius_small",
  "zone_unfinished",
  "station_at_template",
  "no_location",
  "gps_without_location",
]);

export function StationPanel({ gameId, id, onShow, onClose, onSelect }: { gameId: string; id: string; onShow: (p: Point) => void; onClose: () => void; onSelect: (id: string) => void }) {
  const store = editor.get().current;
  const found = useStation(id);
  const lang = useEditorSelect((s) => s.lang);
  const mapIssues = useEditorSelect((s) => {
    const hidden = new Set(s.meta.dismissed ?? []);
    return s.issues.filter((i) => i.at.section === "stationen" && i.at.objectId === id && MAP_CODES.has(i.code) && !hidden.has(i.id));
  }, shallowArray);
  const locIssues = useIssuesAt(found ? `/stations/${found.index}/location` : "/-");
  if (!found) return <p class="muted">Diese Station gibt es nicht mehr.</p>;
  const { station: s, index } = found;
  const p = `/stations/${index}`;
  const name = readText(s.name as never, lang) || s.id;
  const gpsIndex = (s.triggers ?? []).findIndex((t) => t?.type === "gps");
  const gps = gpsTrigger(s);
  const shownIds = new Set(locIssues.map((i) => i.id));

  return (
    <div class="stack" data-objekt={id}>
      <header class="row between">
        <h3>
          <span class="num">{s.final ? "★" : index + 1}</span> {name}
        </h3>
        <button type="button" class="btn small ghost" onClick={onClose}>
          Schließen
        </button>
      </header>
      <TextField path={`${p}/name`} label="Name" required />
      <CoordinateInput
        value={s.location}
        onChange={(q) => store?.update(`Station „${name}“ verschoben`, (g) => moveStationTo(g, id, q))}
        feld="location"
        issues={locIssues}
        onBlur={() => store?.touch(`${p}/location`)}
        onShow={s.location ? () => onShow(s.location!) : undefined}
      />
      {gps ? (
        <NumberInput
          path={`${p}/triggers/${gpsIndex}/radius`}
          label="GPS-Radius"
          unit="m"
          placeholder="20"
          min={5}
          max={100}
          integer
          hint="Am Kreis auf der Karte lässt er sich auch ziehen (5-m-Schritte)."
        />
      ) : (
        <p class="small muted">Ohne GPS – die Station wird per QR, NFC oder Notfall-Code geweckt.</p>
      )}
      <IssueList issues={mapIssues.filter((i) => !shownIds.has(i.id))} />
      <span class="row">
        <Link to={href("editorStation", { gameId, stationId: id })} class="btn small primary">
          <Icon name="edit" /> Bearbeiten
        </Link>
        <button
          type="button"
          class="btn small"
          onClick={() => {
            const copy = duplicateInStore(id, name);
            if (copy) onSelect(copy);
          }}
        >
          Duplizieren
        </button>
        <button type="button" class="btn small" onClick={() => void deleteWithReferences("station", id, name).then((ok) => ok && onClose())}>
          Löschen
        </button>
      </span>
    </div>
  );
}

/** Neue Station: Name und Baustein, Enter legt an, Esc bricht ab. */
export function NewStationPanel({
  location,
  kind,
  onKind,
  onCreate,
  onCancel,
}: {
  location: Point;
  kind: StationKind;
  onKind: (k: StationKind) => void;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const count = useEditorSelect((s) => (Array.isArray(s.game.stations) ? s.game.stations.length : 0));
  const [name, setName] = useState(`Station ${count + 1}`);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [location.lat, location.lon]);
  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(name.trim() || `Station ${count + 1}`);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <h3>Neue Station</h3>
      <div class="field">
        <label for="neue-station-name">Name</label>
        <input id="neue-station-name" ref={input} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <small>Aus dem Namen entsteht die Kennung; umbenennen geht später jederzeit.</small>
      </div>
      <div class="field">
        <label for="neue-station-art">Baustein</label>
        <select id="neue-station-art" value={kind} onChange={(e) => onKind(e.currentTarget.value as StationKind)}>
          {(Object.keys(STATION_KINDS) as StationKind[]).map((k) => (
            <option key={k} value={k}>
              {STATION_KINDS[k].label} – {STATION_KINDS[k].hint}
            </option>
          ))}
        </select>
      </div>
      <p class="small muted">Ort {formatPoint(location)} · mit GPS 20 m, QR-Code und Notfall-Code.</p>
      <div class="form-actions">
        <button type="button" class="btn" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" class="btn primary">
          Anlegen
        </button>
      </div>
    </form>
  );
}
