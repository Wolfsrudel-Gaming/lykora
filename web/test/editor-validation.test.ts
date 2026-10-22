import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EditorIssue, Game } from "../src/lib/editor/types.ts";
import { addressOf, countsBySection, describeField, describeWhere, issuesAt, pointerOf, validateDraft } from "../src/lib/editor/validation.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
type Loose = Record<string, any>;
/** Station ohne enge Typen: die Fälle verbiegen absichtlich Rätsel und Auslöser. */
const st = (g: Game, id: string): Loose => g.stations.find((s) => s.id === id)!;

const key = (i: EditorIssue) => `${i.code}|${i.at.path}`;
/** Meldungen, die der Fall neu erzeugt (das Beispielspiel hat selbst eine: NFC-Wert „lyk-baum“ ist keine UID). */
function fresh(game: Game | null, severity: EditorIssue["severity"] = "error") {
  const base = new Set(validateDraft(load(), {}).map(key));
  return validateDraft(game as Game, {}).filter((i) => i.severity === severity && !base.has(key(i)));
}

/**
 * Fälle aus fehlerkatalog.mjs: je Problem genau eine Meldung mit erwartetem Code und Adresse.
 * Ein paar Fälle reißen echte Folgeprobleme auf (ohne Stationen vergibt niemand mehr ein Codeteil);
 * die stehen als fünftes Glied dabei und werden mitgeprüft.
 */
const CASES: [string, (g: Loose) => void, string, Partial<EditorIssue["at"]>, string[]?][] = [
  ["Formatversion falsch", (g) => (g.format.version = "0.2"), "formatVersion", { section: "einstellungen", field: "format.version" }],
  ["Pflichtfeld fehlt (safety)", (g) => delete g.safety, "required", { section: "sicherheit", field: "safety" }],
  ["Pflichtfeld fehlt (Station name)", (g) => delete g.stations[0].name, "required", { section: "stationen", objectId: "briefing", field: "name" }],
  ["Unbekanntes Feld", (g) => (g.stations[0].colour = "rot"), "additionalProperties", { objectId: "briefing" }],
  ["format.name falsch", (g) => (g.format.name = "lykora"), "const", { field: "format.name" }],
  ["ID-Muster", (g) => (g.stations[0].id = "Böse Station"), "pattern", { objectId: "Böse Station", field: "id" }],
  ["Sprachcode falsch", (g) => (g.meta.languages = ["Deutsch"]), "pattern", { section: "einstellungen", field: "meta.languages.0" }],
  ["Sprache doppelt", (g) => (g.meta.languages = ["de", "de"]), "uniqueItems", { field: "meta.languages" }],
  ["Keine Sprache", (g) => (g.meta.languages = []), "minItems", { field: "meta.languages" }],
  ["Text: leeres Übersetzungsobjekt", (g) => (g.meta.title = {}), "minProperties", { section: "geschichte", field: "meta.title" }],
  ["Text: falscher Sprachschlüssel", (g) => (g.meta.title = { deutsch: "Hallo" }), "propertyNames", { field: "meta.title" }],
  ["Text: Zahl statt Text", (g) => (g.stations[0].name = 5), "unknown_variant", { objectId: "briefing", field: "name" }],
  ["Enum falsch", (g) => (g.meta.genre = "horror"), "enum", { field: "meta.genre" }],
  ["Typ falsch", (g) => (g.meta.scareLevel = "2"), "type", { field: "meta.scareLevel" }],
  ["Maximum", (g) => (g.meta.scareLevel = 5), "maximum", { field: "meta.scareLevel" }],
  ["Minimum", (g) => (g.settings.teamSize.min = 0), "minimum", { section: "einstellungen", field: "settings.teamSize.min" }],
  ["Dauer keine ganze Zahl", (g) => (g.settings.time.duration = 90.5), "type", { field: "settings.time.duration" }],
  ["Koordinate außerhalb", (g) => (g.stations[0].location.lat = 95), "maximum", { objectId: "briefing", field: "location.lat" }],
  ["Radius 0 (GPS)", (g) => (g.stations[1].triggers[0].radius = 0), "exclusiveMinimum", { objectId: "baum", field: "triggers.0.radius" }],
  ["Keine Stationen", (g) => (g.stations = []), "minItems", { section: "karte", field: "stations" }, ["fragment_unassigned", "fragment_unassigned", "fragment_unassigned", "unknown_station", "unknown_station"]],
  ["Station ohne Auslöser", (g) => (g.stations[0].triggers = []), "minItems", { objectId: "briefing", field: "triggers" }],
  ["QR-Auslöser ohne Code", (g) => (g.stations[0].triggers[1] = { type: "qr" }), "required", { objectId: "briefing", field: "triggers.1.code" }],
  ["QR-Code leer", (g) => (g.stations[0].triggers[1] = { type: "qr", code: "" }), "minLength", { field: "triggers.1.code" }],
  ["Auslösertyp unbekannt", (g) => (g.stations[0].triggers[1] = { type: "wlan" }), "unknown_variant", { field: "triggers.1" }],
  ["BLE-UUID falsch", (g) => (g.stations[0].triggers[1] = { type: "ble", uuid: "123" }), "pattern", { field: "triggers.1.uuid" }],
  ["Textaufgabe ohne Antworten", (g) => delete st(g as Game, "baum").task!.answers, "required", { objectId: "baum", field: "task.answers" }],
  ["Antwort leer", (g) => (st(g as Game, "baum").task!.answers = [""]), "minLength", { field: "task.answers.0" }],
  ["Auswahl mit nur einer Option", (g) => (st(g as Game, "briefing").task!.options = st(g as Game, "briefing").task!.options.slice(0, 1)), "minItems", { field: "task.options" }],
  ["Option ohne correct", (g) => delete st(g as Game, "briefing").task!.options[0].correct, "required", { field: "task.options.0.correct" }],
  ["Aufgabentyp unbekannt", (g) => (st(g as Game, "baum").task = { type: "morse", question: "x" }), "unknown_variant", { objectId: "baum", field: "task" }],
  ["Fragmentwert leer", (g) => (g.fragments[0].value = ""), "minLength", { section: "belohnungen", objectId: "f1", field: "value" }],
  ["Fragmentposition 0", (g) => (g.fragments[0].position = 0), "minimum", { objectId: "f1", field: "position" }],
  ["Dialog mit 4 Antworten", (g) => (st(g as Game, "schloss").scene!.arrival![0]!.responses = [1, 2, 3, 4].map((i) => ({ label: `A${i}` }))), "maxItems", { field: "scene.arrival.0.responses" }],
  ["Takt-Art unbekannt", (g) => (st(g as Game, "baum").scene!.beats![0]!.kind = "video"), "enum", { field: "scene.beats.0.kind" }],
  ["Polygon mit 2 Punkten", (g) => (g.field.restrictedZones[0].area.polygon = g.field.restrictedZones[0].area.polygon.slice(0, 2)), "minItems", { section: "karte", objectId: "strasse", field: "area.polygon" }],
  ["Kreis mit Radius 0", (g) => (g.field.boundary.radius = 0), "exclusiveMinimum", { section: "karte", field: "field.boundary.radius" }],
  ["Sammelpunkt ohne Ort", (g) => delete g.field.assemblyPoint.location, "required", { field: "field.assemblyPoint.location" }],
  ["Telefonnummer falsch", (g) => (g.safety.emergency.gameMasterPhone = "Max"), "pattern", { section: "sicherheit", field: "safety.emergency.gameMasterPhone" }],
  ["Lautstärke > 1", (g) => (g.sound.ambience.volume = 1.5), "maximum", { section: "klang", field: "sound.ambience.volume" }],
  ["Strafe ohne Typ", (g) => (g.settings.wrongAnswer = { amount: 30 }), "required", { field: "settings.wrongAnswer.type" }],
  ["Regel ohne Dann", (g) => (g.rules[0].then = []), "minItems", { section: "regeln", objectId: "versteck-freischalten", field: "then" }],
  ["Bedingung mit zwei Schlüsseln", (g) => (g.rules[0].when = [{ station_solved: "schloss", has_item: "zettel" }]), "unknown_variant", { field: "when.0" }],
  ["Aktion unbekannt", (g) => (g.rules[0].then = [{ teleport: "x" }]), "unknown_variant", { field: "then.0" }],
  ["Medium ohne src", (g) => delete g.media[0].src, "required", { section: "medien", objectId: "wind", field: "src" }],
  ["Medientyp falsch", (g) => (g.media[0].type = "sound"), "enum", { objectId: "wind", field: "type" }, ["not_audio"]],
  ["Doppelte Stations-ID", (g) => (g.stations[1].id = "briefing"), "duplicate_id", { section: "stationen", objectId: "briefing", field: "id" }],
  ["Doppelte Regel-ID", (g) => g.rules.push({ ...g.rules[0] }), "duplicate_id", { section: "regeln" }],
  ["Doppelte Sperrzonen-ID", (g) => g.field.restrictedZones.push({ ...g.field.restrictedZones[0] }), "duplicate_id", { section: "karte" }],
  ["Unbekannte Medien-ID (Intro)", (g) => (g.story.intro.media = ["gibtsnicht"]), "unknown_media", { section: "geschichte", field: "story.intro.media.0" }],
  ["Unbekannte Medien-ID (Takt-Bild)", (g) => (st(g as Game, "baum").scene!.beats![0]!.image = "gibtsnicht"), "unknown_media", { objectId: "baum", field: "scene.beats.0.image" }],
  ["Klang zeigt auf Nicht-Audio", (g) => { g.media.push({ id: "bild", type: "image", src: "m.jpg" }); st(g as Game, "baum").sound!.solved = "bild"; }, "not_audio", { objectId: "baum", field: "sound.solved" }],
  ["Unbekannte Figur", (g) => (st(g as Game, "baum").scene!.beats![0]!.speaker = "niemand"), "unknown_character", { field: "scene.beats.0.speaker" }],
  ["Unbekanntes Fragment", (g) => (st(g as Game, "baum").rewards!.fragments = ["f99"]), "unknown_fragment", { field: "rewards.fragments.0" }, ["fragment_unassigned"]],
  ["Unbekannte Station (reveal)", (g) => (st(g as Game, "baum").rewards!.reveal = ["gibtsnicht"]), "unknown_station", { field: "rewards.reveal.0" }],
  ["Unbekanntes Kapitel (Regel)", (g) => g.rules[0].then.push({ start_chapter: "gibtsnicht" }), "unknown_chapter", { objectId: "versteck-freischalten", field: "then.2.start_chapter" }],
  ["GPS ohne Ort", (g) => delete st(g as Game, "baum").location, "gps_without_location", { objectId: "baum", field: "location" }],
  ["Fragment-Lücke", (g) => (g.fragments[2].position = 4), "fragment_gap", { section: "belohnungen", field: "fragments" }],
  ["Zwei Finale-Stationen", (g) => (st(g as Game, "baum").final = true), "multiple_finals", { objectId: "finale", field: "final" }],
  ["Fragmente ohne Finale", (g) => (st(g as Game, "finale").final = false), "fragments_without_final", { section: "karte" }],
];

describe("Prüfung des Entwurfs: je Problem eine Meldung", () => {
  for (const [name, mutate, code, at, extras = []] of CASES) {
    it(name, () => {
      const g = load() as Loose;
      mutate(g);
      const issues = fresh(g as Game);
      expect(issues.map((i) => `${i.code} ${i.at.path}`)).toHaveLength(1 + extras.length);
      const issue = issues.find((i) => i.code === code)!;
      expect(issue, `Meldung ${code}`).toBeDefined();
      expect(issues.filter((i) => i !== issue).map((i) => i.code).sort()).toEqual([...extras].sort());
      expect(issue.at).toMatchObject(at);
      for (const i of issues) {
        expect(i.message).not.toMatch(/^must |^\/|\bmust\b/);
        expect(i.message).toMatch(/[.!?]$/);
        expect(i.dismissable).toBe(false);
      }
    });
  }

  it("Kein Objekt: eine Meldung zur Formatversion, nichts stürzt ab", () => {
    const issues = validateDraft(null as unknown as Game, {});
    expect(issues.map((i) => i.code)).toEqual(["formatVersion"]);
    expect(issues[0]!.message).toContain("Version unbekannt");
    expect(validateDraft({} as Game, {}).map((i) => i.code)).toEqual(["formatVersion"]);
  });

  it("Warnung: versteckt ohne Freischaltung ist ausblendbar", () => {
    const g = load();
    g.rules = [];
    const w = fresh(g, "warning");
    expect(w.map((i) => i.code)).toEqual(["hidden_unreachable"]);
    expect(w[0]!).toMatchObject({ at: { objectId: "versteck", field: "visibility" }, dismissable: true, source: "reference" });
    expect(w[0]!.message).toContain("„Das Versteck“");
  });

  it("verschluckt unter einem Schemafehler keine zweite Meldung und meldet dennoch Querverweise", () => {
    const g = load() as Loose;
    g.safety.emergency.gameMasterPhone = "";
    st(g as Game, "baum").rewards!.fragments = ["f99"];
    const codes = fresh(g as Game).map((i) => i.code).sort();
    // f1 vergibt danach niemand mehr – das ist ein echtes zweites Problem.
    expect(codes).toEqual(["fragment_unassigned", "pattern", "unknown_fragment"]);
  });

  it("Baukasten-Prüfungen laufen auch bei Schemafehlern", () => {
    const g = load() as Loose;
    delete g.safety;
    st(g as Game, "briefing").task = { type: "choice", question: { de: "?" }, options: [{ text: { de: "a" }, correct: false }, { text: { de: "b" }, correct: false }] };
    expect(fresh(g as Game).map((i) => i.code).sort()).toEqual(["choice_no_correct", "required"]);
  });

  it("Meldungen des Beispielspiels", () => {
    const issues = validateDraft(load(), {});
    expect(issues.filter((i) => i.severity === "error").map(key)).toEqual(["nfc_not_uid|/stations/1/triggers/1/tag"]);
    expect(issues.map((i) => i.code)).toContain("languages_extra");
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Adressen", () => {
  const g = load();

  it("rechnet Pointer in Feldadressen um", () => {
    expect(addressOf("/stations/1/task/answers/0", g)).toEqual({ section: "stationen", objectId: "baum", field: "task.answers.0", path: "/stations/1/task/answers/0" });
    expect(addressOf("/stations/1", g)).toEqual({ section: "stationen", objectId: "baum", path: "/stations/1" });
    expect(addressOf("/stations", g)).toEqual({ section: "karte", field: "stations", path: "/stations" });
    expect(addressOf("/meta/languages", g)).toMatchObject({ section: "einstellungen", field: "meta.languages" });
    expect(addressOf("/meta/title", g)).toMatchObject({ section: "geschichte", field: "meta.title" });
    expect(addressOf("/field/restrictedZones/0/area/polygon/1/lat", g)).toMatchObject({ section: "karte", objectId: "strasse", field: "area.polygon.1.lat" });
    expect(addressOf("/field/rescuePoints/0/name", g)).toMatchObject({ section: "sicherheit", field: "field.rescuePoints.0.name" });
    expect(addressOf("/story/chapters/2/ambience/audio", g)).toMatchObject({ section: "geschichte", objectId: "kapitel-3", field: "ambience.audio" });
    expect(addressOf("/rules/0/then/1/message/text", g)).toMatchObject({ section: "regeln", objectId: "versteck-freischalten", field: "then.1.message.text" });
    expect(addressOf("/media/0/src", g)).toMatchObject({ section: "medien", objectId: "wind", field: "src" });
    expect(addressOf("/sound/ui/radio", g)).toMatchObject({ section: "klang", field: "sound.ui.radio" });
    expect(addressOf("", g)).toEqual({ section: "einstellungen", path: "" });
    expect(addressOf("/stations/9/name", g)).toMatchObject({ objectId: "#9", field: "name" });
  });

  it("findet den Pointer nach dem Umsortieren wieder", () => {
    const a = addressOf("/stations/1/task/answers/0", g);
    const moved = structuredClone(g);
    moved.stations.reverse();
    expect(pointerOf(a, moved)).toBe("/stations/3/task/answers/0");
    expect(pointerOf(a, g)).toBe("/stations/1/task/answers/0");
    expect(pointerOf(addressOf("/meta/title", g), g)).toBe("/meta/title");
    expect(pointerOf({ section: "stationen", objectId: "weg", field: "name", path: "/stations/7/name" }, g)).toBeNull();
    expect(pointerOf({ section: "stationen", objectId: "#2", field: "name", path: "/stations/2/name" }, g)).toBe("/stations/2/name");
    expect(pointerOf(addressOf("", g), g)).toBe("");
  });

  it("beschreibt Orte ohne IDs", () => {
    expect(describeWhere(addressOf("/stations/1/scene/beats/0/audio", g), g)).toBe("Station „Der alte Baum“ › Szene › Takt 1 › Klang");
    expect(describeWhere(addressOf("/settings/teamSize/min", g), g)).toBe("Grundregeln › Teamgröße › Mindestens");
    expect(describeWhere(addressOf("/fragments/1", g), g)).toBe("Codeteil „Teil 2“");
    expect(describeWhere(addressOf("", g), g)).toBe("Spiel");
    expect(describeField("task.answers.0")).toBe("Aufgabe › Antwort 1");
  });
});

describe("Zähler und Feldfilter", () => {
  it("zählt je Bereich und lässt ausgeblendete weg", () => {
    const g = load();
    g.rules = [];
    const issues = validateDraft(g, {});
    const counts = countsBySection(issues, []);
    expect(counts.stationen.errors).toBe(1);
    expect(counts.stationen.warnings).toBeGreaterThanOrEqual(1);
    expect(counts.veroeffentlichen).toEqual({ errors: 0, warnings: 0 });
    const hidden = issues.find((i) => i.code === "hidden_unreachable")!;
    expect(countsBySection(issues, [hidden.id]).stationen.warnings).toBe(counts.stationen.warnings - 1);
  });

  it("findet Meldungen am Feld und darunter", () => {
    const g = load();
    // Nur Leerzeichen besteht das Schema (minLength 1), der Baukasten meldet es.
    g.stations[1]!.task = { type: "text", question: { de: "?" }, answers: ["  ", "x"] };
    const issues = validateDraft(g, {});
    expect(issuesAt(issues, "/stations/1/task/answers/0").map((i) => i.code)).toEqual(["empty_answer"]);
    expect(issuesAt(issues, "/stations/1/task").map((i) => i.code)).toContain("empty_answer");
    expect(issuesAt(issues, { section: "stationen", objectId: "baum", field: "task", path: "" }).map((i) => i.code)).toContain("empty_answer");
    expect(issuesAt(issues, { section: "stationen", objectId: "baum", path: "" }).length).toBeGreaterThan(1);
    expect(issuesAt(issues, { section: "stationen", objectId: "schloss", field: "task", path: "" })).toEqual([]);
    expect(issuesAt(issues, "")).toBe(issues);
  });
});
