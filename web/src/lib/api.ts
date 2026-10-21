import type {
  ActionRow,
  EventAction,
  EventDto,
  Game,
  GameDetail,
  GameSummary,
  GameVersion,
  LibrarySound,
  LogEntry,
  LoginResult,
  Materials,
  Me,
  MediaFile,
  Member,
  Message,
  OrgMembership,
  Outcome,
  Overview,
  PublicTeam,
  Role,
  Sos,
  Standing,
  TeamDetail,
  TeamStateSummary,
  TrackPoint,
  ValidationResult,
} from "./types.ts";

/** Fehler aus der API mit Code und Meldung des Servers ({error, message}). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiConfig {
  /** API-Wurzel, z. B. "/lykora/api" */
  root: string;
  token: () => string | null;
  /** Wird bei 401 gerufen, außer bei der Anmeldung selbst. */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  /** Rohdaten statt JSON, z. B. eine Datei */
  raw?: { body: Blob | ArrayBuffer; type: string };
  /** Antwort als Blob statt JSON */
  blob?: boolean;
  signal?: AbortSignal;
}

export function queryString(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

const STATUS_TEXT: Record<number, string> = {
  401: "Anmeldung erforderlich",
  403: "Keine Berechtigung",
  404: "Nicht gefunden",
  413: "Datei zu groß",
  415: "Dateityp nicht unterstützt",
};

export interface EventInput {
  gameId: string;
  version?: number;
  name: string;
  scheduledAt?: string;
  retentionDays?: number;
}

export interface EventPatch {
  name?: string;
  scheduledAt?: string | null;
  retentionDays?: number;
}

export interface MemberInput {
  email: string;
  name?: string;
  password?: string;
  role: Role;
}

export interface MessageInput {
  teamId: string | null;
  body: string;
  kind: "chat" | "hint" | "story";
  sender?: string;
}

export interface CueInput {
  teamId: string | null;
  audio: string;
  volume?: number;
  text?: string;
  sender?: string;
}

export interface TeamPatch {
  name?: string;
  color?: string;
  supervisorPresent?: boolean;
  arrived?: boolean;
}

export type StaffActionType =
  | "staff_reveal"
  | "staff_lock"
  | "staff_unlock"
  | "staff_solve"
  | "staff_reject"
  | "staff_points"
  | "staff_time"
  | "staff_item";

export class Api {
  private readonly cfg: ApiConfig;

  constructor(cfg: ApiConfig) {
    this.cfg = cfg;
  }

  url(path: string, query?: Query): string {
    return `${this.cfg.root}${path}${queryString(query)}`;
  }

  async request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: opts.blob ? "*/*" : "application/json" };
    const token = this.cfg.token();
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (opts.raw) {
      headers["content-type"] = opts.raw.type;
      payload = opts.raw.body;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const doFetch = this.cfg.fetch ?? globalThis.fetch.bind(globalThis);
    let res: Response;
    try {
      res = await doFetch(this.url(path, opts.query), { method, headers, body: payload, signal: opts.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new ApiError(0, "network", "Server nicht erreichbar. Netz prüfen und erneut versuchen.");
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 401 && path !== "/auth/login") this.cfg.onUnauthorized?.();
      const { error, message, ...details } = data;
      throw new ApiError(
        res.status,
        typeof error === "string" ? error : "error",
        typeof message === "string" ? message : (STATUS_TEXT[res.status] ?? `Fehler ${res.status}`),
        details,
      );
    }
    if (opts.blob) return (await res.blob()) as T;
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // Anmeldung

  login(email: string, password: string) {
    return this.request<LoginResult>("POST", "/auth/login", { email, password });
  }

  logout() {
    return this.request<void>("POST", "/auth/logout");
  }

  me() {
    return this.request<Me>("GET", "/me");
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.request<void>("POST", "/me/password", { currentPassword, newPassword });
  }

  // Organisationen

  orgs() {
    return this.request<OrgMembership[]>("GET", "/orgs");
  }

  createOrg(name: string, slug: string) {
    return this.request<OrgMembership & { created_at: string }>("POST", "/orgs", { name, slug });
  }

  members(orgId: string) {
    return this.request<Member[]>("GET", `/orgs/${orgId}/members`);
  }

  addMember(orgId: string, input: MemberInput) {
    return this.request<Member>("POST", `/orgs/${orgId}/members`, input);
  }

  removeMember(orgId: string, userId: string) {
    return this.request<void>("DELETE", `/orgs/${orgId}/members/${userId}`);
  }

  // Spiele

  validate(content: unknown) {
    return this.request<ValidationResult>("POST", "/validate", { content });
  }

  games(orgId: string) {
    return this.request<GameSummary[]>("GET", `/orgs/${orgId}/games`);
  }

  createGame(orgId: string, content: Game, comment?: string) {
    return this.request<GameSummary>("POST", `/orgs/${orgId}/games`, { content, comment });
  }

  game(gameId: string) {
    return this.request<GameDetail>("GET", `/games/${gameId}`);
  }

  saveVersion(gameId: string, content: Game, comment?: string) {
    return this.request<{ id: string; version: number }>("PUT", `/games/${gameId}`, { content, comment });
  }

  gameVersion(gameId: string, version: number) {
    return this.request<GameVersion>("GET", `/games/${gameId}/versions/${version}`);
  }

  archiveGame(gameId: string) {
    return this.request<void>("DELETE", `/games/${gameId}`);
  }

  materials(gameId: string) {
    return this.request<Materials>("GET", `/games/${gameId}/materials`);
  }

  // Medien und Klänge

  media(gameId: string) {
    return this.request<MediaFile[]>("GET", `/games/${gameId}/media`);
  }

  deleteMedia(gameId: string, mediaId: string) {
    return this.request<void>("DELETE", `/games/${gameId}/media/${mediaId}`);
  }

  librarySounds() {
    return this.request<LibrarySound[]>("GET", "/library/sounds");
  }

  /** Lädt eine Datei hoch und meldet den Fortschritt (0..1); fetch kann das nicht, daher XHR. */
  uploadMedia(gameId: string, file: File, onProgress?: (share: number) => void): Promise<MediaFile> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.url(`/games/${gameId}/media`, { filename: file.name }));
      const token = this.cfg.token();
      if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("content-type", mediaContentType(file));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () => reject(new ApiError(0, "network", "Server nicht erreichbar. Netz prüfen und erneut versuchen."));
      xhr.onload = () => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          // Keine JSON-Antwort, z. B. vom Proxy davor.
        }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data as unknown as MediaFile);
        if (xhr.status === 401) this.cfg.onUnauthorized?.();
        reject(
          new ApiError(
            xhr.status,
            typeof data.error === "string" ? data.error : "error",
            typeof data.message === "string" ? data.message : (STATUS_TEXT[xhr.status] ?? `Fehler ${xhr.status}`),
          ),
        );
      };
      xhr.send(file);
    });
  }

  // Events

  events(orgId: string) {
    return this.request<EventDto[]>("GET", `/orgs/${orgId}/events`);
  }

  createEvent(orgId: string, input: EventInput) {
    return this.request<EventDto>("POST", `/orgs/${orgId}/events`, input);
  }

  event(eventId: string) {
    return this.request<EventDto>("GET", `/events/${eventId}`);
  }

  eventGame(eventId: string) {
    return this.request<Game>("GET", `/events/${eventId}/game`);
  }

  updateEvent(eventId: string, patch: EventPatch) {
    return this.request<EventDto>("PATCH", `/events/${eventId}`, patch);
  }

  deleteEvent(eventId: string) {
    return this.request<void>("DELETE", `/events/${eventId}`);
  }

  eventAction(eventId: string, action: EventAction, reason?: string) {
    return this.request<EventDto>("POST", `/events/${eventId}/${action}`, reason ? { reason } : {});
  }

  overview(eventId: string) {
    return this.request<Overview>("GET", `/events/${eventId}/overview`);
  }

  standings(eventId: string) {
    return this.request<Standing[]>("GET", `/events/${eventId}/standings`);
  }

  team(eventId: string, teamId: string) {
    return this.request<TeamDetail>("GET", `/events/${eventId}/teams/${teamId}`);
  }

  track(eventId: string, teamId: string) {
    return this.request<TrackPoint[]>("GET", `/events/${eventId}/teams/${teamId}/track`);
  }

  updateTeam(eventId: string, teamId: string, patch: TeamPatch) {
    return this.request<PublicTeam>("PATCH", `/events/${eventId}/teams/${teamId}`, patch);
  }

  staffAction(eventId: string, teamId: string, type: StaffActionType, payload: Record<string, unknown>, note?: string) {
    return this.request<{ outcome?: Outcome; state: TeamStateSummary }>("POST", `/events/${eventId}/teams/${teamId}/actions`, {
      type,
      payload,
      note: note || undefined,
    });
  }

  log(eventId: string, after = 0, limit = 500) {
    return this.request<LogEntry[]>("GET", `/events/${eventId}/log`, undefined, { query: { after, limit } });
  }

  exportFile(eventId: string, file: "results.csv" | "log.csv") {
    return this.request<Blob>("GET", `/events/${eventId}/export/${file}`, undefined, { blob: true });
  }

  sos(eventId: string) {
    return this.request<Sos[]>("GET", `/events/${eventId}/sos`);
  }

  sosAction(eventId: string, sosId: string, action: "ack" | "resolve") {
    return this.request<Sos>("POST", `/events/${eventId}/sos/${sosId}/${action}`, {});
  }

  messages(eventId: string, after = 0) {
    return this.request<Message[]>("GET", `/events/${eventId}/messages`, undefined, { query: { after } });
  }

  sendMessage(eventId: string, input: MessageInput) {
    return this.request<Message>("POST", `/events/${eventId}/messages`, input);
  }

  sendCue(eventId: string, input: CueInput) {
    return this.request<Message>("POST", `/events/${eventId}/cues`, input);
  }

  /** Foto oder Video eines Teams; braucht den Token, daher als Blob statt als Bildadresse. */
  upload(eventId: string, uploadId: string) {
    return this.request<Blob>("GET", `/events/${eventId}/uploads/${uploadId}`, undefined, { blob: true });
  }
}

/** Content-Type für den Upload; manche Browser liefern für .ogg oder .m4a keinen oder einen anderen. */
export function mediaContentType(file: { name: string; type: string }): string {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    weba: "audio/webm",
    flac: "audio/flac",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
  };
  return byExt[ext] ?? (file.type || "application/octet-stream");
}

/** Aktionen eines Teams, z. B. für Foto-Prüfungen: letzte Antwort mit Upload an einer Station. */
export function latestUpload(actions: ActionRow[], stationId: string): string | null {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]!;
    if (a.type === "answer" && a.payload.station === stationId && typeof a.payload.upload === "string") return a.payload.upload;
  }
  return null;
}
