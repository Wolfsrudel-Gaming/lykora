/**
 * Paket B: Werkzeugleiste der Karte (UX §6.2): Auswählen, + Station (mit Bausteinen), Spielfeld,
 * Sperrzone, Punkt, Mein Standort. Darunter, solange ein Werkzeug aktiv ist, eine Zeile mit dem
 * nächsten Handgriff und den Knöpfen dazu – Zeichnen geht so auch ohne Maus (Ecke in der Kartenmitte).
 */

import { STATION_KINDS, type StationKind } from "../../../../lib/editor/stations.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { POINT_LABELS, type PointKind } from "./actions.ts";
import type { Tool } from "./EditorMap.tsx";
import { Menu } from "./Menu.tsx";

const POINT_TOOLS: { point: PointKind; label: string; hint: string }[] = [
  { point: "assembly", label: "Sammelpunkt versetzen", hint: "Genau einer; hier treffen sich alle" },
  { point: "start", label: "Startpunkt setzen", hint: "Sonst gilt der Sammelpunkt" },
  { point: "rescue", label: "Rettungspunkt / Zufahrt", hint: "Hier kann der Rettungsdienst hin" },
  { point: "supply", label: "Versorgungspunkt", hint: "Derzeit ohne Wirkung in der App" },
];

/** Satz für die Zeile unter der Werkzeugleiste. */
export function toolHint(tool: Tool, drawing: number, stationKind: StationKind): string {
  switch (tool.kind) {
    case "select":
      return "";
    case "station":
      return `Klick in die Karte setzt eine neue ${STATION_KINDS[stationKind].label}.`;
    case "point":
      return `Klick in die Karte setzt den ${POINT_LABELS[tool.point]}.`;
    case "area": {
      const what = tool.target === "boundary" ? "das Spielfeld" : "die Sperrzone";
      if (tool.shape === "circle") return `Klick in die Karte setzt die Mitte; danach zieht der Griff den Radius. Damit setzt du ${what} als Kreis.`;
      if (!drawing) return `Klick in die Karte setzt die erste Ecke für ${what}.`;
      return `${drawing} ${drawing === 1 ? "Ecke" : "Ecken"} gesetzt. Weiter klicken; Enter oder Doppelklick beendet${drawing < 3 ? " (ab 3 Ecken)" : ""}, Rücktaste nimmt die letzte zurück.`;
    }
  }
}

export function MapToolbar({
  tool,
  stationKind,
  drawing,
  onTool,
  onStationKind,
  onLocate,
  onFinish,
  onUndoVertex,
  onCenter,
  onCancel,
}: {
  tool: Tool;
  stationKind: StationKind;
  /** gesetzte Ecken beim Zeichnen */
  drawing: number;
  onTool: (t: Tool) => void;
  onStationKind: (k: StationKind) => void;
  onLocate: () => void;
  onFinish: () => void;
  onUndoVertex: () => void;
  /** wie ein Klick in die Mitte des Kartenausschnitts (Weg ohne Maus) */
  onCenter: () => void;
  onCancel: () => void;
}) {
  const is = (kind: Tool["kind"], target?: string) =>
    tool.kind === kind && (target === undefined || (tool.kind === "area" && tool.target === target) || (tool.kind === "point" && tool.point === target));
  const hint = toolHint(tool, drawing, stationKind);
  return (
    <div class="stack tight">
      <div class="ed-map-tools row" role="toolbar" aria-label="Werkzeuge der Karte">
        <button type="button" class="btn small" aria-pressed={is("select")} onClick={() => onTool({ kind: "select" })}>
          <span aria-hidden="true">↖</span> Auswählen
        </button>
        <span class="ed-split row nowrap">
          <button type="button" class="btn small" aria-pressed={is("station")} onClick={() => onTool(is("station") ? { kind: "select" } : { kind: "station" })}>
            + Station
          </button>
          <Menu
            label="Baustein für neue Stationen"
            items={(Object.keys(STATION_KINDS) as StationKind[]).map((k) => ({
              label: STATION_KINDS[k].label,
              hint: STATION_KINDS[k].hint,
              checked: k === stationKind,
              onSelect: () => {
                onStationKind(k);
                onTool({ kind: "station" });
              },
            }))}
          >
            <span aria-hidden="true">▾</span>
          </Menu>
        </span>
        <Menu
          label="Spielfeld"
          class={is("area", "boundary") ? "active" : undefined}
          items={[
            { label: "Kreis", hint: "Mitte setzen, Radius ziehen", onSelect: () => onTool({ kind: "area", target: "boundary", shape: "circle" }) },
            { label: "Vieleck zeichnen", hint: "Ecken klicken, Enter beendet", onSelect: () => onTool({ kind: "area", target: "boundary", shape: "polygon" }) },
          ]}
        >
          <span aria-hidden="true">◯</span> Spielfeld <span aria-hidden="true">▾</span>
        </Menu>
        <Menu
          label="Sperrzone"
          class={is("area", "zone") ? "active" : undefined}
          items={[
            { label: "Vieleck zeichnen", hint: "Straße, Bach, Hang …", onSelect: () => onTool({ kind: "area", target: "zone", shape: "polygon" }) },
            { label: "Kreis", hint: "Teich, Grube", onSelect: () => onTool({ kind: "area", target: "zone", shape: "circle" }) },
          ]}
        >
          <span aria-hidden="true">▨</span> Sperrzone <span aria-hidden="true">▾</span>
        </Menu>
        <Menu label="Punkt" class={is("point") ? "active" : undefined} items={POINT_TOOLS.map((p) => ({ label: p.label, hint: p.hint, onSelect: () => onTool({ kind: "point", point: p.point }) }))}>
          <span aria-hidden="true">⚑</span> Punkt <span aria-hidden="true">▾</span>
        </Menu>
        <button type="button" class="btn small" onClick={onLocate}>
          <Icon name="pin" /> Mein Standort
        </button>
      </div>
      {hint && (
        <div class="ed-map-hint row between" role="status">
          <span>{hint}</span>
          <span class="row nowrap">
            {tool.kind === "station" && (
              <button type="button" class="btn small" onClick={onCenter}>
                In der Kartenmitte
              </button>
            )}
            {tool.kind === "area" && tool.shape === "polygon" && (
              <>
                <button type="button" class="btn small" onClick={onCenter}>
                  Ecke in der Kartenmitte
                </button>
                {drawing > 0 && (
                  <button type="button" class="btn small" onClick={onUndoVertex}>
                    Letzte Ecke weg
                  </button>
                )}
                <button type="button" class="btn small primary" disabled={drawing < 3} onClick={onFinish}>
                  Fertig
                </button>
              </>
            )}
            {tool.kind === "area" && tool.shape === "circle" && (
              <button type="button" class="btn small" onClick={onCenter}>
                In der Kartenmitte
              </button>
            )}
            {tool.kind === "point" && (
              <button type="button" class="btn small" onClick={onCenter}>
                In der Kartenmitte
              </button>
            )}
            <button type="button" class="btn small ghost" onClick={onCancel}>
              Abbrechen
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
