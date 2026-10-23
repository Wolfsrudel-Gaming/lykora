/**
 * Paket A: Text an einem Pfad (Titel, Frage, Tipp …). Schreibt bei jeder Eingabe verschmolzen in
 * den Verlauf, berührt das Feld beim Verlassen; Pflichtfelder bleiben als leerer Text stehen.
 * Standard ist ein Sprachtext ({ de: "…" }); `plain` für reine Zeichenketten (Telefon, Codes,
 * Notizen, Kachel-Adresse), die nicht durch writeText gehen.
 */

import { useId } from "preact/hooks";
import { editor, useFieldValue, useIssuesAt, useTextField } from "../../../../lib/editor/store.ts";
import type { EditorIssue, JsonPointer } from "../../../../lib/editor/types.ts";
import { FieldFrame, describedBy, hasError, useFeld } from "./FieldFrame.tsx";

export interface TextFieldProps {
  path: JsonPointer;
  label: string;
  required?: boolean;
  multiline?: boolean;
  /** reine Zeichenkette statt Sprachtext */
  plain?: boolean;
  hint?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  /** Eingabeart für Handys, z. B. "tel" */
  inputMode?: "text" | "tel" | "numeric" | "url" | "email";
}

export function TextField(props: TextFieldProps) {
  return props.plain ? <PlainText {...props} /> : <LangText {...props} />;
}

function LangText(props: TextFieldProps) {
  const field = useTextField(props.path, `${props.label} geändert`, { required: props.required });
  return <TextInput {...props} value={field.value} issues={field.issues} onInput={field.set} onBlur={field.blur} />;
}

function PlainText(props: TextFieldProps) {
  const store = editor.get().current;
  const raw = useFieldValue<unknown>(props.path);
  const issues = useIssuesAt(props.path);
  const set = (v: string) => store?.setField(props.path, v || (props.required ? "" : undefined), `${props.label} geändert`, { coalesce: true });
  return <TextInput {...props} value={typeof raw === "string" ? raw : ""} issues={issues} onInput={set} onBlur={() => store?.touch(props.path)} />;
}

function TextInput({
  path,
  label,
  required,
  multiline,
  hint,
  placeholder,
  rows,
  maxLength,
  inputMode,
  value,
  issues,
  onInput,
  onBlur,
}: TextFieldProps & { value: string; issues: EditorIssue[]; onInput: (v: string) => void; onBlur: () => void }) {
  const id = useId();
  const feld = useFeld(path);
  const shared = {
    id,
    value,
    placeholder,
    maxLength,
    "aria-invalid": hasError(issues) || undefined,
    "aria-describedby": describedBy(id, !!hint, issues.length > 0),
    onBlur,
  };
  return (
    <FieldFrame id={id} label={label} hint={hint} required={required} issues={issues} feld={feld}>
      {multiline ? (
        <textarea {...shared} rows={rows ?? 4} onInput={(e) => onInput(e.currentTarget.value)} />
      ) : (
        <input {...shared} inputMode={inputMode} onInput={(e) => onInput(e.currentTarget.value)} />
      )}
    </FieldFrame>
  );
}
