/**
 * Paket C: Stationen anlegen und umbauen – neue Station je Baustein, Auslöser, Rätsel und Takte
 * mit sauberem Typwechsel (keine Felder der alten Art bleiben zurück), Altdaten in eine Szene
 * umwandeln, Finale exklusiv setzen, Sichtbarkeit als eine Antwort. Alles arbeitet auf dem Entwurf
 * (innerhalb einer update-Mutation) oder liefert neue Objekte; Codes sind spielweit eindeutig.
 */

import { coupleFinal, FINAL_QUESTION, finalCode, isCoupled } from "./fragments.ts";
import { allCodes, newId, newManualCode, newQrCode, takenIds } from "./ids.ts";
import { readText } from "./text.ts";
import type { Game, Point, Station } from "./types.ts";

export type Trigger = Station["triggers"][number];
export type TriggerType = Trigger["type"];
export type Task = NonNullable<Station["task"]>;
export type TaskType = Task["type"];
export type Scene = NonNullable<Station["scene"]>;
export type Beat = NonNullable<Scene["arrival"]>[number];
export type BeatKind = Beat["kind"];
export type ScenePart = keyof Scene;

/** Bausteine für „+ Station“ (Karte, Assistent, Sicherheit). */
export type StationKind = "raetsel" | "erzaehl" | "foto" | "briefing" | "finale";

export const STATION_KINDS: Record<StationKind, { label: string; hint: string }> = {
  raetsel: { label: "Rätsel-Station", hint: "Frage mit getippter Antwort" },
  erzaehl: { label: "Erzähl-Station", hint: "Nur Szene, ohne Rätsel" },
  foto: { label: "Foto-Station", hint: "Teams schicken ein Foto" },
  briefing: { label: "Sicherheits-Briefing", hint: "Alle zusammen, kurze Auswahlfrage" },
  finale: { label: "Finale", hint: "Öffnet sich mit allen Codeteilen" },
};

export const TRIGGER_TYPES: TriggerType[] = ["gps", "qr", "nfc", "manual", "ble", "box"];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  gps: "GPS",
  qr: "QR-Code",
  nfc: "NFC-Tag",
  manual: "Notfall-Code",
  ble: "Bluetooth-Beacon",
  box: "ESP32-Box",
};

export const TASK_TYPES: TaskType[] = ["text", "code", "choice", "photo", "find_location"];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  text: "Antwort eintippen",
  code: "Zahlenschloss / Code",
  choice: "Auswahl",
  photo: "Foto oder Video",
  find_location: "Ort finden",
};

/** Standardwerte des Formats je Rätselart: Platzhalter im Formular, nie geschrieben, solange niemand sie setzt. */
export const TASK_DEFAULTS = {
  text: { match: { ignoreCase: true, ignoreWhitespace: true, maxTypos: 1 }, manualReview: false },
  code: {},
  choice: { shuffle: true },
  photo: { video: false, review: "live" as const },
  find_location: { radius: 20 },
} satisfies Record<TaskType, object>;

/** GPS-Radius, Annäherungs-Radius und Punkte, wenn nichts gesetzt ist (Inventar §13). */
export const GPS_RADIUS = 20;
export const REVEAL_RADIUS = 30;
export const SOLVE_POINTS = 100;
export const MAX_RESPONSES = 3;

export const SCENE_PARTS: ScenePart[] = ["arrival", "beats", "afterSolve"];

export const BEAT_KINDS: BeatKind[] = ["narration", "radio", "dialogue", "document", "image", "group", "chapter"];

export const BEAT_KIND_INFO: Record<BeatKind, { label: string; hint: string }> = {
  narration: { label: "Erzähler", hint: "Eine Stimme erzählt, was das Team sieht." },
  radio: { label: "Funkspruch", hint: "Die Zentrale meldet sich; landet im Funk-Protokoll." },
  dialogue: { label: "Gespräch", hint: "Eine Figur spricht, das Team wählt eine Antwort." },
  document: { label: "Fundstück", hint: "Ein Schriftstück zum Lesen, auf Wunsch in die Akte." },
  image: { label: "Bild", hint: "Ein Bild mit Bildunterschrift." },
  group: { label: "Anweisung an alle", hint: "Alle machen mit: „Lampen an“, „Seid still“." },
  chapter: { label: "Kapitelkarte", hint: "Zeigt eine Kapitelkarte, ändert das Kapitel aber nicht." },
};

/** Felder, die eine Takt-Art nutzt (App: beats.dart); der Rest fällt beim Wechsel weg. */
export const BEAT_FIELDS: Record<BeatKind, (keyof Beat)[]> = {
  narration: ["speaker", "text", "audio", "sfx", "ack"],
  radio: ["speaker", "text", "audio", "sfx", "ack"],
  dialogue: ["speaker", "text", "audio", "sfx", "responses"],
  document: ["title", "text", "item", "audio", "sfx"],
  image: ["image", "title", "text", "audio", "sfx"],
  group: ["text", "ack", "audio", "sfx"],
  chapter: ["title", "text", "audio", "sfx"],
};

const BEAT_KEYS = new Set<string>(["kind", "speaker", "title", "text", "audio", "sfx", "image", "item", "ack", "responses"]);

const langOf = (game: Game) => game.meta?.languages?.[0] ?? "de";
const empty = (lang: string) => ({ [lang]: "" });
type Json = Record<string, unknown>;

// Auslöser

/** Neuer Auslöser; QR- und Notfall-Codes sind zufällig und gegen alle Codes des Spiels eindeutig. */
export function newTrigger(type: TriggerType, game: Game): Trigger {
  switch (type) {
    case "gps":
      return { type: "gps", radius: GPS_RADIUS };
    case "qr":
      return { type: "qr", code: newQrCode(allCodes(game)) };
    case "manual":
      return { type: "manual", code: newManualCode(allCodes(game)) };
    case "nfc":
      return { type: "nfc", tag: "" };
    case "ble":
      return { type: "ble", uuid: "" };
    case "box":
      return { type: "box", box: "", event: "solved" };
  }
}

// Rätsel

/** Leeres Rätsel einer Art; find_location bekommt den Ort der Station als Startpunkt. */
export function newTask(type: TaskType, lang: string, near?: Point): Task {
  switch (type) {
    case "text":
      return { type, question: empty(lang), answers: [] };
    case "code":
      return { type, question: empty(lang), answers: [] };
    case "choice":
      return { type, question: empty(lang), options: [{ text: empty(lang), correct: true }, { text: empty(lang), correct: false }] };
    case "photo":
      return { type, prompt: empty(lang) };
    case "find_location":
      return near ? { type, prompt: empty(lang), location: { lat: near.lat, lon: near.lon } } : ({ type, prompt: empty(lang) } as Task);
  }
}

/**
 * Rätselart wechseln: Frage bzw. Auftrag bleibt (question ↔ prompt), Antworten bleiben zwischen
 * Text und Code, Bilder zur Frage zwischen Text, Code und Auswahl; alles andere entsteht neu.
 * Was wegfällt, steht noch im Rückgängig-Verlauf.
 */
export function switchTaskType(task: Task | undefined, type: TaskType, lang: string, near?: Point): Task {
  const next = newTask(type, lang, near) as Json;
  if (!task) return next as Task;
  const old = task as Json;
  if (old.type === type) return task;
  const ask = old.question ?? old.prompt;
  if (ask !== undefined) {
    if ("question" in next) next.question = ask;
    else next.prompt = ask;
  }
  if ((type === "text" || type === "code") && Array.isArray(old.answers)) next.answers = [...(old.answers as string[])];
  if ((type === "text" || type === "code" || type === "choice") && Array.isArray(old.media) && old.media.length) next.media = [...(old.media as string[])];
  if (type === "find_location" && old.location && typeof old.location === "object") next.location = { ...(old.location as Point) };
  return next as Task;
}

// Takte

export function newBeat(kind: BeatKind, lang: string): Beat {
  switch (kind) {
    case "document":
    case "chapter":
      return { kind, title: empty(lang) };
    case "image":
      return { kind };
    default:
      return { kind, text: empty(lang) };
  }
}

/** Art eines Takts wechseln: nur die Felder der neuen Art bleiben (dazu Unbekanntes aus Importen). */
export function switchBeatKind(beat: Beat, kind: BeatKind): Beat {
  const keep = new Set<string>(BEAT_FIELDS[kind]);
  const out: Json = { kind };
  for (const [k, v] of Object.entries(beat)) {
    if (k === "kind") continue;
    if (keep.has(k) || !BEAT_KEYS.has(k)) out[k] = v;
  }
  return out as unknown as Beat;
}

/**
 * Altes Erzählstück (stations[].story) in eine Szene umwandeln, wie die App es beim Spielen tut:
 * speaker hq → Funkspruch, sonst Erzähler; media[0] → Bild-Takt. Liefert eine neue Station ohne story.
 */
export function convertStoryToScene(station: Station): Station {
  const { story, ...rest } = station;
  if (!story) return station;
  const arrival: Beat[] = [];
  if (story.text !== undefined) arrival.push({ kind: story.speaker === "hq" ? "radio" : "narration", text: story.text });
  const image = story.media?.[0];
  if (image) arrival.push({ kind: "image", image });
  const scene: Scene = { ...(station.scene ?? {}) };
  scene.arrival = [...arrival, ...(scene.arrival ?? [])];
  return { ...rest, scene };
}

// Stationen

/**
 * Neue Station aus einem Baustein: GPS (20 m) + QR + Notfall-Code, Codes eindeutig, ID aus dem Namen.
 * Das Finale ist nur dann Finale, wenn es noch keines gibt. Die Station wird nicht eingefügt.
 */
export function newStation(kind: StationKind, name: string, game: Game, opts: { location?: Point } = {}): Station {
  const lang = langOf(game);
  const label = name.trim() || STATION_KINDS[kind].label;
  const station: Station = {
    id: newId("station", label, takenIds(game, "station")),
    name: { [lang]: label },
    triggers: [],
  };
  if (opts.location) station.location = { lat: opts.location.lat, lon: opts.location.lon };
  // Codes nacheinander erzeugen, damit QR- und Notfall-Code sich nicht gleichen.
  const probe = { ...game, stations: [...(game.stations ?? []), station] } as Game;
  for (const type of ["gps", "qr", "manual"] as const) station.triggers.push(newTrigger(type, probe));
  switch (kind) {
    case "raetsel":
      station.task = newTask("text", lang);
      break;
    case "foto":
      station.task = newTask("photo", lang);
      break;
    case "erzaehl":
      station.scene = { arrival: [newBeat("narration", lang)] };
      break;
    case "briefing":
      station.scene = { arrival: [{ kind: "group", text: { [lang]: "Alle zusammenkommen: Lampen an, Warnwesten an, Handys geladen?" }, ack: { [lang]: "Alle bereit" } }] };
      station.task = {
        type: "choice",
        question: { [lang]: "Was tut ihr, wenn ihr euch verlaufen habt?" },
        options: [
          { text: { [lang]: "SOS drücken und am Ort bleiben" }, correct: true },
          { text: { [lang]: "Allein weitersuchen" }, correct: false },
        ],
      };
      break;
    case "finale": {
      const code = finalCode(game);
      if (!(game.stations ?? []).some((s) => s?.final)) station.final = true;
      station.task = { type: "code", question: { [lang]: FINAL_QUESTION }, answers: code ? [code] : [] };
      break;
    }
  }
  return station;
}

/** Finale setzen oder lösen; es gibt nur eines – andere verlieren die Markierung. In place. */
export function setFinal(game: Game, stationId: string, on: boolean): void {
  for (const s of game.stations ?? []) {
    if (!s) continue;
    if (s.id === stationId) {
      if (on) s.final = true;
      else delete s.final;
    } else if (on && s.final) delete s.final;
  }
}

// Sichtbarkeit (UX §7.4): genau eine Antwort auf „Wann sehen Teams diese Station?“

export type VisibilityMode = "visible" | "near" | "station" | "rule" | "leitung";

/** Stationen, deren Belohnung diese Station erscheinen lässt. */
export function revealers(game: Game, stationId: string): Station[] {
  return (game.stations ?? []).filter((s) => s && s.id !== stationId && (s.rewards?.reveal ?? []).includes(stationId));
}

/** Regeln (Listenplatz), die diese Station erscheinen lassen. */
export function revealRules(game: Game, stationId: string): number[] {
  const out: number[] = [];
  (game.rules ?? []).forEach((r, i) => {
    const actions = [...(r?.then ?? []), ...(r?.else ?? [])];
    if (actions.some((a) => a && "reveal_station" in a && a.reveal_station === stationId)) out.push(i);
  });
  return out;
}

export function visibilityMode(game: Game, station: Station): VisibilityMode {
  if (station.visibility !== "hidden") return "visible";
  if (typeof station.revealRadius === "number") return "near";
  if (revealers(game, station.id).length) return "station";
  if (revealRules(game, station.id).length) return "rule";
  return "leitung";
}

/**
 * Sichtbarkeit umstellen (in place). Wechselt die Antwort, entfallen die Freischaltungen über andere
 * Stationen und der Annäherungs-Radius; Regeln bleiben, sie gehören in den Bereich „Regeln“.
 * Bei „station“ schreibt revealer die Belohnung `reveal` der gewählten Station.
 */
export function setVisibility(game: Game, stationId: string, mode: VisibilityMode, revealer?: string): void {
  const station = (game.stations ?? []).find((s) => s?.id === stationId);
  if (!station) return;
  if (mode === "visible") delete station.visibility;
  else station.visibility = "hidden";
  if (mode === "near") station.revealRadius = typeof station.revealRadius === "number" ? station.revealRadius : REVEAL_RADIUS;
  else delete station.revealRadius;
  const keep = mode === "station" ? revealer : undefined;
  for (const s of game.stations ?? []) {
    if (!s || s.id === stationId || !s.rewards?.reveal?.includes(stationId)) continue;
    // „Wenn Station gelöst“ ohne Auswahl lässt die bisherigen Freischaltungen stehen.
    if (mode === "station" && (keep === undefined || s.id === keep)) continue;
    s.rewards.reveal = s.rewards.reveal.filter((id) => id !== stationId);
    if (!s.rewards.reveal.length) delete s.rewards.reveal;
    if (!Object.keys(s.rewards).length) delete s.rewards;
  }
  if (keep) {
    const s = (game.stations ?? []).find((x) => x?.id === keep);
    if (s) {
      s.rewards ??= {};
      s.rewards.reveal = [...new Set([...(s.rewards.reveal ?? []), stationId])];
    }
  }
}

// Codeteile (Kopplung des Finales: fragments.ts)

const DIGITS = "0123456789";

/**
 * „+ neues Codeteil“ an einer Station: hängt einen Teil (eine zufällige Ziffer) an den Finalcode,
 * vergibt ihn hier und zieht ein gekoppeltes Finale mit. Liefert die ID des Teils. In place.
 */
export function addFragment(game: Game, stationId: string, value?: string): string {
  const coupled = isCoupled(game);
  const id = newId("teil", "", takenIds(game, "teil"));
  const position = (game.fragments ?? []).reduce((max, f) => Math.max(max, f?.position ?? 0), 0) + 1;
  const digit = value ?? DIGITS[Math.floor(Math.random() * DIGITS.length)]!;
  game.fragments = [...(game.fragments ?? []), { id, position, value: digit }];
  const station = (game.stations ?? []).find((s) => s?.id === stationId);
  if (station) {
    station.rewards ??= {};
    station.rewards.fragments = [...(station.rewards.fragments ?? []), id];
  }
  if (coupled) coupleFinal(game, true);
  return id;
}

/** Wer einen Codeteil vergibt (Name der Station), für „Teil 2 · 9 – vergeben bei …“. */
export function fragmentOwner(game: Game, fragmentId: string, lang: string): string | null {
  const s = (game.stations ?? []).find((st) => (st?.rewards?.fragments ?? []).includes(fragmentId));
  return s ? readText(s.name as never, lang) || s.id : null;
}

/** Eingefügte Koordinaten lesen: „50.7374, 7.0982“, „50,7374 7,0982“; null, wenn es keine zwei gültigen Zahlen sind. */
export function parseCoordinates(raw: string): Point | null {
  const nums = raw.match(/-?\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  const [lat, lon] = nums.map((n) => Number(n.replace(",", "."))) as [number, number];
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}
