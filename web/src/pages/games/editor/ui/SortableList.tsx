/**
 * Paket A: Sortierbare Liste (Stationen, Takte, Tipps, Regelbausteine) ohne Ziehen als einzigen
 * Weg: Griff ≡ mit Leertaste (Sortieren starten/beenden) und Pfeiltasten, Alt+↑/↓ überall im
 * Eintrag, Knöpfe „Nach oben“/„Nach unten“, dazu Ziehen mit Maus und Finger über Pointer-Events.
 * Jeder Zug ruft onMove(from, to) einmal – ein Schritt im Verlauf; eine Live-Ansage nennt den Platz.
 */

import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";

/** Neue Liste mit dem Eintrag von from an Platz to. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

/** Zielplatz für eine Taste während des Sortierens; null, wenn die Taste nichts bewegt. */
export function moveKey(key: string, index: number, length: number): number | null {
  if (length < 2) return null;
  switch (key) {
    case "ArrowUp":
    case "ArrowLeft":
      return index > 0 ? index - 1 : null;
    case "ArrowDown":
    case "ArrowRight":
      return index < length - 1 ? index + 1 : null;
    case "Home":
      return index > 0 ? 0 : null;
    case "End":
      return index < length - 1 ? length - 1 : null;
    default:
      return null;
  }
}

/** Platz, an den ein gezogener Eintrag bei dieser Höhe fällt (Mitten der Einträge). */
export function dropIndex(mids: number[], y: number): number {
  let i = 0;
  while (i < mids.length && y > mids[i]!) i++;
  return Math.min(i, Math.max(0, mids.length - 1));
}

export function SortableList<T>({
  items,
  keyOf,
  nameOf,
  label,
  onMove,
  render,
  class: cls,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** Name für die Ansage („Baum: Platz 3 von 5“) */
  nameOf: (item: T) => string;
  /** aria-label der Liste */
  label: string;
  onMove: (from: number, to: number) => void;
  render: (item: T, index: number) => ComponentChildren;
  class?: string;
}) {
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);
  const n = items.length;

  const move = (from: number, to: number) => {
    onMove(from, to);
    setLive(`${nameOf(items[from]!)}: Platz ${to + 1} von ${n}`);
    // Der Fokus folgt dem Griff des verschobenen Eintrags.
    requestAnimationFrame(() => handles.current[to]?.focus());
  };

  const onHandleKey = (e: KeyboardEvent, index: number) => {
    const key = keyOf(items[index]!);
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (grabbed === key) {
        setGrabbed(null);
        setLive(`${nameOf(items[index]!)} liegt auf Platz ${index + 1} von ${n}.`);
      } else {
        setGrabbed(key);
        setLive(`${nameOf(items[index]!)} aufgenommen, Platz ${index + 1} von ${n}. Pfeiltasten verschieben, Leertaste beendet.`);
      }
      return;
    }
    if (e.key === "Escape" && grabbed) {
      e.preventDefault();
      setGrabbed(null);
      setLive("Sortieren beendet.");
      return;
    }
    if (grabbed !== key) return;
    const to = moveKey(e.key, index, n);
    if (to === null) return;
    e.preventDefault();
    move(index, to);
  };

  // Alt+↑/↓ irgendwo im Eintrag
  const onRowKey = (e: KeyboardEvent, index: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const to = moveKey(e.key, index, n);
    if (to === null) return;
    e.preventDefault();
    move(index, to);
  };

  const drag = useRef<{ from: number; mids: number[] } | null>(null);
  const onPointerDown = (e: PointerEvent, index: number) => {
    if (e.button !== 0 || n < 2) return;
    const mids = rows.current.slice(0, n).map((el) => {
      const r = el?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : 0;
    });
    drag.current = { from: index, mids };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragOver(index);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    e.preventDefault();
    setDragOver(dropIndex(drag.current.mids, e.clientY));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { from } = drag.current;
    const to = dragOver;
    drag.current = null;
    setDragOver(null);
    if (to !== null && to !== from) move(from, to);
  };

  return (
    <ol class={`sortable${cls ? ` ${cls}` : ""}`} aria-label={label}>
      {items.map((item, index) => {
        const key = keyOf(item);
        const name = nameOf(item);
        return (
          <li
            key={key}
            ref={(el) => {
              rows.current[index] = el;
            }}
            class={`sortable-row${grabbed === key ? " grabbed" : ""}${dragOver === index && drag.current ? " drop" : ""}`}
            onKeyDown={(e) => onRowKey(e, index)}
          >
            <button
              type="button"
              class="btn small ghost sortable-handle"
              ref={(el) => {
                handles.current[index] = el;
              }}
              aria-label={`${name}: Platz ${index + 1} von ${n}. Leertaste startet das Sortieren`}
              aria-pressed={grabbed === key}
              onKeyDown={(e) => onHandleKey(e, index)}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span aria-hidden="true">≡</span>
            </button>
            <div class="sortable-body min0">{render(item, index)}</div>
            <span class="sortable-buttons row nowrap">
              <button type="button" class="btn small ghost" aria-label={`${name} nach oben`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                <span aria-hidden="true">↑</span>
              </button>
              <button type="button" class="btn small ghost" aria-label={`${name} nach unten`} disabled={index === n - 1} onClick={() => move(index, index + 1)}>
                <span aria-hidden="true">↓</span>
              </button>
            </span>
          </li>
        );
      })}
      <li class="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {live}
      </li>
    </ol>
  );
}
