/**
 * Paket C: Stationseditor unter …/baukasten/stationen/:stationId – eine Seite mit zuklappbaren
 * Abschnitten (Zusammenfassung und Zustand), Blättern ◀ ▶ (auch Alt+Bild↑/↓ im Rahmen) und rechts
 * die Vorschau, die dem Fokus folgt. Breit stehen Formular und Vorschau nebeneinander, sonst untereinander.
 */

import { useState } from "preact/hooks";
import { useEditorSelect, useStation } from "../../../../lib/editor/store.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { stationRows } from "../EditorNav.tsx";
import type { SectionProps } from "../sections.ts";
import { Approach } from "./Approach.tsx";
import { Basics } from "./Basics.tsx";
import { Flow } from "./Flow.tsx";
import { RewardsEditor } from "./RewardsEditor.tsx";
import { Setup } from "./Setup.tsx";
import { StationPreview } from "./StationPreview.tsx";
import { StationSound } from "./StationSound.tsx";
import { Triggers } from "./Triggers.tsx";
import { Visibility } from "./Visibility.tsx";
import "./station.css";

export function StationEditor({ gameId, stationId }: SectionProps) {
  const found = useStation(stationId ?? "");
  const rows = useEditorSelect((s) => stationRows(s.game.stations, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const [focus, setFocus] = useState<string | null>(null);
  if (!found || !stationId) return null;
  const { station, index } = found;
  const row = rows.find((r) => r.id === stationId);
  const at = rows.findIndex((r) => r.id === stationId);
  const prev = at > 0 ? rows[at - 1] : undefined;
  const next = at >= 0 ? rows[at + 1] : undefined;
  const title = `${row?.number ?? index + 1} · ${row?.name ?? "Station"}`;

  return (
    <section key={stationId} class="station-editor stack" data-objekt={stationId} aria-labelledby="bereich-station">
      <nav class="crumbs small" aria-label="Pfad im Baukasten">
        <Link to={href("editorSection", { gameId, section: "karte" })}>Karte & Stationen</Link> ›
      </nav>
      <h2 id="bereich-station" tabIndex={-1}>
        {title}
      </h2>
      <nav class="row between st-pager" aria-label="Stationen blättern">
        {prev ? (
          <Link to={href("editorStation", { gameId, stationId: prev.id })} class="btn small" title="Alt+Bild↑">
            ◀ <span class="st-ellipsis">{prev.number} {prev.name}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={href("editorStation", { gameId, stationId: next.id })} class="btn small" title="Alt+Bild↓">
            <span class="st-ellipsis">{next.number} {next.name}</span> ▶
          </Link>
        )}
      </nav>
      <div class="st-layout">
        <div
          class="st-form stack"
          onFocusIn={(e) => {
            const block = (e.target as Element | null)?.closest?.("[data-block]")?.getAttribute("data-block");
            if (block) setFocus(block);
          }}
        >
          <Basics gameId={gameId} station={station} index={index} />
          <Triggers station={station} index={index} />
          <Visibility gameId={gameId} station={station} index={index} />
          <Approach station={station} index={index} />
          <Flow gameId={gameId} station={station} index={index} />
          <RewardsEditor station={station} index={index} />
          <StationSound station={station} index={index} />
          <Setup station={station} index={index} />
        </div>
        <aside class="st-aside">
          <StationPreview station={station} focus={focus} />
        </aside>
      </div>
    </section>
  );
}
