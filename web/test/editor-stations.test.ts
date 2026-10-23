import { readFileSync } from "node:fs";
import { validateGame } from "@lykora/spec";
import { describe, expect, it } from "vitest";
import { finalCode, finalStation, isCoupled } from "../src/lib/editor/fragments.ts";
import { allCodes } from "../src/lib/editor/ids.ts";
import {
  addFragment,
  BEAT_FIELDS,
  BEAT_KINDS,
  convertStoryToScene,
  newBeat,
  newStation,
  newTask,
  newTrigger,
  parseCoordinates,
  revealers,
  setFinal,
  setVisibility,
  STATION_KINDS,
  switchBeatKind,
  switchTaskType,
  TASK_TYPES,
  TRIGGER_TYPES,
  visibilityMode,
  type Beat,
  type StationKind,
  type Task,
  type TaskType,
} from "../src/lib/editor/stations.ts";
import type { Game, Station } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
const st = (g: Game, id: string) => g.stations.find((s) => s.id === id)!;
/** Das Beispielspiel ohne den NFC-Text-Tag (nfc_not_uid ist hier nicht Thema). */
const base = () => {
  const g = load();
  st(g, "baum").triggers[1] = { type: "nfc", tag: "04:A1:B2:C3:D4:E5:F6" };
  return g;
};
const additional = (g: Game) => validateGame(g).errors.filter((e) => /additional/.test(e));
const here = { lat: 50.816, lon: 7.1565 };

/** Rätsel jeder Art mit allen Feldern, die das Format kennt. */
const FULL: Record<TaskType, Task> = {
  text: { type: "text", question: { de: "Welches Tier?" }, answers: ["Eule"], match: { ignoreCase: false, maxTypos: 2 }, manualReview: true, media: ["wind"] },
  code: { type: "code", question: { de: "Welcher Code?" }, input: "lock", answers: ["372"], media: ["wind"] },
  choice: { type: "choice", question: { de: "Was stimmt?" }, options: [{ text: { de: "A" }, correct: true }, { text: { de: "B" }, correct: false }], shuffle: false, media: ["wind"] },
  photo: { type: "photo", prompt: { de: "Macht ein Foto." }, video: true, review: "vote" },
  find_location: { type: "find_location", prompt: { de: "Findet die Eiche." }, location: here, radius: 15 },
};

/** Pflichtfelder auffüllen, die ein frisch gewechseltes Rätsel noch leer lässt. */
function complete(task: Task): Task {
  const t = structuredClone(task) as Record<string, any>;
  if (Array.isArray(t.answers) && !t.answers.length) t.answers = ["42"];
  if (Array.isArray(t.options)) t.options.forEach((o: Record<string, any>, i: number) => (o.text = { de: `Option ${i + 1}` }));
  return t as Task;
}

describe("newStation", () => {
  it("legt GPS 20 m, QR-Code und Notfall-Code an, Kennung aus dem Namen", () => {
    const g = base();
    const s = newStation("raetsel", "Die Brücke", g);
    expect(s.id).toBe("die-bruecke");
    expect(s.name).toEqual({ de: "Die Brücke" });
    expect(s.triggers.map((t) => t.type)).toEqual(["gps", "qr", "manual"]);
    expect(s.triggers[0]).toEqual({ type: "gps", radius: 20 });
    const qr = s.triggers[1] as { code: string };
    const manual = s.triggers[2] as { code: string };
    expect(qr.code).toMatch(/^LYK-[A-HJ-NP-Z2-9]{4}$/);
    expect(manual.code).toMatch(/^\d{4}$/);
    expect(allCodes(g)).not.toContain(qr.code);
    expect(allCodes(g)).not.toContain(manual.code);
  });

  it("erzeugt eindeutige Kennungen und Codes auch bei vielen Stationen", () => {
    const g = base();
    for (let i = 0; i < 60; i++) g.stations.push(newStation("raetsel", "Baum", g));
    const ids = g.stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("baum-2");
    const codes = allCodes(g);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("jeder Baustein ergibt eine schema-gültige Station ohne fremde Felder", () => {
    for (const kind of Object.keys(STATION_KINDS) as StationKind[]) {
      const g = base();
      const s = newStation(kind, "", g, { location: here });
      if (s.task) s.task = complete(s.task);
      g.stations.splice(1, 0, s);
      expect(validateGame(g).errors, kind).toEqual([]);
    }
  });

  it("Finale nur, wenn es noch keines gibt; die Antwort ist der Finalcode", () => {
    const g = base();
    const second = newStation("finale", "Noch ein Ziel", g);
    expect(second.final).toBeUndefined();
    expect(second.task).toMatchObject({ type: "code", answers: ["191"] });
    st(g, "finale").final = false;
    expect(newStation("finale", "Ziel", g).final).toBe(true);
  });

  it("Erzähl-Station hat eine Szene und eine Bereit-Frage, damit sie als gelöst gilt", () => {
    const s = newStation("erzaehl", "Der Brunnen", base());
    expect(s.scene?.arrival?.[0]?.kind).toBe("narration");
    expect(s.task).toMatchObject({ type: "choice", options: [{ correct: true }, { correct: false }] });
  });
});

describe("Auslöser", () => {
  it("newTrigger liefert für jede Art ein Objekt nur mit ihren Feldern", () => {
    const g = base();
    for (const type of TRIGGER_TYPES) {
      const t = newTrigger(type, g);
      expect(t.type).toBe(type);
      const copy = base();
      // Pflichtwerte für die Schema-Prüfung füllen
      const filled = { ...t, ...(type === "nfc" ? { tag: "04A1B2C3" } : {}), ...(type === "ble" ? { uuid: "f7826da6-4fa2-4e98-8024-bc5b71e0893e" } : {}), ...(type === "box" ? { box: "box-1" } : {}) };
      st(copy, "schloss").triggers = [filled];
      expect(validateGame(copy).errors, type).toEqual([]);
    }
  });

  it("Typwechsel baut den Auslöser neu: keine Felder der alten Art", () => {
    const g = base();
    const s = st(g, "schloss");
    s.triggers[1] = newTrigger("manual", g);
    expect(Object.keys(s.triggers[1]!).sort()).toEqual(["code", "type"]);
    s.triggers[1] = newTrigger("gps", g);
    expect(s.triggers[1]).toEqual({ type: "gps", radius: 20 });
    expect(additional(g)).toEqual([]);
  });
});

describe("switchTaskType", () => {
  for (const from of TASK_TYPES) {
    for (const to of TASK_TYPES) {
      it(`${from} → ${to}: keine Fremdfelder, nach dem Ausfüllen gültig`, () => {
        const g = base();
        const s = st(g, "schloss");
        s.task = switchTaskType(structuredClone(FULL[from]), to, "de", s.location);
        expect(s.task.type).toBe(to);
        expect(Object.keys(s.task).filter((k) => !(k in FULL[to]))).toEqual([]);
        s.task = complete(s.task);
        expect(validateGame(g).errors).toEqual([]);
      });
    }
  }

  it("Frage bleibt erhalten, auch zwischen question und prompt", () => {
    const photo = switchTaskType(FULL.text, "photo", "de");
    expect(photo).toEqual({ type: "photo", prompt: { de: "Welches Tier?" } });
    const back = switchTaskType(photo, "choice", "de");
    expect(back).toMatchObject({ type: "choice", question: { de: "Welches Tier?" } });
  });

  it("Antworten bleiben zwischen Text und Code, Bilder zwischen Text, Code und Auswahl", () => {
    expect(switchTaskType(FULL.text, "code", "de")).toEqual({ type: "code", question: { de: "Welches Tier?" }, answers: ["Eule"], media: ["wind"] });
    expect(switchTaskType(FULL.code, "choice", "de")).toMatchObject({ media: ["wind"] });
    expect(switchTaskType(FULL.code, "photo", "de")).not.toHaveProperty("media");
  });

  it("Ort finden übernimmt den Ort der Station; gleiche Art ändert nichts", () => {
    expect(switchTaskType(FULL.text, "find_location", "de", here)).toMatchObject({ location: here });
    expect(switchTaskType(FULL.text, "text", "de")).toBe(FULL.text);
    expect(newTask("find_location", "de")).not.toHaveProperty("location");
  });
});

describe("Takte", () => {
  const full: Beat = {
    kind: "dialogue",
    speaker: "brandt",
    title: { de: "Titel" },
    text: { de: "Hallo" },
    audio: "wind",
    sfx: "wind",
    image: "wind",
    item: "zettel",
    ack: { de: "Los" },
    responses: [{ label: { de: "Wer?" }, reply: { de: "Ich." } }],
  };

  it("switchBeatKind behält nur die Felder der neuen Art", () => {
    for (const kind of BEAT_KINDS) {
      const out = switchBeatKind(full, kind);
      expect(Object.keys(out).sort(), kind).toEqual(["kind", ...BEAT_FIELDS[kind]].sort());
    }
    expect(switchBeatKind(full, "narration")).not.toHaveProperty("responses");
    expect(switchBeatKind(full, "group")).not.toHaveProperty("item");
    expect(switchBeatKind(full, "document")).not.toHaveProperty("image");
    expect(switchBeatKind(full, "document")).toHaveProperty("item", "zettel");
  });

  it("jeder Wechsel bleibt schema-gültig, Unbekanntes aus Importen bleibt", () => {
    for (const kind of BEAT_KINDS) {
      const g = base();
      st(g, "baum").scene!.arrival = [switchBeatKind(full, kind)];
      expect(validateGame(g).errors, kind).toEqual([]);
    }
    expect(switchBeatKind({ ...full, extra: 1 } as Beat, "radio")).toHaveProperty("extra", 1);
  });

  it("newBeat ist für jede Art gültig", () => {
    const g = base();
    st(g, "baum").scene!.beats = BEAT_KINDS.map((k) => newBeat(k, "de"));
    expect(validateGame(g).errors).toEqual([]);
  });

  it("convertStoryToScene: Zentrale wird Funkspruch vor der Ankunft, story fällt weg", () => {
    const g = base();
    const baum = st(g, "baum");
    const out = convertStoryToScene(baum);
    expect(out).not.toHaveProperty("story");
    expect(out.scene!.arrival![0]).toEqual({ kind: "radio", text: { de: "Hier wurde das Funkgerät zuletzt gesehen." } });
    expect(out.scene!.arrival!).toHaveLength(2);
    const plain = convertStoryToScene({ id: "x", name: "X", triggers: [{ type: "gps" }], story: { text: "Es war einmal.", media: ["bild"] } } as Station);
    expect(plain.scene).toEqual({ arrival: [{ kind: "narration", text: "Es war einmal." }, { kind: "image", image: "bild" }] });
  });
});

describe("Finale und Sichtbarkeit", () => {
  it("setFinal ist exklusiv", () => {
    const g = base();
    setFinal(g, "schloss", true);
    expect(g.stations.filter((s) => s.final).map((s) => s.id)).toEqual(["schloss"]);
    expect(finalStation(g)?.id).toBe("schloss");
    setFinal(g, "schloss", false);
    expect(finalStation(g)).toBeUndefined();
    expect(st(g, "schloss")).not.toHaveProperty("final");
  });

  it("visibilityMode erkennt alle Antworten", () => {
    const g = base();
    expect(visibilityMode(g, st(g, "baum"))).toBe("visible");
    expect(visibilityMode(g, st(g, "versteck"))).toBe("rule");
    setVisibility(g, "versteck", "near");
    expect(st(g, "versteck")).toMatchObject({ visibility: "hidden", revealRadius: 30 });
    expect(revealers(g, "versteck")).toEqual([]);
    expect(visibilityMode(g, st(g, "versteck"))).toBe("near");
    setVisibility(g, "versteck", "leitung");
    expect(st(g, "versteck")).not.toHaveProperty("revealRadius");
    expect(visibilityMode(g, st(g, "versteck"))).toBe("rule");
    g.rules = [];
    expect(visibilityMode(g, st(g, "versteck"))).toBe("leitung");
  });

  it("„Wenn Station gelöst“ schreibt rewards.reveal der gewählten Station und nur dort", () => {
    const g = base();
    setVisibility(g, "versteck", "station", "baum");
    expect(st(g, "baum").rewards?.reveal).toEqual(["versteck"]);
    expect(revealers(g, "versteck").map((s) => s.id)).toEqual(["baum"]);
    setVisibility(g, "versteck", "visible");
    expect(st(g, "versteck")).not.toHaveProperty("visibility");
    expect(st(g, "baum").rewards).toEqual({ fragments: ["f1"] });
  });

  it("addFragment verlängert den Finalcode und zieht ein gekoppeltes Finale mit", () => {
    const g = base();
    expect(isCoupled(g)).toBe(true);
    const id = addFragment(g, "baum", "7");
    expect(id).toBe("teil-1");
    expect(finalCode(g)).toBe("1917");
    expect(st(g, "baum").rewards?.fragments).toEqual(["f1", "teil-1"]);
    expect(st(g, "finale").task).toMatchObject({ answers: ["1917"] });
    expect(validateGame(g).errors).toEqual([]);
  });

  it("addFragment lässt ein entkoppeltes Finale in Ruhe", () => {
    const g = base();
    (st(g, "finale").task as { answers: string[] }).answers = ["999"];
    addFragment(g, "schloss");
    expect(finalCode(g)).toMatch(/^191\d$/);
    expect(st(g, "finale").task).toMatchObject({ answers: ["999"] });
  });
});

describe("parseCoordinates", () => {
  it("liest eingefügte Koordinaten mit Punkt oder Komma", () => {
    expect(parseCoordinates("50.7374, 7.0982")).toEqual({ lat: 50.7374, lon: 7.0982 });
    expect(parseCoordinates("50,7374 7,0982")).toEqual({ lat: 50.7374, lon: 7.0982 });
    expect(parseCoordinates("-33.9;151.2")).toEqual({ lat: -33.9, lon: 151.2 });
  });

  it("lehnt Unsinn und Werte außerhalb der Erde ab", () => {
    expect(parseCoordinates("50.7374")).toBeNull();
    expect(parseCoordinates("95, 7")).toBeNull();
    expect(parseCoordinates("Bonn")).toBeNull();
  });
});
