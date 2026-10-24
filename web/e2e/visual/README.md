# Visueller Prüfstand

Beweist, dass eine CSS-Änderung **nichts** verändert (reines Verschieben/Umbauen), oder zeigt bei gewollten
Änderungen genau, was sich ändert. Zwei Prüfmittel auf derselben gesäten Instanz:

| Skript | Prüft | Eigenschaft |
|---|---|---|
| `fingerprint.mjs` | berechnete Stile aller Elemente je Seite (Farben, Abstände, Schrift, Maße, Anzeige …) | unabhängig von Uhrzeit und Kantenglättung; Hauptbeweis für „keine Änderung“ |
| `shots.mjs` + `diff.mjs` | Pixel je Seite (1440×900 und 390×844, Nacht und Tag, dazu A4-Druckansichten) | Uhr von Seite **und** Server fest (Säzeitpunkt + 10 min), Kacheln aus Attrappe, Animationen aus, feste Raster-Optionen |

Die Seitenliste steht in `pages.mjs` (rund 45 Seiten/Zustände: Anmeldung, Events, Leitstand mit allen Reitern,
Betreuer, alle Baukasten-Abschnitte, Vor-Ort, Material, Druck). Neue Seiten dort ergänzen.

Nichts wird in den Repo-Baum geschrieben außer nach `web/e2e/visual/out/` (in `web/.gitignore`). Mit `VISUAL_OUT`
lässt sich der Ausgabeordner verlegen. Keine zusätzlichen npm-Pakete; Playwright kommt wie bei `web/e2e/run.mjs`
aus `PLAYWRIGHT_MODULE` (Standard `/opt/node-tools/node_modules/playwright`).

## Ablauf

```sh
# 0. eigene Datenbank einmalig anlegen (nicht die des Entwicklungs- oder E2E-Laufs benutzen)
createdb -h localhost -U lykora lykora_visual

# 1. Build des Stands, der geprüft werden soll (der Server liefert web/dist aus)
npm run build -w @lykora/web

# 2. Instanz mit echter Uhr starten (Hintergrund); --reset leert die Prüfstand-Datenbank
node web/e2e/visual/instance.mjs --reset &

# 3. Festen Datenbestand säen (schreibt out/state.json mit Token, Ids und Säzeitpunkt),
#    Instanz beenden und mit eingefrorener Serveruhr neu starten (der Server rechnet sonst
#    "seit N Min"-Warnungen mit der Wanduhr, und jede Minute sieht der Leitstand anders aus)
node web/e2e/visual/seed.mjs
kill %1; node web/e2e/visual/instance.mjs --freeze &

# 4. Zustand VOR der Änderung festhalten
node web/e2e/visual/fingerprint.mjs vorher
node web/e2e/visual/shots.mjs vorher

# 5. Änderung machen, neu bauen, Instanz neu starten (--freeze, OHNE --reset und OHNE neu zu säen:
#    gleiche Daten, gleicher Säzeitpunkt)
npm run build -w @lykora/web
kill %1; node web/e2e/visual/instance.mjs --freeze &

# 6. Zustand NACH der Änderung und Vergleich
node web/e2e/visual/fingerprint.mjs nachher
node web/e2e/visual/fingerprint.mjs --diff vorher nachher     # "identisch", Exit 0
node web/e2e/visual/shots.mjs nachher
node web/e2e/visual/diff.mjs vorher nachher                   # 0 abweichend, Exit 0
```

Labels (`vorher`, `nachher`) werden zu `out/fingerprint-<label>.json` und `out/shots-<label>/`; Pfade gehen auch.
Diff-Bilder (weiß = abweichende Pixel) liegen in `out/diff-<a>-<b>/`, nie neben den Quellbildern.

## Umgebung

| Variable | Standard | Bedeutung |
|---|---|---|
| `VISUAL_URL` | `http://localhost:3200/lykora` | Basis-URL der Instanz (für `seed`, `fingerprint`, `shots`) |
| `VISUAL_PORT` / `VISUAL_DB` | `3200` / `postgres://lykora@localhost:5432/lykora_visual` | für `instance.mjs` (Port und Datenbank der eigenen Instanz) |
| `VISUAL_OUT` | `web/e2e/visual/out` | Ausgabeordner (Zustand, Fingerabdrücke, Bilder, Diffs) |
| `VISUAL_ONLY` | alle | Regex auf die Seiten-Id, z. B. `'^ls'` oder `'^bk-'` |
| `VISUAL_VPS` | `dm` | Viewports: `d` 1440×900, `m` 390×844, `t` 1024×768 |
| `VISUAL_THEMES` | `nl` | `n` = Nacht, `l` = Tag |
| `PLAYWRIGHT_MODULE` | `/opt/node-tools/node_modules/playwright` | Pfad zu Playwright |

Druck-Seiten (`druck-*`) laufen unabhängig von `VISUAL_VPS`/`VISUAL_THEMES` immer in A4 (794×1123), Nacht, Druck-Medium.

## Hinweise

- „Keine Änderung beweisen“: Fingerabdruck **und** Pixel müssen leer sein. Hinweis: Der Fingerabdruck sieht nur
  Elemente, die auf den Seiten vorkommen; Regeln für nicht gezeigte Zustände fängt der Vergleich des gebauten CSS
  ab (Build vorher/nachher, Leerraum normalisiert, Regeln in gleicher Reihenfolge).
- „Gewollte Änderung prüfen“: dieselben Befehle; die Ausgabe nennt je Seite die geänderten Stile bzw. Pixelzahlen,
  die Diff-Bilder zeigen, wo. Karten-Marker sind im Fingerabdruck ausgenommen und stehen nur im Pixelvergleich.
- Wer nach einer Änderung neu sät, muss auch „vorher“ neu aufnehmen (Säzeitpunkt und Ids ändern sich).
- Zwei Läufe ohne Änderung müssen identisch sein (Selbsttest: `shots.mjs a`, `shots.mjs b`, `diff.mjs a b`; ebenso
  `fingerprint.mjs`). Das gilt nur mit eingefrorener Serveruhr (`instance.mjs --freeze`), den festen Raster-Optionen
  (`lib.mjs`, `launch`) und dem Neuverbinden der Live-Seiten (`pages.mjs`, `live: true`): Ohne diese Maßnahmen
  wechseln Warnungstexte, der Funk-Zähler am Reiter, die Scrollposition und ±1/255 an Rundungen von Lauf zu Lauf.
- Die Live-Seiten (Leitstand, Betreuer) werden nach dem Laden einmal neu verbunden. Grund: Der Funk-Zähler am Reiter
  zeigt veraltete Werte, wenn die Nachrichten als letzte Antwort eintreffen; das ist ein Zufall der Ladereihenfolge
  der App, kein Stilunterschied.
- Statt `instance.mjs` geht jede andere Instanz, deren `WEB_DIR` auf den gewünschten Build zeigt (`VISUAL_URL` setzen).
