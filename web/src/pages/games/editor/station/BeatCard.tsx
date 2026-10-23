/**
 * Paket C: Ein Block (Takt) der Szene – Art oben, darunter nur die Felder dieser Art: Sprecher,
 * Überschrift, Text, Bild, Fundstück, Knopfbeschriftung, Antworten im Gespräch (höchstens drei),
 * Aufnahme und Geräusch. Das Menü ⋯ verschiebt in eine andere Spur, dupliziert und löscht.
 */

import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { BEAT_FIELDS, BEAT_KIND_INFO, BEAT_KINDS, MAX_RESPONSES, SCENE_PARTS, switchBeatKind, type Beat, type BeatKind, type ScenePart } from "../../../../lib/editor/stations.ts";
import { readText } from "../../../../lib/editor/text.ts";
import { SCENE_PART_LABELS } from "../../../../lib/sound.ts";
import { notify } from "../../../../lib/session.ts";
import { Icon } from "../../../../ui/icons.tsx";
import { RefSelect } from "../ui/RefSelect.tsx";
import { TextField } from "../ui/TextField.tsx";
import { createCharacter, createItem, excerpt, MediaSlot, Menu, store } from "./common.tsx";

const TEXT_LABELS: Record<BeatKind, string> = {
  narration: "Text",
  radio: "Funkspruch",
  dialogue: "Was die Figur sagt",
  document: "Text des Schriftstücks",
  image: "Bildunterschrift",
  group: "Anweisung",
  chapter: "Obere Zeile",
};

const SPEAKER_HINTS: Partial<Record<BeatKind, string>> = {
  narration: "Ohne Auswahl spricht der Erzähler.",
  radio: "Ohne Auswahl funkt die Zentrale.",
};

const ACK_PLACEHOLDER: Partial<Record<BeatKind, string>> = { narration: "Weiter", radio: "Weiter", group: "Alle bereit" };

/** Zeile zum Wiedererkennen: Art · Sprecher und Textanfang. */
export function beatTitle(beat: Beat, speaker: string, lang: string): string {
  const head = [BEAT_KIND_INFO[beat.kind]?.label ?? beat.kind, speaker].filter(Boolean).join(" · ");
  const text = excerpt(readText(beat.title as never, lang) || readText(beat.text as never, lang), 50);
  return text ? `${head}: „${text}“` : head;
}

export function BeatCard({ stationIndex, part, index, count, beat }: { stationIndex: number; part: ScenePart; index: number; count: number; beat: Beat }) {
  const path = `/stations/${stationIndex}/scene/${part}/${index}`;
  const kind = beat.kind;
  const fields = new Set(BEAT_FIELDS[kind] ?? []);
  const label = BEAT_KIND_INFO[kind]?.label ?? "Block";

  const mutateScene = (undo: string, fn: (scene: Record<ScenePart, Beat[] | undefined>) => void) =>
    store().update(undo, (g) => {
      const s = g.stations[stationIndex]!;
      const scene = (s.scene ??= {}) as Record<ScenePart, Beat[] | undefined>;
      fn(scene);
      for (const k of SCENE_PARTS) if (scene[k] && !scene[k]!.length) delete scene[k];
      if (!Object.keys(scene).length) delete s.scene;
    });

  const switchKind = (next: BeatKind) =>
    store().update(`Block zu „${BEAT_KIND_INFO[next].label}“ geändert`, (g) => {
      const list = g.stations[stationIndex]!.scene![part]!;
      list[index] = switchBeatKind(list[index]!, next);
    });

  const moveTo = (target: ScenePart) =>
    mutateScene(`Block nach „${SCENE_PART_LABELS[target]}“ verschoben`, (scene) => {
      const [b] = scene[part]!.splice(index, 1);
      scene[target] = [...(scene[target] ?? []), b!];
    });

  const duplicate = () =>
    mutateScene(`Block „${label}“ dupliziert`, (scene) => {
      scene[part]!.splice(index + 1, 0, structuredClone(scene[part]![index]!));
    });

  const remove = () => {
    mutateScene(`Block „${label}“ gelöscht`, (scene) => {
      scene[part]!.splice(index, 1);
    });
    notify(`Block „${label}“ gelöscht. Strg+Z holt ihn zurück.`, "info");
  };

  const setResponses = (undo: string, fn: (list: NonNullable<Beat["responses"]>) => void) =>
    store().update(undo, (g) => {
      const b = g.stations[stationIndex]!.scene![part]![index]!;
      const list = [...(b.responses ?? [])];
      fn(list);
      if (list.length) b.responses = list;
      else delete b.responses;
    });

  const lang = useEditorSelect((s) => s.lang);
  const pickItem = (id: string | undefined) =>
    store().update(id ? "Fundstück gewählt" : "Fundstück entfernt", (g) => {
      const b = g.stations[stationIndex]!.scene![part]![index]!;
      if (!id) return void delete b.item;
      b.item = id;
      // Das Fundstück bringt Titel und Text als Vorgabe mit, wenn der Block noch leer ist.
      const item = (g.items ?? []).find((x) => x?.id === id);
      if (item && !readText(b.title as never, lang)) b.title = item.name;
      if (item?.body !== undefined && !readText(b.text as never, lang)) b.text = item.body;
    });

  const responses = beat.responses ?? [];

  return (
    <article class="st-beat stack tight" data-block={`${part}-${index}`} data-feld={`scene.${part}.${index}`} aria-label={`${label}, Block ${index + 1} von ${count}`}>
      <header class="row between nowrap">
        <label class="row nowrap min0">
          <span class="sr-only">Art des Blocks</span>
          <select class="st-beat-kind" value={kind} onChange={(e) => switchKind(e.currentTarget.value as BeatKind)}>
            {BEAT_KINDS.map((k) => (
              <option key={k} value={k}>
                {BEAT_KIND_INFO[k].label}
              </option>
            ))}
          </select>
        </label>
        <Menu label={`Weitere Aktionen für Block ${index + 1}`}>
          {(close) => (
            <>
              {SCENE_PARTS.filter((t) => t !== part).map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      moveTo(t);
                    }}
                  >
                    In „{SCENE_PART_LABELS[t]}“ verschieben
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    duplicate();
                  }}
                >
                  Duplizieren
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    remove();
                  }}
                >
                  <Icon name="trash" /> Löschen
                </button>
              </li>
            </>
          )}
        </Menu>
      </header>
      {fields.has("speaker") && (
        <RefSelect
          kind="figur"
          label={kind === "dialogue" ? "Figur" : "Sprecher"}
          path={`${path}/speaker`}
          value={beat.speaker}
          hint={SPEAKER_HINTS[kind]}
          onChange={(id) => {
            store().setField(`${path}/speaker`, id, id ? "Sprecher gewählt" : "Sprecher entfernt");
            store().touch(`${path}/speaker`);
          }}
          onCreate={() => createCharacter(kind === "radio" ? "hq" : kind === "narration" ? "narrator" : "npc")}
        />
      )}
      {kind === "chapter" && <ChapterPick path={path} />}
      {fields.has("image") && <MediaSlot path={`${path}/image`} label="Bild" accept="image" hint="Die Beschreibung des Bilds liest die App vor; du pflegst sie unter Medien." />}
      {fields.has("title") && <TextField path={`${path}/title`} label={kind === "chapter" ? "Kapitelname" : "Überschrift"} />}
      {fields.has("text") && <TextField path={`${path}/text`} label={TEXT_LABELS[kind]} multiline={kind !== "chapter"} rows={3} placeholder={kind === "chapter" ? "z. B. Kapitel II" : undefined} />}
      {fields.has("item") && (
        <RefSelect
          kind="gegenstand"
          label="Kommt in die Akte als"
          path={`${path}/item`}
          value={beat.item}
          hint="Wählst du ein Fundstück, übernimmt der Block dessen Titel und Text als Vorgabe."
          onChange={pickItem}
          onCreate={() => createItem("document", { name: readText(beat.title as never, lang) || undefined, body: beat.text })}
        />
      )}
      {kind === "dialogue" && (
        <fieldset class="stack tight st-responses" data-feld={`scene.${part}.${index}.responses`}>
          <legend class="label">Antworten des Teams</legend>
          {responses.map((_, k) => (
            <div key={k} class="st-response">
              <TextField path={`${path}/responses/${k}/label`} label={`Antwort ${k + 1}`} required />
              <TextField path={`${path}/responses/${k}/reply`} label="Erwiderung der Figur" />
              <button type="button" class="btn small ghost st-self-end" aria-label={`Antwort ${k + 1} entfernen`} onClick={() => setResponses(`Antwort ${k + 1} entfernt`, (l) => l.splice(k, 1))}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
          {responses.length < MAX_RESPONSES ? (
            <button type="button" class="btn small st-self-start" onClick={() => setResponses("Antwort hinzugefügt", (l) => l.push({ label: { [lang]: "" } }))}>
              <Icon name="plus" /> Antwort
            </button>
          ) : (
            <p class="small muted">Höchstens drei Antworten.</p>
          )}
        </fieldset>
      )}
      {fields.has("ack") && <TextField path={`${path}/ack`} label="Beschriftung des Knopfs" placeholder={ACK_PLACEHOLDER[kind]} />}
      <div class="sound-grid">
        <MediaSlot path={`${path}/audio`} label="Aufnahme" accept="audio" />
        <MediaSlot path={`${path}/sfx`} label="Geräusch" accept="audio" />
      </div>
    </article>
  );
}

/** Kapitelkarte: Kapitel wählen füllt den Kapitelnamen (die Karte ändert das Kapitel nicht). */
function ChapterPick({ path }: { path: string }) {
  const chapters = useEditorSelect(
    (s) => (s.game.story?.chapters ?? []).filter((c) => c && c.id).map((c, i) => ({ id: c.id, title: c.title, label: readText(c.title as never, s.lang) || `Kapitel ${i + 1}` })),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!chapters.length) return <p class="small muted">Tipp: Startet eine Belohnung ein Kapitel, zeigt die App die Kapitelkarte selbst.</p>;
  return (
    <label class="field">
      <span class="label">Kapitel wählen</span>
      <select
        value=""
        onChange={(e) => {
          const c = chapters.find((x) => x.id === e.currentTarget.value);
          if (c) store().setField(`${path}/title`, structuredClone(c.title), "Kapitelname übernommen");
        }}
      >
        <option value="">– füllt den Kapitelnamen –</option>
        {chapters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <small>Startet eine Belohnung ein Kapitel, zeigt die App die Kapitelkarte selbst.</small>
    </label>
  );
}

