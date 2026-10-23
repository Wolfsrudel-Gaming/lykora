import { describe, expect, it } from "vitest";
import { validateGame } from "@lykora/spec";
import { CHECKS, setMediaSizes } from "../src/lib/editor/checks.ts";
import { distanceM, stationPoint } from "../src/lib/editor/geo.ts";
import { allCodes } from "../src/lib/editor/ids.ts";
import { TEMPLATES, EXAMPLE_GAME } from "../src/lib/editor/templates/index.ts";
import { buildGame, copyTitle, defaultChoices, duplicateGame, renewCodes, type WizardChoices } from "../src/lib/editor/templates/wizard.ts";
import type { EditorMeta, Game, Point } from "../src/lib/editor/types.ts";
import { validateDraft } from "../src/lib/editor/validation.ts";

const BONN: Point = { lat: 50.7374, lon: 7.0982 };
const QR = /^LYK-[A-HJ-NP-Z2-9]{4}$/;

/** Assistent mit Vorgaben der Vorlage, Ort Bonn, Radius 400 m und Telefon. */
function wizard(game: Game, patch: Partial<WizardChoices> = {}) {
  const choices = { ...defaultChoices(game), place: BONN, radius: 400, phone: "+49 170 1234567", ...patch };
  return buildGame(game, choices as WizardChoices & { place: Point }, { templateId: "test", localTasks: [], now: new Date("2026-10-22T10:00:00Z") });
}

describe("Vorlagen", () => {
  it("es gibt vier, in der Reihenfolge der leeren Spiele-Liste", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["kinder-schnitzeljagd", "nachtwanderung", "outdoor-escape", "leer"]);
  });

  for (const info of TEMPLATES) {
    describe(info.title, () => {
      it("ist ein gültiges Spiel", async () => {
        expect(validateGame(await info.load())).toEqual({ errors: [], warnings: [] });
      });

      it("hat die angegebene Zahl Stationen, jede mit GPS und QR innerhalb 250 m um den Sammelpunkt", async () => {
        const g = await info.load();
        expect(g.stations).toHaveLength(info.stations);
        for (const s of g.stations) {
          const types = s.triggers.map((t) => t.type);
          expect(types.includes("qr") || types.includes("manual"), s.id).toBe(true);
          expect(distanceM(g.field.assemblyPoint.location, stationPoint(s)!), s.id).toBeLessThanOrEqual(250);
        }
        expect(g.meta.night === true).toBe(info.night);
      });

      it("hat keine Platzhalter in eckigen Klammern", async () => {
        expect(JSON.stringify(await info.load())).not.toMatch(/\[[A-ZÄÖÜa-zäöü ]+\]/);
      });

      it("hat nach dem Assistenten mit Telefon keinen Fehler im Baukasten", async () => {
        const { game, meta } = wizard(await info.load());
        const errors = validateDraft(game, meta).filter((i) => i.severity === "error");
        expect(errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
      });

      it("ohne Telefon fehlt nur die Nummer der Spielleitung", async () => {
        const { game, meta } = wizard(await info.load(), { phone: "" });
        const errors = validateDraft(game, meta).filter((i) => i.severity === "error");
        expect(errors.map((e) => [e.at.section, e.at.path])).toEqual([["sicherheit", "/safety/emergency/gameMasterPhone"]]);
      });
    });
  }

  it("das leere Spiel startet ohne Hinweis auf eine ungenutzte Figur", async () => {
    const leer = TEMPLATES.find((t) => t.id === "leer")!;
    const { game, meta } = wizard(await leer.load());
    expect(validateDraft(game, meta).filter((i) => i.code === "character_silent")).toEqual([]);
  });

  it("das Beispiel „Sturmnacht“ lädt und zieht ebenfalls um", async () => {
    const { game } = wizard(await EXAMPLE_GAME());
    expect(game.field.assemblyPoint.location).toEqual(BONN);
    expect(game.$schema).toBeUndefined();
  });
});

describe("buildGame", () => {
  const escape = () => TEMPLATES.find((t) => t.id === "outdoor-escape")!.load();

  it("schreibt Titel, Kennung, Ort, Spielfeld und Zeit wie der Assistent", async () => {
    const { game } = wizard(await escape(), { title: "Agenten im Stadtpark", duration: 3600, limit: "per_team", placeName: "Parkeingang" });
    expect(game.id).toBe("agenten-im-stadtpark");
    expect(game.meta.title).toEqual({ de: "Agenten im Stadtpark" });
    expect(game.field.boundary).toEqual({ center: BONN, radius: 400 });
    expect(game.field.start).toEqual(BONN);
    expect(game.field.assemblyPoint).toMatchObject({ location: BONN, name: { de: "Parkeingang" } });
    expect(game.settings.time).toEqual({ limit: "per_team", duration: 3600 });
    expect(game.meta.expectedDuration).toBe(3600);
    for (const s of game.stations) expect(distanceM(BONN, stationPoint(s)!), s.id).toBeLessThan(400);
  });

  it("vergibt neue, eindeutige und zufällige Codes", async () => {
    const t = await escape();
    const a = wizard(t).game;
    const b = wizard(t).game;
    const qr = a.stations.flatMap((s) => s.triggers.filter((tr) => tr.type === "qr").map((tr) => (tr as { code: string }).code));
    expect(qr.length).toBe(5);
    for (const c of qr) expect(c).toMatch(QR);
    expect(new Set(allCodes(a)).size).toBe(allCodes(a).length);
    expect(allCodes(a)).not.toEqual(allCodes(t));
    expect(allCodes(a)).not.toEqual(allCodes(b));
  });

  it("Nachtspiel schaltet Schnelligkeitspunkte aus, Minderjährige die Betreuerpflicht an", async () => {
    const t = TEMPLATES.find((x) => x.id === "leer")!;
    const g = await t.load();
    g.safety.requireSupervisor = false;
    const { game } = wizard(g, { night: true, ageGroups: ["10-13"] });
    expect(game.settings.scoring?.speedBonus).toBe(false);
    expect(game.safety.requireSupervisor).toBe(true);
  });

  it("ohne Zeitlimit ohne Dauer; Kartenstil Standard wird nicht geschrieben", async () => {
    const kids = await TEMPLATES[0]!.load();
    const { game } = wizard(kids, { limit: "none", mapStyle: "standard" });
    expect(game.settings.time).toEqual({ limit: "none" });
    expect(game.settings.map).toBeUndefined();
  });

  it("merkt sich Orte und ortsbezogene Rätsel; Stationen am Sammelpunkt nicht", async () => {
    const info = TEMPLATES.find((t) => t.id === "outdoor-escape")!;
    const t = await info.load();
    const { game, meta } = buildGame(t, { ...defaultChoices(t), place: BONN, radius: 400, phone: "" }, { templateId: info.id, localTasks: info.localTasks });
    expect(Object.keys(meta.template!.stations)).toHaveLength(6);
    expect(meta.template!.stations.lager).toEqual(stationPoint(game.stations.find((s) => s.id === "lager")!));
    expect(Object.keys(meta.template!.tasks)).toEqual(["briefkasten"]);
    const empty = TEMPLATES.find((x) => x.id === "leer")!;
    const leer = buildGame(await empty.load(), { ...defaultChoices(await empty.load()), place: BONN, radius: 300 }, { templateId: "leer" });
    expect(leer.meta.template!.stations).toEqual({});
  });
});

describe("Prüfungen der Vorlage (Paket E)", () => {
  const issues = (g: Game, meta: EditorMeta, code: string) => CHECKS.flatMap((c) => c(g, meta, "de")).filter((i) => i.code === code);
  const setup = async () => {
    const info = TEMPLATES.find((t) => t.id === "outdoor-escape")!;
    const t = await info.load();
    return buildGame(t, { ...defaultChoices(t), place: BONN, radius: 400, phone: "+49 170 1234567" }, { templateId: info.id, localTasks: info.localTasks });
  };

  it("station_at_template: bis die Station verschoben oder vor Ort bestätigt ist", async () => {
    const { game, meta } = await setup();
    expect(issues(game, meta, "station_at_template").map((i) => i.at.objectId)).toEqual(["einsatz", "funkmast", "lager", "beobachter", "briefkasten", "finale"]);
    const funkmast = game.stations[1]!;
    funkmast.location = { lat: funkmast.location!.lat, lon: funkmast.location!.lon + 0.0014 };
    meta.onSite = { lager: { accuracy: 4, at: "2026-10-22T10:00:00Z" } };
    const left = issues(game, meta, "station_at_template");
    expect(left.map((i) => i.at.objectId)).toEqual(["einsatz", "beobachter", "briefkasten", "finale"]);
    expect(left[0]).toMatchObject({ severity: "warning", at: { section: "stationen", field: "location" } });
    expect(left[0]!.message).toContain("„Einsatzort“");
  });

  it("template_task_generic: verschwindet, sobald das Rätsel geändert ist", async () => {
    const { game, meta } = await setup();
    expect(issues(game, meta, "template_task_generic").map((i) => i.at.objectId)).toEqual(["briefkasten"]);
    const task = game.stations[4]!.task as { radius?: number };
    task.radius = 30;
    expect(issues(game, meta, "template_task_generic")).toEqual([]);
  });

  it("ohne Vorlage gibt es beide Warnungen nicht", async () => {
    const { game } = await setup();
    expect(issues(game, {}, "station_at_template")).toEqual([]);
    expect(issues(game, {}, "template_task_generic")).toEqual([]);
  });

  it("media_too_large: erst mit bekannten Größen über 50 MB", async () => {
    const { game } = await setup();
    game.media = [{ id: "film", type: "video", src: "media/a.mp4" }, { id: "ton", type: "audio", src: "media/b.wav" }];
    expect(issues(game, {}, "media_too_large")).toEqual([]);
    setMediaSizes([{ src: "media/a.mp4", size: 40 * 1024 * 1024 }, { src: "media/b.wav", size: 20 * 1024 * 1024 }]);
    const found = issues(game, {}, "media_too_large");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", at: { section: "medien" } });
    expect(found[0]!.message).toContain("60,0 MB");
    setMediaSizes([]);
  });
});

describe("Duplizieren", () => {
  it("neue Kennung, neuer Titel, neue Codes; Orte bleiben", async () => {
    const source = await EXAMPLE_GAME();
    const copy = duplicateGame(source, copyTitle(source));
    expect(copyTitle(source)).toBe("Sturmnacht: Das verschwundene Funkgerät (Kopie)");
    expect(copy.id).toBe("sturmnacht-das-verschwundene-funkgeraet-kopie");
    expect((copy.meta.title as Record<string, string>).en).toBe("Storm Night: The Missing Radio");
    expect(copy.stations.map((s) => s.location)).toEqual(source.stations.map((s) => s.location));
    const before = new Set(allCodes(source).filter((c) => !c.startsWith("lyk-")));
    for (const c of allCodes(copy)) if (!c.startsWith("lyk-")) expect(before.has(c)).toBe(false);
    expect(allCodes(copy)).toContain("lyk-baum");
  });

  it("renewCodes hält QR und Notfall-Codes spielweit eindeutig", async () => {
    const g = await TEMPLATES[1]!.load();
    renewCodes(g);
    const codes = allCodes(g);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
