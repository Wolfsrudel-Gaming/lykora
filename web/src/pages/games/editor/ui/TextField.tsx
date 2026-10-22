/**
 * Paket A: Sprachtext an einem Pfad (Titel, Frage, Tipp …). Schreibt bei jeder Eingabe verschmolzen
 * in den Verlauf, berührt das Feld beim Verlassen; Pflichtfelder bleiben als leerer Text stehen.
 */

import { useId } from "preact/hooks";
import { useTextField } from "../../../../lib/editor/store.ts";
import type { JsonPointer } from "../../../../lib/editor/types.ts";
import { FieldFrame, describedBy, hasError, useFeld } from "./FieldFrame.tsx";

export function TextField({
  path,
  label,
  required,
  multiline,
  hint,
  placeholder,
  rows,
  maxLength,
}: {
  path: JsonPointer;
  label: string;
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  const id = useId();
  const feld = useFeld(path);
  const field = useTextField(path, `${label} geändert`, { required });
  const shared = {
    id,
    value: field.value,
    placeholder,
    maxLength,
    "aria-invalid": hasError(field.issues) || undefined,
    "aria-describedby": describedBy(id, !!hint, field.issues.length > 0),
    onBlur: field.blur,
  };
  return (
    <FieldFrame id={id} label={label} hint={hint} required={required} issues={field.issues} feld={feld}>
      {multiline ? (
        <textarea {...shared} rows={rows ?? 4} onInput={(e) => field.set(e.currentTarget.value)} />
      ) : (
        <input {...shared} onInput={(e) => field.set(e.currentTarget.value)} />
      )}
    </FieldFrame>
  );
}
