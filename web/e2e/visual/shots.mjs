// Bildschirmfotos aller Seiten aus pages.mjs in $VISUAL_OUT/shots-<label>/ (Uhr fest, Kacheln aus der Attrappe).
//   node web/e2e/visual/shots.mjs <label>
// Danach vergleichen: node web/e2e/visual/diff.mjs <labelA> <labelB>
import { APP, launch, ensureDir, loadState, open, resolveOut } from "./lib.mjs";
import { combos, visit } from "./pages.mjs";

const label = process.argv[2];
if (!label) { console.error("Aufruf: shots.mjs <label>"); process.exit(2); }
const dir = ensureDir(resolveOut(label, "shots"));
const S = loadState();
const browser = await launch();
let n = 0;
for (const { st, vp, th, name } of combos(S)) {
  const { context, page } = await open(browser, S, vp, th, { auth: st.auth !== false, org: st.org });
  try {
    await visit(page, APP, st);
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: st.full !== false, animations: "disabled", caret: "hide" });
    n++;
  } catch (e) {
    console.log("FEHLER", name, e.message.slice(0, 160));
  }
  if (page.errors.length) console.log(name, "Seitenfehler:", page.errors);
  await context.close();
}
await browser.close();
console.log("geschrieben", n, "Bilder nach", dir);
