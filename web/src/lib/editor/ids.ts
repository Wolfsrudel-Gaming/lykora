/**
 * Paket A: Kennungen und Codes erzeugen. IDs entstehen einmal aus dem Namen und ändern sich beim
 * Umbenennen nie mehr (Spielstände und gedrucktes Material hängen daran). Codes für QR und Notfall
 * sind zufällig und spielweit eindeutig, auch gegeneinander.
 */

import { slugId, uniqueId } from "../format.ts";
import type { Game, IdKind } from "./types.ts";

const FALLBACK: Record<IdKind, string> = {
  station: "station",
  figur: "figur",
  gegenstand: "gegenstand",
  kapitel: "kapitel",
  regel: "regel",
  zone: "zone",
  teil: "teil",
  medium: "medium",
  punkt: "punkt",
};

/** Neue ID aus dem Namen; Rückfall je Art plus -2, -3 … Codeteile heißen immer teil-<n>. */
export function newId(kind: IdKind, name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (kind === "teil") {
    for (let n = 1; ; n++) if (!set.has(`teil-${n}`)) return `teil-${n}`;
  }
  return uniqueId(slugId(name, FALLBACK[kind]), set);
}

export { slugId };

/** IDs derselben Liste; Orte (punkt) teilen sich Sammel-, Rettungs- und Versorgungspunkte. */
export function takenIds(game: Game, kind: IdKind): string[] {
  const ids = (list: { id?: string }[] | undefined) => (list ?? []).map((x) => x?.id).filter((id): id is string => typeof id === "string");
  switch (kind) {
    case "station":
      return ids(game.stations);
    case "figur":
      return ids(game.characters);
    case "gegenstand":
      return ids(game.items);
    case "kapitel":
      return ids(game.story?.chapters);
    case "regel":
      return ids(game.rules);
    case "zone":
      return ids(game.field?.restrictedZones);
    case "teil":
      return ids(game.fragments);
    case "medium":
      return ids(game.media);
    case "punkt":
      return ids([...(game.field?.assemblyPoint ? [game.field.assemblyPoint] : []), ...(game.field?.rescuePoints ?? []), ...(game.field?.supplyPoints ?? [])]);
  }
}

/** Ohne 0/O/1/I, damit sich Ausdrucke nicht verlesen lassen. */
const QR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomInt(max: number): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0]! % max;
  }
  return Math.floor(Math.random() * max);
}

/** "LYK-" + 4 Zeichen, nicht in taken (alle Codes des Spiels, siehe allCodes). */
export function newQrCode(taken: Iterable<string>): string {
  const set = new Set(taken);
  for (;;) {
    let code = "LYK-";
    for (let i = 0; i < 4; i++) code += QR_ALPHABET[randomInt(QR_ALPHABET.length)];
    if (!set.has(code)) return code;
  }
}

/** Zu leicht zu raten: alles gleich, auf- oder absteigend, 0000/1234. */
export function isWeakCode(code: string): boolean {
  if (!/^\d{4,6}$/.test(code)) return true;
  if (/^(\d)\1+$/.test(code)) return true;
  const digits = [...code].map(Number);
  const up = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const down = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  return up || down;
}

/** 4 Ziffern, nicht trivial, nicht als QR- oder NFC-Wert vergeben. */
export function newManualCode(taken: Iterable<string>): string {
  const set = new Set(taken);
  for (;;) {
    const code = String(randomInt(10_000)).padStart(4, "0");
    if (!isWeakCode(code) && !set.has(code)) return code;
  }
}

/** Alle QR-Codes, Notfall-Codes und NFC-Werte des Spiels (für Eindeutigkeit). */
export function allCodes(game: Game): string[] {
  const out: string[] = [];
  for (const s of game.stations ?? []) {
    for (const t of s?.triggers ?? []) {
      if (!t) continue;
      if ((t.type === "qr" || t.type === "manual") && t.code) out.push(t.code);
      if (t.type === "nfc" && t.tag) out.push(t.tag);
    }
  }
  return out;
}

export function newGameId(title: string): string {
  return slugId(title, "spiel");
}
