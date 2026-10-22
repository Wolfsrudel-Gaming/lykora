import { request, type IncomingMessage } from "node:http";

/** Höchste API-Version, gegen die der Updater geschrieben ist. Ältere Engines bekommen ihre eigene. */
const MAX_API_VERSION = "1.47";

export class DockerError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Container- und Image-Konfiguration, wie die Engine sie liefert; unbekannte Felder reichen wir durch. */
export interface ContainerConfig {
  Image?: string;
  Hostname?: string;
  Env?: string[] | null;
  Labels?: Record<string, string> | null;
  Cmd?: string[] | null;
  Entrypoint?: string[] | null;
  WorkingDir?: string;
  User?: string;
  Healthcheck?: { Test?: string[] } & Record<string, unknown>;
  ExposedPorts?: Record<string, object> | null;
  Volumes?: Record<string, object> | null;
  StopSignal?: string;
  Tty?: boolean;
  [key: string]: unknown;
}

export interface EndpointSettings {
  Aliases?: string[] | null;
  IPAMConfig?: Record<string, unknown> | null;
  Links?: string[] | null;
  DriverOpts?: Record<string, string> | null;
  [key: string]: unknown;
}

export interface ContainerInfo {
  Id: string;
  /** Mit führendem „/“, z. B. „/lykora-server-1“. */
  Name: string;
  /** ID des Images, mit dem der Container läuft. */
  Image: string;
  RestartCount: number;
  Config: ContainerConfig;
  HostConfig: { NetworkMode?: string } & Record<string, unknown>;
  NetworkSettings: { Networks?: Record<string, EndpointSettings> | null };
  State: { Status: string; Running: boolean; ExitCode?: number; Health?: { Status: string } };
}

export interface ContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  State: string;
  Labels: Record<string, string>;
}

/** Ein Manifest des Images, wie die Engine es mit manifests=1 nennt (nur mit containerd-Image-Store). */
export interface ImageManifest {
  ID: string;
  /** „image“ oder „attestation“ */
  Kind?: string;
  Available?: boolean;
  ImageData?: { Platform?: { os?: string; architecture?: string; variant?: string } } | null;
  [key: string]: unknown;
}

export interface ImageInfo {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
  Config?: ContainerConfig | null;
  /** Leer ohne manifests=1 oder mit dem klassischen Image-Store. */
  Manifests?: ImageManifest[] | null;
}

/** Zugang zur Registry fürs Ziehen; die Engine erwartet ihn base64url-kodiert im Header X-Registry-Auth. */
export interface RegistryAuth {
  user: string;
  token: string;
  server: string;
}

interface CallOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Statuscodes, die kein Fehler sind, z. B. 304 beim Starten eines laufenden Containers. */
  accept?: number[];
  timeoutMs?: number;
}

const versionNumber = (v: string) => v.split(".").map(Number) as [number, number];
const older = (a: string, b: string) => {
  const [am, an] = versionNumber(a);
  const [bm, bn] = versionNumber(b);
  return am < bm || (am === bm && an < bn);
};

/** Wählt die API-Version: unsere höchste, höchstens die der Engine, mindestens deren kleinste. */
export function negotiateVersion(engine: { ApiVersion: string; MinAPIVersion?: string }): string {
  let version = older(engine.ApiVersion, MAX_API_VERSION) ? engine.ApiVersion : MAX_API_VERSION;
  if (engine.MinAPIVersion && older(version, engine.MinAPIVersion)) version = engine.MinAPIVersion;
  return version;
}

/** Zerlegt den Log-Strom eines Containers ohne TTY: 8 Byte Kopf (Strom, 0, 0, 0, Länge) je Block. */
export function demuxLogs(data: Buffer): string {
  const parts: Buffer[] = [];
  let pos = 0;
  while (pos + 8 <= data.length && data[pos]! <= 2 && data.readUIntBE(pos + 1, 3) === 0) {
    const size = data.readUInt32BE(pos + 4);
    parts.push(data.subarray(pos + 8, pos + 8 + size));
    pos += 8 + size;
  }
  return pos === 0 ? data.toString("utf8") : Buffer.concat(parts).toString("utf8");
}

const readAll = (res: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });

const errorMessage = (body: Buffer) => {
  try {
    return String(JSON.parse(body.toString("utf8")).message ?? "");
  } catch {
    return body.toString("utf8").trim();
  }
};

/** Docker-Engine-API über den Unix-Socket, ohne weitere Abhängigkeiten. */
export class DockerClient {
  readonly socketPath: string;
  private version?: Promise<string>;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  private send(method: string, path: string, opts: CallOptions): Promise<IncomingMessage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query ?? {})) if (value !== undefined) query.set(key, String(value));
    const qs = query.size ? `?${query}` : "";
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          method,
          path: `${path}${qs}`,
          headers: {
            host: "docker",
            ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
            ...opts.headers,
          },
          timeout: opts.timeoutMs ?? 60_000,
        },
        resolve,
      );
      req.on("timeout", () => req.destroy(new Error(`Docker antwortet nicht: ${method} ${path}`)));
      req.on("error", reject);
      req.end(payload);
    });
  }

  /** Fragt einmal GET /version und hängt danach jede Anfrage an /v<Version>. */
  apiVersion(): Promise<string> {
    this.version ??= this.send("GET", "/version", {})
      .then(async (res) => {
        const body = await readAll(res);
        if (res.statusCode !== 200) throw new DockerError(res.statusCode ?? 500, errorMessage(body));
        return negotiateVersion(JSON.parse(body.toString("utf8")));
      })
      .catch((err) => {
        this.version = undefined;
        throw err;
      });
    return this.version;
  }

  private async open(method: string, path: string, opts: CallOptions = {}): Promise<IncomingMessage> {
    const res = await this.send(method, `/v${await this.apiVersion()}${path}`, opts);
    const status = res.statusCode ?? 500;
    if (status >= 300 && !opts.accept?.includes(status)) {
      throw new DockerError(status, errorMessage(await readAll(res)) || `${method} ${path}: ${status}`);
    }
    return res;
  }

  private async call<T>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
    const body = await readAll(await this.open(method, path, opts));
    return (body.length ? JSON.parse(body.toString("utf8")) : undefined) as T;
  }

  /** null, wenn es den Container oder das Image nicht gibt. */
  private async optional<T>(promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (err) {
      if (err instanceof DockerError && err.statusCode === 404) return null;
      throw err;
    }
  }

  listContainers(filters: Record<string, string[]>, all = false): Promise<ContainerSummary[]> {
    return this.call("GET", "/containers/json", { query: { all: all ? 1 : undefined, filters: JSON.stringify(filters) } });
  }

  inspectContainer(id: string): Promise<ContainerInfo | null> {
    return this.optional(this.call("GET", `/containers/${encodeURIComponent(id)}/json`));
  }

  /** Mit manifests auch die Manifeste je Plattform; das kennt die API ab 1.48. */
  async inspectImage(ref: string, manifests = false): Promise<ImageInfo | null> {
    const query = manifests && !older(await this.apiVersion(), "1.48") ? { manifests: 1 } : undefined;
    return this.optional(this.call("GET", `/images/${encodeURIComponent(ref)}/json`, { query }));
  }

  /**
   * Zieht ein Image. Die Engine meldet den Fortschritt als JSON-Zeilen; ein Fehler steht in
   * einer davon, nicht im Statuscode.
   */
  async pull(repo: string, tag: string, auth?: RegistryAuth, onProgress?: (status: string) => void): Promise<void> {
    const headers: Record<string, string> = {};
    if (auth) {
      // URL-sicheres Base64 mit Auffüllzeichen, wie es auch die Docker-CLI schickt
      const json = JSON.stringify({ username: auth.user, password: auth.token, serveraddress: auth.server });
      headers["x-registry-auth"] = Buffer.from(json).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    }
    const res = await this.open("POST", "/images/create", { query: { fromImage: repo, tag }, headers, timeoutMs: 30 * 60_000 });
    let rest = "";
    let failure: string | undefined;
    const handle = (line: string) => {
      if (!line.trim()) return;
      let event: { status?: string; id?: string; error?: string; errorDetail?: { message?: string } };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.error || event.errorDetail) failure ??= event.errorDetail?.message || event.error;
      else if (event.status && !event.id) onProgress?.(event.status);
    };
    res.setEncoding("utf8");
    for await (const chunk of res) {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(rest);
    if (failure) throw new DockerError(500, failure);
  }

  async tagImage(image: string, repo: string, tag: string): Promise<void> {
    await this.call("POST", `/images/${encodeURIComponent(image)}/tag`, { query: { repo, tag } });
  }

  async removeImage(image: string): Promise<void> {
    await this.call("DELETE", `/images/${encodeURIComponent(image)}`);
  }

  createContainer(name: string, body: object): Promise<{ Id: string }> {
    return this.call("POST", "/containers/create", { query: { name }, body });
  }

  async startContainer(id: string): Promise<void> {
    await this.call("POST", `/containers/${encodeURIComponent(id)}/start`, { accept: [304] });
  }

  async stopContainer(id: string, timeoutSeconds: number): Promise<void> {
    await this.call("POST", `/containers/${encodeURIComponent(id)}/stop`, {
      query: { t: timeoutSeconds },
      accept: [304],
      timeoutMs: (timeoutSeconds + 30) * 1000,
    });
  }

  async renameContainer(id: string, name: string): Promise<void> {
    await this.call("POST", `/containers/${encodeURIComponent(id)}/rename`, { query: { name } });
  }

  /** Löscht den Container; benannte und anonyme Volumes bleiben. */
  async removeContainer(id: string, force = false): Promise<void> {
    await this.call("DELETE", `/containers/${encodeURIComponent(id)}`, { query: { force: force ? 1 : undefined } });
  }

  async connectNetwork(network: string, container: string, endpoint: EndpointSettings): Promise<void> {
    await this.call("POST", `/networks/${encodeURIComponent(network)}/connect`, {
      body: { Container: container, EndpointConfig: endpoint },
    });
  }

  /** Die letzten Zeilen der Ausgabe eines Containers. */
  async logs(id: string, tail: number, tty = false): Promise<string> {
    const res = await this.open("GET", `/containers/${encodeURIComponent(id)}/logs`, { query: { stdout: 1, stderr: 1, tail } });
    const data = await readAll(res);
    return tty ? data.toString("utf8") : demuxLogs(data);
  }
}
