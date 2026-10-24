/**
 * Stabile Schlüssel für Listen ohne Kennung (Takte, Tipps, Aktionen). Ändert sich die Liste, werden
 * die Schlüssel am Inhalt festgemacht: ein gelöschter oder eingefügter Eintrag nimmt nur seinen
 * eigenen Schlüssel mit. Lässt sich die Änderung so nicht erklären (Rückgängig mit Umordnung,
 * Austausch), bekommen alle Einträge neue Schlüssel – lieber Fokus verlieren als Zustand am falschen Eintrag.
 */

let seq = 0;
export const newListKey = (): string => `k${++seq}`;

/** Abdruck eines Eintrags; gleiche Inhalte haben gleiche Abdrücke. */
export function printOf(item: unknown): string {
  try {
    return JSON.stringify(item) ?? "";
  } catch {
    return String(item);
  }
}

/** Ist `short` eine Teilfolge von `long`? Liefert die Positionen von `long`, die in `short` fehlen, sonst null. */
function missingIn(long: readonly string[], short: readonly string[]): number[] | null {
  const missing: number[] = [];
  let j = 0;
  for (let i = 0; i < long.length; i++) {
    if (j < short.length && long[i] === short[j]) j++;
    else missing.push(i);
  }
  return j === short.length ? missing : null;
}

export interface ListKeys {
  keys: string[];
  prints: string[];
}

/** Schlüssel für die neue Liste; `prev` ist der Stand vom letzten Zeichnen. */
export function reconcileKeys(prev: ListKeys, next: readonly string[], make: () => string = newListKey): ListKeys {
  const { keys, prints } = prev;
  if (next.length === keys.length) return { keys, prints: [...next] };
  if (next.length < keys.length) {
    const gone = missingIn(prints, next);
    if (gone) return { keys: keys.filter((_, i) => !gone.includes(i)), prints: [...next] };
  } else {
    const added = missingIn(next, prints);
    if (added) {
      const out: string[] = [];
      let old = 0;
      for (let i = 0; i < next.length; i++) out.push(added.includes(i) ? make() : keys[old++]!);
      return { keys: out, prints: [...next] };
    }
  }
  return { keys: next.map(() => make()), prints: [...next] };
}

/** Eintrag von `from` nach `to` verschieben; Schlüssel und Abdrücke wandern mit. */
export function moveKeys(prev: ListKeys, from: number, to: number): ListKeys {
  const keys = [...prev.keys];
  const prints = [...prev.prints];
  const [k] = keys.splice(from, 1);
  const [p] = prints.splice(from, 1);
  keys.splice(to, 0, k!);
  prints.splice(to, 0, p!);
  return { keys, prints };
}
