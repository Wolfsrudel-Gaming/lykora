/**
 * Paket D: Gegenstände und Fundstücke (UX §10.3) – je Eintrag ein zuklappbarer Abschnitt mit Name,
 * Art, Beschreibung, Text des Schriftstücks, Bild und „Teams dürfen tauschen“; dazu in Sätzen, wo
 * das Ding vorkommt („bekommt man bei …“, „gebraucht in Regel …“, „Fundstück-Block an …“).
 */

import { useState } from "preact/hooks";
import { ruleSentence } from "../../../../lib/editor/rules.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { createItem, excerpt, MediaSlot } from "../station/common.tsx";
import { worldOf } from "../station/world.ts";
import { Collapsible } from "../ui/Collapsible.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { NO_EFFECT, store, Tiles, useLiveIssues } from "../story/shared.tsx";

type Kind = "object" | "document" | "evidence";
const KINDS: { value: Kind; title: string }[] = [
  { value: "object", title: "Gegenstand" },
  { value: "document", title: "Schriftstück" },
  { value: "evidence", title: "Beweisstück" },
];

/** Wo ein Gegenstand vorkommt, als kurze Sätze. */
export function itemUses(game: Game, id: string, lang: string): string[] {
  const out: string[] = [];
  const name = (v: unknown, fallback: string) => readText(v as never, lang) || fallback;
  for (const s of game.stations ?? []) {
    if (!s) continue;
    if ((s.rewards?.items ?? []).includes(id)) out.push(`bekommt man bei „${name(s.name, s.id)}“`);
    const inScene = (["arrival", "beats", "afterSolve"] as const).some((p) => (s.scene?.[p] ?? []).some((b) => b?.item === id));
    if (inScene) out.push(`Fundstück-Block an „${name(s.name, s.id)}“`);
  }
  (game.rules ?? []).forEach((r, i) => {
    if (!r) return;
    const sentence = `„${excerpt(ruleSentence(r, game, lang, { index: i }), 50)}“`;
    if ([...(r.then ?? []), ...(r.else ?? [])].some((a) => a && "give_item" in a && a.give_item === id)) out.push(`bekommt man durch die Regel ${sentence}`);
    if ((r.when ?? []).some((c) => c && "has_item" in c && c.has_item === id)) out.push(`gebraucht in der Regel ${sentence}`);
  });
  return out;
}

interface ItemRow {
  id: string;
  index: number;
  name: string;
  kind: Kind;
  uses: string[];
}

export function Items() {
  const rows = useEditorSelect(
    (s) =>
      (s.game.items ?? []).flatMap((it, index): ItemRow[] =>
        it && typeof it.id === "string" ? [{ id: it.id, index, name: readText(it.name as never, s.lang), kind: it.kind ?? "object", uses: itemUses(s.game, it.id, s.lang) }] : [],
      ),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const [fresh, setFresh] = useState<string | null>(null);
  const add = async () => {
    const id = await createItem("object");
    if (!id) return;
    setFresh(id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-objekt="${id}"] input`)?.focus());
  };
  return (
    <section class="card stack" aria-labelledby="belohnungen-gegenstaende">
      <header class="row between">
        <h3 id="belohnungen-gegenstaende" tabIndex={-1}>
          Gegenstände und Fundstücke
        </h3>
        <button type="button" class="btn small" aria-label="Neuer Gegenstand" onClick={() => void add()}>
          <Icon name="plus" /> Gegenstand
        </button>
      </header>
      <p class="small muted">Teams finden sie an Stationen oder bekommen sie durch Regeln; sie stehen in der Akte.</p>
      {rows.length === 0 ? <p class="muted">Noch keine Gegenstände.</p> : rows.map((r) => <ItemEditor key={r.id} row={r} open={r.id === fresh} />)}
    </section>
  );
}

function ItemEditor({ row, open }: { row: ItemRow; open: boolean }) {
  const p = `/items/${row.index}`;
  const expert = useEditorSelect((s) => s.expert);
  const caseFile = useEditorSelect((s) => worldOf(s.game).caseFile);
  const issues = useLiveIssues([p]);
  const errors = useEditorSelect((s) => s.issues.some((i) => i.severity === "error" && (i.at.path === p || i.at.path.startsWith(`${p}/`))));
  const kindTitle = KINDS.find((k) => k.value === row.kind)?.title ?? "Gegenstand";
  const name = row.name || "Ohne Namen";
  return (
    <div data-objekt={row.id}>
      <Collapsible title={name} summary={`${kindTitle}${row.uses.length ? ` · ${row.uses[0]}` : ""}`} state={errors ? "error" : issues.length ? "warning" : "ok"} open={open}>
        <IssueList issues={issues} />
        <TextField path={`${p}/name`} label="Name" required />
        <Tiles
          legend="Art"
          feld="kind"
          compact
          value={row.kind}
          options={KINDS}
          onChange={(k) => store().setField(`${p}/kind`, k === "object" ? undefined : k, `„${name}“ ist jetzt ${KINDS.find((x) => x.value === k)!.title}`)}
        />
        <TextField path={`${p}/description`} label="Beschreibung" multiline rows={2} />
        {row.kind === "document" && <TextField path={`${p}/body`} label="Text des Schriftstücks" multiline rows={5} hint={`So steht es in der ${caseFile}.`} />}
        <MediaSlot path={`${p}/image`} label="Bild" accept="image" hint="Erscheint in der Akte." />
        <Toggle path={`${p}/tradeable`} label="Teams dürfen tauschen" defaultValue={false} hint={NO_EFFECT} />
        {expert && <MediaSlot path={`${p}/icon`} label="Symbol" accept="image" hint={NO_EFFECT} />}
        {row.uses.length > 0 && (
          <ul class="small d-uses">
            {row.uses.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}
        <p>
          <button type="button" class="btn small ghost" onClick={() => void deleteWithReferences("gegenstand", row.id, row.name)}>
            <Icon name="trash" /> {kindTitle} löschen
          </button>
        </p>
      </Collapsible>
    </div>
  );
}
