/**
 * Paket D: Spielwelt (UX §9.1) – Titel und Kurzbeschreibung, Genre als fünf Kacheln, Altersgruppen,
 * die Namen der Spielwelt in der App (Platzhalter = Standard des Genres), Nachtspiel und Grusel-Stufe.
 */

import { useEditorSelect } from "../../../../lib/editor/store.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { worldOf } from "../station/world.ts";
import { IssueList } from "../ui/IssueList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { store, Tiles, useLiveIssues, type TileOption } from "./shared.tsx";

type Genre = NonNullable<Game["meta"]["genre"]>;
type AgeGroup = NonNullable<Game["meta"]["ageGroups"]>[number];

const GENRE_TITLES: Record<Genre, string> = { other: "Abenteuer", crime: "Krimi", mystery: "Mystery", agents: "Agenten", rescue: "Rettung" };
const GENRES: Genre[] = ["other", "crime", "mystery", "agents", "rescue"];

/** Standardnamen der App je Genre (ohne eigene Angaben in presentation). */
export function genreWorld(genre: Genre | undefined): { device: string; caseFile: string; stamp: string } {
  return worldOf({ meta: { genre: genre ?? "other" } } as Game);
}

export const AGE_GROUPS: { value: AgeGroup; label: string }[] = [
  { value: "6-9", label: "6–9 Jahre" },
  { value: "10-13", label: "10–13 Jahre" },
  { value: "14-17", label: "14–17 Jahre" },
  { value: "adult", label: "Erwachsene" },
];

export const SCARE_LEVELS: TileOption<number>[] = [
  { value: 0, title: "Kein Grusel" },
  { value: 1, title: "Leicht" },
  { value: 2, title: "Mittel" },
  { value: 3, title: "Stark" },
];

export function World() {
  const genre = useEditorSelect((s) => s.game.meta?.genre);
  const ages = useEditorSelect((s) => (s.game.meta?.ageGroups ?? []).join(","));
  const scare = useEditorSelect((s) => s.game.meta?.scareLevel);
  const ageIssues = useLiveIssues(["/meta/ageGroups"]);
  const scareIssues = useLiveIssues(["/meta/scareLevel"]);
  const base = genreWorld(genre);
  const chosen = ages ? (ages.split(",") as AgeGroup[]) : [];

  const setAge = (group: AgeGroup, on: boolean) => {
    const next = AGE_GROUPS.map((a) => a.value).filter((a) => (a === group ? on : chosen.includes(a)));
    store().setField("/meta/ageGroups", next.length ? next : undefined, `Altersgruppe ${AGE_GROUPS.find((a) => a.value === group)!.label} ${on ? "gewählt" : "abgewählt"}`);
    store().touch("/meta/ageGroups");
  };

  return (
    <section class="card stack" aria-labelledby="geschichte-welt">
      <h3 id="geschichte-welt" tabIndex={-1}>
        Spielwelt
      </h3>
      <TextField path="/meta/title" label="Titel" required />
      <TextField path="/meta/summary" label="Kurzbeschreibung" multiline rows={3} hint="Steht in der App unter dem Titel, wenn Teams packen und starten." />
      <Tiles
        legend="Genre"
        feld="meta.genre"
        value={genre}
        options={GENRES.map((g) => {
          const w = genreWorld(g);
          return { value: g, title: GENRE_TITLES[g], text: `${w.device} · ${w.caseFile} · „${w.stamp}“` };
        })}
        onChange={(g) => store().setField("/meta/genre", g, `Genre: ${GENRE_TITLES[g]}`)}
        hint="Bestimmt Farben, Schrift und die Namen der Dinge in der App."
      />
      <fieldset class="field ed-field" data-feld="meta.ageGroups">
        <legend class="label">Altersgruppen</legend>
        <div class="row d-checks">
          {AGE_GROUPS.map((a) => (
            <label key={a.value} class="check">
              <input type="checkbox" checked={chosen.includes(a.value)} onChange={(e) => setAge(a.value, e.currentTarget.checked)} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
        <small>Nur 6–9: Kindermodus mit großer Schrift und Vorlesen. Ab 14: Rangliste schon während des Spiels. Bei Kindern und Jugendlichen startet ein Team erst mit der Betreuer-PIN.</small>
        <IssueList issues={ageIssues} />
      </fieldset>
      <div class="stack tight">
        <h4 class="label">So heißt es in der App</h4>
        <div class="grid-3">
          <TextField path="/presentation/device" label="Peilgerät" placeholder={base.device} />
          <TextField path="/presentation/caseFile" label="Akte" placeholder={base.caseFile} />
          <TextField path="/presentation/stamp" label="Stempel beim Lösen" placeholder={base.stamp} />
        </div>
        <small class="muted">Leer lassen = Standard der Spielwelt.</small>
      </div>
      <Toggle path="/meta/night" label="Nachtspiel" defaultValue={false} hint="Der Baukasten achtet dann auf Sperrzonen, Lampe, Warnweste und Schnelligkeitspunkte. In der App ändert es nichts." />
      <Tiles
        legend="Grusel-Stufe"
        feld="meta.scareLevel"
        compact
        value={scare}
        options={SCARE_LEVELS}
        issues={scareIssues}
        onChange={(n) => {
          store().setField("/meta/scareLevel", n, `Grusel-Stufe: ${SCARE_LEVELS[n]!.title}`);
          store().touch("/meta/scareLevel");
        }}
      />
    </section>
  );
}
