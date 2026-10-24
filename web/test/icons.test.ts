import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasIcon, Icon, ICON_NAMES, Lantern, strokeWidth } from "../src/ui/icons.tsx";

function walk(dir: URL): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const url = new URL(name + (statSync(new URL(name, dir)).isDirectory() ? "/" : ""), dir);
    if (statSync(url).isDirectory()) out.push(...walk(url));
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(url.pathname);
  }
  return out;
}

describe("Icons", () => {
  it("der Satz hat mindestens 60 Icons ohne Doppelte", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("jedes Icon in den Quellen gibt es: <Icon name=…>, icon=…, iconEnd=…, icon: …", () => {
    const missing: string[] = [];
    for (const f of walk(new URL("../src/", import.meta.url))) {
      const text = readFileSync(f, "utf8");
      const rel = f.slice(f.indexOf("/src/") + 1);
      for (const m of text.matchAll(/<Icon\s+name="([a-z0-9-]+)"/g)) if (!hasIcon(m[1]!)) missing.push(`${rel}: ${m[1]}`);
      for (const m of text.matchAll(/\bicon(?:End)?=\s*"([a-z0-9-]+)"/g)) if (!hasIcon(m[1]!)) missing.push(`${rel}: ${m[1]}`);
      for (const m of text.matchAll(/\bicon:\s*"([a-z0-9-]+)"/g)) if (!hasIcon(m[1]!) && m[1] !== "spinner") missing.push(`${rel}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("die Text-Zeichen haben ein Icon", () => {
    // Haken, Kreuz, Mehr, Pfeil rechts/hoch/runter, ungefähr, Griff, Pfeilspitze rechts/runter, Punkt
    for (const n of ["check", "x", "more", "arrow-right", "arrow-up", "arrow-down", "approx", "grip", "caret-right", "caret-down", "dot"]) expect(hasIcon(n), n).toBe(true);
  });

  it("alle bisherigen Namen bleiben erhalten", () => {
    const old = "play stop pause pin phone radio send sound check x alert battery clock users menu sun moon upload download trash edit eye back plus refresh print map list flag log trophy camera link external image video wave signal route gear".split(" ");
    expect(old.filter((n) => !hasIcon(n))).toEqual([]);
  });

  it("Icon zeichnet ein 24er Raster, Größe 20 und Strich 1,75 (16 px: 2)", () => {
    const v = Icon({ name: "check" }) as unknown as { props: Record<string, unknown> };
    expect(v.props.viewBox).toBe("0 0 24 24");
    expect(v.props.width).toBe(20);
    expect(v.props["stroke-width"]).toBe(1.75);
    expect(v.props["aria-hidden"]).toBe("true");
    const small = Icon({ name: "check", size: 16 }) as unknown as { props: Record<string, unknown> };
    expect(small.props["stroke-width"]).toBe(strokeWidth(16));
    expect(strokeWidth(16)).toBe(2);
    expect(strokeWidth(24)).toBe(1.75);
  });

  it("mit label ist das Icon ein Bild mit Namen, sonst für Screenreader verborgen", () => {
    const v = Icon({ name: "alert", label: "Warnung" }) as unknown as { props: Record<string, unknown> };
    expect(v.props.role).toBe("img");
    expect(v.props["aria-label"]).toBe("Warnung");
    expect(v.props["aria-hidden"]).toBeUndefined();
  });

  it("jedes Icon hat Inhalt", () => {
    for (const n of ICON_NAMES) {
      const v = Icon({ name: n }) as unknown as { props: { children: unknown } };
      expect(v.props.children, n).toBeTruthy();
    }
  });

  it("das Signet gibt es einfarbig und mit Flamme", () => {
    const color = Lantern({}) as unknown as { props: { children: { props: { fill?: string } }[] } };
    const mono = Lantern({ mono: true }) as unknown as { props: { children: { props: { fill?: string } }[] } };
    const flame = (v: typeof color) => v.props.children.find((c) => c.props.fill && c.props.fill !== "none" && c.props.fill !== "currentColor")?.props.fill;
    expect(flame(color)).toBe("var(--accent)");
    expect(flame(mono)).toBeUndefined();
  });

  it("im TSX stehen keine Text-Icons mehr in der Oberfläche der Bausteine und der Entwurfsseite", () => {
    const glyphs = /[✓✗⋯→↑↓≈≡▸▾●]/;
    const own = walk(new URL("../src/ui/", import.meta.url)).concat(walk(new URL("../src/pages/design/", import.meta.url)));
    const hits: string[] = [];
    for (const f of own) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (glyphs.test(line)) hits.push(`${f.slice(f.indexOf("/src/") + 1)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
