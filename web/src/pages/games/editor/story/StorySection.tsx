/**
 * Paket D: Bereich „Geschichte“ (UX §9) – eine Seite mit Sprungleiste: Spielwelt, Anfang und Ende,
 * Kapitel, Figuren. Alles schreibt über den Store in den Entwurf.
 */

import type { SectionProps } from "../sections.ts";
import { Chapters } from "./Chapters.tsx";
import { Characters } from "./Characters.tsx";
import { IntroOutro } from "./IntroOutro.tsx";
import { JumpBar } from "./shared.tsx";
import { World } from "./World.tsx";

const PARTS = [
  { id: "geschichte-welt", title: "Spielwelt" },
  { id: "geschichte-anfang", title: "Anfang und Ende" },
  { id: "geschichte-kapitel", title: "Kapitel" },
  { id: "geschichte-figuren", title: "Figuren" },
];

export function StorySection({ gameId }: SectionProps) {
  return (
    <section class="d-section stack loose" aria-labelledby="bereich-geschichte">
      <header class="stack tight">
        <h2 id="bereich-geschichte" tabIndex={-1}>
          Geschichte
        </h2>
        <JumpBar label="Abschnitte der Geschichte" targets={PARTS} />
      </header>
      <World />
      <IntroOutro />
      <Chapters gameId={gameId} />
      <Characters gameId={gameId} />
    </section>
  );
}
