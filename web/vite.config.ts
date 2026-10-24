import type { Plugin, PreviewServer } from "vite";
import { defineConfig } from "vitest/config";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Basispfad in Entwicklung und Vorschau. Im Betrieb setzt der Server seinen BASE_PATH
 * in den Platzhalter von index.html ein; hier übernimmt das dieses Plugin.
 */
const DEV_BASE = "/lykora/";
const PLACEHOLDER = "/__LYKORA_BASE__/";
/** Server für API und Medien; Standard ist der lokale Entwicklungsserver. */
const SERVER = process.env.LYKORA_SERVER ?? "http://localhost:3000";

function lykoraBase(): Plugin {
  return {
    name: "lykora-base",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        // Im Build bleibt der Platzhalter stehen, den der Server ersetzt.
        return ctx.server ? html.replace(PLACEHOLDER, DEV_BASE) : html;
      },
    },
    configurePreviewServer(server: PreviewServer) {
      const dist = resolve(server.config.root, server.config.build.outDir);
      // Die Vorschau liefert den Build unter /lykora/ aus wie der Server: Dateien direkt, alles andere als index.html.
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://vorschau");
        if (!url.pathname.startsWith(DEV_BASE) || /^\/lykora\/(api|media)(\/|$)/.test(url.pathname)) return next();
        const rel = decodeURIComponent(url.pathname.slice(DEV_BASE.length));
        const file = join(dist, rel);
        if (rel && !rel.includes("..") && existsSync(file) && statSync(file).isFile() && rel !== "index.html") {
          req.url = `/${rel}${url.search}`;
          return next();
        }
        const html = readFileSync(join(dist, "index.html"), "utf8").replace(PLACEHOLDER, DEV_BASE);
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("cache-control", "no-cache");
        res.end(html);
      });
    },
  };
}

const proxy = {
  "/lykora/api": { target: SERVER, changeOrigin: true, ws: true },
  "/lykora/media": { target: SERVER, changeOrigin: true },
};

export default defineConfig(({ command, isPreview }) => ({
  // Relativ, damit der Build unter jedem Basispfad läuft; im Dev-Server unter /lykora/.
  base: command === "serve" && !isPreview ? DEV_BASE : "./",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  plugins: [lykoraBase()],
  // Der Validator-Kern aus dem verknüpften Workspace @lykora/spec lädt Ajv als CommonJS;
  // der Dev-Server bündelt es vor, der Build braucht nichts.
  optimizeDeps: { include: ["ajv/dist/2020.js"] },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 250,
  },
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
}));
