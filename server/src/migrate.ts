import { readdir, readFile } from "node:fs/promises";
import type { Db } from "./db.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);

/** Spielt alle noch fehlenden SQL-Migrationen in Dateinamen-Reihenfolge ein. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  await db.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  // Verhindert, dass zwei Instanzen gleichzeitig migrieren.
  await db.tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(4711001)");
    const done = new Set((await tx.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.query(await readFile(new URL(file, migrationsDir), "utf8"));
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
      log(`Migration ${file} eingespielt`);
    }
  });
}
