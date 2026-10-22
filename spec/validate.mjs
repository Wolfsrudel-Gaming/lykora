#!/usr/bin/env node
// Prüft Lykora-Spieldateien gegen das JSON-Schema und auf Querverweise.
// Aufruf: node spec/validate.mjs [datei.json ...]
// Ohne Argumente werden alle Beispiele unter spec/*/examples geprüft.
// Die Prüfung selbst steckt in validate-core.mjs (ohne node:fs, auch für den Browser); hier kommen
// Schemas von der Platte und die Kommandozeile dazu.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createValidator, toLegacy } from "./validate-core.mjs";

export { createValidator, checkReferences, formatIssue, toLegacy } from "./validate-core.mjs";

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

// Schemas aller Formatversionen: spec/v<version>/game.schema.json → { "<version>": schema }
function schemasFromDisk() {
  const schemas = {};
  for (const d of readdirSync(specDir, { withFileTypes: true })) {
    const schemaPath = join(specDir, d.name, "game.schema.json");
    if (d.isDirectory() && d.name.startsWith("v") && existsSync(schemaPath)) schemas[d.name.slice(1)] = loadJson(schemaPath);
  }
  return schemas;
}

let detailed = null;

/** Ergebnis als Zeichenketten wie bisher; strukturierte Meldungen liefert createValidator aus validate-core.mjs. */
export function validateGame(game) {
  detailed ??= createValidator(schemasFromDisk());
  return toLegacy(detailed(game));
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
