/**
 * Paket D: Gemeinsames der Bereiche Geschichte, Belohnungen, Regeln, Einstellungen, Medien und Klang –
 * Kacheln als Auswahl (Spielwelt, Grusel, Spielart), Auswahlliste und Lautstärke an einem Pfad,
 * Meldungen, die sofort erscheinen (Empfehlungen statt Tippfehler), und die Sprungleiste eines Bereichs.
 */

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { editor, isTouched, shallowArray, useEditorSelect, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { EditorIssue, JsonPointer } from "../../../../lib/editor/types.ts";
import { formatPercent } from "../../../../lib/format.ts";
import { DEFAULT_VOLUME } from "../../../../lib/sound.ts";
import { describedBy, FieldFrame, hasError, useFeld } from "../ui/FieldFrame.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import "./story.css";

export const store = () => editor.get().current!;

/**
 * Meldungen genau an diesen Pfaden, sofort und ohne ausgeblendete – für Hinweise an Karten und Gruppen.
 * Mit `field` zeigt ein Formularfeld sie schon selbst, sobald es berührt ist – dann hier nicht doppelt.
 */
export function useLiveIssues(paths: JsonPointer[], opts: { codes?: string[]; field?: boolean } = {}): EditorIssue[] {
  return useEditorSelect((s) => {
    const hidden = new Set(s.meta.dismissed ?? []);
    return s.issues.filter(
      (i) => !hidden.has(i.id) && paths.includes(i.at.path) && (!opts.codes || opts.codes.includes(i.code)) && !(opts.field && (s.showAll || isTouched(s.touched, i.at.path))),
    );
  }, shallowArray);
}

export interface TileOption<T> {
  value: T;
  title: string;
  text?: string;
}

/**
 * Auswahl als Kacheln (Radiogruppe): Pfeiltasten wandern, Leertaste wählt. value undefined = nichts
 * gewählt (der Standard gilt); feld setzt data-feld für den Sprung.
 */
export function Tiles<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  feld,
  hint,
  issues = [],
  compact,
}: {
  legend: string;
  options: TileOption<T>[];
  value: T | undefined;
  onChange: (v: T) => void;
  feld?: string;
  hint?: ComponentChildren;
  issues?: EditorIssue[];
  compact?: boolean;
}) {
  const id = useId();
  return (
    <fieldset class={`field ed-field d-tiles${compact ? " compact" : ""}`} data-feld={feld} aria-describedby={describedBy(id, !!hint, issues.length > 0)}>
      <legend class="label">{legend}</legend>
      <div class="d-tile-grid">
        {options.map((o) => (
          <label key={String(o.value)} class={`d-tile${o.value === value ? " on" : ""}`}>
            <input type="radio" name={id} class="sr-only" checked={o.value === value} onChange={() => onChange(o.value)} />
            <span class="d-tile-title">{o.title}</span>
            {o.text && <span class="small muted">{o.text}</span>}
          </label>
        ))}
      </div>
      {hint && <small id={`${id}-hinweis`}>{hint}</small>}
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </fieldset>
  );
}

/**
 * Auswahlliste an einem Pfad. Ohne Wert zeigt sie defaultValue (den Standard des Formats) und schreibt
 * erst, wenn jemand wählt. standard: ein eigener leerer Eintrag, der das Feld wieder entfernt.
 */
export function SelectField({
  path,
  label,
  options,
  standard,
  defaultValue,
  hint,
}: {
  path: JsonPointer;
  label: string;
  options: { value: string; label: string }[];
  standard?: string;
  defaultValue?: string;
  hint?: string;
}) {
  const id = useId();
  const feld = useFeld(path);
  const value = useFieldValue<unknown>(path);
  const issues = useIssuesAt(path);
  const current = typeof value === "string" ? value : (defaultValue ?? "");
  return (
    <FieldFrame id={id} label={label} hint={hint} issues={issues} feld={feld}>
      <select
        id={id}
        value={current}
        aria-invalid={hasError(issues) || undefined}
        aria-describedby={describedBy(id, !!hint, issues.length > 0)}
        onChange={(e) => {
          const next = e.currentTarget.value;
          const o = options.find((x) => x.value === next);
          store().setField(path, next || undefined, `${label}: ${o?.label ?? standard ?? "Standard"}`);
          store().touch(path);
        }}
      >
        {standard !== undefined && <option value="">{standard}</option>}
        {current && !options.some((o) => o.value === current) && <option value={current}>{current}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/** Lautstärke 0–100 % an einem Pfad; ohne Wert gilt der Standard des Formats (60 %). */
export function VolumeField({ path, label = "Lautstärke" }: { path: JsonPointer; label?: string }) {
  const id = useId();
  const feld = useFeld(path);
  const raw = useFieldValue<number>(path);
  const value = typeof raw === "number" ? raw : DEFAULT_VOLUME;
  return (
    <div class="field ed-field" data-feld={feld}>
      <label for={id}>{label}</label>
      <span class="volume">
        <input
          id={id}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          aria-valuetext={formatPercent(value)}
          onInput={(e) => store().setField(path, Math.round(Number(e.currentTarget.value) * 100) / 100, `${label} geändert`, { coalesce: true })}
          onChange={() => store().touch(path)}
        />
        <span class="num" aria-hidden="true">
          {formatPercent(value)}
        </span>
      </span>
    </div>
  );
}

/** Sprungleiste eines Bereichs: Knöpfe statt #-Links (die Seite hat ein <base>), Fokus auf die Überschrift. */
export function JumpBar({ label, targets }: { label: string; targets: { id: string; title: string }[] }) {
  const go = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };
  return (
    <nav class="d-jumpbar" aria-label={label}>
      {targets.map((t) => (
        <button key={t.id} type="button" class="btn small ghost" onClick={() => go(t.id)}>
          {t.title}
        </button>
      ))}
    </nav>
  );
}

/** „ohne Wirkung“-Hinweis für Felder, die die App derzeit nicht nutzt. */
export const NO_EFFECT = "Derzeit ohne Wirkung in der App.";

const ROMAN: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function toRoman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** „a, b und c“ */
export function joinAnd(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}
