import type { FastifyInstance } from "fastify";
import { authorize, requireUser } from "../lib/auth.ts";
import { hashPassword } from "../lib/crypto.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";
import { ROLES, type Role } from "../lib/roles.ts";

const orgParams = { type: "object", required: ["orgId"], properties: { orgId: { type: "string", format: "uuid" } } } as const;

export default async function orgRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/orgs", { schema: { tags: ["orgs"], summary: "Eigene Organisationen", security: [{ staff: [] }] } }, async (req) => {
    const user = await requireUser(db, req);
    return db.query(
      `select o.id, o.name, o.slug, m.role from memberships m join organizations o on o.id = m.org_id
       where m.user_id = $1 order by o.name`,
      [user.id],
    );
  });

  app.post<{ Body: { name: string; slug: string } }>(
    "/orgs",
    {
      schema: {
        tags: ["orgs"],
        summary: "Organisation anlegen (nur für Admins einer bestehenden Organisation)",
        security: [{ staff: [] }],
        body: {
          type: "object",
          required: ["name", "slug"],
          properties: { name: { type: "string", minLength: 1 }, slug: { type: "string", pattern: "^[a-z0-9-]{2,40}$" } },
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(db, req);
      const isAdmin = await db.one("select 1 from memberships where user_id = $1 and role = 'admin'", [user.id]);
      if (!isAdmin) throw forbidden();
      const org = await db.tx(async (tx) => {
        const o = await tx.one("insert into organizations (name, slug) values ($1, $2) on conflict (slug) do nothing returning *", [req.body.name, req.body.slug]);
        if (!o) throw conflict("slug_taken", "Kürzel ist schon vergeben");
        await tx.query("insert into memberships (user_id, org_id, role) values ($1, $2, 'admin')", [user.id, o.id]);
        return o;
      });
      return reply.status(201).send(org);
    },
  );

  app.get<{ Params: { orgId: string } }>(
    "/orgs/:orgId/members",
    { schema: { tags: ["orgs"], summary: "Mitglieder", security: [{ staff: [] }], params: orgParams } },
    async (req) => {
      await authorize(db, req, req.params.orgId, "org.manage");
      return db.query(
        `select u.id, u.email, u.name, u.disabled, m.role from memberships m join users u on u.id = m.user_id
         where m.org_id = $1 order by u.name`,
        [req.params.orgId],
      );
    },
  );

  app.post<{ Params: { orgId: string }; Body: { email: string; name?: string; password?: string; role: Role } }>(
    "/orgs/:orgId/members",
    {
      schema: {
        tags: ["orgs"],
        summary: "Mitglied hinzufügen; legt den Nutzer an, wenn es ihn noch nicht gibt",
        security: [{ staff: [] }],
        params: orgParams,
        body: {
          type: "object",
          required: ["email", "role"],
          properties: {
            email: { type: "string", format: "email" },
            name: { type: "string" },
            password: { type: "string", minLength: 10 },
            role: { type: "string", enum: [...ROLES] },
          },
        },
      },
    },
    async (req, reply) => {
      await authorize(db, req, req.params.orgId, "org.manage");
      const email = req.body.email.trim().toLowerCase();
      const member = await db.tx(async (tx) => {
        let user = await tx.one<{ id: string }>("select id from users where email = $1", [email]);
        if (!user) {
          if (!req.body.password || !req.body.name) throw badRequest("user_unknown", "Neuer Nutzer braucht Name und Passwort");
          user = await tx.one("insert into users (email, name, password_hash) values ($1, $2, $3) returning id", [
            email,
            req.body.name,
            await hashPassword(req.body.password),
          ]);
        }
        await tx.query(
          `insert into memberships (user_id, org_id, role) values ($1, $2, $3)
           on conflict (user_id, org_id) do update set role = excluded.role`,
          [user!.id, req.params.orgId, req.body.role],
        );
        return tx.one("select id, email, name from users where id = $1", [user!.id]);
      });
      return reply.status(201).send({ ...member, role: req.body.role });
    },
  );

  app.delete<{ Params: { orgId: string; userId: string } }>(
    "/orgs/:orgId/members/:userId",
    {
      schema: {
        tags: ["orgs"],
        summary: "Mitglied entfernen",
        security: [{ staff: [] }],
        params: { type: "object", properties: { orgId: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" } } },
      },
    },
    async (req, reply) => {
      const { user } = await authorize(db, req, req.params.orgId, "org.manage");
      if (user.id === req.params.userId) throw badRequest("self", "Du kannst dich nicht selbst entfernen");
      const rows = await db.query("delete from memberships where org_id = $1 and user_id = $2 returning user_id", [req.params.orgId, req.params.userId]);
      if (!rows.length) throw notFound("Mitglied");
      return reply.status(204).send();
    },
  );
}
