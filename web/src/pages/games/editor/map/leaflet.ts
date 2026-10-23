/**
 * Paket B: Gemeinsame Leaflet-Teile für Karte, Mini-Karte und Vor-Ort-Modus – Grundkarte mit
 * OSM-Kacheln wie im Leitstand (MapView.tsx), Flächen, Marker-Symbole und das Absperrband-Muster.
 * Farben kommen über Klassen aus den Tokens (map.css, editor-map.css), nie als Werte im Code.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../../../control/map.css";
import "./editor-map.css";
import { areaBounds } from "../../../../lib/game.ts";
import { editor } from "../../../../lib/editor/store.ts";
import { setBaseTiles } from "../../../../lib/map-tiles.ts";
import { isArea, isPoint, type Area } from "../../../../lib/editor/geo.ts";
import type { Game, Point } from "../../../../lib/editor/types.ts";

export { L };

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const ll = (p: Point): L.LatLngTuple => [p.lat, p.lon];
export const pt = (l: L.LatLng): Point => ({ lat: l.lat, lon: l.lng });

/** Grundkarte: Kacheln nach settings.map.tiles des offenen Spiels (sonst OSM), Zuschreibung, Größe folgt dem Layout. Liefert die Karte und das Aufräumen. */
export function baseMap(el: HTMLElement, opts: L.MapOptions = {}): { map: L.Map; dispose: () => void } {
  // Viertelstufen, damit ein Spielfeld auch in kleinen Rahmen den Platz füllt.
  const map = L.map(el, { zoomControl: true, attributionControl: true, minZoom: 3, maxZoom: 19, zoomSnap: 0.25, ...opts });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  const store = editor.get().current;
  const tilesOf = (game: Game | undefined) => game?.settings?.map?.tiles;
  setBaseTiles(map, tilesOf(store?.get().game));
  // Eine Änderung im Experten-Feld wirkt sofort; bei gleichem Wert passiert nichts.
  const offTiles = store?.subscribe((st) => setBaseTiles(map, tilesOf(st.game)));
  map.setView([51.16, 10.45], 6);
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.invalidateSize());
  ro?.observe(el);
  return {
    map,
    dispose: () => {
      offTiles?.();
      ro?.disconnect();
      map.remove();
    },
  };
}

export function drawArea(area: Area, options: L.PathOptions): L.Path {
  return "polygon" in area ? L.polygon(area.polygon.map(ll), options) : L.circle(ll(area.center), { ...options, radius: area.radius });
}

/** Ausschnitt für das ganze Spiel: Spielfeld, sonst Stationen und Sammelpunkt. */
export function gameBounds(game: Game | null | undefined): L.LatLngBounds | null {
  if (!game) return null;
  if (isArea(game.field?.boundary)) return L.latLngBounds(areaBounds(game.field.boundary));
  const pts: L.LatLngTuple[] = [];
  for (const s of game.stations ?? []) if (isPoint(s?.location)) pts.push(ll(s.location));
  if (isPoint(game.field?.assemblyPoint?.location)) pts.push(ll(game.field.assemblyPoint.location));
  return pts.length ? L.latLngBounds(pts) : null;
}

/** Absperrband als SVG-Muster für Sperrzonen (Farben aus --tape-a/--tape-b über editor-map.css). */
export const TAPE_DEFS =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><pattern id="lyk-tape" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="tape-a" width="8" height="16"/><rect class="tape-b" x="8" width="8" height="16"/></pattern></defs></svg>';

// Symbole der Punkte; Füllung und Kante setzt editor-map.css (Rettungsgrün, weiße Kante).
export const ASSEMBLY_SVG =
  '<svg viewBox="0 0 28 28" aria-hidden="true"><rect class="bg" width="28" height="28" rx="3"/><path class="fg" d="M14 5v5M14 18v5M5 14h5M18 14h5M11 8l3-3 3 3M11 20l3 3 3-3M8 11l-3 3 3 3M20 11l3 3-3 3" fill="none"/><circle class="dot" cx="14" cy="14" r="2.5"/></svg>';
export const RESCUE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="bg" width="24" height="24" rx="3"/><path class="fg thick" d="M12 6v12M6 12h12"/></svg>';
export const SUPPLY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="bg" width="24" height="24" rx="12"/><path class="fg" d="M8 9h8l-1 9H9zM10 9V7h4v2" fill="none"/></svg>';
export const START_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="bg" width="24" height="24" rx="3"/><path class="fg" d="M8 19V5l9 4-9 4" fill="none"/></svg>';

/** divIcon für einen Punkt mit Symbol. */
export function pointIcon(cls: string, svg: string, size = 26): L.DivIcon {
  return L.divIcon({ className: cls, html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

/** Griff zum Ziehen (Ecke, Mittelpunkt, Radius). */
export function handleIcon(cls: string, label = ""): L.DivIcon {
  return L.divIcon({ className: `mk-handle ${cls}`, html: label ? `<span class="mk-handle-label">${esc(label)}</span>` : "", iconSize: [16, 16], iconAnchor: [8, 8] });
}
