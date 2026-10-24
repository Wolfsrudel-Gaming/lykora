/** Kennzeichen: Badge, StatusBadge, Chip, Count, StatusDot, TeamDot, Avatar. */

import type { ComponentChildren, JSX } from "preact";
import { STATUS_LABELS } from "../lib/format.ts";
import type { EventStatus } from "../lib/types.ts";
import { Icon } from "./icons.tsx";

export type BadgeVariant = "neutral" | "accent" | "ok" | "warn" | "danger" | "info" | "safety" | "recalled";

/** Zustand eines Objekts in Versalien; Status mit Punkt, immer mit Text (nie nur Farbe). */
export function Badge({
  variant = "neutral",
  dot,
  keepCase,
  children,
  class: cls,
}: {
  variant?: BadgeVariant;
  /** Statuspunkt: gefüllt oder leer (z. B. „Geplant“) */
  dot?: boolean | "hollow";
  /** Schreibweise beibehalten, z. B. für Kennungen */
  keepCase?: boolean;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <span class={`badge badge--${variant}${keepCase ? " keep-case" : ""}${cls ? ` ${cls}` : ""}`}>
      {dot && <span class={`badge-dot${dot === "hollow" ? " badge-dot--hollow" : ""}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

const STATUS_BADGE: Record<EventStatus, { variant: BadgeVariant; dot: boolean | "hollow" }> = {
  draft: { variant: "neutral", dot: "hollow" },
  running: { variant: "accent", dot: true },
  paused: { variant: "warn", dot: true },
  recalled: { variant: "recalled", dot: false },
  ended: { variant: "neutral", dot: true },
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const { variant, dot } = STATUS_BADGE[status];
  return (
    <Badge variant={variant} dot={dot}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** Zähler: Pille mit Zahl (in Reitern, Knöpfen, Listen). */
export function Count({ value, tone }: { value: number | string; tone?: "on" | "safety" }) {
  return <span class={`count${tone ? ` ${tone}` : ""}`}>{value}</span>;
}

/** Punkt für Verbindungs- und Betriebszustand; der Text steht daneben. */
export function StatusDot({ tone = "neutral" }: { tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "accent" }) {
  return <span class={`status-dot${tone === "neutral" ? "" : ` status-dot--${tone}`}`} aria-hidden="true" />;
}

/**
 * Chip: wählbar (onClick, aria-pressed mit `selected`) oder entfernbar (onRemove). Ohne Handler ein reines Etikett.
 */
export function Chip({
  children,
  selected,
  onClick,
  onRemove,
  removeLabel,
  size = "md",
  disabled,
  title,
}: {
  children: ComponentChildren;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  /** Name des Entfernen-Knopfs, z. B. „Eule entfernen“ */
  removeLabel?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
}) {
  const cls = `chip chip--ui${size === "sm" ? " chip--sm" : ""}${selected ? " is-selected" : ""}`;
  const body = (
    <>
      {selected && <Icon name="check" size={16} />}
      <span class="chip-label">{children}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" class={cls} aria-pressed={selected ?? false} disabled={disabled} title={title} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <span class={cls} title={title}>
      {body}
      {onRemove && (
        <button type="button" class="chip-remove" aria-label={removeLabel ?? "Entfernen"} disabled={disabled} onClick={onRemove}>
          <Icon name="x" size={16} />
        </button>
      )}
    </span>
  );
}

/** Initialen aus einem Namen: „Pfadfinder Hennef“ ergibt „PH“, „Admin“ ergibt „AD“. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return [...parts[0]!].slice(0, 2).join("").toUpperCase();
  return (([...parts[0]!][0] ?? "") + ([...parts[parts.length - 1]!][0] ?? "")).toUpperCase();
}

export function Avatar({ name, size = "md", tone, square, class: cls }: { name: string; size?: "sm" | "md" | "lg"; tone?: "accent"; square?: boolean; class?: string }) {
  return (
    <span class={`avatar${size === "md" ? "" : ` avatar--${size}`}${tone ? ` avatar--${tone}` : ""}${square ? " avatar--square" : ""}${cls ? ` ${cls}` : ""}`} aria-hidden="true" title={name}>
      {initials(name)}
    </span>
  );
}

// Teamfarben: Namen wie in der App (join_screen.dart); die Werte stehen als --team-* in tokens.css, je Thema.

const TEAM_NAMES = ["red", "blue", "green", "yellow", "purple", "orange"] as const;
const TEAM_FALLBACK = ["blue", "green", "yellow", "purple", "orange", "teal", "pink", "olive"] as const;
export type TeamTone = (typeof TEAM_NAMES)[number] | (typeof TEAM_FALLBACK)[number];

/** Nachtwerte als Hex für Stellen, die eine echte Farbe brauchen (Karte, QR); für die Oberfläche gilt teamVar. */
const TEAM_HEX: Record<TeamTone, string> = {
  red: "#E5533D",
  blue: "#4A90E2",
  green: "#3FA66B",
  yellow: "#F2C94C",
  purple: "#9B6BD3",
  orange: "#F2994A",
  teal: "#5BC0BE",
  pink: "#D98CB3",
  olive: "#A0A86B",
};

/** Teamfarbe nach Name; sonst eine Hex-Farbe aus den Daten; sonst eine feste Farbe aus der Team-Id. */
export function teamTone(color: string | null | undefined, id: string): TeamTone | string {
  if (color && (TEAM_NAMES as readonly string[]).includes(color)) return color as TeamTone;
  if (color && /^#[0-9a-f]{3,8}$/i.test(color)) return color;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_FALLBACK[h % TEAM_FALLBACK.length]!;
}

/** CSS-Wert für die Teamfarbe im aktuellen Thema: var(--team-blue) oder die Hex-Farbe aus den Daten. */
export function teamVar(color: string | null | undefined, id: string): string {
  const t = teamTone(color, id);
  return t.startsWith("#") ? t : `var(--team-${t})`;
}

export function teamColor(color: string | null | undefined, id: string): string {
  const t = teamTone(color, id);
  return t.startsWith("#") ? t : TEAM_HEX[t as TeamTone];
}

export function TeamDot({ color, id, stale }: { color: string | null; id: string; stale?: boolean }) {
  return <span class={`dot${stale ? " dot--stale" : ""}`} style={{ background: teamVar(color, id) } as JSX.CSSProperties} aria-hidden="true" />;
}
