import type { Game } from "@lykora/spec";
import { elapsedAt, type TeamContext, type TeamState } from "./team.ts";

export interface TeamResult {
  teamId: string;
  rank: number;
  points: number;
  solved: number;
  fragments: number;
  hintsUsed: number;
  finished: boolean;
  /** Spielzeit bis zum Ziel inklusive Zeitstrafen, in Sekunden */
  finishTime: number | null;
  firstOnSite: string[];
}

/**
 * Wertung über alle Teams. Der Erster-am-Ort-Bonus braucht alle Teams und wird
 * deshalb erst hier vergeben: Er geht an das Team mit dem frühesten Lösezeitpunkt.
 */
export function standings(
  game: Game,
  ctx: Omit<TeamContext, "game">,
  teams: { id: string; state: TeamState }[],
): TeamResult[] {
  const bonus = game.settings.scoring?.firstOnSiteBonus ?? 0;
  const first = new Map<string, { teamId: string; time: number }>();
  for (const { id, state } of teams) {
    for (const [station, time] of Object.entries(state.solved)) {
      const best = first.get(station);
      if (!best || time < best.time) first.set(station, { teamId: id, time });
    }
  }

  const results = teams.map(({ id, state }) => {
    const firstOnSite = [...first].filter(([, v]) => v.teamId === id).map(([station]) => station);
    const finishTime =
      state.finishedAt === null
        ? null
        : elapsedAt({ ...ctx, game }, state, state.finishedAt) + state.timePenalty;
    return {
      teamId: id,
      rank: 0,
      points: state.points + (bonus > 0 ? firstOnSite.length * bonus : 0),
      solved: Object.keys(state.solved).length,
      fragments: state.fragments.length,
      hintsUsed: state.hintsUsed,
      finished: state.finishedAt !== null,
      finishTime,
      firstOnSite: bonus > 0 ? firstOnSite : [],
    };
  });

  const tieBreak = (a: TeamResult, b: TeamResult) =>
    game.settings.scoring?.tieBreak === "earlier_finish"
      ? (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || a.hintsUsed - b.hintsUsed
      : a.hintsUsed - b.hintsUsed || (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);

  const byFinish = (a: TeamResult, b: TeamResult) =>
    Number(b.finished) - Number(a.finished) || (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);

  const compare: Record<string, (a: TeamResult, b: TeamResult) => number> = {
    first_escape: (a, b) => byFinish(a, b) || b.points - a.points || tieBreak(a, b),
    most_points: (a, b) => b.points - a.points || tieBreak(a, b),
    all_fragments_in_time: (a, b) => b.fragments - a.fragments || byFinish(a, b) || b.points - a.points || tieBreak(a, b),
  };
  const winCondition = game.settings.winCondition ?? "first_escape";
  const cmp = compare[winCondition]!;
  results.sort(cmp);
  results.forEach((r, i) => {
    const prev = results[i - 1];
    r.rank = prev && cmp(prev, r) === 0 ? prev.rank : i + 1;
  });
  return results;
}
