/** Wörter für Logbuch, Aktionsprotokoll und Ablehnungsgründe der Spiellogik. */

import { formatSigned, formatSpan } from "./format.ts";
import { itemName, stationName } from "./game.ts";
import { audioName } from "./messages.ts";
import type { Game, LogEntry } from "./types.ts";

export const ACTION_LABELS: Record<string, string> = {
  start: "Start",
  trigger: "Station ausgelöst",
  answer: "Antwort",
  hint: "Hinweis genommen",
  heartbeat: "Lebenszeichen",
  arrived: "Am Sammelpunkt",
  staff_reveal: "Station freigeschaltet",
  staff_lock: "Station gesperrt",
  staff_unlock: "Station entsperrt",
  staff_solve: "Als gelöst gewertet",
  staff_reject: "Lösung zurückgewiesen",
  staff_points: "Punkte",
  staff_time: "Zeit",
  staff_item: "Gegenstand",
};

export const LOG_LABELS: Record<string, string> = {
  event_created: "Event angelegt",
  event_start: "Event gestartet",
  event_pause: "Pause",
  event_resume: "Fortgesetzt",
  event_recall: "Rückruf: Alle zurück",
  event_end: "Event beendet",
  team_joined: "Team beigetreten",
  team_updated: "Team bearbeitet",
  supervisor_confirmed: "Betreuer bestätigt",
  sos: "SOS",
  sos_ack: "SOS bestätigt",
  sos_resolve: "SOS erledigt",
  message_sent: "Nachricht gesendet",
  message_received: "Nachricht erhalten",
  cue_sent: "Klang eingespielt",
  team_start: "Team gestartet",
  team_trigger: "Station ausgelöst",
  team_answer: "Antwort",
  team_hint: "Hinweis genommen",
  team_arrived: "Am Sammelpunkt angekommen",
};

/** Bezeichnung eines Logbuch-Eintrags. */
export function logLabel(kind: string): string {
  return LOG_LABELS[kind] ?? ACTION_LABELS[kind] ?? kind;
}

export const REASON_LABELS: Record<string, string> = {
  supervisor_required: "Betreuer fehlt",
  not_started: "Event noch nicht gestartet",
  ended: "Event beendet",
  paused: "Event pausiert",
  finished: "Team schon im Ziel",
  time_up: "Zeit abgelaufen",
  unknown_station: "Unbekannte Station",
  locked: "Station gesperrt",
  fragments_missing: "Fragmente fehlen",
  hidden: "Station noch versteckt",
  already_triggered: "Schon ausgelöst",
  no_task: "Keine Aufgabe",
  not_triggered: "Station nicht ausgelöst",
  already_solved: "Schon gelöst",
  review_pending: "Prüfung läuft",
  locked_out: "Gesperrt nach Fehlversuch",
  hints_disabled: "Hinweise aus",
  already_used: "Hinweis schon genommen",
  invalid_level: "Falsche Hinweisstufe",
  unknown_item: "Unbekannter Gegenstand",
  unknown_type: "Unbekannte Aktion",
  unknown: "Unbekannt",
};

export const VERDICT_LABELS = { correct: "richtig", wrong: "falsch", pending: "wartet auf Prüfung" } as const;

/** Kurzbeschreibung der Daten einer Aktion oder eines Logbuch-Eintrags. */
export function detailText(kind: string, data: Record<string, unknown>, game: Game | null | undefined): string {
  const parts: string[] = [];
  const station = typeof data.station === "string" ? stationName(game, data.station) : null;
  if (station) parts.push(station);
  const type = kind.replace(/^team_/, "");
  if (type === "answer") {
    if (typeof data.text === "string") parts.push(`„${data.text}“`);
    if (Array.isArray(data.choice)) parts.push(`Auswahl ${data.choice.map((c) => Number(c) + 1).join(", ")}`);
    if (typeof data.upload === "string") parts.push("Foto");
    if (data.location && typeof data.location === "object") parts.push("Standort");
  }
  if (type === "hint" && data.level !== undefined) parts.push(`Stufe ${String(data.level)}`);
  if (type === "trigger" && typeof data.method === "string") parts.push(data.method.toUpperCase());
  if (kind === "staff_points" && typeof data.amount === "number") parts.push(`${formatSigned(data.amount)} Punkte`);
  if (kind === "staff_time" && typeof data.seconds === "number") {
    parts.push(data.seconds >= 0 ? `+${formatSpan(data.seconds)} Strafe` : `${formatSpan(-data.seconds)} gutgeschrieben`);
  }
  if (kind === "staff_item" && typeof data.item === "string") parts.push(`${itemName(game, data.item)} ${data.remove ? "genommen" : "gegeben"}`);
  if ((kind === "message_sent" || kind === "message_received") && typeof data.body === "string") parts.push(`„${data.body}“`);
  if (kind === "cue_sent" && typeof data.audio === "string") parts.push(`„${audioName(data.audio)}“${typeof data.text === "string" && data.text ? `: ${data.text}` : ""}`);
  if (kind === "event_recall" && typeof data.reason === "string" && data.reason) parts.push(data.reason);
  if (kind === "team_joined" && typeof data.name === "string") parts.push(data.name);
  if (kind === "sos") {
    if (typeof data.channel === "string") parts.push(`über ${data.channel.toUpperCase()}`);
    if (typeof data.message === "string" && data.message) parts.push(`„${data.message}“`);
  }
  if (kind === "team_updated") {
    if (data.supervisorPresent === true) parts.push("Betreuer bestätigt");
    if (data.arrived === true) parts.push("am Sammelpunkt");
    if (data.arrived === false) parts.push("Ankunft zurückgenommen");
    if (typeof data.name === "string") parts.push(`Name „${data.name}“`);
  }
  if (typeof data.note === "string" && data.note) parts.push(`Notiz: ${data.note}`);
  const outcome = data.outcome as { status?: string; reason?: string; verdict?: keyof typeof VERDICT_LABELS } | undefined;
  if (outcome?.verdict) parts.push(VERDICT_LABELS[outcome.verdict]);
  else if (outcome?.status && outcome.status !== "ok") parts.push(REASON_LABELS[outcome.reason ?? "unknown"] ?? outcome.reason ?? "");
  return parts.filter(Boolean).join(" · ");
}

/** Ob ein Logbuch-Eintrag zur Sicherheit gehört und hervorgehoben wird. */
export function isSafetyLog(entry: Pick<LogEntry, "kind">): boolean {
  return entry.kind === "sos" || entry.kind === "event_recall";
}
