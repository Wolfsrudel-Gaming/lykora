import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireInstanceAdmin, requireUser } from "../lib/auth.ts";
import { TIME_PATTERN, UPDATER_STATES, type UpdateSettings, type UpdaterState } from "../services/update.ts";

const staff = [{ staff: [] }];
const updater = [{ updater: [] }];
const time = { type: "string", pattern: TIME_PATTERN } as const;

export default async function systemRoutes(app: FastifyInstance) {
  const { db, config, updates } = app.deps;

  app.get("/system/version", { schema: { tags: ["system"], summary: "Version des Servers", security: staff } }, async (req) => {
    await requireUser(db, req);
    return config.build;
  });

  app.get(
    "/system/update",
    {
      schema: {
        tags: ["system"],
        summary: "Stand der Updates: installierte und verfügbare Version, Einstellungen, Updater, Verlauf",
        description: "Nur für Admins der Instanz, also der ältesten Organisation.",
        security: staff,
      },
    },
    async (req) => {
      await requireInstanceAdmin(db, req);
      return updates.status();
    },
  );

  app.put<{ Body: { auto: boolean; window?: UpdateSettings["window"] } }>(
    "/system/update/settings",
    {
      schema: {
        tags: ["system"],
        summary: "Automatische Updates ein- oder ausschalten, optional mit Zeitfenster",
        description: "Das Zeitfenster gilt in UPDATE_TIMEZONE und darf über Mitternacht gehen, z. B. 23:00–05:00.",
        security: staff,
        body: {
          type: "object",
          required: ["auto"],
          additionalProperties: false,
          properties: {
            auto: { type: "boolean" },
            window: {
              type: ["object", "null"],
              required: ["from", "to"],
              additionalProperties: false,
              properties: { from: time, to: time },
            },
          },
        },
      },
    },
    async (req) => {
      const user = await requireInstanceAdmin(db, req);
      await updates.saveSettings({ auto: req.body.auto, window: req.body.window ?? null }, user.id);
      return updates.status();
    },
  );

  app.post(
    "/system/update/check",
    { schema: { tags: ["system"], summary: "Sofort in der Registry nach einer neuen Version sehen", security: staff } },
    async (req) => {
      await requireInstanceAdmin(db, req);
      await updates.check();
      return updates.status();
    },
  );

  app.post(
    "/system/update/apply",
    {
      schema: {
        tags: ["system"],
        summary: "Jetzt aktualisieren",
        description: [
          "Beauftragt den Updater; das Zeitfenster gilt dafür nicht. 409 mit event_running während eines Events,",
          "updater_offline, wenn sich der Updater seit 3 Minuten nicht gemeldet hat, up_to_date ohne neuere Version",
          "und not_configured ohne LYKORA_IMAGE.",
        ].join(" "),
        security: staff,
      },
    },
    async (req, reply) => {
      await requireInstanceAdmin(db, req);
      await updates.requestApply();
      return reply.status(202).send(await updates.status());
    },
  );

  // Den Token vor der Schema-Prüfung ansehen, damit Fremde nichts über die Schnittstelle erfahren.
  const updaterOnly = { preValidation: async (req: FastifyRequest) => updates.authorizeUpdater(req.headers.authorization) };

  app.get(
    "/updater/plan",
    {
      ...updaterOnly,
      schema: {
        tags: ["system"],
        summary: "Für den Updater: jetzt aktualisieren oder warten",
        description: "Zählt als Lebenszeichen des Updaters. Braucht den Token aus UPDATER_TOKEN oder DATA_DIR/updater.token.",
        security: updater,
      },
    },
    async () => updates.plan(),
  );

  app.post<{ Body: { state: UpdaterState; message?: string; imageId?: string } }>(
    "/updater/report",
    {
      ...updaterOnly,
      schema: {
        tags: ["system"],
        summary: "Für den Updater: Zwischenstand melden",
        description: "failed und rolled_back schließen das laufende Update im Verlauf. unsupported: Das Image lässt sich nicht ziehen.",
        security: updater,
        body: {
          type: "object",
          required: ["state"],
          properties: { state: { type: "string", enum: UPDATER_STATES }, message: { type: "string" }, imageId: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      await updates.report(req.body);
      return reply.status(204).send();
    },
  );
}
