"""Bereitet die Schriften der App vor: feste Schnitte aus variablen Schriften,
Teilmenge auf Latin-1, Latin Extended-A und typografische Zeichen.

Quelle: github.com/google/fonts (SIL Open Font License 1.1).
Andika hat den reservierten Namen „Andika“; die Teilmenge heißt deshalb „Lykora Fibel“ (OFL §3).

Aufruf: python3 tool/fonts.py <Ordner mit den Originaldateien>
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "assets" / "fonts"
UNICODES = "U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+25CF,U+25CB"

# (Ausgabe, Quelle, Achsen für feste Instanz oder None, neuer Familienname oder None)
FONTS = [
    ("AtkinsonNext-Regular.ttf", "AHNext.ttf", {"wght": 400}, None),
    ("AtkinsonNext-SemiBold.ttf", "AHNext.ttf", {"wght": 600}, None),
    ("AtkinsonNext-ExtraBold.ttf", "AHNext.ttf", {"wght": 800}, None),
    ("AtkinsonMono-Medium.ttf", "AHMono.ttf", {"wght": 500}, None),
    ("AtkinsonMono-Bold.ttf", "AHMono.ttf", {"wght": 700}, None),
    ("LykoraFibel-Regular.ttf", "Andika-Regular.ttf", None, "Lykora Fibel"),
    ("LykoraFibel-Bold.ttf", "Andika-Bold.ttf", None, "Lykora Fibel"),
    ("Fraunces-SemiBold.ttf", "Fraunces.ttf", {"wght": 600, "opsz": 72, "SOFT": 50, "WONK": 0}, None),
    ("CourierPrime-Regular.ttf", "CourierPrime-Regular.ttf", None, None),
    ("CourierPrime-Bold.ttf", "CourierPrime-Bold.ttf", None, None),
    ("IMFellEnglishSC-Regular.ttf", "IMFellEnglishSC.ttf", None, None),
    ("ChakraPetch-SemiBold.ttf", "ChakraPetch-SemiBold.ttf", None, None),
    ("BarlowCondensed-SemiBold.ttf", "BarlowCondensed-SemiBold.ttf", None, None),
    ("BarlowCondensed-Bold.ttf", "BarlowCondensed-Bold.ttf", None, None),
]


def rename(font: TTFont, family: str) -> None:
    style = font["name"].getDebugName(2) or "Regular"
    for record in font["name"].names:
        if record.nameID in (1, 16):
            record.string = family
        elif record.nameID == 4:
            record.string = f"{family} {style}"
        elif record.nameID == 6:
            record.string = f"{family.replace(' ', '')}-{style.replace(' ', '')}"
        elif record.nameID == 3:
            record.string = f"Lykora;{family};{style}"


OUT.mkdir(parents=True, exist_ok=True)
for out, src, axes, family in FONTS:
    font = TTFont(SRC / src)
    if axes is not None:
        font = instancer.instantiateVariableFont(font, {k: v for k, v in axes.items() if k in [a.axisTag for a in font["fvar"].axes]})
    options = subset.Options()
    options.layout_features = ["kern", "liga", "calt", "tnum", "lnum", "case", "smcp", "c2sc"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    if family:
        rename(font, family)
    font.save(OUT / out)
    print(f"{out}: {(OUT / out).stat().st_size // 1024} KB")
