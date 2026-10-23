/**
 * Paket A: Zustand eines geöffneten Spiels im Baukasten. Aufgebaut auf createStore (Abonnenten,
 * set mit Patch), ergänzt um Verlauf (Snapshot je Änderung per structuredClone, 200 Schritte,
 * Tipp-Schritte innerhalb 1 s verschmelzen), Prüfung (300 ms nach der Änderung), automatisches
 * Speichern (autosave.ts) und lokale Sicherung (local.ts). Ein Store je Spiel; das Modul-Singleton
 * `editor` hält den aktuellen, die Hooks lesen daraus.
 */

import { useEffect, useReducer, useRef } from "preact/hooks";
import { ApiError } from "../api.ts";
import { saveJson } from "../download.ts";
import { createStore, useStore, type Store } from "../store.ts";
import { createAutosave, draftClient, type Autosave, type DraftClient } from "./autosave.ts";
import { backupDiffers, clearBackup, keepOnlyBackup, readBackup, writeBackup } from "./local.ts";
import { getAt, lastKey, parentPointer, prune, removeAt, setAt } from "./paths.ts";
import { renumberFragments } from "./references.ts";
import { readText, writeText } from "./text.ts";
import type { DraftDto, EditorIssue, EditorMeta, EditorState, FieldAddress, Game, HistoryEntry, JsonPointer, Station } from "./types.ts";
import { issuesAt, validateDraft } from "./validation.ts";

export type { EditorState, HistoryEntry, SaveStatus } from "./types.ts";

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;
export const VALIDATE_DELAY_MS = 300;

export interface EditorStore extends Store<EditorState> {
  /** Eine Änderung: mutate arbeitet auf Kopien; label ist der Rückgängig-Text („Station „Baum“ verschoben“). */
  update(label: string, mutate: (game: Game, meta: EditorMeta) => void, opts?: { coalesce?: string; focus?: FieldAddress; metaOnly?: boolean }): void;
  /** Kurzform für ein Feld; value undefined entfernt das Feld und räumt den Elternknoten auf. */
  setField(path: JsonPointer, value: unknown, label: string, opts?: { coalesce?: boolean }): void;
  undo(): HistoryEntry | null;
  redo(): HistoryEntry | null;
  touch(path: JsonPointer): void;
  saveNow(): Promise<void>;
  /** Nach Fehler oder offline noch einmal speichern. */
  retrySave(): Promise<void>;
  /** Konflikt auflösen: theirs = Server-Stand laden (eigener Stand vorher als Datei), mine = überschreiben. */
  resolveConflict(choice: "theirs" | "mine"): Promise<void>;
  /** Entwurf durch anderen Inhalt ersetzen (Version wiederherstellen, Datei importieren, Entwurf verwerfen). */
  replace(game: Game, meta: EditorMeta, label: string): void;
  dismissIssue(id: string): void;
  setExpert(on: boolean): void;
  /** Alle Meldungen an den Feldern zeigen (vor Veröffentlichen/Probelauf). */
  showAllIssues(on: boolean): void;
  /** Prüfung sofort statt nach 300 ms. */
  validateNow(): EditorIssue[];
  /** Lokale Sicherung vom Öffnen übernehmen bzw. verwerfen. */
  applyBackup(): Promise<void>;
  discardBackup(): void;
  close(): void;
}

export interface EditorInit {
  gameId: string;
  game: Game;
  meta?: EditorMeta;
  revision?: number;
  baseVersion?: number | null;
  latestVersion?: number | null;
  savedAt?: string | null;
  lastEditor?: EditorState["lastEditor"];
  /** Server-Zugang; ohne ihn wird nicht gespeichert (Tests, Stubs anderer Pakete). */
  client?: DraftClient;
  /** Prüfung; Standard validateDraft */
  validate?: (game: Game, meta: EditorMeta) => EditorIssue[];
  /** lokale Sicherung schreiben (Standard ja) */
  localBackup?: boolean;
  /** eigenen Stand als Datei sichern, bevor der fremde übernommen wird */
  exportFile?: (game: Game, filename: string) => void;
  now?: () => number;
}

/**
 * Schnappschuss für Verlauf und Mutation. Spiele sind reines JSON; der JSON-Umweg ist in V8
 * rund dreimal schneller als structuredClone (270 KB: 3,7 ms statt 10,8 ms) – das hält eine
 * Änderung an 200 Stationen unter 10 ms.
 */
export function cloneGame<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return structuredClone(value);
  }
}

/** Nach dem Entfernen eines Felds: leere Eltern bis zum nächsten Listeneintrag oder Pflichtobjekt mitnehmen. */
function pruneUp(game: Game, path: JsonPointer): void {
  for (let parent = parentPointer(path); parent; parent = parentPointer(parent)) {
    if (/^\d+$/.test(lastKey(parent))) return;
    if (prune(getAt(game, parent), parent) !== undefined) return;
    removeAt(game, parent);
  }
}

/** Billige Invarianten nach jeder Mutation: Codeteile lückenlos, Sprache nie leer. */
export function normalizeGame(game: Game, lang: string): void {
  if (Array.isArray(game.fragments)) renumberFragments(game);
  if (game.meta && typeof game.meta === "object" && !game.meta.languages?.length) game.meta.languages = [lang];
}

/** Ein Feld gilt als berührt, wenn es selbst, ein Teil davon oder sein Behälter berührt wurde. */
export function isTouched(touched: ReadonlySet<JsonPointer>, path: JsonPointer): boolean {
  if (touched.has(path)) return true;
  for (const t of touched) if (t.startsWith(`${path}/`) || path.startsWith(`${t}/`)) return true;
  return false;
}

/** Meldungen, die ein Formularfeld zeigen darf: nicht ausgeblendet und (berührt oder „alle zeigen“). */
export function visibleIssuesAt(state: EditorState, target: JsonPointer | FieldAddress): EditorIssue[] {
  const hidden = new Set(state.meta.dismissed ?? []);
  return issuesAt(state.issues, target).filter((i) => !hidden.has(i.id) && (state.showAll || isTouched(state.touched, i.at.path)));
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-").slice(0, 19);

export function createEditorStore(init: EditorInit): EditorStore {
  const now = init.now ?? (() => Date.now());
  const validate = init.validate ?? validateDraft;
  const meta = init.meta ?? {};
  const lang = init.game?.meta?.languages?.[0] ?? "de";
  const base = createStore<EditorState>({
    gameId: init.gameId,
    game: init.game,
    meta,
    lang,
    revision: init.revision ?? 0,
    baseVersion: init.baseVersion ?? null,
    latestVersion: init.latestVersion ?? null,
    saved: { game: init.game, meta },
    save: { status: "saved", at: init.savedAt ?? null, error: null, conflict: null },
    undo: [],
    redo: [],
    issues: [],
    touched: new Set(),
    showAll: false,
    expert: false,
    backup: null,
    pendingBackup: null,
    lastEditor: init.lastEditor ?? null,
  });

  let validateTimer: ReturnType<typeof setTimeout> | null = null;

  const backup = (): void => {
    if (init.localBackup === false) return;
    const s = base.get();
    base.set({ backup: writeBackup(s.gameId, { revision: s.revision, game: s.game, meta: s.meta, at: new Date(now()).toISOString() }) });
  };

  const validateNow = (): EditorIssue[] => {
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = null;
    const s = base.get();
    const issues = validate(s.game, s.meta);
    base.set({ issues });
    return issues;
  };

  const autosave: Autosave | null = init.client
    ? createAutosave({
        gameId: init.gameId,
        client: init.client,
        get: () => base.get(),
        set: (patch) => base.set(patch),
        onSaved: () => {
          const s = base.get();
          if (s.game === s.saved.game && s.meta === s.saved.meta) clearBackup(s.gameId);
          else backup();
        },
        now,
      })
    : null;

  /** Nach jeder Änderung: Prüfung und Sicherung nach 300 ms, Speichern nach Zeitplan. */
  const afterChange = (): void => {
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = setTimeout(() => {
      validateNow();
      // Schon gespeichert (Strg+S direkt nach der Änderung): keine Sicherung zurücklassen.
      const s = base.get();
      if (s.game === s.saved.game && s.meta === s.saved.meta) {
        if (init.localBackup !== false) clearBackup(s.gameId);
      } else backup();
    }, VALIDATE_DELAY_MS);
    autosave?.schedule();
  };

  const apply = (game: Game, meta: EditorMeta, patch: Partial<EditorState> = {}): void => {
    base.set({ game, meta, lang: game?.meta?.languages?.[0] ?? base.get().lang, ...patch });
    afterChange();
  };

  const store: EditorStore = {
    ...base,

    update(label, mutate, opts = {}) {
      const s = base.get();
      const game = cloneGame(s.game);
      const meta = cloneGame(s.meta);
      mutate(game, meta);
      normalizeGame(game, s.lang);
      if (opts.metaOnly) return apply(game, meta);
      const at = now();
      const top = s.undo[s.undo.length - 1];
      let undo: HistoryEntry[];
      if (opts.coalesce && top && top.coalesce === opts.coalesce && at - top.at < COALESCE_MS) {
        // Tipp-Schritt: der Eintrag behält den Stand vor dem ersten Zeichen, das Zeitfenster rückt mit.
        undo = [...s.undo.slice(0, -1), { ...top, label, at, focus: opts.focus ?? top.focus }];
      } else {
        undo = [...s.undo, { label, game: s.game, meta: s.meta, at, coalesce: opts.coalesce, focus: opts.focus }].slice(-HISTORY_LIMIT);
      }
      apply(game, meta, { undo, redo: [] });
    },

    setField(path, value, label, opts = {}) {
      store.update(
        label,
        (game) => {
          if (value === undefined) {
            removeAt(game, path);
            pruneUp(game, path);
          } else setAt(game, path, value);
        },
        { coalesce: opts.coalesce ? path : undefined },
      );
    },

    undo() {
      const s = base.get();
      const entry = s.undo[s.undo.length - 1];
      if (!entry) return null;
      const redo: HistoryEntry = { label: entry.label, game: s.game, meta: s.meta, at: now(), focus: entry.focus };
      apply(entry.game, entry.meta, { undo: s.undo.slice(0, -1), redo: [...s.redo, redo] });
      return entry;
    },

    redo() {
      const s = base.get();
      const entry = s.redo[s.redo.length - 1];
      if (!entry) return null;
      const undo: HistoryEntry = { label: entry.label, game: s.game, meta: s.meta, at: now(), focus: entry.focus };
      apply(entry.game, entry.meta, { redo: s.redo.slice(0, -1), undo: [...s.undo, undo].slice(-HISTORY_LIMIT) });
      return entry;
    },

    touch(path) {
      const s = base.get();
      if (s.touched.has(path)) return;
      base.set({ touched: new Set([...s.touched, path]) });
    },

    saveNow: () => autosave?.saveNow() ?? Promise.resolve(),
    retrySave: () => autosave?.retry() ?? Promise.resolve(),

    async resolveConflict(choice) {
      const s = base.get();
      const theirs = s.save.conflict;
      if (!theirs) return;
      if (choice === "theirs") {
        (init.exportFile ?? saveJson)(s.game, `${s.gameId}-entwurf-${stamp(new Date(now()))}.json`);
        const game = theirs.content as Game;
        const meta = theirs.meta ?? {};
        base.set({
          game,
          meta,
          lang: game?.meta?.languages?.[0] ?? s.lang,
          revision: theirs.revision,
          saved: { game, meta },
          save: { status: "saved", at: theirs.updated_at, error: null, conflict: null },
          undo: [],
          redo: [],
          lastEditor: theirs.updated_by ? { ...theirs.updated_by, at: theirs.updated_at } : s.lastEditor,
        });
        validateNow();
        clearBackup(s.gameId);
        return;
      }
      base.set({ revision: theirs.revision, save: { ...s.save, status: "pending", conflict: null } });
      await store.saveNow();
    },

    replace(game, meta, label) {
      const s = base.get();
      const undo = [...s.undo, { label, game: s.game, meta: s.meta, at: now() }].slice(-HISTORY_LIMIT);
      normalizeGame(game, s.lang);
      apply(game, meta, { undo, redo: [] });
    },

    dismissIssue(id) {
      store.update("Hinweis ausgeblendet", (_game, m) => {
        m.dismissed = [...new Set([...(m.dismissed ?? []), id])];
      }, { metaOnly: true });
    },

    setExpert: (on) => base.set({ expert: on }),
    showAllIssues: (on) => base.set({ showAll: on }),
    validateNow,

    async applyBackup() {
      const s = base.get();
      const b = s.pendingBackup;
      if (!b) return;
      base.set({ pendingBackup: null });
      store.replace(b.game, b.meta ?? {}, "Lokale Sicherung übernommen");
      await store.saveNow();
    },

    discardBackup() {
      const s = base.get();
      base.set({ pendingBackup: null });
      clearBackup(s.gameId);
    },

    close() {
      if (validateTimer) clearTimeout(validateTimer);
      validateTimer = null;
      autosave?.dispose();
      if (editor.get().current === store) editor.set({ current: null });
    },
  };

  validateNow();
  return store;
}

export const editor: Store<{ current: EditorStore | null }> = createStore<{ current: EditorStore | null }>({ current: null });

export function closeEditor(): void {
  editor.get().current?.close();
}

/**
 * Lädt den Entwurf; gibt es keinen (404), entsteht er aus der neuesten Version (PUT mit revision 0).
 * Danach: Felder aus einer Vorlage gelten als berührt, eine jüngere lokale Sicherung wird angeboten.
 */
export async function openEditor(gameId: string, opts: { client?: DraftClient } = {}): Promise<EditorStore> {
  closeEditor();
  // session.ts liest beim Laden document.baseURI; der Store selbst bleibt ohne Browser nutzbar.
  const { api } = await import("../session.ts");
  const client = opts.client ?? draftClient(api);
  const detail = await api.game(gameId);
  let draft: DraftDto;
  try {
    draft = await client.draft(gameId);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    const content = (detail.content as Game | null) ?? null;
    if (!content) throw new Error("Dieses Spiel hat noch keinen Inhalt. Bitte eine Vorlage wählen oder eine Datei importieren.");
    const r = await client.saveDraft(gameId, { content, meta: {}, revision: 0 });
    draft = { gameId, revision: r.revision, content, meta: {}, base_version: detail.latest_version, updated_at: r.updated_at, updated_by: null };
  }
  const store = createEditorStore({
    gameId,
    game: draft.content as Game,
    meta: draft.meta ?? {},
    revision: draft.revision,
    baseVersion: draft.base_version,
    latestVersion: detail.latest_version,
    savedAt: draft.updated_at,
    lastEditor: draft.updated_by ? { ...draft.updated_by, at: draft.updated_at } : null,
    client,
  });
  if (store.get().meta.template) store.set({ touched: new Set(store.get().issues.map((i) => i.at.path)) });
  keepOnlyBackup(gameId);
  const backup = readBackup(gameId);
  if (backup) {
    const s = store.get();
    if (backup.revision >= draft.revision && backupDiffers(backup, s.game, s.meta)) store.set({ pendingBackup: backup });
    else clearBackup(gameId);
  }
  editor.set({ current: store });
  return store;
}

// Hooks für Komponenten

function currentStore(): EditorStore {
  const store = editor.get().current;
  if (!store) throw new Error("Kein Spiel im Baukasten geöffnet");
  return store;
}

/** Ganzer Zustand (Kopf, Checkliste); zeichnet bei jeder Änderung neu. */
export function useEditor(): EditorState {
  return useStore(currentStore());
}

/** Feinkörnig: zeichnet nur neu, wenn sich der gewählte Wert ändert (Standard Object.is). */
export function useEditorSelect<T>(select: (s: EditorState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = currentStore();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const value = select(store.get());
  const latest = useRef({ select, equal, value });
  latest.current = { select, equal, value };
  useEffect(
    () =>
      store.subscribe((s) => {
        const l = latest.current;
        if (!l.equal(l.value, l.select(s))) bump(0);
      }),
    [store],
  );
  return value;
}

export function shallowArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => Object.is(x, b[i])));
}

export function useStation(stationId: string): { station: Station; index: number } | null {
  return useEditorSelect(
    (s) => {
      const index = s.game.stations?.findIndex((st) => st?.id === stationId) ?? -1;
      return index >= 0 ? { station: s.game.stations[index]!, index } : null;
    },
    (a, b) => a?.station === b?.station && a?.index === b?.index,
  );
}

export function useFieldValue<T = unknown>(path: JsonPointer): T | undefined {
  return useEditorSelect((s) => getAt<T>(s.game, path));
}

/** Sprachtext an einem Pfad: Wert, Schreiben mit Verschmelzen, Berühren beim Verlassen, Meldungen am Feld. */
export function useTextField(path: JsonPointer, label: string, opts: { required?: boolean } = {}): { value: string; set(v: string): void; blur(): void; issues: EditorIssue[] } {
  const store = currentStore();
  const value = useEditorSelect((s) => readText(getAt(s.game, path) as never, s.lang));
  const issues = useEditorSelect((s) => visibleIssuesAt(s, path), shallowArray);
  return {
    value,
    set(next) {
      store.update(
        label,
        (game) => {
          const written = writeText(getAt(game, path) as never, game.meta?.languages?.[0] ?? "de", next);
          if (written === undefined && opts.required) setAt(game, path, { [game.meta?.languages?.[0] ?? "de"]: "" });
          else if (written === undefined) {
            removeAt(game, path);
            pruneUp(game, path);
          } else setAt(game, path, written);
        },
        { coalesce: path },
      );
    },
    blur: () => store.touch(path),
    issues,
  };
}

export function useIssuesAt(target: JsonPointer | FieldAddress): EditorIssue[] {
  return useEditorSelect((s) => visibleIssuesAt(s, target), shallowArray);
}
