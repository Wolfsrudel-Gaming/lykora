import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { distanceM } from "../src/lib/editor/geo.ts";
import { allPoints, relocateGame, relocatePoint, TEMPLATE_ORIGIN } from "../src/lib/editor/relocate.ts";
import type { Game, Point } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
const BONN: Point = { lat: 50.7374, lon: 7.0982 };
const NORD: Point = { lat: 59.9139, lon: 10.7522 };

describe("allPoints", () => {
  it("findet Spielfeld, Start, Sammelpunkt, Zonen, Rettungspunkte und Stationen", () => {
    const paths = allPoints(load()).map((p) => p.path);
    expect(paths).toContain("/field/boundary/center");
    expect(paths).toContain("/field/start");
    expect(paths).toContain("/field/assemblyPoint/location");
    expect(paths).toContain("/field/restrictedZones/0/area/polygon/3");
    expect(paths).toContain("/field/rescuePoints/0/location");
    expect(paths).toContain("/stations/1/location");
  });

  it("findet Orte an Auslösern, „Ort finden“ und Regelorten", () => {
    const g = load();
    g.stations[0]!.triggers[0] = { type: "gps", location: { lat: 50.81, lon: 7.15 } };
    g.stations[1]!.task = { type: "find_location", prompt: { de: "Sucht" }, location: { lat: 50.82, lon: 7.16 } };
    g.rules![0]!.when.push({ near: { location: { lat: 50.83, lon: 7.17 }, radius: 20 } });
    const paths = allPoints(g).map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(["/stations/0/triggers/0/location", "/stations/1/task/location", "/rules/0/when/1/near/location"]));
  });

  it("hält unvollständige Entwürfe aus", () => {
    expect(allPoints({} as Game)).toEqual([]);
    expect(allPoints({ stations: [null], field: { restrictedZones: [{}] } } as unknown as Game)).toEqual([]);
  });
});

describe("relocateGame", () => {
  it("legt den Bezugsort auf das Ziel und lässt das Original unverändert", () => {
    const g = load();
    const moved = relocateGame(g, TEMPLATE_ORIGIN, BONN);
    expect(moved.field.assemblyPoint.location).toEqual(BONN);
    expect(g.field.assemblyPoint.location).toEqual(TEMPLATE_ORIGIN);
  });

  it("erhält Abstände zwischen allen Orten auf ±0,5 m, auch weit im Norden", () => {
    const g = load();
    for (const to of [BONN, NORD]) {
      const before = allPoints(g).map((p) => p.point);
      const after = allPoints(relocateGame(g, TEMPLATE_ORIGIN, to)).map((p) => p.point);
      for (let i = 0; i < before.length; i++) {
        for (let j = i + 1; j < before.length; j++) {
          expect(Math.abs(distanceM(after[i]!, after[j]!) - distanceM(before[i]!, before[j]!))).toBeLessThan(0.5);
        }
      }
    }
  });

  it("streckt Abstände vom Bezugspunkt und Kreis-Radien um scale", () => {
    const g = load();
    const moved = relocateGame(g, TEMPLATE_ORIGIN, BONN, 400 / 300);
    const tree = g.stations.find((s) => s.id === "baum")!.location!;
    const movedTree = moved.stations.find((s) => s.id === "baum")!.location!;
    expect(distanceM(BONN, movedTree)).toBeCloseTo((distanceM(TEMPLATE_ORIGIN, tree) * 4) / 3, 0);
    expect(moved.field.boundary).toMatchObject({ radius: 400 });
  });

  it("rundet auf 6 Nachkommastellen", () => {
    const p = relocatePoint({ lat: 50.81551234, lon: 7.15512345 }, TEMPLATE_ORIGIN, BONN);
    expect(String(p.lat).split(".")[1]!.length).toBeLessThanOrEqual(6);
    expect(String(p.lon).split(".")[1]!.length).toBeLessThanOrEqual(6);
  });
});
