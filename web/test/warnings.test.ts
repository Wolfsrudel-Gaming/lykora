import { describe, expect, it } from "vitest";
import type { Warning } from "../src/lib/types.ts";
import { quickActions, severity, sortWarnings, URGENCY, WARNING_LABELS } from "../src/lib/warnings.ts";

const w = (kind: Warning["kind"], minutes?: number): Warning => ({ kind, minutes, teamId: "t", message: `${kind} ${minutes ?? ""}` });

describe("Warnungen", () => {
  it("sortiert nach Dringlichkeit, dann nach Dauer", () => {
    const list = [w("stuck", 40), w("battery_low"), w("sos"), w("no_contact", 25), w("in_restricted_zone"), w("no_contact", 50), w("crowded_station")];
    expect(sortWarnings(list).map((x) => x.message.trim())).toEqual([
      "sos",
      "in_restricted_zone",
      "no_contact 50",
      "no_contact 25",
      "battery_low",
      "stuck 40",
      "crowded_station",
    ]);
  });

  it("stuft SOS und Sperrzone als Sicherheit ein", () => {
    expect(severity("sos")).toBe("safety");
    expect(severity("in_restricted_zone")).toBe("safety");
    expect(severity("heartbeat_overdue")).toBe("high");
    expect(severity("review_pending")).toBe("normal");
    expect(severity("stuck")).toBe("low");
  });

  it("schlägt passende Schnellhandlungen vor", () => {
    expect(quickActions(w("sos"))[0]).toBe("sos");
    expect(quickActions(w("stuck"))).toEqual(["hint", "message", "team"]);
    expect(quickActions(w("review_pending"))[0]).toBe("review");
    expect(quickActions(w("crowded_station"))).toEqual(["map"]);
  });

  it("hat für jede Art eine Dringlichkeit und eine Bezeichnung", () => {
    expect(Object.keys(URGENCY).sort()).toEqual(Object.keys(WARNING_LABELS).sort());
  });
});
