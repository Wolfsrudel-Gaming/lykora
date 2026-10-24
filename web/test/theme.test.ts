import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTheme, resolveTheme, themeColor, THEMES } from "../src/lib/theme.ts";

describe("Thema: reine Funktionen", () => {
  it("drei Themen, Nacht zuerst", () => {
    expect(THEMES).toEqual(["night", "day", "system"]);
  });

  it("unbekannt oder leer wird Nacht (Standard)", () => {
    expect(parseTheme(null)).toBe("night");
    expect(parseTheme(undefined)).toBe("night");
    expect(parseTheme("")).toBe("night");
    expect(parseTheme("dunkel")).toBe("night");
    expect(parseTheme("day")).toBe("day");
    expect(parseTheme("system")).toBe("system");
  });

  it("System folgt dem Gerät, Nacht und Tag nicht", () => {
    expect(resolveTheme("system", true)).toBe("day");
    expect(resolveTheme("system", false)).toBe("night");
    expect(resolveTheme("night", true)).toBe("night");
    expect(resolveTheme("day", false)).toBe("day");
  });

  it("Farbe der Browserleiste passt zum Seitengrund", () => {
    expect(themeColor("night")).toBe("#0B0C0E");
    expect(themeColor("day")).toBe("#F3EEE4");
  });
});

/** Browser-Umgebung für session.ts: Speicher, Dokument, Geräte-Hell/Dunkel als umschaltbare Medienabfrage. */
function browser(initial: Record<string, string> = {}, light = false) {
  const store = new Map<string, string>(Object.entries(initial));
  const dataset: Record<string, string> = {};
  const meta = { content: "", setAttribute(_k: string, v: string) { this.content = v; } };
  const listeners = new Set<() => void>();
  const mq = {
    matches: light,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  vi.stubGlobal("document", { baseURI: "https://lager.example/lykora/", documentElement: { dataset }, querySelector: (q: string) => (q.includes("theme-color") ? meta : null) });
  vi.stubGlobal("window", { location: { pathname: "/lykora/", search: "" }, addEventListener: vi.fn(), scrollTo: vi.fn(), matchMedia: () => mq });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return {
    store,
    dataset,
    meta,
    setDeviceLight(v: boolean) {
      mq.matches = v;
      for (const fn of listeners) fn();
    },
  };
}

describe("Thema: speichern und anwenden", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("ohne gespeichertes Thema ist es Nacht", async () => {
    browser();
    const { theme } = await import("../src/lib/session.ts");
    expect(theme.get()).toEqual({ value: "night", resolved: "night" });
  });

  it("setTheme speichert, setzt data-theme und die Leistenfarbe", async () => {
    const b = browser();
    const { setTheme, theme } = await import("../src/lib/session.ts");
    setTheme("day");
    expect(b.store.get("lykora.theme")).toBe("day");
    expect(b.dataset.theme).toBe("day");
    expect(b.meta.content).toBe("#F3EEE4");
    expect(theme.get()).toEqual({ value: "day", resolved: "day" });
    setTheme("night");
    expect(b.store.get("lykora.theme")).toBe("night");
    expect(b.dataset.theme).toBe("night");
    expect(b.meta.content).toBe("#0B0C0E");
  });

  it("das gespeicherte Thema gilt nach dem Neuladen", async () => {
    const b = browser({ "lykora.theme": "day" });
    const { theme } = await import("../src/lib/session.ts");
    expect(theme.get().value).toBe("day");
    // fehlt data-theme (alter Seitenstand), setzt die Sitzung es nach
    expect(b.dataset.theme).toBe("day");
  });

  it("System bleibt System und folgt dem Gerät, auch während die Seite offen ist", async () => {
    const b = browser({ "lykora.theme": "system" }, false);
    const { theme } = await import("../src/lib/session.ts");
    expect(theme.get()).toEqual({ value: "system", resolved: "night" });
    expect(b.dataset.theme).toBe("system");
    expect(b.meta.content).toBe("#0B0C0E");
    b.setDeviceLight(true);
    expect(theme.get()).toEqual({ value: "system", resolved: "day" });
    expect(b.meta.content).toBe("#F3EEE4");
    expect(b.store.get("lykora.theme")).toBe("system");
  });

  it("Nacht ignoriert Wechsel des Geräts", async () => {
    const b = browser({ "lykora.theme": "night" }, false);
    const { theme } = await import("../src/lib/session.ts");
    b.setDeviceLight(true);
    expect(theme.get()).toEqual({ value: "night", resolved: "night" });
  });

  it("ein kaputter Speicher stört nicht", async () => {
    browser();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("gesperrt");
      },
      setItem: () => {
        throw new Error("gesperrt");
      },
      removeItem: () => undefined,
    });
    const { setTheme, theme } = await import("../src/lib/session.ts");
    expect(theme.get().value).toBe("night");
    expect(() => setTheme("day")).not.toThrow();
    expect(theme.get().value).toBe("day");
  });
});

describe("Meldungen", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    browser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("Dauer je Art: 4 s Info und Erfolg, 8 s Warnung, Fehler bleibt", async () => {
    const { notify, toasts, toastDuration } = await import("../src/lib/session.ts");
    expect([toastDuration("info"), toastDuration("ok"), toastDuration("warn"), toastDuration("error")]).toEqual([4000, 4000, 8000, null]);
    notify("a", "info");
    notify("b", "error");
    expect(toasts.get().list.map((t) => t.duration)).toEqual([4000, null]);
    vi.advanceTimersByTime(3999);
    expect(toasts.get().list).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(toasts.get().list.map((t) => t.text)).toEqual(["b"]);
    vi.advanceTimersByTime(60_000);
    expect(toasts.get().list.map((t) => t.text)).toEqual(["b"]);
  });

  it("Hover hält die Restzeit an, danach läuft sie weiter", async () => {
    const { notify, pauseToast, resumeToast, toasts } = await import("../src/lib/session.ts");
    notify("x", "info");
    const id = toasts.get().list[0]!.id;
    vi.advanceTimersByTime(3000);
    pauseToast(id);
    vi.advanceTimersByTime(60_000);
    expect(toasts.get().list).toHaveLength(1);
    resumeToast(id);
    vi.advanceTimersByTime(999);
    expect(toasts.get().list).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.get().list).toHaveLength(0);
  });

  it("höchstens drei Meldungen, die älteste weicht", async () => {
    const { notify, toasts } = await import("../src/lib/session.ts");
    for (const t of ["1", "2", "3", "4"]) notify(t, "error");
    expect(toasts.get().list.map((t) => t.text)).toEqual(["2", "3", "4"]);
  });

  it("Aktion und Titel kommen mit; eigene Dauer geht vor", async () => {
    const { notify, toasts, dismiss } = await import("../src/lib/session.ts");
    const onClick = vi.fn();
    notify("Station gelöscht", "info", { title: "Gelöscht", action: { label: "Rückgängig", onClick }, duration: 10_000 });
    const t = toasts.get().list[0]!;
    expect(t).toMatchObject({ title: "Gelöscht", duration: 10_000, action: { label: "Rückgängig" } });
    t.action!.onClick();
    expect(onClick).toHaveBeenCalledOnce();
    dismiss(t.id);
    expect(toasts.get().list).toHaveLength(0);
    // Der Zeitgeber ist mit dismiss weg: nichts passiert später
    vi.advanceTimersByTime(20_000);
    expect(toasts.get().list).toHaveLength(0);
  });
});
