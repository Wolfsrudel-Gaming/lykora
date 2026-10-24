/**
 * Schwebende Flächen: Portal, Floating (Fläche am Anker) und Tooltip. Sie hängen am Ende von <body> (nichts schneidet sie ab,
 * auch nicht in Tabellen oder Karten mit overflow) und sitzen mit position: fixed am Auslöser.
 */

import { cloneElement, render, type ComponentChildren, type JSX, type VNode } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { placeFloating } from "./a11y.ts";

/** Rendert die Kinder in ein eigenes Element am Ende von <body>. */
export function Portal({ children }: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null);
  if (typeof document === "undefined") return null;
  if (!host.current) {
    host.current = document.createElement("div");
    host.current.setAttribute("data-portal", "");
  }
  useLayoutEffect(() => {
    const el = host.current!;
    document.body.appendChild(el);
    return () => {
      render(null, el);
      el.remove();
    };
  }, []);
  useLayoutEffect(() => {
    render(<>{children}</>, host.current!);
  });
  return null;
}

/**
 * Fläche am Anker: setzt top/left nach dem Zeichnen und bei Bildlauf oder Größenänderung neu.
 * Ohne Anker (null) bleibt sie an der Stelle 0/0.
 */
export function Floating({
  anchor,
  side = "bottom",
  align = "start",
  gap = 4,
  matchWidth,
  layerRef,
  class: cls,
  children,
  ...rest
}: {
  anchor: HTMLElement | null;
  layerRef?: { current: HTMLDivElement | null };
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  gap?: number;
  matchWidth?: boolean;
  class?: string;
  children: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "children">) {
  const ref = useRef<HTMLDivElement>(null);
  const place = () => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    if (matchWidth) el.style.minWidth = `${a.width}px`;
    const r = el.getBoundingClientRect();
    const p = placeFloating(
      { top: a.top, left: a.left, width: a.width, height: a.height },
      { width: r.width, height: r.height },
      { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      { side, align, gap },
    );
    el.style.top = `${Math.round(p.top)}px`;
    el.style.left = `${Math.round(p.left)}px`;
    el.dataset.side = p.side;
  };
  useLayoutEffect(place);
  useLayoutEffect(() => {
    if (layerRef) layerRef.current = ref.current;
    return () => {
      if (layerRef) layerRef.current = null;
    };
  }, []);
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, side, align, gap, matchWidth]);
  return (
    <div {...rest} ref={ref} class={cls} style={{ top: 0, left: 0 }}>
      {children}
    </div>
  );
}

// Tooltip

let hideCurrent: (() => void) | null = null;

/**
 * Hinweis am Element: bei Hover nach 400 ms, bei Tastaturfokus sofort, auf Touch bei langer Berührung.
 * Escape blendet aus. Das Kind bekommt aria-describedby; Symbolknöpfe tragen ihren Namen zusätzlich im aria-label.
 */
export function Tooltip({ text, side = "top", delay = 400, children }: { text: string; side?: "top" | "bottom"; delay?: number; children: VNode<JSX.HTMLAttributes<HTMLElement>> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (ms: number, el: HTMLElement) => {
    clear();
    setAnchor(el);
    timer.current = setTimeout(() => {
      hideCurrent?.();
      hideCurrent = () => setOpen(false);
      setOpen(true);
    }, ms);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };
  useEffect(() => clear, []);
  // Escape blendet aus, auch wenn der Fokus nicht auf dem Auslöser liegt (WCAG 1.4.13)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!text) return children;
  const props = children.props;
  const chain = <E extends Event>(own: ((e: E) => void) | undefined, mine: (e: E) => void) => (e: E) => {
    own?.(e);
    mine(e);
  };
  return (
    <>
      {cloneElement(children, {
        "aria-describedby": open ? id : props["aria-describedby"],
        onPointerEnter: chain(props.onPointerEnter as ((e: PointerEvent) => void) | undefined, (e) => {
          if (e.pointerType !== "touch") show(delay, e.currentTarget as HTMLElement);
        }),
        onPointerLeave: chain(props.onPointerLeave as ((e: PointerEvent) => void) | undefined, hide),
        onFocus: chain(props.onFocus as ((e: FocusEvent) => void) | undefined, (e) => {
          const el = e.currentTarget as HTMLElement;
          if (el.matches(":focus-visible")) show(0, el);
        }),
        onBlur: chain(props.onBlur as ((e: FocusEvent) => void) | undefined, hide),
        onKeyDown: chain(props.onKeyDown as ((e: KeyboardEvent) => void) | undefined, (e) => {
          if (e.key === "Escape") hide();
        }),
        onTouchStart: chain(props.onTouchStart as ((e: TouchEvent) => void) | undefined, (e) => show(450, e.currentTarget as HTMLElement)),
        onTouchEnd: chain(props.onTouchEnd as ((e: TouchEvent) => void) | undefined, () => {
          clear();
          if (open) setTimeout(() => setOpen(false), 1600);
        }),
      } as JSX.HTMLAttributes<HTMLElement>)}
      {open && anchor && (
        <Portal>
          <Floating anchor={anchor} side={side} align="center" gap={6} class="tooltip" id={id} role="tooltip">
            {text}
          </Floating>
        </Portal>
      )}
    </>
  );
}
