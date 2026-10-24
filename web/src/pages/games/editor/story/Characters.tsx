/**
 * Paket D: Figuren (UX §9.4). Die Zentrale steht als besondere Karte oben; ihr Name wird gemeinsam
 * in `story.hq.name` und in der Figur mit Rolle Zentrale gepflegt (gibt es keine, legt „Als Figur
 * anlegen“ eine an). Darunter die übrigen Figuren als Karten mit Porträt oder Initialen, Rolle und
 * „spricht n× an m Stationen“; „Bearbeiten“ klappt das Formular auf.
 */

import { useId, useState } from "preact/hooks";
import { base, mediaUrl } from "../../../../lib/base.ts";
import { newId, takenIds } from "../../../../lib/editor/ids.ts";
import { getAt } from "../../../../lib/editor/paths.ts";
import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText, writeText } from "../../../../lib/editor/text.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { href } from "../../../../lib/router.ts";
import { Link, teamColor } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { deleteWithReferences } from "../DeleteWithReferencesDialog.tsx";
import { createCharacter, MediaSlot } from "../station/common.tsx";
import { describedBy, FieldFrame, hasError } from "../ui/FieldFrame.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { SelectField, store, useLiveIssues } from "./shared.tsx";

type Kind = "hq" | "narrator" | "npc";
const KIND_LABELS: Record<Kind, string> = { hq: "Zentrale", narrator: "Erzähler", npc: "Figur" };

interface CharacterRow {
  id: string;
  index: number;
  name: string;
  kind: Kind;
  portrait: string | null;
  /** Takte mit dieser Figur als Sprecher */
  count: number;
  stations: { id: string; name: string }[];
}

function characterRows(game: Game, lang: string): CharacterRow[] {
  const out: CharacterRow[] = [];
  (game.characters ?? []).forEach((c, index) => {
    if (!c || typeof c.id !== "string") return;
    let count = 0;
    const stations: CharacterRow["stations"] = [];
    for (const s of game.stations ?? []) {
      const n = (["arrival", "beats", "afterSolve"] as const).reduce((sum, part) => sum + (s?.scene?.[part] ?? []).filter((b) => b?.speaker === c.id).length, 0);
      if (!n) continue;
      count += n;
      stations.push({ id: s.id, name: readText(s.name as never, lang) || s.id });
    }
    const m = c.portrait ? (game.media ?? []).find((x) => x?.id === c.portrait && x.type === "image") : undefined;
    out.push({ id: c.id, index, name: readText(c.name as never, lang), kind: c.kind ?? "npc", portrait: m ? mediaUrl(base(), m.src) : null, count, stations });
  });
  return out;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

function Avatar({ row }: { row: CharacterRow }) {
  if (row.portrait) return <img class="d-avatar" src={row.portrait} alt="" loading="lazy" />;
  return (
    <span class="d-avatar" style={{ background: teamColor(null, row.id) }} aria-hidden="true">
      {initials(row.name)}
    </span>
  );
}

/** „spricht 6× an 4 Stationen“ mit Links zu den Stationen. */
function Speaks({ gameId, row }: { gameId: string; row: CharacterRow }) {
  if (!row.count) return <p class="small muted">spricht noch nirgends</p>;
  return (
    <p class="small">
      spricht {row.count}× an {row.stations.length === 1 ? "1 Station" : `${row.stations.length} Stationen`}:{" "}
      {row.stations.map((s, i) => (
        <span key={s.id}>
          {i > 0 && (i === row.stations.length - 1 ? " und " : ", ")}
          <Link to={href("editorStation", { gameId, stationId: s.id }, { feld: "scene" })}>{s.name}</Link>
        </span>
      ))}
    </p>
  );
}

export function Characters({ gameId }: { gameId: string }) {
  const rows = useEditorSelect((s) => characterRows(s.game, s.lang), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const hq = rows.find((r) => r.kind === "hq");
  const others = rows.filter((r) => r !== hq);
  const toggle = (id: string, on: boolean) => setOpen((o) => (on ? new Set([...o, id]) : new Set([...o].filter((x) => x !== id))));
  const add = async () => {
    const id = await createCharacter("npc");
    if (!id) return;
    toggle(id, true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-objekt="${id}"] input`)?.focus());
  };
  return (
    <section class="card stack" aria-labelledby="geschichte-figuren">
      <header class="row between">
        <h3 id="geschichte-figuren" tabIndex={-1}>
          Figuren
        </h3>
        <button type="button" class="btn small" aria-label="Neue Figur" onClick={() => void add()}>
          <Icon name="plus" /> Figur
        </button>
      </header>
      <Headquarters gameId={gameId} row={hq} />
      {others.length > 0 && (
        <ul class="d-cards" aria-label="Weitere Figuren">
          {others.map((r) => (
            <CharacterCard key={r.id} gameId={gameId} row={r} open={open.has(r.id)} onOpen={(on) => toggle(r.id, on)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Die Zentrale: Name schreibt Figur und story.hq gemeinsam. */
function Headquarters({ gameId, row }: { gameId: string; row: CharacterRow | undefined }) {
  const fallback = useEditorSelect((s) => readText(s.game.story?.hq?.name as never, s.lang));
  const create = () =>
    store().update("Zentrale als Figur angelegt", (g) => {
      const lang = g.meta?.languages?.[0] ?? "de";
      const name = readText(g.story?.hq?.name as never, lang) || "Zentrale";
      const id = newId("figur", "zentrale", takenIds(g, "figur"));
      g.characters = [{ id, kind: "hq", name: { [lang]: name } }, ...(g.characters ?? [])];
      g.story = { ...(g.story ?? {}), hq: { ...(g.story?.hq ?? {}), name: { [lang]: name } } };
    });
  if (!row) {
    return (
      <div class="d-hq stack tight">
        <p class="label">Zentrale</p>
        <TextField path="/story/hq/name" label="Name der Zentrale" placeholder="Zentrale" hint="Sie funkt die Teams an, gibt Tipps und spricht den Einsatzbefehl." />
        <p>
          <button type="button" class="btn small" onClick={create}>
            Als Figur anlegen
          </button>{" "}
          <span class="small muted">für Rufname, Bild und Beschreibung</span>
        </p>
      </div>
    );
  }
  const p = `/characters/${row.index}`;
  return (
    <div class="d-hq stack tight" data-objekt={row.id}>
      <div class="row nowrap">
        <Avatar row={row} />
        <div class="min0">
          <p class="label">Zentrale</p>
          <strong>{row.name || fallback || "Zentrale"}</strong>
        </div>
      </div>
      <Speaks gameId={gameId} row={row} />
      <div class="grid-2">
        <HqName path={`${p}/name`} />
        <TextField path={`${p}/callSign`} label="Rufname" placeholder="z. B. Nachtfalke an Team" hint="Steht im Briefing unter dem Namen." />
      </div>
      <TextField path={`${p}/description`} label="Beschreibung" multiline rows={2} hint="Für euch und die Darsteller." />
      <MediaSlot path={`${p}/portrait`} label="Bild der Zentrale" accept="image" />
    </div>
  );
}

/** Name der Zentrale: ein Feld, zwei Stellen im Spiel (Figur und story.hq). */
function HqName({ path }: { path: string }) {
  const id = useId();
  const value = useEditorSelect((s) => readText(getAt(s.game, path) as never, s.lang));
  const issues = useIssuesAt(path);
  const set = (next: string) =>
    store().update(
      "Name der Zentrale geändert",
      (g) => {
        const lang = g.meta?.languages?.[0] ?? "de";
        const c = getAt<{ name: unknown }>(g, path.replace(/\/name$/, ""));
        if (c) c.name = writeText(c.name as never, lang, next) ?? { [lang]: "" };
        const hq = writeText(g.story?.hq?.name as never, lang, next);
        g.story = { ...(g.story ?? {}), hq: { ...(g.story?.hq ?? {}), name: hq } };
        if (!hq) delete g.story.hq!.name;
        if (!Object.keys(g.story.hq!).length) delete g.story.hq;
      },
      { coalesce: "zentrale-name" },
    );
  return (
    <FieldFrame id={id} label="Name" required issues={issues} feld="name">
      <input
        id={id}
        value={value}
        aria-invalid={hasError(issues) || undefined}
        aria-describedby={describedBy(id, false, issues.length > 0)}
        onInput={(e) => set(e.currentTarget.value)}
        onBlur={() => store().touch(path)}
      />
    </FieldFrame>
  );
}

function CharacterCard({ gameId, row, open, onOpen }: { gameId: string; row: CharacterRow; open: boolean; onOpen: (on: boolean) => void }) {
  const p = `/characters/${row.index}`;
  const formId = useId();
  const issues = useLiveIssues([p]);
  const name = row.name || "Figur ohne Namen";
  return (
    <li class="d-card stack tight" data-objekt={row.id}>
      <div class="row nowrap">
        <Avatar row={row} />
        <div class="min0">
          <strong class="wrap-anywhere">{name}</strong>
          <p class="label">{KIND_LABELS[row.kind]}</p>
        </div>
      </div>
      <Speaks gameId={gameId} row={row} />
      <IssueList issues={issues} />
      <div class="row">
        <button type="button" class="btn small" aria-expanded={open} aria-controls={formId} onClick={() => onOpen(!open)}>
          <Icon name="edit" /> {open ? "Fertig" : "Bearbeiten"}
        </button>
        <button type="button" class="btn small ghost" aria-label={`${name} löschen`} onClick={() => void deleteWithReferences("figur", row.id, row.name)}>
          <Icon name="trash" />
        </button>
      </div>
      {open && (
        <div id={formId} class="stack tight d-card-form">
          <TextField path={`${p}/name`} label="Name" required />
          <SelectField path={`${p}/kind`} label="Rolle" defaultValue="npc" options={(Object.keys(KIND_LABELS) as Kind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))} hint={roleHint(row.kind)} />
          {row.kind === "hq" && <TextField path={`${p}/callSign`} label="Rufname" />}
          <TextField path={`${p}/description`} label="Beschreibung" multiline rows={3} hint="Für euch und die Darsteller; die App zeigt sie in der Akte, sobald die Figur gesprochen hat." />
          <MediaSlot path={`${p}/portrait`} label="Porträt" accept="image" />
        </div>
      )}
    </li>
  );
}

function roleHint(kind: Kind): string {
  if (kind === "hq") return "Nur die erste Zentrale zählt – diese hier ist eine zweite.";
  if (kind === "narrator") return "Der Name steht über den Erzähler-Blöcken.";
  return "Personen stehen in der Akte und bleiben „Unbekannt“, bis sie gesprochen haben.";
}
