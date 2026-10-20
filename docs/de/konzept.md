# Lykora – Gesamtkonzept

Oct 20, 2026 · @Alexander Riegel · aktualisiert 20.10.2026 mit allen bisher geklärten Entscheidungen

## Kurzfassung und Leitprinzipien

**Lykora** ist eine eigene Open-Source-Plattform für Outdoor-Escape-Spiele und Rallyes, die jeder selbst hosten kann. Der Name kommt von griechisch *lykos* (Wolf): Der Wolf steckt versteckt im Namen und steht für Rudel, Spur und Abenteuer. Anlass ist eine Nachtwanderung rund um Hennef am **19.10.2027**. Die Plattform soll aber von Anfang an auch weitere Spielformen, Übungen und andere Organisationen tragen.

- **Alles konfigurierbar:** Autoren und Spielleitung stellen pro Spiel Modus, Siegbedingung, Zeit, Strafen, Hinweise, Schwierigkeit und Sicherheitsregeln ein. Das System liefert sinnvolle Standards.
- **Offline-first:** Jedes Spiel ist offline spielbar. Live-Funktionen laufen, sobald Netz da ist. Für jede Mechanik ist festgelegt, ob sie offline geht oder den Server braucht.
- **Sicherheit als Kern:** SOS, Lebenszeichen, Rückruf, Sperrzonen und Notfallinfos sind fest eingebaut. SOS hat einen Rückfall für Funklöcher.
- **Entdecken und Abenteuer:** Das ist das Grundgefühl. Kopfrätsel stehen im Vordergrund.
- **Analog und digital gleichwertig:** Requisiten, Darsteller und ESP32-Boxen sind normale Spielelemente.
- **Offen:** AGPL-3.0, Code öffentlich auf GitHub ab Tag 1, Spielformat als dokumentierter Standard.

## Ausgangslage und Ziele

Jens hat nach einem Outdoor-Escape in Siegburg vorgeschlagen, so etwas selbst für eine Nachtwanderung zu bauen. Gekaufte Lösungen wie Loquiz oder Actionbound sind technisch überschaubar und decken DRK-Anforderungen wie Sicherheitsfunktionen und Selbst-Hosting nicht ab.

| Punkt | Festlegung |
| --- | --- |
| Projektname | **Lykora** |
| Ziel Version 1.0 | Nachtwanderung zuverlässig durchführen und allgemeine Plattform, beides gleich wichtig |
| Termin Nachtwanderung | **19.10.2027, fest mit Jens abgestimmt** |
| Pflicht für die Nachtwanderung | Spielkern, Sicherheit, Story und Atmosphäre, ESP32-Boxen |
| Spielmodus der Nachtwanderung | noch offen; die Plattform muss alle Modi können |
| Gelände | Hennef, nachts, **auch abseits der Wege** |
| Mobilfunknetz vor Ort | **lückenhaft** |
| Eventgröße | 5–15 Teams |
| Teamgröße | pro Spiel einstellbar |
| Typisches Spiel | 90–120 Minuten, 8–12 Stationen |
| Altersgruppen | 6–9, 10–13, 14–17 Jahre und Erwachsene, auch gemischt |
| Geräte | eigene Handys, **mindestens ein Android-Gerät pro Team** |
| Sprachen | mehrsprachig vorbereitet, zuerst Deutsch |
| Ausbau | weitere Spielformen, Übungen, andere OVs und KVs, öffentliche Nutzung |
| Betreiber | **Alexander privat**, stellt die Plattform dem DRK zur Verfügung |
| Entwicklung | Alexander mit Claude: Claude schreibt den Code, Alexander testet und baut, 8–15 Stunden pro Woche |
| Zeitbudget bis zum Termin | rund 52 Wochen, also etwa 400–750 Stunden inklusive Testen, Bauen und Spielinhalten |

## Umfang von Version 1.0

Fast alles war als MVP gewünscht. Das Zeitbudget reicht für einen soliden Kern, nicht für alles. Deshalb gibt es eine klare Grenze.

**Pflicht bis zur Nachtwanderung (entschieden)**

- **Spielkern:** Basis-Rätsel, Auslöser per GPS, QR und NFC, Code-Fragmente und Finale, Hinweise, Offline-Karte
- **Sicherheit:** Dashboard mit Live-Karte, SOS mit Rückfall, „Alle zurück“, Sperrzonen, Notfallinfos, Lebenszeichen
- **Story und Atmosphäre:** Story-Stücke an den Stationen, Zentrale per Chat, Audio, Rotlicht-Modus und dunkles Theme
- **ESP32-Boxen:** mindestens eine interaktive Box im echten Einsatz

**Vorschlag: nach 1.0**

- Föderation, zentrale Bibliothek, Kampagnen über mehrere Events
- Live-Co-Editing mehrerer Autoren, Knoten-Editor und Skriptsprache (1.0 hat nur visuelle Blöcke)
- KI-Bilder und KI-Stimmen, Bot-Simulation mehrerer Teams
- Ende-zu-Ende-verschlüsselter Chat
- iOS-App
- Abstimmungen aller Teams und Verzweigungen mit mehreren Enden
- Automatisches Highlight-Video, Gesichter verpixeln

## Spielmechanik

Jedes Spiel ist eine offene Welt: Alle sichtbaren Stationen sind in beliebiger Reihenfolge spielbar, versteckte erscheinen über Bedingungen. Alles hier ist pro Spiel einstellbar.

**Grundregeln**

- Modus: gegeneinander, gegen die Uhr oder kooperativ
- Sieg: als Erstes entkommen, meiste Punkte oder alle Fragmente in der Zeit
- Zeit: global, pro Team ab dessen Start oder ohne Limit; Aufgaben können einen eigenen Countdown haben
- Fehler: nichts, Zeitstrafe, Punktabzug oder kurze Sperre
- Ende: Finale-Station vor Ort, Abschluss in der App, gemeinsames Finale am Treffpunkt, Siegerehrung im Dashboard

**Punkte und Bonus**

- Punkte für Lösen, Schnelligkeit, Kreativität (Fotos/Videos) und Fairplay
- Serien-Bonus, Erster-am-Ort-Bonus, geheime Bonusstationen, Nebenquests
- Abzeichen pro Spiel
- Bei Gleichstand gewinnt, wer weniger Hinweise genutzt hat

**Hinweise und Hilfe**

- Standard: 3 Stufen (Schubs, deutlicher Tipp, fast Lösung), Kosten einstellbar
- Hinweise auf Anfrage des Teams oder von der Spielleitung geschickt
- Joker: ein anderes Team fragen
- Team hängt fest: Meldung an die Spielleitung, Betreuer oder Darsteller hilft vor Ort, Ausweich-Rätsel

**Fortschritt und Logik**

- Escape-Kern: Code-Fragmente tragen ihre Position, die Reihenfolge ist egal; das Finale erscheint, wenn alle Fragmente da sind
- Voll ausgebautes Inventar: Items sammeln, kombinieren, tauschen
- Versteckte Stationen erscheinen bei Annäherung, nach einem Rätsel, durch ein Item oder durch die Spielleitung
- Ereignisse: zeitgesteuert, durch die Spielleitung oder durch Aktionen anderer Teams
- Schwierigkeit: von der Spielleitung gesteuert, Stationen können mehrere Varianten haben
- Zufall: Rätselvarianten pro Team, zufälliger Startpunkt und Reihenfolge, Zufallsereignisse
- Team-Rollen (Navigator, Funker usw.) einstellbar, die App schlägt Rollenwechsel vor

### Offline oder Server: pro Mechanik festgelegt

Das Netz vor Ort ist lückenhaft. Deshalb ist für jede Mechanik festgelegt, ob sie offline läuft oder den Server braucht. Offline erledigte Aktionen werden mit Zeitstempel gespeichert und beim nächsten Netzkontakt synchronisiert. Bei Konflikten entscheidet der Server.

| Mechanik | Läuft | Anmerkung |
| --- | --- | --- |
| Station auslösen (GPS, QR, NFC, BLE) | offline | |
| Antwort prüfen (Code, Text, Multiple Choice) | offline | Lösungen liegen auf dem Gerät, siehe unten |
| Hinweise abrufen | offline | Kosten werden beim Sync verrechnet |
| Fragmente, Inventar, versteckte Stationen eines Teams | offline | |
| Story, Medien, Karte | offline | vorab heruntergeladen |
| Punkte und Zeit des eigenen Teams | offline, Server bestätigt | |
| Rangliste | Server | zeigt den letzten bekannten Stand |
| Erster-am-Ort-Bonus, „nur das erste Team“ | Server | wird bei Funkloch nachträglich entschieden |
| Items tauschen, Sabotage, Bündnisse | Server | nur mit Netz bei beiden Teams |
| Abstimmungen, Ereignisse durch andere Teams | Server | |
| Hinweise und Eingriffe der Spielleitung | Server | kommen an, sobald Netz da ist |
| Foto prüfen durch die Spielleitung | Server | Foto wird nachgeladen |
| SOS | siehe Sicherheit | mehrere Wege |

**Bewusst in Kauf genommen:** Damit Antworten offline geprüft werden können, liegen die Lösungen auf dem Gerät. Die tolerante Freitext-Prüfung verträgt sich nicht mit reinen Hashes. Die Spieldaten werden verschlüsselt gespeichert, aber das ist kein echter Schutz gegen gezieltes Auslesen.

## Story und Atmosphäre

Die Story trägt das Abenteuer und ist Pflicht für die Nachtwanderung. Teams erleben sie stückweise an den Stationen und über eine „Zentrale“, die per Funk oder Chat spricht.

- **Genres:** Krimi/Detektiv, Mystery mit leichtem Grusel, Agenten/Sci-Fi, Rettungseinsatz-Szenario
- **Grusel:** altersabhängig steuerbar
- **Rolle der Teams:** Ermittler oder Rettungsteam, Figuren mit eigener Geschichte; dazu die Spielleitung als Erzähler und optional ein Gegenspieler
- **Einstieg:** Intro-Video oder -Audio, Live-Briefing durch Darsteller, analoger Briefing-Umschlag oder Einsatzalarm aufs Handy
- **Verlauf:** ein Story-Stück an jeder Station, Kapitel bei Meilensteinen, Funk- und Chatmeldungen, Fundstücke vor Ort (Briefe, Akten, Gegenstände)
- **Figuren (NPCs):** in der App ansprechbar mit vorgefertigten Dialogen; die Spielleitung kann live als Figur schreiben oder sprechen
- **Verzweigung:** Entscheidungen wirken auf alle Teams, Abstimmungen aller Teams, mehrere Enden (Vorschlag: nach 1.0)
- **Medien:** Text, Bilder, Audio mit Sprecher, Video
- **Atmosphäre:** Soundscape, ortsgebundene Geräusche, Licht-Effekte an Boxen, Funksprüche der Zentrale

## Aufgaben und Rätseltypen

Kopfrätsel stehen im Vordergrund. Jeder Aufgabentyp ist ein eigenes Modul, neue Typen kommen ohne Umbau des Kerns dazu.

| Gruppe | Aufgabentypen | Meilenstein |
| --- | --- | --- |
| Basis | Code/Zahl/Text, Multiple Choice, Foto/Video, Ort finden (GPS) | M1 |
| Spezial (Nacht/Sinne) | Morse mit Taschenlampe, Geräusch-Rätsel, Sternbild/Himmel, Schritte/Bewegung | M3 |
| Spezial (Team) | Team-Split, Live-Duell, Code-Schnipsel teilen, Sanitäts-Szenario mit Betreuer | M3 |
| Später | Kompass-Peilung, Funkspruch, Zuordnen/Reihenfolge, Audio-Antwort | M5 |

**Antwortprüfung**

- Freitext tolerant (Groß/klein, Leerzeichen, kleine Tippfehler), mehrere richtige Antworten, manuelle Prüfung durch die Spielleitung
- Foto/Video: live durch die Spielleitung, automatisch akzeptiert, nach dem Spiel bewertet oder per Abstimmung der Mitspieler

**Physische Requisiten**

- Zahlenschlösser, UV-Botschaften, Puzzle-Teile, versteckte Gegenstände
- Requisiten sind Teil einer Station (z. B. der Code eines Schlosses) und landen automatisch in der Materialliste

## Stationen, Auslöser und Ortung

Eine Station lässt sich über mehrere gleichwertige Auslöser aktivieren, damit ein spinnendes GPS nie das Spiel stoppt.

| Auslöser | Einsatz | Meilenstein |
| --- | --- | --- |
| GPS-Radius | Standard 20 m, pro Station änderbar; wächst automatisch, wenn das GPS schlechte Genauigkeit meldet | M1 |
| QR-Code | an der Station, auch als Plan B | M1 |
| NFC-Tag | Sticker an der Station, auch als Plan B | M1 |
| BLE-Beacon | einfache Präsenz ohne eigene Logik | M1 |
| Notfall-Code / Spielleitung | Freischalten von Hand | M1 |
| ESP32-Box | interaktive Station: Licht/Sound, Schloss, Display, Ereignis im Spiel | M1 als Demo-Box, M4 komplett |

**Spielfeld**

- Grenze als gezeichnetes Polygon oder Radius um den Startpunkt
- Sperrzonen innerhalb (Straße, Gewässer, Hänge, Gräben) mit Warnung. Weil auch abseits der Wege gespielt wird, sind Sperrzonen besonders wichtig.
- Rettungspunkte und Zufahrten für den Rettungsdienst auf der Karte

**Versteckte Stationen** erscheinen bei Annäherung, nach einem gelösten Rätsel, durch ein Item oder durch die Spielleitung.

## Interaktion zwischen Teams

Teams können sich helfen, handeln und behindern. Was davon aktiv ist, legt jedes Spiel fest. Alle Interaktionen zwischen Teams brauchen Netz (siehe „Offline oder Server“).

- Items handeln und tauschen, Bündnisse schließen
- Wettlauf um Ressourcen, z. B. eine Station, die nur das erste Team lösen kann
- Sabotage, auch bei Kindern möglich (Empfehlung unter Offene Punkte)
- Begegnungen vor Ort: Mini-Duell, Info-Tausch oder gemeinsame Begegnungs-Aufgabe
- Gemeinsames Ziel: ein Finale, das nur alle Teams zusammen lösen
- Joker „anderes Team fragen“

## Nacht-Mechaniken

Die Dunkelheit ist Teil des Spiels, nicht nur Kulisse. Start ist typischerweise in der Dämmerung, damit die Spannung mit der Dunkelheit wächst.

- **Licht:** Taschenlampen-Rätsel, Knicklichter als Marker, Reflektoren finden, UV-Lampe für Geheimes
- **Dunkelheit:** Lampe-aus-Momente, Hör- und Stille-Aufgaben, Sternenhimmel, Nachtsicht- und Rotlicht-Aufgaben
- **App:** Rotlicht-Modus und dunkles Theme
- **Dashboard:** zeigt Sonnenuntergang und Einbruch der Dunkelheit
- **Gelände:** Es wird **auch abseits der Wege** gespielt. Folgen: Sperrzonen, Lampe und Warnweste sind Pflicht, das Spielfeld muss vorab bei Dunkelheit begangen werden, und Stationen abseits brauchen Knicklicht oder Reflektor als Marker.

## Lernziele, Altersgruppen und Inklusion

Lernen passiert im Spiel: Wissen ist oft der Schlüssel zur Lösung.

- **Lernziele:** Erste Hilfe, Orientierung mit Karte und Kompass, Rotkreuz-Wissen (Geschichte, Grundsätze, humanitäres Völkerrecht), Teamarbeit und Kommunikation
- **Prüfung:** im Rätsel versteckt, praktische Aufgabe mit Betreuer, Quiz am Ende
- **Nachbesprechung:** Auswertung mit App-Daten (Replay, Highlights), Feedback-Fragebogen, gemeinsame Story-Auflösung
- **Gemischte Teams:** Erwachsene als Begleiter ohne Lösungsrecht, gleichberechtigt oder mit Aufgaben je Alter im selben Team
- **Lesehilfe:** Vorlesen mit Bildsymbolen, reiner Audio-Modus, einfache Sprache als Variante
- **Barrierefreiheit:** große Schrift und Kontrast, farbenblind-taugliche Farben
- **Inklusion:** Rollstuhl- und Kinderwagen-Route, visuelle Alarme für Gehörlose, Audio-Führung für Sehbehinderte, mehrsprachige Teams

## Spieler-App

Die Android-App ist das Werkzeug der Teams. Mehrere Handys pro Team laufen optional synchron.

| Bereich | Festlegung |
| --- | --- |
| Plattform | Android; jedes Team braucht mindestens ein Android-Gerät, iOS nach 1.0 |
| Einstieg | QR-Code, Code eintippen, Link oder NFC-Karte; enthält Server und Event, die Server-Adresse ist nicht fest einprogrammiert |
| Team-Setup | Teamname, Farbe/Wappen, Vornamen, Notfall-Telefonnummer, Material-Checkliste abhaken |
| Darstellung | Rotlicht-Modus, dunkles Theme, große Schrift, Vorlesen |
| Karte | Standard, topografisch, Schatzkarten-Look, eigene Bild-Overlays; eigene Position pro Spiel sichtbar oder nicht |
| Fortschritt | X von Y Stationen, Fragment-Leiste, Story-Tagebuch, Inventar |
| Rangliste | live, nur am Ende oder live mit verdeckten letzten Minuten |
| Kontakt zur Spielleitung | Chat, vordefinierte Nachrichten, Sprachnachrichten/Push-to-Talk |
| Alarm in der Tasche | Vibration, Ton, blinkende Taschenlampe, Smartwatch |
| Offline | offline spielbar nach „Offline oder Server“, Live-Funktionen bei Netz |
| Akku | Hintergrund-GPS bei ausgeschaltetem Bildschirm, Akku-Warnung an die Spielleitung |
| Verteilung | für Tests als APK; Weg ab 2027 noch offen (siehe Offene Punkte) |

**Risiko Hintergrund:** Android beendet Apps im Hintergrund, besonders bei Samsung, Xiaomi und Huawei. Hintergrund-GPS und Lebenszeichen werden deshalb **schon ab M1** auf echten Geräten der Tester geprüft. Die App führt beim Team-Setup durch die nötigen Akku-Einstellungen.

## Spielleitung, Betreuer und Regie

Im Normalfall läuft das Spiel automatisch. Die Spielleitung greift nur bei Bedarf ein und bekommt dabei Vorschläge vom System.

**Dashboard** (Browser, Tablet oder als Modus in der App)

- Live-Karte: Positionen, Laufspuren, Fortschritt pro Team, Box-Status (Akku, ausgelöst), letzter Netzkontakt jedes Teams
- Eingriffe: Punkte, Zeit und Items vergeben, Stationen frei- oder sperren, Hinweise senden, pausieren oder beenden
- Regie: Plot-Twist, Bonusrunde, Teams umleiten, live als Figur schreiben oder sprechen
- Mehrere Spielleiter mit Rollen und Rechten

**Assistent schlägt vor**

- „Team 3 hängt seit 15 Min – Hinweis senden?“
- „Teams ballen sich an Station 5“
- „Team 2 kommt der Sperrzone nahe“
- „Team 4 seit 20 Min ohne Netzkontakt“
- „Zeitplan läuft aus dem Ruder“

**Betreuer und Darsteller**

- Betreuer sehen ihr Team oder ihren Bereich, bestätigen Stationen und bewerten Aufgaben
- Darsteller können Teil des Spiels sein, mit eigener Rolle in der App

**Zuschauer:** Live-Karte für Eltern am Treffpunkt (ohne genaue Positionen) und Beamer-Ansicht mit Rangliste.

**Nach dem Spiel**

- Logbuch aller Ereignisse, live und exportierbar
- Replay der Laufspuren, Ergebnisliste und Statistik, Fotowand, Feedback-Umfrage
- Exporte: Urkunden (PDF), Tabelle (CSV), Fotos (ZIP), Spielbericht (PDF)

## Editor

Spiele entstehen im Web-Editor, in der App (z. B. Stationen vor Ort aufnehmen) oder als Datei für Profis. Alle Wege speichern ins selbe Spielformat.

- **Orte:** auf der Karte klicken, vor Ort per Handy-GPS aufnehmen, Koordinaten eingeben, GPX/KML importieren
- **Logik:** in 1.0 visuelle Blöcke (Wenn – dann – sonst); Knoten-Editor, Formular-Regeln und Skriptsprache für Profis später
- **Testen:** Fake-GPS am Schreibtisch, Testmodus vor Ort, Simulation mehrerer Teams durch Bots (nach 1.0)
- **Zusammenarbeit:** Versionen mit Verlauf und Zurückspringen; mehrere Autoren gleichzeitig nach 1.0
- **Teilen:** Export und Import als Datei, öffentliche Spielbibliothek, Vorlagen auf einen neuen Ort umziehen
- **Medien:** Upload, externe Links, Mediathek pro Organisation; KI-Bilder und Sprecher-Stimmen nach 1.0
- **Warnung:** Stationen außerhalb der Mobilfunk-Abdeckung, ermittelt aus Testlauf-Daten. Für Hennef besonders wichtig, weil das Netz lückenhaft ist.
- **Orga-Ausgabe:** Materialliste direkt aus dem Spiel

## Sicherheit

Sicherheit ist fest eingebaut, die Regeln sind pro Spiel konfigurierbar.

| Funktion | Festlegung |
| --- | --- |
| SOS-Button | Alarm mit Position ans Dashboard, Anruf bei der Spielleitung, Sprachnachricht, lautes Signal am Handy zum Finden im Dunkeln |
| SOS ohne Netz | **SMS als Rückfall**, wenn keine Datenverbindung besteht; **LoRa-Netz** auf dem Gelände; **Nachholen**: SOS wird gespeichert und gesendet, sobald wieder Netz da ist |
| SOS-Empfänger | Dashboard, alle Spielleiter-Handys, zuständiger Betreuer, extern (Telegram, Matrix, SMS) |
| Lebenszeichen | Team bestätigt alle X Minuten; ausbleibende Lebenszeichen lösen eine Warnung im Dashboard aus |
| „Alle zurück“ | Alarm auf allen Handys, Route zum Sammelpunkt, Spiel pausiert, Ankunft wird erfasst |
| Sperrzonen | Warnung mit Ton, Zeitstrafe, Alarm an die Spielleitung |
| Notfallinfos | 112 mit eigener Position, Telefon der Spielleitung, Sammelpunkt, Standort zum Vorlesen; funktionieren immer offline |
| Aufsicht | bei Minderjährigen startet das Spiel erst mit Betreuer |
| Wetter und Abbruch | DWD-Unwetterwarnung im Dashboard, Abbruch mit Grund im Logbuch |
| Spielerisch | Warnweste und Lampe per Foto-Check, Sicherheits-Briefing als erste Station, Punkte für regelkonformes Verhalten |
| Rettung | Rettungspunkte und Zufahrten auf der Karte |

**LoRa:** Für das LoRa-Netz wird zuerst fertige Meshtastic-Hardware geprüft, statt ein eigenes Protokoll zu bauen. Die Knoten können später auch die ESP32-Boxen anbinden. Weil LoRa für die Sicherheit Pflicht ist, gehört es früh in den Plan und nicht erst in M4.

**Grundsatz:** Die App unterstützt die Sicherheit, ist aber nie die einzige Sicherheitsebene. Eine zusätzliche analoge Ebene (Betreuer mit Funkgerät, Notfallkarte pro Team) wird empfohlen und ist noch zu entscheiden.

## Event-Orga

Das System begleitet ein Event von der Planung bis zum Abbau.

- **Start:** Massenstart, gestaffelt, verschiedene Startpunkte oder freier Start im Zeitfenster
- **Anmeldung:** vorab online, am Infostand oder durch die Spielleitung
- **Versorgungspunkte:** konfigurierbar, als Station mit Mini-Aufgabe oder nur auf der Karte
- **Planung:** Checkliste pro Event, Personal- und Schichtplan, Materialliste aus dem Spiel
- **Aufbau und Abbau:** Route mit Checkliste, Foto-Bestätigung „aufgebaut“, Funktionstest jeder Station, Box und jedes LoRa-Knotens, Abbau-Kontrolle
- **Dokumente:** Sicherheits- und Notfallplan, Ablaufplan für Helfer, Stationskarten zum Ausdrucken, Einladung und Elternbrief mit Einwilligung

## Abschluss, Motivation und Wiederspielbarkeit

Ein Event endet mit Belohnung und Rückblick und kann Teil einer längeren Kampagne sein.

- **Belohnungen:** Urkunden, digitale Abzeichen, echte Schatztruhe am Finale, Preise für Plätze
- **Danach:** Story-Epilog in der App, Fotoalbum, Team-Statistik; automatisches Highlight-Video nach 1.0
- **Feedback:** Spieler bewerten Stationen, Spielleiter-Notizen fürs nächste Mal, Statistik der längsten Hänger
- **Wiederspielbar:** Varianten-Pool pro Station, Story-Fortsetzungen, gleiche Story an neuem Ort, höhere Schwierigkeit
- **Kampagnen:** mehrere Events mit bleibendem Fortschritt, z. B. eine Jahres-Kampagne im JRK (nach 1.0)
- **Team-Profile:** pseudonym über Events hinweg (Teamname und Abzeichen)

## Datenschutz und Rollen

Spieler haben kein Konto. Die Daten sind aber **pseudonym, nicht anonym**: Vornamen, eine Notfall-Telefonnummer, Laufspuren von Kindern und Fotos sind personenbezogene Daten. Sie werden sparsam gespeichert und automatisch gelöscht. Wer selbst hostet, ist für seine Daten selbst verantwortlich.

- **Betrieb für die Nachtwanderung:** Alexander betreibt die Plattform privat und verarbeitet die Daten im Auftrag des DRK. Dafür ist ein **Vertrag zur Auftragsverarbeitung** mit dem DRK nötig.
- **Spieler:** kein Konto, Einstieg per Event-Code
- **Positionen:** gespeichert bis X Tage nach dem Event (für das Replay), dann automatisch gelöscht
- **Fotos und Videos:** Einwilligung pro Event, Auto-Löschung, nur die Spielleitung sieht sie; Gesichter verpixeln nach 1.0; alles einstellbar
- **Einwilligungen:** digital vorab per Link, auf Papier mit Haken im Dashboard oder beim Team-Start
- **Verschlüsselung:** HTTPS und verschlüsselte Datenbank, verschlüsselte Offline-Spieldaten. Der Chat ist in 1.0 nicht Ende-zu-Ende-verschlüsselt, damit Logbuch, Export und Betreuer-Zugriff einfach bleiben. **E2E kommt später als Option.**
- **Telemetrie:** nur opt-in und nur an den eigenen Server
- **Orga-Login:** E-Mail und Passwort, 2FA (App, Passkey, YubiKey), SSO per OIDC, Magic Link
- **Rollen:** feste Rollen (Admin, Autor, Spielleiter, Betreuer, Darsteller, Team, Zuschauer) plus eigene definierbar

## Technik-Rahmen

&#91;embedded content: Architektur · Server, App, Web, Boxen, Stationen\] – *Grafik fehlt in dieser Fassung, bitte nachreichen.*

Die App spielt offline und synchronisiert, sobald Netz da ist. Boxen reden per Bluetooth mit dem Handy oder per LoRa/WLAN direkt mit dem Server.

- **Spielformat als Vertrag:** Das JSON-Schema des Spielformats ist die gemeinsame Grundlage aller Teile. Die TypeScript-Typen für Server und Web sowie die Dart-Typen für die App werden daraus erzeugt. Es wird als Erstes gebaut.
- **App:** Flutter, zuerst Android (APK); iOS später ohne Neuschreiben möglich
- **Web:** Dashboard und Editor als Web-App; das Dashboard gibt es zusätzlich als Modus in der App
- **Server:** eigenes Backend mit PostgreSQL in TypeScript, weil Web-Editor und Server dieselben Typen teilen und es für Live-Co-Editing ausgereifte Bausteine gibt
- **Schnittstellen:** REST mit OpenAPI-Doku, WebSocket für Live-Daten, Webhooks, MQTT für Hardware
- **Karten:** selbst gehostet (PMTiles), Region per Klick herunterladen, externer Dienst konfigurierbar
- **Betrieb:** Docker Compose, Installer-Skript, Raspberry-Pi-Image; Caddy für HTTPS; automatische Backups (auch S3/SFTP) mit Ein-Klick-Wiederherstellung; Update-Hinweis mit einem Klick; Status-Seite, Prometheus-Metriken, Warnungen
- **Organisationen:** eine oder mehrere pro Instanz; Föderation für geteilte Spiele, gemeinsame Events und eine zentrale Bibliothek (nach 1.0)
- **ESP32-Boxen:** Chip je Box-Typ (C3 für einfache Signalboxen, S3 für Display und Terminal); Firmware mit PlatformIO und Arduino-Framework, weil Nachbauer damit am leichtesten einsteigen; Strom per 18650, Powerbank, AA oder Solar; Gehäuse 3D-Druck (Dateien offen), IP65, Schatztruhe oder Holz; Einrichtung per Bluetooth-App, WLAN-Oberfläche, QR-Kopplung oder USB
- **LoRa:** Meshtastic-Hardware als erste Wahl für SOS ohne Mobilfunk und für die Anbindung der Boxen

**Testbetrieb**

| Punkt | Festlegung |
| --- | --- |
| Server | Rootserver von Alexander (Details noch offen) |
| Domain | `lykora.riegel-troisdorf.de`; API, Editor, Dashboard und Karten zunächst als Pfade dahinter |
| HTTPS | Caddy mit Let's Encrypt, Ports 80 und 443 offen |
| Später | Umzug auf eine eigene Domain betrifft nur DNS, weil die Server-Adresse im Einstiegs-QR steckt |

## Open Source und Community

Das Projekt ist von Tag 1 öffentlich und offen für Beiträge.

| Punkt | Festlegung |
| --- | --- |
| Name | **Lykora** (griech. *lykos* = Wolf) |
| Logo | Laterne oder Fackel, Wolf optional; ohne Rotkreuz-Zeichen (gesetzlich geschützt), ohne Wolfsangel oder „Werwolf“-Anspielung |
| Lizenz | AGPL-3.0 |
| Code | GitHub `Wolfsrudel-Gaming/lykora`, öffentlich ab Tag 1 |
| Beiträge | offen ab Tag 1 |
| Austausch | GitHub Discussions und Issues |
| Doku | Englisch und Deutsch |
| App-Verteilung | für Tests per APK über GitHub Releases; F-Droid und Play später entscheiden |
| Spielformat | offener Standard mit JSON-Schema und Versionierung |
| Projektorganisation | GitHub Issues mit Projects-Board, geschnitten in Meilensteine |

## Meilensteine und erster Testlauf

&#91;embedded content: Meilensteine M1–M5 · 3 Gates\] – *Inhalt fehlt in dieser Fassung, bitte nachreichen.*

Der erste Testlauf kommt schon nach M1. Die Nachtwanderung findet am 19.10.2027 statt; die Meilensteine werden rückwärts von diesem Termin geplant.

**Bis zum ersten Testlauf**

- [x] Projektname festlegen: Lykora
- [ ] GitHub-Repo `Wolfsrudel-Gaming/lykora` mit AGPL-3.0 anlegen
- [ ] Spielformat v0.1 als JSON-Schema entwerfen
- [ ] Server-Grundgerüst mit Docker Compose auf dem Rootserver unter `lykora.riegel-troisdorf.de`
- [ ] Flutter-App: Einstieg per QR, Offline-Karte, Basis-Aufgaben, GPS/QR/NFC/BLE
- [ ] Hintergrund-GPS und Lebenszeichen auf echten Geräten der Tester prüfen
- [ ] Web-Editor (Basis) und Dashboard mit Live-Karte und SOS
- [ ] SOS-Rückfall per SMS
- [ ] ESP32-Demo-Box: Licht plus teamgebundener Code per Bluetooth
- [ ] Erste Meshtastic-Knoten beschaffen und Reichweite testen
- [ ] Testspiel mit 3–5 Stationen bauen und spielen

**Testorte:** Garten und Straße zu Hause, DRK-Zentrum Troisdorf, Gelände Hennef (auch Netzabdeckung messen), Simulation am Rechner.

**Tester:** JRK, Bereitschaft, Jens und Orga-Team, Freunde und Familie.

## Entscheidungen vom 20.10.2026

| Frage | Entscheidung |
| --- | --- |
| Projektname | Lykora |
| Termin | 19.10.2027, fest |
| Pflicht für die Nachtwanderung | Spielkern, Sicherheit, Story und Atmosphäre, ESP32-Boxen |
| Spielmodus der Nachtwanderung | offen |
| Netz in Hennef | lückenhaft |
| SOS ohne Netz | SMS als Rückfall, LoRa-Netz, Nachholen bei Netz |
| Gelände | auch abseits der Wege |
| Repo | neues Repo `Wolfsrudel-Gaming/lykora` |
| Betreiber | Alexander privat |
| Chat-Verschlüsselung | HTTPS und verschlüsselte Datenbank; E2E später als Option |
| App-Verteilung | später entscheiden, für Tests APK |
| iOS | mindestens ein Android-Gerät pro Team |
| Offline oder Server | pro Mechanik festgelegt |
| Domain für den Test | `lykora.riegel-troisdorf.de` |

## Offene Punkte und ehrliche Hinweise

Der Umfang ist groß. Bei 8–15 Stunden pro Woche bleiben bis zum Termin etwa 400–750 Stunden. Das reicht für den Pflichtumfang, wenn alles unter „nach 1.0“ konsequent wartet. Der erste Testlauf trägt nur den Kern aus M1.

**Noch zu entscheiden**

- [ ] **Analoge Sicherheitsebene:** Betreuer mit Funkgerät und Notfallkarte pro Team. Dringend empfohlen, weil SMS und Nachholen bei lückenhaftem Netz abseits der Wege versagen können und LoRa erst gebaut und getestet werden muss.
- [ ] Spielmodus der Nachtwanderung: Wettbewerb, gegen die Uhr oder kooperativ
- [ ] App-Verteilung ab 2027: Ohne Google Play braucht die Installation auf zertifizierten Geräten einen bei Google verifizierten Entwickler; die Zukunft von F-Droid ist dabei offen. Entweder als Privatperson verifizieren oder Play zusätzlich nutzen.
- [ ] Elternbrief und Einwilligungen vom DRK-Datenschutz prüfen lassen, zusammen mit dem Vertrag zur Auftragsverarbeitung
- [ ] Repo `Wolfsrudel-Gaming/lykora` anlegen und der Claude GitHub App Zugriff geben
- [ ] Name Lykora absichern: Domain (`lykora.de`, `lykora.org`), GitHub-Name, Marke bei DPMA und EUIPO (Klassen 9 und 41)
- [ ] Rootserver: Anbieter, CPU und RAM, Betriebssystem, was dort schon läuft; DNS-Eintrag für `lykora.riegel-troisdorf.de`
- [ ] Meilensteine M1–M5 mit Gates und Architektur-Grafik nachreichen
- [ ] Bedeutung von „R30“ klären

**Empfehlungen zu einzelnen Entscheidungen**

- **Spieler-App beim ersten Test:** In R30 nicht angehakt, hier als selbstverständlich gesetzt.
- **Spiellogik im Editor:** Vier Bauweisen sind gewünscht. Visuelle Blöcke zuerst bauen, die anderen später; alle speichern ins selbe Spielformat.
- **Sabotage bei Kindern:** erlaubt. Nachts trotzdem keine Effekte, die den Bildschirm sperren, Teams zum Rennen bringen oder Notfallinfos verdecken. Abseits der Wege gilt das umso mehr.
- **Schnelligkeit nachts:** Eine Tempo-Bremse ist nicht gewünscht, Schnelligkeitspunkte sind aber aktiv. Bei Nachtspielen sollten sie standardmäßig aus sein, besonders weil auch abseits der Wege gespielt wird.
- **Straßen- und Gewässer-Warnung im Editor:** nicht gewählt. Als abschaltbare Standard-Warnung trotzdem sinnvoll, weil Sperrzonen von Hand leicht vergessen werden.
- **Chat und Logbuch:** Ohne E2E landen Chats lesbar im Logbuch und im Export. Kommt E2E später als Option, gilt: verschlüsselte Chats landen nur verschlüsselt im Logbuch, die Spielleitung muss sie für den Export selbst entschlüsseln.
- **iPhones:** Jedes Team braucht mindestens ein Android-Gerät, bis es eine iOS-App gibt.
- **LoRa:** fertige Meshtastic-Hardware statt eigenem Protokoll.
