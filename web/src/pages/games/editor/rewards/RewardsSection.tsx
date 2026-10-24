/**
 * Paket D: Bereich „Belohnungen“ (UX §10) – Punkte, Finalcode mit Codeteilen und Kopplung des
 * Finales, Gegenstände und Fundstücke.
 */

import type { SectionProps } from "../sections.ts";
import { JumpBar } from "../story/shared.tsx";
import { FinalCodeBuilder } from "./FinalCodeBuilder.tsx";
import { Items } from "./Items.tsx";
import { Points } from "./Points.tsx";
import "./rewards.css";

const PARTS = [
  { id: "belohnungen-punkte", title: "Punkte" },
  { id: "belohnungen-finalcode", title: "Finalcode" },
  { id: "belohnungen-gegenstaende", title: "Gegenstände" },
];

export function RewardsSection({ gameId }: SectionProps) {
  return (
    <section class="d-section stack loose" aria-labelledby="bereich-belohnungen">
      <header class="stack tight">
        <h2 id="bereich-belohnungen" tabIndex={-1}>
          Belohnungen
        </h2>
        <JumpBar label="Abschnitte der Belohnungen" targets={PARTS} />
      </header>
      <Points gameId={gameId} />
      <FinalCodeBuilder gameId={gameId} />
      <Items />
    </section>
  );
}
