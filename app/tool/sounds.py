"""Erzeugt die Klänge der App rechnerisch, ohne fremde Aufnahmen (eigene Werke, frei nutzbar).

Aufruf: python3 tool/sounds.py
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / "assets" / "sounds"
random.seed(4711)


def save(name, samples, gain=0.8):
    peak = max(1e-9, max(abs(s) for s in samples))
    data = b"".join(struct.pack("<h", int(max(-1, min(1, s / peak * gain)) * 32767)) for s in samples)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)
    print(f"{name}.wav {len(data) // 1024} KB")


def env(t, attack, decay):
    return min(1.0, t / attack) * math.exp(-t / decay) if attack > 0 else math.exp(-t / decay)


def tone(freq, dur, attack=0.005, decay=0.3, harmonics=((1, 1.0),)):
    n = int(dur * RATE)
    return [sum(a * math.sin(2 * math.pi * freq * h * i / RATE) for h, a in harmonics) * env(i / RATE, attack, decay) for i in range(n)]


def mix(*tracks):
    n = max(len(t) for t in tracks)
    return [sum(t[i] for t in tracks if i < len(t)) for i in range(n)]


def delay(track, seconds):
    return [0.0] * int(seconds * RATE) + track


def bandnoise(dur, lo, hi, decay=None):
    """Rauschen durch einen einfachen Bandpass (zwei Einpol-Filter)."""
    n = int(dur * RATE)
    a_lo = math.exp(-2 * math.pi * lo / RATE)
    a_hi = math.exp(-2 * math.pi * hi / RATE)
    lp = hp_in = hp = 0.0
    out = []
    for i in range(n):
        x = random.uniform(-1, 1)
        lp = (1 - a_hi) * x + a_hi * lp  # Tiefpass bei hi
        hp = a_lo * (hp + lp - hp_in)  # Hochpass bei lo
        hp_in = lp
        e = math.exp(-(i / RATE) / decay) if decay else 1.0
        out.append(hp * e)
    return out


OUT.mkdir(parents=True, exist_ok=True)

# Holzklick beim Tippen
save("click", mix(bandnoise(0.03, 900, 3500, decay=0.006), tone(1800, 0.03, decay=0.008)), 0.5)
# Rastklick am Zahlenrad
save("tick", mix(bandnoise(0.02, 2500, 6000, decay=0.003), tone(3200, 0.02, decay=0.004)), 0.45)
# Funk: Rauschtaste an und aus
save("squelch_on", mix(bandnoise(0.16, 300, 3000, decay=0.08), delay(tone(1450, 0.06, decay=0.03), 0.0)), 0.55)
save("squelch_off", mix(bandnoise(0.22, 300, 3000, decay=0.12), delay(tone(1150, 0.05, decay=0.02), 0.17)), 0.5)
# Peilton: sanftes Sonar
save("pulse", tone(660, 0.9, attack=0.01, decay=0.25, harmonics=((1, 1.0), (2, 0.25), (3, 0.08))), 0.5)
# Ankunft: zwei weiche Töne aufwärts
save("arrival", mix(tone(587, 0.8, decay=0.3, harmonics=((1, 1), (2, 0.3))), delay(tone(880, 0.9, decay=0.35, harmonics=((1, 1), (2, 0.3))), 0.16)), 0.6)
# Gelöst: Glocke mit Obertönen, Dreiklang
bell = ((1, 1.0), (2.01, 0.45), (3.0, 0.25), (4.2, 0.12))
save("solved", mix(tone(523, 1.6, decay=0.6, harmonics=bell), delay(tone(659, 1.5, decay=0.6, harmonics=bell), 0.12), delay(tone(784, 1.4, decay=0.7, harmonics=bell), 0.24)), 0.6)
# Siegel: dumpfer Schlag plus kurzer Glanz
save("seal", mix(tone(90, 0.35, decay=0.08, harmonics=((1, 1), (2, 0.5))), bandnoise(0.12, 100, 900, decay=0.03), delay(tone(1568, 0.6, decay=0.2), 0.05)), 0.7)
# Falsch: Schloss rasselt
rattle = []
for k in range(4):
    rattle = mix(rattle, delay(mix(bandnoise(0.05, 1800, 7000, decay=0.012), tone(2400 + 300 * k, 0.05, decay=0.01)), k * 0.07))
save("rattle", rattle, 0.5)
# Fragment fällt in den Schlüsselbund
save("key", mix(tone(2093, 0.4, decay=0.12, harmonics=((1, 1), (2.7, 0.4))), delay(tone(2637, 0.4, decay=0.12, harmonics=((1, 1), (2.7, 0.4))), 0.07)), 0.5)
# Kapitelkarte: tiefer, langer Ton
save("chapter", mix(tone(110, 2.4, attack=0.4, decay=1.2, harmonics=((1, 1), (2, 0.5), (3, 0.2))), tone(165, 2.4, attack=0.6, decay=1.2, harmonics=((1, 0.6),))), 0.6)
# Sicherheit (reserviert): neutraler Zweiklang 880/660 Hz, zweimal
two = []
for k in range(2):
    two = mix(two, delay(tone(880, 0.35, attack=0.01, decay=1.0), k * 0.8), delay(tone(660, 0.35, attack=0.01, decay=1.0), k * 0.8 + 0.4))
save("safety", two, 0.8)
