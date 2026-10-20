# Lykora

**Lykora** ist eine Open-Source-Plattform für Outdoor-Escape-Spiele und Rallyes, die jeder selbst hosten kann. Der Name kommt von griechisch *lykos* (Wolf).

*Lykora is an open-source, self-hostable platform for outdoor escape games and rallies. English summary below.*

## Leitprinzipien

- **Alles konfigurierbar:** Modus, Siegbedingung, Zeit, Strafen, Hinweise und Sicherheitsregeln pro Spiel, mit sinnvollen Standards.
- **Offline-first:** Jedes Spiel ist offline spielbar; Live-Funktionen laufen, sobald Netz da ist.
- **Sicherheit als Kern:** SOS mit Rückfall für Funklöcher, Lebenszeichen, „Alle zurück“, Sperrzonen und Notfallinfos.
- **Analog und digital gleichwertig:** Requisiten, Darsteller und ESP32-Boxen sind normale Spielelemente.
- **Offen:** AGPL-3.0, Spielformat als dokumentierter Standard.

## Stand

Das Projekt steht am Anfang. Das **Spielformat** ist die gemeinsame Grundlage, der **Server** läuft mit Docker, die **Android-App** ist spielbar.

| Teil | Ort | Stand |
| --- | --- | --- |
| Konzept | [`docs/de/konzept.md`](docs/de/konzept.md) | Version vom 20.10.2026 |
| Spielformat v0.1 | [`spec/`](spec/) | Entwurf |
| Server (TypeScript, PostgreSQL, Docker) | [`server/`](server/) | erste Fassung |
| Web: Editor und Dashboard | – | geplant |
| App (Flutter, Android) | [`app/`](app/) | erste Fassung, Test-APK über die CI |
| ESP32-Boxen (PlatformIO) | – | geplant |

## Entwickeln

Server mit Docker starten:

```sh
cp .env.example .env      # Passwörter und Adresse eintragen
docker compose up -d --build
```

Danach ist die API-Doku unter `http://localhost:3000/lykora/api/docs` erreichbar. Details in [`server/README.md`](server/README.md).

Zum Entwickeln: Node.js 22 und PostgreSQL 16.

```sh
npm install
npm run validate          # Beispielspiele gegen das Schema prüfen
npm run validate -- spiel.json
npm test                  # braucht eine Testdatenbank, siehe server/README.md
```

Beiträge sind willkommen, siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## English summary

Lykora lets organisations build and run outdoor escape games: stations triggered by GPS, QR, NFC, BLE or ESP32 boxes, code fragments leading to a finale, hints, story and a live dashboard for the game master. Games work offline and sync when the network is back. Safety (SOS with SMS/LoRa fallback, heartbeats, recall, restricted zones) is built in. The first real event is a night hike near Hennef, Germany, on 19 October 2027.

The game format is the shared contract between server, web and app and is defined as a JSON Schema in [`spec/`](spec/).

## Lizenz

[AGPL-3.0](LICENSE)
