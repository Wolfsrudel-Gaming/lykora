import type { FastifyInstance } from "fastify";
import { validateGame, type Game } from "@lykora/spec";
import { authorize, authorizeGame, requireUser } from "../lib/auth.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { resolveText } from "../services/events.ts";

const idParams = { type: "object", required: ["gameId"], properties: { gameId: { type: "string", format: "uuid" } } } as const;
const contentBody = {
  type: "object",
  required: ["content"],
  properties: { content: { type: "object", description: "Spiel im Lykora-Spielformat" }, comment: { type: "string" } },
} as const;

function check(content: unknown): Game {
  const { errors, warnings } = validateGame(content);
  if (errors.length) {
    const err = badRequest("invalid_game", `Spiel ist ungültig: ${errors.slice(0, 5).join("; ")}`);
    Object.assign(err, { details: { errors, warnings } });
    throw err;
  }
  return content as Game;
}

const titleOf = (game: Game) => resolveText(game.meta.title, game.meta.languages[0] ?? "de");

export default async function gameRoutes(app: FastifyInstance) {
  const { db } = app.deps;

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
        security: [{ staff: [] }],
        params: { type: "object", properties: { orgId: { type: "string", format: "uuid" } } },
      },
    },
    async (req) => {
      await authorize(db, req, req.params.orgId, "game.read");
      return db.query(
        `select g.id, g.title, g.archived, g.created_at, g.updated_at,
                (select max(version) from game_versions v where v.game_id = g.id) as latest_version
         from games g where g.org_id = $1 order by g.updated_at desc`,
        [req.params.orgId],
      );
    },
  );

  app.post<{ Params: { orgId: string }; Body: { content: unknown; comment?: string } }>(
    "/orgs/:orgId/games",
    {
      schema: {
        tags: ["games"],
        summary: "Spiel anlegen",
        security: [{ staff: [] }],
        params: { type: "object", properties: { orgId: { type: "string", format: "uuid" } } },
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
      return reply.status(201).send({ ...created, latest_version: 1 });
    },
  );

  app.get<{ Params: { gameId: string } }>(
    "/games/:gameId",
    { schema: { tags: ["games"], summary: "Spiel in der neuesten Version mit Versionsverlauf", security: [{ staff: [] }], params: idParams } },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const game = await db.one("select * from games where id = $1", [req.params.gameId]);
      const versions = await db.query(
        `select v.version, v.comment, v.created_at, u.name as created_by from game_versions v
         left join users u on u.id = v.created_by where v.game_id = $1 order by v.version desc`,
        [req.params.gameId],
      );
      const latest = await db.one("select content from game_versions where game_id = $1 order by version desc limit 1", [req.params.gameId]);
      return { ...game, latest_version: versions[0]?.version, content: latest?.content, versions };
    },
  );

  app.put<{ Params: { gameId: string }; Body: { content: unknown; comment?: string } }>(
    "/games/:gameId",
    {
      schema: {
        tags: ["games"],
        summary: "Neue Version speichern",
        description: "Ältere Versionen bleiben erhalten; laufende Events behalten ihre Version.",
        security: [{ staff: [] }],
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
           select $1, coalesce(max(version), 0) + 1, $2, $3, $4 from game_versions where game_id = $1
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
        security: [{ staff: [] }],
        params: { type: "object", properties: { gameId: { type: "string", format: "uuid" }, version: { type: "integer" } } },
      },
    },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const v = await db.one("select version, content, comment, created_at from game_versions where game_id = $1 and version = $2", [
        req.params.gameId,
        req.params.version,
      ]);
      if (!v) throw notFound("Version");
      return v;
    },
  );

  app.delete<{ Params: { gameId: string } }>(
    "/games/:gameId",
    { schema: { tags: ["games"], summary: "Spiel archivieren", security: [{ staff: [] }], params: idParams } },
    async (req, reply) => {
      await authorizeGame(db, req, req.params.gameId, "game.write");
      await db.query("update games set archived = true, updated_at = now() where id = $1", [req.params.gameId]);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { gameId: string } }>(
    "/games/:gameId/materials",
    { schema: { tags: ["games"], summary: "Materialliste aus den Requisiten aller Stationen", security: [{ staff: [] }], params: idParams } },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const latest = await db.one<{ content: Game }>("select content from game_versions where game_id = $1 order by version desc limit 1", [
        req.params.gameId,
      ]);
      const game = latest!.content;
      const lang = game.meta.languages[0] ?? "de";
      const items = game.stations.flatMap((s) =>
        (s.props ?? []).map((p) => ({ station: s.id, stationName: resolveText(s.name, lang), ...p, quantity: p.quantity ?? 1 })),
      );
      const markers = game.stations
        .filter((s) => s.offPath)
        .map((s) => ({ station: s.id, stationName: resolveText(s.name, lang), name: "Knicklicht oder Reflektor", kind: "marker", quantity: 1 }));
      const triggers = game.stations.flatMap((s) =>
        s.triggers
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
      const gear = (game.safety.requiredGear ?? []).map((g) => ({ name: resolveText(g, lang), kind: "team_gear", perTeam: true }));
      return { items: [...items, ...markers, ...triggers], teamGear: gear };
    },
  );
}
