/**
 * Paket B: Rechnen auf der Karte des Baukastens – Abstände, Richtung, Verschieben um Meter,
 * Punkt in Fläche, Abstand zur Fläche, Koordinaten lesen und schreiben (dezimal und
 * Grad/Minuten/Sekunden), GPS-Messungen mitteln. Für Spielfelder von wenigen Kilometern reicht
 * eine ebene Näherung um einen Bezugspunkt; Abstände zwischen zwei Punkten rechnen mit Haversine.
 */

import type { Game, Point, Station } from "./types.ts";

export type Area = Game["field"]["boundary"];

export const EARTH_M = 6_371_000;
const RAD = Math.PI / 180;
/** Meter je Grad Breite auf der Kugel mit EARTH_M */
export const M_PER_DEG = EARTH_M * RAD;

/** Punkt mit endlichen Koordinaten (Entwürfe dürfen Lücken haben). */
export function isPoint(p: unknown): p is Point {
  const q = p as Point | null | undefined;
  return !!q && typeof q === "object" && Number.isFinite(q.lat) && Number.isFinite(q.lon);
}

/** Fläche, mit der sich rechnen lässt: Vieleck mit mindestens 3 Ecken oder Kreis mit Radius. */
export function isArea(a: unknown): a is Area {
  const x = a as Record<string, unknown> | null | undefined;
  if (!x || typeof x !== "object") return false;
  if (Array.isArray(x.polygon)) return x.polygon.length >= 3 && x.polygon.every(isPoint);
  return isPoint(x.center) && typeof x.radius === "number" && x.radius > 0;
}

/** Luftlinie in Metern (Haversine). */
export function distanceM(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Richtung von a nach b in Grad (0 = Nord, 90 = Ost). */
export function bearing(a: Point, b: Point): number {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

/** Himmelsrichtung in acht Stufen, deutsch abgekürzt („NO“). */
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** Punkt um dx Meter nach Osten und dy Meter nach Norden verschoben. */
export function offsetPoint(p: Point, dx: number, dy: number): Point {
  const lat = p.lat + dy / M_PER_DEG;
  const lon = p.lon + dx / (M_PER_DEG * Math.cos(p.lat * RAD));
  return { lat: round7(lat), lon: round7(lon) };
}

/** Sieben Nachkommastellen (≈ 1 cm) – mehr schreibt der Baukasten nicht ins Spiel. */
export function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

/** Ebene Näherung in Metern um einen Bezugspunkt (x nach Osten, y nach Norden). */
function local(origin: Point, p: Point): { x: number; y: number } {
  return { x: (p.lon - origin.lon) * M_PER_DEG * Math.cos(origin.lat * RAD), y: (p.lat - origin.lat) * M_PER_DEG };
}

/** Abstand eines Punkts zur Strecke a–b in der Ebene. */
function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Liegt p in der Fläche? Der Rand (bis 0,5 m) zählt dazu. */
export function insideArea(p: Point, area: Area): boolean {
  if (!isArea(area) || !isPoint(p)) return false;
  if ("center" in area) return distanceM(area.center, p) <= area.radius + 0.5;
  const pts = area.polygon.map((q) => local(p, q));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (segmentDistance({ x: 0, y: 0 }, a, b) <= 0.5) return true;
    if (a.y > 0 !== b.y > 0 && 0 < ((b.x - a.x) * (0 - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Abstand in Metern bis zum Rand der Fläche; 0 innen. */
export function distanceToArea(p: Point, area: Area): number {
  if (!isArea(area) || !isPoint(p)) return Infinity;
  if (insideArea(p, area)) return 0;
  if ("center" in area) return Math.max(0, distanceM(area.center, p) - area.radius);
  const pts = area.polygon.map((q) => local(p, q));
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) best = Math.min(best, segmentDistance({ x: 0, y: 0 }, pts[i]!, pts[j]!));
  return best;
}

/** Schwerpunkt eines Vielecks (Flächenschwerpunkt; bei entarteten Flächen der Mittelwert der Ecken). */
export function polygonCentroid(points: Point[]): Point | null {
  const pts = points.filter(isPoint);
  if (!pts.length) return null;
  const origin = pts[0]!;
  const xy = pts.map((q) => local(origin, q));
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const f = xy[j]!.x * xy[i]!.y - xy[i]!.x * xy[j]!.y;
    a += f;
    cx += (xy[j]!.x + xy[i]!.x) * f;
    cy += (xy[j]!.y + xy[i]!.y) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const lat = pts.reduce((s, q) => s + q.lat, 0) / pts.length;
    const lon = pts.reduce((s, q) => s + q.lon, 0) / pts.length;
    return { lat: round7(lat), lon: round7(lon) };
  }
  return offsetPoint(origin, cx / (3 * a), cy / (3 * a));
}

/** Mitte einer Fläche (Kreismitte oder Schwerpunkt). */
export function areaCenter(area: unknown): Point | null {
  const x = area as Record<string, unknown> | null | undefined;
  if (!x || typeof x !== "object") return null;
  if (isPoint(x.center)) return x.center;
  return Array.isArray(x.polygon) ? polygonCentroid(x.polygon as Point[]) : null;
}

/** Ganze 5-Meter-Schritte, mindestens 5 m (Radius-Griff). */
export function roundRadius(m: number): number {
  return Math.max(5, Math.round(m / 5) * 5);
}

/** Ort einer Station für Karte und Prüfung: eigener Ort, sonst der Ort des GPS-Auslösers. */
export function stationPoint(s: Station | null | undefined): Point | null {
  if (!s || typeof s !== "object") return null;
  if (isPoint(s.location)) return s.location;
  const gps = gpsTrigger(s);
  return gps && isPoint(gps.location) ? gps.location : null;
}

type Gps = Extract<Station["triggers"][number], { type: "gps" }>;

export function gpsTrigger(s: Station | null | undefined): Gps | null {
  if (!s || !Array.isArray(s.triggers)) return null;
  return (s.triggers.find((t) => t && typeof t === "object" && t.type === "gps") as Gps | undefined) ?? null;
}

/** Standardradius des GPS-Auslösers laut Format. */
export const GPS_RADIUS_DEFAULT = 20;

/** Wo der GPS-Auslöser auslöst und wie weit: eigener Ort des Auslösers vor dem Ort der Station. */
export function gpsCircle(s: Station | null | undefined): { center: Point; radius: number } | null {
  const gps = gpsTrigger(s);
  if (!gps) return null;
  const center = isPoint(gps.location) ? gps.location : isPoint(s?.location) ? s!.location! : null;
  if (!center) return null;
  return { center, radius: typeof gps.radius === "number" && gps.radius > 0 ? gps.radius : GPS_RADIUS_DEFAULT };
}

// Koordinaten lesen und schreiben

/** Anzeige mit 5 Nachkommastellen (≈ 1 m), wie im Leitstand. */
export function formatPoint(p: Point): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

function dms(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round(((abs - d) * 60 - m) * 600) / 10;
  if (s >= 60) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}° ${m}′ ${s.toFixed(1).replace(".", ",")}″ ${value < 0 ? neg : pos}`;
}

/** Grad, Minuten, Sekunden: „50° 48′ 55,8″ N, 7° 9′ 18,0″ O“. */
export function formatDms(p: Point): string {
  return `${dms(p.lat, "N", "S")}, ${dms(p.lon, "O", "W")}`;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const DECIMAL = new RegExp(String.raw`^\s*(-?\d+(?:[.,]\d+)?)\s*(?:[,;]\s*|\s+)(-?\d+(?:[.,]\d+)?)\s*$`);
const DMS = new RegExp(String.raw`([NSEOW])?\s*${NUM}\s*°\s*(?:${NUM}\s*['′’]\s*)?(?:${NUM}\s*(?:["″”]|'')\s*)?([NSEOW])?`, "gi");
const num = (s: string | undefined) => (s ? Number(s.replace(",", ".")) : 0);

/**
 * Koordinaten aus einer Eingabe: „50.8155, 7.155“, „50,8155; 7,155“, „50.8155 7.155“ oder
 * Grad/Minuten/Sekunden („50°48'55.8"N 7°9'18"E“, „N 50° 48.93' O 7° 9.3'“). Unlesbar → null.
 */
export function parseCoordinates(raw: string): Point | null {
  const text = raw.trim();
  if (!text) return null;
  const dec = DECIMAL.exec(text);
  let p: Point | null = null;
  if (dec) p = { lat: num(dec[1]), lon: num(dec[2]) };
  else if (text.includes("°")) {
    const parts = [...text.matchAll(DMS)].filter((m) => m[2]);
    if (parts.length !== 2) return null;
    const values = parts.map((m) => {
      const hemi = (m[1] ?? m[5] ?? "").toUpperCase();
      const v = num(m[2]) + num(m[3]) / 60 + num(m[4]) / 3600;
      return { v: hemi === "S" || hemi === "W" ? -v : v, hemi };
    });
    // Mit Himmelsrichtung entscheidet sie, ohne die Reihenfolge Breite, Länge.
    const lat = values.find((x) => x.hemi === "N" || x.hemi === "S") ?? values[0]!;
    const lon = values.find((x) => x !== lat)!;
    p = { lat: lat.v, lon: lon.v };
  }
  if (!p || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  return { lat: round7(p.lat), lon: round7(p.lon) };
}

// GPS vor Ort

export interface Fix {
  lat: number;
  lon: number;
  /** Genauigkeit in Metern (Radius) */
  accuracy: number;
}

/**
 * Mittelt Messungen (UX §18): Messungen, die mehr als doppelt so ungenau sind wie die beste,
 * fallen weg; Ergebnis ist der Mittelwert der übrigen und als Genauigkeit die beste Messung.
 */
export function averageFixes(fixes: Fix[]): { point: Point; accuracy: number; used: number; total: number } | null {
  const valid = fixes.filter((f) => isPoint(f) && Number.isFinite(f.accuracy) && f.accuracy >= 0);
  if (!valid.length) return null;
  const best = Math.min(...valid.map((f) => f.accuracy));
  const used = valid.filter((f) => f.accuracy <= 2 * Math.max(best, 1));
  const lat = used.reduce((s, f) => s + f.lat, 0) / used.length;
  const lon = used.reduce((s, f) => s + f.lon, 0) / used.length;
  return { point: { lat: round7(lat), lon: round7(lon) }, accuracy: Math.round(best), used: used.length, total: fixes.length };
}

/** Balken (1–4) und Wort zur Genauigkeit; Farbe ist nur Zusatz. */
export function accuracyLevel(accuracy: number): { bars: 1 | 2 | 3 | 4; word: string } {
  if (accuracy <= 8) return { bars: 4, word: "sehr gut" };
  if (accuracy <= 15) return { bars: 3, word: "gut" };
  if (accuracy <= 30) return { bars: 2, word: "mäßig – kurz warten" };
  return { bars: 1, word: "zu ungenau" };
}

/** Abstand lesbar: „37 m“, „1,2 km“. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "–";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}
