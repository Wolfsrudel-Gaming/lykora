/**
 * Paket D: „Außerdem passiert“ (UX §11.3) – die Wirkungen aus den Stationsbelohnungen als Lesesätze
 * mit Link zur Belohnung der Station. So stehen alle Ursachen an einem Ort.
 */

import { alsoHappens } from "../../../../lib/editor/rules.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";

export function AlsoHappens({ gameId }: { gameId: string }) {
  const lines = useEditorSelect((s) => alsoHappens(s.game, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  if (!lines.length) return null;
  return (
    <section class="stack tight" aria-labelledby="regeln-ausserdem">
      <h3 id="regeln-ausserdem" class="label">
        Außerdem passiert (aus den Stationen, dort bearbeiten)
      </h3>
      <ul class="list card d-also">
        {lines.map((l) => (
          <li key={l.stationId} class="list-item">
            <Link to={href("editorStation", { gameId, stationId: l.stationId }, { feld: "rewards" })}>{l.text} ›</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
