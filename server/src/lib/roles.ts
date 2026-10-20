export const ROLES = ["admin", "author", "gamemaster", "supervisor", "actor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const PERMISSIONS = {
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

export function can(role: Role | undefined, permission: Permission): boolean {
  return role !== undefined && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
