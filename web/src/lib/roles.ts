import type { Role } from "./types.ts";

/**
 * Rechte wie im Server (server/src/lib/roles.ts). Das Dashboard blendet Knöpfe aus,
 * statt Fehler zu zeigen; entscheiden tut weiter der Server. Ein Test prüft, dass beide
 * Tabellen übereinstimmen.
 */
export const ROLES = ["admin", "author", "gamemaster", "supervisor", "actor", "viewer"] as const satisfies readonly Role[];

export const PERMISSIONS = {
  "org.manage": ["admin"],
  "game.read": ["admin", "author", "gamemaster", "supervisor"],
  "game.write": ["admin", "author"],
  "event.read": ["admin", "gamemaster", "supervisor", "actor", "viewer"],
  "event.positions": ["admin", "gamemaster", "supervisor", "actor"],
  "event.manage": ["admin", "gamemaster"],
  "event.intervene": ["admin", "gamemaster"],
  "event.review": ["admin", "gamemaster", "supervisor"],
  "event.message": ["admin", "gamemaster", "supervisor", "actor"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  author: "Autor",
  gamemaster: "Spielleitung",
  supervisor: "Betreuer",
  actor: "Darsteller",
  viewer: "Beobachter",
};

export const ROLE_HINTS: Record<Role, string> = {
  admin: "Alles, auch Mitglieder und Organisation",
  author: "Spiele schreiben, Medien und Klänge",
  gamemaster: "Events anlegen und leiten, Eingriffe",
  supervisor: "Teams begleiten, SOS, Prüfungen, Nachrichten",
  actor: "Nachrichten und Klänge, Positionen sehen",
  viewer: "Nur zusehen",
};
