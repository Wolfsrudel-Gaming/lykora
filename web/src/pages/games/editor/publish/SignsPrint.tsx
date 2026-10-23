/**
 * Paket E: Druckansichten im Bereich Veröffentlichen (…/veroeffentlichen?drucken=schilder|blatt).
 * Stationsschilder (UX §17.2): je QR-Code ein A5-Blatt mit Nummer, QR-Code und dem Code zum
 * Eintippen; der Name nur auf Wunsch, weil er verraten kann, was kommt. Notfall-Codes und
 * Lösungen stehen nur auf dem Blatt für die Spielleitung.
 */

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { signsData, solutionSheet, stationsWithoutSign } from "../../../../lib/editor/print.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { formatDate } from "../../../../lib/format.ts";
import { href } from "../../../../lib/router.ts";
import { Link } from "../../../../ui/components.tsx";
import { Icon } from "../../../../ui/icons.tsx";
import { QrCode } from "../../../../ui/qr.tsx";

function Toolbar({ gameId, title, children }: { gameId: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="stack no-print">
      <div class="row between wrap">
        <h2 id="bereich-veroeffentlichen" tabIndex={-1}>
          {title}
        </h2>
        <div class="row wrap">
          <Link to={href("editorSection", { gameId, section: "veroeffentlichen" })} class="btn">
            Zurück zur Checkliste
          </Link>
          <button type="button" class="btn primary" onClick={() => window.print()}>
            <Icon name="print" /> Drucken
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

export function SignsPrint({ gameId }: { gameId: string }) {
  const game = useEditorSelect((s) => s.game);
  const [names, setNames] = useState(false);
  const signs = signsData(game);
  const without = stationsWithoutSign(game);
  return (
    <section class="stack" aria-labelledby="bereich-veroeffentlichen">
      <Toolbar gameId={gameId} title="Stationsschilder drucken">
        <p class="small muted">Je QR-Code ein Schild im Format A5. Druck in Schwarzweiß reicht. Notfall-Codes stehen auf dem Blatt für die Spielleitung, nicht auf den Schildern.</p>
        <label class="check">
          <input type="checkbox" checked={names} onChange={(e) => setNames(e.currentTarget.checked)} />
          Namen auf den Schildern zeigen (kann verraten, was kommt)
        </label>
        {without.length > 0 && <p class="small muted">Ohne Schild, weil ohne QR-Code: {without.map((n) => `„${n}“`).join(", ")}.</p>}
      </Toolbar>
      {signs.length === 0 ? (
        <p class="empty">Keine Station hat einen QR-Code. Schilder gibt es erst mit QR-Auslöser.</p>
      ) : (
        <div class="pub-signs">
          {signs.map((s) => (
            <article key={s.qr} class="pub-sign" aria-label={`Schild ${s.number}`}>
              <p class="pub-sign-number">{s.number}</p>
              {names && <p class="pub-sign-name">{s.name}</p>}
              <QrCode value={s.qr} size={480} label={`QR-Code ${s.qr}`} />
              <p class="pub-sign-code">
                Kein Scan? In der App „Code eingeben“: <strong class="mono">{s.qr}</strong>
              </p>
              <p class="pub-sign-brand">Lykora</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SolutionPrint({ gameId }: { gameId: string }) {
  const game = useEditorSelect((s) => s.game);
  const sheet = solutionSheet(game);
  return (
    <section class="stack" aria-labelledby="bereich-veroeffentlichen">
      <Toolbar gameId={gameId} title="Blatt für die Spielleitung">
        <p class="small muted">Lösungen, Notfall-Codes, NFC-Werte und Aufbau-Notizen. Nicht an Teams weitergeben.</p>
      </Toolbar>
      <header class="stack tight pub-sheet-head">
        <h1 class="print-only">Blatt für die Spielleitung: {sheet.title}</h1>
        <p class="print-only small">gedruckt am {formatDate(Date.now())}</p>
        <dl class="kv">
          <dt>Spielleitung</dt>
          <dd>{sheet.phone || "noch nicht eingetragen"}</dd>
          <dt>Notruf</dt>
          <dd>{sheet.emergencyNumber}</dd>
          {sheet.finalCode && (
            <>
              <dt>Finalcode</dt>
              <dd class="solution mono">{sheet.finalCode}</dd>
            </>
          )}
        </dl>
      </header>
      <table class="table cards pub-sheet">
        <thead>
          <tr>
            <th>Nr.</th>
            <th>Station</th>
            <th>Rätsel und Lösung</th>
            <th>Codes</th>
            <th>Aufbau</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r) => (
            <tr key={r.stationId}>
              <td data-label="Nr." class="num">
                {r.number}
              </td>
              <td data-label="Station">
                <strong>{r.name}</strong>
                {r.hidden && <span class="badge quiet">versteckt</span>}
              </td>
              <td data-label="Rätsel und Lösung">
                {r.task ? (
                  <>
                    <span class="muted">{r.task.kind}:</span> {r.task.question}
                    {r.task.solution.length > 0 && <div class="solution">{r.task.solution.join(" · ")}</div>}
                  </>
                ) : (
                  <span class="muted">ohne Rätsel</span>
                )}
                {r.fragments.length > 0 && <div class="small">Codeteil: {r.fragments.join(", ")}</div>}
              </td>
              <td data-label="Codes" class="small">
                {r.qr.map((c) => (
                  <div key={c}>
                    QR <span class="mono">{c}</span>
                  </div>
                ))}
                {r.manual.map((c) => (
                  <div key={c}>
                    Notfall <strong class="mono">{c}</strong>
                  </div>
                ))}
                {r.nfc.map((c) => (
                  <div key={c}>
                    NFC <span class="mono">{c}</span>
                  </div>
                ))}
              </td>
              <td data-label="Aufbau" class="small">
                {r.props.length > 0 && <div>{r.props.join(", ")}</div>}
                {r.notes && <div class="muted">{r.notes}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
