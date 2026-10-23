/**
 * Paket B: Vor-Ort-Modus am Handy (/spiele/:gameId/vor-ort, UX §18, W9). Derselbe Entwurf, dasselbe
 * automatische Speichern und dieselbe lokale Sicherung wie im Baukasten – ohne Netz landet alles
 * lokal und geht raus, sobald wieder Netz da ist. Station hier anlegen, die gewählte Station hierher
 * verschieben, „Stelle passt“, Sammel- und Rettungspunkt hier, Notiz. Jeder Ort wird 10 s gemittelt
 * (Ausreißer fallen weg, „Sofort übernehmen“ kürzt ab); der Merker meta.onSite hält Genauigkeit und Zeit.
 */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError } from "../../../lib/api.ts";
import { accuracyLevel, averageFixes, bearing, compass, distanceM, formatDistance, isPoint, type Fix } from "../../../lib/editor/geo.ts";
import { STATION_KINDS, type StationKind } from "../../../lib/editor/stations.ts";
import { editor, openEditor, shallowArray, useEditorSelect, type EditorStore } from "../../../lib/editor/store.ts";
import { readText, writeText } from "../../../lib/editor/text.ts";
import type { Game, Point } from "../../../lib/editor/types.ts";
import { can } from "../../../lib/roles.ts";
import { href } from "../../../lib/router.ts";
import { currentOrg } from "../../../lib/session.ts";
import { useStore } from "../../../lib/store.ts";
import { Dialog, ErrorNotice, Link, Loading, useTitle } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { ConflictDialog } from "../editor/ConflictDialog.tsx";
import { LocalBackupDialog } from "../editor/LocalBackupDialog.tsx";
import { addPoint, addStation, moveStationTo, setPoint } from "../editor/map/actions.ts";
import { LazyEditorMap } from "../editor/map/LazyMap.tsx";
import { SaveStatus } from "../editor/SaveStatus.tsx";
import "../editor/editor.css";
import { useGeolocation, useWakeLock, type Geo } from "./useGeolocation.ts";
import "./onsite.css";

/** So lange wird gemittelt. */
export const MEASURE_MS = 10_000;
/** Ab dieser Genauigkeit fragt die Seite nach („Trotzdem speichern“). */
export const POOR_ACCURACY_M = 30;
/** Ab diesem Abstand fragt „Hierher verschieben“ nach. */
export const FAR_MOVE_M = 100;

/** Stationen mit Ort nach Abstand zu p, die nächste zuerst. */
export function stationsByDistance(game: Game, p: Point | null, lang: string): { id: string; name: string; number: string; distance: number; direction: string }[] {
  return (game.stations ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s?.id && isPoint(s.location))
    .map(({ s, i }) => ({
      id: s.id,
      name: readText(s.name as never, lang) || s.id,
      number: s.final ? "★" : String(i + 1),
      distance: p ? distanceM(p, s.location!) : Infinity,
      direction: p ? compass(bearing(p, s.location!)) : "",
    }))
    .sort((a, b) => a.distance - b.distance);
}

type Load = { kind: "loading" } | { kind: "ready" } | { kind: "forbidden" } | { kind: "missing" } | { kind: "error"; error: unknown };

export function OnSitePage({ gameId }: { gameId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { current } = useStore(editor);
  useEffect(() => {
    if (!can(currentOrg()?.role, "game.write")) return setLoad({ kind: "forbidden" });
    let alive = true;
    setLoad({ kind: "loading" });
    openEditor(gameId)
      .then((store) => (alive ? setLoad({ kind: "ready" }) : store.close()))
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 403) setLoad({ kind: "forbidden" });
        else if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
        else setLoad({ kind: "error", error });
      });
    return () => {
      alive = false;
      const store = editor.get().current;
      if (store && store.get().gameId === gameId) void store.saveNow().finally(() => store.close());
    };
  }, [gameId, attempt]);

  if (load.kind === "forbidden" || load.kind === "missing") {
    return (
      <div class="page narrow stack">
        <h1>Vor Ort</h1>
        <p>{load.kind === "forbidden" ? "Den Vor-Ort-Modus können nur Admins und Autorinnen und Autoren öffnen." : "Spiel nicht gefunden. Vielleicht wurde es archiviert."}</p>
        <p>
          <Link to={href("games")} class="btn">
            Zu den Spielen
          </Link>
        </p>
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div class="page narrow stack">
        <h1>Vor Ort</h1>
        <ErrorNotice error={load.error} retry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }
  if (load.kind === "loading" || !current || current.get().gameId !== gameId) return <Loading text="Spiel lädt …" />;
  return <OnSite gameId={gameId} store={current} />;
}

type Action = { kind: "create" } | { kind: "move"; id: string } | { kind: "assembly" } | { kind: "rescue" };

function OnSite({ gameId, store }: { gameId: string; store: EditorStore }) {
  const geo = useGeolocation();
  useWakeLock(true);
  const game = useEditorSelect((s) => s.game);
  const meta = useEditorSelect((s) => s.meta);
  const lang = useEditorSelect((s) => s.lang);
  const issues = useEditorSelect((s) => s.issues, shallowArray);
  const save = useEditorSelect((s) => s.save);
  const backup = useEditorSelect((s) => s.backup);
  const title = readText(game.meta?.title as never, lang);
  useTitle(`Vor Ort: ${title || "Spiel"}`);
  const [chosen, setChosen] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [focus, setFocus] = useState<{ point: Point; zoom?: number; key: number } | null>(null);
  const here: Point | null = geo.fix ? { lat: geo.fix.lat, lon: geo.fix.lon } : null;
  const list = useMemo(() => stationsByDistance(game, here, lang), [game, here?.lat, here?.lon, lang]);
  const target = (chosen && list.find((s) => s.id === chosen)) || list[0] || null;

  useEffect(() => setConflict(save.status === "conflict"), [save.status]);
  // Erste Messung: Karte dorthin.
  const centered = useRef(false);
  useEffect(() => {
    if (here && !centered.current) {
      centered.current = true;
      setFocus({ point: here, zoom: 18, key: Date.now() });
    }
  }, [here?.lat, here?.lon]);

  const finish = (text: string) => {
    setAction(null);
    setDone(text);
  };

  const confirmHere = () => {
    if (!target || !geo.fix) return;
    const accuracy = Math.round(geo.fix.accuracy);
    store.update(`Stelle von „${target.name}“ bestätigt`, (_g, m) => {
      m.onSite = { ...m.onSite, [target.id]: { accuracy, at: new Date().toISOString() } };
    });
    finish(`Stelle von „${target.name}“ bestätigt (± ${accuracy} m).`);
  };

  const level = geo.fix ? accuracyLevel(geo.fix.accuracy) : null;
  const ready = geo.status === "watching" && !!geo.fix;

  return (
    <div class="page onsite stack">
      <header class="onsite-head">
        <Link to={href("editor", { gameId })} class="btn small ghost">
          <Icon name="back" /> Baukasten
        </Link>
        <h1>Vor Ort</h1>
        <SaveStatus save={save} backup={backup} who={save.conflict?.updated_by?.name} onRetry={() => void store.retrySave()} onConflict={() => setConflict(true)} />
      </header>
      <p class="small muted onsite-title">{title}</p>

      {geo.status === "idle" && (
        <section class="notice stack tight">
          <p>
            Damit du Stationen per GPS setzen kannst, braucht Lykora deinen Standort. Er wird nur hier verwendet und nicht gespeichert – gespeichert wird nur der Ort, den du für eine Station oder
            einen Punkt übernimmst.
          </p>
          <button type="button" class="btn primary onsite-big" onClick={geo.start}>
            <Icon name="pin" /> Standort freigeben
          </button>
        </section>
      )}
      {geo.status === "denied" && (
        <section class="notice warn stack tight" role="alert">
          <p>Der Standort ist für diese Seite gesperrt. Gib ihn im Browser frei (Schloss-Symbol neben der Adresse → Standort → Erlauben) und tippe dann hier.</p>
          <button type="button" class="btn onsite-big" onClick={geo.start}>
            Noch einmal versuchen
          </button>
        </section>
      )}
      {geo.status === "unavailable" && <p class="notice warn">Dieses Gerät kennt keinen Standort. Koordinaten kannst du im Baukasten eintippen.</p>}

      <LazyEditorMap
        game={game}
        meta={meta}
        issues={issues}
        label="Karte vor Ort"
        readOnly
        class="onsite-map"
        me={geo.fix ? { point: { lat: geo.fix.lat, lon: geo.fix.lon }, accuracy: geo.fix.accuracy } : null}
        selection={target ? { kind: "station", id: target.id } : null}
        focus={focus}
        onSelect={(s) => s?.kind === "station" && setChosen(s.id)}
      />

      <section class="onsite-panel stack" aria-label="Werkzeuge vor Ort">
        <div class="onsite-gps" aria-live="off">
          <span class="label">GPS</span>
          {level ? (
            <>
              <span class={`onsite-bars b${level.bars}`} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <strong>± {Math.round(geo.fix!.accuracy)} m</strong>
              <span>· {level.word}</span>
            </>
          ) : (
            <span class="muted">{geo.status === "waiting" ? "Warte auf das erste Signal …" : "aus"}</span>
          )}
          {geo.error && <span class="small muted"> · {geo.error}</span>}
        </div>
        {list.length > 0 && (
          <div class="field onsite-next">
            <label for="vor-ort-station">{chosen ? "Gewählte Station" : "Nächste Station"}</label>
            <select id="vor-ort-station" value={target?.id ?? ""} onChange={(e) => setChosen(e.currentTarget.value || null)}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} {s.name}
                  {Number.isFinite(s.distance) ? ` · ${formatDistance(s.distance)} ${s.direction}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="button" class="btn primary block onsite-big" disabled={!ready} onClick={() => setAction({ kind: "create" })}>
          <Icon name="plus" /> Station hier anlegen
        </button>
        {target && (
          <button type="button" class="btn block onsite-big" disabled={!ready} onClick={() => setAction({ kind: "move", id: target.id })}>
            „{target.name}“ hierher verschieben
          </button>
        )}
        <div class="onsite-grid">
          <button type="button" class="btn onsite-big" disabled={!ready || !target} onClick={confirmHere}>
            <Icon name="check" /> Stelle passt
          </button>
          <button type="button" class="btn onsite-big" disabled={!target} onClick={() => setNoteOpen(true)}>
            <Icon name="edit" /> Notiz
          </button>
          <button type="button" class="btn onsite-big" disabled={!ready} onClick={() => setAction({ kind: "assembly" })}>
            Sammelpunkt hier
          </button>
          <button type="button" class="btn onsite-big" disabled={!ready} onClick={() => setAction({ kind: "rescue" })}>
            Rettungspunkt hier
          </button>
        </div>
        {done && (
          <p class="notice ok row between" role="status">
            <span>{done}</span>
            <button
              type="button"
              class="btn small"
              onClick={() => {
                store.undo();
                setDone("Rückgängig gemacht.");
              }}
            >
              Rückgängig
            </button>
          </p>
        )}
        <p class="small muted">Ohne Netz? Kein Problem. Gespeichert wird, sobald wieder Netz da ist; bis dahin sichert dieses Gerät alles.</p>
      </section>

      {action && <MeasureDialog action={action} geo={geo} store={store} lang={lang} onDone={finish} onCancel={() => setAction(null)} />}
      {target && <NoteDialog open={noteOpen} id={target.id} name={target.name} store={store} onClose={() => setNoteOpen(false)} />}
      <ConflictDialog open={conflict} onClose={() => setConflict(false)} />
      <LocalBackupDialog />
    </div>
  );
}

const ACTION_TITLES: Record<Action["kind"], string> = {
  create: "Station hier anlegen",
  move: "Station hierher verschieben",
  assembly: "Sammelpunkt hier",
  rescue: "Rettungspunkt hier",
};

/** Mitteln über 10 s, bei schlechtem GPS nachfragen, dann das Formular der Aktion. */
function MeasureDialog({ action, geo, store, lang, onDone, onCancel }: { action: Action; geo: Geo; store: EditorStore; lang: string; onDone: (text: string) => void; onCancel: () => void }) {
  const [round, setRound] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [result, setResult] = useState<ReturnType<typeof averageFixes>>(null);
  const [force, setForce] = useState(false);

  useEffect(() => {
    setFixes(geo.fix ? [{ lat: geo.fix.lat, lon: geo.fix.lon, accuracy: geo.fix.accuracy }] : []);
    setElapsed(0);
    setResult(null);
    setForce(false);
    const off = geo.onFix((f) => setFixes((list) => [...list, f]));
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.min(MEASURE_MS, Date.now() - started)), 250);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [round]);

  useEffect(() => {
    if (!result && elapsed >= MEASURE_MS && fixes.length) setResult(averageFixes(fixes));
  }, [elapsed, fixes.length]);

  const measuring = !result;
  const poor = !!result && result.accuracy > POOR_ACCURACY_M && !force;
  return (
    <Dialog open title={ACTION_TITLES[action.kind]} onClose={onCancel}>
      {measuring ? (
        <div class="stack">
          <p>Bleib kurz stehen …</p>
          <span class="progress onsite-progress" role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.round(elapsed / 1000)} aria-label="Messung">
            <span style={{ width: `${Math.round((elapsed / MEASURE_MS) * 100)}%` }} />
          </span>
          <p class="small muted">
            {Math.round(elapsed / 1000)} von 10 s · {fixes.length} {fixes.length === 1 ? "Messung" : "Messungen"}
            {fixes.length > 0 && ` · gemittelt ± ${averageFixes(fixes)!.accuracy} m`}
          </p>
          <div class="form-actions">
            <button type="button" class="btn" onClick={onCancel}>
              Abbrechen
            </button>
            <button type="button" class="btn primary" disabled={!fixes.length} onClick={() => setResult(averageFixes(fixes))}>
              Sofort übernehmen
            </button>
          </div>
        </div>
      ) : poor ? (
        <div class="stack">
          <p>Das GPS ist gerade ungenau (± {result.accuracy} m). Unter freiem Himmel wird es meist besser.</p>
          <div class="form-actions">
            <button type="button" class="btn" onClick={() => setRound((n) => n + 1)}>
              Weiter messen
            </button>
            <button type="button" class="btn primary" onClick={() => setForce(true)}>
              Trotzdem speichern
            </button>
          </div>
        </div>
      ) : (
        <ActionForm action={action} point={result!.point} accuracy={result!.accuracy} store={store} lang={lang} onDone={onDone} onCancel={onCancel} />
      )}
    </Dialog>
  );
}

function ActionForm({
  action,
  point,
  accuracy,
  store,
  lang,
  onDone,
  onCancel,
}: {
  action: Action;
  point: Point;
  accuracy: number;
  store: EditorStore;
  lang: string;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const game = store.get().game;
  const count = Array.isArray(game.stations) ? game.stations.length : 0;
  const station = action.kind === "move" ? game.stations?.find((s) => s?.id === action.id) : undefined;
  const stationName = station ? readText(station.name as never, lang) || station.id : "";
  const initial =
    action.kind === "create"
      ? `Station ${count + 1}`
      : action.kind === "assembly"
        ? readText(game.field?.assemblyPoint?.name as never, lang) || "Sammelpunkt"
        : action.kind === "rescue"
          ? `Rettungspunkt ${(game.field?.rescuePoints?.length ?? 0) + 1}`
          : "";
  const [name, setName] = useState(initial);
  const [kind, setKind] = useState<StationKind>("raetsel");
  const [offPath, setOffPath] = useState(false);
  const [note, setNote] = useState("");
  const distance = station && isPoint(station.location) ? distanceM(station.location, point) : 0;
  const stamp = { accuracy, at: new Date().toISOString() };

  const submit = () => {
    const label = name.trim() || initial;
    switch (action.kind) {
      case "create": {
        let id = "";
        store.update(`Station „${label}“ vor Ort angelegt`, (g, m) => {
          id = addStation(g, kind, label, point);
          const st = g.stations.find((s) => s.id === id)!;
          if (offPath) st.offPath = true;
          if (note.trim()) st.notes = note.trim();
          m.onSite = { ...m.onSite, [id]: stamp };
        });
        return onDone(`„${label}“ angelegt (± ${accuracy} m).`);
      }
      case "move":
        store.update(`Station „${stationName}“ vor Ort verschoben`, (g, m) => {
          moveStationTo(g, action.id, point);
          m.onSite = { ...m.onSite, [action.id]: stamp };
        });
        return onDone(`„${stationName}“ verschoben (± ${accuracy} m).`);
      case "assembly":
        store.update("Sammelpunkt vor Ort gesetzt", (g) => {
          setPoint(g, "assembly", point);
          const ap = g.field.assemblyPoint;
          const text = writeText(ap.name as never, lang, label);
          if (text !== undefined) ap.name = text;
        });
        return onDone(`Sammelpunkt „${label}“ gesetzt (± ${accuracy} m).`);
      case "rescue":
        store.update("Rettungspunkt vor Ort angelegt", (g) => {
          const i = addPoint(g, "rescue", point);
          const rp = g.field.rescuePoints![i]!;
          rp.name = { [lang]: label };
        });
        return onDone(`Rettungspunkt „${label}“ angelegt (± ${accuracy} m).`);
    }
  };

  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p class="small muted">Gemittelt ± {accuracy} m.</p>
      {action.kind === "move" ? (
        <p>
          {distance > FAR_MOVE_M ? `„${stationName}“ um ${formatDistance(distance)} verschieben?` : `„${stationName}“ an diese Stelle verschieben (${formatDistance(distance)} vom bisherigen Ort)?`}
        </p>
      ) : (
        <div class="field">
          <label for="vor-ort-name">Name</label>
          <input id="vor-ort-name" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </div>
      )}
      {action.kind === "create" && (
        <>
          <div class="field">
            <label for="vor-ort-art">Baustein</label>
            <select id="vor-ort-art" value={kind} onChange={(e) => setKind(e.currentTarget.value as StationKind)}>
              {(Object.keys(STATION_KINDS) as StationKind[]).map((k) => (
                <option key={k} value={k}>
                  {STATION_KINDS[k].label}
                </option>
              ))}
            </select>
          </div>
          <label class="check">
            <input type="checkbox" checked={offPath} onChange={(e) => setOffPath(e.currentTarget.checked)} />
            <span>Abseits der Wege</span>
          </label>
          <div class="field">
            <label for="vor-ort-notiz">Notiz für den Aufbau</label>
            <textarea id="vor-ort-notiz" rows={2} value={note} placeholder="z. B. Am Zaunpfahl, 1 m hoch" onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
        </>
      )}
      <p class="small muted">Ohne Netz? Kein Problem. Gespeichert wird, sobald wieder Netz da ist.</p>
      <div class="form-actions">
        <button type="button" class="btn" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" class="btn primary">
          {action.kind === "move" ? "Verschieben" : "Speichern"}
        </button>
      </div>
    </form>
  );
}

/** Aufbau-Notiz der gewählten Station (stations[].notes), getippt wie im Baukasten. */
function NoteDialog({ open, id, name, store, onClose }: { open: boolean; id: string; name: string; store: EditorStore; onClose: () => void }) {
  const value = useEditorSelect((s) => s.game.stations?.find((st) => st?.id === id)?.notes ?? "");
  return (
    <Dialog open={open} title={`Notiz zu „${name}“`} onClose={onClose}>
      <div class="stack">
        <div class="field">
          <label for="vor-ort-aufbau">Notiz für den Aufbau</label>
          <textarea
            id="vor-ort-aufbau"
            rows={4}
            value={value}
            placeholder="z. B. Am Zaunpfahl, 1 m hoch"
            onInput={(e) => {
              const v = e.currentTarget.value;
              const index = store.get().game.stations?.findIndex((st) => st?.id === id) ?? -1;
              if (index >= 0) store.setField(`/stations/${index}/notes`, v || undefined, `Notiz zu „${name}“ geändert`, { coalesce: true });
            }}
          />
        </div>
        <div class="form-actions">
          <button type="button" class="btn primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </Dialog>
  );
}
