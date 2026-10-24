/**
 * Breakpoints: eine Quelle für Skripte. In CSS stehen dieselben Zahlen (@media kann keine Variablen);
 * test/breakpoints.test.ts prüft, dass jedes @media in den Stilen auf diese Stufen fällt.
 *   sm 640 (Handy → Tablet), md 960 (Tablet → Laptop), lg 1280 (Laptop → Desktop), xl 1600
 * „Ab“ heißt min-width, „unter“ heißt max-width mit einem Pixel weniger.
 */

export const BREAKPOINTS = { sm: 640, md: 960, lg: 1280, xl: 1600 } as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** Media-Query für „ab dieser Breite“, z. B. up("md") → (min-width: 960px). */
export function up(bp: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[bp]}px)`;
}

/** Media-Query für „unter dieser Breite“, z. B. down("md") → (max-width: 959px). */
export function down(bp: Breakpoint): string {
  return `(max-width: ${BREAKPOINTS[bp] - 1}px)`;
}

/** Größte Stufe, die zur Breite passt; unter sm ist es "xs". */
export function breakpointOf(width: number): Breakpoint | "xs" {
  let found: Breakpoint | "xs" = "xs";
  for (const [name, px] of Object.entries(BREAKPOINTS) as [Breakpoint, number][]) if (width >= px) found = name;
  return found;
}
