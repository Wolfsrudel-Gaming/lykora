import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config, VersionInfo } from "../config.ts";
import type { Db } from "../db.ts";
import { safeEqual } from "../lib/crypto.ts";
import { badRequest, conflict, unauthorized } from "../lib/errors.ts";

export type UpdaterState = "idle" | "pulling" | "updating" | "restarting" | "failed" | "rolled_back" | "unsupported";
export const UPDATER_STATES: UpdaterState[] = ["idle", "pulling", "updating", "restarting", "failed", "rolled_back", "unsupported"];
export type UpdateTrigger = "auto" | "manual";
export type HistoryState = "running" | "succeeded" | "failed" | "rolled_back";

export interface UpdateWindow {
  from: string;
  to: string;
}

export interface UpdateSettings {
  auto: boolean;
  window: UpdateWindow | null;
}

/** Version im Image der Registry, aus den Labels org.opencontainers.image.*. */
export interface RemoteVersion extends VersionInfo {
  digest: string;
  source: string | null;
}

export interface Change {
  sha: string;
  title: string;
  date: string | null;
  url: string;
}

export interface ActiveEvent {
  id: string;
  name: string;
  status: string;
}

export interface UpdateStatus {
  configured: boolean;
  image: string | null;
  current: VersionInfo;
  available: (VersionInfo & { digest: string }) | null;
  upToDate: boolean | null;
  lastCheckAt: string | null;
  checkError: string | null;
  changes: Change[];
  settings: UpdateSettings;
  timezone: string;
  blockedBy: { reason: "event_running"; events: ActiveEvent[] } | { reason: "outside_window"; nextWindowAt: string } | null;
  updater: { connected: boolean; lastSeenAt: string | null; state: UpdaterState | null; message: string | null };
  pending: { trigger: UpdateTrigger; requestedAt: string; to: VersionInfo } | null;
  history: {
    id: string;
    trigger: UpdateTrigger;
    state: HistoryState;
    from: VersionInfo;
    to: VersionInfo;
    message: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
}

export interface Plan {
  action: "wait" | "update";
  reason: string;
  pollSeconds: number;
  target?: { commit: string | null; version: string | null; digest: string };
}

/** Für Tests austauschbar: Netz, Uhr und Plattform. */
export interface UpdateOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Wie process.arch, z. B. "x64" oder "arm64". */
  arch?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
/** So lange gilt der Updater nach seiner letzten Anfrage als verbunden. */
const UPDATER_ONLINE_MS = 3 * 60_000;
/**
 * Ein laufendes Update, von dem der Updater so lange nichts mehr gemeldet hat, gilt beim Neustart als
 * gescheitert. Gezählt wird ab dem letzten Bericht, nicht ab dem Beginn: Ein langsames Ziehen darf dauern.
 * Dieselbe Spanne gilt nach einem abgeschlossenen Update für den Rückfall-Bericht des Updaters.
 */
const STALE_UPDATE_MS = 15 * 60_000;
/** Eine gescheiterte Version versucht das automatische Update erst nach dieser Pause erneut, wie der Updater. */
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60_000;
const MAX_CHANGES = 30;
const MAX_MESSAGE = 4000;
const DEFAULT_REPO = "Wolfsrudel-Gaming/lykora";
const ACTIVE_STATUSES = ["running", "paused", "recalled"];

// ---------- Registry ----------

export class RegistryError extends Error {}

const notPublic = () => new RegistryError("Image nicht gefunden oder nicht öffentlich");

export interface ImageRef {
  /** Host der Registry, ggf. mit Port; docker.io wird zu registry-1.docker.io. */
  registry: string;
  repository: string;
  /** Tag oder Digest. */
  reference: string;
  baseUrl: string;
}

const REPOSITORY = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;
const TAG = /^[\w][\w.-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/** Ohne Registry und Namensraum, z. B. lykora-server:latest, ist das Image lokal gebaut; so sieht es auch der Updater. */
export const isLocalImage = (image: string) => !image.includes("/");

/** Zerlegt [host[:port]/]repo[:tag|@digest]. HTTPS, nur localhost über HTTP (Tests). */
export function parseImageRef(image: string): ImageRef {
  let rest = image.trim();
  let host = "docker.io";
  const slash = rest.indexOf("/");
  if (slash > 0) {
    const first = rest.slice(0, slash);
    if (first.includes(".") || first.includes(":") || first === "localhost") {
      host = first;
      rest = rest.slice(slash + 1);
    }
  }
  let reference = "latest";
  const at = rest.indexOf("@");
  const colon = rest.lastIndexOf(":");
  if (at >= 0) {
    reference = rest.slice(at + 1);
    rest = rest.slice(0, at);
  } else if (colon >= 0) {
    reference = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  if (host === "docker.io" && !rest.includes("/")) rest = `library/${rest}`;
  if (!REPOSITORY.test(rest) || !(TAG.test(reference) || DIGEST.test(reference))) {
    throw new RegistryError(`Image-Adresse „${image}“ ist ungültig`);
  }
  const registry = host === "docker.io" ? "registry-1.docker.io" : host;
  return { registry, repository: rest, reference, baseUrl: `${isLocalHost(registry) ? "http" : "https"}://${registry}` };
}

const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** Node-Namen der Architekturen in die der Registry. */
const ARCHITECTURES: Record<string, string> = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" };

/** Schlüssel-Wert-Paare aus WWW-Authenticate, z. B. Bearer realm="…",service="…",scope="…". */
function parseChallenge(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)="([^"]*)"/g)) params[m[1]!.toLowerCase()] = m[2]!;
  return params;
}

async function readJson(res: Response): Promise<any> {
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new RegistryError("Antwort der Registry ist nicht lesbar");
  }
}

/**
 * Liest Digest und Versions-Labels des Images für die eigene Plattform (Registry-API v2).
 * Bei 401 holt sie einen Bearer-Token, anonym oder mit Basic-Zugang, und fragt erneut.
 */
export async function fetchRemoteVersion(
  image: string,
  opts: { fetch: typeof fetch; arch: string; auth?: { user: string; token: string }; registryUrl?: string },
): Promise<RemoteVersion> {
  const ref = parseImageRef(image);
  // Erreicht der Server die Registry unter einer anderen Adresse als Docker (etwa auf dem Host), gilt die.
  const baseUrl = opts.registryUrl || ref.baseUrl;
  const registryHost = new URL(baseUrl).host;
  const basic = opts.auth ? `Basic ${Buffer.from(`${opts.auth.user}:${opts.auth.token}`).toString("base64")}` : undefined;
  let authorization: string | undefined;

  const send = async (url: string | URL, headers: Record<string, string>) => {
    try {
      return await opts.fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err: any) {
      const timeout = err?.name === "TimeoutError";
      throw new RegistryError(`Registry ${registryHost} ${timeout ? "antwortet nicht" : "ist nicht erreichbar"}`);
    }
  };

  const login = async (challenge: string | null): Promise<string> => {
    const scheme = challenge?.split(" ")[0]?.toLowerCase();
    if (scheme === "basic" && basic) return basic;
    if (scheme !== "bearer") throw notPublic();
    const params = parseChallenge(challenge!);
    let realm: URL;
    try {
      realm = new URL(params.realm ?? "");
    } catch {
      throw new RegistryError("Registry nennt keinen gültigen Anmeldedienst");
    }
    // Zugangsdaten nie unverschlüsselt verschicken.
    if (realm.protocol !== "https:" && !(realm.protocol === "http:" && (isLocalHost(realm.host) || realm.host === registryHost))) {
      throw new RegistryError("Anmeldedienst der Registry nutzt kein HTTPS");
    }
    if (params.service) realm.searchParams.set("service", params.service);
    realm.searchParams.set("scope", params.scope ?? `repository:${ref.repository}:pull`);
    const res = await send(realm, basic ? { authorization: basic } : {});
    if (res.status === 401 || res.status === 403) throw notPublic();
    if (!res.ok) throw new RegistryError(`Anmeldung an der Registry scheitert mit HTTP ${res.status}`);
    const body = await readJson(res);
    const token = body?.token ?? body?.access_token;
    if (typeof token !== "string" || !token) throw new RegistryError("Registry liefert keinen Token");
    return `Bearer ${token}`;
  };

  const request = async (path: string, accept?: string): Promise<Response> => {
    const url = `${baseUrl}/v2/${ref.repository}/${path}`;
    const headers = () => ({ ...(accept ? { accept } : {}), ...(authorization ? { authorization } : {}) });
    let res = await send(url, headers());
    if (res.status === 401 && !authorization) {
      authorization = await login(res.headers.get("www-authenticate"));
      res = await send(url, headers());
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) throw notPublic();
    if (res.status === 429) throw new RegistryError("Registry meldet zu viele Anfragen; später erneut prüfen");
    if (!res.ok) throw new RegistryError(`Registry antwortet mit HTTP ${res.status}`);
    return res;
  };

  const manifest = async (reference: string) => {
    const res = await request(`manifests/${reference}`, MANIFEST_TYPES);
    const raw = Buffer.from(await res.arrayBuffer());
    const digest = res.headers.get("docker-content-digest") ?? `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    let body: any;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new RegistryError("Manifest der Registry ist nicht lesbar");
    }
    return { digest, body };
  };

  const top = await manifest(ref.reference);
  let manifestBody = top.body;
  if (Array.isArray(top.body?.manifests)) {
    const arch = ARCHITECTURES[opts.arch] ?? opts.arch;
    // Attestierungen tragen die Plattform unknown/unknown und fallen damit heraus.
    const entry = top.body.manifests.find(
      (m: any) =>
        m?.platform?.os === "linux" &&
        m.platform.architecture === arch &&
        m.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest" &&
        typeof m.digest === "string",
    );
    if (!entry || !DIGEST.test(entry.digest)) throw new RegistryError(`Image enthält keine Version für linux/${arch}`);
    manifestBody = (await manifest(entry.digest)).body;
  }
  const configDigest = manifestBody?.config?.digest;
  if (typeof configDigest !== "string" || !DIGEST.test(configDigest)) throw new RegistryError("Manifest ohne Konfiguration");
  const config = await readJson(await request(`blobs/${configDigest}`));
  const labels: Record<string, unknown> = config?.config?.Labels ?? {};
  const label = (name: string) => {
    const value = labels[`org.opencontainers.image.${name}`];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const commit = label("revision");
  if (!commit) throw new RegistryError("Image trägt keine Versionsangaben (Label org.opencontainers.image.revision)");
  return {
    version: label("version") ?? commit.slice(0, 7),
    commit,
    builtAt: label("created"),
    digest: top.digest,
    source: label("source"),
  };
}

/** Gleicher Commit, auch wenn eine Seite nur die Kurzform kennt. */
export function sameCommit(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x));
}

/** Neuer heißt: anderer Commit und später gebaut. Ohne eigenes Build-Datum (lokaler Build) zählt nur der Commit. */
export function isNewer(current: VersionInfo, remote: VersionInfo): boolean {
  if (!remote.commit || sameCommit(current.commit, remote.commit)) return false;
  if (!current.builtAt) return true;
  const remoteAt = remote.builtAt ? Date.parse(remote.builtAt) : NaN;
  const currentAt = Date.parse(current.builtAt);
  return !Number.isNaN(remoteAt) && (Number.isNaN(currentAt) || remoteAt > currentAt);
}

// ---------- Änderungen von GitHub ----------

const COMMIT = /^[0-9a-f]{7,40}$/i;
const REPO = /^[\w.-]+\/[\w.-]+$/;

/** owner/repo aus einer GitHub-Adresse wie https://github.com/Wolfsrudel-Gaming/lykora. */
export function githubRepoOf(source: string | null): string | null {
  const m = source?.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return m ? m[1]! : null;
}

/** Commits zwischen zwei Ständen über die Compare-API, neueste zuerst. */
export async function fetchChanges(fetchFn: typeof fetch, repo: string, from: string, to: string): Promise<Change[]> {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/compare/${from}...${to}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "lykora-server" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub antwortet mit HTTP ${res.status}`);
  const body: any = await res.json();
  const commits: any[] = Array.isArray(body?.commits) ? body.commits : [];
  return commits
    .slice(-MAX_CHANGES)
    .reverse()
    .map((c) => ({
      sha: String(c.sha),
      title: String(c.commit?.message ?? "").split("\n")[0]!,
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null,
      url: typeof c.html_url === "string" ? c.html_url : `https://github.com/${repo}/commit/${c.sha}`,
    }));
}

// ---------- Zeitfenster ----------

export const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";
const TIME = new RegExp(TIME_PATTERN);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Minuten seit Mitternacht in der Zeitzone. */
export function localMinutes(date: Date, timeZone: string): number {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return part("hour") * 60 + part("minute");
}

/** Fenster dürfen über Mitternacht gehen, z. B. 23:00–05:00. Das Ende gehört nicht mehr dazu. */
export function inWindow(date: Date, window: UpdateWindow, timeZone: string): boolean {
  const now = localMinutes(date, timeZone);
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Nächster Beginn des Fensters nach date, auch über eine Zeitumstellung hinweg. */
export function nextWindowStart(date: Date, window: UpdateWindow, timeZone: string): Date {
  const from = minutesOf(window.from);
  const minute = new Date(date);
  minute.setUTCSeconds(0, 0);
  const delta = (from - localMinutes(minute, timeZone) + 1440) % 1440 || 1440;
  const next = new Date(minute.getTime() + delta * 60_000);
  // Liegt eine Zeitumstellung dazwischen, ist die Ortszeit um eine Stunde verschoben.
  const drift = ((((from - localMinutes(next, timeZone)) % 1440) + 1440 + 720) % 1440) - 720;
  const fixed = new Date(next.getTime() + drift * 60_000);
  return drift && fixed > date ? fixed : next;
}

// ---------- Dienst ----------

interface HistoryRow {
  id: string;
  from_version: string | null;
  from_commit: string | null;
  to_version: string | null;
  to_commit: string | null;
  trigger: UpdateTrigger;
  state: HistoryState;
  message: string | null;
  started_at: Date;
  /** Letzter Bericht des Updaters zu einem laufenden Update. */
  updated_at: Date;
  finished_at: Date | null;
}

const clip = (text: string | undefined | null) =>
  text ? (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text) : null;

/**
 * Prüft die Registry auf neue Versionen, hält Einstellungen und Verlauf und entscheidet, wann der
 * Updater-Container aktualisieren darf. Was er zieht, bestimmt er selbst; der Server sagt nur, wann.
 * Laufzeitzustand liegt im Speicher und ist nach einem Neustart leer.
 */
export class UpdateService {
  private readonly db: Db;
  private readonly config: Config;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly arch: string;

  private lastCheckAt: Date | null = null;
  private available: RemoteVersion | null = null;
  private upToDate: boolean | null = null;
  private checkError: string | null = null;
  private changes: Change[] = [];
  /** Änderungen je Paar „eigener...neuer“ Commit. */
  private readonly changeCache = new Map<string, Change[]>();
  private updater: { lastSeenAt: Date | null; state: UpdaterState | null; message: string | null } = { lastSeenAt: null, state: null, message: null };
  /** Offener Auftrag „Jetzt aktualisieren“. */
  private manual: { requestedAt: Date } | null = null;
  private checking: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private token: Promise<string> | undefined;

  constructor(db: Db, config: Config, opts: UpdateOptions = {}) {
    this.db = db;
    this.config = config;
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.arch = opts.arch ?? process.arch;
  }

  /** LYKORA_IMAGE nennt ein Image in einer Registry; ein lokal gebautes lässt sich nicht erneuern. */
  get configured(): boolean {
    return this.config.updateImage !== "" && !isLocalImage(this.config.updateImage);
  }

  /** Warum es keine Updates gibt, wenn configured falsch ist. */
  private get whyNotConfigured(): string {
    const image = this.config.updateImage;
    return image
      ? `LYKORA_IMAGE nennt das lokal gebaute Image ${image}, das in keiner Registry liegt; daraus gibt es keine Updates`
      : "LYKORA_IMAGE ist nicht gesetzt; der Server kennt kein Image für Updates";
  }

  /**
   * Beim Start: Token bereitlegen, offenes Update abschließen, regelmäßig prüfen. Lässt sich der Token
   * nicht anlegen (DATA_DIR nicht beschreibbar), startet der Server trotzdem; die Schnittstelle des
   * Updaters antwortet dann mit 401, bis es klappt.
   */
  async start(log: (message: string) => void = () => {}): Promise<void> {
    await this.updaterToken().catch((err) => log(`Token des Updaters nicht verfügbar: ${(err as Error).message}; der Updater kann sich nicht anmelden`));
    await this.reconcile();
    if (!this.configured || this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.config.updateCheckMinutes * 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Token aus UPDATER_TOKEN, sonst aus DATA_DIR/updater.token; fehlt die Datei, legt der Server sie an. */
  updaterToken(): Promise<string> {
    this.token ??= this.loadToken().catch((err) => {
      this.token = undefined;
      throw err;
    });
    return this.token;
  }

  private async loadToken(): Promise<string> {
    if (this.config.updaterToken) return this.config.updaterToken;
    const file = join(this.config.dataDir, "updater.token");
    const existing = await readFile(file, "utf8").then(
      (text) => text.trim(),
      (err) => {
        if (err.code === "ENOENT") return "";
        throw err;
      },
    );
    if (existing) return existing;
    await mkdir(this.config.dataDir, { recursive: true });
    const token = randomBytes(32).toString("hex");
    // Der Updater liest die Datei über das Volume; andere Nutzer nicht.
    await writeFile(file, `${token}\n`, { mode: 0o640 });
    await chmod(file, 0o640);
    return token;
  }

  async authorizeUpdater(header: string | undefined): Promise<void> {
    const given = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    // Ohne Token (Datei nicht anlegbar) bleibt die Schnittstelle zu; der nächste Aufruf versucht es erneut.
    const expected = await this.updaterToken().catch(() => "");
    if (!given || !expected || !safeEqual(given, expected)) throw unauthorized("Token des Updaters fehlt oder ist falsch");
  }

  // ----- Prüfung -----

  /** Fragt die Registry. Läuft schon eine Prüfung, wartet sie auf deren Ergebnis. */
  check(): Promise<void> {
    if (!this.configured) return Promise.resolve();
    this.checking ??= this.runCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async runCheck(): Promise<void> {
    try {
      const remote = await fetchRemoteVersion(this.config.updateImage, {
        fetch: this.fetch,
        arch: this.arch,
        auth: this.config.registryAuth,
        registryUrl: this.config.registryUrl,
      });
      const newer = isNewer(this.config.build, remote);
      this.available = newer ? remote : null;
      this.upToDate = !newer;
      this.checkError = null;
      this.changes = newer ? await this.changesTo(remote) : [];
      if (!newer) this.manual = null;
    } catch (err) {
      // Eine bekannte neuere Version bleibt bekannt, auch wenn die Registry gerade nicht antwortet.
      this.upToDate = null;
      this.checkError = err instanceof RegistryError ? err.message : `Prüfung fehlgeschlagen: ${(err as Error).message}`;
    } finally {
      this.lastCheckAt = this.now();
    }
  }

  /** Fehler bei GitHub sind nicht schlimm: dann bleibt die Liste leer. */
  private async changesTo(remote: RemoteVersion): Promise<Change[]> {
    const from = this.config.build.commit;
    const repo = this.config.githubRepo || githubRepoOf(remote.source) || DEFAULT_REPO;
    if (!from || !remote.commit || !COMMIT.test(from) || !COMMIT.test(remote.commit) || !REPO.test(repo)) return [];
    const key = `${repo}:${from}...${remote.commit}`;
    const cached = this.changeCache.get(key);
    if (cached) return cached;
    try {
      const changes = await fetchChanges(this.fetch, repo, from, remote.commit);
      this.changeCache.set(key, changes);
      return changes;
    } catch {
      return [];
    }
  }

  // ----- Einstellungen -----

  async settings(): Promise<UpdateSettings> {
    const row = await this.db.one<{ value: Partial<UpdateSettings> }>("select value from system_settings where key = 'update'");
    return { auto: row?.value.auto === true, window: row?.value.window ?? null };
  }

  async saveSettings(settings: UpdateSettings, userId: string): Promise<void> {
    const { window } = settings;
    if (window && (!TIME.test(window.from) || !TIME.test(window.to))) throw badRequest("invalid_window", "Zeiten bitte als HH:MM angeben");
    if (window && window.from === window.to) throw badRequest("invalid_window", "Anfang und Ende des Zeitfensters müssen sich unterscheiden");
    const value = { auto: settings.auto, window: window ? { from: window.from, to: window.to } : null };
    await this.db.query(
      `insert into system_settings (key, value, updated_by) values ('update', $1, $2)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [JSON.stringify(value), userId],
    );
  }

  // ----- Entscheidung -----

  private activeEvents(): Promise<ActiveEvent[]> {
    return this.db.query<ActiveEvent>("select id, name, status from events where status = any($1) order by name", [ACTIVE_STATUSES]);
  }

  private updaterConnected(now: Date): boolean {
    const seen = this.updater.lastSeenAt;
    return !!seen && now.getTime() - seen.getTime() <= UPDATER_ONLINE_MS;
  }

  /** Was ein automatisches Update gerade aufhält. */
  private blockedBy(settings: UpdateSettings, events: ActiveEvent[], now: Date): UpdateStatus["blockedBy"] {
    if (events.length) return { reason: "event_running", events };
    if (settings.window && !inWindow(now, settings.window, this.config.updateTimezone)) {
      return { reason: "outside_window", nextWindowAt: nextWindowStart(now, settings.window, this.config.updateTimezone).toISOString() };
    }
    return null;
  }

  /** Manueller Auftrag „Jetzt aktualisieren“; das Zeitfenster gilt dafür nicht. */
  async requestApply(): Promise<void> {
    if (!this.configured) throw conflict("not_configured", this.whyNotConfigured);
    if (!this.lastCheckAt) await this.check();
    if (!this.available) throw conflict("up_to_date", "Keine neuere Version bekannt");
    const events = await this.activeEvents();
    if (events.length) {
      const err = conflict("event_running", `Während eines Events wird nicht aktualisiert: ${events.map((e) => e.name).join(", ")}`);
      throw Object.assign(err, { details: { events } });
    }
    const now = this.now();
    if (!this.updaterConnected(now)) {
      const since = this.updater.lastSeenAt ? "seit über 3 Minuten nicht" : "noch nicht";
      throw conflict("updater_offline", `Der Updater hat sich ${since} gemeldet; läuft der Container updater?`);
    }
    this.manual = { requestedAt: now };
  }

  /** Antwort auf die Frage des Updaters; zählt als Lebenszeichen. */
  async plan(): Promise<Plan> {
    const now = this.now();
    this.updater.lastSeenAt = now;
    const pollSeconds = this.config.updaterPollSeconds;
    const wait = (reason: string): Plan => ({ action: "wait", reason, pollSeconds });
    if (!this.configured) return wait(this.whyNotConfigured);
    const target = this.available;
    if (!target) return wait(this.lastCheckAt ? "Keine neuere Version bekannt" : "Noch nicht geprüft");
    const events = await this.activeEvents();
    if (events.length) return wait(`Event läuft: ${events.map((e) => e.name).join(", ")}`);
    const trigger: UpdateTrigger = this.manual ? "manual" : "auto";
    if (trigger === "auto") {
      const settings = await this.settings();
      if (!settings.auto) return wait("Automatische Updates sind aus");
      if (settings.window && !inWindow(now, settings.window, this.config.updateTimezone)) {
        return wait(`Außerhalb des Zeitfensters ${settings.window.from}–${settings.window.to}`);
      }
      // Kein Dauerversuch: Eine kaputte Version soll die Seite nicht bei jeder Frage kurz lahmlegen.
      const failed = await this.db.one(
        "select 1 from system_updates where to_commit = $1 and state in ('failed', 'rolled_back') and finished_at > $2",
        [target.commit, new Date(now.getTime() - RETRY_FAILED_AFTER_MS)],
      );
      if (failed) return wait("Update auf diese Version ist gescheitert; automatisch erst nach 6 Stunden erneut");
    }
    // Die neue Version hat sich beim Start schon als eingespielt vermerkt, doch hier läuft noch die alte:
    // Der Updater holt sie gerade zurück. Erst sein Bericht entscheidet (siehe correctLatest).
    const unsettled = await this.db.one("select 1 from system_updates where to_commit = $1 and state = 'succeeded' and finished_at > $2", [
      target.commit,
      new Date(now.getTime() - STALE_UPDATE_MS),
    ]);
    if (unsettled) return wait("Voriges Update auf diese Version ist noch nicht abgeschlossen");
    await this.startEntry(trigger, target, now);
    return {
      action: "update",
      reason: trigger === "manual" ? "Manueller Auftrag" : "Automatisches Update",
      pollSeconds,
      target: { commit: target.commit, version: target.version, digest: target.digest },
    };
  }

  /** Legt beim ersten „update“ für ein Ziel den Verlaufseintrag an. */
  private async startEntry(trigger: UpdateTrigger, target: RemoteVersion, now: Date): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(4711003)");
      const running = await tx.query<{ id: string; to_commit: string | null }>("select id, to_commit from system_updates where state = 'running'");
      if (running.some((r) => r.to_commit === target.commit)) return;
      if (running.length) {
        await tx.query(
          "update system_updates set state = 'failed', message = 'Abgelöst durch eine neuere Version', finished_at = $1 where state = 'running'",
          [now],
        );
      }
      const from = this.config.build;
      await tx.query(
        `insert into system_updates (from_version, from_commit, to_version, to_commit, trigger, state, started_at, updated_at)
         values ($1, $2, $3, $4, $5, 'running', $6, $6)`,
        [from.version, from.commit, target.version, target.commit, trigger, now],
      );
    });
  }

  /** Bericht des Updaters. Scheitern schließt den laufenden Verlaufseintrag; der manuelle Auftrag verfällt. */
  async report(report: { state: UpdaterState; message?: string }): Promise<void> {
    const now = this.now();
    const previous = this.updater.state;
    const message = clip(report.message);
    this.updater = { lastSeenAt: now, state: report.state, message };
    // idle direkt nach pulling im selben Prozess heißt: Der Updater hat nichts ersetzt.
    const ended =
      report.state === "failed" || report.state === "rolled_back" || report.state === "unsupported" || (report.state === "idle" && previous === "pulling");
    if (!ended) {
      // Jeder Zwischenstand zählt als Fortschritt: So lange gilt das Update nach einem Neustart nicht als liegengeblieben.
      await this.db.query("update system_updates set updated_at = $1 where state = 'running'", [now]);
      return;
    }
    const state: HistoryState = report.state === "rolled_back" ? "rolled_back" : "failed";
    const fallback = report.state === "rolled_back" ? "Zurück auf die alte Version" : "Update gescheitert";
    const closed = await this.db.query<{ id: string }>(
      "update system_updates set state = $1, message = $2, finished_at = $3 where state = 'running' returning id",
      [state, message ?? fallback, now],
    );
    if (!closed.length) await this.correctLatest(state, message ?? fallback, now);
    this.manual = null;
  }

  /**
   * Eine neue Version, die startet, vermerkt das Update beim Start als eingespielt (reconcile). Läuft sie
   * dann nicht gesund weiter, holt der Updater die alte zurück und meldet das hier, dem alten Server: Solange
   * der nicht mit dem Ziel läuft, gilt sein Bericht.
   */
  private async correctLatest(state: HistoryState, message: string, now: Date): Promise<void> {
    const latest = await this.db.one<{ id: string; state: HistoryState; to_commit: string | null; finished_at: Date | null }>(
      "select id, state, to_commit, finished_at from system_updates order by started_at desc limit 1",
    );
    if (!latest || latest.state !== "succeeded" || sameCommit(this.config.build.commit, latest.to_commit)) return;
    // Der Rückfall folgt dem Start der neuen Version binnen Minuten; ein alter Erfolg bleibt bestehen.
    if (!latest.finished_at || now.getTime() - latest.finished_at.getTime() > STALE_UPDATE_MS) return;
    await this.db.query("update system_updates set state = $2, message = $3, finished_at = $4 where id = $1", [latest.id, state, message, now]);
  }

  /**
   * Nach einem Neustart: Läuft der Server mit dem Ziel-Commit, ist das Update eingespielt.
   * Passt er nicht und hat der Updater seit 15 Minuten nichts gemeldet, gilt es als gescheitert.
   */
  async reconcile(): Promise<void> {
    const now = this.now();
    const own = this.config.build.commit;
    const running = await this.db.query<{ id: string; to_commit: string | null; updated_at: Date }>(
      "select id, to_commit, updated_at from system_updates where state = 'running'",
    );
    for (const row of running) {
      if (sameCommit(own, row.to_commit)) {
        await this.db.query("update system_updates set state = 'succeeded', message = 'Update eingespielt', finished_at = $2 where id = $1", [row.id, now]);
      } else if (now.getTime() - row.updated_at.getTime() > STALE_UPDATE_MS) {
        await this.db.query(
          "update system_updates set state = 'failed', message = 'Nicht abgeschlossen; der Server läuft noch mit der alten Version', finished_at = $2 where id = $1",
          [row.id, now],
        );
      }
    }
  }

  // ----- Status -----

  async status(): Promise<UpdateStatus> {
    const now = this.now();
    const [settings, events, rows] = await Promise.all([
      this.settings(),
      this.activeEvents(),
      this.db.query<HistoryRow>("select * from system_updates order by started_at desc limit 10"),
    ]);
    const available = this.available;
    const running = rows.find((r) => r.state === "running");
    const version = (v: string | null, commit: string | null): VersionInfo => ({ version: v ?? "?", commit, builtAt: null });
    let pending: UpdateStatus["pending"] = null;
    if (this.manual && available) {
      pending = { trigger: "manual", requestedAt: this.manual.requestedAt.toISOString(), to: versionOf(available) };
    } else if (running) {
      pending = { trigger: running.trigger, requestedAt: running.started_at.toISOString(), to: version(running.to_version, running.to_commit) };
    }
    return {
      configured: this.configured,
      image: this.config.updateImage || null,
      current: this.config.build,
      available: available ? { ...versionOf(available), digest: available.digest } : null,
      upToDate: this.upToDate,
      lastCheckAt: this.lastCheckAt?.toISOString() ?? null,
      // Ein lokal gebautes Image sagt das Dashboard mit demselben Satz, statt eine Registry zu befragen.
      checkError: this.configured || !this.config.updateImage ? this.checkError : this.whyNotConfigured,
      changes: available ? this.changes : [],
      settings,
      timezone: this.config.updateTimezone,
      blockedBy: this.blockedBy(settings, events, now),
      updater: {
        connected: this.updaterConnected(now),
        lastSeenAt: this.updater.lastSeenAt?.toISOString() ?? null,
        state: this.updater.state,
        message: this.updater.message,
      },
      pending,
      history: rows.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        state: r.state,
        from: version(r.from_version, r.from_commit),
        to: version(r.to_version, r.to_commit),
        message: r.message,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at?.toISOString() ?? null,
      })),
    };
  }
}

const versionOf = (v: VersionInfo): VersionInfo => ({ version: v.version, commit: v.commit, builtAt: v.builtAt });
