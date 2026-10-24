import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { authorizeEvent, requireTeam } from "../lib/auth.ts";
import { hashToken, newCode, newToken } from "../lib/crypto.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { closeWithError } from "../lib/live.ts";
import { TEAM_ACTIONS, elapsedAt } from "../engine/team.ts";
import {
  allTeamStates,
  computeStandings,
  loadEvent,
  loadTeam,
  logEvent,
  publicTeam,
  refreshTeam,
  summarizeState,
  supervisorRequired,
  type EventRow,
  type TeamRow,
} from "../services/events.ts";
import type { TeamState } from "../engine/team.ts";

const team = [{ team: [] }];
/** Bei „live mit verdeckten letzten Minuten“ wird die Rangliste so lange vor Schluss ausgeblendet. */
export const HIDDEN_LEADERBOARD_SECONDS = 600;
const UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

const point = {
  type: "object",
  required: ["lat", "lon"],
  properties: { lat: { type: "number", minimum: -90, maximum: 90 }, lon: { type: "number", minimum: -180, maximum: 180 }, accuracy: { type: "number", minimum: 0 } },
} as const;

interface SyncBody {
  deviceTime?: string;
  actions?: { id: string; type: (typeof TEAM_ACTIONS)[number]; time: string; payload?: Record<string, unknown> }[];
  positions?: { lat: number; lon: number; accuracy?: number; time: string }[];
  battery?: number;
  messagesAfter?: number;
  actionsAfter?: number;
}

function leaderboardVisible(event: EventRow, state: TeamState): boolean {
  const mode = event.game.settings.leaderboard ?? "live";
  if (event.status === "ended") return true;
  if (mode === "end_only") return false;
  if (mode === "live") return true;
  const time = event.game.settings.time;
  if (!time || time.limit === "none" || !time.duration) return true;
  const ctx = { game: event.game, eventStartedAt: event.started_at?.getTime() ?? null, pauses: event.pauses.map((p) => ({ from: Date.parse(p.from), to: p.to ? Date.parse(p.to) : null })) };
  const remaining = time.duration - elapsedAt(ctx, state, Date.now()) - state.timePenalty;
  return remaining > HIDDEN_LEADERBOARD_SECONDS;
}

function eventInfo(event: EventRow) {
  return { id: event.id, name: event.name, status: event.status, startedAt: event.started_at, endedAt: event.ended_at, pauses: event.pauses };
}

export default async function playRoutes(app: FastifyInstance) {
  const { db, config, live } = app.deps;

  app.post<{
    Body: {
      code: string;
      deviceCode?: string;
      device?: string;
      team?: {
        name: string;
        color?: string;
        members?: string[];
        emergencyPhone?: string;
        supervisorPin?: string;
      };
    };
  }>(
    "/join",
    {
      schema: {
        tags: ["play"],
        summary: "Einem Event beitreten",
        description: "Mit team wird ein neues Team angelegt. Mit deviceCode tritt ein weiteres Handy einem bestehenden Team bei.",
        body: {
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 4, maxLength: 12 },
            deviceCode: { type: "string", minLength: 4, maxLength: 8 },
            device: { type: "string", maxLength: 60 },
            team: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 60 },
                color: { type: "string", maxLength: 20 },
                members: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
                emergencyPhone: { type: "string", pattern: "^\\+?[0-9 ()/-]{5,}$" },
                supervisorPin: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const code = req.body.code.trim().toUpperCase();
      const ev = await db.one<{ id: string; status: string; supervisor_pin: string }>("select id, status, supervisor_pin from events where join_code = $1", [code]);
      if (!ev || ev.status === "ended") throw notFound("Event");
      const token = newToken();

      const result = await db.tx(async (tx) => {
        let row: TeamRow | undefined;
        if (req.body.deviceCode) {
          row = await tx.one<TeamRow>("select * from teams where event_id = $1 and device_code = $2", [ev.id, req.body.deviceCode.trim().toUpperCase()]);
          if (!row) throw notFound("Team");
        } else if (req.body.team) {
          const t = req.body.team;
          const supervisor = !!t.supervisorPin && t.supervisorPin.trim().toUpperCase() === ev.supervisor_pin;
          for (let i = 0; i < 10 && !row; i++) {
            row = await tx.one<TeamRow>(
              `insert into teams (event_id, name, color, members, emergency_phone, device_code, supervisor_present)
               values ($1, $2, $3, $4, $5, $6, $7) on conflict (event_id, device_code) do nothing returning *`,
              [ev.id, t.name.trim(), t.color ?? null, JSON.stringify(t.members ?? []), t.emergencyPhone ?? null, newCode(4), supervisor],
            ).catch((err) => {
              if (err.code === "23505") throw conflict("team_name_taken", "Diesen Teamnamen gibt es schon");
              throw err;
            });
          }
          if (!row) throw new Error("Kein freier Gerätecode gefunden");
          await logEvent(tx, live, ev.id, "team_joined", { name: row.name, supervisor }, { teamId: row.id });
        } else {
          throw badRequest("team_missing", "team oder deviceCode angeben");
        }
        await tx.query("insert into devices (token_hash, team_id, label) values ($1, $2, $3)", [hashToken(token), row.id, req.body.device ?? null]);
        return row;
      });
      live.publish(ev.id, "team_joined", publicTeam(result));
      return reply.status(201).send({ token, team: { ...publicTeam(result), deviceCode: result.device_code }, eventId: ev.id });
    },
  );

  app.get(
    "/play/game",
    {
      schema: {
        tags: ["play"],
        summary: "Spielpaket zum Herunterladen vor dem Start",
        description: "Enthält das komplette Spiel inklusive Lösungen, damit die App offline prüfen kann.",
        security: team,
      },
    },
    async (req) => {
      const auth = await requireTeam(db, req);
      const event = await loadEvent(db, auth.eventId);
      const t = await loadTeam(db, event.id, auth.teamId);
      return {
        serverTime: new Date(),
        event: eventInfo(event),
        team: { ...publicTeam(t), deviceCode: t.device_code },
        supervisorRequired: supervisorRequired(event.game),
        game: event.game,
      };
    },
  );

  app.post<{ Body: { pin: string } }>(
    "/play/supervisor",
    {
      schema: {
        tags: ["play"],
        summary: "Betreuer bestätigen, wenn die PIN beim Anlegen des Teams noch fehlte",
        security: team,
        body: { type: "object", required: ["pin"], properties: { pin: { type: "string", minLength: 4, maxLength: 12 } } },
      },
    },
    async (req) => {
      const auth = await requireTeam(db, req);
      const ev = await db.one<{ supervisor_pin: string }>("select supervisor_pin from events where id = $1", [auth.eventId]);
      if (req.body.pin.trim().toUpperCase() !== ev!.supervisor_pin) throw badRequest("wrong_pin", "Diese Betreuer-PIN stimmt nicht");
      return db.tx(async (tx) => {
        await tx.query("update teams set supervisor_present = true where id = $1", [auth.teamId]);
        const event = await loadEvent(tx, auth.eventId);
        const t = await loadTeam(tx, event.id, auth.teamId);
        // Der Betreuer-Status ändert, welche Aktionen zählen.
        await refreshTeam(tx, live, event, t);
        await logEvent(tx, live, event.id, "supervisor_confirmed", {}, { teamId: t.id });
        return { ...publicTeam(t), deviceCode: t.device_code };
      });
    },
  );

  app.post<{ Body: SyncBody }>(
    "/play/sync",
    {
      schema: {
        tags: ["play"],
        summary: "Offline gesammelte Aktionen und Positionen abgleichen",
        description: [
          "Aktionen tragen eine eindeutige id und ihren Zeitstempel; doppelt gesendete werden ignoriert.",
          "Mit deviceTime gleicht der Server eine falsch gehende Uhr des Handys aus.",
          "Die Antwort enthält den vom Server bestätigten Spielstand, neue Nachrichten (auch Klang-Cues mit kind cue),",
          "den Stand der eigenen SOS-Meldungen und den Event-Status.",
        ].join(" "),
        security: team,
        body: {
          type: "object",
          properties: {
            deviceTime: { type: "string", format: "date-time" },
            actions: {
              type: "array",
              maxItems: 500,
              items: {
                type: "object",
                required: ["id", "type", "time"],
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 64 },
                  type: { type: "string", enum: [...TEAM_ACTIONS] },
                  time: { type: "string", format: "date-time" },
                  payload: { type: "object" },
                },
              },
            },
            positions: {
              type: "array",
              maxItems: 5000,
              items: { ...point, required: ["lat", "lon", "time"], properties: { ...point.properties, time: { type: "string", format: "date-time" } } },
            },
            battery: { type: "number", minimum: 0, maximum: 1 },
            messagesAfter: { type: "integer", minimum: 0 },
            actionsAfter: { type: "integer", minimum: 0, description: "Liefert alle Aktionen des Teams ab dieser Nummer, auch von anderen Handys und der Spielleitung" },
          },
        },
      },
    },
    async (req) => {
      const auth = await requireTeam(db, req);
      const now = Date.now();
      const offset = req.body.deviceTime ? now - Date.parse(req.body.deviceTime) : 0;
      // Zeitstempel vom Handy korrigieren und nie in die Zukunft legen.
      const fix = (iso: string) => new Date(Math.min(Date.parse(iso) + offset, now));
      const actions = req.body.actions ?? [];
      const positions = req.body.positions ?? [];

      const { event, state, inserted } = await db.tx(async (tx) => {
        await tx.query("select id from teams where id = $1 for update", [auth.teamId]);
        const event = await loadEvent(tx, auth.eventId);
        const inserted: { id: string; type: string; payload: Record<string, unknown> }[] = [];
        for (const a of actions) {
          const row = await tx.one(
            `insert into actions (event_id, team_id, client_id, source, type, payload, client_time)
             values ($1, $2, $3, 'team', $4, $5, $6) on conflict (team_id, client_id) do nothing returning id`,
            [event.id, auth.teamId, a.id, a.type, a.payload ?? {}, fix(a.time)],
          );
          if (row) inserted.push({ id: a.id, type: a.type, payload: a.payload ?? {} });
          if (row && a.type === "heartbeat") {
            await tx.query("update teams set last_heartbeat_at = greatest(last_heartbeat_at, $2) where id = $1", [auth.teamId, fix(a.time)]);
          }
          if (row && a.type === "arrived") {
            await tx.query("update teams set arrived_at = coalesce(arrived_at, $2) where id = $1", [auth.teamId, fix(a.time)]);
          }
        }
        if (positions.length) {
          await tx.query(
            `insert into positions (event_id, team_id, lat, lon, accuracy, recorded_at)
             select $1, $2, p.lat, p.lon, p.accuracy, p.t from jsonb_to_recordset($3::jsonb) as p(lat float8, lon float8, accuracy float8, t timestamptz)`,
            [event.id, auth.teamId, JSON.stringify(positions.map((p) => ({ lat: p.lat, lon: p.lon, accuracy: p.accuracy ?? null, t: fix(p.time) })))],
          );
          const latest = positions.reduce((a, b) => (Date.parse(b.time) > Date.parse(a.time) ? b : a));
          await tx.query(
            `update teams set last_lat = $2, last_lon = $3, last_accuracy = $4, last_position_at = $5
             where id = $1 and (last_position_at is null or last_position_at < $5)`,
            [auth.teamId, latest.lat, latest.lon, latest.accuracy ?? null, fix(latest.time)],
          );
        }
        await tx.query("update teams set last_seen_at = now(), battery = coalesce($2, battery) where id = $1", [auth.teamId, req.body.battery ?? null]);
        const team = await loadTeam(tx, event.id, auth.teamId);
        const state = await refreshTeam(tx, live, event, team);
        const outcomes = new Map(state.outcomes.map((o) => [o.clientId, o]));
        for (const a of inserted) {
          if (a.type === "heartbeat") continue;
          await logEvent(tx, live, event.id, `team_${a.type}`, { ...a.payload, outcome: outcomes.get(a.id) }, { teamId: auth.teamId });
        }
        return { event, state, inserted };
      });

      if (positions.length) {
        const last = positions[positions.length - 1]!;
        live.publish(event.id, "position", { teamId: auth.teamId, lat: last.lat, lon: last.lon, accuracy: last.accuracy, at: fix(last.time) }, { positions: true });
      }

      const outcomes = new Map(state.outcomes.map((o) => [o.clientId, o]));
      const messages = await db.query(
        `select id, kind, sender, body, created_at from messages
         where event_id = $1 and direction = 'to_team' and (team_id = $2 or team_id is null) and id > $3 order by id limit 200`,
        [event.id, auth.teamId, req.body.messagesAfter ?? 0],
      );
      // Damit das Handy zeigen kann, dass die Spielleitung den Alarm gesehen hat.
      const sos = await db.query<{ id: string; client_id: string | null; channel: string; acknowledged_at: Date | null; resolved_at: Date | null; acknowledged_by: string | null }>(
        `select s.id, s.client_id, s.channel, s.acknowledged_at, s.resolved_at, u.name as acknowledged_by
         from sos s left join users u on u.id = s.acknowledged_by
         where s.team_id = $1 order by s.client_time desc, s.received_at desc limit 20`,
        [auth.teamId],
      );
      let leaderboard = null;
      if (leaderboardVisible(event, state)) {
        const states = await allTeamStates(db, event);
        const names = new Map(states.map(({ team }) => [team.id, team.name]));
        leaderboard = computeStandings(event, states).map((r) => ({ rank: r.rank, name: names.get(r.teamId), points: r.points, finished: r.finished, own: r.teamId === auth.teamId }));
      }
      // Vollständiges Protokoll seit dem Cursor, damit alle Handys des Teams denselben Stand rechnen.
      const log = await db.query<{ seq: number; client_id: string; source: string; type: string; payload: unknown; client_time: Date }>(
        "select id as seq, client_id, source, type, payload, client_time from actions where team_id = $1 and id > $2 order by id limit 2000",
        [auth.teamId, req.body.actionsAfter ?? 0],
      );
      const current = await loadTeam(db, event.id, auth.teamId);
      return {
        serverTime: new Date(now),
        event: eventInfo(event),
        team: { ...publicTeam(current), deviceCode: current.device_code },
        actions: log.map((a) => ({ seq: a.seq, id: a.client_id, source: a.source, type: a.type, payload: a.payload, time: a.client_time })),
        accepted: inserted.length,
        outcomes: actions.map((a) => outcomes.get(a.id) ?? { clientId: a.id, status: "ignored", reason: "unknown" }),
        state: summarizeState(state),
        messages,
        sos: sos.map((s) => ({
          id: s.id,
          clientId: s.client_id,
          channel: s.channel,
          acknowledgedAt: s.acknowledged_at,
          resolvedAt: s.resolved_at,
          acknowledgedBy: s.acknowledged_by,
        })),
        leaderboard,
        recall: event.status === "recalled" ? { assemblyPoint: event.game.field.assemblyPoint } : null,
      };
    },
  );

  app.get(
    "/play/live",
    {
      websocket: true,
      schema: {
        tags: ["play"],
        summary: "Anstupsen der App (WebSocket, Gerätetoken als access_token)",
        description: [
          "Sendet hello, danach poke mit reason (message, cue, status, action, sos, team), sobald das Team abgleichen soll,",
          "und alle 25 s ping. Ungültiger Token: Verbindung wird mit Code 4401 geschlossen.",
        ].join(" "),
        querystring: { type: "object", properties: { access_token: { type: "string" } } },
      },
    },
    async (socket, req: FastifyRequest) => {
      try {
        const auth = await requireTeam(db, req);
        live.subscribeTeam(auth.eventId, auth.teamId, socket);
        socket.send(JSON.stringify({ type: "hello" }));
      } catch (err) {
        closeWithError(socket, err, req.log);
      }
    },
  );

  app.post<{ Body: { id: string; time: string; lat?: number; lon?: number; accuracy?: number; message?: string; deferred?: boolean } }>(
    "/play/sos",
    {
      schema: {
        tags: ["play"],
        summary: "SOS auslösen",
        description: "deferred = true, wenn der Alarm offline ausgelöst und jetzt nachgeholt wird. Doppelte ids werden zusammengeführt.",
        security: team,
        body: {
          type: "object",
          required: ["id", "time"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 64 },
            time: { type: "string", format: "date-time" },
            lat: { type: "number", minimum: -90, maximum: 90 },
            lon: { type: "number", minimum: -180, maximum: 180 },
            accuracy: { type: "number", minimum: 0 },
            message: { type: "string", maxLength: 1000 },
            deferred: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const auth = await requireTeam(db, req);
      const b = req.body;
      const time = new Date(Math.min(Date.parse(b.time), Date.now()));
      const row = await db.one(
        `insert into sos (event_id, team_id, client_id, channel, lat, lon, accuracy, message, client_time)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (team_id, client_id) do nothing returning *`,
        [auth.eventId, auth.teamId, b.id, b.deferred ? "deferred" : "app", b.lat ?? null, b.lon ?? null, b.accuracy ?? null, b.message ?? null, time],
      );
      if (row) {
        const t = await loadTeam(db, auth.eventId, auth.teamId);
        live.publish(auth.eventId, "sos", { ...row, team_name: t.name, emergency_phone: t.emergency_phone });
        await logEvent(db, live, auth.eventId, "sos", { sosId: row.id, channel: row.channel, lat: row.lat, lon: row.lon, message: row.message }, { teamId: auth.teamId });
      }
      const event = await loadEvent(db, auth.eventId);
      return reply.status(row ? 201 : 200).send({
        received: true,
        emergency: event.game.safety.emergency,
        assemblyPoint: event.game.field.assemblyPoint,
      });
    },
  );

  app.post<{ Body: { id: string; body: string; kind?: "chat" | "predefined" } }>(
    "/play/messages",
    {
      schema: {
        tags: ["play"],
        summary: "Nachricht an die Spielleitung",
        security: team,
        body: {
          type: "object",
          required: ["id", "body"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 64 },
            body: { type: "string", minLength: 1, maxLength: 2000 },
            kind: { type: "string", enum: ["chat", "predefined"] },
          },
        },
      },
    },
    async (req, reply) => {
      const auth = await requireTeam(db, req);
      const row = await db.one(
        `insert into messages (event_id, team_id, direction, kind, body, client_id)
         values ($1, $2, 'from_team', $3, $4, $5)
         on conflict (team_id, client_id) where client_id is not null do nothing returning id, team_id, direction, kind, body, created_at`,
        [auth.eventId, auth.teamId, req.body.kind ?? "chat", req.body.body, req.body.id],
      );
      if (row) {
        live.publish(auth.eventId, "message", row);
        await logEvent(db, live, auth.eventId, "message_received", { kind: row.kind, body: row.body }, { teamId: auth.teamId });
      }
      return reply.status(201).send({ received: true, id: row?.id });
    },
  );

  // Fotos, Videos und Audio als Rohdaten mit passendem Content-Type.
  app.addContentTypeParser(Object.keys(UPLOAD_TYPES), { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.post<{ Querystring: { id?: string } }>(
    "/play/uploads",
    {
      bodyLimit: 50 * 1024 * 1024,
      schema: {
        tags: ["play"],
        summary: "Foto, Video oder Audio hochladen; die id kommt in die Antwort der Aufgabe",
        description: "Die App kann die id selbst vergeben (UUID), damit sie offline schon antworten und die Datei später nachreichen kann.",
        security: team,
        consumes: Object.keys(UPLOAD_TYPES),
        querystring: { type: "object", properties: { id: { type: "string", format: "uuid" } } },
      },
    },
    async (req, reply) => {
      const auth = await requireTeam(db, req);
      const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      const ext = UPLOAD_TYPES[type];
      if (!ext || !Buffer.isBuffer(req.body)) throw badRequest("unsupported_type", "Dateityp nicht unterstützt");
      const id = req.query.id ?? randomUUID();
      const existing = await db.one("select id from uploads where id = $1", [id]);
      if (existing) return reply.status(200).send({ id });
      const rel = join("uploads", auth.eventId, `${id}.${ext}`);
      await mkdir(join(config.dataDir, "uploads", auth.eventId), { recursive: true });
      await writeFile(join(config.dataDir, rel), req.body);
      await db.query("insert into uploads (id, event_id, team_id, content_type, size, path) values ($1, $2, $3, $4, $5, $6)", [
        id,
        auth.eventId,
        auth.teamId,
        type,
        req.body.length,
        rel,
      ]);
      live.publish(auth.eventId, "upload", { id, teamId: auth.teamId, contentType: type });
      return reply.status(201).send({ id });
    },
  );

  app.get<{ Params: { eventId: string; uploadId: string } }>(
    "/events/:eventId/uploads/:uploadId",
    {
      schema: {
        tags: ["staff"],
        summary: "Hochgeladene Datei ansehen",
        security: [{ staff: [] }],
        params: { type: "object", properties: { eventId: { type: "string", format: "uuid" }, uploadId: { type: "string", format: "uuid" } } },
      },
    },
    async (req, reply) => {
      await authorizeEvent(db, req, req.params.eventId, "event.review");
      const row = await db.one<{ path: string; content_type: string; size: number }>(
        "select path, content_type, size from uploads where id = $1 and event_id = $2",
        [req.params.uploadId, req.params.eventId],
      );
      if (!row) throw notFound("Datei");
      return reply.header("content-type", row.content_type).header("content-length", row.size).header("cache-control", "private, max-age=3600").send(createReadStream(join(config.dataDir, row.path)));
    },
  );
}
