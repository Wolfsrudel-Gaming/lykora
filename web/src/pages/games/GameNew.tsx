/**
 * Paket E: Assistent „Neues Spiel“ (UX §4.3, W2) in sechs Schritten: Vorlage, Name, Spielwelt,
 * Zielgruppe, Ort, Dauer und Notfall. Jeder Schritt ist mit der Vorlage vorbelegt, „Zurück“
 * verliert nichts. Ergebnis ist ein Entwurf ohne Version (createDraftGame), danach geht es in den
 * Baukasten. Ohne Telefon ist das Spiel angelegt, die Nummer steht dann als Fehler in der Checkliste.
 */

import type { ComponentType } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatPoint, parseCoordinates, stationPoint } from "../../lib/editor/geo.ts";
import { relocateGame } from "../../lib/editor/relocate.ts";
import { readText } from "../../lib/editor/text.ts";
import { EXAMPLE_GAME, TEMPLATES, type TemplateId, type TemplateInfo } from "../../lib/editor/templates/index.ts";
import { AGE_LABELS, buildGame, defaultChoices, GENRE_LABELS, MINORS, RADIUS_MAX, RADIUS_MIN, type AgeGroup, type Genre, type MapStyle, type TimeLimit, type WizardChoices } from "../../lib/editor/templates/wizard.ts";
import type { Game, Point } from "../../lib/editor/types.ts";
import { can } from "../../lib/roles.ts";
import { href, navigate, useLocation } from "../../lib/router.ts";
import { api, currentOrg, errorText, notify, session } from "../../lib/session.ts";
import { useStore } from "../../lib/store.ts";
import { Field, Link, Loading, useTitle } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import type { PlaceMapProps } from "./editor/publish/PlaceMap.tsx";
import { worldOf } from "./editor/station/world.ts";
import "./editor/publish/publish.css";

type Source = TemplateId | "beispiel";

const STEPS = ["Vorlage", "Name", "Spielwelt", "Zielgruppe", "Ort", "Dauer und Notfall"];

const GENRES: Genre[] = ["other", "crime", "mystery", "agents", "rescue"];
const AGES: AgeGroup[] = ["6-9", "10-13", "14-17", "adult"];
const SCARE = ["kein Grusel", "ein bisschen unheimlich – passt ab 10", "gruselig – eher ab 14", "richtig gruselig – nur für Erwachsene"];
const STYLES: Record<MapStyle, string> = { standard: "Standard", topo: "Wanderkarte", treasure: "Schatzkarte" };
const LIMITS: Record<TimeLimit, { label: string; hint: string }> = {
  per_team: { label: "je Team", hint: "Die Uhr läuft ab dem Start des Teams." },
  global: { label: "für alle", hint: "Eine Uhr für alle ab dem Start des Events." },
  none: { label: "ohne Zeitlimit", hint: "Teams lassen sich Zeit, bis das Event endet." },
};
const PHONE = /^\+?[0-9 ()/-]{5,}$/;

/** „Für 90 Minuten passen 8–12 Stationen“: 7,5 bis 11,25 Minuten je Station. */
export function stationsFor(minutes: number): [number, number] {
  return [Math.max(1, Math.round(minutes / 11.25)), Math.max(1, Math.round(minutes / 7.5))];
}

const minutes = (seconds: number) => Math.round(seconds / 60);

function usePlaceMap(): ComponentType<PlaceMapProps> | null {
  const [comp, setComp] = useState<ComponentType<PlaceMapProps> | null>(null);
  useEffect(() => {
    let alive = true;
    void import("./editor/publish/PlaceMap.tsx").then((m) => alive && setComp(() => m.PlaceMap));
    return () => {
      alive = false;
    };
  }, []);
  return comp;
}

export function GameNewPage() {
  useTitle("Neues Spiel");
  const s = useStore(session);
  const loc = useLocation();
  const preset = TEMPLATES.find((t) => t.id === loc.query.get("vorlage"))?.id;
  const [step, setStep] = useState(preset ? 2 : 1);
  const [sourceId, setSourceId] = useState<Source>(preset ?? "kinder-schnitzeljagd");
  const [source, setSource] = useState<Game | null>(null);
  const [choices, setChoices] = useState<WizardChoices | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const write = can(currentOrg()?.role, "game.write");

  // Vorlage laden; Ort, Radius und Telefon bleiben beim Wechsel.
  useEffect(() => {
    let alive = true;
    const info = TEMPLATES.find((t) => t.id === sourceId);
    void (info ? info.load() : EXAMPLE_GAME()).then((game) => {
      if (!alive) return;
      setSource(game);
      setChoices((prev) => ({ ...defaultChoices(game), ...(prev ? { place: prev.place, phone: prev.phone } : {}) }));
    });
    return () => {
      alive = false;
    };
  }, [sourceId]);

  // Schrittwechsel: Fokus auf die Überschrift des Schritts.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setProblem(null);
    heading.current?.focus();
  }, [step]);

  if (!write) {
    return (
      <div class="page narrow stack">
        <h1>Neues Spiel</h1>
        <p>Neue Spiele legen Admins und Autorinnen und Autoren an.</p>
        <p>
          <Link to={href("games")} class="btn">
            Zu den Spielen
          </Link>
        </p>
      </div>
    );
  }

  const set = (patch: Partial<WizardChoices>) => {
    setProblem(null);
    setChoices((c) => (c ? { ...c, ...patch } : c));
  };
  const info = TEMPLATES.find((t) => t.id === sourceId);

  const next = () => {
    if (!choices) return;
    if (step === 2 && !choices.title.trim()) return setProblem("Gib dem Spiel einen Namen.");
    if (step === 4 && choices.teamMin > choices.teamMax) return setProblem("Die Mindestgröße ist größer als die Höchstgröße.");
    if (step === 5 && !choices.place) return setProblem("Setz zuerst einen Punkt auf der Karte. Ohne Ort gibt es kein Spielfeld.");
    setStep(step + 1);
  };

  const create = async () => {
    if (!source || !choices?.place || !s.orgId) return;
    setBusy(true);
    setProblem(null);
    try {
      const { game, meta } = buildGame(source, { ...choices, place: choices.place }, { templateId: sourceId, localTasks: info?.localTasks ?? [] });
      const created = await api.createDraftGame(s.orgId, { content: game, meta: { ...meta } });
      notify("Spiel angelegt. Alles wird automatisch gespeichert.", "ok");
      navigate(href("editor", { gameId: created.id }));
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div class="page stack loose wizard">
      <div>
        <nav class="crumbs" aria-label="Pfad">
          <Link to={href("games")}>Spiele</Link>
        </nav>
        <h1>Neues Spiel</h1>
      </div>
      <ol class="wizard-steps" aria-label="Schritte">
        {STEPS.map((label, i) => (
          <li key={label} class={i + 1 < step ? "done" : i + 1 === step ? "current" : ""} aria-current={i + 1 === step ? "step" : undefined}>
            <span class="wizard-dot" aria-hidden="true">
              {i + 1 < step ? "✓" : i + 1}
            </span>
            <span class="wizard-step-label">{label}</span>
          </li>
        ))}
      </ol>
      <form
        class="card stack wizard-body"
        aria-labelledby="wizard-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length) next();
          else void create();
        }}
      >
        <p class="label">
          Schritt {step} von {STEPS.length} · {STEPS[step - 1]}
        </p>
        {!choices || !source ? (
          <Loading text="Vorlage lädt …" />
        ) : (
          <>
            {step === 1 && <StepTemplate headingRef={heading} value={sourceId} onChange={setSourceId} />}
            {step === 2 && <StepName headingRef={heading} choices={choices} set={set} />}
            {step === 3 && <StepWorld headingRef={heading} choices={choices} set={set} />}
            {step === 4 && <StepAudience headingRef={heading} choices={choices} set={set} />}
            {step === 5 && <StepPlace headingRef={heading} choices={choices} set={set} source={source} />}
            {step === 6 && <StepDuration headingRef={heading} choices={choices} set={set} />}
            {step === 6 && <Summary choices={choices} template={info?.title ?? "Beispiel „Sturmnacht“"} />}
          </>
        )}
        {problem && (
          <p class="notice error" role="alert">
            {problem}
          </p>
        )}
        <div class="form-actions wizard-actions">
          {step > 1 ? (
            <button type="button" class="btn" onClick={() => setStep(step - 1)}>
              Zurück
            </button>
          ) : (
            <Link to={href("games")} class="btn">
              Abbrechen
            </Link>
          )}
          <button type="submit" class="btn primary" disabled={busy || !choices}>
            {step < STEPS.length ? "Weiter" : busy ? "Lege an …" : "Spiel anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}

type StepProps = { headingRef: { current: HTMLHeadingElement | null }; choices: WizardChoices; set: (patch: Partial<WizardChoices>) => void };

function StepTemplate({ headingRef, value, onChange }: { headingRef: StepProps["headingRef"]; value: Source; onChange: (id: Source) => void }) {
  const [looking, setLooking] = useState<TemplateId | null>(null);
  return (
    <fieldset class="stack">
      <legend>
        <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
          Womit willst du anfangen?
        </h2>
      </legend>
      <div class="wizard-cards">
        {TEMPLATES.map((t) => (
          <div key={t.id} class={`wizard-card${value === t.id ? " chosen" : ""}`}>
            <label class="wizard-choice">
              <input type="radio" name="vorlage" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} />
              <span class="stack tight">
                <strong class="wizard-card-title">
                  {t.title} {t.subtitle !== "alles selbst" ? t.subtitle : ""}
                </strong>
                <span class="small muted">
                  {t.ageGroups} · {t.night ? "Nacht" : "Tag"} · {t.duration}
                </span>
                <span class="small">{t.blurb}</span>
              </span>
            </label>
            {t.id !== "leer" && (
              <button type="button" class="btn small ghost" aria-expanded={looking === t.id} onClick={() => setLooking(looking === t.id ? null : t.id)}>
                Ansehen
              </button>
            )}
            {looking === t.id && <TemplatePeek info={t} />}
          </div>
        ))}
      </div>
      <label class="check">
        <input type="radio" name="vorlage" value="beispiel" checked={value === "beispiel"} onChange={() => onChange("beispiel")} />
        Beispiel „Sturmnacht“ – ein fertiges Nachtspiel zum Anschauen und Ausprobieren
      </label>
      <p class="small muted">
        Ein bestehendes Spiel kopierst du in der <Link to={href("games")}>Spiele-Liste</Link> über „⋯ › Duplizieren“.
      </p>
    </fieldset>
  );
}

/** „Ansehen“: Stationen und zwei Beispieltexte der Vorlage. */
function TemplatePeek({ info }: { info: TemplateInfo }) {
  const [game, setGame] = useState<Game | null>(null);
  useEffect(() => void info.load().then(setGame), [info.id]);
  if (!game) return <Loading />;
  const lang = game.meta.languages[0] ?? "de";
  const sample = game.stations.find((s) => s.task)?.task;
  return (
    <div class="wizard-peek stack tight">
      <p class="small">„{readText(game.story?.intro?.text as never, lang)}“</p>
      <ol class="small">
        {game.stations.map((s) => (
          <li key={s.id}>
            {readText(s.name as never, lang)}
            {s.final ? " (Finale)" : ""}
          </li>
        ))}
      </ol>
      {sample && "question" in sample && <p class="small muted">Beispiel-Rätsel: „{readText(sample.question as never, lang)}“</p>}
    </div>
  );
}

function StepName({ headingRef, choices, set }: StepProps) {
  return (
    <div class="stack">
      <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
        Wie heißt euer Spiel?
      </h2>
      <Field label="Name des Spiels" hint="Teams sehen den Namen beim Beitreten. Ändern geht jederzeit.">
        <input required maxLength={120} value={choices.title} onInput={(e) => set({ title: e.currentTarget.value })} />
      </Field>
      <Field label="Kurzbeschreibung (optional)" hint="Ein, zwei Sätze für die Spiele-Liste und die App.">
        <textarea rows={3} maxLength={400} value={choices.summary} onInput={(e) => set({ summary: e.currentTarget.value })} />
      </Field>
    </div>
  );
}

function StepWorld({ headingRef, choices, set }: StepProps) {
  const kids = choices.ageGroups.includes("6-9");
  return (
    <div class="stack">
      <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
        In welcher Welt spielt ihr?
      </h2>
      <p class="muted">Das ändert Farben, Schrift und wie die App Dinge nennt.</p>
      <fieldset class="wizard-cards five">
        <legend class="sr-only">Spielwelt</legend>
        {GENRES.map((g) => {
          const w = worldOf({ meta: { genre: g, languages: ["de"] } } as Game);
          return (
            <label key={g} class={`wizard-card wizard-choice${choices.genre === g ? " chosen" : ""}`}>
              <input type="radio" name="welt" checked={choices.genre === g} onChange={() => set({ genre: g })} />
              <span class="stack tight">
                <strong class="wizard-card-title">{GENRE_LABELS[g]}</strong>
                <span class="small muted">
                  {w.device} · {w.caseFile} · „{w.stamp}“
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <label class="check">
        <input type="checkbox" checked={choices.night} onChange={(e) => set({ night: e.currentTarget.checked })} />
        Nachtspiel (dunkles Thema in der App, keine Schnelligkeitspunkte)
      </label>
      <div class="grid-2">
        <Field label="Grusel" hint={kids && choices.scareLevel >= 2 ? "Für 6- bis 9-Jährige ist das zu gruselig." : SCARE[choices.scareLevel]}>
          <select value={choices.scareLevel} onChange={(e) => set({ scareLevel: Number(e.currentTarget.value) })}>
            {SCARE.map((label, n) => (
              <option key={n} value={n}>
                Stufe {n}: {label.split(" – ")[0]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kartenstil">
          <select value={choices.mapStyle} onChange={(e) => set({ mapStyle: e.currentTarget.value as MapStyle })}>
            {(Object.keys(STYLES) as MapStyle[]).map((k) => (
              <option key={k} value={k}>
                {STYLES[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function StepAudience({ headingRef, choices, set }: StepProps) {
  const toggle = (a: AgeGroup, on: boolean) => set({ ageGroups: on ? AGES.filter((x) => x === a || choices.ageGroups.includes(x)) : choices.ageGroups.filter((x) => x !== a) });
  const minors = choices.ageGroups.some((a) => MINORS.includes(a));
  return (
    <div class="stack">
      <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
        Wer spielt mit?
      </h2>
      <fieldset class="stack tight">
        <legend>Altersgruppen</legend>
        <div class="row wrap">
          {AGES.map((a) => (
            <label key={a} class="check">
              <input type="checkbox" checked={choices.ageGroups.includes(a)} onChange={(e) => toggle(a, e.currentTarget.checked)} />
              {AGE_LABELS[a]}
            </label>
          ))}
        </div>
      </fieldset>
      <p class="small muted">
        Spielen nur Kinder von 6 bis 9, zeigt die App eine große Fibelschrift und liest Geschichten und Rätsel automatisch vor. Bei gemischten Gruppen entscheidet jedes Team in der App selbst über
        Vorlesen und große Schrift.
      </p>
      {minors && <p class="small">Bei Minderjährigen ist die Betreuer-Pflicht an: Ein Team startet erst, wenn eine Betreuerin oder ein Betreuer die PIN eingibt.</p>}
      <div class="grid-2">
        <Field label="Teamgröße mindestens">
          <input type="number" min={1} max={20} inputMode="numeric" value={choices.teamMin} onInput={(e) => set({ teamMin: Math.max(1, Number(e.currentTarget.value) || 1) })} />
        </Field>
        <Field label="Teamgröße höchstens">
          <input type="number" min={1} max={20} inputMode="numeric" value={choices.teamMax} onInput={(e) => set({ teamMax: Math.max(1, Number(e.currentTarget.value) || 1) })} />
        </Field>
      </div>
    </div>
  );
}

function StepPlace({ headingRef, choices, set, source }: StepProps & { source: Game }) {
  const PlaceMap = usePlaceMap();
  const [paste, setPaste] = useState(false);
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Die Stationen der Vorlage am gewählten Ort, so wie der Assistent sie umzieht.
  const stations = useMemo(() => {
    if (!choices.place) return [];
    const b = source.field.boundary;
    const moved = relocateGame(source, source.field.assemblyPoint.location, choices.place, choices.radius / ("radius" in b ? b.radius : 300));
    return moved.stations.flatMap((s, i) => {
      const p = stationPoint(s);
      return p ? [{ point: p, label: s.final ? "★" : String(i + 1) }] : [];
    });
  }, [choices.place?.lat, choices.place?.lon, choices.radius, source]);

  const locate = () => {
    setNote(null);
    if (!navigator.geolocation) return setNote("Dieser Browser kennt keinen Standort. Gib Koordinaten ein oder klick in die Karte.");
    setNote("Suche deinen Standort …");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ place: { lat: Math.round(pos.coords.latitude * 1e7) / 1e7, lon: Math.round(pos.coords.longitude * 1e7) / 1e7 } });
        setNote(`Standort übernommen (± ${Math.round(pos.coords.accuracy)} m).`);
      },
      () => setNote("Standort nicht freigegeben. Gib Koordinaten ein oder klick in die Karte."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const take = () => {
    const p = parseCoordinates(raw);
    if (!p) return setNote("Diese Koordinaten kann ich nicht lesen. Beispiel: 50.8155, 7.155");
    set({ place: p });
    setPaste(false);
    setNote(null);
  };

  return (
    <div class="stack">
      <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
        Wo wird gespielt?
      </h2>
      <p class="muted">Klick in die Karte, um den Sammelpunkt zu setzen. Die Stationen der Vorlage verteilen wir grob drumherum; du schiebst sie danach an die echten Stellen.</p>
      <div class="row wrap">
        <button type="button" class="btn" onClick={locate}>
          <Icon name="pin" /> Mein Standort
        </button>
        <button type="button" class="btn" aria-expanded={paste} onClick={() => setPaste(!paste)}>
          Koordinaten …
        </button>
      </div>
      {paste && (
        <div class="row wrap end wizard-paste">
          <Field label="Koordinaten" hint="z. B. 50.8155, 7.155 oder 50°48'55.8&quot;N 7°09'18.0&quot;E – etwa aus einer Karten-App kopiert">
            <input
              value={raw}
              onInput={(e) => setRaw(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  take();
                }
              }}
            />
          </Field>
          <button type="button" class="btn" onClick={take}>
            Übernehmen
          </button>
        </div>
      )}
      {note && (
        <p class="small" role="status">
          {note}
        </p>
      )}
      {PlaceMap ? (
        <PlaceMap place={choices.place} radius={choices.radius} stations={stations} onPlace={(p: Point) => set({ place: p })} />
      ) : (
        <div class="map-wrap wizard-map-wait" aria-busy="true" />
      )}
      <div class="grid-2">
        <Field label={`Spielfeld: Kreis mit ${choices.radius} m Radius`}>
          <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={50} value={choices.radius} onInput={(e) => set({ radius: Number(e.currentTarget.value) })} />
        </Field>
        <Field label="Name des Sammelpunkts" hint={choices.place ? `Sammelpunkt: ${formatPoint(choices.place)}` : "Noch kein Punkt gesetzt."}>
          <input maxLength={80} value={choices.placeName} onInput={(e) => set({ placeName: e.currentTarget.value })} placeholder="z. B. Haupteingang am Parkplatz" />
        </Field>
      </div>
    </div>
  );
}

function StepDuration({ headingRef, choices, set }: StepProps) {
  const min = minutes(choices.duration);
  const [from, to] = stationsFor(min);
  const later = !choices.phone.trim();
  const phoneOk = later || PHONE.test(choices.phone.trim());
  return (
    <div class="stack">
      <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
        Wie lange, und wer hilft im Notfall?
      </h2>
      <Field label={`Geplante Dauer: ${min} Minuten`} hint={`Für ${min} Minuten passen etwa ${from}–${to} Stationen.`}>
        <input type="range" min={15} max={240} step={15} value={min} onInput={(e) => set({ duration: Number(e.currentTarget.value) * 60 })} />
      </Field>
      <fieldset class="stack tight">
        <legend>Zeitlimit</legend>
        {(Object.keys(LIMITS) as TimeLimit[]).map((k) => (
          <label key={k} class="check">
            <input type="radio" name="zeitlimit" checked={choices.limit === k} onChange={() => set({ limit: k })} />
            <span>
              {LIMITS[k].label} <span class="small muted">– {LIMITS[k].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Telefon der Spielleitung" hint={phoneOk ? "Unter welcher Handynummer erreichen Teams die Spielleitung? Die Nummer steht in der App unter „Notfall“ und funktioniert auch ohne Netz." : "Bitte nur Ziffern, Leerzeichen und + ( ) / -, z. B. +49 170 1234567."}>
        <input type="tel" inputMode="tel" autoComplete="tel" value={choices.phone} placeholder="+49 170 1234567" aria-invalid={!phoneOk || undefined} onInput={(e) => set({ phone: e.currentTarget.value.replace(/[^0-9 +()/-]/g, "") })} />
      </Field>
      <div class="row wrap">
        <button type="button" class="btn small" disabled={later} onClick={() => set({ phone: "" })}>
          Später eintragen
        </button>
        {later && <span class="small muted">Ohne Nummer ist das Spiel angelegt, die Nummer steht dann als offener Punkt in der Checkliste.</span>}
      </div>
    </div>
  );
}

function Summary({ choices, template }: { choices: WizardChoices; template: string }) {
  const ages = choices.ageGroups.map((a) => AGE_LABELS[a]).join(", ") || "alle Altersgruppen";
  return (
    <section class="notice stack tight" aria-labelledby="wizard-summary">
      <h3 id="wizard-summary" class="label">
        So wird es
      </h3>
      <p>
        „{choices.title.trim() || "Neues Spiel"}“ aus der Vorlage „{template}“, Spielwelt {GENRE_LABELS[choices.genre]}, {choices.night ? "nachts" : "am Tag"}, für {ages}, Teams von {Math.min(choices.teamMin, choices.teamMax)} bis{" "}
        {Math.max(choices.teamMin, choices.teamMax)}.
      </p>
      <p>
        Spielfeld {choices.radius} m um den Sammelpunkt{choices.placeName.trim() ? ` „${choices.placeName.trim()}“` : ""}. Geplant {minutes(choices.duration)} Minuten, {LIMITS[choices.limit].label}.
      </p>
      <p>{choices.phone.trim() ? `Notfall-Telefon: ${choices.phone.trim()}.` : "Das Notfall-Telefon trägst du später ein."}</p>
      <p class="small muted">Als Nächstes: Stationen an die echten Stellen setzen.</p>
    </section>
  );
}
