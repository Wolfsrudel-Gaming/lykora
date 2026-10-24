/**
 * Paket D: Finalcode-Baukasten (UX §10.2). Der Code wird getippt, die Teile entstehen daraus (jedes
 * Zeichen ein Teil oder eigene Teile, getrennt mit |); je Teil wählt man die Station, die es vergibt.
 * Positionen sieht niemand. Ein gekoppeltes Finale folgt jeder Änderung ohne Rückfrage; entkoppeln
 * gilt für diese Sitzung (das Spiel kennt keinen Merker dafür) und zeigt danach die Abweichung als Warnung.
 */

import { useId, useRef, useState } from "preact/hooks";
import { assignFragment, coupleFinal, finalCode, isCoupled, setFinalCode, sortedFragments, splitMode, type Split } from "../../../../lib/editor/fragments.ts";
import { TASK_TYPE_LABELS } from "../../../../lib/editor/stations.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { store, useLiveIssues } from "../story/shared.tsx";

/** Spiele, deren Finale in dieser Sitzung entkoppelt wurde. */
const decoupled = new Set<string>();

interface Part {
  id: string;
  /** Platz in game.fragments (für Meldungen) */
  index: number;
  position: number;
  value: string;
  giver: string;
}

function parts(game: Game): Part[] {
  const all = game.fragments ?? [];
  return sortedFragments(game).map((f) => ({
    id: f.id,
    index: all.indexOf(f),
    position: f.position,
    value: f.value ?? "",
    giver: (game.stations ?? []).find((s) => (s?.rewards?.fragments ?? []).includes(f.id))?.id ?? "",
  }));
}

function finalInfo(game: Game, lang: string) {
  const index = (game.stations ?? []).findIndex((s) => s?.final === true);
  const s = game.stations?.[index];
  if (!s) return null;
  return { id: s.id, index, name: readText(s.name as never, lang) || "Finale", task: s.task?.type ?? null, answers: s.task && "answers" in s.task ? (s.task.answers ?? []).join(", ") : "" };
}

export function FinalCodeBuilder({ gameId }: { gameId: string }) {
  const id = useId();
  const code = useEditorSelect((s) => finalCode(s.game));
  const list = useEditorSelect((s) => parts(s.game), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const derived = useEditorSelect((s) => splitMode(s.game));
  const coupledInGame = useEditorSelect((s) => isCoupled(s.game));
  const final = useEditorSelect((s) => finalInfo(s.game, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const stations = useEditorSelect(
    (s) => (s.game.stations ?? []).filter((st) => st && typeof st.id === "string").map((st, i) => ({ id: st.id, label: `${st.final ? "★" : i + 1} ${readText(st.name as never, s.lang) || `Station ${i + 1}`}` })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const [mode, setMode] = useState<"chars" | "custom" | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loose, setLoose] = useState(decoupled.has(gameId));
  const split = mode ?? derived;
  // Beim Leeren und Neutippen des Codes bleibt das Finale gekoppelt, auch wenn es kurz keinen Code gibt.
  const sticky = useRef(coupledInGame);
  if (code) sticky.current = coupledInGame;
  const coupled = sticky.current && !loose;
  const finalIssues = useLiveIssues(final ? [`/stations/${final.index}/task/answers`] : [], { codes: ["final_code_mismatch"] });
  const noFinal = useLiveIssues(["/stations"], { codes: ["fragments_without_final"] });
  const joined = list.map((p) => p.value).join(" | ");

  const write = (raw: string) => {
    setDraft(raw);
    const s: Split = split === "chars" ? "chars" : raw.split("|").map((p) => p.trim());
    const next = s === "chars" ? raw.replace(/\s+/g, "") : s.join("");
    store().update("Finalcode geändert", (g) => setFinalCode(g, next, s, { follow: coupled }), { coalesce: "finalcode" });
  };

  const setCoupled = (on: boolean) => {
    setLoose(!on);
    if (on) {
      decoupled.delete(gameId);
      store().update("Finale an den Finalcode gekoppelt", (g) => void coupleFinal(g, true));
    } else decoupled.add(gameId);
  };

  const canCouple = final && (final.task === null || final.task === "code" || final.task === "text");

  return (
    <section class="card stack" aria-labelledby="belohnungen-finalcode">
      <h3 id="belohnungen-finalcode" tabIndex={-1}>
        Finalcode
      </h3>
      <p class="small muted">Den Code geben Teams am Finale ein. Jede Station verrät ein Stück davon.</p>
      <div class="d-code-row">
        <div class="field ed-field" data-feld="fragments">
          <label for={id}>{split === "chars" ? "Finalcode" : "Teile, getrennt mit |"}</label>
          <input
            id={id}
            class="mono d-code-input"
            value={draft ?? (split === "chars" ? code : joined)}
            placeholder={split === "chars" ? "z. B. 191" : "z. B. 19 | 1"}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => write(e.currentTarget.value)}
            onBlur={() => {
              setDraft(null);
              store().touch("/fragments");
            }}
          />
          {split === "custom" && code && <small>ergibt den Code <span class="num">{code}</span></small>}
        </div>
        <fieldset class="field ed-field d-split">
          <legend class="label">Aufteilen</legend>
          <label class="check">
            <input type="radio" name={`${id}-teilen`} checked={split === "chars"} onChange={() => setMode("chars")} />
            <span>jedes Zeichen ein Teil</span>
          </label>
          <label class="check">
            <input type="radio" name={`${id}-teilen`} checked={split === "custom"} onChange={() => setMode("custom")} />
            <span>eigene Teile</span>
          </label>
        </fieldset>
      </div>
      {mode === "chars" && derived === "custom" && <p class="notice small">Beim nächsten Tippen wird jedes Zeichen ein eigener Teil.</p>}

      {list.length > 0 && (
        <ol class="d-parts" aria-label="Codeteile">
          {list.map((p) => (
            <FragmentCard key={p.id} part={p} stations={stations} />
          ))}
        </ol>
      )}

      {final ? (
        <div class="d-couple stack tight">
          <p>
            Finale{" "}
            <Link to={href("editorStation", { gameId, stationId: final.id }, { feld: "task" })}>„{final.name}“</Link>
            {final.task === null ? " hat noch kein Rätsel." : final.answers ? <> prüft <span class="num">{final.answers}</span></> : " prüft noch keine Antwort."}
            {coupled && !!code && <span class="d-ok"> ✓ gekoppelt</span>}
          </p>
          {canCouple ? (
            <label class="check">
              <input type="checkbox" checked={coupled} disabled={!code} onChange={(e) => setCoupled(e.currentTarget.checked)} />
              <span>Mit Finalcode koppeln – das Finale prüft immer den Code aus den Teilen</span>
            </label>
          ) : (
            <p class="small muted">Das Finale ist ein Rätsel der Art „{TASK_TYPE_LABELS[final.task!]}“. Koppeln geht nur mit einer Antwort zum Eintippen oder einem Zahlenschloss.</p>
          )}
          <IssueList issues={finalIssues} />
        </div>
      ) : (
        list.length > 0 && <IssueList issues={noFinal} />
      )}
    </section>
  );
}

function FragmentCard({ part, stations }: { part: Part; stations: { id: string; label: string }[] }) {
  const id = useId();
  const issues = useLiveIssues([`/fragments/${part.index}`]);
  return (
    <li class={`d-part${issues.some((i) => i.severity === "error") ? " invalid" : ""}`} data-objekt={part.id}>
      <span class="label">Teil {part.position}</span>
      <span class="d-part-value num">{part.value}</span>
      <div class="field ed-field">
        <label for={id}>bekommt man bei</label>
        <select
          id={id}
          value={part.giver}
          onChange={(e) => {
            const station = e.currentTarget.value || null;
            store().update(station ? `Teil ${part.position} vergeben` : `Teil ${part.position} an niemanden vergeben`, (g) => assignFragment(g, part.id, station));
          }}
        >
          <option value="">– niemand –</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <IssueList issues={issues} />
    </li>
  );
}
