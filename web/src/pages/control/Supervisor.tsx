/**
 * Betreuer-Ansicht fürs Handy: Teams, SOS, Funk, Prüfungen und Karte, ohne Eingriffe.
 * Knöpfe erscheinen nur mit dem passenden Recht (wie im Server, lib/roles.ts).
 */

import "./control.css";
import { useState } from "preact/hooks";
import type { TeamPatch } from "../../lib/api.ts";
import { formatAgo, formatBattery, formatDuration } from "../../lib/format.ts";
import { can } from "../../lib/roles.ts";
import { href, setQuery, useLocation } from "../../lib/router.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import { remaining } from "../../lib/time.ts";
import type { OverviewTeam } from "../../lib/types.ts";
import { WARNING_LABELS, severity, sortWarnings } from "../../lib/warnings.ts";
import { Empty, ErrorNotice, Link, Loading, StatusBadge, Tabs, TeamDot, useNow, useTitle, type TabDef } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MapView } from "./Control.tsx";
import { Connection, EventClock } from "./Header.tsx";
import { Radio, unreadTotal, type SendKind, type Thread } from "./Radio.tsx";
import { pendingReviews, Reviews } from "./Reviews.tsx";
import { RecallBanner, SosPanel } from "./Safety.tsx";
import { sortTeams } from "./Teams.tsx";
import { isFatal, useControl } from "./useControl.ts";

type Tab = "teams" | "funk" | "pruefungen" | "karte";

export function SupervisorPage({ eventId }: { eventId: string }) {
  const control = useControl(eventId);
  const { state } = control;
  const loc = useLocation();
  const [radioPreset, setRadioPreset] = useState<{ thread: Thread; kind: SendKind; key: number } | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  // Offene SOS stehen vorne im Titel, damit sie auch im Hintergrund-Tab auffallen.
  const openSos = state.sos.filter((s) => !s.resolved_at).length;
  useTitle(`${openSos ? `SOS (${openSos}) · ` : ""}${state.event ? `Betreuer ${state.event.name}` : "Betreuer"}`);

  if (!state.event) {
    return (
      <div class="page">
        {state.error ? <ErrorNotice error={state.error} retry={isFatal(state.error) ? undefined : () => void control.reload()} /> : <Loading text="Lade Event …" />}
      </div>
    );
  }
  const event = state.event;
  const role = state.role;
  const tab = (loc.query.get("tab") as Tab | null) ?? "teams";
  const setTab = (t: Tab) => setQuery({ tab: t });
  const openRadio = (teamId: string) => {
    setRadioPreset({ thread: teamId, kind: "chat", key: Date.now() });
    setTab("funk");
  };
  const focusOn = (lat: number, lon: number) => {
    setFocus({ lat, lon, key: Date.now() });
    setTab("karte");
  };

  const tabs: TabDef<Tab>[] = [
    { id: "teams", label: "Teams", count: state.teams.length },
    { id: "funk", label: "Funk", count: unreadTotal(state.messages), countClass: "on" },
    { id: "pruefungen", label: "Prüfungen", count: pendingReviews(state.teams).length, countClass: "on" },
    ...(can(role, "event.positions") ? [{ id: "karte" as const, label: "Karte" }] : []),
  ];

  return (
    <div class="supervisor">
      <header class="sv-head">
        <div class="row between">
          <h1 class="min0 wrap-anywhere">{event.name}</h1>
          <StatusBadge status={event.status} />
        </div>
        <div class="row">
          <EventClock event={event} game={state.game} />
          <Connection live={state.live} />
          {/* Betreuer mit Tablet wollen manchmal die große Karte; die volle Ansicht zeigt ihnen trotzdem nur, was sie dürfen. */}
          <Link to={href("control", { eventId }, { voll: "1" })} class="btn small">
            {role === "supervisor" ? "Volle Ansicht" : "Leitstand"}
          </Link>
        </div>
      </header>
      {state.error && !isFatal(state.error) ? <ErrorNotice error={state.error} retry={() => void control.reload()} /> : null}
      <div class="control-safety">
        <SosPanel sos={state.sos} teams={state.teams} role={role} eventId={eventId} onChanged={() => void control.reloadSos()} onFocus={can(role, "event.positions") ? focusOn : undefined} />
        <RecallBanner event={event} game={state.game} teams={state.teams} />
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Betreuer-Ansicht" />
      <div class="sv-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "teams" &&
          (state.teams.length ? (
            <ul class="list sv-teams">
              {sortTeams(state.teams).map((t) => (
                <SupervisorTeam key={t.id} team={t} eventId={eventId} control={control} onMessage={() => openRadio(t.id)} onFocus={focusOn} />
              ))}
            </ul>
          ) : (
            <Empty>Noch keine Teams. Code für die App: {event.join.code}</Empty>
          ))}
        {tab === "funk" && (
          <Radio
            eventId={eventId}
            game={state.game}
            teams={state.teams}
            messages={state.messages}
            canSend={can(role, "event.message")}
            preset={radioPreset}
            onSent={() => void control.reloadMessages()}
          />
        )}
        {tab === "pruefungen" && (
          <Reviews eventId={eventId} game={state.game} teams={state.teams} canReview={can(role, "event.review")} uploadTick={state.uploadTick} onDone={() => void control.reloadOverview()} />
        )}
        {tab === "karte" && (
          <div class="map-tab">
            <MapView game={state.game} teams={state.teams} sos={state.sos} selected={null} track={null} focus={focus} onSelect={() => setTab("teams")} />
          </div>
        )}
      </div>
    </div>
  );
}

function SupervisorTeam({
  team,
  eventId,
  control,
  onMessage,
  onFocus,
}: {
  team: OverviewTeam;
  eventId: string;
  control: ReturnType<typeof useControl>;
  onMessage: () => void;
  onFocus: (lat: number, lon: number) => void;
}) {
  const { state } = control;
  const now = useNow(5000);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const role = state.role;
  const event = state.event!;
  const p = team.progress;
  const rest = remaining(state.game, event, { startedAt: team.startedAt, finishedAt: team.finishedAt, timePenalty: p.timePenalty }, now);

  const patchTeam = async (patch: TeamPatch, done: string) => {
    setBusy(true);
    try {
      await api.updateTeam(eventId, team.id, patch);
      notify(done, "ok");
      await control.reloadOverview();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    setOpen(!open);
    // Notfallnummer gibt es nur im Team-Detail (mit Prüfrecht).
    if (!open && phone === undefined && can(role, "event.review")) {
      api
        .team(eventId, team.id)
        .then((d) => setPhone(d.emergencyPhone ?? null))
        .catch(() => setPhone(null));
    }
  };

  return (
    <li class={`sv-team${team.openSos ? " sos" : ""}`}>
      <button type="button" class="sv-team-head" aria-expanded={open} onClick={() => void toggle()}>
        <TeamDot color={team.color} id={team.id} />
        <strong class="min0 wrap-anywhere">{team.name}</strong>
        {team.openSos > 0 && <span class="badge safety">SOS</span>}
        {team.arrivedAt && <span class="badge strong">Am Sammelpunkt</span>}
        <span class="spacer" />
        <span class="num small">
          {p.solved}/{p.stations}
        </span>
      </button>
      <div class="sv-team-meta small">
        <span>Kontakt {formatAgo(team.lastSeenAt, now)}</span>
        <span>Akku {formatBattery(team.battery)}</span>
        {rest !== null && !team.finishedAt && <span class="num">{formatDuration(rest)} übrig</span>}
        {event.supervisorRequired && !team.supervisorPresent && <span class="strong">Betreuer fehlt</span>}
      </div>
      {team.warnings.length > 0 && (
        <ul class="list">
          {sortWarnings(team.warnings).map((w, i) => (
            <li key={i} class={`warn warn-${severity(w.kind)} small`}>
              <span class="warn-kind label">{WARNING_LABELS[w.kind]}</span> {w.message}
            </li>
          ))}
        </ul>
      )}
      <div class="sv-actions">
        {can(role, "event.message") && (
          <button type="button" class="btn" onClick={onMessage}>
            <Icon name="radio" /> Nachricht
          </button>
        )}
        {can(role, "event.review") && !team.supervisorPresent && (
          <button type="button" class="btn primary" disabled={busy} onClick={() => void patchTeam({ supervisorPresent: true }, `Betreuer für ${team.name} bestätigt`)}>
            <Icon name="check" /> Betreuer bestätigen
          </button>
        )}
        {can(role, "event.review") && !team.arrivedAt && (
          <button type="button" class="btn" disabled={busy} onClick={() => void patchTeam({ arrived: true }, `${team.name} am Sammelpunkt`)}>
            <Icon name="flag" /> Angekommen
          </button>
        )}
        {team.position && can(role, "event.positions") && (
          <button type="button" class="btn" onClick={() => onFocus(team.position!.lat, team.position!.lon)}>
            <Icon name="pin" /> Karte
          </button>
        )}
      </div>
      {open && (
        <dl class="kv sv-detail">
          <dt>Punkte</dt>
          <dd class="num">
            {p.points}
            {p.rank !== undefined ? ` · Rang ${p.rank}` : ""}
          </dd>
          {p.totalFragments > 0 && (
            <>
              <dt>Fragmente</dt>
              <dd class="num">
                {p.fragments}/{p.totalFragments}
              </dd>
            </>
          )}
          <dt>Hinweise</dt>
          <dd class="num">{p.hintsUsed}</dd>
          <dt>Mitglieder</dt>
          <dd>{team.members.join(", ") || "–"}</dd>
          {phone !== undefined && (
            <>
              <dt>Notfall</dt>
              <dd>
                {phone ? (
                  <a class="btn small" href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
                    <Icon name="phone" /> {phone}
                  </a>
                ) : (
                  "nicht angegeben"
                )}
              </dd>
            </>
          )}
        </dl>
      )}
    </li>
  );
}
