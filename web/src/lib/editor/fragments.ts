/**
 * Paket D: Finalcode und Codeteile. Teams sammeln Codeteile an Stationen und tippen sie am Finale
 * als Finalcode ein. Positionen sieht niemand: Die Reihenfolge der Teile ist die Reihenfolge im
 * Code, lückenlos ab 1; IDs heißen teil-<n>. Gekoppelt heißt: Das Finale ist ein Code-Rätsel, dessen
 * einzige Antwort der Finalcode ist – es folgt jeder Änderung des Codes. Alles arbeitet in place
 * (innerhalb einer update-Mutation).
 */

import { newId, takenIds } from "./ids.ts";
import { removeWithReferences } from "./references.ts";
import type { Game, Station } from "./types.ts";

export type Fragment = NonNullable<Game["fragments"]>[number];
/** „chars“: jedes Zeichen ein Teil; sonst die eigenen Teile in Code-Reihenfolge. */
export type Split = "chars" | string[];

/** Frage am Finale, wenn das Kuppeln ein neues Rätsel anlegt. */
export const FINAL_QUESTION = "Setzt eure Codeteile ein.";

/** Codeteile in Code-Reihenfolge; Lücken im Entwurf fallen weg. */
export function sortedFragments(game: Game): Fragment[] {
  return (game.fragments ?? []).filter((f) => f && typeof f === "object").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Finalcode aus den Teilen, z. B. „191“. */
export function finalCode(game: Game): string {
  return sortedFragments(game)
    .map((f) => (typeof f.value === "string" ? f.value : ""))
    .join("");
}

/** Teile eines Codes: jedes Zeichen einzeln oder die eigenen Teile ohne leere. */
export function splitCode(code: string, split: Split): string[] {
  return split === "chars" ? Array.from(code) : split.filter((p) => p !== "");
}

/** Wie der Code geteilt ist: ein Zeichen je Teil (oder noch keine Teile) oder eigene Teile. */
export function splitMode(game: Game): "chars" | "custom" {
  return sortedFragments(game).every((f) => Array.from(f.value ?? "").length === 1) ? "chars" : "custom";
}

export function finalStation(game: Game): Station | undefined {
  return (game.stations ?? []).find((s) => s?.final === true);
}

/** Station, die ein Codeteil vergibt (die erste, falls es mehrere sind). */
export function fragmentGiver(game: Game, fragmentId: string): Station | undefined {
  return (game.stations ?? []).find((s) => (s?.rewards?.fragments ?? []).includes(fragmentId));
}

/** Das Finale folgt dem Code: Code- oder Text-Rätsel, dessen einzige Antwort der Finalcode ist. */
export function isCoupled(game: Game): boolean {
  const task = finalStation(game)?.task;
  const code = finalCode(game);
  return !!code && (task?.type === "code" || task?.type === "text") && task.answers?.length === 1 && task.answers[0] === code;
}

/**
 * Finale an den Finalcode koppeln: Antwort = Code; ohne Rätsel entsteht ein Code-Rätsel. Andere
 * Rätselarten (Auswahl, Foto, Ort) lassen sich nicht koppeln. Entkoppeln ändert das Spiel nicht –
 * es heißt nur, dass setFinalCode das Finale nicht mehr mitzieht (follow: false).
 * Liefert, ob das Finale danach gekoppelt ist.
 */
export function coupleFinal(game: Game, on: boolean): boolean {
  if (!on) return false;
  const final = finalStation(game);
  const code = finalCode(game);
  if (!final || !code) return false;
  const task = final.task;
  if (!task) {
    final.task = { type: "code", question: { [game.meta?.languages?.[0] ?? "de"]: FINAL_QUESTION }, answers: [code] };
    return true;
  }
  if (task.type !== "code" && task.type !== "text") return false;
  task.answers = [code];
  return true;
}

/**
 * Neuer Finalcode: vorhandene Teile behalten ID und Vergabe und bekommen den neuen Wert, fehlende
 * entstehen als teil-<n> (noch ohne Station), überzählige verschwinden samt Verweisen. Bei eigenen
 * Teilen zählt split, code ist dann deren Verkettung. Ein gekoppeltes Finale folgt (follow, Standard:
 * gekoppelt vor der Änderung).
 */
export function setFinalCode(game: Game, code: string, split: Split, opts: { follow?: boolean } = {}): void {
  const follow = opts.follow ?? isCoupled(game);
  const parts = splitCode(code, split);
  const existing = sortedFragments(game);
  for (const f of existing.slice(parts.length)) removeWithReferences(game, "teil", f.id);
  for (const s of game.stations ?? []) if (s?.rewards && !Object.keys(s.rewards).length) delete s.rewards;
  const kept = existing.slice(0, parts.length);
  const taken = new Set(takenIds(game, "teil"));
  const next: Fragment[] = parts.map((value, k) => {
    const f = kept[k];
    if (f) return Object.assign(f, { position: k + 1, value });
    const id = newId("teil", "", taken);
    taken.add(id);
    return { id, position: k + 1, value };
  });
  if (next.length) game.fragments = next;
  else delete game.fragments;
  if (follow && next.length) coupleFinal(game, true);
}

/** Codeteil an genau eine Station vergeben (oder an niemanden: stationId null). */
export function assignFragment(game: Game, fragmentId: string, stationId: string | null): void {
  for (const s of game.stations ?? []) {
    const r = s?.rewards;
    if (!r?.fragments?.includes(fragmentId) || s.id === stationId) continue;
    r.fragments = r.fragments.filter((id) => id !== fragmentId);
    if (!r.fragments.length) delete r.fragments;
    if (!Object.keys(r).length) delete s.rewards;
  }
  if (stationId === null) return;
  const station = (game.stations ?? []).find((s) => s?.id === stationId);
  if (!station) return;
  station.rewards ??= {};
  if (!(station.rewards.fragments ?? []).includes(fragmentId)) station.rewards.fragments = [...(station.rewards.fragments ?? []), fragmentId];
}
