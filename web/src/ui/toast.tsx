/** Meldungen: Stapel mit Statusicon, Text, optionaler Aktion und Restzeit-Streifen (hält bei Hover und Fokus an). */

import type { JSX } from "preact";
import { dismiss, pauseToast, resumeToast, toasts, type Toast } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import { IconButton, Button } from "./Button.tsx";
import { Icon, type IconName } from "./icons.tsx";

const KIND_ICON: Record<Toast["kind"], IconName> = { info: "info", ok: "check-circle", warn: "alert", error: "alert-circle" };

export function Toasts() {
  const { list } = useStore(toasts);
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          class={`toast ${t.kind}${t.duration === null ? " is-sticky" : ""}`}
          style={t.duration === null ? undefined : ({ "--toast-ms": `${t.duration}ms` } as JSX.CSSProperties)}
          role={t.kind === "error" ? "alert" : "status"}
          onPointerEnter={() => pauseToast(t.id)}
          onPointerLeave={() => resumeToast(t.id)}
          onFocusIn={() => pauseToast(t.id)}
          onFocusOut={() => resumeToast(t.id)}
        >
          <span class="toast-icon">
            <Icon name={KIND_ICON[t.kind]} size={20} />
          </span>
          <p>
            {t.title && <strong class="toast-title">{t.title}</strong>}
            {t.text}
          </p>
          {t.action ? (
            <Button
              size="sm"
              variant="ghost"
              class="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </Button>
          ) : (
            <span />
          )}
          <IconButton label="Meldung schließen" icon="x" size="sm" tooltip={false} onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
