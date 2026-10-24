/** Menü und Popover: schweben am Knopf, per Tastatur bedienbar. */

import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { menuKeyAction, typeaheadIndex } from "./a11y.ts";
import { Button } from "./Button.tsx";
import { useOutside } from "./hooks.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Floating, Portal } from "./overlay.tsx";

// Menü

export type MenuEntry =
  | { type?: "item"; id: string; label: string; icon?: IconName; shortcut?: string; danger?: boolean; disabled?: boolean; checked?: boolean; onSelect?: () => void }
  | { type: "separator"; id?: string }
  | { type: "heading"; id?: string; label: string };

function isItem(e: MenuEntry): e is Extract<MenuEntry, { id: string; label: string }> {
  return e.type === undefined || e.type === "item";
}

/**
 * Menü an einem Knopf. Tastatur: Pfeil unten/oben öffnen, Pfeile bewegen, Home/Ende, Buchstaben suchen,
 * Enter wählt, Escape schließt und gibt den Fokus an den Knopf zurück.
 */
export function Menu({
  items,
  label,
  icon = "more",
  children,
  align = "end",
  size = "md",
  variant = "ghost",
  side = "bottom",
}: {
  items: MenuEntry[];
  /** Name des Knopfs und des Menüs, z. B. „Weitere Aktionen“ */
  label: string;
  icon?: IconName;
  /** Text im Knopf; ohne Text ist es ein Symbolknopf */
  children?: ComponentChildren;
  align?: "start" | "end";
  size?: "sm" | "md";
  variant?: "ghost" | "secondary" | "primary";
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const menuId = useId();
  const real = items.filter(isItem);
  const disabled = real.map((i) => !!i.disabled);
  const labels = real.map((i) => i.label);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const openAt = (index: number) => {
    const first = disabled.findIndex((d) => !d);
    setActive(first < 0 ? 0 : index < 0 ? Math.max(0, disabled.lastIndexOf(false)) : Math.max(index, first));
    setOpen(true);
  };
  useOutside(open, [trigger, layer], () => close(false));
  // Fokus folgt dem aktiven Eintrag (Layout-Effekt: sofort nach dem Zeichnen, nicht erst nach dem nächsten Frame)
  useLayoutEffect(() => {
    if (!open) return;
    layer.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')[active]?.focus();
  }, [open, active]);

  const choose = (item: Extract<MenuEntry, { id: string; label: string }>) => {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  };
  /** Einträge im DOM; der Fokus ist die Wahrheit, falls Tasten schneller kommen als das Neuzeichnen. */
  const itemEls = () => [...(layer.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const goto = (index: number) => {
    setActive(index);
    itemEls()[index]?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const focused = itemEls().indexOf(document.activeElement as HTMLElement);
    const current = focused >= 0 ? focused : active;
    const action = menuKeyAction(e.key, current, real.length, disabled);
    if (action?.type === "move") goto(action.index);
    else if (action?.type === "close") close(action.refocus);
    else if (action?.type === "select") {
      const item = real[current];
      if (item) choose(item);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 700 ? e.key : typed.current.text + e.key, at: now };
      const hit = typeaheadIndex(labels, typed.current.text, current, disabled);
      if (hit !== null) goto(hit);
      return;
    } else return;
    e.preventDefault();
  };

  let itemIndex = -1;
  return (
    <>
      <Button
        innerRef={trigger}
        variant={variant}
        size={size}
        class={children ? undefined : "btn--icon"}
        aria-label={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openAt(0);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(-1);
          }
        }}
      >
        {children ? (
          <>
            {children}
            <Icon name="chevron-down" size={16} />
          </>
        ) : (
          <Icon name={icon} size={size === "sm" ? 16 : 20} />
        )}
      </Button>
      {open && trigger.current && (
        <Portal>
          <Floating layerRef={layer} anchor={trigger.current} align={align} side={side} class="menu-panel" id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKey}>
            {items.map((entry, k) => {
              if (entry.type === "separator") return <div key={entry.id ?? `s${k}`} class="menu-sep" role="separator" />;
              if (entry.type === "heading") return <div key={entry.id ?? `h${k}`} class="menu-heading" role="presentation">{entry.label}</div>;
              itemIndex++;
              const i = itemIndex;
              const radio = entry.checked !== undefined;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role={radio ? "menuitemcheckbox" : "menuitem"}
                  aria-checked={radio ? entry.checked : undefined}
                  aria-disabled={entry.disabled ? true : undefined}
                  tabIndex={-1}
                  data-active={i === active}
                  class={`menu-item${entry.danger ? " menu-item--danger" : ""}`}
                  onPointerMove={() => i !== active && !entry.disabled && setActive(i)}
                  onClick={() => choose(entry)}
                >
                  {entry.icon && <Icon name={entry.icon} size={16} />}
                  <span class="menu-label">{entry.label}</span>
                  {entry.shortcut && <span class="menu-shortcut">{entry.shortcut}</span>}
                  {entry.checked && <Icon name="check" size={16} class="menu-check" />}
                </button>
              );
            })}
          </Floating>
        </Portal>
      )}
    </>
  );
}

// Popover

/** Nicht-modale Fläche am Knopf (Filter, Hinweise, kleine Formulare); Escape und Außenklick schließen. */
export function Popover({
  trigger,
  label,
  children,
  align = "start",
  side = "bottom",
  open: controlled,
  onOpenChange,
}: {
  /** Inhalt des Knopfs */
  trigger: ComponentChildren;
  label: string;
  children: ComponentChildren;
  align?: "start" | "end";
  side?: "top" | "bottom";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const set = (v: boolean) => {
    setInner(v);
    onOpenChange?.(v);
  };
  const btn = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const id = useId();
  useOutside(open, [btn, layer], () => set(false));
  return (
    <>
      <Button innerRef={btn} variant="secondary" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => set(!open)}>
        {trigger}
      </Button>
      {open && btn.current && (
        <Portal>
          <Floating
            layerRef={layer}
            anchor={btn.current}
            align={align}
            side={side}
            class="popover"
            id={id}
            role="dialog"
            aria-label={label}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                set(false);
                btn.current?.focus();
              }
            }}
          >
            {children}
          </Floating>
        </Portal>
      )}
    </>
  );
}
