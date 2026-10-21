import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "./errors.ts";

/** Content-Types nach Dateiendung für statische Dateien. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Wertet einen Range-Header mit genau einem Bereich aus („bytes=0-99“, „bytes=100-“, „bytes=-500“).
 * null heißt: ganze Datei senden (kein oder nicht auswertbarer Header, mehrere Bereiche).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // Die letzten n Bytes
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] && Number(m[2]) < start) return null;
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

const tagList = (header: string) => header.split(",").map((t) => t.trim().replace(/^W\//, ""));

/** Ob der Client die Datei schon in dieser Fassung hat. */
function notModified(req: FastifyRequest, etag: string, mtime: Date): boolean {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch) return ifNoneMatch.trim() === "*" || tagList(ifNoneMatch).includes(etag);
  const since = Date.parse(req.headers["if-modified-since"] ?? "");
  return !Number.isNaN(since) && Math.floor(mtime.getTime() / 1000) * 1000 <= since;
}

/** If-Range: Teilbereich nur, wenn die Datei noch die ist, von der der Client schon einen Teil hat. */
function rangeAllowed(req: FastifyRequest, etag: string, mtime: Date): boolean {
  const ifRange = req.headers["if-range"];
  if (typeof ifRange !== "string") return true;
  if (ifRange.startsWith('"') || ifRange.startsWith("W/")) return ifRange === etag;
  return Math.floor(mtime.getTime() / 1000) * 1000 === Date.parse(ifRange);
}

/**
 * Sendet eine Datei mit Range-Anfragen (Abspielen und Spulen im Browser und in der App),
 * ETag und Last-Modified. Fehlt die Datei, gibt es 404.
 */
export async function sendFile(
  req: FastifyRequest,
  reply: FastifyReply,
  path: string,
  opts: { contentType: string; cacheControl: string },
): Promise<FastifyReply> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw notFound("Datei");
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  reply
    .header("content-type", opts.contentType)
    .header("cache-control", opts.cacheControl)
    .header("accept-ranges", "bytes")
    .header("etag", etag)
    .header("last-modified", info.mtime.toUTCString())
    .header("x-content-type-options", "nosniff");
  if (notModified(req, etag, info.mtime)) return reply.status(304).send();

  const range = rangeAllowed(req, etag, info.mtime) ? parseRange(req.headers.range, info.size) : null;
  if (range === "unsatisfiable") {
    return reply.status(416).header("content-range", `bytes */${info.size}`).header("content-type", "text/plain; charset=utf-8").send("");
  }
  if (range) {
    return reply
      .status(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${info.size}`)
      .header("content-length", range.end - range.start + 1)
      .send(createReadStream(path, range));
  }
  return reply.header("content-length", info.size).send(createReadStream(path));
}
