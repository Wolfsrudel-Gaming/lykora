/**
 * Paket E: „Als Datei exportieren“ (UX §4.4) – Wahl zwischen veröffentlichter Version und
 * aktuellem Entwurf, Dateiname wie bisher (<spiel-id>-v6.json, <spiel-id>-entwurf.json). Hat der
 * Entwurf Fehler, sagt der Dialog vorher, dass die Datei sich so nicht wieder importieren lässt.
 */

import { useEffect, useState } from "preact/hooks";
import { ApiError } from "../../../../lib/api.ts";
import { saveJson } from "../../../../lib/download.ts";
import type { EditorMeta, Game } from "../../../../lib/editor/types.ts";
import { api, errorText, notify } from "../../../../lib/session.ts";
import { Dialog } from "../../../../ui/components.tsx";

type Source = "version" | "draft";

export function exportName(game: { id?: unknown } | null | undefined, fallback: string, source: Source, version: number | null): string {
  const id = typeof game?.id === "string" && game.id ? game.id : fallback;
  return source === "draft" ? `${id}-entwurf.json` : `${id}-v${version}.json`;
}

export function ExportDialog({ gameId, latestVersion, hasDraft, open, onClose }: { gameId: string; latestVersion: number | null; hasDraft: boolean; open: boolean; onClose: () => void }) {
  const [source, setSource] = useState<Source>(latestVersion === null ? "draft" : "version");
  const [draft, setDraft] = useState<{ content: Game; meta: EditorMeta } | null>(null);
  const [errors, setErrors] = useState<number | null>(null);
  const [version, setVersion] = useState<Game | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setProblem(null);
    if (hasDraft) {
      api
        .draft(gameId)
        .then(async (d) => {
          if (!alive) return;
          const content = d.content as Game;
          setDraft({ content, meta: d.meta as EditorMeta });
          const { validateDraft } = await import("../../../../lib/editor/validation.ts");
          if (alive) setErrors(validateDraft(content, d.meta as EditorMeta).filter((i) => i.severity === "error").length);
        })
        .catch((err) => alive && !(err instanceof ApiError && err.status === 404) && setProblem(errorText(err)));
    }
    if (latestVersion !== null) {
      api
        .gameVersion(gameId, latestVersion)
        .then((v) => alive && setVersion(v.content))
        .catch((err) => alive && setProblem(errorText(err)));
    }
    return () => {
      alive = false;
    };
  }, [open, gameId, latestVersion, hasDraft]);

  const content = source === "draft" ? draft?.content : version;
  const name = exportName(content ?? version ?? draft?.content, gameId, source, latestVersion);

  const download = () => {
    if (!content) return;
    saveJson(content, name);
    notify(`„${name}“ gespeichert`, "ok");
    onClose();
  };

  return (
    <Dialog open={open} title="Als Datei exportieren" onClose={onClose}>
      <div class="stack">
        <fieldset class="stack tight">
          <legend class="sr-only">Was exportieren?</legend>
          {latestVersion !== null && (
            <label class="check">
              <input type="radio" name="export-quelle" checked={source === "version"} onChange={() => setSource("version")} />
              Veröffentlichte Version {latestVersion}
            </label>
          )}
          {hasDraft && (
            <label class="check">
              <input type="radio" name="export-quelle" checked={source === "draft"} onChange={() => setSource("draft")} />
              Aktueller Entwurf
            </label>
          )}
        </fieldset>
        {source === "draft" && errors !== null && errors > 0 && (
          <p class="notice">
            Der Entwurf hat {errors === 1 ? "einen Fehler" : `${errors} Fehler`}. Die Datei lässt sich so erst nach dem Beheben wieder importieren.
          </p>
        )}
        <p class="small muted">
          Datei: <span class="mono">{name}</span>
        </p>
        {problem && (
          <p class="notice error" role="alert">
            {problem}
          </p>
        )}
        <div class="form-actions">
          <button type="button" class="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" class="btn primary" disabled={!content} onClick={download}>
            Herunterladen
          </button>
        </div>
      </div>
    </Dialog>
  );
}
