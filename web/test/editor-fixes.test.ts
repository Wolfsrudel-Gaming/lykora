import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import { RETRY_MS, SAVE_DEBOUNCE_MS, SAVE_TIMEOUT_MS, type DraftClient, type SaveBody } from "../src/lib/editor/autosave.ts";
import { newGameId } from "../src/lib/editor/ids.ts";
import { moveKeys, printOf, reconcileKeys, type ListKeys } from "../src/lib/editor/listkeys.ts";
import { readBackup, writeBackup } from "../src/lib/editor/local.ts";
import { MESSAGES } from "../src/lib/editor/messages.ts";
import { CLOSE_WAIT_MS, closeEditor, createEditorStore, editor, keepMarkers, saveForAction, type EditorInit } from "../src/lib/editor/store.ts";
import type { DraftDto, Game } from "../src/lib/editor/types.ts";
import type { GameSummary } from "../src/lib/types.ts";

// Die Seiten importieren session.ts, das beim Laden document.baseURI liest: Browser-Umgebung, soweit nötig.
vi.stubGlobal("document", { baseURI: "https://lager.example/lykora/", documentElement: { dataset: {} }, querySelector: () => null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
const windowListeners = new Map<string, () => void>();
vi.stubGlobal("window", {
  location: { pathname: "/lykora/", search: "" },
  addEventListener: (name: string, fn: () => void) => windowListeners.set(name, fn),
  removeEventListener: (name: string) => windowListeners.delete(name),
  scrollTo: vi.fn(),
});
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
  key: (i: number) => [...stored.keys()][i] ?? null,
  get length() {
    return stored.size;
  },
});

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

let shell: typeof import("../src/pages/games/editor/EditorShell.tsx");
let backupDialog: typeof import("../src/pages/games/editor/LocalBackupDialog.tsx");
let duration: typeof import("../src/pages/games/editor/ui/DurationInput.tsx");
let games: typeof import("../src/pages/games/Games.tsx");
let session: typeof import("../src/lib/session.ts");

beforeAll(async () => {
  shell = await import("../src/pages/games/editor/EditorShell.tsx");
  backupDialog = await import("../src/pages/games/editor/LocalBackupDialog.tsx");
  duration = await import("../src/pages/games/editor/ui/DurationInput.tsx");
  games = await import("../src/pages/games/Games.tsx");
  session = await import("../src/lib/session.ts");
});

interface Call {
  body: SaveBody;
  signal?: AbortSignal;
}

function fakeClient(respond: (call: Call, n: number) => Promise<{ revision: number; updated_at: string }> = async (c) => ({ revision: c.body.revision + 1, updated_at: `t${c.body.revision + 1}` })) {
  const calls: Call[] = [];
  const client: DraftClient = {
    draft: () => Promise.reject(new ApiError(404, "no_draft", "Kein Entwurf")),
    saveDraft: async (_gameId, body, signal) => {
      const call = { body, signal };
      calls.push(call);
      return respond(call, calls.length);
    },
  };
  return { client, calls };
}

const make = (client: DraftClient, init: Partial<EditorInit> = {}) => createEditorStore({ gameId: "g1", game: load(), revision: 3, localBackup: false, validate: () => [], client, ...init });

beforeEach(() => {
  vi.useFakeTimers();
  stored.clear();
  windowListeners.clear();
});
afterEach(() => {
  vi.useRealTimers();
  editor.set({ current: null });
});

describe("Speichern: Zeitlimit und Konflikte", () => {
  it("bricht einen hängenden Abruf nach 30 s ab: offline, danach Wiederholung", async () => {
    const { client, calls } = fakeClient((c, n) => (n === 1 ? new Promise(() => undefined) : Promise.resolve({ revision: c.body.revision + 1, updated_at: "t" })));
    const store = make(client);
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save.status).toBe("saving");
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(store.get().save.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(calls).toHaveLength(2);
    expect(store.get().save.status).toBe("saved");
    store.close();
  });

  it("409 mit genau dem gesendeten Stand ist kein Konflikt (Antwort kam nach dem Zeitlimit doch an)", async () => {
    const sentGame = load();
    sentGame.meta.title = { de: "A" };
    const same: DraftDto = { gameId: "g1", revision: 4, content: JSON.parse(JSON.stringify(sentGame)), meta: {}, base_version: null, updated_at: "t4", updated_by: null };
    const { client } = fakeClient(async () => {
      throw new ApiError(409, "draft_conflict", "Konflikt", { draft: same });
    });
    const store = make(client);
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    await store.saveNow();
    expect(store.get().save).toMatchObject({ status: "saved", conflict: null });
    expect(store.get().revision).toBe(4);
    store.close();
  });

  it("409 ohne Gegenstand (Entwurf gelöscht): Konflikt ohne fremden Stand, „mine“ legt ihn mit Revision 0 neu an", async () => {
    const { client, calls } = fakeClient(async (c, n) => {
      if (n === 1) throw new ApiError(409, "draft_conflict", "Konflikt", { draft: null });
      return { revision: c.body.revision + 1, updated_at: "t1" };
    });
    const store = make(client);
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save).toMatchObject({ status: "conflict", conflict: null });
    store.update("B", (g) => void (g.meta.title = { de: "B" }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(1);
    await store.resolveConflict("mine");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.revision).toBe(0);
    expect(calls[1]!.body.content.meta.title).toEqual({ de: "B" });
    expect(store.get()).toMatchObject({ revision: 1, save: { status: "saved", conflict: null } });
    store.close();
  });

  it("erneuter Konflikt nach „mine“ bleibt sichtbar als conflict, nicht als gespeichert", async () => {
    const theirs = (revision: number): DraftDto => ({ gameId: "g1", revision, content: { ...load(), meta: { ...load().meta, title: { de: "Anna" } } }, meta: {}, base_version: null, updated_at: "t", updated_by: null });
    const { client } = fakeClient(async (_c, n) => {
      throw new ApiError(409, "draft_conflict", "Konflikt", { draft: theirs(6 + n) });
    });
    const store = make(client);
    store.update("A", (g) => void (g.meta.title = { de: "Ich" }));
    await store.saveNow();
    expect(store.get().save.status).toBe("conflict");
    await store.resolveConflict("mine");
    expect(store.get().save.status).toBe("conflict");
    expect(store.get().save.conflict!.revision).toBe(8);
    store.close();
  });
});

describe("Speichern vor Aktionen und beim Verlassen", () => {
  it("saveForAction meldet ok, conflict und unsaved", async () => {
    const ok = fakeClient();
    const a = make(ok.client);
    a.update("A", (g) => void (g.meta.title = { de: "A" }));
    expect(await saveForAction(a)).toBe("ok");
    a.close();

    const offline = fakeClient(async () => {
      throw new ApiError(0, "network", "Kein Netz");
    });
    const b = make(offline.client);
    b.update("A", (g) => void (g.meta.title = { de: "A" }));
    expect(await saveForAction(b)).toBe("unsaved");
    b.close();

    const conflict = fakeClient(async () => {
      throw new ApiError(409, "draft_conflict", "Konflikt", { draft: null });
    });
    const c = make(conflict.client);
    c.update("A", (g) => void (g.meta.title = { de: "A" }));
    expect(await saveForAction(c)).toBe("conflict");
    c.close();
  });

  it("pagehide schreibt den neuesten Stand sofort in die lokale Sicherung", async () => {
    const { client } = fakeClient(async () => new Promise(() => undefined));
    const store = make(client, { localBackup: true });
    store.update("A", (g) => void (g.meta.title = { de: "Eben getippt" }));
    // weniger als 300 ms: der Sicherungs-Timer hat noch nicht geschlagen
    expect(readBackup("g1")).toBeNull();
    windowListeners.get("pagehide")!();
    expect(readBackup("g1")!.game.meta.title).toEqual({ de: "Eben getippt" });
    expect(store.get().backup).toBe("ok");
    store.close();
  });

  it("leaveWarning warnt bei offenem Stand ohne Sicherung oder bei Konflikt, sonst nicht", () => {
    const g = load();
    const meta = {};
    const saved = { game: g, meta };
    const dirty = { game: { ...g }, meta, saved };
    const status = (s: string, backup: "ok" | "failed" | null) => ({ ...dirty, backup, save: { status: s, at: null, error: null, conflict: null } }) as never;
    expect(shell.leaveWarning({ game: g, meta, saved, save: { status: "conflict", at: null, error: null, conflict: null }, backup: null })).toBe(false);
    expect(shell.leaveWarning(status("pending", "ok"))).toBe(false);
    expect(shell.leaveWarning(status("pending", "failed"))).toBe(true);
    expect(shell.leaveWarning(status("conflict", "ok"))).toBe(true);
    expect(shell.leaveWarning(status("offline", "ok"))).toBe(true);
    expect(shell.leaveWarning(status("unauthorized", "ok"))).toBe(true);
  });

  it("closeEditor wartet auf das laufende Speichern, bevor der Store schließt", async () => {
    let release!: () => void;
    const { client } = fakeClient((c) => new Promise((resolve) => (release = () => resolve({ revision: c.body.revision + 1, updated_at: "t" }))));
    const store = make(client);
    editor.set({ current: store });
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    let closed = false;
    const p = closeEditor().then(() => (closed = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(closed).toBe(false);
    expect(editor.get().current).toBe(store);
    release();
    await p;
    expect(editor.get().current).toBeNull();
    expect(store.get().save.status).toBe("saved");
  });

  it("closeEditor gibt nach höchstens 8 s auf, auch wenn das Speichern hängt", async () => {
    const { client } = fakeClient(() => new Promise(() => undefined));
    const store = make(client);
    editor.set({ current: store });
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    const p = closeEditor();
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS + 10);
    await p;
    expect(editor.get().current).toBeNull();
  });
});

describe("Verwerfen und Rückgängig", () => {
  it("abandon speichert nichts mehr und lässt keine lokale Sicherung zurück", async () => {
    const { client, calls } = fakeClient();
    const store = make(client, { localBackup: true });
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(readBackup("g1")).not.toBeNull();
    store.abandon();
    expect(readBackup("g1")).toBeNull();
    store.update("B", (g) => void (g.meta.title = { de: "B" }));
    await store.saveNow();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(0);
    expect(readBackup("g1")).toBeNull();
    windowListeners.get("pagehide")?.();
    expect(readBackup("g1")).toBeNull();
    store.close();
  });

  it("Rückgängig lässt ausgeblendete Hinweise und den Probelauf-Merker stehen", () => {
    const store = createEditorStore({ gameId: "g1", game: load(), localBackup: false, validate: () => [] });
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    store.dismissIssue("hinweis-1");
    store.update("Probelauf", (_g, m) => void (m.lastTestRun = { eventId: "e1", at: "t" }), { metaOnly: true });
    store.update("B", (g) => void (g.meta.title = { de: "B" }));
    store.undo();
    store.undo();
    expect(store.get().game.meta.title).not.toEqual({ de: "A" });
    expect(store.get().meta.dismissed).toEqual(["hinweis-1"]);
    expect(store.get().meta.lastTestRun).toEqual({ eventId: "e1", at: "t" });
    store.redo();
    expect(store.get().meta.dismissed).toEqual(["hinweis-1"]);
    store.close();
  });

  it("keepMarkers nimmt nur die drei Merker vom aktuellen Stand", () => {
    expect(keepMarkers({ dismissed: ["a"], noZones: true }, { dismissed: [], checklist: { x: "t" } })).toEqual({ dismissed: ["a"], checklist: { x: "t" } });
    expect(keepMarkers({}, { dismissed: ["a"], onSite: {} })).toEqual({});
  });
});

describe("Lokale Sicherung von einem älteren Stand", () => {
  it("erkennt, dass der Server inzwischen weiter ist", () => {
    expect(backupDialog.isOlderBackup({ revision: 5 }, 6)).toBe(true);
    expect(backupDialog.isOlderBackup({ revision: 6 }, 6)).toBe(false);
    expect(backupDialog.isOlderBackup({ revision: 7 }, 6)).toBe(false);
  });

  it("Verwerfen und Übernehmen funktionieren auch für eine ältere Sicherung", async () => {
    const { client, calls } = fakeClient();
    const store = make(client, { revision: 6, localBackup: true });
    const old = load();
    old.meta.title = { de: "Vom Gerät" };
    writeBackup("g1", { revision: 5, game: old, meta: {}, at: "t" });
    store.set({ pendingBackup: readBackup("g1") });
    await store.applyBackup();
    expect(calls[0]!.body.revision).toBe(6);
    expect(calls[0]!.body.content.meta.title).toEqual({ de: "Vom Gerät" });
    store.close();
  });
});

describe("Listenschlüssel", () => {
  const start = (items: unknown[]): ListKeys => reconcileKeys({ keys: [], prints: [] }, items.map(printOf), (() => { let n = 0; return () => `n${++n}`; })());
  let n = 100;
  const make = () => `m${++n}`;

  it("Löschen in der Mitte nimmt nur den Schlüssel des gelöschten Eintrags mit", () => {
    const a = start([{ t: "a" }, { t: "b" }, { t: "c" }]);
    expect(a.keys).toEqual(["n1", "n2", "n3"]);
    const b = reconcileKeys(a, [{ t: "a" }, { t: "c" }].map(printOf), make);
    expect(b.keys).toEqual(["n1", "n3"]);
  });

  it("Einfügen vergibt nur dem neuen Eintrag einen Schlüssel", () => {
    const a = start([1, 2, 3]);
    const b = reconcileKeys(a, [1, 9, 2, 3].map(printOf), make);
    expect(b.keys[0]).toBe("n1");
    expect(b.keys[2]).toBe("n2");
    expect(b.keys[3]).toBe("n3");
    expect(new Set(b.keys).size).toBe(4);
  });

  it("gleiche Länge und Tippen ändern keine Schlüssel", () => {
    const a = start([{ t: "a" }, { t: "b" }]);
    expect(reconcileKeys(a, [{ t: "ax" }, { t: "b" }].map(printOf), make).keys).toEqual(a.keys);
  });

  it("Verschieben nimmt Schlüssel und Abdrücke mit; danach ändert sich nichts", () => {
    const a = start(["a", "b", "c"]);
    const moved = moveKeys(a, 0, 2);
    expect(moved.keys).toEqual(["n2", "n3", "n1"]);
    expect(reconcileKeys(moved, ["b", "c", "a"].map(printOf), make).keys).toEqual(["n2", "n3", "n1"]);
  });

  it("nicht erklärbare Änderung (Löschen und Umordnen zugleich) vergibt alle Schlüssel neu", () => {
    const a = start(["a", "b", "c"]);
    const b = reconcileKeys(a, ["c", "a"].map(printOf), make);
    expect(b.keys).toHaveLength(2);
    expect(b.keys.some((k) => a.keys.includes(k))).toBe(false);
  });
});

describe("Kleinigkeiten", () => {
  it("Spiel-ID „neu“ bleibt der Route /spiele/neu vorbehalten", () => {
    expect(newGameId("Neu")).toBe("neu-spiel");
    expect(newGameId("Sturmnacht")).toBe("sturmnacht");
  });

  it("Dauern: bis 2 Minuten in Sekunden, darüber in Minuten", () => {
    expect(duration.durationLabel(4.4)).toBe("4 s");
    expect(duration.durationLabel(119)).toBe("119 s");
    expect(duration.durationLabel(150)).toBe("2,5 Min");
    expect(duration.durationLabel(600)).toBe("10 Min");
  });

  it("Meldungen zu fehlenden Verweisen und Zahlen nennen weder Kennung noch Sekunden", () => {
    expect(MESSAGES.unknown_station!({ where: "Die Regel", id: "baum-3" })).not.toContain("baum-3");
    expect(MESSAGES.unknown_media!({ where: "Das Bild", id: "bild_7" })).not.toContain("bild_7");
    expect(MESSAGES.type!({ type: "integer", path: "/x" })).not.toMatch(/Sekunden/);
  });
});

describe("Spielliste: Einzelheiten", () => {
  const summary = (over: Partial<GameSummary> = {}) => ({ id: "g1", title: "Spiel", latest_version: 1, draft: { revision: 2, updated_at: "t", updated_by: null, base_version: 1, changed: true }, archived: false, ...over }) as GameSummary;

  it("lädt je Stand nur einmal, ohne Schreibrecht nur die veröffentlichte Fassung", async () => {
    vi.useRealTimers();
    const draft = vi.spyOn(session.api, "draft").mockResolvedValue({ gameId: "g1", revision: 2, content: load(), meta: {}, base_version: 1, updated_at: "t", updated_by: null } as never);
    const game = vi.spyOn(session.api, "game").mockResolvedValue({ content: load() } as never);
    const g = summary();
    const first = await games.loadDetails(g, true);
    expect(first?.facts).toContain("Stationen");
    expect(typeof first?.errors).toBe("number");
    await games.loadDetails(g, true);
    expect(draft).toHaveBeenCalledTimes(1);
    const reader = await games.loadDetails(g, false);
    expect(reader?.errors).toBeUndefined();
    expect(game).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledTimes(1);
    // neuer Stand → neuer Abruf
    await games.loadDetails(summary({ draft: { ...g.draft!, revision: 3 } }), true);
    expect(draft).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
