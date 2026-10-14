"""Generates the bundled themes' own art and sounds: original work made from code, no third-party samples or art.

    python tools/theme_assets.py          (from enhanced-notifications/; needs numpy)

Writes themes/SteamStation/assets/:
    trophy_bronze.svg, trophy_silver.svg, trophy_gold.svg, trophy_platinum.svg   a trophy cup per rarity tier
    complete.svg                                                                  a medal for 100 % (the exceptional tier)
    chime_bronze.wav, chime_silver.wav, chime_gold.wav, chime_platinum.wav        bell chimes, one more note per tier

Everything here is the plugin's own (MIT, like the plugin). Re-run after changing a value; the files are committed.
"""
import os
import wave

import numpy as np

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "themes", "SteamStation", "assets")

# ----------------------------------------------------------------------------------------------------------- art

METALS = {
    #           light      mid        dark       rim
    "bronze": ("#f3c49b", "#c8834f", "#7a4523", "#4d2a14"),
    "silver": ("#ffffff", "#c9d0d8", "#7d8894", "#4a535d"),
    "gold": ("#fff1a8", "#f0b733", "#a8700f", "#6b4407"),
    "platinum": ("#ffffff", "#cfe6ff", "#7fa6cf", "#40607f"),
}

CUP = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="m" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{light}"/>
      <stop offset="0.45" stop-color="{mid}"/>
      <stop offset="1" stop-color="{dark}"/>
    </linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g stroke="{rim}" stroke-width="1.5" stroke-linejoin="round">
    <path d="M17 9 C11 9 7 12 7 17 C7 23 12 27 19 28" fill="none" stroke="url(#m)" stroke-width="4"/>
    <path d="M47 9 C53 9 57 12 57 17 C57 23 52 27 45 28" fill="none" stroke="url(#m)" stroke-width="4"/>
    <path d="M15 6 H49 V16 C49 27 42 34 32 35 C22 34 15 27 15 16 Z" fill="url(#m)"/>
    <path d="M28 35 H36 L35 43 H29 Z" fill="url(#m)"/>
    <path d="M22 43 H42 L44 50 H20 Z" fill="url(#m)"/>
    <rect x="16" y="50" width="32" height="7" rx="2" fill="url(#m)"/>
  </g>
  <path d="M21 9 H25 V18 C25 24 27 28 30 30 C25 29 21 24 21 18 Z" fill="url(#s)"/>
  <path d="M32 12 L34.4 17 L39.8 17.6 L35.8 21.3 L36.9 26.6 L32 23.9 L27.1 26.6 L28.2 21.3 L24.2 17.6 L29.6 17 Z"
        fill="{light}" fill-opacity="0.9" stroke="{dark}" stroke-width="0.8"/>{extra}
</svg>
"""

# Platinum gets two sparkles.
SPARKLES = """
  <g fill="#ffffff">
    <path d="M53 33 L54.2 36.8 L58 38 L54.2 39.2 L53 43 L51.8 39.2 L48 38 L51.8 36.8 Z"/>
    <path d="M10 33 L10.8 35.2 L13 36 L10.8 36.8 L10 39 L9.2 36.8 L7 36 L9.2 35.2 Z"/>
  </g>"""

MEDAL = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9fbff"/>
      <stop offset="0.5" stop-color="#7fd6ff"/>
      <stop offset="1" stop-color="#2a6ea8"/>
    </linearGradient>
  </defs>
  <path d="M18 2 H28 L34 22 H24 Z" fill="#2a6ea8"/>
  <path d="M46 2 H36 L30 22 H40 Z" fill="#40c4ff"/>
  <circle cx="32" cy="40" r="21" fill="url(#g)" stroke="#1d4e78" stroke-width="2"/>
  <circle cx="32" cy="40" r="16" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.5"/>
  <text x="32" y="45" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="13" fill="#0f2f4d">100%</text>
</svg>
"""


def write_art():
    for metal, (light, mid, dark, rim) in METALS.items():
        extra = SPARKLES if metal == "platinum" else ""
        svg = CUP.format(light=light, mid=mid, dark=dark, rim=rim, extra=extra)
        with open(os.path.join(OUT, f"trophy_{metal}.svg"), "w", encoding="utf-8", newline="\n") as f:
            f.write(svg)
    with open(os.path.join(OUT, "complete.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write(MEDAL)


# -------------------------------------------------------------------------------------------------------- sounds

RATE = 44100
# A struck bell: partial ratios and their relative levels and decay speeds (higher partials die faster).
PARTIALS = [(1.0, 1.0, 1.0), (2.0, 0.45, 1.6), (2.76, 0.25, 2.2), (5.40, 0.12, 3.5), (8.93, 0.05, 5.0)]
NOTE = {"G5": 783.99, "B5": 987.77, "D6": 1174.66, "G6": 1567.98, "B6": 1975.53}

TIERS = {
    #           notes (start s, note, level)                                         length s  decay
    "bronze": ([(0.00, "G5", 1.0)], 1.1, 3.2),
    "silver": ([(0.00, "G5", 0.9), (0.11, "D6", 1.0)], 1.3, 3.0),
    "gold": ([(0.00, "G5", 0.85), (0.10, "B5", 0.9), (0.20, "D6", 1.0)], 1.7, 2.6),
    "platinum": ([(0.00, "G5", 0.8), (0.09, "B5", 0.85), (0.18, "D6", 0.9), (0.27, "G6", 1.0), (0.45, "B6", 0.45)], 2.6, 1.9),
}


def bell(freq, length, decay):
    t = np.arange(int(length * RATE)) / RATE
    out = np.zeros_like(t)
    for ratio, level, speed in PARTIALS:
        out += level * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-decay * speed * t)
    attack = np.minimum(1.0, t / 0.004)  # 4 ms, no click
    return out * attack


def write_sounds():
    for tier, (notes, length, decay) in TIERS.items():
        mix = np.zeros(int(length * RATE))
        for start, name, level in notes:
            tone = level * bell(NOTE[name], length - start, decay)
            i = int(start * RATE)
            mix[i:i + len(tone)] += tone
        if tier == "platinum":  # a soft high shimmer under the chord
            t = np.arange(len(mix)) / RATE
            shimmer = 0.06 * np.sin(2 * np.pi * NOTE["G6"] * 2 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 6 * t))
            mix += shimmer * np.exp(-1.2 * t) * np.minimum(1.0, t / 0.3)
        fade = np.ones_like(mix)
        n = int(0.08 * RATE)
        fade[-n:] = np.linspace(1.0, 0.0, n)
        mix *= fade
        mix *= (10 ** (-3 / 20)) / np.max(np.abs(mix))  # peak at -3 dBFS
        pcm = (mix * 32767).astype("<i2")
        with wave.open(os.path.join(OUT, f"chime_{tier}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_art()
    write_sounds()
    for name in sorted(os.listdir(OUT)):
        print(f"{name:24} {os.path.getsize(os.path.join(OUT, name)):>8} bytes")
