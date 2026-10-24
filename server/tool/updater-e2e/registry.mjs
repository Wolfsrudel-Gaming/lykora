#!/usr/bin/env node
// Kleine statische OCI-Registry für Tests des Updaters und der Update-Prüfung.
//
// Liefert Images aus `docker save`-Archiven (OCI-Layout: index.json und blobs/) über HTTP auf
// localhost aus, nur lesend: GET/HEAD /v2/, Manifeste nach Tag oder Digest (mit Content-Type und
// Docker-Content-Digest), Blobs, Tag-Liste. Welches Archiv ein Tag zeigt, lässt sich umstellen:
//   PUT /-/tags/<name>:<tag>   Body: Pfad zu einem .tar oder entpackten Ordner
//   GET /-/tags                alle Tags mit Digest
// Docker behandelt 127.0.0.0/8 ohne weitere Einstellung als unsichere Registry, also klappt
// `docker pull localhost:5000/<name>:<tag>` direkt.
//
// Aufruf: node registry.mjs [--port 5000] [--host 127.0.0.1] [<name>:<tag>=<archiv.tar> ...]
//   --host 0.0.0.0 lauscht auf allen Adressen, damit auch Container (über das Docker-Gateway) herankommen.
// Als Modul: const registry = await startRegistry({ port: 5000 }); registry.setTag("x:v1", "x.tar")

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_TYPES = new Set(["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"]);
const MANIFEST_TYPES = new Set(["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"]);

/** Liest ein OCI-Layout ein und merkt sich zu jedem Blob den Medientyp aus den Deskriptoren. */
function loadLayout(source) {
  let dir = resolve(source);
  let cleanup = () => {};
  if (statSync(dir).isFile()) {
    const target = mkdtempSync(join(tmpdir(), "lykora-registry-"));
    const res = spawnSync("tar", ["-xf", dir, "-C", target], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`Archiv ${source} ließ sich nicht entpacken`);
    dir = target;
    cleanup = () => rmSync(target, { recursive: true, force: true });
  }
  const blobPath = (digest) => join(dir, "blobs", ...digest.split(":"));
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const types = new Map();
  const walk = (descriptor) => {
    if (types.has(descriptor.digest)) return;
    types.set(descriptor.digest, descriptor.mediaType);
    // Fehlende Blobs (fremde Plattformen) gibt es im Archiv nicht; Docker fragt nur seine eigene an.
    if (!existsSync(blobPath(descriptor.digest))) return;
    if (INDEX_TYPES.has(descriptor.mediaType)) {
      for (const child of JSON.parse(readFileSync(blobPath(descriptor.digest), "utf8")).manifests ?? []) walk(child);
    } else if (MANIFEST_TYPES.has(descriptor.mediaType)) {
      const manifest = JSON.parse(readFileSync(blobPath(descriptor.digest), "utf8"));
      walk(manifest.config);
      for (const layer of manifest.layers ?? []) walk(layer);
    }
  };
  for (const descriptor of index.manifests ?? []) walk(descriptor);
  return { source, dir, index, types, blobPath, cleanup };
}

export async function startRegistry({ port = 5000, host = "127.0.0.1", log = () => {} } = {}) {
  const layouts = new Map();
  /** "<name>:<tag>" → { layout, descriptor } */
  const tags = new Map();

  function layoutFor(source) {
    const key = resolve(source);
    if (!layouts.has(key)) layouts.set(key, loadLayout(key));
    return layouts.get(key);
  }

  function setTag(ref, source) {
    const colon = ref.lastIndexOf(":");
    if (colon <= 0) throw new Error(`Tag fehlt in ${ref}`);
    const layout = layoutFor(source);
    // Bei mehreren Images im Archiv das mit passendem Namen, sonst das erste
    const manifests = layout.index.manifests ?? [];
    const descriptor =
      manifests.find((m) => (m.annotations?.["io.containerd.image.name"] ?? "").endsWith(`/${ref}`)) ?? manifests[0];
    if (!descriptor) throw new Error(`${source} enthält kein Image`);
    tags.set(ref, { layout, descriptor });
    log(`${ref} → ${descriptor.digest} (${source})`);
    return descriptor.digest;
  }

  const digestOf = (ref) => tags.get(ref)?.descriptor.digest ?? null;

  function findBlob(digest) {
    for (const layout of layouts.values()) {
      const path = layout.blobPath(digest);
      if (existsSync(path)) return { path, mediaType: layout.types.get(digest) };
    }
    return null;
  }

  function sendBlob(req, res, path, headers) {
    const size = statSync(path).size;
    res.writeHead(200, { ...headers, "content-length": size, "docker-distribution-api-version": "registry/2.0" });
    if (req.method === "HEAD") return res.end();
    createReadStream(path).pipe(res);
  }

  const error = (res, status, code, message) => {
    res.writeHead(status, { "content-type": "application/json", "docker-distribution-api-version": "registry/2.0" });
    res.end(JSON.stringify({ errors: [{ code, message }] }));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://registry");
    const path = decodeURIComponent(url.pathname);
    log(`${req.method} ${path}`);
    try {
      if (req.method === "PUT" && path.startsWith("/-/tags/")) {
        let body = "";
        for await (const chunk of req) body += chunk;
        const digest = setTag(path.slice("/-/tags/".length), body.trim());
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ digest }));
        return;
      }
      if (req.method === "GET" && path === "/-/tags") {
        const list = Object.fromEntries([...tags].map(([ref, t]) => [ref, t.descriptor.digest]));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return error(res, 405, "UNSUPPORTED", "Nur lesend");
      if (path === "/v2/" || path === "/v2") {
        res.writeHead(200, { "content-type": "application/json", "docker-distribution-api-version": "registry/2.0" });
        return res.end(req.method === "HEAD" ? undefined : "{}");
      }
      let m = /^\/v2\/(.+)\/tags\/list$/.exec(path);
      if (m) {
        const list = [...tags.keys()].filter((ref) => ref.startsWith(`${m[1]}:`)).map((ref) => ref.slice(m[1].length + 1));
        if (!list.length) return error(res, 404, "NAME_UNKNOWN", `${m[1]} unbekannt`);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ name: m[1], tags: list }));
      }
      m = /^\/v2\/(.+)\/manifests\/([^/]+)$/.exec(path);
      if (m) {
        const [, name, reference] = m;
        let digest = reference;
        let mediaType;
        if (!reference.startsWith("sha256:")) {
          const tagged = tags.get(`${name}:${reference}`);
          if (!tagged) return error(res, 404, "MANIFEST_UNKNOWN", `${name}:${reference} unbekannt`);
          digest = tagged.descriptor.digest;
          mediaType = tagged.descriptor.mediaType;
        }
        const blob = findBlob(digest);
        if (!blob) return error(res, 404, "MANIFEST_UNKNOWN", `${digest} unbekannt`);
        mediaType ??= blob.mediaType ?? JSON.parse(readFileSync(blob.path, "utf8")).mediaType;
        return sendBlob(req, res, blob.path, { "content-type": mediaType, "docker-content-digest": digest });
      }
      m = /^\/v2\/(.+)\/blobs\/([^/]+)$/.exec(path);
      if (m) {
        const blob = findBlob(m[2]);
        if (!blob) return error(res, 404, "BLOB_UNKNOWN", `${m[2]} unbekannt`);
        return sendBlob(req, res, blob.path, { "content-type": "application/octet-stream", "docker-content-digest": m[2] });
      }
      error(res, 404, "NOT_FOUND", path);
    } catch (err) {
      error(res, 500, "UNKNOWN", err.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    setTag,
    digestOf,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      for (const layout of layouts.values()) layout.cleanup();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv.splice(at, 2)[1] : fallback;
  };
  const port = Number(option("--port", "5000"));
  const host = option("--host", "127.0.0.1");
  const registry = await startRegistry({ port, host, log: (line) => console.log(line) });
  for (const arg of argv) {
    const [ref, source] = arg.split("=");
    registry.setTag(ref, source);
  }
  console.log(`Registry läuft auf ${registry.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => registry.close().then(() => process.exit(0)));
}
