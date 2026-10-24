// Sät eine frische Instanz mit festen Daten: zwei Organisationen (eine leer), zwei Spiele, vier Events
// (laufend mit sechs Teams, zwei geplant, eines beendet), SOS und Rückruf. Alles über die HTTP-API.
//   node web/e2e/visual/seed.mjs      -> schreibt $VISUAL_OUT/state.json
// Die Instanz muss frisch sein (leere Datenbank, Admin aus ADMIN_EMAIL/ADMIN_PASSWORD, siehe instance.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { APP as SERVER, ensureDir, OUT, ROOT, STATE_FILE } from "./lib.mjs";
const ADMIN = { email: process.env.VISUAL_ADMIN_EMAIL ?? "admin@example.org", password: process.env.VISUAL_ADMIN_PASSWORD ?? "geheim-geheim" };

async function api(method, path, body, token) {
  const res = await fetch(`${SERVER}/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = (o = 0) => new Date(Date.now() + o * 1000).toISOString();
let seq = 0;
const cid = (p) => `${p}-${Date.now()}-${++seq}`;

const admin = await api("POST", "/auth/login", ADMIN);
const T = admin.token;
// empty org (for empty states) and filled org
const empty = await api("POST", "/orgs", { name: "Stamm Sieglar (leer)", slug: "stamm-sieglar" }, T);
const org = await api("POST", "/orgs", { name: "Pfadfinder Hennef", slug: "pfadfinder-hennef" }, T);
console.log("orgs", empty.id, org.id);

const sieglar = JSON.parse(readFileSync(`${ROOT}/spec/v0.1/examples/nachtigall-sieglar.json`, "utf8"));
const test = JSON.parse(readFileSync(`${ROOT}/spec/v0.1/examples/testspiel.json`, "utf8"));
test.stations.find((s) => s.id === "baum").triggers.find((t) => t.type === "nfc").tag = "04:A1:B2:C3:D4:E5:F6";
const g1 = await api("POST", `/orgs/${org.id}/games`, { content: sieglar, comment: "Erste Fassung nach dem Probelauf" }, T);
const g2 = await api("POST", `/orgs/${org.id}/games`, { content: test, comment: "Erste Fassung" }, T);
console.log("games", g1.id, g2.id);

// a second version of g1 for version select
const ev = (name, gameId, extra = {}) => api("POST", `/orgs/${org.id}/events`, { gameId, version: 1, name, ...extra }, T);
const live = await ev("Nachtwanderung Sieglar", g1.id, { scheduledAt: new Date(Date.now() - 3600e3).toISOString() });
const planned = await ev("Sommerlager Hennef: Abendspiel", g2.id, { scheduledAt: "2026-11-14T19:30:00+01:00" });
const planned2 = await ev("Gruppenstunde Wölflinge", g2.id, { scheduledAt: "2026-11-21T17:00:00+01:00" });
const finished = await ev("Herbstaktion 2025", g1.id, { scheduledAt: "2026-10-02T19:00:00+02:00" });
console.log("events", live.id, planned.id, finished.id);

// finished event: start, one team, end
await api("POST", `/events/${finished.id}/start`, {}, T);
await sleep(1200);
const fj = await api("POST", "/join", { code: finished.join.code, device: "seed", team: { name: "Dachse", color: "green", members: ["Tom", "Jana"] } });
await api("POST", `/events/${finished.id}/end`, {}, T).catch((e) => console.log("end", e.message));

// live event
await api("POST", `/events/${live.id}/start`, {}, T);
await sleep(1500);
const pin = live.supervisorPin;
const teams = [
  ["Füchse", "orange", ["Mia", "Ben", "Lotta"], 4, 62, [50.8070, 7.1341]],
  ["Eulenwacht", "blue", ["Lea", "Paul"], 2, 14, [50.8061, 7.1338]],
  ["Waschbären", "green", ["Nora", "Jonas", "Emil"], 6, 88, [50.8052, 7.1332]],
  ["Nachtfalter", "purple", ["Ida", "Karl"], 1, 45, [50.8044, 7.1349]],
  ["Dachse", "red", ["Finn", "Mats"], 0, 71, [50.8077, 7.1329]],
  ["Igel", "yellow", ["Hanna", "Theo"], 3, 9, [50.8058, 7.1352]],
];
const joined = [];
for (const [name, color, members, solved, battery, pos] of teams) {
  try {
    const j = await api("POST", "/join", { code: live.join.code, device: "seed", team: { name, color, members, emergencyPhone: "+49 170 1234567", supervisorPin: pin } });
    joined.push({ name, token: j.token, id: j.team.id, solved, battery, pos });
  } catch (e) {
    console.log("join fail", name, e.message);
  }
}
const ids = sieglar.stations.map((s) => s.id);
for (const t of joined) {
  await api(
    "POST",
    "/play/sync",
    {
      deviceTime: now(),
      battery: t.battery / 100,
      actions: [{ id: cid("a"), type: "start", time: now(-0.5) }],
      positions: [
        { lat: t.pos[0] - 0.0004, lon: t.pos[1] - 0.0005, accuracy: 12, time: now(-120) },
        { lat: t.pos[0] - 0.0002, lon: t.pos[1] - 0.0002, accuracy: 9, time: now(-60) },
        { lat: t.pos[0], lon: t.pos[1], accuracy: 8, time: now(-t.name === "Igel" ? -400 : -4) },
      ],
    },
    t.token,
  );
  for (let i = 0; i < t.solved; i++) {
    try {
      await api("POST", `/events/${live.id}/teams/${t.id}/actions`, { type: "staff_solve", payload: { station: ids[i] } }, T);
    } catch (e) {
      console.log("solve fail", t.name, ids[i], e.message.slice(0, 120));
    }
  }
}
const by = Object.fromEntries(joined.map((t) => [t.name, t]));
await api("POST", "/play/messages", { id: cid("m"), body: "Uns ist mulmig.", kind: "predefined" }, by["Füchse"].token);
await api("POST", "/play/messages", { id: cid("m"), body: "Station 3 ist kaputt?", kind: "predefined" }, by["Eulenwacht"].token);
await api("POST", "/play/messages", { id: cid("m"), body: "Wir haben den Hinweis am Aushang nicht gefunden, können wir einen Tipp haben?", kind: "chat" }, by["Nachtfalter"].token);
await api("POST", `/events/${live.id}/messages`, { teamId: by["Füchse"].id, body: "Bleibt, wo ihr seid. Ich komme mit der Lampe zu euch.", sender: "jule" }, T).catch((e) => console.log("msg", e.message.slice(0, 200)));
// photo review: skip (needs upload)
ensureDir(OUT);
writeFileSync(STATE_FILE, JSON.stringify({ seededAt: Date.now(), token: T, org, empty, g1, g2, live, planned, planned2, finished, teams: joined, pin, fj: fj.team }, null, 1));
console.log("done");
