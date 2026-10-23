/**
 * Paket B: Karte des Baukastens auf Leaflet (wie MapView.tsx im Leitstand) – Spielfeld, Sperrzonen
 * mit Absperrband, Stationen mit Zustand (✗ ! ?), Punkte, GPS-Radien, Laufweg, Regelorte und die
 * Griffe der Auswahl: Marker ziehen (ein Schreiben je Zug), Radius-Griff in 5-m-Schritten, Ecken
 * ziehen, Mittelpunkte einfügen, Vieleck zeichnen. Sie zeichnet nur und meldet; schreiben tut der
 * Bereich (MapSection, Vor-Ort-Modus, Übersicht nur lesend). Tastatur: Fokus auf einem Marker oder
 * einer Ecke, Pfeile schieben 1 m (Umschalt 10 m), Entf löscht eine Ecke.
 */

import { useEffect, useRef } from "preact/hooks";
import { distanceM, gpsCircle, isArea, isPoint, offsetPoint, roundRadius, type Area } from "../../../../lib/editor/geo.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, EditorMeta, Game, Point } from "../../../../lib/editor/types.ts";
import { atTemplate, markerState, nudgeOf, type PointKind } from "./actions.ts";
import { ASSEMBLY_SVG, L, RESCUE_SVG, START_SVG, SUPPLY_SVG, TAPE_DEFS, baseMap, drawArea, esc, gameBounds, handleIcon, ll, pointIcon, pt } from "./leaflet.ts";

export type Selection = { kind: "station"; id: string } | { kind: "zone"; id: string } | { kind: "boundary" } | { kind: "point"; point: PointKind; index?: number };

export type Tool = { kind: "select" } | { kind: "station" } | { kind: "area"; target: "boundary" | "zone"; shape: "circle" | "polygon" } | { kind: "point"; point: PointKind };

export interface MapLayers {
  radii: boolean;
  route: boolean;
  rules: boolean;
}

/** Fläche, die gerade Griffe hat */
export type AreaTarget = { kind: "boundary" } | { kind: "zone"; id: string };

export interface EditorMapProps {
  game: Game;
  meta?: EditorMeta;
  issues?: EditorIssue[];
  dismissed?: string[];
  selection?: Selection | null;
  tool?: Tool;
  /** Vieleck im Entstehen */
  drawing?: Point[] | null;
  /** Ort einer neuen Station, deren Name noch fehlt */
  pending?: Point | null;
  layers?: MapLayers;
  /** eigene Position mit Genauigkeit */
  me?: { point: Point; accuracy: number } | null;
  /** Kartenausschnitt auf diesen Punkt; key ändert sich je Wunsch */
  focus?: { point: Point; zoom?: number; key: number } | null;
  label: string;
  /** id der Kurzhilfe für Tastatur und Vorleser */
  describedBy?: string;
  readOnly?: boolean;
  class?: string;
  onSelect?: (s: Selection | null) => void;
  onMapClick?: (p: Point) => void;
  onDblClick?: () => void;
  onStation?: (id: string, p: Point) => void;
  onRadius?: (id: string, radius: number) => void;
  onPoint?: (kind: PointKind, index: number | undefined, p: Point) => void;
  onArea?: (target: AreaTarget, area: Area) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Mitte des Kartenausschnitts nach jedem Verschieben (für „in der Kartenmitte“) */
  onView?: (center: Point) => void;
}

const STATE_TEXT: Record<"error" | "warning", string> = { error: "mit Fehler", warning: "mit Warnung" };

export function EditorMap(props: EditorMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const group = useRef<L.LayerGroup | null>(null);
  const rubber = useRef<L.Polyline | null>(null);
  const live = useRef(props);
  live.current = props;
  const fitted = useRef(false);
  const lastClick = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    const { map: m, dispose } = baseMap(el.current!, { keyboard: true });
    group.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      const p = live.current;
      // Doppelklick beim Zeichnen: der zweite Klick setzt keine zweite Ecke an dieselbe Stelle.
      const now = Date.now();
      const prev = lastClick.current;
      lastClick.current = { x: e.containerPoint.x, y: e.containerPoint.y, t: now };
      if (p.drawing && prev && now - prev.t < 500 && Math.hypot(prev.x - e.containerPoint.x, prev.y - e.containerPoint.y) < 6) return;
      p.onMapClick?.(pt(e.latlng));
    });
    m.on("dblclick", () => live.current.onDblClick?.());
    m.on("moveend", () => live.current.onView?.(pt(m.getCenter())));
    m.on("mousemove", (e: L.LeafletMouseEvent) => {
      const d = live.current.drawing;
      if (!d?.length) return rubber.current?.remove();
      const line: L.LatLngTuple[] = [ll(d[d.length - 1]!), [e.latlng.lat, e.latlng.lng]];
      if (rubber.current) rubber.current.setLatLngs(line);
      else rubber.current = L.polyline(line, { className: "lf-draw rubber", interactive: false });
      if (!m.hasLayer(rubber.current)) rubber.current.addTo(m);
    });
    map.current = m;
    return () => {
      dispose();
      map.current = null;
      group.current = null;
      rubber.current = null;
    };
  }, []);

  // Beim Zeichnen zoomt der Doppelklick nicht, sondern beendet die Fläche.
  const drawingNow = !!props.drawing;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (drawingNow) m.doubleClickZoom.disable();
    else {
      m.doubleClickZoom.enable();
      rubber.current?.remove();
    }
  }, [drawingNow]);

  const { game, meta, issues, dismissed, selection, tool, drawing, pending, layers, me, readOnly } = props;
  useEffect(() => {
    const m = map.current;
    const g = group.current;
    if (!m || !g) return;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active?.closest?.("[data-map-key]")?.getAttribute("data-map-key") ?? null;
    g.clearLayers();
    const lang = game?.meta?.languages?.[0] ?? "de";
    const editing = !readOnly && (!tool || tool.kind === "select");
    const lay = layers ?? { radii: true, route: false, rules: false };
    const keyed: [string, L.Marker][] = [];
    const add = (key: string, marker: L.Marker) => {
      marker.addTo(g);
      marker.getElement()?.setAttribute("data-map-key", key);
      keyed.push([key, marker]);
      return marker;
    };
    const selKey = selectionKey(selection ?? null);
    const field = game?.field;

    // Spielfeld
    if (isArea(field?.boundary)) {
      const path = drawArea(field.boundary, { className: `lf-boundary${selKey === "boundary" ? " selected" : ""}`, fill: false, interactive: editing, bubblingMouseEvents: false });
      if (editing) path.on("click", () => live.current.onSelect?.({ kind: "boundary" })).bindTooltip("Spielfeld", { sticky: true });
      path.addTo(g);
    }
    // Sperrzonen
    for (const z of field?.restrictedZones ?? []) {
      if (!z || !isArea(z.area)) continue;
      const name = readText(z.name as never, lang) || z.id;
      const path = drawArea(z.area, { className: `lf-zone${selKey === `zone:${z.id}` ? " selected" : ""}`, interactive: editing || !!readOnly, bubblingMouseEvents: false });
      path.bindTooltip(`Sperrzone: ${esc(name)}`, { sticky: true });
      if (editing) path.on("click", () => live.current.onSelect?.({ kind: "zone", id: z.id }));
      path.addTo(g);
    }
    // Regelorte: „in der Nähe von …“ und Zielorte von „Ort finden“
    if (lay.rules) {
      for (const r of game?.rules ?? []) {
        for (const c of r?.when ?? []) {
          if (c && "near" in c && isPoint(c.near?.location)) {
            L.circle(ll(c.near.location), { radius: c.near.radius || 20, className: "lf-rule", interactive: false }).addTo(g);
          }
        }
      }
      for (const s of game?.stations ?? []) {
        const t = s?.task;
        if (t?.type === "find_location" && isPoint(t.location)) {
          L.circle(ll(t.location), { radius: t.radius || 20, className: "lf-rule", interactive: true })
            .bindTooltip(`Ziel von „${esc(readText(s.name as never, lang) || s.id)}“`, { sticky: true })
            .addTo(g);
        }
      }
    }
    // GPS-Radien und Laufweg
    const circles = new Map<string, L.Circle>();
    const route: L.LatLngTuple[] = [];
    for (const s of game?.stations ?? []) {
      if (!s?.id) continue;
      const c = gpsCircle(s);
      if (isPoint(s.location)) route.push(ll(s.location));
      if (!c || !(lay.radii || selKey === `station:${s.id}`)) continue;
      const circle = L.circle(ll(c.center), { radius: c.radius, className: `lf-gps${selKey === `station:${s.id}` ? " selected" : ""}`, interactive: false }).addTo(g);
      circles.set(s.id, circle);
    }
    if (lay.route && route.length > 1) L.polyline(route, { className: "lf-route", interactive: true }).bindTooltip("Laufweg als Luftlinie", { sticky: true }).addTo(g);

    // Punkte
    const pointMarker = (kind: PointKind, index: number | undefined, p: Point, cls: string, svg: string, title: string) => {
      const key = index === undefined ? `point:${kind}` : `point:${kind}:${index}`;
      const selected = selKey === key;
      const marker = L.marker(ll(p), {
        icon: pointIcon(`${cls}${selected ? " selected" : ""}`, svg, kind === "assembly" ? 28 : 24),
        title,
        alt: title,
        keyboard: editing,
        interactive: editing || !!readOnly,
        draggable: editing,
        zIndexOffset: kind === "assembly" ? 500 : 200,
      }).bindTooltip(esc(title), { direction: "top", offset: [0, -14] });
      if (editing) {
        marker.on("click", () => live.current.onSelect?.({ kind: "point", point: kind, index }));
        marker.on("dragend", () => live.current.onPoint?.(kind, index, pt(marker.getLatLng())));
      }
      add(key, marker);
    };
    const ap = field?.assemblyPoint;
    if (ap && isPoint(ap.location)) pointMarker("assembly", undefined, ap.location, "mk-assembly", ASSEMBLY_SVG, `Sammelpunkt: ${readText(ap.name as never, lang) || "ohne Namen"}`);
    if (isPoint(field?.start)) pointMarker("start", undefined, field.start, "mk-start", START_SVG, "Startpunkt");
    (field?.rescuePoints ?? []).forEach((rp, i) => {
      if (rp && isPoint(rp.location)) pointMarker("rescue", i, rp.location, "mk-rescue", RESCUE_SVG, `Rettungspunkt: ${readText(rp.name as never, lang) || `Nr. ${i + 1}`}`);
    });
    (field?.supplyPoints ?? []).forEach((sp, i) => {
      if (sp && isPoint(sp.location)) pointMarker("supply", i, sp.location, "mk-supply", SUPPLY_SVG, `Versorgungspunkt: ${readText(sp.name as never, lang) || `Nr. ${i + 1}`}`);
    });

    // Stationen
    (game?.stations ?? []).forEach((s, i) => {
      if (!s?.id || !isPoint(s.location)) return;
      const name = readText(s.name as never, lang) || s.id;
      const state = issues ? markerState(issues, s.id, dismissed) : null;
      const tpl = atTemplate(meta, s.id, s.location);
      const selected = selKey === `station:${s.id}`;
      const cls = `mk-station ed-station${s.final ? " final" : ""}${s.visibility === "hidden" ? " hidden" : ""}${tpl ? " template" : ""}${state ? ` ${state}` : ""}${selected ? " selected" : ""}`;
      const flag = state ? `<b class="mk-flag" aria-hidden="true">${state === "error" ? "✗" : "!"}</b>` : "";
      const title = `${s.final ? "Finale" : `Station ${i + 1}`}: ${name}${state ? ` – ${STATE_TEXT[state]}` : ""}${tpl ? " – noch am Platz der Vorlage" : ""}`;
      const marker = L.marker(ll(s.location), {
        icon: L.divIcon({ className: cls, html: `<span>${s.final ? "★" : i + 1}</span>${flag}${tpl ? '<i class="mk-tpl" aria-hidden="true">?</i>' : ""}`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title,
        alt: `Station ${name}`,
        keyboard: editing || !!readOnly,
        interactive: editing || !!readOnly,
        draggable: editing,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 300,
      }).bindTooltip(esc(name), { direction: "top", offset: [0, -14] });
      if (editing || readOnly) marker.on("click", () => live.current.onSelect?.({ kind: "station", id: s.id }));
      if (editing) {
        marker.on("drag", () => circles.get(s.id)?.setLatLng(marker.getLatLng()));
        marker.on("dragend", () => live.current.onStation?.(s.id, pt(marker.getLatLng())));
      }
      add(`station:${s.id}`, marker);
    });

    // Griffe der Auswahl
    if (editing && selection?.kind === "station") {
      const s = game?.stations?.find((st) => st?.id === selection.id);
      const c = gpsCircle(s);
      const circle = s ? circles.get(s.id) : undefined;
      if (s && c && circle) radiusHandle(c.center, c.radius, circle, (r) => live.current.onRadius?.(s.id, r));
    }
    if (editing && (selection?.kind === "boundary" || selection?.kind === "zone")) {
      const target: AreaTarget = selection.kind === "boundary" ? { kind: "boundary" } : { kind: "zone", id: selection.id };
      const area = selection.kind === "boundary" ? field?.boundary : field?.restrictedZones?.find((z) => z?.id === selection.id)?.area;
      if (isArea(area)) areaHandles(area, target);
    }

    function radiusHandle(center: Point, radius: number, circle: L.Circle, done: (r: number) => void) {
      const edge = offsetPoint(center, radius, 0);
      const handle = L.marker(ll(edge), { icon: handleIcon("radius", `${radius} m`), draggable: true, keyboard: false, title: "Radius ziehen", zIndexOffset: 1500 });
      handle.on("drag", () => {
        const r = roundRadius(distanceM(center, pt(handle.getLatLng())));
        circle.setRadius(r);
        const label = handle.getElement()?.querySelector(".mk-handle-label");
        if (label) label.textContent = `${r} m`;
      });
      handle.on("dragend", () => done(roundRadius(distanceM(center, pt(handle.getLatLng())))));
      add("radius", handle);
    }

    function areaHandles(area: Area, target: AreaTarget) {
      const shape = drawArea(area, { className: `lf-edit${target.kind === "zone" ? " zone" : ""}`, fill: false, interactive: false }).addTo(g!);
      if ("center" in area) {
        const center = L.marker(ll(area.center), { icon: handleIcon("center"), draggable: true, keyboard: true, title: "Mitte der Fläche – ziehen oder Pfeiltasten", zIndexOffset: 1500 });
        center.on("drag", () => (shape as L.Circle).setLatLng(center.getLatLng()));
        center.on("dragend", () => live.current.onArea?.(target, { center: pt(center.getLatLng()), radius: area.radius }));
        add("center", center);
        radiusHandle(area.center, area.radius, shape as L.Circle, (r) => live.current.onArea?.(target, { center: area.center, radius: r }));
        return;
      }
      const pts = area.polygon;
      pts.forEach((p, i) => {
        const v = L.marker(ll(p), { icon: handleIcon("vertex"), draggable: true, keyboard: true, title: `Ecke ${i + 1} von ${pts.length} – ziehen, Pfeiltasten, Entf löscht`, zIndexOffset: 1500 });
        v.on("drag", () => (shape as L.Polygon).setLatLngs(pts.map((q, j) => (j === i ? v.getLatLng() : ll(q)))));
        v.on("dragend", () => live.current.onArea?.(target, { polygon: pts.map((q, j) => (j === i ? pt(v.getLatLng()) : q)) }));
        add(`vertex:${i}`, v);
        const next = pts[(i + 1) % pts.length]!;
        const mid = { lat: (p.lat + next.lat) / 2, lon: (p.lon + next.lon) / 2 };
        const mm = L.marker(ll(mid), { icon: handleIcon("midpoint"), keyboard: true, title: "Ecke hier einfügen", zIndexOffset: 1400 });
        mm.on("click", () => live.current.onArea?.(target, { polygon: [...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)] }));
        add(`mid:${i}`, mm);
      });
    }

    // Neue Station und Vieleck im Entstehen
    if (pending) {
      add(
        "pending",
        L.marker(ll(pending), {
          icon: L.divIcon({ className: "mk-station ed-station pending", html: "<span>+</span>", iconSize: [28, 28], iconAnchor: [14, 14] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 2000,
        }),
      );
    }
    if (drawing?.length) {
      L.polyline(drawing.map(ll), { className: "lf-draw", interactive: false }).addTo(g);
      drawing.forEach((p, i) => add(`draw:${i}`, L.marker(ll(p), { icon: handleIcon(`vertex drawn${i === 0 ? " first" : ""}`), interactive: false, keyboard: false })));
    }
    // Eigene Position
    if (me && isPoint(me.point)) {
      L.circle(ll(me.point), { radius: me.accuracy, className: "lf-accuracy lf-me", interactive: false }).addTo(g);
      add(
        "me",
        L.marker(ll(me.point), {
          icon: L.divIcon({ className: "mk-me", html: "<span></span>", iconSize: [18, 18], iconAnchor: [9, 9] }),
          title: `Dein Standort (± ${Math.round(me.accuracy)} m)`,
          keyboard: false,
          interactive: false,
          zIndexOffset: 2500,
        }),
      );
    }

    // Der Fokus bleibt auf dem Marker, auch wenn er neu gezeichnet wurde.
    if (focusKey)
      keyed
        .find(([k]) => k === focusKey)?.[1]
        .getElement()
        ?.focus({ preventScroll: true });
    if (!fitted.current) {
      const b = gameBounds(game);
      // Der Rahmen hat seine Größe oft erst einen Augenblick nach dem ersten Zeichnen (nachgeladen, Layout).
      const fit = () => {
        if (!map.current || !b) return;
        m.invalidateSize();
        m.fitBounds(b, { padding: [24, 24], maxZoom: 18 });
      };
      fit();
      if (b) setTimeout(fit, 250);
      fitted.current = true;
    }
  }, [game, meta, issues, dismissed, selection, tool, drawing, pending, layers, me, readOnly]);

  useEffect(() => {
    const f = props.focus;
    if (f && map.current) map.current.setView(ll(f.point), f.zoom ?? Math.max(map.current.getZoom(), 17));
  }, [props.focus?.key]);

  /** Ecken und Mitte mit der Tastatur; alles andere entscheidet der Bereich. */
  const onKeyDown = (e: KeyboardEvent) => {
    const p = live.current;
    const key = (e.target as HTMLElement | null)?.closest?.("[data-map-key]")?.getAttribute("data-map-key") ?? "";
    const sel = p.selection;
    const area: Area | undefined = sel?.kind === "boundary" ? p.game.field?.boundary : sel?.kind === "zone" ? p.game.field?.restrictedZones?.find((z) => z?.id === sel.id)?.area : undefined;
    const target: AreaTarget | null = sel?.kind === "boundary" ? { kind: "boundary" } : sel?.kind === "zone" ? { kind: "zone", id: sel.id } : null;
    const vertex = /^vertex:(\d+)$/.exec(key);
    if (target && isArea(area) && (vertex || key === "center")) {
      const n = nudgeOf(e.key, e.shiftKey);
      if (n && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if ("center" in area) p.onArea?.(target, { ...area, center: offsetPoint(area.center, n.dx, n.dy) });
        else if (vertex) p.onArea?.(target, { polygon: area.polygon.map((q, j) => (j === Number(vertex[1]) ? offsetPoint(q, n.dx, n.dy) : q)) });
        return;
      }
      if (vertex && "polygon" in area && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        e.stopPropagation();
        if (area.polygon.length > 3) p.onArea?.(target, { polygon: area.polygon.filter((_, j) => j !== Number(vertex[1])) });
        return;
      }
    }
    if (/^mid:\d+$/.test(key) && (e.key === "Enter" || e.key === " ")) return;
    p.onKeyDown?.(e);
  };

  return (
    <div class={`map-wrap ed-map-wrap${props.class ? ` ${props.class}` : ""}${tool && tool.kind !== "select" ? " drawing" : ""}`}>
      <div dangerouslySetInnerHTML={{ __html: TAPE_DEFS }} />
      <div ref={el} class="map" role="region" aria-label={props.label} aria-describedby={props.describedBy} onKeyDown={onKeyDown} />
    </div>
  );
}

export function selectionKey(s: Selection | null): string | null {
  if (!s) return null;
  switch (s.kind) {
    case "station":
      return `station:${s.id}`;
    case "zone":
      return `zone:${s.id}`;
    case "boundary":
      return "boundary";
    case "point":
      return s.index === undefined ? `point:${s.point}` : `point:${s.point}:${s.index}`;
  }
}
