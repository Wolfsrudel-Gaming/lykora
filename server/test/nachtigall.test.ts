import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Game, Station, Text } from "@lykora/spec";
import { reduceTeam, type EngineAction, type TeamContext } from "../src/engine/team.ts";
import { standings } from "../src/engine/standings.ts";
import { distance } from "../src/lib/geo.ts";

// Durchspielen der Beispielgeschichte „Nachtigall“ mit der echten Engine: jede Station, alle fünf
// Aufgabentypen, Hinweis und Fehlversuch, Regeln, Fragmente, Finale. Dazu Prüfungen der Geschichte
// selbst (Rätsel passen zu den Dokumenten), damit ein späterer Umbau keine Logiklöcher hinterlässt.

const gameUrl = new URL("../../spec/v0.1/examples/nachtigall-wetterwarte.json", import.meta.url);
const load = (): Game => JSON.parse(readFileSync(gameUrl, "utf8"));
const library: { id: string }[] = JSON.parse(readFileSync(new URL("../media-library/library.json", import.meta.url), "utf8"));

const T0 = Date.parse("2026-10-24T18:00:00Z");
const de = (t: Text | undefined): string => (typeof t === "string" ? t : (t?.de ?? ""));
const station = (g: Game, id: string): Station => {
  const s = g.stations.find((x) => x.id === id);
  if (!s) throw new Error(`Station ${id} fehlt`);
  return s;
};
const item = (g: Game, id: string) => g.items!.find((i) => i.id === id)!;
const correctOptions = (g: Game, id: string): number[] => {
  const task = station(g, id).task;
  if (task?.type !== "choice") throw new Error("keine Auswahl");
  return task.options.flatMap((o, i) => (o.correct ? [i] : []));
};
const answerOf = (g: Game, id: string): string => {
  const task = station(g, id).task;
  if (task?.type !== "text" && task?.type !== "code") throw new Error("keine Texteingabe");
  return task.answers[0]!;
};
const targetOf = (g: Game, id: string) => {
  const task = station(g, id).task;
  if (task?.type !== "find_location") throw new Error("kein Ort");
  return task.location;
};

/** Baut ein Aktionsprotokoll mit Minuten ab Start. */
function recorder() {
  let seq = 0;
  const actions: EngineAction[] = [];
  const act = (min: number, type: EngineAction["type"], payload: Record<string, unknown> = {}) => {
    actions.push({ clientId: `a${++seq}`, source: "team", type, payload, time: T0 + min * 60_000, seq });
    return actions.length - 1;
  };
  return { actions, act };
}

const ctx = (game: Game): TeamContext => ({ game, eventStartedAt: T0, pauses: [] });

/** Schnelles Team: alles inklusive Bonus, mit einem Fehlversuch und einem Hinweis an der Bank. */
function fastRun(g: Game) {
  const { actions, act } = recorder();
  const idx: Record<string, number> = {};
  act(0, "start");
  act(2, "trigger", { station: "schlagbaum", method: "qr" });
  idx.schlagbaum = act(5, "answer", { station: "schlagbaum", choice: correctOptions(g, "schlagbaum") });
  idx.eicheVorzeitig = act(6, "trigger", { station: "eiche", method: "gps" });
  act(8, "trigger", { station: "bank", method: "gps" });
  idx.bankFalsch = act(9, "answer", { station: "bank", text: "MORSE" });
  idx.bankHinweis = act(10, "hint", { station: "bank", level: 1 });
  idx.bank = act(12, "answer", { station: "bank", text: " marke " });
  act(14, "trigger", { station: "schaukasten", method: "qr" });
  idx.schaukasten = act(15, "answer", { station: "schaukasten", text: "1989" });
  act(17, "trigger", { station: "eiche", method: "manual" });
  idx.eiche = act(18, "answer", { station: "eiche", upload: "foto-eiche" });
  act(20, "trigger", { station: "antennenplatz", method: "gps" });
  const start = station(g, "antennenplatz").location!;
  idx.ortFalsch = act(21, "answer", { station: "antennenplatz", location: { ...start, accuracy: 5 } });
  const ziel = targetOf(g, "antennenplatz");
  idx.antennenplatz = act(24, "answer", { station: "antennenplatz", location: { lat: ziel.lat + 0.00005, lon: ziel.lon, accuracy: 6 } });
  idx.finaleVorzeitig = act(26, "trigger", { station: "wetterwarte", method: "qr" });
  act(28, "trigger", { station: "hochsitz", method: "gps" });
  idx.hochsitz = act(30, "answer", { station: "hochsitz", choice: correctOptions(g, "hochsitz") });
  act(32, "trigger", { station: "muehlsteg", method: "gps" });
  idx.muehlsteg = act(34, "answer", { station: "muehlsteg", text: "3331" });
  act(36, "trigger", { station: "nest", method: "gps" });
  idx.nest = act(37, "answer", { station: "nest", text: "7" });
  act(40, "trigger", { station: "wetterwarte", method: "qr" });
  idx.wetterwarte = act(42, "answer", { station: "wetterwarte", text: "1455" });
  return { actions, idx };
}

/** Langsames Team: lässt das Nest aus und lässt sich Zeit, damit die Zeit-Regeln feuern. */
function slowRun(g: Game) {
  const { actions, act } = recorder();
  act(0, "start");
  act(3, "trigger", { station: "schlagbaum", method: "gps" });
  act(9, "answer", { station: "schlagbaum", choice: correctOptions(g, "schlagbaum") });
  act(15, "trigger", { station: "schaukasten", method: "gps" });
  act(22, "answer", { station: "schaukasten", text: "1989" });
  act(30, "trigger", { station: "bank", method: "gps" });
  act(37, "answer", { station: "bank", text: "MARKE" });
  act(45, "trigger", { station: "eiche", method: "gps" });
  act(52, "answer", { station: "eiche", upload: "foto-eiche-2" });
  act(58, "trigger", { station: "antennenplatz", method: "gps" });
  const ziel = targetOf(g, "antennenplatz");
  act(70, "answer", { station: "antennenplatz", location: { ...ziel, accuracy: 4 } });
  act(76, "trigger", { station: "hochsitz", method: "gps" });
  act(82, "answer", { station: "hochsitz", choice: correctOptions(g, "hochsitz") }); // nach 80 Minuten: Jule wird nervös
  act(95, "trigger", { station: "muehlsteg", method: "gps" });
  act(110, "answer", { station: "muehlsteg", text: "3331" });
  act(131, "trigger", { station: "wetterwarte", method: "qr" }); // nach 130 Minuten: Zeitwarnung
  act(133, "answer", { station: "wetterwarte", text: "1455" });
  return actions;
}

describe("Nachtigall: Durchspielen", () => {
  it("löst alle neun Stationen mit der echten Engine und erreicht das Spielende", () => {
    const g = load();
    const { actions, idx } = fastRun(g);
    const s = reduceTeam(ctx(g), actions);
    const byIndex = (i: number) => s.outcomes[i]!;

    // Vorzeitige Auslöser werden abgewiesen, alles andere läuft.
    expect(byIndex(idx.eicheVorzeitig!)).toMatchObject({ status: "rejected", reason: "hidden" });
    expect(byIndex(idx.finaleVorzeitig!)).toMatchObject({ status: "rejected", reason: "fragments_missing" });
    const rejected = s.outcomes.filter((o) => o.status !== "ok").map((o) => `${o.status}:${o.reason}`);
    expect(rejected).toEqual(["rejected:hidden", "rejected:fragments_missing"]);

    // Fehlversuch und Hinweis.
    expect(byIndex(idx.bankFalsch!).verdict).toBe("wrong");
    expect(byIndex(idx.ortFalsch!).verdict).toBe("wrong");
    expect(byIndex(idx.bank!).verdict).toBe("correct");
    expect(s.wrongAnswers).toBe(2);
    expect(s.hintsUsed).toBe(1);
    expect(s.hints.bank).toBe(1);
    expect(s.timePenalty).toBe(30 + 30 + 60);

    // Alle neun Stationen sind gelöst, in der Reihenfolge der Geschichte.
    expect(Object.entries(s.solved).sort((a, b) => a[1] - b[1]).map(([id]) => id)).toEqual([
      "schlagbaum", "bank", "schaukasten", "eiche", "antennenplatz", "hochsitz", "muehlsteg", "nest", "wetterwarte",
    ]);
    expect(Object.keys(s.solved).sort()).toEqual(g.stations.map((x) => x.id).sort());

    // Fragmente, Gegenstände, Enthüllungen, Kapitel.
    expect([...s.fragments].sort()).toEqual(["f1", "f2", "f3", "f4"]);
    expect([...s.items].sort()).toEqual(g.items!.map((i) => i.id).sort());
    expect([...s.revealed].sort()).toEqual(["antennenplatz", "bank", "eiche", "hochsitz", "muehlsteg", "nest", "schaukasten"]);
    expect(s.chapters).toEqual(["k2", "k3", "k4", "k5"]);

    // Regeln feuern genau einmal; die Zeitregeln noch nicht (nach 42 Minuten).
    expect(s.firedRules.sort()).toEqual(["frequenz-ahnung", "kassette-abspielen", "nest-erscheint", "weg-zusammen"]);
    expect(s.messages.map((m) => m.key)).toEqual([
      "rule:weg-zusammen:then:1",
      "rule:frequenz-ahnung:then:1",
      "rule:nest-erscheint:then:1",
      "rule:kassette-abspielen:then:1",
    ]);
    expect(s.messages.every((m) => m.from === "hq")).toBe(true);

    // Punkte: 50 + 6 × 100 + Nest 150 + Finale 200 + Kassetten-Regel 100.
    expect(s.points).toBe(50 + 600 + 150 + 200 + 100);
    expect(s.finishedAt).toBe(T0 + 42 * 60_000);
  });

  it("ohne Nest feuert der Sonst-Zweig, die Zeitregeln erinnern die Zentrale, das Spiel endet trotzdem", () => {
    const g = load();
    const s = reduceTeam(ctx(g), slowRun(g));
    expect(s.outcomes.filter((o) => o.status !== "ok")).toEqual([]);
    expect(s.finishedAt).toBe(T0 + 133 * 60_000);
    expect("nest" in s.solved).toBe(false);
    expect(s.items).not.toContain("kassette");
    expect(s.messages.map((m) => m.key)).toEqual([
      "rule:weg-zusammen:then:1",
      "rule:frequenz-ahnung:then:1",
      "rule:jule-nervoes:then:0",
      "rule:nest-erscheint:then:1",
      "rule:zeit-warnung:then:0",
      "rule:kassette-abspielen:else:0",
    ]);
    // Sonst-Zweig: keine Bonuspunkte der Kassette.
    expect(s.points).toBe(50 + 600 + 200);
  });

  it("verlangt die Reihenfolge der Geschichte: Spuren, Fragmente und Rätsel greifen ineinander", () => {
    const g = load();
    const try1 = (actions: EngineAction[]) => reduceTeam(ctx(g), actions).outcomes.map((o) => (o.status === "ok" ? "ok" : `${o.status}:${o.reason}`));
    // Nur Schlagbaum und Wegweiser sichtbar: alles andere ist versteckt oder gesperrt.
    const { act, actions } = recorder();
    for (const id of ["bank", "schaukasten", "eiche", "antennenplatz", "hochsitz", "muehlsteg", "nest"]) act(1, "trigger", { station: id, method: "qr" });
    act(2, "trigger", { station: "wetterwarte", method: "qr" });
    expect(try1(actions)).toEqual([...Array(7).fill("rejected:hidden"), "rejected:fragments_missing"]);

    // Auch der zweite Weg allein schaltet den Hörbaum nicht frei.
    const half = recorder();
    half.act(0, "start");
    half.act(1, "trigger", { station: "schlagbaum", method: "qr" });
    half.act(2, "answer", { station: "schlagbaum", choice: correctOptions(g, "schlagbaum") });
    half.act(3, "trigger", { station: "bank", method: "gps" });
    half.act(4, "answer", { station: "bank", text: "Marke" });
    half.act(5, "trigger", { station: "eiche", method: "gps" });
    const state = reduceTeam(ctx(g), half.actions);
    expect(state.outcomes.at(-1)).toMatchObject({ status: "rejected", reason: "hidden" });
    expect(state.revealed).not.toContain("eiche");

    // Eine falsche Auswahl am Schlagbaum löst nichts und kostet 30 Sekunden.
    const wrong = recorder();
    wrong.act(0, "trigger", { station: "schlagbaum", method: "qr" });
    wrong.act(1, "answer", { station: "schlagbaum", choice: [0, 1, 3] });
    wrong.act(2, "answer", { station: "schlagbaum", choice: [0, 1] });
    const w = reduceTeam(ctx(g), wrong.actions);
    expect(w.outcomes.map((o) => o.verdict)).toEqual([undefined, "wrong", "wrong"]);
    expect(w.timePenalty).toBe(60);
    expect(w.solved).toEqual({});
  });

  it("wertet zwei Teams: das schnellere gewinnt bei gleich vielen Fragmenten", () => {
    const g = load();
    const fast = reduceTeam(ctx(g), fastRun(g).actions);
    const slow = reduceTeam(ctx(g), slowRun(g));
    const ranking = standings(g, { eventStartedAt: T0, pauses: [] }, [
      { id: "langsam", state: slow },
      { id: "schnell", state: fast },
    ]);
    expect(ranking.map((r) => [r.teamId, r.rank, r.fragments, r.finished])).toEqual([
      ["schnell", 1, 4, true],
      ["langsam", 2, 4, true],
    ]);
  });
});

describe("Nachtigall: die Geschichte hängt zusammen", () => {
  const g = load();
  const morse = Object.fromEntries([...de(item(g, "morsekarte").body).matchAll(/([A-Z]) ([·–]+)/g)].map((m) => [m[2]!, m[1]!]));

  it("das Morse-Rätsel der Bank ergibt mit dem Merkblatt die Antwort", () => {
    const task = station(g, "bank").task;
    expect(task?.type).toBe("text");
    const question = de((task as { question: Text }).question);
    const line = question.split("\n").find((l) => l.includes("/"))!;
    const word = line.split("/").map((code) => morse[code.trim()]).join("");
    expect(word).toBe("MARKE");
    expect((task as { answers: string[] }).answers).toContain(word);
  });

  it("das Zahlenschloss am Schaukasten nennt das Gründungsjahr aus dem Zeitungsausschnitt", () => {
    const year = /gegründet (\d{4})/.exec(de(item(g, "ausschnitt").body))![1];
    expect(answerOf(g, "schaukasten")).toBe(year);
  });

  it("der Pegelstein am Mühlsteg ergibt sich aus dem Funkjournal (Minuten und Anwohner)", () => {
    const journal = de(item(g, "journal").body);
    const toMin = (hh: string, mm: string) => Number(hh) * 60 + Number(mm);
    const call = /(\d\d):(\d\d) Meldung Wetterwarte \(Weidenbach\): „Wehr bricht/.exec(journal)!;
    const burst = /(\d\d):(\d\d) Wehr gebrochen/.exec(journal)!;
    const minutes = (toMin(burst[1]!, burst[2]!) + 24 * 60 - toMin(call[1]!, call[2]!)) % (24 * 60);
    const people = Number(/(\d+) Anwohner/.exec(journal)![1]);
    expect(`${minutes}${people}`).toBe(answerOf(g, "muehlsteg"));
  });

  it("die Widersprüche der Dokumente tragen die Auswahl am Hochsitz", () => {
    const protokoll = de(item(g, "protokoll").body);
    const logbuch = de(item(g, "logbuch").body);
    const journal = de(item(g, "journal").body);
    const task = station(g, "hochsitz").task;
    if (task?.type !== "choice") throw new Error("Auswahl erwartet");
    const correct = task.options.filter((o) => o.correct).map((o) => de(o.text));
    expect(correct).toHaveLength(2);
    // Behauptung 1 steht im Aktenvermerk, das Logbuch widerlegt sie (Voss selbst an der Tür), das Journal ebenfalls.
    expect(protokoll).toContain("um 22:10 Uhr verlassen");
    expect(logbuch).toMatch(/22:10 Voss steht an der Tür/);
    expect(journal).toMatch(/23:47 Meldung Wetterwarte/);
    // Behauptung 2: keine Warnung, das Logbuch zählt drei Anrufe.
    expect(protokoll).toContain("zu keinem Zeitpunkt");
    expect(logbuch).toContain("Zum dritten Mal Voss angerufen");
    // Die falschen Optionen sind in den Papieren bestätigt oder unberührt.
    expect(protokoll).toContain("00:20 Uhr");
    expect(journal).toContain("00:20 Wehr gebrochen");
    expect(protokoll).toContain("412 DM");
  });

  it("die Nummer auf der Messingmarke öffnet das Nest", () => {
    const number = /MITGLIED NR\. (\d+)/.exec(de(item(g, "marke").description))![1];
    expect(answerOf(g, "nest")).toBe(number);
  });

  it("der Finalcode ist die Frequenz aus den Fragmenten; das Finale ist die letzte Station", () => {
    const code = [...g.fragments!].sort((a, b) => a.position - b.position).map((f) => f.value).join("");
    expect(code).toBe("1455");
    expect(answerOf(g, "wetterwarte")).toBe(code);
    expect(station(g, "wetterwarte").final).toBe(true);
    expect(g.stations.at(-1)!.id).toBe("wetterwarte");
    // jedes Fragment wird von genau einer Station vergeben
    for (const f of g.fragments!) expect(g.stations.filter((s) => s.rewards?.fragments?.includes(f.id))).toHaveLength(1);
  });

  it("deckt alle fünf Aufgabentypen ab und jede Station hat GPS, QR und Notfall-Code", () => {
    expect(new Set(g.stations.map((s) => s.task?.type))).toEqual(new Set(["choice", "text", "code", "photo", "find_location"]));
    const codes: string[] = [];
    for (const s of g.stations) {
      expect(s.triggers.map((t) => t.type).sort(), s.id).toEqual(["gps", "manual", "qr"]);
      for (const t of s.triggers) if (t.type === "qr" || t.type === "manual") codes.push(t.code);
      expect(s.scene?.arrival?.length, s.id).toBeGreaterThan(0);
      expect(s.hints?.length, s.id).toBe(3);
      expect(s.approach?.far && s.approach.mid && s.approach.near && s.approach.here, s.id).toBeTruthy();
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("jede versteckte Station wird durch eine Belohnung oder eine Regel freigeschaltet", () => {
    const revealed = new Set([
      ...g.stations.flatMap((s) => s.rewards?.reveal ?? []),
      ...(g.rules ?? []).flatMap((r) => [...r.then, ...(r.else ?? [])].flatMap((a) => ("reveal_station" in a ? [a.reveal_station] : []))),
    ]);
    for (const s of g.stations.filter((x) => x.visibility === "hidden")) expect(revealed.has(s.id), s.id).toBe(true);
    // Rätsel mit Ortsbezug: Der Zielpunkt liegt 60 Meter östlich vom Ausgangspunkt.
    const a = station(g, "antennenplatz").location!;
    const b = targetOf(g, "antennenplatz");
    expect(distance(a, b)).toBeGreaterThan(55);
    expect(distance(a, b)).toBeLessThan(65);
    expect(Math.abs(b.lat - a.lat)).toBeLessThan(0.00002);
    expect(b.lon).toBeGreaterThan(a.lon);
  });

  it("alle Klänge stammen aus der Klangbibliothek; Stationen liegen im Spielfeld und außerhalb der Sperrzonen", () => {
    const ids = new Set(library.map((l) => l.id));
    for (const m of g.media!) {
      expect(ids.has(m.id), m.id).toBe(true);
      expect(m.src).toBe(`media/lib/${m.id}.ogg`);
    }
    const boundary = g.field.boundary;
    if (!("center" in boundary)) throw new Error("Kreis erwartet");
    for (const s of g.stations) {
      expect(distance(boundary.center, s.location!), s.id).toBeLessThan(boundary.radius);
      // Abstand der Stationen untereinander: GPS-Bereiche (25 m) überlappen nicht
      for (const o of g.stations) if (o.id !== s.id) expect(distance(s.location!, o.location!), `${s.id}/${o.id}`).toBeGreaterThan(50);
    }
  });

  it("Beats lesen sich auf dem Handy: kurze Takte, keine Platzhalter", () => {
    const parts = ["arrival", "beats", "afterSolve"] as const;
    for (const s of g.stations) {
      for (const part of parts) {
        for (const b of s.scene?.[part] ?? []) {
          if (b.kind === "document") continue;
          expect(de(b.text).length, `${s.id}/${part}`).toBeLessThanOrEqual(560);
          for (const r of b.responses ?? []) expect(de(r.reply).length, `${s.id}/${part}/${de(r.label)}`).toBeLessThanOrEqual(400);
        }
      }
    }
    expect(JSON.stringify(g)).not.toMatch(/TODO|Platzhalter\]|\[[A-ZÄÖÜa-zäöü ]+\]/);
  });
});
