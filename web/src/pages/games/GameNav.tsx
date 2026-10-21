import type { ComponentChildren } from "preact";
import { href, type RouteName } from "../../lib/router.ts";
import { Link } from "../../ui/components.tsx";

const ITEMS: { route: RouteName; label: string }[] = [
  { route: "game", label: "Übersicht" },
  { route: "gameMedia", label: "Medien und Klänge" },
  { route: "gameSound", label: "Klänge zuordnen" },
  { route: "gameMaterials", label: "Materialliste" },
];

/** Kopf aller Spiel-Seiten mit Pfad und Unterseiten. */
export function GameNav({ gameId, title, current, children }: { gameId: string; title: string; current: RouteName; children?: ComponentChildren }) {
  return (
    <div class="stack no-print">
      <nav class="crumbs" aria-label="Pfad">
        <Link to={href("games")}>Spiele</Link>
      </nav>
      <div class="page-head">
        <h1>{title}</h1>
        {children}
      </div>
      <nav class="tabs" aria-label="Spiel">
        {ITEMS.map((i) => (
          <Link key={i.route} to={href(i.route, { gameId })} class="subnav" aria-current={i.route === current ? "page" : undefined}>
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
