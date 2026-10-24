/** Logbuch, live: alles, was im Event passiert, neueste Einträge oben. */

import { useState } from "preact/hooks";
import { formatClockSeconds } from "../../lib/format.ts";
import { detailText, isSafetyLog, logLabel } from "../../lib/labels.ts";
import type { Game, LogEntry, OverviewTeam } from "../../lib/types.ts";
import { Empty, Field } from "../../ui/components.tsx";
import { ExportButton } from "./Standings.tsx";

export function Log({ eventId, log, teams, game }: { eventId: string; log: LogEntry[]; teams: OverviewTeam[]; game: Game | null }) {
  const [team, setTeam] = useState("");
  const [safety, setSafety] = useState(false);
  const [limit, setLimit] = useState(200);
  const list = log.filter((e) => (!team || e.team_id === team) && (!safety || isSafetyLog(e) || e.kind.startsWith("sos"))).reverse();
  return (
    <div class="stack">
      <div class="row">
        <Field label="Team">
          <select value={team} onChange={(e) => setTeam(e.currentTarget.value)}>
            <option value="">Alle</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <label class="check field-btn">
          <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.currentTarget.checked)} />
          Nur Sicherheit
        </label>
        <span class="spacer" />
        <ExportButton eventId={eventId} file="log.csv" label="Logbuch (CSV)" />
      </div>
      {list.length === 0 ? (
        <Empty>Keine Einträge.</Empty>
      ) : (
        <ol class="list log" aria-label="Logbuch">
          {list.slice(0, limit).map((e) => (
            <li key={e.id} class={`log-row${isSafetyLog(e) ? " safety" : ""}`}>
              <span class="num small muted">{formatClockSeconds(e.at)}</span>
              <span class="min0">
                <strong>{logLabel(e.kind)}</strong>
                {e.team_name && <span> · {e.team_name}</span>}
                {e.user_name && <span class="muted"> · {e.user_name}</span>}
                <span class="small"> {detailText(e.kind, e.data, game)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {list.length > limit && (
        <button type="button" class="btn small" onClick={() => setLimit(limit + 300)}>
          Ältere zeigen ({list.length - limit})
        </button>
      )}
    </div>
  );
}
