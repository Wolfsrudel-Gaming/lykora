import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Game } from "@lykora/spec";
import { buildApp } from "../src/app.ts";
import { createAdmin } from "../src/bootstrap.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { createDb, type Db } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";

export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://lykora@localhost:5432/lykora_test";
export const ADMIN = { email: "admin@example.org", password: "geheim-geheim" };

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  api: string;
  token: string;
  orgId: string;
  close(): Promise<void>;
}

export const exampleGame = (): Game =>
  JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8"));

export const tempDir = (prefix: string) => mkdtempSync(join(tmpdir(), `lykora-${prefix}-`));

/**
 * Einstellungen für eine Test-App. Klangbibliothek und Web-Build sind leere Ordner,
 * damit die Tests nicht vom Stand der echten Dateien im Repo abhängen.
 */
export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL,
    BASE_PATH: "/lykora",
    PUBLIC_URL: "https://example.org/lykora",
    DATA_DIR: tempDir("test"),
    MEDIA_LIBRARY_DIR: tempDir("lib"),
    WEB_DIR: tempDir("web"),
    SMS_WEBHOOK_SECRET: "sms-secret",
    ...env,
  });
}

/** Startet die App gegen eine frisch geleerte Testdatenbank. */
export async function setup(env: Record<string, string> = {}): Promise<TestContext> {
  const db = createDb(DATABASE_URL);
  await db.query("drop schema public cascade; create schema public;");
  await migrate(db);
  await createAdmin(db, ADMIN.email, "Admin", ADMIN.password);
  const app = await buildApp(testConfig(env), db, { logger: false });
  await app.ready();
  const api = "/lykora/api";
  const login = await app.inject({ method: "POST", url: `${api}/auth/login`, payload: ADMIN });
  const token = login.json().token;
  const me = await app.inject({ method: "GET", url: `${api}/me`, headers: { authorization: `Bearer ${token}` } });
  return {
    app,
    db,
    api,
    token,
    orgId: me.json().orgs[0].id,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

export function client(ctx: TestContext, token = ctx.token) {
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, payload?: unknown) => {
    const res = await ctx.app.inject({
      method,
      url: `${ctx.api}${path}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : undefined, raw: res };
  };
  return {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown) => call("POST", p, b ?? {}),
    put: (p: string, b: unknown) => call("PUT", p, b),
    patch: (p: string, b: unknown) => call("PATCH", p, b),
    del: (p: string) => call("DELETE", p),
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Legt ein Spiel und daraus ein Event an. */
export async function createEvent(ctx: TestContext, game = exampleGame()) {
  const orga = client(ctx);
  const g = await orga.post(`/orgs/${ctx.orgId}/games`, { content: game });
  if (g.status !== 201) throw new Error(`Spiel nicht angelegt: ${JSON.stringify(g.body)}`);
  const e = await orga.post(`/orgs/${ctx.orgId}/events`, { gameId: g.body.id, name: "Testlauf" });
  if (e.status !== 201) throw new Error(`Event nicht angelegt: ${JSON.stringify(e.body)}`);
  return { gameId: g.body.id as string, event: e.body };
}

export async function joinTeam(ctx: TestContext, code: string, name: string, supervisorPin?: string) {
  const res = await client(ctx, "").post("/join", { code, team: { name, supervisorPin } });
  if (res.status !== 201) throw new Error(`Team nicht angelegt: ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, team: res.body.team };
}

/** Meldet ein neues Mitglied mit der gewünschten Rolle an und liefert dessen Sitzungstoken. */
export async function member(ctx: TestContext, role: string, email: string): Promise<string> {
  const password = "test-passwort-123";
  const add = await client(ctx).post(`/orgs/${ctx.orgId}/members`, { email, name: role, password, role });
  if (add.status !== 201) throw new Error(`Mitglied nicht angelegt: ${JSON.stringify(add.body)}`);
  const login = await client(ctx, "").post("/auth/login", { email, password });
  return login.body.token;
}
