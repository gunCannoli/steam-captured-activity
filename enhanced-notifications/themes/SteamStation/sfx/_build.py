"""Build the SteamStation trophy sounds: PlayStation trophy chimes blended with Steam's UI sounds.

    python _build.py            (needs numpy, scipy and `pip install imageio-ffmpeg`)

Sources are the files one folder up. Every source is roughly in F major (PS5 chime C/F,
platinum F/C, Deck launch and SteamOS startup F/C, desktop toast Bb/F, short toast A),
so layers do not clash. Leading silence in the PS5 files is trimmed so the sound lands
with the toast. Each recipe is a list of (source, start s, gain dB, options) layers.
"""
import os, subprocess
import numpy as np
import imageio_ffmpeg
from scipy.signal import butter, sosfilt, fftconvolve

FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)


def load(name):
    raw = subprocess.run([FF, "-v", "error", "-i", os.path.join(SRC, name), "-f", "f32le",
                          "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    # trim leading silence (anything under -50 dB of the file's peak)
    on = np.argmax(np.abs(x).max(1) > np.abs(x).max() * 0.003)
    return x[max(0, on - int(0.005 * SR)):]


CACHE = {}


def src(name):
    if name not in CACHE:
        CACHE[name] = load(name)
    return CACHE[name]


def filt(x, kind, hz, order=2):
    return sosfilt(butter(order, hz, kind, fs=SR, output="sos"), x, axis=0)


def fade(x, fin=0.0, fout=0.0):
    x = x.copy()
    if fin:
        n = min(len(x), int(fin * SR)); x[:n] *= np.linspace(0, 1, n)[:, None] ** 2
    if fout:
        n = min(len(x), int(fout * SR)); x[-n:] *= np.linspace(1, 0, n)[:, None] ** 2
    return x


def pitch(x, semis):
    """Resample-style shift (changes length too, fine for chimes)."""
    if not semis:
        return x
    r = 2 ** (semis / 12)
    t = np.arange(0, len(x) - 1, r)
    return np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(2)], 1)


def reverb(x, decay=1.4, wet=0.2, tone=6000, seed=1):
    """Synthetic stereo hall: decaying, low-passed noise, decorrelated per channel."""
    rng = np.random.default_rng(seed)
    n = int(decay * SR)
    env = np.exp(-6.9 * np.arange(n) / n)[:, None]
    ir = filt(rng.standard_normal((n, 2)) * env, "lowpass", tone)
    ir[: int(0.012 * SR)] = 0  # pre-delay
    ir /= np.sqrt((ir ** 2).sum(0))
    tail = np.stack([fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    out = np.zeros_like(tail); out[: len(x)] = x
    return out * (1 - wet) + tail * wet


def width(x, amount):
    """Stereo widen (>1) or narrow (<1) via mid/side."""
    m, s = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2 * amount
    return np.stack([m + s, m - s], 1)


def layer(name, at=0.0, db=0.0, seg=None, hp=None, lp=None, semis=0, fin=0.0, fout=0.0, wide=1.0):
    x = src(name)
    if seg:
        x = x[int(seg[0] * SR): int(seg[1] * SR) if seg[1] else None]
    x = pitch(x, semis)
    if hp: x = filt(x, "highpass", hp)
    if lp: x = filt(x, "lowpass", lp)
    x = fade(x, fin, fout)
    if wide != 1.0: x = width(x, wide)
    return at, x * 10 ** (db / 20)


def mix(layers, rv=None, peak_db=-1.0, loud_db=-17.0, tail_fade=0.25):
    end = max(int(at * SR) + len(x) for at, x in layers)
    out = np.zeros((end, 2))
    for at, x in layers:
        i = int(at * SR); out[i: i + len(x)] += x
    if rv:
        out = reverb(out, **rv)
    # cut the inaudible tail, then fade the last bit
    lvl = np.abs(out).max(1)
    last = len(lvl) - np.argmax(lvl[::-1] > lvl.max() * 0.001)
    out = fade(out[: min(len(out), last + int(0.05 * SR))], fout=tail_fade)
    # loudness: match RMS of the loud part, then limit the peak
    act = out[np.abs(out).max(1) > np.abs(out).max() * 0.05]
    out *= 10 ** (loud_db / 20) / np.sqrt((act ** 2).mean())
    pk = np.abs(out).max()
    if pk > 10 ** (peak_db / 20):
        out = np.tanh(out / pk * 1.4) / np.tanh(1.4) * 10 ** (peak_db / 20)  # soft limit
    return out


def write(name, x):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    path = os.path.join(HERE, name)
    subprocess.run([FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", "192k", path], input=pcm, check=True)
    print(f"{name:28s} {len(x) / SR:4.2f}s")


PS5, PS5P, PS4 = "ps5_trophy.mp3", "ps5_trophy_platinum.mp3", "ps4_trophy.mp3"
DECK_TOAST, DECK_LAUNCH = "deck_ui_toast.wav", "deck_ui_launch_game.wav"
DESK, DESK_SHORT, STARTUP = "desktop_toast_default.wav", "desktop_toast_short.wav", "steam_os_startup.wav"

RECIPES = {
    # ---- A · Deck: PS5 chime layered with the Steam Deck UI ------------------------------
    "a_deck_bronze": dict(layers=[
        layer(PS5),
        layer(DESK_SHORT, at=0.0, db=-6, hp=500),            # A5 glint on the attack
    ], rv=dict(decay=0.8, wet=0.10), loud_db=-18),
    "a_deck_silver": dict(layers=[
        layer(DECK_TOAST, at=0.0, db=-3),                    # Deck "ding" first...
        layer(PS5, at=0.07),                                 # ...PS5 chime right on its heels
    ], rv=dict(decay=1.0, wet=0.14), loud_db=-17.5),
    "a_deck_gold": dict(layers=[
        layer(DECK_LAUNCH, at=0.0, db=-2, lp=2500, fout=0.6),  # low F bloom underneath
        layer(DECK_TOAST, at=0.0, db=-4),
        layer(PS5, at=0.10, db=0, wide=1.3),
        layer(DECK_TOAST, at=0.55, db=-14, semis=12, hp=1500, fout=0.3),  # octave sparkle on the tail
    ], rv=dict(decay=1.5, wet=0.18), loud_db=-17),
    "a_deck_platinum": dict(layers=[
        layer(DECK_LAUNCH, at=0.0, db=0, fout=0.8),           # full Deck launch swell
        layer(PS5P, at=0.28, db=0, wide=1.35),                # platinum lands on the swell
        layer(DECK_TOAST, at=0.28, db=-8),
        layer(DECK_TOAST, at=1.05, db=-15, semis=12, hp=1500, fout=0.4),
    ], rv=dict(decay=2.2, wet=0.22), loud_db=-16.5, tail_fade=0.5),

    # ---- B · Classic: Steam desktop toast calls, PS4 chime answers ----------------------
    "b_classic_bronze": dict(layers=[
        layer(DESK_SHORT, at=0.0, db=-2),
        layer(PS4, at=0.16, db=-1),
    ], rv=dict(decay=0.7, wet=0.08), loud_db=-18),
    "b_classic_silver": dict(layers=[
        layer(DESK, at=0.0, db=-1),
        layer(PS4, at=0.20),
        layer(PS4, at=0.42, db=-16, semis=12, hp=1200, fout=0.3),  # high echo of the chime
    ], rv=dict(decay=1.0, wet=0.12), loud_db=-17.5),
    "b_classic_gold": dict(layers=[
        layer(DESK, at=0.0, db=-1),
        layer(PS4, at=0.20, wide=1.25),
        layer(DECK_TOAST, at=0.20, db=-7),                   # C6 shimmer doubles the PS4 C
        layer(PS4, at=0.48, db=-12, semis=5, hp=900, fout=0.3),  # answer up a fourth (F)
    ], rv=dict(decay=1.4, wet=0.16), loud_db=-17),
    "b_classic_platinum": dict(layers=[
        layer(DESK, at=0.0, db=-1),
        layer(PS4, at=0.18, db=-5),
        layer(PS5P, at=0.45, db=0, wide=1.3),                # PS5 platinum takes over
        layer(STARTUP, at=0.45, db=-9, seg=(0.75, 2.6), fin=0.15, fout=0.9, lp=3000),
    ], rv=dict(decay=2.0, wet=0.2), loud_db=-16.5, tail_fade=0.5),

    # ---- C · Startup: PS5 chime over the SteamOS startup swell --------------------------
    "c_startup_bronze": dict(layers=[
        layer(DECK_LAUNCH, at=0.0, db=-4, lp=600, seg=(0, 0.7), fout=0.4),  # short low F thump
        layer(PS5, at=0.02),
    ], rv=dict(decay=0.9, wet=0.10), loud_db=-18),
    "c_startup_silver": dict(layers=[
        layer(DESK, at=0.0, db=-3),                          # Bb/F under the C/F chime
        layer(PS5, at=0.0, wide=1.2),
    ], rv=dict(decay=1.1, wet=0.14), loud_db=-17.5),
    "c_startup_gold": dict(layers=[
        layer(STARTUP, at=0.0, db=-3, seg=(0.75, 2.3), fin=0.08, fout=0.8),  # startup bloom
        layer(PS5, at=0.12, wide=1.3),
    ], rv=dict(decay=1.6, wet=0.18), loud_db=-17),
    "c_startup_platinum": dict(layers=[
        layer(STARTUP, at=0.0, db=0, seg=(0.45, 3.4), fin=0.2, fout=1.2),
        layer(PS5P, at=0.42, db=-1, wide=1.35),              # lands on the startup's peak
        layer(DECK_TOAST, at=0.42, db=-10),
    ], rv=dict(decay=2.4, wet=0.22), loud_db=-16.5, tail_fade=0.6),
}

if __name__ == "__main__":
    for name, r in RECIPES.items():
        write(name + ".mp3", mix(r["layers"], r.get("rv"), loud_db=r.get("loud_db", -17),
                                 tail_fade=r.get("tail_fade", 0.25)))
