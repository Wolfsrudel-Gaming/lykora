import type { FastifyInstance } from "fastify";
import { requireUser, bearerToken } from "../lib/auth.ts";
import { hashPassword, hashToken, newToken, verifyPassword } from "../lib/crypto.ts";
import { badRequest, unauthorized } from "../lib/errors.ts";

// Für unbekannte E-Mails wird trotzdem ein Hash geprüft, damit die Antwortzeit nichts verrät.
let dummyHash: Promise<string> | undefined;

export default async function authRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Mit E-Mail und Passwort anmelden",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string" }, password: { type: "string" } },
        },
      },
    },
    async (req) => {
      const email = req.body.email.trim().toLowerCase();
      const user = await db.one<{ id: string; email: string; name: string; password_hash: string }>(
        "select id, email, name, password_hash from users where email = $1 and not disabled",
        [email],
      );
      const ok = user
        ? await verifyPassword(req.body.password, user.password_hash)
        : await verifyPassword(req.body.password, await (dummyHash ??= hashPassword("x")));
      if (!user || !ok) throw unauthorized("E-Mail oder Passwort falsch");
      const token = newToken();
      const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
      await db.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [hashToken(token), user.id, expires]);
      await db.query("delete from sessions where user_id = $1 and expires_at < now()", [user.id]);
      return { token, expiresAt: expires, user: { id: user.id, email: user.email, name: user.name } };
    },
  );

  app.post("/auth/logout", { schema: { tags: ["auth"], summary: "Sitzung beenden", security: [{ staff: [] }] } }, async (req, reply) => {
    const token = bearerToken(req);
    if (token) await db.query("delete from sessions where token_hash = $1", [hashToken(token)]);
    return reply.status(204).send();
  });

  app.get("/me", { schema: { tags: ["auth"], summary: "Angemeldeter Nutzer mit Organisationen", security: [{ staff: [] }] } }, async (req) => {
    const user = await requireUser(db, req);
    const orgs = await db.query(
      `select o.id, o.name, o.slug, m.role from memberships m join organizations o on o.id = m.org_id
       where m.user_id = $1 order by o.name`,
      [user.id],
    );
    return { ...user, orgs };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/me/password",
    {
      schema: {
        tags: ["auth"],
        summary: "Eigenes Passwort ändern",
        security: [{ staff: [] }],
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 10 } },
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(db, req);
      const row = await db.one<{ password_hash: string }>("select password_hash from users where id = $1", [user.id]);
      if (!(await verifyPassword(req.body.currentPassword, row!.password_hash))) throw badRequest("wrong_password", "Aktuelles Passwort ist falsch");
      await db.query("update users set password_hash = $2 where id = $1", [user.id, await hashPassword(req.body.newPassword)]);
      // Alle anderen Sitzungen beenden.
      await db.query("delete from sessions where user_id = $1 and token_hash <> $2", [user.id, hashToken(bearerToken(req)!)]);
      return reply.status(204).send();
    },
  );
}
