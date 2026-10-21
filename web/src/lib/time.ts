/**
 * Spielzeit und Restzeit wie in der Spiellogik des Servers (engine/team.ts elapsedAt):
 * Pausen des Events zählen nicht, Zeitstrafen verkürzen die Restzeit.
 */

import type { Game, Pause } from "./types.ts";

interface EventTimes {
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  pauses: Pause[];
}

interface TeamTimes {
  startedAt: string | null;
  finishedAt: string | null;
  /** Zeitstrafen in Sekunden */
  timePenalty?: number;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/** Pausenzeit in Millisekunden zwischen from und to. */
export function pausedBetween(pauses: Pause[], from: number, to: number): number {
  let total = 0;
  for (const p of pauses) {
    const a = Math.max(Date.parse(p.from), from);
    const b = Math.min(p.to ? Date.parse(p.to) : to, to);
    if (b > a) total += b - a;
  }
  return total;
}

export type TimeLimit = "global" | "per_team" | "none";

export function timeLimit(game: Game | null | undefined): { limit: TimeLimit; duration: number | null } {
  const time = game?.settings.time;
  const limit = time?.limit ?? "per_team";
  return { limit, duration: limit === "none" ? null : (time?.duration ?? null) };
}

/** Bis wann die Uhr läuft: Ende des Events, Ziel des Teams oder jetzt. */
function stopAt(event: EventTimes, team: TeamTimes | null, now: number): number {
  return Math.min(now, ms(event.endedAt) ?? Infinity, ms(team?.finishedAt) ?? Infinity);
}

/** Laufzeit des Events in Sekunden ohne Pausen; null vor dem Start. */
export function eventElapsed(event: EventTimes, now = Date.now()): number | null {
  const start = ms(event.startedAt);
  if (start === null) return null;
  const end = stopAt(event, null, now);
  return Math.max(0, (end - start - pausedBetween(event.pauses, start, end)) / 1000);
}

/** Spielzeit eines Teams in Sekunden ohne Pausen und ohne Strafen. */
export function teamElapsed(game: Game | null | undefined, event: EventTimes, team: TeamTimes | null, now = Date.now()): number | null {
  const { limit } = timeLimit(game);
  const start = limit === "global" ? (ms(event.startedAt) ?? ms(team?.startedAt)) : ms(team?.startedAt);
  if (start === null) return null;
  const end = stopAt(event, team, now);
  return Math.max(0, (end - start - pausedBetween(event.pauses, start, end)) / 1000);
}

/**
 * Restzeit in Sekunden; negativ, wenn die Zeit abgelaufen ist. null ohne Zeitlimit
 * oder solange die Uhr noch nicht läuft (bei per_team: Team hat noch nicht gestartet).
 */
export function remaining(game: Game | null | undefined, event: EventTimes, team: TeamTimes | null, now = Date.now()): number | null {
  const { limit, duration } = timeLimit(game);
  if (limit === "none" || !duration) return null;
  if (limit === "per_team" && !team) return null;
  const elapsed = teamElapsed(game, event, team, now);
  if (elapsed === null) return null;
  return duration - elapsed - (team?.timePenalty ?? 0);
}

/** Ob das Event gerade steht (Pause oder Rückruf). */
export function isPaused(event: EventTimes): boolean {
  return event.status === "paused" || event.status === "recalled";
}
