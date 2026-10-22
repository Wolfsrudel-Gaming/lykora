import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerConfig, EndpointSettings } from "../src/updater/docker.ts";

/**
 * Nachgebaute Docker-Engine für die Updater-Tests: node:http auf einem Unix-Socket, Zustand im
 * Speicher. Kann, was der Updater braucht, und merkt sich jeden Aufruf.
 */

export interface FakeImage {
  Id: string;
  Config: ContainerConfig;
  /** Wie mit containerd-Image-Store; die Engine nennt sie nur auf manifests=1. */
  Manifests?: unknown[];
}

export interface FakeContainer {
  Id: string;
  Name: string;
  Image: string;
  RestartCount: number;
  Config: ContainerConfig;
  HostConfig: Record<string, unknown> & { NetworkMode?: string };
  NetworkSettings: { Networks: Record<string, EndpointSettings> };
  State: { Status: string; Running: boolean; ExitCode: number; Health?: { Status: string } };
  logs: string;
}

/** Wie sich ein Container eines Images nach dem Start verhält. */
export type Behaviour = "healthy" | "unhealthy" | "starting" | "exit";

const hex = () => randomBytes(32).toString("hex");
const withTag = (ref: string) => (ref.slice(ref.lastIndexOf("/") + 1).includes(":") ? ref : `${ref}:latest`);

export class FakeEngine {
  readonly socketPath = join(mkdtempSync(join(tmpdir(), "lykora-docker-")), "docker.sock");
  readonly images = new Map<string, FakeImage>();
  readonly tags = new Map<string, string>();
  readonly containers = new Map<string, FakeContainer>();
  /** Was ein Pull von „repo:tag“ liefert: eine Image-ID oder einen Fehler (im Strom oder als HTTP-Status). */
  readonly registry = new Map<string, { id: string } | { error: string; status?: number }>();
  readonly behaviour = new Map<string, Behaviour>();
  /** Ausgabe neuer Container je Image-ID. */
  readonly logs = new Map<string, string>();
  /** Jeder Aufruf als „METHODE /pfad?query“, ohne Versionspräfix. */
  readonly calls: string[] = [];
  readonly versions: string[] = [];
  readonly pullHeaders: Record<string, string | string[] | undefined>[] = [];
  /** Bodies von POST /containers/create. */
  readonly created: Record<string, unknown>[] = [];
  apiVersion = "1.45";
  pullDelayMs = 0;
  private server?: Server;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => this.json(res, 500, { message: String(err) }));
    });
    await new Promise<void>((resolve) => this.server!.listen(this.socketPath, resolve));
  }

  async close(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  addImage(ref: string, config: ContainerConfig, manifests?: unknown[]): string {
    const id = `sha256:${hex()}`;
    this.images.set(id, { Id: id, Config: config, ...(manifests ? { Manifests: manifests } : {}) });
    if (ref) this.tags.set(withTag(ref), id);
    return id;
  }

  /** Legt einen laufenden Container an, wie ihn Compose oder docker run anlegen würde. */
  addContainer(
    name: string,
    ref: string,
    opts: { env?: string[]; labels?: Record<string, string>; hostConfig?: FakeContainer["HostConfig"]; networks?: Record<string, EndpointSettings>; state?: string } = {},
  ): FakeContainer {
    const imageId = this.resolveImage(ref);
    if (!imageId) throw new Error(`Image ${ref} fehlt`);
    const c = this.instantiate(name, imageId, { Image: ref, Env: opts.env, Labels: opts.labels }, opts.hostConfig ?? { NetworkMode: "bridge" });
    c.NetworkSettings.Networks = opts.networks ?? { bridge: {} };
    for (const n of Object.values(c.NetworkSettings.Networks)) n.Aliases = [...(n.Aliases ?? []), c.Id.slice(0, 12)];
    c.State = opts.state === "running" || !opts.state ? { Status: "running", Running: true, ExitCode: 0 } : { Status: opts.state, Running: false, ExitCode: 0 };
    if (c.State.Running && this.hasHealthcheck(c)) c.State.Health = { Status: "healthy" };
    return c;
  }

  byName(name: string): FakeContainer | undefined {
    return [...this.containers.values()].find((c) => c.Name === `/${name}`);
  }

  private hasHealthcheck(c: FakeContainer): boolean {
    const test = c.Config.Healthcheck?.Test;
    return !!test?.length && test[0] !== "NONE";
  }

  private resolveImage(ref: string): string | undefined {
    if (this.images.has(ref)) return ref;
    return this.tags.get(withTag(ref));
  }

  private resolveContainer(key: string): FakeContainer | undefined {
    return this.containers.get(key) ?? [...this.containers.values()].find((c) => c.Name === `/${key}` || (key.length >= 12 && c.Id.startsWith(key)));
  }

  /** Legt einen Container an und ergänzt die Konfiguration wie die echte Engine um die des Images. */
  private instantiate(name: string, imageId: string, user: ContainerConfig, hostConfig: FakeContainer["HostConfig"]): FakeContainer {
    const img = this.images.get(imageId)!.Config;
    const id = hex();
    const env = [...(user.Env ?? [])];
    const keys = new Set(env.map((e) => e.split("=")[0]));
    for (const e of img.Env ?? []) if (!keys.has(e.split("=")[0])) env.push(e);
    const config: ContainerConfig = {
      ...user,
      Hostname: user.Hostname || id.slice(0, 12),
      Env: env,
      Labels: { ...img.Labels, ...user.Labels },
      WorkingDir: user.WorkingDir || img.WorkingDir || "",
      User: user.User || img.User || "",
      Healthcheck: user.Healthcheck ?? img.Healthcheck,
      StopSignal: user.StopSignal || img.StopSignal,
      ExposedPorts: { ...img.ExposedPorts, ...user.ExposedPorts },
      Volumes: { ...img.Volumes, ...user.Volumes },
    };
    if (!user.Entrypoint?.length) {
      config.Entrypoint = img.Entrypoint ?? null;
      if (!user.Cmd?.length) config.Cmd = img.Cmd ?? null;
    }
    if (!config.Healthcheck) delete config.Healthcheck;
    const c: FakeContainer = {
      Id: id,
      Name: `/${name}`,
      Image: imageId,
      RestartCount: 0,
      Config: config,
      HostConfig: hostConfig,
      NetworkSettings: { Networks: {} },
      State: { Status: "created", Running: false, ExitCode: 0 },
      logs: this.logs.get(imageId) ?? "",
    };
    this.containers.set(id, c);
    return c;
  }

  private json(res: ServerResponse, status: number, body?: unknown): void {
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  }

  private async body(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, "http://docker");
    const version = /^\/v(\d+\.\d+)(\/.*)$/.exec(url.pathname);
    const path = version ? version[2]! : url.pathname;
    if (version) this.versions.push(version[1]!);
    const q = url.searchParams;
    const method = req.method!;
    this.calls.push(`${method} ${decodeURIComponent(path)}${url.search}`);
    const notFound = (what: string) => this.json(res, 404, { message: `No such ${what}` });
    let m: RegExpExecArray | null;

    if (method === "GET" && path === "/version") return this.json(res, 200, { ApiVersion: this.apiVersion, MinAPIVersion: "1.24" });

    if (method === "GET" && path === "/containers/json") {
      const filters = JSON.parse(q.get("filters") ?? "{}") as Record<string, string[]>;
      const list = [...this.containers.values()].filter((c) => {
        if (!q.get("all") && !c.State.Running) return false;
        if (filters.status && !filters.status.includes(c.State.Status)) return false;
        return (filters.label ?? []).every((f) => {
          const [key, value] = f.split("=");
          return value === undefined ? key! in (c.Config.Labels ?? {}) : c.Config.Labels?.[key!] === value;
        });
      });
      return this.json(
        res,
        200,
        list.map((c) => ({ Id: c.Id, Names: [c.Name], Image: c.Config.Image, ImageID: c.Image, State: c.State.Status, Labels: c.Config.Labels })),
      );
    }

    if ((m = /^\/containers\/([^/]+)\/json$/.exec(path)) && method === "GET") {
      const c = this.resolveContainer(decodeURIComponent(m[1]!));
      if (!c) return notFound("container");
      const { logs: _logs, ...info } = c;
      return this.json(res, 200, info);
    }

    if ((m = /^\/images\/(.+)\/json$/.exec(path)) && method === "GET") {
      const id = this.resolveImage(decodeURIComponent(m[1]!));
      if (!id) return notFound("image");
      const tags = [...this.tags].filter(([, v]) => v === id).map(([k]) => k);
      const { Manifests, ...image } = this.images.get(id)!;
      return this.json(res, 200, { ...image, ...(q.get("manifests") ? { Manifests } : {}), RepoTags: tags });
    }

    if (method === "POST" && path === "/images/create") {
      this.pullHeaders.push(req.headers);
      const ref = `${q.get("fromImage")}:${q.get("tag")}`;
      const entry = this.registry.get(ref) ?? { error: `manifest for ${ref} not found: manifest unknown` };
      if ("status" in entry && entry.status) return this.json(res, entry.status, { message: entry.error });
      if (this.pullDelayMs) await new Promise((r) => setTimeout(r, this.pullDelayMs));
      res.writeHead(200, { "content-type": "application/json" });
      res.write(`${JSON.stringify({ status: `Pulling from ${q.get("fromImage")}`, id: q.get("tag") })}\r\n`);
      if ("error" in entry) {
        res.end(`${JSON.stringify({ errorDetail: { message: entry.error }, error: entry.error })}\r\n`);
        return;
      }
      this.tags.set(ref, entry.id);
      res.end(`${JSON.stringify({ status: `Status: Downloaded newer image for ${ref}` })}\r\n`);
      return;
    }

    if ((m = /^\/images\/(.+)\/tag$/.exec(path)) && method === "POST") {
      const id = this.resolveImage(decodeURIComponent(m[1]!));
      if (!id) return notFound("image");
      this.tags.set(`${q.get("repo")}:${q.get("tag")}`, id);
      return this.json(res, 201);
    }

    if ((m = /^\/images\/(.+)$/.exec(path)) && method === "DELETE") {
      const id = this.resolveImage(decodeURIComponent(m[1]!));
      if (!id) return notFound("image");
      if ([...this.containers.values()].some((c) => c.Image === id)) return this.json(res, 409, { message: "image is being used" });
      this.images.delete(id);
      for (const [k, v] of this.tags) if (v === id) this.tags.delete(k);
      return this.json(res, 200, [{ Deleted: id }]);
    }

    if (method === "POST" && path === "/containers/create") {
      const name = q.get("name")!;
      if (this.byName(name)) return this.json(res, 409, { message: `Conflict. The container name "/${name}" is already in use` });
      const body = await this.body(req);
      this.created.push(body);
      const { HostConfig, NetworkingConfig, ...config } = body;
      const imageId = this.resolveImage(config.Image);
      if (!imageId) return notFound("image");
      const c = this.instantiate(name, imageId, config, HostConfig);
      for (const [net, endpoint] of Object.entries((NetworkingConfig?.EndpointsConfig ?? {}) as Record<string, EndpointSettings>)) {
        c.NetworkSettings.Networks[net] = { ...endpoint, Aliases: [...(endpoint.Aliases ?? []), c.Id.slice(0, 12)] };
      }
      return this.json(res, 201, { Id: c.Id, Warnings: [] });
    }

    if ((m = /^\/networks\/([^/]+)\/connect$/.exec(path)) && method === "POST") {
      const body = await this.body(req);
      const c = this.resolveContainer(body.Container);
      if (!c) return notFound("container");
      const net = decodeURIComponent(m[1]!);
      if (net in c.NetworkSettings.Networks) return this.json(res, 403, { message: `endpoint already exists in network ${net}` });
      c.NetworkSettings.Networks[net] = { ...body.EndpointConfig, Aliases: [...(body.EndpointConfig?.Aliases ?? []), c.Id.slice(0, 12)] };
      return this.json(res, 200);
    }

    m = /^\/containers\/([^/]+)(\/[a-z]+)?$/.exec(path);
    const c = m ? this.resolveContainer(decodeURIComponent(m[1]!)) : undefined;
    if (m && !c) return notFound("container");
    if (c && method === "POST" && m![2] === "/start") {
      if (c.State.Running) return this.json(res, 304);
      const behaviour = this.behaviour.get(c.Image) ?? "healthy";
      if (behaviour === "exit") c.State = { Status: "exited", Running: false, ExitCode: 1 };
      else c.State = { Status: "running", Running: true, ExitCode: 0 };
      if (c.State.Running && this.hasHealthcheck(c)) c.State.Health = { Status: behaviour === "exit" ? "unhealthy" : behaviour };
      return this.json(res, 204);
    }
    if (c && method === "POST" && m![2] === "/stop") {
      if (!c.State.Running) return this.json(res, 304);
      c.State = { Status: "exited", Running: false, ExitCode: 0 };
      return this.json(res, 204);
    }
    if (c && method === "POST" && m![2] === "/rename") {
      const name = q.get("name")!;
      const other = this.byName(name);
      if (other && other !== c) return this.json(res, 409, { message: `Conflict. The container name "/${name}" is already in use` });
      c.Name = `/${name}`;
      return this.json(res, 204);
    }
    if (c && method === "GET" && m![2] === "/logs") {
      // Gemultiplext wie ohne TTY: 8 Byte Kopf je Block
      const data = Buffer.from(c.logs);
      const head = Buffer.alloc(8);
      head[0] = 1;
      head.writeUInt32BE(data.length, 4);
      res.writeHead(200, { "content-type": "application/vnd.docker.multiplexed-stream" }).end(Buffer.concat([head, data]));
      return;
    }
    if (c && method === "DELETE" && !m![2]) {
      if (c.State.Running && q.get("force") !== "1") return this.json(res, 409, { message: "container is running" });
      this.containers.delete(c.Id);
      return this.json(res, 204);
    }
    return this.json(res, 404, { message: `page not found: ${method} ${path}` });
  }
}
