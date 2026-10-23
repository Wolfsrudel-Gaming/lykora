/**
 * Paket E: Spiele-Liste (UX §4.1, W1/W1b). „+ Neues Spiel“ ist der Hauptknopf, „Importieren“ der
 * Expertenweg. Jede Zeile zeigt Zustand und nächsten Schritt (Entwurf oder Version, Änderungen,
 * Fehlerzahl des Entwurfs) und ein Menü ⋯. Ohne Spiele stehen die Vorlagen sofort da.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { EditorMeta, Game } from "../../lib/editor/types.ts";
import { TEMPLATES } from "../../lib/editor/templates/index.ts";
import { AGE_LABELS, copyTitle, duplicateGame, GENRE_LABELS } from "../../lib/editor/templates/wizard.ts";
import { formatAgo } from "../../lib/format.ts";
import { can } from "../../lib/roles.ts";
import { href, navigate } from "../../lib/router.ts";
import { api, errorText, notify, session } from "../../lib/session.ts";
import { useStore } from "../../lib/store.ts";
import type { GameSummary } from "../../lib/types.ts";
import { confirm, Empty, ErrorNotice, Link, Loading, useLoad, useTitle } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import { ExportDialog } from "./editor/publish/ExportDialog.tsx";
import { Menu, type MenuItem } from "./editor/map/Menu.tsx";
import { GameUpload } from "./GameUpload.tsx";
import "./editor/publish/publish.css";

interface Details {
  facts: string;
  errors?: number;
  warnings?: number;
}

/** „Rettungseinsatz · Nacht · 10–13 Jahre, Erwachsene · 5 Stationen · ca. 30 Min“ */
export function factsLine(game: Game): string {
  const m = game?.meta ?? ({} as Game["meta"]);
  const stations = Array.isArray(game?.stations) ? game.stations.length : 0;
  return [
    m.genre ? GENRE_LABELS[m.genre] : null,
    m.night ? "Nacht" : "Tag",
    m.ageGroups?.length ? m.ageGroups.map((a) => AGE_LABELS[a]).join(", ") : null,
    `${stations} ${stations === 1 ? "Station" : "Stationen"}`,
    m.expectedDuration ? `ca. ${Math.round(m.expectedDuration / 60)} Min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Bereits geladene Einzelheiten je Spiel und Stand (Revision bzw. Version); gilt für die ganze Sitzung. */
const detailsCache = new Map<string, Details>();
/** Die Abrufe laufen nacheinander, damit eine lange Liste das Netz nicht flutet. */
let detailsQueue: Promise<unknown> = Promise.resolve();

/**
 * Inhalt (und mit Schreibrecht die Fehlerzahl des Entwurfs) eines Spiels. Ohne Schreibrecht zeigt die
 * Zeile die veröffentlichte Fassung; geprüft wird nur, wer den Entwurf bearbeiten darf.
 */
export function loadDetails(g: GameSummary, write: boolean): Promise<Details | null> {
  const key = `${g.id}:${write ? "w" : "r"}:${g.draft?.revision ?? ""}:${g.latest_version ?? ""}`;
  const cached = detailsCache.get(key);
  if (cached) return Promise.resolve(cached);
  const job = detailsQueue.then(async (): Promise<Details | null> => {
    try {
      let entry: Details | null = null;
      if (write && g.draft) {
        const d = await api.draft(g.id);
        const content = d.content as Game;
        const { validateDraft } = await import("../../lib/editor/validation.ts");
        const hidden = new Set((d.meta as EditorMeta).dismissed ?? []);
        const issues = validateDraft(content, d.meta as EditorMeta).filter((i) => !hidden.has(i.id));
        entry = { facts: factsLine(content), errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length };
      } else if (g.latest_version !== null) {
        const detail = await api.game(g.id);
        if (detail.content) entry = { facts: factsLine(detail.content) };
      }
      if (entry) detailsCache.set(key, entry);
      return entry;
    } catch {
      // Ohne Details bleibt die Zeile kürzer; die Liste selbst ist da.
      return null;
    }
  });
  detailsQueue = job;
  return job;
}

/** Einzelheiten erst laden, wenn die Zeile in den sichtbaren Bereich kommt. */
function useRowDetails(g: GameSummary, write: boolean, row: { current: HTMLElement | null }): Details | undefined {
  const [details, setDetails] = useState<Details | undefined>();
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = row.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const key = `${g.id}:${write}:${g.draft?.revision ?? ""}:${g.latest_version ?? ""}`;
  useEffect(() => {
    if (!seen) return;
    let alive = true;
    void loadDetails(g, write).then((d) => alive && setDetails(d ?? undefined));
    return () => {
      alive = false;
    };
  }, [seen, key]);
  return details;
}

export function GamesPage() {
  useTitle("Spiele");
  const s = useStore(session);
  const role = s.orgs.find((o) => o.id === s.orgId)?.role;
  const write = can(role, "game.write");
  const { data, error, loading, reload } = useLoad(() => (s.orgId ? api.games(s.orgId) : Promise.resolve([])), [s.orgId]);
  const [importing, setImporting] = useState(false);
  const [archived, setArchived] = useState(false);
  const [exporting, setExporting] = useState<GameSummary | null>(null);
  const games = (data ?? []).filter((g) => archived || !g.archived);
  const archivedCount = (data ?? []).filter((g) => g.archived).length;

  const imported = (g: GameSummary, how: string) => {
    notify(`„${g.title}“ ${how}`, "ok");
    navigate(write ? href("editor", { gameId: g.id }) : href("game", { gameId: g.id }));
  };

  return (
    <div class="page stack loose games">
      <div class="page-head">
        <h1>Spiele</h1>
        {write && (
          <>
            <button type="button" class="btn" aria-expanded={importing} onClick={() => setImporting(!importing)}>
              <Icon name="upload" /> Importieren
            </button>
            {!!data?.length && (
              <Link to={href("gameNew")} class="btn primary">
                <Icon name="plus" /> Neues Spiel
              </Link>
            )}
          </>
        )}
      </div>
      {importing && (
        <section class="card stack" aria-labelledby="import-title">
          <div class="row between">
            <h2 id="import-title">Spiel importieren</h2>
            <button type="button" class="btn small" onClick={() => setImporting(false)}>
              Schließen
            </button>
          </div>
          <p class="small muted">Hast du ein Spiel als Datei (.json)? Hier hochladen. Danach bearbeitest du es im Baukasten. Der Server prüft das Spiel vor dem Speichern.</p>
          <GameUpload
            submitLabel="Spiel speichern"
            onSave={async (content, comment) => imported(await api.createGame(s.orgId!, content, comment || undefined), "gespeichert")}
            onDraft={async (content) => imported(await api.createDraftGame(s.orgId!, { content }), "als Entwurf geöffnet. Die Fehler stehen in der Checkliste.")}
          />
        </section>
      )}
      <ErrorNotice error={error} retry={reload} />
      {loading && !data ? (
        <Loading />
      ) : !data?.length && write ? (
        <Welcome />
      ) : games.length === 0 ? (
        <Empty>Noch keine Spiele.</Empty>
      ) : (
        <ul class="list card games-list">
          {games.map((g) => (
            <GameRow key={g.id} game={g} role={role} onExport={() => setExporting(g)} onChanged={reload} />
          ))}
        </ul>
      )}
      {archivedCount > 0 && (
        <label class="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />
          Archivierte Spiele zeigen ({archivedCount})
        </label>
      )}
      {exporting && <ExportDialog gameId={exporting.id} latestVersion={exporting.latest_version} hasDraft={!!exporting.draft} open onClose={() => setExporting(null)} />}
    </div>
  );
}

/** Leere Liste (W1b): Vorlagen sofort sichtbar. */
function Welcome() {
  return (
    <section class="stack" aria-labelledby="welcome-title">
      <h2 id="welcome-title" class="sr-only">
        Vorlagen
      </h2>
      <p>Noch keine Spiele. Such dir eine Vorlage aus – in fünf Minuten steht ein spielbares Grundgerüst, das du danach Station für Station ausbaust.</p>
      <div class="games-templates">
        {TEMPLATES.map((t) => (
          <article key={t.id} class="card stack tight">
            <h3>
              {t.title}
              {t.id !== "leer" && <span class="muted"> {t.subtitle}</span>}
            </h3>
            <p class="small muted">
              {t.ageGroups} · {t.duration}
            </p>
            <p class="small">{t.blurb}</p>
            <Link to={href("gameNew", {}, { vorlage: t.id })} class={`btn${t.id === "leer" ? "" : " primary"}`}>
              {t.id === "leer" ? "Anfangen" : "Damit anfangen"}
            </Link>
          </article>
        ))}
      </div>
      <p class="small">
        Oder: <Link to={href("gameNew")}>Beispielspiel „Sturmnacht“ ansehen</Link> · Spiel aus einer Datei importieren (oben „Importieren“)
      </p>
    </section>
  );
}

function GameRow({ game: g, role, onExport, onChanged }: { game: GameSummary; role: Parameters<typeof can>[0]; onExport: () => void; onChanged: () => void }) {
  const write = can(role, "game.write");
  const rowRef = useRef<HTMLLIElement>(null);
  const details = useRowDetails(g, write, rowRef);
  const editorHref = href("editor", { gameId: g.id });
  const overview = href("game", { gameId: g.id });
  const released = g.latest_version !== null;

  const duplicate = async () => {
    try {
      const source = g.draft ? ((await api.draft(g.id)).content as Game) : (await api.game(g.id)).content;
      if (!source) return;
      const answer = await confirm({
        title: "Spiel duplizieren",
        body: <p>Die Kopie bekommt neue QR- und Notfall-Codes, damit sich gedruckte Schilder nicht verwechseln lassen. Orte und Inhalte bleiben gleich.</p>,
        input: { label: "Name der Kopie (leer lassen für den Vorschlag)", placeholder: copyTitle(source) },
        confirm: "Duplizieren",
      });
      if (!answer.ok) return;
      const copy = duplicateGame(source, answer.value || copyTitle(source));
      const created = await api.createDraftGame(session.get().orgId!, { content: copy });
      notify(`„${created.title}“ angelegt`, "ok");
      onChanged();
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  const archive = async () => {
    const answer = await confirm({
      title: "Spiel archivieren?",
      body: <p>Das Spiel verschwindet aus der Liste. Events, die es nutzen, laufen weiter.</p>,
      confirm: "Archivieren",
    });
    if (!answer.ok) return;
    try {
      await api.archiveGame(g.id);
      notify(`„${g.title}“ archiviert`, "ok");
      onChanged();
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  const items: MenuItem[] = [
    { label: "Übersicht mit Lösungen", onSelect: () => navigate(overview) },
    ...(can(role, "event.manage") ? [{ label: "Event anlegen", hint: released ? undefined : "Erst veröffentlichen", disabled: !released, onSelect: () => navigate(href("eventNew", {}, { spiel: g.id })) }] : []),
    ...(write ? [{ label: "Probelauf", onSelect: () => navigate(href("editorSection", { gameId: g.id, section: "veroeffentlichen" }, { probelauf: "1" })) }] : []),
    { label: "Materialliste", hint: released ? undefined : "Erst veröffentlichen", disabled: !released, onSelect: () => navigate(href("gameMaterials", { gameId: g.id })) },
    ...(write ? [{ label: "Stationsschilder drucken", onSelect: () => navigate(href("editorSection", { gameId: g.id, section: "veroeffentlichen" }, { drucken: "schilder" })) }] : []),
    { label: "Als Datei exportieren", onSelect: onExport },
    ...(write ? [{ label: "Duplizieren", onSelect: () => void duplicate() }] : []),
    ...(write && !g.archived ? [{ label: "Archivieren", onSelect: () => void archive() }] : []),
  ];

  const who = g.draft ? [g.draft.updated_by, formatAgo(g.draft.updated_at)].filter(Boolean).join(", ") : "";
  return (
    <li class="list-item games-row" ref={rowRef}>
      <div class="grow min0 stack tight">
        <Link to={write ? editorHref : overview} class="strong">
          {g.title}
        </Link>
        {details?.facts && <span class="small muted">{details.facts}</span>}
        <span class="small games-state">
          {released ? <span class="badge strong">Version {g.latest_version}</span> : <span class="badge quiet">Entwurf</span>}
          {!released && <span>noch nie veröffentlicht</span>}
          {released && g.draft?.changed && write && <span>● Änderungen seit Version {g.latest_version}, noch nicht veröffentlicht</span>}
          {details?.errors ? <span>✗ {details.errors === 1 ? "1 Fehler" : `${details.errors} Fehler`}</span> : null}
          {details?.warnings ? <span class="muted">! {details.warnings === 1 ? "1 Hinweis" : `${details.warnings} Hinweise`}</span> : null}
          {write && who && (released ? g.draft?.changed : true) && <span class="muted">{who}</span>}
          {g.archived && <span class="badge quiet">Archiviert</span>}
        </span>
      </div>
      <div class="row nowrap">
        <Link to={write ? editorHref : overview} class="btn small">
          {write ? "Bearbeiten" : "Übersicht"}
        </Link>
        <Menu label={`Weitere Aktionen für „${g.title}“`} items={items} align="right">
          <span aria-hidden="true">⋯</span>
        </Menu>
      </div>
    </li>
  );
}

