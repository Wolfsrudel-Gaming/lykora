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
