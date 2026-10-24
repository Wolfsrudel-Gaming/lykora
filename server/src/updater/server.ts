import { readFile } from "node:fs/promises";

export type UpdaterState = "idle" | "pulling" | "updating" | "restarting" | "failed" | "rolled_back" | "unsupported";

export interface Plan {
  action: "wait" | "update";
  reason: string;
  pollSeconds: number;
  target?: { commit: string | null; version: string | null; digest: string };
}

export interface ServerClientOptions {
  /** Adresse des Servers inklusive Basispfad, z. B. http://server:3000/lykora. */
  url: string;
  /** Fester Token aus UPDATER_TOKEN; sonst aus tokenFile. */
  token?: string;
  tokenFile?: string;
  fetch?: typeof fetch;
}

/**
 * Spricht mit dem Lykora-Server: fragt, ob aktualisiert werden soll, und meldet den Stand.
 * Den Token legt der Server beim ersten Start an; fehlt die Datei noch oder passt sie nicht
 * mehr (401), liest der Client sie neu.
 */
export class ServerClient {
  private readonly opts: ServerClientOptions;
  private readonly fetch: typeof fetch;
  private token?: string;

  constructor(opts: ServerClientOptions) {
    this.opts = { ...opts, url: opts.url.replace(/\/+$/, "") };
    this.fetch = opts.fetch ?? fetch;
    this.token = opts.token || undefined;
  }

  private async readToken(): Promise<string> {
    if (this.opts.token) return this.opts.token;
    const file = this.opts.tokenFile;
    const token = file ? (await readFile(file, "utf8").catch(() => "")).trim() : "";
    if (!token) throw new Error(`Kein Token für den Updater: UPDATER_TOKEN setzen oder ${file ?? "UPDATER_TOKEN_FILE"} bereitstellen`);
    return (this.token = token);
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const send = async (token: string) =>
      this.fetch(`${this.opts.url}/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    let res = await send(this.token ?? (await this.readToken()));
    if (res.status === 401 && !this.opts.token) res = await send(await this.readToken());
    if (res.status === 401) throw new Error("Server lehnt den Token des Updaters ab (401)");
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
    return res;
  }

  async plan(): Promise<Plan> {
    const res = await this.request("GET", "/updater/plan");
    return (await res.json()) as Plan;
  }

  async report(state: UpdaterState, message?: string, imageId?: string): Promise<void> {
    await this.request("POST", "/updater/report", { state, ...(message ? { message } : {}), ...(imageId ? { imageId } : {}) });
  }
}
