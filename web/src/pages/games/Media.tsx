/**
 * Medien und Klänge sind Bereiche des Baukastens und schreiben in den Entwurf (Paket D, design 7.5).
 * Die alten Adressen bleiben erreichbar: Autoren landen im Baukasten, alle anderen in der Übersicht
 * des Spiels (wer nicht schreiben darf, sieht keinen Baukasten).
 */

import { useEffect } from "preact/hooks";
import { can } from "../../lib/roles.ts";
import { href, navigate } from "../../lib/router.ts";
import { currentOrg } from "../../lib/session.ts";
import { Loading } from "../../ui/components.tsx";

/** Ziel der alten Adresse für die aktuelle Rolle. */
export function legacyTarget(gameId: string, section: "medien" | "klang", role = currentOrg()?.role): string {
  return can(role, "game.write") ? href("editorSection", { gameId, section }) : href("game", { gameId });
}

export function RedirectToEditor({ gameId, section }: { gameId: string; section: "medien" | "klang" }) {
  useEffect(() => navigate(legacyTarget(gameId, section), { replace: true }), [gameId, section]);
  return (
    <div class="page">
      <Loading />
    </div>
  );
}

export function MediaPage({ gameId }: { gameId: string }) {
  return <RedirectToEditor gameId={gameId} section="medien" />;
}
