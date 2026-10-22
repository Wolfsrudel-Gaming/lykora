/**
 * Paket A: Medienauswahl als Dialog, überall wo ein Bild oder Klang gewählt wird. Reiter „Im Spiel“,
 * „Hochladen“ (eigene Dateien, mit Beschreibung und Urheber) und „Klangbibliothek“ (nur bei Klängen).
 * pickMedia liefert die Medien-ID; Uploads und Bibliotheksklänge landen dabei sofort als
 * media-Eintrag im Entwurf (ein Schritt im Verlauf). MediaPickerHost steht einmal im EditorShell.
 */

import { useEffect, useState } from "preact/hooks";
import { mediaContentType } from "../../../../lib/api.ts";
import { base, mediaUrl } from "../../../../lib/base.ts";
import { editor, useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { formatBytes } from "../../../../lib/format.ts";
import { api, errorText } from "../../../../lib/session.ts";
import { addMedia, libraryMedia, mediaBySrc, suggestMediaId, uploadedMedia } from "../../../../lib/sound.ts";
import { createStore, useStore } from "../../../../lib/store.ts";
import type { LibrarySound, MediaFile, MediaType } from "../../../../lib/types.ts";
import { Dialog, Empty, ErrorNotice, Field, Loading, PreviewButton, Tabs, useLoad } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";

export type Accept = "image" | "audio" | "any";
type Media = NonNullable<Game["media"]>[number];

/** Dateitypen, die der Server annimmt (wie Media.tsx; Absprache Medien-API). */
export const MIME_TYPES: Record<Exclude<MediaType, never>, string[]> = {
  audio: ["audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/webm", "audio/flac"],
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4"],
};
export const MAX_BYTES = 30 * 1024 * 1024;

export function matchesAccept(type: MediaType, accept: Accept): boolean {
  return accept === "any" || type === accept;
}

/** accept-Attribut des Dateifelds. */
export function acceptedMimes(accept: Accept): string[] {
  if (accept === "any") return [...MIME_TYPES.audio, ...MIME_TYPES.image, ...MIME_TYPES.video];
  return MIME_TYPES[accept];
}

export const ACCEPT_LABELS: Record<Accept, string> = { image: "Bild", audio: "Klang", any: "Datei" };

interface PickRequest {
  accept: Accept;
  title: string;
  resolve: (id: string | null) => void;
}

const picker = createStore<{ open: PickRequest | null }>({ open: null });

/** Öffnet die Auswahl; liefert die Medien-ID oder null bei Abbruch. */
export function pickMedia(opts: { accept: Accept; title: string }): Promise<string | null> {
  return new Promise((resolve) => {
    picker.get().open?.resolve(null);
    picker.set({ open: { ...opts, resolve } });
  });
}

/** Nimmt einen Eintrag in den Entwurf auf (ein Schritt) und liefert seine ID. */
function adopt(entry: Media, label: string): string | null {
  const store = editor.get().current;
  if (!store) return null;
  let id: string | null = null;
  store.update(label, (g) => {
    const r = addMedia(g, entry);
    g.media = r.game.media;
    id = r.id;
  });
  return id;
}

type Tab = "spiel" | "hochladen" | "bibliothek";

export function MediaPickerHost({ gameId }: { gameId: string }) {
  const { open } = useStore(picker);
  const [tab, setTab] = useState<Tab>("spiel");
  useEffect(() => setTab("spiel"), [open]);
  const finish = (id: string | null) => {
    open?.resolve(id);
    picker.set({ open: null });
  };
  const accept = open?.accept ?? "any";
  const tabs = [
    { id: "spiel" as const, label: "Im Spiel" },
    { id: "hochladen" as const, label: "Hochladen" },
    ...(accept !== "image" ? [{ id: "bibliothek" as const, label: "Klangbibliothek" }] : []),
  ];
  return (
    <Dialog open={!!open} title={open?.title ?? "Medium wählen"} onClose={() => finish(null)}>
      {open && (
        <div class="stack media-picker">
          <Tabs label="Quelle" tabs={tabs} value={tab} onChange={setTab} />
          <div role="tabpanel" aria-labelledby={`tab-${tab}`} class="media-picker-panel">
            {tab === "spiel" && <InGame accept={accept} onPick={finish} />}
            {tab === "hochladen" && <Upload gameId={gameId} accept={accept} onPick={finish} />}
            {tab === "bibliothek" && <Library onPick={finish} />}
          </div>
          <div class="form-actions">
            <button type="button" class="btn" onClick={() => finish(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Thumb({ type, src }: { type: MediaType; src: string }) {
  const url = mediaUrl(base(), src);
  if (type === "image") return <img class="thumb" src={url} alt="" loading="lazy" />;
  return (
    <span class="thumb">
      <Icon name={type === "audio" ? "wave" : "video"} />
    </span>
  );
}

function InGame({ accept, onPick }: { accept: Accept; onPick: (id: string) => void }) {
  const lang = useEditorSelect((s) => s.lang);
  const media = useEditorSelect((s) => s.game.media ?? [], (a, b) => a === b);
  const rows = media.filter((m) => m && typeof m === "object" && matchesAccept(m.type, accept));
  if (!rows.length) return <Empty>Noch {accept === "image" ? "kein Bild" : accept === "audio" ? "kein Klang" : "keine Datei"} im Spiel. Lad etwas hoch{accept !== "image" ? " oder nimm einen Klang aus der Bibliothek" : ""}.</Empty>;
  return (
    <ul class="list">
      {rows.map((m) => (
        <li key={m.id} class="media-row">
          <Thumb type={m.type} src={m.src} />
          <div class="min0">
            <strong class="wrap-anywhere">{readText(m.alt as never, lang) || m.id}</strong>
            <div class="small muted">{m.type === "audio" ? "Klang" : m.type === "image" ? "Bild" : "Video"}</div>
          </div>
          <div class="actions">
            {m.type === "audio" && <PreviewButton src={mediaUrl(base(), m.src)} label={m.id} />}
            <button type="button" class="btn small primary" onClick={() => onPick(m.id)}>
              Wählen
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Upload({ gameId, accept, onPick }: { gameId: string; accept: Accept; onPick: (id: string) => void }) {
  const game = useEditorSelect((s) => s.game);
  const expert = useEditorSelect((s) => s.expert);
  const lang = useEditorSelect((s) => s.lang);
  const files = useLoad(() => api.media(gameId), [gameId]);
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState("");
  const [alt, setAlt] = useState("");
  const [credit, setCredit] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const mimes = acceptedMimes(accept);

  const choose = (list: FileList | File[] | null | undefined) => {
    const f = Array.from(list ?? [])[0];
    if (!f) return;
    const type = mediaContentType(f);
    if (!mimes.includes(type)) return setError("Dateityp passt hier nicht.");
    if (f.size > MAX_BYTES) return setError("Die Datei ist größer als 30 MB.");
    setError(null);
    setFile(f);
    setId(suggestMediaId(game, f.name));
  };

  const upload = async (e: Event) => {
    e.preventDefault();
    if (!file) return;
    setProgress(0);
    setError(null);
    try {
      const created = await api.uploadMedia(gameId, file, setProgress);
      const entry = uploadedMedia(created, id || suggestMediaId(game, file.name), credit.trim() || undefined);
      if (alt.trim()) entry.alt = { [lang]: alt.trim() };
      const picked = adopt(entry, `${ACCEPT_LABELS[accept]} „${alt.trim() || file.name}“ hochgeladen`);
      if (picked) onPick(picked);
    } catch (err) {
      setError(errorText(err));
      setProgress(null);
    }
  };

  const existing = (files.data ?? []).filter((f) => matchesAccept(f.type, accept) && !mediaBySrc(game, f.src));
  const adoptExisting = (f: MediaFile) => {
    const picked = adopt(uploadedMedia(f, suggestMediaId(game, f.filename)), `${ACCEPT_LABELS[accept]} „${f.filename}“ übernommen`);
    if (picked) onPick(picked);
  };

  return (
    <form class="stack" onSubmit={(e) => void upload(e)}>
      {!file ? (
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
            choose(e.dataTransfer?.files);
          }}
        >
          <Icon name="upload" size={28} />
          <strong>{accept === "image" ? "Bild" : accept === "audio" ? "Aufnahme" : "Datei"} hierher ziehen</strong>
          <span class="small muted">oder klicken und auswählen · bis 30 MB</span>
          <input
            type="file"
            accept={mimes.join(",")}
            class="sr-only"
            onChange={(e) => {
              choose(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      ) : (
        <div class="card stack tight">
          <div class="row between">
            <strong class="wrap-anywhere">{file.name}</strong>
            <span class="small muted">{formatBytes(file.size)}</span>
          </div>
          <Field label="Beschreibung für Menschen, die nicht sehen" hint="Was ist zu sehen oder zu hören?">
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
          {progress !== null && (
            <span class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Fortschritt">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
          <div class="form-actions">
            <button type="button" class="btn small" disabled={progress !== null} onClick={() => setFile(null)}>
              Andere Datei
            </button>
            <button type="submit" class="btn small primary" disabled={progress !== null}>
              Hochladen und wählen
            </button>
          </div>
        </div>
      )}
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      {existing.length > 0 && (
        <details>
          <summary>Schon hochgeladen, noch nicht im Spiel ({existing.length})</summary>
          <ul class="list">
            {existing.map((f) => (
              <li key={f.id} class="media-row">
                <Thumb type={f.type} src={f.src} />
                <div class="min0">
                  <strong class="wrap-anywhere">{f.filename}</strong>
                  <div class="small muted">{formatBytes(f.size)}</div>
                </div>
                <div class="actions">
                  {f.type === "audio" && <PreviewButton src={mediaUrl(base(), f.src)} label={f.filename} />}
                  <button type="button" class="btn small primary" onClick={() => adoptExisting(f)}>
                    Übernehmen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice error={files.error} retry={files.reload} />
    </form>
  );
}

function Library({ onPick }: { onPick: (id: string) => void }) {
  const game = useEditorSelect((s) => s.game);
  const lang = useEditorSelect((s) => s.lang);
  const library = useLoad(() => api.librarySounds(), []);
  if (library.loading && !library.data) return <Loading />;
  if (library.error) return <ErrorNotice error={library.error} retry={library.reload} />;
  const sounds = library.data ?? [];
  if (!sounds.length) return <Empty>Die Bibliothek ist leer.</Empty>;
  const take = (s: LibrarySound) => {
    const inGame = mediaBySrc(game, s.src);
    const picked = inGame ? inGame.id : adopt(libraryMedia(s, s.id, lang), `Klang „${s.title}“ übernommen`);
    if (picked) onPick(picked);
  };
  return (
    <div class="stack">
      <p class="small muted">Mitgelieferte Klänge, frei nutzbar (CC0). Gewählte Klänge stehen danach im Spiel.</p>
      {(["ambience", "sfx"] as const).map((cat) => (
        <div key={cat} class="stack tight">
          <h3>{cat === "ambience" ? "Atmosphäre (Schleifen)" : "Geräusche"}</h3>
          <ul class="list">
            {sounds
              .filter((s) => s.category === cat)
              .map((s) => (
                <li key={s.id} class="media-row">
                  <PreviewButton src={mediaUrl(base(), s.src)} label={s.title} />
                  <div class="min0">
                    <strong>{s.title}</strong>
                    <div class="small muted">
                      {Math.round(s.duration)} s{s.loop ? " · Schleife" : ""}
                    </div>
                  </div>
                  <div class="actions">
                    <button type="button" class="btn small primary" onClick={() => take(s)}>
                      Wählen
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
