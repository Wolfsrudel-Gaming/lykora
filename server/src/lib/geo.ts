import type { Area, Point } from "@lykora/spec";

const EARTH_RADIUS = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Abstand zweier Punkte in Metern (Haversine). */
export function distance(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Lokale ebene Projektion in Metern um einen Bezugspunkt; reicht für Spielfelder von wenigen Kilometern.
function project(origin: Point, p: Point): [number, number] {
  return [rad(p.lon - origin.lon) * EARTH_RADIUS * Math.cos(rad(origin.lat)), rad(p.lat - origin.lat) * EARTH_RADIUS];
}

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Abstand eines Punkts zu einer Fläche in Metern; 0, wenn er darin liegt. */
export function distanceToArea(p: Point, area: Area): number {
  if ("center" in area) return Math.max(0, distance(p, area.center) - area.radius);
  if (insidePolygon(p, area.polygon)) return 0;
  const pp = project(p, p);
  let best = Infinity;
  const pts = area.polygon.map((q) => project(p, q));
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, segmentDistance(pp, pts[i]!, pts[(i + 1) % pts.length]!));
  }
  return best;
}
