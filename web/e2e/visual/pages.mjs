// Liste der geprüften Seiten und Zustände; fingerprint.mjs und shots.mjs benutzen dieselbe Liste.
// Neue Seiten hier ergänzen. Die Ids bestimmen Dateinamen und Schlüssel im Fingerabdruck.
// Felder: path (unter dem Basispfad), auth:false = ohne Anmeldung, org = andere Organisation,
// wait = Selektor, auf den vor der Aufnahme gewartet wird, full:false = nur Viewport statt ganzer Seite,
// live:true = Seite mit Live-Verbindung (wird nach dem Laden einmal neu verbunden, siehe visit),
// print:true = mit Druck-Medium und A4-Fenster (nur Nacht), prep = Vorbereitung auf der Seite.
export function pages(S) {
  const G = S.g1.id, E = S.live.id, T0 = S.teams[0].id;
  const ed = (s) => `/spiele/${G}/baukasten${s ? "/" + s : ""}`;
  const ctl = (q = "") => `/events/${E}/leitstand${q}`;
  const live = { full: false, wait: ".conn.open", live: true };
  return [
    { id: "login", path: "/anmelden", auth: false },
    { id: "join", path: "/join/" + S.live.join.code, auth: false },
    { id: "orgs", path: "/organisation" },
    { id: "events-leer", path: "/events", org: S.empty.id },
    { id: "events", path: "/events" },
    { id: "event-live", path: "/events/" + E },
    { id: "event-geplant", path: "/events/" + S.planned.id },
    { id: "event-beendet", path: "/events/" + S.finished.id },
    { id: "event-neu", path: "/events/neu" },
    { id: "spiele-leer", path: "/spiele", org: S.empty.id },
    { id: "spiele", path: "/spiele" },
    { id: "spiel-neu", path: "/spiele/neu", wait: "h1,h2" },
    { id: "spiel-uebersicht", path: "/spiele/" + G },
    { id: "mitglieder", path: "/mitglieder" },
    { id: "konto", path: "/konto" },
    { id: "einstellungen", path: "/einstellungen" },
    { id: "404", path: "/gibts-nicht" },
    { id: "ls", path: ctl(), ...live },
    { id: "ls-teams", path: ctl("?tab=teams"), ...live },
    { id: "ls-team", path: ctl(`?team=${T0}&tab=team`), ...live },
    { id: "ls-funk", path: ctl("?tab=funk"), ...live },
    { id: "ls-klang", path: ctl("?tab=klang"), ...live },
    { id: "ls-pruefungen", path: ctl("?tab=pruefungen"), ...live },
    { id: "ls-rangliste", path: ctl("?tab=rangliste"), ...live },
    { id: "ls-logbuch", path: ctl("?tab=logbuch"), ...live },
    { id: "ls-karte", path: ctl("?tab=karte"), ...live },
    { id: "ls-geplant", path: `/events/${S.planned.id}/leitstand`, full: false },
    { id: "ls-beendet", path: `/events/${S.finished.id}/leitstand`, full: false },
    { id: "betreuer", path: `/events/${E}/betreuer`, full: false, wait: ".conn.open, .page", live: true },
    { id: "bk-uebersicht", path: ed(""), wait: ".editor-title" },
    { id: "bk-karte", path: ed("karte"), wait: ".leaflet-container" },
    { id: "bk-station", path: ed("stationen/funkcheck"), wait: ".editor-title" },
    { id: "bk-raetsel", path: ed("raetsel"), wait: ".editor-title" },
    { id: "bk-geschichte", path: ed("geschichte"), wait: ".editor-title" },
    { id: "bk-belohnungen", path: ed("belohnungen"), wait: ".editor-title" },
    { id: "bk-regeln", path: ed("regeln"), wait: ".editor-title" },
    { id: "bk-sicherheit", path: ed("sicherheit"), wait: ".editor-title" },
    { id: "bk-medien", path: ed("medien"), wait: ".editor-title" },
    { id: "bk-klang", path: ed("klang"), wait: ".editor-title" },
    { id: "bk-einstellungen", path: ed("einstellungen"), wait: ".editor-title" },
    { id: "bk-veroeffentlichen", path: ed("veroeffentlichen"), wait: ".editor-title" },
    { id: "vor-ort", path: `/spiele/${G}/vor-ort` },
    { id: "material", path: `/spiele/${G}/material` },
    // Druck-Ansichten (A4, Druck-Medium)
    { id: "druck-event", path: "/events/" + E, print: true },
    { id: "druck-material", path: `/spiele/${G}/material`, print: true },
    {
      id: "druck-schilder", path: ed("veroeffentlichen"), print: true,
      prep: async (p) => { await p.getByRole("button", { name: /Schilder drucken/ }).click().catch(() => {}); await p.waitForTimeout(800); },
    },
  ];
}

/** Gemeinsame Schleife: ruft fn für jede Seite × Viewport × Thema. VISUAL_ONLY (Regex auf die Id), VISUAL_VPS (z. B. "dm"), VISUAL_THEMES ("nl"). */
export function* combos(S) {
  const only = process.env.VISUAL_ONLY ? new RegExp(process.env.VISUAL_ONLY) : null;
  const vps = (process.env.VISUAL_VPS ?? "dm").split("");
  const ths = (process.env.VISUAL_THEMES ?? "nl").split("").map((c) => (c === "n" ? "night" : "light"));
  for (const st of pages(S)) {
    if (only && !only.test(st.id)) continue;
    if (st.print) { yield { st, vp: "p", th: "night", name: `${st.id}--p-night` }; continue; }
    for (const vp of vps) for (const th of ths) yield { st, vp, th, name: `${st.id}--${vp}-${th}` };
  }
}

/** Öffnet die Seite des Zustands und wartet, bis sie ruhig ist. */
export async function visit(page, APP, st) {
  await page.goto(APP + st.path);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (st.wait) await page.locator(st.wait).first().waitFor({ timeout: 12000 }).catch(() => console.log("wait fail", st.id));
  await settle(page);
  if (st.live) {
    // Zähler am Reiter (ungelesene Funksprüche) bleiben veraltet, wenn die Nachrichten als letzte Antwort eintreffen;
    // ein Neuverbinden lädt alles erneut und führt immer zum selben Endzustand.
    await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
    if (st.wait) await page.locator(st.wait).first().waitFor({ timeout: 12000 }).catch(() => {});
    await settle(page);
  }
  await st.prep?.(page);
  // Der Funkverlauf scrollt je nach Antwortreihenfolge die Seite mit; immer vom Anfang aufnehmen.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  if (st.print) {
    await page.emulateMedia({ media: "print" });
    await settle(page);
  }
}

/** Wartet, bis Schriften geladen sind und sich das DOM (inklusive Live-Daten per WebSocket) nicht mehr ändert. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  let last = "", same = 0;
  for (let i = 0; i < 40 && same < 5; i++) {
    await page.waitForTimeout(400);
    const now = await page.evaluate(() => `${document.body.innerHTML.length}:${document.body.innerText.length}:${document.body.innerHTML.slice(0, 20000)}`).catch(() => "");
    same = now === last ? same + 1 : 0;
    last = now;
  }
}
