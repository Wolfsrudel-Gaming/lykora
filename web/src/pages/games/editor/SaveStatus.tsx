/**
 * Paket A: Speicherstand im Kopf des Baukastens – als Text mit Symbol, nie nur als Farbe.
 * Angesagt (aria-live) werden nur Wechsel zu Offline, Fehler, Konflikt und abgelaufener Anmeldung,
 * nicht jedes Speichern.
 */

import { formatClock } from "../../../lib/format.ts";
import type { EditorState } from "../../../lib/editor/types.ts";
import { Icon, type IconName } from "../../../ui/icons.tsx";

export interface SaveView {
  icon: IconName | "spinner" | null;
  text: string;
  /** Knopf neben dem Text */
  action: "retry" | "conflict" | null;
  /** wird vorgelesen */
  announce: boolean;
}

/** Text und Symbol je Zustand (UX §16.2). who = Name der Person, die auch geändert hat. */
export function saveStatusView(save: EditorState["save"], who?: string | null): SaveView {
  switch (save.status) {
    case "saved":
      return { icon: "check", text: save.at ? `Gespeichert ${formatClock(save.at)}` : "Gespeichert", action: null, announce: false };
    case "pending":
      return { icon: null, text: "Speichert gleich …", action: null, announce: false };
    case "saving":
      return { icon: "spinner", text: "Speichert …", action: null, announce: false };
    case "offline":
      return { icon: "alert", text: "Offline – Änderungen bleiben auf diesem Gerät und werden nachgeholt", action: "retry", announce: true };
    case "error":
      return { icon: "alert", text: "Nicht gespeichert.", action: "retry", announce: true };
    case "conflict":
      return { icon: "alert", text: `${who || "Jemand"} hat den Entwurf auch geändert.`, action: "conflict", announce: true };
    case "unauthorized":
      return { icon: "alert", text: "Bitte neu anmelden – deine Änderungen bleiben auf diesem Gerät", action: null, announce: true };
  }
}

/** Hinweis zur lokalen Sicherung; nur wenn sie nicht geschrieben werden konnte. */
export function backupHint(backup: EditorState["backup"]): string | null {
  if (backup === "too_large") return "Zu groß für die lokale Sicherung";
  if (backup === "failed") return "Keine lokale Sicherung möglich";
  return null;
}

export function SaveStatus({
  save,
  backup,
  who,
  onRetry,
  onConflict,
}: {
  save: EditorState["save"];
  backup: EditorState["backup"];
  who?: string | null;
  onRetry: () => void;
  onConflict: () => void;
}) {
  const view = saveStatusView(save, who);
  const hint = backupHint(backup);
  return (
    <span class={`save-status ${save.status}`} title={save.error ?? undefined}>
      {view.icon === "spinner" ? <span class="spinner" aria-hidden="true" /> : view.icon ? <Icon name={view.icon} /> : null}
      <span class="save-text">{view.text}</span>
      {hint && <span class="small muted"> · {hint}</span>}
      {view.action === "retry" && (
        <button type="button" class="btn small" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
      {view.action === "conflict" && (
        <button type="button" class="btn small" onClick={onConflict}>
          Ansehen
        </button>
      )}
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {view.announce ? view.text : ""}
      </span>
    </span>
  );
}
