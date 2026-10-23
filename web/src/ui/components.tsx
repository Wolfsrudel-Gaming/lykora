/** Bausteine: Link, Dialog, Bestätigung, Status, Laden, Fehler, Reiter, Meldungen. */

import { cloneElement, type ComponentChildren, type JSX, type VNode } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { base, pagePath } from "../lib/base.ts";
import { STATUS_LABELS } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { dismiss, toasts } from "../lib/session.ts";
import { createStore, useStore } from "../lib/store.ts";
import type { EventStatus } from "../lib/types.ts";
import { Icon } from "./icons.tsx";

type AnchorProps = Omit<JSX.HTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** Link innerhalb der App: echte Adresse für neue Tabs, ohne Neuladen beim normalen Klick. */
export function Link({ to, onClick, children, ...rest }: AnchorProps) {
  return (
    <a
      {...rest}
      href={pagePath(base(), to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Loading({ text = "Lädt …" }: { text?: string }) {
  return (
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div class="notice error row between" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && (
        <button type="button" class="btn small" onClick={retry}>
          <Icon name="refresh" /> Erneut versuchen
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

export function StatusBadge({ status }: { status: EventStatus }) {
  const cls = { draft: "quiet", running: "on", paused: "strong", recalled: "recalled", ended: "" }[status];
  return <span class={`badge ${cls}`}>{STATUS_LABELS[status]}</span>;
}

/**
 * Beschriftetes Eingabefeld. Label und Feld sind über id verbunden statt verschachtelt,
 * damit weder Hinweis noch Auswahlliste in den Namen des Feldes rutschen.
 */
export function Field({ label, hint, children }: { label: string; hint?: ComponentChildren; children: VNode<{ id?: string }> }) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const hintId = `${id}-hinweis`;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {cloneElement(children, { id, "aria-describedby": hint ? hintId : undefined } as { id: string })}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

// Dialog

export function Dialog({
  open,
  title,
  onClose,
  safety,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  safety?: boolean;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Der Browser fokussiert sonst das erste Bedienelement; ein Element mit data-autofocus geht vor.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class={`dialog${safety ? " safety" : ""}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div class="dialog-body">
          <h2 id={id}>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ComponentChildren;
  confirm: string;
  cancel?: string;
  /** Sicherheitsrot und Absperrband, nur für Rückruf und Ähnliches */
  safety?: boolean;
  /** Zusätzliches Textfeld, z. B. der Grund für den Rückruf */
  input?: { label: string; placeholder?: string; required?: boolean; multiline?: boolean };
}

interface ConfirmState {
  open: ConfirmOptions | null;
  resolve: ((r: { ok: boolean; value: string }) => void) | null;
}

const confirmStore = createStore<ConfirmState>({ open: null, resolve: null });

/** Bestätigung im Seitendesign; liefert ok und den eingegebenen Text. */
export function confirm(options: ConfirmOptions): Promise<{ ok: boolean; value: string }> {
  return new Promise((resolve) => {
    confirmStore.get().resolve?.({ ok: false, value: "" });
    confirmStore.set({ open: options, resolve });
  });
}

export function ConfirmHost() {
  const { open, resolve } = useStore(confirmStore);
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [open]);
  const finish = (ok: boolean) => {
    resolve?.({ ok, value: value.trim() });
    confirmStore.set({ open: null, resolve: null });
  };
  const o = open;
  const blocked = !!o?.input?.required && !value.trim();
  return (
    <Dialog open={!!o} title={o?.title ?? ""} safety={o?.safety} onClose={() => finish(false)}>
      {o && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) finish(true);
          }}
        >
          {o.body && <div class="stack tight">{o.body}</div>}
          {o.input && (
            <Field label={o.input.label}>
              {o.input.multiline ? (
                <textarea value={value} placeholder={o.input.placeholder} onInput={(e) => setValue(e.currentTarget.value)} />
              ) : (
                <input value={value} placeholder={o.input.placeholder} onInput={(e) => setValue(e.currentTarget.value)} />
              )}
            </Field>
          )}
          <div class="form-actions">
            <button type="button" class="btn" onClick={() => finish(false)}>
              {o.cancel ?? "Abbrechen"}
            </button>
            <button type="submit" class={`btn ${o.safety ? "safety" : "primary"}`} disabled={blocked}>
              {o.confirm}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// Reiter

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
  countClass?: "on" | "safety";
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
  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-label={label}>
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
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") move(i + 1);
            else if (e.key === "ArrowLeft") move(i - 1);
            else if (e.key === "Home") move(0);
            else if (e.key === "End") move(tabs.length - 1);
            else return;
            e.preventDefault();
          }}
        >
          <span class="tab-label">{t.label}</span>
          {!!t.count && <span class={`count ${t.countClass ?? ""}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const { list } = useStore(toasts);
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <p>{t.text}</p>
          <button type="button" class="btn ghost small" aria-label="Meldung schließen" onClick={() => dismiss(t.id)}>
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Farben der App für Teams (app/lib/ui/screens/join_screen.dart). */
const TEAM_COLORS: Record<string, string> = {
  red: "#E5533D",
  blue: "#4A90E2",
  green: "#3FA66B",
  yellow: "#F2C94C",
  purple: "#9B6BD3",
  orange: "#F2994A",
};
const FALLBACK = ["#4A90E2", "#3FA66B", "#F2C94C", "#9B6BD3", "#F2994A", "#5BC0BE", "#D98CB3", "#A0A86B"];

export function teamColor(color: string | null | undefined, id: string): string {
  if (color && TEAM_COLORS[color]) return TEAM_COLORS[color];
  if (color && /^#[0-9a-f]{3,8}$/i.test(color)) return color;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

export function TeamDot({ color, id }: { color: string | null; id: string }) {
  return <span class="dot" style={{ background: teamColor(color, id) }} aria-hidden="true" />;
}

/** Ein Vorhör-Player für die ganze Seite: Es spielt immer nur ein Klang. */
const preview = createStore<{ src: string | null }>({ src: null });
let audio: HTMLAudioElement | null = null;

export function togglePreview(src: string): void {
  audio ??= new Audio();
  if (preview.get().src === src) {
    audio.pause();
    preview.set({ src: null });
    return;
  }
  audio.pause();
  audio.src = src;
  audio.onended = () => preview.set({ src: null });
  audio.onerror = () => preview.set({ src: null });
  void audio.play().catch(() => preview.set({ src: null }));
  preview.set({ src });
}

function stopPreview(): void {
  audio?.pause();
  preview.set({ src: null });
}

export function PreviewButton({ src, label }: { src: string; label: string }) {
  const { src: playing } = useStore(preview);
  const on = playing === src;
  useEffect(() => () => {
    if (preview.get().src === src) stopPreview();
  }, [src]);
  return (
    <button type="button" class={`btn small${on ? " primary" : ""}`} aria-pressed={on} aria-label={`${label} ${on ? "stoppen" : "vorhören"}`} onClick={() => togglePreview(src)}>
      <Icon name={on ? "stop" : "play"} />
    </button>
  );
}

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

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Lykora` : "Lykora";
  }, [title]);
}
