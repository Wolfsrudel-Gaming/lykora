import { useState } from "preact/hooks";
import { formatDateTime, fromLocalInput, text, toLocalInput } from "../lib/format.ts";
import { can } from "../lib/roles.ts";
import { href, navigate } from "../lib/router.ts";
import { api, errorText, notify, roleIn } from "../lib/session.ts";
import type { EventDto } from "../lib/types.ts";
import { Dialog, ErrorNotice, Field, Link, Loading, StatusBadge, confirm, useLoad, useTitle } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { QrCode } from "../ui/qr.tsx";
import { RETENTION_HINT } from "./EventNew.tsx";

const ACTIVE = ["running", "paused", "recalled"];

export async function copy(value: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    notify(`${what} kopiert`, "ok");
  } catch {
    notify(`${what} ließ sich nicht kopieren. Bitte von Hand markieren.`, "warn");
  }
}

export function EventPage({ eventId }: { eventId: string }) {
  const { data: event, error, loading, reload, setData } = useLoad(() => api.event(eventId), [eventId]);
  const [editing, setEditing] = useState(false);
  useTitle(event?.name ?? "Event");
  if (loading && !event) return <div class="page"><Loading /></div>;
  if (!event) return <div class="page"><ErrorNotice error={error} retry={reload} /></div>;
  const role = roleIn(event.orgId);
  const manage = can(role, "event.manage");
  const active = ACTIVE.includes(event.status);

  const remove = async () => {
    const answer = await confirm({
      title: "Event löschen?",
      body: <p>„{event.name}“ wird mit allen Teams, Positionen, Fotos, Nachrichten und dem Logbuch gelöscht. Das lässt sich nicht rückgängig machen.</p>,
      confirm: "Endgültig löschen",
    });
    if (!answer.ok) return;
    try {
      await api.deleteEvent(event.id);
      notify(`Event „${event.name}“ gelöscht`, "ok");
      navigate(href("events"));
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  return (
    <div class="page stack loose">
      <div>
        <nav class="crumbs no-print" aria-label="Pfad">
          <Link to={href("events")}>Events</Link>
        </nav>
        <div class="page-head">
          <h1>{event.name}</h1>
          <StatusBadge status={event.status} />
        </div>
        <div class="row no-print">
          <Link to={href(role === "supervisor" ? "supervisor" : "control", { eventId })} class={`btn${active || event.status === "draft" ? " primary" : ""}`}>
            {event.status === "ended" ? "Auswertung" : role === "supervisor" ? "Betreuer-Ansicht" : "Leitstand öffnen"}
          </Link>
          {role !== "supervisor" && (
            <Link to={href("supervisor", { eventId })} class="btn">
              Betreuer-Ansicht
            </Link>
          )}
          <span class="spacer" />
          <button type="button" class="btn" onClick={() => window.print()}>
            <Icon name="print" /> Aushang drucken
          </button>
          {manage && (
            <button type="button" class="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Bearbeiten
            </button>
          )}
          {manage && !active && (
            <button type="button" class="btn" onClick={remove}>
              <Icon name="trash" /> Löschen
            </button>
          )}
        </div>
        {manage && active && <p class="small muted no-print">Laufende Events lassen sich erst nach dem Beenden löschen.</p>}
      </div>

      <section class="card stack" aria-labelledby="einstieg">
        <h2 id="einstieg">Einstieg für Teams</h2>
        <div class="grid-2" style={{ alignItems: "start" }}>
          <div class="stack">
            <div class="stack tight">
              <span class="label">Event-Code</span>
              <span class="join-code">{event.join.code}</span>
            </div>
            <div class="stack tight">
              <span class="label">Link für Teams</span>
              <div class="row nowrap">
                <a href={event.join.url} class="wrap-anywhere">
                  {event.join.url}
                </a>
                <button type="button" class="btn small no-print" aria-label="Link kopieren" onClick={() => void copy(event.join.url, "Link")}>
                  <Icon name="link" />
                </button>
              </div>
            </div>
            {event.supervisorPin && (
              <div class="stack tight">
                <span class="label">Betreuer-PIN {event.supervisorRequired ? "(Pflicht)" : ""}</span>
                <span class="pin">{event.supervisorPin}</span>
                <span class="small muted">
                  {event.supervisorRequired
                    ? "Minderjährige Teams starten erst, wenn ein Betreuer diese PIN in der App eingibt. Nur an Betreuer geben."
                    : "Bestätigt in der App, dass ein Betreuer dabei ist. Nur an Betreuer geben."}
                </span>
              </div>
            )}
          </div>
          <div class="stack tight">
            <QrCode value={event.join.qr} label={`QR-Code für den Einstieg mit Code ${event.join.code}`} />
            <span class="small muted">Mit der Lykora-App scannen. Enthält Server und Code.</span>
          </div>
        </div>
      </section>

      <section class="card no-print" aria-labelledby="angaben">
        <h2 id="angaben">Angaben</h2>
        <dl class="kv">
          <dt>Spiel</dt>
          <dd>
            {can(role, "game.read") ? <Link to={href("game", { gameId: event.gameId })}>{text(event.gameTitle)}</Link> : text(event.gameTitle)} · Version {event.gameVersion}
          </dd>
          <dt>Termin</dt>
          <dd>{formatDateTime(event.scheduledAt)}</dd>
          <dt>Gestartet</dt>
          <dd>{formatDateTime(event.startedAt)}</dd>
          <dt>Beendet</dt>
          <dd>{formatDateTime(event.endedAt)}</dd>
          <dt>Pausen</dt>
          <dd>{event.pauses.length}</dd>
          <dt>Aufbewahrung</dt>
          <dd>
            {event.retentionDays} Tage nach dem Ende{event.purgedAt ? ` · personenbezogene Daten gelöscht am ${formatDateTime(event.purgedAt)}` : ""}
          </dd>
          <dt>Angelegt</dt>
          <dd>{formatDateTime(event.createdAt)}</dd>
        </dl>
      </section>

      {manage && (
        <EditDialog
          event={event}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={(e) => {
            setData(e);
            setEditing(false);
            notify("Event gespeichert", "ok");
          }}
        />
      )}
    </div>
  );
}

function EditDialog({ event, open, onClose, onSaved }: { event: EventDto; open: boolean; onClose: () => void; onSaved: (e: EventDto) => void }) {
  const [name, setName] = useState(event.name);
  const [when, setWhen] = useState(toLocalInput(event.scheduledAt));
  const [retention, setRetention] = useState(String(event.retentionDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.updateEvent(event.id, { name: name.trim(), scheduledAt: fromLocalInput(when), retentionDays: Number(retention) }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Event bearbeiten" onClose={onClose}>
      <form class="stack" onSubmit={save}>
        <Field label="Name">
          <input required value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="Termin" hint="Leer lassen für ohne Termin">
          <input type="datetime-local" value={when} onInput={(e) => setWhen(e.currentTarget.value)} />
        </Field>
        <Field label="Aufbewahrung (Tage)" hint={RETENTION_HINT}>
          <input type="number" min={1} max={365} required value={retention} onInput={(e) => setRetention(e.currentTarget.value)} />
        </Field>
        {error && (
          <p class="notice error" role="alert">
            {error}
          </p>
        )}
        <div class="form-actions">
          <button type="button" class="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" class="btn primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </Dialog>
  );
}
