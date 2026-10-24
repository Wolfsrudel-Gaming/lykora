/** Reiter (Tabs) und Segmentierung. Pfeiltasten wandern, Home/Ende springen, nur der gewählte Reiter ist ein Tabstopp. */

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { rovingNext } from "./a11y.ts";
import { Icon, type IconName } from "./icons.tsx";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
  countClass?: "on" | "safety";
  icon?: IconName;
  disabled?: boolean;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const disabled = tabs.map((t) => !!t.disabled);

  // Randverlauf nur, wo noch etwas liegt; der gewählte Reiter scrollt in den sichtbaren Bereich.
  const measure = () => {
    const el = list.current;
    if (!el) return;
    el.dataset.moreStart = String(el.scrollLeft > 1);
    el.dataset.moreEnd = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  useEffect(() => {
    measure();
    const el = list.current;
    if (!el) return;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [tabs.length]);
  useEffect(() => {
    const i = tabs.findIndex((t) => t.id === value);
    refs.current[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);

  const move = (index: number) => {
    onChange(tabs[index]!.id);
    refs.current[index]?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-label={label} ref={list} onScroll={measure}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === value}
          aria-disabled={t.disabled ? true : undefined}
          disabled={t.disabled}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const next = rovingNext(e.key, i, tabs.length, { disabled });
            if (next === null) return;
            e.preventDefault();
            move(next);
          }}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          <span class="tab-label">{t.label}</span>
          {!!t.count && <span class={`count ${t.countClass ?? ""}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmentierte Steuerung (2 bis 4 Optionen) als Radiogruppe mit Pfeiltasten. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: ComponentChildren; icon?: IconName; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = options.map((o) => !!o.disabled);
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          disabled={o.disabled}
          tabIndex={o.id === value ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            const next = rovingNext(e.key, i, options.length, { orientation: "both", disabled });
            if (next === null) return;
            e.preventDefault();
            onChange(options[next]!.id);
            refs.current[next]?.focus();
          }}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
