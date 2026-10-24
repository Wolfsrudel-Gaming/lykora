import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS, breakpointOf, down, up } from "../src/lib/breakpoints.ts";

describe("Breakpoints", () => {
  it("vier Stufen: 640, 960, 1280, 1600", () => {
    expect(BREAKPOINTS).toEqual({ sm: 640, md: 960, lg: 1280, xl: 1600 });
  });

  it("up und down ergeben dieselben Abfragen wie im CSS", () => {
    expect(up("md")).toBe("(min-width: 960px)");
    expect(down("md")).toBe("(max-width: 959px)");
    expect(up("sm")).toBe("(min-width: 640px)");
    expect(down("sm")).toBe("(max-width: 639px)");
  });

  it("breakpointOf ordnet die Breite zu", () => {
    expect(breakpointOf(390)).toBe("xs");
    expect(breakpointOf(640)).toBe("sm");
    expect(breakpointOf(959)).toBe("sm");
    expect(breakpointOf(960)).toBe("md");
    expect(breakpointOf(1440)).toBe("lg");
    expect(breakpointOf(1600)).toBe("xl");
  });
});

function css(dir: URL): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const url = new URL(name + (statSync(new URL(name, dir)).isDirectory() ? "/" : ""), dir);
    if (statSync(url).isDirectory()) out.push(...css(url));
    else if (name.endsWith(".css")) out.push({ file: url.pathname.slice(url.pathname.indexOf("/src/") + 5), text: readFileSync(url, "utf8") });
  }
  return out;
}

const OK = new Set<number>([640, 639, 960, 959, 1280, 1279, 1600, 1599]);

/**
 * Seiten-CSS, das noch eigene Breiten hat (Stand der Umstellung). Die Liste darf nur kürzer werden:
 * Wer eine Datei umstellt, nimmt sie hier heraus; neue Abweichungen schlagen an.
 */
const LEGACY: Record<string, number[]> = {
  "pages/control/control.css": [480],
  "pages/games/editor/editor-frame.css": [1100],
  "pages/games/editor/map/editor-map.css": [899, 1100],
  "pages/games/editor/publish/checklist.css": [480],
  "pages/games/editor/rules/rules.css": [600],
  "pages/games/editor/story/story.css": [600],
  "styles/shell.css": [860, 900],
};

describe("@media im CSS liegt auf den Stufen", () => {
  const files = css(new URL("../src/", import.meta.url));
  const found = new Map<string, number[]>();
  for (const { file, text } of files) {
    const nums = [...text.matchAll(/@media[^{]*\((?:min|max)-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    const off = nums.filter((n) => !OK.has(n));
    if (off.length) found.set(file, [...new Set(off)].sort((a, b) => a - b));
  }

  it("Tokens, Basis, Bausteine und Entwurfsseite benutzen nur 640, 960, 1280, 1600 (±1)", () => {
    const mine = [...found.keys()].filter((f) => /styles\/(tokens|base|typography|layout|brand|print|components\/)|pages\/design\//.test(f));
    expect(mine.map((f) => `${f}: ${found.get(f)!.join(", ")}`)).toEqual([]);
  });

  it("fremdes Seiten-CSS: keine neuen Abweichungen (Altbestand ist gelistet)", () => {
    const other = Object.fromEntries([...found].filter(([f]) => !/styles\/(tokens|base|typography|layout|brand|print|components\/)|pages\/design\//.test(f)));
    const unknown = Object.entries(other).flatMap(([file, nums]) => nums.filter((n) => !(LEGACY[file] ?? []).includes(n)).map((n) => `${file}: ${n}`));
    expect(unknown).toEqual([]);
  });
});
