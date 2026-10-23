import { formatDateTime, text } from "../lib/format.ts";
import { can } from "../lib/roles.ts";
import { href } from "../lib/router.ts";
import { api, session } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import type { EventDto, EventStatus } from "../lib/types.ts";
import { Empty, ErrorNotice, Link, Loading, StatusBadge, useLoad, useTitle } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";

const ORDER: Record<EventStatus, number> = { recalled: 0, running: 1, paused: 2, draft: 3, ended: 4 };

export function EventsPage() {
  useTitle("Events");
  const s = useStore(session);
  const role = s.orgs.find((o) => o.id === s.orgId)?.role;
  const { data, error, loading, reload } = useLoad(() => (s.orgId ? api.events(s.orgId) : Promise.resolve([])), [s.orgId]);
  const all = [...(data ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  // Probeläufe aus dem Baukasten stehen eingeklappt ganz unten und zählen nicht zu den echten Events.
  const tests = all.filter((e) => e.test);
  const events = all.filter((e) => !e.test);
  const live = events.filter((e) => e.status !== "ended" && e.status !== "draft");
  const planned = events.filter((e) => e.status === "draft");
  const ended = events.filter((e) => e.status === "ended");

  return (
    <div class="page stack loose">
      <div class="page-head">
        <h1>Events</h1>
        {can(role, "event.manage") && (
          <Link to={href("eventNew")} class="btn primary">
            <Icon name="plus" /> Event anlegen
          </Link>
        )}
      </div>
      <ErrorNotice error={error} retry={reload} />
      {loading && !data ? (
        <Loading />
      ) : all.length === 0 ? (
        <Empty>Noch keine Events. {can(role, "event.manage") ? "Lege ein Event aus einem Spiel an." : ""}</Empty>
      ) : (
        <>
          <EventGroup title="Laufend" events={live} supervisor={role === "supervisor"} />
          <EventGroup title="Geplant" events={planned} supervisor={role === "supervisor"} />
          <EventGroup title="Beendet" events={ended} supervisor={role === "supervisor"} />
          {tests.length > 0 && (
            <details class="stack events-tests">
              <summary>
                <h2>Probeläufe ({tests.length})</h2>
              </summary>
              <p class="small muted">Probeläufe aus dem Baukasten werden nach 7 Tagen gelöscht.</p>
              <EventGroup title="Probeläufe" events={tests} supervisor={role === "supervisor"} hideTitle />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function EventGroup({ title, events, supervisor, hideTitle }: { title: string; events: EventDto[]; supervisor: boolean; hideTitle?: boolean }) {
  if (!events.length) return null;
  return (
    <section class="stack" aria-label={title}>
      {!hideTitle && <h2>{title}</h2>}
      <div class="grid-3">
        {events.map((e) => (
          <article key={e.id} class="card event-card">
            <div class="row between">
              <span class="row">
                <StatusBadge status={e.status} />
                {e.test && <span class="badge">Probelauf</span>}
              </span>
              <span class="mono small muted">{e.join.code}</span>
            </div>
            <h3>
              <Link to={href("event", { eventId: e.id })}>{e.name}</Link>
            </h3>
            <p class="muted small">
              {text(e.gameTitle)} · {e.gameVersion === null ? "Probestand" : `Version ${e.gameVersion}`}
            </p>
            <p class="small">{e.scheduledAt ? formatDateTime(e.scheduledAt) : e.startedAt ? `Gestartet ${formatDateTime(e.startedAt)}` : "Ohne Termin"}</p>
            <div class="row">
              <Link to={href(supervisor ? "supervisor" : "control", { eventId: e.id })} class={`btn small${e.status === "draft" || e.status === "ended" ? "" : " primary"}`}>
                {e.status === "ended" ? "Auswertung" : supervisor ? "Betreuer-Ansicht" : "Leitstand"}
              </Link>
              <Link to={href("event", { eventId: e.id })} class="btn small">
                Details
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
