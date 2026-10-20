export interface Config {
  port: number;
  host: string;
  /** Pfad, unter dem Lykora erreichbar ist, z. B. "/lykora". Leer für die Wurzel. */
  basePath: string;
  /** Öffentliche Adresse inklusive Basispfad; landet im Einstiegs-QR. */
  publicUrl: string;
  databaseUrl: string;
  dataDir: string;
  logLevel: string;
  sessionDays: number;
  /** Gemeinsames Geheimnis für eingehende SMS vom SMS-Gateway. Leer schaltet den Eingang ab. */
  smsWebhookSecret: string;
  admin?: { email: string; password: string; name: string };
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const basePath = normalizeBasePath(env.BASE_PATH ?? "/lykora");
  const port = Number(env.PORT ?? 3000);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL fehlt");
  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    basePath,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}${basePath}`).replace(/\/+$/, ""),
    databaseUrl,
    dataDir: env.DATA_DIR ?? "./data",
    logLevel: env.LOG_LEVEL ?? "info",
    sessionDays: Number(env.SESSION_DAYS ?? 14),
    smsWebhookSecret: env.SMS_WEBHOOK_SECRET ?? "",
    admin:
      env.ADMIN_EMAIL && env.ADMIN_PASSWORD
        ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME ?? "Admin" }
        : undefined,
  };
}
