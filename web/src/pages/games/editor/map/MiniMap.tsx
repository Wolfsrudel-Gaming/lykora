/**
 * Paket B: Kleine Karte für einen Punkt – Ort der Station (C), Zielort von „Ort finden“ (C),
 * Regelort (D). Klick setzt den Punkt, der Marker lässt sich ziehen (ein Schreiben je Zug) und mit
 * den Pfeiltasten schieben (1 m, Umschalt 10 m); mit radius/onRadius gibt es Kreis und Radius-Griff
 * in 5-m-Schritten. Spielfeld, Sperrzonen und die übrigen Stationen stehen blass dahinter.
 * Mit `coordinates` steht das Koordinatenfeld darunter (Weg ohne Karte); sonst bringt es der Aufrufer selbst mit.
 */

import { useEffect, useId, useRef, useState } from "preact/hooks";
import { distanceM, isArea, isPoint, offsetPoint, roundRadius } from "../../../../lib/editor/geo.ts";
import { editor } from "../../../../lib/editor/store.ts";
import type { EditorIssue, Game, Point } from "../../../../lib/editor/types.ts";
import { useStore } from "../../../../lib/store.ts";
import { nudgeOf } from "./actions.ts";
import { CoordinateInput } from "./CoordinateInput.tsx";
import { L, TAPE_DEFS, baseMap, drawArea, gameBounds, handleIcon, ll, pt } from "./leaflet.ts";

export interface MiniMapProps {
  value?: Point;
  onChange: (p: Point) => void;
  /** Radius in Metern (Kreis um den Punkt) */
  radius?: number;
  onRadius?: (r: number) => void;
  /** Beschriftung der Karte und des Koordinatenfelds */
  label?: string;
  /** data-feld des Koordinatenfelds (Sprungziel), Standard "location" */
  feld?: string;
  issues?: EditorIssue[];
  /** Koordinatenfeld darunter (Standard nein – CoordinateInput gibt es auch einzeln) */
  coordinates?: boolean;
  /** eine Station, die nicht blass dahinter steht (die bearbeitete) */
  stationId?: string;
  onBlur?: () => void;
}

/** Spiel des geöffneten Baukastens, falls es einen gibt; zeichnet nur bei neuem Spielobjekt neu. */
function useContextGame(): Game | null {
  const { current } = useStore(editor);
  const [game, setGame] = useState<Game | null>(() => current?.get().game ?? null);
  useEffect(() => {
    if (!current) return setGame(null);
    setGame(current.get().game);
    let last = current.get().game;
    return current.subscribe((s) => {
      if (s.game !== last) setGame((last = s.game));
    });
  }, [current]);
  return game;
}

export function MiniMap({ value, onChange, radius, onRadius, label = "Ort", feld = "location", issues = [], coordinates = false, stationId, onBlur }: MiniMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ context: L.LayerGroup; point: L.LayerGroup } | null>(null);
  const live = useRef({ onChange, onRadius, value, radius });
  live.current = { onChange, onRadius, value, radius };
  const game = useContextGame();
  const helpId = useId();
  const centered = useRef(false);

  useEffect(() => {
    const { map: m, dispose } = baseMap(el.current!, { keyboard: true, scrollWheelZoom: "center" });
    layers.current = { context: L.layerGroup().addTo(m), point: L.layerGroup().addTo(m) };
    m.on("click", (e: L.LeafletMouseEvent) => live.current.onChange(pt(e.latlng)));
    map.current = m;
    return () => {
      dispose();
      map.current = null;
      layers.current = null;
    };
  }, []);

  // Blasser Hintergrund: Spielfeld, Sperrzonen, andere Stationen
  useEffect(() => {
    const g = layers.current?.context;
    if (!g) return;
    g.clearLayers();
    if (!game) return;
    if (isArea(game.field?.boundary)) drawArea(game.field.boundary, { className: "lf-boundary", fill: false, interactive: false }).addTo(g);
    for (const z of game.field?.restrictedZones ?? []) if (z && isArea(z.area)) drawArea(z.area, { className: "lf-zone", interactive: false }).addTo(g);
    (game.stations ?? []).forEach((s, i) => {
      if (!s?.id || s.id === stationId || !isPoint(s.location)) return;
      L.marker(ll(s.location), {
        icon: L.divIcon({ className: "mk-station ed-station faint", html: `<span>${s.final ? "★" : i + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false,
        keyboard: false,
      }).addTo(g);
    });
    if (!centered.current && !value) {
      const b = gameBounds(game);
      if (b) map.current?.fitBounds(b, { padding: [12, 12], maxZoom: 17 });
    }
  }, [game, stationId]);

  // Der Punkt mit Kreis und Radius-Griff
  useEffect(() => {
    const m = map.current;
    const g = layers.current?.point;
    if (!m || !g) return;
    const focused = !!(document.activeElement as HTMLElement | null)?.closest?.(".mk-mini");
    g.clearLayers();
    if (!value || !isPoint(value)) return;
    const circle = radius ? L.circle(ll(value), { radius, className: "lf-gps selected", interactive: false }).addTo(g) : null;
    const marker = L.marker(ll(value), {
      icon: L.divIcon({ className: "mk-station ed-station selected mk-mini", html: "<span>◎</span>", iconSize: [28, 28], iconAnchor: [14, 14] }),
      draggable: true,
      keyboard: true,
      title: `${label} – ziehen oder mit den Pfeiltasten schieben`,
      alt: label,
      zIndexOffset: 1000,
    }).addTo(g);
    marker.on("drag", () => circle?.setLatLng(marker.getLatLng()));
    marker.on("dragend", () => live.current.onChange(pt(marker.getLatLng())));
    if (circle && radius && onRadius) {
      const handle = L.marker(ll(offsetPoint(value, radius, 0)), { icon: handleIcon("radius", `${radius} m`), draggable: true, keyboard: false, title: "Radius ziehen", zIndexOffset: 1500 }).addTo(g);
      handle.on("drag", () => {
        const r = roundRadius(distanceM(value, pt(handle.getLatLng())));
        circle.setRadius(r);
        const text = handle.getElement()?.querySelector(".mk-handle-label");
        if (text) text.textContent = `${r} m`;
      });
      handle.on("dragend", () => live.current.onRadius?.(roundRadius(distanceM(value, pt(handle.getLatLng())))));
    }
    if (focused) marker.getElement()?.focus({ preventScroll: true });
    if (!centered.current) {
      m.setView(ll(value), 17);
      centered.current = true;
    } else if (!m.getBounds().contains(ll(value))) m.panTo(ll(value));
  }, [value?.lat, value?.lon, radius, !!onRadius]);

  const onKeyDown = (e: KeyboardEvent) => {
    const v = live.current.value;
    if (!v || !(e.target as HTMLElement | null)?.closest?.(".mk-mini")) return;
    const n = nudgeOf(e.key, e.shiftKey);
    if (!n || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    live.current.onChange(offsetPoint(v, n.dx, n.dy));
  };

  return (
    <div class="ed-minimap stack tight">
      <div class="map-wrap ed-map-wrap mini">
        <div dangerouslySetInnerHTML={{ __html: TAPE_DEFS }} />
        <div ref={el} class="map" role="region" aria-label={`Karte: ${label}`} aria-describedby={helpId} onKeyDown={onKeyDown} />
      </div>
      <small id={helpId} class="muted">
        Klick in die Karte setzt den Punkt. Der Marker lässt sich ziehen oder mit den Pfeiltasten schieben (1 m, mit Umschalt 10 m).
        {onRadius ? " Der Griff am Kreis ändert den Radius in 5-m-Schritten." : ""}
      </small>
      {coordinates && (
        <CoordinateInput value={value} onChange={onChange} label={label} feld={feld} issues={issues} onBlur={onBlur} onShow={value ? () => map.current?.setView(ll(value), 18) : undefined} />
      )}
    </div>
  );
}
