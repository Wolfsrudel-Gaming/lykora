/** Teamliste mit Fortschritt und Lebenszeichen, dazu die Warnungen des Assistenten. */

import { formatAgo, formatBattery, formatDuration, plural } from "../../lib/format.ts";
import { remaining } from "../../lib/time.ts";
import type { EventDto, Game, OverviewTeam, Warning } from "../../lib/types.ts";
import { quickActions, severity, sortWarnings, URGENCY, WARNING_LABELS, type QuickAction } from "../../lib/warnings.ts";
import { Empty, TeamDot, useNow } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export interface TeamUi {
  openTeam: (teamId: string) => void;
  openRadio: (teamId: string | null, kind?: "chat" | "hint") => void;
  openReviews: () => void;
  openSos: () => void;
  focusTeam: (teamId: string) => void;
  focusStation: (stationId: string) => void;
}

/** Dringlichstes zuerst: SOS, dann nach schwerster Warnung, dann Name. */
export function sortTeams(teams: OverviewTeam[]): OverviewTeam[] {
  const worst = (t: OverviewTeam) => Math.min(99, ...t.warnings.map((w) => URGENCY[w.kind]));
  return [...teams].sort((a, b) => b.openSos - a.openSos || worst(a) - worst(b) || a.name.localeCompare(b.name, "de"));
}

export function TeamList({
  teams,
  event,
  game,
  selected,
  onOpen,
  compact,
}: {
  teams: OverviewTeam[];
  event: EventDto;
  game: Game | null;
  selected: string | null;
  onOpen: (teamId: string) => void;
  compact?: boolean;
}) {
  const now = useNow();
  if (!teams.length) {
    return <Empty>Noch keine Teams. Teams treten mit dem Event-Code {event.join.code} in der App bei.</Empty>;
  }
  return (
    <ul class="list team-list" aria-label="Teams">
      {sortTeams(teams).map((t) => {
        const rest = remaining(game, event, { startedAt: t.startedAt, finishedAt: t.finishedAt, timePenalty: t.progress.timePenalty }, now);
        const p = t.progress;
        const sos = t.openSos > 0;
        const kinds = [...new Set(sortWarnings(t.warnings).map((w) => w.kind))].filter((k) => k !== "sos");
        return (
          <li key={t.id}>
            <button type="button" class={`team-row${sos ? " sos" : ""}${t.id === selected ? " selected" : ""}`} aria-pressed={t.id === selected} onClick={() => onOpen(t.id)}>
              <span class="team-row-head">
                <TeamDot color={t.color} id={t.id} />
                <strong class="team-name">{t.name}</strong>
                {sos && <span class="badge safety">SOS</span>}
                {t.finishedAt && <span class="badge on">Im Ziel</span>}
                {t.arrivedAt && <span class="badge strong">Am Sammelpunkt</span>}
                {event.supervisorRequired && !t.supervisorPresent && <span class="badge">Betreuer fehlt</span>}
                {p.rank !== undefined && (
                  <span class="rank num" title="Rang">
                    #{p.rank}
                  </span>
                )}
              </span>
              <span class="team-row-stats">
                <span>
                  {p.solved}/{p.stations} Stationen
                </span>
                {p.totalFragments > 0 && (
                  <span>
                    {p.fragments}/{p.totalFragments} Fragmente
                  </span>
                )}
                <span>{p.points} P</span>
                {rest !== null && !t.finishedAt && <span class={rest < 300 ? "strong" : ""}>{formatDuration(rest)} übrig</span>}
              </span>
              {!compact && (
                <span class="team-row-meta small">
                  <span title="Letzter Kontakt">
                    <Icon name="signal" size={14} /> {formatAgo(t.lastSeenAt, now)}
                  </span>
                  <span title="Akku">
                    <Icon name="battery" size={14} /> {formatBattery(t.battery)}
                  </span>
                  {t.supervisorPresent && <span>Betreuer dabei</span>}
                  {p.hintsUsed > 0 && <span>{plural(p.hintsUsed, "Hinweis", "Hinweise")}</span>}
                </span>
              )}
              {kinds.length > 0 && (
                <span class="chips">
                  {kinds.map((k) => (
                    <span key={k} class={`chip warn-${severity(k)}`}>
                      {WARNING_LABELS[k]}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ACTION_LABELS: Record<QuickAction, string> = {
  sos: "Zum SOS",
  team: "Team öffnen",
  message: "Nachricht",
  hint: "Hinweis senden",
  review: "Prüfen",
  map: "Auf der Karte",
};

export function WarningList({ warnings, ui, canMessage, canReview }: { warnings: Warning[]; ui: TeamUi; canMessage: boolean; canReview: boolean }) {
  const list = sortWarnings(warnings);
  if (!list.length) return <p class="muted small warn-empty">Keine Warnungen. Alles ruhig.</p>;
  const run = (w: Warning, a: QuickAction) => {
    if (a === "sos") ui.openSos();
    else if (a === "team" && w.teamId) ui.openTeam(w.teamId);
    else if (a === "message" && w.teamId) ui.openRadio(w.teamId);
    else if (a === "hint" && w.teamId) ui.openRadio(w.teamId, "hint");
    else if (a === "review") ui.openReviews();
    else if (a === "map") {
      if (w.teamId) ui.focusTeam(w.teamId);
      else if (w.stationId) ui.focusStation(w.stationId);
    }
  };
  const allowed = (w: Warning, a: QuickAction) => {
    if ((a === "message" || a === "hint") && !canMessage) return false;
    if (a === "review" && !canReview) return false;
    if ((a === "team" || a === "message" || a === "hint") && !w.teamId) return false;
    return true;
  };
  return (
    <ul class="list warn-list" aria-label="Warnungen">
      {list.map((w, i) => (
        <li key={`${w.kind}-${w.teamId ?? ""}-${w.stationId ?? ""}-${w.zoneId ?? ""}-${i}`} class={`warn warn-${severity(w.kind)}`}>
          <p class="warn-text">
            <span class="warn-kind label">{WARNING_LABELS[w.kind]}</span>
            {w.message}
          </p>
          <div class="row">
            {quickActions(w)
              .filter((a) => allowed(w, a))
              .map((a) => (
                <button key={a} type="button" class={`btn small${a === "sos" ? " safety" : ""}`} onClick={() => run(w, a)}>
                  {ACTION_LABELS[a]}
                </button>
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
