#!/usr/bin/env python3
"""Erzeugt ein Kartenpaket für Lykora: echte OpenStreetMap-Rasterkacheln eines kleinen Gebiets, die der
Server selbst ausliefert (GET <BASE_PATH>/tiles/<paket>/{z}/{x}/{y}.png). So läuft ein Testspiel sofort und
im Feld auch ohne Verbindung zu fremden Kartenservern. Dazu entsteht eine Nachtvariante "<name>-nacht":
dunkel, blaugrau, Straßen heller, Wasser dunkler, Beschriftung gut lesbar.

Ablauf: Das Werkzeug holt die nötigen Kacheln von tile.openstreetmap.org (höflich: Kennung im User-Agent,
höchstens 2 Anfragen je Sekunde, Wiederholung mit wachsender Pause, vorhandene Kacheln werden übersprungen),
schreibt <out>/<name>/{z}/{x}/{y}.png, <out>/<name>-nacht/{z}/{x}/{y}.png und je Paket eine pack.json.

Aufruf (aus dem Repo-Wurzelordner):
    python3 server/tool/map_pack.py --name sieglar --lat 50.8070781 --lon 7.1337849 \\
        --radius 800 --zooms 14-18 --title "DRK Troisdorf, Sieglar"

Wichtige Optionen:
    --radius M          Umkreis in Metern; es werden alle Kacheln erzeugt, die den Kreis berühren (Standard 800)
    --zooms A-B         Zoomstufen, z. B. 14-18 (Standard 14-18)
    --zoom-radius Z=M   engerer Umkreis für eine Stufe, wiederholbar. Standard: 18=450. Die höchste Stufe
                        braucht die meisten Kacheln (ca. 4x je Stufe); ein engerer Umkreis hält das Paket klein.
                        Außerhalb davon zoomt der Client die Kacheln der Stufe darunter hoch (maxNativeZoom).
    --out ORDNER        Zielordner (Standard server/map-packs)
    --cache ORDNER      Zwischenspeicher der Originalkacheln {z}/{x}/{y}.png (Standard ~/.cache/lykora/osm-tiles);
                        bereits geladene Kacheln werden nicht erneut abgerufen
    --title TEXT        Anzeigename in pack.json (Standard: der Name)
    --delay S           Pause zwischen zwei Abrufen in Sekunden (Standard 0.6, mindestens 0.5)
    --no-night          keine Nachtvariante
    --dry-run           nur zählen, nichts laden oder schreiben

Hinweise zur Lizenz und zur Nutzung:
  * Kartendaten (c) OpenStreetMap-Mitwirkende, ODbL 1.0. Die Zuschreibung "(c) OpenStreetMap-Mitwirkende"
    muss in jeder Karte sichtbar bleiben (steht in pack.json, Dashboard und App zeigen sie an).
  * Die Kacheln stammen vom Standard-Kachelserver des OSM-Projekts. Dessen Nutzungsbedingungen
    (https://operations.osmfoundation.org/policies/tiles/) erlauben kein Massenabrufen. Dieses Werkzeug ist für
    EIN kleines Gebiet gedacht (einige hundert Kacheln, einmalig). Wer Lykora produktiv betreibt oder größere
    Gebiete braucht, nimmt einen eigenen Kachelserver oder einen Anbieter mit passenden Bedingungen und lässt das
    Paket damit neu erzeugen (--tile-url).

Braucht Python 3 und Pillow (PIL), sonst nichts.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps

USER_AGENT = "lykora-dev/0.1 (maltevonweinfels@googlemail.com)"
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
ATTRIBUTION = "© OpenStreetMap-Mitwirkende"
LICENSE = "ODbL-1.0"
TILE = 256
MIN_DELAY = 0.5  # höchstens 2 Anfragen je Sekunde
RETRIES = 5
NAME_RE = r"^[a-z0-9-]{1,40}$"

ROOT = Path(__file__).resolve().parent.parent  # server/


# --- Geometrie --------------------------------------------------------------------------------------

def tile_pos(lat, lon, z):
    """Kachelkoordinate (mit Nachkommastellen) eines Punkts in Web-Mercator."""
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def whole(x):
    return int(x) if float(x).is_integer() else x


def metres_per_tile(lat, z):
    return 40075016.686 * math.cos(math.radians(lat)) / 2 ** z


def tiles_for(lat, lon, radius, z):
    """Alle Kacheln der Stufe z, die den Kreis um (lat, lon) berühren."""
    fx, fy = tile_pos(lat, lon, z)
    r = radius / metres_per_tile(lat, z)  # Radius in Kacheln
    out = []
    for x in range(int(math.floor(fx - r)), int(math.floor(fx + r)) + 1):
        for y in range(int(math.floor(fy - r)), int(math.floor(fy + r)) + 1):
            nx = min(max(fx, x), x + 1)
            ny = min(max(fy, y), y + 1)
            if math.hypot(nx - fx, ny - fy) <= r:
                out.append((z, x, y))
    return out


def parse_zooms(text):
    a, _, b = text.partition("-")
    lo, hi = int(a), int(b or a)
    if not 0 <= lo <= hi <= 19:
        raise argparse.ArgumentTypeError("Zoomstufen müssen 0 <= A <= B <= 19 sein")
    return list(range(lo, hi + 1))


def parse_zoom_radius(items):
    out = {}
    for item in items:
        z, _, m = item.partition("=")
        out[int(z)] = float(m)
    return out


# --- Abruf ------------------------------------------------------------------------------------------

class Fetcher:
    def __init__(self, cache, url, delay):
        self.cache, self.url, self.delay = Path(cache), url, max(delay, MIN_DELAY)
        self.last = 0.0
        self.loaded = 0

    def path(self, z, x, y):
        return self.cache / str(z) / str(x) / f"{y}.png"

    def get(self, z, x, y):
        p = self.path(z, x, y)
        if p.exists() and p.stat().st_size > 0:
            return p
        p.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(self.url.format(z=z, x=x, y=y), headers={"User-Agent": USER_AGENT})
        for attempt in range(RETRIES):
            wait = self.last + self.delay - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                if not data.startswith(b"\x89PNG"):
                    raise ValueError("keine PNG-Antwort")
                tmp = p.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(p)
                self.loaded += 1
                return p
            except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
                # 4xx außer 429 (Zu viele Anfragen) bringt Wiederholen nichts
                if isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500 and e.code != 429:
                    raise SystemExit(f"Abruf {z}/{x}/{y} abgelehnt: HTTP {e.code}")
                pause = 2 ** (attempt + 1)
                print(f"  Abruf {z}/{x}/{y} fehlgeschlagen ({e}); neuer Versuch in {pause} s", file=sys.stderr)
                time.sleep(pause)
        raise SystemExit(f"Abruf {z}/{x}/{y} nach {RETRIES} Versuchen aufgegeben")


# --- Nachtvariante ----------------------------------------------------------------------------------

def _curve(points):
    """Stückweise lineare Kennlinie 0..255 -> 0..255 aus Stützpunkten (Eingang, Ausgang)."""
    table = []
    for i in range(256):
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            if x0 <= i <= x1:
                table.append(round(y0 + (y1 - y0) * (i - x0) / (x1 - x0)))
                break
    return table


# Helligkeit der Vorlage -> Helligkeit der Nacht. Nicht monoton, mit Absicht: Beschriftung und Linien
# (dunkel in der Vorlage) werden hell, Gelände (hell) wird dunkel, Straßenfüllung (weiß) wird heller als
# das Gelände, Gebäude und Gehwege liegen dazwischen.
LUMA_CURVE = _curve([
    (0, 240), (60, 215), (120, 150), (170, 80), (195, 54), (215, 42), (230, 34), (240, 30), (246, 40), (250, 100), (255, 112),
])
# Dieselbe Kennlinie für den dunkelsten Farbkanal: farbige Beschriftung (blau, violett) soll so hell werden wie schwarze.
TEXT_CURVE = _curve([(0, 245), (110, 232), (165, 205), (185, 150), (200, 60), (215, 0), (255, 0)])


def night(img):
    """Dunkle, blaugraue Kachel: Straßen heller, Wasser dunkler, Beschriftung hell."""
    src = img.convert("RGB")
    luma = src.convert("L")
    r, g, b = src.split()
    v = luma.point(LUMA_CURVE)
    # Dunkle, aber farbige Pixel (Beschriftung) nach dem dunkelsten Kanal aufhellen; Gewicht 1 bis Helligkeit 120, 0 ab 215
    darkest = ImageChops.darker(ImageChops.darker(r, g), b).point(TEXT_CURVE)
    weight = luma.point(lambda i: 255 if i <= 120 else (0 if i >= 215 else round(255 * (215 - i) / 95)))
    v = ImageChops.lighter(v, ImageChops.multiply(darkest, weight))
    # Gelbe und orange Straßen sind in der Vorlage so hell wie das Gelände, rosa Autobahnen mittelhell:
    # nach Farbton und Sättigung anheben, damit sie sich vom Untergrund lösen
    h, s, val = src.convert("HSV").split()
    sat = s.point(lambda i: 255 if i > 40 else 0)
    bright = val.point(lambda i: 255 if i > 200 else 0)
    warm = ImageChops.multiply(ImageChops.multiply(h.point(lambda i: 255 if 14 <= i <= 50 else 0), sat), bright)
    pink = ImageChops.multiply(ImageChops.multiply(h.point(lambda i: 255 if i >= 232 or i <= 6 else 0), s.point(lambda i: 255 if i > 45 else 0)),
                               val.point(lambda i: 255 if i > 180 else 0))
    v = ImageChops.lighter(v, warm.point(lambda i: round(i * 100 / 255)))
    v = ImageChops.lighter(v, pink.point(lambda i: round(i * 120 / 255)))
    # Farbe der Vorlage gedämpft behalten (Grün bleibt grünlich), dazu eine blaugraue Farbleiter über die Helligkeit
    tinted = Image.merge("HSV", (h, s.point(lambda i: int(i * 0.55)), v)).convert("RGB")
    base = ImageOps.colorize(v, black=(8, 13, 24), mid=(52, 70, 98), white=(226, 236, 246))
    out = Image.blend(base, tinted, 0.35)
    # Wasser (deutlich mehr Blau als Rot) noch dunkler und satter blau
    water = ImageChops.subtract(b, r).point(lambda i: 255 if i > 28 else 0).filter(ImageFilter.GaussianBlur(0.6))
    deep = ImageOps.colorize(v, black=(4, 9, 20), mid=(16, 36, 64), white=(90, 130, 170))
    return Image.composite(deep, out, water)


def save_png(img, path, colors=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if colors and img.mode != "P":
        img = img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    img.save(path, "PNG", optimize=True)


# --- Paket schreiben --------------------------------------------------------------------------------

def write_pack_json(folder, meta):
    (folder / "pack.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Erzeugt ein Lykora-Kartenpaket aus OSM-Rasterkacheln.")
    ap.add_argument("--name", required=True, help="Paketname, nur a-z, 0-9 und Bindestrich (z. B. sieglar)")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--radius", type=float, default=800, help="Umkreis in Metern (Standard 800)")
    ap.add_argument("--zooms", type=parse_zooms, default=parse_zooms("14-18"))
    ap.add_argument("--zoom-radius", action="append", default=None, metavar="Z=M",
                    help="engerer Umkreis für eine Stufe (Standard 18=450), wiederholbar")
    ap.add_argument("--out", default=str(ROOT / "map-packs"))
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "lykora" / "osm-tiles"))
    ap.add_argument("--title", default=None)
    ap.add_argument("--tile-url", default=TILE_URL, help="eigener Kachelserver mit {z}/{x}/{y}")
    ap.add_argument("--delay", type=float, default=0.6)
    ap.add_argument("--no-night", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    import re
    if not re.match(NAME_RE, args.name) or args.name.endswith("-nacht"):
        ap.error("--name muss ^[a-z0-9-]{1,40}$ entsprechen und darf nicht auf -nacht enden")
    zoom_radius = parse_zoom_radius(args.zoom_radius if args.zoom_radius is not None else ["18=450"])

    plan = []
    for z in args.zooms:
        radius = min(args.radius, zoom_radius.get(z, args.radius))
        plan += tiles_for(args.lat, args.lon, radius, z)
    per_zoom = {z: sum(1 for t in plan if t[0] == z) for z in args.zooms}
    print(f"{len(plan)} Kacheln: " + ", ".join(f"z{z}: {n}" for z, n in per_zoom.items()))
    if args.dry_run:
        return

    fetcher = Fetcher(args.cache, args.tile_url, args.delay)
    out = Path(args.out)
    day_dir, night_dir = out / args.name, out / f"{args.name}-nacht"
    sizes = {"day": 0, "night": 0}
    for i, (z, x, y) in enumerate(plan, 1):
        src = fetcher.get(z, x, y)
        with Image.open(src) as im:
            im.load()
            day = day_dir / str(z) / str(x) / f"{y}.png"
            save_png(im.convert("P") if im.mode != "P" else im, day)
            sizes["day"] += day.stat().st_size
            if not args.no_night:
                dst = night_dir / str(z) / str(x) / f"{y}.png"
                save_png(night(im), dst, colors=64)
                sizes["night"] += dst.stat().st_size
        if i % 25 == 0 or i == len(plan):
            print(f"  {i}/{len(plan)} (neu geladen: {fetcher.loaded})")

    # Umschließendes Rechteck des Umkreises: West, Süd, Ost, Nord
    dlat = args.radius / 111320
    dlon = args.radius / (111320 * math.cos(math.radians(args.lat)))
    bounds = [args.lon - dlon, args.lat - dlat, args.lon + dlon, args.lat + dlat]
    title = args.title or args.name
    base = {
        "center": {"lat": args.lat, "lon": args.lon},
        "radiusM": whole(args.radius),
        "zooms": args.zooms,
        "minZoom": args.zooms[0],
        "maxZoom": args.zooms[-1],
        "zoomRadiusM": {str(z): whole(r) for z, r in sorted(zoom_radius.items()) if z in args.zooms},
        "bounds": [round(c, 6) for c in bounds],
        "attribution": ATTRIBUTION,
        "license": LICENSE,
        "source": "tile.openstreetmap.org" if args.tile_url == TILE_URL else args.tile_url,
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tileCount": len(plan),
    }
    write_pack_json(day_dir, {"name": args.name, "title": title, **base, "sizeBytes": sizes["day"]})
    if not args.no_night:
        write_pack_json(night_dir, {"name": f"{args.name}-nacht", "title": f"{title} (Nacht)", "variantOf": args.name,
                                     **base, "sizeBytes": sizes["night"]})
    total = sizes["day"] + sizes["night"]
    print(f"Fertig: Tag {sizes['day'] / 1e6:.2f} MB, Nacht {sizes['night'] / 1e6:.2f} MB, zusammen {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
