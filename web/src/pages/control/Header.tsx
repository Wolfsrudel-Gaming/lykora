import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { formatDuration, text } from "../../lib/format.ts";
import type { LiveState } from "../../lib/live.ts";
import { can } from "../../lib/roles.ts";
import { href } from "../../lib/router.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import { eventElapsed, isPaused, remaining, timeLimit } from "../../lib/time.ts";
import type { EventAction, EventDto, Game, Role } from "../../lib/types.ts";
import { Link, StatusBadge, confirm, useNow } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export const LIVE_LABELS: Record<LiveState, string> = {
  connecting: "Verbinde …",
  open: "Live verbunden",
  closed: "Getrennt – verbinde neu",
  denied: "Kein Live-Zugang",
};

export function Connection({ live }: { live: LiveState }) {
  return (
    <span class={`conn ${live}`} role="status" aria-live="polite">
      <span class="conn-dot" aria-hidden="true" />
      {LIVE_LABELS[live]}
    </span>
  );
}

/** Restzeit bei globalem Limit, sonst Laufzeit des Events. */
export function EventClock({ event, game }: { event: EventDto; game: Game | null }) {
  const now = useNow();
  const { limit, duration } = timeLimit(game);
  const rest = limit === "global" ? remaining(game, event, null, now) : null;
  const elapsed = eventElapsed(event, now);
  // Bei Pause und Rückruf steht die Uhr; das soll man sehen.
  const stopped = isPaused(event);
  if (rest !== null) {
    return (
      <span class={`clock${rest < 600 ? " low" : ""}`}>
        <span class="label">{stopped ? "Restzeit, angehalten" : "Restzeit"}</span>
        <span class="num">{formatDuration(rest)}</span>
      </span>
    );
  }
  return (
    <span class="clock">
      <span class="label">{event.status === "draft" ? "Noch nicht gestartet" : stopped ? "Laufzeit, angehalten" : "Laufzeit"}</span>
      <span class="num">{elapsed === null ? "–:––" : formatDuration(elapsed)}</span>
      {limit === "per_team" && duration ? <span class="small muted">je Team {formatDuration(duration)}</span> : null}
    </span>
  );
}

export function ControlHeader({
  event,
  game,
  role,
  live,
  onChanged,
  extra,
}: {
  event: EventDto;
  game: Game | null;
  role: Role | undefined;
  live: LiveState;
  onChanged: (e: EventDto) => void;
  extra?: ComponentChildren;
}) {
  const [busy, setBusy] = useState<EventAction | null>(null);
  const manage = can(role, "event.manage");

  const run = async (action: EventAction, reason?: string) => {
    setBusy(action);
    try {
      onChanged(await api.eventAction(event.id, action, reason));
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const recall = async () => {
    const answer = await confirm({
      title: "Alle zurück zum Sammelpunkt?",
      body: (
        <>
          <p>Das Spiel wird angehalten. Alle Teams bekommen sofort den Rückruf mit Weg zum Sammelpunkt.</p>
          <p class="muted small">Mit „Fortsetzen“ geht das Spiel danach weiter.</p>
        </>
      ),
      confirm: "Rückruf senden",
      safety: true,
      input: { label: "Grund (geht an alle Teams)", placeholder: "z. B. Gewitter zieht auf", multiline: true },
    });
    if (answer.ok) await run("recall", answer.value || undefined);
  };

  const end = async () => {
    const answer = await confirm({
      title: event.status === "draft" ? "Event absagen?" : "Event beenden?",
      body: <p>Danach können Teams nicht mehr spielen und nicht mehr beitreten. Rangliste und Logbuch bleiben.</p>,
      confirm: event.status === "draft" ? "Absagen" : "Beenden",
    });
    if (answer.ok) await run("end");
  };

  const start = async () => {
    const answer = await confirm({
      title: "Event starten?",
      body: <p>Die Uhr läuft los, Teams können Stationen auslösen.</p>,
      confirm: "Starten",
    });
    if (answer.ok) await run("start");
  };

  const s = event.status;
  return (
    <header class="control-head">
      <div class="control-title min0">
        <Link to={href("event", { eventId: event.id })} class="small muted">
          Event-Details
        </Link>
        <h1>{event.name}</h1>
        <span class="small muted">{text(event.gameTitle)}</span>
      </div>
      <div class="control-status">
        <StatusBadge status={s} />
        <EventClock event={event} game={game} />
        <Connection live={live} />
      </div>
      {extra}
      {manage && s !== "ended" && (
        <div class="control-actions" role="group" aria-label="Spielsteuerung">
          {s === "draft" && (
            <button type="button" class="btn primary" disabled={!!busy} onClick={() => void start()}>
              <Icon name="play" /> Start
            </button>
          )}
          {s === "running" && (
            <button type="button" class="btn" disabled={!!busy} onClick={() => void run("pause")}>
              <Icon name="pause" /> Pause
            </button>
          )}
          {(s === "paused" || s === "recalled") && (
            <button type="button" class="btn primary" disabled={!!busy} onClick={() => void run("resume")}>
              <Icon name="play" /> Fortsetzen
            </button>
          )}
          {(s === "running" || s === "paused") && (
            <button type="button" class="btn safety" disabled={!!busy} onClick={() => void recall()}>
              <Icon name="flag" /> Rückruf
            </button>
          )}
          <button type="button" class="btn" disabled={!!busy} onClick={() => void end()}>
            {s === "draft" ? "Absagen" : "Beenden"}
          </button>
        </div>
      )}
    </header>
  );
}
