import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { notFound } from "../lib/errors.ts";
import { sendFile } from "../lib/files.ts";
import { LIBRARY_FILE, MEDIA_EXT_TYPES, MEDIA_FILE, mediaDir } from "../services/media.ts";

const fileParams = { type: "object", required: ["file"], properties: { file: { type: "string" } } } as const;

/**
 * Öffentliche Medien ohne Anmeldung: hochgeladene Dateien der Spiele und die Klangbibliothek.
 * Die App lädt sie vor dem Start herunter, das Dashboard spielt sie zum Vorhören ab.
 */
export default async function fileRoutes(app: FastifyInstance) {
  const { config } = app.deps;

  app.get<{ Params: { file: string } }>(
    "/media/:file",
    {
      schema: {
        tags: ["media"],
        summary: "Hochgeladene Datei, benannt nach ihrer SHA-256-Prüfsumme (mit Range-Anfragen)",
        params: fileParams,
      },
    },
    async (req, reply) => {
      const m = MEDIA_FILE.exec(req.params.file);
      if (!m) throw notFound("Datei");
      // Der Name ist die Prüfsumme, der Inhalt ändert sich also nie.
      return sendFile(req, reply, join(mediaDir(config.dataDir), req.params.file), {
        contentType: MEDIA_EXT_TYPES[m[2]!]!,
        cacheControl: "public, max-age=31536000, immutable",
      });
    },
  );

  app.get<{ Params: { file: string } }>(
    "/media/lib/:file",
    { schema: { tags: ["media"], summary: "Klang aus der mitgelieferten Bibliothek (mit Range-Anfragen)", params: fileParams } },
    async (req, reply) => {
      if (!LIBRARY_FILE.test(req.params.file)) throw notFound("Datei");
      // Die Bibliothek kann mit einem Update neu erzeugt werden; nach einem Tag fragt der Client per ETag nach.
      return sendFile(req, reply, join(config.mediaLibraryDir, req.params.file), {
        contentType: "audio/ogg",
        cacheControl: "public, max-age=86400",
      });
    },
  );
}
