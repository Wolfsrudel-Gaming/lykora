# Klangbibliothek

Mitgelieferte Klänge für Lykora-Spiele, öffentlich unter `<PUBLIC_URL>/media/lib/<id>.ogg`, Liste unter
`GET <PUBLIC_URL>/api/library/sounds`. Alle Klänge sind rechnerisch erzeugt (Synthese, gefiltertes Rauschen,
Modulation, Faltung mit selbst erzeugten Nachhall-Impulsantworten), ohne fremde Aufnahmen.

Format: OGG Vorbis, mono, 48 kHz, etwa 80 kbit/s. Atmosphären laufen in nahtloser Schleife und liegen bei
etwa -26 LUFS, Geräusche bei etwa -18 LUFS (sehr kurze, harte Klänge etwas leiser), True Peak unter -1 dBTP.

## Klänge

| ID | Titel | Art | Länge |
| --- | --- | --- | --- |
| `wald-nacht` | Wald bei Nacht | Atmosphäre (Schleife) | 60 s |
| `wind` | Wind in den Bäumen | Atmosphäre (Schleife) | 48 s |
| `regen` | Regen | Atmosphäre (Schleife) | 40 s |
| `bach` | Bach | Atmosphäre (Schleife) | 40 s |
| `lagerfeuer` | Lagerfeuer | Atmosphäre (Schleife) | 48 s |
| `funkrauschen` | Funkrauschen | Atmosphäre (Schleife) | 32 s |
| `hoehle` | Höhle mit Tropfen | Atmosphäre (Schleife) | 60 s |
| `sturm` | Sturm mit Regen und Donner | Atmosphäre (Schleife) | 60 s |
| `eule` | Waldkauz ruft | Geräusch | 6 s |
| `donner` | Donnerschlag | Geräusch | 6 s |
| `schritte-laub` | Schritte im Laub | Geräusch | 2,8 s |
| `ast-knackt` | Ast knackt | Geräusch | 1,5 s |
| `tuer-knarzt` | Tür knarzt | Geräusch | 3,2 s |
| `kiste-auf` | Holzkiste öffnet sich | Geräusch | 2,2 s |
| `schloss-klick` | Schloss klickt | Geräusch | 0,8 s |
| `funk-knacken` | Funkgerät knackt | Geräusch | 1,2 s |
| `herzschlag` | Herzschlag | Geräusch | 4 s |
| `glocke` | Glockenschlag | Geräusch | 6 s |
| `wolf-heulen` | Wolf heult | Geräusch | 6 s |

## Lizenz

Die Klangdateien (`*.ogg`) sind gemeinfrei: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.de).
Sie dürfen ohne Nennung und ohne Rückfrage verwendet, verändert und weitergegeben werden. Ein Vermerk im Spiel
ist trotzdem nett und hilft anderen Autoren:

```json
{ "id": "wind", "type": "audio", "src": "media/lib/wind.ogg", "credit": { "de": "Lykora-Klangbibliothek, CC0" } }
```

Die Spielleitung spielt Bibliotheksklänge im Klangpult als `lib:<id>` ein, auch wenn das Spiel sie nicht in
`media` führt.

## Neu erzeugen

Das Werkzeug `server/tool/sound_library.py` erzeugt alle Dateien dieses Ordners, auch `library.json` und
diese Beschreibung. Feste Seeds: gleiche Versionen von numpy, scipy und ffmpeg ergeben gleiche Dateien.

```sh
python3 -m pip install numpy scipy        # ffmpeg mit libvorbis muss installiert sein
python3 server/tool/sound_library.py      # alle Klänge
python3 server/tool/sound_library.py eule wind   # nur einzelne
```

## Eigene Klänge für Autoren

Eigene Aufnahmen klingen fast immer lebendiger als die Bibliothek. Das Dashboard nimmt MP3, OGG, WAV, M4A/AAC,
WebM und FLAC bis 30 MB je Datei an.

**Aufnehmen**

- Ein aktuelles Handy reicht. Eine Rekorder-App, die WAV oder FLAC speichert, ist besser als eine Sprachmemo-App,
  die Lautstärke und Rauschen automatisch „verbessert“.
- Draußen den Wind abschirmen: Windschutz („Fell“), notfalls Körper oder Jacke zwischen Wind und Mikrofon.
- Pegel so wählen, dass die lautesten Stellen deutlich unter Vollaussteuerung bleiben; übersteuerte Aufnahmen
  lassen sich nicht retten.
- Vor und nach dem Geräusch ein paar Sekunden Stille aufnehmen, Handy dabei nicht berühren.
- Stimmen in einem gedämpften Raum (Kleiderschrank, Auto, Sofaecke) mit 20–40 cm Abstand aufnehmen, nicht in
  der gefliesten Küche.

**Bearbeiten** (zum Beispiel mit [Audacity](https://www.audacityteam.org), frei)

- Geräusche: 0,3–6 s, Stille am Anfang knapp abschneiden, am Ende kurz ausblenden.
- Atmosphären: 30–60 s, als Schleife schneiden: an ruhigen Stellen schneiden und Ende und Anfang überblenden,
  damit es am Schleifenpunkt nicht klickt oder springt; keine auffälligen Einzelereignisse, die man beim
  zweiten Durchlauf wiedererkennt.
- Mono reicht; aus dem Handylautsprecher ist Stereo ohnehin kaum zu hören.
- Lautheit angleichen: Atmosphären etwa -26 LUFS, Geräusche und Stimmen etwa -18 LUFS (Audacity: Effekt
  zur Lautheits-Normalisierung in LUFS), Spitzen unter -1 dB.
- Exportieren als OGG Vorbis (Qualität 3–5) oder MP3 mit 96–128 kbit/s. Eine Minute Atmosphäre liegt dann
  bei etwa 0,6–1 MB; das zählt, weil die App alle Klänge vor dem Spiel lädt.

**Freie Aufnahmen aus dem Netz**

- [BigSoundBank](https://bigsoundbank.com): viele Geräusche und Atmosphären, frei nutzbar.
- [Freesound](https://freesound.org): riesige Auswahl; in der Suche nach Lizenz „Creative Commons 0“ filtern.
  Klänge unter CC BY dürfen nur mit Namensnennung verwendet werden.
- [Sonniss GDC Game Audio Bundle](https://sonniss.com/gameaudiogdc): große, frei nutzbare Pakete in
  Studioqualität; nur eingebettet in Spiele verwenden, nicht als Sammlung weitergeben.

Immer die Lizenz des einzelnen Klangs prüfen und Urheber und Lizenz im Spiel als `credit` des Medieneintrags
vermerken, zum Beispiel `"credit": { "de": "Regen auf Laub: Max Muster, freesound.org, CC0" }`.
