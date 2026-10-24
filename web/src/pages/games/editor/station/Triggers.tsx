/**
 * Paket C: Auslöser einer Station als Chips; ✎ öffnet das Formular darunter. GPS, QR-Code, NFC-Tag und
 * Notfall-Code für alle, Bluetooth und Box nur in der Expertenansicht (ohne Wirkung in der App).
 * Ein Typwechsel baut den Auslöser neu, der letzte lässt sich nicht löschen.
 */

import { useState } from "preact/hooks";
import { allCodes, newManualCode, newQrCode } from "../../../../lib/editor/ids.ts";
import { GPS_RADIUS, newTrigger, TRIGGER_LABELS, TRIGGER_TYPES, type Trigger, type TriggerType } from "../../../../lib/editor/stations.ts";
import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { QrCode } from "../../../../ui/qr.tsx";
import { Collapsible } from "../ui/Collapsible.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { TextField } from "../ui/TextField.tsx";
import { LocationField, Menu, stationPath, store, useSectionState } from "./common.tsx";

/** Ohne Wirkung in der App: nur in der Expertenansicht bearbeiten, löschen überall. */
const EXPERT_ONLY = new Set<TriggerType>(["ble", "box"]);

/** Kurzform auf dem Chip: „GPS · 20 m“, „QR-Code LYK-7KQ4“. */
export function triggerChip(t: Trigger): string {
  switch (t.type) {
    case "gps":
      return `GPS · ${t.radius ?? GPS_RADIUS} m`;
    case "qr":
      return `QR-Code ${t.code || "ohne Code"}`;
    case "manual":
      return `Notfall-Code ${t.code || "–"}`;
    case "nfc":
      return `NFC-Tag ${t.tag ? "✓" : "ohne Kennung"}`;
    case "ble":
      return "Bluetooth-Beacon";
    case "box":
      return `Box ${t.box || ""}`.trim();
  }
}

export function Triggers({ station, index }: { station: Station; index: number }) {
  const p = stationPath(index);
  const expert = useEditorSelect((s) => s.expert);
  const triggers = (station.triggers ?? []).filter((t): t is Trigger => !!t && typeof t === "object");
  const [open, setOpen] = useState<number | null>(null);
  const state = useSectionState([`${p}/triggers`], triggers.length > 0);
  const listIssues = useIssuesAt(`${p}/triggers`).filter((i) => i.at.path === `${p}/triggers`);
  const offered = TRIGGER_TYPES.filter((t) => expert || !EXPERT_ONLY.has(t));

  const add = (type: TriggerType) => {
    store().update(`Auslöser „${TRIGGER_LABELS[type]}“ hinzugefügt`, (g) => {
      const s = g.stations[index]!;
      s.triggers = [...(s.triggers ?? []), newTrigger(type, g)];
    });
    setOpen(triggers.length);
  };

  return (
    <Collapsible title="Auslöser" summary={triggers.map(triggerChip).join(" · ") || "keiner"} state={state} open feld="triggers">
      <p class="small muted">So wird die Station geweckt. Jeder einzelne Auslöser reicht; mehrere sind ein Plan B, falls GPS spinnt.</p>
      <ul class="st-chips" aria-label="Auslöser">
        {triggers.map((t, j) => (
          <li key={j}>
            <button type="button" class={`chip st-chip${open === j ? " on" : ""}`} aria-expanded={open === j} onClick={() => setOpen(open === j ? null : j)}>
              {triggerChip(t)}
              {EXPERT_ONLY.has(t.type) && <span class="muted"> (ohne Wirkung)</span>}
              <Icon name="edit" size={14} />
            </button>
          </li>
        ))}
        <li>
          <Menu label="Auslöser hinzufügen" text={<>+ Auslöser ▾</>}>
            {(close) =>
              offered.map((type) => (
                <li key={type}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      add(type);
                    }}
                  >
                    + {TRIGGER_LABELS[type]}
                  </button>
                </li>
              ))
            }
          </Menu>
        </li>
      </ul>
      <IssueList issues={listIssues} />
      {open !== null && triggers[open] && <TriggerForm key={open} trigger={triggers[open]!} stationIndex={index} index={open} last={triggers.length <= 1} expert={expert} onClose={() => setOpen(null)} />}
    </Collapsible>
  );
}

function TriggerForm({ trigger, stationIndex, index, last, expert, onClose }: { trigger: Trigger; stationIndex: number; index: number; last: boolean; expert: boolean; onClose: () => void }) {
  const editable = expert || !EXPERT_ONLY.has(trigger.type);
  const path = `${stationPath(stationIndex)}/triggers/${index}`;
  const label = TRIGGER_LABELS[trigger.type];

  const switchType = (type: TriggerType) =>
    store().update(`Auslöser zu „${TRIGGER_LABELS[type]}“ geändert`, (g) => {
      g.stations[stationIndex]!.triggers[index] = newTrigger(type, g);
    });
  const remove = () => {
    store().update(`Auslöser „${label}“ entfernt`, (g) => {
      g.stations[stationIndex]!.triggers.splice(index, 1);
    });
    onClose();
  };
  const regenerate = (kind: "qr" | "manual") =>
    store().update(kind === "qr" ? "QR-Code neu erzeugt" : "Notfall-Code neu erzeugt", (g) => {
      const t = g.stations[stationIndex]!.triggers[index];
      if (t && (t.type === "qr" || t.type === "manual")) t.code = kind === "qr" ? newQrCode(allCodes(g)) : newManualCode(allCodes(g));
    });

  return (
    <div class="st-subcard stack" data-feld={`triggers.${index}`}>
      <div class="row between">
        <label class="row nowrap">
          <span class="label">Art</span>
          <select value={trigger.type} disabled={!editable} onChange={(e) => switchType(e.currentTarget.value as TriggerType)}>
            {TRIGGER_TYPES.filter((t) => expert || !EXPERT_ONLY.has(t) || t === trigger.type).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <span class="row nowrap">
          <button type="button" class="btn small ghost" disabled={last} title={last ? "Eine Station braucht mindestens einen Auslöser." : undefined} onClick={remove}>
            <Icon name="trash" /> Entfernen
          </button>
          <button type="button" class="btn small ghost" onClick={onClose}>
            Fertig
          </button>
        </span>
      </div>
      {last && <p class="small muted">Der letzte Auslöser bleibt – eine Station braucht mindestens einen.</p>}
      {!editable && <p class="small muted">Diesen Auslöser kennt die App nicht. Bearbeiten kannst du ihn in der Expertenansicht.</p>}
      {trigger.type === "gps" && (
        <>
          <GpsRadius path={`${path}/radius`} value={trigger.radius} />
          {expert && <LocationField path={`${path}/location`} label="Eigener Ort für den Auslöser" hint="Nur, wenn er vom Ort der Station abweicht. Leer lassen = Ort der Station." />}
        </>
      )}
      {trigger.type === "qr" && (
        <div class="st-qr">
          <div class="stack tight min0">
            <TextField path={`${path}/code`} label="Code" plain required hint="Der Code steht auch zum Eintippen auf dem Schild. Neu erzeugen macht gedruckte Schilder ungültig." />
            <button type="button" class="btn small" onClick={() => regenerate("qr")}>
              <Icon name="refresh" /> Neu erzeugen
            </button>
          </div>
          {trigger.code && <QrCode value={trigger.code} label={`QR-Code ${trigger.code}`} size={160} />}
        </div>
      )}
      {trigger.type === "nfc" && (
        <TextField path={`${path}/tag`} label="Chip-Kennung (UID)" plain required placeholder="04:A1:B2:C3:D4:E5:F6" hint="Mit einer NFC-App die Kennung des Stickers auslesen. Text auf dem Tag liest die App nicht." />
      )}
      {trigger.type === "manual" && (
        <div class="stack tight">
          <TextField path={`${path}/code`} label="Notfall-Code" plain required inputMode="numeric" hint="Für Spielleitung und Betreuer: per Funk durchgeben, wenn sonst nichts geht. Steht nicht auf dem Schild." />
          <button type="button" class="btn small st-self-start" onClick={() => regenerate("manual")}>
            <Icon name="refresh" /> Neu erzeugen
          </button>
        </div>
      )}
      {trigger.type === "ble" && editable && (
        <div class="grid-2">
          <TextField path={`${path}/uuid`} label="UUID" plain required />
          <NumberInput path={`${path}/major`} label="Major" integer min={0} max={65535} />
          <NumberInput path={`${path}/minor`} label="Minor" integer min={0} max={65535} />
          <NumberInput path={`${path}/rssi`} label="Mindest-Signal" unit="dBm" integer max={0} placeholder="-75" />
        </div>
      )}
      {trigger.type === "box" && editable && (
        <div class="grid-2">
          <TextField path={`${path}/box`} label="Kennung der Box" plain required />
          <TextField path={`${path}/event`} label="Ereignis" plain placeholder="solved" />
        </div>
      )}
    </div>
  );
}

/** GPS-Radius als Schieber 10–100 m mit Zahl; leer gilt der Standard 20 m. */
function GpsRadius({ path, value }: { path: string; value: number | undefined }) {
  const r = value ?? GPS_RADIUS;
  return (
    <div class="st-radius">
      <NumberInput path={path} label="Radius" unit="m" integer min={1} placeholder={String(GPS_RADIUS)} hint="Der Radius wächst automatisch, wenn das Handy schlechten Empfang meldet." />
      <input
        type="range"
        min={10}
        max={100}
        step={5}
        value={Math.min(100, Math.max(10, r))}
        aria-label="Radius in Metern"
        aria-valuetext={`${r} m`}
        onInput={(e) => store().setField(path, Number(e.currentTarget.value), "GPS-Radius geändert", { coalesce: true })}
        onBlur={() => store().touch(path)}
      />
    </div>
  );
}
