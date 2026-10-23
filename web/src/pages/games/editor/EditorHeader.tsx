/**
 * Paket A: Kopf des Baukastens – Pfad, Titel (direkt bearbeitbar), Speicherstand, Rückgängig und
 * Wiederholen, „Probelauf“ und „Veröffentlichen“ (beide führen in den Bereich Veröffentlichen, der
 * Knopf ist nie ausgegraut) und das Menü „Weitere“. Bleibt beim Rollen oben stehen.
 */

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { saveJson } from "../../../lib/download.ts";
import { jumpTo } from "../../../lib/editor/jump.ts";
import { editor, useEditor, useTextField } from "../../../lib/editor/store.ts";
import { readText } from "../../../lib/editor/text.ts";
import type { EditorState } from "../../../lib/editor/types.ts";
import { href, setQuery } from "../../../lib/router.ts";
import { api, errorText, notify } from "../../../lib/session.ts";
import { Dialog, Link, confirm } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { SaveStatus } from "./SaveStatus.tsx";
import { IssueList } from "./ui/IssueList.tsx";

/** Zähler am Knopf „Veröffentlichen“: nur Fehler und Warnungen, ausgeblendete nicht. */
export function publishCounter(issues: EditorState["issues"], dismissed: string[] = []): { errors: number; warnings: number } {
  const hidden = new Set(dismissed);
  const out = { errors: 0, warnings: 0 };
  for (const i of issues) {
    if (hidden.has(i.id)) continue;
    if (i.severity === "error") out.errors++;
    else if (i.severity === "warning") out.warnings++;
  }
  return out;
}

/** Rückgängig oder Wiederholen mit Meldung; springt zur betroffenen Stelle, wenn der Schritt eine kennt. */
export function runHistory(what: "undo" | "redo"): void {
  const store = editor.get().current;
  const entry = what === "undo" ? store?.undo() : store?.redo();
  if (!entry) return;
  notify(`${what === "undo" ? "Rückgängig" : "Wiederholt"}: ${entry.label}`);
  if (entry.focus) jumpTo(entry.focus);
}

export const SHORTCUTS: [string, string][] = [
  ["Strg+S", "jetzt speichern"],
  ["Strg+Z", "rückgängig"],
  ["Strg+Umschalt+Z, Strg+Y", "wiederholen"],
  ["Alt+Bild↑ / Alt+Bild↓", "vorige / nächste Station"],
  ["Alt+↑ / Alt+↓", "Block, Tipp oder Regelbaustein verschieben"],
  ["Leertaste am ≡", "Sortieren starten und beenden"],
  ["Entf", "ausgewählten Marker oder Block löschen (mit Rückgängig)"],
  ["Pfeiltasten / Umschalt+Pfeil", "ausgewählten Marker 1 m / 10 m verschieben"],
  ["Enter / Rücktaste / Esc", "beim Zeichnen: Fläche beenden / letzte Ecke weg / abbrechen"],
];

export function EditorHeader({
  gameId,
  narrow,
  onConflict,
  onReload,
}: {
  gameId: string;
  /** schmal: Speicherstand und Veröffentlichen stehen in der unteren Leiste */
  narrow: boolean;
  onConflict: () => void;
  /** nach „Entwurf verwerfen“: Baukasten neu öffnen */
  onReload: () => void;
}) {
  const s = useEditor();
  const store = editor.get().current;
  const title = useTextField("/meta/title", "Titel geändert", { required: true });
  const [menu, setMenu] = useState(false);
  const [keys, setKeys] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const counter = publishCounter(s.issues, s.meta.dismissed);
  const undoTop = s.undo[s.undo.length - 1];
  const redoTop = s.redo[s.redo.length - 1];
  const name = readText(s.game.meta?.title as never, s.lang) || "Spiel";

  // Menü schließt bei Klick daneben und mit Esc.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const exportDraft = () => {
    setMenu(false);
    if (counter.errors) notify(`Der Entwurf hat ${counter.errors === 1 ? "einen Fehler" : `${counter.errors} Fehler`}. Die Datei lässt sich so erst nach dem Beheben wieder importieren.`, "warn");
    saveJson(s.game, `${s.game.id || gameId}-entwurf.json`);
  };

  const toggleExpert = () => {
    setMenu(false);
    const on = !s.expert;
    store?.setExpert(on);
    setQuery({ experte: on ? "1" : null });
  };

  const discard = async () => {
    setMenu(false);
    const answer = await confirm({
      title: "Entwurf verwerfen?",
      body: <p>Der Entwurf wird auf Version {s.latestVersion} zurückgesetzt. Alle Änderungen seit dem Veröffentlichen gehen verloren – auch mit Rückgängig sind sie dann weg.</p>,
      confirm: "Entwurf verwerfen",
    });
    if (!answer.ok) return;
    try {
      await api.discardDraft(gameId);
      // Nichts mehr speichern und keine lokale Sicherung zurücklassen, sonst lebt der Entwurf wieder auf.
      store?.abandon();
      notify(`Entwurf verworfen. Version ${s.latestVersion} ist jetzt dein Entwurf.`, "ok");
      onReload();
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  const publishTo = href("editorSection", { gameId, section: "veroeffentlichen" });

  return (
    <header class="editor-head">
      <nav class="crumbs" aria-label="Pfad">
        <Link to={href("games")}>Spiele</Link>
        <span aria-hidden="true">›</span>
        <Link to={href("game", { gameId })}>{name}</Link>
      </nav>
      <div class="editor-head-row">
        <div class="editor-title-block" data-objekt="spiel">
          <span class="label">Baukasten</span>
          <div class="editor-title-wrap" data-feld="meta.title">
            <input
              class="editor-title"
              aria-label="Titel des Spiels"
              placeholder="Titel des Spiels"
              value={title.value}
              aria-invalid={title.issues.some((i) => i.severity === "error") || undefined}
              aria-describedby={title.issues.length ? "editor-title-meldungen" : undefined}
              onInput={(e) => title.set(e.currentTarget.value)}
              onBlur={title.blur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <Icon name="edit" />
          </div>
          <IssueList id="editor-title-meldungen" issues={title.issues} />
        </div>
        <div class="editor-tools">
          {!narrow && <SaveStatus save={s.save} backup={s.backup} who={s.save.conflict?.updated_by?.name} onRetry={() => void store?.retrySave()} onConflict={onConflict} />}
          <span class="row nowrap" role="group" aria-label="Verlauf">
            <button type="button" class="btn small" disabled={!undoTop} title={undoTop ? `Rückgängig: ${undoTop.label} (Strg+Z)` : "Nichts rückgängig zu machen"} aria-keyshortcuts="Control+Z" onClick={() => runHistory("undo")}>
              <span aria-hidden="true">↶</span>
              <span class="sr-only">Rückgängig{undoTop ? `: ${undoTop.label}` : ""}</span>
            </button>
            <button type="button" class="btn small" disabled={!redoTop} title={redoTop ? `Wiederholen: ${redoTop.label} (Strg+Umschalt+Z)` : "Nichts zu wiederholen"} aria-keyshortcuts="Control+Shift+Z Control+Y" onClick={() => runHistory("redo")}>
              <span aria-hidden="true">↷</span>
              <span class="sr-only">Wiederholen{redoTop ? `: ${redoTop.label}` : ""}</span>
            </button>
          </span>
          {!narrow && (
            <>
              <Link to={href("editorSection", { gameId, section: "veroeffentlichen" }, { probelauf: "1" })} class="btn">
                <Icon name="play" /> Probelauf
              </Link>
              <Link to={publishTo} class="btn primary">
                Veröffentlichen
                {counter.errors > 0 && (
                  <span class="count" aria-label={`${counter.errors} Fehler`}>
                    ✗ {counter.errors}
                  </span>
                )}
                {!counter.errors && counter.warnings > 0 && (
                  <span class="count" aria-label={`${counter.warnings} Warnungen`}>
                    ! {counter.warnings}
                  </span>
                )}
              </Link>
            </>
          )}
          <div class="menu" ref={menuRef}>
            <button type="button" class="btn small" aria-haspopup="menu" aria-expanded={menu} aria-label="Weitere Aktionen" onClick={() => setMenu(!menu)}>
              <span aria-hidden="true">⋯</span>
            </button>
            {menu && (
              <ul class="menu-list card" role="menu">
                <li role="none">
                  <Link role="menuitem" to={href("game", { gameId })} onClick={() => setMenu(false)}>
                    Übersicht mit Lösungen
                  </Link>
                </li>
                <li role="none">
                  <Link role="menuitem" to={href("game", { gameId }, { tab: "versionen" })} onClick={() => setMenu(false)}>
                    Versionen
                  </Link>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" onClick={exportDraft}>
                    Als Datei exportieren
                  </button>
                </li>
                <li role="none">
                  <Link role="menuitem" to={href("onSite", { gameId })} onClick={() => setMenu(false)}>
                    Vor Ort am Handy öffnen
                  </Link>
                </li>
                <li role="none">
                  <button type="button" role="menuitemcheckbox" aria-checked={s.expert} onClick={toggleExpert}>
                    Expertenansicht {s.expert ? "aus" : "an"}
                  </button>
                </li>
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setKeys(true);
                    }}
                  >
                    Tastenkürzel
                  </button>
                </li>
                {s.latestVersion !== null && (
                  <li role="none">
                    <button type="button" role="menuitem" onClick={() => void discard()}>
                      Entwurf verwerfen
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Dialog open={keys} title="Tastenkürzel" onClose={() => setKeys(false)}>
        <dl class="kv">
          {SHORTCUTS.map(([key, what]) => (
            <Fragment key={key}>
              <dt class="keep-case">{key}</dt>
              <dd>{what}</dd>
            </Fragment>
          ))}
        </dl>
        <div class="form-actions">
          <button type="button" class="btn" onClick={() => setKeys(false)}>
            Schließen
          </button>
        </div>
      </Dialog>
    </header>
  );
}
