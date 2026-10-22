import { describe, expect, it } from "vitest";
import { demuxLogs, negotiateVersion, type ContainerInfo } from "../src/updater/docker.ts";
import { composeImageDigest, mergeConfig, parseReference, planReplacement } from "../src/updater/merge.ts";

const ID = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708";
const NEW_IMAGE = "sha256:neu";

const image = {
  Env: ["PATH=/usr/local/bin:/usr/bin", "NODE_ENV=production", "LYKORA_COMMIT=aaa"],
  Labels: { "org.opencontainers.image.revision": "aaa", "org.opencontainers.image.source": "https://github.com/Wolfsrudel-Gaming/lykora" },
  Cmd: ["node", "dist/server.js"],
  Entrypoint: ["docker-entrypoint.sh"],
  WorkingDir: "/app/server",
  User: "node",
  Healthcheck: { Test: ["CMD-SHELL", "node -e 1"], Interval: 30_000_000_000 },
  ExposedPorts: { "3000/tcp": {} },
  Volumes: { "/data": {} },
  StopSignal: "SIGTERM",
};

/** So legt Docker den Container an: Image-Werte plus das, was Compose dazugibt. */
const container = {
  ...image,
  Image: "ghcr.io/wolfsrudel-gaming/lykora:testbuild",
  Hostname: ID.slice(0, 12),
  Env: ["DATABASE_URL=postgres://db/lykora", "BASE_PATH=/lykora", ...image.Env],
  Labels: {
    ...image.Labels,
    "io.lykora.autoupdate": "true",
    "com.docker.compose.service": "server",
    "com.docker.compose.image": "sha256:alt",
  },
  Tty: false,
};

describe("Konfiguration zusammenführen", () => {
  it("lässt weg, was vom alten Image stammt, und behält eigene Werte", () => {
    const merged = mergeConfig(container, image, { containerId: ID, newImageId: NEW_IMAGE });
    expect(merged.Env).toEqual(["DATABASE_URL=postgres://db/lykora", "BASE_PATH=/lykora"]);
    expect(merged.Labels).toEqual({
      "io.lykora.autoupdate": "true",
      "com.docker.compose.service": "server",
      "com.docker.compose.image": NEW_IMAGE,
    });
    expect(merged.Cmd).toBeNull();
    expect(merged.Entrypoint).toBeNull();
    expect(merged.WorkingDir).toBe("");
    expect(merged.User).toBe("");
    expect(merged.Healthcheck).toBeUndefined();
    expect(merged.StopSignal).toBeUndefined();
    expect(merged.ExposedPorts).toEqual({});
    expect(merged.Volumes).toEqual({});
    expect(merged.Hostname).toBeUndefined();
    expect(merged.Image).toBe("ghcr.io/wolfsrudel-gaming/lykora:testbuild");
    expect(merged.Tty).toBe(false);
  });

  it("behält überschriebene Werte, auch wenn sie anders als im Image sind", () => {
    const own = {
      ...container,
      Env: [...container.Env.filter((e) => !e.startsWith("NODE_ENV=")), "NODE_ENV=development"],
      Labels: { ...container.Labels, "org.opencontainers.image.revision": "eigene" },
      Cmd: ["node", "dist/cli.js", "migrate"],
      WorkingDir: "/app",
      User: "0",
      Healthcheck: { Test: ["NONE"] },
      ExposedPorts: { "3000/tcp": {}, "9229/tcp": {} },
      Volumes: { "/data": {}, "/backup": {} },
      StopSignal: "SIGINT",
      Hostname: "lykora",
    };
    const merged = mergeConfig(own, image, { containerId: ID, newImageId: NEW_IMAGE });
    expect(merged.Env).toContain("NODE_ENV=development");
    expect(merged.Labels!["org.opencontainers.image.revision"]).toBe("eigene");
    // Gleicher Entrypoint, eigenes Cmd: bleibt
    expect(merged.Entrypoint).toBeNull();
    expect(merged.Cmd).toEqual(["node", "dist/cli.js", "migrate"]);
    expect(merged).toMatchObject({ WorkingDir: "/app", User: "0", Healthcheck: { Test: ["NONE"] }, StopSignal: "SIGINT", Hostname: "lykora" });
    expect(merged.ExposedPorts).toEqual({ "9229/tcp": {} });
    expect(merged.Volumes).toEqual({ "/backup": {} });
  });

  it("behält Cmd zu einem eigenen Entrypoint, auch wenn es dem des Images gleicht", () => {
    const merged = mergeConfig({ ...container, Entrypoint: ["/bin/sh", "-c"] }, image, { containerId: ID, newImageId: NEW_IMAGE });
    expect(merged.Entrypoint).toEqual(["/bin/sh", "-c"]);
    expect(merged.Cmd).toEqual(["node", "dist/server.js"]);
  });

  it("erkennt den Healthcheck des Images auch in anderer Reihenfolge und ohne leere Felder", () => {
    const { Test, Interval } = image.Healthcheck;
    const merged = mergeConfig({ ...container, Healthcheck: { Interval, Timeout: 0, Test } }, image, { containerId: ID, newImageId: NEW_IMAGE });
    expect(merged.Healthcheck).toBeUndefined();
    const other = mergeConfig({ ...container, Healthcheck: { Test, Interval: 5_000_000_000 } }, image, { containerId: ID, newImageId: NEW_IMAGE });
    expect(other.Healthcheck).toEqual({ Test, Interval: 5_000_000_000 });
  });

  it("setzt das Compose-Label nur, wenn es schon da war", () => {
    const { "com.docker.compose.image": _, ...labels } = container.Labels;
    const merged = mergeConfig({ ...container, Labels: labels }, image, { containerId: ID, newImageId: NEW_IMAGE });
    expect(merged.Labels).not.toHaveProperty("com.docker.compose.image");
  });
});

const info = (hostConfig: ContainerInfo["HostConfig"], networks: ContainerInfo["NetworkSettings"]["Networks"]): ContainerInfo => ({
  Id: ID,
  Name: "/lykora-server-1",
  Image: "sha256:alt",
  RestartCount: 0,
  Config: container,
  HostConfig: hostConfig,
  NetworkSettings: { Networks: networks },
  State: { Status: "running", Running: true },
});

describe("Nachfolger planen", () => {
  it("legt mit dem Hauptnetz an und verbindet weitere Netze danach, mit Aliasen ohne alte ID", () => {
    const hostConfig = { NetworkMode: "lykora_default", Binds: ["lykora_data:/data"], RestartPolicy: { Name: "unless-stopped" } };
    const plan = planReplacement(
      info(hostConfig, {
        lykora_extra: { Aliases: ["web"], IPAddress: "172.20.0.5", NetworkID: "n2", EndpointID: "e2" },
        lykora_default: {
          Aliases: ["lykora-server-1", "server", ID.slice(0, 12)],
          IPAMConfig: { IPv4Address: "172.19.0.10" },
          IPAddress: "172.19.0.10",
          MacAddress: "02:42:ac:13:00:0a",
        },
      }),
      image,
      NEW_IMAGE,
    );
    expect(plan.body.HostConfig).toBe(hostConfig);
    expect(plan.body.NetworkingConfig).toEqual({
      EndpointsConfig: { lykora_default: { Aliases: ["lykora-server-1", "server"], IPAMConfig: { IPv4Address: "172.19.0.10" } } },
    });
    expect(plan.networks).toEqual([{ name: "lykora_extra", endpoint: { Aliases: ["web"] } }]);
    expect(plan.body.Env).toEqual(["DATABASE_URL=postgres://db/lykora", "BASE_PATH=/lykora"]);
  });

  it("nimmt das Bridge-Netz für den Standardmodus und keins für host", () => {
    const bridge = planReplacement(info({ NetworkMode: "default" }, { bridge: {}, extra: { Aliases: ["x"] } }), image, NEW_IMAGE);
    expect(Object.keys(bridge.body.NetworkingConfig!.EndpointsConfig)).toEqual(["bridge"]);
    expect(bridge.networks.map((n) => n.name)).toEqual(["extra"]);
    const host = planReplacement(info({ NetworkMode: "host" }, { host: {} }), image, NEW_IMAGE);
    expect(host.body.NetworkingConfig).toBeUndefined();
    expect(host.networks).toEqual([]);
  });

  it("setzt zusätzliche Umgebungsvariablen und ersetzt alte Werte", () => {
    const plan = planReplacement(
      info({ NetworkMode: "bridge" }, { bridge: {} }),
      image,
      NEW_IMAGE,
      { LYKORA_UPDATER_REPLACES: "abc" },
    );
    const again = planReplacement({ ...info({ NetworkMode: "bridge" }, {}), Config: plan.body }, image, NEW_IMAGE, { LYKORA_UPDATER_REPLACES: "def" });
    expect(again.body.Env!.filter((e) => e.startsWith("LYKORA_UPDATER_REPLACES="))).toEqual(["LYKORA_UPDATER_REPLACES=def"]);
  });
});

describe("Image-Referenzen", () => {
  it("zerlegt Host, Repo, Tag und Digest", () => {
    expect(parseReference("ghcr.io/wolfsrudel-gaming/lykora:testbuild")).toEqual({
      repo: "ghcr.io/wolfsrudel-gaming/lykora",
      registry: "ghcr.io",
      explicitRegistry: true,
      tag: "testbuild",
      digest: null,
    });
    expect(parseReference("localhost:5000/lykora-upd")).toMatchObject({ repo: "localhost:5000/lykora-upd", registry: "localhost:5000", tag: "latest" });
    expect(parseReference("lykora-server:latest")).toMatchObject({ repo: "lykora-server", registry: "docker.io", explicitRegistry: false });
    expect(parseReference("wolfsrudel/lykora")).toMatchObject({ repo: "wolfsrudel/lykora", registry: "docker.io", tag: "latest" });
    expect(parseReference("ghcr.io/x/lykora@sha256:abc")).toMatchObject({ repo: "ghcr.io/x/lykora", digest: "sha256:abc" });
  });
});

describe("Docker-Engine", () => {
  it("handelt die API-Version aus", () => {
    expect(negotiateVersion({ ApiVersion: "1.56", MinAPIVersion: "1.40" })).toBe("1.47");
    expect(negotiateVersion({ ApiVersion: "1.41", MinAPIVersion: "1.12" })).toBe("1.41");
    expect(negotiateVersion({ ApiVersion: "1.60", MinAPIVersion: "1.50" })).toBe("1.50");
  });

  it("zerlegt gemultiplexte Logs und lässt TTY-Ausgabe stehen", () => {
    const frame = (stream: number, text: string) => {
      const head = Buffer.alloc(8);
      head[0] = stream;
      head.writeUInt32BE(Buffer.byteLength(text), 4);
      return Buffer.concat([head, Buffer.from(text)]);
    };
    expect(demuxLogs(Buffer.concat([frame(1, "Start\n"), frame(2, "Fehler: kaputt\n")]))).toBe("Start\nFehler: kaputt\n");
    expect(demuxLogs(Buffer.from("einfach Text\n"))).toBe("einfach Text\n");
  });
});
