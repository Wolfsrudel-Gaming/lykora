import type { LykoraSpielformatV01 } from "./v0.1/game.js";

export type * from "./v0.1/game.js";

/** Ein Spiel im Lykora-Spielformat. */
export type Game = LykoraSpielformatV01;

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateGame(game: unknown): ValidationResult;
