/**
 * Paket D: Bereich „Klang“ (design 7.5, UX §13) – Inhalt von „Klänge zuordnen“ ohne Speicherleiste:
 * Grund-Atmosphäre, Geräusche der App, Atmosphäre je Kapitel und Station, Annäherung, Lösen und die
 * Stimmen und Geräusche in den Szenen. Jede Änderung schreibt über applySoundForm in den Entwurf
 * (nur Klangfelder; Bibliotheksklänge landen sofort als media-Eintrag). Rückgängig ersetzt „Verwerfen“.
 */

import { useId, useMemo, useState } from "preact/hooks";
import { base, mediaUrl } from "../../../lib/base.ts";
import { useEditorSelect } from "../../../lib/editor/store.ts";
import { readText } from "../../../lib/editor/text.ts";
import type { Game } from "../../../lib/editor/types.ts";
import { formatPercent } from "../../../lib/format.ts";
import { href } from "../../../lib/router.ts";
import { api } from "../../../lib/session.ts";
import {
  applySoundForm,
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
} from "../../../lib/sound.ts";
import type { LibrarySound } from "../../../lib/types.ts";
import { ErrorNotice, Field, Link, Loading, PreviewButton, useLoad } from "../../../ui/components.tsx";
import type { SectionProps } from "./sections.ts";
import { store } from "./story/shared.tsx";

/**
 * Klangformular in den Entwurf schreiben (in place): applySoundForm rechnet auf einer Kopie, hier
 * werden nur ihre Felder übernommen – was das Formular entfernt (z. B. sound), fällt auch hier weg.
 */
export function writeSoundForm(game: Game, form: SoundForm, library: LibrarySound[]): void {
  const next = applySoundForm(game, form, library) as unknown as Record<string, unknown>;
  const target = game as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) if (!(key in next)) delete target[key];
  Object.assign(target, next);
}

/** Formular aus einem Entwurf, der unvollständig sein darf (Stationen ohne Kennung zählen nicht). */
export function soundFormOf(game: Game): SoundForm {
  return soundFormFromGame({ ...game, meta: game.meta ?? { title: "", languages: ["de"] }, stations: (game.stations ?? []).filter((s) => s && typeof s.id === "string") });
}

interface PickContext {
  game: Game;
  library: LibrarySound[];
  lang: string;
  expert: boolean;
}

function srcOf(value: string, ctx: PickContext): string | null {
  if (!value) return null;
  if (value.startsWith(LIB_PREFIX)) {
    const s = ctx.library.find((x) => x.id === value.slice(LIB_PREFIX.length));
    return s ? mediaUrl(base(), s.src) : null;
  }
  const m = ctx.game.media?.find((x) => x?.id === value);
  return m ? mediaUrl(base(), m.src) : null;
}

/** Wählbare Klänge: zuerst die des Spiels (mit Namen, Kennung nur für Fachleute), dann die Bibliothek. */
function choices(ctx: PickContext, filter?: "ambience" | "sfx") {
  const audio = (ctx.game.media ?? []).filter((m) => m && m.type === "audio");
  const inGame = new Set(audio.map((m) => m.src));
  const name = (m: (typeof audio)[number]) => readText(m.alt as never, ctx.lang) || m.id;
  return {
    game: audio.map((m) => ({ value: m.id, label: ctx.expert ? `${name(m)} · ${m.id}` : name(m) })),
    library: ctx.library.filter((s) => !inGame.has(s.src) && (!filter || s.category === filter)).map((s) => ({ value: LIB_PREFIX + s.id, label: s.title })),
  };
}

function SoundPick({ label, value, onChange, ctx, filter }: { label: string; value: string; onChange: (v: string) => void; ctx: PickContext; filter?: "ambience" | "sfx" }) {
  const c = choices(ctx, filter);
  const src = srcOf(value, ctx);
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <span class="sound-pick">
        <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
          <option value="">Kein Klang</option>
          {value && !value.startsWith(LIB_PREFIX) && !c.game.some((x) => x.value === value) && <option value={value}>Unbekannt</option>}
          {c.game.length > 0 && (
            <optgroup label="Im Spiel">
              {c.game.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          )}
          {c.library.length > 0 && (
            <optgroup label="Aus der Bibliothek (kommt ins Spiel)">
              {c.library.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
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
function SceneBeats({ beats, onChange, ctx }: { beats: BeatSoundForm[]; onChange: (beats: BeatSoundForm[], label: string) => void; ctx: PickContext }) {
  const assigned = beats.filter((b) => b.audio || b.sfx).length;
  // Nur beim Öffnen entscheiden; sonst klappt der Bereich beim Leeren des letzten Felds zu.
  const [initiallyOpen] = useState(assigned > 0);
  const set = (i: number, patch: Partial<BeatSoundForm>, label: string) => onChange(beats.map((b, j) => (j === i ? { ...b, ...patch } : b)), label);
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
              <SoundPick label="Aufnahme (z. B. Stimme)" value={b.audio} onChange={(audio) => set(i, { audio }, "Aufnahme im Takt zugeordnet")} ctx={ctx} />
              <SoundPick label="Geräusch dazu" value={b.sfx} onChange={(sfx) => set(i, { sfx }, "Geräusch im Takt zugeordnet")} ctx={ctx} filter="sfx" />
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function SoundSection({ gameId }: SectionProps) {
  const library = useLoad(() => api.librarySounds().catch(() => [] as LibrarySound[]), []);
  const game = useEditorSelect((s) => s.game);
  const lang = useEditorSelect((s) => s.lang);
  const expert = useEditorSelect((s) => s.expert);
  const form = useMemo(() => soundFormOf(game), [game]);

  if (library.loading && !library.data) return <Loading />;
  const ctx: PickContext = { game, library: library.data ?? [], lang, expert };

  /** Eine Änderung des Formulars als Schritt im Verlauf; schnelle Folgen am selben Feld verschmelzen. */
  const write = (next: SoundForm, label: string, key: string) =>
    store().update(label, (g) => writeSoundForm(g, next, ctx.library), { coalesce: `klang:${key}` });
  const setStation = (i: number, patch: Partial<SoundForm["stations"][number]>, label: string, key: string) =>
    write({ ...form, stations: form.stations.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, label, `${form.stations[i]!.id}:${key}`);

  return (
    <section class="d-section stack loose" aria-labelledby="bereich-klang">
      <header class="stack tight">
        <h2 id="bereich-klang" tabIndex={-1}>
          Klang
        </h2>
        <p class="muted">
          Wähle für Spiel, Kapitel und Stationen passende Klänge, in den Szenen auch gesprochene Aufnahmen. Klänge aus der Bibliothek kommen sofort ins Spiel. Eigene Aufnahmen lädst du unter{" "}
          <Link to={href("editorSection", { gameId, section: "medien" })}>Medien</Link> hoch.
        </p>
      </header>
      <ErrorNotice error={library.error} retry={library.reload} />

      <section class="card stack" aria-labelledby="klang-spiel">
        <h3 id="klang-spiel">Ganzes Spiel</h3>
        <div class="sound-grid" data-feld="sound.ambience">
          <AmbienceFields label="Grund-Atmosphäre" value={form.ambience} onChange={(ambience) => write({ ...form, ambience }, "Grund-Atmosphäre geändert", "ambience")} ctx={ctx} />
        </div>
        <details data-feld="sound.ui">
          <summary>Geräusche der App ersetzen</summary>
          <div class="sound-grid d-sound-ui">
            {UI_KEYS.map((k) => (
              <SoundPick key={k} label={UI_LABELS[k]} value={form.ui[k]} onChange={(v) => write({ ...form, ui: { ...form.ui, [k]: v } }, `Geräusch „${UI_LABELS[k]}“ geändert`, `ui:${k}`)} ctx={ctx} filter="sfx" />
            ))}
          </div>
        </details>
      </section>

      {form.chapters.length > 0 && (
        <section class="card stack" aria-labelledby="klang-kapitel">
          <h3 id="klang-kapitel">Kapitel</h3>
          {form.chapters.map((c, i) => (
            <div key={c.id} class="stack tight" data-objekt={c.id}>
              <h4>{c.title}</h4>
              <div class="sound-grid" data-feld="ambience">
                <AmbienceFields
                  label="Atmosphäre"
                  value={c.ambience}
                  onChange={(ambience) => write({ ...form, chapters: form.chapters.map((x, j) => (j === i ? { ...x, ambience } : x)) }, `Atmosphäre von „${c.title}“ geändert`, `kapitel:${c.id}`)}
                  ctx={ctx}
                />
              </div>
            </div>
          ))}
        </section>
      )}

      <section class="stack" aria-labelledby="klang-stationen">
        <h3 id="klang-stationen">Stationen</h3>
        {form.stations.map((s, i) => (
          <section key={s.id} class="card stack" aria-label={`Station ${s.name}`}>
            <h4>
              {i + 1}. {s.name} {expert && <span class="mono small muted">{s.id}</span>}
            </h4>
            <div class="sound-grid">
              <AmbienceFields label="Atmosphäre" value={s.ambience} onChange={(a) => setStation(i, { ambience: { ...s.ambience, ...a } }, `Atmosphäre von „${s.name}“ geändert`, "ambience")} ctx={ctx} />
              {s.ambience.audio && (
                <Field label="Atmosphäre ab Stufe">
                  <select value={s.ambience.from} onChange={(e) => setStation(i, { ambience: { ...s.ambience, from: e.currentTarget.value as Stage } }, `Atmosphäre von „${s.name}“ geändert`, "from")}>
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
                  onChange={(v) => setStation(i, { approach: { ...s.approach, [st]: v } }, `Annäherungsgeräusch von „${s.name}“ geändert`, `approach:${st}`)}
                  ctx={ctx}
                  filter="sfx"
                />
              ))}
              <SoundPick label="Beim Lösen" value={s.solved} onChange={(solved) => setStation(i, { solved }, `Lösungsgeräusch von „${s.name}“ geändert`, "solved")} ctx={ctx} filter="sfx" />
            </div>
            {s.beats.length > 0 && <SceneBeats beats={s.beats} onChange={(beats, label) => setStation(i, { beats }, `${label} („${s.name}“)`, "beats")} ctx={ctx} />}
          </section>
        ))}
      </section>
    </section>
  );
}
