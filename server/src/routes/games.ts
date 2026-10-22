import type { FastifyInstance } from "fastify";
import { validateGame, type Game, type Text } from "@lykora/spec";
import type { Tx } from "../db.ts";
import { authorize, authorizeGame, requireUser } from "../lib/auth.ts";
import { newCode } from "../lib/crypto.ts";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.ts";
import { loadEvent, logEvent, resolveText, type EventRow } from "../services/events.ts";
import { TEST_EVENT_DAYS } from "../services/retention.ts";
import { eventDto, uniqueJoinCode } from "./events.ts";

const idParams = { type: "object", required: ["gameId"], properties: { gameId: { type: "string", format: "uuid" } } } as const;
const orgParams = { type: "object", properties: { orgId: { type: "string", format: "uuid" } } } as const;
const contentBody = {
  type: "object",
  required: ["content"],
  properties: { content: { type: "object", description: "Spiel im Lykora-Spielformat" }, comment: { type: "string" } },
} as const;
const revisionBody = {
  type: "object",
  required: ["revision"],
  properties: { revision: { type: "integer", minimum: 0, description: "Revision des Entwurfs, die der Client kennt" }, comment: { type: "string" } },
} as const;
const staff = [{ staff: [] }];
/** Entwürfe dürfen größer sein als sonstige Anfragen (App-Standard 2 MB). */
const DRAFT_BODY_LIMIT = 5 * 1024 * 1024;

type Q = Pick<Tx, "query" | "one">;

/** Zeile aus game_drafts, dazu der Name der Person, die zuletzt gespeichert hat. */
interface DraftRow {
  game_id: string;
  content: unknown;
  meta: Record<string, unknown>;
  revision: number;
  base_version: number | null;
  updated_at: Date;
  updated_by: string | null;
  updated_by_name: string | null;
}

/** Spiel für die Liste: neueste veröffentlichte Version und Stand des Entwurfs, ohne Inhalte. */
interface SummaryRow {
  id: string;
  title: string;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
  latest_version: number | null;
  draft_revision: number | null;
  draft_updated_at: Date | null;
  draft_updated_by: string | null;
  draft_base_version: number | null;
  draft_changed: boolean | null;
}

const SUMMARY_SQL = `
  select g.id, g.title, g.archived, g.created_at, g.updated_at, v.version as latest_version,
         d.revision as draft_revision, d.updated_at as draft_updated_at, u.name as draft_updated_by,
         d.base_version as draft_base_version, (v.version is null or d.content <> v.content) as draft_changed
  from games g
  left join lateral (select version, content from game_versions where game_id = g.id and kind = 'release' order by version desc limit 1) v on true
  left join game_drafts d on d.game_id = g.id
  left join users u on u.id = d.updated_by`;

function summary(row: SummaryRow) {
  const { draft_revision, draft_updated_at, draft_updated_by, draft_base_version, draft_changed, ...game } = row;
  return {
    ...game,
    draft:
      draft_revision === null
        ? null
        : { revision: draft_revision, updated_at: draft_updated_at, updated_by: draft_updated_by, base_version: draft_base_version, changed: draft_changed ?? true },
  };
}

/** Stand des Entwurfs eines Spiels; changed = weicht von der neuesten Version ab oder es gibt keine. */
async function draftSummary(db: Q, gameId: string) {
  const row = await db.one<{ revision: number; updated_at: Date; updated_by: string | null; base_version: number | null; changed: boolean }>(
    `select d.revision, d.updated_at, u.name as updated_by, d.base_version, (v.version is null or d.content <> v.content) as changed
     from game_drafts d left join users u on u.id = d.updated_by
     left join lateral (select version, content from game_versions where game_id = d.game_id and kind = 'release' order by version desc limit 1) v on true
     where d.game_id = $1`,
    [gameId],
  );
  return row ?? null;
}

async function loadDraft(db: Q, gameId: string): Promise<DraftRow | undefined> {
  return db.one<DraftRow>("select d.*, u.name as updated_by_name from game_drafts d left join users u on u.id = d.updated_by where d.game_id = $1", [gameId]);
}

function draftDto(d: DraftRow) {
  return {
    gameId: d.game_id,
    revision: d.revision,
    content: d.content,
    meta: d.meta,
    base_version: d.base_version,
    updated_at: d.updated_at,
    updated_by: d.updated_by ? { id: d.updated_by, name: d.updated_by_name ?? "" } : null,
  };
}

const noDraft = () => new HttpError(404, "no_draft", "Kein Entwurf vorhanden");
const noVersion = () => conflict("no_version", "Das Spiel ist noch nicht veröffentlicht");

/** 409 mit dem fremden Stand, damit der Baukasten ihn zeigen kann; null, wenn es gar keinen Entwurf gibt. */
function draftConflict(current: DraftRow | undefined): HttpError {
  const err = conflict("draft_conflict", "Der Entwurf wurde inzwischen von jemand anderem gespeichert");
  return Object.assign(err, { details: { draft: current ? draftDto(current) : null } });
}

function check(content: unknown): Game {
  const { errors, warnings } = validateGame(content);
  if (errors.length) {
    const err = badRequest("invalid_game", `Spiel ist ungültig: ${errors.slice(0, 5).join("; ")}`);
    Object.assign(err, { details: { errors, warnings } });
    throw err;
  }
  return content as Game;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Entwürfe werden nicht geprüft; nur ein Spiel im Lykora-Format soll es sein. */
function asDraft(content: unknown): Record<string, unknown> {
  if (!isObject(content) || !isObject(content.format) || content.format.name !== "lykora-game") {
    throw badRequest("not_a_game", "Das ist kein Lykora-Spiel");
  }
  return content;
}

const titleOf = (game: Game) => resolveText(game.meta.title, game.meta.languages[0] ?? "de");

/** Titel eines Entwurfs, der unvollständig sein darf. */
function draftTitle(content: Record<string, unknown>): string {
  const meta = isObject(content.meta) ? content.meta : {};
  const lang = Array.isArray(meta.languages) && typeof meta.languages[0] === "string" ? meta.languages[0] : "de";
  const title = typeof meta.title === "string" || isObject(meta.title) ? resolveText(meta.title as Text, lang) : "";
  return title.trim() || "Neues Spiel";
}

/** Materialliste aus den Requisiten aller Stationen; Entwürfe dürfen unvollständig sein, daher die Rückfälle. */
function materialsOf(game: Game) {
  const lang = game.meta?.languages?.[0] ?? "de";
  const stations = game.stations ?? [];
  const items = stations.flatMap((s) =>
    (s.props ?? []).map((p) => ({ station: s.id, stationName: resolveText(s.name, lang), ...p, quantity: p.quantity ?? 1 })),
  );
  const markers = stations
    .filter((s) => s.offPath)
    .map((s) => ({ station: s.id, stationName: resolveText(s.name, lang), name: "Knicklicht oder Reflektor", kind: "marker", quantity: 1 }));
  const triggers = stations.flatMap((s) =>
    (s.triggers ?? [])
      .filter((t) => t.type === "qr" || t.type === "nfc" || t.type === "box" || t.type === "ble")
      .map((t) => ({
        station: s.id,
        stationName: resolveText(s.name, lang),
        name: { qr: "QR-Code", nfc: "NFC-Tag", box: "ESP32-Box", ble: "BLE-Beacon" }[t.type as "qr" | "nfc" | "box" | "ble"],
        kind: "trigger",
        quantity: 1,
        note: "code" in t ? t.code : "tag" in t ? t.tag : "box" in t ? t.box : "uuid" in t ? t.uuid : undefined,
      })),
  );
  const gear = (game.safety?.requiredGear ?? []).map((g) => ({ name: resolveText(g, lang), kind: "team_gear", perTeam: true }));
  return { items: [...items, ...markers, ...triggers], teamGear: gear };
}

export default async function gameRoutes(app: FastifyInstance) {
  const { db, config, live } = app.deps;

  app.post<{ Body: { content: unknown } }>(
    "/validate",
    {
      schema: {
        tags: ["games"],
        summary: "Spiel prüfen, ohne zu speichern",
        body: { type: "object", required: ["content"], properties: { content: {} } },
      },
    },
    async (req) => {
      await requireUser(db, req);
      return validateGame(req.body.content);
    },
  );

  app.get<{ Params: { orgId: string } }>(
    "/orgs/:orgId/games",
    {
      schema: {
        tags: ["games"],
        summary: "Spiele einer Organisation",
        description: "latest_version ist null, solange nichts veröffentlicht ist; draft beschreibt den Entwurf des Baukastens oder ist null.",
        security: staff,
        params: orgParams,
      },
    },
    async (req) => {
      await authorize(db, req, req.params.orgId, "game.read");
      const rows = await db.query<SummaryRow>(`${SUMMARY_SQL} where g.org_id = $1 order by g.updated_at desc`, [req.params.orgId]);
      return rows.map(summary);
    },
  );

  app.post<{ Params: { orgId: string }; Body: { content: unknown; comment?: string } }>(
    "/orgs/:orgId/games",
    {
      schema: {
        tags: ["games"],
        summary: "Spiel anlegen",
        security: staff,
        params: orgParams,
        body: contentBody,
      },
    },
    async (req, reply) => {
      const { user } = await authorize(db, req, req.params.orgId, "game.write");
      const game = check(req.body.content);
      const created = await db.tx(async (tx) => {
        const g = await tx.one("insert into games (org_id, title) values ($1, $2) returning *", [req.params.orgId, titleOf(game)]);
        await tx.query("insert into game_versions (game_id, version, content, comment, created_by) values ($1, 1, $2, $3, $4)", [
          g.id,
          game,
          req.body.comment ?? null,
          user.id,
        ]);
        return g;
      });
      return reply.status(201).send({ ...created, latest_version: 1, draft: null });
    },
  );

  app.post<{ Params: { orgId: string }; Body: { content: unknown; meta?: Record<string, unknown> } }>(
    "/orgs/:orgId/games/drafts",
    {
      bodyLimit: DRAFT_BODY_LIMIT,
      schema: {
        tags: ["games"],
        summary: "Spiel als Entwurf anlegen, ohne Version",
        description: "Für den Baukasten: der Entwurf wird nicht geprüft und darf unvollständig sein. Eine Version entsteht erst beim Veröffentlichen.",
        security: staff,
        params: orgParams,
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "object", description: "Spiel im Lykora-Spielformat, darf ungültig sein" },
            meta: { type: "object", description: "Merker des Baukastens" },
          },
        },
      },
    },
    async (req, reply) => {
      const { user } = await authorize(db, req, req.params.orgId, "game.write");
      const content = asDraft(req.body.content);
      const gameId = await db.tx(async (tx) => {
        const g = await tx.one<{ id: string }>("insert into games (org_id, title) values ($1, $2) returning id", [req.params.orgId, draftTitle(content)]);
        await tx.query("insert into game_drafts (game_id, content, meta, updated_by) values ($1, $2, $3, $4)", [g!.id, content, req.body.meta ?? {}, user.id]);
        return g!.id;
      });
      const row = await db.one<SummaryRow>(`${SUMMARY_SQL} where g.id = $1`, [gameId]);
      return reply.status(201).send(summary(row!));
    },
  );

  app.get<{ Params: { gameId: string } }>(
    "/games/:gameId",
    {
      schema: {
        tags: ["games"],
        summary: "Spiel in der neuesten Version mit Versionsverlauf",
        description: "content und latest_version sind null, solange nichts veröffentlicht ist; draft beschreibt den Entwurf oder ist null.",
        security: staff,
        params: idParams,
      },
    },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const game = await db.one("select * from games where id = $1", [req.params.gameId]);
      const versions = await db.query(
        `select v.version, v.comment, v.created_at, u.name as created_by from game_versions v
         left join users u on u.id = v.created_by where v.game_id = $1 and v.kind = 'release' order by v.version desc`,
        [req.params.gameId],
      );
      const latest = await db.one("select content from game_versions where game_id = $1 and kind = 'release' order by version desc limit 1", [
        req.params.gameId,
      ]);
      return { ...game, latest_version: versions[0]?.version ?? null, content: latest?.content ?? null, versions, draft: await draftSummary(db, req.params.gameId) };
    },
  );

  app.put<{ Params: { gameId: string }; Body: { content: unknown; comment?: string } }>(
    "/games/:gameId",
    {
      schema: {
        tags: ["games"],
        summary: "Neue Version speichern",
        description: "Ältere Versionen bleiben erhalten; laufende Events behalten ihre Version.",
        security: staff,
        params: idParams,
        body: contentBody,
      },
    },
    async (req) => {
      const { user } = await authorizeGame(db, req, req.params.gameId, "game.write");
      const game = check(req.body.content);
      return db.tx(async (tx) => {
        // Sperrt das Spiel, damit zwei gleichzeitige Speicherungen keine doppelte Versionsnummer bekommen.
        await tx.query("select id from games where id = $1 for update", [req.params.gameId]);
        const v = await tx.one<{ version: number }>(
          `insert into game_versions (game_id, version, content, comment, created_by)
           select $1, coalesce(max(version) filter (where kind = 'release'), 0) + 1, $2, $3, $4 from game_versions where game_id = $1
           returning version`,
          [req.params.gameId, game, req.body.comment ?? null, user.id],
        );
        await tx.query("update games set title = $2, updated_at = now() where id = $1", [req.params.gameId, titleOf(game)]);
        return { id: req.params.gameId, version: v!.version };
      });
    },
  );

  app.get<{ Params: { gameId: string; version: number } }>(
    "/games/:gameId/versions/:version",
    {
      schema: {
        tags: ["games"],
        summary: "Eine bestimmte Version",
        security: staff,
        params: { type: "object", properties: { gameId: { type: "string", format: "uuid" }, version: { type: "integer" } } },
      },
    },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const v = await db.one(
        "select version, content, comment, created_at from game_versions where game_id = $1 and version = $2 and kind = 'release'",
        [req.params.gameId, req.params.version],
      );
      if (!v) throw notFound("Version");
      return v;
    },
  );

  app.delete<{ Params: { gameId: string } }>(
    "/games/:gameId",
    { schema: { tags: ["games"], summary: "Spiel archivieren", security: staff, params: idParams } },
    async (req, reply) => {
      await authorizeGame(db, req, req.params.gameId, "game.write");
      await db.query("update games set archived = true, updated_at = now() where id = $1", [req.params.gameId]);
      return reply.status(204).send();
    },
  );

  // Entwürfe des Baukastens: einer je Spiel, mit Revision gegen gleichzeitiges Speichern.

  app.get<{ Params: { gameId: string } }>(
    "/games/:gameId/draft",
    { schema: { tags: ["games"], summary: "Entwurf des Baukastens", description: "404 no_draft, wenn es keinen gibt.", security: staff, params: idParams } },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const draft = await loadDraft(db, req.params.gameId);
      if (!draft) throw noDraft();
      return draftDto(draft);
    },
  );

  app.put<{ Params: { gameId: string }; Body: { content: unknown; meta?: Record<string, unknown>; revision: number } }>(
    "/games/:gameId/draft",
    {
      bodyLimit: DRAFT_BODY_LIMIT,
      schema: {
        tags: ["games"],
        summary: "Entwurf speichern",
        description:
          "revision muss der gespeicherten entsprechen; ohne Entwurf legt revision 0 einen an. Sonst 409 draft_conflict mit dem fremden Stand als draft. Der Inhalt wird nicht geprüft.",
        security: staff,
        params: idParams,
        body: {
          type: "object",
          required: ["content", "revision"],
          properties: {
            content: { type: "object", description: "Spiel im Lykora-Spielformat, darf ungültig sein" },
            meta: { type: "object", description: "Merker des Baukastens" },
            revision: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req) => {
      const { user } = await authorizeGame(db, req, req.params.gameId, "game.write");
      const content = req.body.content as Record<string, unknown>;
      return db.tx(async (tx) => {
        // Sperrt das Spiel, damit Revision prüfen und schreiben zusammen passieren.
        await tx.query("select id from games where id = $1 for update", [req.params.gameId]);
        const current = await loadDraft(tx, req.params.gameId);
        if ((current?.revision ?? 0) !== req.body.revision) throw draftConflict(current);
        const saved = current
          ? await tx.one<{ revision: number; updated_at: Date }>(
              `update game_drafts set content = $2, meta = $3, revision = revision + 1, updated_by = $4, updated_at = now()
               where game_id = $1 returning revision, updated_at`,
              [req.params.gameId, content, req.body.meta ?? {}, user.id],
            )
          : await tx.one<{ revision: number; updated_at: Date }>(
              `insert into game_drafts (game_id, content, meta, base_version, updated_by)
               values ($1, $2, $3, (select max(version) from game_versions where game_id = $1 and kind = 'release'), $4)
               returning revision, updated_at`,
              [req.params.gameId, content, req.body.meta ?? {}, user.id],
            );
        await tx.query("update games set title = $2, updated_at = now() where id = $1", [req.params.gameId, draftTitle(content)]);
        return saved!;
      });
    },
  );

  app.delete<{ Params: { gameId: string } }>(
    "/games/:gameId/draft",
    {
      schema: {
        tags: ["games"],
        summary: "Entwurf verwerfen",
        description: "Nur bei einem Spiel mit Version, sonst 409 no_version: ohne Entwurf und Version ginge das Spiel verloren.",
        security: staff,
        params: idParams,
      },
    },
    async (req, reply) => {
      await authorizeGame(db, req, req.params.gameId, "game.write");
      const published = await db.one("select 1 from game_versions where game_id = $1 and kind = 'release'", [req.params.gameId]);
      if (!published) throw noVersion();
      await db.query("delete from game_drafts where game_id = $1", [req.params.gameId]);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { gameId: string }; Body: { revision: number; comment?: string } }>(
    "/games/:gameId/draft/publish",
    {
      schema: {
        tags: ["games"],
        summary: "Entwurf als neue Version veröffentlichen",
        description:
          "Prüft den Entwurf wie beim Hochladen (400 invalid_game mit errors und warnings) und legt die nächste Version an; der Entwurf bleibt. plannedEvents sind geplante Events dieses Spiels mit älterer Version.",
        security: staff,
        params: idParams,
        body: revisionBody,
      },
    },
    async (req) => {
      const { user } = await authorizeGame(db, req, req.params.gameId, "game.write");
      return db.tx(async (tx) => {
        await tx.query("select id from games where id = $1 for update", [req.params.gameId]);
        const draft = await loadDraft(tx, req.params.gameId);
        if (!draft) throw noDraft();
        if (draft.revision !== req.body.revision) throw draftConflict(draft);
        const game = check(draft.content);
        const v = await tx.one<{ version: number }>(
          `insert into game_versions (game_id, version, content, comment, created_by)
           select $1, coalesce(max(version) filter (where kind = 'release'), 0) + 1, $2, $3, $4 from game_versions where game_id = $1
           returning version`,
          [req.params.gameId, game, req.body.comment ?? null, user.id],
        );
        await tx.query("update game_drafts set base_version = $2 where game_id = $1", [req.params.gameId, v!.version]);
        await tx.query("update games set title = $2, updated_at = now() where id = $1", [req.params.gameId, titleOf(game)]);
        const plannedEvents = await tx.query<{ id: string; name: string; gameVersion: number; scheduledAt: Date | null }>(
          `select e.id, e.name, v.version as "gameVersion", e.scheduled_at as "scheduledAt"
           from events e join game_versions v on v.id = e.game_version_id
           where v.game_id = $1 and v.kind = 'release' and v.version < $2 and e.status = 'draft' and not e.test
           order by coalesce(e.scheduled_at, e.created_at)`,
          [req.params.gameId, v!.version],
        );
        return { version: v!.version, draft: await draftSummary(tx, req.params.gameId), plannedEvents };
      });
    },
  );

  app.post<{ Params: { gameId: string }; Body: { revision: number } }>(
    "/games/:gameId/test-events",
    {
      schema: {
        tags: ["games"],
        summary: "Probelauf: Test-Event mit dem aktuellen Entwurf anlegen",
        description:
          "Prüft den Entwurf wie beim Veröffentlichen, speichert ihn als Probestand ohne Versionsnummer und startet sofort ein Event mit test = true. Ein laufender Probelauf des Spiels wird beendet. Nach 7 Tagen wird alles gelöscht. Autoren dürfen das, weil der Probelauf zum Spiel gehört.",
        security: staff,
        params: idParams,
        body: { type: "object", required: ["revision"], properties: { revision: { type: "integer", minimum: 0 } } },
      },
    },
    async (req, reply) => {
      const { user, orgId } = await authorizeGame(db, req, req.params.gameId, "game.write");
      const { event, ended } = await db.tx(async (tx) => {
        await tx.query("select id from games where id = $1 for update", [req.params.gameId]);
        const draft = await loadDraft(tx, req.params.gameId);
        if (!draft) throw noDraft();
        if (draft.revision !== req.body.revision) throw draftConflict(draft);
        const game = check(draft.content);
        // Ein Probelauf je Spiel: laufende beenden, eine offene Pause schließen wie beim Statuswechsel.
        const running = await tx.query<{ id: string; pauses: EventRow["pauses"] }>(
          `select e.id, e.pauses from events e join game_versions v on v.id = e.game_version_id
           where v.game_id = $1 and e.test and e.status <> 'ended' for update of e`,
          [req.params.gameId],
        );
        const now = new Date().toISOString();
        for (const e of running) {
          const last = e.pauses.at(-1);
          const pauses = last && last.to === null ? [...e.pauses.slice(0, -1), { ...last, to: now }] : e.pauses;
          await tx.query("update events set status = 'ended', ended_at = now(), pauses = $2 where id = $1", [e.id, JSON.stringify(pauses)]);
          await logEvent(tx, live, e.id, "event_end", { reason: "Neuer Probelauf" }, { userId: user.id });
        }
        const v = await tx.one<{ id: string }>(
          "insert into game_versions (game_id, kind, content, comment, created_by) values ($1, 'test', $2, 'Probelauf', $3) returning id",
          [req.params.gameId, game, user.id],
        );
        const name = `Probelauf: ${titleOf(game)}`;
        // Läuft sofort: Autoren dürfen Events nicht starten, und das Testhandy soll gleich loslegen.
        const row = await tx.one<{ id: string }>(
          `insert into events (org_id, game_version_id, name, join_code, supervisor_pin, retention_days, test, status, started_at, created_by)
           values ($1, $2, $3, $4, $5, $6, true, 'running', now(), $7) returning id`,
          [orgId, v!.id, name, await uniqueJoinCode(tx), newCode(6), TEST_EVENT_DAYS, user.id],
        );
        await logEvent(tx, live, row!.id, "event_created", { name, test: true }, { userId: user.id });
        await logEvent(tx, live, row!.id, "event_start", { reason: "Probelauf" }, { userId: user.id });
        return { event: await loadEvent(tx, row!.id), ended: running.map((e) => e.id) };
      });
      for (const id of ended) {
        live.publish(id, "status", { status: "ended", reason: null });
        live.poke(id, null, "status");
      }
      return reply.status(201).send(eventDto(event, config.publicUrl, true));
    },
  );

  app.get<{ Params: { gameId: string }; Querystring: { source?: "draft" } }>(
    "/games/:gameId/materials",
    {
      schema: {
        tags: ["games"],
        summary: "Materialliste aus den Requisiten aller Stationen",
        description: "Aus der neuesten Version (ohne Version 409 no_version) oder mit source=draft aus dem Entwurf (ohne Entwurf 404 no_draft).",
        security: staff,
        params: idParams,
        querystring: { type: "object", properties: { source: { type: "string", enum: ["draft"] } } },
      },
    },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      if (req.query.source === "draft") {
        const draft = await loadDraft(db, req.params.gameId);
        if (!draft) throw noDraft();
        return materialsOf(draft.content as Game);
      }
      const latest = await db.one<{ content: Game }>(
        "select content from game_versions where game_id = $1 and kind = 'release' order by version desc limit 1",
        [req.params.gameId],
      );
      if (!latest) throw noVersion();
      return materialsOf(latest.content);
    },
  );
}
