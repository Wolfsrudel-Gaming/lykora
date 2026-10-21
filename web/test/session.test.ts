import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Browser-Umgebung, soweit Sitzung und Router sie brauchen; Seite ist der Leitstand eines Events. */
function browser(fetch: typeof globalThis.fetch) {
  const store = new Map<string, string>([["lykora.token", "alt"]]);
  const loc = { pathname: "/lykora/events/e1/leitstand", search: "?tab=funk" };
  const move = (_: unknown, __: string, url: string) => {
    const u = new URL(url, "https://lager.example");
    loc.pathname = u.pathname;
    loc.search = u.search;
  };
  vi.stubGlobal("document", { baseURI: "https://lager.example/lykora/", documentElement: { dataset: {} }, querySelector: () => null });
  vi.stubGlobal("window", { location: loc, addEventListener: vi.fn(), scrollTo: vi.fn() });
  vi.stubGlobal("history", { pushState: vi.fn(move), replaceState: vi.fn(move) });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("fetch", fetch);
  return { store, loc };
}

async function load() {
  const router = await import("../src/lib/router.ts");
  router.startRouter();
  return import("../src/lib/session.ts");
}

describe("Sitzung beim Start", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("behält die Anmeldung, wenn der Server nicht erreichbar ist", async () => {
    const { store, loc } = browser(vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    const { restoreSession, session } = await load();
    await restoreSession();
    expect(store.get("lykora.token")).toBe("alt");
    expect(session.get()).toMatchObject({ token: "alt", ready: false, offline: expect.stringContaining("nicht erreichbar") });
    expect(loc.pathname).toBe("/lykora/events/e1/leitstand");
  });

  it("verwirft eine abgelaufene Anmeldung und merkt sich die Seite für danach", async () => {
    const { store, loc } = browser(vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized", message: "Sitzung abgelaufen oder ungültig" }), { status: 401 })) as unknown as typeof fetch);
    const { restoreSession, session, toasts } = await load();
    await restoreSession();
    expect(store.has("lykora.token")).toBe(false);
    expect(session.get()).toMatchObject({ token: null, ready: true, offline: null });
    expect(loc.pathname).toBe("/lykora/anmelden");
    expect(new URLSearchParams(loc.search).get("weiter")).toBe("/events/e1/leitstand?tab=funk");
    expect(toasts.get().list.map((t) => t.text)).toEqual(["Sitzung abgelaufen. Bitte neu anmelden."]);
  });
});
