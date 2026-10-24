/** Funk: Absender, Klang-Cues und Hervorhebung eingehender Meldungen. */

import { text } from "./format.ts";
import type { CueBody, Game, Message, MessageKind } from "./types.ts";

export const KIND_LABELS: Record<MessageKind, string> = {
  chat: "Nachricht",
  hint: "Hinweis",
  story: "Story",
  system: "System",
  predefined: "Schnellmeldung",
  cue: "Klang",
};

/** Name eines Klangs ohne Bibliotheks-Vorsilbe: „lib:eule“ wird „eule“. */
export function audioName(id: string): string {
  return id.replace(/^lib:/, "");
}

/** Body einer Cue-Nachricht: JSON-Text {"audio","src","volume","text"}. */
export function parseCue(body: string): CueBody | null {
  try {
    const data = JSON.parse(body) as Partial<CueBody>;
    return typeof data.audio === "string" ? (data as CueBody) : null;
  } catch {
    return null;
  }
}

export function hqName(game: Game | null | undefined): string {
  const lang = game?.meta.languages[0] ?? "de";
  return text(game?.story?.hq?.name, lang) || "Zentrale";
}

/** Angezeigter Absender wie in der App: hq oder leer = Zentrale, sonst Figur aus dem Spiel. */
export function senderLabel(sender: string | null, game: Game | null | undefined): string {
  if (!sender || sender === "hq") return hqName(game);
  if (sender === "narrator") return "Erzähler";
  if (sender === "npc") return "Figur";
  const lang = game?.meta.languages[0] ?? "de";
  const c = game?.characters?.find((ch) => ch.id === sender);
  return c ? text(c.name, lang) : sender;
}

export interface SenderOption {
  value: string;
  label: string;
}

/** Absender zur Auswahl: Zentrale und alle Figuren außer der Zentrale selbst. */
export function senderOptions(game: Game | null | undefined): SenderOption[] {
  const lang = game?.meta.languages[0] ?? "de";
  const figures = (game?.characters ?? []).filter((c) => c.kind !== "hq").map((c) => ({ value: c.id, label: text(c.name, lang) }));
  return [{ value: "hq", label: hqName(game) }, ...figures];
}

export type Tone = "uneasy" | "broken" | "returning" | "normal";

/** Eingehende Schnellmeldungen der App, die im Funk auffallen sollen. */
export function incomingTone(m: Pick<Message, "direction" | "body">): Tone {
  if (m.direction !== "from_team") return "normal";
  const b = m.body.toLowerCase();
  if (b.includes("mulmig")) return "uneasy";
  if (b.includes("kaputt")) return "broken";
  if (b.includes("sammelpunkt")) return "returning";
  return "normal";
}

export const TONE_LABELS: Record<Tone, string> = {
  uneasy: "Mulmig",
  broken: "Station kaputt?",
  returning: "Auf dem Rückweg",
  normal: "",
};

/** Verlauf für ein Team (seine Nachrichten und alle an alle) oder nur „an alle“ bei null. */
export function thread(messages: Message[], teamId: string | null): Message[] {
  return teamId === null ? messages.filter((m) => m.team_id === null) : messages.filter((m) => m.team_id === teamId || m.team_id === null);
}

/** Ungelesene eingehende Nachrichten je Team seit der zuletzt gesehenen ID. */
export function unreadByTeam(messages: Message[], seen: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of messages) {
    if (m.direction !== "from_team" || !m.team_id) continue;
    if (m.id > (seen[m.team_id] ?? 0)) out[m.team_id] = (out[m.team_id] ?? 0) + 1;
  }
  return out;
}
