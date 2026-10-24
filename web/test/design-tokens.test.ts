import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPairs, parseRules, readCss, readThemes, resolve, STYLES, type ThemeName } from "./helpers/tokens.ts";

const themes = readThemes();

describe("Kontrast der Tokens (WCAG 2.x)", () => {
  for (const theme of ["night", "day", "systemLight"] as ThemeName[]) {
    it(`alle Paare halten im Thema ${theme}`, () => {
      const bad = checkPairs(themes, theme).filter((r) => !r.ok);
      expect(bad.map((r) => `${r.fg} auf ${r.bg}: ${r.ratio.toFixed(2)} < ${r.min} (${r.note})`)).toEqual([]);
    });
  }

  it("prüft mindestens 80 Paare je Thema", () => {
    expect(checkPairs(themes, "night").length).toBeGreaterThanOrEqual(80);
  });
});

describe("Themen", () => {
  it("System (hell) hat genau die Werte von Tag", () => {
    // Beide Blöcke werden von Hand gepflegt; dieser Test hält sie gleich.
    const day = [...themes.day].filter(([k]) => k !== "color-scheme");
    const sys = [...themes.systemLight];
    expect(sys).toEqual(day);
  });

  it("Tag definiert genau die Tokens, die Nacht definiert", () => {
    const names = (m: Map<string, string>) => [...m.keys()].filter((k) => k.startsWith("--")).sort();
    expect(names(themes.day)).toEqual(names(themes.night));
  });

  it("die Laterne ist in beiden Themen gleich: --accent ist die Fläche, --accent-text die Schrift", () => {
    expect(resolve(themes, "night", "--accent")).toBe(resolve(themes, "day", "--accent"));
    expect(resolve(themes, "night", "--accent-text")).not.toBe(resolve(themes, "day", "--accent-text"));
  });

  it("Sicherheitsfarben sind in beiden Themen gleich", () => {
    for (const k of ["--safety", "--on-safety", "--tape-a", "--tape-b", "--rescue"]) expect(resolve(themes, "night", k)).toBe(resolve(themes, "day", k));
  });

  it("System gilt nur bei hellem Gerät, Nacht bleibt der Standard", () => {
    const rules = parseRules(readCss("tokens.css"));
    const sys = rules.filter((r) => r.selector === ':root[data-theme="system"]');
    expect(sys).toHaveLength(2);
    expect(sys.some((r) => r.media.includes("(prefers-color-scheme: light)"))).toBe(true);
    const root = rules.find((r) => r.selector === ':root, :root[data-theme="night"]');
    expect(root?.decls.get("color-scheme")).toBe("dark");
  });
});

describe("Raster und Skalen", () => {
  const n = (k: string) => Number.parseInt(themes.base.get(k) ?? "", 10);

  it("Abstände liegen auf dem 4-Pixel-Raster (außer der 2-Pixel-Haarlinie)", () => {
    const spaces = [...themes.base].filter(([k]) => /^--space-\d+$/.test(k));
    expect(spaces.length).toBeGreaterThanOrEqual(10);
    for (const [k, v] of spaces) expect(Number.parseInt(v, 10) % 4, `${k}: ${v}`).toBe(0);
    expect(n("--space-px")).toBe(2);
  });

  it("genau zehn Schriftgrößen", () => {
    const sizes = [...themes.base].filter(([k]) => k.startsWith("--fs-")).map(([, v]) => Number.parseInt(v, 10));
    expect(sizes).toEqual([11, 12, 13, 14, 15, 17, 20, 24, 30, 40]);
  });

  it("Radien, Steuerelemente, Ebenen", () => {
    expect([n("--radius-xs"), n("--radius-sm"), n("--radius-md"), n("--radius-lg")]).toEqual([4, 6, 8, 12]);
    expect([n("--control-sm"), n("--control-md"), n("--control-lg")]).toEqual([32, 40, 48]);
    const z = [...themes.base].filter(([k]) => k.startsWith("--z-")).map(([, v]) => Number(v));
    expect(z).toEqual([...z].sort((a, b) => a - b));
    expect(new Set(z).size).toBe(z.length);
  });

  it("alle Typo-Rollen sind font-Kurzschriften", () => {
    for (const k of ["display", "clock", "stat", "title", "heading", "subhead", "lead", "body", "body-strong", "dense", "label", "caption", "mono", "eyebrow", "badge"]) {
      expect(themes.base.get(`--type-${k}`), `--type-${k}`).toMatch(/^\d{3} .+ var\(--font-/);
    }
  });

  it("Reduced-Motion setzt alle Dauern auf 0", () => {
    const rules = parseRules(readCss("tokens.css"));
    const r = rules.find((x) => x.media.includes("(prefers-reduced-motion: reduce)"));
    expect([...(r?.decls ?? [])]).toEqual([
      ["--dur-press", "0ms"],
      ["--dur-hover", "0ms"],
      ["--dur-pop", "0ms"],
      ["--dur-panel", "0ms"],
    ]);
  });

  it("Dichte compact verkleinert Zeile, Karte und Zelle", () => {
    const rules = parseRules(readCss("tokens.css"));
    const c = rules.find((x) => x.selector === '[data-density="compact"]');
    expect(c?.decls.get("--row-h")).toBe("36px");
    expect(themes.base.get("--row-h")).toBe("44px");
  });
});

describe("Legacy-Aliase bleiben, bis die Seiten umgestellt sind", () => {
  it("alte Namen sind definiert", () => {
    const all = new Set([...themes.base.keys(), ...themes.night.keys()]);
    for (const k of ["--edge", "--accent-bright", "--radius", "--radius-small", "--shade", "--gap", "--tap", "--tick", "--enter", "--ease", "--gutter", "--rescue"]) {
      expect(all.has(k), k).toBe(true);
    }
  });

  it("--edge ist der Rand von Steuerelementen, --accent-bright die Amber-Schrift", () => {
    for (const t of ["night", "day"] as const) {
      expect(resolve(themes, t, "--edge")).toBe(resolve(themes, t, "--line-strong"));
      expect(resolve(themes, t, "--accent-bright")).toBe(resolve(themes, t, "--accent-text"));
    }
  });
});

// Jedes var(--x), das in den Stilen oder im TSX steht, muss irgendwo definiert sein.

function walk(dir: URL, ext: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const url = new URL(name + (statSync(new URL(name, dir)).isDirectory() ? "/" : ""), dir);
    if (name === "node_modules") continue;
    if (statSync(url).isDirectory()) out.push(...walk(url, ext));
    else if (ext.some((e) => name.endsWith(e))) out.push(url.pathname);
  }
  return out;
}

describe("var(--name) ist überall definiert", () => {
  const SRC = new URL("../src/", import.meta.url);
  const files = walk(SRC, [".css", ".tsx", ".ts"]);
  const declared = new Set<string>();
  const used = new Map<string, string[]>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?<![\w-])(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]!);
    // Inline-Stile im TSX: { "--ring-size": … }
    for (const m of text.matchAll(/["'](--[a-z0-9-]+)["']\s*:/g)) declared.add(m[1]!);
    for (const m of text.matchAll(/var\((--[a-z0-9-]*[a-z0-9])[,)]/g)) {
      const list = used.get(m[1]!) ?? [];
      list.push(f.slice(f.indexOf("/src/") + 1));
      used.set(m[1]!, list);
    }
  }

  it("nichts verweist auf einen Namen ohne Definition", () => {
    // Ausnahmen: Werte, die der Aufrufer per Inline-Stil setzt und die ein Rückfallwert absichert
    const ALLOW = new Set<string>(["--sticky-top"]);
    const missing = [...used.keys()].filter((k) => !declared.has(k) && !ALLOW.has(k));
    expect(missing.map((k) => `${k} (${used.get(k)!.slice(0, 2).join(", ")})`)).toEqual([]);
  });

  it("tokens.css definiert die Farb- und Maßtokens selbst (nicht nur Seiten)", () => {
    const tokenText = readFileSync(new URL("tokens.css", STYLES), "utf8");
    for (const k of used.keys()) {
      if (/^--(ground|surface|raised|overlay|field|sunken|line|line-strong|text|muted|subtle|accent|accent-text|on-accent|focus|ok|warn|danger|info|safety|on-safety|font-ui|font-mono|font-head|font-brand|radius-(xs|sm|md|lg)|space-\d+)$/.test(k)) {
        expect(tokenText.includes(`${k}:`), k).toBe(true);
      }
    }
  });
});
