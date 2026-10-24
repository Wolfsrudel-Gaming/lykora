/**
 * Paket C: Bereich „Rätsel & Aufgaben“ – eine Tabelle über alle Stationen zum Durchsehen und
 * Korrekturlesen, mit Filtern und Sprung in den Stationseditor zum Rätsel. Darunter die
 * Grundregeln für Rätsel; „Lösungsblatt drucken“ öffnet das Blatt für die Spielleitung.
 */

import { useState } from "preact/hooks";
import { shallowArray, useEditorSelect } from "../../../../lib/editor/store.ts";
import { GPS_RADIUS, TASK_DEFAULTS, TASK_TYPE_LABELS } from "../../../../lib/editor/stations.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, Game, Station } from "../../../../lib/editor/types.ts";
import { issuesAt } from "../../../../lib/editor/validation.ts";
import { penaltyLabel } from "../../../../lib/game.ts";
import { href, navigate } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import type { SectionProps } from "../sections.ts";
import { excerpt } from "./common.tsx";
import "./station.css";

type Filter = "alle" | "ohne-tipps" | "nur-gps" | "fehler" | "vorlage";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "ohne-tipps", label: "Ohne Tipps" },
  { id: "nur-gps", label: "Nur GPS" },
  { id: "fehler", label: "Mit Fehlern" },
  { id: "vorlage", label: "Vorlage nicht angepasst" },
];

export interface TaskRow {
  id: string;
  number: string;
  name: string;
  kind: string;
  question: string;
  solution: string;
  hints: number;
  check: string;
  gpsOnly: boolean;
  /** wichtigste Meldung zu Rätsel und Tipps, sonst null */
  issue: EditorIssue | null;
  errors: number;
  template: boolean;
}

/** Zeilen der Tabelle in Spielreihenfolge; Meldungen ohne ausgeblendete. */
export function taskRows(game: Game, issues: EditorIssue[], lang: string, dismissed: string[] = []): TaskRow[] {
  const hidden = new Set(dismissed);
  const t = (v: unknown) => readText(v as never, lang);
  return (game.stations ?? []).flatMap((s: Station, i) => {
    if (!s || typeof s !== "object" || typeof s.id !== "string") return [];
    const task = s.task;
    const own = [...issuesAt(issues, `/stations/${i}/task`), ...issuesAt(issues, `/stations/${i}/hints`)].filter((x) => !hidden.has(x.id));
    const all = issuesAt(issues, `/stations/${i}`).filter((x) => !hidden.has(x.id));
    const rank = { error: 0, warning: 1, hint: 2 } as const;
    const triggers = (s.triggers ?? []).filter((x) => x && typeof x === "object");
    let solution = "";
    let check = "–";
    if (task?.type === "text") {
      solution = (task.answers ?? []).join(" · ");
      const typos = task.match?.maxTypos ?? TASK_DEFAULTS.text.match.maxTypos;
      check = task.manualReview ? "von Hand" : typos === 0 ? "ohne Tippfehler" : typos === 1 ? "1 Tippfehler" : `${typos} Tippfehler`;
    } else if (task?.type === "code") {
      solution = (task.answers ?? []).join(" · ");
      check = task.input === "lock" ? "Zahlenschloss" : task.input === "keyboard" ? "exakt, Tastatur" : "exakt";
    } else if (task?.type === "choice") {
      const right = (task.options ?? []).filter((o) => o?.correct).map((o) => t(o.text));
      solution = right.join(" · ");
      check = right.length > 1 ? "mehrere richtig" : "eine richtig";
    } else if (task?.type === "photo") {
      check = { live: "live", auto_accept: "automatisch", after_game: "nach dem Spiel", vote: "Abstimmung" }[task.review ?? "live"];
    } else if (task?.type === "find_location") {
      solution = task.location ? `${task.location.lat.toFixed(5)}, ${task.location.lon.toFixed(5)}` : "";
      check = `± ${task.radius ?? TASK_DEFAULTS.find_location.radius} m`;
    }
    const ask = task ? ("question" in task ? task.question : task.prompt) : undefined;
    return [
      {
        id: s.id,
        number: s.final ? "★" : String(i + 1),
        name: t(s.name) || `Station ${i + 1}`,
        kind: task ? (TASK_TYPE_LABELS[task.type] ?? "?") : "Ohne Rätsel",
        question: excerpt(t(ask), 70),
        solution,
        hints: (s.hints ?? []).length,
        check,
        gpsOnly: triggers.length > 0 && triggers.every((x) => x.type === "gps"),
        issue: [...own].sort((a, b) => rank[a.severity] - rank[b.severity])[0] ?? null,
        errors: all.filter((x) => x.severity === "error").length,
        template: all.some((x) => x.code === "template_task_generic"),
      },
    ];
  });
}

export function matches(row: TaskRow, filter: Filter): boolean {
  switch (filter) {
    case "alle":
      return true;
    case "ohne-tipps":
      return row.hints === 0 && row.kind !== "Ohne Rätsel";
    case "nur-gps":
      return row.gpsOnly;
    case "fehler":
      return row.errors > 0;
    case "vorlage":
      return row.template;
  }
}

const MARK = { error: "✗", warning: "!", hint: "○" } as const;

/** Kurzform für die Spalte „Zustand“; der ganze Satz steht im Tooltip und für Vorleser. */
const SHORT: Record<string, string> = {
  no_hints: "keine Tipps",
  short_answer: "kurze Antwort",
  empty_required_text: "Text fehlt",
  empty_answer: "leere Antwort",
  choice_no_correct: "keine richtige Antwort",
  lock_not_numeric: "Schloss braucht Ziffern",
  final_code_mismatch: "Finalcode weicht ab",
  final_without_task: "Finale ohne Rätsel",
  template_task_generic: "aus der Vorlage",
  station_no_task: "ohne Rätsel",
  photo_review_unsupported: "Prüfung wie live",
  hint_free: "Tipp kostenlos",
  minItems: "Antwort fehlt",
};

export function TasksSection({ gameId }: SectionProps) {
  const game = useEditorSelect((s) => s.game);
  const lang = useEditorSelect((s) => s.lang);
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const dismissed = useEditorSelect((s) => s.meta.dismissed ?? [], shallowArray);
  const [filter, setFilter] = useState<Filter>("alle");
  const rows = taskRows(game, issues, lang, dismissed);
  const shown = rows.filter((r) => matches(r, filter));
  const wrong = game.settings?.wrongAnswer;
  const costs = game.settings?.hints?.defaultCost ?? [];
  const hintsOn = game.settings?.hints?.enabled !== false;
  const open = (id: string) => navigate(href("editorStation", { gameId, stationId: id }, { feld: "task" }));

  return (
    <section class="st-tasks stack" aria-labelledby="bereich-raetsel">
      <div class="row between">
        <h2 id="bereich-raetsel" tabIndex={-1}>
          Rätsel & Aufgaben
        </h2>
        <Link class="btn small" to={href("editorSection", { gameId, section: "veroeffentlichen" }, { drucken: "blatt" })}>
          <Icon name="print" /> Lösungsblatt drucken
        </Link>
      </div>
      <div class="chips st-filters" role="group" aria-label="Filter">
        {FILTERS.map((f) => {
          const n = rows.filter((r) => matches(r, f.id)).length;
          return (
            <button key={f.id} type="button" class={`btn small${filter === f.id ? " primary" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span class="num">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p class="muted">{rows.length ? "Keine Station passt zu diesem Filter." : "Noch keine Stationen."}</p>
      ) : (
        <table class="table cards st-task-table">
          <thead>
            <tr>
              <th class="num">Nr</th>
              <th>Station</th>
              <th>Art</th>
              <th>Frage</th>
              <th>Lösung</th>
              <th class="num">Tipps</th>
              <th>Prüfung</th>
              <th>Zustand</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} class="st-task-row" onClick={(e) => !(e.target as Element).closest("a") && open(r.id)}>
                <td class="num" data-label="Nr">
                  {r.number}
                </td>
                <td data-label="Station">
                  <Link to={href("editorStation", { gameId, stationId: r.id }, { feld: "task" })}>{r.name}</Link>
                </td>
                <td data-label="Art">{r.kind}</td>
                <td data-label="Frage">{r.question || <span class="muted">–</span>}</td>
                <td data-label="Lösung" class="solution">
                  {r.solution || <span class="muted">–</span>}
                </td>
                <td class="num" data-label="Tipps">
                  {r.hints}
                </td>
                <td data-label="Prüfung">{r.check}</td>
                <td data-label="Zustand">
                  {r.issue ? (
                    <span class={`issue-inline ${r.issue.severity}`} title={r.issue.message}>
                      <span aria-hidden="true">{MARK[r.issue.severity]}</span> <span aria-hidden="true">{SHORT[r.issue.code] ?? r.issue.message}</span>
                      <span class="sr-only">{r.issue.message}</span>
                    </span>
                  ) : (
                    <span class="mark ok" aria-label="in Ordnung">
                      ✓
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="small muted">
        Grundregeln für Rätsel: Falsche Antwort {penaltyLabel(wrong)} · Tipps {hintsOn ? (costs.length ? costs.map((c) => penaltyLabel(c)).join(" / ") : "kostenlos") : "aus"} · GPS-Radius Standard {GPS_RADIUS} m.{" "}
        <Link to={href("editorSection", { gameId, section: "einstellungen" })}>In den Einstellungen ändern</Link>
      </p>
    </section>
  );
}
