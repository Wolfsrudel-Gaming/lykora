import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFatalClose, LiveConnection, retryDelay, type LiveState } from "../src/lib/live.ts";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  receive(data: unknown) {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe("Live-Verbindung", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("WebSocket", { OPEN: 1 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("wartet mit wachsender Pause, höchstens 15 Sekunden", () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });

  it("gibt bei fehlendem Recht auf", () => {
    expect(isFatalClose(4401)).toBe(true);
    expect(isFatalClose(4404)).toBe(true);
    expect(isFatalClose(1006)).toBe(false);
    expect(isFatalClose(4500)).toBe(false);
  });

  function connect() {
    const states: [LiveState, boolean][] = [];
    const events: string[] = [];
    let n = 0;
    const conn = new LiveConnection({
      url: () => `ws://x/live?n=${++n}`,
      onEvent: (e) => events.push(e.type),
      onState: (s, r) => states.push([s, r]),
      socket: (url) => new FakeSocket(url) as unknown as WebSocket,
    });
    conn.start();
    return { conn, states, events };
  }

  it("meldet „verbunden“ erst mit hello und verbindet nach Abbruch neu", () => {
    const { conn, states, events } = connect();
    expect(states).toEqual([["connecting", false]]);
    FakeSocket.all[0]!.receive({ type: "hello", data: {} });
    FakeSocket.all[0]!.receive({ type: "position", data: {} });
    expect(states.at(-1)).toEqual(["open", false]);
    expect(events).toEqual(["hello", "position"]);

    FakeSocket.all[0]!.close(1006);
    expect(states.at(-1)).toEqual(["closed", false]);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    expect(FakeSocket.all[1]!.url).toBe("ws://x/live?n=2");
    FakeSocket.all[1]!.receive({ type: "hello", data: {} });
    // Nach dem Neuaufbau lädt der Leitstand alles nach.
    expect(states.at(-1)).toEqual(["open", true]);
    conn.stop();
  });

  it("verbindet bei verweigertem Zugang nicht neu", () => {
    const { states } = connect();
    FakeSocket.all[0]!.close(4401);
    expect(states.at(-1)).toEqual(["denied", false]);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("verbindet bei wiederkehrendem Netz sofort und verwirft den Socket im Aufbau", () => {
    const { conn, states, events } = connect();
    const online = (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(([type]) => type === "online")![1] as () => void;
    // Der erste Socket hängt noch im Aufbau, als das Netz zurückkommt.
    online();
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[0]!.receive({ type: "hello", data: {} });
    FakeSocket.all[0]!.receive({ type: "position", data: {} });
    expect(events).toEqual([]);
    FakeSocket.all[1]!.receive({ type: "hello", data: {} });
    expect(events).toEqual(["hello"]);
    expect(states.at(-1)).toEqual(["open", false]);
    // Ein offener Socket bleibt bestehen.
    online();
    expect(FakeSocket.all).toHaveLength(2);
    conn.stop();
  });

  it("hört nach stop auf", () => {
    const { conn, states } = connect();
    conn.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(states).toEqual([["connecting", false]]);
  });
});
