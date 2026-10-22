/**
 * Paket A: Deutsche Satzschablonen je Meldungscode – Schema-Keywords (Ajv), Querverweise
 * (checkReferences) und Baukasten-Prüfungen (checks.ts). Formulierung: erst was zu tun ist, dann warum.
 * Pakete B–E hängen eigene Codes am Ende an (Block „// Paket X“), ohne fremde Einträge zu ändern.
 */

import { translateMessage } from "../validation.ts";

/** Platzhalter: name (Objekt), field (Feldname lesbar), where (Ort lesbar), n (Nummer), dazu die Params der Prüfung. */
export type MessageParams = Record<string, unknown> & { name?: string; field?: string; where?: string; n?: number | string; path?: string };

const q = (s: unknown) => `„${String(s ?? "")}“`;
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const where = (p: MessageParams) => str(p.where, "Dieser Eintrag");
const field = (p: MessageParams) => str(p.field, "Dieses Feld");
const name = (p: MessageParams) => str(p.name, "ohne Namen");

/** Pflichtfeld fehlt (Schema required), Schlüssel = fehlendes Feld. */
const REQUIRED: Record<string, (p: MessageParams) => string> = {
  title: () => "Das Spiel braucht einen Titel.",
  languages: () => "Bitte die Sprache des Spiels wählen.",
  name: (p) => `${str(p.kindLabel, "Der Eintrag")} braucht einen Namen.`,
  triggers: () => "Wie wird die Station geweckt? Bitte mindestens einen Auslöser wählen.",
  location: () => "Bitte den Ort auf der Karte setzen.",
  boundary: () => "Bitte das Spielfeld auf der Karte festlegen.",
  assemblyPoint: () => "Bitte den Sammelpunkt auf der Karte festlegen.",
  gameMasterPhone: () => "Bitte die Handynummer der Spielleitung eintragen – sie steht auf jedem Notfall-Bildschirm.",
  emergency: () => "Bitte die Handynummer der Spielleitung eintragen – sie steht auf jedem Notfall-Bildschirm.",
  safety: () => "Bitte die Handynummer der Spielleitung eintragen – sie steht auf jedem Notfall-Bildschirm.",
  question: () => "Die Aufgabe braucht eine Frage.",
  prompt: () => "Die Aufgabe braucht einen Auftrag.",
  answers: () => "Bitte mindestens eine richtige Antwort eintragen.",
  options: () => "Bitte Antwortmöglichkeiten anlegen und die richtigen ankreuzen.",
  correct: () => "Bitte Antwortmöglichkeiten anlegen und die richtigen ankreuzen.",
  code: () => "Für diesen Auslöser fehlt der Code.",
  tag: () => "Für diesen Auslöser fehlt die Chip-Kennung.",
  uuid: () => "Für diesen Beacon fehlt die UUID.",
  box: () => "Für diesen Auslöser fehlt die Kennung der Box.",
  text: () => "Der Text fehlt.",
  label: () => "Der Antwortknopf braucht eine Beschriftung.",
  id: () => "Interner Fehler: Kennung fehlt.",
  position: (p) => `Teil ${str(p.n, "?")} des Codes hat keine Position.`,
  value: (p) => `Teil ${str(p.n, "?")} des Codes ist leer.`,
  audio: () => "Bitte einen Klang wählen oder die Atmosphäre entfernen.",
  src: (p) => `Medium ${q(p.objectId)} ist unvollständig – bitte neu hochladen.`,
  type: (p) => (str(p.path).startsWith("/media/") ? `Medium ${q(p.objectId)} ist unvollständig – bitte neu hochladen.` : "Bitte die Art der Strafe wählen."),
  when: () => "Eine Regel braucht mindestens eine Bedingung.",
  then: () => "Eine Regel braucht mindestens eine Aktion.",
  polygon: () => "Die Fläche ist unvollständig.",
  center: () => "Die Fläche ist unvollständig.",
  radius: () => "Die Fläche ist unvollständig.",
  stations: () => "Das Spiel braucht mindestens eine Station.",
  meta: () => "Interner Fehler: Der Bereich „Angaben“ fehlt.",
  settings: () => "Interner Fehler: Der Bereich „Grundregeln“ fehlt.",
  field: () => "Interner Fehler: Der Bereich „Spielfeld“ fehlt.",
  format: () => "Das ist keine Lykora-Spieldatei.",
};

const PATTERNS: Record<string, string> = {
  "^[a-z0-9][a-z0-9_-]{0,63}$": "Kennungen dürfen nur Kleinbuchstaben a–z, Ziffern, - und _ enthalten (keine Umlaute, keine Leerzeichen), höchstens 64 Zeichen.",
  "^[a-z]{2,3}(-[A-Z]{2})?$": "Ungültiger Sprachcode – bitte z. B. „de“, „en“ oder „de-CH“.",
  "^\\+?[0-9 ()/-]{5,}$": "Telefonnummer bitte nur mit Ziffern, Leerzeichen, + ( ) / - und mindestens 5 Zeichen, z. B. +49 170 1234567.",
  "^[0-9a-fA-F-]{32,36}$": "Die Beacon-UUID hat nicht das richtige Format.",
};

const MIN_ITEMS: Record<string, string> = {
  stations: "Das Spiel braucht mindestens eine Station.",
  triggers: "Jede Station braucht mindestens einen Auslöser.",
  languages: "Bitte eine Sprache wählen.",
  answers: "Bitte mindestens eine richtige Antwort eintragen.",
  when: "Die Regel braucht mindestens eine Bedingung.",
  then: "Die Regel braucht mindestens eine Aktion.",
  options: "Eine Auswahl braucht mindestens zwei Antwortmöglichkeiten.",
  polygon: "Eine Fläche braucht mindestens drei Eckpunkte.",
};

const RANGES: Record<string, string> = {
  lat: "Diese Koordinate liegt nicht auf der Erde – bitte den Punkt neu auf der Karte setzen.",
  lon: "Diese Koordinate liegt nicht auf der Erde – bitte den Punkt neu auf der Karte setzen.",
  radius: "Der Radius muss größer als 0 m sein.",
  revealRadius: "Der Annäherungs-Radius muss größer als 0 m sein.",
  scareLevel: "Grusel-Stufe 0 bis 3.",
  volume: "Lautstärke höchstens 100 %.",
  major: "Wert außerhalb des Bereichs.",
  minor: "Wert außerhalb des Bereichs.",
  rssi: "Wert außerhalb des Bereichs.",
};

function range(p: MessageParams): string {
  const key = str(p.key);
  if (RANGES[key]) return RANGES[key]!;
  const limit = Number(p.limit);
  if (limit === 1 && (p.comparison === ">=" || p.keyword === "minimum")) return "Mindestens 1.";
  if (limit === 0 && (p.comparison === ">=" || p.keyword === "minimum")) return "Bitte keine negative Zahl.";
  if (p.comparison === ">" || p.keyword === "exclusiveMinimum") return `Der Wert muss größer als ${limit} sein.`;
  if (p.comparison === "<" || p.keyword === "exclusiveMaximum") return `Der Wert muss kleiner als ${limit} sein.`;
  if (p.comparison === "<=" || p.keyword === "maximum") return `Der Wert darf höchstens ${limit} sein.`;
  return `Der Wert muss mindestens ${limit} sein.`;
}

const LISTS: Record<string, string> = {
  stations: "Stationen",
  characters: "Figuren",
  fragments: "Codeteile",
  items: "Gegenstände",
  media: "Medien",
  "story.chapters": "Kapitel",
  rules: "Regeln",
  "field.restrictedZones": "Sperrzonen",
};

const VARIANTS: Record<string, string> = {
  trigger: "Unbekannte Auslöserart.",
  task: "Unbekannte Rätselart.",
  area: "Die Fläche ist unvollständig.",
  condition: "Unfertiger Regelbaustein.",
  action: "Unfertiger Regelbaustein.",
};

export const MESSAGES: Record<string, (p: MessageParams) => string> = {
  // Vor dem Schema
  formatVersion: (p) => `Diese Spieldatei hat ein Format, das der Baukasten nicht kennt (Version ${str(p.version, "unbekannt")}). Bearbeitet werden kann nur Version 0.1.`,

  // Schema (Ajv-Keywords)
  required: (p) => (REQUIRED[str(p.missingProperty)] ?? ((x: MessageParams) => `${q(field(x))} fehlt.`))(p),
  additionalProperties: (p) => `${where(p)} enthält das unbekannte Feld ${q(p.additionalProperty)}. Es stammt wohl aus einer importierten Datei – bitte in der Expertenansicht entfernen.`,
  const: (p) => (str(p.path) === "/format/name" ? "Das ist keine Lykora-Spieldatei." : `Der Wert muss ${q(p.allowedValue)} sein.`),
  pattern: (p) => PATTERNS[str(p.pattern)] ?? "Das Format stimmt nicht.",
  minItems: (p) => MIN_ITEMS[str(p.key)] ?? `Mindestens ${str(String(p.limit ?? ""))} Einträge.`,
  maxItems: (p) => (str(p.key) === "responses" ? "Höchstens drei Antwortknöpfe im Dialog." : `Höchstens ${str(String(p.limit ?? ""))} Einträge.`),
  minLength: (p) => `${q(field(p))} darf nicht leer sein.`,
  maxLength: (p) => `${q(field(p))}: höchstens ${str(String(p.limit ?? ""))} Zeichen.`,
  minProperties: () => "Der Text fehlt.",
  propertyNames: (p) => `Übersetzung mit ungültigem Sprachcode ${q(p.propertyName)}.`,
  minimum: range,
  maximum: range,
  exclusiveMinimum: range,
  exclusiveMaximum: range,
  type: (p) => (p.type === "integer" ? "Bitte eine ganze Zahl (Sekunden bzw. Punkte)." : `Interner Fehler: falscher Datentyp bei ${where(p)}.`),
  enum: () => "Dieser Wert ist nicht erlaubt – bitte aus der Liste wählen.",
  uniqueItems: (p) => (str(p.key) === "languages" ? "Diese Sprache ist doppelt gewählt." : str(p.key) === "ageGroups" ? "Diese Altersgruppe ist doppelt gewählt." : "Doppelter Eintrag."),
  oneOf: (p) => `${where(p)} ist unvollständig oder widersprüchlich.`,
  anyOf: (p) => `${where(p)} ist unvollständig oder widersprüchlich.`,
  unknown_variant: (p) => VARIANTS[str(p.group)] ?? `Interner Fehler: falscher Datentyp bei ${where(p)}.`,

  // Querverweise (checkReferences)
  duplicate_id: (p) => `Zwei ${LISTS[str(p.list)] ?? "Einträge"} haben dieselbe Kennung ${q(p.id)}. Bitte eine umbenennen.`,
  unknown_media: (p) => `${where(p)} verweist auf ein Medium, das es im Spiel nicht mehr gibt (${q(p.id)}). Bitte neu wählen.`,
  not_audio: (p) => `Hier passt nur ein Klang – ${q(p.id)} ist ein ${p.type === "video" ? "Video" : "Bild"}.`,
  unknown_character: (p) => `Ein Takt der Szene an Station ${q(name(p))} lässt eine Figur sprechen, die es nicht mehr gibt (${q(p.id)}).`,
  unknown_item: (p) => `${where(p)} verweist auf einen Gegenstand, den es nicht mehr gibt (${q(p.id)}).`,
  unknown_fragment: (p) => `Station ${q(name(p))} vergibt ein Codeteil, das es nicht mehr gibt (${q(p.id)}).`,
  unknown_station: (p) => `${where(p)} verweist auf eine Station, die es nicht mehr gibt (${q(p.id)}).`,
  unknown_chapter: (p) => `${where(p)} verweist auf ein Kapitel, das es nicht mehr gibt (${q(p.id)}).`,
  gps_without_location: (p) => `Station ${q(name(p))} soll per GPS auslösen, hat aber keinen Ort. Bitte auf der Karte setzen oder GPS abschalten.`,
  fragment_gap: () => "Der Finalcode hat eine Lücke. Bitte die Teile neu ordnen.",
  multiple_finals: () => "Es kann nur ein Finale geben.",
  fragments_without_final: () => "Es gibt Codeteile, aber kein Finale, an dem man sie einsetzt. Bitte eine Station als Finale markieren.",
  hidden_unreachable: (p) => `Station ${q(name(p))} ist versteckt, aber nichts lässt sie erscheinen. Bitte bei einer anderen Station „Danach erscheint …“ wählen, einen Annäherungs-Radius setzen – oder bewusst so lassen (nur die Spielleitung schaltet frei).`,

  // Baukasten-Prüfungen (checks.ts), Paket A
  empty_required_text: (p) => `${field(p)} ist leer.`,
  empty_answer: () => "Eine Antwort ist leer.",
  choice_no_correct: (p) => `Bei Station ${q(name(p))} ist keine Antwort als richtig markiert – so ist die Aufgabe unlösbar.`,
  lock_not_numeric: () => "Ein Zahlenschloss kennt nur Ziffern gleicher Länge.",
  fragment_unassigned: (p) => `Codeteil ${str(String(p.n ?? "?"))} bekommt man nirgends – das Finale öffnet sich nie.`,
  final_without_task: () => "Das Finale hat keine Aufgabe – kein Team kommt von selbst ins Ziel.",
  final_hidden_unreachable: (p) => `Das Finale ${q(name(p))} ist versteckt, aber nichts lässt es erscheinen. Bitte bei einer anderen Station „Danach erscheint …“ wählen oder einen Annäherungs-Radius setzen.`,
  duplicate_code: (p) => `Der Code ${str(p.code)} gehört zu zwei Stationen – die App öffnet immer die erste.`,
  nfc_not_uid: () => "Bitte die Chip-Kennung (UID) eintragen, z. B. 04:A1:B2:C3:D4:E5:F6. Text auf dem Tag wird nicht gelesen.",
  station_in_zone: (p) => `Station ${q(name(p))} liegt in der Sperrzone ${q(p.zone)}.`,
  assembly_in_zone: (p) => `Der Sammelpunkt liegt in der Sperrzone ${q(p.zone)}.`,
  media_wrong_type: (p) => (p.expected === "audio" ? "Hier passt nur ein Klang." : "Hier passt nur ein Bild."),
  team_size_order: () => "Die Mindestgröße der Teams ist größer als die Höchstgröße.",
  incomplete_rule: () => "Der Regelbaustein ist unvollständig – bitte Station, Gegenstand, Kapitel oder Text wählen.",
  zone_unfinished: (p) => `Die Sperrzone ${q(name(p))} hat weniger als drei Ecken.`,
  station_outside_field: (p) => `Station ${q(name(p))} liegt außerhalb des Spielfelds.`,
  station_near_zone: (p) => `Station ${q(name(p))} liegt näher als ${str(String(p.n ?? ""))} m an der Sperrzone ${q(p.zone)}.`,
  gps_overlap: (p) => `Die GPS-Bereiche von ${q(name(p))} und ${q(p.other)} überschneiden sich.`,
  gps_radius_small: (p) => `Der GPS-Radius von ${q(name(p))} ist kleiner als 15 m – das löst oft nicht aus.`,
  station_at_template: (p) => `Station ${q(name(p))} steht noch am Platz aus der Vorlage. Bitte auf der Karte an euren Ort ziehen.`,
  template_task_generic: (p) => `Das Rätsel von ${q(name(p))} stammt unverändert aus der Vorlage. Passt Frage und Lösung an euren Ort an.`,
  gps_only: (p) => `Station ${q(name(p))} löst nur per GPS aus. Ein QR- oder Notfall-Code hilft, wenn GPS spinnt.`,
  station_no_task: (p) => `Station ${q(name(p))} hat keine Aufgabe – nur die Spielleitung kann sie als gelöst werten.`,
  no_final: () => "Ohne Finale kommt kein Team ins Ziel; die Wertung „Wer zuerst entkommt“ ergibt dann keinen Sinn.",
  final_code_mismatch: (p) => `Die Antwort des Finales ist nicht der Code aus den Teilen (${str(p.code)}). Dann zeigt die App kein „Letztes Schloss“.`,
  no_location: (p) => `Station ${q(name(p))} hat keinen Ort und erscheint nicht auf der Karte.`,
  assembly_no_name: () => "Bitte dem Sammelpunkt einen Namen geben – die App sagt „Geht zum Sammelpunkt: …“.",
  reveal_radius_ineffective: () => "Der Annäherungs-Radius wirkt nur bei versteckten Stationen mit Ort und GPS.",
  reveal_visible: (p) => `Station ${q(name(p))} ist schon sichtbar.`,
  find_location_trigger: () => "Die Station muss vorher geweckt werden – bitte einen Auslöser am Startpunkt der Suche setzen (z. B. QR).",
  photo_fragment_manual: () => "Das Codeteil kommt erst, wenn die Spielleitung das Foto annimmt.",
  photo_review_unsupported: () => "Wirkt derzeit wie „Spielleitung prüft live“.",
  short_answer: () => "Kurze Antworten werden ohne Tippfehler-Toleranz geprüft.",
  time_limit_no_duration: () => "Ohne Dauer gibt es kein Zeitlimit.",
  hint_free: (p) => `Tipp ${str(String(p.n ?? "?"))} ist kostenlos, weil keine Kosten für diese Stufe festgelegt sind.`,
  no_age_group: () => "Ohne Altersgruppe braucht jedes Team die Betreuer-PIN.",
  supervisor_off_minors: () => "Bei Minderjährigen sollte die Betreuerpflicht an sein – sonst startet ein Team auch ohne Betreuer.",
  scare_too_high: () => "Grusel-Stufe 2 oder 3 passt nicht zu 6- bis 9-Jährigen.",
  night_no_zones: () => "Für Nachtspiele empfohlen: Sperrzonen für Straßen, Wasser und Abhänge.",
  night_no_gear: () => "Für Nachtspiele empfohlen: Lampe und Warnweste als Pflichtausrüstung.",
  no_zones: () => "Noch keine Sperrzonen. Gibt es Straßen, Wasser oder Abhänge im Spielfeld?",
  no_rescue_point: () => "Noch kein Rettungspunkt. Wo kann der Rettungsdienst hinfahren?",
  night_speed_bonus: () => "Nachtspiel mit Schnelligkeitspunkten – das verleitet zum Rennen im Dunkeln.",
  rule_else_once: () => "„Sonst“ läuft nur, wenn die erste Bedingung stimmt und eine spätere nicht – nicht, wenn gar nichts zutrifft.",
  rule_repeat: () => "Diese Regel feuert bei jeder Auswertung erneut – Punkte und Nachrichten vervielfachen sich.",
  rule_message_from: () => "Nur Funksprüche der Zentrale erscheinen sauber im Funk-Protokoll – bitte „Zentrale“ als Absender wählen.",
  rule_has_item_document: () => "Dieses Schriftstück kommt nur über einen Szenentakt und landet nie im Inventar – die Bedingung greift nicht.",
  rule_elapsed_near: () => "Zeit und Ort werden erst bei der nächsten Aktion des Teams geprüft, nicht laufend.",
  rule_fragments_too_many: () => "So viele Codeteile gibt es im Spiel nicht – die Bedingung kann nie zutreffen.",
  rule_reveal_visible: (p) => `Station ${q(name(p))} ist schon sichtbar – „erscheint“ bewirkt nichts.`,
  chapter_never_starts: (p) => `Kapitel ${q(name(p))} beginnt nie – keine Station und keine Regel startet es.`,
  item_never_given: (p) => `Gegenstand ${q(name(p))} bekommt kein Team – keine Station und keine Regel vergibt ihn.`,
  character_silent: (p) => `Figur ${q(name(p))} kommt in keiner Szene vor.`,
  languages_extra: () => "Die App zeigt derzeit nur die erste Sprache.",
  sms_fallback_missing: () => "SOS-SMS gehen ohne Gateway-Nummer an das Handy der Spielleitung.",
  media_too_large: (p) => `Die Medien sind zusammen ${str(p.size)} groß – mehr als 50 MB machen den Download vor dem Spiel langsam.`,
  no_intro: () => "Ein Einsatzbefehl zu Beginn holt die Teams in die Geschichte.",
  no_hints: (p) => `Station ${q(name(p))} hat keine Tipps – ein Team, das nicht weiterkommt, muss die Spielleitung rufen.`,
  no_scene: (p) => `Station ${q(name(p))} hat keine Szene – ein Satz bei der Ankunft macht sie lebendig.`,
};

/** Satz zu einem Code; unbekannte Codes bekommen den übersetzten Rohtext und den Ort. */
export function messageFor(code: string, params: MessageParams): string {
  const fn = MESSAGES[code];
  if (fn) return fn(params);
  const raw = str(params.message);
  const text = raw ? translateMessage(raw) : code;
  return params.where ? `${params.where}: ${text}` : text;
}
