/**
 * Paket E: Checkliste vor dem Veröffentlichen (UX §16.7, W8) – „Muss erledigt sein“ (Fehler),
 * „Solltest du prüfen“ (Warnungen, mit „Passt so“) und „Ideen“ (Tipps, eingeklappt). Jede Zeile
 * nennt die Stelle in Worten, hat „Beheben ›“ und, wo es eine gibt, die Sofort-Lösung.
 * Meldungen des Servers (beim Veröffentlichen gefunden) kommen mit dazu.
 */

import { jumpTo } from "../../../../lib/editor/jump.ts";
import { href, navigate } from "../../../../lib/router.ts";
import { editor } from "../../../../lib/editor/store.ts";
import type { EditorIssue, Game } from "../../../../lib/editor/types.ts";
import { addressOf, describeObject } from "../../../../lib/editor/validation.ts";
import { describeError } from "../../../../lib/validation.ts";
import { SECTION_TITLES } from "../sections.ts";
import { applyFix, SEVERITY_MARK } from "../ui/IssueList.tsx";

export interface ChecklistGroups {
  must: EditorIssue[];
  should: EditorIssue[];
  ideas: EditorIssue[];
  hidden: number;
}

/** Meldungen nach Stufe; ausgeblendete Warnungen zählen nirgends, nur ihre Zahl. */
export function checklistGroups(issues: EditorIssue[], dismissed: string[] = []): ChecklistGroups {
  const off = new Set(dismissed);
  const shown = issues.filter((i) => !off.has(i.id));
  return {
    must: shown.filter((i) => i.severity === "error"),
    should: shown.filter((i) => i.severity === "warning"),
    ideas: shown.filter((i) => i.severity === "hint"),
    hidden: issues.length - shown.length,
  };
}

/** Fehlerliste des Servers (invalid_game) als Meldungen; Pfade werden zur Stelle im Baukasten. */
export function serverIssues(errors: string[], game: Game): EditorIssue[] {
  return errors.map((raw, k) => {
    const readable = describeError(raw, game);
    const path = raw.startsWith("/") ? raw.slice(0, raw.indexOf(" ") < 0 ? raw.length : raw.indexOf(" ")) : "";
    return {
      id: `server:${k}:${raw}`,
      severity: "error",
      code: "server",
      message: readable.message ? `${readable.where}: ${readable.message}` : readable.where,
      at: path ? addressOf(path, game) : { section: "veroeffentlichen", path: "" },
      source: "server",
      dismissable: false,
    };
  });
}

/** Wo die Meldung hingehört, in Worten: „Station „Lichtung““ oder der Bereich; leer, wenn der Satz das Objekt schon nennt. */
export function whereOf(issue: EditorIssue, game: Game): string {
  const obj = describeObject(issue.at, game);
  if (obj && issue.message.includes(`„${obj.name}“`)) return "";
  return obj ? `${obj.label} „${obj.name}“` : SECTION_TITLES[issue.at.section];
}

/** Codes, die bei mehreren Stationen zu einer Zeile werden („6 Stationen stehen noch …“). */
const GROUPED: Record<string, (names: string[]) => string> = {
  station_at_template: (names) => names.length === 1
      ? `Die Station ${names.map((n) => `„${n}“`).join("")} steht noch dort, wo die Vorlage sie hingesetzt hat. Zieht sie auf der Karte an euren Ort.`
      : `${names.length} Stationen stehen noch dort, wo die Vorlage sie hingesetzt hat: ${names.map((n) => `„${n}“`).join(", ")}. Zieht sie auf der Karte an eure Orte.`,
};

interface Row {
  issue: EditorIssue;
  /** zusammengefasste Meldungen derselben Art */
  group?: EditorIssue[];
}

function rowsOf(issues: EditorIssue[], game: Game): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const i of issues) {
    const text = GROUPED[i.code];
    const same = text ? issues.filter((x) => x.code === i.code) : [];
    if (!text || same.length < 2) rows.push({ issue: i });
    else if (!seen.has(i.code)) {
      seen.add(i.code);
      const names = same.map((x) => describeObject(x.at, game)?.name ?? "");
      rows.push({ issue: { ...i, id: `gruppe:${i.code}`, message: text(names), at: { section: "karte", path: "" }, fix: undefined }, group: same });
    }
  }
  return rows;
}

export function Checklist({ issues, game, label }: { issues: EditorIssue[]; game: Game; label: string }) {
  if (!issues.length) return null;
  const store = editor.get().current;
  return (
    <ul class="issues pub-list" aria-label={label}>
      {rowsOf(issues, game).map(({ issue: i, group }) => {
        const m = SEVERITY_MARK[i.severity];
        const canJump = i.at.section !== "veroeffentlichen";
        const where = group ? "" : whereOf(i, game);
        return (
          <li key={i.id} class={`issue ${i.severity}`}>
            <span class="issue-mark" aria-hidden="true">
              {m.mark}
            </span>
            <span class="issue-text">
              <span class="sr-only">{m.text}: </span>
              {where && (
                <>
                  <strong>{where}</strong> ·{" "}
                </>
              )}
              {i.message}
              {i.source === "server" && <span class="muted"> (vom Server gemeldet)</span>}
            </span>
            <span class="issue-actions">
              {i.fix && (
                <button type="button" class="btn small" onClick={() => applyFix(i)}>
                  {i.fix.label}
                </button>
              )}
              {canJump && (
                <button type="button" class="btn small ghost" onClick={() => (group ? navigate(href("editorSection", { gameId: store?.get().gameId ?? "", section: "karte" })) : jumpTo(i.at))}>
                  {group ? "Zur Karte ›" : "Beheben ›"}
                </button>
              )}
              {i.dismissable && (
                <button type="button" class="btn small ghost" onClick={() => (group ? group.forEach((x) => store?.dismissIssue(x.id)) : store?.dismissIssue(i.id))}>
                  Passt so
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
