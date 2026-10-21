# Lykora-Server

Backend für Lykora: REST-API mit OpenAPI-Doku, WebSockets für Dashboard und App, Medien und Klangbibliothek, PostgreSQL als Datenbank. Geschrieben in TypeScript mit [Fastify](https://fastify.dev). Der Server liefert auch das Web-Dashboard aus `web/` aus.

| Adresse | Inhalt |
| --- | --- |
| `<PUBLIC_URL>/` | Web-Dashboard (Single-Page-App) |
| `<PUBLIC_URL>/api/` | REST-API, vollständige Beschreibung unter **`<PUBLIC_URL>/api/docs`** |
| `<PUBLIC_URL>/media/` | Hochgeladene Medien der Spiele und Klangbibliothek, öffentlich |

## Betrieb mit Docker

Voraussetzung: Docker mit Compose. Alle Befehle im Wurzelverzeichnis des Repos.

```sh
cp .env.example .env      # Passwörter und Adresse eintragen
docker compose up -d --build
docker compose logs -f server
```

Beim ersten Start spielt der Server die Datenbank-Migrationen ein und legt den Admin aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` an. Danach kann man die beiden Werte aus `.env` wieder löschen.

Der Server lauscht nur auf `127.0.0.1:3000`. HTTPS übernimmt der Webserver davor, der `/lykora/` an den Server weiterreicht, inklusive WebSocket-Upgrade für `/lykora/api/events/<id>/live` (Dashboard) und `/lykora/api/play/live` (App). Uploads sind bis 50 MB groß; bei nginx dafür `client_max_body_size 50m;` setzen.

Weitere Befehle:

```sh
# Admin anlegen oder Passwort zurücksetzen
docker compose exec server node dist/cli.js create-admin admin@example.org "Name" "neues-passwort"
# Datenbank sichern
docker compose exec db pg_dump -U lykora lykora > lykora-$(date +%F).sql
```

### Einstellungen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `DATABASE_URL` | – | PostgreSQL-Verbindung (setzt Compose selbst) |
| `PUBLIC_URL` | `http://localhost:3000/lykora` | Öffentliche Adresse inklusive Basispfad; landet im Einstiegs-QR |
| `BASE_PATH` | `/lykora` | Pfad, unter dem der Server antwortet; leer für die Wurzel einer Domain |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | – | Erster Admin, nur solange es keinen Nutzer gibt |
| `SMS_WEBHOOK_SECRET` | – | Geheimnis für eingehende SOS-SMS; leer schaltet den Eingang ab |
| `DATA_DIR` | `/data` im Container | Ablage für Fotos und Videos der Teams und für hochgeladene Medien der Spiele (`media/`) |
| `WEB_DIR` | `web/dist` im Repo, `/app/web/dist` im Container | Build des Web-Dashboards; fehlt er, zeigt `<PUBLIC_URL>/` einen Hinweis |
| `MEDIA_LIBRARY_DIR` | `server/media-library` im Repo | Klangbibliothek: `<id>.ogg` und `library.json` |
| `SESSION_DAYS` | `14` | Gültigkeit einer Anmeldung |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Entwickeln

Voraussetzungen: Node.js 22 und ein PostgreSQL 16.

```sh
npm install                       # im Wurzelverzeichnis
createdb lykora_dev && createdb lykora_test
cd server
DATABASE_URL=postgres://localhost/lykora_dev ADMIN_EMAIL=admin@example.org ADMIN_PASSWORD=geheim-geheim npm run dev
npm test                          # nutzt TEST_DATABASE_URL, Standard postgres://lykora@localhost:5432/lykora_test
npm run typecheck
```

Die Tests leeren die Testdatenbank bei jedem Lauf.

Das Dashboard unter `http://localhost:3000/lykora/` braucht einen Build (`npm run build -w @lykora/web`); zum Entwickeln am Dashboard `npm run dev -w @lykora/web` nutzen, das API und Medien an diesen Server weiterreicht.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/engine/` | Spiellogik ohne Datenbank: Antwortprüfung, Spielstand aus dem Aktionsprotokoll, Regeln, Wertung |
| `src/routes/` | API-Endpunkte, öffentliche Medien (`files.ts`), Auslieferung des Dashboards (`web.ts`) |
| `src/services/` | Laden und Berechnen von Events und Teams, Dashboard-Warnungen, automatisches Löschen, Medien und Klangbibliothek |
| `src/lib/` | Anmeldung, Rollen, Geometrie, Live-Verteilung, Dateiauslieferung mit Range-Anfragen, CSV |
| `migrations/` | SQL-Migrationen, werden beim Start eingespielt |

### Spielstand aus dem Aktionsprotokoll

Der Server speichert keine Punkte oder gelösten Stationen, sondern nur, **was ein Team getan hat**: Station ausgelöst, Antwort gegeben, Hinweis genommen. Dazu kommen Eingriffe der Spielleitung. Der Spielstand wird bei jedem Abgleich aus diesem Protokoll neu berechnet, sortiert nach dem Zeitstempel der Aktion.

Das passt zum lückenhaften Netz: Ein Team spielt offline weiter, die App prüft Antworten selbst und schickt die Aktionen nach, sobald wieder Netz da ist. Der Server ordnet sie zeitlich richtig ein und entscheidet. Kommen Aktionen doppelt an, zählen sie nur einmal.

Die gleiche Logik muss es später in der App (Dart) geben. Die Tests in `test/engine.test.ts` beschreiben das erwartete Verhalten.

## Schnittstelle der Spieler-App

| Schritt | Endpunkt |
| --- | --- |
| Einstieg per QR (`lykora://join?server=…&code=…`) oder Code | `POST /api/join` mit Teamdaten; weitere Handys mit `deviceCode` |
| Spiel vor dem Start herunterladen | `GET /api/play/game` |
| Abgleich, z. B. alle 15 s bei Netz | `POST /api/play/sync` mit Aktionen, Positionen, Akkustand |
| SOS | `POST /api/play/sos`, offline gespeichert mit `deferred: true` nachholen |
| Nachricht an die Spielleitung | `POST /api/play/messages` |
| Foto/Video hochladen | `POST /api/play/uploads` mit `Content-Type: image/jpeg` usw. |
| Anstupsen bei Netz | WebSocket `GET /api/play/live?access_token=<Gerätetoken>` |

Über `/api/play/live` kommt erst `{"type":"hello"}`, danach `{"type":"poke","reason":…}`, sobald das Team abgleichen soll (`message`, `cue`, `status`, `action`, `sos`, `team`), und alle 25 s `{"type":"ping"}`. Ein ungültiger Token schließt die Verbindung mit Code 4401. Der Abgleich bleibt die einzige Quelle für Daten; das Anstupsen spart nur Wartezeit.

Die Antwort von `/api/play/sync` enthält neben Spielstand und Nachrichten die letzten 20 SOS-Meldungen des Teams mit `acknowledgedAt`, `acknowledgedBy` und `resolvedAt`, damit die App zeigen kann, dass die Spielleitung den Alarm gesehen hat.

Aktionen eines Teams: `start`, `trigger` (`station`, `method`), `answer` (`station` und `text`, `choice`, `upload` oder `location`), `hint` (`station`, `level`), `heartbeat` (Lebenszeichen), `arrived` (am Sammelpunkt). Jede Aktion hat eine eindeutige `id` und ihren Zeitstempel `time`. Mit `deviceTime` im Abgleich gleicht der Server eine falsch gehende Uhr des Handys aus.

### SOS per SMS

Ohne Datenverbindung schickt die App eine SMS an die Spielleitung. Ein SMS-Gateway kann sie an `POST /api/integrations/sms` weiterreichen (Header `X-Lykora-Secret`, Body `{ "from": "...", "text": "..." }`). Aufbau der SMS:

```
LYKORA SOS <Event-Code> <Gerätecode des Teams> <lat>,<lon> <Freitext>
LYKORA SOS K7M2QX AB3D 50.81550,7.15500 Knöchel verletzt
```

Die SMS ist auch ohne Gateway für Menschen lesbar.

## Medien und Klänge

Autoren laden Klänge, Bilder und Videos zu einem Spiel hoch: `POST /api/games/<id>/media?filename=<Name>` mit der Datei als Body und passendem Content-Type (MP3, OGG, WAV, M4A, AAC, WebM, FLAC, JPEG, PNG, WebP, MP4; höchstens 30 MB). Der Server legt die Datei unter `DATA_DIR/media/<sha256>.<Endung>` ab; gleiche Dateien liegen nur einmal da. Die Antwort enthält `src`, das in `media[].src` des Spiels gehört, z. B. `media/3f…a1.ogg`. Beim Löschen bleibt die Datei, solange ein anderer Eintrag sie nutzt; braucht ein noch nicht beendetes Event sie, gibt es 409.

Die mitgelieferte Klangbibliothek (CC0) listet `GET /api/library/sounds`; im Spiel verweist `src: "media/lib/<id>.ogg"` darauf.

Alle Medien sind ohne Anmeldung unter `<PUBLIC_URL>/media/…` abrufbar, mit Range-Anfragen zum Spulen. Hochgeladene Dateien ändern sich nie und dürfen ein Jahr im Cache bleiben.

Im Klangpult spielt die Spielleitung Klänge live ein: `POST /api/events/<id>/cues` mit `audio` (Medien-ID des Spiels oder `lib:<id>`), optional `teamId`, `volume` und `text` als Funkspruch. Das Team bekommt eine Nachricht mit `kind: "cue"` und JSON im `body` und wird angestupst.

## Rollen

| Rolle | Darf |
| --- | --- |
| Admin | alles in der Organisation, Mitglieder verwalten |
| Autor | Spiele anlegen und bearbeiten, Medien hochladen |
| Spielleiter | Events anlegen, steuern und eingreifen |
| Betreuer | Events sehen, Stationen bestätigen, Fotos prüfen, SOS bestätigen, Nachrichten senden, Klänge einspielen |
| Darsteller | Events sehen, Nachrichten als Figur senden, Klänge einspielen |
| Zuschauer | Events und Rangliste sehen, ohne Positionen |

## Datenschutz

Spieler haben kein Konto. Nach Ende eines Events plus `retentionDays` (Standard 30) löscht der Server stündlich automatisch Laufspuren, Fotos, Vornamen, Notfallnummern und SOS-Positionen. Ergebnisse und Logbuch bleiben für die Auswertung erhalten.

## Noch nicht enthalten

- Kartenkacheln (PMTiles)
- 2FA, Passkeys, SSO und Magic Link
- SOS-Weiterleitung an Telegram, Matrix oder SMS
- MQTT für ESP32-Boxen und LoRa
- Schnelligkeitspunkte, Item-Tausch und weitere Interaktionen zwischen Teams
- Betrieb mit mehreren Server-Instanzen (Live-Verteilung läuft im Prozess)
