# Lykora-App

Spieler-App für Android, gebaut mit Flutter. Ein Handy pro Team reicht; weitere Handys koppeln sich mit dem Gerätecode.

## Was die App kann

| Bereich | Funktionen |
| --- | --- |
| Einstieg | Event-QR mit der App oder der Kamera scannen (`lykora://join?…`), Code eintippen oder Link einfügen; Team anlegen mit Vornamen, Farbe, Notfallnummer; weitere Handys per Gerätecode |
| Vorbereitung | Checkliste für GPS, Akku-Optimierung, NFC und Verbindung; Einsatzbefehl zum Vorlesen; Ausrüstung abhaken; Notfallinfos |
| Spielen | Offene Welt mit Karte und Stationsliste; Stationen öffnen sich per GPS (Radius wächst bei schlechtem GPS), QR, NFC-Tag oder Notfall-Code; versteckte Stationen erscheinen per Regel oder bei Annäherung |
| Aufgaben | Freitext mit Tippfehler-Toleranz, Code, Multiple Choice, Foto, Ort finden, Armband-Aufgabe („alle scannen ihr Armband“) |
| Fortschritt | Code-Fragmente mit Finale, Inventar, Story-Tagebuch, Hinweise in Stufen mit Kosten, Restzeit, Punkte, Rangliste |
| Offline | Alles läuft ohne Netz: Die App prüft Antworten selbst und gleicht später ab. Fotos, Nachrichten und SOS werden nachgereicht. Mehrere Handys eines Teams sehen denselben Stand. |
| Zentrale | Chat mit der Spielleitung, Schnellmeldungen per Knopfdruck, Hinweise und Funksprüche der Zentrale, Vorlesen |
| Sicherheit | SOS (2 s halten) mit Nachholen ohne Netz, SMS-Rückfall, Anruf 112 und Spielleitung, „Finde mich“-Blinken; Lebenszeichen-Abfrage; „Alle zurück“ mit Vibration, Ansage und Sammelpunkt auf der Karte; Warnung bei Sperrzonen und Spielfeldgrenze; Standort zum Vorlesen beim Notruf |
| Nacht | Dunkles Design als Standard, Rotlicht-Modus, große Schrift, Vorlesen |
| NFC-Armbänder | siehe unten |

### Gegenüber Actionbound und Loquiz

Lykora deckt die üblichen Grundfunktionen solcher Apps ab: Stationen auf der Karte, QR-Codes, Quizfragen, Fotoaufgaben, Teams, Rangliste und Live-Ansicht für die Spielleitung. Zusätzlich bringt Lykora mit:

- **Selbst gehostet und offen** (AGPL-3.0): Daten bleiben auf dem eigenen Server, keine Lizenzkosten.
- **Sicherheit fest eingebaut**: SOS mit Rückfallwegen, Lebenszeichen, Rückruf, Sperrzonen, Betreuerpflicht, Vollzähligkeits-Check.
- **Konsequent offline**: Auch bei lückenhaftem Netz geht nichts verloren; der Server entscheidet beim Abgleich.
- **Escape-Mechaniken**: Code-Fragmente, Finale, versteckte Stationen, Regeln mit Wenn–Dann–Sonst, Inventar.
- **NFC-Armbänder** für Teilnehmende und Betreuer.
- **Für Nachtspiele gemacht**: Rotlicht-Modus, Vorlesen, „Finde mich“.

## NFC-Armbänder

Jedes NFC-Armband hat eine feste Kennung (UID). Die App liest sie, rechnet daraus einen Hash, der an das Event gebunden ist, und speichert und sendet nur diesen. Die rohe Kennung verlässt das Handy nicht.

| Wofür | Wie |
| --- | --- |
| **Teammitglieder registrieren** | Beim Team-Setup oder unter Einstellungen → Armbänder: jedes Mitglied hält sein Armband ans Handy. |
| **Vollzähligkeits-Check** | Ist `safety.headcount` im Spiel an, scannen alle vor dem Start, im Ziel und beim Rückruf ihr Armband. Fehlt jemand, sieht die Spielleitung sofort eine Warnung im Dashboard. |
| **Armband-Aufgabe** | Aufgabentyp `wristband`: Alle (oder eine Anzahl) müssen ihr Armband scannen, z. B. wenn alle zusammen an einem Ort sein sollen. |
| **Betreuer-Armband** | Bestätigt, dass ein Betreuer dabei ist, bestätigt Stationen vor Ort (z. B. Sanitäts-Szenario) und gibt ohne Netz den Start frei. |
| **Notfallinfo auf dem Armband** | Einstellungen → „Notfallinfo auf Armband schreiben“: Name des Spiels, 112 und Nummer der Spielleitung. Jedes Handy kann das auslesen. Keine persönlichen Daten. |

**Welche Armbänder gehen?** Lesen klappt praktisch mit allen gängigen Armbändern (NTAG213/215/216, MIFARE Ultralight, MIFARE Classic). Für die Notfallinfo muss das Armband beschreibbar sein (NTAG). Den Typ zeigt zum Beispiel die kostenlose App „NFC Tools“.

**Betreuer-Armbänder registrieren:** Die Kennung mit „NFC Tools“ ablesen (Seriennummer) und in der API-Doku unter `POST /api/events/{id}/tags` mit Rolle `supervisor` oder `staff` eintragen. Im kommenden Dashboard geht das per Klick.

## Bauen und testen

Voraussetzungen: Flutter 3.47 (stable) und für die APK das Android-SDK mit Java 17.

```sh
flutter pub get
flutter analyze
flutter test                         # Engine, Steuerung und Bildschirme
flutter build apk --release          # build/app/outputs/flutter-apk/app-release.apk
```

Mit einem laufenden Server prüft `flutter test` zusätzlich das Zusammenspiel:

```sh
LYKORA_TEST_SERVER=http://localhost:3000/lykora LYKORA_TEST_ADMIN=admin@example.org:passwort flutter test
```

Die CI baut bei jedem Push eine APK und lädt die arm64-Variante als Artefakt `lykora-apk-arm64` hoch (7 Tage, soweit das Speicherkontingent des Kontos reicht). Ein Tag wie `app-v0.1.0` veröffentlicht sie als Vorabversion unter GitHub Releases. Die APK ist noch mit dem Debug-Schlüssel signiert und nur für Tests gedacht.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `lib/model/` | Lesender Zugriff auf das Spielformat |
| `lib/engine/` | Spiellogik, Gegenstück zu `server/src/engine`; gleiche Testfälle aus `spec/test-vectors/engine.json` |
| `lib/data/` | Server-Anbindung, lokaler Speicher, Spielsteuerung mit Offline-Abgleich |
| `lib/services/` | GPS mit Vordergrunddienst, NFC |
| `lib/ui/` | Bildschirme |

## Bekannte Grenzen

- Kartenkacheln werden beim Ansehen zwischengespeichert. Ein gezieltes Vorladen ganzer Gebiete kommt mit eigenen Kacheln vom Server (PMTiles); die öffentlichen OpenStreetMap-Server erlauben das nicht. Spielfeld, Zonen und Stationen sind auch ohne Kacheln sichtbar.
- Audio und Video in Stationen sowie Bluetooth-Beacons und ESP32-Boxen sind noch nicht eingebaut.
- Richtungsangaben zu Stationen sind Himmelsrichtungen; ein Kompass folgt.
- Android-Hersteller wie Samsung oder Xiaomi beenden Apps im Hintergrund trotz Vordergrunddienst manchmal. Die App führt deshalb zur Akku-Einstellung; auf echten Geräten muss das getestet werden.
