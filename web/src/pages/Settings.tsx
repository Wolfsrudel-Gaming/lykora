/**
 * Einstellungen: „Darstellung“ für alle, „Server und Updates“ für Admins der Instanz.
 * Texte, Zustände und der Fortschritt eines Updates kommen aus lib/update.ts.
 */

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "../lib/api.ts";
import { formatAgo, formatDate, formatDateTime, STATUS_LABELS } from "../lib/format.ts";
import { href } from "../lib/router.ts";
import { api, errorText, notify, session, setTheme, theme, type Theme } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import type { UpdateEntry, UpdateState, UpdateStatus } from "../lib/types.ts";
import {
  applyRefusal,
  buildLabel,
  followTrack,
  noteUpdateStatus,
  noteVersion,
  serverAway,
  shortCommit,
  startTrack,
  STEPS,
  trackProgress,
  TRIGGER_LABELS,
  UPDATE_STATE_LABELS,
  UPDATER_STATE_LABELS,
  updateRunning,
  updateView,
  versionText,
  windowError,
  windowText,
  zonedWhen,
  type Progress,
  type Track,
} from "../lib/update.ts";
import { Empty, ErrorNotice, Field, Link, Loading, confirm, useNow, useTitle } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";

export function SettingsPage() {
  useTitle("Einstellungen");
  const s = useStore(session);
  return (
    <div class="page narrow stack loose settings">
      <div class="page-head">
        <h1>Einstellungen</h1>
      </div>
      <Appearance />
      {s.instanceAdmin && <ServerUpdates />}
    </div>
  );
}

// Darstellung

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "night", label: "Nacht", hint: "Dunkel, der Standard: blendet nicht im Gelände und am Leitstand." },
  { value: "day", label: "Tag", hint: "Hell, für Büro und Tageslicht." },
  { value: "system", label: "System", hint: "Folgt der Einstellung deines Geräts." },
];

function Appearance() {
  const { value } = useStore(theme);
  return (
    <section class="card stack" aria-labelledby="darstellung">
      <h2 id="darstellung">Darstellung</h2>
      <fieldset class="theme-choice">
        <legend class="sr-only">Thema</legend>
        {THEMES.map((t) => (
          <label key={t.value} class="check theme-option">
            <input type="radio" name="theme" value={t.value} checked={value === t.value} onChange={() => setTheme(t.value)} />
            <span>
              <strong>{t.label}</strong>
              <small class="muted">{t.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p class="small muted">Gilt für dieses Gerät. Der Schalter in der Kopfzeile tut dasselbe.</p>
    </section>
  );
}

// Server und Updates

/** Der Stand kommt alle 30 s; während eines Updates alle 3 s, auch wenn der Server gerade neu startet. */
const IDLE_POLL_MS = 30_000;
const BUSY_POLL_MS = 3_000;

function ServerUpdates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const now = useNow(5000);
  const trackRef = useRef(track);
  trackRef.current = track;

  const progress = track ? trackProgress(track, reachable ? status : null, reachable, now) : null;
  const polling = !!track && !progress?.done;

  const load = async () => {
    try {
      const st = await api.updateStatus();
      setStatus(st);
      setError(null);
      setReachable(true);
      noteUpdateStatus(st);
      const t = trackRef.current;
      // Ein Update, das jemand anders oder der Server selbst angestoßen hat, wird ebenso begleitet.
      if (t) setTrack(followTrack(t, st, true));
      else if (updateRunning(st)) setTrack(startTrack(st));
    } catch (err) {
      const t = trackRef.current;
      if (t && err instanceof ApiError && serverAway(err.status)) {
        setReachable(false);
        setTrack(followTrack(t, null, false));
      } else if (!t) {
        setError(err);
      }
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), polling ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  // Nach dem Update kennt diese Seite die neue Version schon: Das Band „Neu laden“ erscheint sofort.
  useEffect(() => {
    if (progress?.stage === "succeeded" && status) noteVersion(status.current);
  }, [progress?.stage]);

  const check = async () => {
    setBusy("check");
    setRefusal(null);
    try {
      const st = await api.checkUpdate();
      setStatus(st);
      setError(null);
      noteUpdateStatus(st);
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!status?.available) return;
    const answer = await confirm({
      title: `Auf ${buildLabel(status.available)} aktualisieren?`,
      body: (
        <>
          <p>Der Updater lädt die neue Version und ersetzt den Server-Container. Dabei ist Lykora kurz nicht erreichbar, meist unter einer Minute.</p>
          <p>Startet die neue Version nicht gesund, geht es von selbst zurück auf die bisherige.</p>
        </>
      ),
      confirm: "Jetzt aktualisieren",
    });
    if (!answer.ok) return;
    setBusy("apply");
    setRefusal(null);
    try {
      const st = await api.applyUpdate();
      setStatus(st);
      setReachable(true);
      setTrack(startTrack(st));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRefusal(applyRefusal(err.code, err.message));
        void load();
      } else {
        notify(errorText(err), "error");
      }
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return (
      <section class="card" aria-labelledby="server">
        <h2 id="server">Server und Updates</h2>
        {error ? <ErrorNotice error={error} retry={() => void load()} /> : <Loading text="Lädt den Stand der Updates …" />}
      </section>
    );
  }

  const view = updateView(status, now);
  const inProgress = view.kind === "in_progress" || polling;
  return (
    <>
      <section class="card stack" aria-labelledby="server">
        <h2 id="server">Server und Updates</h2>
        <div class={`notice ${view.tone} stack tight`} role="status">
          <strong>{view.title}</strong>
          {view.detail && <p>{view.detail}</p>}
          {view.hint && <p class="small">{view.hint}</p>}
        </div>
        <dl class="kv">
          <dt>Installiert</dt>
          <dd>{versionText(status.current)}</dd>
          <dt>Image</dt>
          <dd>{status.image ? <code>{status.image}</code> : "–"}</dd>
          <dt>Geprüft</dt>
          <dd>{status.lastCheckAt ? formatDateTime(status.lastCheckAt) : "noch nie"}</dd>
        </dl>
        {!status.configured ? (
          <NotConfigured image={status.image} />
        ) : (
          <>
            {refusal && (
              <p class="notice error" role="alert">
                {refusal}
              </p>
            )}
            {view.applyBlocked && (
              <p class="small muted" id="apply-hint">
                {view.applyBlocked}
              </p>
            )}
            <div class="form-actions">
              <button type="button" class="btn" disabled={busy !== null || inProgress} onClick={() => void check()}>
                <Icon name="refresh" /> {busy === "check" ? "Prüft …" : "Jetzt prüfen"}
              </button>
              <button
                type="button"
                class="btn primary"
                disabled={busy !== null || inProgress || !status.available || !!view.applyBlocked}
                aria-describedby={view.applyBlocked ? "apply-hint" : undefined}
                onClick={() => void apply()}
              >
                Jetzt aktualisieren
              </button>
            </div>
          </>
        )}
      </section>
      {progress && <ProgressCard progress={progress} onClose={progress.done ? () => setTrack(null) : undefined} />}
      {status.available && !inProgress && <AvailableCard status={status} />}
      {status.configured && <AutoSettings status={status} waiting={view.waiting} now={now} onSaved={setStatus} />}
      {status.configured && <UpdaterCard status={status} now={now} />}
      <HistoryCard history={status.history} />
    </>
  );
}

/** Ohne LYKORA_IMAGE oder mit einem lokal gebauten Image gibt es keine Updates; hier steht, was zu tun ist. */
function NotConfigured({ image }: { image: string | null }) {
  return (
    <div class="notice warn stack tight">
      {image ? (
        <p>
          <code>LYKORA_IMAGE={image}</code> ist ein selbst gebautes Image, das in keiner Registry liegt; daraus lässt sich nichts erneuern. Für Updates in{" "}
          <code>.env</code> ein Image von ghcr.io eintragen, z. B. <code>LYKORA_IMAGE=ghcr.io/wolfsrudel-gaming/lykora:testbuild</code>, dann{" "}
          <code>docker compose pull && docker compose up -d</code>.
        </p>
      ) : (
        <>
          <p>
            Ohne <code>LYKORA_IMAGE</code> weiß der Server nicht, wo neue Versionen erscheinen. In <code>.env</code> setzen, z. B.{" "}
            <code>LYKORA_IMAGE=ghcr.io/wolfsrudel-gaming/lykora:testbuild</code>, dann <code>docker compose up -d</code>.
          </p>
          <p>Ein lokal gebautes Image lässt sich nicht aus einer Registry erneuern; dafür gibt es keine Updates.</p>
        </>
      )}
    </div>
  );
}

function ProgressCard({ progress, onClose }: { progress: Progress; onClose?: () => void }) {
  return (
    <section class={`card stack update-progress ${progress.stage}`} aria-labelledby="fortschritt">
      <h2 id="fortschritt">Update</h2>
      <ol class="update-steps">
        {STEPS.map((label, i) => {
          const current = i === progress.step && !progress.done;
          return (
            <li key={label} class={i < progress.step || (progress.done && progress.stage === "succeeded") ? "done" : current ? "current" : ""} aria-current={current ? "step" : undefined}>
              {label}
            </li>
          );
        })}
      </ol>
      <div class="stack tight" role="status" aria-live="polite">
        <p class="strong row">
          {!progress.done && <span class="spinner" aria-hidden="true" />}
          {progress.title}
        </p>
        {progress.detail && <p class="muted">{progress.detail}</p>}
      </div>
      {onClose && (
        <div class="form-actions">
          {progress.stage === "succeeded" && (
            <button type="button" class="btn primary" onClick={() => window.location.reload()}>
              Neu laden
            </button>
          )}
          <button type="button" class="btn" onClick={onClose}>
            Ausblenden
          </button>
        </div>
      )}
    </section>
  );
}

function AvailableCard({ status }: { status: UpdateStatus }) {
  const next = status.available!;
  return (
    <section class="card stack" aria-labelledby="neu">
      <h2 id="neu">Neue Version</h2>
      <dl class="kv">
        <dt>Version</dt>
        <dd>{versionText(next)}</dd>
        <dt>Installiert</dt>
        <dd>{versionText(status.current)}</dd>
      </dl>
      <h3>Änderungen</h3>
      {status.changes.length ? (
        <ul class="changes">
          {status.changes.map((c) => (
            <li key={c.sha}>
              <a href={c.url} target="_blank" rel="noopener">
                {c.title}
              </a>{" "}
              <span class="small muted mono">
                {shortCommit(c.sha)}
                {c.date ? ` · ${formatDate(c.date)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted">Keine Liste der Änderungen: GitHub war nicht erreichbar oder die Commits sind dort nicht zu finden.</p>
      )}
    </section>
  );
}

/** Was ein automatisches Update gerade aufhält: laufende Events mit Link oder das nächste Zeitfenster. */
function Blocked({ status, now }: { status: UpdateStatus; now: number }) {
  const b = status.blockedBy;
  if (!b) return null;
  if (b.reason === "event_running") {
    return (
      <p class="small muted">
        Gerade aktiv:{" "}
        {b.events.map((e, i) => (
          <Fragment key={e.id}>
            {i > 0 && ", "}
            <Link to={href("event", { eventId: e.id })}>{e.name}</Link> ({STATUS_LABELS[e.status]})
          </Fragment>
        ))}
      </p>
    );
  }
  return (
    <p class="small muted">
      Nächstes Zeitfenster: {zonedWhen(b.nextWindowAt, status.timezone, now)} ({status.timezone}).
    </p>
  );
}

function AutoSettings({ status, waiting, now, onSaved }: { status: UpdateStatus; waiting: string | null; now: number; onSaved: (st: UpdateStatus) => void }) {
  const { settings } = status;
  const [auto, setAuto] = useState(settings.auto);
  const [useWindow, setUseWindow] = useState(!!settings.window);
  const [from, setFrom] = useState(settings.window?.from ?? "03:00");
  const [to, setTo] = useState(settings.window?.to ?? "05:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Was der Server hat, gilt; das Formular folgt, sobald es sich dort ändert.
  useEffect(() => {
    setAuto(settings.auto);
    setUseWindow(!!settings.window);
    if (settings.window) {
      setFrom(settings.window.from);
      setTo(settings.window.to);
    }
  }, [settings.auto, settings.window?.from, settings.window?.to]);

  const next = { auto, window: useWindow ? { from, to } : null };
  const windowProblem = useWindow ? windowError(from, to) : null;
  const dirty = auto !== settings.auto || (next.window?.from ?? null) !== (settings.window?.from ?? null) || (next.window?.to ?? null) !== (settings.window?.to ?? null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (windowProblem) return setError(windowProblem);
    setBusy(true);
    setError(null);
    try {
      const st = await api.saveUpdateSettings(next);
      onSaved(st);
      noteUpdateStatus(st);
      notify(auto ? "Automatische Updates sind an." : "Automatische Updates sind aus.", "ok");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card stack" onSubmit={submit} aria-labelledby="auto">
      <h2 id="auto">Automatische Updates</h2>
      <label class="check">
        <input type="checkbox" checked={auto} aria-describedby="auto-hint" onChange={(e) => setAuto(e.currentTarget.checked)} />
        <strong>Updates automatisch einspielen</strong>
      </label>
      <div id="auto-hint" class="stack tight small muted">
        <p>Liegt eine neue Version in der Registry, spielt der Updater sie von selbst ein: Server samt Dashboard, nicht die App.</p>
        <ul>
          <li>Nie während eines Events: Solange ein Event läuft, pausiert ist oder im Rückruf steht, wartet das Update.</li>
          <li>Rückfall: Startet die neue Version nicht gesund, läuft die bisherige weiter.</li>
          <li>Beim Neustart ist der Server kurz nicht erreichbar, meist unter einer Minute. Die App holt den Abgleich danach nach.</li>
        </ul>
      </div>
      <label class="check">
        <input type="checkbox" checked={useWindow} onChange={(e) => setUseWindow(e.currentTarget.checked)} />
        Nur in einem Zeitfenster
      </label>
      {useWindow && (
        <div class="window-fields">
          <Field label="Von">
            <input type="time" required value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
          </Field>
          <Field label="Bis">
            <input type="time" required value={to} onInput={(e) => setTo(e.currentTarget.value)} />
          </Field>
          <p class="small muted" role="status">
            Zeitzone des Servers: {status.timezone}. {windowProblem ?? windowText({ from, to })}
          </p>
        </div>
      )}
      {waiting && (
        <div class="notice stack tight" role="status">
          <p>{waiting}</p>
          <Blocked status={status} now={now} />
        </div>
      )}
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      <div class="form-actions">
        <button type="submit" class="btn primary" disabled={busy || !dirty || !!windowProblem}>
          Speichern
        </button>
      </div>
    </form>
  );
}

function UpdaterCard({ status, now }: { status: UpdateStatus; now: number }) {
  const u = status.updater;
  return (
    <section class="card stack" aria-labelledby="updater">
      <div class="row between">
        <h2 id="updater">Updater</h2>
        <span class={`badge ${u.connected ? "on" : "quiet"}`}>{u.connected ? "Verbunden" : "Nicht verbunden"}</span>
      </div>
      <dl class="kv">
        <dt>Zuletzt gesehen</dt>
        <dd>{u.lastSeenAt ? `${formatAgo(u.lastSeenAt, now)} (${formatDateTime(u.lastSeenAt)})` : "noch nie"}</dd>
        <dt>Zustand</dt>
        <dd>
          {u.state ? UPDATER_STATE_LABELS[u.state] : "–"}
          {u.message && <span class="muted"> – {u.message}</span>}
        </dd>
      </dl>
      {!u.connected && (
        <div class="notice warn stack tight">
          <strong>Der Updater meldet sich nicht.</strong>
          <p>
            Er ist ein eigener Container aus demselben Image und fragt den Server etwa jede Minute. Ohne ihn wird nichts eingespielt. Einrichtung auf dem Server im
            Ordner mit <code>compose.yaml</code>:
          </p>
          <pre>
            <code>docker compose pull{"\n"}docker compose up -d</code>
          </pre>
          <p>
            Der Dienst <code>updater</code> braucht den Docker-Socket (<code>/var/run/docker.sock</code>, sonst <code>DOCKER_SOCKET</code> in <code>.env</code>) und
            liest den Token aus dem Volume <code>data</code>. Was er tut, zeigt <code>docker compose logs updater</code>.
          </p>
        </div>
      )}
    </section>
  );
}

const HISTORY_BADGE: Record<UpdateState, string> = { running: "on", succeeded: "", failed: "strong", rolled_back: "strong" };

function HistoryCard({ history }: { history: UpdateEntry[] }) {
  return (
    <section class="card" aria-labelledby="verlauf">
      <h2 id="verlauf">Verlauf</h2>
      {!history.length ? (
        <Empty>Noch keine Updates.</Empty>
      ) : (
        <table class="table cards">
          <thead>
            <tr>
              <th>Wann</th>
              <th>Version</th>
              <th>Auslöser</th>
              <th>Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td data-label="Wann" class="mono">
                  {formatDateTime(h.startedAt)}
                </td>
                <td data-label="Version">
                  {buildLabel(h.from)} → {buildLabel(h.to)}
                </td>
                <td data-label="Auslöser">{TRIGGER_LABELS[h.trigger]}</td>
                <td data-label="Ergebnis">
                  <span class={`badge ${HISTORY_BADGE[h.state]}`}>{UPDATE_STATE_LABELS[h.state]}</span>
                  {h.message && <div class="small muted">{h.message}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
