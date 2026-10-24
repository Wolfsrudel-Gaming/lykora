/**
 * Paket D: Punkte (UX §10.1) – Standard je gelöster Station und darunter jede Station mit eigenem
 * Wert oder „Standard“. Boni stehen in den Einstellungen.
 */

import { SOLVE_POINTS } from "../../../../lib/editor/stations.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";

export function Points({ gameId }: { gameId: string }) {
  const solve = useEditorSelect((s) => s.game.settings?.scoring?.solvePoints ?? SOLVE_POINTS);
  const shown = useEditorSelect((s) => (s.game.settings?.mode ?? "competitive") === "competitive");
  const rows = useEditorSelect(
    (s) =>
      (s.game.stations ?? []).flatMap((st, index) =>
        st && typeof st.id === "string" ? [{ id: st.id, index, name: readText(st.name as never, s.lang) || `Station ${index + 1}`, final: st.final === true, task: !!st.task }] : [],
      ),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <section class="card stack" aria-labelledby="belohnungen-punkte">
      <h3 id="belohnungen-punkte" tabIndex={-1}>
        Punkte
      </h3>
      {!shown && <p class="notice small">Bei dieser Spielart zeigt die App den Teams keine Punkte. Gezählt werden sie trotzdem.</p>}
      <NumberInput path="/settings/scoring/solvePoints" label="Punkte je gelöster Station" integer min={0} placeholder={`${SOLVE_POINTS} (Standard)`} />
      <div class="grid-3 d-points">
        {rows.map((r, i) => (
          <div key={r.id} data-objekt={r.id}>
            <NumberInput
              path={`/stations/${r.index}/rewards/points`}
              label={`${r.final ? "★" : i + 1} ${r.name}`}
              integer
              min={0}
              placeholder={`${solve} (Standard)`}
              hint={r.task ? undefined : "Ohne Rätsel wird die Station nie gelöst."}
            />
          </div>
        ))}
      </div>
      <p class="small muted">
        Boni für Schnelligkeit, die Ersten am Ort und Serien ohne Fehler:{" "}
        <Link to={href("editorSection", { gameId, section: "einstellungen" }, { feld: "settings.scoring" })}>in den Einstellungen ›</Link>
      </p>
    </section>
  );
}
