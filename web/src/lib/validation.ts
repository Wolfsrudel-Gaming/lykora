/**
 * Prüfergebnisse des Servers (POST /validate) verständlich machen: Pfade wie
 * „/stations/2/task“ werden zu „Station „Der alte Baum“ › Aufgabe“, englische
 * Schema-Meldungen zu deutschen Sätzen.
 */

import { text } from "./format.ts";

export interface ReadableError {
  /** Wo im Spiel, lesbar */
  where: string;
  message: string;
  /** Meldung des Servers unverändert, für Fachleute */
  raw: string;
}

const FIELD_LABELS: Record<string, string> = {
  meta: "Angaben",
  title: "Titel",
  summary: "Kurzbeschreibung",
  languages: "Sprachen",
  settings: "Grundregeln",
  time: "Zeit",
  field: "Spielfeld",
  boundary: "Grenze",
  assemblyPoint: "Sammelpunkt",
  restrictedZones: "Sperrzonen",
  rescuePoints: "Rettungspunkte",
  story: "Geschichte",
  chapters: "Kapitel",
  characters: "Figuren",
  fragments: "Fragmente",
  items: "Gegenstände",
  stations: "Stationen",
  triggers: "Auslöser",
  task: "Aufgabe",
  answers: "Antworten",
  options: "Optionen",
  hints: "Hinweise",
  rewards: "Belohnung",
  props: "Requisiten",
  scene: "Szene",
  arrival: "Ankunft",
  beats: "Takte",
  afterSolve: "Nach dem Lösen",
  rules: "Regeln",
  safety: "Sicherheit",
  emergency: "Notfall",
  heartbeat: "Lebenszeichen",
  sound: "Klang",
  ambience: "Atmosphäre",
  approach: "Annäherung",
  solved: "Lösungsgeräusch",
  media: "Medien",
  location: "Ort",
  name: "Name",
  question: "Frage",
};

type Json = Record<string, unknown>;

function labelled(list: unknown, index: number, noun: string, lang: string): string {
  const entry = Array.isArray(list) ? (list[index] as Json | undefined) : undefined;
  const id = typeof entry?.id === "string" ? entry.id : null;
  const name = entry && (typeof entry.name === "string" || typeof entry.name === "object") ? text(entry.name as never, lang) : "";
  const title = entry && (typeof entry.title === "string" || typeof entry.title === "object") ? text(entry.title as never, lang) : "";
  const label = name || title;
  if (label && id) return `${noun} „${label}“ (${id})`;
  if (id) return `${noun} ${id}`;
  return `${noun} ${index + 1}`;
}

const NOUNS: Record<string, string> = {
  stations: "Station",
  chapters: "Kapitel",
  characters: "Figur",
  fragments: "Fragment",
  items: "Gegenstand",
  media: "Medium",
  rules: "Regel",
  restrictedZones: "Sperrzone",
  rescuePoints: "Rettungspunkt",
  triggers: "Auslöser",
  hints: "Hinweis",
  options: "Option",
  answers: "Antwort",
  beats: "Takt",
  arrival: "Ankunft-Takt",
  afterSolve: "Takt nach dem Lösen",
  props: "Requisite",
};

/** JSON-Pfad wie „/stations/0/task“ in Worte fassen. */
export function describePath(path: string, game?: unknown): string {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return "Spiel";
  const lang = (game as { meta?: { languages?: string[] } })?.meta?.languages?.[0] ?? "de";
  const out: string[] = [];
  let node: unknown = game;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!;
    const next = parts[i + 1];
    const container = node as Json | undefined;
    const value = container?.[key];
    if (next !== undefined && /^\d+$/.test(next) && NOUNS[key]) {
      out.push(labelled(value, Number(next), NOUNS[key], lang));
      node = Array.isArray(value) ? value[Number(next)] : undefined;
      i++;
      continue;
    }
    out.push(FIELD_LABELS[key] ?? key);
    node = value;
  }
  return out.join(" › ");
}

const TYPES: Record<string, string> = {
  string: "Text",
  number: "eine Zahl",
  integer: "eine ganze Zahl",
  boolean: "ja oder nein",
  object: "ein Objekt",
  array: "eine Liste",
  null: "leer",
};

/** Englische Meldung des Schema-Prüfers auf Deutsch. */
export function translateMessage(message: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^must have required property '(.+)'$/.exec(message))) return `Pflichtangabe „${FIELD_LABELS[m[1]!] ?? m[1]}“ fehlt`;
  if (message === "must NOT have additional properties") return "enthält ein Feld, das es im Spielformat nicht gibt";
  if (message === "must be equal to one of the allowed values") return "dieser Wert ist nicht erlaubt";
  if (message === "must be equal to constant") return "der Wert muss genau stimmen";
  if ((m = /^must match pattern "(.+)"$/.exec(message))) {
    return m[1] === "^[a-z0-9][a-z0-9_-]{0,63}$" ? "ID nur aus Kleinbuchstaben, Ziffern, - und _ (ohne Umlaute und Leerzeichen)" : "das Format stimmt nicht";
  }
  if ((m = /^must be (\w+)$/.exec(message)) && TYPES[m[1]!]) return `muss ${TYPES[m[1]!]} sein`;
  if (/^must be [\w,]+$/.test(message)) return "hat den falschen Typ";
  if ((m = /^must NOT have fewer than (\d+) items$/.exec(message))) return `braucht mindestens ${m[1]} ${m[1] === "1" ? "Eintrag" : "Einträge"}`;
  if ((m = /^must NOT have more than (\d+) items$/.exec(message))) return `höchstens ${m[1]} ${m[1] === "1" ? "Eintrag" : "Einträge"} erlaubt`;
  if ((m = /^must NOT have fewer than (\d+) characters$/.exec(message))) return `mindestens ${m[1]} Zeichen`;
  if ((m = /^must NOT have more than (\d+) characters$/.exec(message))) return `höchstens ${m[1]} Zeichen`;
  if ((m = /^must be >= (-?[\d.]+)$/.exec(message))) return `muss mindestens ${m[1]} sein`;
  if ((m = /^must be <= (-?[\d.]+)$/.exec(message))) return `darf höchstens ${m[1]} sein`;
  if ((m = /^must be > (-?[\d.]+)$/.exec(message))) return `muss größer als ${m[1]} sein`;
  if ((m = /^must be < (-?[\d.]+)$/.exec(message))) return `muss kleiner als ${m[1]} sein`;
  if (message === "must match exactly one schema in oneOf" || message === "must match a schema in anyOf") return "passt zu keiner der erlaubten Formen";
  if (/^must match "(then|else)" schema$/.test(message)) return "Angaben passen nicht zusammen";
  if (message === "must NOT have duplicate items") return "enthält doppelte Einträge";
  return message;
}

/** Eine Meldung des Servers lesbar machen. Schema-Fehler beginnen mit dem Pfad, Querverweise mit „bereich: …“. */
export function describeError(raw: string, game?: unknown): ReadableError {
  if (raw.startsWith("/")) {
    const space = raw.indexOf(" ");
    const path = space < 0 ? raw : raw.slice(0, space);
    const message = space < 0 ? "" : raw.slice(space + 1);
    return { where: describePath(path, game), message: translateMessage(message), raw };
  }
  const colon = raw.indexOf(": ");
  if (colon > 0 && /^[\w.[\]-]+$/.test(raw.slice(0, colon))) {
    const where = raw
      .slice(0, colon)
      .replace(/\[([^\]]+)\]/g, "/$1")
      .split(/[./]/)
      .filter(Boolean)
      .map((p) => FIELD_LABELS[p] ?? p)
      .join(" › ");
    return { where, message: raw.slice(colon + 2), raw };
  }
  return { where: "Spiel", message: raw, raw };
}

/**
 * Stelle des ersten Syntaxfehlers in einem JSON-Text. Browser nennen sie in ihren
 * Meldungen nicht einheitlich, deshalb hier ein kleiner Prüfer, der nur bei Fehlern läuft.
 */
export function jsonErrorAt(src: string): number {
  let i = 0;
  const ws = () => {
    while (i < src.length && " \t\n\r".includes(src[i]!)) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    for (const ch of word) if (src[i++] !== ch) (i--, fail());
  };
  const string = () => {
    i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i]! < " ") fail();
      if (src[i] === "\\") {
        i++;
        if (src[i] === "u") {
          for (let k = 1; k <= 4; k++) if (!/[0-9a-fA-F]/.test(src[i + k] ?? "")) ((i += k), fail());
          i += 4;
        } else if (!'"\\/bfnrt'.includes(src[i] ?? "")) fail();
      }
      i++;
    }
    if (src[i] !== '"') fail();
    i++;
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      ws();
      if (src[i] === "}") return void i++;
      for (;;) {
        ws();
        if (src[i] !== '"') fail();
        string();
        ws();
        if (src[i] !== ":") fail();
        i++;
        value();
        ws();
        if (src[i] === ",") i++;
        else if (src[i] === "}") return void i++;
        else fail();
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (src[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (src[i] === ",") i++;
        else if (src[i] === "]") return void i++;
        else fail();
      }
    }
    if (c === '"') return string();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    fail();
  };
  try {
    value();
    ws();
    return i < src.length ? i : -1;
  } catch (pos) {
    return pos as number;
  }
}

/** JSON lesen; bei Fehlern mit Zeile und Spalte. */
export function parseJson(source: string): { value?: unknown; error?: string } {
  if (!source.trim()) return { error: "Keine Daten" };
  try {
    return { value: JSON.parse(source) };
  } catch {
    const at = jsonErrorAt(source);
    if (at < 0) return { error: "Kein gültiges JSON" };
    const before = source.slice(0, at);
    const line = before.split("\n").length;
    const col = at - before.lastIndexOf("\n");
    const end = at >= source.length ? " (Text endet zu früh)" : "";
    return { error: `Kein gültiges JSON: Zeile ${line}, Spalte ${col}${end}` };
  }
}
