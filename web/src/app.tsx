import { useEffect, useState } from "preact/hooks";
import { can } from "./lib/roles.ts";
import { href, matchRoute, navigate, useLocation, type Match, type RouteName } from "./lib/router.ts";
import { onLiveReconnect } from "./lib/live.ts";
import { api, currentOrg, restoreSession, selectOrg, session, setTheme, signOut, theme } from "./lib/session.ts";
import { useStore } from "./lib/store.ts";
import { buildLabel, dismissVersion, newerVersion, refreshUpdateHint, updateHint, versionNotice, watchVersion } from "./lib/update.ts";
import { ConfirmHost, ErrorNotice, Link, Loading, Toasts } from "./ui/components.tsx";
import { Icon, Lantern } from "./ui/icons.tsx";
import { lazyPage } from "./ui/lazy.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { JoinPage } from "./pages/Join.tsx";
import { OrgsPage } from "./pages/Orgs.tsx";
import { EventsPage } from "./pages/Events.tsx";
import { EventNewPage } from "./pages/EventNew.tsx";
import { EventPage } from "./pages/Event.tsx";
import { MembersPage } from "./pages/Members.tsx";
import { AccountPage } from "./pages/Account.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { NotFound } from "./pages/NotFound.tsx";

// Leitstand (mit Karte) und Spiele-Werkzeuge kommen als eigene Chunks.
const ControlPage = lazyPage(() => import("./pages/control/Control.tsx").then((m) => m.ControlPage));
const SupervisorPage = lazyPage(() => import("./pages/control/Supervisor.tsx").then((m) => m.SupervisorPage));
const GamesPage = lazyPage(() => import("./pages/games/Games.tsx").then((m) => m.GamesPage));
const GamePage = lazyPage(() => import("./pages/games/Game.tsx").then((m) => m.GamePage));
const MediaPage = lazyPage(() => import("./pages/games/Media.tsx").then((m) => m.MediaPage));
const SoundPage = lazyPage(() => import("./pages/games/Sound.tsx").then((m) => m.SoundPage));
const MaterialsPage = lazyPage(() => import("./pages/games/Materials.tsx").then((m) => m.MaterialsPage));

/** Startseite je nach Rolle: Events für die Spielleitung, Spiele für Autoren. */
function homeRoute(): RouteName {
  const role = currentOrg()?.role;
  if (can(role, "event.read")) return "events";
  if (can(role, "game.read")) return "games";
  return "orgs";
}

function Page({ match }: { match: Match }) {
  const p = match.params;
  switch (match.name) {
    case "orgs":
      return <OrgsPage />;
    case "events":
      return <EventsPage />;
    case "eventNew":
      return <EventNewPage />;
    case "event":
      return <EventPage eventId={p.eventId!} />;
    case "control":
      return <ControlPage eventId={p.eventId!} />;
    case "supervisor":
      return <SupervisorPage eventId={p.eventId!} />;
    case "games":
      return <GamesPage />;
    case "game":
      return <GamePage gameId={p.gameId!} />;
    case "gameMedia":
      return <MediaPage gameId={p.gameId!} />;
    case "gameSound":
      return <SoundPage gameId={p.gameId!} />;
    case "gameMaterials":
      return <MaterialsPage gameId={p.gameId!} />;
    case "members":
      return <MembersPage />;
    case "account":
      return <AccountPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <NotFound />;
  }
}

function TopBar({ match }: { match: Match | null }) {
  const s = useStore(session);
  const { value: mode } = useStore(theme);
  const hint = useStore(updateHint);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.path]);
  // Punkt am Zahnrad für Admins der Instanz; refreshUpdateHint fragt höchstens alle 10 Minuten.
  useEffect(() => {
    if (!s.instanceAdmin) return;
    const refresh = () => void refreshUpdateHint(() => api.updateStatus());
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [s.instanceAdmin]);
  // Nur für Admins der Instanz: Nach einem Nutzerwechsel im selben Tab könnte der Punkt sonst nachleuchten.
  const dot = s.instanceAdmin && hint.available;
  const role = s.orgs.find((o) => o.id === s.orgId)?.role;
  const section = match?.name ?? "";
  const nav: { to: RouteName; label: string; active: boolean; show: boolean }[] = [
    { to: "events", label: "Events", active: ["events", "eventNew", "event", "control", "supervisor"].includes(section), show: can(role, "event.read") },
    { to: "games", label: "Spiele", active: section.startsWith("game"), show: can(role, "game.read") },
    { to: "members", label: "Mitglieder", active: section === "members", show: can(role, "org.manage") },
  ];
  return (
    <header class={`topbar${open ? " open" : ""}`}>
      <Link to={href(homeRoute())} class="wordmark" aria-label="Lykora, zur Startseite">
        <Lantern />
        Lykora
      </Link>
      <span class="spacer" />
      <button type="button" class="btn small menu-toggle" aria-expanded={open} aria-label="Menü" onClick={() => setOpen(!open)}>
        <Icon name={open ? "x" : "menu"} />
      </button>
      <nav aria-label="Bereiche">
        {nav
          .filter((n) => n.show)
          .map((n) => (
            <Link key={n.to} to={href(n.to)} aria-current={n.active ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
      </nav>
      <div class="topbar-tools">
        {s.orgs.length > 1 && (
          <select
            class="org"
            aria-label="Organisation"
            value={s.orgId ?? ""}
            onChange={(e) => {
              selectOrg(e.currentTarget.value);
              navigate(href(homeRoute()));
            }}
          >
            {s.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <Link to={href("orgs")} class="btn small ghost" aria-current={section === "orgs" ? "page" : undefined}>
          {s.orgs.length > 1 ? "Organisationen" : (currentOrg()?.name ?? "Organisation")}
        </Link>
        <button
          type="button"
          class="btn small"
          aria-label={mode === "night" ? "Tag-Thema einschalten" : "Nacht-Thema einschalten"}
          title={mode === "night" ? "Tag-Thema" : "Nacht-Thema"}
          onClick={() => setTheme(mode === "night" ? "day" : "night")}
        >
          <Icon name={mode === "night" ? "sun" : "moon"} />
        </button>
        <Link
          to={href("settings")}
          class="btn small settings-link"
          aria-current={section === "settings" ? "page" : undefined}
          aria-label={dot ? "Einstellungen, Update verfügbar" : "Einstellungen"}
          title="Einstellungen"
        >
          <Icon name="gear" />
          {dot && <span class="hint-dot" aria-hidden="true" />}
        </Link>
        <Link to={href("account")} class="btn small" aria-current={section === "account" ? "page" : undefined} title="Konto">
          {s.user?.name ?? "Konto"}
        </Link>
        <button type="button" class="btn small" onClick={() => void signOut()}>
          Abmelden
        </button>
      </div>
    </header>
  );
}

/** Band für alle, wenn der Server seit dem Laden eine andere Version hat. Neu lädt nur der Nutzer selbst. */
function VersionBand() {
  const next = newerVersion(useStore(versionNotice));
  if (!next) return null;
  return (
    <div class="version-band" role="status">
      <span>Lykora wurde aktualisiert ({buildLabel(next)}). Neu laden, um die neue Version zu nutzen.</span>
      <span class="row nowrap">
        <button type="button" class="btn small primary" onClick={() => window.location.reload()}>
          Neu laden
        </button>
        <button type="button" class="btn small ghost" aria-label="Hinweis ausblenden" onClick={dismissVersion}>
          <Icon name="x" />
        </button>
      </span>
    </div>
  );
}

export function App() {
  const s = useStore(session);
  const loc = useLocation();
  const match = matchRoute(loc.path);
  const signedIn = !!s.token && !!s.user;

  // Versionshinweis: Version beim Laden merken, alle 5 Minuten und nach jedem Wiederverbinden prüfen.
  useEffect(() => {
    if (!signedIn) return;
    return watchVersion(() => api.version(), { onReconnect: onLiveReconnect });
  }, [signedIn]);

  useEffect(() => {
    if (!s.ready || match?.name === "join") return;
    if (!signedIn && match?.name !== "login") {
      const back = loc.path !== "/" ? loc.path + (loc.query.toString() ? `?${loc.query}` : "") : undefined;
      navigate(href("login", {}, { weiter: back }), { replace: true });
    } else if (signedIn && (match?.name === "login" || match?.name === "home")) {
      const next = loc.query.get("weiter");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : href(homeRoute()), { replace: true });
    } else if (signedIn && !s.orgs.length && match?.name !== "orgs" && match?.name !== "account" && match?.name !== "settings") {
      navigate(href("orgs"), { replace: true });
    }
  }, [s.ready, signedIn, match?.name, s.orgs.length]);

  // Ohne Server bleibt die gespeicherte Anmeldung; sobald er wieder antwortet, geht es weiter.
  useEffect(() => {
    if (!s.offline) return;
    const retry = () => void restoreSession();
    const timer = setInterval(retry, 10_000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [s.offline]);

  // Die Spieler-Landeseite braucht keine Anmeldung.
  if (match?.name === "join") return <JoinPage code={match.params.code!} />;
  if (!s.ready && s.offline) {
    return (
      <main class="page narrow stack">
        <h1>Lykora</h1>
        <ErrorNotice error={new Error(`${s.offline} Die Anmeldung bleibt gespeichert; neuer Versuch alle 10 Sekunden.`)} retry={() => void restoreSession()} />
      </main>
    );
  }
  if (!s.ready) return <Loading text="Verbinde …" />;
  if (!signedIn || match?.name === "login") {
    return (
      <>
        <LoginPage />
        <Toasts />
      </>
    );
  }
  return (
    <div class={`shell${match?.name === "control" ? " fill" : ""}`}>
      <a class="sr-only" href="#inhalt">
        Zum Inhalt
      </a>
      <TopBar match={match} />
      <VersionBand />
      <main id="inhalt" class="main">
        {match && match.name !== "home" ? <Page match={match} /> : match ? <Loading /> : <NotFound />}
      </main>
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
