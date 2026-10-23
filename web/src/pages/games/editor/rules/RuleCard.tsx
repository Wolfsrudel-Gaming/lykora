/**
 * Paket D: Eine Regel als Karte (W7). Oben steht der fertige Satz – er ist der Name der Regel; darunter
 * die festen Zeilen SOBALD (erste Bedingung), UND (weitere), DANN und SONST mit Bausteinen. „Sonst“
 * gibt es erst mit einer UND-Bedingung, weil es nur läuft, wenn die erste stimmt und eine weitere nicht.
 */

import { actionClause, keepPlaceNames, newAction, newCondition, ruleSentence, type Rule } from "../../../../lib/editor/rules.ts";
import { shallowArray, useEditorSelect } from "../../../../lib/editor/store.ts";
import { issuesAt } from "../../../../lib/editor/validation.ts";
import { notify } from "../../../../lib/session.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { excerpt, useListKeys } from "../station/common.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { moveItem, SortableList } from "../ui/SortableList.tsx";
import { store, useLiveIssues } from "../story/shared.tsx";
import { ActionBlock, type ActionList } from "./ActionBlock.tsx";
import { ConditionBlock } from "./ConditionBlock.tsx";
import { editRule } from "./edit.ts";

const MARK = { error: { mark: "✗", text: "mit Fehler" }, warning: { mark: "!", text: "mit Warnung" }, ok: { mark: "✓", text: "in Ordnung" } };

export function RuleCard({ rule, index, count, open }: { rule: Rule; index: number; count: number; open: boolean }) {
  const p = `/rules/${index}`;
  const sentence = useEditorSelect((s) => ruleSentence(rule, s.game, s.lang, { meta: s.meta, index }));
  const state = useEditorSelect((s) => {
    const hidden = new Set(s.meta.dismissed ?? []);
    const all = issuesAt(s.issues, p).filter((i) => !hidden.has(i.id));
    return all.some((i) => i.severity === "error") ? "error" : all.length ? "warning" : "ok";
  });
  const ruleIssues = useLiveIssues([p, `${p}/else`, `${p}/once`]);
  const name = excerpt(sentence, 50);
  const m = MARK[state];
  const when = rule.when ?? [];

  const remove = () => {
    store().update(`Regel „${name}“ gelöscht`, (g, meta) =>
      keepPlaceNames(g, meta, () => {
        g.rules?.splice(index, 1);
        if (!g.rules?.length) delete g.rules;
      }),
    );
    notify("Regel gelöscht. Strg+Z holt sie zurück.", "ok");
  };
  const move = (to: number) =>
    store().update(`Regel „${name}“ verschoben`, (g, meta) =>
      keepPlaceNames(g, meta, () => {
        if (g.rules) g.rules = moveItem(g.rules, index, to);
      }),
    );

  return (
    <details class={`collapsible d-rule ${state}`} open={open} data-objekt={rule.id}>
      <summary>
        <span class="d-rule-sentence">{sentence}</span>
        <span class={`mark ${state}`} aria-label={m.text}>
          {m.mark}
        </span>
      </summary>
      <div class="collapsible-body stack">
        <div class="d-line">
          <span class="d-line-label">Sobald</span>
          <div class="d-line-body stack tight">{when[0] ? <ConditionBlock index={index} j={0} condition={when[0]} count={when.length} /> : <AddCondition index={index} />}</div>
        </div>
        <div class="d-line">
          <span class="d-line-label">Und</span>
          <div class="d-line-body stack tight">
            {when.slice(1).map((c, k) => (
              <ConditionBlock key={k + 1} index={index} j={k + 1} condition={c} count={when.length} />
            ))}
            {when.length > 0 && <AddCondition index={index} />}
          </div>
        </div>
        <Actions index={index} list="then" actions={rule.then ?? []} />
        <Actions index={index} list="else" actions={rule.else ?? []} canAdd={when.length > 1} />
        <p class="small muted">
          {rule.once === false ? "Gilt bei jeder Auswertung erneut." : "Gilt einmal je Team."}
          {rule.else?.length ? " Läuft „Sonst“, ist die Regel für dieses Team erledigt – „Dann“ kommt danach nicht mehr." : ""}
        </p>
        <IssueList issues={ruleIssues} />
        <div class="row between">
          <span class="row">
            <button type="button" class="btn small ghost" disabled={index === 0} onClick={() => move(index - 1)}>
              ↑ Nach oben
            </button>
            <button type="button" class="btn small ghost" disabled={index === count - 1} onClick={() => move(index + 1)}>
              ↓ Nach unten
            </button>
          </span>
          <button type="button" class="btn small ghost" onClick={remove}>
            <Icon name="trash" /> Regel löschen
          </button>
        </div>
      </div>
    </details>
  );
}

function AddCondition({ index }: { index: number }) {
  return (
    <button
      type="button"
      class="btn small d-add"
      onClick={() => editRule(index, "Bedingung ergänzt", (r) => void (r.when = [...(r.when ?? []), newCondition("station_solved")]))}
    >
      <Icon name="plus" /> Bedingung
    </button>
  );
}

const LINE_LABELS: Record<ActionList, string> = { then: "Dann", else: "Sonst" };

function Actions({ index, list, actions, canAdd = true }: { index: number; list: ActionList; actions: Rule["then"]; canAdd?: boolean }) {
  const [keys, moveKeys] = useListKeys(actions);
  const lang = useEditorSelect((s) => s.lang);
  const add = () => editRule(index, `${LINE_LABELS[list]}-Aktion ergänzt`, (r) => void (r[list] = [...(r[list] ?? []), newAction("message", lang)]));
  const items = actions.map((a, i) => ({ a, key: keys[i]! }));
  const names = useEditorSelect((s) => actions.map((a) => excerpt(actionClause(a, s.game, s.lang, true), 40)), shallowArray);
  return (
    <div class="d-line">
      <span class="d-line-label">{LINE_LABELS[list]}</span>
      <div class="d-line-body stack tight">
        {items.length > 0 && (
          <SortableList
            items={items}
            keyOf={(x) => x.key}
            nameOf={(x) => names[items.indexOf(x)] ?? "Aktion"}
            label={`${LINE_LABELS[list]}-Aktionen`}
            class="d-actions"
            onMove={(from, to) => {
              moveKeys(from, to);
              editRule(index, `${LINE_LABELS[list]}-Aktion verschoben`, (r) => void (r[list] = moveItem(r[list] ?? [], from, to)));
            }}
            render={(x, i) => <ActionBlock index={index} list={list} j={i} action={x.a} removable={list === "else" || actions.length > 1} />}
          />
        )}
        {canAdd || items.length ? (
          <span class="row">
            <button type="button" class="btn small d-add" onClick={add}>
              <Icon name="plus" /> Aktion
            </button>
            {list === "else" && <small class="muted">läuft, wenn „Sobald“ zutrifft, aber eine Und-Bedingung nicht</small>}
          </span>
        ) : (
          <small class="muted">„Sonst“ gibt es, sobald eine Und-Bedingung dabei ist.</small>
        )}
      </div>
    </div>
  );
}
