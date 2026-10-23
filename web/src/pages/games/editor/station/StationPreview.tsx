/**
 * Paket C: Einfache Vorschau in der App – Blöcke, Rätsel, Tipp und Belohnung als Karten in der
 * Akzentfarbe, mit Blättern und Sprungmarken. Sie folgt dem Fokus im Formular (data-block) und ist
 * echter Text in einer Region, keine Grafik. Verbindlich ist der Probelauf.
 */

import { plural } from "../../../../lib/format.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { base, mediaUrl } from "../../../../lib/base.ts";
import { GPS_RADIUS, SCENE_PARTS, SOLVE_POINTS, type Beat, type Task } from "../../../../lib/editor/stations.ts";
import { useEditorSelect } from "../../../../lib/editor/store.ts";
import { readText } from "../../../../lib/editor/text.ts";
import type { Game, Station } from "../../../../lib/editor/types.ts";
import { penaltyLabel } from "../../../../lib/game.ts";
import { APPROACH_STAGES } from "./Approach.tsx";
import { worldOf } from "./world.ts";

type Group = "Peiler" | "Ankunft" | "Rätsel" | "Tipp" | "Belohnung" | "Nach dem Lösen";
interface Screen {
  /** Wert von data-block im Formular */
  key: string;
  group: Group;
}

const GROUPS: Group[] = ["Peiler", "Ankunft", "Rätsel", "Tipp", "Belohnung", "Nach dem Lösen"];

/** Bildschirme der Station in der Reihenfolge, in der ein Team sie erlebt. */
export function previewScreens(station: Station): Screen[] {
  const out: Screen[] = [{ key: "approach", group: "Peiler" }];
  if (station.story && !station.scene) out.push({ key: "story", group: "Ankunft" });
  for (const part of ["arrival", "beats"] as const) (station.scene?.[part] ?? []).forEach((_, i) => out.push({ key: `${part}-${i}`, group: "Ankunft" }));
  out.push({ key: "task", group: "Rätsel" });
  if (station.task && station.hints?.length) out.push({ key: "hints", group: "Tipp" });
  if (station.task) out.push({ key: "rewards", group: "Belohnung" });
  (station.scene?.afterSolve ?? []).forEach((_, i) => out.push({ key: `afterSolve-${i}`, group: "Nach dem Lösen" }));
  return out;
}

export function StationPreview({ station, focus }: { station: Station; focus: string | null }) {
  const game = useEditorSelect((s) => s.game);
  const lang = useEditorSelect((s) => s.lang);
  const screens = useMemo(() => previewScreens(station), [station]);
  const [index, setIndex] = useState(0);
  const [big, setBig] = useState(false);

  // Dem Fokus folgen: wer an Block 2 schreibt, sieht Block 2.
  useEffect(() => {
    if (!focus) return;
    const i = screens.findIndex((s) => s.key === focus);
    if (i >= 0) setIndex(i);
  }, [focus, screens]);

  const at = Math.min(index, screens.length - 1);
  const screen = screens[at]!;
  const groups = GROUPS.filter((g) => screens.some((s) => s.group === g));
  return (
    <section class="st-preview stack tight" role="region" aria-label="Vorschau in der App">
      <div class="row between">
        <h3 class="st-lane-title">Vorschau in der App</h3>
        <label class="check small">
          <input type="checkbox" checked={big} onChange={(e) => setBig(e.currentTarget.checked)} />
          <span>Lesefassung</span>
        </label>
      </div>
      <div class={`st-phone${big ? " big" : ""}`}>
        <p class="st-phone-head">
          Station {(game.stations ?? []).indexOf(station) + 1} · {worldOf(game).caseFile}
        </p>
        <div class="st-screen" aria-live="polite">
          <ScreenView game={game} station={station} screen={screen} lang={lang} />
        </div>
      </div>
      <div class="row between nowrap">
        <span class="small muted">
          Block {at + 1} von {screens.length}
        </span>
        <span class="row nowrap">
          <button type="button" class="btn small" aria-label="Voriger Block" disabled={at === 0} onClick={() => setIndex(at - 1)}>
            ◀
          </button>
          <button type="button" class="btn small" aria-label="Nächster Block" disabled={at >= screens.length - 1} onClick={() => setIndex(at + 1)}>
            ▶
          </button>
        </span>
      </div>
      <nav class="st-marks small" aria-label="Sprungmarken der Vorschau">
        {groups.map((g) => (
          <button key={g} type="button" class={`btn small ghost${screen.group === g ? " on" : ""}`} aria-pressed={screen.group === g} onClick={() => setIndex(screens.findIndex((s) => s.group === g))}>
            {g}
          </button>
        ))}
      </nav>
      <p class="small muted">Die Vorschau ähnelt der App. Verbindlich ist der Probelauf.</p>
    </section>
  );
}

const media = (game: Game, id: string | undefined) => (id ? (game.media ?? []).find((m) => m?.id === id) : undefined);

function ScreenView({ game, station, screen, lang }: { game: Game; station: Station; screen: Screen; lang: string }) {
  const t = (v: unknown) => readText(v as never, lang);
  if (screen.key === "approach") {
    const near = APPROACH_STAGES.find((s) => s.key === "near")!;
    const radius = station.triggers?.find((x) => x?.type === "gps");
    return (
      <div class="st-card">
        <p class="st-kicker">{worldOf(game).device}</p>
        <p class="st-text">{t(station.approach?.near) || near.fallback}</p>
        {radius?.type === "gps" && <p class="small muted">Löst aus im Umkreis von {radius.radius ?? GPS_RADIUS} m.</p>}
      </div>
    );
  }
  if (screen.key === "story") {
    return (
      <div class="st-card">
        <p class="st-kicker">{station.story?.speaker === "hq" ? "Funkspruch" : "Erzähler"}</p>
        <p class="st-text">{t(station.story?.text) || "…"}</p>
      </div>
    );
  }
  if (screen.key === "task") return <TaskView game={game} task={station.task} lang={lang} />;
  if (screen.key === "hints") {
    const h = station.hints?.[0];
    const cost = h?.cost ?? game.settings?.hints?.defaultCost?.[0];
    return (
      <div class="st-card">
        <p class="st-kicker">Funkspruch · Tipp 1</p>
        <p class="st-text">{t(h?.text) || "…"}</p>
        <p class="small muted">Kostet {cost ? penaltyLabel(cost) : "nichts"}.</p>
      </div>
    );
  }
  if (screen.key === "rewards") return <RewardView game={game} station={station} lang={lang} />;
  const [part, i] = screen.key.split("-") as [(typeof SCENE_PARTS)[number], string];
  const beat = station.scene?.[part]?.[Number(i)];
  return beat ? <BeatView game={game} beat={beat} lang={lang} last={part !== "afterSolve" && isLastBefore(station, part, Number(i))} /> : null;
}

const isLastBefore = (s: Station, part: "arrival" | "beats", i: number) => (part === "beats" ? i === (s.scene?.beats?.length ?? 0) - 1 : !s.scene?.beats?.length && i === (s.scene?.arrival?.length ?? 0) - 1);

function BeatView({ game, beat, lang, last }: { game: Game; beat: Beat; lang: string; last: boolean }) {
  const t = (v: unknown) => readText(v as never, lang);
  const speaker = (game.characters ?? []).find((c) => c?.id === beat.speaker);
  const hq = (game.characters ?? []).find((c) => c?.kind === "hq");
  const who = speaker ? t(speaker.name) : beat.kind === "radio" ? t(hq?.name) || t(game.story?.hq?.name) || "Zentrale" : beat.kind === "narration" ? "Erzähler" : "";
  const ack = t(beat.ack) || (beat.kind === "group" ? "Alle bereit" : last ? "Zum Rätsel" : "Weiter");
  const img = media(game, beat.image);
  switch (beat.kind) {
    case "chapter":
      return (
        <div class="st-card st-chapter">
          <p class="st-kicker">{t(beat.text) || "Kapitel"}</p>
          <p class="st-title">{t(beat.title) || "…"}</p>
        </div>
      );
    case "image":
      return (
        <div class="st-card">
          {img ? <img class="st-image" src={mediaUrl(base(), img.src)} alt={t(img.alt)} /> : <p class="muted">Noch kein Bild gewählt.</p>}
          {t(beat.title) && <p class="st-title small">{t(beat.title)}</p>}
          {t(beat.text) && <p class="small">{t(beat.text)}</p>}
          <span class="st-fake">{ack}</span>
        </div>
      );
    case "document": {
      const item = (game.items ?? []).find((x) => x?.id === beat.item);
      return (
        <div class="st-card st-document">
          <p class="st-title">{t(beat.title) || t(item?.name) || "Fundstück"}</p>
          <p class="st-text">{t(beat.text) || t(item?.body) || "…"}</p>
          {item && <p class="small muted">→ kommt in die {worldOf(game).caseFile}</p>}
          <span class="st-fake">{ack}</span>
        </div>
      );
    }
    default:
      return (
        <div class={`st-card${beat.kind === "radio" ? " st-radio" : ""}`}>
          <p class="st-kicker">
            {beat.kind === "radio" ? "Funkspruch" : beat.kind === "group" ? "Alle zusammen" : beat.kind === "dialogue" ? "Gespräch" : "Erzähler"}
            {who && beat.kind !== "narration" ? ` · ${who}` : ""}
            {beat.audio ? " ▷" : ""}
          </p>
          <p class="st-text">{t(beat.text) || "…"}</p>
          {beat.kind === "dialogue" && beat.responses?.length ? (
            beat.responses.map((r, k) => (
              <span key={k} class="st-fake">
                {t(r.label) || "…"}
              </span>
            ))
          ) : (
            <span class="st-fake">{ack}</span>
          )}
        </div>
      );
  }
}

function TaskView({ game, task, lang }: { game: Game; task: Task | undefined; lang: string }) {
  const t = (v: unknown) => readText(v as never, lang);
  if (!task) return <div class="st-card"><p class="muted">An dieser Station gibt es nichts zu lösen. Die Spielleitung schaltet sie frei.</p></div>;
  const ask = "question" in task ? task.question : task.prompt;
  const images = "media" in task ? (task.media ?? []).map((id) => media(game, id)).filter((m) => m?.type === "image") : [];
  const wheels = task.type === "code" && task.input !== "keyboard" && (task.answers ?? []).every((a) => /^\d{1,6}$/.test(a)) && task.answers?.[0] ? task.answers[0].length : 0;
  return (
    <div class="st-card">
      <p class="st-kicker">Rätsel</p>
      <p class="st-text">{t(ask) || "…"}</p>
      {images.map((m) => m && <img key={m.id} class="st-image" src={mediaUrl(base(), m.src)} alt={t(m.alt)} />)}
      {task.type === "text" && <span class="st-fake input">Antwort eintippen …</span>}
      {task.type === "code" && (wheels ? <span class="st-wheels num" aria-label={`Zahlenschloss mit ${wheels} Rädern`}>{"0".repeat(wheels).split("").join(" ")}</span> : <span class="st-fake input">Code eingeben …</span>)}
      {task.type === "choice" && (task.options ?? []).map((o, k) => <span key={k} class="st-fake">{t(o?.text) || "…"}</span>)}
      {task.type === "photo" && <span class="st-fake">{task.video ? "Video aufnehmen" : "Foto aufnehmen"}</span>}
      {task.type === "find_location" && <span class="st-fake">Wir sind da</span>}
    </div>
  );
}

function RewardView({ game, station, lang }: { game: Game; station: Station; lang: string }) {
  const t = (v: unknown) => readText(v as never, lang);
  const r = station.rewards ?? {};
  const points = r.points ?? game.settings?.scoring?.solvePoints ?? SOLVE_POINTS;
  return (
    <div class="st-card st-reward">
      <p class="st-stamp">{worldOf(game).stamp}</p>
      {(game.settings?.mode ?? "competitive") === "competitive" && <p class="st-title">+{plural(points, "Punkt", "Punkte")}</p>}
      <ul class="small">
        {(r.fragments ?? []).map((id) => {
          const f = (game.fragments ?? []).find((x) => x?.id === id);
          return (
            <li key={id}>
              Codeteil {f?.position ?? "?"}: <span class="num">{f?.value ?? "?"}</span>
            </li>
          );
        })}
        {(r.items ?? []).map((id) => (
          <li key={id}>{t((game.items ?? []).find((x) => x?.id === id)?.name) || id}</li>
        ))}
        {r.chapter && <li>Neues Kapitel: {t((game.story?.chapters ?? []).find((c) => c?.id === r.chapter)?.title) || r.chapter}</li>}
      </ul>
    </div>
  );
}
