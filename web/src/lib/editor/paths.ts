/**
 * Paket A: Lesen und Schreiben im Entwurf über JSON-Pointer ("/stations/1/task/answers/0").
 * getAt liest tolerant (Entwürfe dürfen Lücken haben), setAt legt Zwischenobjekte an,
 * prune räumt nach einer Mutation Leeres aus dem geänderten Teilbaum.
 */

import type { JsonPointer } from "./types.ts";

type Json = Record<string, unknown>;

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");
const escape = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/** "/a/0/b" → ["a", "0", "b"]; "" und "/" sind die Wurzel. */
export function parsePointer(path: JsonPointer): string[] {
  if (!path || path === "/") return [];
  return path.replace(/^\//, "").split("/").map(unescape);
}

export function joinPointer(parts: readonly (string | number)[]): JsonPointer {
  return parts.length ? `/${parts.map((p) => escape(String(p))).join("/")}` : "";
}

/** Letztes Glied des Pfads, z. B. "answers" oder "0". */
export function lastKey(path: JsonPointer): string {
  const parts = parsePointer(path);
  return parts[parts.length - 1] ?? "";
}

/** Übergeordneter Pfad; die Wurzel bleibt die Wurzel. */
export function parentPointer(path: JsonPointer): JsonPointer {
  return joinPointer(parsePointer(path).slice(0, -1));
}

export function getAt<T = unknown>(obj: unknown, path: JsonPointer): T | undefined {
  let node: unknown = obj;
  for (const key of parsePointer(path)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Json)[key];
  }
  return node as T | undefined;
}

/**
 * Schreibt einen Wert; fehlende Zwischenstufen entstehen als Objekt oder, wenn der nächste
 * Schlüssel eine Zahl ist, als Liste. undefined entfernt das Feld.
 */
export function setAt(obj: object, path: JsonPointer, value: unknown): void {
  if (value === undefined) {
    removeAt(obj, path);
    return;
  }
  const parts = parsePointer(path);
  if (!parts.length) throw new Error("setAt: die Wurzel lässt sich nicht ersetzen");
  let node = obj as Json;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = node[key];
    if (next === null || typeof next !== "object") node[key] = /^\d+$/.test(parts[i + 1]!) ? [] : {};
    node = node[key] as Json;
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(node)) node[Number(last)] = value;
  else node[last] = value;
}

/** Entfernt ein Feld oder einen Listeneintrag (Liste rückt nach). Liefert, ob etwas da war. */
export function removeAt(obj: object, path: JsonPointer): boolean {
  const parts = parsePointer(path);
  if (!parts.length) return false;
  const parent = getAt<Json>(obj, joinPointer(parts.slice(0, -1)));
  if (parent === null || typeof parent !== "object") return false;
  const last = parts[parts.length - 1]!;
  if (Array.isArray(parent)) {
    const i = Number(last);
    if (!Number.isInteger(i) || i < 0 || i >= parent.length) return false;
    parent.splice(i, 1);
    return true;
  }
  if (!Object.hasOwn(parent, last)) return false;
  delete parent[last];
  return true;
}

/** Pflicht-Objekte des Spielformats, die auch leer stehen bleiben (sonst meldet das Schema „fehlt“ statt „ist leer“). */
const KEEP = new Set<JsonPointer>(["", "/format", "/meta", "/settings", "/field", "/field/boundary", "/field/assemblyPoint", "/stations", "/safety", "/safety/emergency"]);

/** Schlüssel, deren Werte zwar wie Sprachcodes heißen, aber keine Übersetzungen sind. */
const NOT_TEXT = new Set(["approach", "ui"]);
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** Übersetzungsobjekt { de: "…" }: bleibt unangetastet, auch { de: "" } (Pflichttext, der leer gemeldet wird). */
export function isTextObject(value: unknown, key = ""): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || NOT_TEXT.has(key)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => LANG.test(k)) && Object.values(value).every((v) => typeof v === "string");
}

const MATCH_DEFAULTS: Json = { ignoreCase: true, ignoreWhitespace: true, maxTypos: 1 };

/**
 * Leeres entfernen: undefined, null, "" (als Feld), {} und [] – außer an Pflichtstellen (KEEP) und
 * als Listeneintrag (ein frisch angelegter Eintrag darf leer sein). Dazu: ambience ohne audio und
 * match nur aus Standardwerten fallen weg. at ist der Pfad des Teilbaums im Spiel.
 * Liefert den bereinigten Wert oder undefined, wenn nichts übrig bleibt; Objekte werden in place geändert.
 */
export function prune<T>(value: T, at: JsonPointer = ""): T | undefined {
  return pruneAt(value, at, /^\d+$/.test(lastKey(at))) as T | undefined;
}

function pruneAt(value: unknown, at: JsonPointer, inList: boolean): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value === "" && !inList ? undefined : value;
  if (typeof value !== "object") return value;
  const key = lastKey(at);
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const next = pruneAt(value[i], `${at}/${i}`, true);
      if (next === undefined) value.splice(i, 1);
      else value[i] = next;
    }
    return value.length || KEEP.has(at) || inList ? value : undefined;
  }
  if (isTextObject(value, key)) return value;
  const obj = value as Json;
  for (const k of Object.keys(obj)) {
    const next = pruneAt(obj[k], `${at}/${escape(k)}`, false);
    if (next === undefined) delete obj[k];
    else obj[k] = next;
  }
  if (key === "ambience" && typeof obj.audio !== "string") return undefined;
  if (key === "match" && Object.keys(obj).every((k) => obj[k] === MATCH_DEFAULTS[k])) return undefined;
  return Object.keys(obj).length || KEEP.has(at) || inList ? obj : undefined;
}
