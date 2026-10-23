/**
 * Paket A: Rahmen des Baukastens unter /spiele/:gameId/baukasten[/<bereich>|/stationen/:id].
 * Öffnet den Entwurf (openEditor), zeigt Laden, Fehler und fehlende Rechte, hält die Tastenkürzel
 * (Strg+Z, Strg+Umschalt+Z, Strg+Y, Strg+S, Alt+Bild↑/↓), speichert beim Bereichswechsel, springt
 * zu ?feld= und setzt den Fokus auf die Überschrift des Bereichs. Drei Größen nach UX §5.3:
 * breit (Navigation · Inhalt), mittel (Symbolleiste · Inhalt), schmal (Auswahlfeld, untere Leiste).
 */

import type { ComponentType } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "../../../lib/api.ts";
import { isDirty } from "../../../lib/editor/autosave.ts";
import { focusField } from "../../../lib/editor/jump.ts";
import { editor, openEditor, shallowArray, useEditorSelect, type EditorStore } from "../../../lib/editor/store.ts";
import { readText } from "../../../lib/editor/text.ts";
import { SECTIONS, type EditorState, type FieldAddress, type Section } from "../../../lib/editor/types.ts";
import { countsBySection } from "../../../lib/editor/validation.ts";
import { formatAgo } from "../../../lib/format.ts";
import { can } from "../../../lib/roles.ts";
import { href, navigate, useLocation } from "../../../lib/router.ts";
import { currentOrg, session } from "../../../lib/session.ts";
import { useStore } from "../../../lib/store.ts";
import { ErrorNotice, Link, Loading, useMedia, useTitle } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { ConflictDialog } from "./ConflictDialog.tsx";
import { DeleteWithReferencesHost } from "./DeleteWithReferencesDialog.tsx";
import { EditorHeader, publishCounter, runHistory } from "./EditorHeader.tsx";
import { EditorNav, stationRows } from "./EditorNav.tsx";
import { ExpertPanel } from "./ExpertPanel.tsx";
import { LocalBackupDialog } from "./LocalBackupDialog.tsx";
import { OverviewSection } from "./OverviewSection.tsx";
import { SaveStatus } from "./SaveStatus.tsx";
import { SECTION_LOADERS, type SectionProps } from "./sections.ts";
import { MediaPickerHost } from "./ui/MediaPicker.tsx";
import "./editor.css";

export type Layout = "wide" | "medium" | "narrow";

/** Bereich aus der Adresse; unbekannt → Übersicht, „stationen“ ohne Station → Karte. */
export function sectionOf(raw: string | undefined, stationId?: string): Section {
  if (stationId) return "stationen";
  if (!raw || !(SECTIONS as string[]).includes(raw)) return "uebersicht";
  return raw === "stationen" ? "karte" : (raw as Section);
}

export type Shortcut = "undo" | "redo" | "save" | "prevStation" | "nextStation";

/** Tastenkürzel des Baukastens (Mac: ⌘ statt Strg); null für alle anderen Tasten. */
export function shortcutOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): Shortcut | null {
  const mod = e.ctrlKey || e.metaKey;
  // Autofill löst Tastenereignisse ohne key aus.
  if (typeof e.key !== "string") return null;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey) {
    if (key === "z") return e.shiftKey ? "redo" : "undo";
    if (key === "y" && !e.shiftKey) return "redo";
    if (key === "s" && !e.shiftKey) return "save";
  }
  if (e.altKey && !mod && !e.shiftKey) {
    if (e.key === "PageUp") return "prevStation";
    if (e.key === "PageDown") return "nextStation";
  }
  return null;
}

/**
 * Geht beim Schließen etwas verloren? Ja, wenn ungespeicherte Änderungen weder lokal gesichert sind
 * noch eine Sicherung sie retten kann: bei Konflikt, ohne Netz, abgelaufener Anmeldung oder Fehler
 * ersetzt eine Sicherung den Server nicht (beim nächsten Öffnen ist der Server weiter).
 */
export function leaveWarning(s: Pick<EditorState, "game" | "meta" | "saved" | "save" | "backup">): boolean {
  if (!isDirty(s)) return false;
  if (s.backup !== "ok") return true;
  return s.save.status === "conflict" || s.save.status === "unauthorized" || s.save.status === "error" || s.save.status === "offline";
}

/** Nachbarstation in Spielreihenfolge; null am Rand. */
export function neighbourStation(ids: string[], current: string | undefined, step: -1 | 1): string | null {
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return null;
  return ids[i + step] ?? null;
}

/** Jemand anderes hat den Entwurf in den letzten 5 Minuten gespeichert (UX §16.6). */
export function recentOtherEditor(last: { id: string; at: string } | null, me: string | undefined, now = Date.now()): boolean {
  if (!last || !me || last.id === me) return false;
  return now - new Date(last.at).getTime() < 5 * 60_000;
}

type Load = { kind: "loading" } | { kind: "ready" } | { kind: "forbidden" } | { kind: "missing" } | { kind: "error"; error: unknown };

export function EditorShell({ gameId, section: raw, stationId }: { gameId: string; section?: string; stationId?: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { current } = useStore(editor);
  const loc = useLocation();

  useEffect(() => {
    // Rollen ohne game.write sehen keinen Baukasten (UX §3); der Server prüft ohnehin.
    if (!can(currentOrg()?.role, "game.write")) {
      setLoad({ kind: "forbidden" });
      return;
    }
    let alive = true;
    setLoad({ kind: "loading" });
    openEditor(gameId)
      .then((store) => {
        if (!alive) return store.close();
        if (loc.query.get("experte") === "1") store.setExpert(true);
        setLoad({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 403) setLoad({ kind: "forbidden" });
        else if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
        else setLoad({ kind: "error", error });
      });
    return () => {
      alive = false;
      // Beim Verlassen noch speichern; die lokale Sicherung hält den Stand ohnehin.
      const store = editor.get().current;
      if (store && store.get().gameId === gameId) void store.saveNow().finally(() => store.close());
    };
  }, [gameId, attempt]);

  if (load.kind === "forbidden") {
    return (
      <div class="page narrow stack">
        <h1>Baukasten</h1>
        <p>Den Baukasten können nur Admins und Autorinnen und Autoren öffnen. Die Übersicht mit Lösungen steht allen offen.</p>
        <p>
          <Link to={href("game", { gameId })} class="btn">
            Zur Übersicht des Spiels
          </Link>
        </p>
      </div>
    );
  }
  if (load.kind === "missing") {
    return (
      <div class="page narrow stack">
        <h1>Spiel nicht gefunden</h1>
        <p>Vielleicht wurde es archiviert oder gehört zu einer anderen Organisation.</p>
        <p>
          <Link to={href("games")} class="btn">
            Zu den Spielen
          </Link>
        </p>
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div class="page narrow stack">
        <h1>Baukasten</h1>
        <ErrorNotice error={load.error} retry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }
  if (load.kind === "loading" || !current || current.get().gameId !== gameId) return <Loading text="Baukasten lädt …" />;
  return <EditorFrame store={current} gameId={gameId} section={sectionOf(raw, stationId)} stationId={stationId} onReload={() => setAttempt((n) => n + 1)} />;
}

function useLayout(): Layout {
  const wide = useMedia("(min-width: 1280px)");
  const narrow = useMedia("(max-width: 899px)");
  return wide ? "wide" : narrow ? "narrow" : "medium";
}

/** Höhe der App-Leiste und des Kopfs als CSS-Variablen, damit Kopf und Navigation darunter kleben. */
function useStickyOffsets(root: { current: HTMLElement | null }, head: { current: HTMLElement | null }): void {
  useEffect(() => {
    const el = root.current;
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      el.style.setProperty("--editor-top", `${topbar?.offsetHeight ?? 0}px`);
      el.style.setProperty("--editor-head", `${head.current?.offsetHeight ?? 0}px`);
    };
    const ro = new ResizeObserver(measure);
    if (topbar) ro.observe(topbar);
    if (head.current) ro.observe(head.current);
    measure();
    return () => ro.disconnect();
  }, []);
}

function EditorFrame({ store, gameId, section, stationId, onReload }: { store: EditorStore; gameId: string; section: Section; stationId?: string; onReload: () => void }) {
  const layout = useLayout();
  const loc = useLocation();
  const me = useStore(session).user?.id;
  const root = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [otherDismissed, setOtherDismissed] = useState(false);
  const title = useEditorSelect((s) => readText(s.game.meta?.title as never, s.lang));
  const status = useEditorSelect((s) => s.save.status);
  const expert = useEditorSelect((s) => s.expert);
  const lastEditor = useEditorSelect((s) => s.lastEditor);
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const dismissed = useEditorSelect((s) => s.meta.dismissed ?? [], shallowArray);
  const stationIds = useEditorSelect((s) => stationRows(s.game.stations, s.lang).map((r) => r.id), shallowArray);
  const counts = countsBySection(issues, dismissed);
  const feld = loc.query.get("feld");
  const objekt = loc.query.get("objekt");
  useTitle(`Baukasten: ${title || "Spiel"}`);
  useStickyOffsets(root, head);

  // Tastenkürzel im ganzen Baukasten, auch in Textfeldern: es gibt nur eine Rückgängig-Logik.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutOf(e);
      if (!action) return;
      // In Dialogen (Medien hochladen, Bestätigungen) bleibt die Taste beim Browser.
      if ((e.target as Element | null)?.closest?.("dialog")) return;
      if (action === "prevStation" || action === "nextStation") {
        const next = neighbourStation(stationIds, stationId, action === "prevStation" ? -1 : 1);
        if (!next) return;
        e.preventDefault();
        navigate(href("editorStation", { gameId, stationId: next }));
        return;
      }
      e.preventDefault();
      if (action === "save") void store.saveNow();
      else runHistory(action);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store, gameId, stationId, stationIds]);

  // Bereichswechsel: sofort speichern; ohne Sprungziel geht der Fokus auf die Überschrift.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (isDirty(store.get())) void store.saveNow();
    if (feld || objekt) return;
    // Nachgeladene Bereiche haben ihre Überschrift erst nach ein paar Augenblicken.
    let tries = 0;
    const timer = setInterval(() => {
      const h = content.current?.querySelector<HTMLElement>("h1, h2");
      if (h) {
        if (!h.hasAttribute("tabindex")) h.tabIndex = -1;
        h.focus();
      }
      if (h || ++tries >= 40) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [section, stationId]);

  // ?feld= (und ?objekt=): Feld suchen, sobald der Bereich gerendert ist; nachgeladene Bereiche brauchen kurz.
  useEffect(() => {
    if (!feld && !objekt) return;
    const address: FieldAddress = { section, objectId: stationId ?? objekt ?? undefined, field: feld ?? undefined, path: "" };
    let tries = 0;
    const timer = setInterval(() => {
      if (focusField(address, content.current ?? document) || ++tries >= 20) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [section, stationId, feld, objekt]);

  // Konflikt: der Dialog öffnet sich von selbst, „Ansehen“ im Kopf öffnet ihn wieder.
  useEffect(() => setConflictOpen(status === "conflict"), [status]);

  // Tab schließen: letzten Stand lokal sichern; warnen, wenn er weder gesichert noch auf dem Server ist.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      store.flushBackup();
      if (leaveWarning(store.get())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [store]);

  const narrow = layout === "narrow";
  const other = !otherDismissed && lastEditor && recentOtherEditor(lastEditor, me) ? lastEditor : null;

  return (
    <div class={`editor ${layout}`} ref={root}>
      <div class="editor-head-wrap" ref={head}>
        <EditorHeader gameId={gameId} narrow={narrow} onConflict={() => setConflictOpen(true)} onReload={onReload} />
        {narrow && <EditorNav gameId={gameId} section={section} stationId={stationId} counts={counts} mode="select" />}
      </div>
      {other && (
        <div class="notice warn row between editor-other" role="status">
          <span>
            {other.name} hat diesen Entwurf {formatAgo(other.at)} geändert. Wenn ihr gleichzeitig arbeitet, könnt ihr euch gegenseitig überschreiben.
          </span>
          <span class="row nowrap">
            <button type="button" class="btn small" onClick={() => setOtherDismissed(true)}>
              Trotzdem bearbeiten
            </button>
            <Link to={href("game", { gameId })} class="btn small ghost">
              Nur ansehen
            </Link>
          </span>
        </div>
      )}
      <div class="editor-body">
        {!narrow && <EditorNav gameId={gameId} section={section} stationId={stationId} counts={counts} mode={layout === "wide" ? "full" : "rail"} />}
        <div class="editor-content min0 stack loose" ref={content}>
          {section === "uebersicht" ? <OverviewSection gameId={gameId} /> : <SectionView section={section} gameId={gameId} stationId={stationId} />}
          {expert && <ExpertPanel gameId={gameId} />}
        </div>
      </div>
      {narrow && <BottomBar gameId={gameId} onConflict={() => setConflictOpen(true)} />}
      <ConflictDialog open={conflictOpen} onClose={() => setConflictOpen(false)} />
      <LocalBackupDialog />
      <MediaPickerHost gameId={gameId} />
      <DeleteWithReferencesHost />
    </div>
  );
}

/** Schmal: Speicherstand und Veröffentlichen in einer Leiste am unteren Rand. */
function BottomBar({ gameId, onConflict }: { gameId: string; onConflict: () => void }) {
  const save = useEditorSelect((s) => s.save);
  const backup = useEditorSelect((s) => s.backup);
  const counter = useEditorSelect(
    (s) => publishCounter(s.issues, s.meta.dismissed),
    (a, b) => a.errors === b.errors && a.warnings === b.warnings,
  );
  return (
    <div class="editor-bottom">
      <SaveStatus save={save} backup={backup} who={save.conflict?.updated_by?.name} onRetry={() => void editor.get().current?.retrySave()} onConflict={onConflict} />
      <Link to={href("editorSection", { gameId, section: "veroeffentlichen" })} class="btn primary small">
        Veröffentlichen
        {counter.errors > 0 && (
          <span class="count" aria-label={`${counter.errors} Fehler`}>
            ✗ {counter.errors}
          </span>
        )}
      </Link>
    </div>
  );
}

const loaded = new Map<Section, ComponentType<SectionProps>>();

/** Lädt den Bereich bei Bedarf (eigene Chunks der Pakete B–E) und zeigt ihn; Stationen ohne Treffer → Hinweis. */
function SectionView({ section, gameId, stationId }: { section: Exclude<Section, "uebersicht">; gameId: string; stationId?: string }) {
  const [view, setView] = useState<{ section: Section; Comp: ComponentType<SectionProps> } | null>(() => {
    const Comp = loaded.get(section);
    return Comp ? { section, Comp } : null;
  });
  const [error, setError] = useState<unknown>(null);
  const exists = useEditorSelect((s) => !stationId || (Array.isArray(s.game.stations) && s.game.stations.some((st) => st?.id === stationId)));

  useEffect(() => {
    const cached = loaded.get(section);
    if (cached) return setView({ section, Comp: cached });
    let alive = true;
    setError(null);
    SECTION_LOADERS[section]()
      .then((Comp) => {
        loaded.set(section, Comp);
        if (alive) setView({ section, Comp });
      })
      .catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [section]);

  if (stationId && !exists) {
    return (
      <div class="notice stack tight" role="status">
        <p>Diese Station gibt es im Entwurf nicht (mehr). Vielleicht wurde sie gelöscht – Strg+Z holt sie zurück.</p>
        <p>
          <Link to={href("editorSection", { gameId, section: "karte" })} class="btn small">
            <Icon name="map" /> Zur Karte
          </Link>
        </p>
      </div>
    );
  }
  if (error) return <ErrorNotice error={new Error("Bereich konnte nicht geladen werden. Netz prüfen und neu laden.")} retry={() => location.reload()} />;
  if (!view || view.section !== section) return <Loading />;
  const { Comp } = view;
  return <Comp gameId={gameId} stationId={stationId} />;
}
