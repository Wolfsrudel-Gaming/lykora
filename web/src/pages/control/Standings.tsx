/** Rangliste und Export der Ergebnisse. */

import { useState } from "preact/hooks";
import { saveBlob } from "../../lib/download.ts";
import { formatDuration } from "../../lib/format.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import type { OverviewTeam } from "../../lib/types.ts";
import { Empty, ErrorNotice, Loading, TeamDot, useLoad } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export function ExportButton({ eventId, file, label }: { eventId: string; file: "results.csv" | "log.csv"; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      class="btn small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          saveBlob(await api.exportFile(eventId, file), file);
        } catch (err) {
          notify(errorText(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="download" /> {label}
    </button>
  );
}

export function Standings({ eventId, teams, tick }: { eventId: string; teams: OverviewTeam[]; tick: number }) {
  const { data, error, loading, reload } = useLoad(() => api.standings(eventId), [eventId, tick]);
  return (
    <div class="stack">
      <div class="row end">
        <ExportButton eventId={eventId} file="results.csv" label="Ergebnisse (CSV)" />
      </div>
      <ErrorNotice error={error} retry={reload} />
      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>Noch keine Teams.</Empty>
      ) : (
        <table class="table cards standings">
          <thead>
            <tr>
              <th class="num">Platz</th>
              <th>Team</th>
              <th class="num">Punkte</th>
              <th class="num">Stationen</th>
              <th class="num">Fragmente</th>
              <th class="num">Hinweise</th>
              <th>Ziel</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const t = teams.find((x) => x.id === r.teamId);
              return (
                <tr key={r.teamId}>
                  <td class="num rank" data-label="Platz">
                    {r.rank}
                  </td>
                  <td data-label="Team">
                    <span class="row nowrap">
                      {t && <TeamDot color={t.color} id={t.id} />}
                      <strong class="wrap-anywhere">{r.name ?? t?.name ?? "Team"}</strong>
                    </span>
                  </td>
                  <td class="num" data-label="Punkte">
                    {r.points}
                  </td>
                  <td class="num" data-label="Stationen">
                    {r.solved}
                  </td>
                  <td class="num" data-label="Fragmente">
                    {r.fragments}
                  </td>
                  <td class="num" data-label="Hinweise">
                    {r.hintsUsed}
                  </td>
                  <td data-label="Ziel">{r.finished ? (r.finishTime !== null ? formatDuration(r.finishTime) : "ja") : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
