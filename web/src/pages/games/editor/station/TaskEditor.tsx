/**
 * Paket C: Rätselblock einer Station – Art mit Klartext (Wechsel über switchTaskType, die Frage bleibt),
 * darunter nur die Felder dieser Art; beim Finale die Kopplung an den Finalcode. „Ohne Rätsel“ sagt
 * offen, dass die Station dann nie als gelöst gilt.
 */

import { useState } from "preact/hooks";
import { coupleFinal, finalCode, isCoupled } from "../../../../lib/editor/fragments.ts";
import { switchTaskType, TASK_DEFAULTS, TASK_TYPE_LABELS, TASK_TYPES, type Task, type TaskType } from "../../../../lib/editor/stations.ts";
import { useEditorSelect, useIssuesAt } from "../../../../lib/editor/store.ts";
import type { Station } from "../../../../lib/editor/types.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { Chips } from "../ui/Chips.tsx";
import { IssueList } from "../ui/IssueList.tsx";
import { NumberInput } from "../ui/NumberInput.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { LocationField, MediaSlot, stationPath, store } from "./common.tsx";

type Kind = TaskType | "none";

const REVIEW_LABELS = { live: "Spielleitung prüft live", auto_accept: "Automatisch annehmen", after_game: "Nach dem Spiel prüfen", vote: "Abstimmung der Teams" } as const;
type Review = keyof typeof REVIEW_LABELS;

export function TaskEditor({ station, index }: { station: Station; index: number }) {
  const p = stationPath(index);
  const task = station.task as Task | undefined;
  const kind: Kind = task?.type ?? "none";
  const lang = useEditorSelect((s) => s.lang);
  const typeIssues = useIssuesAt(`${p}/task`).filter((i) => i.at.path === `${p}/task` || i.at.path === `${p}/task/type`);

  const switchTo = (next: Kind) =>
    store().update(next === "none" ? "Rätsel entfernt" : `Rätselart „${TASK_TYPE_LABELS[next]}“ gewählt`, (g) => {
      const s = g.stations[index]!;
      if (next === "none") delete s.task;
      else s.task = switchTaskType(s.task, next, lang, s.location);
    });

  return (
    <div class="st-task stack" data-feld="task" data-block="task">
      <div class="row between">
        <h4 class="st-lane-title">Rätsel</h4>
        <label class="row nowrap" data-feld="task.type">
          <span class="label">Art</span>
          <select value={kind} onChange={(e) => switchTo(e.currentTarget.value as Kind)}>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABELS[t]}
              </option>
            ))}
            <option value="none">Ohne Rätsel</option>
          </select>
        </label>
      </div>
      <IssueList issues={typeIssues} />
      {!task && (
        <div class="notice stack tight">
          <p>Ohne Rätsel – Teams erleben nur die Szene.</p>
          <p class="small">Eine Station ohne Rätsel gilt in der App nie als gelöst: Es gibt keine Belohnung, und „Station gelöst“ in Regeln greift nicht. Nur die Spielleitung kann sie werten.</p>
          <button type="button" class="btn small st-self-start" onClick={() => switchTo("text")}>
            <Icon name="plus" /> Rätsel hinzufügen
          </button>
        </div>
      )}
      {task?.type === "text" && <TextTask p={p} index={index} task={task} />}
      {task?.type === "code" && <CodeTask p={p} index={index} station={station} />}
      {task?.type === "choice" && <ChoiceTask p={p} index={index} task={task} />}
      {task?.type === "photo" && <PhotoTask p={p} task={task} />}
      {task?.type === "find_location" && (
        <>
          <TextField path={`${p}/task/prompt`} label="Auftrag" required multiline rows={2} placeholder="z. B. Findet die alte Eiche am Teich." />
          <LocationField
            path={`${p}/task/location`}
            label="Zielort"
            required
            radius={task.radius ?? TASK_DEFAULTS.find_location.radius}
            onRadius={(r) => store().setField(`${p}/task/radius`, Math.round(r), "Radius des Zielorts geändert", { coalesce: true })}
            hint="Die Station muss vorher geweckt sein – am besten mit einem QR-Code am Startpunkt der Suche."
          />
          <NumberInput path={`${p}/task/radius`} label="Radius" unit="m" min={1} integer placeholder={String(TASK_DEFAULTS.find_location.radius)} />
        </>
      )}
    </div>
  );
}

function TextTask({ p, index, task }: { p: string; index: number; task: Extract<Task, { type: "text" }> }) {
  const digits = task.answers.length > 0 && task.answers.every((a) => /^\d+$/.test(a));
  const lang = useEditorSelect((s) => s.lang);
  const toLock = () =>
    store().update("Als Zahlenschloss gestellt", (g) => {
      const s = g.stations[index]!;
      const next = switchTaskType(s.task, "code", lang);
      if (next.type === "code") next.input = "lock";
      s.task = next;
    });
  const typos = task.match?.maxTypos ?? TASK_DEFAULTS.text.match.maxTypos;
  return (
    <>
      <TextField path={`${p}/task/question`} label="Frage" required multiline rows={2} />
      <Chips path={`${p}/task/answers`} label="Richtige Antworten" required placeholder="z. B. Eule" hint="Enter fügt eine Antwort hinzu. Jede Antwort zählt als richtig." />
      {digits && (
        <p class="small row">
          Alle Antworten sind Ziffern.
          <button type="button" class="btn small" onClick={toLock}>
            Als Zahlenschloss stellen
          </button>
        </p>
      )}
      <details class="st-details">
        <summary>Wie streng?</summary>
        <div class="stack tight">
          <Toggle path={`${p}/task/match/ignoreCase`} label="Groß und klein egal" defaultValue={true} />
          <Toggle path={`${p}/task/match/ignoreWhitespace`} label="Leerzeichen egal" defaultValue={true} />
          <label class="field" data-feld="task.match.maxTypos">
            <span class="label">Tippfehler erlaubt</span>
            <select
              value={String(typos)}
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                store().setField(`${p}/task/match/maxTypos`, n === TASK_DEFAULTS.text.match.maxTypos ? undefined : n, "Tippfehler geändert");
              }}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={String(n)}>
                  {n === 0 ? "keine" : n}
                </option>
              ))}
            </select>
            <small>Gilt ab 7 Zeichen; bis 3 Zeichen nie, bis 6 Zeichen höchstens einer.</small>
          </label>
        </div>
      </details>
      <Toggle path={`${p}/task/manualReview`} label="Spielleitung prüft von Hand" hint="Jede Eingabe wartet auf die Spielleitung; falsche Antworten kosten nichts." />
      <QuestionImages p={p} index={index} />
    </>
  );
}

function CodeTask({ p, index, station }: { p: string; index: number; station: Station }) {
  const task = station.task as Extract<Task, { type: "code" }>;
  const final = station.final === true;
  const code = useEditorSelect((s) => finalCode(s.game));
  const coupled = useEditorSelect((s) => final && isCoupled(s.game));
  // Entkoppeln gilt für diese Sitzung; gespeichert ist nur, ob die Antwort dem Finalcode gleicht.
  const [unlocked, setUnlocked] = useState(false);
  const locked = coupled && !unlocked;
  const answerIssues = useIssuesAt(`${p}/task/answers`);
  const input = task.input ?? "";
  return (
    <>
      <TextField path={`${p}/task/question`} label="Frage" required multiline rows={2} />
      {final && code && (
        <label class="check" data-feld="task.coupled">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              setUnlocked(!on);
              if (on) store().update("Finale an den Finalcode gekoppelt", (g) => void coupleFinal(g, true));
            }}
          />
          <span>Mit Finalcode koppeln</span>
        </label>
      )}
      {locked ? (
        <div class="field" data-feld="task.answers">
          <span class="label">Code</span>
          <p>
            <span class="num st-code">{code}</span> <span class="small muted">– kommt aus Belohnungen › Finalcode und folgt ihm.</span>
          </p>
          <IssueList issues={answerIssues} />
        </div>
      ) : (
        <Chips path={`${p}/task/answers`} label="Code" required placeholder="z. B. 372" hint="Wird exakt geprüft: Groß/klein und führende Nullen zählen. Enter fügt einen weiteren richtigen Code hinzu." />
      )}
      <fieldset class="stack tight" data-feld="task.input">
        <legend class="label">Eingabe</legend>
        {(
          [
            ["", "Automatisch (Zahlenschloss bei reinen Ziffern)"],
            ["lock", "Zahlenschloss mit Rädern"],
            ["keyboard", "Tastatur"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} class="check">
            <input type="radio" name={`${p}-eingabe`} checked={input === value} onChange={() => store().setField(`${p}/task/input`, value || undefined, `Eingabe „${label}“ gewählt`)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <QuestionImages p={p} index={index} />
    </>
  );
}

function ChoiceTask({ p, index, task }: { p: string; index: number; task: Extract<Task, { type: "choice" }> }) {
  const lang = useEditorSelect((s) => s.lang);
  const options = task.options ?? [];
  const optionIssues = useIssuesAt(`${p}/task/options`).filter((i) => i.at.path === `${p}/task/options`);
  const mutate = (undo: string, fn: (list: Extract<Task, { type: "choice" }>["options"]) => void) =>
    store().update(undo, (g) => {
      const t = g.stations[index]!.task;
      if (t?.type === "choice") fn((t.options ??= []));
    });
  return (
    <>
      <TextField path={`${p}/task/question`} label="Frage" required multiline rows={2} />
      <fieldset class="stack tight" data-feld="task.options">
        <legend class="label">Antwortmöglichkeiten</legend>
        {options.map((o, k) => (
          <div key={k} class="st-option" data-feld={`task.options.${k}`}>
            <TextField path={`${p}/task/options/${k}/text`} label={`Möglichkeit ${k + 1}`} required />
            <label class="check" data-feld={`task.options.${k}.correct`}>
              <input type="checkbox" checked={o?.correct === true} onChange={(e) => store().setField(`${p}/task/options/${k}/correct`, e.currentTarget.checked, `Möglichkeit ${k + 1} ${e.currentTarget.checked ? "richtig" : "falsch"}`)} />
              <span>richtig</span>
            </label>
            <button type="button" class="btn small ghost" disabled={options.length <= 2} aria-label={`Möglichkeit ${k + 1} entfernen`} onClick={() => mutate(`Möglichkeit ${k + 1} entfernt`, (l) => l.splice(k, 1))}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
        <IssueList issues={optionIssues} />
        <button type="button" class="btn small st-self-start" onClick={() => mutate("Antwortmöglichkeit hinzugefügt", (l) => l.push({ text: { [lang]: "" }, correct: false }))}>
          <Icon name="plus" /> Antwortmöglichkeit
        </button>
        <small class="muted">Sind mehrere richtig, müssen Teams genau diese wählen.</small>
      </fieldset>
      <Toggle path={`${p}/task/shuffle`} label="Reihenfolge mischen" defaultValue={TASK_DEFAULTS.choice.shuffle} />
      <QuestionImages p={p} index={index} />
    </>
  );
}

function PhotoTask({ p, task }: { p: string; task: Extract<Task, { type: "photo" }> }) {
  const review: Review = task.review ?? TASK_DEFAULTS.photo.review;
  const issues = useIssuesAt(`${p}/task/review`);
  return (
    <>
      <TextField path={`${p}/task/prompt`} label="Auftrag" required multiline rows={2} placeholder="z. B. Macht ein Foto vom ganzen Team vor dem Tor." />
      <Toggle path={`${p}/task/video`} label="Video statt Foto" hint="Derzeit ohne Wirkung in der App – sie nimmt immer ein Foto auf." />
      <label class="field" data-feld="task.review">
        <span class="label">Prüfung</span>
        <select value={review} onChange={(e) => store().setField(`${p}/task/review`, e.currentTarget.value === "live" ? undefined : e.currentTarget.value, "Prüfung des Fotos geändert")}>
          {(Object.keys(REVIEW_LABELS) as Review[]).map((r) => (
            <option key={r} value={r}>
              {REVIEW_LABELS[r]}
            </option>
          ))}
        </select>
        {review === "live" && <small>Jemand im Leitstand muss die Fotos während des Spiels freigeben.</small>}
        {review === "auto_accept" && <small>Jedes Foto gilt sofort als richtig.</small>}
        <IssueList issues={issues} />
      </label>
    </>
  );
}

/** Bilder zur Frage (task.media); die App zeigt jedes unter der Frage. */
function QuestionImages({ p, index }: { p: string; index: number }) {
  const media = useEditorSelect((s) => {
    const m = (s.game.stations?.[index]?.task as { media?: string[] } | undefined)?.media;
    return Array.isArray(m) ? m.length : 0;
  });
  const path = `${p}/task/media`;
  const add = (id: string) =>
    store().update("Bild zur Frage hinzugefügt", (g) => {
      const t = g.stations[index]!.task as { media?: string[] };
      t.media = [...(t.media ?? []), id];
    });
  const removeAt = (k: number) =>
    store().update("Bild zur Frage entfernt", (g) => {
      const t = g.stations[index]!.task as { media?: string[] };
      t.media = (t.media ?? []).filter((_, i) => i !== k);
      if (!t.media.length) delete t.media;
    });
  return (
    <div class="stack tight" data-feld="task.media">
      {Array.from({ length: media }, (_, k) => (
        <MediaSlot key={k} path={`${path}/${k}`} label={`Bild zur Frage${media > 1 ? ` ${k + 1}` : ""}`} accept="image" onClear={() => removeAt(k)} />
      ))}
      <MediaSlot path={`${path}/${media}`} label={media ? "Weiteres Bild zur Frage" : "Bild zur Frage"} accept="image" onPick={add} />
    </div>
  );
}
