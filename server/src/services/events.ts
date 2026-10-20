import type { Game, Text } from "@lykora/spec";
import type { Tx } from "../db.ts";
import { reduceTeam, type ActionType, type EngineAction, type TeamContext, type TeamState } from "../engine/team.ts";
import { standings, type TeamResult } from "../engine/standings.ts";
import { notFound } from "../lib/errors.ts";
import type { LiveHub } from "../lib/live.ts";

export type EventStatus = "draft" | "running" | "paused" | "recalled" | "ended";

export interface EventRow {
  id: string;
  org_id: string;
  game_version_id: string;
  name: string;
  join_code: string;
  supervisor_pin: string;
  status: EventStatus;
  pauses: { from: string; to: string | null }[];
  retention_days: number;
  scheduled_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  purged_at: Date | null;
  created_at: Date;
  game_id: string;
  game_version: number;
  game: Game;
}

export interface Member {
  name: string;
  /** Hash des NFC-Armbands, falls registriert */
  tag?: string;
}

export interface TeamRow {
  id: string;
  event_id: string;
  name: string;
  color: string | null;
  members: Member[];
  emergency_phone: string | null;
  device_code: string;
  supervisor_present: boolean;
  started_at: Date | null;
  finished_at: Date | null;
  arrived_at: Date | null;
  last_seen_at: Date | null;
  last_heartbeat_at: Date | null;
  last_lat: number | null;
  last_lon: number | null;
  last_accuracy: number | null;
  last_position_at: Date | null;
  battery: number | null;
  last_headcount: { at: string; present: number; total: number; complete: boolean } | null;
  created_at: Date;
}

type Q = Pick<Tx, "query" | "one">;

export async function loadEvent(db: Q, eventId: string): Promise<EventRow> {
  const row = await db.one<EventRow>(
    `select e.*, v.game_id, v.version as game_version, v.content as game
     from events e join game_versions v on v.id = e.game_version_id where e.id = $1`,
    [eventId],
  );
  if (!row) throw notFound("Event");
  return row;
}

export async function loadTeams(db: Q, eventId: string): Promise<TeamRow[]> {
  return db.query<TeamRow>("select * from teams where event_id = $1 order by created_at", [eventId]);
}

export async function loadTeam(db: Q, eventId: string, teamId: string): Promise<TeamRow> {
  const row = /^[0-9a-f-]{36}$/i.test(teamId)
    ? await db.one<TeamRow>("select * from teams where id = $1 and event_id = $2", [teamId, eventId])
    : undefined;
  if (!row) throw notFound("Team");
  return row;
}

/** Ob ein Betreuer Pflicht ist: laut Spiel aktiviert und mindestens eine Altersgruppe unter 18. */
export function supervisorRequired(game: Game): boolean {
  const minors = (game.meta.ageGroups ?? []).some((g) => g !== "adult");
  return (game.safety.requireSupervisor ?? true) && (minors || (game.meta.ageGroups ?? []).length === 0);
}

export function eventContext(event: EventRow): Omit<TeamContext, "game" | "blockReason"> {
  return {
    eventStartedAt: event.started_at?.getTime() ?? null,
    endedAt: event.ended_at?.getTime() ?? null,
    pauses: event.pauses.map((p) => ({ from: Date.parse(p.from), to: p.to ? Date.parse(p.to) : null })),
  };
}

export function teamContext(event: EventRow, team: TeamRow, staffTags: string[] = []): TeamContext {
  return {
    ...eventContext(event),
    game: event.game,
    blockReason: supervisorRequired(event.game) && !team.supervisor_present ? "supervisor_required" : null,
    staffTags,
    memberTags: memberTags(team),
  };
}

export function memberTags(team: TeamRow): string[] {
  return team.members.flatMap((m) => (m.tag ? [m.tag] : []));
}

/** Alte Einträge waren reine Namen; heute Objekte mit optionalem Armband. */
export function normalizeMembers(members: unknown[] | undefined): Member[] {
  return (members ?? []).map((m) => (typeof m === "string" ? { name: m } : (m as Member)));
}

export async function eventTags(db: Q, eventId: string): Promise<{ tag_hash: string; role: "staff" | "supervisor"; label: string | null }[]> {
  return db.query("select tag_hash, role, label from event_tags where event_id = $1 order by created_at", [eventId]);
}

export async function loadActions(db: Q, teamIds: string[]): Promise<Map<string, EngineAction[]>> {
  const rows = await db.query<{
    id: number;
    team_id: string;
    client_id: string;
    source: "team" | "staff";
    type: ActionType;
    payload: Record<string, unknown>;
    client_time: Date;
  }>("select id, team_id, client_id, source, type, payload, client_time from actions where team_id = any($1) order by id", [teamIds]);
  const map = new Map<string, EngineAction[]>(teamIds.map((id) => [id, []]));
  for (const r of rows) {
    map.get(r.team_id)!.push({
      clientId: r.client_id,
      source: r.source,
      type: r.type,
      payload: r.payload,
      time: r.client_time.getTime(),
      seq: r.id,
    });
  }
  return map;
}

export async function teamState(db: Q, event: EventRow, team: TeamRow): Promise<TeamState> {
  const actions = (await loadActions(db, [team.id])).get(team.id)!;
  const staff = (await eventTags(db, event.id)).map((t) => t.tag_hash);
  return reduceTeam(teamContext(event, team, staff), actions);
}

export async function allTeamStates(db: Q, event: EventRow, teams?: TeamRow[]) {
  const list = teams ?? (await loadTeams(db, event.id));
  const actions = await loadActions(db, list.map((t) => t.id));
  const staff = (await eventTags(db, event.id)).map((t) => t.tag_hash);
  return list.map((team) => ({ team, state: reduceTeam(teamContext(event, team, staff), actions.get(team.id)!) }));
}

export function computeStandings(event: EventRow, states: { team: TeamRow; state: TeamState }[]): TeamResult[] {
  return standings(event.game, eventContext(event), states.map(({ team, state }) => ({ id: team.id, state })));
}

export async function logEvent(
  db: Q,
  live: LiveHub | undefined,
  eventId: string,
  kind: string,
  data: Record<string, unknown> = {},
  ids: { teamId?: string | null; userId?: string | null } = {},
): Promise<void> {
  const row = await db.one<{ id: number; at: Date }>(
    "insert into event_log (event_id, team_id, user_id, kind, data) values ($1, $2, $3, $4, $5) returning id, at",
    [eventId, ids.teamId ?? null, ids.userId ?? null, kind, data],
  );
  live?.publish(eventId, "log", { id: row!.id, kind, teamId: ids.teamId ?? null, data, at: row!.at });
}

/** Text in der gewünschten Sprache, sonst in der ersten vorhandenen. */
export function resolveText(text: Text | undefined, lang: string): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text[lang] ?? Object.values(text)[0] ?? "";
}

/**
 * Speichert Nachrichten, die Regeln erzeugt haben. Sie entstehen bei jeder Neuberechnung
 * wieder; der eindeutige Schlüssel sorgt dafür, dass jede nur einmal ankommt.
 */
export async function storeGeneratedMessages(db: Q, live: LiveHub | undefined, event: EventRow, teamId: string, state: TeamState) {
  const lang = event.game.meta.languages[0] ?? "de";
  for (const m of state.messages) {
    const body = resolveText(m.text, lang);
    const row = await db.one<{ id: number }>(
      `insert into messages (event_id, team_id, direction, kind, sender, body, client_id)
       values ($1, $2, 'to_team', 'story', $3, $4, $5)
       on conflict (team_id, client_id) where client_id is not null do nothing returning id`,
      [event.id, teamId, m.from, body, m.key],
    );
    if (row) live?.publish(event.id, "message", { id: row.id, teamId, direction: "to_team", kind: "story", sender: m.from, body });
  }
}

/** Spiegelt Start und Ziel aus dem berechneten Stand in die Team-Tabelle. */
export async function syncTeamTimes(db: Q, team: TeamRow, state: TeamState): Promise<void> {
  const started = state.startedAt ? new Date(state.startedAt) : null;
  const finished = state.finishedAt ? new Date(state.finishedAt) : null;
  if (started?.getTime() !== team.started_at?.getTime() || finished?.getTime() !== team.finished_at?.getTime()) {
    await db.query("update teams set started_at = $2, finished_at = $3 where id = $1", [team.id, started, finished]);
  }
}

export function publicTeam(team: TeamRow) {
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    members: normalizeMembers(team.members).map((m) => m.name),
    wristbands: memberTags(team).length,
    lastHeadcount: team.last_headcount,
    supervisorPresent: team.supervisor_present,
    startedAt: team.started_at,
    finishedAt: team.finished_at,
    arrivedAt: team.arrived_at,
    lastSeenAt: team.last_seen_at,
    lastHeartbeatAt: team.last_heartbeat_at,
    battery: team.battery,
  };
}

export function summarizeState(state: TeamState) {
  return {
    startedAt: state.startedAt ? new Date(state.startedAt) : null,
    finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
    triggered: state.triggered,
    solved: Object.keys(state.solved),
    revealed: state.revealed,
    locked: state.locked,
    fragments: state.fragments,
    items: state.items,
    chapters: state.chapters,
    hints: state.hints,
    hintsUsed: state.hintsUsed,
    wrongAnswers: state.wrongAnswers,
    points: state.points,
    timePenalty: state.timePenalty,
    lockedUntil: state.lockedUntil ? new Date(state.lockedUntil) : null,
    pendingReviews: state.pendingReviews,
  };
}

/** Berechnet den Stand neu, speichert Folgen (Nachrichten, Start/Ziel) und meldet ihn live. */
export async function refreshTeam(db: Q, live: LiveHub | undefined, event: EventRow, team: TeamRow): Promise<TeamState> {
  const state = await teamState(db, event, team);
  await storeGeneratedMessages(db, live, event, team.id, state);
  await syncTeamTimes(db, team, state);
  live?.publish(event.id, "team", { teamId: team.id, state: summarizeState(state) });
  return state;
}
