import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CHECKS } from "../src/lib/editor/checks.ts";
import { distanceM, offsetPoint } from "../src/lib/editor/geo.ts";
import { allCodes } from "../src/lib/editor/ids.ts";
import type { EditorIssue, EditorMeta, Game } from "../src/lib/editor/types.ts";
import { validateDraft } from "../src/lib/editor/validation.ts";
import {
  addPoint,
  addStation,
  addZone,
  areaSummary,
  atTemplate,
  convertArea,
  duplicateStation,
  markerState,
  moveStation,
  moveStationTo,
  nudgeOf,
  setGpsRadius,
} from "../src/pages/games/editor/map/actions.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
type Loose = Record<string, any>;
const st = (g: Game, id: string): Loose => g.stations.find((s) => s.id === id)!;
const find = (g: Game, code: string, meta: EditorMeta = {}) => validateDraft(g, meta).filter((i) => i.code === code);
/** Nur die Baukasten-Prüfungen (ohne Schema): für Fälle, die das Schema ohnehin meldet. */
const fromChecks = (g: Game, code: string, meta: EditorMeta = {}) => CHECKS.flatMap((c) => c(g, meta, "de")).filter((i) => i.code === code);

/** Mitten in der Sperrzone „Straße“ des Beispielspiels */
const IN_ROAD = { lat: 50.8169, lon: 7.155 };

const CASES: [
  string,
  (g: Loose, meta: EditorMeta) => void,
  { severity: EditorIssue["severity"]; path: string; text?: RegExp; negative?: (g: Loose, meta: EditorMeta) => void; checksOnly?: boolean },
][] = [
  ["station_in_zone", (g) => (st(g as Game, "baum").location = IN_ROAD), { severity: "error", path: "/stations/1/location", text: /„Der alte Baum“ liegt in der Sperrzone „Straße“/ }],
  [
    "station_in_zone",
    (g) => {
      delete st(g as Game, "baum").location;
      st(g as Game, "baum").triggers[0].location = IN_ROAD;
    },
    { severity: "error", path: "/stations/1/triggers/0/location" },
  ],
  ["assembly_in_zone", (g) => (g.field.assemblyPoint.location = IN_ROAD), { severity: "error", path: "/field/assemblyPoint/location", text: /Sammelpunkt liegt in der Sperrzone „Straße“/ }],
  ["station_outside_field", (g) => (st(g as Game, "baum").location = { lat: 50.82, lon: 7.155 }), { severity: "warning", path: "/stations/1/location", text: /außerhalb des Spielfelds/ }],
  [
    "station_near_zone",
    (g) => (st(g as Game, "baum").location = { lat: 50.81662, lon: 7.155 }),
    { severity: "warning", path: "/stations/1/location", text: /näher als 15 m an der Sperrzone „Straße“/, negative: (g) => (st(g as Game, "baum").location = { lat: 50.8162, lon: 7.155 }) },
  ],
  [
    "gps_overlap",
    () => undefined,
    {
      severity: "warning",
      path: "/stations/4/triggers/0",
      text: /„Finale: das Funkgerät“ und „Sicherheits-Briefing“/,
      negative: (g) => (st(g as Game, "finale").location = { lat: 50.8152, lon: 7.1535 }),
    },
  ],
  ["gps_radius_small", (g) => (st(g as Game, "baum").triggers[0].radius = 10), { severity: "warning", path: "/stations/1/triggers/0/radius" }],
  [
    "zone_unfinished",
    (g) => (g.field.restrictedZones[0].area = { polygon: [IN_ROAD, offsetPoint(IN_ROAD, 10, 0)] }),
    { severity: "error", path: "/field/restrictedZones/0/area/polygon", checksOnly: true },
  ],
  ["assembly_no_name", (g) => delete g.field.assemblyPoint.name, { severity: "hint", path: "/field/assemblyPoint/name" }],
  [
    "no_zones",
    (g) => {
      g.meta.night = false;
      delete g.field.restrictedZones;
    },
    {
      severity: "warning",
      path: "/field/restrictedZones",
      negative: (g, m) => {
        g.meta.night = false;
        delete g.field.restrictedZones;
        m.noZones = true;
      },
    },
  ],
  [
    "night_no_zones",
    (g) => delete g.field.restrictedZones,
    {
      severity: "warning",
      path: "/field/restrictedZones",
      negative: (g) => {
        g.meta.night = false;
        delete g.field.restrictedZones;
      },
    },
  ],
  [
    "no_rescue_point",
    (g) => delete g.field.rescuePoints,
    {
      severity: "warning",
      path: "/field/rescuePoints",
      negative: (g) => {
        g.meta.night = false;
        delete g.field.rescuePoints;
      },
    },
  ],
  [
    "no_rescue_point",
    (g) => {
      g.meta.night = false;
      delete g.field.rescuePoints;
      st(g as Game, "baum").offPath = true;
    },
    { severity: "warning", path: "/field/rescuePoints" },
  ],
  [
    "night_no_gear",
    (g) => (g.safety.requiredGear = [{ de: "Lampe" }]),
    { severity: "warning", path: "/safety/requiredGear", negative: (g) => (g.safety.requiredGear = [{ de: "Stirnlampe" }, { de: "Warnweste" }]) },
  ],
  ["sms_fallback_missing", () => undefined, { severity: "hint", path: "/safety/sos/smsFallback", negative: (g) => delete g.safety.sos.smsFallback }],
];

describe("Kartenprüfungen (Paket B)", () => {
  for (const [code, mutate, want] of CASES) {
    it(`${code}: ${want.path}`, () => {
      const g = load() as Loose;
      const meta: EditorMeta = {};
      mutate(g, meta);
      const hits = (want.checksOnly ? fromChecks : find)(g as Game, code, meta);
      const hit = hits.find((i) => i.at.path === want.path);
      expect(hit, `Meldung ${code} an ${want.path}`).toBeDefined();
      expect(hit!.severity).toBe(want.severity);
      expect(hit!.source).toBe("editor");
      expect(hit!.dismissable).toBe(want.severity !== "error");
      if (want.text) expect(hit!.message).toMatch(want.text);
      const ok = load() as Loose;
      const okMeta: EditorMeta = {};
      want.negative?.(ok, okMeta);
      expect((want.checksOnly ? fromChecks : find)(ok as Game, code, okMeta)).toEqual([]);
    });
  }

  it("Station in der Sperrzone ist nicht zugleich außerhalb des Spielfelds oder nur nah dran", () => {
    const g = load();
    st(g, "baum").location = IN_ROAD;
    const codes = validateDraft(g, {})
      .filter((i) => i.at.objectId === "baum")
      .map((i) => i.code);
    expect(codes).toContain("station_in_zone");
    expect(codes).not.toContain("station_near_zone");
    expect(codes).not.toContain("station_outside_field");
  });

  it("Sofort-Lösungen: Spielfeld vergrößern, Ausrüstung ergänzen, Sperrzonen gibt es nicht", () => {
    const g = load();
    st(g, "baum").location = { lat: 50.82, lon: 7.155 };
    g.safety.requiredGear = [{ de: "Lampe" }];
    const meta: EditorMeta = {};
    for (const i of validateDraft(g, meta).filter((x) => x.fix && ["station_outside_field", "night_no_gear"].includes(x.code))) i.fix!.apply(g, meta);
    expect(find(g, "station_outside_field")).toEqual([]);
    expect((g.field.boundary as { radius: number }).radius).toBeGreaterThan(300);
    expect(g.safety.requiredGear).toEqual([{ de: "Lampe" }, { de: "Warnweste" }]);
    expect(find(g, "night_no_gear")).toEqual([]);

    g.meta.night = false;
    delete g.field.restrictedZones;
    const noZones = find(g, "no_zones", meta)[0]!;
    expect(noZones.fix?.label).toBe("Gibt es nicht");
    noZones.fix!.apply(g, meta);
    expect(meta.noZones).toBe(true);
    expect(find(g, "no_zones", meta)).toEqual([]);
  });

  it("halten kaputte Entwürfe aus", () => {
    const broken = {
      field: { boundary: { polygon: [null] }, assemblyPoint: { location: null }, restrictedZones: [null, { id: "z", area: {} }] },
      stations: [null, { id: "x", triggers: [null, { type: "gps" }] }],
      meta: { night: true },
      safety: {},
    } as unknown as Game;
    for (const check of CHECKS) expect(() => check(broken, {}, "de")).not.toThrow();
    expect(() => validateDraft(broken, {})).not.toThrow();
  });
});

describe("Stationsliste und Karte (Paket B)", () => {
  it("Sortieren ändert die Reihenfolge im Spiel, die IDs bleiben", () => {
    const g = load();
    const before = g.stations.map((s) => s.id);
    moveStation(g, 1, 3);
    expect(g.stations.map((s) => s.id)).toEqual(["briefing", "schloss", "versteck", "baum", "finale"]);
    expect([...g.stations.map((s) => s.id)].sort()).toEqual([...before].sort());
    moveStation(g, 3, 1);
    expect(g.stations.map((s) => s.id)).toEqual(before);
    moveStation(g, 0, 9);
    expect(g.stations.map((s) => s.id)).toEqual(before);
  });

  it("Neue Station: ID aus dem Namen, GPS 20 m, QR und Notfall-Code, Ort gesetzt", () => {
    const g = load();
    const id = addStation(g, "raetsel", "Die Brücke", { lat: 50.81551234567, lon: 7.1561 });
    expect(id).toBe("die-bruecke");
    const s = g.stations.at(-1)!;
    expect(s.id).toBe("die-bruecke");
    expect(s.location).toEqual({ lat: 50.8155123, lon: 7.1561 });
    expect(s.triggers.map((t) => t.type)).toEqual(["gps", "qr", "manual"]);
    expect(s.triggers[0]).toMatchObject({ type: "gps", radius: 20 });
    expect(find(g, "duplicate_code")).toEqual([]);
    expect(addStation(g, "raetsel", "Die Brücke", { lat: 50.8155, lon: 7.156 })).toBe("die-bruecke-2");
  });

  it("Duplizieren: Kopie dahinter, neue ID und Codes, 20 m versetzt, ohne NFC und Codeteile", () => {
    const g = load();
    const codes = new Set(allCodes(g));
    const id = duplicateStation(g, "baum")!;
    expect(id).toBe("baum-2");
    expect(g.stations.map((s) => s.id)).toEqual(["briefing", "baum", "baum-2", "schloss", "versteck", "finale"]);
    const copy = g.stations[2]! as Loose;
    expect(copy.name.de).toBe("Der alte Baum (Kopie)");
    expect(copy.triggers.some((t: Loose) => t.type === "nfc")).toBe(false);
    for (const t of copy.triggers) if (t.code) expect(codes.has(t.code)).toBe(false);
    expect(Math.round(distanceM(st(g, "baum").location, copy.location))).toBe(20);
    expect(copy.final).toBeUndefined();
    expect(copy.rewards?.fragments).toBeUndefined();
    expect(find(g, "duplicate_code")).toEqual([]);
    expect(duplicateStation(g, "gibt-es-nicht")).toBeNull();
  });

  it("Verschieben zieht einen GPS-Auslöser mit eigenem Ort mit; Radius wird geschrieben", () => {
    const g = load();
    const s = st(g, "baum");
    s.triggers[0].location = offsetPoint(s.location, 5, 0);
    const to = offsetPoint(s.location, 100, 0);
    moveStationTo(g, "baum", to);
    expect(s.location).toEqual(to);
    expect(Math.round(distanceM(s.triggers[0].location, offsetPoint(to, 5, 0)))).toBe(0);
    setGpsRadius(g, "baum", 35);
    expect(s.triggers[0].radius).toBe(35);
  });

  it("Pfeiltasten: 1 m, mit Umschalt 10 m; andere Tasten nichts", () => {
    expect(nudgeOf("ArrowRight", false)).toEqual({ dx: 1, dy: 0 });
    expect(nudgeOf("ArrowUp", true)).toEqual({ dx: 0, dy: 10 });
    expect(nudgeOf("ArrowDown", false)).toEqual({ dx: 0, dy: -1 });
    expect(nudgeOf("a", false)).toBeNull();
    // 10× Umschalt+Pfeil rechts ≈ 100 m (E2E „Karte: Stationen verschieben“)
    const g = load();
    const start = { ...st(g, "baum").location };
    for (let i = 0; i < 10; i++) moveStationTo(g, "baum", offsetPoint(st(g, "baum").location, 10, 0));
    expect(Math.round(distanceM(start, st(g, "baum").location))).toBe(100);
  });

  it("Sperrzone und Punkte anlegen: Name nach Art, IDs automatisch", () => {
    const g = load();
    const id = addZone(g, { polygon: [IN_ROAD, offsetPoint(IN_ROAD, 10, 0), offsetPoint(IN_ROAD, 0, 10)] }, "water");
    expect(id).toBe("gewaesser-2");
    expect(g.field.restrictedZones!.at(-1)).toMatchObject({ id, name: { de: "Gewässer 2" }, kind: "water" });
    expect(addZone(g, { center: IN_ROAD, radius: 25 })).toBe("sperrzone-3");
    expect(addPoint(g, "rescue", IN_ROAD)).toBe(1);
    expect(g.field.rescuePoints![1]).toMatchObject({ id: "rettungspunkt-2", name: { de: "Rettungspunkt 2" }, location: IN_ROAD });
    expect(addPoint(g, "supply", IN_ROAD)).toBe(0);
    expect(g.field.supplyPoints![0]!.name).toEqual({ de: "Versorgungspunkt" });
    expect(find(g, "duplicate_id")).toEqual([]);
  });

  it("Flächen umformen: Kreis → Achteck → Kreis", () => {
    const circle = { center: IN_ROAD, radius: 50 };
    const poly = convertArea(circle, "polygon") as { polygon: { lat: number; lon: number }[] };
    expect(poly.polygon).toHaveLength(8);
    for (const p of poly.polygon) expect(Math.round(distanceM(IN_ROAD, p))).toBe(50);
    const back = convertArea(poly, "circle") as { center: { lat: number; lon: number }; radius: number };
    expect(back.radius).toBe(50);
    expect(distanceM(back.center, IN_ROAD)).toBeLessThan(1);
    expect(areaSummary(circle)).toBe("Kreis, Radius 50 m");
    expect(areaSummary(poly)).toBe("Vieleck mit 8 Ecken");
    expect(areaSummary({ polygon: [IN_ROAD] })).toBe("unfertig (1 Ecke)");
    expect(areaSummary(undefined)).toBe("noch nicht festgelegt");
  });

  it("Marker: Zustand aus den Meldungen, Vorlagen-Platz bis vor Ort bestätigt", () => {
    const g = load();
    st(g, "baum").location = IN_ROAD;
    const issues = validateDraft(g, {});
    expect(markerState(issues, "baum")).toBe("error");
    expect(markerState(issues, "finale")).toBe("warning");
    const overlap = issues.find((i) => i.code === "gps_overlap")!;
    expect(markerState(issues, "finale", [overlap.id])).toBeNull();
    const meta: EditorMeta = { template: { id: "t", stations: { baum: offsetPoint(IN_ROAD, 1, 0) }, tasks: {}, createdAt: "" } };
    expect(atTemplate(meta, "baum", IN_ROAD)).toBe(true);
    expect(atTemplate(meta, "baum", offsetPoint(IN_ROAD, 5, 0))).toBe(false);
    expect(atTemplate({ ...meta, onSite: { baum: { accuracy: 4, at: "" } } }, "baum", IN_ROAD)).toBe(false);
  });
});

describe("Sicherheit (Paket B)", () => {
  let safety: typeof import("../src/pages/games/editor/safety/SafetySection.tsx");
  beforeAll(async () => {
    // Die Bausteine laden session.ts, das beim Laden document.baseURI liest.
    vi.stubGlobal("document", { baseURI: "https://lager.example/lykora/", documentElement: { dataset: {} }, querySelector: () => null, addEventListener: vi.fn() });
    vi.stubGlobal("window", { location: { pathname: "/lykora/", search: "" }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(), key: () => null, length: 0 });
    safety = await import("../src/pages/games/editor/safety/SafetySection.tsx");
  });

  it("Telefonfeld lässt nur Zeichen des Musters durch", () => {
    expect(safety.filterPhone("+49 (170) 123-45/67")).toBe("+49 (170) 123-45/67");
    expect(safety.filterPhone("0170 abc 1234567!")).toBe("0170  1234567");
  });

  it("Zeit als Satz, wie in den Einstellungen", () => {
    expect(safety.timeSentence("per_team", 6000)).toBe("Spätestens 100 Minuten nach ihrem Start sind alle Teams fertig.");
    expect(safety.timeSentence(undefined, 5400)).toBe("Spätestens 90 Minuten nach ihrem Start sind alle Teams fertig.");
    expect(safety.timeSentence("global", 3600)).toBe("Spätestens 60 Minuten nach dem Start des Events sind alle Teams fertig.");
    expect(safety.timeSentence("none", 3600)).toBe("Kein Zeitlimit – die Spielleitung beendet das Spiel.");
    expect(safety.timeSentence("per_team", undefined)).toMatch(/ohne Dauer/);
  });
});
