/**
 * Paket A: Konflikt beim Speichern (UX §16.6). Jemand anderes hat den Entwurf inzwischen gespeichert;
 * der Baukasten speichert nicht still darüber. Wahl: deren Stand laden (der eigene geht vorher als
 * Datei in die Downloads) oder den eigenen behalten und überschreiben.
 */

import { useEffect, useState } from "preact/hooks";
import { describeDiff, diffSummary } from "../../../lib/editor/diff.ts";
import { editor, useEditor } from "../../../lib/editor/store.ts";
import type { DraftDto, EditorState, Game } from "../../../lib/editor/types.ts";
import { formatClock } from "../../../lib/format.ts";
import { errorText, notify } from "../../../lib/session.ts";
import { Dialog } from "../../../ui/components.tsx";

/** Sätze für den Dialog: was die andere Person und was ich seit dem letzten gemeinsamen Stand geändert habe. */
export function conflictSummary(s: Pick<EditorState, "game" | "saved">, theirs: DraftDto): { who: string; at: string; theirs: string; mine: string } {
  const who = theirs.updated_by?.name || "Jemand";
  const other = theirs.content as Game;
  return {
    who,
    at: formatClock(theirs.updated_at),
    theirs: describeDiff(diffSummary(s.saved.game, other)),
    mine: describeDiff(diffSummary(s.saved.game, s.game)),
  };
}

export function ConflictDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useEditor();
  const theirs = s.save.conflict;
  const [choice, setChoice] = useState<"theirs" | "mine">("theirs");
  const [busy, setBusy] = useState(false);
  useEffect(() => setChoice("theirs"), [theirs]);
  const text = theirs && s.save.status === "conflict" ? conflictSummary(s, theirs) : null;

  const resolve = async () => {
    const store = editor.get().current;
    if (!store || !text) return;
    setBusy(true);
    try {
      await store.resolveConflict(choice);
      notify(choice === "theirs" ? `Stand von ${text.who} geladen. Deiner liegt als Datei in den Downloads.` : "Dein Stand ist gespeichert.", "ok");
      onClose();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open && !!text} title={`${text?.who ?? "Jemand"} hat den Entwurf auch geändert`} onClose={onClose}>
      {text && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void resolve();
          }}
        >
          <p>
            {text.who} hat um {text.at} gespeichert. Geändert: {text.theirs === "nichts" ? "nichts Sichtbares" : text.theirs}.
          </p>
          {text.mine !== "nichts" && <p>Von dir seit dem letzten Speichern geändert: {text.mine}.</p>}
          <fieldset class="stack tight">
            <legend class="sr-only">Welcher Stand gilt?</legend>
            <label class="check">
              <input type="radio" name="konflikt" checked={choice === "theirs"} onChange={() => setChoice("theirs")} />
              <span>Stand von {text.who} laden. Meine Änderungen sichere ich als Datei.</span>
            </label>
            <label class="check">
              <input type="radio" name="konflikt" checked={choice === "mine"} onChange={() => setChoice("mine")} />
              <span>Meinen Stand behalten. Die Änderungen von {text.who} werden überschrieben.</span>
            </label>
          </fieldset>
          <div class="form-actions">
            <button type="button" class="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button type="submit" class="btn primary" disabled={busy}>
              Weiter
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
