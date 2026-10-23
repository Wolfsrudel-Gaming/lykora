import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import { RETRY_MS, SAVE_DEBOUNCE_MS, SAVE_MAX_MS, type DraftClient, type SaveBody } from "../src/lib/editor/autosave.ts";
import { backupDiffers, readBackup, writeBackup } from "../src/lib/editor/local.ts";
import { createEditorStore, type EditorInit } from "../src/lib/editor/store.ts";
import type { DraftDto, Game } from "../src/lib/editor/types.ts";

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

interface Call {
  gameId: string;
  body: SaveBody;
}

/** Server-Attrappe: antwortet nach einem Tick, Antworten lassen sich vorgeben. */
function fakeClient(respond: (call: Call, n: number) => Promise<{ revision: number; updated_at: string }> = async (c) => ({ revision: c.body.revision + 1, updated_at: `t${c.body.revision + 1}` })) {
  const calls: Call[] = [];
  const client: DraftClient = {
    draft: () => Promise.reject(new ApiError(404, "no_draft", "Kein Entwurf")),
    saveDraft: vi.fn(async (gameId: string, body: SaveBody) => {
      const call = { gameId, body };
      calls.push(call);
      return respond(call, calls.length);
    }),
  };
  return { client, calls };
}

const listeners = new Map<string, () => void>();

function make(client: DraftClient, init: Partial<EditorInit> = {}) {
  return createEditorStore({ gameId: "g1", game: load(), revision: 3, localBackup: false, validate: () => [], client, ...init });
}

describe("Automatisches Speichern", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    vi.stubGlobal("window", { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("speichert 1,5 s nach der letzten Änderung mit der Revision und merkt sich den gesendeten Stand", async () => {
    const { client, calls } = fakeClient();
    const store = make(client);
    expect(store.get().save.status).toBe("saved");
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    expect(store.get().save.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    store.update("Titel", (g) => void (g.meta.title = { de: "AB" }));
    await vi.advanceTimersByTimeAsync(1400);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.gameId).toBe("g1");
    expect(calls[0]!.body.revision).toBe(3);
    expect(calls[0]!.body.content.meta.title).toEqual({ de: "AB" });
    const s = store.get();
    expect(s.save).toEqual({ status: "saved", at: "t4", error: null, conflict: null });
    expect(s.revision).toBe(4);
    expect(s.saved.game).toBe(s.game);
    expect(s.saved.meta).toBe(s.meta);
    store.close();
  });

  it("speichert spätestens 10 s nach der ersten ungespeicherten Änderung", async () => {
    const { client, calls } = fakeClient();
    const store = make(client);
    for (let i = 0; i < 12; i++) {
      store.update("Tippen", (g) => void (g.meta.title = { de: "x".repeat(i + 1) }), { coalesce: "/meta/title" });
      await vi.advanceTimersByTimeAsync(1000);
      if (i < 9) expect(calls).toHaveLength(0);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.content.meta.title).toEqual({ de: "x".repeat(10) });
    // Die Änderungen danach kommen mit dem nächsten Zeitplan.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.revision).toBe(4);
    expect(store.get().save.status).toBe("saved");
    expect(SAVE_MAX_MS).toBe(10_000);
    store.close();
  });

  it("saveNow speichert sofort; eine Änderung währenddessen wird nachgespeichert", async () => {
    let release: (() => void) | null = null;
    const { client, calls } = fakeClient((c) => new Promise((resolve) => (release = () => resolve({ revision: c.body.revision + 1, updated_at: "t" }))));
    const store = make(client);
    store.update("A", (g) => void (g.meta.title = { de: "A" }));
    const p = store.saveNow();
    expect(store.get().save.status).toBe("saving");
    expect(calls).toHaveLength(1);
    store.update("B", (g) => void (g.meta.title = { de: "B" }));
    void store.saveNow();
    release!();
    await p;
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.content.meta.title).toEqual({ de: "B" });
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().save.status).toBe("saved");
    expect(store.get().revision).toBe(5);
    store.close();
  });

  it("409: Konflikt mit dem fremden Stand, kein stilles Speichern mehr", async () => {
    const theirs: DraftDto = { gameId: "g1", revision: 7, content: { ...load(), meta: { ...load().meta, title: { de: "Anna" } } }, meta: { noZones: true }, base_version: 1, updated_at: "t7", updated_by: { id: "u2", name: "Anna" } };
    const { client, calls } = fakeClient(async (c, n) => {
      if (n === 1) throw new ApiError(409, "draft_conflict", "Entwurf wurde inzwischen geändert", { draft: theirs });
      return { revision: c.body.revision + 1, updated_at: "t8" };
    });
    const exportFile = vi.fn();
    const store = make(client, { exportFile });
    store.update("Titel", (g) => void (g.meta.title = { de: "Ich" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save.status).toBe("conflict");
    expect(store.get().save.conflict).toBe(theirs);
    store.update("Noch was", (g) => void (g.meta.summary = { de: "s" }));
    await vi.advanceTimersByTimeAsync(SAVE_MAX_MS);
    expect(calls).toHaveLength(1);

    await store.resolveConflict("theirs");
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0].meta.title).toEqual({ de: "Ich" });
    expect(exportFile.mock.calls[0]![1]).toMatch(/^g1-entwurf-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    const s = store.get();
    expect(s.game.meta.title).toEqual({ de: "Anna" });
    expect(s.meta).toEqual({ noZones: true });
    expect(s.revision).toBe(7);
    expect(s.save).toEqual({ status: "saved", at: "t7", error: null, conflict: null });
    expect(s.undo).toEqual([]);
    expect(s.lastEditor).toEqual({ id: "u2", name: "Anna", at: "t7" });
    store.close();
  });

  it("409 und „meine behalten“: überschreibt mit der fremden Revision", async () => {
    const theirs: DraftDto = { gameId: "g1", revision: 7, content: load(), meta: {}, base_version: null, updated_at: "t7", updated_by: null };
    const { client, calls } = fakeClient(async (c, n) => {
      if (n === 1) throw new ApiError(409, "draft_conflict", "Konflikt", { draft: theirs });
      return { revision: c.body.revision + 1, updated_at: "t8" };
    });
    const store = make(client);
    store.update("Titel", (g) => void (g.meta.title = { de: "Ich" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save.status).toBe("conflict");
    await store.resolveConflict("mine");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.revision).toBe(7);
    expect(calls[1]!.body.content.meta.title).toEqual({ de: "Ich" });
    expect(store.get()).toMatchObject({ revision: 8, save: { status: "saved", conflict: null } });
    store.close();
  });

  it("ohne Netz: offline, Wiederholung bei „online“ und alle 15 s", async () => {
    let online = false;
    const { client, calls } = fakeClient(async (c) => {
      if (!online) throw new ApiError(0, "network", "Server nicht erreichbar. Netz prüfen und erneut versuchen.");
      return { revision: c.body.revision + 1, updated_at: "t4" };
    });
    const store = make(client);
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save).toMatchObject({ status: "offline", error: expect.stringContaining("nicht erreichbar") });
    expect(calls).toHaveLength(1);
    store.update("Titel", (g) => void (g.meta.title = { de: "AB" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save.status).toBe("offline");
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(calls).toHaveLength(2);
    expect(store.get().save.status).toBe("offline");
    online = true;
    listeners.get("online")!();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.body.content.meta.title).toEqual({ de: "AB" });
    expect(store.get().save.status).toBe("saved");
    store.close();
    expect(listeners.has("online")).toBe(false);
  });

  it("401: Anmeldung abgelaufen, Änderungen bleiben im Zustand", async () => {
    const { client, calls } = fakeClient(async () => {
      throw new ApiError(401, "unauthorized", "Anmeldung erforderlich");
    });
    const store = make(client);
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save.status).toBe("unauthorized");
    store.update("Titel", (g) => void (g.meta.title = { de: "AB" }));
    await vi.advanceTimersByTimeAsync(SAVE_MAX_MS);
    expect(calls).toHaveLength(1);
    expect(store.get().game.meta.title).toEqual({ de: "AB" });
    store.close();
  });

  it("sonstiger Fehler: error mit Meldung, „Erneut versuchen“ speichert", async () => {
    let fail = true;
    const { client, calls } = fakeClient(async (c) => {
      if (fail) throw new ApiError(500, "error", "Fehler 500");
      return { revision: c.body.revision + 1, updated_at: "t4" };
    });
    const store = make(client);
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.get().save).toMatchObject({ status: "error", error: "Fehler 500" });
    fail = false;
    await store.retrySave();
    expect(calls).toHaveLength(2);
    expect(store.get().save).toMatchObject({ status: "saved", error: null });
    store.close();
  });

  it("ohne Client wird nicht gespeichert", async () => {
    const store = createEditorStore({ gameId: "g1", game: load(), localBackup: false, validate: () => [] });
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(SAVE_MAX_MS);
    await expect(store.saveNow()).resolves.toBeUndefined();
    expect(store.get().save.status).toBe("saved");
    store.close();
  });
});

describe("Lokale Sicherung", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    vi.useFakeTimers();
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("schreibt nach einer Änderung und löscht nach dem Speichern", async () => {
    const { client } = fakeClient();
    const store = createEditorStore({ gameId: "g1", game: load(), revision: 3, validate: () => [], client });
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    await vi.advanceTimersByTimeAsync(300);
    const backup = readBackup("g1");
    expect(backup).toMatchObject({ revision: 3 });
    expect(backup!.game.meta.title).toEqual({ de: "A" });
    expect(store.get().backup).toBe("ok");
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(readBackup("g1")).toBeNull();
    store.close();
  });

  it("lässt keine Sicherung zurück, wenn vor der Sicherung gespeichert wurde", async () => {
    const { client } = fakeClient();
    const store = createEditorStore({ gameId: "g1", game: load(), revision: 3, validate: () => [], client });
    store.update("Titel", (g) => void (g.meta.title = { de: "A" }));
    await store.saveNow();
    await vi.advanceTimersByTimeAsync(300);
    expect(readBackup("g1")).toBeNull();
    store.close();
  });

  it("vergleicht Sicherungen ohne Rücksicht auf die Reihenfolge der Schlüssel", () => {
    const g = load();
    const reordered = JSON.parse(JSON.stringify(g, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))) as Game;
    expect(backupDiffers({ revision: 1, game: g, meta: { noZones: true, dismissed: [] }, at: "t" }, reordered, { dismissed: [], noZones: true })).toBe(false);
    reordered.meta.title = { de: "Anders" };
    expect(backupDiffers({ revision: 1, game: g, meta: {}, at: "t" }, reordered, {})).toBe(true);
  });

  it("sichert nicht über 4 MB und meldet es", () => {
    const g = load();
    expect(writeBackup("g1", { revision: 1, game: g, meta: {}, at: "t" })).toBe("ok");
    g.stations[0]!.notes = "x".repeat(4 * 1024 * 1024);
    expect(writeBackup("g1", { revision: 1, game: g, meta: {}, at: "t" })).toBe("too_large");
    expect(readBackup("g1")!.game.stations[0]!.notes).toBeUndefined();
    storage.set("lykora.entwurf.kaputt", "{nicht json");
    expect(readBackup("kaputt")).toBeNull();
    expect(readBackup("fehlt")).toBeNull();
  });

  it("übernimmt oder verwirft eine Sicherung beim Öffnen", async () => {
    const { client, calls } = fakeClient();
    const store = createEditorStore({ gameId: "g1", game: load(), revision: 3, validate: () => [], client });
    const other = load();
    other.meta.title = { de: "Vom Gerät" };
    store.set({ pendingBackup: { revision: 3, game: other, meta: { noZones: true }, at: "t" } });
    await store.applyBackup();
    expect(store.get().game.meta.title).toEqual({ de: "Vom Gerät" });
    expect(store.get().meta).toEqual({ noZones: true });
    expect(store.get().pendingBackup).toBeNull();
    expect(calls).toHaveLength(1);
    expect(store.get().undo.map((e) => e.label)).toEqual(["Lokale Sicherung übernommen"]);
    storage.set("lykora.entwurf.g1", "{}");
    store.set({ pendingBackup: { revision: 3, game: other, meta: {}, at: "t" } });
    store.discardBackup();
    expect(store.get().pendingBackup).toBeNull();
    expect(storage.has("lykora.entwurf.g1")).toBe(false);
    store.close();
  });
});
