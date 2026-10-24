/**
 * Kleiner Router über die History-API, relativ zum Basispfad. Seitenpfade sind deutsch;
 * /join/:code ist fest, weil der Server diese Adresse in den Einstiegs-QR schreibt.
 */

import { base, pagePath, routeOf } from "./base.ts";
import { createStore, useStore } from "./store.ts";

export const ROUTES = {
  login: "/anmelden",
  home: "/",
  orgs: "/organisation",
  events: "/events",
  eventNew: "/events/neu",
  event: "/events/:eventId",
  control: "/events/:eventId/leitstand",
  supervisor: "/events/:eventId/betreuer",
  games: "/spiele",
  // Baukasten: feste Pfade vor Parameter-Pfaden, matchRoute nimmt den ersten Treffer.
  gameNew: "/spiele/neu",
  game: "/spiele/:gameId",
  gameMedia: "/spiele/:gameId/medien",
  gameSound: "/spiele/:gameId/klang",
  gameMaterials: "/spiele/:gameId/material",
  onSite: "/spiele/:gameId/vor-ort",
  editorStation: "/spiele/:gameId/baukasten/stationen/:stationId",
  editorSection: "/spiele/:gameId/baukasten/:section",
  editor: "/spiele/:gameId/baukasten",
  members: "/mitglieder",
  account: "/konto",
  settings: "/einstellungen",
  join: "/join/:code",
  // Entwurfsseite: alle Bausteine in allen Zuständen; ohne Anmeldung, nicht in der Navigation
  design: "/_design",
} as const;

export type RouteName = keyof typeof ROUTES;

export interface Match {
  name: RouteName;
  params: Record<string, string>;
}

function compile(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((part) => (part.startsWith(":") ? `(?<${part.slice(1)}>[^/]+)` : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}/?$`);
}

const compiled = (Object.entries(ROUTES) as [RouteName, string][]).map(([name, pattern]) => ({ name, re: compile(pattern) }));

export function matchRoute(path: string): Match | null {
  for (const { name, re } of compiled) {
    const m = re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.groups ?? {})) params[k] = decodeURIComponent(v);
      return { name, params };
    }
  }
  return null;
}

/** Pfad zu einer Route mit Parametern, z. B. href("control", {eventId}). */
export function href(name: RouteName, params: Record<string, string> = {}, query?: Record<string, string | undefined>): string {
  const path = ROUTES[name].replace(/:([a-zA-Z]+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ""));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

interface Location {
  path: string;
  query: URLSearchParams;
}

function readLocation(): Location {
  return { path: routeOf(base(), window.location.pathname) ?? "/", query: new URLSearchParams(window.location.search) };
}

export const location = createStore<Location>({ path: "/", query: new URLSearchParams() });

export function startRouter(): void {
  location.set(readLocation());
  window.addEventListener("popstate", () => location.set(readLocation()));
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const url = pagePath(base(), to);
  if (opts.replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  location.set(readLocation());
  if (!opts.replace) window.scrollTo(0, 0);
}

/** Ändert nur Suchparameter der aktuellen Seite, ohne neuen Verlaufseintrag. */
export function setQuery(patch: Record<string, string | null>): void {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  location.set(readLocation());
}

export function useLocation(): Location {
  return useStore(location);
}
