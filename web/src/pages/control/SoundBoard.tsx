/**
 * Klangpult: Klänge aus dem Spiel und aus der Bibliothek vorhören und live auf ein Team
 * oder alle Teams einspielen (POST /events/:id/cues), wahlweise mit einem Funkspruch.
 */

import { useEffect, useState } from "preact/hooks";
import { base, mediaUrl } from "../../lib/base.ts";
import { formatClock, formatPercent, text } from "../../lib/format.ts";
import { audioMedia } from "../../lib/game.ts";
import { audioName, parseCue, senderOptions } from "../../lib/messages.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import type { Game, LibrarySound, Message, OverviewTeam } from "../../lib/types.ts";
import { Field, PreviewButton, useLoad } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

interface Sound {
  /** Wert für den Cue: Medien-ID des Spiels oder lib:<id> */
  audio: string;
  title: string;
  meta: string;
  src: string;
}

export function SoundBoard({
  eventId,
  game,
  teams,
  messages,
  canSend,
  preset,
  onSent,
}: {
  eventId: string;
  game: Game | null;
  teams: OverviewTeam[];
  messages: Message[];
  canSend: boolean;
  preset: { teamId: string | null; key: number } | null;
  onSent: () => void;
}) {
  const library = useLoad(() => api.librarySounds(), []);
  const [target, setTarget] = useState<string>(preset?.teamId ?? "");
  const [volume, setVolume] = useState(0.8);
  const [say, setSay] = useState("");
  const [sender, setSender] = useState("hq");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (preset) setTarget(preset.teamId ?? "");
  }, [preset?.key]);

  const lang = game?.meta.languages[0] ?? "de";
  const gameSounds: Sound[] = audioMedia(game).map((m) => {
    const alt = text(m.alt, lang);
    // Ohne Beschreibung ist die ID schon der Titel; dann steht der Urheber daneben.
    return { audio: m.id, title: alt || m.id, meta: alt ? m.id : text(m.credit, lang), src: mediaUrl(base(), m.src) };
  });
  const libSounds = (category: LibrarySound["category"]): Sound[] =>
    (library.data ?? [])
      .filter((s) => s.category === category)
      .map((s) => ({
        audio: `lib:${s.id}`,
        title: s.title,
        meta: `${s.id} · ${Math.round(s.duration)} s${s.loop ? " · Schleife" : ""}`,
        src: mediaUrl(base(), s.src),
      }));
  const match = (s: Sound) => !filter.trim() || `${s.title} ${s.meta}`.toLowerCase().includes(filter.trim().toLowerCase());

  const targetName = target ? (teams.find((t) => t.id === target)?.name ?? "Team") : "alle Teams";

  const play = async (s: Sound) => {
    setBusy(s.audio);
    try {
      await api.sendCue(eventId, { teamId: target || null, audio: s.audio, volume, text: say.trim() || undefined, sender: say.trim() ? sender : undefined });
      notify(`„${s.title}“ ${target ? `bei ${targetName}` : "bei allen Teams"} eingespielt`, "ok");
      setSay("");
      onSent();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const recent = messages
    .filter((m) => m.kind === "cue")
    .slice(-8)
    .reverse();

  const group = (title: string, list: Sound[]) => {
    const shown = list.filter(match);
    if (!shown.length) return null;
    return (
      <section class="stack tight" aria-label={title}>
        <h3>{title}</h3>
        <ul class="list sounds">
          {shown.map((s) => (
            <li key={s.audio} class="sound">
              <PreviewButton src={s.src} label={s.title} />
              <span class="min0">
                <strong class="wrap-anywhere">{s.title}</strong>
                <span class="small muted mono"> {s.meta}</span>
              </span>
              {canSend && (
                <button type="button" class="btn small primary" aria-describedby="cue-ziel" disabled={!!busy} onClick={() => void play(s)}>
                  {busy === s.audio ? "Spielt ein …" : "Einspielen"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div class="soundboard stack">
      {canSend && (
        <div class="card stack tight soundboard-controls">
          <span id="cue-ziel" class="sr-only">
            an {targetName}, Lautstärke {formatPercent(volume)}
          </span>
          <div class="cue-target">
            <Field label="Ziel">
              <select value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
                <option value="">Alle Teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <div class="field">
              <label for="cue-volume">Lautstärke</label>
              <span class="volume">
                <input id="cue-volume" type="range" min={0.05} max={1} step={0.05} value={volume} aria-valuetext={formatPercent(volume)} onInput={(e) => setVolume(Number(e.currentTarget.value))} />
                <span class="num" aria-hidden="true">
                  {formatPercent(volume)}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
      {canSend && (
        <div class="grid-2">
          <Field label="Funkspruch dazu (optional)" hint={`${say.length}/300`}>
            <input value={say} maxLength={300} onInput={(e) => setSay(e.currentTarget.value)} placeholder="z. B. Hört ihr das auch?" />
          </Field>
          <Field label="Absender">
            <select value={sender} disabled={!say.trim()} onChange={(e) => setSender(e.currentTarget.value)}>
              {senderOptions(game).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <Field label="Suchen">
        <input type="search" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} placeholder="Eule, Wind, Funk …" />
      </Field>
      {!game && <p class="small muted">Die Klänge des Spiels sieht nur, wer Prüfrechte hat. Die Bibliothek steht allen offen.</p>}
      {group("Klänge im Spiel", gameSounds)}
      {library.error ? <p class="notice small">Bibliothek nicht erreichbar: {errorText(library.error)}</p> : null}
      {group("Bibliothek: Atmosphäre", libSounds("ambience"))}
      {group("Bibliothek: Geräusche", libSounds("sfx"))}
      <section class="stack tight" aria-labelledby="cues-recent">
        <h3 id="cues-recent">Zuletzt eingespielt</h3>
        {recent.length === 0 ? (
          <p class="small muted">Noch nichts eingespielt.</p>
        ) : (
          <ul class="list">
            {recent.map((m) => {
              const cue = parseCue(m.body);
              return (
                <li key={m.id} class="list-item small">
                  <span class="num muted">{formatClock(m.created_at)}</span>
                  <Icon name="sound" size={14} />
                  <span class="grow">
                    <strong>{cue ? audioName(cue.audio) : "?"}</strong> {m.team_id ? `an ${m.team_name ?? "Team"}` : "an alle"} · {formatPercent(cue?.volume ?? 0.8)}
                    {cue?.text ? ` · „${cue.text}“` : ""}
                    {m.user_name ? ` · ${m.user_name}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
