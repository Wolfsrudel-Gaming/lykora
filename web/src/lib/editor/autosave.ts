/**
 * Paket A: Automatisches Speichern des Entwurfs. 1,5 s nach der letzten Änderung, spätestens
 * 10 s nach der ersten ungespeicherten; sofort beim Verlassen der Seite. Antworten des Servers:
 * 409 → Konflikt (fremder Stand im Zustand, bei gelöschtem Entwurf ohne Gegenstand), 401 →
 * Anmeldung abgelaufen, kein Netz oder keine Antwort nach 30 s → offline mit Wiederholung bei
 * „online“ und alle 15 s, sonst Fehler mit „Erneut versuchen“.
 */

import { ApiError, type Api } from "../api.ts";
import { sameContent } from "./local.ts";
import type { DraftDto, EditorMeta, EditorState, Game } from "./types.ts";

export const SAVE_DEBOUNCE_MS = 1500;
export const SAVE_MAX_MS = 10_000;
export const RETRY_MS = 15_000;
/** Antwortet der Server so lange nicht, gilt das Speichern als gescheitert (schwaches Netz vor Ort). */
export const SAVE_TIMEOUT_MS = 30_000;

export interface SaveBody {
  content: Game;
  meta: EditorMeta;
  revision: number;
}

export interface SaveResult {
  revision: number;
  updated_at: string;
}

/** Was der Store vom Server braucht; Tests geben eine Attrappe. */
export interface DraftClient {
  draft(gameId: string): Promise<DraftDto>;
  /** signal bricht den Abruf ab (Zeitlimit); Attrappen dürfen es ignorieren */
  saveDraft(gameId: string, body: SaveBody, signal?: AbortSignal): Promise<SaveResult>;
}

/** Client über die Api-Klasse (api.draft, api.saveDraft). */
export function draftClient(api: Api): DraftClient {
  return {
    draft: (gameId) => api.draft(gameId).then((d) => ({ ...d, meta: d.meta ?? {} })),
    saveDraft: (gameId, body, signal) => api.request<SaveResult>("PUT", `/games/${gameId}/draft`, body, { signal }),
  };
}

type SaveState = EditorState["save"];

export interface AutosaveHost {
  gameId: string;
  client: DraftClient;
  get(): Pick<EditorState, "game" | "meta" | "revision" | "saved" | "save">;
  set(patch: Partial<Pick<EditorState, "revision" | "saved" | "save">>): void;
  /** nach erfolgreichem Speichern, z. B. für die lokale Sicherung */
  onSaved?(sent: { game: Game; meta: EditorMeta }, result: SaveResult): void;
  /** Seite wird verlassen oder verborgen: letzter Moment für die lokale Sicherung */
  onLeave?(): void;
  now?: () => number;
}

export interface Autosave {
  /** nach einer Änderung: Timer stellen */
  schedule(): void;
  /** sofort speichern; läuft gerade eines, wird danach noch einmal gespeichert */
  saveNow(): Promise<void>;
  /** „Erneut versuchen“ nach Fehler oder offline */
  retry(): Promise<void>;
  isDirty(): boolean;
  dispose(): void;
}

export function isDirty(s: Pick<EditorState, "game" | "meta" | "saved">): boolean {
  return s.game !== s.saved.game || s.meta !== s.saved.meta;
}

/** Zeitlimit-Fehler: kein Netzfehler, aber für die Person dasselbe („offline“). */
class SaveTimeout extends Error {}

export function createAutosave(host: AutosaveHost): Autosave {
  const now = host.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let firstDirtyAt: number | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  const save = (patch: Partial<SaveState>) => host.set({ save: { ...host.get().save, ...patch } });
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  function schedule(): void {
    const { status } = host.get().save;
    // Konflikt und abgelaufene Anmeldung löst die Person auf; offline wiederholt der Timer.
    if (status === "conflict" || status === "unauthorized") return;
    if (!isDirty(host.get())) return;
    firstDirtyAt ??= now();
    if (status === "saved" || status === "error") save({ status: "pending" });
    if (status === "offline") return;
    clear();
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, firstDirtyAt + SAVE_MAX_MS - now()));
    timer = setTimeout(() => void saveNow(), delay);
  }

  async function run(): Promise<void> {
    clear();
    clearRetry();
    const s = host.get();
    if (!isDirty(s)) {
      if (s.save.status === "pending") save({ status: "saved" });
      return;
    }
    const sent = { game: s.game, meta: s.meta };
    save({ status: "saving", error: null });
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = host.client.saveDraft(host.gameId, { content: sent.game, meta: sent.meta, revision: s.revision }, abort.signal);
      // Hängt der Abruf, bricht das Zeitlimit ihn ab; Attrappen ohne Signal werden trotzdem verlassen.
      const limit = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          abort.abort();
          reject(new SaveTimeout("Der Server antwortet nicht. Dein Stand bleibt auf diesem Gerät, wir versuchen es gleich noch einmal."));
        }, SAVE_TIMEOUT_MS);
      });
      request.catch(() => undefined);
      const result = await Promise.race([request, limit]);
      firstDirtyAt = null;
      host.set({ revision: result.revision, saved: sent, save: { status: "saved", at: result.updated_at, error: null, conflict: null } });
      host.onSaved?.(sent, result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const theirs = (err.details.draft as DraftDto | null | undefined) ?? null;
        if (theirs && sameContent(theirs.content, sent.game) && sameContent(theirs.meta ?? {}, sent.meta ?? {})) {
          // Die eigene Anfrage kam doch noch an (nach einem Zeitlimit): derselbe Stand, kein Konflikt.
          firstDirtyAt = null;
          host.set({ revision: theirs.revision, saved: sent, save: { status: "saved", at: theirs.updated_at, error: null, conflict: null } });
          host.onSaved?.(sent, { revision: theirs.revision, updated_at: theirs.updated_at });
        } else save({ status: "conflict", conflict: theirs });
      } else if (err instanceof ApiError && err.status === 401) {
        save({ status: "unauthorized" });
      } else if (err instanceof SaveTimeout || (err instanceof ApiError && err.status === 0)) {
        save({ status: "offline", error: (err as Error).message });
        retryTimer = setTimeout(() => void retry(), RETRY_MS);
      } else {
        save({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function saveNow(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    const { status } = host.get().save;
    if (status === "conflict" || status === "unauthorized") return;
    running = (async () => {
      await run();
      // Wer „jetzt speichern“ will (Verlassen, Veröffentlichen), bekommt den neuesten Stand gesichert.
      while (again && host.get().save.status === "saved" && isDirty(host.get())) {
        again = false;
        await run();
      }
    })().finally(() => {
      running = null;
      again = false;
      // Während des Speicherns kam eine weitere Änderung: nach Zeitplan nachspeichern.
      if (isDirty(host.get()) && host.get().save.status === "saved") schedule();
    });
    return running;
  }

  async function retry(): Promise<void> {
    clearRetry();
    const { status } = host.get().save;
    if (status === "offline" || status === "error") save({ status: "pending" });
    return saveNow();
  }

  const onOnline = () => void retry();
  const onHide = () => {
    if (document.visibilityState !== "hidden") return;
    host.onLeave?.();
    void saveNow();
  };
  const onPageHide = () => {
    host.onLeave?.();
    void saveNow();
  };
  const win = globalThis.window as Window | undefined;
  win?.addEventListener("online", onOnline);
  win?.addEventListener("pagehide", onPageHide);
  globalThis.document?.addEventListener("visibilitychange", onHide);

  return {
    schedule,
    saveNow,
    retry,
    isDirty: () => isDirty(host.get()),
    dispose() {
      clear();
      clearRetry();
      win?.removeEventListener("online", onOnline);
      win?.removeEventListener("pagehide", onPageHide);
      globalThis.document?.removeEventListener("visibilitychange", onHide);
    },
  };
}
