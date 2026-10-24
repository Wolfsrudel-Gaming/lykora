/** Warnungen des Assistenten: Reihenfolge nach Dringlichkeit und passende Schnellhandlungen. */

import type { Warning, WarningKind } from "./types.ts";

/** Kleinere Zahl = dringender. Gefahr für Menschen vor Spielfluss. */
export const URGENCY: Record<WarningKind, number> = {
  sos: 0,
  in_restricted_zone: 1,
  heartbeat_overdue: 2,
  outside_field: 3,
  no_contact: 4,
  near_restricted_zone: 5,
  battery_low: 6,
  review_pending: 7,
  stuck: 8,
  crowded_station: 9,
};

export type Severity = "safety" | "high" | "normal" | "low";

export function severity(kind: WarningKind): Severity {
  const u = URGENCY[kind];
  if (u <= 1) return "safety";
  if (u <= 4) return "high";
  if (u <= 7) return "normal";
  return "low";
}

export function sortWarnings(list: Warning[]): Warning[] {
  return [...list].sort((a, b) => URGENCY[a.kind] - URGENCY[b.kind] || (b.minutes ?? 0) - (a.minutes ?? 0) || a.message.localeCompare(b.message, "de"));
}

export type QuickAction = "sos" | "team" | "message" | "hint" | "review" | "map";

/** Welche Schnellhandlungen zu einer Warnung passen, in Reihenfolge der Wichtigkeit. */
export function quickActions(w: Warning): QuickAction[] {
  switch (w.kind) {
    case "sos":
      return ["sos", "team", "map"];
    case "in_restricted_zone":
    case "near_restricted_zone":
    case "outside_field":
      return ["message", "map", "team"];
    case "heartbeat_overdue":
    case "no_contact":
    case "battery_low":
      return ["message", "team"];
    case "review_pending":
      return ["review", "team"];
    case "stuck":
      return ["hint", "message", "team"];
    case "crowded_station":
      return ["map"];
  }
}

export const WARNING_LABELS: Record<WarningKind, string> = {
  sos: "SOS",
  in_restricted_zone: "In Sperrzone",
  near_restricted_zone: "Nahe Sperrzone",
  outside_field: "Außerhalb",
  heartbeat_overdue: "Lebenszeichen fehlt",
  no_contact: "Kein Kontakt",
  battery_low: "Akku schwach",
  review_pending: "Prüfung offen",
  stuck: "Kommt nicht weiter",
  crowded_station: "Gedränge",
};
