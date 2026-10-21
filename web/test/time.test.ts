import { describe, expect, it } from "vitest";
import { eventElapsed, isPaused, pausedBetween, remaining, teamElapsed, timeLimit } from "../src/lib/time.ts";
import type { Game } from "../src/lib/types.ts";

const T0 = Date.parse("2027-10-19T19:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const game = (time: Game["settings"]["time"]) => ({ settings: { time } }) as unknown as Game;

const running = { status: "running", startedAt: at(0), endedAt: null, pauses: [] as { from: string; to: string | null }[] };

describe("Restzeit", () => {
  it("rechnet Pausen heraus, auch eine laufende", () => {
    const pauses = [
      { from: at(10), to: at(15) },
      { from: at(30), to: null },
    ];
    expect(pausedBetween(pauses, T0, T0 + 20 * 60_000)).toBe(5 * 60_000);
    expect(pausedBetween(pauses, T0, T0 + 40 * 60_000)).toBe(15 * 60_000);
    expect(pausedBetween(pauses, T0 + 12 * 60_000, T0 + 40 * 60_000)).toBe(13 * 60_000);
  });

  it("zählt die Laufzeit des Events", () => {
    expect(eventElapsed({ ...running, startedAt: null }, T0)).toBeNull();
    expect(eventElapsed(running, T0 + 90_000)).toBe(90);
    expect(eventElapsed({ ...running, status: "paused", pauses: [{ from: at(5), to: null }] }, T0 + 20 * 60_000)).toBe(300);
    expect(eventElapsed({ ...running, status: "ended", endedAt: at(50) }, T0 + 80 * 60_000)).toBe(3000);
  });

  it("gibt bei per_team die Zeit je Team ab dessen Start", () => {
    const g = game({ limit: "per_team", duration: 2700 });
    const team = { startedAt: at(10), finishedAt: null, timePenalty: 0 };
    expect(remaining(g, running, null, T0)).toBeNull();
    expect(remaining(g, running, { startedAt: null, finishedAt: null }, T0)).toBeNull();
    expect(remaining(g, running, team, T0 + 20 * 60_000)).toBe(2700 - 600);
    expect(remaining(g, running, { ...team, timePenalty: 90 }, T0 + 20 * 60_000)).toBe(2700 - 600 - 90);
    expect(teamElapsed(g, running, team, T0 + 20 * 60_000)).toBe(600);
  });

  it("gibt bei global die Zeit ab Start des Events, für alle gleich", () => {
    const g = game({ limit: "global", duration: 3600 });
    expect(remaining(g, running, null, T0 + 30 * 60_000)).toBe(1800);
    expect(remaining(g, running, { startedAt: at(20), finishedAt: null }, T0 + 30 * 60_000)).toBe(1800);
    const paused = { ...running, pauses: [{ from: at(10), to: at(20) }] };
    expect(remaining(g, paused, null, T0 + 30 * 60_000)).toBe(2400);
  });

  it("wird negativ, wenn die Zeit abgelaufen ist", () => {
    const g = game({ limit: "global", duration: 600 });
    expect(remaining(g, running, null, T0 + 15 * 60_000)).toBe(-300);
  });

  it("hält die Uhr im Ziel und am Ende an", () => {
    const g = game({ limit: "per_team", duration: 2700 });
    const team = { startedAt: at(0), finishedAt: at(30) };
    expect(remaining(g, running, team, T0 + 60 * 60_000)).toBe(900);
    expect(remaining(g, { ...running, status: "ended", endedAt: at(40) }, { startedAt: at(0), finishedAt: null }, T0 + 90 * 60_000)).toBe(300);
  });

  it("kennt Spiele ohne Zeitlimit", () => {
    expect(remaining(game({ limit: "none", duration: 600 }), running, null, T0)).toBeNull();
    expect(remaining(game(undefined), running, { startedAt: at(0), finishedAt: null }, T0)).toBeNull();
    expect(timeLimit(null)).toEqual({ limit: "per_team", duration: null });
  });

  it("erkennt Pause und Rückruf als Stillstand", () => {
    expect(isPaused({ ...running, status: "recalled" })).toBe(true);
    expect(isPaused({ ...running, status: "paused" })).toBe(true);
    expect(isPaused(running)).toBe(false);
  });
});
