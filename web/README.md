# Lykora-Web

Dashboard für Spielleitung, Betreuer und Autoren: Leitstand mit Live-Karte, Funk, Klangpult und Prüfungen, Spiele mit Medien und Klängen, Events und Mitglieder. Geschrieben in TypeScript mit [Preact](https://preactjs.com), gebaut mit [Vite](https://vite.dev), Karten mit [Leaflet](https://leafletjs.com) und OpenStreetMap.

Der Server liefert den Build unter `<PUBLIC_URL>/` aus, z. B. `https://riegel-troisdorf.de/lykora/`. Spieler sehen nur die Landeseite `<PUBLIC_URL>/join/<Code>`; alles andere braucht eine Anmeldung.

## Starten

Im Wurzelverzeichnis des Repos:

```sh
npm install
npm run build -w @lykora/web      # baut web/dist, den der Server ausliefert
```

Der Server sucht den Build unter `web/dist` (Einstellung `WEB_DIR`). Im Docker-Image ist er schon enthalten.

## Entwickeln

Voraussetzung ist ein laufender Server auf Port 3000 (siehe [`server/README.md`](../server/README.md)).

```sh
npm run dev -w @lykora/web        # http://localhost:5173/lykora/, API und Medien gehen an localhost:3000
npm test -w @lykora/web           # Vitest: API-Client, Basispfad, Rechte, Restzeit, Klang-Zuordnung …
npm run typecheck -w @lykora/web  # TypeScript streng
npm run preview -w @lykora/web    # gebauten Stand ansehen, ebenfalls unter /lykora/
```

Einen anderen Server nimmt `LYKORA_SERVER=http://localhost:3100 npm run dev -w @lykora/web`.

### Ende-zu-Ende-Lauf

`web/e2e/run.mjs` spielt mit echtem Server und echtem Browser einen Abend durch: anmelden, Organisation anlegen, Spiel hochladen, Medien hochladen und ins Spiel übernehmen, Klänge und eine Stimme zuordnen, Event anlegen und starten, Teams per API beitreten lassen, Funk, Abriss und Neuaufbau der Live-Verbindung, Klangpult, Foto-Prüfung, Rückruf, SOS, Export, Mitglieder, Betreuer-Ansicht am Handy, die Spieler-Landeseite und eine abgelaufene Sitzung. Bildschirmfotos landen in `web/e2e/screenshots/`.

```sh
createdb -h localhost -U lykora lykora_e2e      # einmalig; der Lauf leert die Datenbank
node web/e2e/run.mjs                            # Server auf Port 3100, Vite-Vorschau auf 4173
node web/e2e/run.mjs --direkt                   # ohne Vorschau: der Server liefert web/dist selbst aus
```

Das Skript nutzt Playwright aus `/opt/node-tools/node_modules/playwright` und Chromium aus `/opt/pw-browsers`; andere Orte über `PLAYWRIGHT_MODULE` und `PLAYWRIGHT_BROWSERS_PATH`, eine andere Datenbank über `E2E_DATABASE_URL`. OSM-Kacheln kommen im Lauf aus dem Skript, damit er ohne Internet funktioniert. Fehlt dem Server die Klangbibliothek noch, ersetzt das Skript `GET /library/sounds` im Browser durch Daten nach der Absprache und sagt das am Ende.

## Aufbau

| Ort | Inhalt |
| --- | --- |
| `index.html` | Einstieg mit `<base href="/__LYKORA_BASE__/">`; der Server setzt dort seinen Basispfad ein |
| `src/lib/` | Logik ohne Oberfläche: API-Client, Basispfad, Router, Rechte, Live-Verbindung, Restzeit, Formatierung, Klang-Zuordnung, Prüfmeldungen |
| `src/ui/` | Bausteine: Link, Dialog, Reiter, Meldungen, Symbole, QR-Code |
| `src/pages/` | Seiten: Anmeldung, Organisation, Events, Event, Mitglieder, Konto, Join-Seite |
| `src/pages/control/` | Leitstand und Betreuer-Ansicht: Karte, Teams, Warnungen, SOS, Team-Detail, Funk, Klangpult, Prüfungen, Rangliste, Logbuch |
| `src/pages/games/` | Spiele: Hochladen und Prüfen, Übersicht, Versionen, Medien und Klänge, Klänge zuordnen, Materialliste |
| `src/styles/` | Design-Tokens (Nacht und Tag) und Grundgerüst, eigenes CSS ohne Framework |
| `public/fonts/` | Atkinson Next, Atkinson Mono, Fraunces und Barlow Condensed aus `app/assets/fonts`, mit Lizenzen (OFL) |
| `test/` | Vitest-Tests der Logik |
| `e2e/` | Ende-zu-Ende-Lauf mit Playwright |

### Basispfad

Der Build nutzt nur relative Adressen (`base: "./"`). Die App liest ihren Basispfad aus `document.baseURI`: Bei `<base href="/lykora/">` liegen Seiten unter `/lykora/…`, die API unter `/lykora/api` und der Live-WebSocket unter `wss://…/lykora/api/events/<id>/live`. Medien aus dem Spiel (`media/<sha256>.<ext>` oder `media/lib/<id>.ogg`) hängen am Basispfad. Im Dev-Server und in der Vorschau ersetzt ein kleines Vite-Plugin den Platzhalter durch `/lykora/`.

### Live-Daten

Der Leitstand lädt Überblick, Nachrichten, SOS und Logbuch und hält eine WebSocket-Verbindung. Live-Ereignisse lösen gezieltes Nachladen aus; Positionen trägt er direkt ein. Bricht die Verbindung ab, verbindet er mit wachsender Pause neu (1, 2, 4, 8, höchstens 15 Sekunden) und lädt danach alles nach, weil in der Lücke Ereignisse gefehlt haben können. Kommt das Netz zurück oder der Tab wieder in den Vordergrund, versucht er es sofort. Der Zustand „verbunden“ oder „getrennt“ steht immer im Kopf, offene SOS zusätzlich im Titel des Tabs.

Lehnt der Server die Sitzung ab (401), geht es zur Anmeldung und danach zurück auf dieselbe Seite. Ist der Server beim Öffnen nicht erreichbar, bleibt die gespeicherte Anmeldung erhalten und das Dashboard versucht es alle 10 Sekunden erneut.

### Klänge

- **Medien und Klänge** (`/spiele/<id>/medien`): eigene Aufnahmen, Bilder und Videos hochladen (mehrere, Ziehen und Ablegen, bis 30 MB je Datei), anhören und mit ID, Beschreibung und Urheber ins Spiel übernehmen. Dazu die mitgelieferte Klangbibliothek (CC0) zum Vorhören und Übernehmen.
- **Klänge zuordnen** (`/spiele/<id>/klang`): Atmosphäre für Spiel, Kapitel und Stationen, Geräusche beim Annähern und Lösen, Ersatz für die Geräusche der App und je Szenen-Takt eine Aufnahme (z. B. die Stimme einer Figur) und ein Geräusch. Bibliotheksklänge kommen beim Speichern als media-Eintrag ins Spiel; gespeichert wird eine neue Version.
- **Klangpult** im Leitstand: Klänge aus dem Spiel und der Bibliothek live bei einem Team oder allen einspielen, mit Lautstärke und wahlweise einem Funkspruch (`POST /events/<id>/cues`).

### Rechte

`src/lib/roles.ts` spiegelt die Rechte des Servers; ein Test vergleicht beide Tabellen. Knöpfe ohne Recht blendet das Dashboard aus, statt Fehler zu zeigen. Betreuer landen in der vereinfachten Ansicht fürs Handy.

### Gestaltung

Wie die App nach dem „Laternenprinzip“: Nacht ist Standard, nur was zählt, leuchtet im Laternen-Bernstein. Sicherheitsrot (`#C8201A`) gehört allein SOS, Rückruf und Sperrzonen, das Absperrband markiert diese Flächen. Zustände zeigen sich auch über Form und Text, nicht nur über Farbe. Tag-Thema über den Knopf oben rechts; die Wahl merkt sich der Browser.
