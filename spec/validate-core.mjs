// Paket A: Validator-Kern ohne node:fs – läuft in Node (validate.mjs, Server) und im Browser (Baukasten).
// Liefert strukturierte Meldungen (JSON-Pointer, Code, Params) und erzeugt daraus die bisherigen
// Zeichenketten, damit validateGame, Server und Web-Tests unverändert bleiben.

import Ajv2020 from "ajv/dist/2020.js";

// Das CJS-Modul kommt unter Node und Vite unterschiedlich an.
const Ajv = Ajv2020.default ?? Ajv2020;

/**
 * Schema-Prüfer je Formatversion; schemas: { "0.1": <game.schema.json> }.
 * Das Kompilat entsteht beim ersten Aufruf je Version und wird danach wiederverwendet.
 */
export function createValidator(schemas) {
  const compiled = new Map();
  const validatorFor = (version) => {
    if (!compiled.has(version)) {
      // Nur eigene Schlüssel, sonst träfe „constructor“ auf Object.prototype.
      if (!Object.hasOwn(schemas, version)) return null;
      const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
      compiled.set(version, ajv.compile(schemas[version]));
    }
    return compiled.get(version);
  };
  return function validateGameDetailed(game) {
    const version = game?.format?.version;
    const validate = validatorFor(version);
    if (!validate) {
      const issue = { kind: "schema", path: "/format/version", keyword: "formatVersion", message: `Unbekannte Formatversion „${version}“`, params: { version }, schemaPath: "" };
      return { ok: false, schema: [issue], references: [], warnings: [] };
    }
    if (!validate(game)) {
      const schema = validate.errors.map((e) => ({ kind: "schema", path: e.instancePath, keyword: e.keyword, message: e.message ?? "", params: e.params ?? {}, schemaPath: e.schemaPath }));
      return { ok: false, schema, references: [], warnings: [] };
    }
    const refs = checkReferences(game);
    return { ok: refs.errors.length === 0, schema: [], references: refs.errors, warnings: refs.warnings };
  };
}

/** Bisherige Zeichenkette zu einer Meldung. */
export function formatIssue(issue) {
  if (issue.kind === "schema") return issue.keyword === "formatVersion" ? issue.message : `${issue.path || "/"} ${issue.message}`;
  return `${issue.where}: ${issue.message}`;
}

/**
 * Ergebnis wie bisher: { errors, warnings } als Zeichenketten. Schemafehler bleiben ungefiltert (Ajv meldet
 * oneOf-Varianten mehrfach), gleiche Querverweis-Texte nur einmal.
 */
export function toLegacy(result) {
  return { errors: [...result.schema.map(formatIssue), ...new Set(result.references.map(formatIssue))], warnings: result.warnings.map(formatIssue) };
}

const list = (x) => (Array.isArray(x) ? x : []);
// Schlüssel im JSON-Pointer (RFC 6901).
const key = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");

const KIND_CODES = { "Medien-ID": "unknown_media", Figur: "unknown_character", "Item-ID": "unknown_item", "Fragment-ID": "unknown_fragment", "Stations-ID": "unknown_station", "Kapitel-ID": "unknown_chapter" };

/**
 * Prüfungen, die JSON-Schema nicht ausdrücken kann. Jede Meldung trägt where (bisherige Bezeichnung,
 * z. B. stations[baum].rewards) und path (JSON-Pointer mit Listenplätzen, z. B. /stations/1/rewards/fragments/0).
 * Wirft nicht bei unvollständigen Entwürfen; gleiche Meldungen an verschiedenen Stellen bleiben getrennt.
 */
export function checkReferences(game) {
  const g = game && typeof game === "object" ? game : {};
  const errors = [];
  const push = (code, where, path, message, params = {}) => errors.push({ kind: "reference", code, where, path, message, params });

  const unique = (label, pointer, entries) => {
    const seen = new Set();
    list(entries).forEach((x, i) => {
      const id = x?.id;
      if (seen.has(id)) push("duplicate_id", label, `${pointer}/${i}/id`, `ID „${id}“ ist doppelt`, { id, list: label });
      seen.add(id);
    });
    return seen;
  };

  const stations = unique("stations", "/stations", g.stations);
  const characters = unique("characters", "/characters", g.characters);
  const fragments = unique("fragments", "/fragments", g.fragments);
  const items = unique("items", "/items", g.items);
  const media = unique("media", "/media", g.media);
  const chapters = unique("story.chapters", "/story/chapters", g.story?.chapters);
  unique("rules", "/rules", g.rules);
  unique("field.restrictedZones", "/field/restrictedZones", g.field?.restrictedZones);

  const ref = (where, path, set, id, kind) => {
    if (!set.has(id)) push(KIND_CODES[kind], where, path, `unbekannte ${kind} „${id}“`, { id, kind });
  };
  const mediaRefs = (where, path, ids) => list(ids).forEach((id, i) => ref(where, `${path}/${i}`, media, id, "Medien-ID"));

  mediaRefs("story.intro", "/story/intro/media", g.story?.intro?.media);
  mediaRefs("story.outro", "/story/outro/media", g.story?.outro?.media);
  list(g.story?.chapters).forEach((c, i) => mediaRefs(`story.chapters[${c?.id}]`, `/story/chapters/${i}/piece/media`, c?.piece?.media));
  if (g.story?.hq?.avatar) ref("story.hq.avatar", "/story/hq/avatar", media, g.story.hq.avatar, "Medien-ID");
  list(g.items).forEach((it, i) => {
    if (it?.icon) ref(`items[${it.id}].icon`, `/items/${i}/icon`, media, it.icon, "Medien-ID");
    if (it?.image) ref(`items[${it.id}].image`, `/items/${i}/image`, media, it.image, "Medien-ID");
  });
  list(g.characters).forEach((c, i) => {
    if (c?.portrait) ref(`characters[${c.id}].portrait`, `/characters/${i}/portrait`, media, c.portrait, "Medien-ID");
  });
  const mediaType = new Map(list(g.media).map((m) => [m?.id, m?.type]));
  // Klänge müssen auf Medien vom Typ audio zeigen.
  const audioRef = (where, path, id) => {
    if (id === undefined) return;
    if (!media.has(id)) push("unknown_media", where, path, `unbekannte Medien-ID „${id}“`, { id, kind: "Medien-ID", audio: true });
    else if (mediaType.get(id) !== "audio") push("not_audio", where, path, `„${id}“ ist kein Audio`, { id, type: mediaType.get(id) });
  };
  const beatRefs = (where, path, beats) => {
    list(beats).forEach((b, i) => {
      if (b?.speaker) ref(where, `${path}/${i}/speaker`, characters, b.speaker, "Figur");
      if (b?.item) ref(where, `${path}/${i}/item`, items, b.item, "Item-ID");
      audioRef(where, `${path}/${i}/audio`, b?.audio);
      audioRef(where, `${path}/${i}/sfx`, b?.sfx);
      if (b?.image) ref(where, `${path}/${i}/image`, media, b.image, "Medien-ID");
    });
  };

  audioRef("sound.ambience", "/sound/ambience/audio", g.sound?.ambience?.audio);
  for (const [k, id] of Object.entries(g.sound?.ui ?? {})) audioRef(`sound.ui.${k}`, `/sound/ui/${key(k)}`, id);
  list(g.story?.chapters).forEach((c, i) => audioRef(`story.chapters[${c?.id}].ambience`, `/story/chapters/${i}/ambience/audio`, c?.ambience?.audio));

  list(g.stations).forEach((s, i) => {
    const where = `stations[${s?.id}]`;
    const path = `/stations/${i}`;
    mediaRefs(`${where}.story`, `${path}/story/media`, s?.story?.media);
    mediaRefs(`${where}.task`, `${path}/task/media`, s?.task?.media);
    beatRefs(`${where}.scene.arrival`, `${path}/scene/arrival`, s?.scene?.arrival);
    beatRefs(`${where}.scene.beats`, `${path}/scene/beats`, s?.scene?.beats);
    beatRefs(`${where}.scene.afterSolve`, `${path}/scene/afterSolve`, s?.scene?.afterSolve);
    audioRef(`${where}.sound.ambience`, `${path}/sound/ambience/audio`, s?.sound?.ambience?.audio);
    for (const [k, id] of Object.entries(s?.sound?.approach ?? {})) audioRef(`${where}.sound.approach.${k}`, `${path}/sound/approach/${key(k)}`, id);
    audioRef(`${where}.sound.solved`, `${path}/sound/solved`, s?.sound?.solved);
    const r = s?.rewards ?? {};
    list(r.fragments).forEach((id, j) => ref(`${where}.rewards`, `${path}/rewards/fragments/${j}`, fragments, id, "Fragment-ID"));
    list(r.items).forEach((id, j) => ref(`${where}.rewards`, `${path}/rewards/items/${j}`, items, id, "Item-ID"));
    list(r.reveal).forEach((id, j) => ref(`${where}.rewards`, `${path}/rewards/reveal/${j}`, stations, id, "Stations-ID"));
    if (r.chapter) ref(`${where}.rewards`, `${path}/rewards/chapter`, chapters, r.chapter, "Kapitel-ID");
    if (!s?.location && list(s?.triggers).some((t) => t?.type === "gps" && !t.location)) {
      push("gps_without_location", where, `${path}/location`, "GPS-Auslöser ohne Ort; Station oder Auslöser braucht location", { station: s.id });
    }
  });

  list(g.rules).forEach((rule, i) => {
    const where = `rules[${rule?.id}]`;
    list(rule?.when).forEach((c, j) => {
      if (c?.station_solved) ref(where, `/rules/${i}/when/${j}/station_solved`, stations, c.station_solved, "Stations-ID");
      if (c?.has_item) ref(where, `/rules/${i}/when/${j}/has_item`, items, c.has_item, "Item-ID");
    });
    const actions = [...list(rule?.then).map((a, j) => [a, `/rules/${i}/then/${j}`]), ...list(rule?.else).map((a, j) => [a, `/rules/${i}/else/${j}`])];
    for (const [a, p] of actions) {
      if (a?.reveal_station) ref(where, `${p}/reveal_station`, stations, a.reveal_station, "Stations-ID");
      if (a?.give_item) ref(where, `${p}/give_item`, items, a.give_item, "Item-ID");
      if (a?.start_chapter) ref(where, `${p}/start_chapter`, chapters, a.start_chapter, "Kapitel-ID");
    }
  });

  // Fragment-Positionen müssen lückenlos 1..n sein.
  const positions = list(g.fragments).map((f) => f?.position).sort((a, b) => a - b);
  if (positions.some((p, i) => p !== i + 1)) {
    push("fragment_gap", "fragments", "/fragments", `Positionen müssen lückenlos 1..${positions.length} sein, gefunden ${positions.join(", ")}`, { positions });
  }

  const finals = list(g.stations).map((s, i) => [s, i]).filter(([s]) => s?.final);
  if (finals.length > 1) push("multiple_finals", "stations", `/stations/${finals[1][1]}/final`, "höchstens eine Finale-Station erlaubt", { stations: finals.map(([s]) => s.id) });
  if (positions.length > 0 && finals.length === 0) push("fragments_without_final", "stations", "/stations", "Fragmente ohne Finale-Station", {});

  // Hinweis auf verwaiste versteckte Stationen.
  const revealed = new Set([
    ...list(g.stations).flatMap((s) => list(s?.rewards?.reveal)),
    ...list(g.rules).flatMap((r) => [...list(r?.then), ...list(r?.else)].map((a) => a?.reveal_station).filter(Boolean)),
  ]);
  const warnings = list(g.stations)
    .map((s, i) => [s, i])
    .filter(([s]) => s?.visibility === "hidden" && !s.revealRadius && !revealed.has(s.id))
    .map(([s, i]) => ({ kind: "reference", code: "hidden_unreachable", where: `stations[${s.id}]`, path: `/stations/${i}/visibility`, message: "versteckt, aber nichts schaltet sie frei (nur durch die Spielleitung erreichbar)", params: { station: s.id } }));

  return { errors, warnings };
}
