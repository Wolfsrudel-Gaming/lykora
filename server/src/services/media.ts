import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Game } from "@lykora/spec";

export type MediaKind = "audio" | "image" | "video";

/** Erlaubte Content-Types beim Hochladen, mit Dateiendung und Art. */
export const MEDIA_TYPES: Record<string, { ext: string; kind: MediaKind }> = {
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/ogg": { ext: "ogg", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", kind: "audio" },
  "audio/wave": { ext: "wav", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/x-m4a": { ext: "m4a", kind: "audio" },
  "audio/aac": { ext: "aac", kind: "audio" },
  "audio/webm": { ext: "webm", kind: "audio" },
  "audio/flac": { ext: "flac", kind: "audio" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
};

/** Content-Type beim Ausliefern; je Endung genau einer. */
export const MEDIA_EXT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  flac: "audio/flac",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
};

export const MAX_MEDIA_SIZE = 30 * 1024 * 1024;

// Nur diese Dateinamen werden ausgeliefert; alles andere (../, Unterordner, versteckte Dateien) ist 404.
export const MEDIA_FILE = new RegExp(`^([0-9a-f]{64})\\.(${Object.keys(MEDIA_EXT_TYPES).join("|")})$`);
const LIBRARY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const LIBRARY_FILE = /^([a-z0-9][a-z0-9-]{0,63})\.ogg$/;

export const mediaDir = (dataDir: string) => join(dataDir, "media");

/** Dateiname einer hochgeladenen Datei: Prüfsumme plus Endung aus dem Content-Type. */
export const mediaFile = (sha256: string, contentType: string) => `${sha256}.${MEDIA_TYPES[contentType]?.ext ?? "bin"}`;

export const librarySrc = (id: string) => `media/lib/${id}.ogg`;

/**
 * Legt eine Datei inhaltsadressiert ab, falls sie noch fehlt. Geschrieben wird erst in eine
 * temporäre Datei im selben Ordner und dann umbenannt, damit nie eine halbe Datei ausgeliefert wird.
 */
export async function storeMediaFile(dataDir: string, file: string, data: Buffer): Promise<void> {
  const dir = mediaDir(dataDir);
  const target = join(dir, file);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.isFile() && existing.size === data.length) return;
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, data);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function removeMediaFile(dataDir: string, file: string): Promise<void> {
  await rm(join(mediaDir(dataDir), file), { force: true });
}

export interface LibrarySound {
  id: string;
  title: string;
  category: "ambience" | "sfx";
  loop: boolean;
  duration: number;
  license: string;
  credit: string;
}

/**
 * Liest library.json der Klangbibliothek. Fehlt die Datei, ist die Bibliothek leer;
 * Einträge ohne gültige ID oder ohne Klangdatei fallen weg.
 */
export async function loadLibrary(dir: string): Promise<LibrarySound[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "library.json"), "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("library.json muss eine Liste sein");
  const valid = list.filter((s): s is Record<string, unknown> => typeof s?.id === "string" && LIBRARY_ID.test(s.id));
  const present = await Promise.all(valid.map((s) => stat(join(dir, `${s.id}.ogg`)).then((i) => i.isFile(), () => false)));
  return valid
    .filter((_, i) => present[i])
    .map((s) => ({
      id: s.id as string,
      title: typeof s.title === "string" ? s.title : (s.id as string),
      category: s.category === "ambience" ? "ambience" : "sfx",
      loop: s.loop === true,
      duration: typeof s.duration === "number" ? s.duration : 0,
      license: typeof s.license === "string" ? s.license : "",
      credit: typeof s.credit === "string" ? s.credit : "",
    }));
}

/** src des Klangs für einen Cue: Medien-ID des Spiels (Typ audio) oder lib:<id> aus der Bibliothek. */
export async function resolveCueAudio(game: Game, audio: string, libraryDir: string): Promise<string | undefined> {
  if (audio.startsWith("lib:")) {
    const id = audio.slice(4);
    return (await loadLibrary(libraryDir)).some((s) => s.id === id) ? librarySrc(id) : undefined;
  }
  return game.media?.find((m) => m.id === audio && m.type === "audio")?.src;
}
