import { useEffect, useState } from "preact/hooks";
import { formatDateTime, fromLocalInput } from "../lib/format.ts";
import { href, navigate, useLocation } from "../lib/router.ts";
import { can } from "../lib/roles.ts";
import { api, errorText, notify, roleIn, session } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import type { GameDetail } from "../lib/types.ts";
import { Empty, ErrorNotice, Field, Link, Loading, useLoad, useTitle } from "../ui/components.tsx";

export const RETENTION_HINT = "So viele Tage nach dem Ende löscht der Server Positionen, Fotos, Vornamen und Notfallnummern. Ergebnisse und Logbuch bleiben.";

export function EventNewPage() {
  useTitle("Event anlegen");
  const s = useStore(session);
  const loc = useLocation();
  const games = useLoad(() => (s.orgId ? api.games(s.orgId) : Promise.resolve([])), [s.orgId]);
  const [gameId, setGameId] = useState(loc.query.get("spiel") ?? "");
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [retention, setRetention] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = (games.data ?? []).filter((g) => !g.archived);
  // Spiele ohne veröffentlichte Version stehen ausgegraut da (Entwürfe und Probeläufe sind keine Version).
  const ready = active.filter((g) => g.latest_version !== null);
  const chosen = active.find((g) => g.id === gameId);

  useEffect(() => {
    if (!gameId && ready[0]) setGameId(ready[0].id);
  }, [games.data]);

  useEffect(() => {
    setDetail(null);
    setVersion("");
    if (!gameId || chosen?.latest_version === null) return;
    let alive = true;
    api
      .game(gameId)
      .then((g) => {
        if (!alive) return;
        setDetail(g);
        setVersion(String(g.latest_version ?? ""));
        setName((n) => n || g.title);
      })
      .catch((err) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [gameId]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!s.orgId) return;
    setBusy(true);
    setError(null);
    try {
      const event = await api.createEvent(s.orgId, {
        gameId,
        version: version ? Number(version) : undefined,
        name: name.trim(),
        scheduledAt: fromLocalInput(when) ?? undefined,
        retentionDays: Number(retention) || 30,
      });
      notify(`Event „${event.name}“ angelegt`, "ok");
      navigate(href("event", { eventId: event.id }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page narrow stack loose">
      <div>
        <nav class="crumbs" aria-label="Pfad">
          <Link to={href("events")}>Events</Link>
        </nav>
        <h1>Event anlegen</h1>
      </div>
      <ErrorNotice error={games.error} retry={games.reload} />
      {games.loading && !games.data ? (
        <Loading />
      ) : active.length === 0 ? (
        <Empty>
          Es gibt noch kein Spiel. <Link to={href("games")}>Zu den Spielen</Link>
        </Empty>
      ) : (
        <form class="card stack" onSubmit={submit}>
          <Field label="Spiel">
            <select required value={gameId} onChange={(e) => setGameId(e.currentTarget.value)}>
              {active.map((g) => (
                <option key={g.id} value={g.id} disabled={g.latest_version === null}>
                  {g.title}
                  {g.latest_version === null ? " – erst veröffentlichen" : ""}
                </option>
              ))}
            </select>
          </Field>
          {chosen?.latest_version === null && (
            <p class="notice">
              „{chosen.title}“ ist noch nicht veröffentlicht. Events spielen immer eine veröffentlichte Version.{" "}
              {can(roleIn(s.orgId), "game.write") && <Link to={href("editorSection", { gameId: chosen.id, section: "veroeffentlichen" })}>Erst veröffentlichen ›</Link>}
            </p>
          )}
          <Field label="Version" hint="Das Event behält diese Version, auch wenn das Spiel später geändert wird.">
            <select required value={version} disabled={!detail} onChange={(e) => setVersion(e.currentTarget.value)}>
              {(detail?.versions ?? []).map((v) => (
                <option key={v.version} value={v.version}>
                  Version {v.version} vom {formatDateTime(v.created_at)}
                  {v.comment ? ` – ${v.comment}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name des Events">
            <input required maxLength={120} value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="z. B. Nachtwanderung Hennef" />
          </Field>
          <div class="grid-2">
            <Field label="Termin" hint="Optional">
              <input type="datetime-local" value={when} onInput={(e) => setWhen(e.currentTarget.value)} />
            </Field>
            <Field label="Aufbewahrung (Tage)" hint={RETENTION_HINT}>
              <input type="number" min={1} max={365} required value={retention} onInput={(e) => setRetention(e.currentTarget.value)} />
            </Field>
          </div>
          {error && (
            <p class="notice error" role="alert">
              {error}
            </p>
          )}
          <div class="form-actions">
            <Link to={href("events")} class="btn">
              Abbrechen
            </Link>
            <button type="submit" class="btn primary" disabled={busy || !detail}>
              Event anlegen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
