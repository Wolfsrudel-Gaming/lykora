import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const REPOSITORY = "wolfsrudel-gaming/lykora";
const TOKEN = "fake-registry-token";
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";

export interface FakeLabels {
  version?: string;
  revision?: string;
  created?: string;
  source?: string;
}

const digestOf = (data: Buffer) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const json = (value: unknown) => Buffer.from(JSON.stringify(value));

/**
 * Kleine Registry nach API v2 wie ghcr.io: Tag zeigt auf einen Index mit amd64, arm64 und einer
 * Attestierung; ohne Bearer-Token gibt es 401 mit Verweis auf den Token-Dienst, Blobs liegen hinter
 * einer Weiterleitung.
 */
export async function startFakeRegistry() {
  const manifests = new Map<string, { body: Buffer; type: string }>();
  const blobs = new Map<string, Buffer>();
  const digests = { index: "", amd64: "", arm64: "", attestation: "", amd64Config: "", arm64Config: "" };
  const options = {
    /** Token nur gegen diesen Basic-Zugang. */
    requireBasic: null as { user: string; password: string } | null,
    digestHeader: true,
    /** Antwortet auf alles unter /v2/ mit diesem Status. */
    failWith: 0,
  };
  const requests: { path: string; authorization: string | undefined; status: number }[] = [];
  const tokenRequests: { query: URLSearchParams; authorization: string | undefined }[] = [];

  function publish(labels: FakeLabels, tag = "testbuild") {
    const imageManifest = (arch: string) => {
      const config = json({
        architecture: arch,
        os: "linux",
        config: {
          Labels: {
            "org.opencontainers.image.version": labels.version,
            "org.opencontainers.image.revision": labels.revision,
            "org.opencontainers.image.created": labels.created,
            "org.opencontainers.image.source": labels.source,
          },
        },
      });
      const configDigest = digestOf(config);
      blobs.set(configDigest, config);
      const body = json({ schemaVersion: 2, mediaType: OCI_MANIFEST, config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: config.length }, layers: [] });
      const digest = digestOf(body);
      manifests.set(digest, { body, type: OCI_MANIFEST });
      return { digest, size: body.length, configDigest };
    };
    const amd64 = imageManifest("amd64");
    const arm64 = imageManifest("arm64");
    // Attestierung wie von buildx: Plattform unknown/unknown, eigene Config ohne Labels.
    const attestationConfig = json({ architecture: "unknown", os: "unknown", config: {} });
    blobs.set(digestOf(attestationConfig), attestationConfig);
    const attestationBody = json({ schemaVersion: 2, mediaType: OCI_MANIFEST, config: { digest: digestOf(attestationConfig), size: attestationConfig.length }, layers: [] });
    const attestation = digestOf(attestationBody);
    manifests.set(attestation, { body: attestationBody, type: OCI_MANIFEST });
    const index = json({
      schemaVersion: 2,
      mediaType: OCI_INDEX,
      manifests: [
        { mediaType: OCI_MANIFEST, digest: attestation, size: attestationBody.length, platform: { architecture: "unknown", os: "unknown" }, annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": amd64.digest } },
        { mediaType: OCI_MANIFEST, digest: amd64.digest, size: amd64.size, platform: { architecture: "amd64", os: "linux" } },
        { mediaType: OCI_MANIFEST, digest: arm64.digest, size: arm64.size, platform: { architecture: "arm64", os: "linux", variant: "v8" } },
      ],
    });
    manifests.set(tag, { body: index, type: OCI_INDEX });
    Object.assign(digests, { index: digestOf(index), amd64: amd64.digest, arm64: arm64.digest, attestation, amd64Config: amd64.configDigest, arm64Config: arm64.configDigest });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://registry");
    const authorization = req.headers.authorization;
    const send = (status: number, body: Buffer | string = "", headers: Record<string, string> = {}) => {
      if (url.pathname.startsWith("/v2/")) requests.push({ path: url.pathname, authorization, status });
      res.writeHead(status, headers).end(body);
    };

    if (url.pathname === "/token") {
      tokenRequests.push({ query: url.searchParams, authorization });
      const basic = options.requireBasic;
      if (basic && authorization !== `Basic ${Buffer.from(`${basic.user}:${basic.password}`).toString("base64")}`) return send(401, "{}");
      return send(200, JSON.stringify({ token: TOKEN }), { "content-type": "application/json" });
    }
    if (url.pathname.startsWith("/storage/")) {
      const blob = blobs.get(url.pathname.slice("/storage/".length));
      return blob ? send(200, blob, { "content-type": "application/octet-stream" }) : send(404);
    }
    const m = url.pathname.match(/^\/v2\/(.+)\/(manifests|blobs)\/([^/]+)$/);
    if (!m) return send(404);
    if (options.failWith) return send(options.failWith, "{}");
    if (authorization !== `Bearer ${TOKEN}`) {
      const realm = `http://${host}/token`;
      return send(401, '{"errors":[{"code":"UNAUTHORIZED"}]}', {
        "www-authenticate": `Bearer realm="${realm}",service="fake-registry",scope="repository:${m[1]}:pull"`,
      });
    }
    if (m[1] !== REPOSITORY) return send(404, '{"errors":[{"code":"NAME_UNKNOWN"}]}');
    if (m[2] === "blobs") {
      // Wie ghcr.io: Blobs kommen über eine Weiterleitung auf den Speicher.
      return blobs.has(m[3]!) ? send(307, "", { location: `/storage/${m[3]}` }) : send(404);
    }
    const manifest = manifests.get(m[3]!);
    if (!manifest) return send(404, '{"errors":[{"code":"MANIFEST_UNKNOWN"}]}');
    return send(200, manifest.body, {
      "content-type": manifest.type,
      ...(options.digestHeader ? { "docker-content-digest": digestOf(manifest.body) } : {}),
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    host,
    image: (tag = "testbuild") => `${host}/${REPOSITORY}:${tag}`,
    publish,
    digests,
    options,
    requests,
    tokenRequests,
    /** Rohdaten des Index unter einem Tag, z. B. zum Nachrechnen des Digests. */
    raw: (tag = "testbuild") => manifests.get(tag)!.body,
    reset() {
      Object.assign(options, { requireBasic: null, digestHeader: true, failWith: 0 });
      requests.length = 0;
      tokenRequests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export type FakeRegistry = Awaited<ReturnType<typeof startFakeRegistry>>;
