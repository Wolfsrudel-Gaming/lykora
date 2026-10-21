/** Ein Team im Detail: Spielstand, Eingriffe, Betreuer, Sammelpunkt und Aktionsprotokoll. */

import { useEffect, useState } from "preact/hooks";
import type { StaffActionType, TeamPatch } from "../../lib/api.ts";
import { formatAgo, formatBattery, formatClock, formatClockSeconds, formatDateTime, formatDuration, formatSpan, text } from "../../lib/format.ts";
import { itemName, stationName } from "../../lib/game.ts";
import { ACTION_LABELS, detailText, REASON_LABELS, VERDICT_LABELS } from "../../lib/labels.ts";
import { can } from "../../lib/roles.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import { remaining } from "../../lib/time.ts";
import type { EventDto, Game, OverviewTeam, Role, TeamDetail as Detail } from "../../lib/types.ts";
import { ErrorNotice, Field, Loading, TeamDot, confirm, useNow } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export interface DetailUi {
  openRadio: (teamId: string, kind?: "chat" | "hint") => void;
  openSound: (teamId: string) => void;
  close: () => void;
  trackShown: boolean;
  toggleTrack: () => void;
}

type StationStatus = { label: string; cls: string };

function stationStatus(id: string, d: Detail): StationStatus {
  const st = d.state;
  if (st.solved.includes(id)) return { label: "Gelöst", cls: "on" };
  if (st.pendingReviews.includes(id)) return { label: "Prüfung offen", cls: "strong" };
  if (st.locked.includes(id)) return { label: "Gesperrt", cls: "quiet" };
  if (st.triggered.includes(id)) return { label: "Ausgelöst", cls: "strong" };
  return { label: "Offen", cls: "" };
}

export function TeamDetail({
  eventId,
  team,
  event,
  game,
  role,
  tick,
  ui,
}: {
  eventId: string;
  team: OverviewTeam;
  event: EventDto;
  game: Game | null;
  role: Role | undefined;
  tick: number;
  ui: DetailUi;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(5000);

  const load = () =>
    api
      .team(eventId, team.id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch(setError);

  useEffect(() => {
    setDetail(null);
  }, [team.id]);
  useEffect(() => {
    void load();
  }, [team.id, tick]);

  const intervene = can(role, "event.intervene");
  const review = can(role, "event.review");
  const lang = game?.meta.languages[0] ?? "de";

  const patchTeam = async (p: TeamPatch, done: string) => {
    setBusy(true);
    try {
      await api.updateTeam(eventId, team.id, p);
      notify(done, "ok");
      await load();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const staff = async (type: StaffActionType, payload: Record<string, unknown>, note?: string) => {
    setBusy(true);
    try {
      const r = await api.staffAction(eventId, team.id, type, payload, note);
      const o = r.outcome;
      const detail = detailText(type, payload, game);
      if (o && o.status !== "ok") notify(`${team.name}: ${ACTION_LABELS[type]} abgelehnt – ${REASON_LABELS[o.reason ?? "unknown"] ?? o.reason}`, "warn");
      else notify(`${team.name}: ${ACTION_LABELS[type]}${detail ? ` – ${detail}` : ""}`, "ok");
      await load();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const rest = remaining(game, event, { startedAt: team.startedAt, finishedAt: team.finishedAt, timePenalty: team.progress.timePenalty }, now);
  const d = detail;

  return (
    <article class="team-detail stack" aria-labelledby="team-title">
      <header class="row">
        <TeamDot color={team.color} id={team.id} />
        <h2 id="team-title" class="min0 wrap-anywhere">
          {team.name}
        </h2>
        {team.openSos > 0 && <span class="badge safety">SOS</span>}
        <span class="spacer" />
        <button type="button" class="btn small" aria-label="Team schließen" onClick={ui.close}>
          <Icon name="x" />
        </button>
      </header>
      {team.members.length > 0 && <p class="small muted">{team.members.join(", ")}</p>}
      <div class="row">
        {can(role, "event.message") && (
          <>
            <button type="button" class="btn small" onClick={() => ui.openRadio(team.id)}>
              <Icon name="radio" /> Nachricht
            </button>
            <button type="button" class="btn small" onClick={() => ui.openRadio(team.id, "hint")}>
              Hinweis
            </button>
            <button type="button" class="btn small" onClick={() => ui.openSound(team.id)}>
              <Icon name="sound" /> Klang
            </button>
          </>
        )}
        {can(role, "event.positions") && (
          <button type="button" class={`btn small${ui.trackShown ? " primary" : ""}`} aria-pressed={ui.trackShown} onClick={ui.toggleTrack}>
            <Icon name="route" /> Laufspur
          </button>
        )}
      </div>

      <dl class="kv">
        <dt>Punkte</dt>
        <dd class="num">
          {team.progress.points}
          {team.progress.rank !== undefined ? ` · Rang ${team.progress.rank}` : ""}
        </dd>
        <dt>Stationen</dt>
        <dd class="num">
          {team.progress.solved} von {team.progress.stations} gelöst
        </dd>
        {team.progress.totalFragments > 0 && (
          <>
            <dt>Fragmente</dt>
            <dd class="num">
              {team.progress.fragments} von {team.progress.totalFragments}
            </dd>
          </>
        )}
        <dt>Restzeit</dt>
        <dd class="num">{team.finishedAt ? `Im Ziel ${formatClock(team.finishedAt)} Uhr` : rest !== null ? formatDuration(rest) : "–"}</dd>
        <dt>Zeitstrafe</dt>
        <dd class="num">{team.progress.timePenalty ? formatSpan(team.progress.timePenalty) : "keine"}</dd>
        <dt>Hinweise</dt>
        <dd class="num">{team.progress.hintsUsed}</dd>
        {d && (
          <>
            <dt>Falsch</dt>
            <dd class="num">{d.state.wrongAnswers} Antworten</dd>
          </>
        )}
        <dt>Start</dt>
        <dd>{team.startedAt ? `${formatClock(team.startedAt)} Uhr` : "noch nicht"}</dd>
        <dt>Kontakt</dt>
        <dd>{formatAgo(team.lastSeenAt, now)}</dd>
        <dt>Lebenszeichen</dt>
        <dd>{formatAgo(team.lastHeartbeatAt, now)}</dd>
        <dt>Akku</dt>
        <dd>{formatBattery(team.battery)}</dd>
        {team.position && (
          <>
            <dt>Position</dt>
            <dd>
              {formatAgo(team.position.at, now)}
              {team.position.accuracy ? ` · ± ${Math.round(team.position.accuracy)} m` : ""}
            </dd>
          </>
        )}
        <dt>Betreuer</dt>
        <dd>{team.supervisorPresent ? "dabei" : event.supervisorRequired ? "fehlt (Pflicht)" : "nicht bestätigt"}</dd>
        <dt>Sammelpunkt</dt>
        <dd>{team.arrivedAt ? `angekommen ${formatClock(team.arrivedAt)} Uhr` : "–"}</dd>
        {d?.emergencyPhone !== undefined && (
          <>
            <dt>Notfallnummer</dt>
            <dd>
              {d.emergencyPhone ? (
                <a href={`tel:${d.emergencyPhone.replace(/[^+\d]/g, "")}`}>
                  <Icon name="phone" size={14} /> {d.emergencyPhone}
                </a>
              ) : (
                "nicht angegeben"
              )}
            </dd>
          </>
        )}
        {d?.deviceCode && (
          <>
            <dt>Gerätecode</dt>
            <dd class="mono">{d.deviceCode}</dd>
          </>
        )}
      </dl>

      {review && (
        <div class="row">
          {team.supervisorPresent ? (
            <button type="button" class="btn small" disabled={busy} onClick={() => void patchTeam({ supervisorPresent: false }, "Betreuer zurückgenommen")}>
              Betreuer zurücknehmen
            </button>
          ) : (
            <button type="button" class="btn small primary" disabled={busy} onClick={() => void patchTeam({ supervisorPresent: true }, `Betreuer für ${team.name} bestätigt`)}>
              <Icon name="check" /> Betreuer bestätigen
            </button>
          )}
          {team.arrivedAt ? (
            <button type="button" class="btn small" disabled={busy} onClick={() => void patchTeam({ arrived: false }, "Ankunft zurückgenommen")}>
              Ankunft zurücknehmen
            </button>
          ) : (
            <button type="button" class="btn small" disabled={busy} onClick={() => void patchTeam({ arrived: true }, `${team.name} am Sammelpunkt`)}>
              <Icon name="flag" /> Am Sammelpunkt
            </button>
          )}
        </div>
      )}

      <ErrorNotice error={error} retry={() => void load()} />
      {!d && !error && <Loading />}
      {d && game && (
        <section class="stack tight" aria-labelledby="stations-title">
          <h3 id="stations-title">Stationen</h3>
          <table class="table compact">
            <thead>
              <tr>
                <th>Station</th>
                <th>Stand</th>
                <th class="num">Hinweise</th>
              </tr>
            </thead>
            <tbody>
              {game.stations.map((s) => {
                const st = stationStatus(s.id, d);
                const hidden = s.visibility === "hidden" && !d.state.revealed.includes(s.id);
                return (
                  <tr key={s.id}>
                    <td>{text(s.name, lang) || s.id}</td>
                    <td>
                      <span class={`badge ${st.cls}`}>{hidden && st.label === "Offen" ? "Versteckt" : st.label}</span>
                    </td>
                    <td class="num">
                      {d.state.hints[s.id] ?? 0}/{s.hints?.length ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(d.state.items.length > 0 || d.state.fragments.length > 0) && (
            <p class="small">
              {d.state.items.length > 0 && <>Gegenstände: {d.state.items.map((i) => itemName(game, i)).join(", ")}. </>}
              {d.state.fragments.length > 0 && (
                <>Fragmente: {d.state.fragments.map((f) => game.fragments?.find((x) => x.id === f)?.value ?? f).join(" ")}</>
              )}
            </p>
          )}
        </section>
      )}

      {d && game && (intervene || review) && <Interventions game={game} detail={d} intervene={intervene} busy={busy} onAction={staff} />}

      {d && (
        <section class="stack tight" aria-labelledby="actions-title">
          <h3 id="actions-title">Aktionsprotokoll</h3>
          {d.actions.length === 0 ? (
            <p class="small muted">Noch keine Aktionen.</p>
          ) : (
            <ol class="list action-log">
              {[...d.actions].reverse().map((a) => {
                const o = a.outcome;
                const result = o?.verdict ? VERDICT_LABELS[o.verdict] : o && o.status !== "ok" ? (REASON_LABELS[o.reason ?? "unknown"] ?? o.reason) : "";
                return (
                  <li key={a.client_id} class={`action-row${a.source === "staff" ? " staff" : ""}${o && o.status !== "ok" ? " rejected" : ""}`}>
                    <span class="num small muted">{formatClockSeconds(a.client_time)}</span>
                    <span class="min0">
                      <strong>{ACTION_LABELS[a.type] ?? a.type}</strong>
                      {a.source === "staff" && <span class="badge quiet">Leitung</span>} <span class="small">{detailText(a.type, a.payload, game)}</span>
                      {result && <span class="small muted"> · {result}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p class="small muted">Erste Aktion: {d.actions[0] ? formatDateTime(d.actions[0].client_time) : "–"}</p>
        </section>
      )}
    </article>
  );
}

const STATION_ACTIONS: { type: StaffActionType; label: string; review?: boolean }[] = [
  { type: "staff_reveal", label: "Freischalten" },
  { type: "staff_lock", label: "Sperren" },
  { type: "staff_unlock", label: "Entsperren" },
  { type: "staff_solve", label: "Als gelöst werten", review: true },
  { type: "staff_reject", label: "Lösung zurückweisen", review: true },
];

function Interventions({
  game,
  detail,
  intervene,
  busy,
  onAction,
}: {
  game: Game;
  detail: Detail;
  intervene: boolean;
  busy: boolean;
  onAction: (type: StaffActionType, payload: Record<string, unknown>, note?: string) => Promise<void>;
}) {
  const [station, setStation] = useState(game.stations[0]?.id ?? "");
  const [points, setPoints] = useState("");
  const [minutes, setMinutes] = useState("");
  const [timeMode, setTimeMode] = useState<"penalty" | "credit">("penalty");
  const [item, setItem] = useState(game.items?.[0]?.id ?? "");
  const [note, setNote] = useState("");

  const stationAction = async (type: StaffActionType, label: string) => {
    if (type === "staff_solve") {
      const answer = await confirm({
        title: "Als gelöst werten?",
        body: <p>{stationName(game, station)} zählt für das Team als gelöst, mit Punkten und Belohnungen.</p>,
        confirm: label,
      });
      if (!answer.ok) return;
    }
    await onAction(type, { station }, note);
  };

  const hasItem = detail.state.items.includes(item);

  return (
    <section class="stack interventions" aria-labelledby="intervene-title">
      <h3 id="intervene-title">Eingriffe</h3>
      <Field label="Station">
        <select value={station} onChange={(e) => setStation(e.currentTarget.value)}>
          {game.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {stationName(game, s.id)}
            </option>
          ))}
        </select>
      </Field>
      <div class="row">
        {STATION_ACTIONS.filter((a) => intervene || a.review).map((a) => (
          <button key={a.type} type="button" class="btn small" disabled={busy || !station} onClick={() => void stationAction(a.type, a.label)}>
            {a.label}
          </button>
        ))}
      </div>
      {intervene && (
        <>
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              const amount = Number(points);
              if (amount) void onAction("staff_points", { amount }, note).then(() => setPoints(""));
            }}
          >
            <Field label="Punkte (minus zieht ab)">
              <input type="number" step={1} value={points} onInput={(e) => setPoints(e.currentTarget.value)} placeholder="z. B. 50 oder -20" />
            </Field>
            <button type="submit" class="btn small field-btn" disabled={busy || !Number(points)}>
              Punkte buchen
            </button>
          </form>
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              const m = Number(minutes);
              if (m > 0) void onAction("staff_time", { seconds: Math.round(m * 60) * (timeMode === "penalty" ? 1 : -1) }, note).then(() => setMinutes(""));
            }}
          >
            <Field label="Minuten">
              <input type="number" min={0} step={0.5} value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} />
            </Field>
            <Field label="Art">
              <select value={timeMode} onChange={(e) => setTimeMode(e.currentTarget.value as "penalty" | "credit")}>
                <option value="penalty">Zeitstrafe</option>
                <option value="credit">Zeitgutschrift</option>
              </select>
            </Field>
            <button type="submit" class="btn small field-btn" disabled={busy || !(Number(minutes) > 0)}>
              Zeit buchen
            </button>
          </form>
          {(game.items ?? []).length > 0 && (
            <div class="row">
              <Field label="Gegenstand">
                <select value={item} onChange={(e) => setItem(e.currentTarget.value)}>
                  {(game.items ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {itemName(game, i.id)}
                      {detail.state.items.includes(i.id) ? " (hat das Team)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" class="btn small field-btn" disabled={busy || !item || hasItem} onClick={() => void onAction("staff_item", { item }, note)}>
                Geben
              </button>
              <button type="button" class="btn small field-btn" disabled={busy || !item || !hasItem} onClick={() => void onAction("staff_item", { item, remove: true }, note)}>
                Nehmen
              </button>
            </div>
          )}
        </>
      )}
      <Field label="Notiz fürs Logbuch (optional)">
        <input value={note} maxLength={200} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Warum der Eingriff?" />
      </Field>
    </section>
  );
}
