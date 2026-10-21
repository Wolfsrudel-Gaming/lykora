/**
 * Klänge zuordnen ohne JSON: Grund-Atmosphäre des Spiels, Atmosphäre je Kapitel und je
 * Station, Geräusche beim Annähern und beim Lösen, Aufnahmen und Geräusche in den Szenen.
 * Speichern legt eine neue Version an; der Server prüft sie und meldet Fehler verständlich zurück.
 */

import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { base, mediaUrl } from "../../lib/base.ts";
import { formatPercent } from "../../lib/format.ts";
import { can } from "../../lib/roles.ts";
import { api, errorText, notify, roleIn } from "../../lib/session.ts";
import {
  applySoundForm,
  audioChoices,
  BEAT_LABELS,
  LIB_PREFIX,
  SCENE_PART_LABELS,
  soundFormFromGame,
  STAGE_LABELS,
  STAGES,
  UI_KEYS,
  UI_LABELS,
  type AmbienceField,
  type BeatSoundForm,
  type SoundForm,
  type Stage,
} from "../../lib/sound.ts";
import type { Game, LibrarySound, ValidationResult } from "../../lib/types.ts";
import { ErrorNotice, Field, Loading, PreviewButton, useLoad, useTitle } from "../../ui/components.tsx";
import { GameNav } from "./GameNav.tsx";
import { saveErrors, ValidationList } from "./GameUpload.tsx";

interface PickContext {
  game: Game;
  library: LibrarySound[];
}

function srcOf(value: string, ctx: PickContext): string | null {
  if (!value) return null;
  if (value.startsWith(LIB_PREFIX)) {
    const s = ctx.library.find((x) => x.id === value.slice(LIB_PREFIX.length));
    return s ? mediaUrl(base(), s.src) : null;
  }
  const m = ctx.game.media?.find((x) => x.id === value);
  return m ? mediaUrl(base(), m.src) : null;
}

function SoundPick({ label, value, onChange, ctx, filter }: { label: string; value: string; onChange: (v: string) => void; ctx: PickContext; filter?: "ambience" | "sfx" }) {
  const choices = audioChoices(ctx.game, filter ? ctx.library.filter((s) => s.category === filter) : ctx.library);
  const src = srcOf(value, ctx);
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <span class="sound-pick">
        <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
          <option value="">Kein Klang</option>
          {choices.game.length > 0 && (
            <optgroup label="Im Spiel">
              {choices.game.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          )}
          {choices.library.length > 0 && (
            <optgroup label="Aus der Bibliothek (wird übernommen)">
              {choices.library.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {src && <PreviewButton src={src} label={label} />}
      </span>
    </div>
  );
}

function Volume({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <span class="volume">
        <input id={id} type="range" min={0} max={1} step={0.05} value={value} aria-valuetext={formatPercent(value)} onInput={(e) => onChange(Number(e.currentTarget.value))} />
        <span class="num" aria-hidden="true">
          {formatPercent(value)}
        </span>
      </span>
    </div>
  );
}

function AmbienceFields({ label, value, onChange, ctx }: { label: string; value: AmbienceField; onChange: (v: AmbienceField) => void; ctx: PickContext }) {
  return (
    <>
      <SoundPick label={label} value={value.audio} onChange={(audio) => onChange({ ...value, audio })} ctx={ctx} filter="ambience" />
      {value.audio && <Volume label="Lautstärke" value={value.volume} onChange={(volume) => onChange({ ...value, volume })} />}
    </>
  );
}

/** Takte der Szene einer Station: Aufnahme (Stimme) und Geräusch je Takt. */
function SceneBeats({ beats, onChange, ctx }: { beats: BeatSoundForm[]; onChange: (beats: BeatSoundForm[]) => void; ctx: PickContext }) {
  const assigned = beats.filter((b) => b.audio || b.sfx).length;
  // Nur beim Öffnen der Seite entscheiden; sonst klappt der Bereich beim Leeren des letzten Felds zu.
  const [initiallyOpen] = useState(assigned > 0);
  const set = (i: number, patch: Partial<BeatSoundForm>) => onChange(beats.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <details open={initiallyOpen}>
      <summary>
        Szene: Stimmen und Geräusche ({beats.length} {beats.length === 1 ? "Takt" : "Takte"}
        {assigned ? `, ${assigned} mit Klang` : ""})
      </summary>
      <ol class="list beats">
        {beats.map((b, i) => (
          <li key={`${b.part}-${b.index}`} class="beat stack tight">
            <p class="small">
              <span class="label">
                {SCENE_PART_LABELS[b.part]} · {BEAT_LABELS[b.kind]}
                {b.speaker ? ` · ${b.speaker}` : ""}
              </span>{" "}
              {b.excerpt && <span class="muted">„{b.excerpt}“</span>}
            </p>
            <div class="sound-grid">
              <SoundPick label="Aufnahme (z. B. Stimme)" value={b.audio} onChange={(audio) => set(i, { audio })} ctx={ctx} />
              <SoundPick label="Geräusch dazu" value={b.sfx} onChange={(sfx) => set(i, { sfx })} ctx={ctx} filter="sfx" />
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function SoundPage({ gameId }: { gameId: string }) {
  const game = useLoad(() => api.game(gameId), [gameId]);
  const library = useLoad(() => api.librarySounds().catch(() => [] as LibrarySound[]), []);
  const [form, setForm] = useState<SoundForm | null>(null);
  const [initial, setInitial] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useTitle(game.data ? `Klänge: ${game.data.title}` : "Klänge");

  useEffect(() => {
    if (!game.data) return;
    const f = soundFormFromGame(game.data.content);
    setForm(f);
    setInitial(JSON.stringify(f));
  }, [game.data]);

  const dirty = useMemo(() => !!form && JSON.stringify(form) !== initial, [form, initial]);

  if ((game.loading && !game.data) || (library.loading && !library.data)) return <div class="page"><Loading /></div>;
  if (!game.data || !form) return <div class="page"><ErrorNotice error={game.error} retry={game.reload} /></div>;
  const g = game.data;
  const write = can(roleIn(g.org_id), "game.write");
  const ctx: PickContext = { game: g.content, library: library.data ?? [] };

  const set = (patch: Partial<SoundForm>) => setForm({ ...form, ...patch });
  const setStation = (i: number, patch: Partial<SoundForm["stations"][number]>) =>
    set({ stations: form.stations.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setProblem(null);
    try {
      // Neuesten Stand holen, damit parallele Änderungen nicht verloren gehen.
      const fresh = await api.game(gameId);
      const content = applySoundForm(fresh.content, form, library.data ?? []);
      const v = await api.saveVersion(gameId, content, comment.trim() || "Klänge zugeordnet");
      notify(`Klänge gespeichert (Version ${v.version})`, "ok");
      setComment("");
      game.reload();
    } catch (err) {
      const list = saveErrors(err);
      if (list) setResult(list);
      else setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="page stack loose" onSubmit={save}>
      <GameNav gameId={gameId} title={g.title} current="gameSound" />
      <p class="muted">
        Wähle für Spiel, Kapitel und Stationen passende Klänge, in den Szenen auch gesprochene Aufnahmen. Klänge aus der Bibliothek kommen beim Speichern automatisch ins Spiel. Eigene Aufnahmen lädst du unter
        „Medien und Klänge“ hoch und übernimmst sie dort ins Spiel.
      </p>
      {!write && <p class="notice">Ändern dürfen Autoren und Admins. Du siehst die aktuelle Zuordnung.</p>}

      <fieldset class="card stack" disabled={!write}>
        <legend class="sr-only">Ganzes Spiel</legend>
        <h2>Ganzes Spiel</h2>
        <div class="sound-grid">
          <AmbienceFields label="Grund-Atmosphäre" value={form.ambience} onChange={(ambience) => set({ ambience })} ctx={ctx} />
        </div>
        <details>
          <summary>Geräusche der App ersetzen</summary>
          <div class="sound-grid" style={{ marginTop: "12px" }}>
            {UI_KEYS.map((k) => (
              <SoundPick key={k} label={UI_LABELS[k]} value={form.ui[k]} onChange={(v) => set({ ui: { ...form.ui, [k]: v } })} ctx={ctx} filter="sfx" />
            ))}
          </div>
        </details>
      </fieldset>

      {form.chapters.length > 0 && (
        <fieldset class="card stack" disabled={!write}>
          <legend class="sr-only">Kapitel</legend>
          <h2>Kapitel</h2>
          {form.chapters.map((c, i) => (
            <div key={c.id} class="stack tight">
              <h3>{c.title}</h3>
              <div class="sound-grid">
                <AmbienceFields
                  label="Atmosphäre"
                  value={c.ambience}
                  onChange={(ambience) => set({ chapters: form.chapters.map((x, j) => (j === i ? { ...x, ambience } : x)) })}
                  ctx={ctx}
                />
              </div>
            </div>
          ))}
        </fieldset>
      )}

      <fieldset class="stack" disabled={!write}>
        <legend class="sr-only">Stationen</legend>
        <h2>Stationen</h2>
        {form.stations.map((s, i) => (
          <section key={s.id} class="card stack" aria-label={`Station ${s.name}`}>
            <h3>
              {i + 1}. {s.name} <span class="mono small muted">{s.id}</span>
            </h3>
            <div class="sound-grid">
              <AmbienceFields label="Atmosphäre" value={s.ambience} onChange={(a) => setStation(i, { ambience: { ...s.ambience, ...a } })} ctx={ctx} />
              {s.ambience.audio && (
                <Field label="Atmosphäre ab Stufe">
                  <select value={s.ambience.from} onChange={(e) => setStation(i, { ambience: { ...s.ambience, from: e.currentTarget.value as Stage } })}>
                    {STAGES.map((st) => (
                      <option key={st} value={st}>
                        {STAGE_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <div class="sound-grid">
              {STAGES.map((st) => (
                <SoundPick
                  key={st}
                  label={`Annäherung: ${STAGE_LABELS[st]}`}
                  value={s.approach[st]}
                  onChange={(v) => setStation(i, { approach: { ...s.approach, [st]: v } })}
                  ctx={ctx}
                  filter="sfx"
                />
              ))}
              <SoundPick label="Beim Lösen" value={s.solved} onChange={(solved) => setStation(i, { solved })} ctx={ctx} filter="sfx" />
            </div>
            {s.beats.length > 0 && <SceneBeats beats={s.beats} onChange={(beats) => setStation(i, { beats })} ctx={ctx} />}
          </section>
        ))}
      </fieldset>

      {write && (
        <div class={`card stack save-bar${dirty || result || problem ? " pending" : ""}`}>
          {result && <ValidationList result={result} game={g.content} />}
          {problem && (
            <p class="notice error" role="alert">
              {problem}
            </p>
          )}
          <div class="save-row">
            <Field label="Kommentar zur Version">
              <input value={comment} maxLength={200} placeholder="Klänge zugeordnet" onInput={(e) => setComment(e.currentTarget.value)} />
            </Field>
            <div class="row end">
              <button type="button" class="btn" disabled={!dirty || busy} onClick={() => setForm(JSON.parse(initial) as SoundForm)}>
                Verwerfen
              </button>
              <button type="submit" class="btn primary" disabled={!dirty || busy}>
                Als neue Version speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
