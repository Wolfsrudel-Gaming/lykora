/**
 * Paket E: Probelauf (UX §17.1). Gibt es Fehler, nennt der Dialog sie mit Sprungmarken. Sonst
 * speichert er, legt einen Probelauf aus dem Entwurf an (POST …/test-events, beendet den alten)
 * und zeigt Event-Code als QR, Betreuer-PIN, die Stations-Codes zum Testen am Schreibtisch und –
 * mit Leserecht für Events – den Leitstand. Der letzte Probelauf steht in meta.lastTestRun.
 */

import { useEffect, useState } from "preact/hooks";
import { ApiError } from "../../../../lib/api.ts";
import { editor, useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import { formatClock } from "../../../../lib/format.ts";
import { can } from "../../../../lib/roles.ts";
import { href } from "../../../../lib/router.ts";
import { api, currentOrg, errorText, notify } from "../../../../lib/session.ts";
import type { EventDto } from "../../../../lib/types.ts";
import { base, pagePath } from "../../../../lib/base.ts";
import { Dialog } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { QrCode } from "../../../../ui/qr.tsx";
import { Checklist, checklistGroups } from "./Checklist.tsx";
import { StationCodesSheet } from "./StationCodesSheet.tsx";

/** Probeläufe dieser Sitzung je Spiel; Autoren dürfen Events sonst nicht lesen. */
const known = new Map<string, EventDto>();

type View = { kind: "blocked" } | { kind: "intro" } | { kind: "starting" } | { kind: "ready"; event: EventDto } | { kind: "failed"; error: string };

/** Speichern, Probelauf anlegen, Merker setzen; Fehler als Text. */
export async function startTestRun(gameId: string): Promise<EventDto> {
  const store = editor.get().current;
  if (!store) throw new Error("Kein Spiel im Baukasten geöffnet");
  await store.saveNow();
  if (store.get().save.status === "conflict") throw new Error("Jemand hat den Entwurf auch geändert. Bitte zuerst den Konflikt lösen.");
  const event = await api.createTestEvent(gameId, { revision: store.get().revision });
  known.set(gameId, event);
  store.update("Probelauf gestartet", (_game, meta) => void (meta.lastTestRun = { eventId: event.id, at: new Date().toISOString() }), { metaOnly: true });
  return event;
}

export function TestRunDialog({ gameId, open, onClose }: { gameId: string; open: boolean; onClose: () => void }) {
  const game = useEditorSelect((s) => s.game);
  const lang = useEditorSelect((s) => s.lang);
  const issues = useEditorSelect((s) => s.issues);
  const dismissed = useEditorSelect((s) => s.meta.dismissed);
  const last = useEditorSelect((s) => s.meta.lastTestRun);
  const [view, setView] = useState<View>({ kind: "intro" });
  const [codes, setCodes] = useState(false);
  const errors = checklistGroups(issues, dismissed).must;
  const title = readText(game.meta?.title as never, lang) || "Spiel";

  const start = async () => {
    setView({ kind: "starting" });
    try {
      setView({ kind: "ready", event: await startTestRun(gameId) });
    } catch (err) {
      setView({ kind: "failed", error: err instanceof ApiError && err.code === "invalid_game" ? "Der Server hat Fehler im Entwurf gefunden. Bitte die Checkliste ansehen." : errorText(err) });
    }
  };

  // Beim Öffnen: Fehler zeigen, sonst den bekannten Probelauf oder gleich einen neuen.
  useEffect(() => {
    if (!open) return;
    editor.get().current?.showAllIssues(true);
    if (errors.length) return setView({ kind: "blocked" });
    const cached = known.get(gameId);
    if (cached && cached.id === last?.eventId) return setView({ kind: "ready", event: cached });
    if (!last) return void start();
    let alive = true;
    setView({ kind: "starting" });
    api
      .event(last.eventId)
      .then((event) => alive && setView(event.test && event.status !== "ended" ? { kind: "ready", event } : { kind: "intro" }))
      .catch(() => alive && setView({ kind: "intro" }));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (open && view.kind === "blocked" && !errors.length) setView({ kind: "intro" });
  }, [errors.length]);

  const event = view.kind === "ready" ? view.event : null;
  return (
    <>
      <Dialog open={open} title="Probelauf" onClose={onClose}>
        <div class="stack pub-test">
          {view.kind === "blocked" && (
            <>
              <p>Für den Probelauf erst {errors.length === 1 ? "diesen Punkt" : `diese ${errors.length} Punkte`} erledigen:</p>
              <Checklist issues={errors} game={game} label="Fehler" />
            </>
          )}
          {view.kind === "intro" && (
            <>
              <p>
                Ein Probelauf spielt den aktuellen Entwurf von „{title}“ – ohne Version, ohne echtes Event. Ein laufender Probelauf dieses Spiels wird dabei beendet.
              </p>
              <div class="form-actions">
                <button type="button" class="btn primary" onClick={() => void start()}>
                  <Icon name="play" /> Probelauf starten
                </button>
              </div>
            </>
          )}
          {view.kind === "starting" && (
            <p class="loading" role="status">
              <span class="spinner" aria-hidden="true" /> Probelauf wird vorbereitet …
            </p>
          )}
          {view.kind === "failed" && (
            <>
              <p class="notice error" role="alert">
                {view.error}
              </p>
              <div class="form-actions">
                <button type="button" class="btn" onClick={() => void start()}>
                  Erneut versuchen
                </button>
              </div>
            </>
          )}
          {event && (
            <>
              <p class="muted">
                Probelauf „{title}“ · Stand von {formatClock(last?.eventId === event.id ? last.at : event.createdAt)}
              </p>
              <div class="pub-test-join">
                <QrCode value={event.join.qr} size={320} label={`QR-Code für den Einstieg mit Code ${event.join.code}`} />
                <dl class="kv">
                  <dt>Event-Code</dt>
                  <dd class="join-code mono">{event.join.code}</dd>
                  <dt>Betreuer-PIN</dt>
                  <dd class="pin mono">{event.supervisorPin ?? "–"}</dd>
                </dl>
                <p class="small">Mit der Lykora-App scannen, Test-Team anlegen, PIN eingeben – los geht's.</p>
              </div>
              <section class="stack tight" aria-labelledby="pub-desk">
                <h3 id="pub-desk" class="label">
                  Am Schreibtisch testen
                </h3>
                <p class="small">Du musst nicht rausgehen: Scanne die Stations-Codes vom Bildschirm oder tipp die Notfall-Codes in der App unter „Code eingeben“.</p>
                <div>
                  <button type="button" class="btn" onClick={() => setCodes(true)}>
                    Stations-Codes zeigen
                  </button>
                </div>
              </section>
              <div class="row wrap">
                {can(currentOrg()?.role, "event.read") && (
                  <a class="btn" href={pagePath(base(), href("control", { eventId: event.id }))} target="_blank" rel="noopener">
                    Leitstand öffnen ↗
                  </a>
                )}
                <button
                  type="button"
                  class="btn"
                  onClick={() =>
                    void start().then(() => {
                      if (known.get(gameId)?.id !== event.id) notify("Probelauf mit aktuellem Stand neu gestartet. Testhandys brauchen den neuen Code.", "ok");
                    })
                  }
                >
                  Mit aktuellem Stand neu starten
                </button>
              </div>
              <p class="small muted">Echte Events ändern sich nicht. Der Probelauf wird nach 7 Tagen gelöscht.</p>
            </>
          )}
          <div class="form-actions">
            <button type="button" class="btn" onClick={onClose}>
              Schließen
            </button>
          </div>
        </div>
      </Dialog>
      <StationCodesSheet game={game} open={codes} onClose={() => setCodes(false)} />
    </>
  );
}
