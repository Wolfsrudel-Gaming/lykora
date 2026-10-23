/**
 * Klänge zuordnen ist der Bereich „Klang“ im Baukasten (Paket D, design 7.5); die alte Adresse
 * leitet dorthin um.
 */

import { RedirectToEditor } from "./Media.tsx";

export function SoundPage({ gameId }: { gameId: string }) {
  return <RedirectToEditor gameId={gameId} section="klang" />;
}
