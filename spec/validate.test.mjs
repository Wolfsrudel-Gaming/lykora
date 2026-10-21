import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateGame } from "./validate.mjs";

const example = () =>
  JSON.parse(readFileSync(new URL("./v0.1/examples/testspiel.json", import.meta.url), "utf8"));

test("Beispielspiel ist gültig", () => {
  assert.deepEqual(validateGame(example()).errors, []);
});

test("unbekannte Formatversion wird abgelehnt", () => {
  const game = example();
  game.format.version = "9.9";
  assert.match(validateGame(game).errors[0], /Formatversion/);
});

test("Station ohne Auslöser verletzt das Schema", () => {
  const game = example();
  game.stations[0].triggers = [];
  assert.ok(validateGame(game).errors.length > 0);
});

test("unbekanntes Feld verletzt das Schema", () => {
  const game = example();
  game.stations[0].colour = "rot";
  assert.ok(validateGame(game).errors.length > 0);
});

test("Verweis auf unbekanntes Fragment wird gemeldet", () => {
  const game = example();
  game.stations[1].rewards.fragments = ["f99"];
  assert.ok(validateGame(game).errors.some((e) => e.includes("f99")));
});

test("doppelte Stations-ID wird gemeldet", () => {
  const game = example();
  game.stations[1].id = "briefing";
  assert.ok(validateGame(game).errors.some((e) => e.includes("doppelt")));
});

test("Lücke in den Fragment-Positionen wird gemeldet", () => {
  const game = example();
  game.fragments[2].position = 4;
  assert.ok(validateGame(game).errors.some((e) => e.includes("lückenlos")));
});

test("Regel auf unbekannte Station wird gemeldet", () => {
  const game = example();
  game.rules[0].then[0].reveal_station = "gibtsnicht";
  assert.ok(validateGame(game).errors.some((e) => e.includes("gibtsnicht")));
});

test("versteckte Station ohne Freischaltung erzeugt eine Warnung", () => {
  const game = example();
  game.rules = [];
  const { errors, warnings } = validateGame(game);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("versteck")));
});

test("Szene mit unbekannter Figur wird gemeldet", () => {
  const game = example();
  game.stations[1].scene.arrival[0].speaker = "niemand";
  assert.ok(validateGame(game).errors.some((e) => e.includes("niemand")));
});
