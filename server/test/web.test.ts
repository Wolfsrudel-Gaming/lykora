import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { setup, tempDir, testConfig, type TestContext } from "./helpers.ts";

// Nachgebauter Web-Build mit dem Platzhalter für den Basispfad
const webRoot = tempDir("webroot");
const webDir = join(webRoot, "dist");
mkdirSync(join(webDir, "assets"), { recursive: true });
mkdirSync(join(webDir, "fonts"), { recursive: true });
const INDEX = `<!doctype html>
<html lang="de"><head><base href="/__LYKORA_BASE__/"><link rel="stylesheet" href="./assets/index-Bx7q2a9c.css">
<script type="module" src="./assets/index-D4f8kP1z.js"></script></head><body><div id="app"></div></body></html>`;
writeFileSync(join(webDir, "index.html"), INDEX);
writeFileSync(join(webDir, "assets", "index-D4f8kP1z.js"), "console.log('lykora')");
writeFileSync(join(webDir, "assets", "index-Bx7q2a9c.css"), "body{margin:0}");
writeFileSync(join(webDir, "fonts", "atkinson-next.woff2"), Buffer.from("wOF2"));
writeFileSync(join(webDir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
writeFileSync(join(webDir, ".env"), "GEHEIMER-INHALT");
writeFileSync(join(webRoot, "geheim.txt"), "GEHEIMER-INHALT");

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setup({ WEB_DIR: webDir });
});
afterAll(async () => {
  await ctx?.close();
});

const get = (url: string, app = ctx.app) => app.inject({ method: "GET", url });

describe("Web-Dashboard", () => {
  it("liefert index.html mit eingesetztem Basispfad für alle Seiten der App", async () => {
    for (const url of ["/lykora/", "/lykora/index.html", "/lykora/events/7d1c/teams", "/lykora/join/K7M2QX", "/lykora/einstellungen/", "/lykora/?code=K7M2QX"]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toBe("text/html; charset=utf-8");
      expect(res.headers["cache-control"], url).toBe("no-cache");
      expect(res.body, url).toContain('<base href="/lykora/">');
      expect(res.body, url).not.toContain("__LYKORA_BASE__");
    }
  });

  it("leitet auf den Basispfad mit Schrägstrich um", async () => {
    const bare = await get("/lykora?code=K7M2QX");
    expect(bare.statusCode).toBe(302);
    expect(bare.headers.location).toBe("/lykora/?code=K7M2QX");
    const root = await get("/");
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe("/lykora/");
  });

  it("liefert Assets mit passenden Typen und Cache-Headern", async () => {
    const js = await get("/lykora/assets/index-D4f8kP1z.js");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(js.body).toBe("console.log('lykora')");
    const css = await get("/lykora/assets/index-Bx7q2a9c.css");
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    const font = await get("/lykora/fonts/atkinson-next.woff2");
    expect(font.headers["content-type"]).toBe("font/woff2");
    expect(font.headers["cache-control"]).toBe("public, max-age=86400");
    const icon = await get("/lykora/favicon.svg");
    expect(icon.headers["content-type"]).toBe("image/svg+xml");
    expect((await ctx.app.inject({ method: "GET", url: "/lykora/favicon.svg", headers: { "if-none-match": icon.headers.etag as string } })).statusCode).toBe(304);
  });

  it("antwortet bei fehlenden Dateien und Pfad-Tricks mit 404 statt index.html", async () => {
    for (const url of [
      "/lykora/assets/index-fehlt.js",
      "/lykora/bild.png",
      "/lykora/.env",
      "/lykora/..%2Fgeheim.txt",
      "/lykora/%2e%2e%2fgeheim.txt",
      "/lykora/assets/..%2F..%2Fgeheim.txt",
      "/lykora/assets%5C..%5C..%5Cgeheim.txt",
    ]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain("GEHEIMER-INHALT");
    }
  });

  it("lässt API, API-Doku und Medien unberührt", async () => {
    expect((await get("/lykora/api/health")).json()).toMatchObject({ status: "ok" });
    for (const url of ["/lykora/api/gibtsnicht", "/lykora/api", "/lykora/api/games/x/y/z", "/lykora/media/gibtsnicht.ogg", "/lykora/media/a/b/c"]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).toContain("application/json");
      expect(res.json().error, url).toBe("not_found");
    }
    const post = await ctx.app.inject({ method: "POST", url: "/lykora/api/gibtsnicht", payload: {} });
    expect(post.statusCode).toBe(404);
    expect(post.json()).toEqual({ error: "not_found", message: "Route POST /lykora/api/gibtsnicht nicht gefunden" });

    const docs = await get("/lykora/api/docs/json");
    expect(docs.statusCode).toBe(200);
    const paths = Object.keys(docs.json().paths);
    expect(paths).toEqual(expect.arrayContaining(["/lykora/api/games/{gameId}/media", "/lykora/api/library/sounds", "/lykora/api/events/{eventId}/cues", "/lykora/media/{file}"]));
    expect(paths.some((p) => p.includes("*"))).toBe(false);
    const ui = await get("/lykora/api/docs");
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(ui.body).toContain("swagger-ui");
    expect(ui.body).not.toContain('<base href="/lykora/">');
    const css = await get("/lykora/api/docs/static/swagger-ui.css");
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
  });

  it("zeigt ohne Build eine Hinweisseite", async () => {
    const app = await buildApp(testConfig(), ctx.db, { logger: false });
    const res = await get("/lykora/events/123", app);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain("nicht gebaut");
    expect(res.body).toContain('<base href="/lykora/">');
    expect((await get("/lykora/assets/index-D4f8kP1z.js", app)).statusCode).toBe(404);
    await app.close();
  });

  it("funktioniert auch ohne Basispfad", async () => {
    const app = await buildApp(testConfig({ BASE_PATH: "", PUBLIC_URL: "https://lykora.example.org", WEB_DIR: webDir }), ctx.db, { logger: false });
    const index = await get("/", app);
    expect(index.body).toContain('<base href="/">');
    expect((await get("/events/1", app)).body).toContain('<base href="/">');
    expect((await get("/assets/index-D4f8kP1z.js", app)).statusCode).toBe(200);
    expect((await get("/api/health", app)).statusCode).toBe(200);
    const missing = await get("/api/gibtsnicht", app);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("not_found");
    expect((await get("/media/gibtsnicht.ogg", app)).json().error).toBe("not_found");
    await app.close();
  });
});
