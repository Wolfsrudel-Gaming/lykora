/**
 * Paket A: Startseite des Baukastens (UX §5.4). Beantwortet „Was fehlt noch, und was mache ich als
 * Nächstes?“: Nächste Schritte aus Prüfung und Editor-Merkern, jede Zeile mit einem Knopf zur Stelle,
 * darunter alle offenen Meldungen und „Das Spiel in Zahlen“. Am Handy steht „Vor Ort arbeiten“ oben.
 */

import type { ComponentType } from "preact";
import { useState } from "preact/hooks";
import { TASK_LABELS } from "../../../lib/game.ts";
import { jumpTo } from "../../../lib/editor/jump.ts";
import { shallowArray, useEditorSelect } from "../../../lib/editor/store.ts";
import { GENRE_LABELS } from "../../../lib/editor/templates/wizard.ts";
import type { EditorIssue, EditorState, FieldAddress, Game, Point, Section } from "../../../lib/editor/types.ts";
import { bySeverity } from "../../../lib/editor/validation.ts";
import { formatBytes, formatDateTime, plural } from "../../../lib/format.ts";
import { href } from "../../../lib/router.ts";
import { api } from "../../../lib/session.ts";
import { Link, useLoad, useMedia } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import * as sections from "./sections.ts";
import { IssueList } from "./ui/IssueList.tsx";

export type StepState = "done" | "todo" | "error" | "open";

export interface StepAction {
  label: string;
  /** Bereich mit Suchparametern … */
  section?: Section;
  query?: Record<string, string>;
  /** … oder ein Feld (Sprung) … */
  jump?: FieldAddress;
  /** … oder der Vor-Ort-Modus */
  onSite?: boolean;
}

export interface Step {
  id: string;
  state: StepState;
  text: string;
  detail?: string;
  actions: StepAction[];
}

const STEP_MARK: Record<StepState, { mark: string; text: string }> = {
  done: { mark: "✓", text: "erledigt" },
  todo: { mark: "!", text: "offen, empfohlen" },
  error: { mark: "✗", text: "offen, nötig zum Veröffentlichen" },
  open: { mark: "○", text: "noch nicht gemacht" },
};

const objects = <T,>(x: T[] | undefined | null): T[] => (Array.isArray(x) ? x.filter((e) => e && typeof e === "object") : []);

/** Nächste Schritte aus Meldungen und Merkern (Reihenfolge wie UX §5.4); ausgeblendete Meldungen zählen nicht. */
export function nextSteps(s: Pick<EditorState, "game" | "meta" | "issues" | "latestVersion">): Step[] {
  const { game, meta } = s;
  const hidden = new Set(meta.dismissed ?? []);
  const issues = s.issues.filter((i) => !hidden.has(i.id));
  const withCode = (code: string) => issues.filter((i) => i.code === code);
  const stations = objects(game.stations);
  const steps: Step[] = [];

  if (meta.template) steps.push({ id: "grundgeruest", state: "done", text: "Grundgerüst aus der Vorlage angelegt", actions: [] });
  else if (stations.length) steps.push({ id: "grundgeruest", state: "done", text: `Grundgerüst steht: ${plural(stations.length, "Station", "Stationen")}`, actions: [] });
  else steps.push({ id: "grundgeruest", state: "todo", text: "Erste Station anlegen", actions: [{ label: "Zur Karte", section: "karte" }] });

  const fieldErrors = issues.filter((i) => i.severity === "error" && /^\/field\/(boundary|assemblyPoint)(\/|$)/.test(i.at.path));
  const fieldSet = !!game.field?.boundary && !!game.field?.assemblyPoint?.location;
  steps.push(
    fieldSet && !fieldErrors.length
      ? { id: "spielfeld", state: "done", text: "Spielfeld und Sammelpunkt gesetzt", actions: [] }
      : { id: "spielfeld", state: fieldErrors.length ? "error" : "todo", text: "Spielfeld und Sammelpunkt auf der Karte setzen", actions: [{ label: "Zur Karte", section: "karte" }] },
  );

  if (stations.length) {
    const open = new Set([...stations.filter((st) => !st.location).map((st) => st.id), ...withCode("station_at_template").map((i) => i.at.objectId)]);
    const done = stations.length - open.size;
    const confirmed = Object.keys(meta.onSite ?? {}).length;
    steps.push({
      id: "vor-ort",
      state: open.size ? "todo" : "done",
      text: open.size
        ? `Stationen an echte Orte setzen – ${done} von ${stations.length} erledigt`
        : stations.length === 1
          ? "Die Station steht an einem echten Ort"
          : stations.length === 1 ? "Die Station steht an einem echten Ort" : `Alle ${stations.length} Stationen stehen an echten Orten`,
      detail: confirmed ? `${confirmed} vor Ort bestätigt` : undefined,
      actions: open.size
        ? [
            { label: "Zur Karte", section: "karte" },
            { label: "Vor Ort am Handy", onSite: true },
          ]
        : [],
    });
  }

  const zones = objects(game.field?.restrictedZones).length;
  if (zones) steps.push({ id: "sperrzonen", state: "done", text: `${plural(zones, "Sperrzone", "Sperrzonen")} eingezeichnet`, actions: [] });
  else if (meta.noZones) steps.push({ id: "sperrzonen", state: "done", text: "Keine Sperrzonen nötig", actions: [] });
  else steps.push({ id: "sperrzonen", state: "todo", text: "Sperrzonen einzeichnen – noch keine. Straßen? Bäche? Hänge?", actions: [{ label: "Zur Karte", section: "karte" }] });

  const empty = withCode("empty_required_text");
  steps.push(
    empty.length
      ? { id: "texte", state: "error", text: `Pflichttexte ausfüllen – ${empty.length} ${empty.length === 1 ? "fehlt" : "fehlen"}`, actions: [{ label: "Ausfüllen", jump: empty[0]!.at }] }
      : { id: "texte", state: "done", text: "Alle Pflichttexte ausgefüllt", actions: [] },
  );

  const phone = typeof game.safety?.emergency?.gameMasterPhone === "string" && game.safety.emergency.gameMasterPhone.trim();
  steps.push(
    phone
      ? { id: "telefon", state: "done", text: "Telefon der Spielleitung eingetragen", actions: [] }
      : {
          id: "telefon",
          state: "error",
          text: "Telefon der Spielleitung eintragen",
          actions: [{ label: "Eintragen", jump: { section: "sicherheit", field: "safety.emergency.gameMasterPhone", path: "/safety/emergency/gameMasterPhone" } }],
        },
  );

  if (meta.template) {
    const generic = withCode("template_task_generic");
    steps.push(
      generic.length
        ? {
            id: "raetsel",
            state: "todo",
            text: `Rätsel an eure Orte anpassen – ${plural(generic.length, "ist", "sind")} noch wie in der Vorlage`,
            actions: [{ label: "Anpassen", jump: generic[0]!.at }],
          }
        : { id: "raetsel", state: "done", text: "Rätsel an eure Orte angepasst", actions: [] },
    );
  } else {
    const tasks = stations.filter((st) => st.task).length;
    steps.push(
      tasks
        ? { id: "raetsel", state: "done", text: `${plural(tasks, "Rätsel", "Rätsel")} angelegt`, actions: [] }
        : { id: "raetsel", state: "todo", text: "Rätsel anlegen", actions: [{ label: "Zu den Rätseln", section: "raetsel" }] },
    );
  }

  steps.push(
    meta.lastTestRun
      ? {
          id: "probelauf",
          state: "done",
          text: `Probelauf gemacht (${formatDateTime(meta.lastTestRun.at)})`,
          actions: [{ label: "Noch einmal", section: "veroeffentlichen", query: { probelauf: "1" } }],
        }
      : { id: "probelauf", state: "open", text: "Probelauf machen", actions: [{ label: "Probelauf", section: "veroeffentlichen", query: { probelauf: "1" } }] },
  );

  const errors = issues.filter((i) => i.severity === "error").length;
  steps.push({
    id: "veroeffentlichen",
    state: "open",
    text: errors ? `Veröffentlichen – vorher ${plural(errors, "Fehler", "Fehler")} beheben` : s.latestVersion === null ? "Veröffentlichen" : `Veröffentlichen – zuletzt Version ${s.latestVersion}`,
    actions: [{ label: "Zur Checkliste", section: "veroeffentlichen" }],
  });
  return steps;
}

/** Luftlinie in Metern (Haversine). */
export function distanceM(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const WALK_M_PER_MIN = 4000 / 60;
export const MIN_PER_STATION = 8;

export interface GameFacts {
  stations: number;
  hidden: number;
  final: boolean;
  /** Laufweg als Luftlinie in Listenreihenfolge */
  walkM: number;
  /** Schätzung in Minuten: 4 km/h plus 8 Minuten je Station */
  estimateMin: number;
  plannedMin: number | null;
  /** Schätzung weicht mehr als 30 % von der geplanten Dauer ab */
  offPlan: boolean;
  tasks: [string, number][];
  fragments: number;
  finalCode: string;
  characters: number;
  chapters: number;
  items: number;
  rules: number;
  media: number;
}

export function gameFacts(game: Game): GameFacts {
  const stations = objects(game.stations);
  let walkM = 0;
  let prev: Point | null = null;
  for (const st of stations) {
    const p = st.location;
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    if (prev) walkM += distanceM(prev, p);
    prev = p;
  }
  const estimateMin = Math.round(walkM / WALK_M_PER_MIN + MIN_PER_STATION * stations.length);
  const planned = game.meta?.expectedDuration;
  const plannedMin = typeof planned === "number" && planned > 0 ? Math.round(planned / 60) : null;
  const counts = new Map<string, number>();
  for (const st of stations) if (st.task && TASK_LABELS[st.task.type]) counts.set(st.task.type, (counts.get(st.task.type) ?? 0) + 1);
  const fragments = objects(game.fragments);
  return {
    stations: stations.length,
    hidden: stations.filter((st) => st.visibility === "hidden").length,
    final: stations.some((st) => st.final),
    walkM,
    estimateMin,
    plannedMin,
    offPlan: plannedMin !== null && stations.length > 0 && Math.abs(estimateMin - plannedMin) > plannedMin * 0.3,
    tasks: (Object.keys(TASK_LABELS) as (keyof typeof TASK_LABELS)[]).filter((t) => counts.has(t)).map((t) => [TASK_LABELS[t], counts.get(t)!]),
    fragments: fragments.length,
    finalCode: [...fragments]
      .sort((a, b) => a.position - b.position)
      .map((f) => f.value ?? "")
      .join(""),
    characters: objects(game.characters).length,
    chapters: objects(game.story?.chapters).length,
    items: objects(game.items).length,
    rules: objects(game.rules).length,
    media: objects(game.media).length,
  };
}

const AGES: Record<string, string> = { "6-9": "6–9 J.", "10-13": "10–13 J.", "14-17": "14–17 J.", adult: "Erwachsene" };

/** Spielwelt in einer Zeile: „Mystery · Nacht · Grusel 1 · 10–13 J.“ */
export function worldLine(game: Game): string {
  const m = game.meta ?? ({} as Game["meta"]);
  const parts: string[] = [];
  if (m.genre) parts.push(GENRE_LABELS[m.genre] ?? m.genre);
  if (m.night) parts.push("Nacht");
  if (typeof m.scareLevel === "number") parts.push(`Grusel ${m.scareLevel}`);
  if (Array.isArray(m.ageGroups) && m.ageGroups.length) parts.push(m.ageGroups.map((a) => AGES[a] ?? a).join(", "));
  return parts.join(" · ");
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`);
export const MEDIA_WARN_BYTES = 50 * 1024 * 1024;

function StepButton({ action, gameId }: { action: StepAction; gameId: string }) {
  if (action.jump) {
    const jump = action.jump;
    return (
      <button type="button" class="btn small" onClick={() => jumpTo(jump)}>
        {action.label}
      </button>
    );
  }
  const to = action.onSite
    ? href("onSite", { gameId })
    : action.section && action.section !== "uebersicht"
      ? href("editorSection", { gameId, section: action.section }, action.query)
      : href("editor", { gameId });
  return (
    <Link to={to} class="btn small">
      {action.label}
    </Link>
  );
}

export function OverviewSection({ gameId }: { gameId: string }) {
  const steps = useEditorSelect(
    (s) => nextSteps(s),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const game = useEditorSelect((s) => s.game);
  const issues = useEditorSelect((s) => {
    const hidden = new Set(s.meta.dismissed ?? []);
    return bySeverity(s.issues.filter((i) => !hidden.has(i.id) && i.severity !== "hint"));
  }, shallowArray);
  const hints = useEditorSelect((s) => s.issues.filter((i) => i.severity === "hint" && !(s.meta.dismissed ?? []).includes(i.id)), shallowArray);
  const phone = useMedia("(max-width: 640px)");
  const [all, setAll] = useState(false);
  const facts = gameFacts(game);
  const world = worldLine(game);
  const done = steps.filter((s) => s.state === "done").length;
  const MiniMap: ComponentType<{ gameId: string }> | null = sections.overviewMap;
  const shown: EditorIssue[] = all ? issues : issues.slice(0, 6);

  return (
    <section class="editor-overview stack loose" aria-labelledby="bereich-uebersicht">
      <h2 id="bereich-uebersicht" tabIndex={-1} class="sr-only">
        Übersicht
      </h2>
      {phone && (
        <Link to={href("onSite", { gameId })} class="btn primary block editor-onsite-big">
          <Icon name="pin" /> Vor Ort arbeiten
        </Link>
      )}
      <div class="editor-overview-grid">
        <section class="card stack" aria-labelledby="naechste-schritte">
          <header class="row between">
            <h3 id="naechste-schritte">Nächste Schritte</h3>
            <span class="row nowrap small muted">
              <span class="progress editor-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Erledigt">
                <span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
              </span>
              {done} von {steps.length}
            </span>
          </header>
          <ol class="editor-steps">
            {steps.map((step) => {
              const m = STEP_MARK[step.state];
              return (
                <li key={step.id} class={`editor-step ${step.state}`}>
                  <span class={`mark ${step.state === "done" ? "ok" : step.state === "error" ? "error" : step.state === "todo" ? "warning" : "open"}`} aria-hidden="true">
                    {m.mark}
                  </span>
                  <span class="min0">
                    <span class="sr-only">{m.text}: </span>
                    {step.text}
                    {step.detail && <span class="small muted"> · {step.detail}</span>}
                  </span>
                  {step.actions.length > 0 && (
                    <span class="row nowrap editor-step-actions">
                      {step.actions.map((a) => (
                        <StepButton key={a.label} action={a} gameId={gameId} />
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        <section class="card stack" aria-labelledby="in-zahlen">
          <h3 id="in-zahlen">Das Spiel in Zahlen</h3>
          {MiniMap && <MiniMap gameId={gameId} />}
          <Facts facts={facts} gameId={gameId} />
          {world && (
            <p class="row between">
              <span>
                <span class="label">Spielwelt</span> {world}
              </span>
              <Link to={href("editorSection", { gameId, section: "geschichte" })} class="btn small ghost">
                Ändern
              </Link>
            </p>
          )}
        </section>
      </div>
      <section class="card stack" aria-labelledby="meldungen">
        <h3 id="meldungen">{issues.length ? `Offene Meldungen (${issues.length})` : "Keine offenen Fehler oder Warnungen"}</h3>
        <IssueList issues={shown} jump />
        {issues.length > shown.length && (
          <button type="button" class="btn small ghost" onClick={() => setAll(true)}>
            Alle {issues.length} zeigen
          </button>
        )}
        {hints.length > 0 && (
          <details>
            <summary>Tipps ({hints.length})</summary>
            <IssueList issues={hints} jump />
          </details>
        )}
      </section>
    </section>
  );
}

function Facts({ facts, gameId }: { facts: GameFacts; gameId: string }) {
  const files = useLoad(() => api.media(gameId), [gameId]);
  const srcs = useEditorSelect((s) => objects(s.game.media).map((m) => m.src), shallowArray);
  const bytes = (files.data ?? []).filter((f) => srcs.includes(f.src)).reduce((sum, f) => sum + f.size, 0);
  return (
    <ul class="editor-facts">
      <li>
        {plural(facts.stations, "Station", "Stationen")}
        {facts.hidden > 0 && ` · ${facts.hidden} versteckt`}
        {facts.stations > 0 && !facts.final && " · ohne Finale"}
      </li>
      {facts.walkM > 0 && <li>Laufweg ca. {km(facts.walkM)} (Luftlinie)</li>}
      {facts.stations > 0 && (
        <li>
          ≈ {facts.estimateMin} Min{facts.plannedMin !== null && `, geplant ${facts.plannedMin} Min`}{" "}
          {facts.plannedMin !== null &&
            (facts.offPlan ? (
              <span class="mark warning" aria-label="weicht stark ab">
                !
              </span>
            ) : (
              <span class="mark ok" aria-label="passt">
                ✓
              </span>
            ))}
        </li>
      )}
      {facts.tasks.length > 0 && <li>Rätsel: {facts.tasks.map(([label, n]) => `${n} ${label}`).join(", ")}</li>}
      {facts.fragments > 0 && (
        <li>
          {plural(facts.fragments, "Codeteil", "Codeteile")} → Finalcode <span class="num">{facts.finalCode}</span>
        </li>
      )}
      {(facts.characters > 0 || facts.chapters > 0) && (
        <li>
          {plural(facts.characters, "Figur", "Figuren")} · {facts.chapters} Kapitel
        </li>
      )}
      {(facts.items > 0 || facts.rules > 0) && (
        <li>
          {plural(facts.items, "Gegenstand", "Gegenstände")} · {plural(facts.rules, "Regel", "Regeln")}
        </li>
      )}
      <li>
        {plural(facts.media, "Medium", "Medien")}
        {bytes > 0 && ` · ${formatBytes(bytes)} (lädt vorab aufs Handy)`}
        {bytes > MEDIA_WARN_BYTES && (
          <span class="mark warning" aria-label="viel zum Vorladen">
            !
          </span>
        )}
      </li>
    </ul>
  );
}
