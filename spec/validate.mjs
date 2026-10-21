#!/usr/bin/env node
// Prüft Lykora-Spieldateien gegen das JSON-Schema und auf Querverweise.
// Aufruf: node spec/validate.mjs [datei.json ...]
// Ohne Argumente werden alle Beispiele unter spec/*/examples geprüft.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const specDir = dirname(fileURLToPath(import.meta.url));

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function exampleFiles() {
  return readdirSync(specDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(specDir, d.name, "examples"))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(dir, f)),
    );
}

const validators = new Map();
function validatorFor(version) {
  if (!validators.has(version)) {
    const schemaPath = join(specDir, `v${version}`, "game.schema.json");
    if (!existsSync(schemaPath)) return null;
    const ajv = new Ajv2020({ allErrors: true, strict: true, useDefaults: false });
    validators.set(version, ajv.compile(loadJson(schemaPath)));
  }
  return validators.get(version);
}

// Prüfungen, die JSON-Schema nicht ausdrücken kann.
function checkReferences(game) {
  const errors = [];
  const ids = (list) => (list ?? []).map((x) => x.id);

  const unique = (label, list) => {
    const seen = new Set();
    for (const id of list) {
      if (seen.has(id)) errors.push(`${label}: ID „${id}“ ist doppelt`);
      seen.add(id);
    }
    return seen;
  };

  const stations = unique("stations", ids(game.stations));
  const characters = unique("characters", ids(game.characters));
  const fragments = unique("fragments", ids(game.fragments));
  const items = unique("items", ids(game.items));
  const media = unique("media", ids(game.media));
  const chapters = unique("story.chapters", ids(game.story?.chapters));
  unique("rules", ids(game.rules));
  unique("field.restrictedZones", ids(game.field?.restrictedZones));

  const ref = (where, set, id, kind) => {
    if (!set.has(id)) errors.push(`${where}: unbekannte ${kind} „${id}“`);
  };
  const mediaRefs = (where, list) => (list ?? []).forEach((id) => ref(where, media, id, "Medien-ID"));

  mediaRefs("story.intro", game.story?.intro?.media);
  mediaRefs("story.outro", game.story?.outro?.media);
  for (const c of game.story?.chapters ?? []) mediaRefs(`story.chapters[${c.id}]`, c.piece?.media);
  if (game.story?.hq?.avatar) ref("story.hq.avatar", media, game.story.hq.avatar, "Medien-ID");
  for (const i of game.items ?? []) {
    if (i.icon) ref(`items[${i.id}].icon`, media, i.icon, "Medien-ID");
    if (i.image) ref(`items[${i.id}].image`, media, i.image, "Medien-ID");
  }
  for (const c of game.characters ?? []) if (c.portrait) ref(`characters[${c.id}].portrait`, media, c.portrait, "Medien-ID");
  const mediaType = new Map((game.media ?? []).map((m) => [m.id, m.type]));
  // Klänge müssen auf Medien vom Typ audio zeigen.
  const audioRef = (where, id) => {
    if (id === undefined) return;
    if (!media.has(id)) errors.push(`${where}: unbekannte Medien-ID „${id}“`);
    else if (mediaType.get(id) !== "audio") errors.push(`${where}: „${id}“ ist kein Audio`);
  };
  const beatRefs = (where, beats) => {
    for (const b of beats ?? []) {
      if (b.speaker) ref(where, characters, b.speaker, "Figur");
      if (b.item) ref(where, items, b.item, "Item-ID");
      audioRef(where, b.audio);
      audioRef(where, b.sfx);
      if (b.image) ref(where, media, b.image, "Medien-ID");
    }
  };

  audioRef("sound.ambience", game.sound?.ambience?.audio);
  for (const [k, id] of Object.entries(game.sound?.ui ?? {})) audioRef(`sound.ui.${k}`, id);
  for (const c of game.story?.chapters ?? []) audioRef(`story.chapters[${c.id}].ambience`, c.ambience?.audio);

  for (const s of game.stations ?? []) {
    const where = `stations[${s.id}]`;
    mediaRefs(`${where}.story`, s.story?.media);
    mediaRefs(`${where}.task`, s.task?.media);
    beatRefs(`${where}.scene.arrival`, s.scene?.arrival);
    beatRefs(`${where}.scene.beats`, s.scene?.beats);
    beatRefs(`${where}.scene.afterSolve`, s.scene?.afterSolve);
    audioRef(`${where}.sound.ambience`, s.sound?.ambience?.audio);
    for (const [k, id] of Object.entries(s.sound?.approach ?? {})) audioRef(`${where}.sound.approach.${k}`, id);
    audioRef(`${where}.sound.solved`, s.sound?.solved);
    const r = s.rewards ?? {};
    (r.fragments ?? []).forEach((id) => ref(`${where}.rewards`, fragments, id, "Fragment-ID"));
    (r.items ?? []).forEach((id) => ref(`${where}.rewards`, items, id, "Item-ID"));
    (r.reveal ?? []).forEach((id) => ref(`${where}.rewards`, stations, id, "Stations-ID"));
    if (r.chapter) ref(`${where}.rewards`, chapters, r.chapter, "Kapitel-ID");
    if (!s.location && s.triggers.some((t) => t.type === "gps" && !t.location)) {
      errors.push(`${where}: GPS-Auslöser ohne Ort; Station oder Auslöser braucht location`);
    }
  }

  for (const rule of game.rules ?? []) {
    const where = `rules[${rule.id}]`;
    for (const c of rule.when) {
      if (c.station_solved) ref(where, stations, c.station_solved, "Stations-ID");
      if (c.has_item) ref(where, items, c.has_item, "Item-ID");
    }
    for (const a of [...rule.then, ...(rule.else ?? [])]) {
      if (a.reveal_station) ref(where, stations, a.reveal_station, "Stations-ID");
      if (a.give_item) ref(where, items, a.give_item, "Item-ID");
      if (a.start_chapter) ref(where, chapters, a.start_chapter, "Kapitel-ID");
    }
  }

  // Fragment-Positionen müssen lückenlos 1..n sein.
  const positions = (game.fragments ?? []).map((f) => f.position).sort((a, b) => a - b);
  positions.forEach((p, i) => {
    if (p !== i + 1) errors.push(`fragments: Positionen müssen lückenlos 1..${positions.length} sein, gefunden ${positions.join(", ")}`);
  });

  const finals = (game.stations ?? []).filter((s) => s.final);
  if (finals.length > 1) errors.push("stations: höchstens eine Finale-Station erlaubt");
  if (positions.length > 0 && finals.length === 0) errors.push("stations: Fragmente ohne Finale-Station");

  // Hinweis auf verwaiste versteckte Stationen.
  const revealed = new Set([
    ...(game.stations ?? []).flatMap((s) => s.rewards?.reveal ?? []),
    ...(game.rules ?? []).flatMap((r) => [...r.then, ...(r.else ?? [])].map((a) => a.reveal_station).filter(Boolean)),
  ]);
  const warnings = (game.stations ?? [])
    .filter((s) => s.visibility === "hidden" && !s.revealRadius && !revealed.has(s.id))
    .map((s) => `stations[${s.id}]: versteckt, aber nichts schaltet sie frei (nur durch die Spielleitung erreichbar)`);

  return { errors: [...new Set(errors)], warnings };
}

export function validateGame(game) {
  const version = game?.format?.version;
  const validate = validatorFor(version);
  if (!validate) return { errors: [`Unbekannte Formatversion „${version}“`], warnings: [] };
  if (!validate(game)) {
    return {
      errors: validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`),
      warnings: [],
    };
  }
  return checkReferences(game);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : exampleFiles();
  let failed = false;
  for (const file of files) {
    const { errors, warnings } = validateGame(loadJson(file));
    for (const w of warnings) console.warn(`  Warnung: ${w}`);
    if (errors.length) {
      failed = true;
      console.error(`✗ ${file}`);
      for (const e of errors) console.error(`  ${e}`);
    } else {
      console.log(`✓ ${file}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
