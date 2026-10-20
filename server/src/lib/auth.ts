import type { FastifyRequest } from "fastify";
import type { Db } from "../db.ts";
import { hashToken } from "./crypto.ts";
import { forbidden, notFound, unauthorized } from "./errors.ts";
import { can, type Permission, type Role } from "./roles.ts";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthTeam {
  teamId: string;
  eventId: string;
  deviceToken: string;
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  // Browser können bei WebSockets keine Header setzen.
  const query = req.query as Record<string, unknown> | undefined;
  if (typeof query?.access_token === "string") return query.access_token;
  return undefined;
}

export async function requireUser(db: Db, req: FastifyRequest): Promise<AuthUser> {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  const user = await db.one<AuthUser>(
    `select u.id, u.email, u.name from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and not u.disabled`,
    [hashToken(token)],
  );
  if (!user) throw unauthorized("Sitzung abgelaufen oder ungültig");
  return user;
}

export async function requireTeam(db: Db, req: FastifyRequest): Promise<AuthTeam> {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  const row = await db.one<{ team_id: string; event_id: string }>(
    `update devices d set last_seen_at = now() from teams t
     where d.token_hash = $1 and t.id = d.team_id
     returning d.team_id, t.event_id`,
    [hashToken(token)],
  );
  if (!row) throw unauthorized("Gerät ist keinem Team zugeordnet");
  return { teamId: row.team_id, eventId: row.event_id, deviceToken: token };
}

export async function roleIn(db: Db, userId: string, orgId: string): Promise<Role | undefined> {
  const row = await db.one<{ role: Role }>("select role from memberships where user_id = $1 and org_id = $2", [userId, orgId]);
  return row?.role;
}

/** Meldet den Nutzer an und prüft seine Rolle in der Organisation. */
export async function authorize(db: Db, req: FastifyRequest, orgId: string, permission: Permission) {
  const user = await requireUser(db, req);
  const role = await roleIn(db, user.id, orgId);
  // Wer nicht Mitglied ist, soll nicht einmal erfahren, dass es die Organisation gibt.
  if (!role) throw notFound("Organisation");
  if (!can(role, permission)) throw forbidden();
  return { user, role };
}

async function orgOf(db: Db, table: "games" | "events", id: string): Promise<string> {
  const row = /^[0-9a-f-]{36}$/i.test(id) ? await db.one<{ org_id: string }>(`select org_id from ${table} where id = $1`, [id]) : undefined;
  if (!row) throw notFound(table === "games" ? "Spiel" : "Event");
  return row.org_id;
}

export async function authorizeGame(db: Db, req: FastifyRequest, gameId: string, permission: Permission) {
  const orgId = await orgOf(db, "games", gameId);
  return { ...(await authorize(db, req, orgId, permission)), orgId };
}

export async function authorizeEvent(db: Db, req: FastifyRequest, eventId: string, permission: Permission) {
  const orgId = await orgOf(db, "events", eventId);
  return { ...(await authorize(db, req, orgId, permission)), orgId };
}
