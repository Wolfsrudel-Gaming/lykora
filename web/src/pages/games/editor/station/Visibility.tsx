/**
 * Paket C: Sichtbarkeit als genau eine Antwort auf „Wann sehen Teams diese Station?“ (UX §7.4).
 * „Wenn eine andere Station gelöst ist“ schreibt die Belohnung der anderen Station; Regeln stehen
 * als Sätze da und werden im Bereich „Regeln“ bearbeitet.
 */

import { useId, useState } from "preact/hooks";
import { REVEAL_RADIUS, revealers, revealRules, setVisibility, visibilityMode, type VisibilityMode } from "../../../../lib/editor/stations.ts";
import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { Collapsible } from "../ui/Collapsible.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { stationPath, store, useSectionState } from "./common.tsx";

const MODES: { mode: VisibilityMode; label: string }[] = [
  { mode: "visible", label: "Von Anfang an auf der Karte" },
  { mode: "near", label: "Erst wenn das Team nah dran ist" },
  { mode: "station", label: "Wenn eine andere Station gelöst ist" },
  { mode: "rule", label: "Durch eine Regel" },
  { mode: "leitung", label: "Nur durch die Spielleitung (im Leitstand freigeben)" },
];

export function Visibility({ gameId, station, index }: { gameId: string; station: Station; index: number }) {
  const p = stationPath(index);
  const id = useId();
  const derived = useEditorSelect((s) => {
    const st = s.game.stations?.[index];
    return st ? visibilityMode(s.game, st) : "visible";
  });
  // „Station“ und „Regel“ sind erst nach einer Auswahl im Spiel sichtbar; bis dahin gilt die Wahl hier.
  const [chosen, setChosen] = useState<VisibilityMode | null>(null);
  const mode = chosen ?? derived;
  const from = useEditorSelect(
    (s) => revealers(s.game, station.id).map((r) => ({ id: r.id, name: readText(r.name as never, s.lang) || r.id })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const rules = useEditorSelect((s) => revealRules(s.game, station.id).map((i) => ({ index: i, id: s.game.rules?.[i]?.id ?? "" })), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const others = useEditorSelect(
    (s) => (s.game.stations ?? []).filter((x) => x && x.id !== station.id).map((x) => ({ id: x.id, name: readText(x.name as never, s.lang) || x.id })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const state = useSectionState([`${p}/visibility`, `${p}/revealRadius`], true);
  const issues = useIssuesAt(`${p}/visibility`);
  const name = useEditorSelect((s) => readText(s.game.stations?.[index]?.name as never, s.lang) || "Station");

  const pick = (next: VisibilityMode) => {
    setChosen(next === "station" || next === "rule" ? next : null);
    store().update(`Sichtbarkeit von „${name}“ geändert`, (g) => setVisibility(g, station.id, next));
    store().touch(`${p}/visibility`);
  };
  const reveal = (by: string) => store().update(`„${name}“ erscheint nach einer anderen Station`, (g) => setVisibility(g, station.id, "station", by || undefined));

  const sentences = [
    ...from.map((r) => `Erscheint, sobald „${r.name}“ gelöst ist.`),
    ...rules.map((r) => `Erscheint durch Regel ${r.index + 1}.`),
    ...(station.visibility === "hidden" && typeof station.revealRadius === "number" ? [`Erscheint, wenn ein Team näher als ${station.revealRadius} m ist.`] : []),
  ];
  const summary = mode === "visible" ? "von Anfang an auf der Karte" : sentences[0] ?? "versteckt – nur die Spielleitung schaltet frei";

  return (
    <Collapsible title="Sichtbarkeit" summary={summary} state={state} feld="visibility">
      <fieldset class="stack tight st-radios" aria-describedby={issues.length ? `${id}-meldungen` : undefined}>
        <legend class="label">Wann sehen Teams diese Station?</legend>
        {MODES.map((m) => (
          <label key={m.mode} class="check">
            <input type="radio" name={`${id}-sicht`} checked={mode === m.mode} onChange={() => pick(m.mode)} />
            <span>{m.label}</span>
          </label>
        ))}
      </fieldset>
      {mode === "near" && <NumberInput path={`${p}/revealRadius`} label="Abstand" unit="m" min={1} integer placeholder={String(REVEAL_RADIUS)} hint="Wirkt nur mit Ort und GPS-Auslöser." />}
      {mode === "station" && (
        <div class="field">
          <label for={`${id}-von`}>Erscheint, sobald diese Station gelöst ist</label>
          <select id={`${id}-von`} value={from.length === 1 ? from[0]!.id : ""} onChange={(e) => reveal(e.currentTarget.value)}>
            <option value="">– bitte wählen –</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <small>Das trägt diese Station in die Belohnung der gewählten ein.</small>
        </div>
      )}
      {mode === "rule" && (
        <div class="stack tight">
          {rules.length ? (
            <ul class="small">
              {rules.map((r) => (
                <li key={r.index}>
                  <Link to={href("editorSection", { gameId, section: "regeln" }, { objekt: r.id || undefined })}>Regel {r.index + 1}</Link> lässt sie erscheinen.
                </li>
              ))}
            </ul>
          ) : (
            <p class="small muted">Noch keine Regel lässt diese Station erscheinen.</p>
          )}
          <Link to={href("editorSection", { gameId, section: "regeln" })} class="btn small st-self-start">
            Regel anlegen
          </Link>
        </div>
      )}
      {mode === "leitung" && <p class="small muted">Teams sehen die Station erst, wenn jemand im Leitstand sie freigibt.</p>}
      {mode !== "visible" && sentences.length > 1 && (
        <ul class="small muted">
          {sentences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <IssueList id={`${id}-meldungen`} issues={issues} />
    </Collapsible>
  );
}
