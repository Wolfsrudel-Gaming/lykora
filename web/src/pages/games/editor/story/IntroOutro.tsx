/**
 * Paket D: Anfang und Ende (UX §9.2) – Einsatzbefehl mit Aufnahme dazu und Auflösung. Sprecher und
 * Medien der Auflösung haben in der App keine Wirkung und stehen nur in der Expertenansicht.
 */

import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { MediaSlot } from "../station/common.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { NO_EFFECT, SelectField, useLiveIssues } from "./shared.tsx";

const SPEAKERS = [
  { value: "hq", label: "Zentrale" },
  { value: "narrator", label: "Erzähler" },
  { value: "npc", label: "Figur" },
];

export function IntroOutro() {
  const expert = useEditorSelect((s) => s.expert);
  const hasFinal = useEditorSelect((s) => (s.game.stations ?? []).some((st) => st?.final === true));
  const introHints = useLiveIssues(["/story/intro/text"], { codes: ["no_intro"], field: true });
  return (
    <section class="card stack" aria-labelledby="geschichte-anfang">
      <h3 id="geschichte-anfang" tabIndex={-1}>
        Anfang und Ende
      </h3>
      <div class="stack tight">
        <TextField
          path="/story/intro/text"
          label="Einsatzbefehl"
          multiline
          rows={4}
          hint="Das hören alle Teams beim Start, noch vor Kapitel I – als Funkspruch der Zentrale. Ohne Text sagt die App nur „Viel Glück da draußen!“."
        />
        <IssueList issues={introHints} />
        <MediaSlot path="/story/intro/media/0" label="Aufnahme zum Einsatzbefehl" accept="audio" hint="Spielt statt der Vorlesestimme." />
      </div>
      <TextField
        path="/story/outro/text"
        label="Auflösung"
        multiline
        rows={4}
        hint={hasFinal ? "Steht nach dem Lösen des Finales auf dem Belohnungsbildschirm und danach in der Akte." : "Erscheint erst, wenn eine Station das Finale ist."}
      />
      {expert && (
        <div class="grid-2 d-expert">
          <SelectField path="/story/intro/speaker" label="Sprecher Einsatzbefehl" options={SPEAKERS} standard="nicht angegeben" hint={NO_EFFECT} />
          <SelectField path="/story/outro/speaker" label="Sprecher Auflösung" options={SPEAKERS} standard="nicht angegeben" hint={NO_EFFECT} />
          <MediaSlot path="/story/outro/media/0" label="Bild zur Auflösung" accept="image" hint={NO_EFFECT} />
        </div>
      )}
    </section>
  );
}
