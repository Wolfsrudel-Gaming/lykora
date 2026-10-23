import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, tempDir, type TestContext } from "./helpers.ts";

// Kleines Kartenpaket mit Ersatzdaten; der Server prüft den Inhalt der Kacheln nicht.
const packsDir = tempDir("packs");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("kachel-17-68130-43990")]);
function writePack(name: string, meta: object | null, tiles: Array<[number, number, number]>) {
  for (const [z, x, y] of tiles) {
    mkdirSync(join(packsDir, name, String(z), String(x)), { recursive: true });
    writeFileSync(join(packsDir, name, String(z), String(x), `${y}.png`), PNG);
  }
  mkdirSync(join(packsDir, name), { recursive: true });
  if (meta) writeFileSync(join(packsDir, name, "pack.json"), JSON.stringify(meta));
}
writePack("probe", { name: "falsch", title: "Probekarte", attribution: "© OpenStreetMap-Mitwirkende", license: "ODbL-1.0", tileCount: 1 }, [[17, 68130, 43990]]);
writePack("probe-nacht", { name: "probe-nacht", title: "Probekarte (Nacht)", variantOf: "probe" }, [[17, 68130, 43990]]);
writePack("ohne-meta", null, [[17, 68130, 43990]]);
mkdirSync(join(packsDir, "Gross"), { recursive: true });
writeFileSync(join(packsDir, "Gross", "pack.json"), "{}");
writeFileSync(join(packsDir, "geheim.txt"), "geheim");

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setup({ MAP_PACKS_DIR: packsDir });
});
afterAll(async () => {
  await ctx?.close();
});

const get = (url: string, headers: Record<string, string> = {}) => ctx.app.inject({ method: "GET", url, headers });
const tile = (pack: string, z: string | number, x: string | number, y: string | number) => get(`/lykora/tiles/${pack}/${z}/${x}/${y}.png`);

describe("Kacheln ausliefern", () => {
  it("liefert eine Kachel ohne Anmeldung", async () => {
    const res = await tile("probe", 17, 68130, 43990);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("setzt Cache-Header und ETag, 304 bei gleichem ETag", async () => {
    const res = await tile("probe", 17, 68130, 43990);
    expect(res.headers["cache-control"]).toMatch(/public, max-age=\d{6,}/);
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f-]+"$/);
    const again = await get("/lykora/tiles/probe/17/68130/43990.png", { "if-none-match": etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
  });

  it("liefert die Nachtvariante als eigenes Paket", async () => {
    expect((await tile("probe-nacht", 17, 68130, 43990)).statusCode).toBe(200);
  });

  it("antwortet bei fehlender Kachel mit 404", async () => {
    for (const [pack, z, x, y] of [["probe", 17, 1, 1], ["probe", 16, 68130, 43990], ["gibtsnicht", 17, 68130, 43990]] as const) {
      const res = await tile(pack, z, x, y);
      expect(res.statusCode, `${pack}/${z}/${x}/${y}`).toBe(404);
      expect(res.headers["content-type"]).not.toBe("image/png");
    }
  });

  it("weist Pfadtricks und ungültige Namen ab", async () => {
    const bad = [
      "/lykora/tiles/..%2Fprobe/17/68130/43990.png",
      "/lykora/tiles/../probe/17/68130/43990.png",
      "/lykora/tiles/probe/17/68130/..%2F..%2F..%2Fgeheim.txt",
      "/lykora/tiles/probe/17/%2e%2e/43990.png",
      "/lykora/tiles/probe/..%2F..%2Fgeheim.txt/1/1.png",
      "/lykora/tiles/Gross/17/68130/43990.png",
      "/lykora/tiles/probe%00/17/68130/43990.png",
      "/lykora/tiles/probe_x/17/68130/43990.png",
      `/lykora/tiles/${"a".repeat(41)}/17/68130/43990.png`,
      "/lykora/tiles/probe/17/68130/43990.jpg",
      "/lykora/tiles/probe/17/68130/43990",
      "/lykora/tiles/probe/17/68130/.png",
      "/lykora/tiles/probe/17/68130/43990.png.png",
    ];
    for (const url of bad) expect((await get(url)).statusCode, url).toBe(404);
  });

  it("weist ungültige Koordinaten ab", async () => {
    const coords: Array<[string, string, string]> = [["-1", "1", "1"], ["17", "-68130", "43990"], ["17", "6.8", "1"], ["17", "0x10", "1"], ["17", "068130", "43990"], ["99", "1", "1"], ["1", "5", "0"], ["abc", "1", "1"], ["17", "1e3", "1"], ["17", "", "1"]];
    for (const [z, x, y] of coords) expect((await tile("probe", z, x, y)).statusCode, `${z}/${x}/${y}`).toBe(404);
  });

  it("kennt nur GET", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/lykora/tiles/probe/17/68130/43990.png", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe("Kartenpakete auflisten", () => {
  it("listet Pakete mit pack.json und Kachel-Vorlage, ohne Anmeldung", async () => {
    const res = await get("/lykora/api/tiles");
    expect(res.statusCode).toBe(200);
    const packs = res.json();
    expect(packs.map((p: any) => p.name)).toEqual(["probe", "probe-nacht"]);
    expect(packs[0]).toMatchObject({
      name: "probe", // kommt vom Ordner, nicht aus der Datei
      title: "Probekarte",
      attribution: "© OpenStreetMap-Mitwirkende",
      license: "ODbL-1.0",
      tiles: "tiles/probe/{z}/{x}/{y}.png",
      url: "https://example.org/lykora/tiles/probe/{z}/{x}/{y}.png",
    });
    expect(packs[1]).toMatchObject({ variantOf: "probe", tiles: "tiles/probe-nacht/{z}/{x}/{y}.png" });
  });

  it("liefert eine leere Liste, wenn der Ordner fehlt", async () => {
    const other = await setup({ MAP_PACKS_DIR: join(packsDir, "gibtsnicht") });
    try {
      const res = await other.app.inject({ method: "GET", url: "/lykora/api/tiles" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it("findet ohne Einstellung das mitgelieferte Paket im Repo", async () => {
    const other = await setup();
    try {
      const res = await other.app.inject({ method: "GET", url: "/lykora/api/tiles" });
      const names = res.json().map((p: any) => p.name);
      expect(names).toContain("sieglar");
      expect(names).toContain("sieglar-nacht");
      const pack = res.json().find((p: any) => p.name === "sieglar");
      expect(pack).toMatchObject({ license: "ODbL-1.0", attribution: "© OpenStreetMap-Mitwirkende", tiles: "tiles/sieglar/{z}/{x}/{y}.png" });
      // Mittelpunkt des Pakets auf der niedrigsten Stufe
      const n = 2 ** pack.minZoom;
      const x = Math.floor(((pack.center.lon + 180) / 360) * n);
      const y = Math.floor(((1 - Math.asinh(Math.tan((pack.center.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
      const t = await other.app.inject({ method: "GET", url: `/lykora/tiles/sieglar/${pack.minZoom}/${x}/${y}.png` });
      expect(t.statusCode).toBe(200);
      expect(t.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await other.close();
    }
  });
});
