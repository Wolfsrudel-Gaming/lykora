/**
 * Paket A: Verweis auf ein Objekt des Spiels (Station, Figur, Gegenstand, Kapitel, Codeteil, Medium,
 * Sperrzone, Regel) – zeigt Namen, nie Kennungen (außer in der Expertenansicht). Einzeln als
 * Auswahlliste, mehrfach als Ankreuzliste; „+ Neu“ legt über onCreate ein Objekt an und wählt es.
 */

import { useId } from "preact/hooks";
import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Game, IdKind, JsonPointer } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { IssueList } from "./IssueList.tsx";
import { describedBy, hasError } from "./FieldFrame.tsx";

export interface RefOption {
  value: string;
  label: string;
}

export const KIND_LABELS: Record<IdKind, string> = {
  station: "Station",
  figur: "Figur",
  gegenstand: "Gegenstand",
  kapitel: "Kapitel",
  regel: "Regel",
  zone: "Sperrzone",
  teil: "Codeteil",
  medium: "Medium",
  punkt: "Ort",
};

type Entry = { id?: string; name?: unknown; title?: unknown; position?: number; value?: string; final?: boolean };
const list = (x: unknown): Entry[] => (Array.isArray(x) ? x.filter((e) => e && typeof e === "object" && typeof e.id === "string") : []);

/** Wählbare Einträge einer Art in Spielreihenfolge; expert hängt die Kennung an. */
export function refOptions(game: Game, kind: IdKind, lang: string, expert = false): RefOption[] {
  const g = game as unknown as Record<string, unknown>;
  const name = (e: Entry, fallback: string) => readText((e.name ?? e.title) as never, lang) || fallback;
  let out: RefOption[];
  switch (kind) {
    case "station":
      out = list(g.stations).map((e, i) => ({ value: e.id!, label: `${e.final ? "★" : i + 1} ${name(e, `Station ${i + 1}`)}` }));
      break;
    case "figur":
      out = list(g.characters).map((e) => ({ value: e.id!, label: name(e, e.id!) }));
      break;
    case "gegenstand":
      out = list(g.items).map((e) => ({ value: e.id!, label: name(e, e.id!) }));
      break;
    case "kapitel":
      out = list((g.story as { chapters?: unknown } | undefined)?.chapters).map((e, i) => ({ value: e.id!, label: name(e, `Kapitel ${i + 1}`) }));
      break;
    case "teil":
      out = list(g.fragments).map((e, i) => ({ value: e.id!, label: `Teil ${typeof e.position === "number" ? e.position : i + 1}${e.value ? ` (${e.value})` : ""}` }));
      break;
    case "medium":
      out = list(g.media).map((e) => ({ value: e.id!, label: readText((e as { alt?: unknown }).alt as never, lang) || e.id! }));
      break;
    case "zone":
      out = list((g.field as { restrictedZones?: unknown } | undefined)?.restrictedZones).map((e, i) => ({ value: e.id!, label: name(e, `Sperrzone ${i + 1}`) }));
      break;
    case "regel":
      out = list(g.rules).map((e, i) => ({ value: e.id!, label: `Regel ${i + 1}` }));
      break;
    case "punkt": {
      const f = (g.field ?? {}) as { assemblyPoint?: Entry; rescuePoints?: unknown; supplyPoints?: unknown };
      out = [
        ...(f.assemblyPoint?.id ? [{ value: f.assemblyPoint.id, label: `Sammelpunkt ${name(f.assemblyPoint, "")}`.trim() }] : []),
        ...list(f.rescuePoints).map((e, i) => ({ value: e.id!, label: `Rettungspunkt ${name(e, String(i + 1))}` })),
        ...list(f.supplyPoints).map((e, i) => ({ value: e.id!, label: `Versorgungspunkt ${name(e, String(i + 1))}` })),
      ];
      break;
    }
  }
  return expert ? out.map((o) => ({ ...o, label: `${o.label} · ${o.value}` })) : out;
}

interface Shared {
  kind: IdKind;
  label: string;
  hint?: string;
  /** Pfad des Felds im Entwurf, für Meldungen und data-feld */
  path?: JsonPointer;
  /** data-feld, wenn kein Pfad gegeben ist */
  feld?: string;
  onCreate?: () => Promise<string | null> | string | null;
  required?: boolean;
}

type Props = Shared & ({ multiple?: false; value: string | undefined; onChange: (id: string | undefined) => void } | { multiple: true; value: string[]; onChange: (ids: string[]) => void });

export function RefSelect(props: Props) {
  const { kind, label, hint, path, onCreate, required } = props;
  const id = useId();
  const options = useEditorSelect((s) => refOptions(s.game, kind, s.lang, s.expert), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  // Ohne Pfad gibt es keine Meldungen am Feld: ein Pfad, der nie vorkommt.
  const issues = useIssuesAt(path ?? "/-");
  const feld = props.feld ?? (path ? feldFromPath(path) : kind);
  const invalid = hasError(issues) || undefined;
  const describe = describedBy(id, !!hint, issues.length > 0);

  const create = async () => {
    if (!onCreate) return;
    const created = await onCreate();
    if (!created) return;
    if (props.multiple) props.onChange([...props.value, created]);
    else props.onChange(created);
  };

  return (
    <div class={`field ed-field${invalid ? " invalid" : ""}`} data-feld={feld}>
      {props.multiple ? (
        <fieldset class="ed-refs" aria-describedby={describe} aria-invalid={invalid}>
          <legend>
            {label}
            {required && <span class="muted"> (Pflicht)</span>}
          </legend>
          {options.length === 0 && <p class="small muted">Noch nichts angelegt.</p>}
          {options.map((o) => (
            <label key={o.value} class="check">
              <input
                type="checkbox"
                checked={props.value.includes(o.value)}
                onChange={(e) => props.onChange(e.currentTarget.checked ? [...props.value, o.value] : props.value.filter((v) => v !== o.value))}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <label for={id}>
            {label}
            {required && <span class="muted"> (Pflicht)</span>}
          </label>
          <span class="ed-unit">
            <select id={id} value={props.value ?? ""} aria-invalid={invalid} aria-describedby={describe} onChange={(e) => props.onChange(e.currentTarget.value || undefined)}>
              <option value="">– bitte wählen –</option>
              {props.value && !options.some((o) => o.value === props.value) && <option value={props.value}>Unbekannt: {props.value}</option>}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        </>
      )}
      {onCreate && (
        <button type="button" class="btn small ed-ref-new" onClick={() => void create()}>
          <Icon name="plus" /> Neu
        </button>
      )}
      {hint && <small id={`${id}-hinweis`}>{hint}</small>}
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </div>
  );
}

/** data-feld aus einem Pfad ohne Store-Zugriff: Punkt-Pfad ab dem Objekt, wenn der Pfad in eine Liste zeigt. */
export function feldFromPath(path: JsonPointer): string {
  const parts = path.split("/").slice(1);
  const lists = ["stations", "rules", "characters", "items", "fragments", "media"];
  if (parts[0] === "story" && parts[1] === "chapters" && /^\d+$/.test(parts[2] ?? "")) return parts.slice(3).join(".");
  if (parts[0] === "field" && parts[1] === "restrictedZones" && /^\d+$/.test(parts[2] ?? "")) return parts.slice(3).join(".");
  if (parts[0] && lists.includes(parts[0]) && /^\d+$/.test(parts[1] ?? "")) return parts.slice(2).join(".");
  return parts.join(".");
}
