"""Erzeugt die mitgelieferte Klangbibliothek des Servers rechnerisch: Synthese, gefiltertes Rauschen,
Modulation und Faltung mit selbst erzeugten Nachhall-Impulsantworten. Keine fremden Aufnahmen;
die Klänge sind eigene Werke und gemeinfrei (CC0 1.0).

Atmosphären entstehen zyklisch (Rauschen über die FFT, Ereignisse modulo Schleifenlänge, Nachhall als
zyklische Faltung): Das Ende geht sample-genau in den Anfang über, ein Überblenden ist nicht nötig.
Jeder Klang hat einen festen Seed aus seiner ID; gleiche Werkzeuge ergeben gleiche Dateien.

Aufruf: python3 server/tool/sound_library.py [id ...]   (ohne IDs: alle)
Braucht numpy, scipy und ffmpeg mit libvorbis.
"""
import json
import subprocess
import sys
import tempfile
import zlib
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
OUT = Path(__file__).resolve().parent.parent / "media-library"
CREDIT = "Lykora-Klangbibliothek, erzeugt mit server/tool/sound_library.py"
LOUDNESS = {"ambience": -26.0, "sfx": -18.0}  # LUFS integriert
CEILING = -1.5  # dBTP vor dem Kodieren; Vorbis legt etwas zu, Ziel bleibt unter -1 dBTP
MAX_LIMIT = 6.0  # dB Begrenzung höchstens; braucht ein Klang mehr, bleibt er leiser als das Ziel
BITRATE = "80k"
N_FFT, HOP = 2048, 512
FR = SR / HOP  # Frames je Sekunde der STFT
WIN = np.sqrt(np.hanning(N_FFT + 1)[:-1])

SOUNDS = []  # (id, Titel, Kategorie, Sekunden, Funktion)


def sound(id, title, category, seconds):
    def register(fn):
        SOUNDS.append((id, title, category, seconds, fn))
        return fn
    return register


# --- Grundbausteine ---------------------------------------------------------------------------------

def at(seconds):
    return int(round(seconds * SR))


def db(x):
    return 10 ** (x / 20)


def rms(x):
    return np.sqrt(np.mean(np.square(x))) + 1e-12


def level(x, dbfs):
    """Setzt den Effektivwert auf dbfs."""
    return x * db(dbfs) / rms(x)


def peak(x, dbfs):
    return x * db(dbfs) / (np.max(np.abs(x)) + 1e-12)


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def add(buf, x, pos, wrap=False):
    """Addiert x ab Sample pos; zyklisch läuft der Überhang in den Anfang."""
    n, pos = len(buf), int(pos)
    if wrap:
        pos %= n
        while len(x):
            k = min(len(x), n - pos)
            buf[pos:pos + k] += x[:k]
            x, pos = x[k:], 0
        return
    if pos < 0:
        x, pos = x[-pos:], 0
    k = min(len(x), n - pos)
    if k > 0:
        buf[pos:pos + k] += x[:k]


def mix(*xs):
    out = np.zeros(max(len(x) for x in xs))
    for x in xs:
        out[:len(x)] += x
    return out


def delay(x, seconds):
    return np.concatenate([np.zeros(at(seconds)), x])


def fit(x, n):
    """Auf n Samples kürzen oder mit Stille auffüllen."""
    return x[:n] if len(x) >= n else np.concatenate([x, np.zeros(n - len(x))])


def freqs(n):
    return np.fft.rfftfreq(n, 1 / SR)


# Betragsgänge für Filter über die FFT (f in Hz, auch als Matrix)
def lp(f, fc, order=2):
    return 1 / np.sqrt(1 + (f / fc) ** (2 * order))


def hp(f, fc, order=2):
    return 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order))


def res(f, fc, q):
    """Resonanz zweiter Ordnung, 1 bei fc."""
    f = np.maximum(f, 1e-3)
    return 1 / np.sqrt(1 + q * q * (f / fc - fc / f) ** 2)


def tilt(f, db_per_octave, ref=1000):
    return (np.maximum(f, 20) / ref) ** (db_per_octave / 6.02)


def shape(x, gain):
    """Filtert zyklisch über die FFT; gain(f) ist der Betragsgang."""
    return np.fft.irfft(np.fft.rfft(x) * gain(freqs(len(x))), len(x))


def band(x, lo=None, hi=None, order=2):
    """Butterworth-Filter für Einzelgeräusche (kausal, nicht zyklisch)."""
    hi = min(hi, 0.45 * SR) if hi else None
    if lo and hi:
        sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    elif lo:
        sos = signal.butter(order, lo, "highpass", fs=SR, output="sos")
    else:
        sos = signal.butter(order, hi, "lowpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def conv(x, k, wrap=False):
    """Faltung; zyklisch läuft der Ausklang in den Anfang, sonst wird er nach len(x) abgeschnitten."""
    if wrap:
        n = len(x)
        return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(k[:n], n), n)
    return signal.fftconvolve(x, k)[:len(x)]


def spectral(x, mask):
    """Zeitveränderliches Filter über die STFT, zyklisch. mask(t, f) liefert die Gewichte als Matrix
    Frames x Frequenzen; t ist die Mitte jedes Frames in Sekunden (Spalte), f die Frequenz (Zeile)."""
    n = len(x)
    frames = n // HOP
    assert frames * HOP == n, "Länge muss ein Vielfaches von HOP sein"
    idx = (np.arange(frames)[:, None] * HOP + np.arange(N_FFT)) % n
    spec = np.fft.rfft(x[idx] * WIN, axis=1)
    spec *= mask((np.arange(frames)[:, None] * HOP + N_FFT / 2) / SR, freqs(N_FFT)[None, :])
    y = np.fft.irfft(spec, N_FFT, axis=1) * WIN
    out = np.zeros(n)
    for j in range(N_FFT // HOP):
        out += np.roll(y[:, j * HOP:(j + 1) * HOP].reshape(-1), j * HOP)
    return out / 2


def spectral_once(x, mask):
    """spectral für Einzelgeräusche: mit Stille aufgefüllt, damit nichts herumläuft."""
    n = len(x)
    m = (n // HOP + 1) * HOP + N_FFT
    return spectral(fit(x, m), mask)[:n]


def drift(rng, n, rate, sr=SR):
    """Glatte Zufallskurve (Mittel 0, Std 1), periodisch über n Werte, Schwankungen bis etwa rate Hz."""
    k = max(1, min(n // 2 - 1, int(round(rate * n / sr))))
    spec = np.zeros(n // 2 + 1, complex)
    spec[1:k + 1] = (rng.standard_normal(k) + 1j * rng.standard_normal(k)) / np.sqrt(np.arange(1, k + 1))
    y = np.fft.irfft(spec, n)
    return y / y.std()


def per_sample(curve, n):
    """Kurve je STFT-Frame (zyklisch) auf Samples umrechnen."""
    return np.interp((np.arange(n) - N_FFT / 2) / HOP, np.arange(len(curve)), curve, period=len(curve))


def loop_phase(f):
    """Phase zur Frequenzkurve f (Hz je Sample), leicht gestaucht, damit sie über die Schleife
    ganze Perioden macht und am Schleifenpunkt nicht springt."""
    total = np.sum(f) / SR
    return 2 * np.pi * np.cumsum(f * (max(1, round(total)) / total)) / SR


def events(rng, rate, n):
    """Zeitpunkte (Samples) eines Poisson-Prozesses; rate in Hz, Zahl oder Kurve je Sample."""
    cum = np.cumsum(np.broadcast_to(rate, (n,))) / SR
    count = rng.poisson(cum[-1])
    return np.sort(np.searchsorted(cum, rng.uniform(0, cum[-1], count)))


def sprinkle(rng, n, pos, amp, kernels, wrap=False):
    """Setzt Kurzklänge an die Positionen pos (Samples) mit Stärke amp; Klang je Ereignis zufällig."""
    pos, amp = np.asarray(pos), np.asarray(amp)
    which = rng.integers(0, len(kernels), len(pos))
    y = np.zeros(n)
    for i, k in enumerate(kernels):
        sel = which == i
        if not sel.any():
            continue
        imp = np.zeros(n)
        if wrap:
            np.add.at(imp, pos[sel] % n, amp[sel])
        else:
            keep = sel & (pos < n)
            np.add.at(imp, pos[keep], amp[keep])
        y += conv(imp, k, wrap)
    return y


def scatter(rng, n, rate, kernels, spread=0.8, wrap=True):
    """Zufällig gestreute Kurzklänge (Poisson), Stärke logarithmisch-normal verteilt, ohne extreme Ausreißer."""
    pos = events(rng, rate, n)
    return sprinkle(rng, n, pos, np.exp(np.clip(rng.normal(0, spread, len(pos)), -2.5 * spread, 2.5 * spread)), kernels, wrap)


# --- Klangquellen ------------------------------------------------------------------------------------

def click(rng, lo, hi, decay, seconds=None):
    """Kurzer Rauschstoß im Band lo..hi, klingt mit decay (s) ab; Spitze 1."""
    n = at(seconds or decay * 8)
    t = np.arange(n) / SR
    x = band(rng.standard_normal(n) * np.exp(-t / decay), lo, hi)
    return x / (np.max(np.abs(x)) + 1e-12)


def modes(rng, freqs_, decays, amps=None, seconds=None):
    """Abklingende Eigenschwingungen eines Körpers (Modalsynthese), Phasen zufällig."""
    freqs_ = np.atleast_1d(np.asarray(freqs_, float))
    decays = np.broadcast_to(np.asarray(decays, float), freqs_.shape)
    amps = np.ones_like(freqs_) if amps is None else np.broadcast_to(np.asarray(amps, float), freqs_.shape)
    n = at(seconds or 6 * decays.max())
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f, d, a in zip(freqs_, decays, amps):
        if f < 0.45 * SR:
            y += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / d)
    return y * (1 - np.exp(-t / 0.0002))


def bubble(rng, f0, tau, rise=0.3):
    """Luftblase im Wasser (Minnaert-Resonanz): Sinus, dessen Tonhöhe beim Aufsteigen steigt."""
    n = at(tau * 6)
    t = np.arange(n) / SR
    phase = 2 * np.pi * f0 * (t + rise * t * t / (2 * tau)) + rng.uniform(-0.3, 0.3)
    return np.sin(phase) * (1 - np.exp(-t / 0.0005)) * np.exp(-t / tau)


def nwave(width):
    """Druckstoß (N-Welle): Überdruck, dann Unterdruck; die Breite bestimmt die Tonhöhe."""
    x = np.linspace(-1, 1, max(8, at(width * 2)))
    return -x * np.exp(-5 * x * x)


def distant(x, cutoff):
    """Entfernung: die Luft schluckt Höhen."""
    return band(x, None, cutoff, 1)


def hall(seed, rt60, seconds, damping, early=(), predelay=0.0):
    """Nachhall-Impulsantwort aus Rauschen, das je Frequenz mit eigener Nachhallzeit abklingt
    (Höhen schneller, damping), plus frühe Reflexionen (Zeit s, Pegel); Energie 1."""
    rng = np.random.default_rng(seed)
    n = int(np.ceil(seconds * SR / HOP)) * HOP

    def mask(t, f):
        rt = rt60 * np.clip((np.maximum(f, 60) / 1000) ** -damping, 0.25, 1.4)
        return 10 ** (-3 * t / rt)

    ir = spectral(rng.standard_normal(n), mask)
    ir *= 1 - np.exp(-np.arange(n) / SR / 0.008)
    ir /= np.sqrt(np.sum(ir ** 2))
    tap = np.hanning(11)
    for time, gain in early:
        add(ir, gain * tap * rng.choice([-1, 1]), at(time))
    ir = np.concatenate([np.zeros(at(predelay)), ir])
    return ir / np.sqrt(np.sum(ir ** 2))


@lru_cache
def forest():
    return hall(11, 1.3, 2.6, 0.45, [(0.009, 0.10), (0.016, 0.08), (0.027, 0.07), (0.041, 0.06), (0.063, 0.05)])


@lru_cache
def chamber():
    return hall(12, 0.55, 1.2, 0.3, [(0.003, 0.14), (0.0055, 0.12), (0.009, 0.1), (0.013, 0.09), (0.018, 0.07)])


@lru_cache
def cavern():
    early = [(0.017, 0.10), (0.029, 0.09), (0.043, 0.09), (0.061, 0.08), (0.083, 0.07), (0.112, 0.06), (0.151, 0.05)]
    return hall(13, 4.2, 7.0, 0.3, early, predelay=0.005)


@lru_cache
def valley():
    return hall(14, 2.4, 4.0, 0.5, [(0.012, 0.06), (0.031, 0.05)], predelay=0.01)


def echo(rng, x, taps):
    """Echo von Waldrand oder Hang: verzögerte, dumpfere und verwischte Kopien
    (Verzögerung s, Pegel dB, Grenzfrequenz Hz); Bäume und Gelände streuen den Schall."""
    y = x.copy()
    for seconds, gain, cutoff in taps:
        m = at(0.4)
        smear = rng.standard_normal(m) * smoothstep(np.arange(m) / SR / 0.03) * np.exp(-np.arange(m) / SR / 0.08)
        add(y, db(gain) * conv(band(x, None, cutoff, 4), smear / np.sqrt(np.sum(smear ** 2))), at(seconds))
    return y


def crunch(rng, seconds, count, lo=900, hi=9000, spread=0.8, texture=0.0):
    """Brechendes trockenes Laub: viele winzige Knacke, dicht am Anfang, dann ausdünnend; texture mischt
    Rauschen dazu, das der Dichte der Knacke folgt (Blätter, die aneinander reiben)."""
    n = at(seconds + 0.02)
    pos = (rng.beta(1.3, 3.0, count) * at(seconds)).astype(int)
    kernels = [click(rng, c / 1.7, c * 1.7, rng.uniform(0.0002, 0.0009), 0.006) for c in np.geomspace(lo * 1.7, hi / 1.7, 8)]
    y = sprinkle(rng, n, pos, np.exp(rng.normal(0, spread, count)), kernels)
    if texture:
        crush = band(rng.standard_normal(n), lo, hi) * uniform_filter1d(np.abs(y), at(0.012))
        y += texture * crush * rms(y) / rms(crush)
    return y


def contour(n, notes):
    """Tonhöhe und Hüllkurve aus Noten: (Beginn s, Dauer s, [(Anteil 0..1, Hz), ...], Anstieg s, Abklingen s)."""
    t = np.arange(n) / SR
    f0 = np.full(n, notes[0][2][0][1], float)
    amp = np.zeros(n)
    for start, dur, points, attack, release in notes:
        i0, i1 = at(start), min(n, at(start + dur))
        tt = t[i0:i1] - start
        f0[i0:i1] = PchipInterpolator([p for p, _ in points], [h for _, h in points])(tt / dur)
        amp[i0:i1] = smoothstep(tt / attack) * smoothstep((dur - tt) / release)
    return f0, amp


def voice(rng, f0, amp, formants, tilt_db=-12.0, breath=0.05, jitter=0.004, shimmer=0.05, air_cutoff=6000):
    """Stimme eines Tiers: Teiltöne von f0, gewichtet mit Formant-Resonanzen (Frequenz, Güte, Pegel;
    die Frequenz darf eine Kurve je Sample sein), dazu Atemrauschen (breath: Anteil, Zahl oder Kurve je
    Sample). Zittern in Tonhöhe und Stärke wie bei echten Stimmen."""
    n = len(f0)
    f0 = f0 * (1 + jitter * drift(rng, n, 30))
    amp = amp * (1 + shimmer * drift(rng, n, 18))
    phase = 2 * np.pi * np.cumsum(f0) / SR

    def envelope(f, mean=False):
        return sum(g * res(f, np.mean(fc) if mean else fc, q) for fc, q, g in formants)

    tone = np.zeros(n)
    for k in range(1, 80):
        fk = k * f0
        if fk.min() > 0.4 * SR:
            break
        tone += envelope(fk) * k ** (tilt_db / 6.02) * (fk < 0.4 * SR) * np.sin(k * phase + rng.uniform(0, 2 * np.pi))
    air = shape(rng.standard_normal(n), lambda f: envelope(f, True) * hp(f, 150, 1) * lp(f, air_cutoff, 2))
    tone, air = tone * amp, air * amp
    return tone + breath * air * rms(tone) / rms(air)


def tawny(rng, female=False):
    """Waldkauz. Männchen um 0,8 kHz, fast reiner Ton: langes „huuh“ (steigt und fällt), gut zwei Sekunden
    Pause, kurzes „hu“, dann „hu-hu-huuuuh“: erst abgesetzte Stöße, dann bebend ausgehalten und sinkend.
    Weibchen: „ke-wick“."""
    if female:
        n = at(0.6)
        f0, amp = contour(n, [
            (0.02, 0.09, [(0, 980), (0.5, 1120), (1, 1060)], 0.012, 0.03),
            (0.15, 0.36, [(0, 1100), (0.25, 1640), (0.6, 1420), (1, 1180)], 0.02, 0.12),
        ])
        return voice(rng, f0, amp, [(1500, 1.2, 1.0), (3100, 2.0, 0.45), (4600, 3.0, 0.12)], -5, 0.28, 0.012, 0.12)
    n = at(5.0)
    last = 3.18
    f0, amp = contour(n, [
        (0.08, 0.62, [(0, 760), (0.3, 868), (0.75, 850), (1, 790)], 0.06, 0.18),
        (2.80, 0.11, [(0, 790), (0.5, 850), (1, 820)], 0.02, 0.05),
        (last, 1.70, [(0, 800), (0.1, 880), (0.55, 866), (1, 772)], 0.03, 0.45),
    ])
    # Beben im letzten Ton: anfangs so tief, dass einzelne Stöße hörbar sind, dann ein Zittern, zum Ende langsamer
    t = np.arange(n) / SR
    on = smoothstep((t - last) / 0.05) * (t < last + 1.7)
    quaver = np.sin(2 * np.pi * np.cumsum(9.5 - 3 * smoothstep((t - last) / 1.4)) / SR)
    depth = 1 - 0.65 * smoothstep((t - last - 0.2) / 0.6)
    amp *= 1 - depth * on * (0.5 + 0.5 * quaver)
    f0 *= 1 + 0.025 * on * quaver
    return voice(rng, f0, amp, [(840, 1.4, 1.0), (1700, 2.5, 0.07), (2600, 3.0, 0.015)], -18, 0.1, 0.003, 0.04, 3000)


def wolf(rng):
    """Wolf: setzt tiefer und hauchig an, gleitet hinauf und hält lange um 450 Hz. Kein gleichmäßiges
    Vibrato wie bei einer Stimme: die Tonhöhe wandert langsam und ändert ein paarmal die Richtung, am Ende
    sinkt sie ab. Das Maul öffnet sich zum gerundeten „uu“ und schließt sich wieder."""
    n = at(5.0)
    t = np.arange(n) / SR
    key = lambda pts: PchipInterpolator([p for p, _ in pts], [v for _, v in pts])(t)
    f0 = key([(0, 290), (0.3, 370), (0.8, 436), (1.6, 462), (2.4, 450), (3.2, 471), (3.9, 458), (4.4, 425), (4.8, 345), (5.0, 320)])
    f0 *= 1 + 0.007 * drift(rng, n, 2.0) * smoothstep((t - 0.5) / 0.5)
    amp = smoothstep(t / 0.3) * (1 - smoothstep((t - 4.3) / 0.65)) * (0.8 + 0.2 * smoothstep((t - 0.3) / 1.4))
    f1 = key([(0, 420), (0.8, 600), (3.8, 640), (4.6, 500), (5.0, 450)])
    f2 = key([(0, 1000), (0.8, 1250), (3.8, 1300), (4.6, 1080), (5.0, 1000)])
    # hauchiger Ansatz: anfangs viel Luft, die Stimme klärt sich nach einer halben Sekunde
    breath = 0.06 + 0.25 * (1 - smoothstep(t / 0.5))
    return voice(rng, f0, amp, [(f1, 2.0, 1.0), (f2, 3.0, 0.25), (2700, 4.0, 0.04)], -12, breath, 0.004, 0.04)


def syllable(rng, carrier, dur=0.017):
    """Eine Silbe der Feldgrille: Ton um carrier, leicht fallend, harter Einsatz."""
    n = at(dur)
    x = np.arange(n) / n
    ph = 2 * np.pi * np.cumsum(carrier * (1 - 0.025 * x)) / SR + rng.uniform(0, 2 * np.pi)
    env = x ** 0.5 * (1 - x) ** 1.2
    s = np.sin(ph) + 0.12 * np.sin(2 * ph + 1.0) + 0.03 * np.sin(3 * ph + 2.0)
    return s * env / env.max()


def cricket(rng, n):
    """Feldgrille: Zirpser aus 3–4 Silben um 4,5 kHz, singt in Phasen mit Pausen; zyklisch über n."""
    y = np.zeros(n)
    carrier = rng.uniform(4300, 5100)
    period = rng.uniform(0.3, 0.48)
    count = int(rng.integers(3, 5))
    kernels = [syllable(rng, carrier * rng.uniform(0.995, 1.005), rng.uniform(0.015, 0.019)) for _ in range(4)]
    t, end = rng.uniform(0, period), n / SR
    singing, switch = rng.random() < 0.8, rng.uniform(3, 20)
    while t < end:
        if t > switch:
            singing = not singing
            switch = t + (rng.uniform(8, 30) if singing else rng.uniform(1.5, 7))
        if singing:
            a = np.exp(rng.normal(0, 0.15))
            for s in range(count):
                w = a * rng.uniform(0.85, 1.0) * (0.7 if s == count - 1 else 1.0)
                add(y, w * kernels[rng.integers(len(kernels))], at(t + s * 0.033 + rng.normal(0, 0.0015)), True)
        t += period * np.exp(rng.normal(0, 0.05))
    return y


def gate_curve(rng, n, on, off, edge=0.15):
    """Zyklische Ein-Aus-Kurve mit weichen Flanken: Phasen von on (min, max) s, Pausen off (min, max) s."""
    rate = 100
    m = int(n / SR * rate)
    gate = np.zeros(m)
    pos = rng.uniform(0, off[1])
    while pos < m / rate:
        length = rng.uniform(*on)
        gate[np.arange(int(pos * rate), int((pos + length) * rate)) % m] = 1
        pos += length + rng.uniform(*off)
    gate = uniform_filter1d(gate, max(1, int(edge * rate)), mode="wrap")
    return np.interp(np.arange(n) * rate / SR, np.arange(m), gate, period=m)


def tree_cricket(rng, n, carrier):
    """Weinhähnchen: weiches, langes Trillern um 2,8 kHz, kurze Pausen."""
    tone = np.sin(loop_phase(carrier * (1 + 0.003 * drift(rng, n, 0.2))))
    pulses = (0.5 - 0.5 * np.cos(loop_phase(np.full(n, rng.uniform(42, 52))))) ** 1.5
    return tone * pulses * gate_curve(rng, n, (2, 6), (0.4, 2.0))


def katydid(rng, n):
    """Grünes Heupferd in der Ferne: helles, schnarrendes „zick-zick“ in langen Reihen."""
    buzz = shape(rng.standard_normal(n), lambda f: res(f, 10500, 2.5))
    zick = mix(np.hanning(at(0.022)), delay(np.hanning(at(0.022)), 0.035))
    gate = np.zeros(n)
    pos = rng.uniform(0, 5)
    while pos < n / SR:
        length, rate = rng.uniform(3, 12), rng.uniform(5, 7)
        for k in range(int(length * rate)):
            add(gate, zick * rng.uniform(0.8, 1.0), at(pos + k / rate), True)
        pos += length + rng.uniform(2, 10)
    return buzz * gate


def foliage(rng, n, gust, strength):
    """Blätterrauschen: helles Rauschen, das flattert, dazu feines Klicken von Blatt an Blatt;
    folgt den Böen gust (0..1 je Sample)."""
    flutter = np.exp(0.45 * drift(rng, n, 6) + 0.2 * drift(rng, n, 25))
    hiss = shape(rng.standard_normal(n), lambda f: hp(f, 700, 2) * lp(f, 11000, 2) * tilt(f, -2))
    kernels = [click(rng, c / 1.5, c * 1.5, rng.uniform(0.0003, 0.001)) for c in np.geomspace(1500, 8000, 8)]
    ticks = scatter(rng, n, 2 + strength * (5 + 600 * gust ** 2), kernels, 0.7)
    return level(hiss * gust ** 1.3 * flutter, -30) + level(ticks, -36)


def windscape(rng, n, strength):
    """Wind: Böen aus gefiltertem Rauschen, bei starken Böen heller; wandernde Resonanzen, wo der Wind
    an Ästen und Kanten pfeift. Gibt Körper, Blätterrauschen und Böenkurve (je Sample) zurück."""
    frames = n // HOP
    gust = 1 / (1 + np.exp(-(0.9 * drift(rng, frames, 0.04, FR) + 0.9 * drift(rng, frames, 0.15, FR)
                             + 0.15 * drift(rng, frames, 1.0, FR) - 0.3 + 1.5 * (strength - 0.6))))
    g = gust[:, None]
    howls = [(base, drift(rng, frames, 0.06, FR)[:, None], drift(rng, frames, 0.1, FR)[:, None]) for base in (330, 520, 790)]

    def mask(t, f):
        cutoff = 300 + 2600 * strength * g ** 1.5
        m = (0.25 + g) ** 1.4 * tilt(f, -3) * hp(f, 70, 2) * lp(f, cutoff, 1.5)
        for base, wander, swell in howls:
            c = base * (1 + 0.6 * strength * g) * 2 ** (0.35 * wander)
            a = strength * g ** 2 * (0.6 + 0.4 * np.tanh(swell))
            m = m + 0.3 * a * np.exp(-0.5 * (np.log2(np.maximum(f, 1) / c) / 0.05) ** 2) * tilt(c, -3)
        return m

    body = spectral(rng.standard_normal(n), mask)
    gs = per_sample(gust, n)
    return body, foliage(rng, n, gs, strength), gs


def leaf_tap(rng):
    """Tropfen auf ein Blatt: kurzer Klick, das Blatt schwingt kurz mit."""
    c = rng.uniform(1500, 6000)
    tap = click(rng, c / 2, c * 2, rng.uniform(0.0003, 0.0012), 0.01)
    return mix(tap, modes(rng, rng.uniform(250, 900, 2), rng.uniform(0.003, 0.008, 2), rng.uniform(0.1, 0.3, 2), 0.02))


def puddle(rng, lo=1400, hi=4200):
    """Tropfen in eine Pfütze: Aufschlag und Luftbläschen („plink“)."""
    hit = click(rng, 800, 9000, rng.uniform(0.0003, 0.001), 0.008)
    return mix(0.5 * hit, delay(bubble(rng, rng.uniform(lo, hi), rng.uniform(0.005, 0.014), rng.uniform(0.1, 0.5)), 0.001))


def rain(rng, n, heavy=1.0):
    """Regen: Rauschbett, Tropfen auf Blättern und in Pfützen, einzelne große Tropfen von Ästen."""
    swell = np.exp(0.18 * drift(rng, n, 0.04))
    bed = shape(rng.standard_normal(n), lambda f: hp(f, 250, 1) * lp(f, 11000, 2) * (0.3 + res(f, 2800, 0.6))) * swell
    leaves = scatter(rng, n, 260 * heavy * swell ** 2, [leaf_tap(rng) for _ in range(12)], 0.75)
    puddles = scatter(rng, n, 30 * heavy * swell ** 2, [puddle(rng) for _ in range(16)], 0.8)
    drips = np.zeros(n)
    for period in (rng.uniform(0.7, 1.1), rng.uniform(1.6, 2.4)):
        f0, t = rng.uniform(700, 1300), rng.uniform(0, period)
        while t < n / SR:
            drop = mix(0.4 * click(rng, 1000, 8000, 0.0005, 0.004),
                       bubble(rng, f0 * np.exp(rng.normal(0, 0.06)), rng.uniform(0.012, 0.025), rng.uniform(0.1, 0.3)))
            add(drips, drop * np.exp(rng.normal(0, 0.3)), at(t), True)
            t += period * np.exp(rng.normal(0, 0.2))
    louder = 3 * np.log2(heavy)
    return level(bed, -30 + louder) + level(leaves, -32 + louder) + level(puddles, -37) + peak(drips, -22)


def thunder(rng, seconds, near):
    """Donner: Knall des nahen Blitzkanals, dann Grollen aus vielen später eintreffenden Stößen,
    die mit der Zeit dumpfer werden (über die längeren Wege schluckt die Luft die Höhen)."""
    n = int(np.ceil(seconds * SR / HOP)) * HOP
    claps = np.zeros(n)
    onset = 0.06 if near else 0.4
    times = [onset + rng.gamma(1.5 if near else 2.4, 0.6 if near else 0.9, 140 if near else 90)]
    # Rollen: Abschnitte des Kanals, deren Schall fast gleichzeitig eintrifft, lassen das Grollen anschwellen
    for _ in range(int(rng.integers(3, 6))):
        center = onset + rng.uniform(0.25, 0.55 * seconds)
        times.append(center + rng.normal(0, 0.2, int(rng.integers(15, 35))))
    times = np.concatenate(times)
    for tt in times[(times > onset) & (times < seconds - 1.2)]:
        width = (0.003 if near else 0.008) + 0.01 * (tt - onset) * rng.uniform(0.5, 1.5)
        a = np.exp(-(tt - onset) / (1.8 if near else 3.0)) * np.exp(rng.normal(0, 0.7))
        add(claps, a * nwave(width), at(tt))
    if near:
        # erster Schlag: harter Knall, gefolgt vom reißenden Krachen des Blitzkanals
        add(claps, 6 * np.max(np.abs(claps)) * nwave(0.03), at(onset + 0.01))
        pos = at(onset) + (rng.gamma(1.2, 0.035, 90) * SR).astype(int)
        amp = np.exp(-(pos / SR - onset) / 0.09) * np.exp(rng.normal(0, 0.6, 90))
        kernels = [click(rng, 250, 9000, rng.uniform(0.0006, 0.004), 0.03) for _ in range(8)]
        crack = sprinkle(rng, n, pos, amp, kernels)
        claps = level(claps, -20) + level(crack, -24)
    # Grollen: jeder Stoß hallt nach, schnell an, langsam ab
    k = np.arange(at(3.0)) / SR
    swell = signal.fftconvolve(np.abs(claps), (1 - np.exp(-k / 0.05)) * np.exp(-k / 0.5))[:n]
    rumble = shape(rng.standard_normal(n), lambda f: hp(f, 25, 2) * lp(f, 140, 2)) * swell / swell.max()
    y = level(claps, -20) + level(rumble, -24)

    def mask(t, f):
        dt = np.maximum(t - onset, 0)
        cutoff = (2600 if near else 900) * np.exp(-dt / 0.35) + (300 if near else 220) * np.exp(-dt / 4) + 70
        return lp(f, cutoff, 2)

    y = spectral_once(y, mask)[:at(seconds)]
    if not near:
        # ferner Donner kommt allmählich aus dem Rauschen
        y *= smoothstep((np.arange(len(y)) / SR - onset) / 3.0)
    return y


def creak(rng, n, rate, force, body, jitter=0.03, shimmer=0.25):
    """Knarzen durch Haftreibung (Stick-Slip): Rutsch-Impulse mit wechselnder Rate (Hz je Sample) und
    Stärke (0..1 je Sample) regen die Eigenschwingungen des Körpers an. jitter streut den Zeitpunkt
    (Anteil der Periode, Zahl oder Kurve je Sample), shimmer die Stärke jedes Impulses."""
    phase = np.cumsum(rate) / SR
    k = np.arange(1, int(phase[-1]))
    spread = np.broadcast_to(jitter, (n,))[np.minimum(np.searchsorted(phase, k), n - 1)]
    pos = np.searchsorted(phase, k + rng.normal(0, 1, len(k)) * spread)
    pos = pos[(pos > 0) & (pos < n)]
    amp = force[pos] * np.exp(rng.normal(0, shimmer, len(pos)))
    imp = np.zeros(n)
    np.add.at(imp, pos, amp)
    return conv(band(imp, None, 7000), body)


def glide(rng, n, points):
    """Weiche Kurve je Sample durch Stützpunkte (Zeit s, (kleinster, größter Wert)), Werte zufällig."""
    times = [p for p, _ in points]
    return PchipInterpolator(times, [rng.uniform(*span) for _, span in points])(np.clip(np.arange(n) / SR, times[0], times[-1]))


# --- Atmosphären --------------------------------------------------------------------------------------

@sound("wald-nacht", "Wald bei Nacht", "ambience", 60)
def wald_nacht(rng, n):
    frames = n // HOP
    gust = per_sample(1 / (1 + np.exp(-(1.4 * drift(rng, frames, 0.03, FR) + 0.5 * drift(rng, frames, 0.2, FR) - 1.0))), n)
    leaves = foliage(rng, n, gust, 0.15)
    air = shape(rng.standard_normal(n), lambda f: hp(f, 30, 2) * lp(f, 220, 2)) * (0.6 + gust)
    # Grillenchor: nahe Tiere deutlich, ferne verschwimmen im Nachhall
    near, far = np.zeros(n), np.zeros(n)
    for dist in (1.0, 1.5, 2.2, 3.0, 4.0, 5.5, 7.0, 9.0):
        song = cricket(rng, n) / dist
        if dist < 2.5:
            near += song
        else:
            far += song
    far = shape(far, lambda f: lp(f, 7000, 1)) * np.exp(0.25 * drift(rng, n, 0.4))
    trill = tree_cricket(rng, n, 2750) + 0.7 * tree_cricket(rng, n, 2980)
    bush = katydid(rng, n)
    # Waldkauz in der Ferne: Männchen zweimal, Weibchen antwortet einmal
    calls = np.zeros(n)
    add(calls, distant(tawny(rng), 4500), at(rng.uniform(6, 12)), True)
    add(calls, 0.6 * distant(tawny(rng, True), 3500), at(rng.uniform(31, 36)), True)
    add(calls, 0.5 * distant(tawny(rng), 3000), at(rng.uniform(46, 50)), True)
    # Rascheln im Unterholz
    rustle = np.zeros(n)
    for _ in range(3):
        add(rustle, rng.uniform(0.4, 1.0) * crunch(rng, rng.uniform(0.3, 0.8), int(rng.integers(20, 50)), 700, 6000),
            at(rng.uniform(0, n / SR)), True)
    near, far, trill, bush = level(near, -31), level(far, -33), level(trill, -42), level(bush, -52)
    calls, rustle = peak(calls, -19), peak(rustle, -27)
    dry = level(leaves, -36) + level(air, -42) + near + 0.4 * far + 0.5 * trill + 0.2 * calls + rustle
    wet = 0.25 * near + far + trill + bush + calls + 0.3 * rustle
    return dry + 0.6 * conv(wet, forest(), True)


@sound("wind", "Wind in den Bäumen", "ambience", 48)
def wind(rng, n):
    body, leaves, _ = windscape(rng, n, 0.6)
    return level(body, -27) + level(leaves, -29)


@sound("regen", "Regen", "ambience", 40)
def regen(rng, n):
    frames = n // HOP
    gust = per_sample(1 / (1 + np.exp(-(1.5 * drift(rng, frames, 0.03, FR) - 1.5))), n)
    y = rain(rng, n) + level(foliage(rng, n, gust, 0.2), -42)
    return y + 0.2 * conv(y, forest(), True)


@sound("bach", "Bach", "ambience", 40)
def bach(rng, n):
    end = n / SR
    bubbles = np.zeros(n)
    # Stellen, an denen Wasser über Steine fällt: je eigene Blasengröße und eigener Rhythmus
    for center, rate, strength, size in ((420, 0.7, 1.3, 1.6), (650, 3.0, 1.0, 1.0), (900, 1.2, 1.1, 1.2),
                                         (1100, 4.5, 0.9, 1.0), (1700, 6.0, 0.7, 0.9), (2600, 5.0, 0.5, 0.8)):
        t = rng.uniform(0, 1 / rate)
        while t < end:
            start = t
            for _ in range(int(rng.integers(2, 12))):
                f0 = center * np.exp(rng.normal(0, 0.25))
                tau = 0.010 * size * (1000 / f0) ** 0.6 * np.exp(rng.normal(0, 0.25))
                b = bubble(rng, f0, tau, rng.uniform(0.05, 0.4)) * strength * np.exp(rng.normal(0, 0.5)) * (f0 / 1000) ** -0.3
                start += rng.gamma(1.5, 0.018)
                add(bubbles, b, at(start), True)
            t += rng.exponential(1 / rate)
    # einzelne Blasen überall
    for p in events(rng, 110.0, n):
        f0 = np.exp(rng.uniform(np.log(450), np.log(4000)))
        add(bubbles, 0.5 * np.exp(rng.normal(0, 0.6)) * bubble(rng, f0, 0.008 * (1000 / f0) ** 0.6, rng.uniform(0.05, 0.4)), p, True)
    rush = shape(rng.standard_normal(n), lambda f: hp(f, 120, 1) * lp(f, 7000, 2) * (0.4 + res(f, 900, 0.5)))
    rush *= 1 + 0.15 * drift(rng, n, 0.3)
    splash = scatter(rng, n, 8.0, [click(rng, 2000, 9000, rng.uniform(0.004, 0.015)) for _ in range(6)], 0.8)
    y = level(bubbles, -27) + level(rush, -31) + level(splash, -40)
    return y + 0.25 * conv(y, forest(), True)


@sound("lagerfeuer", "Lagerfeuer", "ambience", 48)
def lagerfeuer(rng, n):
    end = n / SR
    # Flammen: tiefes, flackerndes Rauschen und leises Lecken
    roar = shape(rng.standard_normal(n), lambda f: lp(f, 280, 2) * hp(f, 50, 2) * tilt(f, -2))
    roar *= np.exp(0.5 * drift(rng, n, 4) + 0.3 * drift(rng, n, 0.3))
    lick = shape(rng.standard_normal(n), lambda f: res(f, 650, 0.8)) * np.exp(0.9 * drift(rng, n, 2.5))
    # Zischen: Gase aus dem Holz
    hiss = shape(rng.standard_normal(n), lambda f: hp(f, 2500, 2) * lp(f, 9000, 2)) * np.maximum(0, drift(rng, n, 6)) ** 2
    # Knistern: Bündel feiner Knacke, mal dichter, mal ruhiger
    activity = np.exp(0.6 * drift(rng, n, 0.15) + 0.4 * drift(rng, n, 1.5))
    kernels = [click(rng, c / 1.8, c * 1.8, rng.uniform(0.00015, 0.0012)) for c in np.geomspace(1200, 9000, 12)]
    crackle = scatter(rng, n, 25 * activity, kernels, 0.6)
    # Knacken: seltene laute Knalle mit Holzresonanz, danach Funkenknistern
    pops = np.zeros(n)
    t = rng.uniform(1, 4)
    while t < end:
        body = modes(rng, rng.uniform(600, 2600, 5), rng.uniform(0.004, 0.02, 5), rng.uniform(0.3, 1, 5))
        add(pops, np.exp(rng.normal(0, 0.4)) * mix(click(rng, 400, 12000, 0.0006, 0.004), 0.4 * body), at(t), True)
        for _ in range(int(rng.integers(3, 10))):
            add(pops, 0.15 * np.exp(rng.normal(0, 0.6)) * kernels[rng.integers(len(kernels))], at(t + rng.gamma(1.2, 0.08)), True)
        t += rng.uniform(2.5, 8)
    # Holz sackt nach: dumpfer Stoß, Knistern, Glut klirrt leise
    for _ in range(2):
        t0 = rng.uniform(0, end)
        add(pops, 0.5 * click(rng, 70, 350, 0.02, 0.15), at(t0), True)
        add(pops, 0.3 * crunch(rng, 0.6, 40, 1500, 9000), at(t0 + 0.02), True)
        for _ in range(8):
            tink = modes(rng, rng.uniform(3000, 7000, 2), rng.uniform(0.003, 0.008, 2), 1, 0.03)
            add(pops, 0.06 * tink, at(t0 + rng.uniform(0.1, 0.9)), True)
    # nasses Holz: Dampf zischt und pfeift kurz
    steam_len = rng.uniform(1.5, 2.5)
    m = at(steam_len)
    tt = np.arange(m) / SR
    steam_env = smoothstep(tt / 0.3) * smoothstep((steam_len - tt) / 0.6) * np.exp(0.5 * drift(rng, m, 15))
    steam = band(rng.standard_normal(m), 3500, 6500) * steam_env
    whistle = np.sin(2 * np.pi * np.cumsum(4300 * (1 + 0.02 * drift(rng, m, 3))) / SR) * steam_env * 0.15
    add(pops, peak(steam + whistle * rms(steam), 0.0) * 0.05, at(rng.uniform(0, end)), True)
    y = level(roar, -32) + level(lick, -39) + level(hiss, -44) + level(crackle, -33) + peak(pops, -21)
    return y + 0.15 * conv(y, forest(), True)


@sound("funkrauschen", "Funkrauschen", "ambience", 32)
def funkrauschen(rng, n):
    frames = n // HOP
    fade = drift(rng, frames, 0.12, FR)[:, None]
    notch = drift(rng, frames, 0.18, FR)[:, None]
    slope = drift(rng, frames, 0.08, FR)[:, None]

    def mask(t, f):
        base = hp(f, 280, 4) * lp(f, 2900, 5) * (1 + 0.4 * res(f, 1500, 1.2))
        center = 1200 * 2 ** (1.2 * np.tanh(notch))
        dip = 1 - 0.5 * np.exp(-0.5 * (np.log2(np.maximum(f, 1) / center) / 0.35) ** 2)
        return base * dip * db(3.5 * fade) * tilt(f, 1.5 * slope)

    hiss = spectral(rng.standard_normal(n), mask)
    # atmosphärische Störungen: einzelne Knacke und kurze Prasselschauer
    ticks = scatter(rng, n, 0.9, [click(rng, 300, 3000, rng.uniform(0.0005, 0.003), 0.02) for _ in range(6)], 0.4)
    crashes = np.zeros(n)
    for p in events(rng, 0.25, n):
        m = at(rng.uniform(0.03, 0.25))
        tt = np.arange(m) / SR
        burst = band(rng.standard_normal(m), 300, 3000) * np.exp(-tt / (m / SR / 3)) * np.exp(0.8 * drift(rng, m, 60))
        add(crashes, burst * np.exp(rng.normal(0, 0.3)), p, True)
    # ferner Überlagerungston, zweimal, schwach und wackelig
    whistles = np.zeros(n)
    for _ in range(2):
        m = at(rng.uniform(3, 6))
        tt = np.arange(m) / SR
        f = rng.uniform(800, 1500) * (1 + 0.15 * (tt / tt[-1] - 0.5) * rng.choice([-1, 1])) * (1 + 0.004 * drift(rng, m, 8))
        env = np.sin(np.pi * tt / tt[-1]) ** 2 * np.exp(0.4 * drift(rng, m, 1.5))
        add(whistles, np.sin(2 * np.pi * np.cumsum(f) / SR) * env, at(rng.uniform(0, n / SR)), True)
    y = level(hiss, -24) + peak(ticks, -3) + peak(crashes, -6) + level(whistles, -46)
    # Empfänger: weiche Sättigung, danach wieder nur das Sprachband
    y = 0.6 * np.tanh(y / 0.6)
    return shape(y, lambda f: hp(f, 250, 3) * lp(f, 3200, 4))


@sound("hoehle", "Höhle mit Tropfen", "ambience", 60)
def hoehle(rng, n):
    end = n / SR
    # Brummen: tiefes Rauschen mit Raumresonanzen, darüber ein leiser Luftton im Gang
    drone = shape(rng.standard_normal(n), lambda f: hp(f, 22, 2) * lp(f, 160, 3) + 0.8 * res(f, 47, 9)
                  + 0.6 * res(f, 71, 11) + 0.35 * res(f, 118, 12) + 0.15 * res(f, 236, 14) + 0.06 * res(f, 352, 16))
    drone *= np.exp(0.3 * drift(rng, n, 0.05))
    air = shape(rng.standard_normal(n), lambda f: hp(f, 150, 2) * lp(f, 1200, 2) * tilt(f, -3)) * np.exp(0.5 * drift(rng, n, 0.03))
    # Tropfen: feste Stellen mit eigenem Takt und eigener Pfütze
    drips = np.zeros(n)
    for period, f0, strength in ((1.9, 1650, 1.0), (3.1, 2250, 0.7), (4.6, 1150, 0.85), (7.3, 2900, 0.5), (11.0, 980, 0.6)):
        t = rng.uniform(0, period)
        while t < end:
            drop = mix(0.3 * click(rng, 1500, 9000, 0.0004, 0.004),
                       bubble(rng, f0 * np.exp(rng.normal(0, 0.04)), 0.018 * np.exp(rng.normal(0, 0.15)), rng.uniform(0.08, 0.25)))
            add(drips, strength * np.exp(rng.normal(0, 0.2)) * drop, at(t), True)
            t += period * np.exp(rng.normal(0, 0.12))
    # Tropfen auf Fels: nur ein heller Tick
    for p in events(rng, 0.35, n):
        tick = mix(click(rng, 2000, 10000, 0.0003, 0.003), 0.3 * modes(rng, rng.uniform(2500, 6000, 2), 0.004, 1, 0.02))
        add(drips, 0.35 * tick * np.exp(rng.normal(0, 0.4)), p, True)
    # ein Steinchen löst sich und springt
    t0, gap = rng.uniform(0, end), 0.16
    for k in range(6):
        stone = mix(click(rng, 1200, 9000, 0.0005, 0.004), 0.4 * modes(rng, rng.uniform(1800, 5000, 3), 0.006, 1, 0.03))
        add(drips, 0.5 * 0.7 ** k * stone, at(t0), True)
        t0, gap = t0 + gap, gap * 0.72
    y = level(drone, -30) + level(air, -44) + 0.18 * peak(drips, -10)
    return y + peak(conv(drips, cavern(), True), -14)


@sound("sturm", "Sturm mit Regen und Donner", "ambience", 60)
def sturm(rng, n):
    body, leaves, gust = windscape(rng, n, 1.0)
    rolls = np.zeros(n)
    for start, seconds, strength in ((rng.uniform(6, 12), 11.0, 1.0), (rng.uniform(36, 42), 9.0, 0.6)):
        add(rolls, strength * thunder(rng, seconds, False), at(start), True)
    # ein Baum knarrt in einer Böe: tiefes Ächzen
    m = at(2.4)
    tt = np.arange(m) / SR
    move = smoothstep(tt / 0.6) * smoothstep((2.4 - tt) / 0.8)
    body_ir = modes(rng, [120, 210, 340, 520, 760, 1050], [0.05, 0.04, 0.035, 0.03, 0.02, 0.015], [1, 0.8, 0.6, 0.4, 0.3, 0.2], 0.3)
    pitch = glide(rng, m, [(0, (30, 40)), (0.7, (55, 75)), (1.5, (45, 60)), (2.4, (35, 45))])
    tree = creak(rng, m, pitch * np.exp(0.05 * drift(rng, m, 3)), move, body_ir)
    creaks = np.zeros(n)
    add(creaks, tree, at(rng.uniform(20, 30)), True)
    y = level(body, -24) + level(leaves, -27) + rain(rng, n, 2.0) + peak(rolls, -2) + peak(creaks, -26)
    return y + 0.25 * conv(y, forest(), True)


# --- Geräusche ----------------------------------------------------------------------------------------

@sound("eule", "Waldkauz ruft", "sfx", 6.0)
def eule(rng, n):
    y = fit(delay(distant(tawny(rng), 7000), 0.05), n)
    return y + 0.3 * conv(y, forest())


@sound("donner", "Donnerschlag", "sfx", 6.0)
def donner(rng, n):
    y = fit(thunder(rng, 6.0, True), n)
    y = echo(rng, y, [(0.62, -9, 900), (1.35, -13, 600), (2.2, -18, 400)])
    return y + 0.5 * conv(y, valley())


@sound("schritte-laub", "Schritte im Laub", "sfx", 2.8)
def schritte_laub(rng, n):
    y = np.zeros(n)
    t = 0.04
    for k in range(4):
        heavy = rng.uniform(0.8, 1.1) * (1.0 if k % 2 else 0.9)
        m = at(0.08)
        tt = np.arange(m) / SR
        # Ferse: dumpfer Stoß in den Waldboden
        add(y, 0.5 * heavy * band(rng.standard_normal(m) * np.exp(-tt / 0.012), 50, 260), at(t + 0.01))
        # Laub bricht unter Ferse und Ballen
        add(y, heavy * crunch(rng, 0.14, int(rng.integers(80, 110)), spread=0.6, texture=0.8), at(t))
        add(y, 0.8 * heavy * crunch(rng, 0.18, int(rng.integers(100, 140)), spread=0.6, texture=0.8), at(t + rng.uniform(0.07, 0.1)))
        # Blätter werden verschoben
        m = at(0.3)
        tt = np.arange(m) / SR
        add(y, 0.12 * heavy * band(rng.standard_normal(m), 600, 5000) * smoothstep(tt / 0.04) * np.exp(-tt / 0.1), at(t + 0.02))
        t += rng.uniform(0.56, 0.64)
    return y + 0.15 * conv(y, forest())


@sound("ast-knackt", "Ast knackt", "sfx", 1.5)
def ast_knackt(rng, n):
    y = np.zeros(n)
    wood = lambda: modes(rng, rng.uniform(500, 3800, 7), rng.uniform(0.002, 0.012, 7), rng.uniform(0.2, 1, 7), 0.08)
    # Fasern spannen sich und reißen vereinzelt
    for k in range(4):
        add(y, 0.06 * (k + 1) * mix(click(rng, 1500, 9000, 0.0003, 0.003), 0.3 * wood()), at(0.06 + 0.045 * k + rng.uniform(0, 0.02)))
    # der Bruch: dichte Folge harter Knacke mit Holzresonanz, dazwischen splitternde Fasern
    t = 0.26
    body = wood()
    m = at(0.12)
    add(y, 0.25 * band(rng.standard_normal(m), 1200, 9000) * np.exp(-np.arange(m) / SR / 0.035), at(t))
    for k in range(int(rng.integers(15, 24))):
        a = np.exp(-k / 7) * np.exp(rng.normal(0, 0.35))
        add(y, a * mix(click(rng, 300, 12000, rng.uniform(0.0002, 0.0008), 0.004), 0.5 * body * rng.uniform(0.6, 1.0)), at(t))
        t += rng.gamma(1.0, 0.006)
    # Splitter danach, Blätter rascheln, ein Stück fällt auf den Boden
    for _ in range(3):
        add(y, 0.15 * mix(click(rng, 1000, 9000, 0.0004, 0.003), 0.3 * wood()), at(t + rng.uniform(0.03, 0.16)))
    add(y, 0.2 * crunch(rng, 0.5, 40), at(t + 0.08))
    m = at(0.1)
    add(y, 0.25 * band(rng.standard_normal(m) * np.exp(-np.arange(m) / SR / 0.015), 80, 900), at(t + 0.45))
    return y + 0.3 * conv(y, forest())


@sound("tuer-knarzt", "Tür knarzt", "sfx", 3.2)
def tuer_knarzt(rng, n):
    t = np.arange(n) / SR
    # die Tür schwingt auf: erst einzelne, unregelmäßige Knacke, dann ein gleitender, klar gestimmter
    # Knarzton mit vielen Obertönen, der schwankt und am Ende wieder absinkt
    move = smoothstep((t - 0.05) / 0.4) * (1 - smoothstep((t - 2.5) / 0.5))
    pitch = glide(rng, n, [(0, (24, 32)), (0.3, (40, 60)), (0.7, (120, 160)), (1.1, (250, 310)), (1.5, (330, 400)),
                           (1.9, (270, 330)), (2.3, (360, 440)), (2.7, (170, 220)), (3.2, (110, 130))])
    rate = pitch * np.exp(0.03 * drift(rng, n, 4))
    force = move * (0.7 + 0.3 * np.tanh(1.5 * drift(rng, n, 2)))
    # Haften und Rutschen wird mit der Geschwindigkeit regelmäßiger: langsam ein Rattern, schnell ein Ton
    jitter = 0.004 + 0.06 * np.exp(-rate / 60)
    # Türblatt: viele dicht liegende, gedämpfte Eigenschwingungen färben den Ton, ohne eigene Töne zu bilden;
    # das Scharnier klingt hell und metallisch
    panel_f = np.geomspace(110, 5000, 30) * np.exp(rng.normal(0, 0.04, 30))
    weight = np.minimum((panel_f / 350) ** 1.5, (panel_f / 350) ** -0.5)
    panel = modes(rng, panel_f, 0.004 * (1000 / panel_f) ** 0.6, weight * rng.uniform(0.5, 1, 30), 0.1)
    hinge = modes(rng, [1350, 2140, 3380, 4710, 6100], [0.01, 0.008, 0.006, 0.005, 0.004], [0.5, 0.4, 0.3, 0.2, 0.1], 0.06)
    y = creak(rng, n, rate, force, mix(panel, 0.15 * hinge), jitter, 0.12)
    return y + 0.3 * conv(y, chamber())


@sound("kiste-auf", "Holzkiste öffnet sich", "sfx", 2.2)
def kiste_auf(rng, n):
    y = np.zeros(n)
    # Riegel springt
    add(y, 0.5 * mix(click(rng, 1500, 9000, 0.0004, 0.004), 0.5 * modes(rng, [2450, 3900, 5600], [0.012, 0.008, 0.005], [1, 0.6, 0.3], 0.05)), at(0.05))
    # Deckel löst sich: Holz klackt
    lid = modes(rng, [160, 290, 460, 720, 1050, 1500], [0.03, 0.025, 0.02, 0.015, 0.012, 0.01], [1, 0.8, 0.6, 0.4, 0.3, 0.2], 0.2)
    add(y, 0.9 * mix(click(rng, 200, 5000, 0.0008, 0.01), lid), at(0.14))
    # Scharniere quietschen beim Aufklappen
    m = at(1.1)
    tt = np.arange(m) / SR
    move = smoothstep(tt / 0.15) * smoothstep((1.1 - tt) / 0.25)
    hinge = modes(rng, [980, 1610, 2380, 3350, 4800], [0.012, 0.009, 0.007, 0.005, 0.004], [1, 0.7, 0.5, 0.3, 0.2], 0.06)
    pitch = glide(rng, m, [(0, (60, 90)), (0.25, (220, 280)), (0.6, (330, 420)), (0.9, (260, 320)), (1.1, (200, 240))])
    add(y, 0.5 * peak(creak(rng, m, pitch * np.exp(0.04 * drift(rng, m, 5)), move, mix(hinge, 0.3 * lid)), 0), at(0.2))
    # Deckel schlägt hinten an und federt einmal nach
    thud = mix(click(rng, 80, 2000, 0.002, 0.02), modes(rng, [95, 180, 310, 520], [0.035, 0.025, 0.02, 0.015], [1, 0.7, 0.5, 0.3], 0.2))
    add(y, peak(thud, 0), at(1.32))
    add(y, 0.3 * peak(thud, 0), at(1.42))
    return y + 0.25 * conv(y, chamber())


@sound("schloss-klick", "Schloss klickt", "sfx", 0.8)
def schloss_klick(rng, n):
    y = np.zeros(n)
    # Schlüssel schabt im Zylinder
    m = at(0.12)
    tt = np.arange(m) / SR
    add(y, 0.1 * band(rng.standard_normal(m), 2500, 8000) * np.sin(np.pi * tt / tt[-1]) * np.exp(0.6 * drift(rng, m, 40)), at(0.03))
    metal = lambda scale: modes(rng, scale * np.array([1870, 3120, 4470, 6230, 8310, 10900]),
                                [0.03, 0.02, 0.014, 0.01, 0.007, 0.005], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.12)
    knock = modes(rng, [520, 840], [0.012, 0.008], [1, 0.5], 0.06)
    # Riegel gibt nach, dann rastet er ein
    add(y, 0.55 * mix(click(rng, 2000, 12000, 0.0003, 0.003), 0.4 * metal(1.0), 0.5 * knock), at(0.16))
    add(y, mix(click(rng, 1500, 12000, 0.0003, 0.003), 0.5 * metal(0.93), 0.8 * knock), at(0.27))
    return y + 0.2 * conv(y, chamber())


@sound("funk-knacken", "Funkgerät knackt", "sfx", 1.2)
def funk_knacken(rng, n):
    t = np.arange(n) / SR
    # Rauschen bei offener Rauschsperre: erst ein Stoß, dann flatternd, mit Knacken darin
    gate = smoothstep((t - 0.03) / 0.01) * (1 - smoothstep((t - 0.84) / 0.02))
    static = rng.standard_normal(n) * gate * (1 + 0.8 * np.exp(-(t - 0.03).clip(0) / 0.05)) * np.exp(0.35 * drift(rng, n, 9))
    ticks = sprinkle(rng, n, (rng.uniform(0.06, 0.8, 9) * SR).astype(int), np.exp(rng.normal(0, 0.5, 9)),
                     [click(rng, 300, 3000, 0.001, 0.01) for _ in range(4)])
    radio = level(static, -18) + peak(ticks, -6)
    # beim Schließen ein kurzer, hellerer Rauschschwanz
    m = at(0.12)
    add(radio, level(rng.standard_normal(m) * np.exp(-np.arange(m) / SR / 0.035), -14), at(0.85))
    # Empfänger: übersteuert weich, der kleine Lautsprecher gibt nur das Sprachband wieder
    y = band(0.5 * np.tanh(radio / 0.5), 300, 3400, 4)
    # Taste: Knack beim Drücken und Loslassen, direkt am Gerät
    add(y, peak(click(rng, 200, 6000, 0.0004, 0.006), -4), at(0.02))
    add(y, peak(click(rng, 200, 6000, 0.0004, 0.006), -7), at(0.97))
    return y


@sound("herzschlag", "Herzschlag", "sfx", 4.0)
def herzschlag(rng, n):
    y = np.zeros(n)

    def thump(f, decay, strength):
        """Dumpfer Schlag: stark gedämpfte Schwingung plus Gewebe-Rauschen, beides mit weichem Einsatz."""
        m = at(0.3)
        tt = np.arange(m) / SR
        env = smoothstep(tt / 0.012) * np.exp(-tt / decay)
        body = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.5 * np.exp(-tt / 0.03))) / SR) * env
        tissue = band(rng.standard_normal(m), 30, 250) * env
        x = body + 0.6 * tissue * rms(body) / rms(tissue)
        # Sättigung: Obertöne, damit der Schlag auch auf kleinen Lautsprechern hörbar ist
        return strength * np.tanh(2 * x / np.max(np.abs(x)))

    # fünf Herzschläge mit 75 pro Minute, je „lub-dub“; der erste Ton hat zwei dicht folgende Anteile
    for k in range(5):
        t0 = 0.06 + 0.8 * k + rng.normal(0, 0.006)
        add(y, thump(46, 0.04, rng.uniform(0.95, 1.0)), at(t0))
        add(y, thump(58, 0.03, rng.uniform(0.5, 0.6)), at(t0 + 0.022))
        add(y, thump(64, 0.03, rng.uniform(0.6, 0.7)), at(t0 + 0.3))
    y = band(y, None, 500, 2)
    return y + level(shape(rng.standard_normal(n), lambda f: lp(f, 300, 2) * hp(f, 30, 2)), -48)


@sound("glocke", "Glockenschlag", "sfx", 6.0)
def glocke(rng, n):
    t = np.arange(n) / SR
    prime = 311.0
    # Teiltöne einer Glocke (Verhältnis zum Schlagton, Pegel, Nachhallzeit s): Unterton, Prime, Terz,
    # Quinte, Oktave und höhere, nicht harmonische Teiltöne
    partials = [(0.5, 0.35, 9.0), (1.0, 0.6, 6.0), (1.19, 0.45, 4.5), (1.51, 0.2, 3.2), (2.0, 0.7, 3.8), (2.51, 0.25, 2.2),
                (2.68, 0.18, 2.0), (3.01, 0.3, 1.8), (4.07, 0.15, 1.1), (5.18, 0.08, 0.8), (6.3, 0.05, 0.55), (7.5, 0.03, 0.4)]
    y = np.zeros(n)
    for ratio, a, t60 in partials:
        f = prime * ratio * (1 + rng.normal(0, 0.002))
        # jeder Teilton ist ein Paar eng benachbarter Schwingungen: die Glocke schwebt
        for side in (-1, 1):
            y += 0.5 * a * np.sin(2 * np.pi * (f + side * rng.uniform(0.2, 0.9)) * t + rng.uniform(0, 2 * np.pi)) * 10 ** (-3 * t / t60)
    y *= 1 - np.exp(-t / 0.0015)
    strike = mix(0.6 * click(rng, 800, 9000, 0.0015, 0.02), 0.3 * modes(rng, prime * np.array([9.3, 11.7, 14.2]), 0.01, 1, 0.06))
    y = fit(delay(mix(y, strike), 0.02), n)
    return y + 0.4 * conv(y, valley())


@sound("wolf-heulen", "Wolf heult", "sfx", 6.0)
def wolf_heulen(rng, n):
    y = fit(delay(distant(wolf(rng), 7000), 0.08), n)
    y = echo(rng, y, [(0.48, -14, 1800), (1.05, -20, 1200)])
    return y + 0.55 * conv(y, valley())


# --- Ausgabe ------------------------------------------------------------------------------------------

def finish(x, category):
    """Gleichanteil weg; bei Geräuschen kurze Blenden am Anfang und Ende."""
    if category == "ambience":
        return shape(x, lambda f: hp(f, 25, 2))
    x = band(x, 25, None)
    k = at(0.003)
    x[:k] *= np.linspace(0, 1, k)
    k = at(0.25)
    x[-k:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k))
    return x


def true_peak(x):
    return np.max(np.abs(signal.resample_poly(x, 4, 1)))


def limit(x, ceiling, wrap):
    """Begrenzt Spitzen (4-fach überabgetastet geschätzt) auf ceiling, mit 3 ms Vorschau und weichem Verlauf."""
    m = at(0.01)
    xx = np.concatenate([x[-m:], x, x[:m]]) if wrap else np.concatenate([np.zeros(m), x, np.zeros(m)])
    over = np.abs(signal.resample_poly(xx, 4, 1)).reshape(-1, 4).max(axis=1)
    need = np.minimum(1, ceiling / np.maximum(over, 1e-12))
    w = 2 * at(0.003) + 1
    return (xx * uniform_filter1d(minimum_filter1d(need, w), w))[m:-m]


def measure(path, raw=False):
    """Lautheit (LUFS integriert) und True Peak (dBTP) mit ffmpeg loudnorm."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats"]
    if raw:
        cmd += ["-f", "f32le", "-ar", str(SR), "-ac", "1"]
    cmd += ["-i", str(path), "-af", "loudnorm=print_format=json", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True, check=True).stderr
    data = json.loads(err[err.rindex("{"):err.rindex("}") + 1])
    return float(data["input_i"]), float(data["input_tp"])


def decoded_length(path):
    """Zahl der Samples, die ein Abspielgerät aus der fertigen Datei dekodiert."""
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-"], capture_output=True, check=True).stdout
    return len(out) // 4


def normalize(x, target, wrap, raw):
    """Bringt x auf die Ziel-Lautheit; Spitzen über CEILING werden begrenzt, höchstens um MAX_LIMIT dB."""
    for _ in range(5):
        x.astype("<f4").tofile(raw)
        loudness, _ = measure(raw, True)
        gain = target - loudness
        if abs(gain) < 0.1:
            break
        x = x * db(gain)
        over = 20 * np.log10(true_peak(x)) - CEILING
        if over > MAX_LIMIT:
            x *= db(MAX_LIMIT - over)
        if over > 0:
            x = limit(x, db(CEILING), wrap)
        if over > MAX_LIMIT:
            break
    x.astype("<f4").tofile(raw)
    return x


def encode(raw, path, title):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", str(raw),
                    "-c:a", "libvorbis", "-b:a", BITRATE, "-fflags", "+bitexact", "-flags:a", "+bitexact",
                    "-metadata", f"title={title}", "-metadata", "artist=Lykora-Klangbibliothek",
                    "-metadata", "copyright=CC0 1.0", "-metadata", "license=CC0-1.0", str(path)], check=True)


def build(entry):
    id, title, category, seconds, fn = entry
    rng = np.random.default_rng(zlib.crc32(id.encode()))
    n = at(seconds)
    x = finish(fit(fn(rng, n), n), category)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / f"{id}.f32"
        x = normalize(x, LOUDNESS[category], category == "ambience", raw)
        path = OUT / f"{id}.ogg"
        for _ in range(3):
            encode(raw, path, title)
            loudness, tp = measure(path)
            if tp <= -1.0:
                break
            # Kodierung hat Spitzen angehoben: etwas leiser, neu kodieren
            x = x * db(-1.1 - tp)
            x.astype("<f4").tofile(raw)
    # der Vorbis-Kodierer von ffmpeg verschiebt das Ende bei manchen Längen um einige Samples; eine Schleife
    # muss exakt passen, sonst springt sie am Schleifenpunkt
    got = decoded_length(path)
    if got != n and (category == "ambience" or abs(got - n) > at(0.01)):
        raise RuntimeError(f"{id}: dekodiert {got} statt {n} Samples, Länge ändern")
    return {"id": id, "seconds": got / SR, "lufs": loudness, "tp": tp, "kb": path.stat().st_size / 1024}


def library():
    return [{"id": id, "title": title, "category": category, "loop": category == "ambience", "duration": round(seconds, 2),
             "file": f"{id}.ogg", "license": "CC0-1.0", "credit": CREDIT} for id, title, category, seconds, _ in SOUNDS]


README = """# Klangbibliothek

Mitgelieferte Klänge für Lykora-Spiele, öffentlich unter `<PUBLIC_URL>/media/lib/<id>.ogg`, Liste unter
`GET <PUBLIC_URL>/api/library/sounds`. Alle Klänge sind rechnerisch erzeugt (Synthese, gefiltertes Rauschen,
Modulation, Faltung mit selbst erzeugten Nachhall-Impulsantworten), ohne fremde Aufnahmen.

Format: OGG Vorbis, mono, 48 kHz, etwa 80 kbit/s. Atmosphären laufen in nahtloser Schleife und liegen bei
etwa -26 LUFS, Geräusche bei etwa -18 LUFS (sehr kurze, harte Klänge etwas leiser), True Peak unter -1 dBTP.

## Klänge

| ID | Titel | Art | Länge |
| --- | --- | --- | --- |
{rows}

## Lizenz

Die Klangdateien (`*.ogg`) sind gemeinfrei: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.de).
Sie dürfen ohne Nennung und ohne Rückfrage verwendet, verändert und weitergegeben werden. Ein Vermerk im Spiel
ist trotzdem nett und hilft anderen Autoren:

```json
{{ "id": "wind", "type": "audio", "src": "media/lib/wind.ogg", "credit": {{ "de": "Lykora-Klangbibliothek, CC0" }} }}
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
vermerken, zum Beispiel `"credit": {{ "de": "Regen auf Laub: Max Muster, freesound.org, CC0" }}`.
"""


def write_index():
    sounds = library()
    (OUT / "library.json").write_text(json.dumps(sounds, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    kind = {"ambience": "Atmosphäre (Schleife)", "sfx": "Geräusch"}
    rows = "\n".join(f"| `{s['id']}` | {s['title']} | {kind[s['category']]} | {s['duration']:g} s |".replace(".", ",") for s in sounds)
    (OUT / "README.md").write_text(README.format(rows=rows), encoding="utf-8")


def main(ids):
    unknown = set(ids) - {s[0] for s in SOUNDS}
    if unknown:
        sys.exit(f"Unbekannte Klänge: {', '.join(sorted(unknown))}")
    OUT.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(build, [s for s in SOUNDS if not ids or s[0] in ids]))
    for r in results:
        print(f"{r['id']:<14} {r['seconds']:>6.2f} s  {r['lufs']:6.1f} LUFS  {r['tp']:5.1f} dBTP  {r['kb']:6.0f} KB")
    write_index()
    total = sum(p.stat().st_size for p in OUT.glob("*.ogg")) / 1024 / 1024
    print(f"zusammen {total:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
