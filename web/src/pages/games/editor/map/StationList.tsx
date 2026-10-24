/**
 * Paket B: Sortierbare Stationsliste in der Navigation des Baukastens (und auf der Karte, wenn die
 * Navigation eingeklappt ist). Reihenfolge = Nummer in App und Karte; das Finale trägt ★.
 * Sortieren: am Griff ≡ ziehen (Maus, Finger), Leertaste am Griff nimmt auf, Pfeile/Pos1/Ende
 * verschieben, Leertaste legt ab, Esc bricht ab; Alt+↑/↓ in der Zeile; Menü ⋯ mit „Nach oben“,
 * „Nach unten“, Duplizieren, Löschen. Ein Zug = ein Schritt im Verlauf, IDs bleiben.
 * Ohne Leaflet, damit die Navigation leicht bleibt.
 */

import { useRef, useState } from "preact/hooks";
import { editor, shallowArray, useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue } from "../../../../lib/editor/types.ts";
import { href, navigate } from "../../../../lib/router.ts";
import { notify } from "../../../../lib/session.ts";
import { Link } from "../../../../ui/components.tsx";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { stationState, type StationListProps } from "../EditorNav.tsx";
import { dropIndex, moveKey } from "../ui/SortableList.tsx";
import { duplicateStation, moveStation } from "./actions.ts";
import { Menu } from "./Menu.tsx";
import "./editor-map.css";

export interface ListRow {
  id: string;
  /** Platz im Spiel (stations[index]) */
  index: number;
  /** Laufnummer oder ★ beim Finale */
  number: string;
  name: string;
  hidden: boolean;
}

/** Zeilen in Spielreihenfolge mit Listenplatz; Lücken im Entwurf fallen weg. */
export function listRows(stations: unknown, lang: string): ListRow[] {
  if (!Array.isArray(stations)) return [];
  const out: ListRow[] = [];
  stations.forEach((s, index) => {
    const st = s as { id?: unknown; name?: unknown; visibility?: string; final?: boolean } | null;
    if (!st || typeof st !== "object" || typeof st.id !== "string") return;
    out.push({ id: st.id, index, number: st.final ? "★" : String(index + 1), name: readText(st.name as never, lang) || `Station ${index + 1}`, hidden: st.visibility === "hidden" });
  });
  return out;
}

const sameRows = (a: ListRow[], b: ListRow[]) =>
  a.length === b.length && a.every((r, i) => r.id === b[i]!.id && r.index === b[i]!.index && r.name === b[i]!.name && r.number === b[i]!.number && r.hidden === b[i]!.hidden);

const STATE_MARK = {
  error: { mark: "✗", text: "mit Fehler" },
  warning: { mark: "!", text: "mit Warnung" },
  ok: { mark: "✓", text: "in Ordnung" },
} as const;

/** Erste nicht ausgeblendete Meldung einer Station (Tooltip der Zeile). */
function firstIssue(issues: EditorIssue[], id: string, dismissed: string[]): string | undefined {
  const hidden = new Set(dismissed);
  return issues.find((i) => i.at.section === "stationen" && i.at.objectId === id && !hidden.has(i.id) && i.severity !== "hint")?.message;
}

export function moveStationInStore(rows: ListRow[], from: number, to: number): void {
  const store = editor.get().current;
  const row = rows[from];
  const target = rows[to];
  if (!store || !row || !target || from === to) return;
  store.update(`Station „${row.name}“ auf Platz ${to + 1} verschoben`, (g) => moveStation(g, row.index, target.index));
}

export function duplicateInStore(id: string, name: string): string | null {
  const store = editor.get().current;
  if (!store) return null;
  let created: string | null = null;
  store.update(`Station „${name}“ dupliziert`, (g) => {
    created = duplicateStation(g, id);
  });
  if (created) notify(`„${name} (Kopie)“ angelegt – 20 m daneben, mit neuen Codes.`, "ok");
  return created;
}

export function StationList({ gameId, currentStationId }: StationListProps) {
  const rows = useEditorSelect((s) => listRows(s.game.stations, s.lang), sameRows);
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const dismissed = useEditorSelect((s) => s.meta.dismissed ?? [], shallowArray);
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ from: number; mids: number[]; moved: boolean } | null>(null);
  const n = rows.length;

  if (!n) return <p class="small muted ed-stationlist-empty">Noch keine Stationen. Auf der Karte mit „+ Station“ anlegen.</p>;

  const move = (from: number, to: number) => {
    moveStationInStore(rows, from, to);
    setLive(`${rows[from]!.name}: Platz ${to + 1} von ${n}`);
    requestAnimationFrame(() => handles.current[to]?.focus());
  };

  const onHandleKey = (e: KeyboardEvent, i: number) => {
    const row = rows[i]!;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (grabbed === row.id) {
        setGrabbed(null);
        setLive(`${row.name} liegt auf Platz ${i + 1} von ${n}.`);
      } else {
        setGrabbed(row.id);
        setLive(`${row.name} aufgenommen, Platz ${i + 1} von ${n}. Pfeiltasten verschieben, Leertaste legt ab.`);
      }
      return;
    }
    if (e.key === "Escape" && grabbed) {
      e.preventDefault();
      e.stopPropagation();
      setGrabbed(null);
      setLive("Sortieren beendet.");
      return;
    }
    if (grabbed !== row.id) return;
    const to = moveKey(e.key, i, n);
    if (to === null) return;
    e.preventDefault();
    move(i, to);
  };

  const onRowKey = (e: KeyboardEvent, i: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const to = moveKey(e.key, i, n);
    if (to === null) return;
    e.preventDefault();
    move(i, to);
  };

  const onPointerDown = (e: PointerEvent, i: number) => {
    if (e.button !== 0 || n < 2) return;
    drag.current = {
      from: i,
      moved: false,
      mids: items.current.slice(0, n).map((el) => {
        const r = el?.getBoundingClientRect();
        return r ? r.top + r.height / 2 : 0;
      }),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    d.moved = true;
    setOver(dropIndex(d.mids, e.clientY));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    const to = over;
    setOver(null);
    if (d?.moved && to !== null && to !== d.from) move(d.from, to);
  };

  return (
    <div class="ed-stationlist-wrap">
      <ol class="ed-stationlist" aria-label="Stationen in Spielreihenfolge">
        {rows.map((r, i) => {
          const state = stationState(issues, r.id, dismissed);
          const m = STATE_MARK[state];
          const first = firstIssue(issues, r.id, dismissed);
          return (
            <li
              key={r.id}
              ref={(el) => {
                items.current[i] = el;
              }}
              class={`ed-st-row${grabbed === r.id ? " grabbed" : ""}${over === i && drag.current ? " drop" : ""}${r.id === currentStationId ? " current" : ""}`}
              onKeyDown={(e) => onRowKey(e, i)}
            >
              <button
                type="button"
                class="ed-st-handle"
                ref={(el) => {
                  handles.current[i] = el;
                }}
                aria-label={`${r.name}: Platz ${i + 1} von ${n}. Leertaste startet das Sortieren`}
                aria-pressed={grabbed === r.id}
                onKeyDown={(e) => onHandleKey(e, i)}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <span aria-hidden="true">≡</span>
              </button>
              <Link to={href("editorStation", { gameId, stationId: r.id })} class="ed-st-link" aria-current={r.id === currentStationId ? "page" : undefined} title={first}>
                <span class="num station-no" aria-hidden="true">
                  {r.number}
                </span>
                <span class="station-name">
                  <span class="sr-only">{r.number === "★" ? "Finale: " : `Station ${r.number}: `}</span>
                  {r.name}
                  {r.hidden && <span class="badge quiet">versteckt</span>}
                </span>
                <span class={`mark ${state}`} aria-label={m.text}>
                  {m.mark}
                </span>
              </Link>
              <Menu
                label={`Aktionen für „${r.name}“`}
                class="ed-st-menu"
                align="right"
                items={[
                  { label: "Nach oben", onSelect: () => move(i, i - 1), disabled: i === 0 },
                  { label: "Nach unten", onSelect: () => move(i, i + 1), disabled: i === n - 1 },
                  { label: "Auf der Karte zeigen", onSelect: () => navigate(href("editorSection", { gameId, section: "karte" }, { objekt: r.id })) },
                  { label: "Duplizieren", hint: "20 m daneben, neue Codes", onSelect: () => duplicateInStore(r.id, r.name) },
                  { label: "Löschen", onSelect: () => void deleteWithReferences("station", r.id, r.name) },
                ]}
              >
                <span aria-hidden="true">⋯</span>
              </Menu>
            </li>
          );
        })}
      </ol>
      <p class="small muted ed-stationlist-help">Ziehen am ≡ oder mit Leertaste und Pfeiltasten.</p>
      <p class="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {live}
      </p>
    </div>
  );
}
