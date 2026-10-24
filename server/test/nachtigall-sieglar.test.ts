import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Game, Point, Station, Text } from "@lykora/spec";
import { reduceTeam, type EngineAction, type TeamContext } from "../src/engine/team.ts";
import { standings } from "../src/engine/standings.ts";
import { distance, distanceToArea } from "../src/lib/geo.ts";

// Durchspielen von „Nachtigall in Sieglar“ mit der echten Engine: jede Station, alle fünf Aufgabentypen,
// falsche Antwort und Hinweis, Regeln (je einmal), Fragmente, Finale, Spielende. Dazu Prüfungen der Geschichte
// (Rätsel passen zu den Dokumenten) und der Sicherheit am echten Ort (Stationen im Spielfeld, außerhalb der
// Sperrzonen, Hauptstraßen nicht im Spielfeld). Die Koordinaten wurden auf Rasterkacheln von OpenStreetMap
// gegengeprüft; der Test hält die Ergebnisse fest, damit ein Umbau sie nicht stillschweigend verschiebt.

const gameUrl = new URL("../../spec/v0.1/examples/nachtigall-sieglar.json", import.meta.url);
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
const targetOf = (g: Game, id: string): Point => {
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

/** Schnelles Team: alles inklusive Bonus, mit einem Fehlversuch und einem Hinweis an der Ecke. */
function fastRun(g: Game) {
  const { actions, act } = recorder();
  const idx: Record<string, number> = {};
  act(0, "start");
  act(2, "trigger", { station: "funkcheck", method: "qr" });
  idx.funkcheck = act(5, "answer", { station: "funkcheck", choice: correctOptions(g, "funkcheck") });
  idx.lauschpostenVorzeitig = act(6, "trigger", { station: "lauschposten", method: "gps" });
  act(8, "trigger", { station: "ecke", method: "gps" });
  idx.eckeFalsch = act(9, "answer", { station: "ecke", text: "MORSE" });
  idx.eckeHinweis = act(10, "hint", { station: "ecke", level: 1 });
  idx.ecke = act(12, "answer", { station: "ecke", text: " marke " });
  act(14, "trigger", { station: "aushang", method: "qr" });
  idx.aushang = act(15, "answer", { station: "aushang", text: "1989" });
  act(17, "trigger", { station: "lauschposten", method: "manual" });
  idx.lauschposten = act(18, "answer", { station: "lauschposten", upload: "foto-lauschposten" });
  act(20, "trigger", { station: "antennenplatz", method: "gps" });
  const start = station(g, "antennenplatz").location!;
  idx.ortFalsch = act(21, "answer", { station: "antennenplatz", location: { ...start, accuracy: 5 } });
  const ziel = targetOf(g, "antennenplatz");
  idx.antennenplatz = act(24, "answer", { station: "antennenplatz", location: { lat: ziel.lat + 0.00005, lon: ziel.lon, accuracy: 6 } });
  idx.finaleVorzeitig = act(26, "trigger", { station: "funkstelle", method: "qr" });
  act(28, "trigger", { station: "treffpunkt", method: "gps" });
  idx.treffpunkt = act(30, "answer", { station: "treffpunkt", choice: correctOptions(g, "treffpunkt") });
  act(32, "trigger", { station: "relais", method: "gps" });
  idx.relais = act(34, "answer", { station: "relais", text: "3331" });
  act(36, "trigger", { station: "nest", method: "gps" });
  idx.nest = act(37, "answer", { station: "nest", text: "7" });
  act(40, "trigger", { station: "funkstelle", method: "qr" });
  idx.funkstelle = act(42, "answer", { station: "funkstelle", text: "1455" });
  return { actions, idx };
}

/** Langsames Team: lässt das Nest aus und lässt sich Zeit, damit die Zeit-Regeln feuern. */
function slowRun(g: Game) {
  const { actions, act } = recorder();
  act(0, "start");
  act(3, "trigger", { station: "funkcheck", method: "gps" });
  act(9, "answer", { station: "funkcheck", choice: correctOptions(g, "funkcheck") });
  act(15, "trigger", { station: "aushang", method: "gps" });
  act(22, "answer", { station: "aushang", text: "1989" });
  act(30, "trigger", { station: "ecke", method: "gps" });
  act(37, "answer", { station: "ecke", text: "MARKE" });
  act(46, "trigger", { station: "lauschposten", method: "gps" }); // nach 45 Minuten: Jule bittet um Ruhe
  act(52, "answer", { station: "lauschposten", upload: "foto-lauschposten-2" });
  act(58, "trigger", { station: "antennenplatz", method: "gps" });
  const ziel = targetOf(g, "antennenplatz");
  act(64, "answer", { station: "antennenplatz", location: { ...ziel, accuracy: 4 } });
  act(72, "trigger", { station: "treffpunkt", method: "gps" }); // nach 70 Minuten: Jule wird nervös
  act(78, "answer", { station: "treffpunkt", choice: correctOptions(g, "treffpunkt") });
  act(85, "trigger", { station: "relais", method: "gps" });
  act(92, "answer", { station: "relais", text: "3331" });
  act(111, "trigger", { station: "funkstelle", method: "qr" }); // nach 110 Minuten: Zeitwarnung
  act(113, "answer", { station: "funkstelle", text: "1455" });
  return actions;
}

describe("Nachtigall in Sieglar: Durchspielen", () => {
  it("löst alle neun Stationen mit der echten Engine und erreicht das Spielende", () => {
    const g = load();
    const { actions, idx } = fastRun(g);
    const s = reduceTeam(ctx(g), actions);
    const byIndex = (i: number) => s.outcomes[i]!;

    // Vorzeitige Auslöser werden abgewiesen, alles andere läuft.
    expect(byIndex(idx.lauschpostenVorzeitig!)).toMatchObject({ status: "rejected", reason: "hidden" });
    expect(byIndex(idx.finaleVorzeitig!)).toMatchObject({ status: "rejected", reason: "fragments_missing" });
    const rejected = s.outcomes.filter((o) => o.status !== "ok").map((o) => `${o.status}:${o.reason}`);
    expect(rejected).toEqual(["rejected:hidden", "rejected:fragments_missing"]);

    // Fehlversuch und Hinweis.
    expect(byIndex(idx.eckeFalsch!).verdict).toBe("wrong");
    expect(byIndex(idx.ortFalsch!).verdict).toBe("wrong");
    expect(byIndex(idx.ecke!).verdict).toBe("correct");
    expect(s.wrongAnswers).toBe(2);
    expect(s.hintsUsed).toBe(1);
    expect(s.hints.ecke).toBe(1);
    expect(s.timePenalty).toBe(30 + 30 + 60);

    // Alle neun Stationen sind gelöst, in der Reihenfolge der Geschichte.
    expect(Object.entries(s.solved).sort((a, b) => a[1] - b[1]).map(([id]) => id)).toEqual([
      "funkcheck", "ecke", "aushang", "lauschposten", "antennenplatz", "treffpunkt", "relais", "nest", "funkstelle",
    ]);
    expect(Object.keys(s.solved).sort()).toEqual(g.stations.map((x) => x.id).sort());

    // Fragmente, Gegenstände, Enthüllungen, Kapitel.
    expect([...s.fragments].sort()).toEqual(["f1", "f2", "f3", "f4"]);
    expect([...s.items].sort()).toEqual(g.items!.map((i) => i.id).sort());
    expect([...s.revealed].sort()).toEqual(["antennenplatz", "aushang", "ecke", "lauschposten", "nest", "relais", "treffpunkt"]);
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
    expect(s.finishedAt).toBe(T0 + 113 * 60_000);
    expect("nest" in s.solved).toBe(false);
    expect(s.items).not.toContain("kassette");
    expect(s.messages.map((m) => m.key)).toEqual([
      "rule:weg-zusammen:then:1",
      "rule:leise:then:0",
      "rule:frequenz-ahnung:then:1",
      "rule:jule-nervoes:then:0",
      "rule:nest-erscheint:then:1",
      "rule:zeit-warnung:then:0",
      "rule:kassette-abspielen:else:0",
    ]);
    // Sonst-Zweig: keine Bonuspunkte der Kassette. Das Zeitlimit (130 Minuten) wurde nicht gerissen.
    expect(s.points).toBe(50 + 600 + 200);
    expect(g.settings.time).toEqual({ limit: "per_team", duration: 7800 });
  });

  it("verlangt die Reihenfolge der Geschichte: Spuren, Fragmente und Rätsel greifen ineinander", () => {
    const g = load();
    const try1 = (actions: EngineAction[]) => reduceTeam(ctx(g), actions).outcomes.map((o) => (o.status === "ok" ? "ok" : `${o.status}:${o.reason}`));
    // Nur der Funkcheck ist sichtbar: alles andere ist versteckt oder gesperrt.
    const { act, actions } = recorder();
    for (const id of ["ecke", "aushang", "lauschposten", "antennenplatz", "treffpunkt", "relais", "nest"]) act(1, "trigger", { station: id, method: "qr" });
    act(2, "trigger", { station: "funkstelle", method: "qr" });
    expect(try1(actions)).toEqual([...Array(7).fill("rejected:hidden"), "rejected:fragments_missing"]);

    // Auch der zweite Weg allein schaltet den Lauschposten nicht frei.
    const half = recorder();
    half.act(0, "start");
    half.act(1, "trigger", { station: "funkcheck", method: "qr" });
    half.act(2, "answer", { station: "funkcheck", choice: correctOptions(g, "funkcheck") });
    half.act(3, "trigger", { station: "ecke", method: "gps" });
    half.act(4, "answer", { station: "ecke", text: "Marke" });
    half.act(5, "trigger", { station: "lauschposten", method: "gps" });
    const state = reduceTeam(ctx(g), half.actions);
    expect(state.outcomes.at(-1)).toMatchObject({ status: "rejected", reason: "hidden" });
    expect(state.revealed).not.toContain("lauschposten");

    // Falsche Auswahl am Funkcheck löst nichts und kostet je 30 Sekunden (auch eine unvollständige).
    const wrong = recorder();
    wrong.act(0, "trigger", { station: "funkcheck", method: "qr" });
    wrong.act(1, "answer", { station: "funkcheck", choice: [0, 1, 4] });
    wrong.act(2, "answer", { station: "funkcheck", choice: [0, 1] });
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

describe("Nachtigall in Sieglar: die Geschichte hängt zusammen", () => {
  const g = load();
  const morse = Object.fromEntries([...de(item(g, "morsekarte").body).matchAll(/([A-Z]) ([·–]+)/g)].map((m) => [m[2]!, m[1]!]));

  it("das Morse-Rätsel an der Ecke ergibt mit dem Merkblatt die Antwort", () => {
    const task = station(g, "ecke").task;
    expect(task?.type).toBe("text");
    const question = de((task as { question: Text }).question);
    const line = question.split("\n").find((l) => l.includes("/"))!;
    const word = line.split("/").map((code) => morse[code.trim()]).join("");
    expect(word).toBe("MARKE");
    expect((task as { answers: string[] }).answers).toContain(word);
  });

  it("das Zahlenschloss am Aushang nennt das Gründungsjahr aus dem Zeitungsausschnitt", () => {
    const year = /gegründet (\d{4})/.exec(de(item(g, "ausschnitt").body))![1];
    expect(answerOf(g, "aushang")).toBe(year);
  });

  it("das Schloss an der Relaisstelle ergibt sich aus dem Funkjournal (Minuten und Anwohner)", () => {
    const journal = de(item(g, "journal").body);
    const toMin = (hh: string, mm: string) => Number(hh) * 60 + Number(mm);
    const call = /(\d\d):(\d\d) Meldung Funkstelle \(Weidenbach\): „Wehr bricht/.exec(journal)!;
    const burst = /(\d\d):(\d\d) Wehr gebrochen/.exec(journal)!;
    const minutes = (toMin(burst[1]!, burst[2]!) + 24 * 60 - toMin(call[1]!, call[2]!)) % (24 * 60);
    const people = Number(/(\d+) Anwohner/.exec(journal)![1]);
    expect(`${minutes}${people}`).toBe(answerOf(g, "relais"));
  });

  it("die Widersprüche der Dokumente tragen die Auswahl am Treffpunkt", () => {
    const protokoll = de(item(g, "protokoll").body);
    const logbuch = de(item(g, "logbuch").body);
    const journal = de(item(g, "journal").body);
    const task = station(g, "treffpunkt").task;
    if (task?.type !== "choice") throw new Error("Auswahl erwartet");
    const correct = task.options.filter((o) => o.correct).map((o) => de(o.text));
    expect(correct).toHaveLength(2);
    // Behauptung 1 steht im Aktenvermerk, das Logbuch widerlegt sie (Voss selbst an der Tür), das Journal ebenfalls.
    expect(protokoll).toContain("um 22:10 Uhr verlassen");
    expect(logbuch).toMatch(/22:10 Voss steht an der Tür/);
    expect(journal).toMatch(/23:47 Meldung Funkstelle/);
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
    expect(answerOf(g, "funkstelle")).toBe(code);
    expect(station(g, "funkstelle").final).toBe(true);
    expect(g.stations.at(-1)!.id).toBe("funkstelle");
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
      expect(s.notes, s.id).toContain("Dauer etwa");
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("jede versteckte Station wird durch eine Belohnung oder eine Regel freigeschaltet", () => {
    const revealed = new Set([
      ...g.stations.flatMap((s) => s.rewards?.reveal ?? []),
      ...(g.rules ?? []).flatMap((r) => [...r.then, ...(r.else ?? [])].flatMap((a) => ("reveal_station" in a ? [a.reveal_station] : []))),
    ]);
    for (const s of g.stations.filter((x) => x.visibility === "hidden")) expect(revealed.has(s.id), s.id).toBe(true);
  });

  it("alle Klänge stammen aus der Klangbibliothek", () => {
    const ids = new Set(library.map((l) => l.id));
    for (const m of g.media!) {
      expect(ids.has(m.id), m.id).toBe(true);
      expect(m.src).toBe(`media/lib/${m.id}.ogg`);
    }
  });

  it("Beats lesen sich auf dem Handy: kurze Takte, keine Platzhalter im Spieltext", () => {
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

  it("erfindet nichts über reale Einrichtungen: DRK, Feuerwehr, Schule, Kirche kommen nur als Navigationshinweis vor", () => {
    // Spieltexte (Szenen, Fundstücke, Regeln, Schluss) nennen keine realen Organisationen.
    const story = JSON.stringify({ stations: g.stations.map((s) => ({ scene: s.scene, task: s.task, hints: s.hints })), items: g.items, rules: g.rules, story: g.story, characters: g.characters });
    expect(story).not.toMatch(/DRK|Rotes Kreuz|Feuerwehr|Polizei Troisdorf|Moschee|Kirche|Schule von|Stadt Troisdorf/);
    // Nur die Polizei als „die Polizei schließt eine Flucht nicht aus“ steht im erfundenen Zeitungsartikel von 1996.
    expect(de(item(g, "ausschnitt").body)).toContain("Die Polizei schließt eine Flucht nicht aus");
    // Telefonnummer ist der Platzhalter und in den Stationsnotizen als solcher gekennzeichnet.
    expect(g.safety.emergency.gameMasterPhone).toBe("+49 170 0000000");
    expect(station(g, "funkcheck").notes).toContain("PLATZHALTER");
  });
});

// Straßenachsen (vereinfacht, 15 m Schritt) aus den Rasterkacheln: Teutonenstraße, Germanenstraße, Frankenstraße, Gotenstraße.
const ACHSEN: Record<string, [number, number][]> = {
  teutonenstrasse: [[50.807208, 7.134262], [50.807079, 7.134212], [50.806965, 7.134098], [50.806852, 7.133982], [50.806737, 7.133869], [50.806619, 7.133767], [50.806513, 7.133636], [50.806398, 7.133523], [50.806282, 7.133415], [50.806166, 7.133306], [50.806053, 7.13319], [50.805942, 7.133068], [50.805833, 7.132944], [50.805721, 7.132825], [50.805605, 7.132716], [50.805493, 7.132601], [50.805386, 7.132475], [50.805294, 7.132327], [50.805221, 7.132157], [50.805192, 7.131952], [50.805191, 7.131944]],
  germanenstrasse: [[50.806084, 7.13323], [50.806163, 7.133059], [50.806241, 7.132884], [50.806346, 7.132755], [50.806462, 7.132647], [50.806575, 7.132535], [50.806701, 7.132459], [50.80682, 7.132359], [50.806939, 7.13226], [50.807057, 7.132155], [50.807107, 7.132106]],
  frankenstrasse: [[50.807255, 7.132557], [50.8072, 7.132362], [50.807137, 7.132174], [50.80707, 7.131988], [50.806998, 7.131809], [50.806919, 7.131635], [50.806836, 7.131467], [50.806724, 7.131385], [50.806606, 7.131484], [50.80649, 7.131594], [50.806374, 7.131703], [50.806259, 7.131813], [50.806142, 7.13192], [50.806027, 7.132031], [50.805912, 7.132142], [50.805796, 7.132251], [50.80568, 7.132361], [50.805565, 7.132471], [50.805493, 7.132537]],
  gotenstrasse: [[50.805462, 7.132558], [50.805456, 7.132758], [50.805381, 7.132937], [50.805309, 7.133117], [50.80523, 7.13329], [50.805148, 7.133458], [50.805066, 7.133628], [50.804967, 7.133774], [50.804863, 7.133909], [50.804747, 7.134016], [50.804623, 7.1341], [50.804493, 7.134151], [50.80436, 7.134188], [50.804226, 7.134189], [50.804091, 7.134182], [50.803957, 7.134155], [50.803823, 7.134129], [50.803743, 7.134114]],
};
// Stichproben auf den Hauptstraßen (aus der Karte): A59, Willy-Brandt-Ring, Larstraße, Troisdorfer Straße.
const HAUPTSTRASSEN: Record<string, { zone: string; punkte: [number, number][] }> = {
  a59: { zone: "a59", punkte: [[50.806945, 7.135727], [50.806199, 7.1368], [50.805318, 7.137873], [50.804809, 7.138141]] },
  ring: { zone: "willy-brandt-ring", punkte: [[50.807481, 7.131758], [50.807494, 7.13326], [50.807562, 7.134118]] },
  larstrasse: { zone: "larstrasse", punkte: [[50.80647, 7.130899], [50.805962, 7.131329], [50.805521, 7.131758], [50.804369, 7.131543]] },
  troisdorfer: { zone: "troisdorfer-strasse", punkte: [[50.803751, 7.13208], [50.80369, 7.133582], [50.803724, 7.135406]] },
};
const pt = ([lat, lon]: [number, number]): Point => ({ lat, lon });
const DRK: Point = { lat: 50.8070781, lon: 7.1337849 };

/** Abstand eines Punkts zu einer Linie in Metern (lokale Ebene). */
function distanceToLine(p: Point, line: [number, number][]): number {
  const kx = distance({ lat: p.lat, lon: 0 }, { lat: p.lat, lon: 1 });
  const ky = distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ay, ax] = [(line[i]![0] - p.lat) * ky, (line[i]![1] - p.lon) * kx] as [number, number];
    const [by, bx] = [(line[i + 1]![0] - p.lat) * ky, (line[i + 1]![1] - p.lon) * kx] as [number, number];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

describe("Nachtigall in Sieglar: Sicherheit am echten Ort", () => {
  const g = load();
  const zone = (id: string) => g.field.restrictedZones!.find((z) => z.id === id)!;

  it("alle Stationen liegen im Spielfeld, mit Abstand zum Rand, und höchstens 650 m vom DRK-Ortsverein", () => {
    for (const s of g.stations) {
      expect(distanceToArea(s.location!, g.field.boundary), s.id).toBe(0);
      expect(distance(DRK, s.location!), s.id).toBeLessThan(650);
    }
    expect(distance(DRK, g.field.assemblyPoint.location)).toBeLessThan(60);
    expect(distance(g.field.start!, g.field.assemblyPoint.location)).toBeLessThan(5);
  });

  it("Stationen und das Ziel am Antennenplatz liegen außerhalb aller Sperrzonen, mit Puffer über die Warnentfernung", () => {
    const punkte: [string, Point][] = [...g.stations.map((s): [string, Point] => [s.id, s.location!]), ["ziel", targetOf(g, "antennenplatz")]];
    for (const [name, p] of punkte) {
      for (const z of g.field.restrictedZones!) {
        // GPS-Radius 20 m plus Genauigkeit: die Warnung soll nie ausgelöst werden, nur weil das Team an der Station steht
        expect(distanceToArea(p, z.area), `${name} / ${z.id}`).toBeGreaterThan((z.warnDistance ?? 15) + 5);
      }
    }
  });

  it("A59, Willy-Brandt-Ring, Larstraße und Troisdorfer Straße liegen nicht im Spielfeld, sondern in je einer Sperrzone", () => {
    for (const [name, h] of Object.entries(HAUPTSTRASSEN)) {
      for (const p of h.punkte) {
        expect(distanceToArea(pt(p), g.field.boundary), `${name} ${p}`).toBeGreaterThan(5);
        expect(distanceToArea(pt(p), zone(h.zone).area), `${name} ${p}`).toBe(0);
      }
    }
    // Der Sammelpunkt liegt deutlich abseits der Autobahn (mehr als 60 m bis zur ersten Stichprobe).
    expect(distance(g.field.assemblyPoint.location, pt(HAUPTSTRASSEN.a59!.punkte[0]!))).toBeGreaterThan(60);
  });

  it("jede Station steht am Gehweg ihrer Straße (3 bis 7 m neben der Straßenachse), das Ziel am Antennenplatz ebenso", () => {
    const strasse: Record<string, string> = {
      funkcheck: "teutonenstrasse", ecke: "teutonenstrasse", funkstelle: "teutonenstrasse",
      aushang: "germanenstrasse", lauschposten: "frankenstrasse", antennenplatz: "frankenstrasse",
      treffpunkt: "gotenstrasse", relais: "gotenstrasse", nest: "gotenstrasse",
    };
    for (const s of g.stations) {
      const d = distanceToLine(s.location!, ACHSEN[strasse[s.id]!]!);
      expect(d, s.id).toBeGreaterThan(3);
      expect(d, s.id).toBeLessThan(7);
    }
    const dz = distanceToLine(targetOf(g, "antennenplatz"), ACHSEN.frankenstrasse!);
    expect(dz).toBeGreaterThan(2);
    expect(dz).toBeLessThan(7);
  });

  it("die Stationen liegen mindestens 50 m auseinander, der Weg bleibt unter zwei Kilometern", () => {
    for (const s of g.stations) {
      for (const o of g.stations) if (o.id !== s.id) expect(distance(s.location!, o.location!), `${s.id}/${o.id}`).toBeGreaterThan(50);
    }
    const reihenfolge = ["funkcheck", "ecke", "aushang", "lauschposten", "antennenplatz", "treffpunkt", "relais", "nest", "funkstelle"];
    let luftlinie = 0;
    for (let i = 1; i < reihenfolge.length; i++) luftlinie += distance(station(g, reihenfolge[i - 1]!).location!, station(g, reihenfolge[i]!).location!);
    // Luftlinie in Spielreihenfolge etwa 0,9 km; zu Fuß mit Umwegen und dem Rückweg vom Süden rund 1,3 km
    expect(luftlinie).toBeGreaterThan(800);
    expect(luftlinie).toBeLessThan(1100);
  });

  it("das Rätsel am Antennenplatz ist ortsunabhängig: 60 m in Richtung 150 Grad vom Auslöseort", () => {
    const a = station(g, "antennenplatz").location!;
    const b = targetOf(g, "antennenplatz");
    expect(distance(a, b)).toBeGreaterThan(57);
    expect(distance(a, b)).toBeLessThan(63);
    const dx = distance({ lat: a.lat, lon: a.lon }, { lat: a.lat, lon: b.lon }) * Math.sign(b.lon - a.lon);
    const dy = distance({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: a.lon }) * Math.sign(b.lat - a.lat);
    const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    expect(bearing).toBeGreaterThan(148);
    expect(bearing).toBeLessThan(152);
    expect(de((station(g, "antennenplatz").task as { prompt: Text }).prompt)).toContain("150 Grad");
  });

  it("die Sicherheitsangaben sind vollständig: Betreuer, Warnweste, Lebenszeichen, Rettungspunkte, Sammelpunkt", () => {
    expect(g.safety.requireSupervisor).toBe(true);
    expect(g.safety.requiredGear!.map(de).join("|")).toMatch(/Warnweste/);
    expect(g.safety.requiredGear!.map(de).join("|")).toMatch(/Taschenlampe/);
    expect(g.safety.heartbeat).toEqual({ enabled: true, interval: 900, grace: 300 });
    expect(g.field.rescuePoints!.length).toBeGreaterThanOrEqual(2);
    for (const r of g.field.rescuePoints!) expect(distanceToArea(r.location, g.field.boundary), r.id).toBe(0);
    expect(g.meta.ageGroups).toEqual(["10-13", "14-17"]);
    expect(g.meta.scareLevel).toBeLessThanOrEqual(2);
    expect(de(g.safety.emergency.notes)).toMatch(/keine Straße überqueren/);
    // Karte: eigenes Kachelpaket (relative Adresse, vom Server ausgeliefert)
    expect(g.settings.map?.tiles).toBe("tiles/sieglar/{z}/{x}/{y}.png");
  });
});
