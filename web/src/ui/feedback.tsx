/** Rückmeldung: Laden (Spinner, Skeleton), Fortschritt, Hinweise (Notice, Banner), Leer- und Fehlerzustände. */

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Button, IconButton } from "./Button.tsx";
import { Icon, type IconName } from "./icons.tsx";

export function Spinner({ size = 20 }: { size?: 16 | 20 | 24 }) {
  return <span class={`spinner${size === 16 ? " spinner--sm" : size === 24 ? " spinner--lg" : ""}`} aria-hidden="true" />;
}

export function Loading({ text = "Lädt …" }: { text?: string }) {
  return (
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

// Skeleton: Platzhalter in den Maßen der echten Inhalte

export function Skeleton({ shape = "line", width, height, class: cls }: { shape?: "line" | "title" | "block" | "circle"; width?: string; height?: string; class?: string }) {
  return <span class={`skeleton skeleton--${shape}${cls ? ` ${cls}` : ""}`} style={{ width, height }} aria-hidden="true" />;
}

/** Liste im Ladezustand; die Region meldet „Lädt“ einmal, nicht jede Zeile. */
export function SkeletonRows({ rows = 5, label = "Lädt …" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true">
      <span class="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div class="skeleton-row" key={i}>
          <Skeleton shape="circle" width="24px" height="24px" />
          <Skeleton width={`${70 - ((i * 13) % 30)}%`} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div class="skeleton-card" role="status" aria-busy="true">
      <span class="sr-only">Lädt …</span>
      <Skeleton shape="title" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

// Fortschritt: immer Balken und Zahl

export function Progress({ value, max, label, text, done }: { value: number; max: number; label: string; text?: string; done?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  const finished = done ?? (max > 0 && value >= max);
  return (
    <div class="progress-row">
      <div class={`progress${finished ? " is-done" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text ?? `${value} von ${max}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span class="progress-label">{text ?? `${value} von ${max}`}</span>
    </div>
  );
}

export function ProgressRing({ value, max, label, size = 56 }: { value: number; max: number; label: string; size?: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span class={`progress-ring${pct >= 1 ? " is-done" : ""}`} style={{ "--ring-size": `${size}px` } as never} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} von ${max}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle class="ring-track" cx="24" cy="24" r={r} />
        <circle class="ring-fill" cx="24" cy="24" r={r} stroke-dasharray={c} stroke-dashoffset={c * (1 - pct)} />
      </svg>
      <span>{Math.round(pct * 100)}%</span>
    </span>
  );
}

// Hinweise

export type Status = "info" | "ok" | "warn" | "danger";

const STATUS_ICON: Record<Status, IconName> = { info: "info", ok: "check-circle", warn: "alert", danger: "alert-circle" };

/** Hinweis im Inhalt: Symbol links, Titel, Text, optional eine Aktion rechts. Role „alert“ nur bei Gefahr. */
export function Notice({ status = "info", title, children, action, class: cls }: { status?: Status; title?: string; children?: ComponentChildren; action?: ComponentChildren; class?: string }) {
  return (
    <div class={`notice notice--${status} notice--icon${cls ? ` ${cls}` : ""}`} role={status === "danger" ? "alert" : "status"}>
      <Icon name={STATUS_ICON[status]} size={16} class="notice-icon" />
      <div class="notice-body">
        {title && <div class="notice-title">{title}</div>}
        {children}
      </div>
      {action && <div class="notice-action">{action}</div>}
    </div>
  );
}

/** Seitenweites Band unter der Kopfzeile (Update verfügbar, Verbindung getrennt); schließbar. */
export function Banner({ status = "info", children, action, onClose }: { status?: Status; children: ComponentChildren; action?: ComponentChildren; onClose?: () => void }) {
  return (
    <div class={`banner banner--${status}`} role={status === "danger" ? "alert" : "status"}>
      <Icon name={STATUS_ICON[status]} size={16} />
      <span class="grow" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </span>
      {action}
      {onClose && <IconButton label="Hinweis ausblenden" icon="x" size="sm" onClick={onClose} />}
    </div>
  );
}

/** Fehler als Hinweis; mit `retry` ein Knopf „Erneut versuchen“. Altes Verhalten und Klassen (notice error) bleiben. */
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div class="notice error row between" role="alert">
      <span class="row nowrap" style={{ alignItems: "flex-start" }}>
        <Icon name="alert-circle" size={16} class="notice-icon" />
        <span>{error instanceof Error ? error.message : String(error)}</span>
      </span>
      {retry && (
        <Button size="sm" icon="refresh" onClick={retry}>
          Erneut versuchen
        </Button>
      )}
    </div>
  );
}

// Leere und fehlerhafte Zustände

/** Alter Einzeiler; neue Stellen nehmen EmptyState. */
export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

export function EmptyState({
  icon = "list",
  title,
  children,
  action,
  variant = "default",
}: {
  icon?: IconName;
  title: string;
  children?: ComponentChildren;
  action?: ComponentChildren;
  variant?: "default" | "inline" | "page";
}) {
  return (
    <div class={`empty-state${variant === "default" ? "" : ` empty-state--${variant}`}`}>
      {variant !== "inline" && (
        <span class="empty-state__icon">
          <Icon name={icon} size={24} />
        </span>
      )}
      <h3 class="empty-state__title">{title}</h3>
      {children && <p class="empty-state__text">{children}</p>}
      {action && <div class="empty-state__action">{action}</div>}
    </div>
  );
}

/** Fehlerzustand mit kurzer Meldung, „Erneut versuchen“ und aufklappbaren Einzelheiten. */
export function ErrorState({ title = "Das hat nicht geklappt", error, retry, details }: { title?: string; error?: unknown; retry?: () => void; details?: string }) {
  const [more, setMore] = useState(false);
  const message = error ? (error instanceof Error ? error.message : String(error)) : undefined;
  return (
    <div class="empty-state empty-state--error" role="alert">
      <span class="empty-state__icon">
        <Icon name="alert-circle" size={24} />
      </span>
      <h3 class="empty-state__title">{title}</h3>
      {message && <p class="empty-state__text">{message}</p>}
      <div class="empty-state__action">
        {retry && (
          <Button variant="primary" icon="refresh" onClick={retry}>
            Erneut versuchen
          </Button>
        )}
        {details && (
          <Button variant="ghost" iconEnd={more ? "chevron-up" : "chevron-down"} aria-expanded={more} onClick={() => setMore(!more)}>
            Einzelheiten
          </Button>
        )}
      </div>
      {details && more && (
        <div class="empty-state__details">
          <pre>{details}</pre>
        </div>
      )}
    </div>
  );
}
