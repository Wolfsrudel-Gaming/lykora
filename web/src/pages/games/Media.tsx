/**
 * Medien und Klänge eines Spiels: eigene Dateien hochladen (Ziehen und Ablegen, mehrere,
 * mit Fortschritt), anhören, ansehen, löschen und ins Spiel übernehmen. Dazu die
 * mitgelieferte Klangbibliothek.
 */

import { useState } from "preact/hooks";
import { mediaContentType } from "../../lib/api.ts";
import { base, mediaUrl } from "../../lib/base.ts";
import { formatBytes, formatDateTime } from "../../lib/format.ts";
import { can } from "../../lib/roles.ts";
import { api, errorText, notify, roleIn } from "../../lib/session.ts";
import { addMedia, audioUsage, libraryMedia, mediaBySrc, suggestMediaId, uploadedMedia } from "../../lib/sound.ts";
import type { GameDetail, LibrarySound, MediaFile } from "../../lib/types.ts";
import { Empty, ErrorNotice, Field, Loading, PreviewButton, confirm, useLoad, useTitle } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import { GameNav } from "./GameNav.tsx";

/** Dateitypen, die der Server annimmt (Absprache Medien-API). */
export const ACCEPTED = [
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/webm",
  "audio/flac",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
];
export const MAX_BYTES = 30 * 1024 * 1024;

interface Pending {
  key: number;
  name: string;
  progress: number;
  error?: string;
}

let pendingKey = 0;

export function MediaPage({ gameId }: { gameId: string }) {
  const game = useLoad(() => api.game(gameId), [gameId]);
  const media = useLoad(() => api.media(gameId), [gameId]);
  const library = useLoad(() => api.librarySounds(), []);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  useTitle(game.data ? `Medien: ${game.data.title}` : "Medien");

  if (game.loading && !game.data) return <div class="page"><Loading /></div>;
  if (!game.data) return <div class="page"><ErrorNotice error={game.error} retry={game.reload} /></div>;
  const g = game.data;
  const write = can(roleIn(g.org_id), "game.write");

  const upload = async (files: FileList | File[] | null | undefined) => {
    for (const file of Array.from(files ?? [])) {
      const key = ++pendingKey;
      const type = mediaContentType(file);
      const problem = !ACCEPTED.includes(type) ? "Dateityp nicht unterstützt" : file.size > MAX_BYTES ? "größer als 30 MB" : null;
      setPending((p) => [...p, { key, name: file.name, progress: 0, error: problem ?? undefined }]);
      if (problem) continue;
      try {
        const created = await api.uploadMedia(gameId, file, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
        media.setData((list) => [created, ...(list ?? []).filter((m) => m.id !== created.id)]);
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (err) {
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: errorText(err) } : x)));
      }
    }
  };

  /** Schreibt einen media-Eintrag in eine neue Version; holt vorher den neuesten Stand. */
  const adopt = async (entry: Parameters<typeof addMedia>[1], label: string) => {
    const fresh = await api.game(gameId);
    const result = addMedia(fresh.content, entry);
    if (!result.added) {
      notify(`${label} ist schon im Spiel als „${result.id}“`, "info");
      game.setData(fresh);
      return;
    }
    const v = await api.saveVersion(gameId, result.game, `Medium „${result.id}“ übernommen`);
    game.setData({ ...fresh, content: result.game, latest_version: v.version, versions: [{ version: v.version, comment: `Medium „${result.id}“ übernommen`, created_at: new Date().toISOString(), created_by: null }, ...fresh.versions] });
    notify(`„${result.id}“ ist im Spiel (Version ${v.version})`, "ok");
  };

  const remove = async (m: MediaFile) => {
    const inGame = mediaBySrc(g.content, m.src);
    const answer = await confirm({
      title: "Datei löschen?",
      body: inGame ? (
        <p>
          Das Spiel nutzt die Datei als „{inGame.id}“{audioUsage(g.content, inGame.id) ? ` an ${audioUsage(g.content, inGame.id)} Stellen` : ""}. Ohne Datei fehlt der Klang in neuen Spielpaketen. Ältere Versionen
          verweisen weiter darauf.
        </p>
      ) : (
        <p>„{m.filename}“ wird gelöscht.</p>
      ),
      confirm: "Löschen",
    });
    if (!answer.ok) return;
    try {
      await api.deleteMedia(gameId, m.id);
      media.setData((list) => (list ?? []).filter((x) => x.id !== m.id));
      notify(`„${m.filename}“ gelöscht`, "ok");
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  return (
    <div class="page stack loose">
      <GameNav gameId={gameId} title={g.title} current="gameMedia" />
      {write && (
        <section class="stack" aria-labelledby="upload-title">
          <h2 id="upload-title">Hochladen</h2>
          <label
            class={`dropzone${over ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void upload(e.dataTransfer?.files);
            }}
          >
            <Icon name="upload" size={28} />
            <strong>Aufnahmen, Bilder oder Videos hierher ziehen</strong>
            <span class="small muted">oder klicken und auswählen · MP3, OGG, WAV, M4A, AAC, FLAC, JPG, PNG, WebP, MP4 · bis 30 MB je Datei</span>
            <input
              type="file"
              multiple
              accept={ACCEPTED.join(",")}
              class="sr-only"
              onChange={(e) => {
                void upload(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {pending.length > 0 && (
            <ul class="list card" aria-label="Uploads">
              {pending.map((p) => (
                <li key={p.key} class="list-item">
                  <span class="grow wrap-anywhere">{p.name}</span>
                  {p.error ? (
                    <>
                      <span class="strong">{p.error}</span>
                      <button type="button" class="btn small" aria-label="Meldung entfernen" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                        <Icon name="x" />
                      </button>
                    </>
                  ) : (
                    <span class="grow">
                      <span class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress * 100)} aria-label={`Fortschritt ${p.name}`}>
                        <span style={{ width: `${Math.round(p.progress * 100)}%` }} />
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section class="stack" aria-labelledby="files-title">
        <h2 id="files-title">Dateien des Spiels</h2>
        <ErrorNotice error={media.error} retry={media.reload} />
        {media.loading && !media.data ? (
          <Loading />
        ) : !media.data?.length ? (
          <Empty>Noch keine eigenen Dateien. Eigene Aufnahmen machen ein Spiel unverwechselbar.</Empty>
        ) : (
          <ul class="list card">
            {media.data.map((m) => (
              <MediaRow key={m.id} file={m} game={g} write={write} onAdopt={adopt} onRemove={() => void remove(m)} />
            ))}
          </ul>
        )}
      </section>

      <section class="stack" aria-labelledby="library-title">
        <h2 id="library-title">Klangbibliothek</h2>
        <p class="small muted">Mitgelieferte Klänge, frei nutzbar (CC0). Übernommene Klänge stehen im Spiel und lassen sich Stationen und Kapiteln zuordnen.</p>
        <ErrorNotice error={library.error} retry={library.reload} />
        {library.loading && !library.data ? (
          <Loading />
        ) : !library.data?.length ? (
          <Empty>Die Bibliothek ist leer.</Empty>
        ) : (
          (["ambience", "sfx"] as const).map((cat) => (
            <div key={cat} class="card stack tight">
              <h3>{cat === "ambience" ? "Atmosphäre (Schleifen)" : "Geräusche"}</h3>
              <ul class="list">
                {library.data!.filter((s) => s.category === cat).map((s) => (
                  <LibraryRow key={s.id} sound={s} game={g} write={write} onAdopt={adopt} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function MediaRow({
  file,
  game,
  write,
  onAdopt,
  onRemove,
}: {
  file: MediaFile;
  game: GameDetail;
  write: boolean;
  onAdopt: (entry: Parameters<typeof addMedia>[1], label: string) => Promise<void>;
  onRemove: () => void;
}) {
  const inGame = mediaBySrc(game.content, file.src);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(() => suggestMediaId(game.content, file.filename));
  const [credit, setCredit] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = mediaUrl(base(), file.src);
  const lang = game.content.meta.languages[0] ?? "de";

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = uploadedMedia(file, id, credit);
      if (alt.trim()) entry.alt = { [lang]: alt.trim() };
      await onAdopt(entry, `„${file.filename}“`);
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li class="media-row">
      {file.type === "image" ? (
        <img class="thumb" src={url} alt="" loading="lazy" />
      ) : (
        <span class="thumb">
          <Icon name={file.type === "audio" ? "wave" : "video"} />
        </span>
      )}
      <div class="min0">
        <strong class="wrap-anywhere">{file.filename}</strong>
        <div class="small muted">
          {formatBytes(file.size)} · {file.contentType} · {formatDateTime(file.createdAt)}
        </div>
        <div class="small">{inGame ? <span class="badge on keep-case">Im Spiel als „{inGame.id}“</span> : <span class="badge quiet">Nicht im Spiel</span>}</div>
      </div>
      <div class="actions">
        {file.type === "audio" && <PreviewButton src={url} label={file.filename} />}
        {file.type !== "audio" && (
          <a class="btn small" href={url} target="_blank" rel="noopener">
            <Icon name="eye" /> Ansehen
          </a>
        )}
        {write && !inGame && (
          <button type="button" class="btn small primary" aria-expanded={open} onClick={() => setOpen(!open)}>
            Ins Spiel übernehmen
          </button>
        )}
        {write && (
          <button type="button" class="btn small" aria-label={`${file.filename} löschen`} onClick={onRemove}>
            <Icon name="trash" />
          </button>
        )}
      </div>
      {open && (
        <form class="adopt card stack tight" onSubmit={submit}>
          <div class="grid-3">
            <Field label="ID im Spiel" hint="Kleinbuchstaben, Ziffern, - und _">
              <input required pattern="[a-z0-9][a-z0-9_\-]{0,63}" value={id} onInput={(e) => setId(e.currentTarget.value)} />
            </Field>
            <Field label="Urheber und Lizenz">
              <input value={credit} onInput={(e) => setCredit(e.currentTarget.value)} placeholder="z. B. Aufnahme: Anna B., CC BY 4.0" />
            </Field>
            <Field label="Beschreibung">
              <input value={alt} onInput={(e) => setAlt(e.currentTarget.value)} placeholder="z. B. Knarrende Tür" />
            </Field>
          </div>
          {error && (
            <p class="notice error" role="alert">
              {error}
            </p>
          )}
          <div class="form-actions">
            <button type="button" class="btn small" onClick={() => setOpen(false)}>
              Abbrechen
            </button>
            <button type="submit" class="btn small primary" disabled={busy}>
              Neue Version mit „{id}“ speichern
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function LibraryRow({
  sound,
  game,
  write,
  onAdopt,
}: {
  sound: LibrarySound;
  game: GameDetail;
  write: boolean;
  onAdopt: (entry: Parameters<typeof addMedia>[1], label: string) => Promise<void>;
}) {
  const inGame = mediaBySrc(game.content, sound.src);
  const [busy, setBusy] = useState(false);
  const lang = game.content.meta.languages[0] ?? "de";
  return (
    <li class="media-row">
      <PreviewButton src={mediaUrl(base(), sound.src)} label={sound.title} />
      <div class="min0">
        <strong>{sound.title}</strong>
        <div class="small muted">
          <span class="mono">{sound.id}</span> · {Math.round(sound.duration)} s{sound.loop ? " · Schleife" : ""} · {sound.license}
        </div>
      </div>
      <div class="actions">
        {inGame ? (
          <span class="badge on keep-case">Im Spiel als „{inGame.id}“</span>
        ) : (
          write && (
            <button
              type="button"
              class="btn small primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onAdopt(libraryMedia(sound, sound.id, lang), `„${sound.title}“`);
                } catch (err) {
                  notify(errorText(err), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ins Spiel übernehmen
            </button>
          )
        )}
      </div>
    </li>
  );
}
