/**
 * Paket A: Beim Öffnen liegt auf diesem Gerät ein jüngerer Stand als auf dem Server (Netz weg,
 * Tab abgestürzt). Übernehmen ersetzt den Entwurf und speichert sofort, Verwerfen löscht die Sicherung.
 */

import { useState } from "preact/hooks";
import { describeDiff, diffSummary } from "../../../lib/editor/diff.ts";
import { editor, useEditorSelect } from "../../../lib/editor/store.ts";
import type { Game, LocalBackup } from "../../../lib/editor/types.ts";
import { formatAgo, formatDateTime } from "../../../lib/format.ts";
import { errorText, notify } from "../../../lib/session.ts";
import { Dialog } from "../../../ui/components.tsx";

/** „Änderungen von 22.10.2026, 17:02 Uhr (vor 3 Min)“ und was sich unterscheidet. */
export function backupSummary(backup: LocalBackup, server: Game, now = Date.now()): { when: string; what: string } {
  return { when: `${formatDateTime(backup.at)} (${formatAgo(backup.at, now)})`, what: describeDiff(diffSummary(server, backup.game)) };
}

export function LocalBackupDialog() {
  const backup = useEditorSelect((s) => s.pendingBackup);
  const game = useEditorSelect((s) => s.game);
  const [busy, setBusy] = useState(false);
  const text = backup ? backupSummary(backup, game) : null;

  const apply = async () => {
    setBusy(true);
    try {
      await editor.get().current?.applyBackup();
      notify("Änderungen von diesem Gerät übernommen", "ok");
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    // Esc verwirft nichts: die Entscheidung trifft die Person mit einem der beiden Knöpfe.
    <Dialog open={!!backup} title="Ungespeicherte Änderungen auf diesem Gerät" onClose={() => undefined}>
      {text && (
        <div class="stack">
          <p>Auf diesem Gerät liegen Änderungen von {text.when}, die noch nicht auf dem Server sind.</p>
          {text.what !== "nichts" && <p class="muted">Betroffen: {text.what}.</p>}
          <div class="form-actions">
            <button type="button" class="btn" onClick={() => editor.get().current?.discardBackup()}>
              Verwerfen
            </button>
            <button type="button" class="btn primary" disabled={busy} onClick={() => void apply()}>
              Übernehmen
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
