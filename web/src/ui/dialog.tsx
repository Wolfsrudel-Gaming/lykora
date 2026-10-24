/**
 * Dialog (modales <dialog>) und Bestätigung. Das Element hält den Fokus drinnen, Escape schließt (onCancel),
 * der Fokus kommt zum Auslöser zurück. Größen sm, md, lg; Sheet am Rand; Sicherheitsvariante mit Absperrband.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { canRestoreFocus, pickInitialFocus, trapTab } from "./a11y.ts";
import { createStore, useStore } from "../lib/store.ts";
import { Button, IconButton } from "./Button.tsx";
import { Field, Input, Textarea } from "./form.tsx";

const FOCUSABLE = 'button:not(:disabled), [href], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Sicherheitsrot und Absperrband, nur für Rückruf und Ähnliches */
  safety?: boolean;
  size?: "sm" | "md" | "lg";
  /** Am Rand statt in der Mitte (Handy: unten) */
  sheet?: boolean;
  /** Ein Satz unter dem Titel */
  description?: ComponentChildren;
  /** Fuß mit Aktionen (rechtsbündig; Hauptaktion zuletzt) */
  footer?: ComponentChildren;
  /** Klick auf den Hintergrund schließt (Standard; bei Sicherheitsdialogen nie) */
  dismissible?: boolean;
  children: ComponentChildren;
}

export function Dialog({ open, title, onClose, safety, size = "md", sheet, description, footer, dismissible = true, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const from = useRef<HTMLElement | null>(null);
  const id = useId();
  const descId = `${id}-beschreibung`;
  // Layout-Effekt: Öffnen und Schließen sofort nach dem Zeichnen, damit Tasten nicht ins Leere laufen
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      from.current = document.activeElement as HTMLElement | null;
      d.showModal();
      // Der Browser fokussiert sonst das erste Bedienelement, das wäre der Schließen-Knopf: erst das Feld, dann die Hauptaktion.
      pickInitialFocus((sel) => d.querySelector<HTMLElement>(sel))?.focus();
    }
    if (!open && d.open) {
      d.close();
      const el = from.current;
      from.current = null;
      if (canRestoreFocus(el)) el!.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      class={`dialog${size === "md" ? "" : ` dialog--${size}`}${sheet ? " dialog--sheet" : ""}${safety ? " safety" : ""}`}
      aria-labelledby={id}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        // Fokus bleibt im Dialog: am Rand springt er auf die andere Seite (sonst landet er kurz auf der Seite dahinter)
        const d = ref.current;
        if (!d) return;
        const els = [...d.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
        if (els.length === 0) return;
        const jump = trapTab(document.activeElement, els[0], els[els.length - 1], e.shiftKey);
        if (jump) {
          e.preventDefault();
          (jump === "first" ? els[0] : els[els.length - 1])!.focus();
        }
      }}
      onClick={(e) => {
        // Klick auf den Hintergrund trifft das Dialog-Element selbst, nie seinen Inhalt
        if (dismissible && !safety && e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div class="dialog-body">
          <div class="dialog-head">
            <h2 id={id}>{title}</h2>
            <IconButton class="dialog-close" label="Dialog schließen" icon="x" size="sm" tooltip={false} onClick={onClose} />
          </div>
          {description && (
            <p class="dialog-desc" id={descId}>
              {description}
            </p>
          )}
          <div class="dialog-scroll">{children}</div>
          {footer && <div class="dialog-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Seitenpanel am Rand (Handy: unten); ein Dialog mit sheet. */
export function Sheet(props: Omit<DialogProps, "sheet">) {
  return <Dialog {...props} sheet />;
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
  /** Löschen und Beenden: Hauptaktion in Gefahrenrot */
  danger?: boolean;
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
  const formId = useId();
  useEffect(() => setValue(""), [open]);
  const finish = (ok: boolean) => {
    resolve?.({ ok, value: value.trim() });
    confirmStore.set({ open: null, resolve: null });
  };
  const o = open;
  const blocked = !!o?.input?.required && !value.trim();
  return (
    <Dialog
      open={!!o}
      title={o?.title ?? ""}
      safety={o?.safety}
      size="sm"
      onClose={() => finish(false)}
      footer={
        o && (
          <>
            <Button onClick={() => finish(false)}>{o.cancel ?? "Abbrechen"}</Button>
            <Button type="submit" form={formId} variant={o.safety ? "safety" : o.danger ? "danger" : "primary"} disabled={blocked}>
              {o.confirm}
            </Button>
          </>
        )
      }
    >
      {o && (
        <form
          id={formId}
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
                <Textarea value={value} placeholder={o.input.placeholder} onInput={(e) => setValue(e.currentTarget.value)} />
              ) : (
                <Input value={value} placeholder={o.input.placeholder} onInput={(e) => setValue(e.currentTarget.value)} />
              )}
            </Field>
          )}
        </form>
      )}
    </Dialog>
  );
}
