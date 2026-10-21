import type { FastifyInstance, FastifyRequest } from "fastify";
import { authorize, authorizeEvent } from "../lib/auth.ts";
import { newCode } from "../lib/crypto.ts";
import { conflict, notFound } from "../lib/errors.ts";
import { closeWithError } from "../lib/live.ts";
import { can } from "../lib/roles.ts";
import { toCsv } from "../lib/csv.ts";
import {
  allTeamStates,
  computeStandings,
  loadEvent,
  loadTeam,
  logEvent,
  publicTeam,
  summarizeState,
  supervisorRequired,
  teamState,
  type EventRow,
  type EventStatus,
} from "../services/events.ts";
import { crowdWarnings, teamWarnings } from "../services/overview.ts";

const eventParams = { type: "object", required: ["eventId"], properties: { eventId: { type: "string", format: "uuid" } } } as const;
const teamParams = {
  type: "object",
  required: ["eventId", "teamId"],
  properties: { eventId: { type: "string", format: "uuid" }, teamId: { type: "string", format: "uuid" } },
} as const;
const staff = [{ staff: [] }];

/** Erlaubte Statuswechsel. */
const TRANSITIONS: Record<string, { from: EventStatus[]; to: EventStatus }> = {
  start: { from: ["draft"], to: "running" },
  pause: { from: ["running"], to: "paused" },
  resume: { from: ["paused", "recalled"], to: "running" },
  recall: { from: ["running", "paused"], to: "recalled" },
  end: { from: ["draft", "running", "paused", "recalled"], to: "ended" },
};

export function joinInfo(publicUrl: string, event: Pick<EventRow, "join_code">) {
  const url = `${publicUrl}/join/${event.join_code}`;
  return {
    code: event.join_code,
    url,
    // Inhalt des Einstiegs-QR: Server und Event, damit die App keine feste Adresse braucht.
    qr: `lykora://join?server=${encodeURIComponent(publicUrl)}&code=${event.join_code}`,
  };
}

function eventDto(event: EventRow, publicUrl: string, showPin: boolean) {
  return {
    id: event.id,
    orgId: event.org_id,
    name: event.name,
    status: event.status,
    gameId: event.game_id,
    gameVersion: event.game_version,
    gameTitle: event.game.meta.title,
    scheduledAt: event.scheduled_at,
    startedAt: event.started_at,
    endedAt: event.ended_at,
    pauses: event.pauses,
    retentionDays: event.retention_days,
    purgedAt: event.purged_at,
    createdAt: event.created_at,
    join: joinInfo(publicUrl, event),
    supervisorRequired: supervisorRequired(event.game),
    supervisorPin: showPin ? event.supervisor_pin : undefined,
  };
}

async function uniqueJoinCode(db: FastifyInstance["deps"]["db"]): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = newCode(6);
    if (!(await db.one("select 1 from events where join_code = $1", [code]))) return code;
  }
  throw new Error("Kein freier Event-Code gefunden");
}

export default async function eventRoutes(app: FastifyInstance) {
  const { db, config, live } = app.deps;

  app.get<{ Params: { orgId: string } }>(
    "/orgs/:orgId/events",
    {
      schema: { tags: ["events"], summary: "Events einer Organisation", security: staff, params: { type: "object", properties: { orgId: { type: "string", format: "uuid" } } } },
    },
    async (req) => {
      await authorize(db, req, req.params.orgId, "event.read");
      const rows = await db.query<{ id: string }>("select id from events where org_id = $1 order by coalesce(scheduled_at, created_at) desc", [req.params.orgId]);
      const events = await Promise.all(rows.map((r) => loadEvent(db, r.id)));
      return events.map((e) => eventDto(e, config.publicUrl, false));
    },
  );

  app.post<{ Params: { orgId: string }; Body: { gameId: string; version?: number; name: string; scheduledAt?: string; retentionDays?: number } }>(
    "/orgs/:orgId/events",
    {
      schema: {
        tags: ["events"],
        summary: "Event aus einem Spiel anlegen",
        description: "Ohne version wird die neueste Version des Spiels verwendet. Spätere Änderungen am Spiel wirken nicht auf das Event.",
        security: staff,
        params: { type: "object", properties: { orgId: { type: "string", format: "uuid" } } },
        body: {
          type: "object",
          required: ["gameId", "name"],
          properties: {
            gameId: { type: "string", format: "uuid" },
            version: { type: "integer", minimum: 1 },
            name: { type: "string", minLength: 1 },
            scheduledAt: { type: "string", format: "date-time" },
            retentionDays: { type: "integer", minimum: 1, maximum: 365 },
          },
        },
      },
    },
    async (req, reply) => {
      const { user } = await authorize(db, req, req.params.orgId, "event.manage");
      const version = await db.one<{ id: string }>(
        `select v.id from game_versions v join games g on g.id = v.game_id
         where g.id = $1 and g.org_id = $2 and ($3::int is null or v.version = $3) order by v.version desc limit 1`,
        [req.body.gameId, req.params.orgId, req.body.version ?? null],
      );
      if (!version) throw notFound("Spiel oder Version");
      const row = await db.one<{ id: string }>(
        `insert into events (org_id, game_version_id, name, join_code, supervisor_pin, scheduled_at, retention_days, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [req.params.orgId, version.id, req.body.name, await uniqueJoinCode(db), newCode(6), req.body.scheduledAt ?? null, req.body.retentionDays ?? 30, user.id],
      );
      await logEvent(db, live, row!.id, "event_created", { name: req.body.name }, { userId: user.id });
      return reply.status(201).send(eventDto(await loadEvent(db, row!.id), config.publicUrl, true));
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId",
    { schema: { tags: ["events"], summary: "Event mit Einstiegsdaten", security: staff, params: eventParams } },
    async (req) => {
      const { role } = await authorizeEvent(db, req, req.params.eventId, "event.read");
      return eventDto(await loadEvent(db, req.params.eventId), config.publicUrl, can(role, "event.review"));
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/game",
    { schema: { tags: ["events"], summary: "Spielinhalt des Events inklusive Lösungen", security: staff, params: eventParams } },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.review");
      return (await loadEvent(db, req.params.eventId)).game;
    },
  );

  app.patch<{ Params: { eventId: string }; Body: { name?: string; scheduledAt?: string | null; retentionDays?: number } }>(
    "/events/:eventId",
    {
      schema: {
        tags: ["events"],
        summary: "Event bearbeiten",
        security: staff,
        params: eventParams,
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            scheduledAt: { type: ["string", "null"], format: "date-time" },
            retentionDays: { type: "integer", minimum: 1, maximum: 365 },
          },
        },
      },
    },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.manage");
      const b = req.body;
      await db.query(
        `update events set name = coalesce($2, name),
           scheduled_at = case when $3::boolean then $4::timestamptz else scheduled_at end,
           retention_days = coalesce($5, retention_days) where id = $1`,
        [req.params.eventId, b.name ?? null, "scheduledAt" in b, b.scheduledAt ?? null, b.retentionDays ?? null],
      );
      return eventDto(await loadEvent(db, req.params.eventId), config.publicUrl, true);
    },
  );

  app.delete<{ Params: { eventId: string } }>(
    "/events/:eventId",
    { schema: { tags: ["events"], summary: "Event mit allen Daten löschen", security: staff, params: eventParams } },
    async (req, reply) => {
      await authorizeEvent(db, req, req.params.eventId, "event.manage");
      const event = await loadEvent(db, req.params.eventId);
      if (event.status === "running" || event.status === "paused" || event.status === "recalled") {
        throw conflict("event_active", "Laufende Events erst beenden");
      }
      await db.query("delete from events where id = $1", [req.params.eventId]);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { eventId: string; action: string }; Body: { reason?: string } | undefined }>(
    "/events/:eventId/:action",
    {
      schema: {
        tags: ["events"],
        summary: "Status ändern: start, pause, resume, recall („Alle zurück“) oder end",
        description: "recall pausiert das Spiel und schickt allen Teams den Rückruf zum Sammelpunkt.",
        security: staff,
        params: {
          type: "object",
          properties: { eventId: { type: "string", format: "uuid" }, action: { type: "string", enum: Object.keys(TRANSITIONS) } },
        },
        body: { type: ["object", "null"], properties: { reason: { type: "string" } } },
      },
    },
    async (req) => {
      const { user } = await authorizeEvent(db, req, req.params.eventId, "event.manage");
      const t = TRANSITIONS[req.params.action]!;
      const reason = req.body?.reason ?? null;
      const event = await db.tx(async (tx) => {
        const e = await loadEventForUpdate(tx, req.params.eventId);
        if (!t.from.includes(e.status)) throw conflict("invalid_status", `Aus Status „${e.status}“ nicht möglich`);
        const now = new Date().toISOString();
        let pauses = e.pauses;
        const openPause = pauses.length > 0 && pauses[pauses.length - 1]!.to === null;
        if ((t.to === "paused" || t.to === "recalled") && !openPause) pauses = [...pauses, { from: now, to: null }];
        if ((t.to === "running" || t.to === "ended") && openPause) pauses = [...pauses.slice(0, -1), { ...pauses[pauses.length - 1]!, to: now }];
        await tx.query(
          `update events set status = $2, pauses = $3,
             started_at = case when $2 = 'running' and started_at is null then now() else started_at end,
             ended_at = case when $2 = 'ended' then now() else ended_at end
           where id = $1`,
          [e.id, t.to, JSON.stringify(pauses)],
        );
        if (t.to === "recalled") {
          await tx.query(
            `insert into messages (event_id, team_id, direction, kind, sender, body, user_id)
             values ($1, null, 'to_team', 'system', 'hq', $2, $3)`,
            [e.id, `Alle zurück zum Sammelpunkt!${reason ? ` ${reason}` : ""}`, user.id],
          );
        }
        await logEvent(tx, live, e.id, `event_${req.params.action}`, { reason }, { userId: user.id });
        return loadEvent(tx, e.id);
      });
      live.publish(event.id, "status", { status: event.status, reason });
      live.poke(event.id, null, "status");
      return eventDto(event, config.publicUrl, true);
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/overview",
    {
      schema: {
        tags: ["events"],
        summary: "Dashboard: Teams mit Position, Fortschritt, Lebenszeichen und Warnungen",
        security: staff,
        params: eventParams,
      },
    },
    async (req) => {
      const { role } = await authorizeEvent(db, req, req.params.eventId, "event.read");
      const event = await loadEvent(db, req.params.eventId);
      const states = await allTeamStates(db, event);
      const results = new Map(computeStandings(event, states).map((r) => [r.teamId, r]));
      const sosRows = await db.query<{ team_id: string; n: number }>(
        "select team_id, count(*)::int as n from sos where event_id = $1 and resolved_at is null group by team_id",
        [event.id],
      );
      const openSos = new Map(sosRows.map((r) => [r.team_id, r.n]));
      const positions = can(role, "event.positions");
      const teams = states.map(({ team, state }) => ({
        ...publicTeam(team),
        position: positions && team.last_lat !== null ? { lat: team.last_lat, lon: team.last_lon, accuracy: team.last_accuracy, at: team.last_position_at } : null,
        progress: {
          solved: Object.keys(state.solved).length,
          stations: event.game.stations.length,
          fragments: state.fragments.length,
          totalFragments: event.game.fragments?.length ?? 0,
          hintsUsed: state.hintsUsed,
          points: results.get(team.id)?.points ?? state.points,
          rank: results.get(team.id)?.rank,
          timePenalty: state.timePenalty,
        },
        openSos: openSos.get(team.id) ?? 0,
        warnings: teamWarnings(event.game, event, team, state, openSos.get(team.id) ?? 0),
      }));
      return {
        event: eventDto(event, config.publicUrl, can(role, "event.review")),
        teams,
        warnings: [...teams.flatMap((t) => t.warnings), ...(positions ? crowdWarnings(event.game, states.map((s) => s.team)) : [])],
      };
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/standings",
    { schema: { tags: ["events"], summary: "Rangliste", security: staff, params: eventParams } },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.read");
      const event = await loadEvent(db, req.params.eventId);
      const states = await allTeamStates(db, event);
      const names = new Map(states.map(({ team }) => [team.id, team.name]));
      return computeStandings(event, states).map((r) => ({ ...r, name: names.get(r.teamId) }));
    },
  );

  app.get<{ Params: { eventId: string; teamId: string } }>(
    "/events/:eventId/teams/:teamId",
    { schema: { tags: ["events"], summary: "Team im Detail mit Spielstand und Aktionen", security: staff, params: teamParams } },
    async (req) => {
      const { role } = await authorizeEvent(db, req, req.params.eventId, "event.read");
      const event = await loadEvent(db, req.params.eventId);
      const team = await loadTeam(db, event.id, req.params.teamId);
      const state = await teamState(db, event, team);
      const actions = await db.query(
        "select client_id, source, type, payload, client_time, received_at from actions where team_id = $1 order by client_time, id",
        [team.id],
      );
      const outcomes = new Map(state.outcomes.map((o) => [o.clientId, o]));
      const detailed = can(role, "event.review");
      return {
        ...publicTeam(team),
        emergencyPhone: detailed ? team.emergency_phone : undefined,
        deviceCode: detailed ? team.device_code : undefined,
        state: summarizeState(state),
        actions: actions.map((a) => ({ ...a, outcome: outcomes.get(a.client_id) })),
      };
    },
  );

  app.get<{ Params: { eventId: string; teamId: string } }>(
    "/events/:eventId/teams/:teamId/track",
    { schema: { tags: ["events"], summary: "Laufspur eines Teams", security: staff, params: teamParams } },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.positions");
      await loadTeam(db, req.params.eventId, req.params.teamId);
      return db.query("select lat, lon, accuracy, recorded_at from positions where team_id = $1 order by recorded_at", [req.params.teamId]);
    },
  );

  app.get<{ Params: { eventId: string }; Querystring: { after?: number; limit?: number } }>(
    "/events/:eventId/log",
    {
      schema: {
        tags: ["events"],
        summary: "Logbuch",
        security: staff,
        params: eventParams,
        querystring: { type: "object", properties: { after: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 1000 } } },
      },
    },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.read");
      return db.query(
        `select l.id, l.kind, l.data, l.at, l.team_id, t.name as team_name, u.name as user_name
         from event_log l left join teams t on t.id = l.team_id left join users u on u.id = l.user_id
         where l.event_id = $1 and l.id > $2 order by l.id limit $3`,
        [req.params.eventId, req.query.after ?? 0, req.query.limit ?? 500],
      );
    },
  );

  app.get<{ Params: { eventId: string; file: string } }>(
    "/events/:eventId/export/:file",
    {
      schema: {
        tags: ["events"],
        summary: "Export als CSV: results.csv oder log.csv",
        security: staff,
        params: { type: "object", properties: { eventId: { type: "string", format: "uuid" }, file: { type: "string", enum: ["results.csv", "log.csv"] } } },
      },
    },
    async (req, reply) => {
      await authorizeEvent(db, req, req.params.eventId, "event.read");
      const event = await loadEvent(db, req.params.eventId);
      let csv: string;
      if (req.params.file === "results.csv") {
        const states = await allTeamStates(db, event);
        const names = new Map(states.map(({ team }) => [team.id, team.name]));
        csv = toCsv(
          ["Platz", "Team", "Punkte", "Stationen", "Fragmente", "Hinweise", "Im Ziel", "Zeit (s)"],
          computeStandings(event, states).map((r) => [r.rank, names.get(r.teamId), r.points, r.solved, r.fragments, r.hintsUsed, r.finished ? "ja" : "nein", r.finishTime === null ? "" : Math.round(r.finishTime)]),
        );
      } else {
        const rows = await db.query(
          `select l.at, l.kind, t.name as team, u.name as user_name, l.data from event_log l
           left join teams t on t.id = l.team_id left join users u on u.id = l.user_id where l.event_id = $1 order by l.id`,
          [event.id],
        );
        csv = toCsv(["Zeit", "Ereignis", "Team", "Person", "Daten"], rows.map((r) => [r.at.toISOString(), r.kind, r.team, r.user_name, JSON.stringify(r.data)]));
      }
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${req.params.file}"`)
        .send(csv);
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/live",
    {
      websocket: true,
      schema: {
        tags: ["events"],
        summary: "Live-Ereignisse fürs Dashboard (WebSocket, Token als access_token)",
        params: eventParams,
        querystring: { type: "object", properties: { access_token: { type: "string" } } },
      },
    },
    async (socket, req: FastifyRequest<{ Params: { eventId: string } }>) => {
      try {
        const { role } = await authorizeEvent(db, req, req.params.eventId, "event.read");
        live.subscribe(req.params.eventId, socket, can(role, "event.positions"));
        socket.send(JSON.stringify({ type: "hello", data: { eventId: req.params.eventId } }));
      } catch (err) {
        closeWithError(socket, err, req.log);
      }
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/sos",
    { schema: { tags: ["events"], summary: "SOS-Meldungen", security: staff, params: eventParams } },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.read");
      return db.query(
        `select s.*, t.name as team_name, t.emergency_phone, u.name as acknowledged_by_name from sos s
         join teams t on t.id = s.team_id left join users u on u.id = s.acknowledged_by
         where s.event_id = $1 order by s.resolved_at nulls first, s.client_time desc`,
        [req.params.eventId],
      );
    },
  );

  app.post<{ Params: { eventId: string; sosId: string; action: "ack" | "resolve" } }>(
    "/events/:eventId/sos/:sosId/:action",
    {
      schema: {
        tags: ["events"],
        summary: "SOS bestätigen (ack) oder als erledigt markieren (resolve)",
        security: staff,
        params: {
          type: "object",
          properties: { eventId: { type: "string", format: "uuid" }, sosId: { type: "string", format: "uuid" }, action: { type: "string", enum: ["ack", "resolve"] } },
        },
      },
    },
    async (req) => {
      const { user } = await authorizeEvent(db, req, req.params.eventId, "event.review");
      const row = await db.one(
        `update sos set acknowledged_by = coalesce(acknowledged_by, $3), acknowledged_at = coalesce(acknowledged_at, now()),
           resolved_at = case when $4 then coalesce(resolved_at, now()) else resolved_at end
         where id = $1 and event_id = $2 returning *`,
        [req.params.sosId, req.params.eventId, user.id, req.params.action === "resolve"],
      );
      if (!row) throw notFound("SOS");
      await logEvent(db, live, req.params.eventId, `sos_${req.params.action}`, { sosId: row.id }, { teamId: row.team_id, userId: user.id });
      live.publish(req.params.eventId, "sos", row);
      // Das Handy zeigt dem Team, dass der Alarm angekommen ist.
      live.poke(req.params.eventId, row.team_id, "sos");
      return row;
    },
  );
}

async function loadEventForUpdate(tx: Parameters<typeof loadEvent>[0], eventId: string) {
  await tx.query("select id from events where id = $1 for update", [eventId]);
  return loadEvent(tx, eventId);
}
