# Spielformat

Das Spielformat beschreibt ein Lykora-Spiel vollständig als JSON-Datei. Es ist der gemeinsame Vertrag aller Teile: Die TypeScript-Typen für Server und Web und die Dart-Typen für die App werden aus dem Schema erzeugt.

| Version | Schema | Stand |
| --- | --- | --- |
| 0.1 | [`v0.1/game.schema.json`](v0.1/game.schema.json) | Entwurf für M1 |

Beispiel: [`v0.1/examples/testspiel.json`](v0.1/examples/testspiel.json)

TypeScript-Typen: [`v0.1/game.d.ts`](v0.1/game.d.ts), erzeugt mit `npm run generate -w @lykora/spec`. Nach jeder Schema-Änderung neu erzeugen; die CI prüft das.

## Aufbau

| Feld | Inhalt |
| --- | --- |
| `format` | Name `lykora-game` und Formatversion |
| `meta` | Titel, Sprachen, Altersgruppen, Genre, Grusel-Stufe, Nachtspiel |
| `settings` | Modus, Siegbedingung, Zeit, Teamgröße, Fehlerstrafe, Hinweiskosten, Punkte, Rangliste, Karte |
| `field` | Spielfeldgrenze, Start, Sammelpunkt, Sperrzonen, Rettungs- und Versorgungspunkte |
| `story` | Intro, Outro, Zentrale, Kapitel |
| `fragments` | Code-Fragmente mit Position im Finalcode |
| `items` | Inventar-Gegenstände |
| `stations` | Ort, Sichtbarkeit, gleichwertige Auslöser, Story, Aufgabe, Hinweise, Belohnungen, Requisiten |
| `rules` | Visuelle Blöcke: wenn – dann – sonst |
| `safety` | Notfallinfos, Lebenszeichen, SOS-Rückfall, Betreuerpflicht, Pflicht-Ausrüstung |
| `media` | Bilder, Audio, Video; werden vor dem Spiel geladen |

**Texte** sind entweder ein einfacher String oder ein Objekt mit Übersetzungen je Sprachcode, z. B. `{ "de": "Hallo", "en": "Hello" }`. Die erste Sprache in `meta.languages` ist die Standardsprache.

**Auslöser** einer Station sind gleichwertig: Jeder einzelne aktiviert sie. So bleibt das Spiel spielbar, wenn GPS spinnt (QR- oder NFC-Plan-B, Notfall-Code).

**Aufgabentypen in v0.1:** `text` (tolerante Prüfung), `code` (exakt), `choice`, `photo`, `find_location`. Weitere Typen kommen als neue Varianten dazu, ohne bestehende zu ändern.

**Lösungen liegen im Spiel.** Damit Antworten offline geprüft werden können, enthält die Datei die Lösungen. Die App speichert Spieldaten verschlüsselt, das ist aber kein Schutz gegen gezieltes Auslesen (siehe Konzept).

## Prüfung

`spec/validate.mjs` prüft eine Datei gegen das Schema und zusätzlich, was JSON-Schema nicht ausdrücken kann:

- eindeutige IDs je Liste
- Verweise auf Stationen, Fragmente, Items, Kapitel und Medien existieren
- Fragment-Positionen lückenlos ab 1, höchstens eine Finale-Station
- GPS-Auslöser haben einen Ort
- Warnung bei versteckten Stationen, die nichts freischaltet

```sh
npm run validate -- pfad/zum/spiel.json
```

## Versionierung

Jede Datei nennt ihre Version in `format.version`. Neue Felder mit Standardwert sind eine kleine Version (0.1 → 0.2). Bis 1.0 können sich Felder noch ändern; ab 1.0 gelten inkompatible Änderungen nur mit neuer Hauptversion und Migrationsskript.
