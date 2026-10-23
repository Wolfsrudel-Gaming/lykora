/**
 * Paket A: Löschen mit Verweisen (UX §16.4). Ohne Verweise wird sofort gelöscht – ein Schritt im
 * Verlauf, Strg+Z holt es zurück. Verweist etwas darauf, fragt der Dialog vorher und nennt die
 * Stellen; die Verweise gehen mit (removeWithReferences). DeleteWithReferencesHost steht einmal im EditorShell.
 */

import { removeWithReferences, usagesOf, type Usage } from "../../../lib/editor/references.ts";
import { editor } from "../../../lib/editor/store.ts";
import type { IdKind } from "../../../lib/editor/types.ts";
import { notify } from "../../../lib/session.ts";
import { createStore, useStore } from "../../../lib/store.ts";
import { Dialog } from "../../../ui/components.tsx";
import { KIND_LABELS } from "./ui/RefSelect.tsx";

interface DeleteRequest {
  kind: IdKind;
  id: string;
  name: string;
  usages: Usage[];
  resolve: (deleted: boolean) => void;
}

const pending = createStore<{ open: DeleteRequest | null }>({ open: null });

/** „Station „Baum““ – Art und Name für Titel und Rückgängig-Text. */
export function objectLabel(kind: IdKind, name: string): string {
  return name ? `${KIND_LABELS[kind]} „${name}“` : KIND_LABELS[kind];
}

/** Eine Zeile je Verweis, gleiche Stellen nur einmal: „Regel 2: Bedingung“. */
export function usageLines(usages: Usage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of usages) {
    const line = u.owner.kind === "spiel" ? u.what : `${u.owner.name}: ${u.what}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function remove(kind: IdKind, id: string, name: string): void {
  const store = editor.get().current;
  if (!store) return;
  const label = `${objectLabel(kind, name)} gelöscht`;
  store.update(label, (game, meta) => {
    removeWithReferences(game, kind, id, meta);
  });
  notify(`${label}. Strg+Z holt es zurück.`, "ok");
}

/**
 * Löscht einen Eintrag samt Verweisen; fragt nur, wenn etwas darauf verweist.
 * Liefert, ob gelöscht wurde.
 */
export function deleteWithReferences(kind: IdKind, id: string, name: string): Promise<boolean> {
  const store = editor.get().current;
  if (!store) return Promise.resolve(false);
  const usages = usagesOf(store.get().game, kind, id);
  if (!usages.length) {
    remove(kind, id, name);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    pending.get().open?.resolve(false);
    pending.set({ open: { kind, id, name, usages, resolve } });
  });
}

export function DeleteWithReferencesHost() {
  const { open } = useStore(pending);
  const finish = (ok: boolean) => {
    if (!open) return;
    if (ok) remove(open.kind, open.id, open.name);
    open.resolve(ok);
    pending.set({ open: null });
  };
  const title = open ? `${objectLabel(open.kind, open.name)} löschen?` : "";
  const lines = open ? usageLines(open.usages) : [];
  return (
    <Dialog open={!!open} title={title} onClose={() => finish(false)}>
      {open && (
        <div class="stack">
          <p>Darauf {lines.length === 1 ? "verweist" : "verweisen"}:</p>
          <ul class="ed-usages">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p>Die Verweise werden mit entfernt. Mit Strg+Z holst du alles zurück.</p>
          <div class="form-actions">
            <button type="button" class="btn" onClick={() => finish(false)}>
              Abbrechen
            </button>
            <button type="button" class="btn primary" onClick={() => finish(true)}>
              {KIND_LABELS[open.kind]} löschen
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
