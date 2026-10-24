# Stile des Dashboards

Design-System „Laterne 2“: Rollen statt Rohwerten. Nacht zuerst, Laternen-Amber als Marke, Sicherheitsrot und
Absperrband nur für SOS, Rückruf und Sperrzonen, Rettungsgrün nur für Rettungspunkte. Alle Bausteine und Tokens
zeigt die Entwurfsseite unter `/_design` (ohne Anmeldung, nicht in der Navigation).

## Dateien

| Datei | Inhalt |
|---|---|
| `tokens.css` | Schriften, themenunabhängige Tokens, Themen Nacht, Tag, System, Dichte, Legacy-Aliase |
| `index.css` | Einstieg, Reihenfolge der Dateien (Kaskade, Druck zuletzt) |
| `base.css` | Reset, Seitengrund, Überschriften, Fokus, Auswahl, Bildlaufleiste, Leaflet-Isolation |
| `typography.css` | Typo-Rollen als Klassen (`.t-title` …), `.eyebrow`, `.num` |
| `layout.css` | `.row`, `.stack`, `.cluster`, Raster (`.grid-12`), Container |
| `components/*.css` | button, form, card, notice, empty, badge, chip, avatar, stat, safety, tabs, table, dialog, menu, tooltip, toast, feedback, skeleton, list, media, misc |
| `print.css` | A4, 16 mm Rand, Schwarz auf Weiß, Haken als Rahmen, Tabellenköpfe, QR |

`shell.css` und `pages/*.css` gehören den Seiten und benutzen nur die Tokens.

## Regeln

- Abstand, Schriftgröße, Radius, Farbe, Schatten, Dauer, z-Ebene nur über Tokens (stylelint folgt im Abschluss).
- Zwei Ambertöne: `--accent` ist die Fläche (Primärknopf, in beiden Themen `#f2a33a`), `--accent-text` die Schrift
  daneben (Nacht `#f7c37f`, Tag `#8a4a00`). Dazu `--accent-graphic` für kleine Zeichen, die 3:1 brauchen (Fortschritt,
  Haken-Feld, Schalter, Reiter-Unterstrich): Nacht `#f2a33a`, Tag `#c06a00`.
- Status (`--ok`, `--warn`, `--danger`, `--info`) immer mit Icon und Text, nie nur Farbe.
- Drei Ränder: `--line` trennt, `--line-strong` begrenzt Steuerelemente (3:1), `--accent-line` markiert Auswahl.
- Vier Flächen: `--ground`, `--surface`, `--raised`, `--overlay`; dazu `--field` und `--sunken`.
- Höchstens zwei sichtbare Rahmenebenen.
- Keine `transition: all`; Dauern `--dur-*`; bei „weniger Bewegung“ sind sie 0.
- Zeichen im Text (Haken, Kreuz, Pfeile, Punkte) sind verboten, dafür gibt es `Icon`.
- Breakpoints 640, 960, 1280, 1600 stehen in `lib/breakpoints.ts` und im CSS; `test/breakpoints.test.ts` hält beide gleich.
- Dichte per `data-density="compact"` (Zeile 36, Karte 12, Zelle 8) statt Zeiger-Weiche.
- Zustände erzwingen (Entwurfsseite, Tests): Klassen `is-hover`, `is-active`, `is-focus`.

## Themen

`data-theme` am `<html>`: `night` (Standard), `day`, `system`. System ist Nacht, bei hellem Gerät
(`prefers-color-scheme: light`) die Tag-Palette. Die Tag-Werte stehen in `tokens.css` zweimal (Thema Tag und System bei
hellem Gerät); `test/design-tokens.test.ts` schlägt an, wenn beide auseinanderlaufen. Gespeichert wird in
`localStorage` unter `lykora.theme` (`lib/theme.ts`, `lib/session.ts`).

## Kontrast (WCAG 2.x)

Gemessen mit `test/helpers/tokens.ts` (rechnet wie `contrast.py` der Prüfung, Alpha-Farben über den Untergrund gelegt).
Der Test `test/design-tokens.test.ts` hält alle Paare in Nacht, Tag und System-hell: Text 4,5:1, Steuerelemente und Zeichen 3:1.
Nicht geprüft werden `--text-disabled` (gesperrte Elemente sind ausgenommen) und dekorative Linien (`--line`).

| Paar (Schrift/Zeichen auf Grund) | Verwendung | Soll | Nacht | Tag |
|---|---|---|---|---|
| `--text` auf `--ground` | Text | 4.5:1 | 15.8 | 15.0 |
| `--muted` auf `--ground` | Text, gedämpft | 4.5:1 | 9.6 | 6.3 |
| `--subtle` auf `--ground` | Metadaten, Platzhalter | 4.5:1 | 6.4 | 5.1 |
| `--accent-text` auf `--ground` | Amber als Schrift, Links | 4.5:1 | 12.2 | 5.9 |
| `--text` auf `--surface` | Text | 4.5:1 | 14.3 | 17.4 |
| `--muted` auf `--surface` | Text, gedämpft | 4.5:1 | 8.7 | 7.3 |
| `--subtle` auf `--surface` | Metadaten, Platzhalter | 4.5:1 | 5.8 | 5.9 |
| `--accent-text` auf `--surface` | Amber als Schrift, Links | 4.5:1 | 11.1 | 6.9 |
| `--text` auf `--raised` | Text | 4.5:1 | 12.7 | 15.6 |
| `--muted` auf `--raised` | Text, gedämpft | 4.5:1 | 7.7 | 6.5 |
| `--subtle` auf `--raised` | Metadaten, Platzhalter | 4.5:1 | 5.2 | 5.3 |
| `--accent-text` auf `--raised` | Amber als Schrift, Links | 4.5:1 | 9.8 | 6.1 |
| `--text` auf `--overlay` | Text | 4.5:1 | 11.4 | 17.4 |
| `--muted` auf `--overlay` | Text, gedämpft | 4.5:1 | 7.0 | 7.3 |
| `--subtle` auf `--overlay` | Metadaten, Platzhalter | 4.5:1 | 4.7 | 5.9 |
| `--accent-text` auf `--overlay` | Amber als Schrift, Links | 4.5:1 | 8.8 | 6.9 |
| `--text` auf `--field` | Text | 4.5:1 | 15.3 | 17.1 |
| `--muted` auf `--field` | Text, gedämpft | 4.5:1 | 9.4 | 7.2 |
| `--subtle` auf `--field` | Metadaten, Platzhalter | 4.5:1 | 6.2 | 5.9 |
| `--accent-text` auf `--field` | Amber als Schrift, Links | 4.5:1 | 11.8 | 6.8 |
| `--text` auf `--sunken` | Text | 4.5:1 | 15.1 | 13.9 |
| `--muted` auf `--sunken` | Text, gedämpft | 4.5:1 | 9.2 | 5.8 |
| `--subtle` auf `--sunken` | Metadaten, Platzhalter | 4.5:1 | 6.2 | 4.7 |
| `--accent-text` auf `--sunken` | Amber als Schrift, Links | 4.5:1 | 11.7 | 5.5 |
| `--on-accent` auf `--accent` | Primärbutton | 4.5:1 | 8.9 | 8.9 |
| `--on-accent` auf `--accent-hover` | Primärbutton, Hover | 4.5:1 | 10.3 | 10.3 |
| `--on-accent` auf `--accent-press` | Primärbutton, gedrückt | 4.5:1 | 7.1 | 7.1 |
| `--accent-text` auf `--surface` + `--accent-soft` | Auswahl (Schrift auf accent-soft) | 4.5:1 | 8.6 | 6.0 |
| `--text` auf `--surface` + `--accent-soft` | Auswahl, Text | 4.5:1 | 11.1 | 15.3 |
| `--on-ok` auf `--ok-fill` | Status ok, gefüllt | 4.5:1 | 6.5 | 6.2 |
| `--on-warn` auf `--warn-fill` | Status Warnung, gefüllt | 4.5:1 | 9.7 | 9.7 |
| `--on-danger` auf `--danger-fill` | Status Fehler, gefüllt | 4.5:1 | 4.6 | 6.5 |
| `--on-info` auf `--info-fill` | Status Info, gefüllt | 4.5:1 | 4.9 | 6.8 |
| `--on-safety` auf `--safety` | Sicherheit, gefüllt | 4.5:1 | 5.7 | 5.7 |
| `--ok` auf `--surface` | Status ok auf Karte | 4.5:1 | 9.2 | 6.2 |
| `--ok` auf `--ground` | Status ok auf Seitengrund | 4.5:1 | 10.1 | 5.4 |
| `--ok` auf `--surface` + `--ok-soft` | Status ok auf weichem Grund | 4.5:1 | 7.3 | 5.4 |
| `--ok` auf `--raised` + `--ok-soft` | Status ok auf weichem Grund (Fläche raised) | 4.5:1 | 6.3 | 4.9 |
| `--warn` auf `--surface` | Status warn auf Karte | 4.5:1 | 10.2 | 6.6 |
| `--warn` auf `--ground` | Status warn auf Seitengrund | 4.5:1 | 11.2 | 5.7 |
| `--warn` auf `--surface` + `--warn-soft` | Status warn auf weichem Grund | 4.5:1 | 7.8 | 5.9 |
| `--warn` auf `--raised` + `--warn-soft` | Status warn auf weichem Grund (Fläche raised) | 4.5:1 | 6.8 | 5.3 |
| `--danger` auf `--surface` | Status danger auf Karte | 4.5:1 | 7.0 | 6.5 |
| `--danger` auf `--ground` | Status danger auf Seitengrund | 4.5:1 | 7.7 | 5.7 |
| `--danger` auf `--surface` + `--danger-soft` | Status danger auf weichem Grund | 4.5:1 | 6.2 | 5.7 |
| `--danger` auf `--raised` + `--danger-soft` | Status danger auf weichem Grund (Fläche raised) | 4.5:1 | 5.5 | 5.2 |
| `--info` auf `--surface` | Status info auf Karte | 4.5:1 | 8.5 | 6.8 |
| `--info` auf `--ground` | Status info auf Seitengrund | 4.5:1 | 9.4 | 5.9 |
| `--info` auf `--surface` + `--info-soft` | Status info auf weichem Grund | 4.5:1 | 6.8 | 6.0 |
| `--info` auf `--raised` + `--info-soft` | Status info auf weichem Grund (Fläche raised) | 4.5:1 | 5.9 | 5.4 |
| `--line-strong` auf `--ground` | Rand von Steuerelementen | 3:1 | 4.0 | 3.2 |
| `--line-strong` auf `--surface` | Rand von Steuerelementen | 3:1 | 3.6 | 3.7 |
| `--line-strong` auf `--raised` | Rand von Steuerelementen | 3:1 | 3.2 | 3.3 |
| `--line-strong` auf `--field` | Rand von Steuerelementen | 3:1 | 3.9 | 3.6 |
| `--focus` auf `--ground` | Fokusring | 3:1 | 12.2 | 5.9 |
| `--focus` auf `--surface` | Fokusring | 3:1 | 11.1 | 6.9 |
| `--focus` auf `--raised` | Fokusring | 3:1 | 9.8 | 6.1 |
| `--focus` auf `--overlay` | Fokusring | 3:1 | 8.8 | 6.9 |
| `--accent-graphic` auf `--surface` | Fortschritt, Schalter an, Haken-Feld | 3:1 | 8.5 | 4.0 |
| `--accent-graphic` auf `--ground` | Fortschritt auf Seitengrund | 3:1 | 9.4 | 3.4 |
| `--accent-graphic` auf `--sunken` | Fortschrittsfüllung auf Spur | 3:1 | 9.0 | 3.2 |
| `--accent-graphic` auf `--field` | Haken-Feld auf Eingabefläche | 3:1 | 9.1 | 3.9 |
| `--on-accent` auf `--accent-graphic` | Haken im Auswahlfeld | 4.5:1 | 8.9 | 4.7 |
| `--danger` auf `--field` | Rand bei ungültigem Feld | 3:1 | 7.5 | 6.4 |
| `--team-red` auf `--surface` | Team red auf Karte | 3:1 | 4.8 | 5.1 |
| `--team-red` auf `--ground` | Team red auf Seitengrund | 3:1 | 5.3 | 4.4 |
| `--team-yellow` auf `--surface` | Team yellow auf Karte | 3:1 | 11.2 | 3.7 |
| `--team-yellow` auf `--ground` | Team yellow auf Seitengrund | 3:1 | 12.3 | 3.2 |
| `--team-orange` auf `--surface` | Team orange auf Karte | 3:1 | 8.0 | 4.2 |
| `--team-orange` auf `--ground` | Team orange auf Seitengrund | 3:1 | 8.8 | 3.6 |

## Schriften

Webschriften liegen als TrueType in `public/fonts`. Die Ersatzschriften „Atkinson Next Fallback“ und
„Barlow Condensed Fallback“ nutzen lokales Arial mit `size-adjust`, `ascent-override`, `descent-override`:
gemessen am Glyphenvorrat der Dateien gegen Liberation Sans (Arial-kompatibel): Atkinson Next Regular 98,6 %,
SemiBold 103,2 %, Barlow Condensed Bold 80,4 %; Höhen aus der hhea-Tabelle (Atkinson 0,984 / 0,316,
Barlow 1,0 / 0,2). Dadurch springt Text beim Laden kaum.

## Legacy-Aliase (bis Paket 1b)

`--edge` (= `--line-strong`), `--accent-bright` (= `--accent-text`), `--radius` (= `--radius-md`),
`--radius-small` (= `--radius-sm`), `--shade` (= `--scrim`), `--gap`, `--tap`, `--tick`, `--enter`, `--ease`.
Klassen: `.btn.primary|ghost|safety|small`, `.badge.on|strong|quiet|safety|recalled|keep-case`, `.notice.error|ok|warn`,
`.table.cards`, `.card.flat`, `.label` (= Eyebrow), `.check`, `.tabs a/button`.
