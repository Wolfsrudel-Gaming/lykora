/**
 * Version und Updates ohne Oberfläche: Texte und Zustände für die Einstellungen, den Punkt am
 * Zahnrad und den Hinweis „Lykora wurde aktualisiert“. Netz und Uhr kommen von außen, damit die
 * Tests alles direkt prüfen können.
 */

import { formatAgo, formatDateTime, formatSpan } from "./format.ts";
import { createStore } from "./store.ts";
import type { UpdateState, UpdateStatus, UpdateTrigger, UpdateWindow, UpdaterState, VersionInfo } from "./types.ts";

const two = (n: number) => String(n).padStart(2, "0");

// Versionen

/** Commit auf 7 Zeichen wie bei GitHub. */
export function shortCommit(commit: string | null | undefined): string {
  return commit ? commit.slice(0, 7) : "";
}

/** Gleicher Commit, auch wenn einer gekürzt ist (wie sameCommit im Server). */
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x));
}

/** Gleiche Version: Haben beide einen Commit, zählt nur der; sonst Laufnummer, Commit und Bauzeit. */
export function sameVersion(a: VersionInfo, b: VersionInfo): boolean {
  if (a.commit && b.commit) return sameCommit(a.commit, b.commit);
  return a.version === b.version && (a.commit ?? null) === (b.commit ?? null) && (a.builtAt ?? null) === (b.builtAt ?? null);
}

/** „Build 57“; ohne Image „Entwicklungsstand“; ohne Laufnummer der Commit. */
export function buildLabel(v: VersionInfo): string {
  if (/^\d+$/.test(v.version)) return `Build ${v.version}`;
  if (v.version === "dev") return "Entwicklungsstand";
  if (v.version && v.version !== "?") return v.version;
  return v.commit ? `Commit ${shortCommit(v.commit)}` : "unbekannte Version";
}

/** Ausführlich: „Build 57 · a1b2c3d · 20.10.2026, 14:03 Uhr“. */
export function versionText(v: VersionInfo): string {
  const label = buildLabel(v);
  const parts = [label];
  if (v.commit && !label.startsWith("Commit")) parts.push(shortCommit(v.commit));
  if (v.builtAt) parts.push(formatDateTime(v.builtAt));
  return parts.join(" · ");
}

// Zeitfenster

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Fehler im Zeitfenster als Satz, sonst null. Über Mitternacht ist erlaubt, z. B. 23:00–05:00. */
export function windowError(from: string, to: string): string | null {
  if (!from || !to) return "Bitte Anfang und Ende angeben.";
  if (!TIME.test(from) || !TIME.test(to)) return "Zeiten bitte als HH:MM angeben, z. B. 03:00.";
  if (from === to) return "Anfang und Ende müssen sich unterscheiden.";
  return null;
}

/** Länge des Fensters in Minuten, auch über Mitternacht. */
export function windowMinutes(w: UpdateWindow): number {
  return (minutesOf(w.to) - minutesOf(w.from) + 1440) % 1440;
}

/** „täglich 03:00–05:00 Uhr (2 Std)“, über Mitternacht mit Hinweis. */
export function windowText(w: UpdateWindow): string {
  const night = minutesOf(w.to) < minutesOf(w.from) ? ", über Mitternacht" : "";
  return `täglich ${w.from}–${w.to} Uhr (${formatSpan(windowMinutes(w) * 60)}${night})`;
}

interface Zoned {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zoned(date: Date, timeZone: string): Zoned {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).formatToParts(date);
  } catch {
    // Unbekannte Zeitzone: dann die des Geräts.
    parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(date);
  }
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

/** Zeitpunkt in der Zeitzone des Servers: „heute um 03:00 Uhr“, „morgen um …“, „am 24.10. um …“. */
export function zonedWhen(iso: string, timeZone: string, now = Date.now()): string {
  const at = zoned(new Date(iso), timeZone);
  const today = zoned(new Date(now), timeZone);
  const days = Math.round((Date.UTC(at.year, at.month - 1, at.day) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000);
  const clock = `${two(at.hour)}:${two(at.minute)} Uhr`;
  if (days === 0) return `heute um ${clock}`;
  if (days === 1) return `morgen um ${clock}`;
  return `am ${two(at.day)}.${two(at.month)}. um ${clock}`;
}

// Zustände

export const UPDATER_STATE_LABELS: Record<UpdaterState, string> = {
  idle: "Bereit",
  pulling: "Lädt die neue Version",
  updating: "Ersetzt den Server-Container",
  restarting: "Wartet auf den neuen Server",
  failed: "Gescheitert",
  rolled_back: "Zurück auf der alten Version",
  unsupported: "Kann dieses Image nicht ziehen",
};

export const UPDATE_STATE_LABELS: Record<UpdateState, string> = {
  running: "Läuft",
  succeeded: "Eingespielt",
  failed: "Gescheitert",
  rolled_back: "Zurückgerollt",
};

export const TRIGGER_LABELS: Record<UpdateTrigger, string> = {
  auto: "Automatisch",
  manual: "Von Hand",
};

/** Gescheiterte Versionen versucht der Server automatisch erst nach dieser Pause erneut. */
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60_000;

/** Ein Auftrag ist offen oder ein Eintrag im Verlauf noch nicht abgeschlossen. */
export function updateRunning(status: UpdateStatus): boolean {
  return !!status.pending || status.history.some((h) => h.state === "running");
}

export type UpdateKind = "not_configured" | "in_progress" | "available" | "check_failed" | "up_to_date" | "unchecked";

export interface UpdateView {
  kind: UpdateKind;
  title: string;
  detail: string | null;
  /** Rahmen der Notiz */
  tone: "ok" | "warn" | "info";
  /** Was zu tun ist, wenn der Server selbst nicht weiterkommt */
  hint: string | null;
  /** Warum „Jetzt aktualisieren“ gerade nicht geht */
  applyBlocked: string | null;
  /** Was das automatische Update aufhält oder wann es kommt */
  waiting: string | null;
}

/** Das Paket auf ghcr.io ist nach dem ersten Lauf der CI privat, bis es jemand einmal freigibt. */
const GHCR_PRIVATE_HINT =
  "Das Paket auf ghcr.io ist nach dem ersten Lauf der CI privat: Auf GitHub unter Packages → lykora → Package settings → " +
  "„Change visibility“ einmal auf Public stellen. Oder in .env LYKORA_REGISTRY_USER und LYKORA_REGISTRY_TOKEN " +
  "(Token mit read:packages) setzen und docker compose up -d ausführen.";

/** Was die Einstellungen oben zum Stand der Updates sagen. */
export function updateView(status: UpdateStatus, now = Date.now()): UpdateView {
  const checked = status.lastCheckAt ? `Zuletzt geprüft ${formatAgo(status.lastCheckAt, now)}.` : null;
  const plain = { hint: null, applyBlocked: null, waiting: null };
  if (!status.configured) {
    // Mit Image, aber ohne Registry: lokal gebaut; der Server sagt das selbst in checkError.
    return status.image
      ? { kind: "not_configured", title: "Keine Updates für ein lokal gebautes Image", detail: status.checkError, tone: "warn", ...plain }
      : {
          kind: "not_configured",
          title: "Updates sind nicht eingerichtet",
          detail: "Der Server kennt kein Image, unter dem neue Versionen erscheinen: LYKORA_IMAGE ist leer.",
          tone: "warn",
          ...plain,
        };
  }
  if (updateRunning(status)) {
    const to = status.pending?.to ?? status.history.find((h) => h.state === "running")?.to;
    return { kind: "in_progress", title: to ? `Update auf ${buildLabel(to)} läuft` : "Update läuft", detail: null, tone: "info", ...plain };
  }
  const available = status.available;
  if (available) {
    return {
      kind: "available",
      title: `Neue Version: ${buildLabel(available)}`,
      detail: [available.builtAt ? `Gebaut am ${formatDateTime(available.builtAt)}.` : null, checked].filter(Boolean).join(" ") || null,
      tone: "info",
      hint: null,
      applyBlocked: applyBlocked(status),
      waiting: autoWaiting(status, now),
    };
  }
  if (status.checkError) {
    const reason = status.checkError.replace(/^Prüfung fehlgeschlagen:\s*/, "");
    const notPublic = /nicht öffentlich/.test(reason) && !!status.image?.startsWith("ghcr.io/");
    return {
      kind: "check_failed",
      title: "Prüfung fehlgeschlagen",
      detail: [`${reason.replace(/\.$/, "")}.`, checked].filter(Boolean).join(" "),
      tone: "warn",
      ...plain,
      hint: notPublic ? GHCR_PRIVATE_HINT : null,
    };
  }
  if (status.upToDate) return { kind: "up_to_date", title: "Lykora ist aktuell", detail: checked, tone: "ok", ...plain };
  return { kind: "unchecked", title: "Noch nicht geprüft", detail: "Der Server sieht regelmäßig nach; „Jetzt prüfen“ fragt sofort.", tone: "info", ...plain };
}

function applyBlocked(status: UpdateStatus): string | null {
  if (status.blockedBy?.reason === "event_running") return "Während eines Events wird nicht aktualisiert.";
  if (!status.updater.connected) return "Der Updater meldet sich nicht; ohne ihn kann sich der Server nicht selbst aktualisieren.";
  return null;
}

function autoWaiting(status: UpdateStatus, now: number): string {
  if (!status.settings.auto) return "Automatische Updates sind aus. „Jetzt aktualisieren“ spielt die Version sofort ein.";
  const blocked = status.blockedBy;
  if (blocked?.reason === "event_running") return "Das automatische Update wartet, bis kein Event mehr läuft.";
  if (blocked?.reason === "outside_window") return `Das automatische Update wartet auf das Zeitfenster: ${zonedWhen(blocked.nextWindowAt, status.timezone, now)}.`;
  if (!status.updater.connected) return "Das automatische Update wartet auf den Updater.";
  const failed = status.history.find(
    (h) =>
      (h.state === "failed" || h.state === "rolled_back") &&
      sameCommit(h.to.commit, status.available?.commit) &&
      !!h.finishedAt &&
      now - Date.parse(h.finishedAt) < RETRY_FAILED_AFTER_MS,
  );
  if (failed) return "Diese Version ist vorhin gescheitert; automatisch erst 6 Stunden danach wieder. „Jetzt aktualisieren“ versucht es sofort.";
  return "Wird automatisch eingespielt, sobald der Updater das nächste Mal fragt (etwa jede Minute).";
}

/** Antwort auf eine Absage (409) von „Jetzt aktualisieren“. */
export function applyRefusal(code: string, message: string): string {
  switch (code) {
    case "event_running":
      return "Während eines Events wird nicht aktualisiert, auch nicht von Hand. Nach dem Ende des Events geht es.";
    case "updater_offline":
      return "Der Updater meldet sich nicht. Ohne ihn kann sich der Server nicht selbst aktualisieren; Einrichtung siehe „Updater“.";
    case "up_to_date":
      return "Es ist keine neuere Version bekannt. „Jetzt prüfen“ sieht in der Registry nach.";
    case "not_configured":
      return "Updates sind nicht eingerichtet: LYKORA_IMAGE fehlt.";
    default:
      return message;
  }
}

/** Server gerade weg, etwa beim Neustart: kein Netz (0) oder der Proxy davor findet ihn nicht (502–504). */
export function serverAway(httpStatus: number): boolean {
  return httpStatus === 0 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
}

// Fortschritt eines Updates

export const STEPS = ["Beauftragt", "Neue Version laden", "Server ersetzen", "Neustart und Prüfung"] as const;

const STEP_OF: Partial<Record<UpdaterState, number>> = { pulling: 1, updating: 2, restarting: 3 };

/** Beobachtung eines Updates aus Sicht der Seite; übersteht den Neustart des Servers. */
export interface Track {
  /** Version vor dem Update */
  from: VersionInfo;
  /** Eintrag im Verlauf, sobald der Server ihn angelegt hat */
  entryId: string | null;
  /** Weitester erreichter Schritt in STEPS */
  step: number;
  startedAt: number;
}

export function startTrack(status: UpdateStatus, now = Date.now()): Track {
  return followTrack({ from: status.current, entryId: null, step: 0, startedAt: now }, status, true);
}

/**
 * Nächster Stand der Beobachtung. Schritte gehen nie zurück: Der neu gestartete Server weiß nichts
 * mehr vom Zustand des Updaters, und ist er weg, steckt das Update im Neustart.
 */
export function followTrack(track: Track, status: UpdateStatus | null, reachable: boolean): Track {
  const entryId = track.entryId ?? status?.history.find((h) => h.state === "running")?.id ?? null;
  const step = !reachable || !status ? 3 : (STEP_OF[status.updater.state ?? "idle"] ?? 0);
  return { ...track, entryId, step: Math.max(track.step, step) };
}

export type Stage = "requested" | "pulling" | "updating" | "restarting" | "succeeded" | "failed" | "rolled_back" | "stopped";

export interface Progress {
  stage: Stage;
  /** Index in STEPS; STEPS.length heißt fertig */
  step: number;
  /** Ergebnis steht fest, nicht mehr fragen */
  done: boolean;
  title: string;
  detail: string | null;
}

/** Dauert es länger, hilft ein Blick in die Ausgabe des Updaters. */
const SLOW_MS = 10 * 60_000;

export function trackProgress(track: Track, status: UpdateStatus | null, reachable: boolean, now = Date.now()): Progress {
  const slow = now - track.startedAt > SLOW_MS ? " Das dauert länger als üblich; auf dem Server zeigt docker compose logs updater, was er gerade tut." : "";
  if (!reachable || !status) {
    return {
      stage: "restarting",
      step: 3,
      done: false,
      title: "Server startet neu …",
      detail: `Dabei ist er kurz nicht erreichbar. Die Seite fragt alle 3 Sekunden und macht von selbst weiter.${slow}`,
    };
  }
  const entry = track.entryId ? status.history.find((h) => h.id === track.entryId) : undefined;
  if (!sameVersion(track.from, status.current) || entry?.state === "succeeded") {
    return {
      stage: "succeeded",
      step: STEPS.length,
      done: true,
      title: `Update eingespielt: ${buildLabel(status.current)}`,
      detail: "Neu laden, um auch das neue Dashboard zu nutzen.",
    };
  }
  if (entry?.state === "rolled_back") {
    return {
      stage: "rolled_back",
      step: track.step,
      done: true,
      title: "Zurück auf der alten Version",
      detail: entry.message ?? "Die neue Version ist nicht gesund gestartet; der Server läuft weiter mit der bisherigen.",
    };
  }
  if (entry?.state === "failed") return { stage: "failed", step: track.step, done: true, title: "Update gescheitert", detail: entry.message };
  const updater = status.updater;
  if (updater.state === "unsupported") return { stage: "failed", step: track.step, done: true, title: "Update nicht möglich", detail: updater.message };
  if (!status.pending && entry?.state !== "running") {
    const failed = updater.state === "failed" || updater.state === "rolled_back";
    return {
      stage: failed ? "failed" : "stopped",
      step: track.step,
      done: true,
      title: failed ? "Update gescheitert" : "Kein Update mehr offen",
      detail: updater.message,
    };
  }
  switch (track.step) {
    case 0:
      return {
        stage: "requested",
        step: 0,
        done: false,
        title: "Wartet auf den Updater …",
        detail: `Er holt den Auftrag bei seiner nächsten Frage ab, meist innerhalb einer Minute.${slow}`,
      };
    case 1:
      return { stage: "pulling", step: 1, done: false, title: "Lädt die neue Version …", detail: `Je nach Leitung dauert das ein paar Minuten.${slow}` };
    case 2:
      return { stage: "updating", step: 2, done: false, title: "Ersetzt den Server-Container …", detail: `Gleich ist der Server kurz nicht erreichbar.${slow}` };
    default:
      return {
        stage: "restarting",
        step: 3,
        done: false,
        title: "Server startet neu …",
        detail: `Die neue Version muss sich gesund melden, sonst geht es zurück auf die alte.${slow}`,
      };
  }
}

// Punkt am Zahnrad

export const HINT_EVERY_MS = 10 * 60_000;

/** Für Admins der Instanz: Eine neue Version ist da. */
export const updateHint = createStore<{ available: boolean; at: number }>({ available: false, at: 0 });

export function noteUpdateStatus(status: UpdateStatus, now = Date.now()): void {
  updateHint.set({ available: !!status.available, at: now });
}

/** Beim Abmelden: Der nächste Nutzer im selben Tab erbt weder Punkt noch Wartezeit. */
export function resetUpdateHint(): void {
  updateHint.set({ available: false, at: 0 });
}

/** Fragt höchstens alle 10 Minuten; ein Fehlschlag zählt mit, damit ein gestörter Server Ruhe hat. */
export async function refreshUpdateHint(load: () => Promise<UpdateStatus>, now = Date.now()): Promise<void> {
  const { at } = updateHint.get();
  if (at && now - at < HINT_EVERY_MS) return;
  updateHint.set({ at: now });
  try {
    noteUpdateStatus(await load(), now);
  } catch {
    // Lieber kein Punkt als ein falscher.
  }
}

// Hinweis auf eine neue Version für alle

export const VERSION_EVERY_MS = 5 * 60_000;

export interface VersionNotice {
  /** Version beim Laden der Seite */
  loaded: VersionInfo | null;
  /** Version des Servers jetzt */
  current: VersionInfo | null;
  /** Weggeklickt für diese Version */
  dismissed: VersionInfo | null;
}

export const versionNotice = createStore<VersionNotice>({ loaded: null, current: null, dismissed: null });

/** Die erste bekannte Version gilt als die geladene. */
export function noteVersion(v: VersionInfo): void {
  versionNotice.set((s) => (s.loaded ? { current: v } : { loaded: v, current: v }));
}

/** Neue Version, für die das Band stehen soll; null, wenn alles passt oder es weggeklickt ist. */
export function newerVersion(s: VersionNotice): VersionInfo | null {
  if (!s.loaded || !s.current || sameVersion(s.loaded, s.current)) return null;
  if (s.dismissed && sameVersion(s.dismissed, s.current)) return null;
  return s.current;
}

export function dismissVersion(): void {
  versionNotice.set((s) => ({ dismissed: s.current }));
}

/**
 * Prüft gleich, alle 5 Minuten und nach jedem Neuaufbau einer Live-Verbindung, ob der Server eine
 * andere Version hat als beim Laden. Neu lädt nur der Nutzer selbst: Der Leitstand kann gerade in
 * Gebrauch sein.
 */
export function watchVersion(
  load: () => Promise<VersionInfo>,
  opts: { every?: number; onReconnect?: (fn: () => void) => () => void } = {},
): () => void {
  let stopped = false;
  const check = () =>
    void load().then(
      (v) => {
        if (!stopped) noteVersion(v);
      },
      () => undefined,
    );
  check();
  const timer = setInterval(check, opts.every ?? VERSION_EVERY_MS);
  const off = opts.onReconnect?.(check);
  return () => {
    stopped = true;
    clearInterval(timer);
    off?.();
  };
}
