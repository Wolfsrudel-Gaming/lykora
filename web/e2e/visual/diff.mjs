// Pixelvergleich zweier Bilderordner (gleiche Dateinamen). Diff-Bilder landen in $VISUAL_OUT/diff-<a>-<b>/, nie im Quellordner.
//   node web/e2e/visual/diff.mjs <a> <b> [--tol N]    (a, b: Labels von shots.mjs oder Ordnerpfade)
// Exit 1 bei Abweichung. --tol N: Kanalunterschied bis N zählt nicht als abweichend (Standard 0 = streng).
// shots.mjs startet Chromium mit festen Raster-Optionen (lib.mjs launch), damit zwei Läufe ohne Änderung 0 Pixel abweichen.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureDir, OUT, resolveOut } from "./lib.mjs";
import { decode, encodeRgb } from "./png.mjs";

const args = process.argv.slice(2);
const tol = args.includes("--tol") ? Number(args[args.indexOf("--tol") + 1]) : 0;
const [a, b] = args.filter((x, i) => !x.startsWith("--") && args[i - 1] !== "--tol").map((x) => resolveOut(x, "shots"));
if (!a || !b) { console.error("Aufruf: diff.mjs <a> <b> [--tol N]"); process.exit(2); }
const diffDir = join(OUT, `diff-${basename(a).replace(/^shots-/, "")}-${basename(b).replace(/^shots-/, "")}`);

let bad = 0, compared = 0;
// VISUAL_ONLY (Regex auf die Seiten-Id) begrenzt den Vergleich auf einen Teil, wenn nur dieser aufgenommen wurde.
const only = process.env.VISUAL_ONLY ? new RegExp(process.env.VISUAL_ONLY) : null;
const pick = (x) => x.endsWith(".png") && (!only || only.test(x.split("--")[0]));
for (const f of readdirSync(a).filter(pick).sort()) {
  if (!existsSync(join(b, f))) { console.log(`FEHLT in b: ${f}`); bad++; continue; }
  compared++;
  const x = decode(readFileSync(join(a, f))), y = decode(readFileSync(join(b, f)));
  if (x.width !== y.width || x.height !== y.height) { console.log(`SIZE ${f} ${x.width}x${x.height} -> ${y.width}x${y.height}`); bad++; continue; }
  const d = Buffer.alloc(x.width * x.height * 3, 0);
  let n = 0, max = 0;
  for (let i = 0; i < x.width * x.height; i++) {
    const diff = Math.max(Math.abs(x.rgb[i * 3] - y.rgb[i * 3]), Math.abs(x.rgb[i * 3 + 1] - y.rgb[i * 3 + 1]), Math.abs(x.rgb[i * 3 + 2] - y.rgb[i * 3 + 2]));
    if (diff > tol) { n++; if (diff > max) max = diff; d[i * 3] = 255; d[i * 3 + 1] = 255; d[i * 3 + 2] = 255; }
  }
  if (n) {
    bad++;
    console.log(`DIFF ${f}: ${n} px (größte Abweichung ${max}/255)`);
    writeFileSync(join(ensureDir(diffDir), f), encodeRgb(x.width, x.height, d));
  }
}
for (const f of readdirSync(b).filter((x) => pick(x) && !existsSync(join(a, x)))) { console.log(`NEU in b: ${f}`); bad++; }
console.log(`fertig, ${compared} verglichen, ${bad} abweichend${bad ? ` (Diff-Bilder: ${diffDir})` : ""}`);
process.exit(bad ? 1 : 0);
