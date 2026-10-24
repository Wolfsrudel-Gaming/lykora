/** Liest die Design-Tokens aus styles/tokens.css und rechnet Kontraste (WCAG 2.x) für die Tests. */

import { readFileSync } from "node:fs";

export const STYLES = new URL("../../src/styles/", import.meta.url);

export interface Rule {
  selector: string;
  /** Bedingungen der umgebenden @media-Blöcke */
  media: string[];
  decls: Map<string, string>;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Sehr kleiner CSS-Leser: Regeln mit Selektor, Medienbedingung und Deklarationen (verschachtelt nur @media). */
export function parseRules(css: string): Rule[] {
  const src = stripComments(css);
  const out: Rule[] = [];
  const walk = (text: string, media: string[]) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      let inUrl = false;
      for (; j < text.length && depth > 0; j++) {
        const c = text[j];
        if (c === "(" && text.slice(j - 3, j) === "url") inUrl = true;
        else if (c === ")" && inUrl) inUrl = false;
        if (inUrl) continue;
        if (c === "{") depth++;
        else if (c === "}") depth--;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(body, [...media, head.slice(6).trim()]);
      else if (head.startsWith("@")) {
        // @font-face, @keyframes usw. werden übergangen
      } else {
        const decls = new Map<string, string>();
        // Deklarationen trennen, ohne an ; in url("data:…") zu zerbrechen
        let cur = "";
        let paren = 0;
        let quote = "";
        for (const c of body) {
          if (quote) {
            if (c === quote) quote = "";
          } else if (c === '"' || c === "'") quote = c;
          else if (c === "(") paren++;
          else if (c === ")") paren--;
          if (c === ";" && paren === 0 && !quote) {
            push(cur, decls);
            cur = "";
          } else cur += c;
        }
        push(cur, decls);
        out.push({ selector: head.replace(/\s+/g, " "), media, decls });
      }
      i = j;
    }
  };
  const push = (decl: string, into: Map<string, string>) => {
    const k = decl.indexOf(":");
    if (k < 0) return;
    const name = decl.slice(0, k).trim();
    const value = decl.slice(k + 1).trim();
    if (name) into.set(name, value);
  };
  walk(src, []);
  return out;
}

export function readCss(rel: string): string {
  return readFileSync(new URL(rel, STYLES), "utf8");
}

export type ThemeName = "night" | "day" | "systemLight";

export interface Themes {
  /** Themenunabhängige Tokens aus :root */
  base: Map<string, string>;
  night: Map<string, string>;
  day: Map<string, string>;
  systemLight: Map<string, string>;
}

export function readThemes(): Themes {
  const rules = parseRules(readCss("tokens.css"));
  const base = new Map<string, string>();
  const night = new Map<string, string>();
  const day = new Map<string, string>();
  const systemLight = new Map<string, string>();
  for (const r of rules) {
    const plain = r.media.length === 0;
    if (plain && r.selector === ":root") for (const [k, v] of r.decls) base.set(k, v);
    else if (plain && r.selector === ":root, :root[data-theme=\"night\"]") for (const [k, v] of r.decls) night.set(k, v);
    else if (plain && r.selector === ':root[data-theme="day"]') for (const [k, v] of r.decls) day.set(k, v);
    else if (r.media.length === 1 && r.media[0] === "(prefers-color-scheme: light)" && r.selector === ':root[data-theme="system"]') for (const [k, v] of r.decls) systemLight.set(k, v);
  }
  return { base, night, day, systemLight };
}

/** Wert eines Tokens im Thema, mit aufgelösten var()-Verweisen. */
export function resolve(themes: Themes, theme: ThemeName, name: string, depth = 0): string {
  const own = themes[theme];
  const raw = own.get(name) ?? (theme === "systemLight" ? themes.day.get(name) : undefined) ?? themes.night.get(name) ?? themes.base.get(name);
  if (raw === undefined) throw new Error(`Token ${name} fehlt (${theme})`);
  if (depth > 8) throw new Error(`Token ${name}: Verweis ohne Ende`);
  return raw.replace(/var\((--[a-z0-9-]+)\)/g, (_, n: string) => resolve(themes, theme, n, depth + 1));
}

import { over, parseColor, ratio, type RGBA } from "../../src/lib/contrast.ts";

export { over, parseColor, ratio, type RGBA };

export interface Pair {
  /** Vordergrund, wie in tokens.css benannt */
  fg: string;
  /** Untergrund; mehrere Schichten werden von hinten nach vorn übereinandergelegt: "surface+ok-soft" */
  bg: string;
  min: number;
  note: string;
}

const T = 4.5;
const U = 3;

/** Alle Paare, die in beiden Themen halten müssen. */
export const PAIRS: Pair[] = [
  // Text auf den Flächen
  ...["ground", "surface", "raised", "overlay", "field", "sunken"].flatMap((bg) => [
    { fg: "text", bg, min: T, note: "Text" },
    { fg: "muted", bg, min: T, note: "Text, gedämpft" },
    { fg: "subtle", bg, min: T, note: "Metadaten, Platzhalter" },
    { fg: "accent-text", bg, min: T, note: "Amber als Schrift, Links" },
  ]),
  // Aktion
  { fg: "on-accent", bg: "accent", min: T, note: "Primärbutton" },
  { fg: "on-accent", bg: "accent-hover", min: T, note: "Primärbutton, Hover" },
  { fg: "on-accent", bg: "accent-press", min: T, note: "Primärbutton, gedrückt" },
  { fg: "accent-text", bg: "surface+accent-soft", min: T, note: "Auswahl (Schrift auf accent-soft)" },
  { fg: "text", bg: "surface+accent-soft", min: T, note: "Auswahl, Text" },
  // Status auf Fläche
  { fg: "on-ok", bg: "ok-fill", min: T, note: "Status ok, gefüllt" },
  { fg: "on-warn", bg: "warn-fill", min: T, note: "Status Warnung, gefüllt" },
  { fg: "on-danger", bg: "danger-fill", min: T, note: "Status Fehler, gefüllt" },
  { fg: "on-info", bg: "info-fill", min: T, note: "Status Info, gefüllt" },
  { fg: "on-safety", bg: "safety", min: T, note: "Sicherheit, gefüllt" },
  // Status als Schrift/Icon auf Karte und auf weichem Grund
  ...(["ok", "warn", "danger", "info"] as const).flatMap((s) => [
    { fg: s, bg: "surface", min: T, note: `Status ${s} auf Karte` },
    { fg: s, bg: "ground", min: T, note: `Status ${s} auf Seitengrund` },
    { fg: s, bg: `surface+${s}-soft`, min: T, note: `Status ${s} auf weichem Grund` },
    { fg: s, bg: `raised+${s}-soft`, min: T, note: `Status ${s} auf weichem Grund (Fläche raised)` },
  ]),
  // Nicht-Text: Ränder, Fokus, Fortschritt
  ...["ground", "surface", "raised", "field"].map((bg) => ({ fg: "line-strong", bg, min: U, note: "Rand von Steuerelementen" })),
  ...["ground", "surface", "raised", "overlay"].map((bg) => ({ fg: "focus", bg, min: U, note: "Fokusring" })),
  { fg: "accent-graphic", bg: "surface", min: U, note: "Fortschritt, Schalter an, Haken-Feld" },
  { fg: "accent-graphic", bg: "ground", min: U, note: "Fortschritt auf Seitengrund" },
  { fg: "accent-graphic", bg: "sunken", min: U, note: "Fortschrittsfüllung auf Spur" },
  { fg: "accent-graphic", bg: "field", min: U, note: "Haken-Feld auf Eingabefläche" },
  { fg: "on-accent", bg: "accent-graphic", min: T, note: "Haken im Auswahlfeld" },
  { fg: "danger", bg: "field", min: U, note: "Rand bei ungültigem Feld" },
  // Teamfarben als Punkt auf Karte und Grund
  ...["red", "blue", "green", "yellow", "purple", "orange", "teal", "pink", "olive"].flatMap((c) => [
    { fg: `team-${c}`, bg: "surface", min: U, note: `Team ${c} auf Karte` },
    { fg: `team-${c}`, bg: "ground", min: U, note: `Team ${c} auf Seitengrund` },
  ]),
];

export function colorOf(themes: Themes, theme: ThemeName, expr: string): RGBA {
  // "surface+ok-soft": von hinten nach vorn
  const layers = expr.split("+");
  let acc = parseColor(resolve(themes, theme, `--${layers[0]!}`));
  for (const l of layers.slice(1)) acc = over(parseColor(resolve(themes, theme, `--${l}`)), acc);
  return acc;
}

export interface PairResult extends Pair {
  theme: ThemeName;
  ratio: number;
  ok: boolean;
}

export function checkPairs(themes: Themes, theme: ThemeName): PairResult[] {
  return PAIRS.map((p) => {
    const bg = colorOf(themes, theme, p.bg);
    const fg = over(parseColor(resolve(themes, theme, `--${p.fg}`)), bg);
    const r = ratio(fg, bg);
    return { ...p, theme, ratio: r, ok: r >= p.min };
  });
}
