/** Entwurfsseite, Teil 1: Tokens (Farben mit Kontrast, Typo, Abstand, Radien, Erhöhung, Bewegung, Ebenen, Icons, Layout). */

import { useEffect, useRef, useState } from "preact/hooks";
import { over, parseColor, ratio, hex, type RGBA } from "../../lib/contrast.ts";
import { theme } from "../../lib/session.ts";
import { useStore } from "../../lib/store.ts";
import { Button } from "../../ui/Button.tsx";
import { ICON_NAMES, Icon } from "../../ui/icons.tsx";

/** Gelesene Farbe eines Tokens im aktuellen Thema (ein Wegwerf-Element liefert die berechnete Farbe). */
function tokenColor(name: string, onto?: RGBA): RGBA {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;background-color:var(--${name})`;
  document.body.appendChild(probe);
  const c = parseColor(getComputedStyle(probe).backgroundColor);
  probe.remove();
  return onto ? over(c, onto) : c;
}

/** Rechnet bei jedem Themenwechsel neu (Thema, Dichte und Gerätewechsel setzen den Zähler hoch). */
function useThemeTick(): number {
  const { value, resolved } = useStore(theme);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Nach dem Zeichnen, damit data-theme schon gilt
    const id = requestAnimationFrame(() => setTick((t) => t + 1));
    return () => cancelAnimationFrame(id);
  }, [value, resolved]);
  return tick;
}

function grade(r: number): string {
  return r >= 7 ? "AAA" : r >= 4.5 ? "AA Text" : r >= 3 ? "AA Fläche" : "dekorativ";
}

function Swatch({ name, tick }: { name: string; tick: number }) {
  const [info, setInfo] = useState<{ hex: string; r: number; alpha: number } | null>(null);
  useEffect(() => {
    const surface = tokenColor("surface");
    const c = tokenColor(name);
    const flat = over(c, surface);
    setInfo({ hex: hex(flat), r: ratio(flat, surface), alpha: c[3] });
  }, [tick, name]);
  return (
    <div class="ds-swatch">
      <span class="ds-swatch__chip" style={{ background: `var(--${name})` }} />
      <span class="ds-swatch__meta">
        <span class="ds-swatch__name">--{name}</span>
        <span class="ds-swatch__value">{info ? `${info.hex}${info.alpha < 1 ? ` · ${Math.round(info.alpha * 100)} %` : ""}` : " "}</span>
        <span class="ds-swatch__ratio">{info ? `${info.r.toFixed(1)}:1 auf Karte · ${grade(info.r)}` : " "}</span>
      </span>
    </div>
  );
}

const SWATCHES: { title: string; note: string; tokens: string[] }[] = [
  { title: "Flächen", note: "Vier Ebenen: Seitengrund, Karte, erhöht, Überlagerung; dazu Eingabe und Vertiefung.", tokens: ["ground", "surface", "raised", "overlay", "field", "sunken"] },
  { title: "Ränder und Fokus", note: "Trennlinie dekorativ, Rand von Steuerelementen mindestens 3:1, Fokus mindestens 3:1.", tokens: ["line", "line-strong", "accent-line", "focus"] },
  { title: "Text", note: "Text, gedämpft und Metadaten müssen 4,5:1 auf jeder Fläche erreichen. Deaktiviert ist ausgenommen.", tokens: ["text", "muted", "subtle", "text-disabled", "accent-text"] },
  { title: "Marke und Aktion", note: "--accent ist die Fläche (Primärknopf), --accent-text die Schrift, --accent-graphic der Strich und die Füllung für kleine Zeichen (Fortschritt, Haken).", tokens: ["accent", "accent-hover", "accent-press", "accent-graphic", "accent-soft", "on-accent"] },
  { title: "Status", note: "Immer mit Icon und Text. Schrift, Fläche, weicher Grund, Linie.", tokens: ["ok", "ok-fill", "ok-soft", "ok-line", "warn", "warn-fill", "warn-soft", "warn-line", "danger", "danger-fill", "danger-soft", "danger-line", "info", "info-fill", "info-soft", "info-line"] },
  { title: "Sicherheit und Rettung", note: "Exklusiv für SOS, Rückruf, Sperrzonen und Rettungspunkte.", tokens: ["safety", "safety-soft", "tape-a", "rescue"] },
  { title: "Teams", note: "Punkt immer mit Ring; im Tag dunkler, damit er auf Weiß mindestens 3:1 hat.", tokens: ["team-red", "team-blue", "team-green", "team-yellow", "team-purple", "team-orange", "team-teal", "team-pink", "team-olive"] },
  { title: "Zustände", note: "Überlagerungen auf jeder Fläche.", tokens: ["hover", "press", "select", "scrim"] },
];

const PAIRS: { fg: string; bg: string[]; min: number; note: string }[] = [
  { fg: "text", bg: ["surface"], min: 4.5, note: "Text" },
  { fg: "muted", bg: ["surface"], min: 4.5, note: "Text, gedämpft" },
  { fg: "subtle", bg: ["surface"], min: 4.5, note: "Metadaten, Platzhalter" },
  { fg: "subtle", bg: ["raised"], min: 4.5, note: "Metadaten auf erhöhter Fläche" },
  { fg: "accent-text", bg: ["surface"], min: 4.5, note: "Link, Amber als Schrift" },
  { fg: "accent-text", bg: ["surface", "accent-soft"], min: 4.5, note: "Auswahl" },
  { fg: "on-accent", bg: ["accent"], min: 4.5, note: "Primärknopf" },
  { fg: "on-accent", bg: ["accent-press"], min: 4.5, note: "Primärknopf, gedrückt" },
  { fg: "on-ok", bg: ["ok-fill"], min: 4.5, note: "Erfolg, gefüllt" },
  { fg: "on-warn", bg: ["warn-fill"], min: 4.5, note: "Warnung, gefüllt" },
  { fg: "on-danger", bg: ["danger-fill"], min: 4.5, note: "Fehler, gefüllt" },
  { fg: "on-info", bg: ["info-fill"], min: 4.5, note: "Info, gefüllt" },
  { fg: "on-safety", bg: ["safety"], min: 4.5, note: "Sicherheit" },
  { fg: "ok", bg: ["surface", "ok-soft"], min: 4.5, note: "Erfolg als Schrift" },
  { fg: "warn", bg: ["surface", "warn-soft"], min: 4.5, note: "Warnung als Schrift" },
  { fg: "danger", bg: ["surface", "danger-soft"], min: 4.5, note: "Fehler als Schrift" },
  { fg: "info", bg: ["surface", "info-soft"], min: 4.5, note: "Info als Schrift" },
  { fg: "line-strong", bg: ["surface"], min: 3, note: "Rand von Steuerelementen" },
  { fg: "focus", bg: ["surface"], min: 3, note: "Fokusring" },
  { fg: "accent-graphic", bg: ["sunken"], min: 3, note: "Fortschrittsfüllung" },
  { fg: "team-yellow", bg: ["surface"], min: 3, note: "Teampunkt Gelb" },
  { fg: "team-orange", bg: ["surface"], min: 3, note: "Teampunkt Orange" },
];

function PairRow({ fg, bg, min, note, tick }: { fg: string; bg: string[]; min: number; note: string; tick: number }) {
  const [r, setR] = useState<number | null>(null);
  useEffect(() => {
    let base = tokenColor(bg[0]!);
    for (const l of bg.slice(1)) base = over(tokenColor(l), base);
    setR(ratio(over(tokenColor(fg), base), base));
  }, [tick, fg, bg.join("+")]);
  const bgCss = bg.length === 1 ? `var(--${bg[0]})` : `linear-gradient(var(--${bg[1]}), var(--${bg[1]})), var(--${bg[0]})`;
  return (
    <tr>
      <td>
        <span class="sample" style={{ background: bgCss, color: `var(--${fg})`, boxShadow: min === 3 ? "none" : undefined }}>
          {min === 3 ? <i style={{ display: "block", width: 40, height: 4, borderRadius: 2, background: `var(--${fg})` }} /> : "Aa 123"}
        </span>
      </td>
      <td class="mono">
        --{fg} auf --{bg.join(" + --")}
      </td>
      <td>{note}</td>
      <td class="num">{r === null ? "" : `${r.toFixed(2)}:1`}</td>
      <td class="num">ab {min}:1</td>
      <td class={r !== null && r >= min ? "pass" : "fail"}>
        <span class="row nowrap">
          <Icon name={r !== null && r >= min ? "check-circle" : "x-circle"} size={16} />
          {r !== null && r >= min ? "besteht" : "zu schwach"}
        </span>
      </td>
    </tr>
  );
}

export function Colors() {
  const tick = useThemeTick();
  return (
    <div class="ds-content">
      {SWATCHES.map((g) => (
        <div class="ds-block" key={g.title}>
          <h3>{g.title}</h3>
          <p class="ds-note">{g.note}</p>
          <div class="ds-grid">
            {g.tokens.map((t) => (
              <Swatch key={t} name={t} tick={tick} />
            ))}
          </div>
        </div>
      ))}
      <div class="ds-block">
        <h3>Kontrastpaare</h3>
        <p class="ds-note">Gemessen im aktuellen Thema nach WCAG 2.x. Text braucht 4,5:1, Ränder und Zeichen 3:1. Der Test test/design-tokens.test.ts prüft dieselben Paare (und mehr) in Nacht und Tag.</p>
        <div class="ds-stage" style={{ overflowX: "auto" }}>
          <table class="ds-pairs">
            <thead>
              <tr>
                <th>Muster</th>
                <th>Paar</th>
                <th>Verwendung</th>
                <th class="num">Wert</th>
                <th class="num">Soll</th>
                <th>Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {PAIRS.map((p) => (
                <PairRow key={`${p.fg}-${p.bg.join()}`} {...p} tick={tick} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const TYPE_ROLES: { token: string; use: string; spec: string; sample: string; cls: string }[] = [
  { token: "display", use: "Event-Code", spec: "Mono 700, 40 bis 72 px", sample: "4VMBZ5", cls: "t-display" },
  { token: "clock", use: "Laufzeit", spec: "Mono 700, 28 px", sample: "3:54:12", cls: "t-clock" },
  { token: "stat", use: "Kennzahl", spec: "Mono 700, 24 px", sample: "1.455", cls: "t-stat" },
  { token: "title", use: "Seiten-h1, Versalien", spec: "Barlow Condensed 700, 30 px", sample: "Nachtwanderung Sieglar", cls: "t-title" },
  { token: "heading", use: "h2, Satzschreibung", spec: "Barlow Condensed 700, 24 px", sample: "Nächste Schritte", cls: "t-heading" },
  { token: "subhead", use: "h3, Kartentitel", spec: "Barlow Condensed 600, 20 px", sample: "Das Spiel in Zahlen", cls: "t-subhead" },
  { token: "lead", use: "Einleitung", spec: "Atkinson 400, 17 px", sample: "Ein Satz, der die Seite erklärt, bevor es ins Einzelne geht.", cls: "t-lead" },
  { token: "body", use: "Fließtext", spec: "Atkinson 400, 15 px, Zeile 1,5", sample: "Zugänge vergibt, wer in deiner Organisation Admin ist. Zeilenlänge höchstens 72 Zeichen.", cls: "t-body" },
  { token: "body-strong", use: "Betont", spec: "Atkinson 600, 15 px", sample: "Eulenwacht hat sich gemeldet", cls: "t-body-strong" },
  { token: "dense", use: "Tabellen, Listen, Leitstand", spec: "Atkinson 400, 14 px", sample: "Dachse · 3 von 9 Stationen · 120 Punkte", cls: "t-dense" },
  { token: "label", use: "Feldbeschriftung, Reiter, Knopf klein", spec: "Atkinson 600, 13 px", sample: "E-Mail-Adresse", cls: "t-label" },
  { token: "caption", use: "Hinweis unter dem Feld", spec: "Atkinson 400, 12 px, gedämpft", sample: "Zuletzt gespeichert um 19:32", cls: "t-caption" },
  { token: "mono", use: "Kennungen, Koordinaten", spec: "Mono 500, 13 px", sample: "50.7753, 7.2051", cls: "t-mono" },
  { token: "eyebrow", use: "Etikett über Titeln, Versalien", spec: "Mono 500, 11 px, 0,08 em", sample: "Baukasten", cls: "t-eyebrow" },
  { token: "badge", use: "Status, Versalien", spec: "Mono 700, 11 px, 0,06 em", sample: "Läuft", cls: "t-badge" },
];

export function TypeScale() {
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Rollen</h3>
        <p class="ds-note">Genau zehn Schriftgrößen: 11, 12, 13, 14, 15, 17, 20, 24, 30, 40 (dazu die Anzeigegröße für den Event-Code). Fraunces nur in der Wortmarke.</p>
        <div class="ds-stage">
          {TYPE_ROLES.map((r) => (
            <div class="ds-type" key={r.token}>
              <code>
                --type-{r.token}
                <span class="ds-type__spec">{r.spec}</span>
              </code>
              <div>
                <div class={r.cls}>{r.sample}</div>
                <span class="ds-type__spec">{r.use}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Überschriften im Dokument</h3>
        <div class="ds-stage stack">
          <h1>Seitentitel h1</h1>
          <h2>Bereichsüberschrift h2</h2>
          <h3>Unterüberschrift h3</h3>
          <h4>Kleine Überschrift h4</h4>
          <p>
            Fließtext mit einem <a href="#farben">Link in Amber-Schrift</a>, <strong>Betonung</strong> und einer Zahl in Mono: <span class="num">0123456789</span>. Atkinson Hyperlegible hat eine Null mit Schrägstrich; in Datumsangaben ist das gewollt.
          </p>
          <p class="muted">Gedämpfter Text für Erklärungen. <span class="subtle">Metadaten noch leiser.</span> <kbd>Strg</kbd> + <kbd>K</kbd></p>
        </div>
      </div>
    </div>
  );
}

const SPACES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

export function Scales() {
  const [on, setOn] = useState(false);
  const durations = [
    { name: "press", ms: 80 },
    { name: "hover", ms: 120 },
    { name: "pop", ms: 180 },
    { name: "panel", ms: 280 },
  ];
  const eases = ["out", "in", "inout"] as const;
  const [ease, setEase] = useState<(typeof eases)[number]>("out");
  const track = useRef<HTMLDivElement>(null);
  const [travel, setTravel] = useState(200);
  useEffect(() => {
    const el = track.current;
    if (el) setTravel(Math.max(0, el.clientWidth - 32));
  }, []);
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Abstand: 4-Pixel-Raster</h3>
        <div class="ds-stage ds-space">
          {SPACES.map((n) => (
            <div key={n}>
              <span style={{ minWidth: 120 }}>--space-{n}</span>
              <i style={{ width: `var(--space-${n})` }} />
              <span>{n * 4} px</span>
            </div>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Radien</h3>
        <div class="ds-grid">
          {[
            ["xs", "4 px", "Badges, Code"],
            ["sm", "6 px", "kleine Elemente, Menüeinträge"],
            ["md", "8 px", "Knöpfe, Eingaben"],
            ["lg", "12 px", "Karten, Dialoge"],
            ["pill", "999 px", "Chips, Zähler"],
          ].map(([n, px, use]) => (
            <div key={n} class="ds-tile" style={{ borderRadius: `var(--radius-${n})` }}>
              <span>
                --radius-{n}
                <br />
                {px} · {use}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Erhöhung</h3>
        <p class="ds-note">Nacht: heller plus Haarlinie. Tag: Schatten. Karte, erhöht, Überlagerung.</p>
        <div class="ds-stage ds-stage--ground ds-grid">
          <div class="ds-elev" style={{ background: "var(--surface)", boxShadow: "none", border: "1px solid var(--line)" }}>
            Stufe 0 · Karte
          </div>
          <div class="ds-elev" style={{ background: "var(--surface)", boxShadow: "var(--elev-1)" }}>
            --elev-1 · Leiste
          </div>
          <div class="ds-elev" style={{ boxShadow: "var(--elev-2)" }}>
            --elev-2 · Menü, Toast
          </div>
          <div class="ds-elev" style={{ boxShadow: "var(--elev-3)" }}>
            --elev-3 · Dialog
          </div>
        </div>
      </div>
      <div class="ds-block">
        <h3>Bewegung</h3>
        <p class="ds-note">Nie „transition: all“, immer eine Liste. Bei „weniger Bewegung“ im System stehen alle Dauern auf 0.</p>
        <div class="ds-stage ds-motion" style={{ "--ds-ease": `var(--ease-${ease})` } as never}>
          <div class="ds-row">
            <Button size="sm" variant="primary" onClick={() => setOn(!on)}>
              Abspielen
            </Button>
            {eases.map((e) => (
              <Button key={e} size="sm" aria-pressed={ease === e} onClick={() => setEase(e)}>
                ease-{e}
              </Button>
            ))}
          </div>
          {durations.map((d) => (
            <div key={d.name} class="ds-row">
              <span class="mono" style={{ minWidth: 210, color: "var(--muted)" }}>
                --dur-{d.name} · {d.ms} ms
              </span>
              <div class={`ds-motion${on ? " is-on" : ""}`} style={{ flex: 1, "--ds-dur": `var(--dur-${d.name})`, "--ds-travel": `${travel}px` } as never}>
                <div class="ds-motion__track" ref={d.name === "press" ? track : undefined}>
                  <span class="ds-motion__ball" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Ebenen (z-index)</h3>
        <div class="ds-stage ds-z">
          {["sticky 10", "nav 20", "dropdown 30", "scrim 40", "dialog 50", "toast 60", "tooltip 70", "skip 80"].map((z) => (
            <div key={z}>
              {z.split(" ")[0]} <span>{z.split(" ")[1]}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Fokusring</h3>
        <p class="ds-note">Ein Ring für alles: 2 px in --focus, 2 px Abstand. In Eingabefeldern wird der Rand zum Fokus und ein weicher Ring kommt dazu. Tab durch die Muster:</p>
        <div class="ds-stage ds-row">
          <Button>Knopf</Button>
          <a href="#fokus">Link</a>
          <input placeholder="Eingabe" style={{ maxWidth: 180 }} aria-label="Beispieleingabe" />
          <input type="checkbox" aria-label="Haken" />
          <Button class="is-focus">Erzwungen</Button>
        </div>
      </div>
    </div>
  );
}

export function Icons() {
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Größen und Strich</h3>
        <p class="ds-note">24er Raster, Strich 1,75 (bei 16 px 2), runde Enden, Farbe aus der Schrift. Größen 16 (dicht), 20 (Standard), 24 (Kopf). Zeichen im Text (Haken, Kreuz, Pfeile, Punkte, Wellen) kommen nicht vor: Die Schriften haben sie nicht, also sind sie hier Icons.</p>
        <div class="ds-stage ds-row">
          {[16, 20, 24].map((s) => (
            <span key={s} class="ds-row" style={{ gap: "var(--space-2)" }}>
              <Icon name="check" size={s} />
              <Icon name="more" size={s} />
              <Icon name="arrow-right" size={s} />
              <Icon name="alert" size={s} />
              <span class="mono muted">{s}</span>
            </span>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Alle Icons ({ICON_NAMES.length})</h3>
        <div class="ds-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
          {ICON_NAMES.map((n) => (
            <div class="ds-icon" key={n}>
              <span class="ds-icon__sizes">
                <Icon name={n} size={16} />
                <Icon name={n} size={20} />
                <Icon name={n} size={24} />
              </span>
              <span>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LayoutDemo() {
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Container</h3>
        <p class="ds-note">Schmal 640 (Formulare), Seite 1120, breit 1440 (Leitstand, Baukasten). Die Titel liegen immer an der linken Kante des Containers. Breakpoints 640, 960, 1280, 1600 stehen in lib/breakpoints.ts und im CSS.</p>
        <div class="ds-stage ds-bands">
          {[
            ["narrow", "640"],
            ["page", "1120"],
            ["wide", "1440"],
          ].map(([n, w]) => (
            <div key={n} class="ds-band" style={{ width: `min(100%, ${Number(w) * 0.6}px)` }}>
              --w-{n} · {w} px
            </div>
          ))}
        </div>
      </div>
      <div class="ds-block">
        <h3>Zwölf Spalten</h3>
        <div class="ds-stage grid-12">
          <div class="col-8 ds-band">8 Inhalt</div>
          <div class="col-4 ds-band">4 Seitenleiste</div>
          <div class="col-4 ds-band">4</div>
          <div class="col-4 ds-band">4</div>
          <div class="col-4 ds-band">4</div>
        </div>
      </div>
    </div>
  );
}
