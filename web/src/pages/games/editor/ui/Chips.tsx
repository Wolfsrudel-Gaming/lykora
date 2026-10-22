/**
 * Paket A: Liste kurzer Werte als Chips (Antworten, Pflicht-Ausrüstung). Enter oder Komma legt
 * einen Chip an, Rücktaste im leeren Feld entfernt den letzten; mit `text` sind die Werte
 * Sprachtexte, sonst reine Zeichenketten (Antworten gehen nicht durch writeText).
 */

import { useId, useState } from "preact/hooks";
import { getAt, setAt, removeAt } from "../../../../lib/editor/paths.ts";
import { editor, useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { JsonPointer } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { FieldFrame, describedBy, hasError, useFeld } from "./FieldFrame.tsx";

/** Eingabe in Werte: getrennt an Komma und Zeilenumbruch, ohne Leere und Dubletten. */
export function splitChips(raw: string, existing: readonly string[] = []): string[] {
  const seen = new Set(existing);
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const v = part.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function Chips({
  path,
  label,
  hint,
  placeholder,
  required,
  text,
}: {
  path: JsonPointer;
  label: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** Werte sind Sprachtexte ({ de: "…" }) statt Zeichenketten */
  text?: boolean;
}) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const lang = useEditorSelect((s) => s.lang);
  const values = useEditorSelect(
    (s) => {
      const raw = getAt<unknown[]>(s.game, path);
      return Array.isArray(raw) ? raw.map((v) => (text ? readText(v as never, s.lang) : typeof v === "string" ? v : String(v ?? ""))) : [];
    },
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );
  const issues = useIssuesAt(path);
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const next = splitChips(raw, values);
    setDraft("");
    if (!next.length) return;
    store?.update(`${label} ergänzt`, (g) => {
      const arr = getAt<unknown[]>(g, path);
      setAt(g, path, [...(Array.isArray(arr) ? arr : []), ...next.map((v) => (text ? { [lang]: v } : v))]);
    });
    store?.touch(path);
  };

  const remove = (index: number) => {
    store?.update(`${label}: „${values[index]}“ entfernt`, (g) => {
      const arr = getAt<unknown[]>(g, path);
      if (!Array.isArray(arr)) return;
      if (arr.length <= 1 && !required) removeAt(g, path);
      else setAt(g, path, arr.filter((_, i) => i !== index));
    });
    store?.touch(path);
  };

  return (
    <FieldFrame id={id} label={label} hint={hint ?? "Enter oder Komma trennt die Einträge."} required={required} issues={issues} feld={feld}>
      <div class={`chips-input${hasError(issues) ? " invalid" : ""}`}>
        {values.map((v, i) => (
          <span key={`${i}-${v}`} class="chip">
            {v}
            <button type="button" class="chip-remove" aria-label={`„${v}“ entfernen`} onClick={() => remove(i)}>
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={values.length ? undefined : placeholder}
          aria-invalid={hasError(issues) || undefined}
          aria-describedby={describedBy(id, true, issues.length > 0)}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              e.preventDefault();
              remove(values.length - 1);
            }
          }}
          onBlur={() => {
            if (draft.trim()) add(draft);
            store?.touch(path);
          }}
        />
      </div>
    </FieldFrame>
  );
}
