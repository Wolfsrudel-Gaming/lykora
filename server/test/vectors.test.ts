import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Game } from "@lykora/spec";
import { reduceTeam, type EngineAction, type TeamContext } from "../src/engine/team.ts";

// Gemeinsame Testfälle mit der App, siehe spec/test-vectors/engine.json.
const vectorsUrl = new URL("../../spec/test-vectors/engine.json", import.meta.url);
const vectors = JSON.parse(readFileSync(vectorsUrl, "utf8"));
const readGame = (path: string): Game => JSON.parse(readFileSync(new URL(path, vectorsUrl), "utf8"));
const baseGame: Game = readGame(vectors.game);
const T0 = Date.parse(vectors.t0);
const at = (min: number) => T0 + min * 60_000;

/** Setzt einen Wert über einen Pfad wie "settings.wrongAnswer" oder "stations[baum].task". */
export function applyPatch(target: any, path: string, value: unknown) {
  const parts = path.split(".");
  let obj = target;
  parts.forEach((part, i) => {
    const m = /^(\w+)\[(.+)\]$/.exec(part);
    const last = i === parts.length - 1;
    if (m) {
      const item = obj[m[1]!].find((x: any) => x.id === m[2]);
      if (last) throw new Error("Pfad darf nicht auf ein Listenelement enden");
      obj = item;
    } else if (last) {
      obj[part] = value;
    } else {
      obj[part] ??= {};
      obj = obj[part];
    }
  });
}

describe("gemeinsame Engine-Testfälle", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      // Ein Fall kann ein eigenes Spiel nennen ("game"), sonst gilt das Spiel der Datei.
      const game: Game = c.game ? readGame(c.game) : structuredClone(baseGame);
      for (const p of c.patch ?? []) applyPatch(game, p.path, p.value);
      const ctx: TeamContext = {
        game,
        eventStartedAt: at(c.ctx?.eventStartedAt ?? 0),
        endedAt: c.ctx?.endedAt != null ? at(c.ctx.endedAt) : null,
        pauses: (c.ctx?.pauses ?? []).map(([a, b]: [number, number | null]) => ({ from: at(a), to: b === null ? null : at(b) })),
        blockReason: c.ctx?.blockReason ?? null,
      };
      const actions: EngineAction[] = c.actions.map(([min, type, payload, source]: any[], i: number) => ({
        clientId: `a${i}`,
        type,
        payload,
        source: source ?? "team",
        time: at(min),
        seq: i,
      }));
      const state = reduceTeam(ctx, actions);
      const byId = new Map(state.outcomes.map((o) => [o.clientId, o]));
      const e = c.expect;
      if (e.outcomes) {
        expect(actions.map((a) => byId.get(a.clientId)).map((o) => (o!.status === "ok" ? "ok" : `${o!.status}:${o!.reason}`))).toEqual(e.outcomes);
      }
      if (e.verdicts) expect(actions.map((a) => byId.get(a.clientId)!.verdict ?? null)).toEqual(e.verdicts);
      if (e.solved) expect(Object.keys(state.solved).sort()).toEqual([...e.solved].sort());
      if (e.fragments) expect([...state.fragments].sort()).toEqual([...e.fragments].sort());
      if (e.items) expect([...state.items].sort()).toEqual([...e.items].sort());
      if (e.revealed) expect([...state.revealed].sort()).toEqual([...e.revealed].sort());
      if (e.points !== undefined) expect(state.points).toBe(e.points);
      if (e.timePenalty !== undefined) expect(state.timePenalty).toBe(e.timePenalty);
      if (e.hintsUsed !== undefined) expect(state.hintsUsed).toBe(e.hintsUsed);
      if (e.wrongAnswers !== undefined) expect(state.wrongAnswers).toBe(e.wrongAnswers);
      if (e.pendingReviews) expect(state.pendingReviews).toEqual(e.pendingReviews);
      if (e.finishedAt !== undefined) expect(state.finishedAt).toBe(e.finishedAt === null ? null : at(e.finishedAt));
      if (e.messages) expect(state.messages.map((m) => m.key)).toEqual(e.messages);
    });
  }
});
