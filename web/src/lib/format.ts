/** Formatierung für Anzeigen im Dashboard, alles auf Deutsch. */

import type { EventStatus, Text } from "./types.ts";

/** Text in der gewünschten Sprache, sonst in der ersten vorhandenen (wie resolveText im Server). */
export function text(value: Text | undefined | null, lang = "de"): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return value[lang] ?? Object.values(value)[0] ?? "";
}

const two = (n: number) => String(n).padStart(2, "0");

/** Dauer in Sekunden als „45:00“ oder „1:05:03“; negativ mit Minuszeichen. */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "−" : "";
  const s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return h > 0 ? `${sign}${h}:${two(m)}:${two(rest)}` : `${sign}${m}:${two(rest)}`;
}

/** Kurze Dauer in Worten: „90 s“, „5 Min“, „2 Std 10 Min“. */
export function formatSpan(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  if (s < 120) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} Std ${m % 60} Min` : `${h} Std`;
}

const toDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

export function formatClock(value: string | number | Date): string {
  const d = toDate(value);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function formatClockSeconds(value: string | number | Date): string {
  const d = toDate(value);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export function formatDate(value: string | number | Date): string {
  const d = toDate(value);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return `${formatDate(value)}, ${formatClock(value)} Uhr`;
}

/** Abstand zu jetzt: „gerade eben“, „vor 3 Min“, „vor 2 Std“, „vor 3 Tagen“. */
export function formatAgo(value: string | number | Date | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined) return "nie";
  const s = (now - toDate(value).getTime()) / 1000;
  if (s < 45) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  if (h < 36) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

export function formatBattery(level: number | null | undefined): string {
  if (level === null || level === undefined) return "–";
  return `${Math.round(level * 100)} %`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

/** Punkte mit Vorzeichen bei Änderungen: „+50“, „−20“. */
export function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Entwurf",
  running: "Läuft",
  paused: "Pausiert",
  recalled: "Rückruf",
  ended: "Beendet",
};

/** Wert für <input type="datetime-local"> in lokaler Zeit. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Aus <input type="datetime-local"> wieder ISO-Zeit; leer bleibt leer. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Stabile ID aus einem Dateinamen: Kleinbuchstaben, Ziffern und Bindestriche, wie das Spielformat sie verlangt. */
export function kebabId(name: string, fallback = "medium"): string {
  return slugId(name.replace(/\.[a-z0-9]{1,5}$/i, ""), fallback);
}

/** ID aus einem Namen wie kebabId, ohne eine Dateiendung abzuschneiden: „Akt 1.2“ wird zu akt-1-2. */
export function slugId(name: string, fallback: string): string {
  const id = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return id || fallback;
}

/** Freie ID: hängt -2, -3 … an, solange die ID schon vergeben ist. */
export function uniqueId(id: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(id)) return id;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = id.slice(0, 64 - suffix.length) + suffix;
    if (!set.has(candidate)) return candidate;
  }
}

/** Kürzel für eine Organisation aus ihrem Namen, passend zu ^[a-z0-9-]{2,40}$. */
export function slugify(name: string): string {
  return kebabId(name, "").slice(0, 40).replace(/-+$/, "");
}
