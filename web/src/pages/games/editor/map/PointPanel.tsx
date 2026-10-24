/**
 * Paket B: Formular eines Punkts – Sammelpunkt (Name für „Geht zum Sammelpunkt: …“, nur verschieben),
 * Startpunkt („wie Sammelpunkt“ entfernt das Feld), Rettungs- und Versorgungspunkte (Name,
 * Beschreibung, Ort, löschen). Der Ort geht über Karte oder Koordinaten.
 */

import { isPoint } from "../../../../lib/editor/geo.ts";
import { editor, useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Point } from "../../../../lib/editor/types.ts";
import { notify } from "../../../../lib/session.ts";
import { TextField } from "../ui/TextField.tsx";
import { POINT_LABELS, setPoint, type PointKind } from "./actions.ts";
import { CoordinateInput } from "./CoordinateInput.tsx";

/** Pfad eines Punkts im Spiel. */
export function pointPath(kind: PointKind, index?: number): string {
  switch (kind) {
    case "assembly":
      return "/field/assemblyPoint";
    case "start":
      return "/field/start";
    case "rescue":
      return `/field/rescuePoints/${index ?? 0}`;
    case "supply":
      return `/field/supplyPoints/${index ?? 0}`;
  }
}

/** Punkt aus der Liste entfernen (Rettungs- und Versorgungspunkte; Verweise gibt es keine). */
export function removePoint(kind: "rescue" | "supply", index: number, name: string): void {
  const store = editor.get().current;
  if (!store) return;
  const label = `${POINT_LABELS[kind]} „${name}“ gelöscht`;
  store.update(label, (g) => {
    const key = kind === "rescue" ? "rescuePoints" : "supplyPoints";
    const list = g.field?.[key];
    if (!Array.isArray(list)) return;
    list.splice(index, 1);
    if (!list.length) delete g.field[key];
  });
  notify(`${label}. Strg+Z holt ihn zurück.`, "ok");
}

export function PointPanel({ kind, index, onShow, onClose }: { kind: PointKind; index?: number; onShow: (p: Point) => void; onClose: () => void }) {
  const store = editor.get().current;
  const path = pointPath(kind, index);
  const raw = useEditorSelect((s) => {
    const f = s.game.field;
    if (kind === "assembly") return f?.assemblyPoint;
    if (kind === "start") return f?.start;
    return (kind === "rescue" ? f?.rescuePoints : f?.supplyPoints)?.[index ?? 0];
  });
  const lang = useEditorSelect((s) => s.lang);
  const assembly = useEditorSelect((s) => s.game.field?.assemblyPoint?.location);
  const locIssues = useIssuesAt(kind === "start" ? path : `${path}/location`);
  const location = kind === "start" ? (raw as Point | undefined) : (raw as { location?: Point } | undefined)?.location;
  const name = kind === "start" ? "" : readText((raw as { name?: never } | undefined)?.name, lang);

  if (kind !== "start" && kind !== "assembly" && !raw) return <p class="muted">Diesen Punkt gibt es nicht mehr.</p>;

  const move = (p: Point) => {
    if (kind === "assembly" || kind === "start") store?.update(`${POINT_LABELS[kind]} versetzt`, (g) => setPoint(g, kind, p));
    else store?.setField(`${path}/location`, p, `${POINT_LABELS[kind]} „${name}“ versetzt`);
  };

  return (
    <div class="stack" data-feld={path.slice(1).replace(/\//g, ".")}>
      <header class="row between">
        <h3>{kind === "rescue" || kind === "supply" ? `${POINT_LABELS[kind]}${name ? `: ${name}` : ""}` : POINT_LABELS[kind]}</h3>
        <button type="button" class="btn small ghost" onClick={onClose}>
          Schließen
        </button>
      </header>
      {kind === "start" ? (
        <>
          <label class="check">
            <input
              type="checkbox"
              checked={!isPoint(location)}
              disabled={!isPoint(assembly) && !isPoint(location)}
              onChange={(e) => {
                if (e.currentTarget.checked) store?.setField("/field/start", undefined, "Startpunkt wie Sammelpunkt");
                else if (isPoint(assembly)) store?.setField("/field/start", { ...assembly }, "Eigener Startpunkt");
              }}
            />
            <span>wie Sammelpunkt</span>
          </label>
          <p class="small muted">Die App zeigt den Startpunkt als Kartenmitte, solange sie die eigene Position noch nicht kennt.</p>
          {isPoint(location) && <CoordinateInput value={location} onChange={move} feld="field.start" issues={locIssues} onShow={() => onShow(location)} />}
        </>
      ) : (
        <>
          <TextField
            path={`${path}/name`}
            label="Name"
            hint={
              kind === "assembly"
                ? "Die App sagt: „Geht zum Sammelpunkt: …“ – z. B. „Grillhütte am Parkplatz“."
                : kind === "rescue"
                  ? "Steht auf der Notfallseite der App, z. B. „Zufahrt Parkplatz Waldweg“."
                  : undefined
            }
          />
          <TextField path={`${path}/description`} label="Beschreibung" multiline rows={2} />
          <CoordinateInput value={location} onChange={move} feld={`${path.slice(1).replace(/\//g, ".")}.location`} required issues={locIssues} onShow={location ? () => onShow(location) : undefined} />
          {kind === "supply" && <p class="small muted">Versorgungspunkte zeigt die App derzeit nicht an; sie helfen beim Aufbau.</p>}
          {kind === "assembly" && <p class="small muted">Den Sammelpunkt gibt es genau einmal. Verschieben geht über die Karte oder die Koordinaten.</p>}
          {(kind === "rescue" || kind === "supply") && (
            <span class="row">
              <button
                type="button"
                class="btn small"
                onClick={() => {
                  removePoint(kind, index ?? 0, name || POINT_LABELS[kind]);
                  onClose();
                }}
              >
                {POINT_LABELS[kind]} löschen
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );
}
