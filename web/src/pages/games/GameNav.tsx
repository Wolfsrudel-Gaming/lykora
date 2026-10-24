import type { ComponentChildren } from "preact";
import { can } from "../../lib/roles.ts";
import { href, type RouteName } from "../../lib/router.ts";
import { currentOrg } from "../../lib/session.ts";
import { Link } from "../../ui/components.tsx";

/** Unterseiten; Medien und Klänge stehen für Autoren im Baukasten, nicht mehr hier. */
const ITEMS: { route: RouteName; label: string; write?: boolean }[] = [
  { route: "game", label: "Übersicht" },
  { route: "editor", label: "Baukasten", write: true },
  { route: "gameMaterials", label: "Materialliste" },
];

/** Kopf aller Spiel-Seiten mit Pfad und Unterseiten. */
export function GameNav({ gameId, title, current, children }: { gameId: string; title: string; current: RouteName; children?: ComponentChildren }) {
  const write = can(currentOrg()?.role, "game.write");
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
        {ITEMS.filter((i) => write || !i.write).map((i) => (
          <Link key={i.route} to={href(i.route, { gameId })} class="subnav" aria-current={i.route === current ? "page" : undefined}>
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
