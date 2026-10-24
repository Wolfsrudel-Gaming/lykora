import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTime } from "../src/lib/format.ts";
import type { UpdateEntry, UpdateStatus, VersionInfo } from "../src/lib/types.ts";
import {
  applyRefusal,
  buildLabel,
  dismissVersion,
  followTrack,
  newerVersion,
  noteVersion,
  refreshUpdateHint,
  resetUpdateHint,
  sameVersion,
  serverAway,
  shortCommit,
  startTrack,
  trackProgress,
  updateHint,
  updateView,
  versionNotice,
  versionText,
  watchVersion,
  windowError,
  windowMinutes,
  windowText,
  zonedWhen,
} from "../src/lib/update.ts";

const NOW = Date.parse("2026-10-21T18:00:00Z");
const OLD: VersionInfo = { version: "57", commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", builtAt: "2026-10-20T12:03:00Z" };
const NEW: VersionInfo = { version: "58", commit: "ffeeddccbbaa99887766554433221100ffeeddcc", builtAt: "2026-10-21T09:30:00Z" };

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    configured: true,
    image: "ghcr.io/wolfsrudel-gaming/lykora:testbuild",
    current: OLD,
    available: null,
    upToDate: true,
    lastCheckAt: new Date(NOW - 3 * 60_000).toISOString(),
    checkError: null,
    changes: [],
    settings: { auto: false, window: null },
    timezone: "Europe/Berlin",
    blockedBy: null,
    updater: { connected: true, lastSeenAt: new Date(NOW - 20_000).toISOString(), state: "idle", message: null },
    pending: null,
    history: [],
    ...patch,
  };
}

const available = (patch: Partial<UpdateStatus> = {}) => status({ available: { ...NEW, digest: "sha256:abc" }, upToDate: false, ...patch });

const entry = (patch: Partial<UpdateEntry> = {}): UpdateEntry => ({
  id: "u1",
  trigger: "manual",
  state: "running",
  from: OLD,
  to: NEW,
  message: null,
  startedAt: new Date(NOW).toISOString(),
  finishedAt: null,
  ...patch,
});

describe("Versionen", () => {
  it("kürzt Commits und benennt Builds", () => {
    expect(shortCommit(OLD.commit)).toBe("a1b2c3d");
    expect(shortCommit(null)).toBe("");
    expect(buildLabel(OLD)).toBe("Build 57");
    expect(buildLabel({ version: "dev", commit: null, builtAt: null })).toBe("Entwicklungsstand");
    expect(buildLabel({ version: "?", commit: NEW.commit, builtAt: null })).toBe("Commit ffeeddc");
    expect(buildLabel({ version: "?", commit: null, builtAt: null })).toBe("unbekannte Version");
  });

  it("zeigt Build, Commit und Datum", () => {
    expect(versionText(OLD)).toBe(`Build 57 · a1b2c3d · ${formatDateTime(OLD.builtAt)}`);
    expect(versionText({ version: "dev", commit: null, builtAt: null })).toBe("Entwicklungsstand");
    expect(versionText({ version: "?", commit: NEW.commit, builtAt: null })).toBe("Commit ffeeddc");
  });

  it("vergleicht über den Commit, auch gekürzt, sonst über Laufnummer und Bauzeit", () => {
    expect(sameVersion(OLD, { ...OLD })).toBe(true);
    expect(sameVersion(OLD, { version: "?", commit: "a1b2c3d", builtAt: null })).toBe(true);
    expect(sameVersion(OLD, NEW)).toBe(false);
    const dev = { version: "dev", commit: null, builtAt: null };
    expect(sameVersion(dev, { ...dev })).toBe(true);
    expect(sameVersion(dev, OLD)).toBe(false);
  });
});

describe("Zeitfenster", () => {
  it("prüft Anfang und Ende", () => {
    expect(windowError("03:00", "05:00")).toBeNull();
    expect(windowError("23:00", "05:00")).toBeNull();
    expect(windowError("", "05:00")).toBe("Bitte Anfang und Ende angeben.");
    expect(windowError("3:00", "05:00")).toMatch(/HH:MM/);
    expect(windowError("24:00", "05:00")).toMatch(/HH:MM/);
    expect(windowError("04:00", "04:00")).toBe("Anfang und Ende müssen sich unterscheiden.");
  });

  it("beschreibt das Fenster, auch über Mitternacht", () => {
    expect(windowMinutes({ from: "03:00", to: "05:00" })).toBe(120);
    expect(windowMinutes({ from: "23:30", to: "01:00" })).toBe(90);
    expect(windowText({ from: "03:00", to: "05:00" })).toBe("täglich 03:00–05:00 Uhr (2 Std)");
    expect(windowText({ from: "23:00", to: "05:00" })).toBe("täglich 23:00–05:00 Uhr (6 Std, über Mitternacht)");
    expect(windowText({ from: "02:00", to: "02:30" })).toBe("täglich 02:00–02:30 Uhr (30 Min)");
  });

  it("nennt das nächste Fenster in der Zeitzone des Servers", () => {
    // 18:00 UTC ist 20:00 in Berlin (Sommerzeit bis 25.10.2026).
    expect(zonedWhen("2026-10-21T19:00:00Z", "Europe/Berlin", NOW)).toBe("heute um 21:00 Uhr");
    expect(zonedWhen("2026-10-22T01:00:00Z", "Europe/Berlin", NOW)).toBe("morgen um 03:00 Uhr");
    expect(zonedWhen("2026-10-21T22:30:00Z", "Europe/Berlin", NOW)).toBe("morgen um 00:30 Uhr");
    expect(zonedWhen("2026-10-21T22:30:00Z", "UTC", NOW)).toBe("heute um 22:30 Uhr");
    // Nach der Zeitumstellung gilt wieder UTC+1.
    expect(zonedWhen("2026-10-26T02:00:00Z", "Europe/Berlin", NOW)).toBe("am 26.10. um 03:00 Uhr");
    expect(zonedWhen("2026-10-22T01:00:00Z", "Keine/Zone", NOW)).toMatch(/um \d\d:\d\d Uhr$/);
  });
});

describe("Stand der Updates", () => {
  it("erklärt, wenn kein Image eingestellt ist", () => {
    const v = updateView(status({ configured: false, image: null, upToDate: null, lastCheckAt: null }), NOW);
    expect(v.kind).toBe("not_configured");
    expect(v.detail).toContain("LYKORA_IMAGE");
    expect(v.tone).toBe("warn");
    expect(v.hint).toBeNull();
  });

  it("nennt ein lokal gebautes Image beim Namen", () => {
    const reason = "LYKORA_IMAGE nennt das lokal gebaute Image lykora-server:latest, das in keiner Registry liegt; daraus gibt es keine Updates";
    const v = updateView(status({ configured: false, image: "lykora-server:latest", upToDate: null, lastCheckAt: null, checkError: reason }), NOW);
    expect(v).toMatchObject({ kind: "not_configured", title: "Keine Updates für ein lokal gebautes Image", detail: reason, tone: "warn" });
  });

  it("meldet „aktuell“ mit dem Zeitpunkt der letzten Prüfung", () => {
    const v = updateView(status(), NOW);
    expect(v).toMatchObject({ kind: "up_to_date", title: "Lykora ist aktuell", detail: "Zuletzt geprüft vor 3 Min.", tone: "ok" });
  });

  it("unterscheidet „noch nicht geprüft“ und eine gescheiterte Prüfung", () => {
    expect(updateView(status({ upToDate: null, lastCheckAt: null }), NOW).kind).toBe("unchecked");
    const failed = updateView(status({ upToDate: null, checkError: "Prüfung fehlgeschlagen: fetch failed" }), NOW);
    expect(failed).toMatchObject({ kind: "check_failed", title: "Prüfung fehlgeschlagen", detail: "fetch failed. Zuletzt geprüft vor 3 Min." });
    expect(failed.hint).toBeNull();
    // Das Paket auf ghcr.io ist anfangs privat: Dazu gehört ein Hinweis, was zu tun ist.
    const hidden = updateView(status({ upToDate: null, checkError: "Image nicht gefunden oder nicht öffentlich" }), NOW);
    expect(hidden.detail).toBe("Image nicht gefunden oder nicht öffentlich. Zuletzt geprüft vor 3 Min.");
    expect(hidden.hint).toMatch(/^Das Paket auf ghcr.io ist nach dem ersten Lauf der CI privat: .*Public.*LYKORA_REGISTRY_USER und LYKORA_REGISTRY_TOKEN/);
    const elsewhere = updateView(status({ image: "registry.example.org/team/lykora:1", upToDate: null, checkError: "Image nicht gefunden oder nicht öffentlich" }), NOW);
    expect(elsewhere.hint).toBeNull();
  });

  it("zeigt eine neue Version mit Bauzeit", () => {
    const v = updateView(available(), NOW);
    expect(v.kind).toBe("available");
    expect(v.title).toBe("Neue Version: Build 58");
    expect(v.detail).toBe(`Gebaut am ${formatDateTime(NEW.builtAt)}. Zuletzt geprüft vor 3 Min.`);
    expect(v.applyBlocked).toBeNull();
    expect(v.waiting).toMatch(/^Automatische Updates sind aus/);
  });

  it("sagt, was „Jetzt aktualisieren“ aufhält", () => {
    const events = [{ id: "e1", name: "Nachtwanderung", status: "running" as const }];
    expect(updateView(available({ blockedBy: { reason: "event_running", events } }), NOW).applyBlocked).toMatch(/Events/);
    expect(updateView(available({ updater: { connected: false, lastSeenAt: null, state: null, message: null } }), NOW).applyBlocked).toMatch(/Updater/);
  });

  it("sagt, worauf das automatische Update wartet", () => {
    const auto = { auto: true, window: { from: "03:00", to: "05:00" } };
    const waiting = (patch: Partial<UpdateStatus>) => updateView(available({ settings: auto, ...patch }), NOW).waiting;
    expect(waiting({ blockedBy: { reason: "event_running", events: [{ id: "e1", name: "Nachtwanderung", status: "paused" }] } })).toMatch(/bis kein Event mehr läuft/);
    expect(waiting({ blockedBy: { reason: "outside_window", nextWindowAt: "2026-10-22T01:00:00Z" } })).toBe(
      "Das automatische Update wartet auf das Zeitfenster: morgen um 03:00 Uhr.",
    );
    expect(waiting({ updater: { connected: false, lastSeenAt: null, state: null, message: null } })).toMatch(/wartet auf den Updater/);
    expect(waiting({})).toMatch(/^Wird automatisch eingespielt/);
    const failed = entry({ state: "rolled_back", finishedAt: new Date(NOW - 60 * 60_000).toISOString() });
    expect(waiting({ history: [failed] })).toMatch(/vorhin gescheitert/);
    const longAgo = entry({ state: "failed", finishedAt: new Date(NOW - 7 * 60 * 60_000).toISOString() });
    expect(waiting({ history: [longAgo] })).toMatch(/^Wird automatisch eingespielt/);
  });

  it("erkennt ein laufendes Update an Auftrag oder Verlauf", () => {
    const pending = available({ pending: { trigger: "manual", requestedAt: new Date(NOW).toISOString(), to: NEW } });
    expect(updateView(pending, NOW)).toMatchObject({ kind: "in_progress", title: "Update auf Build 58 läuft" });
    expect(updateView(status({ history: [entry({ trigger: "auto" })] }), NOW).kind).toBe("in_progress");
  });

  it("erklärt die Absagen von „Jetzt aktualisieren“", () => {
    expect(applyRefusal("event_running", "x")).toMatch(/Events/);
    expect(applyRefusal("updater_offline", "x")).toMatch(/Updater/);
    expect(applyRefusal("up_to_date", "x")).toMatch(/Jetzt prüfen/);
    expect(applyRefusal("not_configured", "x")).toMatch(/LYKORA_IMAGE/);
    expect(applyRefusal("anderes", "Meldung des Servers")).toBe("Meldung des Servers");
  });

  it("hält den Server beim Neustart für weg, nicht für kaputt", () => {
    expect([0, 502, 503, 504].every(serverAway)).toBe(true);
    expect([401, 403, 409, 500].some(serverAway)).toBe(false);
  });
});

describe("Fortschritt eines Updates", () => {
  const requested = available({ pending: { trigger: "manual", requestedAt: new Date(NOW).toISOString(), to: NEW } });
  const withUpdater = (state: UpdateStatus["updater"]["state"], patch: Partial<UpdateStatus> = {}) =>
    available({ ...patch, pending: requested.pending, history: [entry()], updater: { connected: true, lastSeenAt: null, state, message: null } });

  it("geht die Schritte bis zum Neustart durch", () => {
    let track = startTrack(requested, NOW);
    expect(track).toMatchObject({ from: OLD, entryId: null, step: 0 });
    expect(trackProgress(track, requested, true, NOW)).toMatchObject({ stage: "requested", step: 0, done: false });
    track = followTrack(track, withUpdater("pulling"), true);
    expect(track.entryId).toBe("u1");
    expect(trackProgress(track, withUpdater("pulling"), true, NOW)).toMatchObject({ stage: "pulling", step: 1 });
    track = followTrack(track, withUpdater("updating"), true);
    expect(trackProgress(track, withUpdater("updating"), true, NOW).stage).toBe("updating");
  });

  it("wartet ruhig, solange der Server weg ist, und meldet dann die neue Version", () => {
    let track = followTrack(startTrack(requested, NOW), withUpdater("updating"), true);
    track = followTrack(track, null, false);
    expect(track.step).toBe(3);
    expect(trackProgress(track, null, false, NOW)).toMatchObject({ stage: "restarting", title: "Server startet neu …", done: false });
    // Der neue Server weiß nichts vom Zustand des Updaters; der Schritt bleibt trotzdem.
    const back = status({ current: NEW, history: [entry({ state: "succeeded", finishedAt: new Date(NOW).toISOString() })], updater: { connected: false, lastSeenAt: null, state: null, message: null } });
    track = followTrack(track, back, true);
    expect(track.step).toBe(3);
    expect(trackProgress(track, back, true, NOW)).toMatchObject({ stage: "succeeded", done: true, title: "Update eingespielt: Build 58" });
  });

  it("bleibt beim Neustart, wenn der alte Server zurückkommt, bis der Updater berichtet", () => {
    let track = followTrack(startTrack(requested, NOW), null, false);
    track = followTrack(track, withUpdater("pulling"), true);
    const old = status({ history: [entry()], updater: { connected: true, lastSeenAt: null, state: null, message: null } });
    expect(trackProgress(followTrack(track, old, true), old, true, NOW)).toMatchObject({ stage: "restarting", done: false });
    const rolledBack = status({ history: [entry({ state: "rolled_back", message: "Healthcheck: unhealthy" })] });
    expect(trackProgress(track, rolledBack, true, NOW)).toMatchObject({ stage: "rolled_back", done: true, detail: "Healthcheck: unhealthy" });
  });

  it("meldet Scheitern und nicht unterstützte Images", () => {
    const track = followTrack(startTrack(requested, NOW), withUpdater("pulling"), true);
    const failed = status({ history: [entry({ state: "failed", message: "Ziehen fehlgeschlagen" })] });
    expect(trackProgress(track, failed, true, NOW)).toMatchObject({ stage: "failed", title: "Update gescheitert", detail: "Ziehen fehlgeschlagen" });
    const unsupported = withUpdater("unsupported");
    unsupported.updater.message = "LYKORA_IMAGE in .env setzen";
    expect(trackProgress(track, unsupported, true, NOW)).toMatchObject({ stage: "failed", title: "Update nicht möglich", detail: "LYKORA_IMAGE in .env setzen" });
    expect(trackProgress(startTrack(requested, NOW), status(), true, NOW)).toMatchObject({ stage: "stopped", done: true });
  });

  it("gibt nach langer Zeit einen Hinweis auf die Ausgabe des Updaters", () => {
    const track = startTrack(requested, NOW);
    expect(trackProgress(track, requested, true, NOW + 11 * 60_000).detail).toMatch(/docker compose logs updater/);
    expect(trackProgress(track, requested, true, NOW + 60_000).detail).not.toMatch(/logs/);
  });
});

describe("Punkt am Zahnrad", () => {
  beforeEach(() => updateHint.set({ available: false, at: 0 }));

  it("fragt höchstens alle 10 Minuten", async () => {
    const load = vi.fn(async () => available());
    await refreshUpdateHint(load, NOW);
    expect(updateHint.get()).toEqual({ available: true, at: NOW });
    await refreshUpdateHint(load, NOW + 9 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValueOnce(status());
    await refreshUpdateHint(load, NOW + 10 * 60_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(updateHint.get().available).toBe(false);
  });

  it("zählt einen Fehlschlag mit und lässt den Punkt, wie er war", async () => {
    updateHint.set({ available: true, at: 0 });
    const load = vi.fn(async (): Promise<UpdateStatus> => {
      throw new Error("weg");
    });
    await refreshUpdateHint(load, NOW);
    await refreshUpdateHint(load, NOW + 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(updateHint.get()).toEqual({ available: true, at: NOW });
  });

  it("vergisst Punkt und Wartezeit beim Abmelden", async () => {
    await refreshUpdateHint(async () => available(), NOW);
    expect(updateHint.get().available).toBe(true);
    resetUpdateHint();
    expect(updateHint.get()).toEqual({ available: false, at: 0 });
    // Der nächste Nutzer fragt sofort, nicht erst nach 10 Minuten.
    const load = vi.fn(async () => status());
    await refreshUpdateHint(load, NOW + 1000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("Hinweis auf eine neue Version", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    versionNotice.set({ loaded: null, current: null, dismissed: null });
  });
  afterEach(() => vi.useRealTimers());

  it("merkt die Version beim Laden und zeigt eine andere an, bis sie weggeklickt ist", () => {
    noteVersion(OLD);
    expect(newerVersion(versionNotice.get())).toBeNull();
    noteVersion({ ...OLD });
    expect(newerVersion(versionNotice.get())).toBeNull();
    noteVersion(NEW);
    expect(newerVersion(versionNotice.get())).toEqual(NEW);
    dismissVersion();
    expect(newerVersion(versionNotice.get())).toBeNull();
    const next = { version: "59", commit: "0123456789abcdef0123456789abcdef01234567", builtAt: null };
    noteVersion(next);
    expect(newerVersion(versionNotice.get())).toEqual(next);
  });

  it("prüft sofort, alle 5 Minuten und nach dem Neuaufbau der Live-Verbindung", async () => {
    const versions = [OLD, OLD, NEW];
    const load = vi.fn(async () => versions.shift() ?? NEW);
    let reconnect: (() => void) | null = null;
    const off = vi.fn();
    const stop = watchVersion(load, {
      onReconnect: (fn) => {
        reconnect = fn;
        return off;
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(versionNotice.get().loaded).toEqual(OLD);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(newerVersion(versionNotice.get())).toBeNull();
    reconnect!();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    expect(newerVersion(versionNotice.get())).toEqual(NEW);
    stop();
    expect(off).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("übersteht Fehler beim Fragen", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("weg")).mockResolvedValue(OLD);
    const stop = watchVersion(load, { every: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(versionNotice.get().loaded).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(versionNotice.get().loaded).toEqual(OLD);
    stop();
  });
});
