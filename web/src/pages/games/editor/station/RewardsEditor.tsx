/**
 * Paket C: Belohnung beim Lösen – Punkte (leer = Standard), Codeteile (mit Vergabe und „+ neues
 * Codeteil“, das ein gekoppeltes Finale mitzieht), Gegenstände, Stationen, die erscheinen, und das
 * Kapitel danach; darunter die Belohnung als Satz. Ohne Rätsel ausgegraut (die Station wird nie gelöst).
 */

import { plural } from "../../../../lib/format.ts";
import { useId } from "preact/hooks";
import { addFragment, fragmentOwner, SOLVE_POINTS } from "../../../../lib/editor/stations.ts";
import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Game, Station } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { Collapsible } from "../ui/Collapsible.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { RefSelect } from "../ui/RefSelect.tsx";
import { createChapter, createItem, stationPath, store, useSectionState } from "./common.tsx";

type Rewards = NonNullable<Station["rewards"]>;
type ListKey = "fragments" | "items" | "reveal";

const join = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`);

/** Belohnung als Satz: „Wer „Kiste“ löst, bekommt 100 Punkte und Codeteil 2. Danach beginnt Kapitel III.“ */
export function rewardSentence(game: Game, station: Station, lang: string): string {
  const r = station.rewards ?? {};
  const name = readText(station.name as never, lang) || "diese Station";
  const points = r.points ?? game.settings?.scoring?.solvePoints ?? SOLVE_POINTS;
  const parts = [plural(points, "Punkt", "Punkte")];
  for (const id of r.fragments ?? []) {
    const f = (game.fragments ?? []).find((x) => x?.id === id);
    parts.push(`Codeteil ${f?.position ?? "?"}`);
  }
  for (const id of r.items ?? []) {
    const it = (game.items ?? []).find((x) => x?.id === id);
    parts.push(`„${readText(it?.name as never, lang) || id}“`);
  }
  let out = `Wer „${name}“ löst, bekommt ${join(parts)}.`;
  const shown = (r.reveal ?? []).map((id) => {
    const s = (game.stations ?? []).find((x) => x?.id === id);
    return `„${readText(s?.name as never, lang) || id}“`;
  });
  if (shown.length) out += ` Danach ${shown.length === 1 ? "erscheint" : "erscheinen"} ${join(shown)}.`;
  if (r.chapter) out += ` ${chapterSentence(game, r.chapter, lang)}`;
  return out;
}

/** „Danach beginnt Kapitel III „Das Signal“ (mit Atmosphäre „Sturm“).“ */
function chapterSentence(game: Game, id: string, lang: string): string {
  const chapters = game.story?.chapters ?? [];
  const i = chapters.findIndex((c) => c?.id === id);
  const c = chapters[i];
  if (!c) return "";
  const title = readText(c.title as never, lang);
  const audio = c.ambience?.audio;
  const m = audio ? (game.media ?? []).find((x) => x?.id === audio) : undefined;
  const ambience = audio ? ` (mit Atmosphäre „${readText(m?.alt as never, lang) || audio}“)` : "";
  return `Danach beginnt Kapitel ${toRoman(i + 1)}${title ? ` „${title}“` : ""}${ambience}.`;
}

function toRoman(n: number): string {
  const table: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

export function RewardsEditor({ station, index }: { station: Station; index: number }) {
  const p = stationPath(index);
  const id = useId();
  const r: Rewards = station.rewards ?? {};
  const noTask = !station.task;
  const lang = useEditorSelect((s) => s.lang);
  const sentence = useEditorSelect((s) => (s.game.stations?.[index] ? rewardSentence(s.game, s.game.stations[index]!, s.lang) : ""));
  const solvePoints = useEditorSelect((s) => s.game.settings?.scoring?.solvePoints ?? SOLVE_POINTS);
  const fragments = useEditorSelect(
    (s) => (s.game.fragments ?? []).filter((f) => f?.id).map((f) => ({ id: f.id, position: f.position, value: f.value, owner: fragmentOwner(s.game, f.id, s.lang) })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const others = useEditorSelect(
    (s) =>
      (s.game.stations ?? [])
        .filter((x) => x && x.id !== station.id)
        .map((x) => ({ id: x.id, name: readText(x.name as never, s.lang) || x.id, hidden: x.visibility === "hidden" }))
        .sort((a, b) => Number(b.hidden) - Number(a.hidden)),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const filled = Object.keys(r).length > 0;
  const state = useSectionState([`${p}/rewards`], filled);
  const fragmentIssues = useIssuesAt(`${p}/rewards/fragments`);
  const revealIssues = useIssuesAt(`${p}/rewards/reveal`);
  const name = readText(station.name as never, lang) || "Station";

  const setList = (key: ListKey, ids: string[], undo: string) =>
    store().update(undo, (g) => {
      const s = g.stations[index]!;
      const rw = (s.rewards ??= {});
      if (ids.length) rw[key] = ids;
      else delete rw[key];
      if (!Object.keys(rw).length) delete s.rewards;
    });

  // Ein Codeteil gibt es nur einmal: hier vergeben heißt, es anderswo zu entfernen.
  const toggleFragment = (fid: string, position: number, on: boolean) =>
    store().update(on ? `Codeteil ${position} an „${name}“ vergeben` : `Codeteil ${position} entfernt`, (g) => {
      for (const s of g.stations ?? []) {
        if (!s?.rewards?.fragments) continue;
        if (s.id === station.id || on) {
          s.rewards.fragments = s.rewards.fragments.filter((x) => x !== fid);
          if (!s.rewards.fragments.length) delete s.rewards.fragments;
          if (!Object.keys(s.rewards).length) delete s.rewards;
        }
      }
      if (on) {
        const s = g.stations[index]!;
        s.rewards ??= {};
        s.rewards.fragments = [...(s.rewards.fragments ?? []), fid];
      }
    });

  const newFragment = () => store().update(`Neues Codeteil an „${name}“ vergeben`, (g) => void addFragment(g, station.id));

  const toggle = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((x) => x !== value));

  return (
    <Collapsible title="Belohnung" summary={noTask ? "ohne Rätsel keine Belohnung" : sentence} state={noTask ? "empty" : state} feld="rewards">
      <div data-block="rewards" class="stack">
        {noTask && <p class="notice small">Ohne Rätsel gibt es keine Belohnung. Soll es eine geben, reicht eine einfache Auswahlfrage, z. B. „Seid ihr bereit?“ mit einer richtigen Antwort (im Bereich „Rätsel“ als Abschluss anlegen).</p>}
        <fieldset class="stack st-plain" disabled={noTask}>
          <legend class="sr-only">Belohnung</legend>
          <NumberInput path={`${p}/rewards/points`} label="Punkte" integer min={0} placeholder={`${solvePoints} (Standard)`} hint="Leer gilt der Standard aus den Einstellungen." />
          <fieldset class="ed-refs field" data-feld="rewards.fragments" aria-describedby={fragmentIssues.length ? `${id}-teile` : undefined}>
            <legend>Codeteile</legend>
            {fragments.length === 0 && <p class="small muted">Noch kein Finalcode angelegt.</p>}
            {fragments.map((f) => {
              const mine = (r.fragments ?? []).includes(f.id);
              return (
                <label key={f.id} class="check">
                  <input type="checkbox" checked={mine} onChange={(e) => toggleFragment(f.id, f.position, e.currentTarget.checked)} />
                  <span>
                    Teil {f.position} · <span class="num">{f.value}</span>
                    {!mine && f.owner && <span class="small muted"> – bekommt man bei „{f.owner}“</span>}
                  </span>
                </label>
              );
            })}
            <button type="button" class="btn small st-self-start" onClick={newFragment}>
              <Icon name="plus" /> neues Codeteil
            </button>
            <IssueList id={`${id}-teile`} issues={fragmentIssues} />
          </fieldset>
          <RefSelect
            kind="gegenstand"
            label="Gegenstände"
            multiple
            path={`${p}/rewards/items`}
            value={r.items ?? []}
            onChange={(ids) => setList("items", ids, "Gegenstände der Belohnung geändert")}
            onCreate={() => createItem("object")}
          />
          <fieldset class="ed-refs field" data-feld="rewards.reveal">
            <legend>Danach erscheint</legend>
            {others.length === 0 && <p class="small muted">Keine anderen Stationen.</p>}
            {others.map((o) => (
              <label key={o.id} class="check">
                <input type="checkbox" checked={(r.reveal ?? []).includes(o.id)} onChange={(e) => setList("reveal", toggle(r.reveal ?? [], o.id, e.currentTarget.checked), `„${o.name}“ ${e.currentTarget.checked ? "erscheint danach" : "erscheint nicht mehr danach"}`)} />
                <span>
                  {o.name}
                  {!o.hidden && <span class="small muted"> (ist schon sichtbar)</span>}
                </span>
              </label>
            ))}
            <IssueList issues={revealIssues} />
          </fieldset>
          <RefSelect
            kind="kapitel"
            label="Kapitel beginnt"
            path={`${p}/rewards/chapter`}
            value={r.chapter}
            onChange={(cid) => {
              store().update(cid ? "Kapitel der Belohnung gewählt" : "Kapitel der Belohnung entfernt", (g) => {
                const s = g.stations[index]!;
                const rw = (s.rewards ??= {});
                if (cid) rw.chapter = cid;
                else delete rw.chapter;
                if (!Object.keys(rw).length) delete s.rewards;
              });
            }}
            onCreate={createChapter}
          />
        </fieldset>
        {!noTask && <p class="st-sentence">{sentence}</p>}
      </div>
    </Collapsible>
  );
}
