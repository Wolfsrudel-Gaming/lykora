/**
 * Paket D: Änderungen an einer Regel als ein Schritt im Verlauf; Namen der Regelorte
 * (meta.placeNames) wandern beim Umbau mit ihrer Bedingung.
 */

import { keepPlaceNames, type Rule } from "../../../../lib/editor/rules.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { store } from "../story/shared.tsx";

export function editRule(index: number, label: string, change: (rule: Rule, game: Game) => void): void {
  store().update(label, (g, meta) =>
    keepPlaceNames(g, meta, () => {
      const rule = g.rules?.[index];
      if (rule) change(rule, g);
    }),
  );
}
