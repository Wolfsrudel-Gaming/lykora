/** Lesbare Zusammenfassungen eines Spiels für Spielleitung und Autoren. */

import { formatSpan, text } from "./format.ts";
import type { Game } from "./types.ts";

type Station = Game["stations"][number];
type Trigger = Station["triggers"][number];
type Task = NonNullable<Station["task"]>;
type Area = Game["field"]["boundary"];
type Penalty = NonNullable<Game["settings"]["wrongAnswer"]>;

export const lang = (game: Game | null | undefined) => game?.meta.languages[0] ?? "de";

export function triggerLabel(t: Trigger): string {
  switch (t.type) {
    case "gps":
      return `GPS${t.radius ? ` (${t.radius} m)` : ""}`;
    case "qr":
      return `QR-Code „${t.code}“`;
    case "nfc":
      return `NFC-Tag „${t.tag}“`;
    case "ble":
      return `BLE-Beacon ${t.uuid}`;
    case "manual":
      return `Notfall-Code ${t.code}`;
    case "box":
      return `ESP32-Box „${t.box}“${t.event ? ` (${t.event})` : ""}`;
  }
}

export const TASK_LABELS: Record<Task["type"], string> = {
  text: "Antwort eintippen",
  code: "Code",
  choice: "Auswahl",
  photo: "Foto",
  find_location: "Ort finden",
};

export interface TaskSummary {
  kind: string;
  question: string;
  /** Lösungen, so wie die Spielleitung sie braucht */
  solution: string[];
}

export function taskSummary(task: Task, l: string): TaskSummary {
  switch (task.type) {
    case "text":
      return { kind: TASK_LABELS.text + (task.manualReview ? " (Prüfung von Hand)" : ""), question: text(task.question, l), solution: task.answers };
    case "code":
      return { kind: TASK_LABELS.code, question: text(task.question, l), solution: task.answers };
    case "choice":
      return { kind: TASK_LABELS.choice, question: text(task.question, l), solution: task.options.filter((o) => o.correct).map((o) => text(o.text, l)) };
    case "photo": {
      const review = { live: "Prüfung live", auto_accept: "wird automatisch angenommen", after_game: "Prüfung nach dem Spiel", vote: "Abstimmung" }[task.review ?? "live"];
      return { kind: `${task.video ? "Video" : "Foto"}, ${review}`, question: text(task.prompt, l), solution: [] };
    }
    case "find_location":
      return {
        kind: TASK_LABELS.find_location,
        question: text(task.prompt, l),
        solution: [`${task.location.lat.toFixed(5)}, ${task.location.lon.toFixed(5)} (± ${task.radius ?? 20} m)`],
      };
  }
}

export function penaltyLabel(p: Penalty | undefined): string {
  if (!p || p.type === "none") return "keine Strafe";
  if (p.type === "time") return `+${formatSpan(p.amount ?? 0)}`;
  if (p.type === "points") return `−${p.amount ?? 0} Punkte`;
  return `${formatSpan(p.amount ?? 0)} Sperre`;
}

/** Klänge einer Station in Worten. */
export function stationSoundLines(s: Station): string[] {
  const out: string[] = [];
  const snd = s.sound;
  if (snd?.ambience) {
    const from = { mid: "ab mittlerer Entfernung", near: "aus der Nähe", here: "am Ort" }[snd.ambience.from ?? "near"];
    out.push(`Atmosphäre „${snd.ambience.audio}“ ${from}`);
  }
  const stages = { mid: "mittel", near: "nah", here: "am Ort" } as const;
  for (const k of ["mid", "near", "here"] as const) {
    const id = snd?.approach?.[k];
    if (id) out.push(`Annäherung ${stages[k]}: „${id}“`);
  }
  if (snd?.solved) out.push(`Beim Lösen: „${snd.solved}“`);
  for (const beat of [...(s.scene?.arrival ?? []), ...(s.scene?.beats ?? []), ...(s.scene?.afterSolve ?? [])]) {
    if (beat.sfx) out.push(`Szene: Geräusch „${beat.sfx}“`);
    if (beat.audio) out.push(`Szene: Aufnahme „${beat.audio}“`);
  }
  return out;
}

export function audioMedia(game: Game | null | undefined) {
  return (game?.media ?? []).filter((m) => m.type === "audio");
}

/** Mittelpunkt und Ausdehnung einer Fläche für den Kartenausschnitt. */
export function areaBounds(area: Area): [[number, number], [number, number]] {
  if ("polygon" in area) {
    const lats = area.polygon.map((p) => p.lat);
    const lons = area.polygon.map((p) => p.lon);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];
  }
  // Ein Grad Breite sind etwa 111 km; die Länge schrumpft mit dem Kosinus der Breite.
  const dLat = area.radius / 111_320;
  const dLon = area.radius / (111_320 * Math.cos((area.center.lat * Math.PI) / 180));
  return [
    [area.center.lat - dLat, area.center.lon - dLon],
    [area.center.lat + dLat, area.center.lon + dLon],
  ];
}

export function stationName(game: Game | null | undefined, id: string): string {
  const s = game?.stations.find((st) => st.id === id);
  return s ? text(s.name, lang(game)) || id : id;
}

export function itemName(game: Game | null | undefined, id: string): string {
  const i = game?.items?.find((it) => it.id === id);
  return i ? text(i.name, lang(game)) || id : id;
}
