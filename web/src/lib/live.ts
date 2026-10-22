/**
 * Live-Verbindung zum Dashboard-WebSocket eines Events. Baut die Verbindung bei Abbruch
 * mit wachsender Wartezeit neu auf; nach einem Neuaufbau lädt der Leitstand alles nach,
 * weil in der Lücke Ereignisse fehlen können.
 */

import type { LiveEvent } from "./types.ts";

export type LiveState = "connecting" | "open" | "closed" | "denied";

/** Wartezeit vor dem n-ten neuen Versuch: 1, 2, 4, 8, dann höchstens 15 Sekunden. */
export function retryDelay(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));
}

/** Schließcodes des Servers: 4000 + HTTP-Status. 4401/4403/4404 heißt: Neuversuch zwecklos. */
export function isFatalClose(code: number): boolean {
  return code === 4401 || code === 4403 || code === 4404;
}

const reconnectListeners = new Set<() => void>();

/** Meldet jeden Neuaufbau einer Live-Verbindung nach einem Abriss, z. B. für den Versionshinweis. */
export function onLiveReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

export interface LiveOptions {
  url: () => string;
  onEvent: (event: LiveEvent) => void;
  onState: (state: LiveState, reconnected: boolean) => void;
  /** Für Tests */
  socket?: (url: string) => WebSocket;
}

export class LiveConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private wasOpen = false;
  private readonly opts: LiveOptions;

  constructor(opts: LiveOptions) {
    this.opts = opts;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    window.addEventListener("online", this.retryNow);
    window.addEventListener("offline", this.dropNow);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.retryNow);
    window.removeEventListener("offline", this.dropNow);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
    if (this.timer) clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    if (ws) discard(ws);
  }

  /** Sofort neu verbinden, z. B. wenn das Netz zurück ist. */
  private readonly retryNow = () => {
    if (this.stopped || this.ws?.readyState === WebSocket.OPEN) return;
    if (this.timer) clearTimeout(this.timer);
    // Ein Socket noch im Aufbau würde sonst parallel weiterlaufen und Ereignisse doppelt liefern.
    const pending = this.ws;
    this.ws = null;
    if (pending) discard(pending);
    this.attempt = 0;
    this.connect();
  };

  /** Handys frieren Hintergrund-Tabs ein; beim Zurückkommen nicht erst die Wartezeit abwarten. */
  private readonly onVisible = () => {
    if (document.visibilityState === "visible") this.retryNow();
  };

  /** Ohne Netz meldet der Browser einen toten Socket oft erst spät; dann lieber gleich schließen. */
  private readonly dropNow = () => this.ws?.close();

  private connect(): void {
    this.opts.onState("connecting", false);
    const ws = (this.opts.socket ?? ((u) => new WebSocket(u)))(this.opts.url());
    this.ws = ws;
    ws.onmessage = (msg) => {
      if (this.ws !== ws) return;
      let event: LiveEvent;
      try {
        event = JSON.parse(String(msg.data)) as LiveEvent;
      } catch {
        return;
      }
      // Erst „hello“ bestätigt die Anmeldung; vorher kann der Server noch mit 4401 schließen.
      if (event.type === "hello") {
        const reconnected = this.wasOpen;
        this.wasOpen = true;
        this.attempt = 0;
        this.opts.onState("open", reconnected);
        if (reconnected) for (const fn of reconnectListeners) fn();
      }
      this.opts.onEvent(event);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      if (isFatalClose(e.code)) {
        this.opts.onState("denied", false);
        return;
      }
      this.opts.onState("closed", false);
      this.timer = setTimeout(() => this.connect(), retryDelay(this.attempt++));
    };
  }
}

/** Schließt einen Socket, ohne dass er noch Ereignisse meldet. */
function discard(ws: WebSocket): void {
  ws.onmessage = null;
  ws.onclose = null;
  // Ein Socket im Aufbau würde beim Schließen eine Fehlermeldung in die Konsole schreiben.
  if (ws.readyState === 0) ws.onopen = () => ws.close(1000);
  else ws.close(1000);
}
