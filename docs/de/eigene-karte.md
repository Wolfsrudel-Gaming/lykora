# Eigene Karte für ein Spiel

Lykora kann die Karte selbst ausliefern: Der Server hält ein **Kartenpaket** aus echten OpenStreetMap-Kacheln für das Spielgebiet bereit, dazu eine dunkle **Nachtvariante**. Dashboard und App brauchen dann keinen fremden Kartenserver, und das Testspiel läuft sofort auf `riegel-troisdorf.de/lykora`.

## Mitgeliefert

| Paket | Inhalt |
| --- | --- |
| `sieglar` | Tageskarte rund um den DRK Ortsverein Troisdorf (Teutonenstraße 31, Sieglar), 800 m Umkreis, Zoom 14 bis 18 (Zoom 18 nur im inneren Umkreis von 450 m) |
| `sieglar-nacht` | dieselben Kacheln dunkel und blaugrau: Straßen heller, Wasser dunkler, Namen lesbar |

Außerhalb des Pakets gibt es keine Kacheln; das Spielfeld muss also im Umkreis liegen.

## Im Spiel eintragen

Im Spiel (JSON) unter `settings.map.tiles`:

```json
"settings": { "map": { "tiles": "tiles/sieglar/{z}/{x}/{y}.png" } }
```

Für die Nacht: `"tiles": "tiles/sieglar-nacht/{z}/{x}/{y}.png"`.

Im Baukasten steht das Feld in der Expertenansicht unter „Felder ohne Wirkung in der App“ → „Kartenkacheln (Adresse)“. Regeln:

- Die Vorlage enthält `{z}`, `{x}` und `{y}` (sonst gilt OpenStreetMap).
- Ohne `https://` gilt die Adresse relativ zum Server, wie bei Medien (`media/…`). Mit `https://` ist sie vollständig, z. B. `https://riegel-troisdorf.de/lykora/tiles/sieglar/{z}/{x}/{y}.png`.
- Leer heißt: OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`).
- Die Zuschreibung „© OpenStreetMap-Mitwirkende“ bleibt in der Karte sichtbar.

Welche Pakete der Server hat, zeigt `GET /lykora/api/tiles` (ohne Anmeldung).

## Neues Gebiet

Auf einem Rechner mit Internet und Python 3 mit Pillow, im Repo:

```sh
python3 server/tool/map_pack.py --name mein-ort --lat 50.8070781 --lon 7.1337849 --radius 800 --zooms 14-18
```

Das Werkzeug lädt die Kacheln einmalig (höchstens 2 pro Sekunde) und legt `server/map-packs/mein-ort` und `mein-ort-nacht` an. Danach Server neu bauen oder den Ordner auf den Server kopieren. Mehr dazu, auch zu Lizenz (ODbL) und Betrieb, steht im Abschnitt „Eigene Karte“ der `server/README.md`.
