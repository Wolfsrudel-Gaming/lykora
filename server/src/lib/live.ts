import type { WebSocket } from "ws";

export interface LiveMessage {
  type: string;
  data: unknown;
}

/**
 * Verteilt Live-Ereignisse an alle offenen Dashboard-Verbindungen eines Events.
 * Läuft im Prozess; für mehrere Server-Instanzen später über Postgres LISTEN/NOTIFY.
 */
export class LiveHub {
  private readonly subscribers = new Map<string, Set<{ socket: WebSocket; positions: boolean }>>();

  subscribe(eventId: string, socket: WebSocket, positions: boolean): void {
    let set = this.subscribers.get(eventId);
    if (!set) this.subscribers.set(eventId, (set = new Set()));
    const entry = { socket, positions };
    set.add(entry);
    socket.on("close", () => {
      set!.delete(entry);
      if (set!.size === 0) this.subscribers.delete(eventId);
    });
  }

  publish(eventId: string, type: string, data: unknown, opts: { positions?: boolean } = {}): void {
    const set = this.subscribers.get(eventId);
    if (!set) return;
    const payload = JSON.stringify({ type, data, at: new Date().toISOString() });
    for (const { socket, positions } of set) {
      if (opts.positions && !positions) continue;
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  count(eventId: string): number {
    return this.subscribers.get(eventId)?.size ?? 0;
  }
}
