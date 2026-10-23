/**
 * Paket B: Formular einer Fläche (Spielfeld, Sperrzone) neben der Karte: Kreis oder Vieleck,
 * beim Kreis Mitte und Radius, beim Vieleck die Zahl der Ecken und „Neu zeichnen“; die Liste der
 * Ecken mit Koordinaten zeigt die Expertenansicht. Umschalten der Form baut die Fläche um
 * (Kreis → Achteck, Vieleck → umschließender Kreis) – ein Schritt im Verlauf.
 */

import { isArea, isPoint, type Area } from "../../../../lib/editor/geo.ts";
import { getAt, setAt } from "../../../../lib/editor/paths.ts";
import { editor, useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { JsonPointer, Point } from "../../../../lib/editor/types.ts";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { areaSummary, convertArea } from "./actions.ts";
import { CoordinateInput } from "./CoordinateInput.tsx";

export function AreaEditor({ path, label, onRedraw, onShow }: { path: JsonPointer; label: string; onRedraw: (shape: "circle" | "polygon") => void; onShow?: (p: Point) => void }) {
  const store = editor.get().current;
  const area = useEditorSelect((s) => getAt<Area>(s.game, path));
  const expert = useEditorSelect((s) => s.expert);
  const issues = useIssuesAt(path);
  const shape = area && "polygon" in area ? "polygon" : "circle";
  const ok = isArea(area);

  const write = (next: Area, undo: string) => store?.update(undo, (g) => setAt(g, path, next));
  const switchShape = (to: "circle" | "polygon") => {
    if (!ok || to === shape) return;
    write(convertArea(area, to), `${label}: ${to === "circle" ? "Kreis" : "Vieleck"}`);
  };

  return (
    <div class="stack tight ed-area" data-feld={pathFeld(path)}>
      <fieldset class="ed-shape">
        <legend class="label">Form</legend>
        <span class="row">
          <label class="check">
            <input type="radio" name={`form-${path}`} checked={shape === "circle"} disabled={!ok} onChange={() => switchShape("circle")} /> Kreis
          </label>
          <label class="check">
            <input type="radio" name={`form-${path}`} checked={shape === "polygon"} disabled={!ok} onChange={() => switchShape("polygon")} /> Vieleck
          </label>
        </span>
      </fieldset>
      <p class="small muted">{areaSummary(area)}</p>
      {ok && "center" in area && (
        <>
          <CoordinateInput
            label="Mitte"
            feld={`${pathFeld(path)}.center`}
            value={area.center}
            onChange={(p) => write({ ...area, center: p }, `${label}: Mitte versetzt`)}
            onShow={onShow ? () => onShow(area.center) : undefined}
          />
          <NumberInput path={`${path}/radius`} label="Radius" unit="m" min={5} integer />
        </>
      )}
      {ok && "polygon" in area && expert && <Vertices area={area} label={label} onWrite={write} />}
      <IssueList issues={issues.filter((i) => i.at.path !== `${path}/radius`)} />
      <span class="row">
        <button type="button" class="btn small" onClick={() => onRedraw("polygon")}>
          Als Vieleck neu zeichnen
        </button>
        <button type="button" class="btn small" onClick={() => onRedraw("circle")}>
          Als Kreis neu setzen
        </button>
      </span>
      {ok && "polygon" in area && !expert && <p class="small muted">Ecken ziehen; ein Klick auf einen kleinen Mittelpunkt fügt eine Ecke ein, Entf auf einer Ecke löscht sie.</p>}
    </div>
  );
}

/** Ecken als Liste (Expertenansicht): Koordinaten ändern, Ecke entfernen. */
function Vertices({ area, label, onWrite }: { area: Extract<Area, { polygon: unknown }>; label: string; onWrite: (a: Area, undo: string) => void }) {
  return (
    <ol class="ed-vertices stack tight">
      {area.polygon.map((p, i) => (
        <li key={i} class="row nowrap">
          <span class="min0" style={{ flex: 1 }}>
            <CoordinateInput
              label={`Ecke ${i + 1}`}
              value={isPoint(p) ? p : null}
              onChange={(q) => onWrite({ polygon: area.polygon.map((x, j) => (j === i ? q : x)) }, `${label}: Ecke ${i + 1} versetzt`)}
            />
          </span>
          <button
            type="button"
            class="btn small ghost"
            disabled={area.polygon.length <= 3}
            aria-label={`Ecke ${i + 1} entfernen`}
            onClick={() => onWrite({ polygon: area.polygon.filter((_, j) => j !== i) }, `${label}: Ecke ${i + 1} entfernt`)}
          >
            ✕
          </button>
        </li>
      ))}
    </ol>
  );
}

/** data-feld ohne Objekt: Punkt-Pfad ab Wurzel; in einer Sperrzone relativ zur Zone. */
function pathFeld(path: JsonPointer): string {
  const parts = path.split("/").slice(1);
  const z = parts.indexOf("restrictedZones");
  return (z >= 0 ? parts.slice(z + 2) : parts).join(".");
}
