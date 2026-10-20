import { createAdmin } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { migrate } from "./migrate.ts";

const usage = `Aufruf:
  node dist/cli.js migrate
  node dist/cli.js create-admin <email> <name> <passwort>
     Legt einen Admin an oder setzt das Passwort eines bestehenden Nutzers neu.`;

const [command, ...args] = process.argv.slice(2);
const db = createDb(loadConfig().databaseUrl);
try {
  if (command === "migrate") {
    await migrate(db, console.log);
  } else if (command === "create-admin" && args.length === 3) {
    await migrate(db);
    await createAdmin(db, args[0]!, args[1]!, args[2]!);
    console.log(`Admin ${args[0]} angelegt`);
  } else {
    console.log(usage);
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
