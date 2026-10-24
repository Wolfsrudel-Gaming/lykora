/**
 * Paket A: Strafe (keine, Zeit, Punkte, Sperre) an einem Pfad – für falsche Antworten, Tipps und
 * Sperrzonen. Zeit und Sperre werden in Minuten bedient, das Format speichert Sekunden.
 * Mit `optional` gibt es „Standard“: das Feld wird entfernt, der Standard des Spiels gilt.
 */

import { useId } from "preact/hooks";
import { editor, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { JsonPointer } from "../../../../lib/editor/types.ts";
import { minutesToSeconds, secondsToMinutes } from "./DurationInput.tsx";
import { FieldFrame, describedBy, hasError, useFeld } from "./FieldFrame.tsx";
import { parseNumber } from "./NumberInput.tsx";

export type PenaltyType = "none" | "time" | "points" | "lockout";
export interface Penalty {
  type: PenaltyType;
  amount?: number;
}

export const PENALTY_LABELS: Record<PenaltyType, string> = { none: "keine", time: "Zeit", points: "Punkte", lockout: "Sperre" };

/** Formularstand aus dem Wert: Minuten bei time/lockout, Punkte bei points. */
export function penaltyToForm(p: Penalty | undefined): { type: PenaltyType | ""; amount: string } {
  if (!p || typeof p !== "object") return { type: "", amount: "" };
  const type = (["none", "time", "points", "lockout"] as PenaltyType[]).includes(p.type) ? p.type : "";
  if (type === "" || type === "none" || typeof p.amount !== "number") return { type, amount: "" };
  return { type, amount: String(type === "points" ? p.amount : secondsToMinutes(p.amount)) };
}

/** Wert aus dem Formular; "" → undefined (Standard), none ohne Betrag. */
export function penaltyFromForm(type: PenaltyType | "", amount: string): Penalty | undefined {
  if (type === "") return undefined;
  if (type === "none") return { type: "none" };
  const n = parseNumber(amount);
  if (n === null) return { type };
  return { type, amount: type === "points" ? Math.round(n) : minutesToSeconds(n) };
}

export function PenaltyInput({ path, label, hint, optional }: { path: JsonPointer; label: string; hint?: string; optional?: boolean }) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const value = useFieldValue<Penalty>(path);
  const issues = useIssuesAt(path);
  const form = penaltyToForm(value);
  const write = (type: PenaltyType | "", amount: string) => store?.setField(path, penaltyFromForm(type, amount), `${label} geändert`, { coalesce: true });
  const unit = form.type === "points" ? "Punkte" : "Minuten";

  return (
    <FieldFrame id={id} label={label} hint={hint} issues={issues} feld={feld}>
      <span class="ed-unit">
        <select
          id={id}
          value={form.type}
          aria-invalid={hasError(issues) || undefined}
          aria-describedby={describedBy(id, !!hint, issues.length > 0)}
          onChange={(e) => write(e.currentTarget.value as PenaltyType | "", form.amount)}
          onBlur={() => store?.touch(path)}
        >
          {optional && <option value="">Standard</option>}
          {(Object.keys(PENALTY_LABELS) as PenaltyType[]).map((t) => (
            <option key={t} value={t}>
              {PENALTY_LABELS[t]}
            </option>
          ))}
        </select>
        {form.type && form.type !== "none" && (
          <>
            <input
              type="number"
              inputMode="decimal"
              aria-label={`${label}: ${unit}`}
              value={form.amount}
              min={0}
              step={form.type === "points" ? 1 : 0.5}
              onInput={(e) => write(form.type, e.currentTarget.value)}
              onBlur={() => store?.touch(path)}
            />
            <span class="muted">{unit}</span>
          </>
        )}
      </span>
    </FieldFrame>
  );
}
