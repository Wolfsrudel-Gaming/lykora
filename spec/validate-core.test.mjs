// Paket A: Tests für den Validator-Kern. Belegt (a) dass validateGame und der Kern dieselben Zeichenketten
// liefern wie spec/validate.mjs vor dem Umbau (spec/test-vectors/validator.json), (b) Pfade, Codes und
// Params der strukturierten Meldungen.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { validateGame } from "./validate.mjs";
import { checkReferences, createValidator, formatIssue, toLegacy } from "./validate-core.mjs";

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const detailed = createValidator({ "0.1": read("./v0.1/game.schema.json") });
const base = () => read("./v0.1/examples/testspiel.json");
const st = (g, id) => g.stations.find((s) => s.id === id);

// Fehlerkatalog des Baukastens: jede Funktion verändert das Beispielspiel oder liefert ein Ersatzspiel
// (null, Zeichenkette …). Erwartete Meldungen je Name stehen in test-vectors/validator.json.
const cases = {
  // --- vor dem Schema ---
  "Formatversion falsch": (g) => { g.format.version = "0.2"; },
  "Kein Objekt / leer": () => null,
  // --- Schema ---
  "Pflichtfeld fehlt (safety)": (g) => { delete g.safety; },
  "Pflichtfeld fehlt (Station name)": (g) => { delete g.stations[0].name; },
  "Unbekanntes Feld": (g) => { g.stations[0].colour = "rot"; },
  "format.name falsch": (g) => { g.format.name = "lykora"; },
  "ID-Muster (Großbuchstaben/Umlaut)": (g) => { g.stations[0].id = "Böse Station"; },
  "Sprachcode falsch": (g) => { g.meta.languages = ["Deutsch"]; },
  "Sprache doppelt": (g) => { g.meta.languages = ["de", "de"]; },
  "Keine Sprache": (g) => { g.meta.languages = []; },
  "Text: leeres Übersetzungsobjekt": (g) => { g.meta.title = {}; },
  "Text: falscher Sprachschlüssel": (g) => { g.meta.title = { deutsch: "Hallo" }; },
  "Text: Zahl statt Text": (g) => { g.stations[0].name = 5; },
  "Enum falsch (genre)": (g) => { g.meta.genre = "horror"; },
  "Typ falsch (scareLevel als Text)": (g) => { g.meta.scareLevel = "2"; },
  "Maximum (scareLevel 5)": (g) => { g.meta.scareLevel = 5; },
  "Minimum (teamSize.min 0)": (g) => { g.settings.teamSize.min = 0; },
  "Dauer negativ": (g) => { g.settings.time.duration = -1; },
  "Dauer keine ganze Zahl": (g) => { g.settings.time.duration = 90.5; },
  "Koordinate außerhalb (lat 95)": (g) => { g.stations[0].location.lat = 95; },
  "Radius 0 (GPS-Auslöser)": (g) => { g.stations[1].triggers[0].radius = 0; },
  "Keine Stationen": (g) => { g.stations = []; },
  "Station ohne Auslöser": (g) => { g.stations[0].triggers = []; },
  "QR-Auslöser ohne Code": (g) => { g.stations[0].triggers[1] = { type: "qr" }; },
  "QR-Code leer": (g) => { g.stations[0].triggers[1] = { type: "qr", code: "" }; },
  "Auslösertyp unbekannt": (g) => { g.stations[0].triggers[1] = { type: "wlan" }; },
  "BLE-UUID falsch": (g) => { g.stations[0].triggers[1] = { type: "ble", uuid: "123" }; },
  "Textaufgabe ohne Antworten": (g) => { delete st(g, "baum").task.answers; },
  "Antwort leer": (g) => { st(g, "baum").task.answers = [""]; },
  "Auswahl mit nur einer Option": (g) => { st(g, "briefing").task.options = st(g, "briefing").task.options.slice(0, 1); },
  "Option ohne correct": (g) => { delete st(g, "briefing").task.options[0].correct; },
  "Aufgabentyp unbekannt": (g) => { st(g, "baum").task = { type: "morse", question: "x" }; },
  "Fragmentwert leer": (g) => { g.fragments[0].value = ""; },
  "Fragmentposition 0": (g) => { g.fragments[0].position = 0; },
  "Dialog mit 4 Antworten": (g) => { const b = st(g, "schloss").scene.arrival[0]; b.responses = [1, 2, 3, 4].map((i) => ({ label: `A${i}` })); },
  "Takt-Art unbekannt": (g) => { st(g, "baum").scene.beats[0].kind = "video"; },
  "Polygon mit 2 Punkten": (g) => { g.field.restrictedZones[0].area.polygon = g.field.restrictedZones[0].area.polygon.slice(0, 2); },
  "Kreis mit Radius 0": (g) => { g.field.boundary.radius = 0; },
  "Sammelpunkt ohne Ort": (g) => { delete g.field.assemblyPoint.location; },
  "Telefonnummer falsch": (g) => { g.safety.emergency.gameMasterPhone = "Max"; },
  "Lautstärke > 1": (g) => { g.sound.ambience.volume = 1.5; },
  "Strafe ohne Typ": (g) => { g.settings.wrongAnswer = { amount: 30 }; },
  "Regel ohne Dann": (g) => { g.rules[0].then = []; },
  "Bedingung mit zwei Schlüsseln": (g) => { g.rules[0].when = [{ station_solved: "schloss", has_item: "zettel" }]; },
  "Aktion unbekannt": (g) => { g.rules[0].then = [{ teleport: "x" }]; },
  "Medium ohne src": (g) => { delete g.media[0].src; },
  "Medientyp falsch": (g) => { g.media[0].type = "sound"; },
  // --- Querverweise ---
  "Doppelte Stations-ID": (g) => { g.stations[1].id = "briefing"; },
  "Doppelte Figuren-ID": (g) => { g.characters[1].id = "zentrale"; },
  "Doppelte Fragment-ID": (g) => { g.fragments[1].id = "f1"; },
  "Doppelte Item-ID": (g) => { g.items[1].id = "uv-lampe"; },
  "Doppelte Medien-ID": (g) => { g.media[1].id = "wind"; },
  "Doppelte Kapitel-ID": (g) => { g.story.chapters[1].id = "kapitel-1"; },
  "Doppelte Regel-ID": (g) => { g.rules.push({ ...g.rules[0] }); },
  "Doppelte Sperrzonen-ID": (g) => { g.field.restrictedZones.push({ ...g.field.restrictedZones[0] }); },
  "Unbekannte Medien-ID (Intro)": (g) => { g.story.intro.media = ["gibtsnicht"]; },
  "Unbekannte Medien-ID (Zentrale-Avatar)": (g) => { g.story.hq.avatar = "gibtsnicht"; },
  "Unbekannte Medien-ID (Item-Bild)": (g) => { g.items[0].image = "gibtsnicht"; },
  "Unbekannte Medien-ID (Porträt)": (g) => { g.characters[1].portrait = "gibtsnicht"; },
  "Unbekannte Medien-ID (Aufgabe)": (g) => { st(g, "baum").task.media = ["gibtsnicht"]; },
  "Unbekannte Medien-ID (Takt-Bild)": (g) => { st(g, "baum").scene.beats[0].image = "gibtsnicht"; },
  "Klang zeigt auf Nicht-Audio": (g) => { g.media.push({ id: "bild", type: "image", src: "media/bild.jpg" }); st(g, "baum").sound.solved = "bild"; },
  "Klang unbekannt (Kapitel)": (g) => { g.story.chapters[2].ambience.audio = "gibtsnicht"; },
  "Unbekannte Figur": (g) => { st(g, "baum").scene.beats[0].speaker = "niemand"; },
  "Unbekanntes Item (Takt)": (g) => { st(g, "schloss").scene.beats[0].item = "gibtsnicht"; },
  "Unbekanntes Fragment (Belohnung)": (g) => { st(g, "baum").rewards.fragments = ["f99"]; },
  "Unbekanntes Item (Belohnung)": (g) => { st(g, "briefing").rewards.items = ["gibtsnicht"]; },
  "Unbekannte Station (reveal)": (g) => { st(g, "baum").rewards.reveal = ["gibtsnicht"]; },
  "Unbekanntes Kapitel (Belohnung)": (g) => { st(g, "briefing").rewards.chapter = "gibtsnicht"; },
  "Unbekannte Station (Regel wenn)": (g) => { g.rules[0].when[0].station_solved = "gibtsnicht"; },
  "Unbekanntes Item (Regel)": (g) => { g.rules[0].when.push({ has_item: "gibtsnicht" }); },
  "Unbekanntes Kapitel (Regel)": (g) => { g.rules[0].then.push({ start_chapter: "gibtsnicht" }); },
  "GPS ohne Ort": (g) => { delete st(g, "baum").location; },
  "Fragment-Lücke": (g) => { g.fragments[2].position = 4; },
  "Zwei Finale-Stationen": (g) => { st(g, "baum").final = true; },
  "Fragmente ohne Finale": (g) => { st(g, "finale").final = false; },
  "Warnung: versteckt ohne Freischaltung": (g) => { g.rules = []; },
  // --- NICHT erkannt (Editor muss selbst prüfen) ---
  "NICHT ERKANNT: keine Option richtig": (g) => { st(g, "briefing").task.options.forEach((o) => (o.correct = false)); },
  "NICHT ERKANNT: Fragment wird nie vergeben": (g) => { st(g, "versteck").rewards = {}; },
  "NICHT ERKANNT: Finalcode passt nicht zu Fragmenten": (g) => { st(g, "finale").task.answers = ["999"]; },
  "NICHT ERKANNT: QR-Code doppelt": (g) => { st(g, "schloss").triggers[1].code = "LYK-BRIEFING"; },
  "NICHT ERKANNT: Stationsname leer": (g) => { g.stations[0].name = ""; },
  "NICHT ERKANNT: Bild als Intro-Audio": (g) => { g.media.push({ id: "bild", type: "image", src: "media/bild.jpg" }); g.story.intro.media = ["bild"]; },
  "NICHT ERKANNT: Audio als Takt-Bild": (g) => { st(g, "baum").scene.beats[0].image = "wind"; },
  "NICHT ERKANNT: teamSize min > max": (g) => { g.settings.teamSize = { min: 6, max: 2 }; },
  "NICHT ERKANNT: Sammelpunkt außerhalb des Spielfelds": (g) => { g.field.assemblyPoint.location = { lat: 51, lon: 7 }; },
  "NICHT ERKANNT: doppelte Rettungspunkt-ID": (g) => { g.field.rescuePoints.push({ ...g.field.rescuePoints[0] }); },
  "NICHT ERKANNT: Code-Schloss mit Buchstaben": (g) => { st(g, "schloss").task.input = "lock"; st(g, "schloss").task.answers = ["ABC"]; },
  "NICHT ERKANNT: Zeitlimit ohne Dauer": (g) => { delete g.settings.time.duration; },
};

// Weitere kaputte und gültige Spiele: Zusammenfassen gleicher Texte, Sonst-Zweig, mehrere Lücken, Nicht-Objekte.
const extra = {
  "Kein Spiel: Zeichenkette": () => "x",
  "Kein Spiel: Liste": () => [],
  "Kein Spiel: leeres Objekt": () => ({}),
  "Nur das Format": () => ({ format: { name: "lykora-game", version: "0.1" } }),
  "Mehrere Schemafehler zugleich": (g) => { delete g.meta.title; st(g, "baum").sound.ambience.volume = 3; g.stations[2].id = "Schloss Nr. 1"; },
  "Gleiche Figur in zwei Takten (eine Meldung)": (g) => { st(g, "briefing").scene.beats[0].speaker = "niemand"; st(g, "briefing").scene.beats[1].speaker = "niemand"; },
  "Gleiche Figur in Ankunft und Takt (zwei Meldungen)": (g) => { st(g, "briefing").scene.arrival[0].speaker = "niemand"; st(g, "briefing").scene.beats[0].speaker = "niemand"; },
  "Fragment-Lücke mehrfach": (g) => { g.fragments[1].position = 3; g.fragments[2].position = 5; },
  "Drei Finale-Stationen": (g) => { st(g, "baum").final = true; st(g, "schloss").final = true; },
  "Versteckt mit Freischaltradius (keine Warnung)": (g) => { g.rules = []; st(g, "versteck").revealRadius = 40; },
  "Sonst-Zweig auf unbekannte Station": (g) => { g.rules[0].else = [{ reveal_station: "gibtsnicht" }]; },
  "Takt-Audio unbekannt": (g) => { st(g, "baum").scene.beats[0].audio = "gibtsnicht"; },
  "Takt-Geräusch kein Audio": (g) => { g.media.push({ id: "bild", type: "image", src: "media/bild.jpg" }); st(g, "baum").scene.beats[0].sfx = "bild"; },
  "Klang unbekannt (sound.ui)": (g) => { g.sound.ui.radio = "gibtsnicht"; },
  "Klang unbekannt (Annäherung)": (g) => { st(g, "finale").sound.approach.here = "gibtsnicht"; },
  "Klang unbekannt (Stations-Atmosphäre)": (g) => { st(g, "baum").sound.ambience.audio = "gibtsnicht"; },
  "Unbekannte Medien-ID (Outro)": (g) => { g.story.outro = { ...(g.story.outro ?? {}), media: ["gibtsnicht"] }; },
  "Unbekannte Medien-ID (Kapitel-Stück)": (g) => { g.story.chapters[0].piece = { ...(g.story.chapters[0].piece ?? {}), media: ["gibtsnicht"] }; },
  "Unbekannte Medien-ID (Item-Symbol)": (g) => { g.items[0].icon = "gibtsnicht"; },
  "Unbekannte Medien-ID (Stationsgeschichte)": (g) => { st(g, "baum").story = { ...(st(g, "baum").story ?? {}), media: ["gibtsnicht"] }; },
  "Querverweise an mehreren Stellen zugleich": (g) => { st(g, "baum").rewards.fragments = ["f99"]; g.rules[0].then[0].reveal_station = "nix"; st(g, "baum").scene.beats[0].speaker = "niemand"; },
  "GPS-Auslöser mit eigenem Ort (gültig)": (g) => { const s = st(g, "baum"); s.triggers[0].location = s.location; delete s.location; },
};

const alle = { ...cases, ...extra };
const gameOf = (mutate) => {
  const g = base();
  const r = mutate(g);
  return r === undefined ? g : r;
};

describe("Zeichenketten wie bisher", () => {
  const expected = read("./test-vectors/validator.json");
  const byName = new Map(expected.cases.map((c) => [c.name, c]));

  test("Testtabelle und validator.json nennen dieselben Fälle", () => {
    assert.deepEqual([...byName.keys()].sort(), Object.keys(alle).sort());
  });

  for (const [name, mutate] of Object.entries(alle)) {
    test(name, () => {
      const { errors, warnings } = byName.get(name);
      const game = gameOf(mutate);
      assert.deepEqual(validateGame(game), { errors, warnings });
      assert.deepEqual(toLegacy(detailed(game)), { errors, warnings });
    });
  }

  test("alle Beispiele sind gültig; Kern und validateGame stimmen überein", () => {
    const dirs = readdirSync(new URL("./", import.meta.url)).filter((d) => d.startsWith("v") && existsSync(new URL(`./${d}/examples`, import.meta.url)));
    const files = dirs.flatMap((d) => readdirSync(new URL(`./${d}/examples`, import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => `./${d}/examples/${f}`));
    assert.ok(files.length > 0);
    for (const f of files) {
      const game = read(f);
      const legacy = validateGame(game);
      assert.deepEqual(legacy.errors, [], f);
      assert.deepEqual(toLegacy(detailed(game)), legacy, f);
    }
  });
});

describe("Strukturierte Meldungen", () => {
  test("gültiges Spiel: ok, keine Schema- und Querverweisfehler", () => {
    const r = detailed(base());
    assert.equal(r.ok, true);
    assert.deepEqual(r.schema, []);
    assert.deepEqual(r.references, []);
  });

  test("unbekannte Formatversion: Pseudo-Meldung mit Pfad /format/version", () => {
    const g = base();
    g.format.version = "0.2";
    const r = detailed(g);
    assert.equal(r.ok, false);
    assert.deepEqual(r.schema, [{ kind: "schema", path: "/format/version", keyword: "formatVersion", message: "Unbekannte Formatversion „0.2“", params: { version: "0.2" }, schemaPath: "" }]);
    assert.equal(formatIssue(r.schema[0]), "Unbekannte Formatversion „0.2“");
    assert.equal(detailed(null).schema[0].params.version, undefined);
    // Nur eigene Schlüssel der Schema-Tabelle zählen, nicht Object.prototype.
    assert.equal(detailed({ format: { version: "constructor" } }).schema[0].keyword, "formatVersion");
  });

  test("Schemafehler: JSON-Pointer, Ajv-Keyword, Params und Schemapfad", () => {
    const g = base();
    delete g.meta.title;
    g.stations[0].colour = "rot";
    const { schema, references, ok } = detailed(g);
    assert.equal(ok, false);
    assert.deepEqual(references, [], "Querverweise erst, wenn das Schema passt");
    const title = schema.find((i) => i.keyword === "required" && i.path === "/meta");
    assert.equal(title.kind, "schema");
    assert.equal(title.params.missingProperty, "title");
    assert.match(title.schemaPath, /^#\//);
    assert.equal(formatIssue(title), "/meta must have required property 'title'");
    const colour = schema.find((i) => i.keyword === "additionalProperties" && i.path === "/stations/0");
    assert.equal(colour.params.additionalProperty, "colour");
    const root = detailed({ format: { name: "lykora-game", version: "0.1" } }).schema[0];
    assert.equal(root.path, "");
    assert.match(formatIssue(root), /^\/ must have required property/);
  });

  test("Querverweise: Pfade mit Listenplätzen, Codes und Params", () => {
    const g = base();
    st(g, "baum").rewards.fragments = ["f99"];
    st(g, "briefing").rewards.items = ["nix"];
    st(g, "baum").rewards.reveal = ["nirgends"];
    st(g, "briefing").rewards.chapter = "kap-0";
    g.rules[0].then[0].reveal_station = "nix";
    g.rules[0].else = [{ give_item: "nix" }, { start_chapter: "kap-0" }];
    g.rules[0].when.push({ has_item: "nix" });
    st(g, "baum").scene.beats[0].speaker = "niemand";
    st(g, "schloss").scene.beats[0].item = "nix";
    g.items[0].image = "bild-fehlt";
    g.story.hq.avatar = "bild-fehlt";
    const r = detailed(g);
    assert.equal(r.ok, false);
    assert.deepEqual(r.schema, []);
    const got = r.references.map((i) => [i.code, i.path, i.where, i.params]);
    assert.deepEqual(got, [
      ["unknown_media", "/story/hq/avatar", "story.hq.avatar", { id: "bild-fehlt", kind: "Medien-ID" }],
      ["unknown_media", "/items/0/image", "items[uv-lampe].image", { id: "bild-fehlt", kind: "Medien-ID" }],
      ["unknown_item", "/stations/0/rewards/items/0", "stations[briefing].rewards", { id: "nix", kind: "Item-ID" }],
      ["unknown_chapter", "/stations/0/rewards/chapter", "stations[briefing].rewards", { id: "kap-0", kind: "Kapitel-ID" }],
      ["unknown_character", "/stations/1/scene/beats/0/speaker", "stations[baum].scene.beats", { id: "niemand", kind: "Figur" }],
      ["unknown_fragment", "/stations/1/rewards/fragments/0", "stations[baum].rewards", { id: "f99", kind: "Fragment-ID" }],
      ["unknown_station", "/stations/1/rewards/reveal/0", "stations[baum].rewards", { id: "nirgends", kind: "Stations-ID" }],
      ["unknown_item", "/stations/2/scene/beats/0/item", "stations[schloss].scene.beats", { id: "nix", kind: "Item-ID" }],
      ["unknown_item", "/rules/0/when/1/has_item", "rules[versteck-freischalten]", { id: "nix", kind: "Item-ID" }],
      ["unknown_station", "/rules/0/then/0/reveal_station", "rules[versteck-freischalten]", { id: "nix", kind: "Stations-ID" }],
      ["unknown_item", "/rules/0/else/0/give_item", "rules[versteck-freischalten]", { id: "nix", kind: "Item-ID" }],
      ["unknown_chapter", "/rules/0/else/1/start_chapter", "rules[versteck-freischalten]", { id: "kap-0", kind: "Kapitel-ID" }],
    ]);
    for (const i of r.references) assert.equal(i.kind, "reference");
  });

  test("Klänge: unbekannt oder kein Audio, Pfad bis zum Feld", () => {
    const g = base();
    g.media.push({ id: "bild", type: "image", src: "media/bild.jpg" });
    g.sound.ui.radio = "fehlt";
    st(g, "baum").sound.solved = "bild";
    st(g, "finale").sound.approach.here = "bild";
    st(g, "baum").scene.beats[0].sfx = "fehlt";
    g.story.chapters[2].ambience.audio = "bild";
    const got = detailed(g).references.map((i) => [i.code, i.path, i.params]);
    assert.deepEqual(got, [
      ["unknown_media", "/sound/ui/radio", { id: "fehlt", kind: "Medien-ID", audio: true }],
      ["not_audio", "/story/chapters/2/ambience/audio", { id: "bild", type: "image" }],
      ["unknown_media", "/stations/1/scene/beats/0/sfx", { id: "fehlt", kind: "Medien-ID", audio: true }],
      ["not_audio", "/stations/1/sound/solved", { id: "bild", type: "image" }],
      ["not_audio", "/stations/4/sound/approach/here", { id: "bild", type: "image" }],
    ]);
  });

  test("doppelte ID zeigt auf das zweite Vorkommen", () => {
    const g = base();
    g.stations[1].id = "briefing";
    g.fragments[2].id = "f1";
    const got = detailed(g).references.map((i) => [i.code, i.path, i.where, i.params]);
    assert.deepEqual(got, [
      ["duplicate_id", "/stations/1/id", "stations", { id: "briefing", list: "stations" }],
      ["duplicate_id", "/fragments/2/id", "fragments", { id: "f1", list: "fragments" }],
      // Das umbenannte f3 fehlt jetzt als Belohnung.
      ["unknown_fragment", "/stations/3/rewards/fragments/0", "stations[versteck].rewards", { id: "f3", kind: "Fragment-ID" }],
    ]);
  });

  test("GPS ohne Ort, Fragment-Lücke, mehrere Finale, Fragmente ohne Finale", () => {
    const g = base();
    delete st(g, "baum").location;
    g.fragments[1].position = 3;
    g.fragments[2].position = 5;
    st(g, "baum").final = true;
    const got = detailed(g).references.map((i) => [i.code, i.path, i.params]);
    assert.deepEqual(got, [
      ["gps_without_location", "/stations/1/location", { station: "baum" }],
      ["fragment_gap", "/fragments", { positions: [1, 3, 5] }],
      ["multiple_finals", "/stations/4/final", { stations: ["baum", "finale"] }],
    ]);
    const h = base();
    st(h, "finale").final = false;
    assert.deepEqual(detailed(h).references.map((i) => [i.code, i.path]), [["fragments_without_final", "/stations"]]);
  });

  test("versteckte Station ohne Freischaltung ist eine Warnung, kein Fehler", () => {
    const g = base();
    g.rules = [];
    const r = detailed(g);
    assert.equal(r.ok, true);
    assert.deepEqual(r.references, []);
    assert.deepEqual(r.warnings.map((i) => [i.kind, i.code, i.path, i.where, i.params]), [["reference", "hidden_unreachable", "/stations/3/visibility", "stations[versteck]", { station: "versteck" }]]);
    assert.equal(formatIssue(r.warnings[0]), "stations[versteck]: versteckt, aber nichts schaltet sie frei (nur durch die Spielleitung erreichbar)");
    st(g, "versteck").revealRadius = 40;
    assert.deepEqual(detailed(g).warnings, []);
  });

  test("toLegacy fasst gleiche Texte zusammen, der Kern behält jede Stelle", () => {
    const g = base();
    st(g, "briefing").scene.beats[0].speaker = "niemand";
    st(g, "briefing").scene.beats[1].speaker = "niemand";
    const r = detailed(g);
    assert.deepEqual(r.references.map((i) => i.path), ["/stations/0/scene/beats/0/speaker", "/stations/0/scene/beats/1/speaker"]);
    assert.deepEqual(toLegacy(r).errors, ["stations[briefing].scene.beats: unbekannte Figur „niemand“"]);
  });

  test("checkReferences wirft nicht bei unvollständigen Entwürfen", () => {
    assert.deepEqual(checkReferences(null), { errors: [], warnings: [] });
    assert.deepEqual(checkReferences("x"), { errors: [], warnings: [] });
    const draft = {
      stations: [{ id: "a" }, { id: "a", triggers: "kaputt", rewards: { fragments: "x" } }, null],
      rules: [{ id: "r", when: null }, { id: "r2", then: [null, { reveal_station: "weg" }] }],
      fragments: [{}],
      sound: { ui: { "a/b": "fehlt" } },
    };
    const { errors, warnings } = checkReferences(draft);
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors.map((i) => [i.code, i.path]), [
      ["duplicate_id", "/stations/1/id"],
      ["unknown_media", "/sound/ui/a~1b"],
      ["unknown_station", "/rules/1/then/1/reveal_station"],
      ["fragment_gap", "/fragments"],
      ["fragments_without_final", "/stations"],
    ]);
  });

  test("der Kern lädt kein Node-Modul", () => {
    const src = readFileSync(new URL("./validate-core.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(src, /["']node:|\bprocess\b|\brequire\(/);
    assert.deepEqual([...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]), ["ajv/dist/2020.js"]);
  });
});
