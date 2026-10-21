import type { FastifyInstance, FastifyReply } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { contentTypeFor, sendFile } from "../lib/files.ts";

/** Platzhalter im index.html des Web-Builds; der Server setzt dort den Basispfad ein. */
export const BASE_PLACEHOLDER = "/__LYKORA_BASE__/";

const missingBuild = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${BASE_PLACEHOLDER}">
<title>Lykora</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
  body { max-width: 36rem; margin: 4rem auto; padding: 0 1rem; }
  code { font-size: 0.95em; }
</style>
</head>
<body>
<h1>Lykora</h1>
<p>Der Server läuft, aber das Web-Dashboard ist nicht gebaut.</p>
<p>Im Wurzelverzeichnis des Repos <code>npm run build -w @lykora/web</code> ausführen oder <code>WEB_DIR</code> auf den fertigen Build setzen.</p>
<p>Die API-Doku liegt unter <a href="api/docs">api/docs</a>.</p>
</body>
</html>
`;

/**
 * Liefert das Web-Dashboard aus (Single-Page-App). Jede Seite außerhalb von /api und /media bekommt
 * index.html, damit Links wie /lykora/events/<id> oder /lykora/join/<code> direkt funktionieren.
 */
export default async function webRoutes(app: FastifyInstance) {
  const { config } = app.deps;
  const base = `${config.basePath}/`;
  const root = resolve(config.webDir);

  async function sendIndex(reply: FastifyReply) {
    let html: string;
    try {
      html = await readFile(join(root, "index.html"), "utf8");
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
      html = missingBuild;
    }
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("x-content-type-options", "nosniff")
      .send(html.replaceAll(BASE_PLACEHOLDER, base));
  }

  if (config.basePath) {
    // Ohne Schrägstrich am Ende lösen die relativen Adressen der App falsch auf.
    app.get(config.basePath, { schema: { hide: true } }, async (req, reply) => {
      const query = req.url.indexOf("?");
      return reply.redirect(base + (query >= 0 ? req.url.slice(query) : ""));
    });
    app.get("/", { schema: { hide: true } }, async (_req, reply) => reply.redirect(base));
  }

  app.get(base, { schema: { hide: true } }, async (_req, reply) => sendIndex(reply));

  app.get<{ Params: { "*": string } }>(`${base}*`, { schema: { hide: true } }, async (req, reply) => {
    const rel = req.params["*"];
    const segments = rel.split("/");
    // API und Medien haben eigene Routen; was dort nicht passt, ist ein echtes 404.
    if (segments[0] === "api" || segments[0] === "media") return reply.callNotFound();
    if (rel === "index.html") return sendIndex(reply);

    // Keine versteckten Dateien, kein ../ und nichts außerhalb des Build-Ordners.
    if (/[\\\0]/.test(rel) || segments.some((s) => s.startsWith("."))) return reply.callNotFound();
    const path = resolve(root, rel);
    if (path.startsWith(root + sep)) {
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile()) {
        // Vite legt Assets mit Inhalts-Hash im Namen unter assets/ ab.
        const hashed = segments[0] === "assets";
        return sendFile(req, reply, path, {
          contentType: contentTypeFor(path),
          cacheControl: hashed ? "public, max-age=31536000, immutable" : "public, max-age=86400",
        });
      }
    }
    // Fehlende Dateien bekommen kein index.html, sonst landet HTML im Skript- oder Bild-Tag.
    if (extname(segments[segments.length - 1]!) !== "") return reply.callNotFound();
    return sendIndex(reply);
  });
}
