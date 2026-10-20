import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Game } from "@lykora/spec";
import { checkAnswer, editDistance } from "../src/engine/answers.ts";
import { reduceTeam, type EngineAction } from "../src/engine/team.ts";
import { standings } from "../src/engine/standings.ts";

const game = (): Game =>
  JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8"));

let seq = 0;
const T0 = Date.parse("2027-10-19T18:00:00Z");
const act = (min: number, type: EngineAction["type"], payload: Record<string, unknown> = {}, source: "team" | "staff" = "team"): EngineAction => ({
  clientId: `a${++seq}`,
  source,
  type,
  payload,
  time: T0 + min * 60_000,
  seq,
});
const ctx = (g = game()) => ({ game: g, eventStartedAt: T0, pauses: [] });

/** Löst das Beispielspiel komplett. */
const fullRun = (offset = 0): EngineAction[] => [
  act(offset + 0, "start"),
  act(offset + 1, "trigger", { station: "briefing", method: "qr" }),
  act(offset + 2, "answer", { station: "briefing", choice: [0] }),
  act(offset + 5, "trigger", { station: "baum", method: "gps" }),
  act(offset + 6, "answer", { station: "baum", text: " eule " }),
  act(offset + 9, "trigger", { station: "schloss", method: "gps" }),
  act(offset + 10, "answer", { station: "schloss", text: "372" }),
  act(offset + 12, "trigger", { station: "versteck", method: "gps" }),
  act(offset + 13, "answer", { station: "versteck", upload: "foto-1" }),
  act(offset + 15, "trigger", { station: "finale", method: "qr" }),
  act(offset + 16, "answer", { station: "finale", text: "191" }),
];

describe("Antwortprüfung", () => {
  it("toleriert Groß/klein, Leerzeichen und kleine Tippfehler", () => {
    const task = { type: "text" as const, question: "?", answers: ["Rotes Kreuz"] };
    expect(checkAnswer(task, { text: "rotes kreuz" })).toBe("correct");
    expect(checkAnswer(task, { text: "Rotes  Kreutz" })).toBe("correct");
    expect(checkAnswer(task, { text: "Blaues Kreuz" })).toBe("wrong");
  });

  it("erlaubt bei kurzen Antworten keine Tippfehler", () => {
    const task = { type: "text" as const, question: "?", answers: ["Uhu"] };
    expect(checkAnswer(task, { text: "Uhi" })).toBe("wrong");
  });

  it("prüft Codes exakt", () => {
    const task = { type: "code" as const, question: "?", answers: ["0372"] };
    expect(checkAnswer(task, { text: "372" })).toBe("wrong");
    expect(checkAnswer(task, { text: "0372" })).toBe("correct");
  });

  it("verlangt bei Multiple Choice genau die richtigen Optionen", () => {
    const task = {
      type: "choice" as const,
      question: "?",
      options: [
        { text: "a", correct: true },
        { text: "b", correct: true },
        { text: "c", correct: false },
      ],
    };
    expect(checkAnswer(task, { choice: [1, 0] })).toBe("correct");
    expect(checkAnswer(task, { choice: [0] })).toBe("wrong");
  });

  it("berechnet den Editierabstand", () => {
    expect(editDistance("kitten", "sitting", 5)).toBe(3);
    expect(editDistance("abc", "abcdefgh", 2)).toBe(3);
  });
});

describe("Spielstand eines Teams", () => {
  it("spielt das Beispielspiel bis zum Finale", () => {
    const s = reduceTeam(ctx(), fullRun());
    expect(s.outcomes.filter((o) => o.status !== "ok")).toEqual([]);
    expect(Object.keys(s.solved)).toEqual(["briefing", "baum", "schloss", "versteck", "finale"]);
    expect(s.fragments.sort()).toEqual(["f1", "f2", "f3"]);
    expect(s.items).toEqual(["uv-lampe"]);
    expect(s.finishedAt).toBe(T0 + 16 * 60_000);
    // 50 Briefing + 4 × 100
    expect(s.points).toBe(450);
    expect(s.messages.map((m) => m.key)).toEqual(["rule:versteck-freischalten:then:1"]);
  });

  it("wertet nach Zeitstempel, nicht nach Eingang", () => {
    const actions = fullRun();
    const s = reduceTeam(ctx(), [...actions].reverse());
    expect(s.finishedAt).toBe(T0 + 16 * 60_000);
  });

  it("lehnt versteckte Stationen ab, bis eine Regel sie freischaltet", () => {
    const s = reduceTeam(ctx(), [act(0, "trigger", { station: "versteck", method: "gps" })]);
    expect(s.outcomes[0]).toMatchObject({ status: "rejected", reason: "hidden" });
  });

  it("schaltet das Finale erst mit allen Fragmenten frei", () => {
    const s = reduceTeam(ctx(), [act(0, "trigger", { station: "finale", method: "qr" })]);
    expect(s.outcomes[0]).toMatchObject({ status: "rejected", reason: "fragments_missing" });
  });

  it("verlangt einen Auslöser vor der Antwort", () => {
    const s = reduceTeam(ctx(), [act(0, "answer", { station: "baum", text: "Eule" })]);
    expect(s.outcomes[0]).toMatchObject({ status: "rejected", reason: "not_triggered" });
  });

  it("verrechnet Fehler und Hinweise als Zeitstrafe", () => {
    const s = reduceTeam(ctx(), [
      act(0, "trigger", { station: "baum", method: "gps" }),
      act(1, "answer", { station: "baum", text: "Fuchs" }),
      act(2, "hint", { station: "baum", level: 1 }),
      act(3, "hint", { station: "baum", level: 2 }),
      act(4, "hint", { station: "baum", level: 2 }),
    ]);
    expect(s.wrongAnswers).toBe(1);
    expect(s.hintsUsed).toBe(2);
    expect(s.timePenalty).toBe(30 + 60 + 120);
    expect(s.outcomes[4]).toMatchObject({ status: "ignored" });
  });

  it("sperrt bei Lockout-Strafe weitere Antworten", () => {
    const g = game();
    g.settings.wrongAnswer = { type: "lockout", amount: 120 };
    const s = reduceTeam(ctx(g), [
      act(0, "trigger", { station: "baum", method: "gps" }),
      act(1, "answer", { station: "baum", text: "Fuchs" }),
      act(2, "answer", { station: "baum", text: "Eule" }),
      act(4, "answer", { station: "baum", text: "Eule" }),
    ]);
    expect(s.outcomes.map((o) => o.status)).toEqual(["ok", "ok", "rejected", "ok"]);
    expect("baum" in s.solved).toBe(true);
  });

  it("lehnt Aktionen nach Ablauf der Zeit ab, Pausen zählen nicht", () => {
    const run = [act(0, "start"), act(50, "trigger", { station: "baum", method: "gps" })];
    expect(reduceTeam(ctx(), run).outcomes[1]).toMatchObject({ reason: "time_up" });
    const paused = { ...ctx(), pauses: [{ from: T0 + 10 * 60_000, to: T0 + 20 * 60_000 }] };
    expect(reduceTeam(paused, run).outcomes[1]).toMatchObject({ status: "ok" });
  });

  it("wartet bei Foto-Prüfung auf die Spielleitung", () => {
    const g = game();
    const versteck = g.stations.find((s) => s.id === "versteck")!;
    versteck.task = { type: "photo", prompt: "Foto", review: "live" };
    const base = fullRun().slice(0, 9);
    const pending = reduceTeam(ctx(g), base);
    expect(pending.pendingReviews).toEqual(["versteck"]);
    const approved = reduceTeam(ctx(g), [...base, act(14, "staff_solve", { station: "versteck" }, "staff")]);
    expect(approved.fragments).toContain("f3");
    expect(approved.pendingReviews).toEqual([]);
  });

  it("führt Sonst-Aktionen aus, wenn nur die erste Bedingung erfüllt ist", () => {
    const g = game();
    g.rules = [
      {
        id: "mit-lampe",
        when: [{ station_solved: "baum" }, { has_item: "uv-lampe" }],
        then: [{ add_points: 10 }],
        else: [{ add_points: -5 }],
      },
    ];
    const s = reduceTeam(ctx(g), [
      act(0, "trigger", { station: "baum", method: "gps" }),
      act(1, "answer", { station: "baum", text: "Eule" }),
    ]);
    expect(s.points).toBe(95);
  });
});

describe("Wertung", () => {
  it("vergibt Ränge nach Siegbedingung und Erster-am-Ort-Bonus", () => {
    const g = game();
    g.settings.scoring = { ...g.settings.scoring, firstOnSiteBonus: 20 };
    const fast = reduceTeam(ctx(g), fullRun(0));
    const slow = reduceTeam(ctx(g), fullRun(5));
    const idle = reduceTeam(ctx(g), [act(0, "start")]);
    const r = standings(g, { eventStartedAt: T0, pauses: [] }, [
      { id: "slow", state: slow },
      { id: "idle", state: idle },
      { id: "fast", state: fast },
    ]);
    expect(r.map((x) => x.teamId)).toEqual(["fast", "slow", "idle"]);
    expect(r[0]!.points).toBe(450 + 5 * 20);
    expect(r[0]!.finishTime).toBe(16 * 60);
    expect(r[1]!.firstOnSite).toEqual([]);
  });
});
