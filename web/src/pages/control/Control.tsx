/**
 * Leitstand eines Events: Kopf mit Steuerung, Sicherheitsfelder, Karte, Teams mit
 * Warnungen und ein Reiterfeld für Team, Funk, Klang, Prüfungen, Rangliste und Logbuch.
 * Breite Bildschirme zeigen drei Spalten, Tablets zwei, Handys eine mit Reitern.
 */

import "./control.css";
import { useEffect, useState } from "preact/hooks";
import { can } from "../../lib/roles.ts";
import { href, navigate, setQuery, useLocation } from "../../lib/router.ts";
import { api, notify } from "../../lib/session.ts";
import type { TrackPoint } from "../../lib/types.ts";
import { ErrorNotice, Link, Loading, Tabs, useMedia, useTitle, type TabDef } from "../../ui/components.tsx";
import { lazyPage } from "../../ui/lazy.tsx";
import { ControlHeader } from "./Header.tsx";
import { Log } from "./Log.tsx";
import type { MapProps } from "./MapView.tsx";
import { Radio, unreadTotal, type SendKind, type Thread } from "./Radio.tsx";
import { pendingReviews, Reviews } from "./Reviews.tsx";
import { RecallBanner, SosPanel } from "./Safety.tsx";
import { SoundBoard } from "./SoundBoard.tsx";
import { Standings } from "./Standings.tsx";
import { TeamDetail } from "./TeamDetail.tsx";
import { TeamList, WarningList, type TeamUi } from "./Teams.tsx";
import { isFatal, useControl, type Control } from "./useControl.ts";

export const MapView = lazyPage<MapProps>(() => import("./MapView.tsx").then((m) => m.MapView));

type Tab = "team" | "teams" | "karte" | "funk" | "klang" | "pruefungen" | "rangliste" | "logbuch";

/** Laufspur des gewählten Teams; neue Positionen kommen live dazu. */
export function useTrack(control: Control, eventId: string, teamId: string | null): TrackPoint[] | null {
  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  useEffect(() => {
    setTrack(null);
    if (!teamId) return;
    let alive = true;
    api
      .track(eventId, teamId)
      .then((t) => alive && setTrack(t))
      .catch((err) => alive && notify(`Laufspur: ${err instanceof Error ? err.message : String(err)}`, "error"));
    const off = control.onTrack((id, p) => {
      if (id === teamId) setTrack((t) => (t ? [...t, p] : t));
    });
    return () => {
      alive = false;
      off();
    };
  }, [eventId, teamId]);
  return track;
}

export function ControlPage({ eventId }: { eventId: string }) {
  const control = useControl(eventId);
  const { state } = control;
  const loc = useLocation();
  const wide = useMedia("(min-width: 1280px)");
  const narrow = useMedia("(max-width: 899px)");
  const [radioPreset, setRadioPreset] = useState<{ thread: Thread; kind: SendKind; key: number } | null>(null);
  const [soundPreset, setSoundPreset] = useState<{ teamId: string | null; key: number } | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const [trackTeam, setTrackTeam] = useState<string | null>(null);
  const track = useTrack(control, eventId, trackTeam);
  // Offene SOS stehen vorne im Titel, damit sie auch im Hintergrund-Tab auffallen.
  const openSos = state.sos.filter((s) => !s.resolved_at).length;
  useTitle(`${openSos ? `SOS (${openSos}) · ` : ""}${state.event ? `Leitstand ${state.event.name}` : "Leitstand"}`);

  const role = state.role;
  // Betreuer bekommen die vereinfachte Ansicht, außer sie wollen ausdrücklich die volle.
  useEffect(() => {
    if (role === "supervisor" && !loc.query.has("voll")) navigate(href("supervisor", { eventId }), { replace: true });
  }, [role]);

  const selected = loc.query.get("team");
  const team = state.teams.find((t) => t.id === selected) ?? null;
  const defaultTab: Tab = narrow ? "karte" : wide ? "funk" : "teams";
  let tab = (loc.query.get("tab") as Tab | null) ?? (team ? "team" : defaultTab);
  if ((tab === "teams" && wide) || (tab === "karte" && !narrow) || (tab === "team" && !team)) tab = defaultTab;

  if (!state.event) {
    return (
      <div class="page">
        {state.error ? <ErrorNotice error={state.error} retry={isFatal(state.error) ? undefined : () => void control.reload()} /> : <Loading text="Lade Leitstand …" />}
      </div>
    );
  }
  const event = state.event;

  const setTab = (t: Tab) => setQuery({ tab: t });
  const focusOn = (lat: number, lon: number) => {
    setFocus({ lat, lon, key: Date.now() });
    if (narrow) setTab("karte");
  };
  const ui: TeamUi = {
    openTeam: (teamId) => setQuery({ team: teamId, tab: "team" }),
    openRadio: (teamId, kind = "chat") => {
      setRadioPreset({ thread: teamId ?? "all", kind, key: Date.now() });
      setTab("funk");
    },
    openReviews: () => setTab("pruefungen"),
    openSos: () => document.getElementById("sos-title")?.scrollIntoView({ block: "center" }),
    focusTeam: (teamId) => {
      const t = state.teams.find((x) => x.id === teamId);
      if (t?.position) focusOn(t.position.lat, t.position.lon);
      else notify(`Von ${t?.name ?? "diesem Team"} gibt es noch keine Position.`, "warn");
    },
    focusStation: (stationId) => {
      const s = state.game?.stations.find((x) => x.id === stationId);
      if (s?.location) focusOn(s.location.lat, s.location.lon);
    },
  };

  const reviews = pendingReviews(state.teams).length;
  const unread = unreadTotal(state.messages);
  const tabs: TabDef<Tab>[] = [
    ...(team ? [{ id: "team" as const, label: team.name }] : []),
    ...(!wide ? [{ id: "teams" as const, label: "Teams", count: state.warnings.length, countClass: "on" as const }] : []),
    ...(narrow ? [{ id: "karte" as const, label: "Karte" }] : []),
    { id: "funk", label: "Funk", count: unread, countClass: "on" },
    { id: "klang", label: "Klang" },
    { id: "pruefungen", label: "Prüfungen", count: reviews, countClass: "on" },
    { id: "rangliste", label: "Rangliste" },
    { id: "logbuch", label: "Logbuch" },
  ];

  const map = (
    <MapView
      game={state.game}
      teams={state.teams}
      sos={state.sos}
      selected={selected}
      track={trackTeam === selected ? track : null}
      focus={focus}
      onSelect={(id) => ui.openTeam(id)}
    />
  );

  const teamsPanel = (
    <div class="stack">
      <section aria-labelledby="assist-title" class="stack tight">
        <h2 id="assist-title" class="panel-title">
          Assistent
        </h2>
        <WarningList warnings={state.warnings} ui={ui} canMessage={can(role, "event.message")} canReview={can(role, "event.review")} />
      </section>
      <section aria-labelledby="teams-title" class="stack tight">
        <h2 id="teams-title" class="panel-title">
          Teams <span class="count">{state.teams.length}</span>
        </h2>
        <TeamList teams={state.teams} event={event} game={state.game} selected={selected} onOpen={ui.openTeam} />
      </section>
    </div>
  );

  const panel = () => {
    switch (tab) {
      case "team":
        return team ? (
          <TeamDetail
            eventId={eventId}
            team={team}
            event={event}
            game={state.game}
            role={role}
            tick={state.teamTick}
            ui={{
              openRadio: (id, kind) => ui.openRadio(id, kind),
              openSound: (id) => {
                setSoundPreset({ teamId: id, key: Date.now() });
                setTab("klang");
              },
              close: () => {
                setTrackTeam(null);
                setQuery({ team: null, tab: null });
              },
              trackShown: trackTeam === team.id,
              toggleTrack: () => {
                const next = trackTeam === team.id ? null : team.id;
                setTrackTeam(next);
                if (next && narrow) setTab("karte");
              },
            }}
          />
        ) : null;
      case "teams":
        return teamsPanel;
      case "karte":
        return <div class="map-tab">{map}</div>;
      case "funk":
        return (
          <Radio
            eventId={eventId}
            game={state.game}
            teams={state.teams}
            messages={state.messages}
            canSend={can(role, "event.message")}
            preset={radioPreset}
            onSent={() => void control.reloadMessages()}
          />
        );
      case "klang":
        return (
          <SoundBoard
            eventId={eventId}
            game={state.game}
            teams={state.teams}
            messages={state.messages}
            canSend={can(role, "event.message")}
            preset={soundPreset}
            onSent={() => void control.reloadMessages()}
          />
        );
      case "pruefungen":
        return <Reviews eventId={eventId} game={state.game} teams={state.teams} canReview={can(role, "event.review")} uploadTick={state.uploadTick} onDone={() => void control.reloadOverview()} />;
      case "rangliste":
        return <Standings eventId={eventId} teams={state.teams} tick={state.teamTick} />;
      case "logbuch":
        return <Log eventId={eventId} log={state.log} teams={state.teams} game={state.game} />;
    }
  };

  return (
    <div class={`control ${wide ? "wide" : narrow ? "narrow" : "medium"}`}>
      <ControlHeader
        event={event}
        game={state.game}
        role={role}
        live={state.live}
        onChanged={(e) => {
          control.setEvent(e);
          void control.reloadOverview();
        }}
        extra={
          role === "supervisor" ? (
            <Link to={href("supervisor", { eventId })} class="btn small">
              Einfache Ansicht
            </Link>
          ) : undefined
        }
      />
      {state.error && !isFatal(state.error) ? <ErrorNotice error={state.error} retry={() => void control.reload()} /> : null}
      <div class="control-safety">
        <SosPanel sos={state.sos} teams={state.teams} role={role} eventId={eventId} onChanged={() => void control.reloadSos()} onFocus={focusOn} onOpenTeam={ui.openTeam} />
        <RecallBanner event={event} game={state.game} teams={state.teams} />
      </div>
      <div class="control-body">
        {wide && <aside class="col col-left">{teamsPanel}</aside>}
        {!narrow && <section class="col col-map">{map}</section>}
        <section class="col col-panel">
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Leitstand" />
          <div class="panel-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {panel()}
          </div>
        </section>
      </div>
    </div>
  );
}
