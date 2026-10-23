/**
 * Paket A: Beim Öffnen liegt auf diesem Gerät ein jüngerer Stand als auf dem Server (Netz weg,
 * Tab abgestürzt). Übernehmen ersetzt den Entwurf und speichert sofort, Verwerfen löscht die Sicherung.
 * Beruht die Sicherung auf einem älteren Stand (inzwischen hat jemand gespeichert), wird sie nie still
 * gelöscht: sie lässt sich als Datei sichern, und Übernehmen überschreibt dann bewusst den neueren Stand.
 */

import { useState } from "preact/hooks";
import { saveJson } from "../../../lib/download.ts";
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

/** Die Sicherung beruht auf einem älteren Serverstand: inzwischen wurde der Entwurf von jemand anderem gespeichert. */
export function isOlderBackup(backup: Pick<LocalBackup, "revision">, serverRevision: number): boolean {
  return backup.revision < serverRevision;
}

export function LocalBackupDialog() {
  const backup = useEditorSelect((s) => s.pendingBackup);
  const game = useEditorSelect((s) => s.game);
  const revision = useEditorSelect((s) => s.revision);
  const gameId = useEditorSelect((s) => s.gameId);
  const [busy, setBusy] = useState(false);
  const text = backup ? backupSummary(backup, game) : null;
  const older = !!backup && isOlderBackup(backup, revision);

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
          {older && (
            <p class="notice warn">
              Diese Änderungen beruhen auf einem älteren Stand. Inzwischen hat jemand den Entwurf auch geändert. Wenn du übernimmst, werden diese neueren Änderungen überschrieben. Sichere dir vorher am besten eine Datei.
            </p>
          )}
          <div class="form-actions">
            {older && backup && (
              <button type="button" class="btn" onClick={() => saveJson(backup.game, `${gameId}-sicherung.json`)}>
                Als Datei sichern
              </button>
            )}
            <button type="button" class="btn" onClick={() => editor.get().current?.discardBackup()}>
              Verwerfen
            </button>
            <button type="button" class="btn primary" disabled={busy} onClick={() => void apply()}>
              {older ? "Trotzdem übernehmen" : "Übernehmen"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
