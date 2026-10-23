/**
 * Paket B: Mini-Karte in der Übersicht des Baukastens – nur lesen, Klick auf eine Station öffnet
 * die Karte mit dieser Station. Leaflet kommt erst beim Anzeigen (eigener Chunk), damit die
 * Navigation und die Übersicht ohne Karte schnell da sind.
 */

import { shallowArray, useEditorSelect } from "../../../../lib/editor/store.ts";
import { href, navigate } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { LazyEditorMap } from "./LazyMap.tsx";

export function OverviewMap({ gameId }: { gameId: string }) {
  const game = useEditorSelect((s) => s.game);
  const meta = useEditorSelect((s) => s.meta);
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const dismissed = useEditorSelect((s) => s.meta.dismissed ?? [], shallowArray);
  return (
    <div class="stack tight ed-overview-map">
      <div class="ed-overview-map-box">
        <LazyEditorMap
          game={game}
          meta={meta}
          issues={issues}
          dismissed={dismissed}
          label="Karte des Spielfelds (nur ansehen)"
          readOnly
          class="mini"
          onSelect={(s) => s?.kind === "station" && navigate(href("editorSection", { gameId, section: "karte" }, { objekt: s.id }))}
        />
      </div>
      <Link to={href("editorSection", { gameId, section: "karte" })} class="btn small ghost">
        Karte bearbeiten ›
      </Link>
    </div>
  );
}
