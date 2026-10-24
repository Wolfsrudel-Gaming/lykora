/** Anmeldung, gewählte Organisation, Thema und Meldungen: der globale Zustand des Dashboards. */

import { Api, ApiError } from "./api.ts";
import { base } from "./base.ts";
import { href, location, navigate } from "./router.ts";
import { load, save } from "./storage.ts";
import { parseTheme, prefersLight, resolveTheme, themeColor, watchSystemTheme, type ResolvedTheme, type Theme } from "./theme.ts";
import { createStore } from "./store.ts";
import type { OrgMembership, Role, User } from "./types.ts";
import { resetUpdateHint } from "./update.ts";

export interface Session {
  token: string | null;
  user: User | null;
  orgs: OrgMembership[];
  orgId: string | null;
  /** Admin der Instanz: sieht „Server und Updates“ in den Einstellungen */
  instanceAdmin: boolean;
  /** Gespeicherte Anmeldung ist geprüft */
  ready: boolean;
  /** Prüfung der gespeicherten Anmeldung gescheitert, ohne dass sie ungültig wäre (z. B. kein Netz) */
  offline: string | null;
}

export const session = createStore<Session>({ token: load("token"), user: null, orgs: [], orgId: load("org"), instanceAdmin: false, ready: false, offline: null });

export const api = new Api({
  root: base().api,
  token: () => session.get().token,
  onUnauthorized: () => {
    if (session.get().token) void signOut({ expired: true });
  },
});

function applyOrgs(orgs: OrgMembership[]): string | null {
  const stored = session.get().orgId;
  const orgId = orgs.some((o) => o.id === stored) ? stored : (orgs[0]?.id ?? null);
  save("org", orgId);
  return orgId;
}

/**
 * Prüft die gespeicherte Anmeldung beim Start. Nur eine Absage des Servers (401) verwirft sie;
 * ist der Server gerade nicht erreichbar, bleibt sie für den nächsten Versuch erhalten.
 */
export async function restoreSession(): Promise<void> {
  if (!session.get().token) return session.set({ ready: true, offline: null });
  try {
    const me = await api.me();
    session.set({
      user: { id: me.id, email: me.email, name: me.name },
      orgs: me.orgs,
      orgId: applyOrgs(me.orgs),
      instanceAdmin: me.instanceAdmin === true,
      ready: true,
      offline: null,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      save("token", null);
      session.set({ token: null, user: null, orgs: [], ready: true, offline: null });
    } else {
      session.set({ ready: false, offline: errorText(err) });
    }
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const result = await api.login(email, password);
  save("token", result.token);
  session.set({ token: result.token });
  const me = await api.me();
  session.set({ user: result.user, orgs: me.orgs, orgId: applyOrgs(me.orgs), instanceAdmin: me.instanceAdmin === true, ready: true, offline: null });
}

export async function signOut(opts: { expired?: boolean } = {}): Promise<void> {
  if (!opts.expired) await api.logout().catch(() => undefined);
  save("token", null);
  session.set({ token: null, user: null, orgs: [], instanceAdmin: false });
  resetUpdateHint();
  if (opts.expired) {
    notify("Sitzung abgelaufen. Bitte neu anmelden.", "warn");
    // Nach der neuen Anmeldung geht es auf derselben Seite weiter, z. B. im Leitstand.
    const { path, query } = location.get();
    const back = path !== "/" && path !== href("login") ? path + (query.toString() ? `?${query}` : "") : undefined;
    navigate(href("login", {}, { weiter: back }), { replace: true });
  } else {
    navigate(href("login"), { replace: true });
  }
}

export async function refreshOrgs(): Promise<void> {
  const orgs = await api.orgs();
  session.set({ orgs, orgId: applyOrgs(orgs) });
}

export function selectOrg(orgId: string): void {
  save("org", orgId);
  session.set({ orgId });
}

export function roleIn(orgId: string | null | undefined): Role | undefined {
  return session.get().orgs.find((o) => o.id === orgId)?.role;
}

export function currentOrg(): OrgMembership | undefined {
  const { orgs, orgId } = session.get();
  return orgs.find((o) => o.id === orgId);
}

// Thema

export type { Theme } from "./theme.ts";

export const theme = createStore<{ value: Theme; resolved: ResolvedTheme }>(initialTheme());

function initialTheme(): { value: Theme; resolved: ResolvedTheme } {
  const value = parseTheme(load("theme"));
  return { value, resolved: resolveTheme(value, prefersLight()) };
}

/** Thema an die Seite hängen: data-theme (auch „system“, das CSS folgt dem Gerät) und die Farbe der Browserleiste. */
function applyTheme(value: Theme, resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor(resolved));
}

export function setTheme(value: Theme): void {
  save("theme", value);
  const resolved = resolveTheme(value, prefersLight());
  applyTheme(value, resolved);
  theme.set({ value, resolved });
}

// Das Vorab-Skript in index.html setzt das Thema schon vor dem ersten Zeichnen; fehlt es (alte Seite im Cache), holt das hier nach.
if (typeof document !== "undefined" && document.documentElement?.dataset && document.documentElement.dataset.theme !== theme.get().value) {
  applyTheme(theme.get().value, theme.get().resolved);
}

// Bei „System“ folgt die Seite einem Wechsel des Geräts, ohne neu zu laden.
watchSystemTheme((light) => {
  const { value } = theme.get();
  if (value !== "system") return;
  const resolved = resolveTheme(value, light);
  applyTheme(value, resolved);
  theme.set({ resolved });
});

// Meldungen am Bildschirmrand

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "warn" | "error";
  /** Fett davor, optional */
  title?: string;
  /** Eine Aktion rechts, z. B. „Rückgängig“; schließt die Meldung danach */
  action?: { label: string; onClick: () => void };
  /** Anzeigedauer in ms; null bleibt, bis die Meldung geschlossen wird (Fehler) */
  duration: number | null;
}

export interface NotifyOptions {
  title?: string;
  action?: Toast["action"];
  /** ms; null = bleibt stehen. Standard: 4 s Info/Erfolg, 8 s Warnung, Fehler bleiben. */
  duration?: number | null;
}

export const toasts = createStore<{ list: Toast[] }>({ list: [] });
let toastId = 0;
const timers = new Map<number, { handle: ReturnType<typeof setTimeout> | null; left: number; since: number }>();

export function toastDuration(kind: Toast["kind"]): number | null {
  return kind === "error" ? null : kind === "warn" ? 8000 : 4000;
}

export function notify(text: string, kind: Toast["kind"] = "info", options: NotifyOptions = {}): void {
  const id = ++toastId;
  const duration = options.duration === undefined ? toastDuration(kind) : options.duration;
  // Höchstens drei Meldungen gleichzeitig, damit sie den Leitstand nicht zudecken.
  toasts.set((s) => ({ list: [...s.list.slice(-2), { id, text, kind, title: options.title, action: options.action, duration }] }));
  if (duration !== null) startToastTimer(id, duration);
}

function startToastTimer(id: number, ms: number): void {
  const t = { handle: setTimeout(() => dismiss(id), ms) as ReturnType<typeof setTimeout> | null, left: ms, since: Date.now() };
  timers.set(id, t);
}

/** Beim Überfahren oder Fokussieren: Restzeit anhalten. */
export function pauseToast(id: number): void {
  const t = timers.get(id);
  if (!t || t.handle === null) return;
  clearTimeout(t.handle);
  t.handle = null;
  t.left = Math.max(0, t.left - (Date.now() - t.since));
}

export function resumeToast(id: number): void {
  const t = timers.get(id);
  if (!t || t.handle !== null) return;
  t.since = Date.now();
  t.handle = setTimeout(() => dismiss(id), t.left);
}

export function dismiss(id: number): void {
  const t = timers.get(id);
  if (t?.handle) clearTimeout(t.handle);
  timers.delete(id);
  toasts.set((s) => ({ list: s.list.filter((x) => x.id !== id) }));
}

/** Fehler als Meldung zeigen; liefert die Meldung für Formulare. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
