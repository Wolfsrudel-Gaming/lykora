#!/usr/bin/env node
// Erzeugt die TypeScript-Typen aus dem JSON-Schema. Aufruf: npm run generate -w @lykora/spec
import { readFileSync, writeFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";

const banner = "/* Automatisch erzeugt aus game.schema.json – nicht von Hand ändern. Neu erzeugen: npm run generate -w @lykora/spec */";

for (const version of ["0.1"]) {
  const dir = new URL(`./v${version}/`, import.meta.url);
  const schema = JSON.parse(readFileSync(new URL("game.schema.json", dir), "utf8"));
  const ts = await compile(schema, "Game", {
    bannerComment: banner,
    additionalProperties: false,
    unreachableDefinitions: true,
    ignoreMinAndMaxItems: true,
    style: { singleQuote: false },
  });
  writeFileSync(new URL("game.d.ts", dir), ts);
  console.log(`v${version}/game.d.ts erzeugt`);
}
