# Lykora-Server

Backend für Lykora: REST-API mit OpenAPI-Doku, WebSockets für Dashboard und App, Medien und Klangbibliothek, PostgreSQL als Datenbank. Geschrieben in TypeScript mit [Fastify](https://fastify.dev). Der Server liefert auch das Web-Dashboard aus `web/` aus.

| Adresse | Inhalt |
| --- | --- |
| `<PUBLIC_URL>/` | Web-Dashboard (Single-Page-App) |
| `<PUBLIC_URL>/api/` | REST-API, vollständige Beschreibung unter **`<PUBLIC_URL>/api/docs`** |
| `<PUBLIC_URL>/media/` | Hochgeladene Medien der Spiele und Klangbibliothek, öffentlich |
| `<PUBLIC_URL>/tiles/<paket>/{z}/{x}/{y}.png` | Kacheln der eigenen Karte, öffentlich (siehe „Eigene Karte“) |

## Betrieb mit Docker

Voraussetzung: Docker mit Compose. Alle Befehle im Wurzelverzeichnis des Repos.

```sh
cp .env.example .env      # Passwörter und Adresse eintragen
docker compose pull       # fertiges Image von ghcr.io holen
docker compose up -d
docker compose logs -f server
```

Compose startet drei Container: `db` (PostgreSQL), `server` (API und Web-Dashboard) und `updater`, der auf Wunsch neue Versionen einspielt (siehe unten). Wer selbst bauen will, setzt in `.env` `LYKORA_IMAGE=lykora-server:latest` und startet mit `docker compose up -d --build`; automatische Updates gibt es dann nicht.

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
| `MAP_PACKS_DIR` | `server/map-packs` im Repo, `/app/server/map-packs` im Container | Kartenpakete: `<paket>/{z}/{x}/{y}.png` und `<paket>/pack.json` |
| `SESSION_DAYS` | `14` | Gültigkeit einer Anmeldung |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LYKORA_IMAGE` | `ghcr.io/wolfsrudel-gaming/lykora:testbuild` (Compose) | Image von Server und Updater; darunter sucht der Server neue Versionen. Leer schaltet die Prüfung ab |
| `UPDATE_CHECK_MINUTES` | `30` | Abstand der Prüfung auf neue Versionen, 1 bis 10080 (eine Woche) |
| `UPDATE_TIMEZONE` | `Europe/Berlin` | Zeitzone für das Zeitfenster der automatischen Updates |
| `UPDATER_TOKEN` | – | Gemeinsamer Token von Server und Updater; ohne legt der Server `DATA_DIR/updater.token` an |
| `LYKORA_REGISTRY_USER`, `LYKORA_REGISTRY_TOKEN` | – | Zugang für private Images (Server und Updater) |
| `LYKORA_REGISTRY_URL` | aus `LYKORA_IMAGE` | Adresse, unter der der Server die Registry erreicht, falls sie von der im Image abweicht, z. B. `http://host.docker.internal:5000` für eine Registry auf dem Host |
| `UPDATER_POLL_SECONDS` | `60` | Abstand, in dem der Updater fragen soll; der Server gibt ihn mit jeder Antwort vor |
| `GITHUB_REPO` | `Wolfsrudel-Gaming/lykora` | Repo für die Liste der Änderungen |
| `LYKORA_VERSION`, `LYKORA_COMMIT`, `LYKORA_BUILT_AT` | setzt die CI im Image | Version des Builds; ohne meldet der Server `dev` |

### Images

Nach jedem Push mit grünen Tests veröffentlicht die CI ein Image für amd64 und arm64 (Raspberry Pi und Co.) unter `ghcr.io/wolfsrudel-gaming/lykora`:

| Tag | Inhalt |
| --- | --- |
| `testbuild` | neuester Push, egal auf welchem Branch (wie die Test-APK) |
| `latest` | neuester Stand von `main` |
| `<branch>` | neuester Stand eines Branches; `/` und andere Sonderzeichen werden zu `-` |
| `sha-<7 Zeichen>` | genau ein Commit, zum Festhalten einer Version |

Das Image trägt seine Version als Umgebung und als Labels `org.opencontainers.image.version` (Laufnummer der CI), `.revision` (Commit) und `.created`. Den Kanal wählt `LYKORA_IMAGE` in `.env`; nach einer Änderung `docker compose pull && docker compose up -d`.

**Das Paket ist nach dem ersten Lauf der CI privat.** GitHub legt ein neues Container-Paket immer privat an; `docker compose pull` scheitert dann mit `denied`, und das Dashboard meldet unter Einstellungen „Prüfung fehlgeschlagen: Image nicht gefunden oder nicht öffentlich“ mit demselben Hinweis wie hier. Einmalig freigeben: GitHub → Organisation `Wolfsrudel-Gaming` → Packages → `lykora` → Package settings → „Change visibility“ → Public. Wer das Paket privat lassen will, trägt stattdessen in `.env` `LYKORA_REGISTRY_USER` (GitHub-Nutzer) und `LYKORA_REGISTRY_TOKEN` (Personal Access Token mit `read:packages`) ein; Server und Updater melden sich damit an. Fürs Ziehen von Hand zusätzlich `docker login ghcr.io`.

### Automatische Updates

Neue Versionen spielt der Container `updater` ein, aber nur, wenn ein Admin der Instanz das im Dashboard erlaubt: **Einstellungen → Server und Updates → „Updates automatisch einspielen“**, auf Wunsch nur in einem Zeitfenster (z. B. 03:00–05:00), oder einmalig mit „Jetzt aktualisieren“. Ohne Opt-in fragt der Updater nur.

So läuft ein Update:

1. Der Server prüft alle `UPDATE_CHECK_MINUTES` die Registry, ob unter `LYKORA_IMAGE` eine neuere Version liegt, und zeigt sie samt Änderungen im Dashboard.
2. Der Updater fragt den Server jede Minute (`GET /api/updater/plan`). Der Server sagt nur „jetzt“ oder „warten“: nie während eines Events (laufend, pausiert, zurückgerufen), sonst nach Opt-in und Zeitfenster.
3. Der Updater zieht das Image, mit dem der Container `server` schon läuft. Eine Image-Adresse vom Server nimmt er nie an.
4. Er markiert die alte Version als `<image>:lykora-rollback`, benennt den alten Container in `<name>-alt` um, stoppt ihn und legt den neuen mit denselben Einstellungen an: Umgebung, Volumes, Ports, Netze mit Aliasen, Labels. Was vom alten Image stammt, kommt jetzt vom neuen.
5. Er wartet bis zu 180 s, bis der neue Container gesund ist (Healthcheck des Images). Dann löscht er den alten Container und meldet „Update eingespielt“.
6. Startet die neue Version nicht gesund, löscht er sie, startet den alten Container wieder und meldet „zurückgerollt“ mit den letzten Log-Zeilen. Das Tag aus `LYKORA_IMAGE` zeigt danach lokal wieder auf die alte Version, damit ein späteres `docker compose up -d` (etwa nach einer Änderung in `.env`) nicht die kaputte anlegt; `docker compose pull` holt sie aber erneut, bis in der Registry eine reparierte liegt. Automatisch versucht der Server dieselbe Version frühestens nach 6 Stunden wieder; „Jetzt aktualisieren“ geht sofort.
7. Zuletzt ersetzt sich der Updater selbst: Er startet `<name>-neu` mit dem neuen Image, der den alten Updater stoppt und dessen Namen übernimmt.

Bricht ein Update mittendrin ab, etwa durch einen Neustart des Rechners, findet der Updater beim nächsten Start `<name>-alt` und stellt den alten Container wieder her, falls der neue nicht gesund läuft. Verweigert Docker beim Rückfall einen Schritt, wiederholt der Updater ihn; bleibt der alte Container trotzdem liegen, holt er ihn bei der nächsten Frage an den Server zurück, spätestens nach drei vergeblichen Fragen. Die Seite bleibt also nie liegen.

Der Updater hat Zugriff auf den Docker-Socket und damit volle Rechte auf dem Host. Er fasst nur Container mit dem Label `io.lykora.autoupdate=true` an und zieht nur Images, mit denen diese schon laufen. Den Token für den Server liest er aus `/data/updater.token` (Volume `data`, nur lesend). Wer ihn gar nicht laufen lassen will: `docker compose up -d --scale updater=0`.

| Variable (Updater) | Standard | Bedeutung |
| --- | --- | --- |
| `LYKORA_SERVER_URL` | `http://server:3000/lykora` | Adresse des Servers inklusive Basispfad |
| `UPDATER_TOKEN`, `UPDATER_TOKEN_FILE` | –, `/data/updater.token` | Token für den Server, fest oder aus der Datei |
| `UPDATER_POLL_SECONDS` | `60` | Abstand der Fragen, solange der Server nicht erreichbar ist; sonst gibt der Server seinen Wert vor |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker-Socket im Container; in `.env` der Pfad auf dem Host |

Zustand und Fehler stehen im Dashboard und in `docker compose logs updater`. „Nicht unterstützt“ heißt meist: Der Server läuft mit einem selbst gebauten Image, das in keiner Registry liegt. Dann `LYKORA_IMAGE` in `.env` auf ein Image von ghcr.io setzen und `docker compose pull && docker compose up -d`. Steht in `LYKORA_IMAGE` selbst ein lokales Image wie `lykora-server:latest`, fragt der Server keine Registry und sagt das im Dashboard. „Prüfung fehlgeschlagen: Image nicht gefunden oder nicht öffentlich“ heißt bei ghcr.io fast immer: Das Paket ist noch privat (siehe [Images](#images)).

Von Hand geht ein Update genauso mit `docker compose pull && docker compose up -d`. Zurück auf die vorige Version (automatische Updates vorher ausschalten):

```sh
docker tag ghcr.io/wolfsrudel-gaming/lykora:lykora-rollback ghcr.io/wolfsrudel-gaming/lykora:testbuild
docker compose up -d
```

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
| `src/updater.ts`, `src/updater/` | Updater: Docker-Engine-API über den Socket, Konfiguration zusammenführen, Ablauf eines Updates mit Rückfall |
| `migrations/` | SQL-Migrationen, werden beim Start eingespielt |
| `tool/updater-e2e/` | Probe der automatischen Updates mit echtem Docker und `compose.yaml` (`node tool/updater-e2e/run.mjs`), Probe des Updaters allein inklusive Abbruch (`updater-only.mjs`) und kleine Registry für Tests |

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

## Entwürfe und Probeläufe

Der Baukasten im Dashboard arbeitet auf einem Entwurf je Spiel (`game_drafts`), der ungültig sein darf; eine Version entsteht erst beim Veröffentlichen. Spiele dürfen deshalb ohne Version existieren (`latest_version: null`), und `GET /api/orgs/<org>/games` liefert zu jedem Spiel `draft` mit Revision, Zeitpunkt, Person und `changed` (weicht von der neuesten Version ab). `meta` enthält Merker des Baukastens (Vorlage, Vor-Ort, Checkliste) und wird nie Teil des Spiels.

| Schritt | Endpunkt |
| --- | --- |
| Spiel nur als Entwurf anlegen, ohne Prüfung | `POST /api/orgs/<org>/games/drafts` mit `{ content, meta? }`; 400 `not_a_game` ohne `format.name` |
| Entwurf lesen | `GET /api/games/<id>/draft`; 404 `no_draft` |
| Entwurf speichern (bis 5 MB) | `PUT /api/games/<id>/draft` mit `{ content, meta, revision }`; `revision: 0` legt ihn an. Passt die Revision nicht: 409 `draft_conflict` mit dem gespeicherten Stand als `draft` |
| Entwurf verwerfen | `DELETE /api/games/<id>/draft`; 409 `no_version` bei einem Spiel ohne Version |
| Veröffentlichen | `POST /api/games/<id>/draft/publish` mit `{ revision, comment? }`: prüft wie beim Hochladen (400 `invalid_game` mit `errors` und `warnings`), legt die nächste Version an und nennt geplante Events mit älterer Version (`plannedEvents`) |
| Geplantes Event umstellen | `PATCH /api/events/<id>` mit `{ version }`; nur im Status `draft`, sonst 409 `event_started` |
| Probelauf | `POST /api/games/<id>/test-events` mit `{ revision }`: prüft wie beim Veröffentlichen, speichert den Stand als Probestand ohne Versionsnummer (`game_versions.kind = 'test'`) und startet sofort ein Event mit `test: true` und Betreuer-PIN. Ein laufender Probelauf desselben Spiels wird beendet |
| Materialliste des Entwurfs | `GET /api/games/<id>/materials?source=draft`; ohne `source` und ohne Version 409 `no_version` |

Rechte wie bei Spielen: lesen `game.read`, schreiben `game.write`. Autoren dürfen Probeläufe anlegen, weil sie zum Spiel gehören; normale Events brauchen weiterhin `event.manage`, und `POST /api/orgs/<org>/events` lehnt Spiele ohne Version mit 409 `no_version` ab. Probeläufe stehen in der Event-Liste mit `test: true` und werden sieben Tage nach dem Anlegen samt Probestand gelöscht (Löschlauf wie unter Datenschutz).

## Medien und Klänge

Autoren laden Klänge, Bilder und Videos zu einem Spiel hoch: `POST /api/games/<id>/media?filename=<Name>` mit der Datei als Body und passendem Content-Type (MP3, OGG, WAV, M4A, AAC, WebM, FLAC, JPEG, PNG, WebP, MP4; höchstens 30 MB). Der Server legt die Datei unter `DATA_DIR/media/<sha256>.<Endung>` ab; gleiche Dateien liegen nur einmal da. Die Antwort enthält `src`, das in `media[].src` des Spiels gehört, z. B. `media/3f…a1.ogg`. Beim Löschen bleibt die Datei, solange ein anderer Eintrag sie nutzt; braucht ein noch nicht beendetes Event sie, gibt es 409.

Die mitgelieferte Klangbibliothek (CC0) listet `GET /api/library/sounds`; im Spiel verweist `src: "media/lib/<id>.ogg"` darauf.

Alle Medien sind ohne Anmeldung unter `<PUBLIC_URL>/media/…` abrufbar, mit Range-Anfragen zum Spulen. Hochgeladene Dateien ändern sich nie und dürfen ein Jahr im Cache bleiben.

Im Klangpult spielt die Spielleitung Klänge live ein: `POST /api/events/<id>/cues` mit `audio` (Medien-ID des Spiels oder `lib:<id>`), optional `teamId`, `volume` und `text` als Funkspruch. Das Team bekommt eine Nachricht mit `kind: "cue"` und JSON im `body` und wird angestupst.

## Eigene Karte

Der Server liefert Kartenkacheln selbst aus: ein Paket aus echten OpenStreetMap-Rasterkacheln für ein kleines Spielgebiet, dazu eine dunkle Nachtvariante. Das Testspiel läuft damit sofort, ohne dass Dashboard oder Handys einen fremden Kartenserver brauchen, und im Feld reichen die einmal geladenen Kacheln. Mitgeliefert ist `sieglar` (DRK Ortsverein Troisdorf, Teutonenstraße 31, 800 m Umkreis, Zoom 14–18) und `sieglar-nacht`.

| Adresse | Inhalt |
| --- | --- |
| `GET <PUBLIC_URL>/tiles/<paket>/{z}/{x}/{y}.png` | Kachel, ohne Anmeldung, eine Woche im Cache, mit ETag; fehlt sie, gibt es 404 (Clients zeigen dann Lücke oder Ersatz) |
| `GET <PUBLIC_URL>/api/tiles` | Liste der Pakete aus ihrer `pack.json` mit `tiles` (Vorlage relativ zum Server) und `url` (vollständig) |

**Im Spiel** trägt `settings.map.tiles` die Vorlage ein, relativ zum Server, so wie `media[].src`:

```json
"settings": { "map": { "tiles": "tiles/sieglar/{z}/{x}/{y}.png" } }
```

Nachts: `tiles/sieglar-nacht/{z}/{x}/{y}.png`. Das Schema erlaubt jeden Text; das Dashboard erkennt eine Vorlage an `{z}`, `{x}` und `{y}`. Ohne `https://` gilt sie ab dem Basispfad des Servers, mit `https://` als vollständige Adresse. Ist das Feld leer oder keine Vorlage, nimmt das Dashboard `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Mehr dazu in `docs/de/eigene-karte.md`.

**Paket neu erzeugen oder ein anderes Gebiet:**

```sh
python3 server/tool/map_pack.py --name sieglar --title "DRK Ortsverein Troisdorf, Sieglar" \
    --lat 50.8070781 --lon 7.1337849 --radius 800 --zooms 14-18
```

Das Werkzeug (Python 3 und Pillow) holt die Kacheln einmalig von `tile.openstreetmap.org` (höflich: Kennung im User-Agent, höchstens 2 Anfragen je Sekunde, vorhandene Kacheln werden übersprungen, Zwischenspeicher in `~/.cache/lykora/osm-tiles`, anderer Ort mit `--cache`). Mit `--zoom-radius 18=450` (Standard) bekommt die feinste Stufe nur 450 m Umkreis, sonst wächst das Paket auf das Vierfache. Der Server wertet nur den Ordner aus; für ein weiteres Gebiet genügt ein weiterer Paketname (`^[a-z0-9-]{1,40}$`). Das aktuelle Paket hat 192 Kacheln je Variante (z14: 4, z15: 8, z16: 22, z17: 71, z18: 87) und rund 5,4 MB zusammen. Nach dem Erzeugen die Änderung committen: `server/map-packs` gehört ins Image (Dockerfile) und ins Repo.

**Lizenz und Zuschreibung.** Kartendaten © OpenStreetMap-Mitwirkende, ODbL 1.0; die Zuschreibung „© OpenStreetMap-Mitwirkende“ muss in jeder Karte sichtbar bleiben (Dashboard und App zeigen sie, `pack.json` trägt sie). Die Nachtvariante ist eine Umfärbung derselben Kacheln und steht unter derselben Lizenz.

**Hinweis für den Betrieb.** Die Kacheln stammen vom Standard-Server des OSM-Projekts, dessen [Nutzungsbedingungen](https://operations.osmfoundation.org/policies/tiles/) kein Massenabrufen erlauben. Das Werkzeug ist für ein kleines Gebiet und einmaliges Laden gedacht. Wer größere Gebiete oder viele Pakete braucht, nimmt einen eigenen Kachelserver oder einen Anbieter mit passenden Bedingungen (`--tile-url https://…/{z}/{x}/{y}.png`) und erzeugt das Paket damit neu.

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
