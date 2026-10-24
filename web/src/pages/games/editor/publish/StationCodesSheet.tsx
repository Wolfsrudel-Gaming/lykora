/**
 * Paket E: „Stations-Codes zeigen“ für den Probelauf am Schreibtisch (UX §17.1) – alle Stationen
 * untereinander, je QR-Code groß zum Scannen vom Bildschirm und der Notfall-Code zum Eintippen.
 */

import { readText } from "../../../../lib/editor/text.ts";
import type { Game } from "../../../../lib/editor/types.ts";
import { stationLabel } from "../../../../lib/editor/print.ts";
import { Dialog } from "../../../../ui/components.tsx";
import { QrCode } from "../../../../ui/qr.tsx";

export function StationCodesSheet({ game, open, onClose }: { game: Game; open: boolean; onClose: () => void }) {
  const lang = game.meta?.languages?.[0] ?? "de";
  const stations = (Array.isArray(game.stations) ? game.stations : []).map((s, i) => [s, i] as const).filter(([s]) => s && typeof s === "object");
  return (
    <Dialog open={open} title="Stations-Codes" onClose={onClose}>
      <div class="stack">
        <p class="small muted">Mit dem Testhandy vom Bildschirm scannen oder den Notfall-Code in der App unter „Code eingeben“ tippen.</p>
        <ol class="pub-codes">
          {stations.map(([s, i]) => {
            const name = readText(s.name as never, lang) || s.id;
            const qr = (s.triggers ?? []).flatMap((t) => (t?.type === "qr" && t.code ? [t.code] : []));
            const manual = (s.triggers ?? []).flatMap((t) => (t?.type === "manual" && t.code ? [t.code] : []));
            return (
              <li key={s.id} class="pub-code">
                <h3>
                  <span class="num">{stationLabel(s, i)}</span> {name}
                </h3>
                {qr.map((code) => (
                  <figure key={code}>
                    <QrCode value={code} size={240} label={`QR-Code der Station „${name}“: ${code}`} />
                    <figcaption class="mono">{code}</figcaption>
                  </figure>
                ))}
                {!qr.length && <p class="small muted">Kein QR-Code an dieser Station.</p>}
                {manual.length > 0 && (
                  <p>
                    Notfall-Code <strong class="mono">{manual.join(", ")}</strong>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div class="form-actions">
          <button type="button" class="btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </Dialog>
  );
}
