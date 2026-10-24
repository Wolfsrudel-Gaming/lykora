/** Offene Foto-Prüfungen: Bild oder Video des Teams ansehen, freigeben oder ablehnen. */

import { useEffect, useRef, useState } from "preact/hooks";
import { latestUpload } from "../../lib/api.ts";
import { lang, stationName, taskSummary } from "../../lib/game.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import type { Game, OverviewTeam } from "../../lib/types.ts";
import { Empty, Loading, TeamDot } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export interface PendingReview {
  teamId: string;
  stationId: string;
}

/** Offene Prüfungen aus den Warnungen der Übersicht. */
export function pendingReviews(teams: OverviewTeam[]): PendingReview[] {
  return teams.flatMap((t) => t.warnings.filter((w) => w.kind === "review_pending" && w.stationId).map((w) => ({ teamId: t.id, stationId: w.stationId! })));
}

export function Reviews({
  eventId,
  game,
  teams,
  canReview,
  uploadTick,
  onDone,
}: {
  eventId: string;
  game: Game | null;
  teams: OverviewTeam[];
  canReview: boolean;
  uploadTick: number;
  onDone: () => void;
}) {
  const list = pendingReviews(teams);
  if (!canReview) return <p class="notice">Prüfen dürfen Spielleitung und Betreuer.</p>;
  if (!list.length) return <Empty>Keine offenen Prüfungen.</Empty>;
  return (
    <div class="stack reviews">
      {list.map((r) => {
        const team = teams.find((t) => t.id === r.teamId)!;
        return <ReviewCard key={`${r.teamId}-${r.stationId}`} eventId={eventId} game={game} team={team} stationId={r.stationId} uploadTick={uploadTick} onDone={onDone} />;
      })}
    </div>
  );
}

function ReviewCard({
  eventId,
  game,
  team,
  stationId,
  uploadTick,
  onDone,
}: {
  eventId: string;
  game: Game | null;
  team: OverviewTeam;
  stationId: string;
  uploadTick: number;
  onDone: () => void;
}) {
  const [media, setMedia] = useState<{ upload: string; url: string; type: string } | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const current = useRef(media);
  current.current = media;

  // Die Bildadresse gilt, bis die Karte verschwindet oder eine neuere Datei kommt.
  useEffect(() => () => void (current.current && URL.revokeObjectURL(current.current.url)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const detail = await api.team(eventId, team.id);
      if (!alive) return;
      // Textaufgaben mit Prüfung von Hand haben eine Antwort statt einer Datei.
      const last = [...detail.actions].reverse().find((a) => a.type === "answer" && a.payload.station === stationId);
      const typed = typeof last?.payload.text === "string" ? last.payload.text : null;
      setAnswer(typed);
      const upload = latestUpload(detail.actions, stationId);
      // Neue Uploads anderer Teams lösen auch hier ein Nachladen aus; die eigene Datei bleibt dann stehen.
      if (upload && upload === current.current?.upload) return setState("ready");
      if (!upload) return setState(typed !== null ? "ready" : "missing");
      try {
        const blob = await api.upload(eventId, upload);
        if (!alive) return;
        if (current.current) URL.revokeObjectURL(current.current.url);
        setMedia({ upload, url: URL.createObjectURL(blob), type: blob.type });
        setState("ready");
      } catch {
        // Die Antwort kam offline, die Datei folgt beim nächsten Netz.
        if (alive) setState(typed !== null ? "ready" : "missing");
      }
    })().catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [eventId, team.id, stationId, uploadTick]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api.staffAction(eventId, team.id, approve ? "staff_solve" : "staff_reject", { station: stationId });
      notify(approve ? `${stationName(game, stationId)} für ${team.name} freigegeben` : `Lösung von ${team.name} abgelehnt`, "ok");
      onDone();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const station = game?.stations.find((s) => s.id === stationId);
  const task = station?.task ? taskSummary(station.task, lang(game)) : null;

  return (
    <article class="card review stack tight" aria-label={`Prüfung ${team.name}, ${stationName(game, stationId)}`}>
      <header class="row">
        <TeamDot color={team.color} id={team.id} />
        <strong>{team.name}</strong>
        <span class="muted">· {stationName(game, stationId)}</span>
      </header>
      {task && (
        <p class="small">
          <span class="muted">{task.kind}:</span> {task.question}
        </p>
      )}
      <div class="review-media">
        {state === "loading" && <Loading text="Lade Foto …" />}
        {state === "missing" && (
          <p class="small muted">
            <Icon name="camera" size={14} /> Datei noch nicht angekommen. Sie erscheint, sobald das Handy des Teams wieder Netz hat.
          </p>
        )}
        {answer !== null && <p class="review-answer">„{answer}“</p>}
        {state === "error" && <p class="small notice">Foto konnte nicht geladen werden.</p>}
        {state === "ready" && media && <ReviewMedia url={media.url} type={media.type} label={`${team.name} zu ${stationName(game, stationId)}`} />}
      </div>
      <div class="row">
        <button type="button" class="btn primary" disabled={busy} onClick={() => void decide(true)}>
          <Icon name="check" /> Freigeben
        </button>
        <button type="button" class="btn" disabled={busy} onClick={() => void decide(false)}>
          <Icon name="x" /> Ablehnen
        </button>
      </div>
    </article>
  );
}

/** Datei des Teams: Foto, Video oder Sprachaufnahme. */
function ReviewMedia({ url, type, label }: { url: string; type: string; label: string }) {
  if (type.startsWith("video/")) return <video src={url} controls playsInline aria-label={`Video von ${label}`} />;
  if (type.startsWith("audio/")) return <audio src={url} controls aria-label={`Aufnahme von ${label}`} />;
  return <img src={url} alt={`Foto von ${label}`} />;
}
