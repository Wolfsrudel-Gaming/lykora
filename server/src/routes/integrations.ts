import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { forbidden, notFound } from "../lib/errors.ts";
import { logEvent } from "../services/events.ts";

/**
 * Aufbau der SOS-SMS, die die App ohne Datenverbindung verschickt:
 *   LYKORA SOS <Event-Code> <Gerätecode des Teams> [<lat>,<lon>] [Freitext]
 * Beispiel: LYKORA SOS K7M2QX AB3D 50.81550,7.15500 Knöchel verletzt
 */
export const SMS_PATTERN = /^\s*LYKORA\s+SOS\s+([A-Z0-9]{4,12})\s+([A-Z0-9]{4,8})(?:\s+(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+))?\s*(.*)$/is;

export function parseSosSms(text: string) {
  const m = SMS_PATTERN.exec(text);
  if (!m) return null;
  return {
    eventCode: m[1]!.toUpperCase(),
    deviceCode: m[2]!.toUpperCase(),
    lat: m[3] ? Number(m[3]) : null,
    lon: m[4] ? Number(m[4]) : null,
    message: m[5]?.trim() || null,
  };
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function integrationRoutes(app: FastifyInstance) {
  const { db, config, live } = app.deps;

  app.post<{ Body: { from?: string; text: string } }>(
    "/integrations/sms",
    {
      schema: {
        tags: ["integrations"],
        summary: "Eingehende SOS-SMS von einem SMS-Gateway",
        description: "Braucht den Header X-Lykora-Secret mit dem Wert von SMS_WEBHOOK_SECRET. Format der SMS siehe Doku.",
        body: { type: "object", required: ["text"], properties: { from: { type: "string" }, text: { type: "string", maxLength: 1600 } } },
      },
    },
    async (req, reply) => {
      const secret = req.headers["x-lykora-secret"];
      if (!config.smsWebhookSecret || typeof secret !== "string" || !safeEqual(secret, config.smsWebhookSecret)) throw forbidden();
      const sms = parseSosSms(req.body.text);
      if (!sms) return reply.status(202).send({ handled: false });
      const team = await db.one<{ id: string; event_id: string; name: string; emergency_phone: string | null }>(
        `select t.id, t.event_id, t.name, t.emergency_phone from teams t join events e on e.id = t.event_id
         where e.join_code = $1 and t.device_code = $2`,
        [sms.eventCode, sms.deviceCode],
      );
      if (!team) throw notFound("Team");
      const row = await db.one(
        `insert into sos (event_id, team_id, channel, lat, lon, message, client_time) values ($1, $2, 'sms', $3, $4, $5, now()) returning *`,
        [team.event_id, team.id, sms.lat, sms.lon, [sms.message, req.body.from ? `(SMS von ${req.body.from})` : null].filter(Boolean).join(" ") || null],
      );
      live.publish(team.event_id, "sos", { ...row, team_name: team.name, emergency_phone: team.emergency_phone });
      await logEvent(db, live, team.event_id, "sos", { sosId: row.id, channel: "sms", lat: row.lat, lon: row.lon }, { teamId: team.id });
      // Hat ein anderes Handy des Teams Netz, zeigt es gleich, dass die SMS angekommen ist.
      live.poke(team.event_id, team.id, "sos");
      return reply.status(201).send({ handled: true });
    },
  );
}
