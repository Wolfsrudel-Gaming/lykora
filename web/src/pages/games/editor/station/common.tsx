/**
 * Paket C: Gemeinsames des Stationseditors – Zustand der Abschnitte aus den Meldungen, Anlegen von
 * Figuren, Gegenständen und Kapiteln ohne den Block zu verlassen, Medienfeld (Bild oder Klang mit
 * Vorhören), Ortsfeld (Mini-Karte aus Paket B, sonst Koordinaten) und das kleine Menü ⋯.
 */

import type { ComponentChildren, ComponentType } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { base, mediaUrl } from "../../../../lib/base.ts";
import { newId, takenIds } from "../../../../lib/editor/ids.ts";
import { parseCoordinates } from "../../../../lib/editor/stations.ts";
import { editor, shallowArray, useEditorSelect, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, Game, JsonPointer, Point } from "../../../../lib/editor/types.ts";
import { issuesAt } from "../../../../lib/editor/validation.ts";
import { formatCoord } from "../../../../lib/format.ts";
import { confirm, PreviewButton } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import type { CollapsibleState } from "../ui/Collapsible.tsx";
import { FieldFrame, describedBy, hasError, useFeld } from "../ui/FieldFrame.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { pickMedia, type Accept } from "../ui/MediaPicker.tsx";

export const store = () => editor.get().current!;

/** Pfad einer Station im Spiel. */
export const stationPath = (index: number): JsonPointer => `/stations/${index}`;

/**
 * Zustand eines Abschnitts: alle Meldungen darunter (nicht nur berührte, wie in der Navigation),
 * ohne ausgeblendete; ohne Inhalt „noch leer“.
 */
export function useSectionState(paths: JsonPointer[], filled: boolean): CollapsibleState {
  const issues = useEditorSelect((s) => {
    const hidden = new Set(s.meta.dismissed ?? []);
    return paths.flatMap((p) => issuesAt(s.issues, p)).filter((i) => !hidden.has(i.id));
  }, shallowArray);
  return stateOf(issues, filled);
}

export function stateOf(issues: EditorIssue[], filled: boolean): CollapsibleState {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return filled ? "ok" : "empty";
}

/** Fragt nach einem Namen; null bei Abbruch. */
async function askName(title: string, label: string): Promise<string | null> {
  const r = await confirm({ title, input: { label, required: true }, confirm: "Anlegen" });
  return r.ok && r.value ? r.value : null;
}

/** Neue Figur über „+ Neu“ beim Sprecher; Erzähler und Zentrale bekommen ihre Rolle. */
export async function createCharacter(kind: "hq" | "narrator" | "npc" = "npc"): Promise<string | null> {
  const name = await askName("Neue Figur", "Name der Figur");
  if (!name) return null;
  let id: string | null = null;
  store().update(`Figur „${name}“ angelegt`, (g) => {
    id = newId("figur", name, takenIds(g, "figur"));
    g.characters = [...(g.characters ?? []), { id, kind, name: { [langOf(g)]: name } }];
  });
  return id;
}

/** Neuer Gegenstand; ein Fundstück übernimmt Überschrift und Text des Blocks als Vorgabe. */
export async function createItem(kind: "object" | "document", preset: { name?: string; body?: unknown } = {}): Promise<string | null> {
  const name = preset.name || (await askName(kind === "document" ? "Neues Fundstück" : "Neuer Gegenstand", "Name"));
  if (!name) return null;
  let id: string | null = null;
  store().update(`${kind === "document" ? "Fundstück" : "Gegenstand"} „${name}“ angelegt`, (g) => {
    id = newId("gegenstand", name, takenIds(g, "gegenstand"));
    const item: NonNullable<Game["items"]>[number] = { id, name: { [langOf(g)]: name } };
    if (kind === "document") item.kind = "document";
    if (preset.body !== undefined) item.body = preset.body as never;
    g.items = [...(g.items ?? []), item];
  });
  return id;
}

export async function createChapter(): Promise<string | null> {
  const title = await askName("Neues Kapitel", "Titel des Kapitels");
  if (!title) return null;
  let id: string | null = null;
  store().update(`Kapitel „${title}“ angelegt`, (g) => {
    id = newId("kapitel", title, takenIds(g, "kapitel"));
    g.story = { ...(g.story ?? {}), chapters: [...(g.story?.chapters ?? []), { id, title: { [langOf(g)]: title } }] };
  });
  return id;
}

const langOf = (g: Game) => g.meta?.languages?.[0] ?? "de";

/** Ein Medium des Spiels: Anzeigename (Beschreibung, sonst Kennung), Art und Adresse. */
export function useMediaEntry(id: string | undefined): { name: string; type: string; url: string } | null {
  return useEditorSelect(
    (s) => {
      if (!id) return null;
      const m = (s.game.media ?? []).find((x) => x?.id === id);
      if (!m) return { name: id, type: "", url: "" };
      return { name: readText(m.alt as never, s.lang) || m.id, type: m.type, url: mediaUrl(base(), m.src) };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
}

/**
 * Bild oder Klang an einem Pfad wählen (Medienauswahl mit Hochladen und Klangbibliothek),
 * mit Vorhören bzw. Vorschaubild; „Entfernen“ räumt das Feld (oder ruft onClear).
 */
export function MediaSlot({ path, label, accept, hint, onClear, onPick }: { path: JsonPointer; label: string; accept: Exclude<Accept, "any">; hint?: string; onClear?: () => void; onPick?: (id: string) => void }) {
  const id = useId();
  const feld = useFeld(path);
  const value = useFieldValue<string>(path);
  const entry = useMediaEntry(typeof value === "string" ? value : undefined);
  const issues = useIssuesAt(path);
  const choose = async () => {
    const picked = await pickMedia({ accept, title: label });
    if (!picked) return;
    if (onPick) onPick(picked);
    else store().setField(path, picked, `${label} gewählt`);
    store().touch(path);
  };
  return (
    <div class={`field ed-field st-media${hasError(issues) ? " invalid" : ""}`} data-feld={feld}>
      <span class="label" id={`${id}-name`}>
        {label}
      </span>
      <span class="row nowrap st-media-row" aria-describedby={describedBy(id, !!hint, issues.length > 0)}>
        {entry ? (
          <>
            {entry.type === "image" && entry.url && <img class="thumb" src={entry.url} alt="" loading="lazy" />}
            {entry.type === "audio" && entry.url && <PreviewButton src={entry.url} label={entry.name} />}
            <span class="min0 st-media-name">{entry.name}</span>
            <button type="button" class="btn small ghost" aria-label={`${label} ändern`} onClick={() => void choose()}>
              Ändern
            </button>
            <button
              type="button"
              class="btn small ghost"
              aria-label={`${label} entfernen`}
              onClick={() => {
                if (onClear) onClear();
                else store().setField(path, undefined, `${label} entfernt`);
              }}
            >
              <Icon name="x" />
            </button>
          </>
        ) : (
          <button type="button" class="btn small" aria-labelledby={`${id}-name`} onClick={() => void choose()}>
            <Icon name={accept === "image" ? "image" : "sound"} /> {accept === "image" ? "Bild wählen" : "Klang wählen"}
          </button>
        )}
      </span>
      {hint && <small id={`${id}-hinweis`}>{hint}</small>}
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </div>
  );
}

/** Mini-Karte aus Paket B, sobald es sie gibt (import.meta.glob findet die Datei oder nichts). */
type MiniMapProps = { value?: Point; onChange: (p: Point) => void; radius?: number; onRadius?: (r: number) => void };
const MINI_MAP = import.meta.glob<{ MiniMap?: ComponentType<MiniMapProps> }>("../map/MiniMap.tsx");
let miniMap: ComponentType<MiniMapProps> | null | undefined;

function useMiniMap(): ComponentType<MiniMapProps> | null {
  // Eine Komponente ist eine Funktion: useState bekäme sie sonst als Anfangsrechnung.
  const [comp, setComp] = useState<ComponentType<MiniMapProps> | null>(() => miniMap ?? null);
  useEffect(() => {
    if (miniMap !== undefined) return;
    const load = Object.values(MINI_MAP)[0];
    if (!load) {
      miniMap = null;
      return;
    }
    load()
      .then((m) => {
        miniMap = m.MiniMap ?? null;
        setComp(() => miniMap ?? null);
      })
      .catch(() => (miniMap = null));
  }, []);
  return comp;
}

/**
 * Ort an einem Pfad: Mini-Karte zum Ziehen (Paket B) und Koordinaten zum Einfügen, z. B. „50.7374, 7.0982“.
 * radius/onRadius zeigen und ändern den GPS-Radius auf der Karte.
 */
export function LocationField({ path, label, required, hint, radius, onRadius, extra }: { path: JsonPointer; label: string; required?: boolean; hint?: string; radius?: number; onRadius?: (r: number) => void; extra?: ComponentChildren }) {
  const id = useId();
  const feld = useFeld(path);
  const value = useFieldValue<Point>(path);
  const issues = useIssuesAt(path);
  const MiniMap = useMiniMap();
  const point = value && typeof value.lat === "number" && typeof value.lon === "number" ? value : undefined;
  const shown = point ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (!raw) {
      if (!required) store().setField(path, undefined, `${label} entfernt`);
      setBad(false);
      return;
    }
    const p = parseCoordinates(raw);
    setBad(!p);
    if (p) store().setField(path, p, `${label} gesetzt`);
    store().touch(path);
  };
  const set = (p: Point) => {
    store().setField(path, { lat: round(p.lat), lon: round(p.lon) }, `${label} verschoben`);
    store().touch(path);
  };
  return (
    <FieldFrame id={id} label={label} hint={hint} required={required} issues={issues} feld={feld}>
      {MiniMap && <MiniMap value={point} onChange={set} radius={radius} onRadius={onRadius} />}
      <span class="row st-coords">
        <input
          id={id}
          class="mono"
          value={draft ?? shown}
          placeholder="z. B. 50.7374, 7.0982"
          inputMode="decimal"
          aria-invalid={bad || hasError(issues) || undefined}
          aria-describedby={describedBy(id, !!hint, issues.length > 0)}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        {extra}
      </span>
      {bad && <small role="alert">Bitte zwei Zahlen eintragen: Breite, Länge – z. B. 50.7374, 7.0982.</small>}
      {point && !MiniMap && <small class="muted">{formatCoord(point.lat, point.lon)}</small>}
    </FieldFrame>
  );
}

/** Sieben Nachkommastellen reichen für 1 cm. */
const round = (v: number) => Math.round(v * 1e7) / 1e7;

/** Kleines Menü ⋯ für Blöcke und Zeilen; schließt mit Esc und bei Klick daneben. */
export function Menu({ label, text, children }: { label: string; /** sichtbare Beschriftung statt ⋯ */ text?: ComponentChildren; children: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Erster Eintrag bekommt den Fokus, damit die Tastatur gleich weitermachen kann.
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div class="menu" ref={ref}>
      <button type="button" class={`btn small${text ? "" : " ghost"}`} ref={button} aria-haspopup="menu" aria-expanded={open} aria-label={text ? undefined : label} onClick={() => setOpen(!open)}>
        {text ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <ul class="menu-list card" role="menu" onKeyDown={(e) => menuKeys(e)}>
          {children(close)}
        </ul>
      )}
    </div>
  );
}

/** Pfeiltasten wandern durch die Einträge. */
function menuKeys(e: KeyboardEvent) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role=menuitem]")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
  e.preventDefault();
  next?.focus();
}

/** Kürzt auf eine Zeile. */
export function excerpt(value: string, max = 60): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

let keySeq = 0;

/**
 * Stabile Schlüssel für Listen ohne Kennung (Takte, Tipps): sie wandern beim Sortieren mit, damit
 * Fokus und „aufgenommen“ am selben Eintrag bleiben. Neue Einträge hinten bekommen neue Schlüssel.
 */
export function useListKeys(length: number): [string[], (from: number, to: number) => void] {
  const keys = useRef<string[]>([]);
  while (keys.current.length < length) keys.current.push(`k${++keySeq}`);
  if (keys.current.length > length) keys.current = keys.current.slice(0, length);
  const move = (from: number, to: number) => {
    const next = [...keys.current];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k!);
    keys.current = next;
  };
  return [keys.current, move];
}
