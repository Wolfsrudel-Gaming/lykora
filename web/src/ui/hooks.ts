/** Hooks der Oberfläche: Daten laden, Uhr, Medienabfragen, Seitentitel, Außenklick, Fokus-Rückgabe. */

import { useEffect, useRef, useState } from "preact/hooks";
import { down, up, type Breakpoint } from "../lib/breakpoints.ts";
import { canRestoreFocus } from "./a11y.ts";

/** Lädt Daten beim Öffnen und bei geänderten Abhängigkeiten. */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: unknown[],
): { data: T | undefined; error: unknown; loading: boolean; reload: () => void; setData: (d: T | ((prev: T | undefined) => T)) => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData: (d) => setData(d as T) };
}

/** Uhr, die jede Sekunde (oder seltener) neu zeichnet. */
export function useNow(interval = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Ab einem Breakpoint (sm 640, md 960, lg 1280, xl 1600), dieselben Stufen wie im CSS. */
export function useUp(bp: Breakpoint): boolean {
  return useMedia(up(bp));
}

/** Unter einem Breakpoint. */
export function useDown(bp: Breakpoint): boolean {
  return useMedia(down(bp));
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Lykora` : "Lykora";
  }, [title]);
}

/** Ruft `onOutside` bei Klick oder Berührung außerhalb aller angegebenen Elemente, solange `active` gilt. */
export function useOutside(active: boolean, refs: { current: Element | null }[], onOutside: () => void): void {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const t = e.target as Node | null;
      if (t && refs.some((r) => r.current?.contains(t))) return;
      cb.current();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [active]);
}

/** Merkt sich beim Öffnen das fokussierte Element und gibt den Fokus beim Schließen dorthin zurück. */
export function useFocusReturn(open: boolean): void {
  const from = useRef<HTMLElement | null>(null);
  const was = useRef(false);
  if (open && !was.current) from.current = document.activeElement as HTMLElement | null;
  useEffect(() => {
    if (!open && was.current) {
      const el = from.current;
      from.current = null;
      if (canRestoreFocus(el)) el!.focus();
    }
    was.current = open;
  }, [open]);
}
