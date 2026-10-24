/** Spiel als JSON-Datei oder eingefügt hochladen, vorher vom Server prüfen lassen. */

import { useState } from "preact/hooks";
import { plural, text } from "../../lib/format.ts";
import { api, errorText } from "../../lib/session.ts";
import type { Game, ValidationResult } from "../../lib/types.ts";
import { describeError, parseJson } from "../../lib/validation.ts";
import { Field, Tabs } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export function ValidationList({ result, game }: { result: ValidationResult; game?: unknown }) {
  return (
    <div class="stack tight">
      {result.errors.length > 0 && (
        <div class="notice error" role="alert">
          {result.errors.length === 1 ? "1 Fehler" : `${result.errors.length} Fehler`} – so lässt sich das Spiel nicht speichern:
          <ul class="validation">
            {result.errors.map((e) => {
              const r = describeError(e, game);
              return (
                <li key={e}>
                  <strong>{r.where}:</strong> {r.message}
                  {r.message !== r.raw && <span class="small muted mono"> ({r.raw})</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {result.warnings.length > 0 && (
        <div class="notice">
          Hinweise:
          <ul>
            {result.warnings.map((w) => {
              const r = describeError(w, game);
              return (
                <li key={w}>
                  <strong>{r.where}:</strong> {r.message}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Fehler beim Speichern: invalid_game bringt die Fehlerliste in details mit. */
export function saveErrors(err: unknown): ValidationResult | null {
  const details = (err as { details?: { errors?: unknown; warnings?: unknown } }).details;
  if (details && Array.isArray(details.errors)) return { errors: details.errors as string[], warnings: Array.isArray(details.warnings) ? (details.warnings as string[]) : [] };
  return null;
}

export function GameUpload({
  submitLabel,
  expectId,
  onSave,
  onDraft,
}: {
  submitLabel: string;
  /** ID des bestehenden Spiels; weicht die neue ab, gibt es einen Hinweis */
  expectId?: string;
  onSave: (content: Game, comment: string) => Promise<void>;
  /** Fehlerhafte Datei mit der Grundform eines Spiels trotzdem als Entwurf öffnen (Baukasten) */
  onDraft?: (content: Game) => Promise<void>;
}) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [parsed, setParsed] = useState<unknown>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const check = async (src: string) => {
    setResult(null);
    setProblem(null);
    setParsed(null);
    const { value, error } = parseJson(src);
    if (error) return setProblem(error);
    setBusy(true);
    try {
      setParsed(value);
      setResult(await api.validate(value));
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setProblem("Die Datei ist größer als 5 MB. Ist das wirklich ein Spiel im JSON-Format?");
    const content = await file.text();
    setFileName(file.name);
    setSource(content);
    await check(content);
  };

  const save = async (e: Event) => {
    e.preventDefault();
    if (!parsed || !result || result.errors.length) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSave(parsed as Game, comment.trim());
    } catch (err) {
      const list = saveErrors(err);
      if (list) setResult(list);
      else setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const game = parsed as Game | null;
  const ok = !!result && result.errors.length === 0;
  const lang = game?.meta?.languages?.[0] ?? "de";

  return (
    <div class="stack">
      <Tabs
        label="Quelle"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: "file", label: "Datei" },
          { id: "paste", label: "Einfügen" },
        ]}
      />
      <div role="tabpanel" aria-labelledby={`tab-${mode}`}>
        {mode === "file" ? (
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
              void readFile(e.dataTransfer?.files[0]);
            }}
          >
            <Icon name="upload" size={28} />
            <strong>{fileName ?? "Spieldatei (.json) hierher ziehen"}</strong>
            <span class="small muted">oder klicken und auswählen</span>
            <input
              type="file"
              accept=".json,application/json"
              class="sr-only"
              onChange={(e) => {
                void readFile(e.currentTarget.files?.[0]);
                // Dieselbe Datei nach einer Korrektur noch einmal wählen können.
                e.currentTarget.value = "";
              }}
            />
          </label>
        ) : (
          <div class="stack tight">
            <Field label="Spiel im JSON-Format">
              <textarea class="code" spellcheck={false} value={source} onInput={(e) => setSource(e.currentTarget.value)} placeholder='{ "format": { "name": "lykora-game", "version": "0.1" }, … }' />
            </Field>
            <div class="row end">
              <button type="button" class="btn" disabled={busy || !source.trim()} onClick={() => void check(source)}>
                Prüfen
              </button>
            </div>
          </div>
        )}
      </div>
      {busy && !result && <p class="muted">Prüfe …</p>}
      {problem && (
        <p class="notice error" role="alert">
          {problem}
        </p>
      )}
      {result && <ValidationList result={result} game={parsed} />}
      {onDraft && result && !ok && (parsed as { format?: { name?: unknown } } | null)?.format?.name === "lykora-game" && (
        <div class="row wrap">
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDraft(parsed as Game)
                .catch((err) => setProblem(errorText(err)))
                .finally(() => setBusy(false));
            }}
          >
            Trotzdem als Entwurf öffnen und im Baukasten reparieren
          </button>
        </div>
      )}
      {ok && game && (
        <form class="stack" onSubmit={save}>
          <p class="notice ok">
            Gültig: „{text(game.meta.title, lang)}“ mit {plural(game.stations.length, "Station", "Stationen")}
            {game.media?.length ? ` und ${plural(game.media.length, "Medium", "Medien")}` : ""}.
          </p>
          {expectId && game.id !== expectId && (
            <p class="notice">
              Die Spiel-ID „{game.id}“ weicht von der bisherigen („{expectId}“) ab. Gespeichert wird trotzdem als neue Version dieses Spiels.
            </p>
          )}
          <Field label="Kommentar zur Version (optional)">
            <input value={comment} maxLength={200} onInput={(e) => setComment(e.currentTarget.value)} placeholder="z. B. Station 3 verlegt" />
          </Field>
          <div class="form-actions">
            <button type="submit" class="btn primary" disabled={busy}>
              {submitLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
