/**
 * Paket E: „Vor dem Spieltag“ – Punkte zum Abhaken, die nichts blockieren (UX §16.7). Abgehakt
 * wird in den Merkern des Entwurfs (meta.checklist, ohne Rückgängig-Schritt); „Probelauf gemacht“
 * hakt sich nach einem Probelauf selbst ab.
 */

import { stationPoint } from "../../../../lib/editor/geo.ts";
import { editor, useEditorSelect } from "../../../../lib/editor/store.ts";
import type { EditorMeta, Game } from "../../../../lib/editor/types.ts";
import { base, pagePath } from "../../../../lib/base.ts";
import { formatDateTime } from "../../../../lib/format.ts";
import { href, setQuery } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";

export interface DayItem {
  key: string;
  label: string;
  done: string | null;
  action?: { label: string; to?: string; probelauf?: boolean; external?: boolean };
}

/** Punkte der Liste aus Spiel und Merkern; Nachtspiele bekommen „bei Dunkelheit abgegangen“. */
export function dayItems(game: Game, meta: EditorMeta, gameId: string): DayItem[] {
  const ticked = meta.checklist ?? {};
  const stations = (Array.isArray(game.stations) ? game.stations : []).filter((s) => s && typeof s === "object");
  const located = stations.filter((s) => stationPoint(s)).length;
  const onSite = stations.filter((s) => meta.onSite?.[s.id]).length;
  const items: DayItem[] = [
    {
      key: "probelauf",
      label: meta.lastTestRun ? `Probelauf gemacht (${formatDateTime(meta.lastTestRun.at)})` : "Probelauf gemacht",
      done: meta.lastTestRun?.at ?? ticked.probelauf ?? null,
      action: { label: "Probelauf", probelauf: true },
    },
  ];
  if (game.meta?.night) items.push({ key: "dunkel", label: "Spielfeld bei Dunkelheit abgegangen", done: ticked.dunkel ?? null });
  items.push(
    {
      key: "vor-ort",
      label: `Alle Stationen vor Ort geprüft (${onSite} von ${stations.length} vor Ort bestätigt, ${located} mit Ort)`,
      done: ticked["vor-ort"] ?? (stations.length > 0 && onSite === stations.length ? "auto" : null),
      action: { label: "Vor Ort ↗", to: href("onSite", { gameId }), external: true },
    },
    { key: "schilder", label: "Stationsschilder gedruckt und aufgehängt", done: ticked.schilder ?? null, action: { label: "Schilder drucken", to: href("editorSection", { gameId, section: "veroeffentlichen" }, { drucken: "schilder" }) } },
    { key: "blatt", label: "Blatt für die Spielleitung gedruckt", done: ticked.blatt ?? null, action: { label: "Blatt drucken", to: href("editorSection", { gameId, section: "veroeffentlichen" }, { drucken: "blatt" }) } },
    { key: "material", label: "Materialliste gepackt", done: ticked.material ?? null, action: { label: "Materialliste", to: href("gameMaterials", { gameId }) } },
  );
  return items;
}

export function PreGameDay({ gameId }: { gameId: string }) {
  const game = useEditorSelect((s) => s.game);
  const meta = useEditorSelect((s) => s.meta);
  const items = dayItems(game, meta, gameId);

  const toggle = (item: DayItem, on: boolean) => {
    editor.get().current?.update(
      on ? `„${item.label}“ abgehakt` : `Haken bei „${item.label}“ entfernt`,
      (_game, m) => {
        const list = { ...(m.checklist ?? {}) };
        if (on) list[item.key] = new Date().toISOString();
        else delete list[item.key];
        if (Object.keys(list).length) m.checklist = list;
        else delete m.checklist;
        if (!on && item.key === "probelauf") delete m.lastTestRun;
      },
      { metaOnly: true },
    );
  };

  return (
    <section class="card stack" aria-labelledby="pub-day">
      <h3 id="pub-day" class="label">
        Vor dem Spieltag <span class="muted">(zum Abhaken, blockiert nichts)</span>
      </h3>
      <ul class="pub-day">
        {items.map((item) => (
          <li key={item.key}>
            <label class="check">
              <input type="checkbox" checked={!!item.done} onChange={(e) => toggle(item, e.currentTarget.checked)} />
              <span>
                {item.label}
                {item.done && item.done !== "auto" && item.key !== "probelauf" && <span class="muted small"> · {formatDateTime(item.done)}</span>}
              </span>
            </label>
            {item.action?.probelauf && (
              <button type="button" class="btn small" onClick={() => setQuery({ probelauf: "1" })}>
                {item.action.label}
              </button>
            )}
            {item.action?.to &&
              (item.action.external ? (
                <a href={pagePath(base(), item.action.to)} class="btn small" target="_blank" rel="noopener">
                  {item.action.label}
                </a>
              ) : (
                <Link to={item.action.to} class="btn small">
                  {item.action.label}
                </Link>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
