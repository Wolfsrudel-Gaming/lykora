/**
 * Paket A: Baukasten-Prüfungen, die das Schema nicht kennt (Inventar §23.5). Jede Prüfung liefert
 * EditorIssues über makeIssue (Adresse, deutscher Satz, Sofort-Lösung). Sie laufen immer, auch bei
 * Schemafehlern, und müssen unvollständige Entwürfe aushalten (optionale Verkettung, keine Annahmen).
 * Pakete B–E hängen eigene Prüfungen am Ende an (Block „// Paket X“), ohne fremde zu ändern.
 */

import { hasText } from "./text.ts";
import type { EditorIssue, EditorMeta, Game, Station } from "./types.ts";
import { makeIssue } from "./validation.ts";

export type Check = (game: Game, meta: EditorMeta, lang: string) => EditorIssue[];

type Json = Record<string, unknown>;
type Task = NonNullable<Station["task"]>;
type Beat = NonNullable<NonNullable<Station["scene"]>["beats"]>[number];

const list = <T>(x: T[] | undefined | null): T[] => (Array.isArray(x) ? x : []);
/** Stationen mit Listenplatz; Lücken im Entwurf (null) fallen weg. */
const stations = (g: Game): [Station, number][] => list(g.stations).map((s, i): [Station, number] => [s, i]).filter(([s]) => s && typeof s === "object");
const beats = (s: Station): [Beat, string][] =>
  (["arrival", "beats", "afterSolve"] as const).flatMap((part) => list(s.scene?.[part]).map((b, j): [Beat, string] => [b, `scene/${part}/${j}`]).filter(([b]) => b && typeof b === "object"));

/** Welche Stationen etwas freischaltet (Belohnung oder Regel). */
function revealed(g: Game): Set<string> {
  const out = new Set<string>();
  for (const [s] of stations(g)) for (const id of list(s.rewards?.reveal)) out.add(id);
  for (const r of list(g.rules)) for (const a of [...list(r?.then), ...list(r?.else)]) if (a && "reveal_station" in a) out.add(a.reveal_station);
  return out;
}

const TEXT_FIELDS: Check = (g, _meta, lang) => {
  const out: EditorIssue[] = [];
  const check = (value: unknown, path: string, field: string) => {
    if (value !== undefined && !hasText(value as never, lang)) out.push(makeIssue(g, "empty_required_text", path, "error", { field }));
  };
  check(g.meta?.title, "/meta/title", "Der Titel");
  for (const [s, i] of stations(g)) {
    const p = `/stations/${i}`;
    check(s.name, `${p}/name`, "Der Name der Station");
    const task = s.task as Json | undefined;
    if (task) {
      if ("question" in task) check(task.question, `${p}/task/question`, "Die Frage");
      if ("prompt" in task) check(task.prompt, `${p}/task/prompt`, "Der Auftrag");
      list(task.options as { text?: unknown }[] | undefined).forEach((o, k) => check(o?.text, `${p}/task/options/${k}/text`, `Antwortmöglichkeit ${k + 1}`));
    }
    list(s.hints).forEach((h, k) => check(h?.text, `${p}/hints/${k}/text`, `Tipp ${k + 1}`));
    for (const [b, bp] of beats(s)) list(b.responses).forEach((r, k) => check(r?.label, `${p}/${bp}/responses/${k}/label`, `Antwortknopf ${k + 1}`));
  }
  list(g.story?.chapters).forEach((c, i) => check(c?.title, `/story/chapters/${i}/title`, "Der Kapiteltitel"));
  list(g.characters).forEach((c, i) => check(c?.name, `/characters/${i}/name`, "Der Name der Figur"));
  list(g.items).forEach((it, i) => check(it?.name, `/items/${i}/name`, "Der Name des Gegenstands"));
  list(g.field?.restrictedZones).forEach((z, i) => check(z?.name, `/field/restrictedZones/${i}/name`, "Der Name der Sperrzone"));
  return out;
};

const ANSWERS: Check = (g) => {
  const out: EditorIssue[] = [];
  for (const [s, i] of stations(g)) {
    const task = s.task as Task | undefined;
    if (!task) continue;
    const p = `/stations/${i}/task`;
    if ((task.type === "text" || task.type === "code") && Array.isArray(task.answers)) {
      task.answers.forEach((a, k) => {
        if (typeof a === "string" && !a.trim()) out.push(makeIssue(g, "empty_answer", `${p}/answers/${k}`, "error"));
      });
      if (task.type === "code" && task.input === "lock") {
        const answers = task.answers.filter((a): a is string => typeof a === "string");
        const digits = answers.every((a) => /^\d+$/.test(a));
        const sameLength = answers.every((a) => a.length === answers[0]!.length);
        if (answers.length && (!digits || !sameLength)) out.push(makeIssue(g, "lock_not_numeric", `${p}/answers`, "error"));
      }
      if (task.type === "text" && task.answers.some((a) => typeof a === "string" && a.trim().length > 0 && a.trim().length <= 3)) {
        out.push(makeIssue(g, "short_answer", `${p}/answers`, "hint"));
      }
    }
    if (task.type === "choice" && Array.isArray(task.options) && task.options.length && !task.options.some((o) => o?.correct === true)) {
      out.push(makeIssue(g, "choice_no_correct", `${p}/options`, "error"));
    }
  }
  return out;
};

const FRAGMENTS: Check = (g) => {
  const out: EditorIssue[] = [];
  const given = new Set(stations(g).flatMap(([s]) => list(s.rewards?.fragments)));
  list(g.fragments).forEach((f, k) => {
    if (f && typeof f === "object" && typeof f.id === "string" && !given.has(f.id)) {
      out.push(makeIssue(g, "fragment_unassigned", `/fragments/${k}`, "error", { n: typeof f.position === "number" ? f.position : k + 1 }));
    }
  });
  return out;
};

const FINALS: Check = (g) => {
  const out: EditorIssue[] = [];
  const finals = stations(g).filter(([s]) => s.final === true);
  const open = revealed(g);
  for (const [s, i] of finals) {
    const p = `/stations/${i}`;
    if (!s.task) out.push(makeIssue(g, "final_without_task", `${p}/task`, "error"));
    if (s.visibility === "hidden" && !s.revealRadius && !open.has(s.id)) out.push(makeIssue(g, "final_hidden_unreachable", `${p}/visibility`, "error"));
  }
  if (!finals.length && !list(g.fragments).length && stations(g).length) out.push(makeIssue(g, "no_final", "/stations", "hint"));
  for (const [s, i] of stations(g)) if (!s.task && s.final !== true) out.push(makeIssue(g, "station_no_task", `/stations/${i}/task`, "hint"));
  // Finale-Antwort gegen den Code aus den Teilen
  const parts = list(g.fragments).filter((f) => f && typeof f === "object");
  const final = finals[0];
  if (final && parts.length) {
    const [s, i] = final;
    const task = s.task as Task | undefined;
    if (task && (task.type === "code" || task.type === "text") && Array.isArray(task.answers)) {
      const code = [...parts].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((f) => f.value ?? "").join("");
      if (code && !task.answers.includes(code)) {
        out.push(
          makeIssue(g, "final_code_mismatch", `/stations/${i}/task/answers`, "warning", { code }, {
            fix: {
              label: "Antwort übernehmen",
              apply: (game) => {
                const t = game.stations?.[i]?.task;
                if (t && (t.type === "code" || t.type === "text")) t.answers = [code];
              },
              undoLabel: "Finalcode als Antwort übernommen",
            },
          }),
        );
      }
    }
  }
  return out;
};

const CODES: Check = (g) => {
  const out: EditorIssue[] = [];
  const seen = new Map<string, string>();
  for (const [s, i] of stations(g)) {
    list(s.triggers).forEach((t, j) => {
      if (!t || typeof t !== "object") return;
      const p = `/stations/${i}/triggers/${j}`;
      const code = t.type === "qr" || t.type === "manual" ? t.code : t.type === "nfc" ? t.tag : undefined;
      if (typeof code !== "string" || !code.trim()) return;
      const key = code.trim();
      const field = t.type === "nfc" ? "tag" : "code";
      if (seen.has(key)) out.push(makeIssue(g, "duplicate_code", `${p}/${field}`, "error", { code: key }, { paramKey: key }));
      else seen.set(key, p);
      if (t.type === "nfc" && !/^[0-9a-f]{8,}$/i.test(key.replace(/[:\-\s]/g, ""))) out.push(makeIssue(g, "nfc_not_uid", `${p}/tag`, "error"));
    });
  }
  return out;
};

const MEDIA_TYPES: Check = (g) => {
  const out: EditorIssue[] = [];
  const types = new Map(list(g.media).filter((m) => m && typeof m === "object").map((m) => [m.id, m.type]));
  const expect = (id: unknown, path: string, expected: "image" | "audio") => {
    if (typeof id !== "string") return;
    const type = types.get(id);
    if (type && type !== expected) out.push(makeIssue(g, "media_wrong_type", path, "error", { expected }));
  };
  for (const [s, i] of stations(g)) {
    const p = `/stations/${i}`;
    for (const [b, bp] of beats(s)) expect(b.image, `${p}/${bp}/image`, "image");
    list((s.task as Json | undefined)?.media as string[] | undefined).forEach((id, k) => expect(id, `${p}/task/media/${k}`, "image"));
  }
  list(g.characters).forEach((c, i) => expect(c?.portrait, `/characters/${i}/portrait`, "image"));
  list(g.items).forEach((it, i) => {
    expect(it?.image, `/items/${i}/image`, "image");
    expect(it?.icon, `/items/${i}/icon`, "image");
  });
  list(g.story?.intro?.media).forEach((id, k) => expect(id, `/story/intro/media/${k}`, "audio"));
  list(g.story?.outro?.media).forEach((id, k) => expect(id, `/story/outro/media/${k}`, "audio"));
  return out;
};

const SETTINGS: Check = (g) => {
  const out: EditorIssue[] = [];
  const size = g.settings?.teamSize;
  if (typeof size?.min === "number" && typeof size.max === "number" && size.min > size.max) {
    out.push(
      makeIssue(g, "team_size_order", "/settings/teamSize/min", "error", {}, {
        fix: {
          label: "Werte tauschen",
          apply: (game) => {
            const t = game.settings?.teamSize;
            if (t) [t.min, t.max] = [t.max, t.min];
          },
          undoLabel: "Teamgröße getauscht",
        },
      }),
    );
  }
  const time = g.settings?.time;
  if (time && time.limit !== "none" && time.duration === undefined) out.push(makeIssue(g, "time_limit_no_duration", "/settings/time/duration", "hint"));
  if (!list(g.meta?.ageGroups).length && g.safety?.requireSupervisor !== false) out.push(makeIssue(g, "no_age_group", "/meta/ageGroups", "hint"));
  if (list(g.meta?.ageGroups).some((a) => a === "6-9" || a === "10-13" || a === "14-17") && g.safety?.requireSupervisor === false) {
    out.push(makeIssue(g, "supervisor_off_minors", "/safety/requireSupervisor", "warning"));
  }
  if (list(g.meta?.languages).length > 1) out.push(makeIssue(g, "languages_extra", "/meta/languages", "hint"));
  return out;
};

const STATION_BASICS: Check = (g) => {
  const out: EditorIssue[] = [];
  const costs = g.settings?.hints?.defaultCost;
  for (const [s, i] of stations(g)) {
    const p = `/stations/${i}`;
    const triggers = list(s.triggers).filter((t) => t && typeof t === "object");
    if (triggers.length && triggers.every((t) => t.type === "gps")) out.push(makeIssue(g, "gps_only", `${p}/triggers`, "warning"));
    const located = !!s.location || triggers.some((t) => t.type === "gps" && !!t.location);
    if (!located && !triggers.some((t) => t.type === "gps")) out.push(makeIssue(g, "no_location", `${p}/location`, "hint"));
    if (Array.isArray(costs) && g.settings?.hints?.enabled !== false) {
      list(s.hints).forEach((h, k) => {
        if (k >= costs.length && !h?.cost) out.push(makeIssue(g, "hint_free", `${p}/hints/${k}`, "hint", { n: k + 1 }, { paramKey: String(k) }));
      });
    }
  }
  return out;
};

// Paket A
export const CHECKS: Check[] = [TEXT_FIELDS, ANSWERS, FRAGMENTS, FINALS, CODES, MEDIA_TYPES, SETTINGS, STATION_BASICS];

// Paket C: Stationseditor – Sichtbarkeit, Rätsel und Szene (Hinweise; short_answer steht schon in ANSWERS)
const STATION_FLOW: Check = (g) => {
  const out: EditorIssue[] = [];
  const all = stations(g);
  const visible = new Set(all.filter(([s]) => s.visibility !== "hidden").map(([s]) => s.id));
  const hintsOn = g.settings?.hints?.enabled !== false;
  for (const [s, i] of all) {
    const p = `/stations/${i}`;
    const triggers = list(s.triggers).filter((t) => t && typeof t === "object");
    const gps = triggers.find((t) => t.type === "gps");
    if (typeof s.revealRadius === "number" && (s.visibility !== "hidden" || !gps || !(s.location || (gps.type === "gps" && gps.location)))) {
      out.push(makeIssue(g, "reveal_radius_ineffective", `${p}/revealRadius`, "hint"));
    }
    list(s.rewards?.reveal).forEach((id, k) => {
      if (id !== s.id && !visible.has(id)) return;
      const target = all.find(([t]) => t.id === id)?.[0];
      out.push(makeIssue(g, "reveal_visible", `${p}/rewards/reveal/${k}`, "hint", { name: target ? readName(target, g) : id }, { paramKey: id }));
    });
    const task = s.task as Task | undefined;
    if (task?.type === "find_location" && triggers.length && triggers.every((t) => t.type === "gps")) out.push(makeIssue(g, "find_location_trigger", `${p}/triggers`, "hint"));
    if (task?.type === "photo") {
      if (task.review !== "auto_accept" && list(s.rewards?.fragments).length) out.push(makeIssue(g, "photo_fragment_manual", `${p}/rewards/fragments`, "hint"));
      if (task.review === "after_game" || task.review === "vote") out.push(makeIssue(g, "photo_review_unsupported", `${p}/task/review`, "hint"));
    }
    if (task && hintsOn && !list(s.hints).length) out.push(makeIssue(g, "no_hints", `${p}/hints`, "hint"));
    if (!s.story && !beats(s).length) out.push(makeIssue(g, "no_scene", `${p}/scene`, "hint"));
  }
  return out;
};

/** Name einer Station in der Spielsprache, sonst ihre Kennung. */
function readName(s: Station, g: Game): string {
  const lang = g.meta?.languages?.[0] ?? "de";
  const name = s.name as unknown;
  if (typeof name === "string") return name || s.id;
  if (name && typeof name === "object") return (name as Record<string, string>)[lang] || Object.values(name as Record<string, string>)[0] || s.id;
  return s.id;
}

CHECKS.push(STATION_FLOW);

// Paket B: Karte und Sicherheit – Lage der Stationen zu Spielfeld und Sperrzonen, GPS-Radien, Punkte, Nachtspiel
// (Import hier im Block, damit Anhänge der Pakete nicht im Kopf der Datei kollidieren)
import { distanceM, distanceToArea, gpsCircle, gpsTrigger, insideArea, isArea, isPoint, stationPoint } from "./geo.ts";
import { readText } from "./text.ts";

const MAP: Check = (g, meta, lang) => {
  const out: EditorIssue[] = [];
  const field = g.field;
  const zones = list(field?.restrictedZones).map((z, k): [typeof z, number] => [z, k]).filter(([z]) => z && typeof z === "object");
  const zoneName = (z: (typeof zones)[number][0]) => readText(z.name as never, lang) || z.id || "ohne Namen";
  /** Pfad des Orts einer Station: eigener Ort, sonst der Ort am GPS-Auslöser */
  const placePath = (s: Station, i: number) => (isPoint(s.location) ? `/stations/${i}/location` : `/stations/${i}/triggers/${list(s.triggers).findIndex((t) => t?.type === "gps")}/location`);

  for (const [z, k] of zones) {
    const polygon = (z.area as { polygon?: unknown } | undefined)?.polygon;
    if (Array.isArray(polygon) && polygon.length < 3) out.push(makeIssue(g, "zone_unfinished", `/field/restrictedZones/${k}/area/polygon`, "error"));
  }
  const boundary = isArea(field?.boundary) ? field!.boundary : null;
  for (const [s, i] of stations(g)) {
    const p = stationPoint(s);
    if (!p) continue;
    const at = placePath(s, i);
    let inZone = false;
    for (const [z] of zones) {
      if (!isArea(z.area)) continue;
      const d = distanceToArea(p, z.area);
      const warn = typeof z.warnDistance === "number" ? z.warnDistance : 15;
      if (d === 0) {
        inZone = true;
        out.push(makeIssue(g, "station_in_zone", at, "error", { zone: zoneName(z) }, { paramKey: z.id }));
      } else if (d < warn) out.push(makeIssue(g, "station_near_zone", at, "warning", { zone: zoneName(z), n: warn, distance: Math.round(d) }, { paramKey: z.id }));
    }
    if (boundary && !inZone && !insideArea(p, boundary)) {
      const center = "center" in boundary ? boundary.center : null;
      out.push(
        makeIssue(g, "station_outside_field", at, "warning", {}, {
          fix: center
            ? {
                label: "Spielfeld vergrößern",
                apply: (game) => {
                  const b = game.field?.boundary;
                  if (b && "center" in b) b.radius = Math.max(b.radius, Math.ceil((distanceM(center, p) + 20) / 10) * 10);
                },
                undoLabel: "Spielfeld vergrößert",
              }
            : undefined,
        }),
      );
    }
  }
  // GPS-Radien: zu klein und Überschneidungen (eine Meldung je Paar, an der späteren Station)
  const circles = stations(g)
    .map(([s, i]) => ({ s, i, c: gpsCircle(s), k: list(s.triggers).findIndex((t) => t?.type === "gps") }))
    .filter((x) => x.c);
  for (const [n, b] of circles.entries()) {
    const radius = gpsTrigger(b.s)?.radius;
    if (typeof radius === "number" && radius < 15) out.push(makeIssue(g, "gps_radius_small", `/stations/${b.i}/triggers/${b.k}/radius`, "warning"));
    for (const a of circles.slice(0, n)) {
      if (distanceM(a.c!.center, b.c!.center) < a.c!.radius + b.c!.radius) {
        out.push(makeIssue(g, "gps_overlap", `/stations/${b.i}/triggers/${b.k}`, "warning", { other: readText(a.s.name as never, lang) || a.s.id }, { paramKey: a.s.id }));
      }
    }
  }
  // Sammelpunkt
  const ap = field?.assemblyPoint;
  if (ap && typeof ap === "object") {
    if (isPoint(ap.location)) {
      for (const [z] of zones) if (isArea(z.area) && insideArea(ap.location, z.area)) out.push(makeIssue(g, "assembly_in_zone", "/field/assemblyPoint/location", "error", { zone: zoneName(z) }, { paramKey: z.id }));
    }
    if (!hasText(ap.name as never, lang)) out.push(makeIssue(g, "assembly_no_name", "/field/assemblyPoint/name", "hint"));
  }
  // Sicherheit (UX §12): Sperrzonen, Rettungspunkt, Ausrüstung bei Nacht
  const night = g.meta?.night === true;
  if (field && typeof field === "object" && !zones.length) {
    if (night) out.push(makeIssue(g, "night_no_zones", "/field/restrictedZones", "warning"));
    else if (!meta.noZones) {
      out.push(
        makeIssue(g, "no_zones", "/field/restrictedZones", "warning", {}, {
          fix: { label: "Gibt es nicht", apply: (_game, m) => void (m.noZones = true), undoLabel: "Keine Sperrzonen nötig" },
        }),
      );
    }
  }
  const offPath = stations(g).some(([s]) => s.offPath === true);
  if (field && typeof field === "object" && (night || offPath) && !list(field.rescuePoints).length) out.push(makeIssue(g, "no_rescue_point", "/field/rescuePoints", "warning"));
  if (night) {
    const gear = list(g.safety?.requiredGear).map((t) => readText(t as never, lang).toLowerCase());
    const missing = [["Lampe", /lampe|taschenlampe|stirnlampe|licht/], ["Warnweste", /weste/]].filter(([, re]) => !gear.some((x) => (re as RegExp).test(x))).map(([name]) => name as string);
    if (missing.length) {
      out.push(
        makeIssue(g, "night_no_gear", "/safety/requiredGear", "warning", { missing: missing.join(" und ") }, {
          fix: {
            label: `${missing.join(" und ")} ergänzen`,
            apply: (game) => {
              if (!game.safety || typeof game.safety !== "object") return;
              game.safety.requiredGear = [...list(game.safety.requiredGear), ...missing.map((m) => ({ [lang]: m }))];
            },
            undoLabel: `${missing.join(" und ")} zur Ausrüstung ergänzt`,
          },
        }),
      );
    }
  }
  // SMS-Rückfall: ausdrücklich dieselbe Nummer wie die Spielleitung – dann gibt es kein Gateway.
  const phone = g.safety?.emergency?.gameMasterPhone;
  const sms = g.safety?.sos?.smsFallback;
  const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");
  if (sms !== undefined && digits(sms) && digits(sms) === digits(phone)) out.push(makeIssue(g, "sms_fallback_missing", "/safety/sos/smsFallback", "hint"));
  return out;
};

CHECKS.push(MAP);

// Paket E: Vorlage (Station noch am Platz, Rätsel unverändert) und Größe der Medien
// (Importe mit eigenem Namen, damit sie nicht mit denen der anderen Blöcke kollidieren)
import { formatBytes as bytesText } from "../format.ts";
import { distanceM as metersBetween, stationPoint as placeOfStation } from "./geo.ts";

/** Grenze für die Summe der Medien eines Spiels; darüber dauert der Download vor dem Spiel zu lange. */
export const MEDIA_LIMIT = 50 * 1024 * 1024;

/** Größen der hochgeladenen Dateien nach src; die Prüfung kennt sie erst, wenn jemand sie geladen hat. */
const mediaSizes = new Map<string, number>();

/** Größen aus GET /games/:id/media übernehmen (Veröffentlichen); danach store.validateNow(). */
export function setMediaSizes(files: { src: string; size: number }[]): void {
  mediaSizes.clear();
  for (const f of files) mediaSizes.set(f.src, f.size);
}

const TEMPLATE: Check = (g, meta) => {
  const out: EditorIssue[] = [];
  const t = meta.template;
  if (t && typeof t === "object") {
    for (const [s, i] of stations(g)) {
      const origin = t.stations?.[s.id];
      const p = placeOfStation(s);
      if (origin && p && !meta.onSite?.[s.id] && metersBetween(origin, p) < 2) {
        const gps = list(s.triggers).findIndex((tr) => tr?.type === "gps");
        const at = s.location || gps < 0 ? `/stations/${i}/location` : `/stations/${i}/triggers/${gps}/location`;
        out.push(makeIssue(g, "station_at_template", at, "warning"));
      }
      const task = t.tasks?.[s.id];
      if (task && s.task && JSON.stringify(s.task) === task) out.push(makeIssue(g, "template_task_generic", `/stations/${i}/task`, "warning"));
    }
  }
  let total = 0;
  for (const m of list(g.media)) if (m && typeof m.src === "string") total += mediaSizes.get(m.src) ?? 0;
  if (total > MEDIA_LIMIT) out.push(makeIssue(g, "media_too_large", "/media", "warning", { size: bytesText(total) }));
  return out;
};

CHECKS.push(TEMPLATE);

// Paket D: Regeln (unfertige Bausteine, Fallstricke der Engine), Geschichte, Spielwelt und Punkte
// (Importe mit eigenem Namen, damit sie nicht mit denen der anderen Blöcke kollidieren)
import { incompleteParts as unfinishedParts } from "./rules.ts";
import { readText as textIn } from "./text.ts";

type RuleAction = NonNullable<Game["rules"]>[number]["then"][number];

/** Alle Dann- und Sonst-Aktionen aller Regeln. */
const ruleActions = (g: Game): RuleAction[] => list(g.rules).flatMap((r) => [...list(r?.then), ...list(r?.else)]).filter((a) => a && typeof a === "object");

const RULE_CHECKS: Check = (g, _meta, lang) => {
  const out: EditorIssue[] = [];
  const all = stations(g);
  const visible = new Map(all.filter(([s]) => s.visibility !== "hidden").map(([s]) => [s.id, textIn(s.name as never, lang) || s.id]));
  // Ins Inventar kommt nur, was eine Belohnung oder Regel vergibt; Schriftstücke aus Szenen zählen nicht.
  const owned = new Set<unknown>([...all.flatMap(([s]) => list(s.rewards?.items)), ...ruleActions(g).map((a) => ("give_item" in a ? a.give_item : undefined))]);
  const inScenes = new Set<unknown>(all.flatMap(([s]) => beats(s).map(([b]) => b.item)));
  const fragments = list(g.fragments).length;
  list(g.rules).forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const p = `/rules/${i}`;
    for (const part of unfinishedParts(r, lang)) out.push(makeIssue(g, "incomplete_rule", `${p}/${part.path}`, "error", { missing: part.missing }));
    list(r.when).forEach((c, j) => {
      if (!c || typeof c !== "object") return;
      const at = `${p}/when/${j}`;
      if ("has_item" in c && c.has_item && !owned.has(c.has_item) && inScenes.has(c.has_item)) out.push(makeIssue(g, "rule_has_item_document", `${at}/has_item`, "warning"));
      if ("fragments_collected" in c && typeof c.fragments_collected === "number" && c.fragments_collected > fragments) {
        out.push(makeIssue(g, "rule_fragments_too_many", `${at}/fragments_collected`, "warning"));
      }
      if ("elapsed" in c || "near" in c) out.push(makeIssue(g, "rule_elapsed_near", at, "hint"));
    });
    for (const key of ["then", "else"] as const) {
      list(r[key]).forEach((a, j) => {
        if (!a || typeof a !== "object") return;
        const at = `${p}/${key}/${j}`;
        if ("reveal_station" in a && visible.has(a.reveal_station)) {
          out.push(makeIssue(g, "rule_reveal_visible", `${at}/reveal_station`, "hint", { name: visible.get(a.reveal_station) }, { paramKey: a.reveal_station }));
        }
        if ("message" in a && (a.message?.from === "narrator" || a.message?.from === "npc")) {
          out.push(
            makeIssue(g, "rule_message_from", `${at}/message/from`, "hint", {}, {
              fix: {
                label: "Zentrale als Absender",
                apply: (game) => {
                  const m = game.rules?.[i]?.[key]?.[j];
                  if (m && "message" in m) m.message.from = "hq";
                },
                undoLabel: "Funkspruch kommt von der Zentrale",
              },
            }),
          );
        }
      });
    }
    if (list(r.else).length && r.once !== false) out.push(makeIssue(g, "rule_else_once", `${p}/else`, "hint"));
    if (r.once === false) {
      out.push(
        makeIssue(g, "rule_repeat", `${p}/once`, "warning", {}, {
          fix: {
            label: "Einmal je Team",
            apply: (game) => void delete game.rules?.[i]?.once,
            undoLabel: "Regel gilt einmal je Team",
          },
        }),
      );
    }
  });
  return out;
};

const STORY_CHECKS: Check = (g, _meta, lang) => {
  const out: EditorIssue[] = [];
  const all = stations(g);
  const actions = ruleActions(g);
  const started = new Set<unknown>([...all.map(([s]) => s.rewards?.chapter), ...actions.map((a) => ("start_chapter" in a ? a.start_chapter : undefined))]);
  // Kapitel I beginnt mit dem Spielstart.
  list(g.story?.chapters).forEach((c, k) => {
    if (k > 0 && c && typeof c.id === "string" && !started.has(c.id)) out.push(makeIssue(g, "chapter_never_starts", `/story/chapters/${k}`, "warning"));
  });
  const given = new Set<unknown>([...all.flatMap(([s]) => list(s.rewards?.items)), ...actions.map((a) => ("give_item" in a ? a.give_item : undefined)), ...all.flatMap(([s]) => beats(s).map(([b]) => b.item))]);
  list(g.items).forEach((it, k) => {
    if (it && typeof it.id === "string" && !given.has(it.id)) out.push(makeIssue(g, "item_never_given", `/items/${k}`, "warning"));
  });
  // Die Zentrale spricht immer (Funk, Tipps, Einsatzbefehl), der Erzähler über jedem Erzähltakt.
  const speakers = new Set<unknown>(all.flatMap(([s]) => beats(s).map(([b]) => b.speaker)));
  const narration = all.some(([s]) => beats(s).some(([b]) => b.kind === "narration"));
  list(g.characters).forEach((c, k) => {
    if (!c || typeof c.id !== "string" || c.kind === "hq" || speakers.has(c.id) || (c.kind === "narrator" && narration)) return;
    out.push(makeIssue(g, "character_silent", `/characters/${k}`, "hint"));
  });
  const scare = g.meta?.scareLevel;
  if (typeof scare === "number" && scare >= 2 && list(g.meta?.ageGroups).includes("6-9")) out.push(makeIssue(g, "scare_too_high", "/meta/scareLevel", "warning"));
  if (g.meta?.night === true && g.settings?.scoring?.speedBonus === true) {
    out.push(
      makeIssue(g, "night_speed_bonus", "/settings/scoring/speedBonus", "warning", {}, {
        fix: {
          label: "Schnelligkeitspunkte aus",
          apply: (game) => {
            const s = game.settings?.scoring;
            if (!s) return;
            delete s.speedBonus;
            if (!Object.keys(s).length) delete game.settings.scoring;
          },
          undoLabel: "Schnelligkeitspunkte ausgeschaltet",
        },
      }),
    );
  }
  if (!textIn(g.story?.intro?.text as never, lang).trim()) out.push(makeIssue(g, "no_intro", "/story/intro/text", "hint"));
  return out;
};

CHECKS.push(RULE_CHECKS, STORY_CHECKS);
