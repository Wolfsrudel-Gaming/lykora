/**
 * Grundkarte für Leaflet nach settings.map.tiles des Spiels (Auflösung der Adresse: tiles.ts).
 * Leitstand und Baukasten rufen setBaseTiles bei jeder Änderung auf; derselbe Wert tut nichts.
 */

import L from "leaflet";
import { base } from "./base.ts";
import { resolveTiles } from "./tiles.ts";

/** Durchsichtiges 1×1-Bild für fehlende Kacheln, sonst zeigt der Browser ein kaputtes Bild. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** Das mitgelieferte Paket hat Stufe 18 nur nahe dem Mittelpunkt (tool/map_pack.py), Stufe 17 im ganzen Gebiet. */
const OWN_NATIVE_ZOOM = 18;
const OWN_FALLBACK_ZOOM = 17;

const applied = new WeakMap<L.Map, { key: string; layers: L.Layer[] }>();

export function setBaseTiles(map: L.Map, value: unknown): void {
  const src = resolveTiles(value, base());
  const key = `${src.own ? "own" : "web"}|${src.url}`;
  const prev = applied.get(map);
  if (prev?.key === key) return;
  for (const l of prev?.layers ?? []) l.remove();
  const layers: L.Layer[] = src.own
    ? [
        // Unten die Stufe 17 für den Rand, oben die feinste Stufe, wo es sie gibt; fehlende Kacheln bleiben leer.
        L.tileLayer(src.url, { maxZoom: 19, maxNativeZoom: OWN_FALLBACK_ZOOM, attribution: src.attribution, errorTileUrl: BLANK }),
        L.tileLayer(src.url, { maxZoom: 19, maxNativeZoom: OWN_NATIVE_ZOOM, errorTileUrl: BLANK }),
      ]
    : [L.tileLayer(src.url, { maxZoom: 19, attribution: src.attribution })];
  for (const l of layers) l.addTo(map);
  applied.set(map, { key, layers });
}
