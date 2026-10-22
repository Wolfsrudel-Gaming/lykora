/**
 * Paket A: Dauer in Minuten (das Format speichert Sekunden). Halbe Minuten sind erlaubt;
 * leer entfernt das Feld. Sekunden sieht niemand – Werte über zwei Minuten stehen nie als Sekunden da.
 */

import { useId, useState } from "preact/hooks";
import { editor, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { JsonPointer } from "../../../../lib/editor/types.ts";
import { FieldFrame, describedBy, hasError, useFeld } from "./FieldFrame.tsx";
import { parseNumber } from "./NumberInput.tsx";

/** Sekunden → Minuten mit höchstens einer Nachkommastelle (90 → 1.5). */
export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 6) / 10;
}

/** Minuten → ganze Sekunden, nie negativ (1.5 → 90). */
export function minutesToSeconds(minutes: number): number {
  return Math.max(0, Math.round(minutes * 60));
}

/** Anzeige einer Dauer in Worten: „90 Min“, „1,5 Min“, unter 2 Minuten mit Sekunden. */
export function minutesLabel(seconds: number): string {
  if (seconds < 120 && seconds % 60) return `${seconds} s`;
  const m = secondsToMinutes(seconds);
  return `${String(m).replace(".", ",")} Min`;
}

export function DurationInput({
  path,
  label,
  hint,
  placeholder,
  min,
  max,
  required,
}: {
  path: JsonPointer;
  label: string;
  hint?: string;
  /** Standard in Sekunden, als Minuten angezeigt */
  placeholder?: number;
  /** Minuten */
  min?: number;
  max?: number;
  required?: boolean;
}) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const seconds = useFieldValue<number>(path);
  const issues = useIssuesAt(path);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (typeof seconds === "number" ? String(secondsToMinutes(seconds)) : "");

  const write = (raw: string) => {
    setDraft(raw);
    const n = parseNumber(raw);
    if (n === null) {
      if (!raw.trim()) store?.setField(path, undefined, `${label} entfernt`, { coalesce: true });
      return;
    }
    store?.setField(path, minutesToSeconds(n), `${label} geändert`, { coalesce: true });
  };

  return (
    <FieldFrame id={id} label={label} hint={hint} required={required} issues={issues} feld={feld}>
      <span class="ed-unit">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={shown}
          placeholder={placeholder !== undefined ? String(secondsToMinutes(placeholder)) : undefined}
          min={min ?? 0}
          max={max}
          step={0.5}
          aria-invalid={hasError(issues) || undefined}
          aria-describedby={describedBy(id, !!hint, issues.length > 0)}
          onInput={(e) => write(e.currentTarget.value)}
          onBlur={() => {
            setDraft(null);
            store?.touch(path);
          }}
        />
        <span class="muted">Minuten</span>
      </span>
    </FieldFrame>
  );
}
