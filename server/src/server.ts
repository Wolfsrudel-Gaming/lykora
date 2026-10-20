import { buildApp } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { purgeExpired } from "./services/retention.ts";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = await buildApp(config, db);
const log = (msg: string) => app.log.info(msg);

await migrate(db, log);
await bootstrap(db, config, log);

const purge = () => purgeExpired(db, config.dataDir, log).catch((err) => app.log.error(err, "Löschlauf fehlgeschlagen"));
await purge();
const timer = setInterval(purge, 60 * 60 * 1000);

await app.listen({ port: config.port, host: config.host });
app.log.info(`Lykora läuft unter ${config.publicUrl} (API-Doku: ${config.publicUrl}/api/docs)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} empfangen, fahre herunter`);
    clearInterval(timer);
    await app.close();
    await db.close();
    process.exit(0);
  });
}
