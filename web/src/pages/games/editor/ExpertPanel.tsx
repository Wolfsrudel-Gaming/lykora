/**
 * Paket A: Expertenansicht (⋯ › Expertenansicht oder ?experte=1). Zeigt, was der Baukasten sonst
 * verbirgt: Kennungen (umbenennen zieht alle Verweise mit), Rohfelder ohne Wirkung in der App
 * (Bluetooth- und Box-Auslöser, Kachel-Adresse, Abschriften, Codeteil-Beschriftungen) und den
 * Entwurf als JSON – nur zum Lesen, Kopieren und Herunterladen.
 */

import { useState } from "preact/hooks";
import { saveJson } from "../../../lib/download.ts";
import { takenIds } from "../../../lib/editor/ids.ts";
import { renameId } from "../../../lib/editor/references.ts";
import { editor, useEditorSelect } from "../../../lib/editor/store.ts";
import { readText } from "../../../lib/editor/text.ts";
import type { Game, IdKind } from "../../../lib/editor/types.ts";
import { setQuery } from "../../../lib/router.ts";
import { notify } from "../../../lib/session.ts";
import { confirm } from "../../../ui/components.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { NumberInput } from "./ui/NumberInput.tsx";
import { KIND_LABELS, refOptions } from "./ui/RefSelect.tsx";
import { TextField } from "./ui/TextField.tsx";

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Prüft eine neue Kennung; liefert den Grund, warum sie nicht geht, oder null. */
export function idProblem(game: Game, kind: IdKind, from: string, to: string): string | null {
  if (to === from) return "Das ist schon die Kennung.";
  if (!ID_PATTERN.test(to)) return "Nur Kleinbuchstaben, Ziffern, - und _, am Anfang ein Buchstabe oder eine Ziffer, höchstens 64 Zeichen.";
  if (takenIds(game, kind).includes(to)) return `„${to}“ ist schon vergeben.`;
  return null;
}

const ID_KINDS: IdKind[] = ["station", "figur", "gegenstand", "kapitel", "teil", "zone", "regel", "medium", "punkt"];

export function ExpertPanel({ gameId }: { gameId: string }) {
  return (
    <section class="card stack editor-expert" aria-labelledby="experten">
      <header class="row between">
        <h2 id="experten">Expertenansicht</h2>
        <button
          type="button"
          class="btn small"
          onClick={() => {
            editor.get().current?.setExpert(false);
            setQuery({ experte: null });
          }}
        >
          <Icon name="x" /> Schließen
        </button>
      </header>
      <p class="small muted">Für Fachleute: Kennungen, Felder ohne Wirkung in der App und der Entwurf als JSON. Im übrigen Baukasten bleibt das verborgen.</p>
      <Ids />
      <RawFields />
      <Json gameId={gameId} />
    </section>
  );
}

function Ids() {
  const rows = useEditorSelect(
    (s) => {
      const out: { kind: IdKind; id: string; label: string }[] = [];
      for (const kind of ID_KINDS) for (const o of refOptions(s.game, kind, s.lang)) out.push({ kind, id: o.value, label: o.label });
      return out;
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const gameIdInFile = useEditorSelect((s) => s.game.id);

  const rename = async (kind: IdKind, from: string, label: string) => {
    const store = editor.get().current;
    if (!store) return;
    const answer = await confirm({
      title: `Kennung von „${label}“ ändern`,
      body: (
        <p>
          Alle Verweise im Spiel ziehen mit. Laufende Events und gedruckte Codes nutzen weiter die alte Kennung <code>{from}</code>.
        </p>
      ),
      input: { label: "Neue Kennung", placeholder: from, required: true },
      confirm: "Ändern",
    });
    if (!answer.ok) return;
    const to = answer.value;
    const problem = idProblem(store.get().game, kind, from, to);
    if (problem) return notify(problem, "warn");
    let moved = 0;
    store.update(`Kennung „${from}“ in „${to}“ geändert`, (g, meta) => {
      moved = renameId(g, kind, from, to, meta);
    });
    notify(`Kennung geändert${moved ? `, ${moved} ${moved === 1 ? "Verweis" : "Verweise"} mitgezogen` : ""}.`, "ok");
  };

  return (
    <details class="stack" open>
      <summary>Kennungen</summary>
      <table class="table editor-ids">
        <thead>
          <tr>
            <th scope="col">Art</th>
            <th scope="col">Name</th>
            <th scope="col">Kennung</th>
            <th scope="col">
              <span class="sr-only">Aktion</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="Art">Spiel</td>
            <td data-label="Name">–</td>
            <td data-label="Kennung" class="keep-case">
              <code>{gameIdInFile}</code>
            </td>
            <td />
          </tr>
          {rows.map((r) => (
            <tr key={`${r.kind}:${r.id}`}>
              <td data-label="Art">{KIND_LABELS[r.kind]}</td>
              <td data-label="Name" class="wrap-anywhere">
                {r.label}
              </td>
              <td data-label="Kennung" class="keep-case wrap-anywhere">
                <code>{r.id}</code>
              </td>
              <td>
                {r.kind !== "teil" && (
                  <button type="button" class="btn small ghost" aria-label={`Kennung von ${r.label} ändern`} onClick={() => void rename(r.kind, r.id, r.label)}>
                    <Icon name="edit" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Entfernt einen Auslöser (ein Schritt im Verlauf); die Station behält die übrigen. */
function deleteTrigger(stationId: string, index: number, type: "ble" | "box"): void {
  editor.get().current?.update(`${type === "ble" ? "Bluetooth-Auslöser" : "Box-Auslöser"} entfernt`, (g) => {
    const st = g.stations?.find((x) => x?.id === stationId);
    if (st?.triggers?.[index]?.type === type) st.triggers.splice(index, 1);
  });
}

type RawTrigger = { type: "ble" | "box"; station: string; stationIndex: number; index: number; name: string };

function RawFields() {
  const lang = useEditorSelect((s) => s.lang);
  const triggers = useEditorSelect(
    (s) => {
      const out: RawTrigger[] = [];
      (Array.isArray(s.game.stations) ? s.game.stations : []).forEach((st, i) =>
        (Array.isArray(st?.triggers) ? st.triggers : []).forEach((t, k) => {
          if (t?.type === "ble" || t?.type === "box") out.push({ type: t.type, station: st.id, stationIndex: i, index: k, name: readText(st.name as never, lang) || st.id });
        }),
      );
      return out;
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const media = useEditorSelect(
    (s) => (Array.isArray(s.game.media) ? s.game.media : []).map((m, i) => ({ i, id: m?.id, type: m?.type, name: readText(m?.alt as never, s.lang) || m?.id })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const fragments = useEditorSelect((s) => (Array.isArray(s.game.fragments) ? s.game.fragments.length : 0));

  return (
    <details class="stack">
      <summary>Felder ohne Wirkung in der App</summary>
      <TextField
        path="/settings/map/tiles"
        label="Kartenkacheln (Adresse)"
        plain
        inputMode="url"
        placeholder="tiles/sieglar/{z}/{x}/{y}.png"
        hint="Vorlage mit {z}/{x}/{y}. Ohne https:// gilt sie relativ zum Server (eigenes Kartenpaket, Nachtvariante: tiles/sieglar-nacht/{z}/{x}/{y}.png); leer heißt OpenStreetMap. Das Dashboard nutzt sie schon, die App liest bisher nur vollständige Adressen."
      />
      <h3>Bluetooth- und Box-Auslöser</h3>
      {!triggers.length && <p class="small muted">Keine. Neue legst du im Stationseditor bei den Auslösern an.</p>}
      {triggers.map((t) => {
        const base = `/stations/${t.stationIndex}/triggers/${t.index}`;
        return (
          <fieldset key={base} class="card flat stack tight" data-objekt={t.station}>
            <legend>
              {t.name}: {t.type === "ble" ? "Bluetooth-Beacon" : "ESP32-Box"}
            </legend>
            {t.type === "ble" ? (
              <div class="grid-2">
                <TextField path={`${base}/uuid`} label="UUID" plain required />
                <NumberInput path={`${base}/rssi`} label="Mindest-Signalstärke" unit="dBm" integer />
                <NumberInput path={`${base}/major`} label="Major" integer min={0} />
                <NumberInput path={`${base}/minor`} label="Minor" integer min={0} />
              </div>
            ) : (
              <div class="grid-2">
                <TextField path={`${base}/box`} label="Kennung der Box" plain required />
                <TextField path={`${base}/event`} label="Ereignis" plain />
              </div>
            )}
            <div>
              <button type="button" class="btn small" onClick={() => deleteTrigger(t.station, t.index, t.type)}>
                <Icon name="trash" /> Auslöser entfernen
              </button>
            </div>
          </fieldset>
        );
      })}
      {media.some((m) => m.type === "audio" || m.type === "video") && <h3>Abschriften von Klängen und Videos</h3>}
      {media
        .filter((m) => m.type === "audio" || m.type === "video")
        .map((m) => (
          <div key={m.id ?? m.i} data-objekt={m.id}>
            <TextField path={`/media/${m.i}/transcript`} label={`Abschrift: ${m.name ?? `Medium ${m.i + 1}`}`} multiline rows={2} />
          </div>
        ))}
      {fragments > 0 && <h3>Beschriftung der Codeteile</h3>}
      {Array.from({ length: fragments }, (_, i) => (
        <TextField key={i} path={`/fragments/${i}/label`} label={`Codeteil ${i + 1}`} />
      ))}
      <TextField path="/story/hq/avatar" label="Bild der Zentrale (Medien-Kennung)" plain />
    </details>
  );
}

function Json({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const game = useEditorSelect((s) => s.game);
  // Erst beim Aufklappen umwandeln: große Spiele sind sonst bei jeder Änderung teuer.
  const json = open ? JSON.stringify(game, null, 2) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(game, null, 2));
      notify("JSON kopiert", "ok");
    } catch {
      notify("Kopieren ging nicht. Markiere den Text und kopiere ihn von Hand.", "warn");
    }
  };
  return (
    <details class="stack" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Entwurf als JSON (nur lesen)</summary>
      <div class="row">
        <button type="button" class="btn small" onClick={() => void copy()}>
          Kopieren
        </button>
        <button type="button" class="btn small" onClick={() => saveJson(game, `${game.id || gameId}-entwurf.json`)}>
          <Icon name="download" /> Herunterladen
        </button>
      </div>
      {open && (
        <pre class="editor-json" tabIndex={0} aria-label="Entwurf als JSON">
          <code>{json}</code>
        </pre>
      )}
    </details>
  );
}
