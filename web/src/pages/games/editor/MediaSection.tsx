/**
 * Paket D: Bereich „Medien“ (design 7.5, UX §13) – Inhalt und Look von „Medien und Klänge“, aber im
 * Entwurf: Hochladen und Löschen von Dateien bleiben Server-Aufrufe, „Ins Spiel übernehmen“ schreibt
 * einen media-Eintrag in den Entwurf (ein Schritt im Verlauf, keine Version). Dazu die Liste „Im Spiel“
 * mit Beschreibung und Urheber. Kennungen stehen nur in der Expertenansicht.
 */

import { useState } from "preact/hooks";
import { mediaContentType } from "../../../lib/api.ts";
import { base, mediaUrl } from "../../../lib/base.ts";
import { removeWithReferences, usagesOf } from "../../../lib/editor/references.ts";
import { editor, useEditorSelect } from "../../../lib/editor/store.ts";
import { readText } from "../../../lib/editor/text.ts";
import type { Game } from "../../../lib/editor/types.ts";
import { formatBytes, formatDateTime } from "../../../lib/format.ts";
import { href } from "../../../lib/router.ts";
import { api, errorText, notify } from "../../../lib/session.ts";
import { addMedia, libraryMedia, mediaBySrc, suggestMediaId, uploadedMedia } from "../../../lib/sound.ts";
import type { LibrarySound, MediaFile } from "../../../lib/types.ts";
import { confirm, Empty, ErrorNotice, Field, Link, Loading, PreviewButton, useLoad } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { deleteWithReferences, usageLines } from "./DeleteWithReferencesDialog.tsx";
import type { SectionProps } from "./sections.ts";
import { JumpBar, store } from "./story/shared.tsx";
import { durationLabel } from "./ui/DurationInput.tsx";
import { acceptedMimes, MAX_BYTES } from "./ui/MediaPicker.tsx";
import { TextField } from "./ui/TextField.tsx";

type Media = NonNullable<Game["media"]>[number];

const TYPE_LABELS: Record<Media["type"], string> = { audio: "Klang", image: "Bild", video: "Video" };

/** Name eines Mediums im Baukasten: Beschreibung, sonst Kennung. */
export function mediaName(m: Pick<Media, "id" | "alt">, lang: string): string {
  return readText(m.alt as never, lang) || m.id;
}

/** Medium in den Entwurf übernehmen; liefert die Kennung (eine schon vorhandene Datei behält ihre). */
export function adoptMedia(entry: Media, label: string): string | null {
  let id: string | null = null;
  store().update(label, (g) => {
    const r = addMedia(g, entry);
    if (r.added) g.media = r.game.media;
    id = r.id;
  });
  return id;
}

interface Pending {
  key: number;
  name: string;
  progress: number;
  error?: string;
}

let pendingKey = 0;

const PARTS = [
  { id: "medien-hochladen", title: "Hochladen" },
  { id: "medien-spiel", title: "Im Spiel" },
  { id: "medien-dateien", title: "Dateien" },
  { id: "medien-bibliothek", title: "Klangbibliothek" },
];

export function MediaSection({ gameId }: SectionProps) {
  const files = useLoad(() => api.media(gameId), [gameId]);
  const library = useLoad(() => api.librarySounds(), []);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const mimes = acceptedMimes("any");

  const upload = async (list: FileList | File[] | null | undefined) => {
    for (const file of Array.from(list ?? [])) {
      const key = ++pendingKey;
      const type = mediaContentType(file);
      const problem = !mimes.includes(type) ? "Dateityp nicht unterstützt" : file.size > MAX_BYTES ? "größer als 30 MB" : null;
      setPending((p) => [...p, { key, name: file.name, progress: 0, error: problem ?? undefined }]);
      if (problem) continue;
      try {
        const created = await api.uploadMedia(gameId, file, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
        files.setData((l) => [created, ...(l ?? []).filter((m) => m.id !== created.id)]);
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (err) {
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: errorText(err) } : x)));
      }
    }
  };

  /** Datei auf dem Server löschen; nutzt der Entwurf sie, gehen die Verweise mit (nach Rückfrage). */
  const remove = async (f: MediaFile) => {
    const s = editor.get().current!.get();
    const inGame = mediaBySrc(s.game, f.src);
    const usages = inGame ? usagesOf(s.game, "medium", inGame.id) : [];
    const name = inGame ? mediaName(inGame, s.lang) : f.filename;
    const answer = await confirm({
      title: "Datei löschen?",
      body: inGame ? (
        <div class="stack tight">
          <p>
            „{name}“ ist im Spiel{usages.length ? ` und wird an ${usages.length === 1 ? "1 Stelle" : `${usages.length} Stellen`} verwendet` : ""}. Dort bleibt dann kein{f.type === "image" ? " Bild" : " Klang"}.
          </p>
          {usages.length > 0 && (
            <ul class="ed-usages">
              {usageLines(usages).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p>„{f.filename}“ wird gelöscht.</p>
      ),
      confirm: "Löschen",
    });
    if (!answer.ok) return;
    try {
      await api.deleteMedia(gameId, f.id);
      files.setData((l) => (l ?? []).filter((x) => x.id !== f.id));
      if (inGame) store().update(`Medium „${name}“ entfernt`, (g, meta) => void removeWithReferences(g, "medium", inGame.id, meta));
      notify(`„${f.filename}“ gelöscht`, "ok");
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  return (
    <section class="d-section stack loose" aria-labelledby="bereich-medien">
      <header class="stack tight">
        <h2 id="bereich-medien" tabIndex={-1}>
          Medien
        </h2>
        <JumpBar label="Abschnitte der Medien" targets={PARTS} />
        <p class="muted">
          Eigene Aufnahmen und Bilder machen ein Spiel unverwechselbar. Was du ins Spiel übernimmst, steht danach überall zur Wahl, wo ein Bild oder Klang gebraucht wird. Klänge ordnest du unter{" "}
          <Link to={href("editorSection", { gameId, section: "klang" })}>Klang</Link> zu.
        </p>
      </header>

      <section class="stack" aria-labelledby="medien-hochladen">
        <h3 id="medien-hochladen" tabIndex={-1}>
          Hochladen
        </h3>
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
            accept={mimes.join(",")}
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

      <InGame />

      <section class="stack" aria-labelledby="medien-dateien">
        <h3 id="medien-dateien" tabIndex={-1}>
          Dateien des Spiels
        </h3>
        <ErrorNotice error={files.error} retry={files.reload} />
        {files.loading && !files.data ? (
          <Loading />
        ) : !files.data?.length ? (
          <Empty>Noch keine eigenen Dateien hochgeladen.</Empty>
        ) : (
          <ul class="list card">
            {files.data.map((f) => (
              <FileRow key={f.id} file={f} onRemove={() => void remove(f)} />
            ))}
          </ul>
        )}
      </section>

      <section class="stack" aria-labelledby="medien-bibliothek">
        <h3 id="medien-bibliothek" tabIndex={-1}>
          Klangbibliothek
        </h3>
        <p class="small muted">Mitgelieferte Klänge, frei nutzbar (CC0). Übernommene Klänge stehen im Spiel und lassen sich Stationen und Kapiteln zuordnen.</p>
        <ErrorNotice error={library.error} retry={library.reload} />
        {library.loading && !library.data ? (
          <Loading />
        ) : !library.data?.length ? (
          <Empty>Die Bibliothek ist leer.</Empty>
        ) : (
          (["ambience", "sfx"] as const).map((cat) => (
            <div key={cat} class="card stack tight">
              <h4>{cat === "ambience" ? "Atmosphäre (Schleifen)" : "Geräusche"}</h4>
              <ul class="list">
                {library.data!.filter((s) => s.category === cat).map((s) => (
                  <LibraryRow key={s.id} sound={s} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

/** „Im Spiel als „…““ bzw. „Nicht im Spiel“ für eine Datei. */
function useInGame(src: string): { id: string; name: string } | null {
  return useEditorSelect(
    (s) => {
      const m = mediaBySrc(s.game, src);
      return m ? { id: m.id, name: s.expert ? m.id : mediaName(m, s.lang) } : null;
    },
    (a, b) => a?.id === b?.id && a?.name === b?.name,
  );
}

/** Medien im Entwurf: Beschreibung und Urheber bearbeiten, aus dem Spiel nehmen. */
function InGame() {
  const rows = useEditorSelect(
    (s) => (s.game.media ?? []).flatMap((m, index) => (m && typeof m.id === "string" ? [{ id: m.id, index, type: m.type, src: m.src, name: mediaName(m, s.lang), uses: usagesOf(s.game, "medium", m.id).length }] : [])),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const expert = useEditorSelect((s) => s.expert);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section class="stack" aria-labelledby="medien-spiel">
      <h3 id="medien-spiel" tabIndex={-1}>
        Im Spiel ({rows.length})
      </h3>
      {!rows.length ? (
        <Empty>Noch nichts im Spiel. Übernimm unten eine Datei oder einen Klang aus der Bibliothek.</Empty>
      ) : (
        <ul class="list card">
          {rows.map((m) => (
            <li key={m.id} class="media-row" data-objekt={m.id}>
              {m.type === "image" ? (
                <img class="thumb" src={mediaUrl(base(), m.src)} alt="" loading="lazy" />
              ) : (
                <span class="thumb">
                  <Icon name={m.type === "audio" ? "wave" : "video"} />
                </span>
              )}
              <div class="min0">
                <strong class="wrap-anywhere">{m.name}</strong>
                <div class="small muted">
                  {TYPE_LABELS[m.type] ?? m.type}
                  {expert && <span class="mono"> · {m.id}</span>} · {m.uses ? `${m.uses}× verwendet` : "noch nirgends verwendet"}
                </div>
              </div>
              <div class="actions">
                {m.type === "audio" && <PreviewButton src={mediaUrl(base(), m.src)} label={m.name} />}
                <button type="button" class="btn small" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                  <Icon name="edit" /> Angaben
                </button>
                <button type="button" class="btn small ghost" aria-label={`${m.name} aus dem Spiel nehmen`} onClick={() => void deleteWithReferences("medium", m.id, m.name)}>
                  <Icon name="trash" />
                </button>
              </div>
              {open === m.id && (
                <div class="adopt card stack tight">
                  <div class="grid-2">
                    <TextField path={`/media/${m.index}/alt`} label="Beschreibung" placeholder="z. B. Knarrende Tür" hint="Für Menschen, die nicht sehen; auch der Name in der Auswahl." />
                    <CreditField index={m.index} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Urheber: reine Zeichenkette wie beim Hochladen; vorhandene Übersetzungen bleiben Sprachtext. */
function CreditField({ index }: { index: number }) {
  const translated = useEditorSelect((s) => typeof s.game.media?.[index]?.credit === "object");
  return <TextField path={`/media/${index}/credit`} label="Urheber und Lizenz" plain={!translated} placeholder="z. B. Aufnahme: Anna B., CC BY 4.0" />;
}

function FileRow({ file, onRemove }: { file: MediaFile; onRemove: () => void }) {
  const inGame = useInGame(file.src);
  const expert = useEditorSelect((s) => s.expert);
  const lang = useEditorSelect((s) => s.lang);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [credit, setCredit] = useState("");
  const [alt, setAlt] = useState("");
  const url = mediaUrl(base(), file.src);

  const submit = (e: Event) => {
    e.preventDefault();
    const game = editor.get().current!.get().game;
    const entry = uploadedMedia(file, id || suggestMediaId(game, file.filename), credit);
    if (alt.trim()) entry.alt = { [lang]: alt.trim() };
    const name = alt.trim() || file.filename;
    if (adoptMedia(entry, `Medium „${name}“ übernommen`)) notify(`„${name}“ ist im Spiel`, "ok");
    setOpen(false);
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
        <div class="small">{inGame ? <span class="badge on keep-case">Im Spiel als „{inGame.name}“</span> : <span class="badge quiet">Nicht im Spiel</span>}</div>
      </div>
      <div class="actions">
        {file.type === "audio" && <PreviewButton src={url} label={file.filename} />}
        {file.type !== "audio" && (
          <a class="btn small" href={url} target="_blank" rel="noopener">
            <Icon name="eye" /> Ansehen
          </a>
        )}
        {!inGame && (
          <button
            type="button"
            class="btn small primary"
            aria-expanded={open}
            onClick={() => {
              if (!open) setId(suggestMediaId(editor.get().current!.get().game, file.filename));
              setOpen(!open);
            }}
          >
            Ins Spiel übernehmen
          </button>
        )}
        <button type="button" class="btn small" aria-label={`${file.filename} löschen`} onClick={onRemove}>
          <Icon name="trash" />
        </button>
      </div>
      {open && (
        <form class="adopt card stack tight" onSubmit={submit}>
          <div class="grid-3">
            <Field label="Beschreibung">
              <input value={alt} onInput={(e) => setAlt(e.currentTarget.value)} placeholder="z. B. Knarrende Tür" />
            </Field>
            <Field label="Urheber und Lizenz">
              <input value={credit} onInput={(e) => setCredit(e.currentTarget.value)} placeholder="z. B. Aufnahme: Anna B., CC BY 4.0" />
            </Field>
            {expert && (
              <Field label="Kennung im Spiel" hint="Kleinbuchstaben, Ziffern, - und _">
                <input required pattern="[a-z0-9][a-z0-9_\-]{0,63}" value={id} onInput={(e) => setId(e.currentTarget.value)} />
              </Field>
            )}
          </div>
          <div class="form-actions">
            <button type="button" class="btn small" onClick={() => setOpen(false)}>
              Abbrechen
            </button>
            <button type="submit" class="btn small primary">
              Übernehmen
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function LibraryRow({ sound }: { sound: LibrarySound }) {
  const inGame = useInGame(sound.src);
  const lang = useEditorSelect((s) => s.lang);
  return (
    <li class="media-row">
      <PreviewButton src={mediaUrl(base(), sound.src)} label={sound.title} />
      <div class="min0">
        <strong>{sound.title}</strong>
        <div class="small muted">
          {durationLabel(sound.duration)}{sound.loop ? " · Schleife" : ""} · {sound.license}
        </div>
      </div>
      <div class="actions">
        {inGame ? (
          <span class="badge on keep-case">Im Spiel als „{inGame.name}“</span>
        ) : (
          <button
            type="button"
            class="btn small primary"
            onClick={() => {
              if (adoptMedia(libraryMedia(sound, sound.id, lang), `Klang „${sound.title}“ übernommen`)) notify(`„${sound.title}“ ist im Spiel`, "ok");
            }}
          >
            Ins Spiel übernehmen
          </button>
        )}
      </div>
    </li>
  );
}
