/**
 * Paket E: Bereich „Veröffentlichen“ (UX §16.7, W8). Checkliste aus der laufenden Prüfung (Muss,
 * Sollte, Ideen), „Vor dem Spieltag“, „Was ist neu“, Kommentar und der Knopf „Als Version n
 * veröffentlichen“ – bei Fehlern aria-disabled, ein Klick springt dann zum ersten. Danach der Dialog
 * für geplante Events. ?probelauf=1 öffnet den Probelauf, ?drucken=schilder|blatt die Druckansichten.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiError } from "../../../../lib/api.ts";
import { setMediaSizes } from "../../../../lib/editor/checks.ts";
import { diffSummary } from "../../../../lib/editor/diff.ts";
import { jumpTo } from "../../../../lib/editor/jump.ts";
import { editor, saveForAction, useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, Game, PublishResult } from "../../../../lib/editor/types.ts";
import { setQuery, useLocation } from "../../../../lib/router.ts";
import { api, errorText, notify } from "../../../../lib/session.ts";
import { useLoad } from "../../../../ui/components.tsx";
import type { SectionProps } from "../sections.ts";
import { AfterPublishDialog } from "./AfterPublishDialog.tsx";
import { Checklist, checklistGroups, serverIssues } from "./Checklist.tsx";
import { PreGameDay } from "./PreGameDay.tsx";
import { SignsPrint, SolutionPrint } from "./SignsPrint.tsx";
import { TestRunDialog } from "./TestRunDialog.tsx";
import { suggestComment, WhatsNew } from "./WhatsNew.tsx";
import "./publish.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PublishSection({ gameId }: SectionProps) {
  const loc = useLocation();
  const print = loc.query.get("drucken");
  if (print === "schilder") return <SignsPrint gameId={gameId} />;
  if (print === "blatt") return <SolutionPrint gameId={gameId} />;
  return <PublishView gameId={gameId} />;
}

function PublishView({ gameId }: { gameId: string }) {
  const loc = useLocation();
  const store = editor.get().current!;
  const game = useEditorSelect((s) => s.game);
  const lang = useEditorSelect((s) => s.lang);
  const issues = useEditorSelect((s) => s.issues);
  const dismissed = useEditorSelect((s) => s.meta.dismissed);
  const latestVersion = useEditorSelect((s) => s.latestVersion);
  const [server, setServer] = useState<EditorIssue[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [showShould, setShowShould] = useState(true);
  const latest = useLoad(() => (latestVersion === null ? Promise.resolve(null) : api.gameVersion(gameId, latestVersion).then((v) => v.content)), [gameId, latestVersion]);
  const entries = useMemo(() => (latest.data ? diffSummary(latest.data, game) : null), [latest.data, game]);
  const groups = checklistGroups(issues, dismissed);
  const must = [...server, ...groups.must];
  const title = readText(game.meta?.title as never, lang) || "Spiel";
  const next = (latestVersion ?? 0) + 1;
  const testRun = loc.query.get("probelauf") === "1";

  // Ab hier zeigen alle Felder ihre Meldungen (UX §15.2); Mediengrößen für media_too_large.
  useEffect(() => {
    store.showAllIssues(true);
    let alive = true;
    api
      .media(gameId)
      .then((files) => {
        if (!alive) return;
        setMediaSizes(files);
        store.validateNow();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gameId]);

  // Server-Meldungen gelten für den Stand, an dem sie gefunden wurden.
  useEffect(() => setServer([]), [game]);

  const publish = async () => {
    if (must.length) {
      const first = must.find((i) => i.at.section !== "veroeffentlichen");
      if (first) jumpTo(first.at);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveForAction(store);
      if (saved === "conflict") {
        notify("Jemand hat den Entwurf auch geändert. Bitte zuerst den Konflikt lösen.", "warn");
        return;
      }
      if (saved === "unsaved") {
        notify("Dein neuester Stand ist noch nicht gespeichert. Bitte kurz warten oder das Netz prüfen und noch einmal versuchen.", "warn");
        return;
      }
      const r = await api.publishDraft(gameId, { revision: store.get().revision, comment: comment.trim() || undefined });
      store.set({ latestVersion: r.version, baseVersion: r.version });
      setComment("");
      setResult(r);
      latest.reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_game" && Array.isArray(err.details.errors)) {
        setServer(serverIssues(err.details.errors as string[], store.get().game as Game));
        notify("Der Server hat noch Fehler gefunden. Sie stehen oben in der Liste.", "error");
      } else if (err instanceof ApiError && err.code === "draft_conflict") {
        notify("Jemand hat den Entwurf inzwischen geändert. Bitte neu laden oder den Konflikt lösen.", "warn");
        void store.saveNow();
      } else notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const suggestion = entries?.length ? suggestComment(entries) : latestVersion === null ? "Erste Fassung" : "";

  return (
    <section class="pub stack loose" aria-labelledby="bereich-veroeffentlichen">
      <header class="stack tight">
        <h2 id="bereich-veroeffentlichen" tabIndex={-1}>
          Veröffentlichen
        </h2>
        <p>
          {must.length
            ? `Noch ${must.length === 1 ? "1 Ding" : `${must.length} Dinge`}, dann ist „${title}“ startklar.`
            : `„${title}“ ist startklar. Veröffentliche es als Version ${next}, dann können Events es nutzen.`}
        </p>
        <p class="sr-only" aria-live="polite">
          {plural(must.length, "Fehler", "Fehler")}, {plural(groups.should.length, "Hinweis", "Hinweise")}
        </p>
      </header>

      <section class="card stack" aria-labelledby="pub-must">
        <h3 id="pub-must" class="label">
          Muss erledigt sein ({must.length})
        </h3>
        {must.length ? <Checklist issues={must} game={game} label="Muss erledigt sein" /> : <p class="muted">✓ Nichts mehr – alles Nötige ist da.</p>}
      </section>

      <section class="card stack" aria-labelledby="pub-should">
        <div class="row between">
          <h3 id="pub-should" class="label">
            Solltest du prüfen ({groups.should.length})
          </h3>
          {groups.should.length > 0 && (
            <button type="button" class="btn small ghost" aria-expanded={showShould} aria-controls="pub-should-list" onClick={() => setShowShould(!showShould)}>
              {showShould ? "Zuklappen" : "Aufklappen"}
            </button>
          )}
        </div>
        <div id="pub-should-list">{showShould && (groups.should.length ? <Checklist issues={groups.should} game={game} label="Solltest du prüfen" /> : <p class="muted">Keine Warnungen.</p>)}</div>
        {groups.hidden > 0 && (
          <p class="small muted">
            {plural(groups.hidden, "Hinweis", "Hinweise")} mit „Passt so“ ausgeblendet.{" "}
            <button type="button" class="btn small ghost" onClick={() => store.update("Ausgeblendete Hinweise wieder gezeigt", (_g, m) => void delete m.dismissed, { metaOnly: true })}>
              Wieder zeigen
            </button>
          </p>
        )}
      </section>

      {groups.ideas.length > 0 && (
        <details class="card stack pub-ideas">
          <summary class="label">Ideen ({groups.ideas.length})</summary>
          <Checklist issues={groups.ideas} game={game} label="Ideen" />
        </details>
      )}

      <PreGameDay gameId={gameId} />

      <WhatsNew entries={entries} latestVersion={latestVersion} />

      <section class="card stack" aria-labelledby="pub-go">
        <h3 id="pub-go" class="sr-only">
          Version veröffentlichen
        </h3>
        <div class="field">
          <label for="pub-comment">Kommentar zur Version</label>
          <input id="pub-comment" value={comment} maxLength={200} placeholder={suggestion ? `z. B. ${suggestion}` : "Was hat sich geändert?"} onInput={(e) => setComment(e.currentTarget.value)} />
          {suggestion && !comment && (
            <small>
              <button type="button" class="btn small ghost" onClick={() => setComment(suggestion)}>
                Vorschlag übernehmen
              </button>
            </small>
          )}
        </div>
        <div class="row wrap pub-go">
          <button type="button" class="btn primary" aria-disabled={must.length > 0 || busy} aria-describedby={must.length ? "pub-why" : undefined} onClick={() => !busy && void publish()}>
            {busy ? "Veröffentliche …" : `Als Version ${next} veröffentlichen`}
          </button>
          {must.length > 0 && (
            <span id="pub-why" class="small muted">
              Geht, sobald {must.length === 1 ? "der Punkt" : `die ${must.length} Punkte`} oben erledigt {must.length === 1 ? "ist" : "sind"}.
            </span>
          )}
          <button type="button" class="btn" onClick={() => setQuery({ probelauf: "1" })}>
            Probelauf
          </button>
        </div>
      </section>

      <AfterPublishDialog gameId={gameId} result={result} onClose={() => setResult(null)} />
      <TestRunDialog gameId={gameId} open={testRun} onClose={() => setQuery({ probelauf: null })} />
    </section>
  );
}
