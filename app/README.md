# Lykora-App

Spieler-App für Android, gebaut mit Flutter. Ein Handy pro Team reicht; weitere Handys koppeln sich mit dem Gerätecode.

## Was die App kann

Die App erzählt Gruppen eine Geschichte draußen: als Schnitzeljagd, Nachtwanderung oder Escape-Spiel. Leitidee ist das **Laternenprinzip**: Das Handy ist die Laterne des Teams. Auf jedem Bildschirm leuchtet nur, was gerade zählt; alles andere bleibt Nacht.

| Bereich | Funktionen |
| --- | --- |
| Einstieg | Event-Karte scannen (`lykora://join?…`) oder den Code in sechs Kästchen tippen; Team in drei Schritten: Name, wer ist dabei, Betreuer-PIN; weitere Handys per Gerätecode |
| Packen und Startklar | „Alles im Rucksack“ zeigt sichtbar, dass das Spiel offline läuft; Startklar-Ritual mit Ortung, Akku, Hintergrundbetrieb, Tontest, NFC, Ausrüstung; Lichtmodus wählen; „So sieht echt aus“ |
| Briefing | Einsatzalarm: Die Zentrale meldet sich per Funk, das Team bestätigt, dann folgt die Kapitelkarte |
| Weg | **Peilen** statt zappelndem Pfeil: vier Stufen (weit, unterwegs, nah, hier) mit Hysterese, Ton und Vibration; ein Lichtkegel zeigt die Richtung und wird ehrlich breiter, wenn GPS oder Kompass unsicher sind; Taschenmodus. Dazu Nachtkarte (Schleier außerhalb des Spielfelds, schraffierte Sperrzonen, Stationsformen, Fußspur) und Liste mit grober Entfernung und Richtung als Uhrzeit |
| Station als Szene | Ankommen und Erleben in Takten: Funkspruch, Erzähler, Dialog mit Antworten, Fundstück-Dokument, Anweisung an alle, Kapitelkarte; Vorlesemodus Satz für Satz |
| Rätsel | Zahlenschloss mit Rädern, Auswahlkacheln (für 6–9 als Bildkarten mit Vorlesen), Schreibmaschinenzeile oder Protokolleintrag, Beweisfoto, Ort finden; falsch heißt Schloss rasselt, nie Rot; Tipps kommen als Funkspruch |
| Belohnung | Siegel oder Stempel der Spielwelt prägt sich ein, das Fragment erscheint mit klarer Position, die Zentrale gibt den Ausblick; Kapitelwechsel; Finale: die gesammelten Teile werden ins Schloss gesetzt statt abgetippt, danach Auflösung und der Weg zum Sammelpunkt |
| Klang | Atmosphäre in Schleife je Spiel, Kapitel und Station mit weicher Überblendung; Geräusche beim Annähern, beim Lösen und zu Takten einer Szene; eigene Aufnahmen statt der eingebauten Geräusche; Stimmen ducken die Atmosphäre; Cues, die die Spielleitung live einspielt; alles offline aus dem Spielpaket |
| Funk | Funkprotokoll statt Chat-Blasen; Funktasten „Verstanden“, „Wir brauchen einen Tipp“, „Uns ist mulmig“, „Station kaputt?“; Live-Meldungen der Spielleitung, die sofort ankommen, weil der Server das Handy anstupst; Störung im Äther ohne Netz |
| Akte | Schlüsselbund, Fundstücke (auch Dokumente aus Szenen), Personen (Unbekannte als Schatten), Chronik zum Nachhören; Name je Spielwelt, z. B. „Einsatzprotokoll“ oder „Tagebuch der Nacht“ |
| Sicherheit | Eigene Ebene über allen Seiten mit Absperrband, ISO-Zeichen und dem Wort ECHT, das die Geschichte nie benutzt: feste Leiste mit SOS; Stufe B als Streifen (Sperrzone in der Nähe, Lebenszeichen, Nachricht der Spielleitung, SOS wartet); Stufe A als Vollbild (Rückruf mit Pfeil und „Wir sind unterwegs“, mitten in der Sperrzone), dabei verstummen Geschichte, Atmosphäre und Cues sofort. SOS 3 s halten, ehrlicher Sendestatus bis „Spielleitung hat gelesen“ und „erledigt“, 112, SMS, „Finde mich“; Notfallinfos mit Standort in Klartext |
| Licht | Nacht, Rotlicht, Bernstein und Tag als eigene Paletten (kein Farbfilter); Lichtschalter immer oben links; Kontraste werden nach WCAG getestet |
| Spielwelten | Krimi, Mystery, Agenten, Rettung und Allgemein mit eigenem Akzent, eigener Titelschrift, Siegel oder Stempel und eigenen Wörtern für Peilgerät und Akte |
| Lesefassung 6–9 | Größere Fibelschrift, Bildkarten, Vorlesen, Hilfe der Zentrale nach drei Minuten von selbst |
| Offline | Alles läuft ohne Netz: Die App prüft Antworten selbst und gleicht später ab. Fotos, Nachrichten und SOS werden nachgereicht. Mehrere Handys eines Teams sehen denselben Stand. |

### Gegenüber Actionbound und Loquiz

Lykora deckt die üblichen Grundfunktionen solcher Apps ab: Stationen auf der Karte, QR-Codes, Quizfragen, Fotoaufgaben, Teams, Rangliste und Live-Ansicht für die Spielleitung. Dort ist ein Spiel aber meist eine Kette aus Infoseite, Quiz und „Weiter“. Lykora bringt zusätzlich mit:

- **Geschichten statt Formulare**: Szenen in Takten, Figuren, Funk, Kapitel, Fundstücke und ein Finale, in dem die Teile ins Schloss gesetzt werden.
- **Peilen statt Starren aufs Display**: wärmer/kälter in Ton und Vibration, ehrlich bei schlechtem GPS, mit Taschenmodus.
- **Für die Nacht gemacht**: Rotlicht und Bernstein als echte Paletten, große Schrift, Vorlesen, „Finde mich“.
- **Sicherheit, die nie verkleidet wird**: SOS mit Rückfallwegen, Lebenszeichen, Rückruf, Sperrzonen, Betreuerpflicht, alles in eigener Signatur.
- **Eine Geschichte, mehrere Altersstufen**: Lesefassung für 6–9 ohne zweite App.
- **Selbst gehostet und offen** (AGPL-3.0): Daten bleiben auf dem eigenen Server, keine Lizenzkosten.
- **Konsequent offline**: Auch bei lückenhaftem Netz geht nichts verloren; der Server entscheidet beim Abgleich.

## Klang

Die App spielt alle Klänge aus dem Spielpaket; sie liegen nach dem Packen auf dem Handy und laufen auch ohne Netz. Maßgeblich ist `sound` in [spec/v0.1/game.schema.json](../spec/v0.1/game.schema.json); alle Klang-Werte sind IDs aus `media` mit `type: "audio"`.

### Klänge im Spiel einsetzen

1. Im Dashboard unter „Medien“ des Spiels eigene Aufnahmen hochladen oder Klänge aus der Klangbibliothek übernehmen. Beides landet als Eintrag in `media` mit `src: "media/…"` und `credit` für Urheber und Lizenz.
2. Die ID dort eintragen, wo der Klang spielen soll:

| Stelle | Feld | Was die App macht |
| --- | --- | --- |
| Spiel | `sound.ambience` `{audio, volume}` | Grund-Atmosphäre, solange das Spiel läuft |
| Kapitel | `story.chapters[].ambience` | ersetzt die Grund-Atmosphäre, solange das Kapitel läuft |
| Station | `stations[].sound.ambience` `{audio, volume, from}` | läuft, sobald der Peiler die Station ab Stufe `from` (`mid`, `near`, `here`; Standard `near`) anzeigt, und während ihrer Szene immer |
| Station | `stations[].sound.approach` `{mid, near, here}` | einmal beim Erreichen der Peilstufe, z. B. eine Eule, wenn das Team nah ist |
| Station | `stations[].sound.solved` | beim Lösen statt des eingebauten Erfolgstons |
| Takt | `scene.*[].sfx` | Geräusch, das mit dem Takt einsetzt, zusätzlich zur Stimme in `audio` |
| Spiel | `sound.ui` `{arrival, solved, wrong, chapter, radio, hint, key}` | eigene Aufnahme statt des eingebauten Geräuschs für Ankunft, Erfolg, falsche Antwort, Kapitelkarte, Funkrauschen, Tipp und Schlüssel |

Welche Atmosphäre läuft, entscheidet die App in dieser Reihenfolge: Szene einer Station, angepeilte Station ab ihrer Stufe, laufendes Kapitel, Spiel. Die Stufe kommt vom Peiler mit seiner Hysterese; zeigt das Team Karte oder Liste, peilt die App das nächste Ziel im Hintergrund weiter. Ein Wechsel blendet weich über (2,5 s). Fehlt eine Datei auf dem Handy, gilt die nächste Ebene. `volume` ist der Pegel im Spiel (Standard 0,6); dazu kommt der Regler „Atmosphäre“ in den Einstellungen (Standard 80 %). Spricht eine Stimme (Hörstück eines Takts, Vorlesen, Cue), wird die Atmosphäre leiser und kommt danach wieder hoch. Im Taschenmodus und bei gesperrtem Bildschirm läuft sie weiter. Auf der SOS-Seite und bei einem Sicherheitsalarm schweigt sie; danach setzt sie wieder ein. Während eines Rückrufs bleibt sie aus, auch wenn das Team ihn schon bestätigt hat.

Der Schalter „Geräusche“ schaltet Atmosphäre, Geräusche und Cues ab; Hörstücke der Geschichte spielen weiter.

### Formate

- **Atmosphäre**: nahtlose Schleifen von 30 bis 60 s als OGG Vorbis, mono, 44,1 oder 48 kHz, etwa 64–96 kbit/s. MP3 eignet sich nicht für Schleifen, weil der Encoder am Anfang und Ende Stille einfügt.
- **Geräusche und Stimmen**: OGG, MP3, M4A/AAC, WAV oder FLAC. Kurz halten: Geräusche 0,3–6 s, Stimmen so lang wie der Text.
- Höchstens 30 MB je Datei; alles zusammen muss beim Packen aufs Handy, also lieber sparsam. Lautheit der Aufnahmen angleichen, damit `volume` vergleichbar bleibt.

### Klangbibliothek

Der Server bringt eine Bibliothek mit (CC0, selbst erzeugt mit `server/tool/sound_library.py`): Atmosphären `wald-nacht`, `wind`, `regen`, `bach`, `lagerfeuer`, `funkrauschen`, `hoehle`, `sturm` und Geräusche `eule`, `donner`, `schritte-laub`, `ast-knackt`, `tuer-knarzt`, `kiste-auf`, `schloss-klick`, `funk-knacken`, `herzschlag`, `glocke`, `wolf-heulen`. Im Spiel verweist `src: "media/lib/<id>.ogg"` darauf; das Beispielspiel [testspiel.json](../spec/v0.1/examples/testspiel.json) nutzt sie.

### Cues

Im Klangpult des Dashboards spielt die Spielleitung Klänge live auf ein Team oder alle ein, wahlweise mit einem Funkspruch. Die App bekommt sie als Nachricht mit `kind: "cue"` und `body` `{audio, src, volume, text}`:

- Der Klang kommt aus dem Spielpaket; ein Bibliotheksklang (`lib:<id>`), der nicht im Spiel steht, wird einmal nachgeladen und liegt danach im Medienordner.
- Die Atmosphäre duckt sich darunter. Ein Funkspruch erscheint als Funk-Hinweis und im Funkprotokoll; ein Cue ohne Text ist nur Klang und taucht dort nicht auf.
- Während eines Sicherheitsalarms bleibt ein Cue still. Cues, die nach einer Funkstille älter als zwei Minuten ankommen, spielen nicht mehr.

Damit Cues und Nachrichten sofort ankommen, hält die App eine WebSocket-Verbindung zu `/api/play/live`. Der Server stupst darüber an, und die App gleicht gleich ab, statt bis zum nächsten Takt (15 s) zu warten. Reißt die Verbindung ab, baut die App sie mit wachsender Pause (2 bis 60 s) neu auf; der Abgleich im Takt läuft ohnehin weiter.

## Bauen und testen

Voraussetzungen: Flutter 3.47 (stable) und für die APK das Android-SDK mit Java 17.

```sh
flutter pub get
flutter analyze
flutter test                         # Engine, Steuerung, Klang, Anstupsen, Bildschirme, Kontraste
flutter build apk --release          # build/app/outputs/flutter-apk/app-release.apk
```

Bildschirmfotos aller wichtigen Seiten (zwei Spielwelten, alle Lichtmodi):

```sh
LYKORA_SCREENSHOTS=build/screenshots flutter test test/screenshots
```

Mit einem laufenden Server prüft `flutter test` zusätzlich das Zusammenspiel:

```sh
LYKORA_TEST_SERVER=http://localhost:3000/lykora LYKORA_TEST_ADMIN=admin@example.org:passwort flutter test
```

Die CI baut bei jedem Push eine APK und lädt die arm64-Variante als Artefakt `lykora-apk-arm64` hoch (7 Tage, soweit das Speicherkontingent des Kontos reicht). Wer auf GitHub unter „Releases“ ein Release mit einem Tag wie `app-v0.1.0` veröffentlicht, bekommt die APKs dort automatisch angehängt. Die APK ist noch mit dem Debug-Schlüssel signiert und nur für Tests gedacht.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `lib/model/` | Lesender Zugriff auf das Spielformat |
| `lib/engine/` | Spiellogik, Gegenstück zu `server/src/engine`; gleiche Testfälle aus `spec/test-vectors/engine.json` |
| `lib/data/` | Server-Anbindung, lokaler Speicher, Spielsteuerung mit Offline-Abgleich |
| `lib/services/` | GPS mit Vordergrunddienst, NFC, Kompass, Klang und Vibration (`fx.dart`), Klanglandschaft mit Atmosphäre und Cues (`soundscape.dart`), Anstupsen über WebSocket (`live.dart`) |
| `lib/ui/design/` | Design-Tokens (Lichtmodi, Spielwelten, Schrift, Bewegung), Bausteine, Sicherheitszeichen |
| `lib/ui/safety/` | Sicherheitsebene, SOS, Notfallinfos |
| `lib/ui/story/` | Takte einer Szene: Funkspruch, Erzähler, Dokument, Dialog, Vorlesemodus |
| `lib/ui/screens/` | Einstieg, Vorbereitung, Briefing, Weg, Station, Belohnung, Funk, Akte |
| `assets/` | Schriften (SIL OFL, vorbereitet mit `tool/fonts.py`) und Klänge (erzeugt mit `tool/sounds.py`) |

## Bekannte Grenzen

- Kartenkacheln werden beim Ansehen zwischengespeichert. Ein gezieltes Vorladen ganzer Gebiete kommt mit eigenen Kacheln vom Server (PMTiles); die öffentlichen OpenStreetMap-Server erlauben das nicht. Spielfeld, Zonen und Stationen sind auch ohne Kacheln sichtbar.
- Hörstücke spielen, wenn das Spielpaket sie mitbringt; sonst liest die Vorlesestimme. Videos, Bluetooth-Beacons und ESP32-Boxen sind noch nicht eingebaut.
- Rückruf und Sperrzone wecken das Handy nur, solange die App läuft; eine Vollbild-Benachrichtigung auf dem Sperrbildschirm folgt.
- Der Kompass braucht einen Magnetsensor; ohne ihn zeigt der Peiler nach Norden ausgerichtet.
- Android-Hersteller wie Samsung oder Xiaomi beenden Apps im Hintergrund trotz Vordergrunddienst manchmal. Die App führt deshalb zur Akku-Einstellung; auf echten Geräten muss das getestet werden.
