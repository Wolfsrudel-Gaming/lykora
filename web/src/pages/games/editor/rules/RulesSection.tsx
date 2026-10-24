/**
 * Paket D: Bereich „Regeln“ (UX §11) – Regeln als Sätze aus Bausteinen, „+ Neue Regel ▾“ mit Rezepten,
 * darunter „Außerdem passiert“ aus den Stationsbelohnungen. Neue und fehlerhafte Regeln stehen offen.
 */

import { useState } from "preact/hooks";
import { newRule, RECIPES, type Recipe } from "../../../../lib/editor/rules.ts";
import { editor, useEditorSelect } from "../../../../lib/editor/store.ts";
import { useLocation } from "../../../../lib/router.ts";
import { Icon } from "../../../../ui/icons.tsx";
import type { SectionProps } from "../sections.ts";
import { Menu } from "../station/common.tsx";
import { store } from "../story/shared.tsx";
import { AlsoHappens } from "./AlsoHappens.tsx";
import { RuleCard } from "./RuleCard.tsx";
import "./rules.css";

export function RulesSection({ gameId }: SectionProps) {
  const rules = useEditorSelect((s) => s.game.rules ?? []);
  const target = useLocation().query.get("objekt");
  // Offen stehen beim Öffnen fehlerhafte Regeln und das Sprungziel, danach jede neue; nichts klappt von selbst zu.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
    const s = editor.get().current?.get();
    return new Set([...(s?.issues ?? []).filter((i) => i.severity === "error" && i.at.section === "regeln").map((i) => i.at.objectId ?? ""), target ?? ""]);
  });

  const add = (recipe: Recipe) => {
    let id = "";
    store().update(`Neue Regel: ${recipe.label}`, (g) => {
      const rule = newRule(g, g.meta?.languages?.[0] ?? "de", recipe);
      id = rule.id;
      g.rules = [...(g.rules ?? []), rule];
    });
    setOpened((o) => new Set([...o, id]));
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-objekt="${id}"]`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      el?.querySelector<HTMLElement>(".d-block select:not(.d-kind)")?.focus({ preventScroll: true });
    });
  };

  return (
    <section class="d-section stack loose" aria-labelledby="bereich-regeln">
      <header class="stack tight">
        <div class="row between">
          <h2 id="bereich-regeln" tabIndex={-1}>
            Regeln
          </h2>
          <Menu
            label="Neue Regel"
            text={
              <>
                <Icon name="plus" /> Neue Regel ▾
              </>
            }
          >
            {(close) =>
              RECIPES.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      add(r);
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))
            }
          </Menu>
        </div>
        <p class="muted">Regeln lassen im Spiel etwas passieren: Stationen erscheinen, die Zentrale funkt, Teams bekommen Punkte oder Gegenstände. Jede Regel gilt für jedes Team einzeln.</p>
      </header>
      {rules.length === 0 ? (
        <p class="muted">Noch keine Regeln. Für „Station A gelöst, dann erscheint Station B“ reicht oft „Danach erscheint“ in der Belohnung der Station.</p>
      ) : (
        rules.map((r, i) =>
          r && typeof r === "object" ? (
            <RuleCard key={r.id || i} rule={r} index={i} count={rules.length} open={opened.has(r.id) || r.id === target} />
          ) : null,
        )
      )}
      <AlsoHappens gameId={gameId} />
    </section>
  );
}
