/**
 * Paket C: Standardnamen der Spielwelt je Genre, wie die App sie ohne eigene Angaben zeigt
 * (app/lib/ui/design/tokens.dart): Peilgerät, Akte und Stempel der Belohnung.
 */

import { readText } from "../../../../lib/editor/text.ts";
import type { Game } from "../../../../lib/editor/types.ts";

type Genre = NonNullable<Game["meta"]["genre"]>;

const WORLDS: Record<Genre, { device: string; caseFile: string; stamp: string }> = {
  other: { device: "Laterne", caseFile: "Rucksack", stamp: "Gefunden" },
  crime: { device: "Spürnase", caseFile: "Fallakte", stamp: "Gelöst" },
  mystery: { device: "Irrlicht-Glas", caseFile: "Tagebuch der Nacht", stamp: "Enthüllt" },
  agents: { device: "Signalpeiler", caseFile: "Dossier", stamp: "Zugang gewährt" },
  rescue: { device: "Peilempfänger", caseFile: "Einsatzprotokoll", stamp: "Auftrag erfüllt" },
};

/** Namen der Spielwelt: eigene aus presentation, sonst die des Genres. */
export function worldOf(game: Game): { device: string; caseFile: string; stamp: string } {
  const lang = game.meta?.languages?.[0] ?? "de";
  const base = WORLDS[game.meta?.genre ?? "other"] ?? WORLDS.other;
  const p = game.presentation;
  return {
    device: readText(p?.device as never, lang) || base.device,
    caseFile: readText(p?.caseFile as never, lang) || base.caseFile,
    stamp: readText(p?.stamp as never, lang) || base.stamp,
  };
}
