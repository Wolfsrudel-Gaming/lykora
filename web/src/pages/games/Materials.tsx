/** Materialliste zum Packen und Aufbauen, druckfreundlich. */

import { formatDate } from "../../lib/format.ts";
import { api } from "../../lib/session.ts";
import type { MaterialItem } from "../../lib/types.ts";
import { Empty, ErrorNotice, Loading, useLoad, useTitle } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import { GameNav } from "./GameNav.tsx";

const KINDS: Record<string, string> = {
  lock: "Schloss",
  uv_message: "UV-Botschaft",
  puzzle: "Rätsel",
  hidden_object: "Versteckt",
  marker: "Markierung",
  document: "Dokument",
  box: "Box",
  trigger: "Auslöser",
  other: "Sonstiges",
};

export function MaterialsPage({ gameId }: { gameId: string }) {
  const game = useLoad(() => api.game(gameId), [gameId]);
  const materials = useLoad(() => api.materials(gameId), [gameId]);
  useTitle(game.data ? `Material: ${game.data.title}` : "Material");
  if ((game.loading && !game.data) || (materials.loading && !materials.data)) return <div class="page"><Loading /></div>;
  if (!game.data || !materials.data) {
    return (
      <div class="page">
        <ErrorNotice error={game.error ?? materials.error} retry={() => (game.reload(), materials.reload())} />
      </div>
    );
  }
  const g = game.data;
  const { items, teamGear } = materials.data;
  // Nach Station gruppieren, in der Reihenfolge des Spiels.
  const order = g.content.stations.map((s) => s.id);
  const groups = new Map<string, MaterialItem[]>();
  for (const item of [...items].sort((a, b) => order.indexOf(a.station ?? "") - order.indexOf(b.station ?? ""))) {
    const key = item.stationName ?? item.station ?? "Allgemein";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const total = items.reduce((n, i) => n + (i.quantity ?? 1), 0);

  return (
    <div class="page stack loose materials">
      <GameNav gameId={gameId} title={g.title} current="gameMaterials">
        <button type="button" class="btn" onClick={() => window.print()}>
          <Icon name="print" /> Drucken
        </button>
      </GameNav>
      <header class="print-only">
        <h1>Materialliste: {g.title}</h1>
        <p>
          Version {g.latest_version} · gedruckt am {formatDate(Date.now())}
        </p>
      </header>
      <p class="muted">
        {total} Teile an {groups.size} Stationen. Abhaken beim Packen und beim Abbau.
      </p>
      {items.length === 0 ? (
        <Empty>Das Spiel nennt keine Requisiten. Requisiten stehen im Spiel unter stations[].props.</Empty>
      ) : (
        <section class="card">
          <table class="table cards checklist">
            <thead>
              <tr>
                <th>
                  <span class="sr-only">Erledigt</span>
                </th>
                <th>Station</th>
                <th>Material</th>
                <th>Art</th>
                <th class="num">Anzahl</th>
                <th>Notiz</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].flatMap(([station, list]) =>
                list.map((item, i) => (
                  <tr key={`${station}-${i}`}>
                    <td>
                      <input type="checkbox" aria-label={`${item.name} erledigt`} />
                    </td>
                    <td data-label="Station">{i === 0 ? <strong>{station}</strong> : <span class="muted">″</span>}</td>
                    <td data-label="Material">{item.name}</td>
                    <td data-label="Art">{KINDS[item.kind ?? "other"] ?? item.kind}</td>
                    <td data-label="Anzahl" class="num">
                      {item.quantity ?? 1}
                    </td>
                    <td data-label="Notiz" class="mono small">
                      {item.note ?? ""}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}
      {teamGear.length > 0 && (
        <section class="card stack tight">
          <h2>Ausrüstung je Team</h2>
          <ul>
            {teamGear.map((gear) => (
              <li key={gear.name}>{gear.name}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
