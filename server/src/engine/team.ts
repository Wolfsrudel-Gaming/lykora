import type { Game, Penalty, Rule, Station, Text } from "@lykora/spec";
import { distance } from "../lib/geo.ts";
import { checkAnswer, type AnswerInput } from "./answers.ts";

/**
 * Der Spielstand eines Teams wird vollständig aus seinem Aktionsprotokoll berechnet.
 * Offline erledigte Aktionen kommen später an und werden nach Zeitstempel einsortiert;
 * dadurch kann sich der Stand nachträglich ändern. Der Server entscheidet.
 */

export const TEAM_ACTIONS = ["start", "trigger", "answer", "hint", "heartbeat", "arrived"] as const;
export const STAFF_ACTIONS = [
  "staff_reveal",
  "staff_lock",
  "staff_unlock",
  "staff_solve",
  "staff_reject",
  "staff_points",
  "staff_time",
  "staff_item",
] as const;
export type ActionType = (typeof TEAM_ACTIONS)[number] | (typeof STAFF_ACTIONS)[number];

export interface EngineAction {
  clientId: string;
  source: "team" | "staff";
  type: ActionType;
  payload: Record<string, any>;
  /** Zeitpunkt in ms seit Epoche */
  time: number;
  /** Eingangsreihenfolge, entscheidet bei gleichem Zeitstempel */
  seq: number;
}

export type OutcomeStatus = "ok" | "rejected" | "ignored";

export interface Outcome {
  clientId: string;
  status: OutcomeStatus;
  reason?: string;
  verdict?: "correct" | "wrong" | "pending";
}

export interface GeneratedMessage {
  key: string;
  from: "hq" | "narrator" | "npc";
  text: Text;
  time: number;
}

export interface TeamState {
  startedAt: number | null;
  finishedAt: number | null;
  triggered: string[];
  solved: Record<string, number>;
  revealed: string[];
  locked: string[];
  fragments: string[];
  items: string[];
  chapters: string[];
  hints: Record<string, number>;
  hintsUsed: number;
  wrongAnswers: number;
  points: number;
  /** Zeitstrafen in Sekunden */
  timePenalty: number;
  lockedUntil: number | null;
  pendingReviews: string[];
  firedRules: string[];
  messages: GeneratedMessage[];
  outcomes: Outcome[];
}

export interface TeamContext {
  game: Game;
  /** Start des Events in ms; Bezug für ein globales Zeitlimit */
  eventStartedAt: number | null;
  /** Pausen des Events in ms */
  pauses: { from: number; to: number | null }[];
  /** Ende des Events in ms */
  endedAt?: number | null;
  /** Grund, warum das Team gerade nicht spielen darf, z. B. fehlender Betreuer */
  blockReason?: string | null;
}

export function pausedBetween(pauses: TeamContext["pauses"], from: number, to: number): number {
  let total = 0;
  for (const p of pauses) {
    const a = Math.max(p.from, from);
    const b = Math.min(p.to ?? to, to);
    if (b > a) total += b - a;
  }
  return total;
}

/** Spielzeit in Sekunden zum Zeitpunkt t, ohne Pausen und ohne Strafen. */
export function elapsedAt(ctx: TeamContext, state: TeamState, t: number): number {
  const limit = ctx.game.settings.time?.limit ?? "per_team";
  const start = limit === "global" ? (ctx.eventStartedAt ?? state.startedAt) : state.startedAt;
  if (start === null) return 0;
  return Math.max(0, (t - start - pausedBetween(ctx.pauses, start, t)) / 1000);
}

function isTimeUp(ctx: TeamContext, state: TeamState, t: number): boolean {
  const time = ctx.game.settings.time;
  if (!time || time.limit === "none" || !time.duration) return false;
  return elapsedAt(ctx, state, t) + state.timePenalty > time.duration;
}

/** Prüft, ob Teams zum Zeitpunkt t überhaupt spielen dürfen. */
function gateReason(ctx: TeamContext, t: number): string | null {
  if (ctx.blockReason) return ctx.blockReason;
  if (ctx.eventStartedAt === null || t < ctx.eventStartedAt) return "not_started";
  if (ctx.endedAt != null && t > ctx.endedAt) return "ended";
  if (ctx.pauses.some((p) => t >= p.from && (p.to === null || t < p.to))) return "paused";
  return null;
}

export function emptyState(): TeamState {
  return {
    startedAt: null,
    finishedAt: null,
    triggered: [],
    solved: {},
    revealed: [],
    locked: [],
    fragments: [],
    items: [],
    chapters: [],
    hints: {},
    hintsUsed: 0,
    wrongAnswers: 0,
    points: 0,
    timePenalty: 0,
    lockedUntil: null,
    pendingReviews: [],
    firedRules: [],
    messages: [],
    outcomes: [],
  };
}

const add = (list: string[], value: string) => {
  if (!list.includes(value)) list.push(value);
};
const remove = (list: string[], value: string) => {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
};

export function sortActions(actions: EngineAction[]): EngineAction[] {
  return [...actions].sort((a, b) => a.time - b.time || a.seq - b.seq);
}

export function reduceTeam(ctx: TeamContext, actions: EngineAction[]): TeamState {
  const { game } = ctx;
  const stations = new Map(game.stations.map((s) => [s.id, s]));
  const state = emptyState();
  // Sorgt für Serien-Bonus: nur gelöste Stationen ohne Fehler oder Hinweis dazwischen zählen.
  let streak = 0;
  let lastLocation: { lat: number; lon: number } | null = null;

  const allFragments = () => (game.fragments ?? []).every((f) => state.fragments.includes(f.id));

  const isAvailable = (s: Station) =>
    !state.locked.includes(s.id) &&
    (s.visibility !== "hidden" || state.revealed.includes(s.id)) &&
    (!s.final || allFragments());

  const applyPenalty = (penalty: Penalty | undefined, t: number) => {
    if (!penalty) return;
    const amount = penalty.amount ?? 0;
    if (penalty.type === "time") state.timePenalty += amount;
    else if (penalty.type === "points") state.points -= amount;
    else if (penalty.type === "lockout") state.lockedUntil = Math.max(state.lockedUntil ?? 0, t + amount * 1000);
  };

  const conditionHolds = (c: Rule["when"][number], t: number): boolean => {
    if ("station_solved" in c) return c.station_solved in state.solved;
    if ("has_item" in c) return state.items.includes(c.has_item);
    if ("fragments_collected" in c) return state.fragments.length >= c.fragments_collected;
    if ("elapsed" in c) return elapsedAt(ctx, state, t) >= c.elapsed;
    if ("near" in c) return lastLocation !== null && distance(lastLocation, c.near.location) <= c.near.radius;
    return false;
  };

  const runRuleActions = (rule: Rule, list: Rule["then"], branch: string, t: number) => {
    list.forEach((a, i) => {
      if ("reveal_station" in a) add(state.revealed, a.reveal_station);
      else if ("give_item" in a) add(state.items, a.give_item);
      else if ("add_points" in a) state.points += a.add_points;
      else if ("start_chapter" in a) add(state.chapters, a.start_chapter);
      else if ("message" in a) {
        state.messages.push({ key: `rule:${rule.id}:${branch}:${i}`, from: a.message.from ?? "hq", text: a.message.text, time: t });
      }
    });
  };

  // „Sonst“ greift, wenn die erste Bedingung erfüllt ist, aber nicht alle.
  const evaluateRules = (t: number) => {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      for (const rule of game.rules ?? []) {
        const once = rule.once ?? true;
        if (once && state.firedRules.includes(rule.id)) continue;
        const results = rule.when.map((c) => conditionHolds(c, t));
        if (results.every(Boolean)) {
          runRuleActions(rule, rule.then, "then", t);
        } else if (rule.else?.length && results[0]) {
          runRuleActions(rule, rule.else, "else", t);
        } else continue;
        add(state.firedRules, rule.id);
        changed = once;
      }
    }
  };

  const solve = (s: Station, t: number, clean: boolean) => {
    if (s.id in state.solved) return;
    state.solved[s.id] = t;
    remove(state.pendingReviews, s.id);
    const r = s.rewards ?? {};
    state.points += r.points ?? game.settings.scoring?.solvePoints ?? 100;
    streak = clean ? streak + 1 : 0;
    if (streak > 1) state.points += game.settings.scoring?.streakBonus ?? 0;
    for (const f of r.fragments ?? []) add(state.fragments, f);
    for (const i of r.items ?? []) add(state.items, i);
    for (const st of r.reveal ?? []) add(state.revealed, st);
    if (r.chapter) add(state.chapters, r.chapter);
    if (s.final && state.finishedAt === null) state.finishedAt = t;
  };

  // Ob seit der letzten gelösten Station ein Fehler oder Hinweis passiert ist.
  let cleanSinceLastSolve = true;

  for (const action of sortActions(actions)) {
    const t = action.time;
    const p = action.payload;
    const out: Outcome = { clientId: action.clientId, status: "ok" };
    state.outcomes.push(out);
    const reject = (reason: string) => {
      out.status = "rejected";
      out.reason = reason;
    };
    const ignore = (reason: string) => {
      out.status = "ignored";
      out.reason = reason;
    };

    if (p.location && typeof p.location.lat === "number") lastLocation = p.location;

    if (action.source === "team") {
      if (action.type === "heartbeat" || action.type === "arrived") continue;
      const gate = gateReason(ctx, t);
      if (gate) {
        reject(gate);
        continue;
      }
      if (state.startedAt === null) state.startedAt = t;
      if (action.type === "start") continue;
      if (state.finishedAt !== null) {
        ignore("finished");
        continue;
      }
      if (isTimeUp(ctx, state, t)) {
        reject("time_up");
        continue;
      }
    }

    const station = typeof p.station === "string" ? stations.get(p.station) : undefined;
    const needsStation = action.type !== "staff_points" && action.type !== "staff_time" && action.type !== "staff_item";
    if (needsStation && !station) {
      reject("unknown_station");
      continue;
    }

    switch (action.type) {
      case "trigger": {
        const s = station!;
        const revealByProximity = s.visibility === "hidden" && s.revealRadius !== undefined && p.method === "gps";
        if (revealByProximity && !state.revealed.includes(s.id)) add(state.revealed, s.id);
        if (!isAvailable(s)) {
          reject(state.locked.includes(s.id) ? "locked" : s.final ? "fragments_missing" : "hidden");
          break;
        }
        if (state.triggered.includes(s.id)) ignore("already_triggered");
        else add(state.triggered, s.id);
        break;
      }
      case "answer": {
        const s = station!;
        if (!s.task) {
          reject("no_task");
          break;
        }
        if (!state.triggered.includes(s.id)) {
          reject("not_triggered");
          break;
        }
        if (s.id in state.solved) {
          ignore("already_solved");
          break;
        }
        if (state.pendingReviews.includes(s.id)) {
          ignore("review_pending");
          break;
        }
        if (state.lockedUntil !== null && t < state.lockedUntil) {
          reject("locked_out");
          break;
        }
        const verdict = checkAnswer(s.task, p as AnswerInput);
        out.verdict = verdict;
        if (verdict === "correct") {
          solve(s, t, cleanSinceLastSolve);
          cleanSinceLastSolve = true;
        } else if (verdict === "pending") {
          add(state.pendingReviews, s.id);
        } else {
          state.wrongAnswers++;
          cleanSinceLastSolve = false;
          applyPenalty(game.settings.wrongAnswer, t);
        }
        break;
      }
      case "hint": {
        const s = station!;
        const used = state.hints[s.id] ?? 0;
        const level = Number(p.level ?? used + 1);
        if (game.settings.hints?.enabled === false) {
          reject("hints_disabled");
          break;
        }
        if (level <= used) {
          ignore("already_used");
          break;
        }
        if (level !== used + 1 || level > (s.hints?.length ?? 0)) {
          reject("invalid_level");
          break;
        }
        state.hints[s.id] = level;
        state.hintsUsed++;
        cleanSinceLastSolve = false;
        applyPenalty(s.hints![level - 1]!.cost ?? game.settings.hints?.defaultCost?.[level - 1], t);
        break;
      }
      case "staff_reveal":
        add(state.revealed, station!.id);
        remove(state.locked, station!.id);
        break;
      case "staff_lock":
        add(state.locked, station!.id);
        break;
      case "staff_unlock":
        remove(state.locked, station!.id);
        add(state.revealed, station!.id);
        break;
      case "staff_solve":
        add(state.triggered, station!.id);
        solve(station!, t, false);
        break;
      case "staff_reject":
        remove(state.pendingReviews, station!.id);
        break;
      case "staff_points":
        state.points += Number(p.amount) || 0;
        break;
      case "staff_time":
        state.timePenalty += Number(p.seconds) || 0;
        break;
      case "staff_item":
        if (typeof p.item !== "string") reject("unknown_item");
        else if (p.remove) remove(state.items, p.item);
        else add(state.items, p.item);
        break;
      default:
        reject("unknown_type");
    }

    if (out.status === "ok") evaluateRules(t);
  }

  return state;
}
