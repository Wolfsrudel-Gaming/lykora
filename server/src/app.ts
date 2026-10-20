import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./lib/errors.ts";
import { LiveHub } from "./lib/live.ts";
import authRoutes from "./routes/auth.ts";
import orgRoutes from "./routes/orgs.ts";
import gameRoutes from "./routes/games.ts";
import eventRoutes from "./routes/events.ts";
import staffRoutes from "./routes/staff.ts";
import playRoutes from "./routes/play.ts";
import integrationRoutes from "./routes/integrations.ts";

export interface Deps {
  db: Db;
  config: Config;
  live: LiveHub;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
  }
}

export async function buildApp(config: Config, db: Db, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array", allErrors: false } },
  });
  const deps: Deps = { db, config, live: new LiveHub() };
  app.decorate("deps", deps);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, ...(err as any).details });
    }
    if (err.validation) {
      return reply.status(400).send({ error: "invalid_request", message: err.message });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.code ?? "error", message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Interner Fehler" });
  });

  const api = `${config.basePath}/api`;

  await app.register(swagger, {
    openapi: {
      info: { title: "Lykora API", version: "0.1.0", description: "Server für Outdoor-Escape-Spiele und Rallyes" },
      servers: [{ url: config.publicUrl.replace(/\/+$/, "").replace(new RegExp(`${config.basePath}$`), "") || "/" }],
      components: {
        securitySchemes: {
          staff: { type: "http", scheme: "bearer", description: "Sitzungstoken aus /auth/login" },
          team: { type: "http", scheme: "bearer", description: "Gerätetoken aus /join" },
        },
      },
      tags: [
        { name: "auth", description: "Anmeldung der Orga" },
        { name: "orgs", description: "Organisationen und Mitglieder" },
        { name: "games", description: "Spiele und Versionen" },
        { name: "events", description: "Events und Live-Betrieb" },
        { name: "staff", description: "Eingriffe von Spielleitung und Betreuern" },
        { name: "play", description: "Schnittstelle der Spieler-App" },
        { name: "integrations", description: "Eingänge für externe Systeme" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: `${api}/docs` });
  await app.register(websocket);

  await app.register(
    async (scope) => {
      scope.get("/health", { schema: { hide: true } }, async () => {
        await db.query("select 1");
        return { status: "ok", version: "0.1.0" };
      });
      await scope.register(authRoutes);
      await scope.register(orgRoutes);
      await scope.register(gameRoutes);
      await scope.register(eventRoutes);
      await scope.register(staffRoutes);
      await scope.register(playRoutes);
      await scope.register(integrationRoutes);
    },
    { prefix: api },
  );

  return app;
}
