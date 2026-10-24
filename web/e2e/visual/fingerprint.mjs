// Fingerabdruck der berechneten Stile je Seite: beweist, dass ein reines CSS-Verschieben nichts ändert
// (oder zeigt bei gewollten Änderungen genau, was sich ändert).
//   Aufnehmen:  node web/e2e/visual/fingerprint.mjs <label>        -> $VISUAL_OUT/fingerprint-<label>.json
//   Vergleich:  node web/e2e/visual/fingerprint.mjs --diff <a> <b> (Labels oder Dateipfade; Exit 1 bei Abweichung)
import { readFileSync, writeFileSync } from "node:fs";
import { APP, launch, ensureDir, loadState, open, OUT, resolveOut } from "./lib.mjs";
import { combos, visit } from "./pages.mjs";

const file = (arg) => resolveOut(arg, "fingerprint", ".json");

if (process.argv[2] === "--diff") {
  const a = JSON.parse(readFileSync(file(process.argv[3]))), b = JSON.parse(readFileSync(file(process.argv[4])));
  let bad = 0;
  // VISUAL_ONLY (Regex auf die Seiten-Id) begrenzt den Vergleich auf einen Teil, wenn nur dieser aufgenommen wurde.
  const only = process.env.VISUAL_ONLY ? new RegExp(process.env.VISUAL_ONLY) : null;
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !only || only.test(k.split("--")[0]))) {
    const A = a[k], B = b[k];
    if (!A || !B) { bad++; console.log(`DIFF ${k}: nur in ${A ? "a" : "b"}`); continue; }
    const d = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((x) => A[x] !== B[x]);
    if (d.length) {
      bad++;
      console.log(`DIFF ${k}: ${d.length} Abweichungen, z. B. ${d.slice(0, 2).map((x) => `${x.slice(0, 90)}… ${A[x] ?? 0}→${B[x] ?? 0}`).join(" | ")}`);
    }
  }
  console.log(bad ? `${bad} Seiten weichen ab` : "identisch");
  process.exit(bad ? 1 : 0);
}

const label = process.argv[2];
if (!label) { console.error("Aufruf: fingerprint.mjs <label> | --diff <a> <b>"); process.exit(2); }

const PROPS = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopStyle", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "fontSize", "fontWeight", "fontFamily", "letterSpacing", "lineHeight", "textTransform", "textDecorationLine", "boxShadow", "opacity", "display", "position", "zIndex", "rowGap", "columnGap", "backgroundImage", "cursor", "transitionProperty", "transitionDuration", "minHeight", "outlineStyle", "width", "height"];
const S = loadState();
const out = {};
const browser = await launch();
for (const { st, vp, th, name } of combos(S)) {
  const { context, page } = await open(browser, S, vp, th, { auth: st.auth !== false, org: st.org });
  await visit(page, APP, st);
  out[name] = await page.evaluate((props) => {
    const m = {};
    for (const el of document.querySelectorAll("body, body *")) {
      // Karten-Marker erscheinen zeitabhängig; die Kartenstile prüft der Screenshot-Vergleich.
      if (el.closest(".leaflet-container") && !el.matches(".leaflet-container")) continue;
      const cs = getComputedStyle(el);
      const key = `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}|` + props.map((p) => cs[p]).join("|");
      m[key] = (m[key] ?? 0) + 1;
    }
    return m;
  }, PROPS);
  await context.close();
}
await browser.close();
ensureDir(OUT);
writeFileSync(file(label), JSON.stringify(out));
console.log("geschrieben", file(label), Object.keys(out).length, "Zustände");
