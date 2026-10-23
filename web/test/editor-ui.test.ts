import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorIssue, Game } from "../src/lib/editor/types.ts";

// Die Bausteine importieren session.ts, das beim Laden document.baseURI liest: Browser-Umgebung, soweit nötig.
vi.stubGlobal("document", { baseURI: "https://lager.example/lykora/", documentElement: { dataset: {} }, querySelector: () => null, addEventListener: vi.fn() });
vi.stubGlobal("window", { location: { pathname: "/lykora/", search: "" }, addEventListener: vi.fn(), removeEventListener: vi.fn(), scrollTo: vi.fn() });
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
  key: (i: number) => [...stored.keys()][i] ?? null,
  get length() {
    return stored.size;
  },
});

const load = () => JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

let router: typeof import("../src/lib/router.ts");
let store: typeof import("../src/lib/editor/store.ts");
let references: typeof import("../src/lib/editor/references.ts");
let jump: typeof import("../src/lib/editor/jump.ts");
let validation: typeof import("../src/lib/editor/validation.ts");
let shell: typeof import("../src/pages/games/editor/EditorShell.tsx");
let nav: typeof import("../src/pages/games/editor/EditorNav.tsx");
let header: typeof import("../src/pages/games/editor/EditorHeader.tsx");
let saveStatus: typeof import("../src/pages/games/editor/SaveStatus.tsx");
let overview: typeof import("../src/pages/games/editor/OverviewSection.tsx");
let conflict: typeof import("../src/pages/games/editor/ConflictDialog.tsx");
let backup: typeof import("../src/pages/games/editor/LocalBackupDialog.tsx");
let del: typeof import("../src/pages/games/editor/DeleteWithReferencesDialog.tsx");
let expert: typeof import("../src/pages/games/editor/ExpertPanel.tsx");
let sections: typeof import("../src/pages/games/editor/sections.ts");
let sortable: typeof import("../src/pages/games/editor/ui/SortableList.tsx");
let chips: typeof import("../src/pages/games/editor/ui/Chips.tsx");
let number: typeof import("../src/pages/games/editor/ui/NumberInput.tsx");
let duration: typeof import("../src/pages/games/editor/ui/DurationInput.tsx");
let penalty: typeof import("../src/pages/games/editor/ui/PenaltyInput.tsx");
let refs: typeof import("../src/pages/games/editor/ui/RefSelect.tsx");
let frame: typeof import("../src/pages/games/editor/ui/FieldFrame.tsx");
let picker: typeof import("../src/pages/games/editor/ui/MediaPicker.tsx");
let issueList: typeof import("../src/pages/games/editor/ui/IssueList.tsx");

beforeAll(async () => {
  router = await import("../src/lib/router.ts");
  store = await import("../src/lib/editor/store.ts");
  references = await import("../src/lib/editor/references.ts");
  jump = await import("../src/lib/editor/jump.ts");
  validation = await import("../src/lib/editor/validation.ts");
  shell = await import("../src/pages/games/editor/EditorShell.tsx");
  nav = await import("../src/pages/games/editor/EditorNav.tsx");
  header = await import("../src/pages/games/editor/EditorHeader.tsx");
  saveStatus = await import("../src/pages/games/editor/SaveStatus.tsx");
  overview = await import("../src/pages/games/editor/OverviewSection.tsx");
  conflict = await import("../src/pages/games/editor/ConflictDialog.tsx");
  backup = await import("../src/pages/games/editor/LocalBackupDialog.tsx");
  del = await import("../src/pages/games/editor/DeleteWithReferencesDialog.tsx");
  expert = await import("../src/pages/games/editor/ExpertPanel.tsx");
  sections = await import("../src/pages/games/editor/sections.ts");
  sortable = await import("../src/pages/games/editor/ui/SortableList.tsx");
  chips = await import("../src/pages/games/editor/ui/Chips.tsx");
  number = await import("../src/pages/games/editor/ui/NumberInput.tsx");
  duration = await import("../src/pages/games/editor/ui/DurationInput.tsx");
  penalty = await import("../src/pages/games/editor/ui/PenaltyInput.tsx");
  refs = await import("../src/pages/games/editor/ui/RefSelect.tsx");
  frame = await import("../src/pages/games/editor/ui/FieldFrame.tsx");
  picker = await import("../src/pages/games/editor/ui/MediaPicker.tsx");
  issueList = await import("../src/pages/games/editor/ui/IssueList.tsx");
});

/** Store ohne Server und ohne lokale Sicherung, als aktueller Baukasten eingetragen. */
function open(game = load()) {
  const s = store.createEditorStore({ gameId: "g1", game, localBackup: false });
  store.editor.set({ current: s });
  return s;
}

const issue = (code: string, severity: EditorIssue["severity"], at: Partial<EditorIssue["at"]> = {}): EditorIssue => ({
  id: `${code}:${at.objectId ?? ""}`,
  severity,
  code,
  message: code,
  at: { section: "karte", path: "", ...at },
  source: "editor",
  dismissable: severity !== "error",
});

describe("Routen des Baukastens", () => {
  it("erkennt feste Pfade vor Parameter-Pfaden", () => {
    expect(router.matchRoute("/spiele/neu")).toEqual({ name: "gameNew", params: {} });
    expect(router.matchRoute("/spiele/g1")?.name).toBe("game");
    expect(router.matchRoute("/spiele/g1/vor-ort")).toEqual({ name: "onSite", params: { gameId: "g1" } });
    expect(router.matchRoute("/spiele/g1/baukasten")).toEqual({ name: "editor", params: { gameId: "g1" } });
    expect(router.matchRoute("/spiele/g1/baukasten/karte")).toEqual({ name: "editorSection", params: { gameId: "g1", section: "karte" } });
    expect(router.matchRoute("/spiele/g1/baukasten/stationen/baum")).toEqual({ name: "editorStation", params: { gameId: "g1", stationId: "baum" } });
    expect(router.matchRoute("/spiele/g1/medien")?.name).toBe("gameMedia");
  });

  it("baut dieselben Pfade wie der Sprung", () => {
    expect(router.href("editorStation", { gameId: "g1", stationId: "baum" }, { feld: "task.answers" })).toBe(jump.editorPath("g1", "stationen", "baum", { feld: "task.answers" }));
    expect(router.href("editorSection", { gameId: "g 1", section: "regeln" })).toBe(jump.editorPath("g 1", "regeln"));
    expect(router.href("editor", { gameId: "g1" })).toBe(jump.editorPath("g1"));
  });
});

describe("Rahmen: Bereich, Tastenkürzel, Hinweise", () => {
  it("leitet den Bereich aus der Adresse ab", () => {
    expect(shell.sectionOf(undefined)).toBe("uebersicht");
    expect(shell.sectionOf("regeln")).toBe("regeln");
    expect(shell.sectionOf("gibtsnicht")).toBe("uebersicht");
    expect(shell.sectionOf("stationen")).toBe("karte");
    expect(shell.sectionOf(undefined, "baum")).toBe("stationen");
  });

  it("kennt Strg und ⌘ für Rückgängig, Wiederholen und Speichern", () => {
    // Autofill meldet Tastenereignisse ohne key
    expect(shell.shortcutOf({ key: undefined as never, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBeNull();
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => shell.shortcutOf({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(key("z", { ctrlKey: true })).toBe("undo");
    expect(key("z", { metaKey: true })).toBe("undo");
    expect(key("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(key("y", { ctrlKey: true })).toBe("redo");
    expect(key("s", { ctrlKey: true })).toBe("save");
    expect(key("PageDown", { altKey: true })).toBe("nextStation");
    expect(key("PageUp", { altKey: true })).toBe("prevStation");
    expect(key("z")).toBeNull();
    expect(key("z", { ctrlKey: true, altKey: true })).toBeNull();
    expect(key("PageDown")).toBeNull();
  });

  it("findet Nachbarstationen und hält am Rand", () => {
    expect(shell.neighbourStation(["a", "b", "c"], "b", 1)).toBe("c");
    expect(shell.neighbourStation(["a", "b", "c"], "a", -1)).toBeNull();
    expect(shell.neighbourStation(["a", "b"], undefined, 1)).toBeNull();
  });

  it("warnt nur bei fremden Änderungen der letzten 5 Minuten", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    expect(shell.recentOtherEditor({ id: "anna", at: at(2) }, "ich", now)).toBe(true);
    expect(shell.recentOtherEditor({ id: "anna", at: at(6) }, "ich", now)).toBe(false);
    expect(shell.recentOtherEditor({ id: "ich", at: at(1) }, "ich", now)).toBe(false);
    expect(shell.recentOtherEditor(null, "ich", now)).toBe(false);
  });

  it("hat für jeden Bereich außer der Übersicht einen Lader mit Platzhalter", async () => {
    const all = ["karte", "stationen", "raetsel", "geschichte", "belohnungen", "regeln", "sicherheit", "medien", "klang", "einstellungen", "veroeffentlichen"];
    expect(Object.keys(sections.SECTION_LOADERS).sort()).toEqual([...all].sort());
    for (const s of all) expect(typeof (await sections.SECTION_LOADERS[s as keyof typeof sections.SECTION_LOADERS]())).toBe("function");
    expect(typeof (await sections.PAGES.gameNew())).toBe("function");
    expect(Object.keys(sections.SECTION_TITLES)).toHaveLength(12);
  });
});

describe("Navigation und Kopf", () => {
  it("zählt Stationsmeldungen bei „Karte & Stationen“ und zeigt Form statt Farbe", () => {
    const counts = validation.countsBySection([issue("a", "error", { section: "stationen" }), issue("b", "warning", { section: "karte" }), issue("c", "hint", { section: "karte" })]);
    const karte = nav.NAV_ITEMS.find((i) => i.section === "karte")!;
    const c = nav.counterOf(counts, karte);
    expect(c).toEqual({ errors: 1, warnings: 2 });
    expect(nav.counterLabel(c)).toBe("✗ 1 · ! 2");
    expect(nav.counterText(c)).toBe("1 Fehler, 2 Warnungen");
    expect(nav.counterLabel({ errors: 0, warnings: 0 })).toBe("✓");
    expect(nav.counterText({ errors: 0, warnings: 0 })).toBe("ohne Meldungen");
  });

  it("listet Stationen in Spielreihenfolge mit Finale und Zustand", () => {
    const game = load();
    const rows = nav.stationRows([...game.stations, null, { name: "ohne ID" }], "de");
    expect(rows.map((r) => r.number)).toEqual(["1", "2", "3", "4", "★"]);
    expect(rows.filter((r) => r.hidden)).toHaveLength(1);
    const id = rows[1]!.id;
    const list = [issue("x", "warning", { section: "stationen", objectId: id }), issue("y", "error", { section: "stationen", objectId: id })];
    expect(nav.stationState(list, id)).toBe("error");
    expect(nav.stationState(list, id, ["y:" + id])).toBe("warning");
    expect(nav.stationState(list, "andere")).toBe("ok");
  });

  it("zählt am Knopf „Veröffentlichen“ Fehler und Warnungen, keine Hinweise und keine ausgeblendeten", () => {
    const list = [issue("a", "error"), issue("b", "warning", { objectId: "s" }), issue("c", "hint")];
    expect(header.publishCounter(list)).toEqual({ errors: 1, warnings: 1 });
    expect(header.publishCounter(list, ["b:s"])).toEqual({ errors: 1, warnings: 0 });
  });

  it("beschreibt jeden Speicherstand mit Text und sagt nur Störungen an", () => {
    const save = (status: "saved" | "pending" | "saving" | "offline" | "error" | "conflict" | "unauthorized") => saveStatus.saveStatusView({ status, at: null, error: null, conflict: null }, "Anna");
    expect(save("saved")).toMatchObject({ text: "Gespeichert", announce: false });
    expect(save("saving").announce).toBe(false);
    expect(save("offline")).toMatchObject({ action: "retry", announce: true });
    expect(save("error").text).toBe("Nicht gespeichert.");
    expect(save("conflict")).toMatchObject({ text: "Anna hat den Entwurf auch geändert.", action: "conflict" });
    expect(save("unauthorized").text).toMatch(/neu anmelden/);
    expect(saveStatus.backupHint("too_large")).toBe("Zu groß für die lokale Sicherung");
    expect(saveStatus.backupHint("ok")).toBeNull();
  });

  it("Rückgängig und Wiederholen laufen über den aktuellen Store", () => {
    const s = open();
    const before = s.get().game;
    s.setField("/meta/title", { de: "Neu" }, "Titel geändert");
    header.runHistory("undo");
    expect(s.get().game).toBe(before);
    header.runHistory("redo");
    expect(s.get().game.meta.title).toEqual({ de: "Neu" });
    s.close();
  });
});

describe("Übersicht", () => {
  it("leitet die nächsten Schritte für das Beispielspiel ab", () => {
    const game = load();
    const steps = overview.nextSteps({ game, meta: {}, issues: validation.validateDraft(game, {}), latestVersion: 1 });
    expect(steps.map((s) => s.id)).toEqual(["grundgeruest", "spielfeld", "vor-ort", "sperrzonen", "texte", "telefon", "raetsel", "probelauf", "veroeffentlichen"]);
    expect(steps.filter((s) => s.state === "done")).toHaveLength(7);
    expect(steps.find((s) => s.id === "veroeffentlichen")!.text).toBe("Veröffentlichen – vorher 1 Fehler beheben");
    expect(steps.find((s) => s.id === "probelauf")!.actions[0]).toMatchObject({ section: "veroeffentlichen", query: { probelauf: "1" } });
  });

  it("zeigt bei einem leeren Spiel, was fehlt, mit Knopf zur Stelle", () => {
    const game = {
      format: { name: "lykora-game", version: "0.1" },
      id: "neu",
      meta: { title: { de: "" }, languages: ["de"] },
      settings: {},
      field: {},
      stations: [],
      safety: { emergency: { gameMasterPhone: "" } },
    } as unknown as Game;
    const steps = overview.nextSteps({ game, meta: {}, issues: validation.validateDraft(game, {}), latestVersion: null });
    const state = Object.fromEntries(steps.map((s) => [s.id, s.state]));
    expect(state).toMatchObject({ grundgeruest: "todo", spielfeld: "error", sperrzonen: "todo", telefon: "error", raetsel: "todo", probelauf: "open", veroeffentlichen: "open" });
    expect(state["vor-ort"]).toBeUndefined();
    expect(steps.find((s) => s.id === "telefon")!.actions[0]!.jump).toEqual({ section: "sicherheit", field: "safety.emergency.gameMasterPhone", path: "/safety/emergency/gameMasterPhone" });
  });

  it("zählt Stationen am Vorlagen-Platz und Rätsel aus der Vorlage; ausgeblendete Meldungen zählen nicht", () => {
    const game = load();
    const ids = game.stations.map((s) => s.id);
    const meta = { template: { id: "nacht", stations: {}, tasks: {}, createdAt: "2026-10-22T10:00:00Z" }, noZones: true };
    const list = [
      issue("station_at_template", "warning", { objectId: ids[0] }),
      issue("station_at_template", "warning", { objectId: ids[1] }),
      issue("template_task_generic", "warning", { section: "stationen", objectId: ids[1] }),
    ];
    let steps = overview.nextSteps({ game, meta, issues: list, latestVersion: null });
    expect(steps.find((s) => s.id === "vor-ort")!.text).toBe("Stationen an echte Orte setzen – 3 von 5 erledigt");
    expect(steps.find((s) => s.id === "raetsel")!.state).toBe("todo");
    expect(steps.find((s) => s.id === "grundgeruest")!.text).toBe("Grundgerüst aus der Vorlage angelegt");
    steps = overview.nextSteps({ game, meta: { ...meta, dismissed: [`station_at_template:${ids[0]}`] }, issues: list, latestVersion: null });
    expect(steps.find((s) => s.id === "vor-ort")!.text).toBe("Stationen an echte Orte setzen – 4 von 5 erledigt");
  });

  it("rechnet das Spiel in Zahlen", () => {
    const facts = overview.gameFacts(load());
    expect(facts).toMatchObject({ stations: 5, hidden: 1, final: true, fragments: 3, finalCode: "191", plannedMin: 30, offPlan: true });
    expect(facts.walkM).toBeGreaterThan(400);
    expect(facts.estimateMin).toBe(Math.round(facts.walkM / overview.WALK_M_PER_MIN + 5 * overview.MIN_PER_STATION));
    expect(overview.distanceM({ lat: 50, lon: 7 }, { lat: 51, lon: 7 })).toBeCloseTo(111195, -1);
    expect(overview.worldLine(load())).toBe("Rettung · Nacht · Grusel 1 · 10–13 J., Erwachsene");
    expect(overview.gameFacts({ stations: [] } as unknown as Game)).toMatchObject({ stations: 0, walkM: 0, estimateMin: 0, offPlan: false });
  });
});

describe("Dialoge", () => {
  it("fasst einen Konflikt in Sätzen zusammen", () => {
    const mine = load();
    const theirs = structuredClone(mine);
    theirs.stations[0]!.name = { de: "Fremd" };
    const now = structuredClone(mine);
    now.safety.emergency.gameMasterPhone = "+49 1";
    const text = conflict.conflictSummary(
      { saved: { game: mine, meta: {} }, game: now },
      { gameId: "g1", revision: 3, content: theirs, meta: {}, base_version: 1, updated_at: "2026-10-22T21:44:00Z", updated_by: { id: "a", name: "Anna" } },
    );
    expect(text.who).toBe("Anna");
    expect(text.theirs).toBe("1 Station");
    expect(text.mine).toBe("die Sicherheit");
  });

  it("beschreibt eine lokale Sicherung", () => {
    const game = load();
    const local = structuredClone(game);
    local.meta.title = { de: "Vom Gerät" };
    const at = "2026-10-22T15:02:00Z";
    const text = backup.backupSummary({ revision: 2, game: local, meta: {}, at }, game, Date.parse(at) + 3 * 60_000);
    expect(text.when).toMatch(/22\.10\.2026, \d\d:02 Uhr \(vor 3 Min\)/);
    expect(text.what).toBe("die Angaben zum Spiel");
  });

  it("löscht ohne Verweise sofort, mit Rückgängig", async () => {
    const s = open();
    s.update("Figur angelegt", (g) => void g.characters!.push({ id: "neu", name: { de: "Neu" } }));
    const game = s.get().game;
    expect(await del.deleteWithReferences("figur", "neu", "Neu")).toBe(true);
    expect(s.get().game.characters!.some((c) => c.id === "neu")).toBe(false);
    expect(s.get().undo.at(-1)!.label).toBe("Figur „Neu“ gelöscht");
    s.undo();
    expect(s.get().game).toBe(game);
    expect(del.objectLabel("station", "Baum")).toBe("Station „Baum“");
    expect(
      del.usageLines([
        { path: "/rules/0/when/0", owner: { kind: "regel", id: "r1", name: "Regel 1" }, what: "Bedingung" },
        { path: "/rules/0/when/1", owner: { kind: "regel", id: "r1", name: "Regel 1" }, what: "Bedingung" },
        { path: "/story", owner: { kind: "spiel", name: "Spiel" }, what: "Zentrale" },
      ]),
    ).toEqual(["Regel 1: Bedingung", "Zentrale"]);
    s.close();
  });

  it("fragt vor dem Löschen, wenn etwas verweist", async () => {
    const s = open();
    const target = s.get().game.stations.find((st) => references.usagesOf(s.get().game, "station", st.id).length)!.id;
    const before = s.get().game;
    let settled = false;
    void del.deleteWithReferences("station", target, "Baum").then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(s.get().game).toBe(before);
    s.close();
  });

  it("prüft neue Kennungen in der Expertenansicht", () => {
    const game = load();
    const [a, b] = game.stations.map((s) => s.id);
    expect(expert.idProblem(game, "station", a!, "neue-id")).toBeNull();
    expect(expert.idProblem(game, "station", a!, b!)).toMatch(/schon vergeben/);
    expect(expert.idProblem(game, "station", a!, "Groß")).toMatch(/Kleinbuchstaben/);
    expect(expert.idProblem(game, "station", a!, a!)).toMatch(/schon die Kennung/);
  });
});

describe("Bausteine", () => {
  it("SortableList: verschieben mit Tasten und beim Ziehen", () => {
    expect(sortable.moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(sortable.moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(sortable.moveKey("ArrowUp", 0, 3)).toBeNull();
    expect(sortable.moveKey("ArrowDown", 0, 3)).toBe(1);
    expect(sortable.moveKey("End", 0, 3)).toBe(2);
    expect(sortable.moveKey("Home", 2, 3)).toBe(0);
    expect(sortable.moveKey("ArrowDown", 0, 1)).toBeNull();
    expect(sortable.moveKey("x", 1, 3)).toBeNull();
    expect(sortable.dropIndex([10, 30, 50], 5)).toBe(0);
    expect(sortable.dropIndex([10, 30, 50], 40)).toBe(2);
    expect(sortable.dropIndex([10, 30, 50], 99)).toBe(2);
  });

  it("Chips, Zahlen, Dauer und Strafe", () => {
    expect(chips.splitChips("a, b,,a\nc", ["c"], true)).toEqual(["a", "b"]);
    // Antworten: das Komma gehört dazu, nur der Zeilenumbruch trennt.
    expect(chips.splitChips("2,5")).toEqual(["2,5"]);
    expect(chips.splitChips("Berlin, Hauptstadt\r\nBonn")).toEqual(["Berlin, Hauptstadt", "Bonn"]);
    expect(number.parseNumber("1,5")).toBe(1.5);
    expect(number.parseNumber(" ")).toBeNull();
    expect(number.parseNumber("abc")).toBeNull();
    expect(duration.secondsToMinutes(90)).toBe(1.5);
    expect(duration.minutesToSeconds(1.5)).toBe(90);
    expect(duration.minutesToSeconds(-2)).toBe(0);
    expect(duration.minutesLabel(90)).toBe("90 s");
    expect(duration.minutesLabel(5400)).toBe("90 Min");
    expect(penalty.penaltyToForm({ type: "time", amount: 120 })).toEqual({ type: "time", amount: "2" });
    expect(penalty.penaltyToForm({ type: "points", amount: 5 })).toEqual({ type: "points", amount: "5" });
    expect(penalty.penaltyToForm(undefined)).toEqual({ type: "", amount: "" });
    expect(penalty.penaltyFromForm("lockout", "1,5")).toEqual({ type: "lockout", amount: 90 });
    expect(penalty.penaltyFromForm("none", "3")).toEqual({ type: "none" });
    expect(penalty.penaltyFromForm("", "3")).toBeUndefined();
  });

  it("RefSelect zeigt Namen, Kennungen nur für Fachleute", () => {
    const game = load();
    const stations = refs.refOptions(game, "station", "de");
    expect(stations).toHaveLength(5);
    expect(stations[4]!.label.startsWith("★")).toBe(true);
    expect(stations[0]!.label).toBe("1 Sicherheits-Briefing");
    expect(refs.refOptions(game, "station", "de", true)[0]!.label).toContain(`· ${game.stations[0]!.id}`);
    expect(refs.refOptions(game, "teil", "de").map((o) => o.label)).toEqual(["Teil 1 (1)", "Teil 2 (9)", "Teil 3 (1)"]);
    expect(refs.feldFromPath("/stations/1/task/answers/0")).toBe("task.answers.0");
    expect(refs.feldFromPath("/story/chapters/0/title")).toBe("title");
    expect(refs.feldFromPath("/settings/teamSize/min")).toBe("settings.teamSize.min");
  });

  it("FieldFrame verbindet Hinweis und Meldungen über aria-describedby", () => {
    expect(frame.describedBy("f", true, true)).toBe("f-hinweis f-meldungen");
    expect(frame.describedBy("f", false, false)).toBeUndefined();
    expect(frame.hasError([issue("a", "warning")])).toBe(false);
    expect(frame.hasError([issue("a", "error")])).toBe(true);
  });

  it("MediaPicker filtert nach Art", () => {
    expect(picker.matchesAccept("audio", "audio")).toBe(true);
    expect(picker.matchesAccept("image", "audio")).toBe(false);
    expect(picker.matchesAccept("video", "any")).toBe(true);
    expect(picker.acceptedMimes("image")).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("IssueList: Sofort-Lösung ist ein Schritt mit eigenem Text", () => {
    const s = open();
    const fixed: EditorIssue = {
      ...issue("team_size_order", "error", { section: "einstellungen", path: "/settings/teamSize" }),
      fix: { label: "Werte tauschen", undoLabel: "Teamgröße getauscht", apply: (g) => void (g.settings.teamSize = { min: 2, max: 5 }) },
    };
    issueList.applyFix(fixed);
    expect(s.get().game.settings.teamSize).toEqual({ min: 2, max: 5 });
    expect(s.get().undo.at(-1)).toMatchObject({ label: "Teamgröße getauscht", focus: fixed.at });
    expect(issueList.SEVERITY_MARK.hint.mark).toBe("○");
    s.close();
  });
});
