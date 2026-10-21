import type { FastifyInstance } from "fastify";
import { authorizeEvent } from "../lib/auth.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { STAFF_ACTIONS } from "../engine/team.ts";
import type { Permission } from "../lib/roles.ts";
import { loadEvent, loadTeam, logEvent, publicTeam, refreshTeam, summarizeState } from "../services/events.ts";
import { resolveCueAudio } from "../services/media.ts";
import { randomUUID } from "node:crypto";

const staff = [{ staff: [] }];
const eventParams = { type: "object", required: ["eventId"], properties: { eventId: { type: "string", format: "uuid" } } } as const;
const teamParams = {
  type: "object",
  required: ["eventId", "teamId"],
  properties: { eventId: { type: "string", format: "uuid" }, teamId: { type: "string", format: "uuid" } },
} as const;

/** Prüfen und Freigeben dürfen auch Betreuer; alles andere nur die Spielleitung. */
const permissionFor = (type: string): Permission => (type === "staff_solve" || type === "staff_reject" ? "event.review" : "event.intervene");

export default async function staffRoutes(app: FastifyInstance) {
  const { db, config, live } = app.deps;

  app.post<{ Params: { eventId: string; teamId: string }; Body: { type: (typeof STAFF_ACTIONS)[number]; payload?: Record<string, unknown>; note?: string } }>(
    "/events/:eventId/teams/:teamId/actions",
    {
      schema: {
        tags: ["staff"],
        summary: "Eingriff bei einem Team",
        description: [
          "staff_reveal / staff_lock / staff_unlock {station}: Station frei- oder sperren",
          "staff_solve {station}: Station als gelöst werten, z. B. nach Foto-Prüfung oder vor Ort",
          "staff_reject {station}: eingereichte Lösung zurückweisen",
          "staff_points {amount}: Punkte vergeben oder abziehen",
          "staff_time {seconds}: Zeitstrafe (positiv) oder Gutschrift (negativ)",
          "staff_item {item, remove?}: Item geben oder nehmen",
        ].join("\n\n"),
        security: staff,
        params: teamParams,
        body: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: [...STAFF_ACTIONS] },
            payload: { type: "object" },
            note: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const { user } = await authorizeEvent(db, req, req.params.eventId, permissionFor(req.body.type));
      const payload = req.body.payload ?? {};
      const result = await db.tx(async (tx) => {
        const event = await loadEvent(tx, req.params.eventId);
        const team = await loadTeam(tx, event.id, req.params.teamId);
        if (payload.station !== undefined && !event.game.stations.some((s) => s.id === payload.station)) throw notFound("Station");
        if (req.body.type === "staff_item" && !(event.game.items ?? []).some((i) => i.id === payload.item)) throw notFound("Item");
        const clientId = `staff-${randomUUID()}`;
        await tx.query(
          `insert into actions (event_id, team_id, client_id, source, type, payload, client_time, user_id)
           values ($1, $2, $3, 'staff', $4, $5, now(), $6)`,
          [event.id, team.id, clientId, req.body.type, payload, user.id],
        );
        const state = await refreshTeam(tx, live, event, team);
        await logEvent(tx, live, event.id, req.body.type, { ...payload, note: req.body.note }, { teamId: team.id, userId: user.id });
        return { outcome: state.outcomes.find((o) => o.clientId === clientId), state: summarizeState(state) };
      });
      // Erst nach dem Commit, sonst holt sich das Handy noch den alten Stand.
      live.poke(req.params.eventId, req.params.teamId, "action");
      return result;
    },
  );

  app.patch<{ Params: { eventId: string; teamId: string }; Body: { name?: string; color?: string; supervisorPresent?: boolean; arrived?: boolean } }>(
    "/events/:eventId/teams/:teamId",
    {
      schema: {
        tags: ["staff"],
        summary: "Team bearbeiten, Betreuer bestätigen oder Ankunft am Sammelpunkt erfassen",
        security: staff,
        params: teamParams,
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 60 },
            color: { type: "string", maxLength: 20 },
            supervisorPresent: { type: "boolean" },
            arrived: { type: "boolean" },
          },
        },
      },
    },
    async (req) => {
      const { user } = await authorizeEvent(db, req, req.params.eventId, "event.review");
      const b = req.body;
      const updated = await db.tx(async (tx) => {
        const event = await loadEvent(tx, req.params.eventId);
        await loadTeam(tx, event.id, req.params.teamId);
        await tx.query(
          `update teams set name = coalesce($2, name), color = coalesce($3, color),
             supervisor_present = coalesce($4, supervisor_present),
             arrived_at = case when $5::boolean is null then arrived_at when $5 then coalesce(arrived_at, now()) else null end
           where id = $1`,
          [req.params.teamId, b.name ?? null, b.color ?? null, b.supervisorPresent ?? null, b.arrived ?? null],
        );
        const team = await loadTeam(tx, event.id, req.params.teamId);
        // Der Betreuer-Status ändert, welche Aktionen zählen.
        if (b.supervisorPresent !== undefined) await refreshTeam(tx, live, event, team);
        await logEvent(tx, live, event.id, "team_updated", { ...b }, { teamId: team.id, userId: user.id });
        return publicTeam(team);
      });
      live.poke(req.params.eventId, req.params.teamId, "team");
      return updated;
    },
  );

  app.get<{ Params: { eventId: string }; Querystring: { after?: number; teamId?: string } }>(
    "/events/:eventId/messages",
    {
      schema: {
        tags: ["staff"],
        summary: "Nachrichten des Events",
        security: staff,
        params: { type: "object", properties: { eventId: { type: "string", format: "uuid" } } },
        querystring: { type: "object", properties: { after: { type: "integer" }, teamId: { type: "string", format: "uuid" } } },
      },
    },
    async (req) => {
      await authorizeEvent(db, req, req.params.eventId, "event.read");
      return db.query(
        `select m.id, m.team_id, t.name as team_name, m.direction, m.kind, m.sender, m.body, m.created_at, m.read_at, u.name as user_name
         from messages m left join teams t on t.id = m.team_id left join users u on u.id = m.user_id
         where m.event_id = $1 and m.id > $2 and ($3::uuid is null or m.team_id = $3 or m.team_id is null) order by m.id limit 500`,
        [req.params.eventId, req.query.after ?? 0, req.query.teamId ?? null],
      );
    },
  );

  app.post<{ Params: { eventId: string }; Body: { teamId?: string | null; body: string; kind?: "chat" | "hint" | "story"; sender?: string } }>(
    "/events/:eventId/messages",
    {
      schema: {
        tags: ["staff"],
        summary: "Nachricht, Hinweis oder Figuren-Text an ein Team oder alle Teams senden",
        description: "teamId leer = an alle Teams. sender ist der angezeigte Absender, z. B. „Zentrale“ oder der Name einer Figur.",
        security: staff,
        params: { type: "object", properties: { eventId: { type: "string", format: "uuid" } } },
        body: {
          type: "object",
          required: ["body"],
          properties: {
            teamId: { type: ["string", "null"], format: "uuid" },
            body: { type: "string", minLength: 1, maxLength: 2000 },
            kind: { type: "string", enum: ["chat", "hint", "story"] },
            sender: { type: "string", maxLength: 60 },
          },
        },
      },
    },
    async (req, reply) => {
      const { user } = await authorizeEvent(db, req, req.params.eventId, "event.message");
      const teamId = req.body.teamId ?? null;
      if (teamId) await loadTeam(db, req.params.eventId, teamId);
      else if (req.body.kind === "hint") throw badRequest("hint_needs_team", "Hinweise gehen an ein bestimmtes Team");
      const msg = await db.one(
        `insert into messages (event_id, team_id, direction, kind, sender, body, user_id)
         values ($1, $2, 'to_team', $3, $4, $5, $6) returning id, team_id, direction, kind, sender, body, created_at`,
        [req.params.eventId, teamId, req.body.kind ?? "chat", req.body.sender ?? "hq", req.body.body, user.id],
      );
      await logEvent(db, live, req.params.eventId, "message_sent", { kind: msg.kind, body: msg.body }, { teamId, userId: user.id });
      live.publish(req.params.eventId, "message", msg);
      live.poke(req.params.eventId, teamId, "message");
      return reply.status(201).send(msg);
    },
  );

  app.post<{ Params: { eventId: string }; Body: { teamId?: string | null; audio: string; volume?: number; text?: string; sender?: string } }>(
    "/events/:eventId/cues",
    {
      schema: {
        tags: ["staff"],
        summary: "Klang live bei einem Team oder allen Teams abspielen (Klangpult)",
        description: [
          "audio ist die ID eines Klangs aus media des Spiels (Typ audio) oder lib:<id> aus der Klangbibliothek.",
          "teamId leer = an alle Teams. text erscheint dazu als Funkspruch.",
          "Gespeichert wird eine Nachricht mit kind cue; ihr body ist JSON mit audio, src, volume und text.",
        ].join(" "),
        security: staff,
        params: eventParams,
        body: {
          type: "object",
          required: ["audio"],
          properties: {
            teamId: { type: ["string", "null"], format: "uuid" },
            audio: { type: "string", minLength: 1, maxLength: 100 },
            volume: { type: "number", minimum: 0, maximum: 1 },
            text: { type: "string", maxLength: 300 },
            sender: { type: "string", maxLength: 60 },
          },
        },
      },
    },
    async (req, reply) => {
      const { user } = await authorizeEvent(db, req, req.params.eventId, "event.message");
      const teamId = req.body.teamId ?? null;
      if (teamId) await loadTeam(db, req.params.eventId, teamId);
      const event = await loadEvent(db, req.params.eventId);
      const { audio } = req.body;
      const src = await resolveCueAudio(event.game, audio, config.mediaLibraryDir);
      if (!src) throw badRequest("unknown_audio", `Den Klang „${audio}“ gibt es weder im Spiel noch in der Bibliothek`);
      const volume = req.body.volume ?? 0.8;
      const text = req.body.text?.trim() || undefined;
      const msg = await db.one(
        `insert into messages (event_id, team_id, direction, kind, sender, body, user_id)
         values ($1, $2, 'to_team', 'cue', $3, $4, $5) returning id, team_id, direction, kind, sender, body, created_at`,
        [event.id, teamId, req.body.sender ?? "hq", JSON.stringify({ audio, src, volume, text }), user.id],
      );
      await logEvent(db, live, event.id, "cue_sent", { audio, src, volume, text }, { teamId, userId: user.id });
      live.publish(event.id, "message", msg);
      live.poke(event.id, teamId, "cue");
      return reply.status(201).send(msg);
    },
  );
}
