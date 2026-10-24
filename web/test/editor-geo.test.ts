import { describe, expect, it } from "vitest";
import {
  accuracyLevel,
  areaCenter,
  averageFixes,
  bearing,
  compass,
  distanceM,
  distanceToArea,
  formatDms,
  gpsCircle,
  insideArea,
  M_PER_DEG,
  offsetPoint,
  parseCoordinates,
  polygonCentroid,
  roundRadius,
  stationPoint,
} from "../src/lib/editor/geo.ts";
import type { Station } from "../src/lib/editor/types.ts";

const near = (actual: number, expected: number, share = 0.01) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * share);
/** Quadrat 100 × 100 m mit der Ecke unten links bei Bonn */
const origin = { lat: 50.7374, lon: 7.0982 };
const square = { polygon: [origin, offsetPoint(origin, 100, 0), offsetPoint(origin, 100, 100), offsetPoint(origin, 0, 100)] };

describe("Abstände und Richtung", () => {
  it("rechnet bekannte Abstände auf 1 % genau", () => {
    near(distanceM({ lat: 50, lon: 7 }, { lat: 51, lon: 7 }), 111_195);
    // Berlin – Hamburg rund 255 km
    near(distanceM({ lat: 52.52, lon: 13.405 }, { lat: 53.5511, lon: 9.9937 }), 255_000, 0.01);
    near(distanceM(origin, offsetPoint(origin, 300, 400)), 500);
    expect(distanceM(origin, origin)).toBe(0);
  });

  it("verschiebt um Meter nach Osten und Norden", () => {
    const p = offsetPoint(origin, 10, 0);
    near(distanceM(origin, p), 10);
    expect(p.lat).toBe(origin.lat);
    near((offsetPoint(origin, 0, 1).lat - origin.lat) * M_PER_DEG, 1);
  });

  it("nennt Richtung und Himmelsrichtung", () => {
    expect(bearing(origin, offsetPoint(origin, 0, 100)) % 360).toBeCloseTo(0, 3);
    near(bearing(origin, offsetPoint(origin, 100, 0)), 90);
    expect(compass(bearing(origin, offsetPoint(origin, 50, 50)))).toBe("NO");
    expect(compass(bearing(origin, offsetPoint(origin, -50, -50)))).toBe("SW");
    expect(compass(359)).toBe("N");
  });

  it("rundet den Radius-Griff auf 5 m", () => {
    expect(roundRadius(22.4)).toBe(20);
    expect(roundRadius(23)).toBe(25);
    expect(roundRadius(1)).toBe(5);
  });
});

describe("Punkt in Fläche", () => {
  it("Vieleck: innen, außen und auf dem Rand", () => {
    expect(insideArea(offsetPoint(origin, 50, 50), square)).toBe(true);
    expect(insideArea(offsetPoint(origin, 150, 50), square)).toBe(false);
    expect(insideArea(offsetPoint(origin, 100, 50), square)).toBe(true);
    expect(insideArea(origin, square)).toBe(true);
  });

  it("Kreis: innen bis zum Rand", () => {
    const circle = { center: origin, radius: 50 };
    expect(insideArea(offsetPoint(origin, 49, 0), circle)).toBe(true);
    expect(insideArea(offsetPoint(origin, 50, 0), circle)).toBe(true);
    expect(insideArea(offsetPoint(origin, 52, 0), circle)).toBe(false);
  });

  it("misst den Abstand zur Fläche", () => {
    expect(distanceToArea(offsetPoint(origin, 50, 50), square)).toBe(0);
    near(distanceToArea(offsetPoint(origin, 120, 50), square), 20, 0.02);
    near(distanceToArea(offsetPoint(origin, -30, -40), square), 50, 0.02);
    near(distanceToArea(offsetPoint(origin, 80, 0), { center: origin, radius: 50 }), 30, 0.02);
  });

  it("hält unfertige Flächen aus", () => {
    expect(insideArea(origin, { polygon: [origin] } as never)).toBe(false);
    expect(distanceToArea(origin, { center: origin } as never)).toBe(Infinity);
    expect(areaCenter(null)).toBeNull();
  });

  it("findet den Schwerpunkt", () => {
    const c = polygonCentroid(square.polygon)!;
    near(distanceM(c, offsetPoint(origin, 50, 50)), 0.5, 1);
    expect(distanceM(c, offsetPoint(origin, 50, 50))).toBeLessThan(0.5);
    expect(areaCenter({ center: origin, radius: 3 })).toEqual(origin);
  });
});

describe("Ort der Station", () => {
  it("nimmt den eigenen Ort, sonst den des GPS-Auslösers; Radius Standard 20 m", () => {
    const s = { id: "a", name: "A", triggers: [{ type: "gps", location: offsetPoint(origin, 5, 0) }] } as Station;
    expect(stationPoint(s)).toEqual(offsetPoint(origin, 5, 0));
    expect(gpsCircle(s)).toEqual({ center: offsetPoint(origin, 5, 0), radius: 20 });
    const t = { ...s, location: origin, triggers: [{ type: "gps", radius: 35 }] } as Station;
    expect(stationPoint(t)).toEqual(origin);
    expect(gpsCircle(t)).toEqual({ center: origin, radius: 35 });
    expect(gpsCircle({ ...t, triggers: [{ type: "qr", code: "LYK-AAAA" }] } as Station)).toBeNull();
  });
});

describe("Koordinaten lesen und schreiben", () => {
  it("liest dezimal mit Punkt, Komma und Leerzeichen", () => {
    expect(parseCoordinates("50.8155, 7.155")).toEqual({ lat: 50.8155, lon: 7.155 });
    expect(parseCoordinates("50,8155; 7,155")).toEqual({ lat: 50.8155, lon: 7.155 });
    expect(parseCoordinates("50,8155, 7,155")).toEqual({ lat: 50.8155, lon: 7.155 });
    expect(parseCoordinates(" 50.8155 7.155 ")).toEqual({ lat: 50.8155, lon: 7.155 });
    expect(parseCoordinates("-33.9, 18.4")).toEqual({ lat: -33.9, lon: 18.4 });
  });

  it("liest Grad, Minuten und Sekunden", () => {
    const p = parseCoordinates(`50°48'55.8"N 7°9'18"E`)!;
    near(p.lat, 50.8155, 0.00001);
    near(p.lon, 7.155, 0.00001);
    const q = parseCoordinates("N 50° 48.93' O 7° 9.3'")!;
    near(q.lat, 50.8155, 0.00001);
    near(q.lon, 7.155, 0.00001);
    const r = parseCoordinates("7° 9′ 18″ O, 50° 48′ 55,8″ N")!;
    near(r.lat, 50.8155, 0.00001);
    expect(parseCoordinates(`33°55'S 18°25'W`)).toEqual({ lat: -33.9166667, lon: -18.4166667 });
  });

  it("lehnt Unlesbares und Unmögliches ab", () => {
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("Bonn")).toBeNull();
    expect(parseCoordinates("95, 7")).toBeNull();
    expect(parseCoordinates("50° N")).toBeNull();
  });

  it("schreibt Grad, Minuten und Sekunden und liest sie zurück", () => {
    const p = { lat: 50.8155, lon: 7.155 };
    expect(formatDms(p)).toBe("50° 48′ 55,8″ N, 7° 9′ 18,0″ O");
    const back = parseCoordinates(formatDms(p))!;
    expect(distanceM(back, p)).toBeLessThan(2);
    expect(formatDms({ lat: -1.5, lon: -0.25 })).toBe("1° 30′ 0,0″ S, 0° 15′ 0,0″ W");
  });
});

describe("Mitteln vor Ort", () => {
  it("lässt Ausreißer weg und meldet die beste Genauigkeit", () => {
    const fixes = [
      { ...offsetPoint(origin, 0, 0), accuracy: 5 },
      { ...offsetPoint(origin, 2, 0), accuracy: 6 },
      { ...offsetPoint(origin, -2, 0), accuracy: 8 },
      { ...offsetPoint(origin, 80, 80), accuracy: 40 },
    ];
    const r = averageFixes(fixes)!;
    expect(r.used).toBe(3);
    expect(r.total).toBe(4);
    expect(r.accuracy).toBe(5);
    expect(distanceM(r.point, origin)).toBeLessThan(0.5);
  });

  it("nimmt bei gleich guten Messungen alle und liefert nichts ohne Messung", () => {
    const r = averageFixes([
      { ...origin, accuracy: 12 },
      { ...offsetPoint(origin, 10, 0), accuracy: 12 },
    ])!;
    expect(r.used).toBe(2);
    near(distanceM(r.point, offsetPoint(origin, 5, 0)), 0.1, 10);
    expect(averageFixes([])).toBeNull();
  });

  it("beschreibt die Genauigkeit in vier Stufen", () => {
    expect(accuracyLevel(6)).toEqual({ bars: 4, word: "sehr gut" });
    expect(accuracyLevel(12)).toEqual({ bars: 3, word: "gut" });
    expect(accuracyLevel(25)).toEqual({ bars: 2, word: "mäßig – kurz warten" });
    expect(accuracyLevel(42)).toEqual({ bars: 1, word: "zu ungenau" });
  });
});
