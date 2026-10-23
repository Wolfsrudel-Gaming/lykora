/**
 * Paket B: Bereich „Sicherheit“ (UX §12) in fünf Gruppen: Notfall (Telefon der Spielleitung,
 * Notruf, Hinweise), Treffpunkt (Sammel-, Start-, Rettungs- und Versorgungspunkte als Liste),
 * Gelände (Spielfeld, Sperrzonen, „Gibt es nicht“), Begleitung und Kontakt (Betreuer-Pflicht,
 * Lebenszeichen, SOS) und Ausrüstung und Zeit (Pflicht-Ausrüstung mit Vorschlägen, Zeit als Satz –
 * derselbe Wert wie in den Einstellungen). Dazu die Tipp-Karte „Briefing-Station“.
 */

import { useId, useState } from "preact/hooks";
import { isPoint } from "../../../../lib/editor/geo.ts";
import { newStation } from "../../../../lib/editor/stations.ts";
import { getAt } from "../../../../lib/editor/paths.ts";
import { editor, isTouched, shallowArray, useEditorSelect, useFieldValue, useIssuesAt } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { EditorIssue, JsonPointer, Point } from "../../../../lib/editor/types.ts";
import { href, navigate } from "../../../../lib/router.ts";
import { notify } from "../../../../lib/session.ts";
import { Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { addPoint, areaSummary, ZONE_KINDS } from "../map/actions.ts";
import { CoordinateInput } from "../map/CoordinateInput.tsx";
import { removePoint } from "../map/PointPanel.tsx";
import type { SectionProps } from "../sections.ts";
import { Chips } from "../ui/Chips.tsx";
import { DurationInput, minutesLabel } from "../ui/DurationInput.tsx";
import { describedBy, FieldFrame, hasError, useFeld } from "../ui/FieldFrame.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import "../map/editor-map.css";
import "./safety.css";

/** Vorschläge für die Pflicht-Ausrüstung (UX §12). */
export const GEAR_SUGGESTIONS = ["Lampe", "Warnweste", "Erste-Hilfe-Set", "Geladenes Handy", "Trinkflasche"];

/** Erlaubte Zeichen im Telefonfeld (Muster des Formats: Ziffern, Leerzeichen, + ( ) / -). */
export function filterPhone(raw: string): string {
  return raw.replace(/[^0-9 +()/-]/g, "");
}

/** Zeit als Satz, gespiegelt aus den Einstellungen. */
export function timeSentence(limit: string | undefined, duration: number | undefined): string {
  const l = limit ?? "per_team";
  if (l === "none") return "Kein Zeitlimit – die Spielleitung beendet das Spiel.";
  if (typeof duration !== "number") return "Zeitlimit ohne Dauer – bitte die Minuten eintragen.";
  const d = minutesLabel(duration).replace(" Min", " Minuten");
  return l === "global" ? `Spätestens ${d} nach dem Start des Events sind alle Teams fertig.` : `Spätestens ${d} nach ihrem Start sind alle Teams fertig.`;
}

/**
 * Meldungen einer Gruppe sofort, nicht erst nach dem Berühren (Empfehlungen, keine Tippfehler).
 * Mit `field` zeigt sie ein Feld schon selbst, sobald es berührt ist – dann hier nicht doppelt.
 */
function useGroupIssues(paths: JsonPointer[], opts: { codes?: string[]; field?: boolean } = {}): EditorIssue[] {
  return useEditorSelect((s) => {
    const hidden = new Set(s.meta.dismissed ?? []);
    return s.issues.filter((i) => !hidden.has(i.id) && paths.includes(i.at.path) && (!opts.codes || opts.codes.includes(i.code)) && !(opts.field && (s.showAll || isTouched(s.touched, i.at.path))));
  }, shallowArray);
}

export function SafetySection({ gameId }: SectionProps) {
  return (
    <section class="ed-safety stack loose" aria-labelledby="bereich-sicherheit">
      <header class="stack tight">
        <h2 id="bereich-sicherheit" tabIndex={-1}>
          Sicherheit
        </h2>
        <p class="muted">Alles hier steht den Teams in der App zur Verfügung, auch ohne Netz.</p>
      </header>
      <BriefingTip gameId={gameId} />
      <Emergency />
      <MeetingPoints gameId={gameId} />
      <Terrain gameId={gameId} />
      <Supervision />
      <GearAndTime />
    </section>
  );
}

function Emergency() {
  return (
    <section class="card stack" aria-labelledby="sicherheit-notfall">
      <h3 id="sicherheit-notfall">Notfall</h3>
      <PhoneField path="/safety/emergency/gameMasterPhone" label="Telefon der Spielleitung" required hint="Teams sehen die Nummer unter „Notfall“, auch ohne Netz. Beispiel: +49 170 1234567" />
      <PhoneField path="/safety/emergency/emergencyNumber" label="Notruf" placeholder="112" hint="Knopf „Notruf“ in der App. Ohne Eintrag gilt 112." />
      <TextField path="/safety/emergency/notes" label="Hinweise für den Notfall" multiline rows={3} placeholder="z. B. Bei Gewitter alle in die Grillhütte am Parkplatz." />
    </section>
  );
}

/** Telefonnummer: nur erlaubte Zeichen, reine Zeichenkette, Pflicht bleibt als "" stehen. */
function PhoneField({ path, label, hint, placeholder, required }: { path: JsonPointer; label: string; hint?: string; placeholder?: string; required?: boolean }) {
  const id = useId();
  const feld = useFeld(path);
  const store = editor.get().current;
  const raw = useFieldValue<unknown>(path);
  const issues = useIssuesAt(path);
  return (
    <FieldFrame id={id} label={label} hint={hint} required={required} issues={issues} feld={feld}>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={typeof raw === "string" ? raw : ""}
        placeholder={placeholder}
        aria-invalid={hasError(issues) || undefined}
        aria-describedby={describedBy(id, !!hint, issues.length > 0)}
        onInput={(e) => {
          const el = e.currentTarget;
          const v = filterPhone(el.value);
          if (v !== el.value) el.value = v;
          store?.setField(path, v || (required ? "" : undefined), `${label} geändert`, { coalesce: true });
        }}
        onBlur={() => store?.touch(path)}
      />
    </FieldFrame>
  );
}

function MeetingPoints({ gameId }: { gameId: string }) {
  const store = editor.get().current;
  const field = useEditorSelect((s) => s.game.field);
  const lang = useEditorSelect((s) => s.lang);
  const groupIssues = useGroupIssues(["/field/rescuePoints"]);
  const ap = field?.assemblyPoint;
  const toMap = (feld: string) => navigate(href("editorSection", { gameId, section: "karte" }, { feld }));
  const anchor: Point | null = isPoint(ap?.location) ? ap!.location : null;
  const add = (kind: "rescue" | "supply") => {
    if (!anchor) return notify("Erst den Sammelpunkt auf der Karte setzen.", "warn");
    store?.update(kind === "rescue" ? "Rettungspunkt angelegt" : "Versorgungspunkt angelegt", (g) => void addPoint(g, kind, anchor));
    notify("Angelegt am Sammelpunkt – bitte den Ort anpassen (Karte oder Koordinaten).", "ok");
  };
  return (
    <section class="card stack" aria-labelledby="sicherheit-treffpunkt">
      <h3 id="sicherheit-treffpunkt">Treffpunkt</h3>
      <div class="stack tight ed-safety-point">
        <h4 class="label">Sammelpunkt</h4>
        <TextField path="/field/assemblyPoint/name" label="Name" hint="Die App sagt: „Geht zum Sammelpunkt: …“" />
        <TextField path="/field/assemblyPoint/description" label="Beschreibung" multiline rows={2} />
        <PointLocation path="/field/assemblyPoint/location" label="Ort des Sammelpunkts" onMap={() => toMap("field.assemblyPoint")} />
      </div>
      <label class="check">
        <input
          type="checkbox"
          checked={!isPoint(field?.start)}
          disabled={!anchor && !isPoint(field?.start)}
          onChange={(e) => {
            if (e.currentTarget.checked) store?.setField("/field/start", undefined, "Startpunkt wie Sammelpunkt");
            else if (anchor) store?.setField("/field/start", { ...anchor }, "Eigener Startpunkt");
          }}
        />
        <span>Startpunkt wie Sammelpunkt</span>
      </label>
      {isPoint(field?.start) && <PointLocation path="/field/start" label="Startpunkt" onMap={() => toMap("field.start")} />}
      <PointList kind="rescue" title="Rettungspunkte und Zufahrten" points={field?.rescuePoints} lang={lang} onMap={toMap} />
      <IssueList issues={groupIssues} />
      <PointList kind="supply" title="Versorgungspunkte" points={field?.supplyPoints} lang={lang} onMap={toMap} hint="Zeigt die App derzeit nicht an; hilft beim Aufbau." />
      <span class="row">
        <button type="button" class="btn small" onClick={() => add("rescue")}>
          + Rettungspunkt
        </button>
        <button type="button" class="btn small" onClick={() => add("supply")}>
          + Versorgungspunkt
        </button>
      </span>
    </section>
  );
}

function PointLocation({ path, label, onMap }: { path: JsonPointer; label: string; onMap: () => void }) {
  const store = editor.get().current;
  const value = useFieldValue<Point>(path);
  const issues = useIssuesAt(path);
  const feld = useFeld(path);
  return (
    <CoordinateInput
      value={isPoint(value) ? value : null}
      label={label}
      feld={feld}
      issues={issues}
      onChange={(p) => store?.setField(path, p, `${label} versetzt`)}
      onBlur={() => store?.touch(path)}
      onShow={onMap}
    />
  );
}

function PointList({
  kind,
  title,
  points,
  lang,
  onMap,
  hint,
}: {
  kind: "rescue" | "supply";
  title: string;
  points: { name?: unknown; location?: Point }[] | undefined;
  lang: string;
  onMap: (feld: string) => void;
  hint?: string;
}) {
  const key = kind === "rescue" ? "rescuePoints" : "supplyPoints";
  const list = Array.isArray(points) ? points : [];
  return (
    <div class="stack tight">
      <h4 class="label">{title}</h4>
      {hint && <p class="small muted">{hint}</p>}
      {!list.length && <p class="small muted">Noch keine.</p>}
      {list.map((p, i) => {
        const name = readText(p?.name as never, lang) || `${kind === "rescue" ? "Rettungspunkt" : "Versorgungspunkt"} ${i + 1}`;
        return (
          <details key={i} class="ed-more ed-safety-item">
            <summary>
              <span class={`ed-sym${kind === "rescue" ? " rescue" : ""}`} aria-hidden="true">
                {kind === "rescue" ? "+" : "◍"}
              </span>{" "}
              {name}
            </summary>
            <div class="stack tight">
              <TextField path={`/field/${key}/${i}/name`} label="Name" />
              <TextField path={`/field/${key}/${i}/description`} label="Beschreibung" multiline rows={2} />
              <PointLocation path={`/field/${key}/${i}/location`} label="Ort" onMap={() => onMap(`field.${key}.${i}`)} />
              <span class="row">
                <button type="button" class="btn small" onClick={() => removePoint(kind, i, name)}>
                  Löschen
                </button>
              </span>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function Terrain({ gameId }: { gameId: string }) {
  const store = editor.get().current;
  const field = useEditorSelect((s) => s.game.field);
  const noZones = useEditorSelect((s) => s.meta.noZones === true);
  const lang = useEditorSelect((s) => s.lang);
  const issues = useGroupIssues(["/field/restrictedZones", "/field/boundary"]);
  const zones = (field?.restrictedZones ?? []).filter((z) => z && typeof z === "object");
  const toMap = (query: Record<string, string>) => navigate(href("editorSection", { gameId, section: "karte" }, query));
  return (
    <section class="card stack" aria-labelledby="sicherheit-gelaende">
      <h3 id="sicherheit-gelaende">Gelände</h3>
      <p class="row between" data-feld="field.boundary">
        <span>
          <span class="label">Spielfeld</span> {areaSummary(field?.boundary)}
        </span>
        <button type="button" class="btn small" onClick={() => toMap({ feld: "field.boundary" })}>
          <Icon name="map" /> Auf der Karte
        </button>
      </p>
      <div class="stack tight" data-feld="field.restrictedZones">
        <h4 class="label">Sperrzonen</h4>
        {zones.length ? (
          <ul class="ed-map-items">
            {zones.map((z) => (
              <li key={z.id} class="row between nowrap" data-objekt={z.id}>
                <span class="min0">
                  <span class="ed-sym zone" aria-hidden="true">
                    {ZONE_KINDS[z.kind ?? "other"]?.symbol ?? "▨"}
                  </span>{" "}
                  {readText(z.name as never, lang) || z.id}
                  <span class="small muted">
                    {" "}
                    · {z.kind ? ZONE_KINDS[z.kind]?.label : "Art offen"} · Warnung ab {typeof z.warnDistance === "number" ? z.warnDistance : 15} m
                  </span>
                </span>
                <button type="button" class="btn small" onClick={() => toMap({ objekt: z.id })}>
                  <Icon name="map" /> Auf der Karte
                </button>
              </li>
            ))}
          </ul>
        ) : noZones ? (
          <p class="small muted row between">
            <span>Ihr habt angegeben: Hier gibt es keine Straßen, Gewässer oder Abhänge.</span>
            <button type="button" class="btn small ghost" onClick={() => store?.update("Sperrzonen doch prüfen", (_g, m) => void delete m.noZones)}>
              Doch prüfen
            </button>
          </p>
        ) : (
          <p class="small muted">Keine Sperrzonen eingezeichnet. Gibt es Straßen, Bäche oder Hänge in der Nähe?</p>
        )}
        <IssueList issues={issues} />
        <span class="row">
          <button type="button" class="btn small" onClick={() => toMap({})}>
            + Sperrzone zeichnen
          </button>
        </span>
      </div>
    </section>
  );
}

function Supervision() {
  const expert = useEditorSelect((s) => s.expert);
  const ownSms = useEditorSelect((s) => typeof getAt(s.game, "/safety/sos/smsFallback") === "string");
  const [own, setOwn] = useState(ownSms);
  const store = editor.get().current;
  const supervisorIssues = useGroupIssues(["/safety/requireSupervisor"], { codes: ["supervisor_off_minors"], field: true });
  const smsIssues = useGroupIssues(["/safety/sos/smsFallback"], { codes: ["sms_fallback_missing"], field: true });
  return (
    <section class="card stack" aria-labelledby="sicherheit-begleitung">
      <h3 id="sicherheit-begleitung">Begleitung und Kontakt</h3>
      <Toggle path="/safety/requireSupervisor" label="Betreuer-Pflicht" defaultValue={true} hint="Minderjährige Teams starten erst, wenn ein Betreuer die PIN eingibt." />
      <IssueList issues={supervisorIssues} />
      <div class="stack tight">
        <h4 class="label">Lebenszeichen</h4>
        <Toggle path="/safety/heartbeat/enabled" label="Teams bestätigen regelmäßig, dass alles in Ordnung ist" defaultValue={true} />
        <div class="grid-2">
          <DurationInput path="/safety/heartbeat/interval" label="Alle" placeholder={900} min={1} />
          <DurationInput path="/safety/heartbeat/grace" label="Nachfrist" placeholder={300} min={0} hint="Danach warnt der Leitstand." />
        </div>
      </div>
      <div class="stack tight">
        <h4 class="label">SOS</h4>
        <label class="check">
          <input
            type="checkbox"
            checked={!own && !ownSms}
            onChange={(e) => {
              const same = e.currentTarget.checked;
              setOwn(!same);
              if (same) store?.setField("/safety/sos/smsFallback", undefined, "SOS-SMS an das Telefon der Spielleitung");
            }}
          />
          <span>SOS-SMS ohne Netz an das Telefon der Spielleitung</span>
        </label>
        {(own || ownSms) && <PhoneField path="/safety/sos/smsFallback" label="SMS-Rückfall-Nummer" hint="Nummer eures SMS-Gateways, das SOS-SMS an den Leitstand weiterleitet." />}
        <IssueList issues={smsIssues} />
        <Toggle path="/safety/sos/loudSignal" label="Lautes Signal beim SOS" defaultValue={true} hint="Derzeit ohne Wirkung in der App." />
        {expert && <Toggle path="/safety/sos/lora" label="LoRa-Funk" defaultValue={false} hint="Derzeit ohne Wirkung in der App." />}
      </div>
    </section>
  );
}

function GearAndTime() {
  const store = editor.get().current;
  const lang = useEditorSelect((s) => s.lang);
  const gear = useEditorSelect((s) => (s.game.safety?.requiredGear ?? []).map((g) => readText(g as never, s.lang).toLowerCase()), shallowArray);
  const limit = useEditorSelect((s) => s.game.settings?.time?.limit);
  const duration = useEditorSelect((s) => s.game.settings?.time?.duration);
  const gearIssues = useGroupIssues(["/safety/requiredGear"], { codes: ["night_no_gear"], field: true });
  const missing = GEAR_SUGGESTIONS.filter((g) => !gear.includes(g.toLowerCase()));
  const limitId = useId();
  return (
    <section class="card stack" aria-labelledby="sicherheit-ausruestung">
      <h3 id="sicherheit-ausruestung">Ausrüstung und Zeit</h3>
      <Chips path="/safety/requiredGear" label="Pflicht-Ausrüstung" text placeholder="z. B. Lampe" hint="Teams haken alles in der App ab, bevor sie starten. Enter oder Komma trennt." />
      {missing.length > 0 && (
        <p class="row ed-gear-suggest">
          <span class="small muted">Vorschläge:</span>
          {missing.map((g) => (
            <button
              key={g}
              type="button"
              class="btn small ghost"
              onClick={() => {
                store?.update(`Pflicht-Ausrüstung ergänzt: ${g}`, (game) => {
                  game.safety ??= { emergency: { gameMasterPhone: "" } };
                  game.safety.requiredGear = [...(game.safety.requiredGear ?? []), { [lang]: g }];
                });
                store?.touch("/safety/requiredGear");
              }}
            >
              + {g}
            </button>
          ))}
        </p>
      )}
      <IssueList issues={gearIssues} />
      <div class="stack tight" data-feld="settings.time">
        <h4 class="label">Zeit</h4>
        <p class="ed-time-sentence">{timeSentence(limit, duration)}</p>
        <div class="grid-2">
          <div class="field">
            <label for={limitId}>Zeitlimit</label>
            <select
              id={limitId}
              value={limit ?? "per_team"}
              onChange={(e) => {
                const v = e.currentTarget.value;
                store?.setField("/settings/time/limit", v === "per_team" && limit === undefined ? undefined : v, `Zeitlimit: ${v === "none" ? "keins" : v === "global" ? "für alle" : "je Team"}`);
              }}
            >
              <option value="per_team">je Team</option>
              <option value="global">für alle gemeinsam</option>
              <option value="none">keins</option>
            </select>
          </div>
          {limit !== "none" && <DurationInput path="/settings/time/duration" label="Dauer" min={1} />}
        </div>
        <p class="small muted">Derselbe Wert wie in den Einstellungen – geändert wird er an einer Stelle.</p>
      </div>
    </section>
  );
}

/** Tipp-Karte: erste Station als Sicherheits-Briefing (UX §12). */
function BriefingTip({ gameId }: { gameId: string }) {
  const store = editor.get().current;
  const has = useEditorSelect((s) => (s.game.stations ?? []).some((st) => /briefing/i.test(`${st?.id ?? ""} ${readText(st?.name as never, s.lang)}`)));
  const anchor = useEditorSelect((s) => s.game.field?.assemblyPoint?.location);
  const [hidden, setHidden] = useState(false);
  if (has || hidden) return null;
  const add = () => {
    let id = "";
    store?.update("Briefing-Station angelegt", (g) => {
      const st = newStation("briefing", "Sicherheits-Briefing", g, isPoint(anchor) ? { location: anchor } : {});
      id = st.id;
      g.stations = [st, ...(Array.isArray(g.stations) ? g.stations : [])];
    });
    notify("Briefing-Station als erste Station angelegt.", "ok");
    if (id) navigate(href("editorStation", { gameId, stationId: id }));
  };
  return (
    <aside class="notice stack tight ed-tip" aria-label="Tipp">
      <p>
        <strong>Tipp:</strong> Erste Station als Sicherheits-Briefing? Teams wiederholen dort die Regeln, bevor es losgeht.
      </p>
      <span class="row">
        <button type="button" class="btn small primary" onClick={add}>
          Briefing-Station hinzufügen
        </button>
        <button type="button" class="btn small ghost" onClick={() => setHidden(true)}>
          Nicht jetzt
        </button>
        <Link to={href("editorSection", { gameId, section: "karte" })} class="btn small ghost">
          Zur Karte
        </Link>
      </span>
    </aside>
  );
}
