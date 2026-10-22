/**
 * Paket A: Automatisches Speichern des Entwurfs. 1,5 s nach der letzten Änderung, spätestens
 * 10 s nach der ersten ungespeicherten; sofort beim Verlassen der Seite. Antworten des Servers:
 * 409 → Konflikt (fremder Stand im Zustand), 401 → Anmeldung abgelaufen, kein Netz → offline mit
 * Wiederholung bei „online“ und alle 15 s, sonst Fehler mit „Erneut versuchen“.
 */

import { ApiError, type Api } from "../api.ts";
import type { DraftDto, EditorMeta, EditorState, Game } from "./types.ts";

export const SAVE_DEBOUNCE_MS = 1500;
export const SAVE_MAX_MS = 10_000;
export const RETRY_MS = 15_000;

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
  saveDraft(gameId: string, body: SaveBody): Promise<SaveResult>;
}

/**
 * Client über die Api-Klasse (api.draft, api.saveDraft). types.ts führt EditorMeta noch als
 * Record<string, unknown> (TODO(A2) dort); bis es die Typen aus editor/types.ts nimmt, bleibt der Cast.
 */
export function draftClient(api: Api): DraftClient {
  return {
    draft: (gameId) => api.draft(gameId).then((d) => ({ ...d, meta: (d.meta ?? {}) as EditorMeta })),
    saveDraft: (gameId, body) => api.saveDraft(gameId, body as unknown as Parameters<Api["saveDraft"]>[1]),
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
    try {
      const result = await host.client.saveDraft(host.gameId, { content: sent.game, meta: sent.meta, revision: s.revision });
      firstDirtyAt = null;
      host.set({ revision: result.revision, saved: sent, save: { status: "saved", at: result.updated_at, error: null, conflict: null } });
      host.onSaved?.(sent, result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        save({ status: "conflict", conflict: (err.details.draft as DraftDto | undefined) ?? null });
      } else if (err instanceof ApiError && err.status === 401) {
        save({ status: "unauthorized" });
      } else if (err instanceof ApiError && err.status === 0) {
        save({ status: "offline", error: err.message });
        retryTimer = setTimeout(() => void retry(), RETRY_MS);
      } else {
        save({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  async function saveNow(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    const { status } = host.get().save;
    if (status === "conflict" || status === "unauthorized") return;
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        schedule();
      } else if (isDirty(host.get()) && host.get().save.status === "saved") {
        // Während des Speicherns kam eine weitere Änderung.
        schedule();
      }
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
    if (document.visibilityState === "hidden") void saveNow();
  };
  const onPageHide = () => void saveNow();
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
