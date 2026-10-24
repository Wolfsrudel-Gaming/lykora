import { fileURLToPath } from "node:url";

/** Version des laufenden Builds; die CI setzt sie als Build-Argument ins Image. */
export interface VersionInfo {
  version: string;
  commit: string | null;
  builtAt: string | null;
}

export interface Config {
  port: number;
  host: string;
  /** Pfad, unter dem Lykora erreichbar ist, z. B. "/lykora". Leer für die Wurzel. */
  basePath: string;
  /** Öffentliche Adresse inklusive Basispfad; landet im Einstiegs-QR. */
  publicUrl: string;
  databaseUrl: string;
  dataDir: string;
  /** Mitgelieferte Klangbibliothek: <id>.ogg und library.json. */
  mediaLibraryDir: string;
  /** Eigene Kartenpakete: <paket>/{z}/{x}/{y}.png und <paket>/pack.json (Werkzeug server/tool/map_pack.py). */
  mapPacksDir: string;
  /** Build des Web-Dashboards (index.html und Assets). */
  webDir: string;
  logLevel: string;
  sessionDays: number;
  /** Gemeinsames Geheimnis für eingehende SMS vom SMS-Gateway. Leer schaltet den Eingang ab. */
  smsWebhookSecret: string;
  build: VersionInfo;
  /** Image, unter dem neue Versionen erscheinen, z. B. ghcr.io/wolfsrudel-gaming/lykora:testbuild. Leer schaltet die Prüfung ab. */
  updateImage: string;
  updateCheckMinutes: number;
  /** Zeitzone für das Zeitfenster der automatischen Updates. */
  updateTimezone: string;
  /** Token des Updaters. Leer: der Server legt DATA_DIR/updater.token an. */
  updaterToken: string;
  /** Zugang für private Images; leer heißt anonym. */
  registryAuth?: { user: string; token: string };
  /**
   * Adresse, unter der der Server die Registry erreicht, falls sie von der im Image abweicht, etwa
   * http://host.docker.internal:5000 für eine Registry auf dem Host (localhost:5000 im Image). Leer: aus LYKORA_IMAGE.
   */
  registryUrl: string;
  /** Abstand, in dem der Updater fragen soll; der Server gibt ihn mit jeder Antwort vor. */
  updaterPollSeconds: number;
  /** GitHub-Repo für die Liste der Änderungen. Leer: aus dem Label des Images, sonst Wolfsrudel-Gaming/lykora. */
  githubRepo: string;
  admin?: { email: string; password: string; name: string };
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function checkTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
  } catch {
    throw new Error(`UPDATE_TIMEZONE „${tz}“ ist keine gültige Zeitzone`);
  }
  return tz;
}

function checkRegistryUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\/[^/?#]+(\/[^?#]*)?$/.test(url)) throw new Error(`LYKORA_REGISTRY_URL „${value}“ muss mit http:// oder https:// beginnen`);
  return url;
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
    // src/ und dist/ liegen gleich tief im Server-Ordner, daher passen die Standardpfade für beide.
    mediaLibraryDir: env.MEDIA_LIBRARY_DIR || fileURLToPath(new URL("../media-library", import.meta.url)),
    mapPacksDir: env.MAP_PACKS_DIR || fileURLToPath(new URL("../map-packs", import.meta.url)),
    webDir: env.WEB_DIR || fileURLToPath(new URL("../../web/dist", import.meta.url)),
    logLevel: env.LOG_LEVEL ?? "info",
    sessionDays: Number(env.SESSION_DAYS ?? 14),
    smsWebhookSecret: env.SMS_WEBHOOK_SECRET ?? "",
    build: { version: env.LYKORA_VERSION || "dev", commit: env.LYKORA_COMMIT || null, builtAt: env.LYKORA_BUILT_AT || null },
    updateImage: (env.LYKORA_IMAGE ?? "").trim(),
    // Höchstens eine Woche: Ein Timer über 2^31 ms feuert in Node sofort und ständig.
    updateCheckMinutes: Math.min(7 * 24 * 60, Math.max(1, Number(env.UPDATE_CHECK_MINUTES) || 30)),
    updateTimezone: checkTimezone(env.UPDATE_TIMEZONE || "Europe/Berlin"),
    updaterToken: (env.UPDATER_TOKEN ?? "").trim(),
    registryAuth:
      env.LYKORA_REGISTRY_USER && env.LYKORA_REGISTRY_TOKEN ? { user: env.LYKORA_REGISTRY_USER, token: env.LYKORA_REGISTRY_TOKEN } : undefined,
    registryUrl: checkRegistryUrl(env.LYKORA_REGISTRY_URL ?? ""),
    updaterPollSeconds: Math.min(24 * 60 * 60, Math.max(1, Number(env.UPDATER_POLL_SECONDS) || 60)),
    githubRepo: (env.GITHUB_REPO ?? "").trim(),
    admin:
      env.ADMIN_EMAIL && env.ADMIN_PASSWORD
        ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME ?? "Admin" }
        : undefined,
  };
}
