import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { MAX_MEDIA_SIZE } from "../src/services/media.ts";
import { client, createEvent, exampleGame, joinTeam, member, setup, tempDir, testConfig, type TestContext } from "./helpers.ts";

// Kleine Klangbibliothek mit Ersatzdateien; der Server prüft den Inhalt nicht.
const libDir = tempDir("lib");
const WIND = Buffer.concat([Buffer.from("OggS"), randomBytes(2000)]);
writeFileSync(join(libDir, "wind.ogg"), WIND);
writeFileSync(join(libDir, "eule.ogg"), Buffer.from("OggS-eule"));
const credit = "Lykora-Klangbibliothek, erzeugt mit server/tool/sound_library.py";
writeFileSync(
  join(libDir, "library.json"),
  JSON.stringify([
    { id: "wind", title: "Wind", category: "ambience", loop: true, duration: 42.5, file: "wind.ogg", license: "CC0-1.0", credit },
    { id: "eule", title: "Eule", category: "sfx", loop: false, duration: 1.6, file: "eule.ogg", license: "CC0-1.0", credit },
    // Datei fehlt: taucht nicht auf
    { id: "donner", title: "Donner", category: "sfx", loop: false, duration: 4, file: "donner.ogg", license: "CC0-1.0", credit },
    // Ungültige ID: taucht nicht auf
    { id: "../geheim", title: "Geheim", category: "sfx", loop: false, duration: 1, file: "geheim.ogg", license: "CC0-1.0", credit },
  ]),
);

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setup({ MEDIA_LIBRARY_DIR: libDir });
});
afterAll(async () => {
  await ctx?.close();
});

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const mediaDir = () => join(ctx.app.deps.config.dataDir, "media");

async function createGame(game = exampleGame()): Promise<string> {
  const res = await client(ctx).post(`/orgs/${ctx.orgId}/games`, { content: game });
  expect(res.status).toBe(201);
  return res.body.id;
}

function upload(gameId: string, data: Buffer, contentType: string, opts: { filename?: string; token?: string } = {}) {
  const query = opts.filename !== undefined ? `?filename=${encodeURIComponent(opts.filename)}` : "";
  return ctx.app.inject({
    method: "POST",
    url: `${ctx.api}/games/${gameId}/media${query}`,
    headers: { authorization: `Bearer ${opts.token ?? ctx.token}`, "content-type": contentType },
    payload: data,
  });
}

const get = (url: string, headers: Record<string, string> = {}) => ctx.app.inject({ method: "GET", url, headers });

describe("Medien hochladen", () => {
  it("speichert inhaltsadressiert und listet neueste zuerst", async () => {
    const gameId = await createGame();
    const mp3 = Buffer.concat([Buffer.from("ID3"), randomBytes(500)]);
    const first = await upload(gameId, mp3, "audio/mpeg", { filename: "Eule ruft.mp3" });
    expect(first.statusCode).toBe(201);
    const hash = sha(mp3);
    expect(first.json()).toMatchObject({
      gameId,
      sha256: hash,
      filename: "Eule ruft.mp3",
      contentType: "audio/mpeg",
      type: "audio",
      size: mp3.length,
      src: `media/${hash}.mp3`,
      url: `https://example.org/lykora/media/${hash}.mp3`,
    });
    expect(first.json().createdAt).toBeTruthy();
    expect(readFileSync(join(mediaDir(), `${hash}.mp3`)).equals(mp3)).toBe(true);

    // Pfadanteile im Dateinamen fallen weg, Parameter am Content-Type stören nicht.
    const png = await upload(gameId, randomBytes(300), "image/png", { filename: "../../karten/karte.png" });
    expect(png.json()).toMatchObject({ filename: "karte.png", type: "image", contentType: "image/png" });
    expect(png.json().src).toMatch(/^media\/[0-9a-f]{64}\.png$/);
    const wav = await upload(gameId, randomBytes(300), "audio/x-wav; codecs=1");
    expect(wav.json()).toMatchObject({ type: "audio", contentType: "audio/x-wav" });
    expect(wav.json().src).toMatch(/\.wav$/);
    expect(wav.json().filename).toMatch(/^[0-9a-f]{12}\.wav$/);
    const mp4 = await upload(gameId, randomBytes(300), "video/mp4", { filename: "intro.mp4" });
    expect(mp4.json()).toMatchObject({ type: "video", src: expect.stringMatching(/\.mp4$/) });
    const m4a = await upload(gameId, randomBytes(300), "audio/x-m4a", { filename: "stimme.m4a" });
    expect(m4a.json()).toMatchObject({ type: "audio", src: expect.stringMatching(/\.m4a$/) });

    // Dieselbe Datei noch einmal: bestehender Eintrag, keine Kopie
    const again = await upload(gameId, mp3, "audio/mpeg", { filename: "anderer-name.mp3" });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);

    const list = await client(ctx).get(`/games/${gameId}/media`);
    expect(list.status).toBe(200);
    expect(list.body.map((m: any) => m.filename)).toEqual(["stimme.m4a", "intro.mp4", wav.json().filename, "karte.png", "Eule ruft.mp3"]);
    // Keine temporären Dateien übrig
    expect(readdirSync(mediaDir()).filter((f) => f.startsWith("."))).toEqual([]);
    expect(readdirSync(mediaDir())).toHaveLength(5);
  });

  it("prüft die Rechte", async () => {
    const gameId = await createGame();
    const author = await member(ctx, "author", "autor-medien@example.org");
    const supervisor = await member(ctx, "supervisor", "betreuer-medien@example.org");
    const viewer = await member(ctx, "viewer", "zuschauer-medien@example.org");
    const data = randomBytes(100);

    expect((await upload(gameId, data, "audio/ogg", { token: "" })).statusCode).toBe(401);
    expect((await upload(gameId, data, "audio/ogg", { token: supervisor })).statusCode).toBe(403);
    expect((await upload(gameId, data, "audio/ogg", { token: viewer })).statusCode).toBe(403);
    const created = await upload(gameId, data, "audio/ogg", { token: author });
    expect(created.statusCode).toBe(201);

    expect((await client(ctx, supervisor).get(`/games/${gameId}/media`)).status).toBe(200);
    expect((await client(ctx, viewer).get(`/games/${gameId}/media`)).status).toBe(403);
    expect((await client(ctx, "").get(`/games/${gameId}/media`)).status).toBe(401);
    expect((await client(ctx, supervisor).del(`/games/${gameId}/media/${created.json().id}`)).status).toBe(403);

    // Spiel einer fremden Organisation: gibt es für das Mitglied gar nicht.
    const org = await client(ctx).post("/orgs", { name: "Andere", slug: "andere-medien" });
    const foreign = await client(ctx).post(`/orgs/${org.body.id}/games`, { content: exampleGame() });
    const res = await upload(foreign.body.id, data, "audio/ogg", { token: author });
    expect(res.statusCode).toBe(404);
    expect((await upload("00000000-0000-0000-0000-000000000000", data, "audio/ogg")).statusCode).toBe(404);
  });

  it("lehnt falsche Typen, leere und zu große Dateien ab", async () => {
    const gameId = await createGame();
    for (const type of ["application/pdf", "image/svg+xml", "text/html", "text/plain", "audio/x-unbekannt"]) {
      const res = await upload(gameId, Buffer.from("<svg onload=alert(1)>"), type);
      expect(res.statusCode, type).toBe(415);
      expect(res.json().error, type).toBe("unsupported_type");
    }
    const json = await ctx.app.inject({
      method: "POST",
      url: `${ctx.api}/games/${gameId}/media`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { data: "abc" },
    });
    expect(json.statusCode).toBe(415);

    const empty = await upload(gameId, Buffer.alloc(0), "audio/ogg");
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe("empty_file");

    const big = await upload(gameId, Buffer.alloc(MAX_MEDIA_SIZE + 1), "audio/wav");
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe("too_large");
    // Genau 30 MB gehen noch.
    const max = await upload(gameId, Buffer.alloc(MAX_MEDIA_SIZE, 1), "audio/wav");
    expect(max.statusCode).toBe(201);
    expect(max.json().size).toBe(MAX_MEDIA_SIZE);

    // Andere Endpunkte bleiben beim kleinen JSON-Limit.
    const huge = await client(ctx).post(`/orgs/${ctx.orgId}/games`, { content: { padding: "x".repeat(3 * 1024 * 1024) } });
    expect(huge.status).toBe(413);
  });

  it("prüft Rechte und Typ, bevor der Body gelesen wird", async () => {
    const gameId = await createGame();
    const viewer = await member(ctx, "viewer", "zuschauer-gross@example.org");
    // Ohne die frühe Prüfung käme hier erst 413, nachdem der Server 30 MB gelesen hat.
    const big = Buffer.alloc(MAX_MEDIA_SIZE + 1);
    expect((await upload(gameId, big, "audio/wav", { token: "" })).statusCode).toBe(401);
    expect((await upload(gameId, big, "audio/wav", { token: viewer })).statusCode).toBe(403);
    expect((await upload("00000000-0000-0000-0000-000000000000", big, "audio/wav")).statusCode).toBe(404);
    // Die Rechteprüfung läuft vor der Schema-Prüfung; eine schiefe ID darf trotzdem keinen 500 auslösen.
    for (const id of ["-".repeat(36), "nicht-einmal-eine-id"]) {
      expect((await upload(id, Buffer.from("x"), "audio/wav")).statusCode, id).toBe(404);
    }
    const json = await upload(gameId, big, "application/json");
    expect(json.statusCode).toBe(415);
    expect(json.json().error).toBe("unsupported_type");
    expect((await upload(gameId, big, "application/json", { token: "" })).statusCode).toBe(401);
  });

  it("nimmt Rohdaten nur am Upload an, nicht an anderen Endpunkten", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `${ctx.api}/orgs/${ctx.orgId}/games`,
      headers: { authorization: `Bearer ${ctx.token}`, "content-type": "audio/ogg" },
      payload: randomBytes(100),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe("unsupported_type");
  });

  it("verkraftet gleichzeitige Uploads derselben Datei", async () => {
    const [a, b] = [await createGame(), await createGame()];
    const data = randomBytes(5000);
    const results = await Promise.all([a, b, a, b, a, b].map((gameId) => upload(gameId, data, "audio/ogg")));
    for (const gameId of [a, b]) {
      const mine = results.filter((r) => r.json().gameId === gameId);
      expect(mine.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
      expect(new Set(mine.map((r) => r.json().id)).size).toBe(1);
      expect((await client(ctx).get(`/games/${gameId}/media`)).body).toHaveLength(1);
    }
    expect(readFileSync(join(mediaDir(), `${sha(data)}.ogg`)).equals(data)).toBe(true);
    expect(readdirSync(mediaDir()).filter((f) => f.startsWith("."))).toEqual([]);
  });

  it("verliert keine Datei, wenn Löschen und Hochladen gleichzeitig laufen", async () => {
    const [a, b] = [await createGame(), await createGame()];
    for (let i = 0; i < 5; i++) {
      const data = randomBytes(2000);
      const first = await upload(a, data, "audio/mpeg");
      const [del, up] = await Promise.all([client(ctx).del(`/games/${a}/media/${first.json().id}`), upload(b, data, "audio/mpeg")]);
      expect(del.status).toBe(204);
      expect(up.statusCode).toBe(201);
      expect(readFileSync(join(mediaDir(), `${sha(data)}.mp3`)).equals(data)).toBe(true);
    }
  });

  it("löscht die Datei erst, wenn kein Eintrag sie mehr nutzt", async () => {
    const a = await createGame();
    const b = await createGame();
    const data = randomBytes(400);
    const inA = await upload(a, data, "audio/ogg", { filename: "a.ogg" });
    const inB = await upload(b, data, "audio/ogg", { filename: "b.ogg" });
    expect(inA.json().sha256).toBe(inB.json().sha256);
    const file = join(mediaDir(), `${sha(data)}.ogg`);

    // Falsches Spiel zum Eintrag
    expect((await client(ctx).del(`/games/${b}/media/${inA.json().id}`)).status).toBe(404);

    expect((await client(ctx).del(`/games/${a}/media/${inA.json().id}`)).status).toBe(204);
    expect(existsSync(file)).toBe(true);
    expect((await client(ctx).get(`/games/${a}/media`)).body).toEqual([]);
    expect((await get(`/lykora/${inB.json().src}`)).statusCode).toBe(200);

    expect((await client(ctx).del(`/games/${b}/media/${inB.json().id}`)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect((await get(`/lykora/${inB.json().src}`)).statusCode).toBe(404);
    expect((await client(ctx).del(`/games/${b}/media/${inB.json().id}`)).status).toBe(404);
  });

  it("behält Dateien, die ein noch nicht beendetes Event braucht", async () => {
    const gameId = await createGame();
    const data = randomBytes(256);
    const up = await upload(gameId, data, "audio/mpeg", { filename: "ruf.mp3" });
    const game = exampleGame();
    game.media = [...(game.media ?? []), { id: "ruf", type: "audio", src: up.json().src }];
    expect((await client(ctx).put(`/games/${gameId}`, { content: game })).status).toBe(200);
    const event = await client(ctx).post(`/orgs/${ctx.orgId}/events`, { gameId, name: "Mit Ruf" });

    const blocked = await client(ctx).del(`/games/${gameId}/media/${up.json().id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "media_in_use" });
    expect(blocked.body.message).toContain("Mit Ruf");

    await client(ctx).post(`/events/${event.body.id}/end`);
    expect((await client(ctx).del(`/games/${gameId}/media/${up.json().id}`)).status).toBe(204);
  });
});

describe("Medien und Entwurf", () => {
  it("löscht kein Medium, das der Entwurf noch nutzt", async () => {
    const orga = client(ctx);
    const gameId = await createGame();
    const data = randomBytes(200);
    const up = await upload(gameId, data, "audio/mpeg", { filename: "entwurf.mp3" });
    const draft = exampleGame();
    draft.media = [...(draft.media ?? []), { id: "ruf", type: "audio", src: up.json().src }];
    const put = await orga.put(`/games/${gameId}/draft`, { content: draft, meta: {}, revision: 0 });
    expect(put.status).toBe(200);

    const blocked = await orga.del(`/games/${gameId}/media/${up.json().id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "media_in_use" });
    expect(blocked.body.message).toContain("Entwurf");
    expect(existsSync(join(mediaDir(), `${sha(data)}.mp3`))).toBe(true);

    // Erst im Entwurf entfernen, dann geht das Löschen.
    expect((await orga.put(`/games/${gameId}/draft`, { content: exampleGame(), meta: {}, revision: 1 })).status).toBe(200);
    expect((await orga.del(`/games/${gameId}/media/${up.json().id}`)).status).toBe(204);
  });

  it("verträgt einen Entwurf mit kaputter Medienliste", async () => {
    const orga = client(ctx);
    const gameId = await createGame();
    const up = await upload(gameId, randomBytes(100), "audio/mpeg", { filename: "kaputt.mp3" });
    const content = { ...exampleGame(), media: "kaputt" };
    expect((await orga.put(`/games/${gameId}/draft`, { content, meta: {}, revision: 0 })).status).toBe(200);
    expect((await orga.del(`/games/${gameId}/media/${up.json().id}`)).status).toBe(204);
  });
});

describe("Medien ausliefern", () => {
  it("liefert hochgeladene Dateien ohne Anmeldung, mit Range-Anfragen und Cache-Headern", async () => {
    const gameId = await createGame();
    const data = randomBytes(1000);
    const { src } = (await upload(gameId, data, "audio/ogg")).json();
    const url = `/lykora/${src}`;

    const full = await get(url);
    expect(full.statusCode).toBe(200);
    expect(full.headers).toMatchObject({
      "content-type": "audio/ogg",
      "accept-ranges": "bytes",
      "content-length": "1000",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    expect(full.rawPayload.equals(data)).toBe(true);

    const head = await ctx.app.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(200);
    expect(head.headers["content-length"]).toBe("1000");
    expect(head.rawPayload.length).toBe(0);

    const start = await get(url, { range: "bytes=0-99" });
    expect(start.statusCode).toBe(206);
    expect(start.headers["content-range"]).toBe("bytes 0-99/1000");
    expect(start.headers["content-length"]).toBe("100");
    expect(start.rawPayload.equals(data.subarray(0, 100))).toBe(true);

    const open = await get(url, { range: "bytes=900-" });
    expect(open.headers["content-range"]).toBe("bytes 900-999/1000");
    expect(open.rawPayload.equals(data.subarray(900))).toBe(true);

    const suffix = await get(url, { range: "bytes=-10" });
    expect(suffix.headers["content-range"]).toBe("bytes 990-999/1000");
    expect(suffix.rawPayload.equals(data.subarray(990))).toBe(true);

    const beyond = await get(url, { range: "bytes=950-5000" });
    expect(beyond.headers["content-range"]).toBe("bytes 950-999/1000");

    const unsatisfiable = await get(url, { range: "bytes=5000-" });
    expect(unsatisfiable.statusCode).toBe(416);
    expect(unsatisfiable.headers["content-range"]).toBe("bytes */1000");

    // Grenzen: erstes und letztes Byte, Suffix länger als die Datei
    const firstByte = await get(url, { range: "bytes=0-0" });
    expect(firstByte.statusCode).toBe(206);
    expect(firstByte.headers["content-range"]).toBe("bytes 0-0/1000");
    expect(firstByte.rawPayload.equals(data.subarray(0, 1))).toBe(true);
    const lastByte = await get(url, { range: "bytes=999-999" });
    expect(lastByte.headers["content-range"]).toBe("bytes 999-999/1000");
    expect(lastByte.rawPayload.equals(data.subarray(999))).toBe(true);
    const longSuffix = await get(url, { range: "bytes=-5000" });
    expect(longSuffix.statusCode).toBe(206);
    expect(longSuffix.headers["content-range"]).toBe("bytes 0-999/1000");
    expect((await get(url, { range: "bytes=1000-1000" })).statusCode).toBe(416);
    expect((await get(url, { range: "bytes=-0" })).statusCode).toBe(416);

    // Mehrere Bereiche, verkehrte Grenzen und Unsinn: ganze Datei
    expect((await get(url, { range: "bytes=0-1,5-6" })).statusCode).toBe(200);
    expect((await get(url, { range: "bytes=5-3" })).statusCode).toBe(200);
    expect((await get(url, { range: "bytes=-" })).statusCode).toBe(200);
    expect((await get(url, { range: "zeilen=1-2" })).statusCode).toBe(200);

    const etag = full.headers.etag as string;
    expect((await get(url, { "if-none-match": etag })).statusCode).toBe(304);
    expect((await get(url, { range: "bytes=0-9", "if-range": etag })).statusCode).toBe(206);
    expect((await get(url, { range: "bytes=0-9", "if-range": '"veraltet"' })).statusCode).toBe(200);
  });

  it("liefert nur strikt erlaubte Dateinamen", async () => {
    const dataDir = ctx.app.deps.config.dataDir;
    writeFileSync(join(dataDir, "geheim.txt"), "geheim");
    writeFileSync(join(libDir, "geheim.txt"), "geheim");
    const gameId = await createGame();
    const { sha256 } = (await upload(gameId, randomBytes(64), "image/png")).json();
    writeFileSync(join(mediaDir(), `.${sha256}.tmp`), "halb");

    for (const path of [
      `/lykora/media/${sha256}.exe`,
      `/lykora/media/${sha256.toUpperCase()}.png`,
      `/lykora/media/${sha256}.png.txt`,
      `/lykora/media/.${sha256}.tmp`,
      `/lykora/media/${"0".repeat(64)}.png`,
      "/lykora/media/..%2Fgeheim.txt",
      "/lykora/media/%2e%2e%2fgeheim.txt",
      "/lykora/media/..%5Cgeheim.txt",
      "/lykora/media/lib/geheim.txt",
      "/lykora/media/lib/library.json",
      "/lykora/media/lib/..%2Flibrary.json",
      "/lykora/media/lib/Wind.ogg",
      "/lykora/media/lib/.wind.ogg",
      "/lykora/media/lib/wind.ogg%00.txt",
      "/lykora/media/lib/a/b.ogg",
      "/lykora/media/lib",
      "/lykora/media",
    ]) {
      const res = await get(path);
      expect(res.statusCode, path).toBe(404);
      expect(res.json().error, path).toBe("not_found");
    }
    expect((await get(`/lykora/media/${sha256}.png`)).statusCode).toBe(200);
  });

  it("liefert Klänge der Bibliothek", async () => {
    const res = await get("/lykora/media/lib/wind.ogg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/ogg");
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.rawPayload.equals(WIND)).toBe(true);
    const part = await get("/lykora/media/lib/wind.ogg", { range: "bytes=0-3" });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe("OggS");
    expect((await get("/lykora/media/lib/donner.ogg")).statusCode).toBe(404);
  });

  it("funktioniert auch ohne Basispfad", async () => {
    const root = await buildApp(
      testConfig({ BASE_PATH: "", PUBLIC_URL: "https://lykora.example.org", DATA_DIR: ctx.app.deps.config.dataDir, MEDIA_LIBRARY_DIR: libDir }),
      ctx.db,
      { logger: false },
    );
    const gameId = await createGame();
    const data = randomBytes(300);
    const up = await root.inject({
      method: "POST",
      url: `/api/games/${gameId}/media`,
      headers: { authorization: `Bearer ${ctx.token}`, "content-type": "audio/ogg" },
      payload: data,
    });
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({ src: `media/${sha(data)}.ogg`, url: `https://lykora.example.org/media/${sha(data)}.ogg` });
    const file = await root.inject({ method: "GET", url: `/${up.json().src}` });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(data)).toBe(true);
    expect((await root.inject({ method: "GET", url: "/media/lib/wind.ogg" })).rawPayload.equals(WIND)).toBe(true);
    const library = await root.inject({ method: "GET", url: "/api/library/sounds" });
    expect(library.json()[0]).toMatchObject({ src: "media/lib/wind.ogg", url: "https://lykora.example.org/media/lib/wind.ogg" });
    await root.close();
  });
});

describe("Klangbibliothek", () => {
  it("listet vorhandene Klänge ohne Anmeldung", async () => {
    const res = await client(ctx, "").get("/library/sounds");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "wind",
        title: "Wind",
        category: "ambience",
        loop: true,
        duration: 42.5,
        src: "media/lib/wind.ogg",
        url: "https://example.org/lykora/media/lib/wind.ogg",
        license: "CC0-1.0",
        credit,
      },
      {
        id: "eule",
        title: "Eule",
        category: "sfx",
        loop: false,
        duration: 1.6,
        src: "media/lib/eule.ogg",
        url: "https://example.org/lykora/media/lib/eule.ogg",
        license: "CC0-1.0",
        credit,
      },
    ]);
  });

  it("ist ohne library.json leer", async () => {
    const other = await buildApp(testConfig(), ctx.db, { logger: false });
    const res = await other.inject({ method: "GET", url: "/lykora/api/library/sounds" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await other.close();
  });
});

describe("Klang-Cues", () => {
  it("spielt Klänge aus dem Spiel und der Bibliothek bei Teams ein", async () => {
    const orga = client(ctx);
    const game = exampleGame();
    game.media = [...(game.media ?? []), { id: "karte", type: "image", src: "media/karte.png" }];
    const { event } = await createEvent(ctx, game);
    const a = await joinTeam(ctx, event.join.code, "Füchse", event.supervisorPin);
    const b = await joinTeam(ctx, event.join.code, "Eulen", event.supervisorPin);

    const toA = await orga.post(`/events/${event.id}/cues`, { teamId: a.team.id, audio: "eule", text: "  Hört ihr das?  ", sender: "Förster" });
    expect(toA.status).toBe(201);
    expect(toA.body).toMatchObject({ team_id: a.team.id, direction: "to_team", kind: "cue", sender: "Förster" });
    expect(JSON.parse(toA.body.body)).toEqual({ audio: "eule", src: "media/lib/eule.ogg", volume: 0.8, text: "Hört ihr das?" });

    const toAll = await orga.post(`/events/${event.id}/cues`, { teamId: null, audio: "lib:wind", volume: 0.5 });
    expect(toAll.status).toBe(201);
    expect(toAll.body).toMatchObject({ team_id: null, kind: "cue", sender: "hq" });
    expect(JSON.parse(toAll.body.body)).toEqual({ audio: "lib:wind", src: "media/lib/wind.ogg", volume: 0.5 });

    for (const audio of ["gibtsnicht", "karte", "lib:donner", "lib:../geheim", "lib:", "wind.ogg"]) {
      const res = await orga.post(`/events/${event.id}/cues`, { audio });
      expect(res.status, audio).toBe(400);
      expect(res.body.error, audio).toBe("unknown_audio");
    }
    expect((await orga.post(`/events/${event.id}/cues`, { audio: "eule", volume: 1.5 })).status).toBe(400);
    expect((await orga.post(`/events/${event.id}/cues`, { audio: "eule", text: "x".repeat(301) })).status).toBe(400);
    expect((await orga.post(`/events/${event.id}/cues`, {})).status).toBe(400);

    // Team eines anderen Events
    const other = await createEvent(ctx);
    const stranger = await joinTeam(ctx, other.event.join.code, "Fremde");
    expect((await orga.post(`/events/${event.id}/cues`, { teamId: stranger.team.id, audio: "eule" })).status).toBe(404);

    // Rechte wie bei Nachrichten: Darsteller ja, Zuschauer nein
    const actor = await member(ctx, "actor", "darsteller-cue@example.org");
    const viewer = await member(ctx, "viewer", "zuschauer-cue@example.org");
    expect((await client(ctx, actor).post(`/events/${event.id}/cues`, { teamId: b.team.id, audio: "lib:eule" })).status).toBe(201);
    expect((await client(ctx, viewer).post(`/events/${event.id}/cues`, { audio: "lib:eule" })).status).toBe(403);

    const syncA = await client(ctx, a.token).post("/play/sync", {});
    const cuesA = syncA.body.messages.filter((m: any) => m.kind === "cue").map((m: any) => JSON.parse(m.body).audio);
    expect(cuesA).toEqual(["eule", "lib:wind"]);
    const syncB = await client(ctx, b.token).post("/play/sync", {});
    expect(syncB.body.messages.filter((m: any) => m.kind === "cue").map((m: any) => JSON.parse(m.body).audio)).toEqual(["lib:wind", "lib:eule"]);

    const log = await orga.get(`/events/${event.id}/log`);
    const cueLog = log.body.filter((l: any) => l.kind === "cue_sent");
    expect(cueLog).toHaveLength(3);
    expect(cueLog[0]).toMatchObject({ team_name: "Füchse", user_name: "Admin", data: { audio: "eule", src: "media/lib/eule.ogg", volume: 0.8, text: "Hört ihr das?" } });
    const messages = await orga.get(`/events/${event.id}/messages`);
    expect(messages.body.filter((m: any) => m.kind === "cue")).toHaveLength(3);
  });

  it("spielt hochgeladene Klänge des Spiels ein", async () => {
    const gameId = await createGame();
    const up = await upload(gameId, randomBytes(128), "audio/mpeg", { filename: "stimme.mp3" });
    const game = exampleGame();
    game.media = [...(game.media ?? []), { id: "stimme", type: "audio", src: up.json().src }];
    await client(ctx).put(`/games/${gameId}`, { content: game });
    const event = await client(ctx).post(`/orgs/${ctx.orgId}/events`, { gameId, name: "Mit Stimme" });
    const cue = await client(ctx).post(`/events/${event.body.id}/cues`, { audio: "stimme" });
    expect(cue.status).toBe(201);
    expect(JSON.parse(cue.body.body)).toEqual({ audio: "stimme", src: up.json().src, volume: 0.8 });
  });
});
