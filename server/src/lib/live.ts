import type { WebSocket } from "ws";

export interface LiveMessage {
  type: string;
  data: unknown;
}

/** Warum ein Team sofort abgleichen soll. */
export type PokeReason = "message" | "cue" | "status" | "action" | "sos" | "team";

/** Takt der Lebenszeichen; hält Proxys und Mobilfunk-NAT bei ruhigen Verbindungen offen. */
export const PING_INTERVAL_MS = 25_000;

const PING = JSON.stringify({ type: "ping" });

function send(socket: WebSocket, payload: string): void {
  if (socket.readyState === socket.OPEN) socket.send(payload);
}

/**
 * Schließt eine Verbindung, deren Anmeldung gescheitert ist, mit 4000 + HTTP-Status (z. B. 4401).
 * Interne Fehler gehen ins Log und nur als „Interner Fehler“ an den Client.
 */
export function closeWithError(socket: WebSocket, err: any, log: { error(obj: unknown): void }): void {
  const status = typeof err?.statusCode === "number" && err.statusCode < 500 ? err.statusCode : 500;
  if (status === 500) log.error(err);
  let reason = status === 500 ? "Interner Fehler" : String(err.message ?? "");
  // Mehr als 123 Byte lässt das WebSocket-Protokoll im Close-Frame nicht zu.
  while (Buffer.byteLength(reason) > 123) reason = reason.slice(0, -1);
  socket.close(4000 + (status % 1000), reason);
}

/**
 * Verteilt Live-Ereignisse an alle offenen Dashboard-Verbindungen eines Events und stupst die
 * Handys der Teams an, damit sie gleich abgleichen statt erst beim nächsten Takt.
 * Läuft im Prozess; für mehrere Server-Instanzen später über Postgres LISTEN/NOTIFY.
 */
export class LiveHub {
  private readonly subscribers = new Map<string, Set<{ socket: WebSocket; positions: boolean }>>();
  /** Verbindungen der Teams je Event und Team. */
  private readonly teams = new Map<string, Map<string, Set<WebSocket>>>();

  subscribe(eventId: string, socket: WebSocket, positions: boolean): void {
    // Hat der Browser schon während der Anmeldung aufgelegt, käme kein close mehr.
    if (socket.readyState !== socket.OPEN) return;
    let set = this.subscribers.get(eventId);
    if (!set) this.subscribers.set(eventId, (set = new Set()));
    const entry = { socket, positions };
    set.add(entry);
    // Ping-Frames sieht der Browser nicht; sie halten nur die Verbindung durch den Proxy offen.
    const timer = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), PING_INTERVAL_MS).unref();
    socket.on("close", () => {
      clearInterval(timer);
      set!.delete(entry);
      if (set!.size === 0 && this.subscribers.get(eventId) === set) this.subscribers.delete(eventId);
    });
  }

  publish(eventId: string, type: string, data: unknown, opts: { positions?: boolean } = {}): void {
    const set = this.subscribers.get(eventId);
    if (!set) return;
    const payload = JSON.stringify({ type, data, at: new Date().toISOString() });
    for (const { socket, positions } of set) {
      if (opts.positions && !positions) continue;
      send(socket, payload);
    }
  }

  count(eventId: string): number {
    return this.subscribers.get(eventId)?.size ?? 0;
  }

  subscribeTeam(eventId: string, teamId: string, socket: WebSocket): void {
    if (socket.readyState !== socket.OPEN) return;
    let byTeam = this.teams.get(eventId);
    if (!byTeam) this.teams.set(eventId, (byTeam = new Map()));
    let set = byTeam.get(teamId);
    if (!set) byTeam.set(teamId, (set = new Set()));
    set.add(socket);
    // Die App bekommt das Lebenszeichen als Nachricht und merkt so, wenn die Verbindung still abreißt.
    const timer = setInterval(() => send(socket, PING), PING_INTERVAL_MS).unref();
    socket.on("close", () => {
      clearInterval(timer);
      set!.delete(socket);
      if (set!.size === 0 && byTeam!.get(teamId) === set) byTeam!.delete(teamId);
      if (byTeam!.size === 0 && this.teams.get(eventId) === byTeam) this.teams.delete(eventId);
    });
  }

  /** Stupst ein Team an oder, mit teamId null, alle Teams des Events. */
  poke(eventId: string, teamId: string | null, reason: PokeReason): void {
    const byTeam = this.teams.get(eventId);
    if (!byTeam) return;
    const payload = JSON.stringify({ type: "poke", reason });
    const sets = teamId ? [byTeam.get(teamId)] : [...byTeam.values()];
    for (const set of sets) for (const socket of set ?? []) send(socket, payload);
  }

  teamCount(eventId: string, teamId?: string): number {
    const byTeam = this.teams.get(eventId);
    if (!byTeam) return 0;
    if (teamId) return byTeam.get(teamId)?.size ?? 0;
    let n = 0;
    for (const set of byTeam.values()) n += set.size;
    return n;
  }
}
