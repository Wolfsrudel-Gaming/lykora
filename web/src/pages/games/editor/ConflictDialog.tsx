/**
 * Paket A: Konflikt beim Speichern (UX §16.6). Jemand anderes hat den Entwurf inzwischen gespeichert;
 * der Baukasten speichert nicht still darüber. Wahl: deren Stand laden (der eigene geht vorher als
 * Datei in die Downloads) oder den eigenen behalten und überschreiben. Ist der Entwurf inzwischen
 * gelöscht worden, gibt es keinen fremden Stand: dann den eigenen neu anlegen oder als Datei sichern.
 */

import { useEffect, useState } from "preact/hooks";
import { saveJson } from "../../../lib/download.ts";
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
      // Nur melden, was stimmt: „mine“ speichert erneut und kann wieder scheitern.
      const status = store.get().save.status;
      if (status === "saved") {
        notify(choice === "theirs" ? `Stand von ${text.who} geladen. Deiner liegt als Datei in den Downloads.` : "Dein Stand ist gespeichert.", "ok");
        onClose();
      } else if (status === "conflict") {
        notify("Inzwischen hat jemand noch einmal gespeichert. Bitte entscheide neu.", "warn");
      } else {
        notify("Das Speichern hat nicht geklappt. Dein Stand ist noch nicht gespeichert.", "error");
      }
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const recreate = async () => {
    const store = editor.get().current;
    if (!store) return;
    setBusy(true);
    try {
      await store.resolveConflict("mine");
      if (store.get().save.status === "saved") {
        notify("Dein Stand ist als neuer Entwurf gespeichert.", "ok");
        onClose();
      } else notify("Das Speichern hat nicht geklappt. Dein Stand ist noch nicht gespeichert.", "error");
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!theirs && s.save.status === "conflict") {
    return (
      <Dialog open={open} title="Der Entwurf wurde gelöscht" onClose={onClose}>
        <div class="stack">
          <p>Jemand hat den Entwurf verworfen, während du daran gearbeitet hast. Dein Stand ist nur noch hier im Browser.</p>
          <div class="form-actions">
            <button type="button" class="btn" onClick={() => saveJson(s.game, `${s.gameId}-entwurf.json`)}>
              Meinen Stand als Datei sichern
            </button>
            <button type="button" class="btn primary" disabled={busy} onClick={() => void recreate()}>
              Meinen Stand neu anlegen
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

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
