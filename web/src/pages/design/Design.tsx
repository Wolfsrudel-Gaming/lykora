/**
 * Entwurfsseite /_design: alle Tokens und Bausteine in allen Zuständen, in Nacht, Tag und System, regulär und kompakt.
 * Abnahmefläche für Bildschirmfotos. Ohne Anmeldung, nicht in der Navigation, nur über die Adresse erreichbar.
 * Mit ?thema=day|night|system und ?dichte=compact lässt sich der Zustand per Adresse einstellen (für Aufnahmen).
 */

import { useEffect, useState } from "preact/hooks";
import { useLocation } from "../../lib/router.ts";
import { setTheme, theme } from "../../lib/session.ts";
import { parseTheme, type Theme } from "../../lib/theme.ts";
import { useStore } from "../../lib/store.ts";
import { ConfirmHost } from "../../ui/dialog.tsx";
import { useTitle } from "../../ui/hooks.ts";
import { Lantern } from "../../ui/icons.tsx";
import { Segmented } from "../../ui/tabs.tsx";
import { Toasts } from "../../ui/toast.tsx";
import { Badges, Buttons, Feedback, Forms, Surfaces } from "./Components.tsx";
import { Colors, Icons, LayoutDemo, Scales, TypeScale } from "./Foundations.tsx";
import "./design.css";

const SECTIONS: { id: string; title: string; text: string; view: () => preact.JSX.Element }[] = [
  { id: "farben", title: "Farben", text: "Rollen statt Rohwerte: Flächen, Ränder, Text, Marke, Status, Sicherheit, Teams. Jede Zahl ist im aktuellen Thema gemessen.", view: Colors },
  { id: "typografie", title: "Typografie", text: "Zehn Größen, Rollen statt Pixelwerte. Überschriften in Satzschreibung, Versalien nur für die Seiten-h1 und kurze Etiketten.", view: TypeScale },
  { id: "raster", title: "Abstand, Radius, Ebenen, Bewegung", text: "4-Pixel-Raster, fünf Radien, drei Erhöhungen, vier Dauern, acht Ebenen und ein Fokusring.", view: Scales },
  { id: "layout", title: "Layout", text: "Drei Container, zwölf Spalten, Breakpoints aus einer Quelle.", view: LayoutDemo },
  { id: "icons", title: "Icons", text: "Ein Satz, ein Strich. Größen 16, 20 und 24.", view: Icons },
  { id: "knoepfe", title: "Knöpfe", text: "Sieben Varianten in drei Größen mit allen Zuständen.", view: Buttons },
  { id: "formulare", title: "Formulare", text: "Felder, Auswahl, Haken, Radio und Schalter mit Beschriftung, Hinweis, Fehler und allen Zuständen.", view: Forms },
  { id: "flaechen", title: "Flächen und Daten", text: "Reiter, Karten, Kennzahlen, Tabellen und der Seitenkopf.", view: Surfaces },
  { id: "kennzeichen", title: "Kennzeichen", text: "Badges, Chips, Zähler, Avatare und Teampunkte.", view: Badges },
  { id: "rueckmeldung", title: "Rückmeldung", text: "Hinweise, Meldungen, Dialoge, Menüs, Laden, leere und fehlerhafte Zustände.", view: Feedback },
];

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: "night", label: "Nacht" },
  { id: "day", label: "Tag" },
  { id: "system", label: "System" },
];

export function DesignPage() {
  useTitle("Entwurf");
  const { query } = useLocation();
  const { value } = useStore(theme);
  const [density, setDensity] = useState<"regular" | "compact">(query.get("dichte") === "compact" ? "compact" : "regular");
  // Thema aus der Adresse (nur beim ersten Zeichnen)
  useEffect(() => {
    const t = query.get("thema");
    if (t) setTheme(parseTheme(t));
  }, []);
  // Nicht in Suchmaschinen
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  return (
    <div class="ds" data-density={density}>
      <header class="ds-bar">
        <span class="wordmark">
          <Lantern />
          Lykora
        </span>
        <span class="ds-bar__title">Entwurf · Bausteine und Tokens</span>
        <div class="ds-bar__controls">
          <Segmented label="Thema" value={value} onChange={setTheme} options={THEME_OPTIONS} />
          <Segmented
            label="Dichte"
            value={density}
            onChange={setDensity}
            options={[
              { id: "regular", label: "Regulär" },
              { id: "compact", label: "Kompakt" },
            ]}
          />
        </div>
      </header>
      <div class="ds-body container container--wide">
        <nav class="ds-nav" aria-label="Abschnitte">
          {SECTIONS.map((s, i) => (
            <a key={s.id} href={`#${s.id}`} onClick={(e) => {
              e.preventDefault();
              document.getElementById(s.id)?.scrollIntoView({ behavior: "auto", block: "start" });
              history.replaceState(null, "", `#${s.id}`);
            }}>
              {String(i + 1).padStart(2, "0")} {s.title}
            </a>
          ))}
        </nav>
        <main class="ds-main" id="inhalt">
          {SECTIONS.map((s, i) => (
            <section key={s.id} id={s.id} class="ds-section" aria-labelledby={`${s.id}-h`}>
              <header>
                <span class="eyebrow">{String(i + 1).padStart(2, "0")}</span>
                <h2 id={`${s.id}-h`}>{s.title}</h2>
                <p>{s.text}</p>
              </header>
              <s.view />
            </section>
          ))}
        </main>
      </div>
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
