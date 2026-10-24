import { describe, expect, it } from "vitest";
import { resolveBase } from "../src/lib/base.ts";
import { OSM_ATTRIBUTION, OSM_TILES, resolveTiles } from "../src/lib/tiles.ts";

const base = resolveBase("https://riegel-troisdorf.de/lykora/");
const root = resolveBase("http://localhost:3000/");

describe("Kacheln des Spiels", () => {
  it("nimmt OpenStreetMap, wenn nichts eingestellt ist", () => {
    for (const v of [undefined, null, "", "   ", 42]) {
      expect(resolveTiles(v, base)).toEqual({ url: OSM_TILES, attribution: OSM_ATTRIBUTION, own: false });
    }
  });

  it("löst eine relative Adresse am Basispfad des Servers auf", () => {
    const own = resolveTiles("tiles/sieglar/{z}/{x}/{y}.png", base);
    expect(own).toEqual({ url: "/lykora/tiles/sieglar/{z}/{x}/{y}.png", attribution: OSM_ATTRIBUTION, own: true });
    expect(resolveTiles("/tiles/sieglar-nacht/{z}/{x}/{y}.png", root).url).toBe("/tiles/sieglar-nacht/{z}/{x}/{y}.png");
    expect(resolveTiles("  tiles/sieglar/{z}/{x}/{y}.png ", base).url).toBe("/lykora/tiles/sieglar/{z}/{x}/{y}.png");
  });

  it("lässt vollständige Adressen stehen und erkennt Kacheln des eigenen Servers", () => {
    const osm = resolveTiles("https://tile.openstreetmap.org/{z}/{x}/{y}.png", base);
    expect(osm).toMatchObject({ url: OSM_TILES, own: false });
    const other = resolveTiles("https://tiles.example.org/a/{z}/{x}/{y}.png", base);
    expect(other).toMatchObject({ url: "https://tiles.example.org/a/{z}/{x}/{y}.png", own: false });
    const self = resolveTiles("https://riegel-troisdorf.de/lykora/tiles/sieglar/{z}/{x}/{y}.png", base);
    expect(self.own).toBe(true);
    expect(resolveTiles("https://riegel-troisdorf.de/lykora/media/x/{z}/{x}/{y}.png", base).own).toBe(false);
  });

  it("fällt auf OpenStreetMap zurück, wenn der Wert nicht brauchbar ist", () => {
    for (const v of [
      "tiles/sieglar", // keine Vorlage (z. B. Media-ID eines PMTiles-Pakets)
      "0a1b2c3d.pmtiles",
      "tiles/sieglar/{z}/{x}.png", // y fehlt
      "tiles/{s}/{z}/{x}/{y}.png", // Platzhalter, den Leaflet nicht füllt
      "tiles/{z}/{x}/{y}/{r}.png",
      "javascript:alert({z}{x}{y})",
      "data:text/html,{z}{x}{y}",
      "file:///etc/{z}/{x}/{y}",
      "//evil.example/{z}/{x}/{y}.png",
    ]) {
      expect(resolveTiles(v, base), v).toMatchObject({ url: OSM_TILES, own: false });
    }
  });
});
