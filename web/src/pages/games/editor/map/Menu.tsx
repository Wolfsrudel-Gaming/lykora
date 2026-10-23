/**
 * Paket B: Kleines Aufklappmenü (Werkzeuge der Karte, ⋯ an der Station). Knopf mit aria-expanded,
 * Liste mit role="menu"; Pfeiltasten wandern, Esc und Klick daneben schließen, der Fokus kehrt
 * zum Knopf zurück. Gleiche Klassen wie das Menü im Kopf des Baukastens.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface MenuItem {
  label: string;
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Häkchen (menuitemradio) */
  checked?: boolean;
}

export function Menu({ label, items, children, class: cls, align = "left" }: { label: string; items: MenuItem[]; children: ComponentChildren; class?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus());
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const all = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      all[e.key === "Home" ? 0 : all.length - 1]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div class={`menu ed-menu${cls ? ` ${cls}` : ""}`} ref={root} onKeyDown={open ? onKey : undefined}>
      <button ref={button} type="button" class="btn small" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {children}
      </button>
      {open && (
        <ul class={`menu-list card${align === "right" ? " right" : " left"}`} role="menu" aria-label={label}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
              >
                <span class="stack tight min0">
                  <span>{item.label}</span>
                  {item.hint && <small class="muted">{item.hint}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
