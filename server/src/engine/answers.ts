import type { Task } from "@lykora/spec";
import { distance } from "../lib/geo.ts";

export type Verdict = "correct" | "wrong" | "pending";

export interface AnswerInput {
  /** Antwort für text und code */
  text?: string;
  /** Gewählte Optionen für choice (Indizes) */
  choice?: number[];
  /** Upload-ID für photo */
  upload?: string;
  /** Gescannte Armbänder (Hashes) für wristband */
  tags?: string[];
  /** Position für find_location */
  location?: { lat: number; lon: number; accuracy?: number };
}

export function normalize(value: string, ignoreCase: boolean, ignoreWhitespace: boolean): string {
  let v = value.normalize("NFC").trim();
  if (ignoreCase) v = v.toLocaleLowerCase("de");
  if (ignoreWhitespace) v = v.replace(/\s+/g, "");
  else v = v.replace(/\s+/g, " ");
  return v;
}

/** Levenshtein-Abstand, bricht ab, sobald max überschritten ist. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Erlaubte Tippfehler hängen von der Länge ab, damit kurze Antworten nicht beliebig werden. */
function allowedTypos(answer: string, maxTypos: number): number {
  if (answer.length <= 3) return 0;
  if (answer.length <= 6) return Math.min(maxTypos, 1);
  return maxTypos;
}

export function checkAnswer(task: Task, input: AnswerInput, memberTags: string[] = []): Verdict {
  switch (task.type) {
    case "text": {
      if (typeof input.text !== "string") return "wrong";
      if (task.manualReview) return "pending";
      const m = task.match ?? {};
      const ignoreCase = m.ignoreCase ?? true;
      const ignoreWhitespace = m.ignoreWhitespace ?? true;
      const given = normalize(input.text, ignoreCase, ignoreWhitespace);
      const ok = task.answers.some((a) => {
        const want = normalize(a, ignoreCase, ignoreWhitespace);
        return editDistance(given, want, allowedTypos(want, m.maxTypos ?? 1)) <= allowedTypos(want, m.maxTypos ?? 1);
      });
      return ok ? "correct" : "wrong";
    }
    case "code": {
      if (typeof input.text !== "string") return "wrong";
      const given = input.text.trim();
      return task.answers.some((a) => a.trim() === given) ? "correct" : "wrong";
    }
    case "choice": {
      if (!Array.isArray(input.choice)) return "wrong";
      const want = task.options.flatMap((o, i) => (o.correct ? [i] : []));
      const given = [...new Set(input.choice)].sort((a, b) => a - b);
      return given.length === want.length && given.every((v, i) => v === want[i]) ? "correct" : "wrong";
    }
    case "photo": {
      if (typeof input.upload !== "string") return "wrong";
      return (task.review ?? "live") === "auto_accept" ? "correct" : "pending";
    }
    case "find_location": {
      if (!input.location) return "wrong";
      const tolerance = task.radius ?? 20;
      const slack = Math.min(input.location.accuracy ?? 0, tolerance);
      return distance(input.location, task.location) <= tolerance + slack ? "correct" : "wrong";
    }
    case "wristband": {
      if (!Array.isArray(input.tags)) return "wrong";
      const scanned = new Set(input.tags.filter((t) => memberTags.includes(t)));
      const needed = task.count === undefined || task.count === "all" ? memberTags.length : task.count;
      return needed > 0 && scanned.size >= needed ? "correct" : "wrong";
    }
  }
}
