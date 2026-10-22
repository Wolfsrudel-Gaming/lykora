/**
 * Paket A: Prüfung des Entwurfs im Browser mit demselben Kern wie der Server
 * (spec/validate-core.mjs). Aus Schema-, Querverweis- und Baukasten-Meldungen werden
 * EditorIssues mit Feldadresse und deutschem Satz; oneOf-Rauschen von Ajv wird zusammengefasst.
 */

import type { ReferenceIssue, SchemaIssue } from "@lykora/spec";
import { checkReferences, createValidator } from "@lykora/spec/validate-core.mjs";
import schema from "@lykora/spec/v0.1/game.schema.json";
import { CHECKS } from "./checks.ts";
import { messageFor, type MessageParams } from "./messages.ts";
import { getAt, joinPointer, parsePointer } from "./paths.ts";
import { readText } from "./text.ts";
import { SECTIONS, type EditorIssue, type EditorMeta, type FieldAddress, type Game, type JsonPointer, type Section, type Severity } from "./types.ts";

type Json = Record<string, unknown>;
const isIndex = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);

// Adressen

/** Listen mit eigener ID (Inventar §21): Pfadpräfix → Art und Bezeichnung. */
const OBJECT_LISTS: { prefix: string[]; kind: string; label: string }[] = [
  { prefix: ["stations"], kind: "station", label: "Station" },
  { prefix: ["rules"], kind: "regel", label: "Regel" },
  { prefix: ["characters"], kind: "figur", label: "Figur" },
  { prefix: ["story", "chapters"], kind: "kapitel", label: "Kapitel" },
  { prefix: ["items"], kind: "gegenstand", label: "Gegenstand" },
  { prefix: ["fragments"], kind: "teil", label: "Codeteil" },
  { prefix: ["field", "restrictedZones"], kind: "zone", label: "Sperrzone" },
  { prefix: ["media"], kind: "medium", label: "Medium" },
];

function objectList(parts: string[]) {
  for (const o of OBJECT_LISTS) {
    if (parts.length > o.prefix.length && o.prefix.every((p, i) => parts[i] === p) && isIndex(parts[o.prefix.length])) return o;
  }
  return null;
}

const SETTINGS_META = new Set(["languages", "authors", "license", "expectedDuration"]);

function sectionOf(parts: string[]): Section {
  const [a, b] = parts;
  switch (a) {
    case "meta":
      return b !== undefined && SETTINGS_META.has(b) ? "einstellungen" : "geschichte";
    case "presentation":
    case "story":
    case "characters":
      return "geschichte";
    case "settings":
      return "einstellungen";
    case "field":
      return b === "rescuePoints" || b === "supplyPoints" ? "sicherheit" : "karte";
    case "fragments":
    case "items":
      return "belohnungen";
    case "stations":
      return isIndex(b) ? "stationen" : "karte";
    case "rules":
      return "regeln";
    case "safety":
      return "sicherheit";
    case "sound":
      return "klang";
    case "media":
      return "medien";
    default:
      return "einstellungen";
  }
}

/** Pointer → stabile Feldadresse (Bereich, Objekt-ID, Feld relativ zum Objekt). Ohne ID: "#<Index>". */
export function addressOf(path: JsonPointer, game: Game): FieldAddress {
  const parts = parsePointer(path);
  const section = sectionOf(parts);
  const o = objectList(parts);
  if (o) {
    const index = Number(parts[o.prefix.length]);
    const entry = getAt<Json>(game, joinPointer([...o.prefix, index]));
    const id = typeof entry?.id === "string" && entry.id ? entry.id : `#${index}`;
    const rest = parts.slice(o.prefix.length + 1);
    return { section, objectId: id, field: rest.length ? rest.join(".") : undefined, path };
  }
  return parts.length ? { section, field: parts.join("."), path } : { section, path };
}

/** Feldadresse → Pointer im aktuellen Spiel; null, wenn das Objekt nicht mehr da ist. */
export function pointerOf(address: FieldAddress, game: Game): JsonPointer | null {
  const field = address.field ? address.field.split(".") : [];
  if (!address.objectId) return field.length ? joinPointer(field) : address.path;
  const o = objectList(parsePointer(address.path));
  if (!o) return null;
  const entries = getAt<Json[]>(game, joinPointer(o.prefix));
  if (!Array.isArray(entries)) return null;
  const m = /^#(\d+)$/.exec(address.objectId);
  const index = m ? Number(m[1]) : entries.findIndex((e) => e?.id === address.objectId);
  if (index < 0 || index >= entries.length) return null;
  return joinPointer([...o.prefix, index, ...field]);
}

/** Art und Name des Objekts einer Adresse, für Meldungen („Station „Baum““). */
export function describeObject(address: FieldAddress, game: Game): { kind: string; label: string; name: string; index: number } | null {
  const o = objectList(parsePointer(address.path));
  if (!o || !address.objectId) return null;
  const pointer = pointerOf({ ...address, field: undefined }, game);
  const entry = pointer === null ? undefined : getAt<Json>(game, pointer);
  const index = pointer === null ? -1 : Number(parsePointer(pointer).pop());
  const lang = game?.meta?.languages?.[0] ?? "de";
  let name = "";
  if (entry) {
    if (o.kind === "teil") name = `Teil ${typeof entry.position === "number" ? entry.position : index + 1}`;
    else name = readText((entry.name ?? entry.title) as never, lang) || (typeof entry.id === "string" ? entry.id : "");
  }
  return { kind: o.kind, label: o.label, name: name || `${o.label} ${index + 1}`, index };
}

// Lesbare Feldnamen (für „Feld ist leer“, „bei {Ort}“)

export const FIELD_LABELS: Record<string, string> = {
  meta: "Angaben", title: "Titel", summary: "Kurzbeschreibung", authors: "Autoren", languages: "Sprachen", ageGroups: "Altersgruppen", genre: "Genre", scareLevel: "Grusel-Stufe", night: "Nachtspiel", expectedDuration: "Erwartete Dauer", license: "Lizenz",
  settings: "Grundregeln", mode: "Spielart", winCondition: "Wertung", time: "Zeit", limit: "Zeitlimit", duration: "Dauer", teamSize: "Teamgröße", min: "Mindestens", max: "Höchstens", wrongAnswer: "Falsche Antwort", hints: "Tipps", enabled: "An", defaultCost: "Standardkosten", scoring: "Punkte", solvePoints: "Punkte je Rätsel", speedBonus: "Schnelligkeitspunkte", firstOnSiteBonus: "Bonus für die Ersten", streakBonus: "Serienbonus", tieBreak: "Gleichstand", leaderboard: "Rangliste", showOwnPosition: "Eigene Position", map: "Karte", style: "Kartenstil", tiles: "Kacheln",
  field: "Spielfeld", boundary: "Spielfeld", start: "Startpunkt", assemblyPoint: "Sammelpunkt", restrictedZones: "Sperrzonen", rescuePoints: "Rettungspunkte", supplyPoints: "Versorgungspunkte", area: "Fläche", polygon: "Ecken", center: "Mittelpunkt", radius: "Radius", warnDistance: "Warnabstand", penalty: "Strafe", alertGameMaster: "Spielleitung alarmieren", location: "Ort", lat: "Koordinate", lon: "Koordinate",
  story: "Geschichte", intro: "Einsatzbefehl", outro: "Auflösung", hq: "Zentrale", avatar: "Bild", chapters: "Kapitel", piece: "Erzählstück", ambience: "Atmosphäre", audio: "Klang", volume: "Lautstärke", speaker: "Sprecher", presentation: "Spielwelt", device: "Gerät", caseFile: "Akte", stamp: "Stempel",
  characters: "Figuren", name: "Name", callSign: "Rufzeichen", description: "Beschreibung", portrait: "Porträt", kind: "Art",
  fragments: "Codeteile", position: "Position", value: "Wert", label: "Beschriftung", items: "Gegenstände", icon: "Symbol", body: "Inhalt", image: "Bild", tradeable: "Tauschbar",
  stations: "Stationen", visibility: "Sichtbarkeit", revealRadius: "Annäherungs-Radius", final: "Finale", offPath: "Abseits der Wege", triggers: "Auslöser", type: "Art", code: "Code", tag: "Chip-Kennung", uuid: "UUID", box: "Box", event: "Ereignis",
  scene: "Szene", arrival: "Ankunft", beats: "Takte", afterSolve: "Nach dem Lösen", text: "Text", sfx: "Geräusch", item: "Fundstück", ack: "Bestätigung", responses: "Antwortknöpfe", reply: "Antwort", approach: "Annäherung", far: "Fern", mid: "Mittel", near: "Nah", here: "Am Ort",
  task: "Aufgabe", question: "Frage", prompt: "Auftrag", answers: "Antworten", match: "Vergleich", manualReview: "Prüfung von Hand", input: "Eingabe", options: "Antwortmöglichkeiten", correct: "Richtig", shuffle: "Mischen", video: "Video", review: "Prüfung", cost: "Kosten", amount: "Betrag",
  rewards: "Belohnung", points: "Punkte", reveal: "Danach erscheint", chapter: "Kapitel", props: "Requisiten", quantity: "Anzahl", note: "Hinweis", notes: "Notizen", sound: "Klang", from: "Ab Stufe", solved: "Lösungsgeräusch",
  rules: "Regeln", when: "Wenn", then: "Dann", else: "Sonst", once: "Nur einmal", station_solved: "Station gelöst", has_item: "Team hat", fragments_collected: "Codeteile gesammelt", elapsed: "Spielzeit", reveal_station: "Station erscheint", give_item: "Team bekommt", add_points: "Punkte", message: "Funkspruch", start_chapter: "Kapitel beginnt",
  safety: "Sicherheit", emergency: "Notfall", gameMasterPhone: "Handynummer der Spielleitung", emergencyNumber: "Notrufnummer", heartbeat: "Lebenszeichen", interval: "Abstand", grace: "Nachfrist", sos: "SOS", smsFallback: "SMS-Nummer", lora: "LoRa", loudSignal: "Lautes Signal", requireSupervisor: "Betreuerpflicht", requiredGear: "Pflichtausrüstung",
  ui: "Geräusche der App", media: "Medien", src: "Datei", alt: "Beschreibung", transcript: "Transkript", credit: "Urheber", id: "Kennung", format: "Format", version: "Version",
};

/** Hauptwörter für Listeneinträge, z. B. beats/0 → „Takt 1“. */
const NOUNS: Record<string, string> = {
  stations: "Station", chapters: "Kapitel", characters: "Figur", fragments: "Codeteil", items: "Gegenstand", media: "Medium", rules: "Regel", restrictedZones: "Sperrzone", rescuePoints: "Rettungspunkt", supplyPoints: "Versorgungspunkt",
  triggers: "Auslöser", hints: "Tipp", options: "Antwortmöglichkeit", answers: "Antwort", beats: "Takt", arrival: "Ankunft-Takt", afterSolve: "Takt nach dem Lösen", responses: "Antwortknopf", props: "Requisite", when: "Bedingung", then: "Aktion", else: "Sonst-Aktion", polygon: "Ecke", languages: "Sprache", ageGroups: "Altersgruppe", requiredGear: "Ausrüstung", defaultCost: "Stufe", authors: "Autor",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** Feldpfad relativ zum Objekt in Worten: "scene.beats.0.audio" → „Szene › Takt 1 › Klang“. */
export function describeField(field: string | undefined): string {
  if (!field) return "";
  const parts = field.split(".");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!;
    const next = parts[i + 1];
    if (isIndex(next) && NOUNS[key]) {
      out.push(`${NOUNS[key]} ${Number(next) + 1}`);
      i++;
    } else if (!isIndex(key)) out.push(fieldLabel(key));
  }
  return out.join(" › ");
}

/** Ort einer Adresse in Worten: „Station „Baum“ › Szene › Takt 1 › Klang“ – ohne IDs. */
export function describeWhere(address: FieldAddress, game: Game): string {
  const obj = describeObject(address, game);
  const field = describeField(address.field);
  if (obj) return field ? `${obj.label} „${obj.name}“ › ${field}` : `${obj.label} „${obj.name}“`;
  return field || "Spiel";
}

// Meldungen

/** Stabile Kennung: Code, Adresse und der unterscheidende Parameter. */
export function issueId(code: string, at: FieldAddress, paramKey = ""): string {
  return `${code}:${at.section}:${at.objectId ?? ""}:${at.field ?? ""}:${paramKey}`;
}

const SCHEMA_PARAM_KEYS = ["missingProperty", "additionalProperty", "propertyName", "allowedValue", "limit"];

/** Letzter benannter Schlüssel ohne Listenplatz: "/task/answers/0" → "answers". */
function keyOf(parts: string[]): string {
  for (let i = parts.length - 1; i >= 0; i--) if (!isIndex(parts[i])) return parts[i]!;
  return "";
}

/** „Die Station“, „Der Gegenstand“ … für „braucht einen Namen“. */
const KIND_LABELS: Record<string, string> = { stations: "Die Station", characters: "Die Figur", items: "Der Gegenstand", props: "Die Requisite", restrictedZones: "Die Sperrzone", rescuePoints: "Der Rettungspunkt", supplyPoints: "Der Versorgungspunkt", hq: "Die Zentrale", assemblyPoint: "Der Sammelpunkt" };

/**
 * Eine Baukasten-Meldung bauen (auch für die CHECKS der Pakete B–E): Adresse aus dem Pfad,
 * Satz aus messages.ts mit Objektname, Feld und Ort als Platzhalter.
 */
export function makeIssue(
  game: Game,
  code: string,
  path: JsonPointer,
  severity: Severity,
  params: MessageParams = {},
  opts: { source?: EditorIssue["source"]; fix?: EditorIssue["fix"]; paramKey?: string } = {},
): EditorIssue {
  const at = addressOf(path, game);
  const obj = describeObject(at, game);
  const parts = parsePointer(path);
  const key = keyOf(parts);
  const full: MessageParams = {
    key,
    field: fieldLabel(key),
    where: describeWhere(at, game),
    name: obj?.name,
    objectId: at.objectId,
    n: obj ? obj.index + 1 : undefined,
    path,
    ...params,
  };
  const paramKey = opts.paramKey ?? SCHEMA_PARAM_KEYS.map((k) => params[k]).find((v) => v !== undefined);
  return {
    id: issueId(code, at, paramKey === undefined ? "" : String(paramKey)),
    severity,
    code,
    message: messageFor(code, full),
    at,
    source: opts.source ?? "editor",
    fix: opts.fix,
    dismissable: severity !== "error",
  };
}

// oneOf-Rauschen zusammenfassen

type Group = "trigger" | "task" | "area" | "condition" | "action" | "text";
const TRIGGER_TYPES = ["gps", "qr", "nfc", "ble", "manual", "box"];
const TASK_TYPES = ["text", "code", "choice", "photo", "find_location"];
const CONDITION_KEYS = ["station_solved", "has_item", "fragments_collected", "elapsed", "near"];
const ACTION_KEYS = ["reveal_station", "give_item", "add_points", "message", "start_chapter"];

function groupOf(path: string): Group {
  if (/^\/stations\/\d+\/triggers\/\d+$/.test(path)) return "trigger";
  if (/^\/stations\/\d+\/task$/.test(path)) return "task";
  if (/^\/field\/boundary$/.test(path) || /^\/field\/restrictedZones\/\d+\/area$/.test(path)) return "area";
  if (/^\/rules\/\d+\/when\/\d+$/.test(path)) return "condition";
  if (/^\/rules\/\d+\/(then|else)\/\d+$/.test(path)) return "action";
  return "text";
}

/** Welche oneOf-Variante gemeint ist; -1 = nicht erkennbar (unbekannte Art). */
function variantOf(group: Group, value: unknown): number {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  const keys = obj ? Object.keys(obj) : [];
  switch (group) {
    case "trigger":
      return TRIGGER_TYPES.indexOf(String(obj?.type));
    case "task":
      return TASK_TYPES.indexOf(String(obj?.type));
    case "area":
      return obj && "polygon" in obj ? 0 : obj && ("center" in obj || "radius" in obj) ? 1 : -1;
    case "condition":
      return keys.length === 1 ? CONDITION_KEYS.indexOf(keys[0]!) : -1;
    case "action":
      return keys.length === 1 ? ACTION_KEYS.indexOf(keys[0]!) : -1;
    case "text":
      return typeof value === "string" ? 0 : obj ? 1 : -1;
  }
}

/**
 * Ajv meldet bei oneOf die Fehler aller Varianten. Je Gruppe (Pfad des oneOf-Fehlers) bleibt nur,
 * was zur erkannten Variante gehört; const, fremde required/additionalProperties und der
 * oneOf-Fehler selbst fallen weg. Ist die Art nicht erkennbar, bleibt eine Meldung unknown_variant.
 * Innere Gruppen (Text in einer Aufgabe) werden von Ajv je äußerer Variante wiederholt – Dubletten fallen weg.
 */
export function collapseSchemaIssues(issues: SchemaIssue[], game: unknown): SchemaIssue[] {
  const roots = [...new Set(issues.filter((i) => i.keyword === "oneOf").map((i) => i.path))].sort((a, b) => b.length - a.length);
  const rootOf = (path: string) => roots.find((r) => path === r || path.startsWith(`${r}/`));
  const groups = new Map<string, SchemaIssue[]>();
  const plain: SchemaIssue[] = [];
  for (const issue of issues) {
    const root = rootOf(issue.path);
    if (root === undefined) plain.push(issue);
    else groups.set(root, [...(groups.get(root) ?? []), issue]);
  }
  const out: SchemaIssue[] = [...plain];
  for (const [root, members] of groups) {
    const group = groupOf(root);
    const value = getAt(game, root);
    const variant = variantOf(group, value);
    if (variant < 0) {
      const obj = value && typeof value === "object" ? (value as Json) : null;
      out.push({ kind: "schema", path: root, keyword: "unknown_variant", message: "", params: { group, type: obj?.type, keys: obj ? Object.keys(obj) : [] }, schemaPath: "" });
      continue;
    }
    let kept = members.filter((i) => {
      if (i.path === root && i.keyword === "oneOf") return false;
      if (i.keyword === "const") return false;
      const m = /^#\/oneOf\/(\d+)\//.exec(i.schemaPath);
      return !m || Number(m[1]) === variant;
    });
    // Falscher Sprachschlüssel: propertyNames nennt ihn, das pattern dazu sagt dasselbe noch einmal.
    if (group === "text") kept = kept.filter((i) => i.keyword !== "pattern" || !kept.some((o) => o.keyword === "propertyNames" && o.path === i.path));
    if (!kept.length) kept = members.filter((i) => i.path === root && i.keyword === "oneOf");
    out.push(...kept);
  }
  const seen = new Set<string>();
  return out.filter((i) => {
    const key = `${i.path}|${i.keyword}|${i.schemaPath}|${JSON.stringify(i.params)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Ergebnis → EditorIssues

let validator: ((game: unknown) => ReturnType<ReturnType<typeof createValidator>>) | null = null;

/** Schema-Prüfer (Ajv-Kompilat entsteht beim ersten Aufruf, ~100 ms). */
function validate(game: unknown) {
  validator ??= createValidator({ "0.1": schema as object });
  return validator(game);
}

function fromSchema(issue: SchemaIssue, game: Game): EditorIssue {
  const missing = issue.keyword === "required" ? String(issue.params.missingProperty) : null;
  const path = missing === null ? issue.path : `${issue.path}/${missing}`;
  const parts = parsePointer(path);
  const listKey = isIndex(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
  const params: MessageParams = { ...issue.params, keyword: issue.keyword, message: issue.message, kindLabel: KIND_LABELS[listKey ?? ""] ?? "Der Eintrag" };
  if (issue.keyword === "formatVersion") return makeIssue(game, "formatVersion", "/format/version", "error", params, { source: "schema" });
  return makeIssue(game, issue.keyword, path, "error", params, { source: "schema" });
}

function fromReference(issue: ReferenceIssue, game: Game, severity: Severity): EditorIssue {
  const params: MessageParams = { ...issue.params, message: issue.message };
  return makeIssue(game, issue.code, issue.path, severity, params, { source: "reference", paramKey: String(issue.params.id ?? issue.params.station ?? "") });
}

/** Liegt an diesem Pfad oder darunter schon ein Schemafehler? Dann ist die zweite Meldung Rauschen. */
function shadowed(path: JsonPointer, schemaPaths: string[]): boolean {
  return schemaPaths.some((p) => p === path || p.startsWith(`${path}/`));
}

/**
 * Alle Meldungen zum Entwurf: Schema (zusammengefasst) → Querverweise → Baukasten-Prüfungen.
 * Querverweise und Baukasten-Fehler, die unter einem Schemafehler liegen, fallen weg (ein Problem, eine Meldung).
 * Läuft auch auf kaputten Entwürfen und wirft nicht.
 */
export function validateDraft(game: Game, meta: EditorMeta): EditorIssue[] {
  const out: EditorIssue[] = [];
  const result = validate(game);
  const schemaIssues = collapseSchemaIssues(result.schema, game).map((s) => fromSchema(s, game));
  out.push(...schemaIssues);
  const schemaPaths = schemaIssues.map((i) => i.at.path);
  // Bei unbekannter Formatversion ist nichts weiter prüfbar.
  if (game && typeof game === "object" && !schemaIssues.some((i) => i.code === "formatVersion")) {
    const refs = checkReferences(game);
    for (const r of refs.errors) if (!shadowed(r.path, schemaPaths)) out.push(fromReference(r, game, "error"));
    for (const r of refs.warnings) if (!shadowed(r.path, schemaPaths)) out.push(fromReference(r, game, "warning"));
    const lang = game.meta?.languages?.[0] ?? "de";
    for (const check of CHECKS) {
      try {
        for (const issue of check(game, meta, lang)) if (issue.severity !== "error" || !shadowed(issue.at.path, schemaPaths)) out.push(issue);
      } catch {
        // Eine Prüfung, die an einem Entwurf scheitert, darf die anderen nicht mitreißen.
      }
    }
  }
  // Ein Finale, das nichts freischaltet, meldet der Baukasten als Fehler; die Kern-Warnung dazu entfällt.
  const finalHidden = new Set(out.filter((i) => i.code === "final_hidden_unreachable").map((i) => i.at.objectId));
  const seen = new Set<string>();
  return out.filter((i) => {
    if (i.code === "hidden_unreachable" && finalHidden.has(i.at.objectId)) return false;
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

/** Zähler je Bereich für die Navigation; ausgeblendete Warnungen zählen nicht. Hinweise zählen als Warnungen. */
export function countsBySection(issues: EditorIssue[], dismissed: string[] = []): Record<Section, { errors: number; warnings: number }> {
  const out = Object.fromEntries(SECTIONS.map((s) => [s, { errors: 0, warnings: 0 }])) as Record<Section, { errors: number; warnings: number }>;
  const hidden = new Set(dismissed);
  for (const i of issues) {
    if (hidden.has(i.id)) continue;
    if (i.severity === "error") out[i.at.section].errors++;
    else out[i.at.section].warnings++;
  }
  return out;
}

/** Meldungen an einem Feld (oder darunter): Pointer oder Feldadresse. */
export function issuesAt(issues: EditorIssue[], target: JsonPointer | FieldAddress): EditorIssue[] {
  if (typeof target === "string") {
    if (!target || target === "/") return issues;
    return issues.filter((i) => i.at.path === target || i.at.path.startsWith(`${target}/`));
  }
  return issues.filter((i) => {
    if (i.at.section !== target.section || (i.at.objectId ?? "") !== (target.objectId ?? "")) return false;
    if (!target.field) return true;
    return i.at.field === target.field || (i.at.field?.startsWith(`${target.field}.`) ?? false);
  });
}

/** Wichtigste Stufe zuerst: Fehler, Warnung, Hinweis. */
export function bySeverity(issues: EditorIssue[]): EditorIssue[] {
  const rank: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
