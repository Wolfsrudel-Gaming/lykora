import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateGame } from "@lykora/spec";
import { addMedia, applySoundForm, audioChoices, audioUsage, libraryMedia, soundFormFromGame, suggestMediaId, uploadedMedia } from "../src/lib/sound.ts";
import type { Game, LibrarySound } from "../src/lib/types.ts";

const testspiel = JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;
const game = () => structuredClone(testspiel);

const lib = (id: string, category: LibrarySound["category"] = "sfx"): LibrarySound => ({
  id,
  title: id === "wolf-heulen" ? "Wolf heult" : id,
  category,
  loop: category === "ambience",
  duration: category === "ambience" ? 45 : 2,
  src: `media/lib/${id}.ogg`,
  url: `http://localhost:3000/lykora/media/lib/${id}.ogg`,
  license: "CC0-1.0",
  credit: "Lykora-Klangbibliothek, erzeugt mit server/tool/sound_library.py",
});
const library = [lib("wolf-heulen"), lib("eule"), lib("regen", "ambience"), lib("wind", "ambience"), lib("glocke")];

describe("Klänge zuordnen", () => {
  it("liest die Zuordnung aus dem Spiel", () => {
    const form = soundFormFromGame(game());
    expect(form.ambience).toEqual({ audio: "wind", volume: 0.35 });
    expect(form.ui.radio).toBe("funk-knacken");
    expect(form.ui.arrival).toBe("");
    expect(form.chapters.map((c) => [c.id, c.ambience.audio])).toEqual([
      ["kapitel-1", ""],
      ["kapitel-2", ""],
      ["kapitel-3", "sturm"],
    ]);
    const baum = form.stations.find((s) => s.id === "baum")!;
    expect(baum.name).toBe("Der alte Baum");
    expect(baum.ambience).toEqual({ audio: "wald-nacht", volume: 0.7, from: "near" });
    expect(baum.approach).toEqual({ mid: "", near: "eule", here: "" });
    expect(baum.solved).toBe("ast-knackt");
    expect(form.stations.find((s) => s.id === "briefing")!.ambience).toEqual({ audio: "", volume: 0.6, from: "near" });
  });

  it("lässt ein unverändertes Spiel unverändert", () => {
    const g = game();
    expect(applySoundForm(g, soundFormFromGame(g), library)).toEqual(testspiel);
    // Das Original bleibt unberührt.
    expect(g).toEqual(testspiel);
  });

  it("übernimmt Bibliotheksklänge als media-Eintrag mit Urheber", () => {
    const g = game();
    const form = soundFormFromGame(g);
    const briefing = form.stations.find((s) => s.id === "briefing")!;
    briefing.ambience = { audio: "lib:regen", volume: 0.5, from: "mid" };
    briefing.approach.here = "lib:wolf-heulen";
    briefing.solved = "lib:wolf-heulen";
    form.ui.arrival = "lib:glocke";
    const out = applySoundForm(g, form, library);
    const s = out.stations.find((x) => x.id === "briefing")!;
    expect(s.sound).toEqual({ ambience: { audio: "regen", volume: 0.5, from: "mid" }, approach: { here: "wolf-heulen" }, solved: "wolf-heulen" });
    expect(out.sound?.ui).toEqual({ arrival: "glocke", radio: "funk-knacken" });
    const wolf = out.media!.filter((m) => m.src === "media/lib/wolf-heulen.ogg");
    expect(wolf).toEqual([{ id: "wolf-heulen", type: "audio", src: "media/lib/wolf-heulen.ogg", alt: { de: "Wolf heult" }, credit: library[0]!.credit }]);
    expect(validateGame(out)).toEqual({ errors: [], warnings: expect.any(Array) });
  });

  it("nutzt vorhandene Medien mit gleicher Datei, statt sie doppelt anzulegen", () => {
    const g = game();
    const form = soundFormFromGame(g);
    form.stations[0]!.solved = "lib:eule";
    const out = applySoundForm(g, form, library);
    expect(out.stations[0]!.sound?.solved).toBe("eule");
    expect(out.media!.filter((m) => m.src === "media/lib/eule.ogg")).toHaveLength(1);
    expect(out.media).toHaveLength(testspiel.media!.length);
  });

  it("weicht bei belegter ID aus", () => {
    const g = game();
    g.media = g.media!.map((m) => (m.id === "wind" ? { ...m, src: "media/abc.ogg" } : m));
    const form = soundFormFromGame(g);
    form.stations[0]!.ambience.audio = "lib:wind";
    const out = applySoundForm(g, form, library);
    expect(out.stations[0]!.sound?.ambience?.audio).toBe("wind-2");
    expect(out.media!.find((m) => m.id === "wind-2")?.src).toBe("media/lib/wind.ogg");
  });

  it("entfernt Klänge, die geleert wurden, samt leerer Objekte", () => {
    const g = game();
    const form = soundFormFromGame(g);
    form.ambience.audio = "";
    form.ui.radio = "";
    form.chapters[2]!.ambience.audio = "";
    const baum = form.stations.find((s) => s.id === "baum")!;
    baum.ambience.audio = "";
    baum.approach.near = "";
    baum.solved = "";
    const out = applySoundForm(g, form, library);
    expect(out.sound).toBeUndefined();
    expect(out.story!.chapters![2]).not.toHaveProperty("ambience");
    expect(out.stations.find((s) => s.id === "baum")).not.toHaveProperty("sound");
    expect(validateGame(out).errors).toEqual([]);
  });

  it("begrenzt die Lautstärke auf 0 bis 1 mit zwei Stellen", () => {
    const g = game();
    const form = soundFormFromGame(g);
    form.ambience.volume = 1.234;
    form.chapters[0]!.ambience = { audio: "bach", volume: 0.3333 };
    const out = applySoundForm(g, form, library);
    expect(out.sound?.ambience).toEqual({ audio: "wind", volume: 1 });
    expect(out.story!.chapters![0]!.ambience).toEqual({ audio: "bach", volume: 0.33 });
  });

  it("liest Aufnahme und Geräusch je Takt der Szene", () => {
    const form = soundFormFromGame(game());
    const briefing = form.stations.find((s) => s.id === "briefing")!;
    expect(briefing.beats.map((b) => [b.part, b.index, b.kind])).toEqual([
      ["arrival", 0, "chapter"],
      ["beats", 0, "radio"],
      ["beats", 1, "group"],
      ["afterSolve", 0, "radio"],
    ]);
    expect(briefing.beats[1]).toMatchObject({ speaker: "Zentrale Nachtfalke", audio: "", sfx: "funk-knacken" });
    expect(briefing.beats[1]!.excerpt).toMatch(/^Nachtfalke an Team\. .{20,}…$/);
    expect(briefing.beats[1]!.excerpt.length).toBeLessThanOrEqual(70);
    const dialogue = form.stations.find((s) => s.id === "schloss")!.beats[0]!;
    expect(dialogue).toMatchObject({ part: "arrival", kind: "dialogue", speaker: "Försterin Brandt" });
  });

  it("schreibt Stimmen und Geräusche in die Takte zurück", () => {
    const g = game();
    g.media = [...g.media!, { id: "stimme-brandt", type: "audio", src: "media/ab12.mp3" }];
    const form = soundFormFromGame(g);
    const schloss = form.stations.find((s) => s.id === "schloss")!;
    schloss.beats[0]!.audio = "stimme-brandt";
    schloss.beats[0]!.sfx = "lib:wolf-heulen";
    form.stations.find((s) => s.id === "briefing")!.beats[1]!.sfx = "";
    const out = applySoundForm(g, form, library);
    const arrival = out.stations.find((s) => s.id === "schloss")!.scene!.arrival![0]!;
    expect(arrival).toMatchObject({ kind: "dialogue", speaker: "brandt", audio: "stimme-brandt", sfx: "wolf-heulen" });
    expect(arrival.responses).toEqual(testspiel.stations.find((s) => s.id === "schloss")!.scene!.arrival![0]!.responses);
    expect(out.stations.find((s) => s.id === "briefing")!.scene!.beats![0]).not.toHaveProperty("sfx");
    expect(out.media!.some((m) => m.id === "wolf-heulen")).toBe(true);
    expect(validateGame(out).errors).toEqual([]);
  });

  it("lässt umgebaute Takte in Ruhe", () => {
    const g = game();
    const form = soundFormFromGame(g);
    form.stations.find((s) => s.id === "briefing")!.beats[1]!.audio = "eule";
    // Inzwischen hat jemand die Szene umgestellt: an Stelle 1 steht jetzt ein anderer Takt.
    const fresh = game();
    const scene = fresh.stations.find((s) => s.id === "briefing")!.scene!;
    scene.beats = [scene.beats![1]!, scene.beats![0]!];
    const out = applySoundForm(fresh, form, library);
    expect(out.stations.find((s) => s.id === "briefing")!.scene!.beats).toEqual(scene.beats);
  });

  it("meldet unbekannte Bibliotheksklänge", () => {
    const g = game();
    const form = soundFormFromGame(g);
    form.ambience.audio = "lib:gibtsnicht";
    expect(() => applySoundForm(g, form, library)).toThrow(/gibtsnicht/);
  });

  it("bietet Bibliotheksklänge nur an, wenn sie noch nicht im Spiel sind", () => {
    const choices = audioChoices(game(), library);
    expect(choices.game.map((c) => c.value)).toContain("eule");
    expect(choices.game.find((c) => c.value === "eule")?.label).toBe("eule – Ruf einer Eule");
    expect(choices.library.map((c) => c.value)).toEqual(["lib:wolf-heulen", "lib:regen", "lib:glocke"]);
  });
});

describe("Medien ins Spiel übernehmen", () => {
  it("schlägt eine freie ID aus dem Dateinamen vor", () => {
    expect(suggestMediaId(game(), "Tür knarzt.mp3")).toBe("tuer-knarzt");
    expect(suggestMediaId(game(), "Eule.ogg")).toBe("eule-2");
  });

  it("legt hochgeladene Dateien mit Urheber an", () => {
    expect(uploadedMedia({ type: "audio", src: "media/ab12.mp3" }, "tuer", " Anna B., CC BY 4.0 ")).toEqual({
      id: "tuer",
      type: "audio",
      src: "media/ab12.mp3",
      credit: "Anna B., CC BY 4.0",
    });
    expect(uploadedMedia({ type: "image", src: "media/cd.png" }, "karte")).toEqual({ id: "karte", type: "image", src: "media/cd.png" });
  });

  it("fügt hinzu oder erkennt die vorhandene Datei", () => {
    const g = game();
    const first = addMedia(g, uploadedMedia({ type: "audio", src: "media/ab12.mp3" }, "eule"));
    expect(first.added).toBe(true);
    expect(first.id).toBe("eule-2");
    expect(validateGame(first.game).errors).toEqual([]);
    const again = addMedia(first.game, uploadedMedia({ type: "audio", src: "media/ab12.mp3" }, "anders"));
    expect(again).toMatchObject({ added: false, id: "eule-2" });
    expect(again.game).toBe(first.game);
  });

  it("baut Einträge für Bibliotheksklänge", () => {
    expect(libraryMedia(library[1]!, "eule", "de")).toEqual({ id: "eule", type: "audio", src: "media/lib/eule.ogg", alt: { de: "eule" }, credit: library[1]!.credit });
  });

  it("zählt, wo ein Klang verwendet wird", () => {
    const g = game();
    expect(audioUsage(g, "funk-knacken")).toBe(3);
    expect(audioUsage(g, "eule")).toBe(1);
    expect(audioUsage(g, "regen")).toBe(0);
  });
});
