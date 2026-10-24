import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Game } from "../src/lib/editor/types.ts";
import type { LibrarySound } from "../src/lib/types.ts";

// Die Bereiche importieren session.ts, das beim Laden document.baseURI liest: Browser-Umgebung, soweit nötig.
vi.stubGlobal("document", { baseURI: "https://lager.example/lykora/", documentElement: { dataset: {} }, querySelector: () => null, addEventListener: vi.fn() });
vi.stubGlobal("window", { location: { pathname: "/lykora/", search: "" }, addEventListener: vi.fn(), removeEventListener: vi.fn(), scrollTo: vi.fn() });

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

let store: typeof import("../src/lib/editor/store.ts");
let settings: typeof import("../src/pages/games/editor/SettingsSection.tsx");
let sound: typeof import("../src/pages/games/editor/SoundSection.tsx");
let media: typeof import("../src/pages/games/editor/MediaSection.tsx");
let legacy: typeof import("../src/pages/games/Media.tsx");
let sections: typeof import("../src/pages/games/editor/sections.ts");

beforeAll(async () => {
  store = await import("../src/lib/editor/store.ts");
  settings = await import("../src/pages/games/editor/SettingsSection.tsx");
  sound = await import("../src/pages/games/editor/SoundSection.tsx");
  media = await import("../src/pages/games/editor/MediaSection.tsx");
  legacy = await import("../src/pages/games/Media.tsx");
  sections = await import("../src/pages/games/editor/sections.ts");
});

/** Store ohne Server und ohne lokale Sicherung, als aktueller Baukasten eingetragen. */
function open(game = load()) {
  const s = store.createEditorStore({ gameId: "g1", game, localBackup: false });
  store.editor.set({ current: s });
  return s;
}

const lib = (id: string, category: LibrarySound["category"] = "sfx"): LibrarySound => ({
  id,
  title: id === "wolf-heulen" ? "Wolf heult" : id,
  category,
  loop: category === "ambience",
  duration: 2,
  src: `media/lib/${id}.ogg`,
  url: `http://localhost:3000/lykora/media/lib/${id}.ogg`,
  license: "CC0-1.0",
  credit: "Lykora-Klangbibliothek",
});

describe("Spielart", () => {
  it("liest die Spielart aus mode und winCondition mit den Standards", () => {
    const g = load();
    expect(settings.gameModeOf(g)).toBe("race");
    delete g.settings.mode;
    delete g.settings.winCondition;
    expect(settings.gameModeOf(g)).toBe("race");
    g.settings.mode = "time_trial";
    expect(settings.gameModeOf(g)).toBeNull();
    g.settings.mode = "cooperative";
    expect(settings.gameModeOf(g)).toBe("together");
  });

  it("schreibt beim Umstellen mode und winCondition (ein Schritt im Verlauf)", () => {
    const s = open();
    s.update("Spielart: Punktejagd", (g) => settings.setGameMode(g, "points"));
    expect(s.get().game.settings).toMatchObject({ mode: "competitive", winCondition: "most_points", leaderboard: "live_hidden_last_minutes" });
    s.update("Spielart: Gegen die Uhr", (g) => settings.setGameMode(g, "clock"));
    expect(s.get().game.settings).toMatchObject({ mode: "time_trial", winCondition: "all_fragments_in_time" });
    s.update("Spielart: Gemeinsam", (g) => settings.setGameMode(g, "together"));
    const after = s.get().game.settings;
    expect(after.mode).toBe("cooperative");
    expect("winCondition" in after).toBe(false);
    expect(after.leaderboard).toBe("end_only");
    expect(settings.gameModeOf(s.get().game)).toBe("together");
    s.undo();
    s.undo();
    expect(s.get().game.settings).toMatchObject({ mode: "competitive", winCondition: "most_points" });
    s.close();
  });

  it("legt settings an, wenn es im Entwurf fehlt", () => {
    const g = load();
    delete (g as Partial<Game>).settings;
    settings.setGameMode(g, "race");
    expect(g.settings).toEqual({ mode: "competitive", winCondition: "first_escape" });
  });
});

describe("Sprache", () => {
  it("stellt die Standardsprache um, Texte bleiben", () => {
    const g = load();
    const title = structuredClone(g.meta.title);
    settings.setLanguage(g, "en");
    expect(g.meta.languages).toEqual(["en"]);
    expect(g.meta.title).toEqual(title);
    g.meta.languages = ["de", "en", "fr"];
    settings.setLanguage(g, "fr");
    expect(g.meta.languages).toEqual(["fr", "en"]);
    expect(settings.languageName("nl")).toBe("Niederländisch");
    expect(settings.languageName("xx")).toBe("xx");
  });
});

describe("Klang im Entwurf", () => {
  it("applySoundForm über den Store ändert nur Klangfelder", () => {
    const s = open();
    const before = s.get().game;
    const form = sound.soundFormOf(before);
    form.ambience = { audio: "lib:regen", volume: 0.5 };
    form.ui.wrong = "lib:wolf-heulen";
    form.stations.find((x) => x.id === "baum")!.solved = "";
    s.update("Klang zugeordnet", (g) => sound.writeSoundForm(g, form, [lib("regen", "ambience"), lib("wolf-heulen")]), { coalesce: "klang:x" });
    const after = s.get().game;
    expect(after.sound).toEqual({ ambience: { audio: "regen", volume: 0.5 }, ui: { radio: "funk-knacken", wrong: "wolf-heulen" } });
    expect(after.media!.slice(-2).map((m) => m.id)).toEqual(["regen", "wolf-heulen"]);
    expect(after.stations.find((x) => x.id === "baum")!.sound).toEqual({ ambience: { audio: "wald-nacht", volume: 0.7, from: "near" }, approach: { near: "eule" } });
    // Alles außer Klang und Medien ist unverändert (wie sound.test.ts).
    const strip = (g: Game) => {
      const c = structuredClone(g) as Partial<Game>;
      delete c.sound;
      delete c.media;
      for (const st of c.stations!) delete st.sound;
      for (const ch of c.story?.chapters ?? []) delete ch.ambience;
      return c;
    };
    expect(strip(after)).toEqual(strip(before));
    expect(s.get().undo.at(-1)!.label).toBe("Klang zugeordnet");
    s.undo();
    expect(s.get().game).toBe(before);
    s.close();
  });

  it("entfernt sound ganz, wenn das Formular nichts mehr zuordnet", () => {
    const g = load();
    const form = sound.soundFormOf(g);
    form.ambience.audio = "";
    form.ui.radio = "";
    sound.writeSoundForm(g, form, []);
    expect("sound" in g).toBe(false);
  });

  it("liest auch unvollständige Entwürfe", () => {
    const g = load() as Game & { stations: unknown[] };
    g.stations.push(null);
    expect(sound.soundFormOf(g).stations).toHaveLength(5);
  });
});

describe("Medien im Entwurf", () => {
  it("übernimmt ein Medium als Schritt im Verlauf, ohne Doppel", () => {
    const s = open();
    const id = media.adoptMedia({ id: "stimme", type: "audio", src: "media/abc.wav" }, "Medium „Stimme.wav“ übernommen");
    expect(id).toBe("stimme");
    expect(s.get().game.media!.at(-1)).toEqual({ id: "stimme", type: "audio", src: "media/abc.wav" });
    expect(media.adoptMedia({ id: "anders", type: "audio", src: "media/abc.wav" }, "noch einmal")).toBe("stimme");
    expect(s.get().game.media!.filter((m) => m.src === "media/abc.wav")).toHaveLength(1);
    expect(media.mediaName({ id: "stimme", alt: { de: "Stimme der Försterin" } }, "de")).toBe("Stimme der Försterin");
    expect(media.mediaName({ id: "stimme" }, "de")).toBe("stimme");
    s.close();
  });
});

describe("Alte Adressen", () => {
  it("leiten Autoren in den Baukasten, alle anderen in die Übersicht", () => {
    expect(legacy.legacyTarget("spiel-1", "medien", "author")).toBe("/spiele/spiel-1/baukasten/medien");
    expect(legacy.legacyTarget("spiel-1", "klang", "admin")).toBe("/spiele/spiel-1/baukasten/klang");
    expect(legacy.legacyTarget("spiel-1", "klang", "viewer")).toBe("/spiele/spiel-1");
    expect(legacy.legacyTarget("spiel-1", "medien", undefined)).toBe("/spiele/spiel-1");
  });

  it("die Bereiche von Paket D sind eingetragen", async () => {
    for (const s of ["geschichte", "belohnungen", "regeln", "medien", "klang", "einstellungen"] as const) {
      const C = await sections.SECTION_LOADERS[s]();
      expect(C.name).not.toMatch(/Platzhalter/);
    }
  });
});
