/**
 * Adressen relativ zum Basispfad. index.html enthält <base href="/__LYKORA_BASE__/">;
 * der Server ersetzt den Platzhalter durch seinen BASE_PATH, z. B. /lykora/.
 * Daraus ergeben sich Seiten-, API-, WebSocket- und Medienadressen.
 */

export const BASE_PLACEHOLDER = "/__LYKORA_BASE__/";

export interface Base {
  /** Schema, Host und Port, z. B. https://riegel-troisdorf.de */
  origin: string;
  /** Basispfad mit Schrägstrich am Ende, z. B. "/lykora/" oder "/" */
  path: string;
  /** API-Wurzel ohne Schrägstrich am Ende, z. B. "/lykora/api" */
  api: string;
}

export function resolveBase(baseURI: string): Base {
  const url = new URL(baseURI);
  let path = url.pathname;
  // Ohne Server (z. B. Datei direkt geöffnet) bleibt der Platzhalter stehen.
  if (path.startsWith(BASE_PLACEHOLDER)) path = "/";
  if (!path.endsWith("/")) path = path.slice(0, path.lastIndexOf("/") + 1);
  return { origin: url.origin, path, api: `${path}api` };
}

/** Seitenadresse zu einem App-Pfad wie "/events/123". */
export function pagePath(base: Base, route: string): string {
  return base.path + route.replace(/^\/+/, "");
}

/** App-Pfad aus der Adresse im Browser; außerhalb des Basispfads null. */
export function routeOf(base: Base, pathname: string): string | null {
  const root = base.path.replace(/\/$/, "");
  if (pathname === root) return "/";
  if (!pathname.startsWith(base.path)) return null;
  return `/${pathname.slice(base.path.length)}`;
}

export function apiUrl(base: Base, path: string): string {
  return `${base.api}${path.startsWith("/") ? path : `/${path}`}`;
}

export function wsUrl(base: Base, path: string, token: string): string {
  const origin = base.origin.replace(/^http/, "ws");
  const sep = path.includes("?") ? "&" : "?";
  return `${origin}${apiUrl(base, path)}${sep}access_token=${encodeURIComponent(token)}`;
}

/** Adresse einer Mediendatei aus media[].src; URLs bleiben, relative Pfade hängen am Basispfad. */
export function mediaUrl(base: Base, src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return base.path + src.replace(/^\/+/, "");
}

/** Öffentliche Server-Adresse inklusive Basispfad ohne Schrägstrich, wie PUBLIC_URL. */
export function serverUrl(base: Base): string {
  return (base.origin + base.path).replace(/\/+$/, "");
}

/** Inhalt des Einstiegs-QR, gleich aufgebaut wie im Server (routes/events.ts joinInfo). */
export function appJoinLink(server: string, code: string): string {
  return `lykora://join?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}`;
}

let current: Base | undefined;

/** Basis der laufenden Seite. */
export function base(): Base {
  return (current ??= resolveBase(document.baseURI));
}
