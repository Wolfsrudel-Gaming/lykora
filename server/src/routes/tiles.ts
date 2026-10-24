import type { FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "../lib/errors.ts";
import { sendFile } from "../lib/files.ts";

/** Paketnamen sind Ordnernamen; die enge Form schließt Pfadtricks aus. */
export const PACK_NAME = /^[a-z0-9-]{1,40}$/;
const COORD = /^(0|[1-9]\d{0,7})$/;
const MAX_ZOOM = 22;

const packParams = {
  type: "object",
  required: ["pack", "z", "x", "file"],
  properties: { pack: { type: "string" }, z: { type: "string" }, x: { type: "string" }, file: { type: "string" } },
} as const;

/**
 * Eigene Karte: Rasterkacheln aus MAP_PACKS_DIR (erzeugt mit server/tool/map_pack.py), öffentlich ohne
 * Anmeldung wie die Medien. Dashboard und App laden die Kacheln über die URL aus settings.map.tiles.
 */
export default async function tileRoutes(app: FastifyInstance) {
  const { config } = app.deps;

  app.get<{ Params: { pack: string; z: string; x: string; file: string } }>(
    "/tiles/:pack/:z/:x/:file",
    {
      schema: {
        tags: ["tiles"],
        summary: "Kachel eines Kartenpakets (PNG, 256 × 256), Adressform tiles/<paket>/{z}/{x}/{y}.png",
        params: packParams,
      },
    },
    async (req, reply) => {
      const { pack, z, x, file } = req.params;
      const y = /^(.+)\.png$/.exec(file)?.[1];
      if (!PACK_NAME.test(pack) || !COORD.test(z) || !COORD.test(x) || !y || !COORD.test(y) || Number(z) > MAX_ZOOM) throw notFound("Kachel");
      const n = 2 ** Number(z);
      if (Number(x) >= n || Number(y) >= n) throw notFound("Kachel");
      // Kacheln eines Pakets ändern sich nur, wenn jemand es neu erzeugt; danach fragt der Client per ETag nach.
      return sendFile(req, reply, join(config.mapPacksDir, pack, z, x, `${y}.png`), {
        contentType: "image/png",
        cacheControl: "public, max-age=604800",
      });
    },
  );

  app.get(
    "/api/tiles",
    {
      schema: {
        tags: ["tiles"],
        summary: "Kartenpakete des Servers mit Kachel-Adresse (ohne Anmeldung)",
        description:
          "tiles ist die Vorlage relativ zum Server, url die vollständige Adresse. Eines von beiden gehört in settings.map.tiles des Spiels.",
      },
    },
    async () => {
      const entries = await readdir(config.mapPacksDir, { withFileTypes: true }).catch(() => []);
      const packs = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !PACK_NAME.test(entry.name)) continue;
        let meta: any;
        try {
          meta = JSON.parse(await readFile(join(config.mapPacksDir, entry.name, "pack.json"), "utf8"));
        } catch {
          continue; // kein Paket ohne lesbare pack.json
        }
        if (!meta || typeof meta !== "object") continue;
        const template = `tiles/${entry.name}/{z}/{x}/{y}.png`;
        packs.push({
          ...meta,
          name: entry.name,
          tiles: template,
          url: `${config.publicUrl}/${template}`,
        });
      }
      return packs.sort((a, b) => a.name.localeCompare(b.name));
    },
  );
}
