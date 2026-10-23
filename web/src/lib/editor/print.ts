/**
 * Paket E: Daten für die Druckansichten – Stationsschilder (A5, QR-Code und Code zum Eintippen,
 * nichts, was Lösungen verrät) und das Blatt für die Spielleitung (Lösungen, Notfall-Codes,
 * NFC-Werte, Aufbau-Notizen, Finalcode). Reine Funktionen; die Ansichten stehen in publish/.
 */

import { taskSummary } from "../game.ts";
import { readText } from "./text.ts";
import type { Game, Station } from "./types.ts";

type Json = Record<string, unknown>;

const list = <T>(x: T[] | undefined | null): T[] => (Array.isArray(x) ? x.filter((e) => e && typeof e === "object") : []);
/** Stationen mit ihrem Platz im Spiel; Lücken im Entwurf (null) fallen weg, ohne die Nummern zu verschieben. */
const placed = (game: Game): [Station, number][] =>
  (Array.isArray(game.stations) ? game.stations : []).map((s, i): [Station, number] => [s, i]).filter(([s]) => s && typeof s === "object");
const codes = (s: Station, type: "qr" | "manual" | "nfc"): string[] =>
  list(s.triggers)
    .filter((t) => t.type === type)
    .map((t) => String((t as Json)[type === "nfc" ? "tag" : "code"] ?? ""))
    .filter(Boolean);

/** Nummer einer Station wie in Liste und Karte: Platz in der Spielreihenfolge, Finale mit Stern. */
export function stationLabel(s: Station, index: number): string {
  return s.final ? "★" : String(index + 1);
}

export interface Sign {
  stationId: string;
  /** Platz in der Spielreihenfolge (1, 2 …) oder ★ beim Finale */
  number: string;
  name: string;
  /** Inhalt des QR-Codes, den die App scannt */
  qr: string;
}

/** Ein Schild je QR-Auslöser (eine Station kann zwei haben). Stationen ohne QR brauchen kein Schild. */
export function signsData(game: Game): Sign[] {
  const lang = game.meta?.languages?.[0] ?? "de";
  return placed(game).flatMap(([s, i]) =>
    codes(s, "qr").map((qr) => ({ stationId: s.id, number: stationLabel(s, i), name: readText(s.name as never, lang) || s.id, qr })),
  );
}

/** Stationen ohne QR-Code: Teams lösen sie per GPS, Chip oder Notfall-Code aus, ein Schild gibt es nicht. */
export function stationsWithoutSign(game: Game): string[] {
  const lang = game.meta?.languages?.[0] ?? "de";
  return placed(game)
    .filter(([s]) => !codes(s, "qr").length)
    .map(([s]) => readText(s.name as never, lang) || s.id);
}

export interface SheetRow {
  stationId: string;
  number: string;
  name: string;
  hidden: boolean;
  /** Art und Frage des Rätsels; null ohne Rätsel */
  task: { kind: string; question: string; solution: string[] } | null;
  qr: string[];
  manual: string[];
  nfc: string[];
  /** Werte der Codeteile, die es hier gibt, in Reihenfolge */
  fragments: string[];
  props: string[];
  notes: string;
}

export interface SolutionSheet {
  title: string;
  phone: string;
  emergencyNumber: string;
  finalCode: string;
  rows: SheetRow[];
}

/** Blatt für die Spielleitung: alles, was auf den Schildern fehlt. Hält unvollständige Entwürfe aus. */
export function solutionSheet(game: Game): SolutionSheet {
  const lang = game.meta?.languages?.[0] ?? "de";
  const fragments = list(game.fragments).sort((a, b) => a.position - b.position);
  const value = new Map(fragments.map((f) => [f.id, f.value]));
  const rows = placed(game).map(([s, i]): SheetRow => {
    let task: SheetRow["task"] = null;
    if (s.task) {
      try {
        task = taskSummary(s.task, lang);
      } catch {
        task = { kind: "Rätsel", question: "", solution: [] };
      }
    }
    return {
      stationId: s.id,
      number: stationLabel(s, i),
      name: readText(s.name as never, lang) || s.id,
      hidden: s.visibility === "hidden",
      task,
      qr: codes(s, "qr"),
      manual: codes(s, "manual"),
      nfc: codes(s, "nfc"),
      fragments: (s.rewards?.fragments ?? []).map((id) => value.get(id) ?? "?"),
      props: list(s.props).map((p) => `${p.quantity && p.quantity > 1 ? `${p.quantity}× ` : ""}${p.name}${p.note ? ` (${p.note})` : ""}`),
      notes: typeof s.notes === "string" ? s.notes : "",
    };
  });
  return {
    title: readText(game.meta?.title as never, lang),
    phone: game.safety?.emergency?.gameMasterPhone ?? "",
    emergencyNumber: game.safety?.emergency?.emergencyNumber ?? "112",
    finalCode: fragments.map((f) => f.value).join(""),
    rows,
  };
}
