/**
 * Formularbausteine: Field (Beschriftung, Hinweis, Fehler), Input (Vorsilbe, Einheit, Passwort-Auge), Textarea, Select,
 * Checkbox, Radio, RadioGroup, Switch. Beschriftung per id (nicht verschachtelt), Hinweis und Fehler per aria-describedby,
 * Fehler setzen aria-invalid.
 */

import { cloneElement, type ComponentChildren, type JSX, type Ref, type VNode } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { fieldControlProps, fieldIds, rovingNext } from "./a11y.ts";
import { IconButton } from "./Button.tsx";
import { Icon } from "./icons.tsx";

/**
 * Beschriftetes Feld. Label und Feld sind über id verbunden statt verschachtelt,
 * damit weder Hinweis noch Auswahlliste in den Namen des Feldes rutschen.
 * Das Kind (input, select, textarea, Input, Select …) bekommt id, aria-describedby, aria-invalid.
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
}: {
  label: string;
  hint?: ComponentChildren;
  /** Fehlermeldung: ersetzt den Hinweis, rot, mit Symbol; das Feld wird aria-invalid */
  error?: ComponentChildren;
  /** Pflichtfeld: „(Pflicht)“ hinter dem Namen und aria-required */
  required?: boolean;
  /** Freiwilliges Feld: „(optional)“ hinter dem Namen */
  optional?: boolean;
  children: VNode<{ id?: string; "aria-describedby"?: string }>;
}) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const ids = fieldIds(id);
  const props = fieldControlProps(id, { hint: !!hint && !error, error: !!error, required, describedBy: children.props["aria-describedby"] });
  return (
    <div class="field">
      <label for={id}>
        {label}
        {required && <span class="field-optional">(Pflicht)</span>}
        {optional && !required && <span class="field-optional">(optional)</span>}
      </label>
      {cloneElement(children, props as Record<string, unknown>)}
      {error ? (
        <div class="field-error" id={ids.error}>
          <Icon name="alert-circle" size={16} />
          <span>{error}</span>
        </div>
      ) : (
        hint && <small id={ids.hint}>{hint}</small>
      )}
    </div>
  );
}

type InputBase = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & { innerRef?: Ref<HTMLInputElement> };

export interface InputProps extends InputBase {
  /** Vorsilbe im Feld, z. B. ein Symbol oder „@“ */
  prefix?: ComponentChildren;
  /** Einheit oder Nachsilbe im Feld, z. B. „min“ oder „m“ */
  suffix?: ComponentChildren;
  size?: "sm" | "md" | "lg";
  /** Gültig nach Prüfung durch den Server: Haken rechts */
  ok?: boolean;
  /** Passwortfeld mit Auge (Standard bei type="password") */
  revealable?: boolean;
}

/** Eingabefeld; mit Vorsilbe, Einheit, Haken oder Passwort-Auge als Gruppe. */
export function Input({ prefix, suffix, size = "md", ok, revealable, type = "text", innerRef, class: cls, disabled, ...rest }: InputProps) {
  const [shown, setShown] = useState(false);
  const reveal = type === "password" && revealable !== false;
  const sizeClass = size === "md" ? "" : ` input--${size}`;
  const invalid = rest["aria-invalid"] === true || rest["aria-invalid"] === "true";
  const extra = typeof cls === "string" ? cls : "";
  if (!prefix && !suffix && !ok && !reveal) {
    return <input {...rest} ref={innerRef} type={type} disabled={disabled} class={`input${sizeClass}${extra ? ` ${extra}` : ""}`} />;
  }
  return (
    <div class={`input-group${invalid ? " is-invalid" : ""}${ok && !invalid ? " is-ok" : ""}${disabled ? " is-disabled" : ""}${sizeClass}${extra ? ` ${extra}` : ""}`}>
      {prefix && <span class="input-affix input-affix--start">{prefix}</span>}
      <input {...rest} ref={innerRef} type={reveal && shown ? "text" : type} disabled={disabled} class="input" />
      {suffix && <span class="input-affix input-affix--end">{suffix}</span>}
      {ok && !invalid && (
        <span class="input-affix input-affix--end input-affix--ok">
          <Icon name="check-circle" size={16} label="Geprüft" />
        </span>
      )}
      {reveal && (
        <span class="input-affix input-affix--end">
          <IconButton
            label={shown ? "Passwort verbergen" : "Passwort anzeigen"}
            icon={shown ? "eye-off" : "eye"}
            size="sm"
            aria-pressed={shown}
            disabled={disabled}
            onClick={() => setShown((v) => !v)}
          />
        </span>
      )}
    </div>
  );
}

export function Textarea({ innerRef, class: cls, ...rest }: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { innerRef?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...rest} ref={innerRef} class={`input${typeof cls === "string" && cls ? ` ${cls}` : ""}`} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Auswahl: das native select (Touch-Wähler, Tastatur, Screenreader), im Stil der Eingaben mit eigenem Pfeil. */
export function Select({
  options,
  size = "md",
  innerRef,
  class: cls,
  children,
  ...rest
}: Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "size"> & { options?: SelectOption[]; size?: "sm" | "md" | "lg"; innerRef?: Ref<HTMLSelectElement> }) {
  return (
    <select {...rest} ref={innerRef} class={`input${size === "md" ? "" : ` input--${size}`}${typeof cls === "string" && cls ? ` ${cls}` : ""}`}>
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}

type CheckProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "label"> & { label: ComponentChildren; hint?: ComponentChildren };

/** Haken mit klickbarer Beschriftung (Trefferfläche mindestens 40 px hoch); `indeterminate` für teilweise gewählt. */
export function Checkbox({ label, hint, indeterminate, class: cls, ...rest }: CheckProps & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label class={`check${typeof cls === "string" && cls ? ` ${cls}` : ""}`}>
      <input {...rest} ref={ref} type="checkbox" aria-checked={indeterminate ? "mixed" : undefined} />
      <span>
        {label}
        {hint && <small class="muted"> {hint}</small>}
      </span>
    </label>
  );
}

export function Radio({ label, hint, innerRef, class: cls, ...rest }: CheckProps & { innerRef?: Ref<HTMLInputElement> }) {
  return (
    <label class={`check${typeof cls === "string" && cls ? ` ${cls}` : ""}`}>
      <input {...rest} ref={innerRef} type="radio" />
      <span>
        {label}
        {hint && <small class="muted"> {hint}</small>}
      </span>
    </label>
  );
}

/** Schalter für sofort wirksame Einstellungen; Formulare mit „Speichern“ nehmen Haken. */
export function Switch({ label, class: cls, ...rest }: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "label"> & { label: ComponentChildren }) {
  return (
    <label class={`switch${typeof cls === "string" && cls ? ` ${cls}` : ""}`}>
      <input {...rest} type="checkbox" role="switch" />
      <span>{label}</span>
    </label>
  );
}

/** Radiogruppe mit Pfeiltasten (roving tabindex): eine Gruppe ist ein Tabstopp. */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  orientation = "vertical",
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: ComponentChildren; hint?: ComponentChildren; disabled?: boolean }[];
  onChange: (value: T) => void;
  orientation?: "vertical" | "horizontal";
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const disabled = options.map((o) => !!o.disabled);
  return (
    <fieldset class={`radio-group stack tight${orientation === "horizontal" ? " row" : ""}`} role="radiogroup">
      <legend>{legend}</legend>
      {options.map((o, i) => (
        <Radio
          key={o.value}
          name={name}
          value={o.value}
          label={o.label}
          hint={o.hint}
          disabled={o.disabled}
          checked={o.value === value}
          tabIndex={o.value === value || (!options.some((x) => x.value === value) && i === 0) ? 0 : -1}
          innerRef={(el: HTMLInputElement | null) => {
            refs.current[i] = el;
          }}
          onChange={() => onChange(o.value)}
          onKeyDown={(e: KeyboardEvent) => {
            const next = rovingNext(e.key, i, options.length, { orientation: "both", disabled });
            if (next === null) return;
            e.preventDefault();
            onChange(options[next]!.value);
            refs.current[next]?.focus();
          }}
        />
      ))}
    </fieldset>
  );
}
