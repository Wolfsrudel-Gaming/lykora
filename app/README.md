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
| Funk | Funkprotokoll statt Chat-Blasen; Funktasten „Verstanden“, „Wir brauchen einen Tipp“, „Uns ist mulmig“, „Station kaputt?“; Live-Meldungen der Spielleitung; Störung im Äther ohne Netz |
| Akte | Schlüsselbund, Fundstücke (auch Dokumente aus Szenen), Personen (Unbekannte als Schatten), Chronik zum Nachhören; Name je Spielwelt, z. B. „Einsatzprotokoll“ oder „Tagebuch der Nacht“ |
| Sicherheit | Eigene Ebene über allen Seiten mit Absperrband, ISO-Zeichen und dem Wort ECHT, das die Geschichte nie benutzt: feste Leiste mit SOS; Stufe B als Streifen (Sperrzone in der Nähe, Lebenszeichen, Nachricht der Spielleitung, SOS wartet); Stufe A als Vollbild (Rückruf mit Pfeil und „Wir sind unterwegs“, mitten in der Sperrzone). SOS 3 s halten, ehrlicher Sendestatus, 112, SMS, „Finde mich“; Notfallinfos mit Standort in Klartext |
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

## Bauen und testen

Voraussetzungen: Flutter 3.47 (stable) und für die APK das Android-SDK mit Java 17.

```sh
flutter pub get
flutter analyze
flutter test                         # Engine, Steuerung, Bildschirme, Kontraste
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
| `lib/services/` | GPS mit Vordergrunddienst, NFC, Kompass, Klang und Vibration |
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
