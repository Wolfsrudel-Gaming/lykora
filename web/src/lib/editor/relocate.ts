/**
 * Paket E: Umzug eines Spiels an einen anderen Ort. Vorlagen liegen am Bezugsort (Sammelpunkt in
 * Hennef, Spielfeld 300 m); der Assistent verschiebt alle Orte an den gewählten Sammelpunkt und
 * streckt die Abstände auf den gewählten Radius. Abstände in Metern bleiben erhalten, weil die Länge
 * mit dem Kosinus der Breite am alten und am neuen Ort umgerechnet wird.
 */

import { joinPointer } from "./paths.ts";
import type { Game, JsonPointer, Point } from "./types.ts";

export const TEMPLATE_ORIGIN: Point = { lat: 50.8155, lon: 7.155 };
export const TEMPLATE_RADIUS = 300;

type Json = Record<string, unknown>;

const isPoint = (p: unknown): p is Point => !!p && typeof p === "object" && typeof (p as Point).lat === "number" && typeof (p as Point).lon === "number";
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const obj = (x: unknown): Json | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : null);

/** Alle Orte im Spiel mit Pfad: Spielfeld, Start, Sammelpunkt, Zonen, Punkte, Stationen, Auslöser, „Ort finden“, Regelorte. */
export function allPoints(game: Game): { path: JsonPointer; point: Point }[] {
  const out: { path: JsonPointer; point: Point }[] = [];
  const add = (value: unknown, ...path: (string | number)[]) => {
    if (isPoint(value)) out.push({ path: joinPointer(path), point: value });
  };
  const area = (value: unknown, ...path: (string | number)[]) => {
    const a = obj(value);
    if (!a) return;
    add(a.center, ...path, "center");
    list(a.polygon).forEach((p, k) => add(p, ...path, "polygon", k));
  };
  const field = obj(game?.field);
  if (field) {
    area(field.boundary, "field", "boundary");
    add(field.start, "field", "start");
    add(obj(field.assemblyPoint)?.location, "field", "assemblyPoint", "location");
    list(field.restrictedZones).forEach((z, k) => area(obj(z)?.area, "field", "restrictedZones", k, "area"));
    for (const key of ["rescuePoints", "supplyPoints"]) list(field[key]).forEach((p, k) => add(obj(p)?.location, "field", key, k, "location"));
  }
  list(game?.stations).forEach((value, i) => {
    const s = obj(value);
    if (!s) return;
    add(s.location, "stations", i, "location");
    list(s.triggers).forEach((t, k) => add(obj(t)?.location, "stations", i, "triggers", k, "location"));
    add(obj(s.task)?.location, "stations", i, "task", "location");
  });
  list(game?.rules).forEach((value, i) => {
    list(obj(value)?.when).forEach((c, k) => add(obj(obj(c)?.near)?.location, "rules", i, "when", k, "near", "location"));
  });
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const cos = (lat: number) => Math.cos((lat * Math.PI) / 180);

/** Einen Punkt umziehen: Versatz zu from in Metern, gestreckt um scale, an to angesetzt. */
export function relocatePoint(p: Point, from: Point, to: Point, scale = 1): Point {
  const dLat = p.lat - from.lat;
  const dLon = (p.lon - from.lon) * cos(from.lat);
  return { lat: round6(to.lat + dLat * scale), lon: round6(to.lon + (dLon * scale) / cos(to.lat)) };
}

/**
 * Verschiebt alle Orte so, dass `from` auf `to` liegt; Abstände in Metern bleiben (Länge mit cos der
 * Breite skaliert). scale streckt Abstände vom Bezugspunkt, Kreis-Radien von Spielfeld und Sperrzonen
 * wachsen mit; GPS-Radien bleiben, sie hängen an der Genauigkeit der Handys. Liefert eine Kopie.
 */
export function relocateGame(game: Game, from: Point, to: Point, scale = 1): Game {
  const copy = JSON.parse(JSON.stringify(game)) as Game;
  for (const { point } of allPoints(copy)) Object.assign(point, relocatePoint(point, from, to, scale));
  if (scale !== 1) {
    const circles = [copy.field?.boundary, ...list(copy.field?.restrictedZones).map((z) => obj(z)?.area)];
    for (const c of circles) {
      const a = obj(c);
      if (a && typeof a.radius === "number") a.radius = Math.round(a.radius * scale);
    }
  }
  return copy;
}
