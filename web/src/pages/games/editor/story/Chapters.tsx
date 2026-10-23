/**
 * Paket D: Kapitel (UX §9.3) als sortierbare Liste – die Reihenfolge ist die Kapitelnummer. „Beginnt“
 * nennt die Herkunft in Worten und schreibt an die richtige Stelle: Kapitel I mit dem Spielstart,
 * sonst die Belohnung `rewards.chapter` der gewählten Station; Regeln mit „Kapitel beginnt“ stehen als Link.
 */

import { useId } from "preact/hooks";
import { readText } from "../../../../lib/editor/text.ts";
import { ruleSentence } from "../../../../lib/editor/rules.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { createChapter, MediaSlot, Menu } from "../station/common.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { moveItem, SortableList } from "../ui/SortableList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { store, toRoman, useLiveIssues, VolumeField } from "./shared.tsx";

interface Row {
  id: string;
  title: string;
  hasAmbience: boolean;
  /** Station, deren Lösen das Kapitel startet */
  starter: string;
  /** Regeln, die es starten: Kennung und Satz */
  rules: { id: string; sentence: string }[];
}

function rows(game: Game, lang: string): Row[] {
  return (game.story?.chapters ?? [])
    .filter((c) => c && typeof c.id === "string")
    .map((c) => ({
      id: c.id,
      title: readText(c.title as never, lang),
      hasAmbience: !!c.ambience,
      starter: (game.stations ?? []).find((s) => s?.rewards?.chapter === c.id)?.id ?? "",
      rules: (game.rules ?? [])
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => [...(r?.then ?? []), ...(r?.else ?? [])].some((a) => a && "start_chapter" in a && a.start_chapter === c.id))
        .map(({ r, i }) => ({ id: r.id, sentence: ruleSentence(r, game, lang, { index: i }) })),
    }));
}

/** Stationen zur Auswahl; „startet schon …“, wenn ihre Belohnung ein anderes Kapitel beginnt. */
function starters(game: Game, lang: string, chapterId: string): { id: string; label: string }[] {
  return (game.stations ?? [])
    .filter((s) => s && typeof s.id === "string")
    .map((s, i) => {
      const other = s.rewards?.chapter && s.rewards.chapter !== chapterId ? (game.story?.chapters ?? []).find((c) => c?.id === s.rewards!.chapter) : undefined;
      const name = readText(s.name as never, lang) || `Station ${i + 1}`;
      return { id: s.id, label: other ? `${name} (startet schon „${readText(other.title as never, lang) || other.id}“)` : name };
    });
}

export function Chapters({ gameId }: { gameId: string }) {
  const list = useEditorSelect((s) => rows(s.game, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const add = async () => {
    const id = await createChapter();
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-objekt="${id}"] input`)?.focus());
  };
  return (
    <section class="card stack" aria-labelledby="geschichte-kapitel">
      <header class="row between">
        <h3 id="geschichte-kapitel" tabIndex={-1}>
          Kapitel
        </h3>
        <button type="button" class="btn small" aria-label="Neues Kapitel" onClick={() => void add()}>
          <Icon name="plus" /> Kapitel
        </button>
      </header>
      <p class="small muted">Die Reihenfolge ist die Kapitelnummer. Die App zeigt beim Wechsel eine Kapitelkarte und spielt die Atmosphäre des Kapitels.</p>
      {list.length === 0 ? (
        <p class="muted">Noch keine Kapitel. Ohne Kapitel läuft das Spiel in einem Stück.</p>
      ) : (
        <SortableList
          items={list}
          keyOf={(c) => c.id}
          nameOf={(c) => c.title || "Kapitel"}
          label="Kapitel"
          class="d-chapters"
          onMove={(from, to) =>
            store().update(`Kapitel „${list[from]!.title}“ verschoben`, (g) => {
              if (g.story?.chapters) g.story.chapters = moveItem(g.story.chapters, from, to);
            })
          }
          render={(c, i) => <Chapter gameId={gameId} row={c} index={i} />}
        />
      )}
    </section>
  );
}

function Chapter({ gameId, row, index }: { gameId: string; row: Row; index: number }) {
  const p = `/story/chapters/${index}`;
  const id = useId();
  const options = useEditorSelect((s) => starters(s.game, s.lang, row.id), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const issues = useLiveIssues([p]);
  const name = row.title || `Kapitel ${toRoman(index + 1)}`;

  const setStarter = (stationId: string) =>
    store().update(stationId ? `Kapitel „${name}“ beginnt nach einer anderen Station` : `Start von Kapitel „${name}“ entfernt`, (g) => {
      for (const s of g.stations ?? []) {
        if (s?.rewards?.chapter !== row.id) continue;
        delete s.rewards.chapter;
        if (!Object.keys(s.rewards).length) delete s.rewards;
      }
      const s = (g.stations ?? []).find((x) => x?.id === stationId);
      if (s) s.rewards = { ...(s.rewards ?? {}), chapter: row.id };
    });

  return (
    <div class="d-chapter stack tight" data-objekt={row.id}>
      <div class="row between nowrap">
        <span class="d-roman" aria-hidden="true">
          {toRoman(index + 1)}
        </span>
        <Menu label={`Kapitel „${name}“: weitere Aktionen`}>
          {(close) => (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  void deleteWithReferences("kapitel", row.id, name);
                }}
              >
                <Icon name="trash" /> Kapitel löschen
              </button>
            </li>
          )}
        </Menu>
      </div>
      <TextField path={`${p}/title`} label={`Titel von Kapitel ${toRoman(index + 1)}`} required />
      {index === 0 ? (
        <p class="small">
          <span class="label">Beginnt</span> mit dem Spielstart. Die App startet Kapitel I selbst.
        </p>
      ) : (
        <div class="field ed-field" data-feld="beginnt">
          <label for={id}>Beginnt, wenn diese Station gelöst ist</label>
          <select id={id} value={row.starter} onChange={(e) => setStarter(e.currentTarget.value)}>
            <option value="">– keine Station –</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {row.rules.map((r) => (
            <small key={r.id}>
              oder durch Regel{" "}
              <Link to={href("editorSection", { gameId, section: "regeln" }, { objekt: r.id })} class="d-rule-link">
                „{r.sentence}“ ›
              </Link>
            </small>
          ))}
        </div>
      )}
      <TextField path={`${p}/piece/text`} label="Einleitung" multiline rows={2} hint="Für euch und die Spielleitung; die App zeigt sie derzeit nicht." />
      <div class="grid-2">
        <MediaSlot path={`${p}/ambience/audio`} label="Atmosphäre" accept="audio" onClear={() => store().setField(`${p}/ambience`, undefined, `Atmosphäre von „${name}“ entfernt`)} />
        {row.hasAmbience && <VolumeField path={`${p}/ambience/volume`} />}
      </div>
      <IssueList issues={issues} />
    </div>
  );
}
