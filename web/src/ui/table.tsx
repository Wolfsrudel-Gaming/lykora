/**
 * Tabelle als Baustein: Kopf (sticky), Dichte, Sortierung (aria-sort), Auswahlzeile, Lade- und Leerzustand,
 * Kartenform unter 560 px Behälterbreite. Wer eine eigene Tabelle schreibt, nimmt <div class="table-wrap"><table class="table">.
 */

import type { ComponentChildren } from "preact";
import { Icon } from "./icons.tsx";
import { EmptyState, SkeletonRows } from "./feedback.tsx";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ComponentChildren;
  /** Zahlen rechtsbündig, gleich breite Ziffern */
  num?: boolean;
  /** Sortierbar: Schlüssel, den onSort bekommt */
  sortable?: boolean;
  /** Beschriftung in der Kartenform (Standard: die Kopfzeile) */
  label?: string;
  /** Aktionsspalte: rechts, Knöpfe erscheinen bei Hover und Fokus */
  actions?: boolean;
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/** Reihenfolge der aria-sort-Werte: erst aufsteigend, dann absteigend, dann keine. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSort,
  selectedKey,
  onRowClick,
  loading,
  empty,
  density,
  sticky = true,
  cards = true,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Beschreibt die Tabelle für Screenreader (sichtbar nicht) */
  caption: string;
  sort?: SortState | null;
  onSort?: (next: SortState | null) => void;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ComponentChildren;
  density?: "regular" | "compact";
  sticky?: boolean;
  /** Schmal als Karten statt Spalten */
  cards?: boolean;
}) {
  if (loading) return <SkeletonRows rows={5} />;
  if (rows.length === 0) return <>{empty ?? <EmptyState variant="inline" title="Nichts zu zeigen" />}</>;
  return (
    <div class="table-wrap" data-density={density}>
      <table class={`table${sticky ? " table--sticky" : ""}${cards ? " table--cards" : ""}`}>
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key ? sort : null;
              return (
                <th key={c.key} class={c.num ? "num" : undefined} scope="col" aria-sort={c.sortable ? (active ? (active.dir === "asc" ? "ascending" : "descending") : "none") : undefined}>
                  {c.sortable && onSort ? (
                    <button type="button" class="th-sort" onClick={() => onSort(nextSort(sort ?? null, c.key))}>
                      {c.header}
                      <Icon name={active ? (active.dir === "asc" ? "arrow-up" : "arrow-down") : "sort"} size={16} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey === key;
            return (
              <tr
                key={key}
                class={selected ? "selected" : undefined}
                aria-current={selected ? "true" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} class={`${c.num ? "num" : ""}${c.actions ? " actions" : ""}`.trim() || undefined} data-label={c.actions ? undefined : (c.label ?? c.header)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
