import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { hashPassword } from "./lib/crypto.ts";

/** Legt beim ersten Start eine Organisation und den Admin aus ADMIN_EMAIL/ADMIN_PASSWORD an. */
export async function bootstrap(db: Db, config: Config, log: (msg: string) => void): Promise<void> {
  const existing = await db.one<{ n: number }>("select count(*)::int as n from users");
  if (existing!.n > 0) return;
  if (!config.admin) {
    log("Noch kein Nutzer vorhanden. ADMIN_EMAIL und ADMIN_PASSWORD setzen oder `node dist/cli.js create-admin <E-Mail> <Name> <Passwort>` ausführen.");
    return;
  }
  await createAdmin(db, config.admin.email, config.admin.name, config.admin.password);
  log(`Admin ${config.admin.email} angelegt`);
}

export async function createAdmin(db: Db, email: string, name: string, password: string, orgName = "Standard"): Promise<void> {
  if (password.length < 10) throw new Error("Passwort muss mindestens 10 Zeichen haben");
  await db.tx(async (tx) => {
    const org =
      (await tx.one<{ id: string }>("select id from organizations order by created_at limit 1")) ??
      (await tx.one<{ id: string }>("insert into organizations (name, slug) values ($1, 'standard') returning id", [orgName]));
    const user = await tx.one<{ id: string }>(
      `insert into users (email, name, password_hash) values ($1, $2, $3)
       on conflict (email) do update set password_hash = excluded.password_hash, disabled = false returning id`,
      [email.trim().toLowerCase(), name, await hashPassword(password)],
    );
    await tx.query(
      `insert into memberships (user_id, org_id, role) values ($1, $2, 'admin')
       on conflict (user_id, org_id) do update set role = 'admin'`,
      [user!.id, org!.id],
    );
  });
}
