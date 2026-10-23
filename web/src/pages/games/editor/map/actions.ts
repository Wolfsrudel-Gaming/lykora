/**
 * Paket B: Änderungen an Karte und Stationsliste als reine Funktionen auf dem Entwurf – sie laufen
 * innerhalb einer store.update-Mutation (in place) und sind ohne Browser testbar: Stationen anlegen,
 * sortieren, duplizieren, Spielfeld und Sperrzonen setzen, Punkte anlegen, Marker mit Pfeiltasten schieben.
 */

import { areaCenter, distanceM, isArea, isPoint, offsetPoint, round7, roundRadius } from "../../../../lib/editor/geo.ts";
import { allCodes, newId, newManualCode, newQrCode, takenIds } from "../../../../lib/editor/ids.ts";
import { newStation, type StationKind } from "../../../../lib/editor/stations.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, EditorMeta, Game, Point, Station } from "../../../../lib/editor/types.ts";
import { moveItem } from "../ui/SortableList.tsx";

export type Area = Game["field"]["boundary"];
export type Zone = NonNullable<Game["field"]["restrictedZones"]>[number];
export type ZoneKind = NonNullable<Zone["kind"]>;
export type NamedPoint = Game["field"]["assemblyPoint"];
/** Punkte auf der Karte außer Stationen */
export type PointKind = "assembly" | "start" | "rescue" | "supply";

const lang = (g: Game) => g.meta?.languages?.[0] ?? "de";

/** Arten der Sperrzonen mit Symbol und Namensvorschlag (Reihenfolge wie im Format). */
export const ZONE_KINDS: Record<ZoneKind, { label: string; symbol: string }> = {
  road: { label: "Straße", symbol: "═" },
  water: { label: "Gewässer", symbol: "≈" },
  slope: { label: "Hang", symbol: "◢" },
  ditch: { label: "Graben", symbol: "⌄" },
  private: { label: "Privatgelände", symbol: "⌂" },
  other: { label: "Sonstiges", symbol: "▨" },
};

export const POINT_LABELS: Record<PointKind, string> = {
  assembly: "Sammelpunkt",
  start: "Startpunkt",
  rescue: "Rettungspunkt",
  supply: "Versorgungspunkt",
};

/** Ebenen der Karte zu Beginn: Radien und Laufweg an, Regelorte aus (UX §6.2) */
export const DEFAULT_LAYERS = { radii: true, route: true, rules: false };

/** Standard-Radien beim Setzen eines Kreises */
export const BOUNDARY_RADIUS = 300;
export const ZONE_RADIUS = 25;
/** Kopie einer Station steht so weit östlich des Originals */
export const DUPLICATE_OFFSET_M = 20;

/** Neue Station am Ort; die ID entsteht aus dem Namen. Liefert die ID. */
export function addStation(game: Game, kind: StationKind, name: string, location: Point): string {
  const station = newStation(kind, name, game, { location: { lat: round7(location.lat), lon: round7(location.lon) } });
  game.stations = [...(Array.isArray(game.stations) ? game.stations : []), station];
  return station.id;
}

/** Reihenfolge ändern; IDs bleiben, die Nummern in App und Karte folgen der Liste. */
export function moveStation(game: Game, from: number, to: number): void {
  if (!Array.isArray(game.stations)) return;
  game.stations = moveItem(game.stations, from, to);
}

/**
 * Kopie hinter dem Original: „… (Kopie)“, neue ID (baum-2), neue QR- und Notfall-Codes, 20 m
 * versetzt. NFC-Chips gibt es nur einmal, Codeteile auch – beides bleibt beim Original; das
 * Finale bleibt eins. Liefert die neue ID.
 */
export function duplicateStation(game: Game, id: string): string | null {
  const list = Array.isArray(game.stations) ? game.stations : [];
  const index = list.findIndex((s) => s?.id === id);
  if (index < 0) return null;
  const copy = JSON.parse(JSON.stringify(list[index])) as Station;
  copy.id = newId("station", id, takenIds(game, "station"));
  const l = lang(game);
  const name = readText(copy.name as never, l) || id;
  copy.name = { ...(typeof copy.name === "object" ? copy.name : {}), [l]: `${name} (Kopie)` };
  delete copy.final;
  if (copy.rewards) {
    delete copy.rewards.fragments;
    if (!Object.keys(copy.rewards).length) delete copy.rewards;
  }
  const taken = allCodes(game);
  copy.triggers = (copy.triggers ?? []).filter((t) => t?.type !== "nfc");
  for (const t of copy.triggers) {
    if (t.type === "qr") taken.push((t.code = newQrCode(taken)));
    else if (t.type === "manual") taken.push((t.code = newManualCode(taken)));
    else if (t.type === "gps" && isPoint(t.location)) t.location = offsetPoint(t.location, DUPLICATE_OFFSET_M, 0);
  }
  if (!copy.triggers.length) copy.triggers.push({ type: "manual", code: newManualCode(taken) });
  if (isPoint(copy.location)) copy.location = offsetPoint(copy.location, DUPLICATE_OFFSET_M, 0);
  game.stations = [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
  return copy.id;
}

/** Ort einer Station setzen; ein GPS-Auslöser mit eigenem Ort zieht mit. */
export function moveStationTo(game: Game, id: string, to: Point): void {
  const s = game.stations?.find((st) => st?.id === id);
  if (!s) return;
  const p = { lat: round7(to.lat), lon: round7(to.lon) };
  const from = isPoint(s.location) ? s.location : null;
  s.location = p;
  for (const t of s.triggers ?? []) {
    if (t?.type === "gps" && isPoint(t.location) && from) t.location = { lat: round7(t.location.lat + p.lat - from.lat), lon: round7(t.location.lon + p.lon - from.lon) };
  }
}

/** Radius des GPS-Auslösers (5-m-Schritte macht der Aufrufer). */
export function setGpsRadius(game: Game, id: string, radius: number): void {
  const t = game.stations?.find((st) => st?.id === id)?.triggers?.find((tr) => tr?.type === "gps");
  if (t && t.type === "gps") t.radius = radius;
}

/** Spielfeld ersetzen (Kreis oder Vieleck). */
export function setBoundary(game: Game, area: Area): void {
  game.field ??= {} as Game["field"];
  game.field.boundary = area;
}

/** Neue Sperrzone; Name nach der Art, ID aus dem Namen. Liefert die ID. */
export function addZone(game: Game, area: Area, kind: ZoneKind = "other"): string {
  game.field ??= {} as Game["field"];
  const zones = Array.isArray(game.field.restrictedZones) ? game.field.restrictedZones : [];
  const base = kind === "other" ? "Sperrzone" : ZONE_KINDS[kind].label;
  const name = zones.length ? `${base} ${zones.length + 1}` : base;
  const id = newId("zone", name, takenIds(game, "zone"));
  const zone: Zone = { id, name: { [lang(game)]: name }, area };
  if (kind !== "other") zone.kind = kind;
  game.field.restrictedZones = [...zones, zone];
  return id;
}

/** Rettungs- oder Versorgungspunkt anlegen; Name „Rettungspunkt 2“, ID automatisch. Liefert den Listenplatz. */
export function addPoint(game: Game, kind: "rescue" | "supply", location: Point): number {
  game.field ??= {} as Game["field"];
  const key = kind === "rescue" ? "rescuePoints" : "supplyPoints";
  const points = Array.isArray(game.field[key]) ? game.field[key]! : [];
  const name = points.length ? `${POINT_LABELS[kind]} ${points.length + 1}` : POINT_LABELS[kind];
  const id = newId("punkt", name, takenIds(game, "punkt"));
  game.field[key] = [...points, { id, name: { [lang(game)]: name }, location: { lat: round7(location.lat), lon: round7(location.lon) } }];
  return points.length;
}

/** Sammel- oder Startpunkt setzen; der Sammelpunkt behält Name und ID. */
export function setPoint(game: Game, kind: "assembly" | "start", location: Point): void {
  game.field ??= {} as Game["field"];
  const p = { lat: round7(location.lat), lon: round7(location.lon) };
  if (kind === "start") game.field.start = p;
  else game.field.assemblyPoint = { ...(game.field.assemblyPoint ?? {}), location: p };
}

/** Taste → Verschiebung in Metern (Pfeile 1 m, mit Umschalt 10 m); null für andere Tasten. */
export function nudgeOf(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowUp":
      return { dx: 0, dy: step };
    case "ArrowDown":
      return { dx: 0, dy: -step };
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    default:
      return null;
  }
}

/** Ganze Fläche verschieben (Pfeiltasten bei ausgewähltem Spielfeld oder ausgewählter Sperrzone). */
export function moveArea(area: Area, dx: number, dy: number): Area {
  if ("center" in area) return { ...area, center: offsetPoint(area.center, dx, dy) };
  return { polygon: area.polygon.map((p) => offsetPoint(p, dx, dy)) };
}

/** Kreis als Achteck (zum Weiterformen), Vieleck als Kreis um den Schwerpunkt. */
export function convertArea(area: Area, shape: "circle" | "polygon"): Area {
  if (shape === "polygon") {
    if ("polygon" in area) return area;
    return { polygon: Array.from({ length: 8 }, (_, i) => offsetPoint(area.center, area.radius * Math.sin((i * Math.PI) / 4), area.radius * Math.cos((i * Math.PI) / 4))) };
  }
  if ("center" in area) return area;
  const center = areaCenter(area)!;
  return { center, radius: roundRadius(Math.max(...area.polygon.map((p) => distanceM(center, p)))) };
}

/** Kurzbeschreibung: „Kreis, Radius 300 m“ / „Vieleck mit 5 Ecken“. */
export function areaSummary(area: unknown): string {
  if (!isArea(area)) {
    const poly = (area as { polygon?: unknown[] } | undefined)?.polygon;
    return Array.isArray(poly) ? `unfertig (${poly.length} ${poly.length === 1 ? "Ecke" : "Ecken"})` : "noch nicht festgelegt";
  }
  return "center" in area ? `Kreis, Radius ${Math.round(area.radius)} m` : `Vieleck mit ${area.polygon.length} Ecken`;
}

type StationState = "error" | "warning" | null;

/** Zustand am Marker: schwerste nicht ausgeblendete Meldung der Station (Hinweise zählen nicht). */
export function markerState(issues: EditorIssue[], id: string, dismissed: string[] = []): StationState {
  const hidden = new Set(dismissed);
  let state: StationState = null;
  for (const i of issues) {
    if (i.at.section !== "stationen" || i.at.objectId !== id || hidden.has(i.id) || i.severity === "hint") continue;
    if (i.severity === "error") return "error";
    state = "warning";
  }
  return state;
}

/** Station steht noch am Platz aus der Vorlage (weniger als 2 m) und wurde vor Ort nicht bestätigt. */
export function atTemplate(meta: EditorMeta | undefined, id: string, p: Point | null): boolean {
  const t = meta?.template?.stations?.[id];
  if (!t || !p || meta?.onSite?.[id]) return false;
  return distanceM(t, p) < 2;
}
