/**
 * Paket E: Karte im Schritt „Ort“ des Assistenten. Klick setzt den Sammelpunkt, der Marker lässt
 * sich ziehen und mit den Pfeiltasten schieben (1 m, Umschalt 10 m). Das Spielfeld steht als Kreis
 * darum, die Stationen der Vorlage blass an ihrem künftigen Platz; der Ausschnitt folgt dem Spielfeld.
 * Lädt Leaflet; der Assistent holt die Datei erst in diesem Schritt.
 */

import { useEffect, useId, useRef } from "preact/hooks";
import { offsetPoint } from "../../../../lib/editor/geo.ts";
import type { Point } from "../../../../lib/editor/types.ts";
import { nudgeOf } from "../map/actions.ts";
import { ASSEMBLY_SVG, L, baseMap, ll, pointIcon, pt } from "../map/leaflet.ts";

export interface PlaceMapProps {
  place: Point | null;
  radius: number;
  /** Stationen der Vorlage am gewählten Ort, mit Nummer oder ★ */
  stations: { point: Point; label: string }[];
  onPlace: (p: Point) => void;
}

export function PlaceMap({ place, radius, stations, onPlace }: PlaceMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const live = useRef({ onPlace, place });
  live.current = { onPlace, place };
  const helpId = useId();

  useEffect(() => {
    const { map: m, dispose } = baseMap(el.current!, { keyboard: true, scrollWheelZoom: "center" });
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => live.current.onPlace(pt(e.latlng)));
    map.current = m;
    return () => {
      dispose();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Spielfeld, Stationen und Sammelpunkt; der Ausschnitt zeigt das ganze Spielfeld.
  const key = stations.map((s) => `${s.point.lat},${s.point.lon}`).join(";");
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    const focused = !!(document.activeElement as HTMLElement | null)?.closest?.(".mk-assembly");
    g.clearLayers();
    if (!place) return;
    const circle = L.circle(ll(place), { radius, className: "lf-boundary", fill: false, interactive: false }).addTo(g);
    for (const s of stations) {
      L.marker(ll(s.point), {
        icon: L.divIcon({ className: "mk-station ed-station faint", html: `<span>${s.label}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false,
        keyboard: false,
      }).addTo(g);
    }
    const marker = L.marker(ll(place), {
      icon: pointIcon("mk-assembly selected", ASSEMBLY_SVG, 28),
      draggable: true,
      keyboard: true,
      title: "Sammelpunkt – ziehen oder mit den Pfeiltasten schieben",
      alt: "Sammelpunkt",
      zIndexOffset: 1000,
    }).addTo(g);
    marker.on("dragend", () => live.current.onPlace(pt(marker.getLatLng())));
    if (focused) marker.getElement()?.focus({ preventScroll: true });
    m.fitBounds(circle.getBounds(), { padding: [16, 16], animate: false });
  }, [place?.lat, place?.lon, radius, key]);

  const onKeyDown = (e: KeyboardEvent) => {
    const p = live.current.place;
    if (!p || !(e.target as HTMLElement | null)?.closest?.(".mk-assembly")) return;
    const n = nudgeOf(e.key, e.shiftKey);
    if (!n || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    live.current.onPlace(offsetPoint(p, n.dx, n.dy));
  };

  return (
    <div class="stack tight">
      <div class="map-wrap ed-map-wrap wizard-map">
        <div ref={el} class="map" role="region" aria-label="Karte: Sammelpunkt und Spielfeld" aria-describedby={helpId} onKeyDown={onKeyDown} />
      </div>
      <small id={helpId} class="muted">
        Klick in die Karte setzt den Sammelpunkt. Der Marker lässt sich ziehen oder mit den Pfeiltasten schieben (1 m, mit Umschalt 10 m). Die blassen Nummern sind die Stationen der Vorlage.
      </small>
    </div>
  );
}
