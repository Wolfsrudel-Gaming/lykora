/**
 * Paket A: Bereichs-Navigation des Baukastens mit Zählern (✓, ! 2, ✗ 1 · ! 2 – Form und Text, nicht nur
 * Farbe) und darunter die Stationsliste. Drei Formen: volle Liste (breit), Symbolleiste mit Tooltip
 * (mittel) und Auswahlfeld „Bereich“ (schmal). Die Stationsliste ist hier eine einfache Liste in
 * Spielreihenfolge; Paket B hängt seine sortierbare über `stationList` in sections.ts ein.
 */

import type { ComponentType } from "preact";
import { useEditorSelect, shallowArray } from "../../../lib/editor/store.ts";
import { readText } from "../../../lib/editor/text.ts";
import type { EditorIssue, Section } from "../../../lib/editor/types.ts";
import { href, navigate } from "../../../lib/router.ts";
import { Link } from "../../../ui/components.tsx";
import { Icon, type IconName } from "../../../ui/icons.tsx";
import * as sections from "./sections.ts";

export type Counts = Record<Section, { errors: number; warnings: number }>;

export interface NavItem {
  section: Exclude<Section, "stationen">;
  label: string;
  icon: IconName;
  /** Bereiche der Prüfung, deren Meldungen hier gezählt werden */
  counts: Section[];
}

/** Reihenfolge wie in UX §5.2; Stationsmeldungen zählen bei „Karte & Stationen“. */
export const NAV_ITEMS: NavItem[] = [
  { section: "uebersicht", label: "Übersicht", icon: "list", counts: [] },
  { section: "karte", label: "Karte & Stationen", icon: "map", counts: ["karte", "stationen"] },
  { section: "geschichte", label: "Geschichte", icon: "log", counts: ["geschichte"] },
  { section: "raetsel", label: "Rätsel & Aufgaben", icon: "edit", counts: ["raetsel"] },
  { section: "belohnungen", label: "Belohnungen", icon: "trophy", counts: ["belohnungen"] },
  { section: "regeln", label: "Regeln", icon: "route", counts: ["regeln"] },
  { section: "sicherheit", label: "Sicherheit", icon: "alert", counts: ["sicherheit"] },
  { section: "medien", label: "Medien", icon: "image", counts: ["medien"] },
  { section: "klang", label: "Klang", icon: "sound", counts: ["klang"] },
  { section: "einstellungen", label: "Einstellungen", icon: "gear", counts: ["einstellungen"] },
  { section: "veroeffentlichen", label: "Veröffentlichen", icon: "upload", counts: [] },
];

export interface Counter {
  errors: number;
  warnings: number;
}

export function counterOf(counts: Counts, item: NavItem): Counter {
  const out = { errors: 0, warnings: 0 };
  for (const s of item.counts) {
    out.errors += counts[s]?.errors ?? 0;
    out.warnings += counts[s]?.warnings ?? 0;
  }
  return out;
}

/** Sichtbarer Zähler: ✓ ohne Meldungen, sonst erst Fehler, dann Warnungen („✗ 1 · ! 2“). */
export function counterLabel(c: Counter): string {
  const parts: string[] = [];
  if (c.errors) parts.push(`✗ ${c.errors}`);
  if (c.warnings) parts.push(`! ${c.warnings}`);
  return parts.length ? parts.join(" · ") : "✓";
}

/** Dasselbe in Worten für Vorleser. */
export function counterText(c: Counter): string {
  const parts: string[] = [];
  if (c.errors) parts.push(c.errors === 1 ? "1 Fehler" : `${c.errors} Fehler`);
  if (c.warnings) parts.push(c.warnings === 1 ? "1 Warnung" : `${c.warnings} Warnungen`);
  return parts.length ? parts.join(", ") : "ohne Meldungen";
}

export type StationState = "error" | "warning" | "ok";

/** Zustand einer Station aus ihren Meldungen; ausgeblendete zählen nicht. */
export function stationState(issues: EditorIssue[], stationId: string, dismissed: string[] = []): StationState {
  const hidden = new Set(dismissed);
  let state: StationState = "ok";
  for (const i of issues) {
    if (i.at.section !== "stationen" || i.at.objectId !== stationId || hidden.has(i.id)) continue;
    if (i.severity === "error") return "error";
    state = "warning";
  }
  return state;
}

const STATE_MARK: Record<StationState, { mark: string; text: string }> = {
  error: { mark: "✗", text: "mit Fehler" },
  warning: { mark: "!", text: "mit Warnung" },
  ok: { mark: "✓", text: "in Ordnung" },
};

export interface StationRow {
  id: string;
  /** Laufnummer oder ★ beim Finale */
  number: string;
  name: string;
  hidden: boolean;
  final: boolean;
}

/** Zeilen der Stationsliste in Spielreihenfolge; Lücken im Entwurf fallen weg. */
export function stationRows(stations: unknown, lang: string): StationRow[] {
  if (!Array.isArray(stations)) return [];
  return stations
    .map((s, i) => ({ s: s as { id?: string; name?: unknown; visibility?: string; final?: boolean } | null, i }))
    .filter(({ s }) => s && typeof s === "object" && typeof s.id === "string")
    .map(({ s, i }) => ({
      id: s!.id!,
      number: s!.final ? "★" : String(i + 1),
      name: readText(s!.name as never, lang) || `Station ${i + 1}`,
      hidden: s!.visibility === "hidden",
      final: !!s!.final,
    }));
}

export interface StationListProps {
  gameId: string;
  currentStationId?: string;
}

/** Einfache Stationsliste (Nummer, Name, Zustand); Sortieren liefert Paket B. */
export function SimpleStationList({ gameId, currentStationId }: StationListProps) {
  const rows = useEditorSelect((s) => stationRows(s.game.stations, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const dismissed = useEditorSelect((s) => s.meta.dismissed ?? [], shallowArray);
  if (!rows.length) return <p class="small muted">Noch keine Stationen.</p>;
  return (
    <ol class="editor-stations" aria-label="Stationen">
      {rows.map((r) => {
        const state = STATE_MARK[stationState(issues, r.id, dismissed)];
        return (
          <li key={r.id}>
            <Link to={href("editorStation", { gameId, stationId: r.id })} aria-current={r.id === currentStationId ? "page" : undefined}>
              <span class="num station-no" aria-hidden="true">
                {r.number}
              </span>
              <span class="station-name">
                <span class="sr-only">{r.final ? "Finale: " : `Station ${r.number}: `}</span>
                {r.name}
                {r.hidden && <span class="badge quiet">versteckt</span>}
              </span>
              <span class={`mark ${state === STATE_MARK.ok ? "ok" : state === STATE_MARK.error ? "error" : "warning"}`} aria-label={state.text}>
                {state.mark}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function EditorNav({
  gameId,
  section,
  stationId,
  counts,
  mode,
}: {
  gameId: string;
  section: Section;
  stationId?: string;
  counts: Counts;
  /** full: Liste mit Stationen; rail: Symbolleiste; select: Auswahlfeld */
  mode: "full" | "rail" | "select";
}) {
  const to = (s: NavItem["section"]) => (s === "uebersicht" ? href("editor", { gameId }) : href("editorSection", { gameId, section: s }));
  const active = (s: NavItem["section"]) => (section === "stationen" ? s === "karte" : s === section);
  const StationList: ComponentType<StationListProps> = sections.stationList ?? SimpleStationList;
  // Immer gelesen (Reihenfolge der Hooks), gebraucht nur vom Auswahlfeld.
  const rows = useEditorSelect((s) => stationRows(s.game.stations, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));

  if (mode === "select") {
    const value = section === "stationen" && stationId ? `station:${stationId}` : section;
    return (
      <div class="field editor-nav-select">
        <label for="editor-bereich">Bereich</label>
        <select
          id="editor-bereich"
          value={value}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v.startsWith("station:")) navigate(href("editorStation", { gameId, stationId: v.slice(8) }));
            else navigate(to(v as NavItem["section"]));
          }}
        >
          {NAV_ITEMS.map((item) => {
            const c = counterOf(counts, item);
            return (
              <option key={item.section} value={item.section}>
                {item.label}
                {item.counts.length ? ` · ${counterLabel(c)}` : ""}
              </option>
            );
          })}
          {rows.length > 0 && (
            <optgroup label="Stationen">
              {rows.map((r) => (
                <option key={r.id} value={`station:${r.id}`}>
                  {r.number} {r.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    );
  }

  return (
    <nav class={`editor-nav ${mode}`} aria-label="Bereiche des Baukastens">
      <ul>
        {NAV_ITEMS.map((item) => {
          const c = counterOf(counts, item);
          const label = counterLabel(c);
          const text = counterText(c);
          return (
            <li key={item.section} class={item.section === "veroeffentlichen" ? "publish" : undefined}>
              <Link
                to={to(item.section)}
                aria-current={active(item.section) ? "page" : undefined}
                title={mode === "rail" ? `${item.label}${item.counts.length ? ` – ${text}` : ""}` : undefined}
                aria-label={mode === "rail" ? `${item.label}${item.counts.length ? `, ${text}` : ""}` : undefined}
              >
                <Icon name={item.icon} />
                {mode === "full" && <span class="nav-label">{item.label}</span>}
                {item.counts.length > 0 && (
                  <span class={`mark ${c.errors ? "error" : c.warnings ? "warning" : "ok"}`} aria-hidden={mode === "rail" ? "true" : undefined} aria-label={mode === "full" ? text : undefined}>
                    {mode === "rail" ? (c.errors ? c.errors : c.warnings ? c.warnings : "") : label}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {mode === "full" && (
        <>
          <h2 class="label editor-nav-title">Stationen</h2>
          <StationList gameId={gameId} currentStationId={stationId} />
          <Link to={href("onSite", { gameId })} class="btn small editor-onsite">
            <Icon name="pin" /> Vor Ort öffnen
          </Link>
        </>
      )}
    </nav>
  );
}
