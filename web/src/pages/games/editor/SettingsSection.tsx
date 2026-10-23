/**
 * Paket D: Bereich „Einstellungen“ (UX §14). Oben die Spielart als vier Karten (schreibt mode und
 * winCondition), darunter die Feineinstellungen in Sätzen: Zeit, Teams, falsche Antwort, Tipps, Punkte,
 * Rangliste, Karte. Dann die Sprache des Spiels (Wechsel zählt vorher fehlende Texte), Angaben und
 * Experten: Kennung und Formatversion nur lesen, die Expertenansicht zeigt JSON und Rohfelder.
 */

import { useId } from "preact/hooks";
import { countMissing } from "../../../lib/editor/text.ts";
import { editor, useEditorSelect } from "../../../lib/editor/store.ts";
import type { Game } from "../../../lib/editor/types.ts";
import { setQuery } from "../../../lib/router.ts";
import { session } from "../../../lib/session.ts";
import { confirm } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import type { SectionProps } from "./sections.ts";
import { JumpBar, NO_EFFECT, SelectField, store, Tiles, useLiveIssues } from "./story/shared.tsx";
import { Chips } from "./ui/Chips.tsx";
import { DurationInput, minutesLabel } from "./ui/DurationInput.tsx";
import { IssueList } from "./ui/IssueList.tsx";
import { NumberInput } from "./ui/NumberInput.tsx";
import { PenaltyInput } from "./ui/PenaltyInput.tsx";
import { TextField } from "./ui/TextField.tsx";
import { Toggle } from "./ui/Toggle.tsx";

type Settings = Game["settings"];
export type GameMode = "race" | "points" | "clock" | "together";

/** Die vier Spielarten (UX §14) und was sie ins Spiel schreiben; „Gemeinsam“ schlägt die Rangliste erst am Ende vor. */
export const GAME_MODES: { id: GameMode; title: string; text: string; mode: NonNullable<Settings["mode"]>; winCondition?: NonNullable<Settings["winCondition"]>; leaderboard?: Settings["leaderboard"] }[] = [
  { id: "race", title: "Wettlauf", text: "Wer zuerst das Finale löst, gewinnt.", mode: "competitive", winCondition: "first_escape" },
  { id: "points", title: "Punktejagd", text: "Die meisten Punkte gewinnen.", mode: "competitive", winCondition: "most_points" },
  { id: "clock", title: "Gegen die Uhr", text: "Alle Codeteile in der Zeit – die meisten Teile gewinnen.", mode: "time_trial", winCondition: "all_fragments_in_time" },
  { id: "together", title: "Gemeinsam", text: "Alle spielen zusammen, ohne Rangliste während des Spiels.", mode: "cooperative", leaderboard: "end_only" },
];

/** Spielart aus mode und winCondition (mit den Standards des Formats); null bei eigener Kombination. */
export function gameModeOf(game: Game): GameMode | null {
  const mode = game.settings?.mode ?? "competitive";
  if (mode === "cooperative") return "together";
  const win = game.settings?.winCondition ?? "first_escape";
  return GAME_MODES.find((m) => m.mode === mode && m.winCondition === win)?.id ?? null;
}

/** Spielart setzen (in place): mode und winCondition, bei „Gemeinsam“ die Rangliste erst am Ende. */
export function setGameMode(game: Game, id: GameMode): void {
  const m = GAME_MODES.find((x) => x.id === id)!;
  game.settings ??= {};
  game.settings.mode = m.mode;
  if (m.winCondition) game.settings.winCondition = m.winCondition;
  else delete game.settings.winCondition;
  if (m.leaderboard) game.settings.leaderboard = m.leaderboard;
}

/** Sprachen zur Auswahl (Muster `lang` des Formats). */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "de", name: "Deutsch" },
  { code: "en", name: "Englisch" },
  { code: "fr", name: "Französisch" },
  { code: "nl", name: "Niederländisch" },
  { code: "pl", name: "Polnisch" },
  { code: "it", name: "Italienisch" },
  { code: "es", name: "Spanisch" },
  { code: "da", name: "Dänisch" },
  { code: "cs", name: "Tschechisch" },
  { code: "tr", name: "Türkisch" },
];

export const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

/** Standardsprache wechseln (in place): neue vorn, die bisherige fällt weg, weitere bleiben. Texte bleiben unangetastet. */
export function setLanguage(game: Game, code: string): void {
  const rest = (game.meta.languages ?? []).slice(1).filter((l) => l !== code);
  game.meta.languages = [code, ...rest];
}

const PARTS = [
  { id: "einstellungen-spielart", title: "Spielart" },
  { id: "einstellungen-fein", title: "Feineinstellungen" },
  { id: "einstellungen-sprache", title: "Sprache" },
  { id: "einstellungen-angaben", title: "Angaben" },
  { id: "einstellungen-experten", title: "Experten" },
];

export function SettingsSection(_: SectionProps) {
  return (
    <section class="d-section stack loose" aria-labelledby="bereich-einstellungen">
      <header class="stack tight">
        <h2 id="bereich-einstellungen" tabIndex={-1}>
          Einstellungen
        </h2>
        <JumpBar label="Abschnitte der Einstellungen" targets={PARTS} />
      </header>
      <Mode />
      <Fine />
      <Language />
      <Details />
      <Expert />
    </section>
  );
}

function Mode() {
  const current = useEditorSelect((s) => gameModeOf(s.game));
  const noLimit = useEditorSelect((s) => s.game.settings?.time?.limit === "none" || typeof s.game.settings?.time?.duration !== "number");
  return (
    <section class="card stack" aria-labelledby="einstellungen-spielart">
      <h3 id="einstellungen-spielart" tabIndex={-1}>
        Spielart
      </h3>
      <Tiles
        legend="Wie wird gewonnen?"
        feld="settings.mode"
        value={current ?? undefined}
        options={GAME_MODES.map((m) => ({ value: m.id, title: m.title, text: m.text }))}
        onChange={(id) => store().update(`Spielart: ${GAME_MODES.find((m) => m.id === id)!.title}`, (g) => setGameMode(g, id))}
        hint={current === null ? "Eigene Kombination aus der Expertenansicht – eine Karte wählen stellt sie um." : undefined}
      />
      {current === "clock" && noLimit && <p class="notice small">„Gegen die Uhr“ braucht ein Zeitlimit – bitte unten unter „Zeit“ eintragen.</p>}
      <ExpertModes />
    </section>
  );
}

/** Feinsteuerung von mode und winCondition, nur in der Expertenansicht. */
function ExpertModes() {
  const expert = useEditorSelect((s) => s.expert);
  if (!expert) return null;
  return (
    <div class="grid-2 d-expert">
      <SelectField
        path="/settings/mode"
        label="mode"
        defaultValue="competitive"
        options={[
          { value: "competitive", label: "competitive – gegeneinander" },
          { value: "time_trial", label: "time_trial – gegen die Uhr" },
          { value: "cooperative", label: "cooperative – gemeinsam" },
        ]}
      />
      <SelectField
        path="/settings/winCondition"
        label="winCondition"
        defaultValue="first_escape"
        options={[
          { value: "first_escape", label: "first_escape – zuerst am Ziel" },
          { value: "most_points", label: "most_points – meiste Punkte" },
          { value: "all_fragments_in_time", label: "all_fragments_in_time – meiste Codeteile" },
        ]}
        hint="Punkte sehen Teams nur bei „competitive“."
      />
    </div>
  );
}

const LIMITS = [
  { value: "per_team", label: "je Team ab dessen Start" },
  { value: "global", label: "für alle ab Event-Start" },
  { value: "none", label: "kein Zeitlimit" },
];

const LEADERBOARD = [
  { value: "live" as const, title: "Live", text: "Teams sehen die Rangliste während des ganzen Spiels." },
  { value: "live_hidden_last_minutes" as const, title: "Live, Schluss verdeckt", text: "Die letzten 10 Minuten vor Ablauf des Zeitlimits bleibt sie verdeckt." },
  { value: "end_only" as const, title: "Erst am Ende", text: "Teams sehen sie erst nach dem Spiel." },
];

function Fine() {
  const limit = useEditorSelect((s) => s.game.settings?.time?.limit ?? "per_team");
  const duration = useEditorSelect((s) => s.game.settings?.time?.duration);
  const hintsOn = useEditorSelect((s) => s.game.settings?.hints?.enabled !== false);
  const costs = useEditorSelect((s) => (s.game.settings?.hints?.defaultCost ?? []).length);
  const leaderboard = useEditorSelect((s) => s.game.settings?.leaderboard);
  const speedIssues = useLiveIssues(["/settings/scoring/speedBonus"], { field: true });
  const sentence =
    limit === "none"
      ? "Kein Zeitlimit – die Spielleitung beendet das Spiel."
      : typeof duration === "number"
        ? `Spätestens ${minutesLabel(duration).replace(" Min", " Minuten")} nach ${limit === "global" ? "dem Start des Events" : "ihrem Start"} sind alle Teams fertig.`
        : "Ohne Dauer gibt es kein Zeitlimit.";

  const addCost = () =>
    store().update(`Kosten für Tipp ${costs + 1} ergänzt`, (g) => {
      g.settings ??= {};
      g.settings.hints = { ...(g.settings.hints ?? {}), defaultCost: [...(g.settings.hints?.defaultCost ?? []), { type: "time", amount: 60 * (costs + 1) }] };
    });
  const removeCost = () =>
    store().update(`Kosten für Tipp ${costs} entfernt`, (g) => {
      const h = g.settings?.hints;
      if (!h?.defaultCost) return;
      h.defaultCost = h.defaultCost.slice(0, -1);
      if (!h.defaultCost.length) delete h.defaultCost;
      if (!Object.keys(h).length) delete g.settings.hints;
    });

  return (
    <section class="card stack" aria-labelledby="einstellungen-fein">
      <h3 id="einstellungen-fein" tabIndex={-1}>
        Feineinstellungen
      </h3>

      <div class="stack tight d-group">
        <h4 class="label">Zeit</h4>
        <div class="grid-2">
          <SelectField path="/settings/time/limit" label="Zeitlimit" defaultValue="per_team" options={LIMITS} />
          {limit !== "none" && <DurationInput path="/settings/time/duration" label="Dauer" min={1} />}
        </div>
        <p class="small">{sentence}</p>
        <DurationInput path="/meta/expectedDuration" label="Erwartete Spieldauer" hint="Steht in der Übersicht der Spiele, z. B. „etwa 45 Min“." />
      </div>

      <div class="stack tight d-group">
        <h4 class="label">Teams</h4>
        <div class="grid-2">
          <NumberInput path="/settings/teamSize/min" label="Mindestens" unit="Leute" integer min={1} placeholder="2" />
          <NumberInput path="/settings/teamSize/max" label="Höchstens" unit="Leute" integer min={1} placeholder="6" />
        </div>
        <small class="muted">Nur zur Information für die Anmeldung; die App prüft die Größe nicht.</small>
      </div>

      <div class="stack tight d-group">
        <h4 class="label">Falsche Antwort</h4>
        <PenaltyInput path="/settings/wrongAnswer" label="Eine falsche Antwort kostet" optional hint="Standard: nichts. Gilt nicht für Fotos und nicht, wenn die Spielleitung von Hand prüft." />
      </div>

      <div class="stack tight d-group">
        <h4 class="label">Tipps</h4>
        <Toggle path="/settings/hints/enabled" label="Teams dürfen Tipps funken" defaultValue={true} />
        {hintsOn && (
          <>
            {Array.from({ length: costs }, (_, k) => (
              <PenaltyInput key={k} path={`/settings/hints/defaultCost/${k}`} label={`Tipp ${k + 1} kostet`} />
            ))}
            {costs === 0 && <p class="small muted">Tipps kosten nichts, solange eine Station keine eigenen Kosten nennt.</p>}
            <span class="row">
              <button type="button" class="btn small" onClick={addCost}>
                <Icon name="plus" /> Kosten für Tipp {costs + 1}
              </button>
              {costs > 0 && (
                <button type="button" class="btn small ghost" onClick={removeCost}>
                  Letzte Stufe entfernen
                </button>
              )}
            </span>
            <small class="muted">Hat eine Station mehr Tipps als Stufen, sind die übrigen kostenlos.</small>
          </>
        )}
      </div>

      <div class="stack tight d-group" data-feld="settings.scoring">
        <h4 class="label">Punkte</h4>
        <div class="grid-2">
          <NumberInput path="/settings/scoring/solvePoints" label="Punkte je gelöster Station" integer min={0} placeholder="100" />
          <NumberInput path="/settings/scoring/firstOnSiteBonus" label="Bonus für die Ersten" integer min={0} placeholder="0" hint="Je Station, die ein Team als erstes löst; zählt nur in der Rangliste." />
          <NumberInput path="/settings/scoring/streakBonus" label="Serienbonus" integer min={0} placeholder="0" hint="Ab der zweiten Lösung in Folge ohne Fehlversuch und ohne Tipp." />
          <SelectField
            path="/settings/scoring/tieBreak"
            label="Bei Gleichstand gewinnt"
            defaultValue="fewer_hints"
            options={[
              { value: "fewer_hints", label: "wer weniger Tipps brauchte" },
              { value: "earlier_finish", label: "wer früher fertig war" },
            ]}
          />
        </div>
        <Toggle path="/settings/scoring/speedBonus" label="Schnelligkeitspunkte" defaultValue={false} hint={NO_EFFECT} />
        <IssueList issues={speedIssues} />
      </div>

      <div class="stack tight d-group">
        <h4 class="label">Rangliste</h4>
        <Tiles
          legend="Wann sehen Teams die Rangliste?"
          feld="settings.leaderboard"
          value={leaderboard ?? "live"}
          options={LEADERBOARD}
          onChange={(v) => store().setField("/settings/leaderboard", v, `Rangliste: ${LEADERBOARD.find((l) => l.value === v)!.title}`)}
          hint={leaderboard === "live_hidden_last_minutes" && limit === "none" ? "Ohne Zeitlimit wirkt das wie „Live“." : undefined}
        />
        <Toggle path="/settings/showOwnPosition" label="Teams sehen ihre eigene Position auf der Karte" defaultValue={true} />
      </div>

      <div class="stack tight d-group">
        <h4 class="label">Karte in der App</h4>
        <SelectField
          path="/settings/map/style"
          label="Kartenstil"
          defaultValue="standard"
          options={[
            { value: "standard", label: "Standard" },
            { value: "topo", label: "Topografisch" },
            { value: "treasure", label: "Schatzkarte" },
          ]}
          hint={NO_EFFECT}
        />
      </div>
    </section>
  );
}

function Language() {
  const id = useId();
  const languages = useEditorSelect((s) => (s.game.meta?.languages ?? []).join(","));
  const issues = useLiveIssues(["/meta/languages"]);
  const list = languages ? languages.split(",") : [];
  const first = list[0] ?? "de";
  const change = async (code: string) => {
    const s = editor.get().current?.get();
    if (!s || code === first) return;
    const missing = countMissing(s.game, code);
    const name = languageName(code);
    const answer = await confirm({
      title: `Spiel auf ${name} umstellen?`,
      body: (
        <p>
          {missing ? `${missing} ${missing === 1 ? "Text fehlt" : "Texte fehlen"} auf ${name}. Dort zeigt die App den Text in der ersten vorhandenen Sprache.` : `Alle Texte gibt es schon auf ${name}.`} Bearbeitet wird ab
          jetzt {name}; vorhandene Übersetzungen bleiben erhalten.
        </p>
      ),
      confirm: `Auf ${name} umstellen`,
    });
    if (answer.ok) store().update(`Sprache des Spiels: ${name}`, (g) => setLanguage(g, code));
  };
  return (
    <section class="card stack" aria-labelledby="einstellungen-sprache">
      <h3 id="einstellungen-sprache" tabIndex={-1}>
        Sprache
      </h3>
      <div class="field ed-field" data-feld="meta.languages">
        <label for={id}>Sprache des Spiels</label>
        <select id={id} value={first} onChange={(e) => void change(e.currentTarget.value)}>
          {!LANGUAGES.some((l) => l.code === first) && <option value={first}>{first}</option>}
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <small>Die App zeigt alle Texte in dieser Sprache. Weitere Sprachen folgen später mit einer Übersetzungsansicht.</small>
      </div>
      {list.length > 1 && <p class="small">Außerdem im Spiel (nur lesen): {list.slice(1).map(languageName).join(", ")}.</p>}
      <IssueList issues={issues} />
    </section>
  );
}

const LICENSES = [
  { value: "CC-BY-SA-4.0", label: "CC BY-SA 4.0 (empfohlen)" },
  { value: "CC-BY-4.0", label: "CC BY 4.0" },
  { value: "CC0-1.0", label: "CC0 – ohne Bedingungen" },
];

function Details() {
  const me = session.get().user?.name;
  const authors = useEditorSelect((s) => (s.game.meta?.authors ?? []).join("\n"));
  const expert = useEditorSelect((s) => s.expert);
  const addMe = () =>
    store().update(`${me} als Autor eingetragen`, (g) => {
      g.meta.authors = [...(g.meta.authors ?? []), me!];
    });
  return (
    <section class="card stack" aria-labelledby="einstellungen-angaben">
      <h3 id="einstellungen-angaben" tabIndex={-1}>
        Angaben
      </h3>
      <Chips path="/meta/authors" label="Autorinnen und Autoren" placeholder="Name" commaSeparates />
      {me && !authors.split("\n").includes(me) && (
        <p>
          <button type="button" class="btn small" onClick={addMe}>
            <Icon name="plus" /> {me} eintragen
          </button>
        </p>
      )}
      <SelectField
        path="/meta/license"
        label="Lizenz der Inhalte"
        standard="keine Angabe"
        options={LICENSES}
        hint="Mit einer freien Lizenz dürfen andere das Spiel nutzen und anpassen. BY: mit Namensnennung, SA: Änderungen unter derselben Lizenz."
      />
      {expert && <TextField path="/meta/license" plain label="Lizenz als SPDX-Kennung" placeholder="z. B. CC-BY-NC-4.0" />}
    </section>
  );
}

function Expert() {
  const id = useEditorSelect((s) => s.game.id);
  const version = useEditorSelect((s) => s.game.format?.version);
  const expert = useEditorSelect((s) => s.expert);
  const toggle = (on: boolean) => {
    editor.get().current?.setExpert(on);
    setQuery({ experte: on ? "1" : null });
  };
  return (
    <section class="card stack" aria-labelledby="einstellungen-experten">
      <h3 id="einstellungen-experten" tabIndex={-1}>
        Experten
      </h3>
      <dl class="kv">
        <dt>Kennung des Spiels</dt>
        <dd class="mono">{id}</dd>
        <dt>Formatversion</dt>
        <dd class="mono">{version}</dd>
      </dl>
      <p class="small muted">Beides lässt sich hier nicht ändern. Die Kennung steht in Spielständen und auf gedrucktem Material.</p>
      <p>
        <button type="button" class="btn small" aria-pressed={expert} onClick={() => toggle(!expert)}>
          {expert ? "Expertenansicht schließen" : "Expertenansicht öffnen"}
        </button>{" "}
        {expert && <span class="small muted">Sie steht unter diesem Bereich: Kennungen, Rohfelder und das Spiel als JSON (nur lesen).</span>}
      </p>
    </section>
  );
}
