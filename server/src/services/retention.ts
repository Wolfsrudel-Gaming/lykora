import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db.ts";

/**
 * Löscht personenbezogene Daten abgelaufener Events: Positionen, Uploads, Vornamen und
 * Notfallnummern. Ergebnisse, Punkte und das Logbuch bleiben für die Auswertung erhalten.
 */
export async function purgeExpired(db: Db, dataDir: string, log: (msg: string) => void = () => {}): Promise<number> {
  const due = await db.query<{ id: string; name: string }>(
    `select id, name from events where status = 'ended' and purged_at is null
     and ended_at + make_interval(days => retention_days) < now()`,
  );
  for (const event of due) {
    await db.tx(async (tx) => {
      await tx.query("delete from positions where event_id = $1", [event.id]);
      await tx.query("delete from uploads where event_id = $1", [event.id]);
      await tx.query("delete from devices where team_id in (select id from teams where event_id = $1)", [event.id]);
      await tx.query(
        `update teams set members = '[]', emergency_phone = null, last_lat = null, last_lon = null,
           last_accuracy = null, last_position_at = null where event_id = $1`,
        [event.id],
      );
      await tx.query("update sos set lat = null, lon = null, accuracy = null where event_id = $1", [event.id]);
      await tx.query("update events set purged_at = now() where id = $1", [event.id]);
    });
    await rm(join(dataDir, "uploads", event.id), { recursive: true, force: true });
    log(`Personenbezogene Daten von Event „${event.name}“ gelöscht`);
  }
  // Abgelaufene Sitzungen aufräumen.
  await db.query("delete from sessions where expires_at < now()");
  return due.length;
}
