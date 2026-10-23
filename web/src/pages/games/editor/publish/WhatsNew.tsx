/**
 * Paket E: „Was ist neu seit Version n“ – Vergleich des Entwurfs mit der neuesten Version auf
 * Ebene Station, Regel, Figur und Bereich (diff.ts). Daraus kommt auch der Vorschlag für den Kommentar.
 */

import type { DiffEntry } from "../../../../lib/editor/diff.ts";

const MARK: Record<DiffEntry["kind"], { mark: string; text: string }> = {
  added: { mark: "+", text: "neu" },
  removed: { mark: "−", text: "entfernt" },
  changed: { mark: "~", text: "geändert" },
};

/** Höchstens so viele Zeilen, der Rest als Zahl. */
const SHOWN = 12;

/** Kommentar-Vorschlag aus den ersten Änderungen, höchstens 200 Zeichen wie das Feld. */
export function suggestComment(entries: DiffEntry[]): string {
  const text = entries.slice(0, 4).map((e) => e.text).join(", ");
  const more = entries.length > 4 ? ` und ${entries.length - 4} weitere Änderungen` : "";
  return `${text}${more}`.slice(0, 200);
}

export function WhatsNew({ entries, latestVersion }: { entries: DiffEntry[] | null; latestVersion: number | null }) {
  return (
    <section class="card stack tight" aria-labelledby="pub-new">
      <h3 id="pub-new" class="label">
        {latestVersion === null ? "Erste Version" : `Was ist neu seit Version ${latestVersion}`}
      </h3>
      {latestVersion === null ? (
        <p class="muted">Das Spiel wurde noch nie veröffentlicht. Alles im Entwurf wird Version 1.</p>
      ) : entries === null ? (
        <p class="muted">Vergleiche mit Version {latestVersion} …</p>
      ) : entries.length === 0 ? (
        <p class="muted">Keine Änderungen seit Version {latestVersion}.</p>
      ) : (
        <ul class="pub-diff">
          {entries.slice(0, SHOWN).map((e, i) => (
            <li key={i} class={e.kind}>
              <span class="pub-diff-mark" aria-hidden="true">
                {MARK[e.kind].mark}
              </span>
              <span class="sr-only">{MARK[e.kind].text}: </span>
              {e.text}
            </li>
          ))}
          {entries.length > SHOWN && <li class="muted">und {entries.length - SHOWN} weitere</li>}
        </ul>
      )}
    </section>
  );
}
