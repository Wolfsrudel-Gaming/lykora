import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { authorizeGame } from "../lib/auth.ts";
import { HttpError, badRequest, conflict, notFound } from "../lib/errors.ts";
import {
  MAX_MEDIA_SIZE,
  MEDIA_TYPES,
  librarySrc,
  loadLibrary,
  mediaFile,
  removeMediaFile,
  storeMediaFile,
  type MediaKind,
} from "../services/media.ts";

interface MediaRow {
  id: string;
  game_id: string;
  org_id: string;
  sha256: string;
  filename: string;
  content_type: string;
  kind: MediaKind;
  size: number;
  created_by: string | null;
  created_at: Date;
}

const staff = [{ staff: [] }];
const unsupportedType = () => new HttpError(415, "unsupported_type", "Dateityp nicht unterstützt");
const gameParams = { type: "object", required: ["gameId"], properties: { gameId: { type: "string", format: "uuid" } } } as const;
/** Sperrt eine Prüfsumme, damit Hochladen und Löschen derselben Datei nicht durcheinanderkommen. */
const LOCK_SQL = "select pg_advisory_xact_lock(4711002, hashtext($1))";

/** Nur der Dateiname, ohne Pfad und Steuerzeichen. */
function cleanFilename(name: string | undefined, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return base.slice(0, 200) || fallback;
}

const contentTypeOf = (req: FastifyRequest) => (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();

export default async function mediaRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  /** Ergebnis der Rechteprüfung vor dem Lesen des Bodys, je Anfrage. */
  const uploaders = new WeakMap<FastifyRequest, { userId: string; orgId: string }>();

  const dto = (row: MediaRow) => {
    const file = mediaFile(row.sha256, row.content_type);
    return {
      id: row.id,
      gameId: row.game_id,
      sha256: row.sha256,
      filename: row.filename,
      contentType: row.content_type,
      type: row.kind,
      size: row.size,
      src: `media/${file}`,
      url: `${config.publicUrl}/media/${file}`,
      createdAt: row.created_at,
    };
  };

  // Rohdaten nur für diesen einen Endpunkt; alle anderen Endpunkte bleiben bei JSON.
  await app.register(async (scope) => {
    scope.addContentTypeParser(Object.keys(MEDIA_TYPES), { parseAs: "buffer", bodyLimit: MAX_MEDIA_SIZE }, (_req, body, done) => done(null, body));

    scope.post<{ Params: { gameId: string }; Querystring: { filename?: string } }>(
      "/games/:gameId/media",
      {
        bodyLimit: MAX_MEDIA_SIZE,
        schema: {
          tags: ["media"],
          summary: "Klang, Bild oder Video für ein Spiel hochladen",
          description: [
            "Die Datei kommt als Rohdaten im Body, mit passendem Content-Type, höchstens 30 MB.",
            "src aus der Antwort gehört in media[].src des Spiels. Gleiche Dateien liegen nur einmal auf dem Server;",
            "ist die Datei im Spiel schon vorhanden, kommt der bestehende Eintrag mit Status 200 zurück.",
          ].join(" "),
          security: staff,
          consumes: Object.keys(MEDIA_TYPES),
          params: gameParams,
          querystring: { type: "object", properties: { filename: { type: "string", maxLength: 255 } } },
        },
        // Rechte und Typ prüfen, bevor bis zu 30 MB gelesen werden; sonst könnte jeder ohne Anmeldung den Speicher füllen.
        onRequest: async (req) => {
          const { user, orgId } = await authorizeGame(db, req, req.params.gameId, "game.write");
          if (!MEDIA_TYPES[contentTypeOf(req)]) throw unsupportedType();
          uploaders.set(req, { userId: user.id, orgId });
        },
      },
      async (req, reply) => {
        const uploader = uploaders.get(req)!;
        const contentType = contentTypeOf(req);
        const type = MEDIA_TYPES[contentType];
        if (!type || !Buffer.isBuffer(req.body)) throw unsupportedType();
        if (req.body.length === 0) throw badRequest("empty_file", "Die Datei ist leer");
        const data = req.body;
        const sha256 = createHash("sha256").update(data).digest("hex");
        const { row, created } = await db.tx(async (tx) => {
          await tx.query(LOCK_SQL, [sha256]);
          const inserted = await tx.one<MediaRow>(
            `insert into game_media (game_id, org_id, sha256, filename, content_type, kind, size, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (game_id, sha256) do nothing returning *`,
            [req.params.gameId, uploader.orgId, sha256, cleanFilename(req.query.filename, `${sha256.slice(0, 12)}.${type.ext}`), contentType, type.kind, data.length, uploader.userId],
          );
          const row = inserted ?? (await tx.one<MediaRow>("select * from game_media where game_id = $1 and sha256 = $2", [req.params.gameId, sha256]))!;
          // Auch beim bestehenden Eintrag: fehlt die Datei aus irgendeinem Grund, liegt sie danach wieder da.
          await storeMediaFile(config.dataDir, mediaFile(row.sha256, row.content_type), data);
          return { row, created: !!inserted };
        });
        return reply.status(created ? 201 : 200).send(dto(row));
      },
    );
  });

  app.get<{ Params: { gameId: string } }>(
    "/games/:gameId/media",
    { schema: { tags: ["media"], summary: "Hochgeladene Medien eines Spiels, neueste zuerst", security: staff, params: gameParams } },
    async (req) => {
      await authorizeGame(db, req, req.params.gameId, "game.read");
      const rows = await db.query<MediaRow>("select * from game_media where game_id = $1 order by created_at desc, id", [req.params.gameId]);
      return rows.map(dto);
    },
  );

  app.delete<{ Params: { gameId: string; mediaId: string } }>(
    "/games/:gameId/media/:mediaId",
    {
      schema: {
        tags: ["media"],
        summary: "Medium aus einem Spiel entfernen",
        description: "Die Datei selbst bleibt, solange ein anderer Eintrag sie nutzt. Nutzt ein noch nicht beendetes Event oder der Entwurf sie, gibt es 409.",
        security: staff,
        params: {
          type: "object",
          required: ["gameId", "mediaId"],
          properties: { gameId: { type: "string", format: "uuid" }, mediaId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      await authorizeGame(db, req, req.params.gameId, "game.write");
      await db.tx(async (tx) => {
        const row = await tx.one<MediaRow>("select * from game_media where id = $1 and game_id = $2", [req.params.mediaId, req.params.gameId]);
        if (!row) throw notFound("Medium");
        await tx.query(LOCK_SQL, [row.sha256]);
        const file = mediaFile(row.sha256, row.content_type);
        // Events spielen eine feste Version des Spiels; deren Teams laden die Datei unter Umständen erst später.
        const inUse = await tx.one<{ name: string }>(
          `select e.name from events e join game_versions v on v.id = e.game_version_id
           where v.game_id = $1 and e.status <> 'ended'
             and exists (select 1 from jsonb_array_elements(coalesce(v.content->'media', '[]'::jsonb)) m where m->>'src' in ($2, $3))
           order by e.created_at limit 1`,
          [row.game_id, `media/${file}`, `${config.publicUrl}/media/${file}`],
        );
        if (inUse) throw conflict("media_in_use", `Das Event „${inUse.name}“ nutzt diese Datei noch`);
        // Der Entwurf des Baukastens darf nicht auf eine fehlende Datei zeigen; erst dort entfernen, dann löschen.
        const inDraft = await tx.one(
          `select 1 from game_drafts d
           where d.game_id = $1 and jsonb_typeof(d.content->'media') = 'array'
             and exists (select 1 from jsonb_array_elements(d.content->'media') m where m->>'src' in ($2, $3))`,
          [row.game_id, `media/${file}`, `${config.publicUrl}/media/${file}`],
        );
        if (inDraft) throw conflict("media_in_use", "Der Entwurf des Spiels nutzt diese Datei noch; entferne sie zuerst dort");
        await tx.query("delete from game_media where id = $1", [row.id]);
        const others = await tx.query<{ content_type: string }>("select content_type from game_media where sha256 = $1", [row.sha256]);
        if (!others.some((o) => mediaFile(row.sha256, o.content_type) === file)) await removeMediaFile(config.dataDir, file);
      });
      return reply.status(204).send();
    },
  );

  app.get(
    "/library/sounds",
    {
      schema: {
        tags: ["media"],
        summary: "Mitgelieferte Klangbibliothek (CC0), ohne Anmeldung",
        description: "Im Spiel als media-Eintrag mit diesem src verwenden oder im Klangpult als lib:<id> einspielen.",
      },
    },
    async () => {
      const sounds = await loadLibrary(config.mediaLibraryDir);
      return sounds.map((s) => ({
        id: s.id,
        title: s.title,
        category: s.category,
        loop: s.loop,
        duration: s.duration,
        src: librarySrc(s.id),
        url: `${config.publicUrl}/${librarySrc(s.id)}`,
        license: s.license,
        credit: s.credit,
      }));
    },
  );
}
