/**
 * Daten des Leitstands: Überblick, Funk, SOS und Logbuch, live über den WebSocket.
 * Live-Ereignisse lösen gezieltes Nachladen aus, damit alle Ansichten dasselbe Format sehen;
 * nur Positionen werden direkt eingetragen. Nach einem Neuaufbau der Verbindung lädt der
 * Leitstand alles nach, weil in der Lücke Ereignisse gefehlt haben können.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "../../lib/api.ts";
import { base, wsUrl } from "../../lib/base.ts";
import { LiveConnection, type LiveState } from "../../lib/live.ts";
import { can } from "../../lib/roles.ts";
import { api, roleIn, session } from "../../lib/session.ts";
import type { EventDto, Game, LiveEvent, LogEntry, Message, OverviewTeam, Role, Sos, TrackPoint, Warning } from "../../lib/types.ts";

export interface ControlState {
  event: EventDto | null;
  role: Role | undefined;
  game: Game | null;
  teams: OverviewTeam[];
  warnings: Warning[];
  messages: Message[];
  sos: Sos[];
  log: LogEntry[];
  live: LiveState;
  error: unknown;
  /** Zählt bei jeder Änderung an Teams hoch; Team-Detail und Rangliste laden dann nach. */
  teamTick: number;
  /** Zählt bei neuen Uploads hoch; Prüfungen laden dann Fotos nach. */
  uploadTick: number;
}

const PAGE = 500;
const KEEP_LOG = 2000;

/** Lädt alle Seiten einer „after“-Liste nach (Nachrichten, Logbuch). */
async function pages<T extends { id: number }>(fetchPage: (after: number) => Promise<T[]>, after: number, limit = PAGE, max = 10): Promise<T[]> {
  const out: T[] = [];
  let cursor = after;
  for (let i = 0; i < max; i++) {
    const page = await fetchPage(cursor);
    out.push(...page);
    if (page.length < limit) break;
    cursor = page[page.length - 1]!.id;
  }
  return out;
}

export function useControl(eventId: string) {
  const [state, setState] = useState<ControlState>({
    event: null,
    role: undefined,
    game: null,
    teams: [],
    warnings: [],
    messages: [],
    sos: [],
    log: [],
    live: "connecting",
    error: null,
    teamTick: 0,
    uploadTick: 0,
  });
  const ref = useRef(state);
  ref.current = state;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const patch = (p: Partial<ControlState> | ((s: ControlState) => Partial<ControlState>)) =>
    setState((s) => {
      const next = { ...s, ...(typeof p === "function" ? p(s) : p) };
      ref.current = next;
      return next;
    });

  // Mehrere Ereignisse kurz hintereinander lösen nur ein Nachladen aus.
  const debounce = (key: string, fn: () => Promise<void>, ms = 300) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => void fn().catch((err) => patch({ error: err })), ms);
  };

  const loadOverview = async () => {
    const o = await api.overview(eventId);
    patch((s) => ({ event: o.event, role: roleIn(o.event.orgId), teams: o.teams, warnings: o.warnings, error: null, teamTick: s.teamTick + 1 }));
    return o.event;
  };

  const loadMessages = async () => {
    const after = ref.current.messages.at(-1)?.id ?? 0;
    const fresh = await pages((a) => api.messages(eventId, a), after);
    if (fresh.length) patch((s) => ({ messages: [...s.messages, ...fresh.filter((m) => !s.messages.some((x) => x.id === m.id))] }));
  };

  const loadLog = async () => {
    const after = ref.current.log.at(-1)?.id ?? 0;
    const fresh = await pages((a) => api.log(eventId, a, PAGE), after);
    if (fresh.length) patch((s) => ({ log: [...s.log, ...fresh.filter((e) => e.id > (s.log.at(-1)?.id ?? 0))].slice(-KEEP_LOG) }));
  };

  const loadSos = async () => {
    patch({ sos: await api.sos(eventId) });
  };

  const loadAll = async () => {
    try {
      const event = await loadOverview();
      const role = roleIn(event.orgId);
      await Promise.all([
        loadMessages(),
        loadLog(),
        loadSos(),
        // Das Spiel mit Lösungen gibt der Server nur an Rollen mit Prüfrecht.
        !ref.current.game && can(role, "event.review") ? api.eventGame(eventId).then((game) => patch({ game })) : Promise.resolve(),
      ]);
    } catch (err) {
      patch({ error: err });
    }
  };

  const trackListeners = useRef(new Set<(teamId: string, p: TrackPoint) => void>()).current;

  const onEvent = (e: LiveEvent) => {
    const data = (e.data ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "position": {
        const teamId = data.teamId as string;
        patch((s) => ({
          teams: s.teams.map((t) =>
            t.id === teamId
              ? { ...t, position: { lat: data.lat as number, lon: data.lon as number, accuracy: (data.accuracy as number | undefined) ?? null, at: (data.at as string) ?? e.at ?? null } }
              : t,
          ),
        }));
        trackListeners.forEach((fn) => fn(teamId, { lat: data.lat as number, lon: data.lon as number, accuracy: (data.accuracy as number | undefined) ?? null, recorded_at: (data.at as string) ?? new Date().toISOString() }));
        break;
      }
      case "message":
        debounce("messages", loadMessages, 150);
        break;
      case "sos":
        debounce("sos", loadSos, 50);
        debounce("overview", async () => void (await loadOverview()), 300);
        break;
      case "upload":
        patch((s) => ({ uploadTick: s.uploadTick + 1 }));
        break;
      case "log":
        debounce("log", loadLog, 250);
        break;
      case "status":
      case "team_joined":
        debounce("overview", async () => void (await loadOverview()), 50);
        break;
      case "team":
        debounce("overview", async () => void (await loadOverview()), 400);
        break;
    }
  };

  useEffect(() => {
    void loadAll();
    const token = session.get().token ?? "";
    const conn = new LiveConnection({
      url: () => wsUrl(base(), `/events/${eventId}/live`, session.get().token ?? token),
      onEvent,
      onState: (live, reconnected) => {
        patch({ live });
        if (reconnected) void loadAll();
        // Abgelehnt heißt meist: Sitzung abgelaufen oder Recht entzogen. Die API sagt, was genau;
        // bei 401 geht es von dort zur Anmeldung.
        if (live === "denied") void loadOverview().catch((err) => patch({ error: err }));
      },
    });
    conn.start();
    // Warnungen hängen auch an der Zeit (z. B. „seit 20 Min ohne Kontakt“).
    const refresh = setInterval(() => void loadOverview().catch(() => undefined), 30_000);
    return () => {
      conn.stop();
      clearInterval(refresh);
      for (const t of Object.values(timers.current)) clearTimeout(t);
    };
  }, [eventId]);

  return {
    state,
    reload: loadAll,
    reloadOverview: () => loadOverview().then(() => undefined),
    reloadMessages: loadMessages,
    reloadSos: loadSos,
    /** Neue Positionen für die Laufspur eines Teams abonnieren */
    onTrack: (fn: (teamId: string, p: TrackPoint) => void) => {
      trackListeners.add(fn);
      return () => trackListeners.delete(fn);
    },
    setEvent: (event: EventDto) => patch({ event }),
  };
}

export type Control = ReturnType<typeof useControl>;

/** Fehler beim Laden, die einen Neuversuch nicht lohnen (kein Recht, Event weg). */
export function isFatal(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 404);
}
