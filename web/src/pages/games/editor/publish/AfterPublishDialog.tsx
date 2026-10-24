/**
 * Paket E: Dialog nach dem Veröffentlichen (UX §16.7). Geplante Events, die noch nicht gestartet
 * sind, lassen sich auf die neue Version umstellen (Code und Aushang bleiben); dazu „Event anlegen“
 * und „Schilder drucken“. Laufende und beendete Events behalten ihre Version.
 */

import { useEffect, useState } from "preact/hooks";
import type { PublishResult } from "../../../../lib/editor/types.ts";
import { formatDateTime } from "../../../../lib/format.ts";
import { can } from "../../../../lib/roles.ts";
import { href } from "../../../../lib/router.ts";
import { api, currentOrg, errorText, notify } from "../../../../lib/session.ts";
import { Dialog, Link } from "../../../../ui/components.tsx";

export function AfterPublishDialog({ gameId, result, onClose }: { gameId: string; result: PublishResult | null; onClose: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const planned = result?.plannedEvents ?? [];
  const version = result?.version ?? 0;
  useEffect(() => setChosen(new Set(planned.map((e) => e.id))), [result]);

  const finish = async () => {
    if (!chosen.size) return onClose();
    setBusy(true);
    const failed: string[] = [];
    for (const e of planned.filter((p) => chosen.has(p.id))) {
      try {
        await api.updateEvent(e.id, { version });
      } catch (err) {
        failed.push(`„${e.name}“: ${errorText(err)}`);
      }
    }
    setBusy(false);
    const done = chosen.size - failed.length;
    if (done) notify(`${done === 1 ? "1 Event nutzt" : `${done} Events nutzen`} jetzt Version ${version}.`, "ok");
    if (failed.length) notify(`Nicht umgestellt: ${failed.join(" · ")}`, "error");
    onClose();
  };

  return (
    <Dialog open={!!result} title={`Version ${version} ist veröffentlicht`} onClose={onClose}>
      <div class="stack">
        <p>Neue Events nutzen ab jetzt Version {version}.</p>
        {planned.length > 0 && (
          <fieldset class="stack tight pub-planned">
            <legend>Geplante Events, die noch nicht gestartet sind:</legend>
            {planned.map((e) => (
              <label key={e.id} class="check">
                <input
                  type="checkbox"
                  checked={chosen.has(e.id)}
                  onChange={(ev) => {
                    const next = new Set(chosen);
                    if (ev.currentTarget.checked) next.add(e.id);
                    else next.delete(e.id);
                    setChosen(next);
                  }}
                />
                <span>
                  <strong>{e.name}</strong>
                  {e.scheduledAt ? ` · ${formatDateTime(e.scheduledAt)}` : ""} · nutzt Version {e.gameVersion}
                  <br />
                  <span class="small muted">→ auf Version {version} umstellen. Code und Aushang bleiben gleich.</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <p class="small muted">Laufende und beendete Events behalten ihre Version.</p>
        <div class="form-actions">
          {can(currentOrg()?.role, "event.manage") && (
            <Link to={href("eventNew", {}, { spiel: gameId })} class="btn">
              Event anlegen
            </Link>
          )}
          <Link to={href("editorSection", { gameId, section: "veroeffentlichen" }, { drucken: "schilder" })} class="btn" onClick={onClose}>
            Schilder drucken
          </Link>
          <button type="button" class="btn primary" disabled={busy} onClick={() => void finish()}>
            {chosen.size ? "Umstellen und schließen" : "Schließen"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
