/** Spiel für Spielleitung und Autoren: Übersicht mit Lösungen, Versionen und neue Version. */

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { saveJson } from "../../lib/download.ts";
import { formatDateTime, formatSpan, text } from "../../lib/format.ts";
import { lang as gameLang, penaltyLabel, stationSoundLines, taskSummary, triggerLabel } from "../../lib/game.ts";
import { can } from "../../lib/roles.ts";
import { href, navigate, setQuery, useLocation } from "../../lib/router.ts";
import { api, errorText, notify, roleIn } from "../../lib/session.ts";
import type { Game, GameDetail } from "../../lib/types.ts";
import { ErrorNotice, Link, Loading, Tabs, confirm, useLoad, useTitle } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import { GameNav } from "./GameNav.tsx";
import { GameUpload } from "./GameUpload.tsx";

type Tab = "uebersicht" | "versionen" | "neu";

const MODE = { competitive: "Wettkampf", time_trial: "Zeitfahren", cooperative: "Gemeinsam" } as const;
const WIN = { first_escape: "Wer zuerst im Ziel ist", most_points: "Meiste Punkte", all_fragments_in_time: "Alle Fragmente in der Zeit" } as const;
const LIMIT = { global: "für alle gemeinsam ab Start", per_team: "je Team ab dessen Start", none: "ohne Zeitlimit" } as const;
const BOARD = { live: "live", end_only: "erst am Ende", live_hidden_last_minutes: "live, letzte Minuten verdeckt" } as const;

export function GamePage({ gameId }: { gameId: string }) {
  const { data: game, error, loading, reload } = useLoad(() => api.game(gameId), [gameId]);
  const loc = useLocation();
  useTitle(game?.title ?? "Spiel");
  if (loading && !game) return <div class="page"><Loading /></div>;
  if (!game) return <div class="page"><ErrorNotice error={error} retry={reload} /></div>;
  const role = roleIn(game.org_id);
  const write = can(role, "game.write");
  const tab = (loc.query.get("tab") as Tab | null) ?? "uebersicht";

  const archive = async () => {
    const answer = await confirm({
      title: "Spiel archivieren?",
      body: <p>Das Spiel verschwindet aus der Liste. Events, die es nutzen, laufen weiter.</p>,
      confirm: "Archivieren",
    });
    if (!answer.ok) return;
    try {
      await api.archiveGame(gameId);
      notify(`„${game.title}“ archiviert`, "ok");
      navigate(href("games"));
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  return (
    <div class="page stack loose">
      <GameNav gameId={gameId} title={game.title} current="game">
        <span class="badge strong">Version {game.latest_version}</span>
      </GameNav>
      <div class="row no-print">
        {can(role, "event.manage") && (
          <Link to={href("eventNew", {}, { spiel: gameId })} class="btn primary">
            <Icon name="plus" /> Event aus diesem Spiel
          </Link>
        )}
        <button type="button" class="btn" onClick={() => saveJson(game.content, `${game.content.id}-v${game.latest_version}.json`)}>
          <Icon name="download" /> JSON herunterladen
        </button>
        {write && !game.archived && (
          <button type="button" class="btn" onClick={() => void archive()}>
            Archivieren
          </button>
        )}
      </div>
      <Tabs
        label="Ansicht"
        value={tab}
        onChange={(t) => setQuery({ tab: t === "uebersicht" ? null : t })}
        tabs={[
          { id: "uebersicht", label: "Inhalt" },
          { id: "versionen", label: "Versionen", count: game.versions.length },
          ...(write ? [{ id: "neu" as const, label: "Neue Version" }] : []),
        ]}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "uebersicht" && <Overview game={game.content} gameId={gameId} />}
        {tab === "versionen" && <Versions game={game} write={write} onChanged={reload} />}
        {tab === "neu" && write && <NewVersion gameId={gameId} expectId={game.content.id} onSaved={reload} />}
      </div>
    </div>
  );
}

/** Neue Version als Datei oder eingefügt; laufende Events behalten ihre. */
function NewVersion({ gameId, expectId, onSaved }: { gameId: string; expectId: string; onSaved: () => void }) {
  return (
    <section class="card stack" aria-label="Neue Version hochladen">
      <p class="small muted">Laufende und geplante Events behalten ihre Version. Neue Events nutzen die neueste.</p>
      <GameUpload
        submitLabel="Als neue Version speichern"
        expectId={expectId}
        onSave={async (content, comment) => {
          const v = await api.saveVersion(gameId, content, comment || undefined);
          notify(`Version ${v.version} gespeichert`, "ok");
          setQuery({ tab: null });
          onSaved();
        }}
      />
    </section>
  );
}

function Versions({ game, write, onChanged }: { game: GameDetail; write: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const download = async (version: number) => {
    setBusy(version);
    try {
      const v = await api.gameVersion(game.id, version);
      saveJson(v.content, `${v.content.id}-v${version}.json`);
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const restore = async (version: number) => {
    const answer = await confirm({
      title: `Version ${version} wiederherstellen?`,
      body: <p>Der Inhalt von Version {version} wird als neue Version {(game.latest_version ?? 0) + 1} gespeichert. Nichts geht verloren.</p>,
      confirm: "Wiederherstellen",
    });
    if (!answer.ok) return;
    setBusy(version);
    try {
      const v = await api.gameVersion(game.id, version);
      const saved = await api.saveVersion(game.id, v.content, `Wiederhergestellt aus Version ${version}`);
      notify(`Version ${version} als Version ${saved.version} wiederhergestellt`, "ok");
      onChanged();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section class="card">
      <table class="table cards">
        <thead>
          <tr>
            <th>Version</th>
            <th>Gespeichert</th>
            <th>Von</th>
            <th>Kommentar</th>
            <th>
              <span class="sr-only">Aktionen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {game.versions.map((v) => (
            <tr key={v.version}>
              <td data-label="Version" class="num">
                {v.version}{" "}
                {v.version === game.latest_version && <span class="badge on">neueste</span>}
              </td>
              <td data-label="Gespeichert">{formatDateTime(v.created_at)}</td>
              <td data-label="Von">{v.created_by ?? "–"}</td>
              <td data-label="Kommentar">{v.comment ?? ""}</td>
              <td class="num">
                <div class="row end">
                  <button type="button" class="btn small" disabled={busy !== null} onClick={() => void download(v.version)}>
                    <Icon name="download" /> JSON
                  </button>
                  {write && v.version !== game.latest_version && (
                    <button type="button" class="btn small" disabled={busy !== null} onClick={() => void restore(v.version)}>
                      Wiederherstellen
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Übersicht für die Spielleitung: alles Wichtige ohne JSON, mit Lösungen. */
export function Overview({ game, gameId }: { game: Game; gameId: string }) {
  const l = gameLang(game);
  const set = game.settings;
  const safety = game.safety;
  const audio = (id: string | undefined) => (id ? `„${id}“` : "–");
  const finalCode = [...(game.fragments ?? [])].sort((a, b) => a.position - b.position);
  return (
    <div class="stack loose">
      <section class="grid-2">
        <div class="card stack tight">
          <h2>Spiel</h2>
          {game.meta.summary && <p>{text(game.meta.summary, l)}</p>}
          <dl class="kv">
            <dt>Spiel-ID</dt>
            <dd class="mono">{game.id}</dd>
            <dt>Sprachen</dt>
            <dd>{game.meta.languages.join(", ")}</dd>
            {game.meta.ageGroups && (
              <>
                <dt>Alter</dt>
                <dd>{game.meta.ageGroups.map((a) => (a === "adult" ? "Erwachsene" : `${a} Jahre`)).join(", ")}</dd>
              </>
            )}
            {game.meta.expectedDuration && (
              <>
                <dt>Dauer</dt>
                <dd>etwa {formatSpan(game.meta.expectedDuration)}</dd>
              </>
            )}
            <dt>Nacht</dt>
            <dd>{game.meta.night ? "ja" : "nein"}</dd>
            {game.meta.scareLevel !== undefined && (
              <>
                <dt>Grusel</dt>
                <dd>Stufe {game.meta.scareLevel} von 3</dd>
              </>
            )}
            {game.meta.authors && (
              <>
                <dt>Autoren</dt>
                <dd>{game.meta.authors.join(", ")}</dd>
              </>
            )}
            {game.meta.license && (
              <>
                <dt>Lizenz</dt>
                <dd>{game.meta.license}</dd>
              </>
            )}
          </dl>
        </div>
        <div class="card stack tight">
          <h2>Regeln</h2>
          <dl class="kv">
            <dt>Modus</dt>
            <dd>{MODE[set.mode ?? "competitive"]}</dd>
            <dt>Sieg</dt>
            <dd>{WIN[set.winCondition ?? "first_escape"]}</dd>
            <dt>Zeit</dt>
            <dd>
              {set.time?.duration ? `${formatSpan(set.time.duration)}, ` : ""}
              {LIMIT[set.time?.limit ?? "per_team"]}
            </dd>
            <dt>Falsche Antwort</dt>
            <dd>{penaltyLabel(set.wrongAnswer)}</dd>
            <dt>Hinweise</dt>
            <dd>{set.hints?.enabled === false ? "aus" : (set.hints?.defaultCost ?? []).map((c, i) => `${i + 1}: ${penaltyLabel(c)}`).join(" · ") || "ohne Kosten"}</dd>
            <dt>Rangliste</dt>
            <dd>{BOARD[set.leaderboard ?? "live"]}</dd>
            {set.teamSize && (
              <>
                <dt>Teamgröße</dt>
                <dd>
                  {set.teamSize.min ?? 1} bis {set.teamSize.max ?? "beliebig"}
                </dd>
              </>
            )}
          </dl>
        </div>
      </section>

      <section class="card stack tight">
        <h2>Sicherheit</h2>
        <dl class="kv">
          <dt>Spielleitung</dt>
          <dd>
            <a href={`tel:${safety.emergency.gameMasterPhone.replace(/[^+\d]/g, "")}`}>{safety.emergency.gameMasterPhone}</a>
          </dd>
          <dt>Notruf</dt>
          <dd>{safety.emergency.emergencyNumber ?? "112"}</dd>
          {safety.sos?.smsFallback && (
            <>
              <dt>SOS per SMS</dt>
              <dd>{safety.sos.smsFallback}</dd>
            </>
          )}
          <dt>Lebenszeichen</dt>
          <dd>{safety.heartbeat?.enabled === false ? "aus" : `alle ${formatSpan(safety.heartbeat?.interval ?? 900)}, Nachfrist ${formatSpan(safety.heartbeat?.grace ?? 300)}`}</dd>
          <dt>Betreuer</dt>
          <dd>{safety.requireSupervisor === false ? "keine Pflicht" : "Pflicht bei Minderjährigen"}</dd>
          {safety.requiredGear?.length ? (
            <>
              <dt>Ausrüstung</dt>
              <dd>{safety.requiredGear.map((g) => text(g, l)).join(", ")}</dd>
            </>
          ) : null}
          <dt>Sammelpunkt</dt>
          <dd>{text(game.field.assemblyPoint.name, l) || "ohne Namen"}</dd>
          {game.field.restrictedZones?.length ? (
            <>
              <dt>Sperrzonen</dt>
              <dd>{game.field.restrictedZones.map((z) => text(z.name, l) || z.id).join(", ")}</dd>
            </>
          ) : null}
          {game.field.rescuePoints?.length ? (
            <>
              <dt>Rettungspunkte</dt>
              <dd>{game.field.rescuePoints.map((r) => text(r.name, l) || r.id).join(", ")}</dd>
            </>
          ) : null}
          {safety.emergency.notes && (
            <>
              <dt>Notizen</dt>
              <dd>{text(safety.emergency.notes, l)}</dd>
            </>
          )}
        </dl>
      </section>

      <section class="card stack tight">
        <h2>Klang</h2>
        <dl class="kv">
          <dt>Atmosphäre</dt>
          <dd>
            {audio(game.sound?.ambience?.audio)}
            {game.sound?.ambience?.volume !== undefined ? ` · ${Math.round(game.sound.ambience.volume * 100)} %` : ""}
          </dd>
          {(game.story?.chapters ?? []).map((c) => (
            <Fragment key={c.id}>
              <dt>Kapitel</dt>
              <dd>
                {text(c.title, l) || c.id}: {audio(c.ambience?.audio)}
              </dd>
            </Fragment>
          ))}
          {Object.entries(game.sound?.ui ?? {}).map(([k, v]) => (
            <Fragment key={k}>
              <dt>App: {k}</dt>
              <dd>{audio(v)}</dd>
            </Fragment>
          ))}
        </dl>
        <p class="small muted">
          {(game.media ?? []).filter((m) => m.type === "audio").length} Klänge im Spiel. <Link to={href("gameSound", { gameId })}>Klänge zuordnen</Link>
        </p>
      </section>

      <section class="stack" aria-labelledby="stations-title">
        <h2 id="stations-title">Stationen ({game.stations.length})</h2>
        {game.stations.map((s, i) => {
          const task = s.task ? taskSummary(s.task, l) : null;
          const sounds = stationSoundLines(s);
          return (
            <article key={s.id} class="card station-card">
              <header>
                <span class="badge strong num">{s.final ? "Finale" : i + 1}</span>
                <h3>{text(s.name, l) || s.id}</h3>
                <span class="mono small muted">{s.id}</span>
                {s.visibility === "hidden" && <span class="badge quiet">versteckt</span>}
                {s.offPath && <span class="badge">abseits</span>}
              </header>
              <div class="chips">
                {s.triggers.map((t, j) => (
                  <span key={j} class="chip">
                    {triggerLabel(t)}
                  </span>
                ))}
              </div>
              {task && (
                <dl class="kv">
                  <dt>Aufgabe</dt>
                  <dd>
                    <span class="muted">{task.kind}:</span> {task.question}
                  </dd>
                  {task.solution.length > 0 && (
                    <>
                      <dt>Lösung</dt>
                      <dd class="solution">{task.solution.join(" · ")}</dd>
                    </>
                  )}
                </dl>
              )}
              {s.hints?.length ? (
                <ol class="small">
                  {s.hints.map((h, j) => (
                    <li key={j}>
                      {text(h.text, l)} <span class="muted">({penaltyLabel(h.cost ?? set.hints?.defaultCost?.[j])})</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {s.rewards && (
                <p class="small">
                  Belohnung: {s.rewards.points ?? set.scoring?.solvePoints ?? 100} Punkte
                  {s.rewards.fragments?.length ? ` · Fragment ${s.rewards.fragments.join(", ")}` : ""}
                  {s.rewards.items?.length ? ` · ${s.rewards.items.join(", ")}` : ""}
                  {s.rewards.reveal?.length ? ` · schaltet frei: ${s.rewards.reveal.join(", ")}` : ""}
                  {s.rewards.chapter ? ` · Kapitel ${s.rewards.chapter}` : ""}
                </p>
              )}
              {sounds.length > 0 && (
                <p class="small">
                  <Icon name="sound" size={14} /> {sounds.join(" · ")}
                </p>
              )}
              {s.props?.length ? <p class="small">Material: {s.props.map((p) => `${p.quantity ?? 1}× ${p.name}`).join(", ")}</p> : null}
              {s.notes && <p class="small notice">{s.notes}</p>}
            </article>
          );
        })}
      </section>

      {finalCode.length > 0 && (
        <section class="card stack tight">
          <h2>Finalcode</h2>
          <p class="solution join-code" style={{ fontSize: "40px" }}>
            {finalCode.map((f) => f.value).join("")}
          </p>
          <p class="small muted">Fragmente in Reihenfolge: {finalCode.map((f) => `${f.position}: ${f.value}`).join(" · ")}</p>
        </section>
      )}

      {game.characters?.length ? (
        <section class="card stack tight">
          <h2>Figuren</h2>
          <dl class="kv">
            {game.characters.map((c) => (
              <Fragment key={c.id}>
                <dt>{text(c.name, l)}</dt>
                <dd>
                  {c.kind === "hq" ? "Zentrale" : c.kind === "narrator" ? "Erzähler" : "Figur"}
                  {c.description ? ` – ${text(c.description, l)}` : ""}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
