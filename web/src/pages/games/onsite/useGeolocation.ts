/**
 * Paket B: Standort für den Vor-Ort-Modus. Fragt erst nach einem Knopfdruck (die Seite erklärt
 * vorher, wozu), beobachtet dann mit hoher Genauigkeit und reicht jede Messung an Abonnenten weiter
 * (Mitteln über 10 s). Dazu die Bildschirmsperre (Wake Lock), solange die Seite offen ist.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { Fix } from "../../../lib/editor/geo.ts";

export type GeoStatus = "idle" | "waiting" | "watching" | "denied" | "unavailable";

export interface Geo {
  status: GeoStatus;
  /** letzte Messung */
  fix: (Fix & { at: number }) | null;
  error: string | null;
  start: () => void;
  /** jede neue Messung; liefert das Abbestellen */
  onFix: (fn: (fix: Fix) => void) => () => void;
}

export function useGeolocation(): Geo {
  const [status, setStatus] = useState<GeoStatus>(() => (typeof navigator !== "undefined" && "geolocation" in navigator ? "idle" : "unavailable"));
  const [fix, setFix] = useState<Geo["fix"]>(null);
  const [error, setError] = useState<string | null>(null);
  const watch = useRef<number | null>(null);
  const subs = useRef(new Set<(fix: Fix) => void>());

  const stop = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  };

  const start = () => {
    if (!("geolocation" in navigator)) return setStatus("unavailable");
    stop();
    setStatus("waiting");
    setError(null);
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const f = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 0 };
        setFix({ ...f, at: Date.now() });
        setStatus("watching");
        for (const fn of subs.current) fn(f);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setStatus("denied");
        } else setError(err.code === err.TIMEOUT ? "Noch kein GPS-Signal. Unter freiem Himmel geht es meist schneller." : "Standort gerade nicht verfügbar.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  };

  useEffect(() => stop, []);

  return {
    status,
    fix,
    error,
    start,
    onFix: (fn) => {
      subs.current.add(fn);
      return () => subs.current.delete(fn);
    },
  };
}

/** Bildschirm bleibt an, solange die Seite sichtbar ist (wo der Browser es kann). */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!on || !nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let alive = true;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      nav.wakeLock!.request("screen").then(
        (l) => {
          if (alive) lock = l;
          else void l.release();
        },
        () => undefined,
      );
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}
