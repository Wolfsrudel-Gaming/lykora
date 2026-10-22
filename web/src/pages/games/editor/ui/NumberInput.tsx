/**
 * Paket A: Zahl an einem Pfad (Radius, Punkte, Teamgröße). Während des Tippens bleibt der Text
 * stehen, in den Entwurf geht nur eine gültige Zahl; leer entfernt das Feld (Standard gilt).
 */

import { useId, useState } from "preact/hooks";
import { editor, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { JsonPointer } from "../../../../lib/editor/types.ts";
import { FieldFrame, describedBy, hasError, useFeld } from "./FieldFrame.tsx";

/** Zahl aus der Eingabe; Komma gilt wie Punkt; leer oder unlesbar → null. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function NumberInput({
  path,
  label,
  hint,
  placeholder,
  unit,
  min,
  max,
  step,
  integer,
  required,
}: {
  path: JsonPointer;
  label: string;
  hint?: string;
  /** Standardwert als Platzhalter */
  placeholder?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const value = useFieldValue<number>(path);
  const issues = useIssuesAt(path);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (typeof value === "number" ? String(value) : "");

  const write = (raw: string) => {
    setDraft(raw);
    const n = parseNumber(raw);
    if (n === null) {
      if (!raw.trim()) store?.setField(path, undefined, `${label} entfernt`, { coalesce: true });
      return;
    }
    store?.setField(path, integer ? Math.round(n) : n, `${label} geändert`, { coalesce: true });
  };

  return (
    <FieldFrame id={id} label={label} hint={hint} required={required} issues={issues} feld={feld}>
      <span class="ed-unit">
        <input
          id={id}
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          value={shown}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step ?? (integer ? 1 : "any")}
          aria-invalid={hasError(issues) || undefined}
          aria-describedby={describedBy(id, !!hint, issues.length > 0)}
          onInput={(e) => write(e.currentTarget.value)}
          onBlur={() => {
            setDraft(null);
            store?.touch(path);
          }}
        />
        {unit && <span class="muted">{unit}</span>}
      </span>
    </FieldFrame>
  );
}
