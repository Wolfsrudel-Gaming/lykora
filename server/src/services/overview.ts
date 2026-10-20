import type { Game } from "@lykora/spec";
import type { TeamState } from "../engine/team.ts";
import { distance, distanceToArea } from "../lib/geo.ts";
import type { EventRow, TeamRow } from "./events.ts";

/** Schwellen für die Vorschläge des Assistenten. */
export const THRESHOLDS = {
  stuckMinutes: 15,
  noContactMinutes: 20,
  batteryLow: 0.2,
  crowdRadius: 30,
  crowdTeams: 3,
};

export interface Warning {
  kind:
    | "sos"
    | "heartbeat_overdue"
    | "no_contact"
    | "stuck"
    | "in_restricted_zone"
    | "near_restricted_zone"
    | "outside_field"
    | "battery_low"
    | "review_pending"
    | "crowded_station"
    | "headcount_incomplete";
  teamId?: string;
  stationId?: string;
  zoneId?: string;
  minutes?: number;
  message: string;
}

const minutesSince = (now: number, t: Date | number | null | undefined) =>
  t == null ? Infinity : (now - (typeof t === "number" ? t : t.getTime())) / 60_000;

export function teamWarnings(
  game: Game,
  event: EventRow,
  team: TeamRow,
  state: TeamState,
  openSos: number,
  now = Date.now(),
): Warning[] {
  const w: Warning[] = [];
  const name = team.name;
  if (openSos > 0) w.push({ kind: "sos", teamId: team.id, message: `${name} hat SOS ausgelöst` });

  const active = event.status === "running" && state.startedAt !== null && state.finishedAt === null && !team.arrived_at;
  if (active) {
    const hb = game.safety.heartbeat;
    if (hb?.enabled ?? true) {
      const limit = ((hb?.interval ?? 900) + (hb?.grace ?? 300)) / 60;
      const since = minutesSince(now, team.last_heartbeat_at ?? state.startedAt);
      if (since > limit) {
        w.push({ kind: "heartbeat_overdue", teamId: team.id, minutes: Math.round(since), message: `${name}: Lebenszeichen seit ${Math.round(since)} Min überfällig` });
      }
    }
    const silent = minutesSince(now, team.last_seen_at);
    if (silent > THRESHOLDS.noContactMinutes) {
      w.push({ kind: "no_contact", teamId: team.id, minutes: Math.round(silent), message: `${name} seit ${Math.round(silent)} Min ohne Netzkontakt` });
    }
    const lastProgress = Math.max(state.startedAt ?? 0, ...Object.values(state.solved));
    const stuck = minutesSince(now, lastProgress);
    if (stuck > THRESHOLDS.stuckMinutes) {
      w.push({ kind: "stuck", teamId: team.id, minutes: Math.round(stuck), message: `${name} hängt seit ${Math.round(stuck)} Min – Hinweis senden?` });
    }
  }

  if (team.last_lat !== null && team.last_lon !== null && active) {
    const pos = { lat: team.last_lat, lon: team.last_lon };
    for (const zone of game.field.restrictedZones ?? []) {
      const d = distanceToArea(pos, zone.area);
      const label = typeof zone.name === "string" ? zone.name : (Object.values(zone.name ?? {})[0] ?? zone.id);
      if (d === 0) w.push({ kind: "in_restricted_zone", teamId: team.id, zoneId: zone.id, message: `${name} ist in der Sperrzone „${label}“` });
      else if (d <= (zone.warnDistance ?? 15)) {
        w.push({ kind: "near_restricted_zone", teamId: team.id, zoneId: zone.id, message: `${name} kommt der Sperrzone „${label}“ nahe (${Math.round(d)} m)` });
      }
    }
    if (distanceToArea(pos, game.field.boundary) > 0) {
      w.push({ kind: "outside_field", teamId: team.id, message: `${name} ist außerhalb des Spielfelds` });
    }
  }

  const hc = team.last_headcount;
  if (hc && !hc.complete && !state.finishedAt) {
    w.push({ kind: "headcount_incomplete", teamId: team.id, message: `${name}: Vollzähligkeits-Check unvollständig (${hc.present} von ${hc.total})` });
  }
  if (team.battery !== null && team.battery < THRESHOLDS.batteryLow) {
    w.push({ kind: "battery_low", teamId: team.id, message: `${name}: Akku bei ${Math.round(team.battery * 100)} %` });
  }
  for (const stationId of state.pendingReviews) {
    w.push({ kind: "review_pending", teamId: team.id, stationId, message: `${name} wartet auf Prüfung an Station ${stationId}` });
  }
  return w;
}

/** Stationen, an denen sich gerade viele Teams ballen. */
export function crowdWarnings(game: Game, teams: TeamRow[], now = Date.now()): Warning[] {
  const recent = teams.filter((t) => t.last_lat !== null && minutesSince(now, t.last_position_at) < 5 && !t.finished_at);
  const out: Warning[] = [];
  for (const s of game.stations) {
    if (!s.location) continue;
    const near = recent.filter((t) => distance({ lat: t.last_lat!, lon: t.last_lon! }, s.location!) <= THRESHOLDS.crowdRadius);
    if (near.length >= THRESHOLDS.crowdTeams) {
      out.push({ kind: "crowded_station", stationId: s.id, message: `${near.length} Teams ballen sich an Station ${s.id}` });
    }
  }
  return out;
}
