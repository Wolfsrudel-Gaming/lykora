import type { ContainerConfig, ContainerInfo, EndpointSettings, ImageInfo } from "./docker.ts";

/**
 * Konfiguration für den Nachfolger eines Containers, nach den Regeln von Watchtower: Alles, was der
 * Container vom alten Image geerbt hat, fällt weg, damit die Werte des neuen Images gelten. Was beim
 * Anlegen gesetzt wurde (Compose, docker run), bleibt.
 */

const sameList = (a: string[] | null | undefined, b: string[] | null | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((v, i) => v === b?.[i]);

/** Schlüssel sortiert, leere Werte weg: Die Engine liefert dieselbe Angabe mal so, mal so geordnet. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined && v !== 0 && v !== "")
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => [k, canonical(v)]),
  );
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

/** Schlüssel, die auch im Image stehen, fallen weg. */
function withoutKeys<T>(own: Record<string, T> | null | undefined, image: Record<string, T> | null | undefined) {
  if (!own) return own;
  return Object.fromEntries(Object.entries(own).filter(([key]) => !(image && key in image)));
}

/** Node-Namen der Architekturen in die der Images. */
const ARCHITECTURES: Record<string, string> = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" };

/**
 * Was Compose (ab v5) in com.docker.compose.image schreibt: mit containerd-Image-Store der Digest des
 * Image-Manifests für die eigene Plattform, ein einzelnes Manifest unabhängig von der Plattform, sonst die
 * Image-ID (klassischer Image-Store). Stimmt der Wert, lässt „docker compose up -d“ den Container stehen.
 * Varianten (arm/v7) bleiben unbeachtet; die CI baut amd64 und arm64.
 */
export function composeImageDigest(image: ImageInfo, arch = process.arch): string {
  const available = (image.Manifests ?? []).filter((m) => m.Kind === "image" && m.Available);
  const wanted = ARCHITECTURES[arch] ?? arch;
  const match = available.find((m) => m.ImageData?.Platform?.os === "linux" && m.ImageData.Platform.architecture === wanted);
  if (match) return match.ID;
  return available.length === 1 ? available[0]!.ID : image.Id;
}

export function mergeConfig(
  container: ContainerConfig,
  image: ContainerConfig,
  opts: { containerId: string; newImageId: string; composeImage?: string },
): ContainerConfig {
  const merged: ContainerConfig = { ...container };
  const imageEnv = new Set(image.Env ?? []);
  merged.Env = (container.Env ?? []).filter((entry) => !imageEnv.has(entry));

  const labels = Object.fromEntries(Object.entries(container.Labels ?? {}).filter(([key, value]) => image.Labels?.[key] !== value));
  // Compose merkt sich hier seine Kennung des Images (composeImageDigest); stimmt sie, baut „docker compose up“ den Container nicht neu.
  if (container.Labels && "com.docker.compose.image" in container.Labels) labels["com.docker.compose.image"] = opts.composeImage ?? opts.newImageId;
  merged.Labels = labels;

  if (sameList(container.Entrypoint, image.Entrypoint)) {
    merged.Entrypoint = null;
    // Ein eigenes Cmd zu einem eigenen Entrypoint bleibt stehen, auch wenn es dem des Images gleicht.
    if (sameList(container.Cmd, image.Cmd)) merged.Cmd = null;
  }
  if (container.WorkingDir === image.WorkingDir) merged.WorkingDir = "";
  if (container.User === image.User) merged.User = "";
  if (sameJson(container.Healthcheck, image.Healthcheck)) delete merged.Healthcheck;
  if (container.StopSignal === image.StopSignal) delete merged.StopSignal;
  merged.ExposedPorts = withoutKeys(container.ExposedPorts, image.ExposedPorts);
  merged.Volumes = withoutKeys(container.Volumes, image.Volumes);
  // Ohne eigenen Namen heißt ein Container wie seine ID; der Nachfolger bekommt seine eigene.
  if (container.Hostname && opts.containerId.startsWith(container.Hostname)) delete merged.Hostname;
  return merged;
}

/** Netzwerk-Modi ohne eigene Endpunkte, etwa „host“ oder „container:<id>“. */
const sharedNetworkMode = (mode: string | undefined) => mode === "host" || mode === "none" || !!mode?.startsWith("container:");

/** Übernimmt, was man einem Endpunkt selbst gibt; Adressen und IDs vergibt Docker neu. */
function endpointFor(settings: EndpointSettings, containerId: string): EndpointSettings {
  const endpoint: EndpointSettings = {};
  // Ältere Engines führen die kurze ID als Alias; die passt nicht zum Nachfolger.
  const aliases = (settings.Aliases ?? []).filter((a) => !containerId.startsWith(a));
  if (aliases.length) endpoint.Aliases = aliases;
  if (settings.IPAMConfig && Object.values(settings.IPAMConfig).some(Boolean)) endpoint.IPAMConfig = settings.IPAMConfig;
  if (settings.Links?.length) endpoint.Links = settings.Links;
  if (settings.DriverOpts && Object.keys(settings.DriverOpts).length) endpoint.DriverOpts = settings.DriverOpts;
  return endpoint;
}

export interface CreatePlan {
  /** Body für POST /containers/create; enthält höchstens das erste Netzwerk. */
  body: ContainerConfig & { HostConfig: object; NetworkingConfig?: { EndpointsConfig: Record<string, EndpointSettings> } };
  /** Weitere Netzwerke, die nach dem Anlegen verbunden werden; ältere Engines nehmen beim Anlegen nur eins. */
  networks: { name: string; endpoint: EndpointSettings }[];
}

/** Baut den Nachfolger: zusammengeführte Konfiguration, HostConfig unverändert, Netzwerke mit Aliasen. */
export function planReplacement(
  container: ContainerInfo,
  imageConfig: ContainerConfig,
  newImageId: string,
  env: Record<string, string> = {},
  composeImage = newImageId,
): CreatePlan {
  const config = mergeConfig(container.Config, imageConfig, { containerId: container.Id, newImageId, composeImage });
  for (const [key, value] of Object.entries(env)) {
    config.Env = [...(config.Env ?? []).filter((e) => !e.startsWith(`${key}=`)), `${key}=${value}`];
  }
  const body: CreatePlan["body"] = { ...config, HostConfig: container.HostConfig };
  const mode = container.HostConfig.NetworkMode;
  if (sharedNetworkMode(mode)) return { body, networks: [] };

  const networks = Object.entries(container.NetworkSettings.Networks ?? {}).map(([name, settings]) => ({
    name,
    endpoint: endpointFor(settings, container.Id),
  }));
  const primaryName = !mode || mode === "default" ? "bridge" : mode;
  const primary = networks.find((n) => n.name === primaryName) ?? networks[0];
  if (primary) body.NetworkingConfig = { EndpointsConfig: { [primary.name]: primary.endpoint } };
  return { body, networks: networks.filter((n) => n !== primary) };
}

export interface ImageReference {
  /** Ohne Tag und Digest, z. B. „ghcr.io/wolfsrudel-gaming/lykora“. */
  repo: string;
  /** Host der Registry; „docker.io“, wenn keiner angegeben ist. */
  registry: string;
  /** Ob der Name einen Host nennt. Ohne Host und ohne Namensraum ist es ein offizielles Docker-Hub-Image. */
  explicitRegistry: boolean;
  tag: string;
  digest: string | null;
}

export function parseReference(ref: string): ImageReference {
  let rest = ref.trim();
  let digest: string | null = null;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let tag = "latest";
  const colon = rest.lastIndexOf(":");
  if (colon > rest.lastIndexOf("/")) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  const first = rest.split("/")[0]!;
  const explicitRegistry = rest.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost");
  return { repo: rest, registry: explicitRegistry ? first : "docker.io", explicitRegistry, tag, digest };
}
