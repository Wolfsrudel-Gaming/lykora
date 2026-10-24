/**
 * Paket B: Bereich „Karte & Stationen“ (UX §6, W4). Werkzeugleiste, Karte und Seitenleiste mit dem
 * Formular der Auswahl (Station, Sperrzone, Spielfeld, Punkt) oder – ohne Auswahl – den Listen der
 * Punkte und Sperrzonen und den Meldungen der Karte. Jede Änderung ist ein Schritt im Verlauf; Ziehen
 * schreibt einmal je Zug, Pfeiltasten verschmelzen innerhalb einer Sekunde. Prüfungen laufen sofort.
 * ?objekt=<id> wählt eine Station oder Sperrzone aus, ?feld= einen Punkt oder das Spielfeld.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { isArea, isPoint, offsetPoint, type Area } from "../../../../lib/editor/geo.ts";
import { STATION_KINDS, type StationKind } from "../../../../lib/editor/stations.ts";
import { editor, shallowArray, useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, Point } from "../../../../lib/editor/types.ts";
import { useLocation } from "../../../../lib/router.ts";
import { notify } from "../../../../lib/session.ts";
import { useMedia } from "../../../../ui/components.tsx";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { gameFacts } from "../OverviewSection.tsx";
import type { SectionProps } from "../sections.ts";
import { IssueList } from "../ui/IssueList.tsx";
import {
  addPoint,
  addStation,
  addZone,
  areaSummary,
  BOUNDARY_RADIUS,
  DEFAULT_LAYERS,
  moveArea,
  moveStationTo,
  nudgeOf,
  POINT_LABELS,
  setBoundary,
  setGpsRadius,
  setPoint,
  ZONE_KINDS,
  ZONE_RADIUS,
  type PointKind,
} from "./actions.ts";
import { AreaEditor } from "./AreaEditor.tsx";
import type { AreaTarget, MapLayers, Selection, Tool } from "./EditorMap.tsx";
import { LazyEditorMap } from "./LazyMap.tsx";
import { MapToolbar } from "./MapToolbar.tsx";
import { PointPanel, removePoint } from "./PointPanel.tsx";
import { MAP_CODES, NewStationPanel, StationPanel } from "./StationPanel.tsx";
import { StationList } from "./StationList.tsx";
import { ZonePanel } from "./ZonePanel.tsx";

const LAYERS_KEY = "lykora.karte.ebenen";

function loadLayers(): MapLayers {
  try {
    return { ...DEFAULT_LAYERS, ...(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "{}") as Partial<MapLayers>) };
  } catch {
    return DEFAULT_LAYERS;
  }
}

/** Auswahl aus ?objekt= und ?feld= (Sprung aus Meldungen und der Stationsliste). */
export function selectionFromQuery(objekt: string | null, feld: string | null, stationIds: string[], zoneIds: string[]): Selection | null {
  if (objekt && stationIds.includes(objekt)) return { kind: "station", id: objekt };
  if (objekt && zoneIds.includes(objekt)) return { kind: "zone", id: objekt };
  if (!feld) return null;
  if (feld.startsWith("field.boundary")) return { kind: "boundary" };
  if (feld.startsWith("field.assemblyPoint")) return { kind: "point", point: "assembly" };
  if (feld.startsWith("field.start")) return { kind: "point", point: "start" };
  const m = /^field\.(rescuePoints|supplyPoints)\.(\d+)/.exec(feld);
  if (m) return { kind: "point", point: m[1] === "rescuePoints" ? "rescue" : "supply", index: Number(m[2]) };
  return null;
}

export function MapSection({ gameId }: SectionProps) {
  const store = editor.get().current!;
  const game = useEditorSelect((s) => s.game);
  const meta = useEditorSelect((s) => s.meta);
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const dismissed = useEditorSelect((s) => s.meta.dismissed ?? [], shallowArray);
  const lang = useEditorSelect((s) => s.lang);
  const wide = useMedia("(min-width: 1280px)");
  const loc = useLocation();
  const [tool, setToolState] = useState<Tool>({ kind: "select" });
  const [stationKind, setStationKind] = useState<StationKind>("raetsel");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [pending, setPending] = useState<Point | null>(null);
  const [layers, setLayers] = useState<MapLayers>(loadLayers);
  const [me, setMe] = useState<{ point: Point; accuracy: number } | null>(null);
  const [focus, setFocus] = useState<{ point: Point; zoom?: number; key: number } | null>(null);
  const [center, setCenter] = useState<Point | null>(null);

  const objekt = loc.query.get("objekt");
  const feld = loc.query.get("feld");
  useEffect(() => {
    const sel = selectionFromQuery(
      objekt,
      feld,
      (game.stations ?? []).map((s) => s?.id),
      (game.field?.restrictedZones ?? []).map((z) => z?.id),
    );
    if (!sel) return;
    setSelection(sel);
    const p = sel.kind === "station" ? game.stations?.find((s) => s?.id === sel.id)?.location : sel.kind === "point" && sel.point === "assembly" ? game.field?.assemblyPoint?.location : null;
    if (isPoint(p)) setFocus({ point: p, key: Date.now() });
  }, [objekt, feld]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      // Ebenen merken ist Bequemlichkeit, kein Muss.
    }
  }, [layers]);

  // Auswahl, die es nicht mehr gibt (gelöscht, Rückgängig), fällt weg.
  useEffect(() => {
    if (selection?.kind === "station" && !game.stations?.some((s) => s?.id === selection.id)) setSelection(null);
    if (selection?.kind === "zone" && !game.field?.restrictedZones?.some((z) => z?.id === selection.id)) setSelection(null);
  }, [game, selection]);

  const setTool = (t: Tool) => {
    setToolState(t);
    setDrawing(t.kind === "area" && t.shape === "polygon" ? [] : null);
    if (t.kind !== "station") setPending(null);
    if (t.kind !== "select") setSelection(null);
  };
  const cancel = () => {
    setDrawing(null);
    setPending(null);
    setToolState({ kind: "select" });
  };

  const name = (id: string) => readText(game.stations?.find((s) => s?.id === id)?.name as never, lang) || id;
  const zoneName = (id: string) => readText(game.field?.restrictedZones?.find((z) => z?.id === id)?.name as never, lang) || id;

  const writeArea = (target: AreaTarget, area: Area, label?: string) => {
    if (target.kind === "boundary") store.update(label ?? "Spielfeld geändert", (g) => setBoundary(g, area));
    else
      store.update(label ?? `Sperrzone „${zoneName(target.id)}“ geändert`, (g) => {
        const z = g.field?.restrictedZones?.find((x) => x?.id === target.id);
        if (z) z.area = area;
      });
  };

  const finishDrawing = (pts = drawing) => {
    if (tool.kind !== "area" || !pts) return;
    if (pts.length < 3) return notify("Ein Vieleck braucht mindestens drei Ecken.", "warn");
    const area: Area = { polygon: pts };
    if (tool.target === "boundary") {
      store.update("Spielfeld als Vieleck gezeichnet", (g) => setBoundary(g, area));
      setSelection({ kind: "boundary" });
    } else {
      let id = "";
      store.update("Sperrzone gezeichnet", (g) => {
        id = addZone(g, area);
      });
      setSelection({ kind: "zone", id });
      focusPanelInput();
    }
    setDrawing(null);
    setToolState({ kind: "select" });
  };

  const onMapClick = (p: Point) => {
    switch (tool.kind) {
      case "select":
        return setSelection(null);
      case "station":
        return setPending(p);
      case "area":
        if (tool.shape === "polygon") return setDrawing([...(drawing ?? []), p]);
        if (tool.target === "boundary") {
          store.update("Spielfeld als Kreis gesetzt", (g) => setBoundary(g, { center: p, radius: BOUNDARY_RADIUS }));
          setSelection({ kind: "boundary" });
        } else {
          let id = "";
          store.update("Sperrzone als Kreis gesetzt", (g) => {
            id = addZone(g, { center: p, radius: ZONE_RADIUS });
          });
          setSelection({ kind: "zone", id });
          focusPanelInput();
        }
        return setToolState({ kind: "select" });
      case "point": {
        const kind = tool.point;
        if (kind === "assembly" || kind === "start") {
          store.update(`${POINT_LABELS[kind]} gesetzt`, (g) => setPoint(g, kind, p));
          setSelection({ kind: "point", point: kind });
        } else {
          let index = 0;
          store.update(`${POINT_LABELS[kind]} angelegt`, (g) => {
            index = addPoint(g, kind, p);
          });
          setSelection({ kind: "point", point: kind, index });
          focusPanelInput();
        }
        return setToolState({ kind: "select" });
      }
    }
  };

  const createStation = (stationName: string) => {
    if (!pending) return;
    let id = "";
    store.update(`Station „${stationName}“ angelegt`, (g) => {
      id = addStation(g, stationKind, stationName, pending);
    });
    setPending(null);
    setToolState({ kind: "select" });
    setSelection({ kind: "station", id });
    notify(`Station „${stationName}“ angelegt.`, "ok");
  };

  const nudge = (dx: number, dy: number) => {
    const s = selection;
    if (!s) return false;
    if (s.kind === "station") {
      const st = game.stations?.find((x) => x?.id === s.id);
      if (!st || !isPoint(st.location)) return false;
      store.update(`Station „${name(s.id)}“ verschoben`, (g) => moveStationTo(g, s.id, offsetPoint(st.location!, dx, dy)), { coalesce: `nudge:${s.id}` });
      return true;
    }
    if (s.kind === "point") {
      const f = game.field;
      const p = s.point === "assembly" ? f?.assemblyPoint?.location : s.point === "start" ? f?.start : (s.point === "rescue" ? f?.rescuePoints : f?.supplyPoints)?.[s.index ?? 0]?.location;
      if (!isPoint(p)) return false;
      movePoint(s.point, s.index, offsetPoint(p, dx, dy), `nudge:${s.point}:${s.index ?? ""}`);
      return true;
    }
    const target: AreaTarget = s.kind === "boundary" ? { kind: "boundary" } : { kind: "zone", id: s.id };
    const area = s.kind === "boundary" ? game.field?.boundary : game.field?.restrictedZones?.find((z) => z?.id === s.id)?.area;
    if (!isArea(area)) return false;
    store.update(
      s.kind === "boundary" ? "Spielfeld verschoben" : `Sperrzone „${zoneName(s.id)}“ verschoben`,
      (g) => {
        if (target.kind === "boundary") setBoundary(g, moveArea(area, dx, dy));
        else {
          const z = g.field?.restrictedZones?.find((x) => x?.id === target.id);
          if (z) z.area = moveArea(area, dx, dy);
        }
      },
      { coalesce: `nudge:${s.kind}` },
    );
    return true;
  };

  const movePoint = (kind: PointKind, index: number | undefined, p: Point, coalesce?: string) => {
    if (kind === "assembly" || kind === "start") store.update(`${POINT_LABELS[kind]} verschoben`, (g) => setPoint(g, kind, p), { coalesce });
    else
      store.update(
        `${POINT_LABELS[kind]} verschoben`,
        (g) => {
          const list = kind === "rescue" ? g.field?.rescuePoints : g.field?.supplyPoints;
          const item = list?.[index ?? 0];
          if (item) item.location = { lat: p.lat, lon: p.lon };
        },
        { coalesce },
      );
  };

  const remove = () => {
    const s = selection;
    if (!s) return;
    if (s.kind === "station") void deleteWithReferences("station", s.id, name(s.id)).then((ok) => ok && setSelection(null));
    else if (s.kind === "zone") void deleteWithReferences("zone", s.id, zoneName(s.id)).then((ok) => ok && setSelection(null));
    else if (s.kind === "point" && (s.point === "rescue" || s.point === "supply")) {
      const list = s.point === "rescue" ? game.field?.rescuePoints : game.field?.supplyPoints;
      removePoint(s.point, s.index ?? 0, readText(list?.[s.index ?? 0]?.name as never, lang) || POINT_LABELS[s.point]);
      setSelection(null);
    } else notify(s.kind === "boundary" ? "Das Spielfeld lässt sich nur ersetzen, nicht löschen." : `Den ${POINT_LABELS[s.point]} gibt es immer; verschieben geht.`, "info");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (drawing) {
      if (e.key === "Enter") finishDrawing();
      else if (e.key === "Backspace") setDrawing(drawing.slice(0, -1));
      else if (e.key === "Escape") cancel();
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "Escape") {
      if (pending || tool.kind !== "select") cancel();
      else if (selection) setSelection(null);
      else return;
      e.preventDefault();
      return;
    }
    if (tool.kind !== "select") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!selection) return;
      e.preventDefault();
      e.stopPropagation();
      remove();
      return;
    }
    const n = nudgeOf(e.key, e.shiftKey);
    if (n && nudge(n.dx, n.dy)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const clickCenter = () => {
    if (center) onMapClick(center);
  };

  const show = (p: Point) => setFocus({ point: p, key: Date.now() });
  const facts = useMemo(() => gameFacts(game), [game]);
  const mapIssues = useMemo(() => {
    const hidden = new Set(dismissed);
    return issues.filter((i) => !hidden.has(i.id) && (MAP_CODES.has(i.code) || i.at.path.startsWith("/field")));
  }, [issues, dismissed]);

  return (
    <section class="ed-map-section stack" aria-labelledby="bereich-karte">
      <header class="row between">
        <h2 id="bereich-karte" tabIndex={-1}>
          Karte & Stationen
        </h2>
        <span class="small muted">
          {facts.stations} {facts.stations === 1 ? "Station" : "Stationen"}
          {facts.walkM > 0 && ` · Luftlinie ${facts.walkM >= 1000 ? `${(facts.walkM / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(facts.walkM)} m`} · ≈ ${facts.estimateMin} Min`}
        </span>
      </header>
      <MapToolbar
        tool={tool}
        stationKind={stationKind}
        drawing={drawing?.length ?? 0}
        onTool={setTool}
        onStationKind={setStationKind}
        onLocate={() => locate(setMe, show)}
        onFinish={() => finishDrawing()}
        onUndoVertex={() => setDrawing((d) => (d ? d.slice(0, -1) : d))}
        onCenter={clickCenter}
        onCancel={cancel}
      />
      <div class="ed-map-grid">
        <div class="ed-map-main stack tight">
          <LazyEditorMap
            game={game}
            meta={meta}
            issues={issues}
            dismissed={dismissed}
            selection={selection}
            tool={tool}
            drawing={drawing}
            pending={pending}
            layers={layers}
            me={me}
            focus={focus}
            label="Karte des Spielfelds"
            describedBy="karte-hilfe"
            onSelect={(s) => {
              setSelection(s);
              setPending(null);
            }}
            onMapClick={onMapClick}
            onDblClick={() => drawing && finishDrawing()}
            onStation={(id, p) => store.update(`Station „${name(id)}“ verschoben`, (g) => moveStationTo(g, id, p))}
            onRadius={(id, r) => store.update(`GPS-Radius von „${name(id)}“: ${r} m`, (g) => setGpsRadius(g, id, r))}
            onPoint={(kind, index, p) => movePoint(kind, index, p)}
            onArea={(target, area) => writeArea(target, area)}
            onKeyDown={onKeyDown}
            onView={setCenter}
          />
          <fieldset class="ed-layers row">
            <legend class="sr-only">Ebenen</legend>
            <span class="label">Ebenen</span>
            {(
              [
                ["radii", "Radien"],
                ["route", "Laufweg"],
                ["rules", "Regelorte"],
              ] as [keyof MapLayers, string][]
            ).map(([key, label]) => (
              <label key={key} class="check">
                <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers({ ...layers, [key]: e.currentTarget.checked })} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <p id="karte-hilfe" class="small muted">
            Ausgewählte Marker lassen sich mit den Pfeiltasten verschieben (1 m, mit Umschalt 10 m); Entf löscht. Beim Zeichnen: Enter beendet, Rücktaste nimmt die letzte Ecke zurück, Esc bricht ab.
            Alles geht auch über die Formulare daneben.
          </p>
        </div>
        <aside class="ed-map-panel card" aria-label="Auswahl">
          {pending ? (
            <NewStationPanel location={pending} kind={stationKind} onKind={setStationKind} onCreate={createStation} onCancel={cancel} />
          ) : selection?.kind === "station" ? (
            <StationPanel gameId={gameId} id={selection.id} onShow={show} onClose={() => setSelection(null)} onSelect={(id) => setSelection({ kind: "station", id })} />
          ) : selection?.kind === "zone" ? (
            <ZonePanel id={selection.id} onShow={show} onClose={() => setSelection(null)} onRedraw={(shape) => setTool({ kind: "area", target: "zone", shape })} />
          ) : selection?.kind === "boundary" ? (
            <div class="stack" data-feld="field.boundary">
              <header class="row between">
                <h3>Spielfeld</h3>
                <button type="button" class="btn small ghost" onClick={() => setSelection(null)}>
                  Schließen
                </button>
              </header>
              <p class="small muted">Teams werden gewarnt, wenn sie es verlassen. Ein neues Spielfeld ersetzt das alte (Strg+Z holt es zurück).</p>
              <AreaEditor path="/field/boundary" label="Spielfeld" onShow={show} onRedraw={(shape) => setTool({ kind: "area", target: "boundary", shape })} />
            </div>
          ) : selection?.kind === "point" ? (
            <PointPanel kind={selection.point} index={selection.index} onShow={show} onClose={() => setSelection(null)} />
          ) : (
            <Lists wide={wide} gameId={gameId} onSelect={setSelection} onTool={setTool} issues={mapIssues} />
          )}
        </aside>
      </div>
    </section>
  );
}

/** Ohne Auswahl: Stationen (wenn die Navigation sie nicht zeigt), Spielfeld, Punkte, Sperrzonen, Meldungen. */
function Lists({ wide, gameId, onSelect, onTool, issues }: { wide: boolean; gameId: string; onSelect: (s: Selection) => void; onTool: (t: Tool) => void; issues: EditorIssue[] }) {
  const field = useEditorSelect((s) => s.game.field);
  const lang = useEditorSelect((s) => s.lang);
  const ap = field?.assemblyPoint;
  return (
    <div class="stack ed-map-lists">
      {!wide && (
        <section class="stack tight" aria-labelledby="karte-stationen">
          <header class="row between">
            <h3 id="karte-stationen">Stationen</h3>
            <button type="button" class="btn small" onClick={() => onTool({ kind: "station" })}>
              + Station
            </button>
          </header>
          <StationList gameId={gameId} />
        </section>
      )}
      <section class="stack tight" aria-labelledby="karte-feld">
        <h3 id="karte-feld">Spielfeld</h3>
        <button type="button" class="ed-map-item" onClick={() => onSelect({ kind: "boundary" })}>
          <span aria-hidden="true">◯</span> {areaSummary(field?.boundary)}
        </button>
      </section>
      <section class="stack tight" aria-labelledby="karte-punkte">
        <h3 id="karte-punkte">Punkte</h3>
        <ul class="ed-map-items">
          <li>
            <button type="button" class="ed-map-item" onClick={() => onSelect({ kind: "point", point: "assembly" })}>
              <span class="ed-sym assembly" aria-hidden="true">
                S
              </span>{" "}
              Sammelpunkt: {readText(ap?.name as never, lang) || <em class="muted">ohne Namen</em>}
            </button>
          </li>
          <li>
            <button type="button" class="ed-map-item" onClick={() => onSelect({ kind: "point", point: "start" })}>
              <span class="ed-sym" aria-hidden="true">
                ⚑
              </span>{" "}
              Startpunkt: {isPoint(field?.start) ? "eigener Ort" : "wie Sammelpunkt"}
            </button>
          </li>
          {(field?.rescuePoints ?? []).map((p, i) => (
            <li key={`r${i}`}>
              <button type="button" class="ed-map-item" onClick={() => onSelect({ kind: "point", point: "rescue", index: i })}>
                <span class="ed-sym rescue" aria-hidden="true">
                  +
                </span>{" "}
                {readText(p?.name as never, lang) || `Rettungspunkt ${i + 1}`}
              </button>
            </li>
          ))}
          {(field?.supplyPoints ?? []).map((p, i) => (
            <li key={`v${i}`}>
              <button type="button" class="ed-map-item" onClick={() => onSelect({ kind: "point", point: "supply", index: i })}>
                <span class="ed-sym" aria-hidden="true">
                  ◍
                </span>{" "}
                {readText(p?.name as never, lang) || `Versorgungspunkt ${i + 1}`}
              </button>
            </li>
          ))}
        </ul>
        <span class="row">
          <button type="button" class="btn small" onClick={() => onTool({ kind: "point", point: "rescue" })}>
            + Rettungspunkt
          </button>
          <button type="button" class="btn small" onClick={() => onTool({ kind: "point", point: "supply" })}>
            + Versorgungspunkt
          </button>
        </span>
      </section>
      <section class="stack tight" aria-labelledby="karte-zonen">
        <h3 id="karte-zonen">Sperrzonen</h3>
        {(field?.restrictedZones ?? []).length ? (
          <ul class="ed-map-items">
            {(field?.restrictedZones ?? []).map((z) =>
              z ? (
                <li key={z.id}>
                  <button type="button" class="ed-map-item" onClick={() => onSelect({ kind: "zone", id: z.id })}>
                    <span class="ed-sym zone" aria-hidden="true">
                      {ZONE_KINDS[z.kind ?? "other"]?.symbol ?? "▨"}
                    </span>{" "}
                    {readText(z.name as never, lang) || z.id}
                    <span class="small muted"> · Warnung ab {typeof z.warnDistance === "number" ? z.warnDistance : 15} m</span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p class="small muted">Noch keine. Straßen, Wasser und Abhänge gehören eingezeichnet.</p>
        )}
        <span class="row">
          <button type="button" class="btn small" onClick={() => onTool({ kind: "area", target: "zone", shape: "polygon" })}>
            + Sperrzone zeichnen
          </button>
        </span>
      </section>
      {issues.length > 0 && (
        <section class="stack tight" aria-labelledby="karte-meldungen">
          <h3 id="karte-meldungen">Prüfungen auf der Karte</h3>
          <IssueList issues={issues} jump />
        </section>
      )}
      <p class="small muted">
        Bausteine für neue Stationen:{" "}
        {Object.values(STATION_KINDS)
          .map((k) => k.label)
          .join(", ")}{" "}
        – im Menü ▾ neben „+ Station“.
      </p>
    </div>
  );
}

/** Eigene Position einmal abfragen und zeigen. */
function locate(set: (me: { point: Point; accuracy: number }) => void, show: (p: Point) => void): void {
  if (!("geolocation" in navigator)) return notify("Dieser Browser kennt keinen Standort.", "warn");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      set({ point, accuracy: pos.coords.accuracy });
      show(point);
    },
    () => notify("Standort nicht verfügbar. Bitte im Browser freigeben oder Koordinaten eintippen.", "warn"),
    { enableHighAccuracy: true, timeout: 15_000 },
  );
}

/** Nach dem Anlegen: erstes Feld der Seitenleiste (Name) markieren, damit man gleich tippen kann. */
function focusPanelInput(): void {
  // Zwei Frames: erst rendert die Seitenleiste das neue Formular.
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".ed-map-panel input:not([type])")?.select()));
}
