/** Sicherheitsfelder ganz oben im Leitstand: offene SOS und laufender Rückruf. */

import { useState } from "preact/hooks";
import { formatAgo, formatClock, formatCoord, text } from "../../lib/format.ts";
import { can } from "../../lib/roles.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import type { EventDto, Game, OverviewTeam, Role, Sos } from "../../lib/types.ts";
import { TeamDot, useNow } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

const CHANNELS: Record<Sos["channel"], string> = { app: "App", deferred: "App, nachgereicht", sms: "SMS", lora: "LoRa" };

export function SosPanel({
  sos,
  teams,
  role,
  eventId,
  onChanged,
  onFocus,
  onOpenTeam,
}: {
  sos: Sos[];
  teams: OverviewTeam[];
  role: Role | undefined;
  eventId: string;
  onChanged: () => void;
  onFocus?: (lat: number, lon: number) => void;
  onOpenTeam?: (teamId: string) => void;
}) {
  const now = useNow(15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const open = sos.filter((s) => !s.resolved_at);
  if (!open.length) return null;
  const review = can(role, "event.review");

  const act = async (s: Sos, action: "ack" | "resolve") => {
    setBusy(s.id + action);
    try {
      await api.sosAction(eventId, s.id, action);
      notify(action === "ack" ? `SOS von ${s.team_name} bestätigt` : `SOS von ${s.team_name} erledigt`, "ok");
      onChanged();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="safety-box sos-panel" aria-labelledby="sos-title" role="alert">
      <h2 id="sos-title" class="safety-title">
        SOS · {open.length} offen
      </h2>
      <ul class="list sos-list">
        {open.map((s) => {
          const team = teams.find((t) => t.id === s.team_id);
          return (
            <li key={s.id} class="sos-item">
              <div class="sos-main min0">
                <div class="row">
                  {team && <TeamDot color={team.color} id={team.id} />}
                  <strong class="sos-team">{s.team_name}</strong>
                  <span class={`badge ${s.acknowledged_at ? "strong" : "safety"}`}>{s.acknowledged_at ? "Bestätigt" : "Neu"}</span>
                  <span class="small">
                    {formatClock(s.client_time)} Uhr · {formatAgo(s.client_time, now)} · {CHANNELS[s.channel]}
                  </span>
                </div>
                {s.message && <p class="sos-message">„{s.message}“</p>}
                <div class="row small">
                  {s.lat !== null && s.lon !== null ? (
                    <>
                      {onFocus && (
                        <button type="button" class="btn small" onClick={() => onFocus(s.lat!, s.lon!)}>
                          <Icon name="pin" /> Auf der Karte
                        </button>
                      )}
                      <a class="btn small" href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=18/${s.lat}/${s.lon}`} target="_blank" rel="noopener">
                        {formatCoord(s.lat, s.lon)}
                        {s.accuracy ? ` ± ${Math.round(s.accuracy)} m` : ""}
                      </a>
                    </>
                  ) : (
                    <span>Ohne Position</span>
                  )}
                  {s.emergency_phone && (
                    <a class="btn small" href={`tel:${s.emergency_phone.replace(/[^+\d]/g, "")}`}>
                      <Icon name="phone" /> {s.emergency_phone}
                    </a>
                  )}
                  {onOpenTeam && (
                    <button type="button" class="btn small" onClick={() => onOpenTeam(s.team_id)}>
                      Team öffnen
                    </button>
                  )}
                </div>
                {s.acknowledged_at && (
                  <p class="small">
                    Bestätigt {s.acknowledged_by_name ? `von ${s.acknowledged_by_name} ` : ""}um {formatClock(s.acknowledged_at)} Uhr
                  </p>
                )}
              </div>
              {review && (
                <div class="sos-actions">
                  {!s.acknowledged_at && (
                    <button type="button" class="btn safety" disabled={!!busy} onClick={() => void act(s, "ack")}>
                      Bestätigen
                    </button>
                  )}
                  <button type="button" class="btn" disabled={!!busy} onClick={() => void act(s, "resolve")}>
                    <Icon name="check" /> Erledigt
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RecallBanner({ event, game, teams }: { event: EventDto; game: Game | null; teams: OverviewTeam[] }) {
  if (event.status !== "recalled") return null;
  const arrived = teams.filter((t) => t.arrivedAt);
  const missing = teams.filter((t) => !t.arrivedAt);
  const point = game ? text(game.field.assemblyPoint.name, game.meta.languages[0] ?? "de") : "";
  return (
    <section class="safety-box recall" aria-labelledby="recall-title" role="status">
      <h2 id="recall-title" class="safety-title">
        Rückruf aktiv{point ? ` · ${point}` : ""}
      </h2>
      <p>
        <strong>
          {arrived.length} von {teams.length}
        </strong>{" "}
        Teams am Sammelpunkt.
        {missing.length > 0 && <> Unterwegs: {missing.map((t) => t.name).join(", ")}.</>}
      </p>
    </section>
  );
}
