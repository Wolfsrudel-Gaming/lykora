/**
 * Kartenkacheln eines Spiels: settings.map.tiles als Vorlage mit {z}/{x}/{y}.
 * Eine Adresse ohne Schema ist relativ zum Server („tiles/sieglar/{z}/{x}/{y}.png“, wie media[].src);
 * fehlt der Wert oder ist er nicht brauchbar (PMTiles, fremdes Schema, unbekannte Platzhalter), gilt OpenStreetMap.
 */

import { serverUrl, type Base } from "./base.ts";

export const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Zuschreibung, die in jeder Karte sichtbar bleiben muss (ODbL); die Kacheln des Servers stammen von OpenStreetMap. */
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

export interface TileSource {
  /** Vorlage mit {z}/{x}/{y}, absolut oder ab der Wurzel des Servers */
  url: string;
  /** HTML für die Zuschreibung der Karte */
  attribution: string;
  /** Kacheln des eigenen Servers (Kartenpaket, nur ein kleines Gebiet und wenige Zoomstufen) */
  own: boolean;
}

/** Platzhalter, die Leaflet füllt; jeder andere Platzhalter würde dort einen Fehler werfen. */
const PLACEHOLDERS = /\{([^}]*)\}/g;

const DEFAULT: TileSource = { url: OSM_TILES, attribution: OSM_ATTRIBUTION, own: false };

export function resolveTiles(value: unknown, base: Base): TileSource {
  if (typeof value !== "string") return DEFAULT;
  const raw = value.trim();
  if (!raw) return DEFAULT;
  const names = [...raw.matchAll(PLACEHOLDERS)].map((m) => m[1]);
  if (!["z", "x", "y"].every((n) => names.includes(n)) || names.some((n) => !["z", "x", "y"].includes(n!))) return DEFAULT;
  if (/^https?:\/\//i.test(raw)) {
    const own = raw.startsWith(`${serverUrl(base)}/tiles/`);
    return { url: raw, attribution: OSM_ATTRIBUTION, own };
  }
  // Jedes andere Schema (javascript:, data:, file:) und protokollrelative Adressen scheiden aus.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return DEFAULT;
  return { url: base.path + raw.replace(/^\/+/, ""), attribution: OSM_ATTRIBUTION, own: true };
}
