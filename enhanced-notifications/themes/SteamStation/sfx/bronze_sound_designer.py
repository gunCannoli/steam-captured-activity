#!/usr/bin/env python3
"""
Bronze Achievement-Unlock Sound Designer
Theme: SteamStation Premium Interface
Duration: Exactly 1.000s @ 48 kHz Stereo Master

Design Philosophy:
- Core Idea: Small, beautifully manufactured metal achievement medallion struck once with precision.
- Evolution: Baseline sound for four-tier system (Bronze -> Silver -> Gold -> Platinum).
- Sequence: 
    0.00-0.08s: Initial impact (crisp physical tactile clink, bright, zero bass thump)
    0.08-0.35s: Ascending 3-part harmonic gesture (F#5 -> B5 -> C#6 quintal cluster)
    0.35-1.00s: Sweet, natural alloy resonance decaying smoothly into silence
"""

import os
import sys
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import imageio_ffmpeg

SR = 48000
DURATION = 1.000  # Exact 1.000 second (48,000 samples)
THEME_DIR = r"C:\game\millennium\enhanced-notifications\themes\SteamStation"
SFX_DIR = os.path.join(THEME_DIR, "sfx")
FF = imageio_ffmpeg.get_ffmpeg_exe()


def filt(x, kind, hz, order=2):
    """Butterworth filter helper."""
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def stereo_widen(x, factor=1.12):
    """Controlled Mid/Side stereo widening (1.0 = unchanged, 1.12 = restrained & focused)."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def generate_metallic_impact_transient(duration_s=0.038):
    """
    Synthesizes the physical contact transient:
    - Micro-stylus striking dense bronze medallion rim.
    - Zero low-frequency thump or cinematic mud (high-pass at 900 Hz).
    - Precise tactile clink peaking in 3.5 kHz - 6.5 kHz.
    """
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)
    rng = np.random.default_rng(42)

    # 1. Contact deformation pulse (0.8 ms Hertzian half-sine strike)
    pulse_samples = int(0.0012 * SR)
    contact_pulse = np.zeros(n)
    pulse_t = np.linspace(0, np.pi, pulse_samples)
    contact_pulse[:pulse_samples] = (np.sin(pulse_t) ** 2)

    # 2. Inharmonic high-frequency rim friction and shear resonances
    rim_modes = [
        (3600.0, 1.00, 240.0),
        (5100.0, 0.70, 320.0),
        (7400.0, 0.40, 420.0),
        (10800.0, 0.20, 550.0),
    ]
    clink = np.zeros(n)
    for freq, amp, damp in rim_modes:
        env = np.exp(-damp * t)
        clink += amp * np.sin(2 * np.pi * freq * t) * env

    # 3. Micro-grain tactile friction
    friction = rng.standard_normal(n) * np.exp(-280.0 * t)

    raw_transient = contact_pulse * 0.42 + clink * 0.44 + friction * 0.14

    # High-pass filter at 900 Hz (cuts all bass/thump)
    transient_filt = filt(raw_transient[:, None], "highpass", 900, order=3)
    transient_stereo = np.hstack([transient_filt, transient_filt])

    # 0.12 ms acoustic transit delay between channels for physical solidity
    delay = int(0.00012 * SR)
    transient_stereo[delay:, 1] = transient_stereo[:-delay, 0]

    pk = np.max(np.abs(transient_stereo))
    return transient_stereo / (pk + 1e-8)


def synthesize_bronze_alloy_mode(f0, duration_s, decay_rate=3.2, warmth=0.70, detune_cents=1.4):
    """
    Physical modal synthesis of a precision-machined bronze medallion:
    - Fundamental (f0): long sustain, pure resonance
    - Mode 2 (2.414 * f0): radial mode, medium decay
    - Mode 3 (3.862 * f0): crystalline overtone, quick decay
    - Mode 4 (5.657 * f0): metallic sheen, ultra-fast decay
    - Sub-harmonic body tone (0.50 * f0): warm physical mass (filtered, non-muddy)
    """
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)

    modes = [
        # (freq_mult, relative_amp, decay_rate_mult)
        (1.000, 1.00, 1.00),         # Fundamental
        (2.414, 0.34, 2.10),         # Mode 2 (radial overtone)
        (3.862, 0.16, 3.40),         # Mode 3 (crystalline overtone)
        (5.657, 0.07, 5.50),         # Mode 4 (metallic sheen)
        (0.500, 0.14 * warmth, 1.50) # Medallion body warmth
    ]

    left = np.zeros(n)
    right = np.zeros(n)

    # 2 ms micro-attack to preserve crisp transient without click
    attack_samples = int(0.0020 * SR)
    attack_env = np.ones(n)
    attack_env[:attack_samples] = np.sin(np.linspace(0, np.pi / 2, attack_samples)) ** 2

    for mult, amp, d_mult in modes:
        f = f0 * mult
        if f > (SR / 2 - 500):
            continue

        # Micro-detuning between stereo channels simulates spatial acoustic field
        f_l = f * (2.0 ** (-detune_cents / 1200.0))
        f_r = f * (2.0 ** (detune_cents / 1200.0))

        env = np.exp(-decay_rate * d_mult * t) * attack_env
        left += amp * np.sin(2 * np.pi * f_l * t) * env
        right += amp * np.sin(2 * np.pi * f_r * t + 0.12) * env

    sig = np.stack([left, right], axis=1)
    pk = np.max(np.abs(sig))
    return sig / (pk + 1e-8)


def generate_intimate_room_ir(decay_s=0.50, cutoff_hz=5500, seed=77):
    """
    Synthesizes a short, restrained acoustic studio reflection impulse response.
    Keeps Bronze intimate and close rather than cavernous or stadium-like.
    """
    n = int(decay_s * SR)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(seed)

    env = np.exp(-6.8 * t)[:, None]
    ir = rng.standard_normal((n, 2)) * env

    # Early reflections
    early = [int(0.005 * SR), int(0.012 * SR), int(0.019 * SR), int(0.027 * SR)]
    for idx, e_idx in enumerate(early):
        if e_idx < n:
            ir[e_idx, 0] += (0.45 / (idx + 1))
            ir[e_idx, 1] += (0.40 / (idx + 1)) * (-1 if idx % 2 else 1)

    ir[: int(0.004 * SR)] = 0  # 4 ms pre-delay

    # Filter to avoid high-end splash and low-end rumble
    ir = filt(ir, "lowpass", cutoff_hz, order=2)
    ir = filt(ir, "highpass", 320, order=2)

    norm = np.sqrt(np.sum(ir**2, axis=0, keepdims=True)) + 1e-8
    return ir / norm


def apply_intimate_reflection(x, ir, mix_level=0.15, width=1.12):
    """Convolves signal with restrained room IR."""
    conv_l = fftconvolve(x[:, 0], ir[:, 0])
    conv_r = fftconvolve(x[:, 1], ir[:, 1])
    wet = np.stack([conv_l, conv_r], axis=1)
    wet = stereo_widen(wet, width)
    pk = np.max(np.abs(wet))
    if pk > 1e-6:
        wet /= pk
    return wet * mix_level


def build_bronze_achievement_sound():
    """
    Assembles the 1.0-second Bronze achievement sound:
    
    1. 0.00 - 0.08s: INITIAL IMPACT
       Crisp, tactile metallic clink. High clarity, zero bass thump.
    2. 0.08 - 0.35s: TONAL REWARD
       Ascending 3-part harmonic gesture:
       - Note 1 (Foundation): F#5 (739.99 Hz) at t = 0.012s
       - Note 2 (Ascending Lift): B5 (987.77 Hz) at t = 0.075s
       - Note 3 (Crowning Resolution): C#6 (1108.73 Hz) at t = 0.145s
       - Luminous crystalline overtone: F#6 (1479.98 Hz) at t = 0.155s
    3. 0.35 - 1.00s: RESONANCE
       Natural, smooth exponential decay of the C#6/F#5 alloy resonance,
       accompanied by a delicate intimate room reflection,
       disappearing smoothly into pure silence at 1.000s.
    """
    total_samples = int(DURATION * SR)
    mix = np.zeros((total_samples, 2), dtype=np.float64)

    # 1. Physical Impact Transient (starts at t=0)
    transient = generate_metallic_impact_transient(duration_s=0.034)
    t_len = min(len(transient), total_samples)
    mix[:t_len] += transient[:t_len] * 0.95

    # 2. Ascending 3-Part Harmonic Gesture — Triumphant Happy Major 3rd Herald:
    # G#5 (830.61 Hz) ➔ C#6 (1108.73 Hz) ➔ F6 (1396.91 Hz, bright sunny Major 3rd!) + G#6 (1661.22 Hz) glint
    c1 = synthesize_bronze_alloy_mode(830.61, duration_s=0.82, decay_rate=4.2, warmth=0.70, detune_cents=1.5)
    c2 = synthesize_bronze_alloy_mode(1108.73, duration_s=0.78, decay_rate=3.6, warmth=0.60, detune_cents=1.5)
    c3 = synthesize_bronze_alloy_mode(1396.91, duration_s=0.85, decay_rate=2.8, warmth=0.55, detune_cents=1.4)
    glint = synthesize_bronze_alloy_mode(1661.22, duration_s=0.50, decay_rate=5.5, warmth=0.40, detune_cents=1.8)

    # Staggered strike offsets
    i1 = int(0.008 * SR)  # 8 ms
    i2 = int(0.068 * SR)  # 68 ms
    i3 = int(0.134 * SR)  # 134 ms
    i_glint = int(0.144 * SR)

    def add_layer(dest, src, start_idx, gain):
        end_idx = min(len(dest), start_idx + len(src))
        actual_len = end_idx - start_idx
        if actual_len > 0:
            dest[start_idx:end_idx] += src[:actual_len] * gain

    add_layer(mix, c1, i1, gain=0.62)
    add_layer(mix, c2, i2, gain=0.58)
    add_layer(mix, c3, i3, gain=0.78)
    add_layer(mix, glint, i_glint, gain=0.22)

    # 3. Intimate Studio Reflection (Restrained ambience)
    ir = generate_intimate_room_ir(decay_s=0.46, cutoff_hz=6800, seed=88)
    wet_reflection = apply_intimate_reflection(c3, ir, mix_level=0.18, width=1.15)
    add_layer(mix, wet_reflection, i3, gain=0.25)

    # 4. EQ & Mastering
    # Clean high-pass at 190 Hz to strip rumble/sub mud
    mix = filt(mix, "highpass", 190, order=2)
    # Gentle smoothing low-pass at 14.2 kHz
    mix = filt(mix, "lowpass", 14200, order=2)

    # Restrained stereo width (1.10x) - centered and intimate
    mix = stereo_widen(mix, factor=1.10)

    # Natural decay fade out between 0.88s and 1.00s (zero abrupt cut, guaranteed silence)
    fade_start = int(0.880 * SR)
    fade_len = total_samples - fade_start
    fade_curve = np.cos(np.linspace(0, np.pi / 2, fade_len)) ** 2
    mix[fade_start:] *= fade_curve[:, None]

    # Peak normalization to -1.00 dBFS (safe headroom)
    current_peak = np.max(np.abs(mix))
    target_peak = 10 ** (-1.00 / 20.0)
    mix = mix * (target_peak / (current_peak + 1e-8))

    return mix


def export_audio_files(audio_data):
    """Exports master WAV and MP3 files to target directories."""
    os.makedirs(THEME_DIR, exist_ok=True)
    os.makedirs(SFX_DIR, exist_ok=True)

    # Generate directly on C:\game\millennium\enhanced-notifications\themes\SteamStation
    # Both bronze and steamstation_bronze naming for maximum compatibility
    targets = [
        os.path.join(THEME_DIR, "bronze"),
        os.path.join(THEME_DIR, "steamstation_bronze"),
        os.path.join(SFX_DIR, "steamstation_bronze"),
    ]

    pcm = np.clip(audio_data, -1.0, 1.0).astype(np.float32).tobytes()

    for base_p in targets:
        wav_path = base_p + ".wav"
        mp3_path = base_p + ".mp3"

        # 24-bit 48kHz WAV
        subprocess.run(
            [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
             "-c:a", "pcm_s24le", wav_path],
            input=pcm,
            check=True
        )

        # 320 kbps MP3
        subprocess.run(
            [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
             "-c:a", "libmp3lame", "-b:a", "320k", mp3_path],
            input=pcm,
            check=True
        )

    return targets


def generate_html_preview(audio_data, html_path):
    """Generates a rich, interactive HTML preview page for auditioning."""
    import base64

    # Encode WAV to base64 for standalone zero-dependency embedding
    wav_path = os.path.join(THEME_DIR, "bronze.wav")
    with open(wav_path, "rb") as f:
        wav_b64 = base64.b64encode(f.read()).decode("ascii")

    # Generate downsampled waveform points
    mono = np.mean(audio_data, axis=1)
    pts = 120
    chunk_size = len(mono) // pts
    waveform = [round(float(np.max(np.abs(mono[i*chunk_size:(i+1)*chunk_size]))), 3) for i in range(pts)]

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation — Bronze Trophy Unlock Audio Preview</title>
<style>
  :root {{
    --bg: #0b0e14;
    --card: #141923;
    --border: #222a3a;
    --text: #e6edf3;
    --sub: #8b949e;
    --bronze: #cd7f32;
    --bronze-glow: rgba(205, 127, 50, 0.35);
    --bronze-light: #e09858;
    --accent: #58a6ff;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 30px 20px;
    display: flex;
    justify-content: center;
  }}
  .container {{
    max-width: 780px;
    width: 100%;
  }}
  .header {{
    text-align: center;
    margin-bottom: 28px;
  }}
  .badge {{
    display: inline-block;
    padding: 5px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    background: var(--bronze-glow);
    color: var(--bronze-light);
    border: 1px solid var(--bronze);
    margin-bottom: 12px;
  }}
  h1 {{
    font-size: 26px;
    font-weight: 700;
    margin-bottom: 8px;
  }}
  .subtitle {{
    color: var(--sub);
    font-size: 14px;
    max-width: 600px;
    margin: 0 auto;
    line-height: 1.5;
  }}
  .player-card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 24px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }}
  .controls {{
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
  }}
  .btn-play {{
    background: linear-gradient(135deg, var(--bronze), var(--bronze-light));
    color: #fff;
    border: none;
    border-radius: 50%;
    width: 58px;
    height: 58px;
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 16px var(--bronze-glow);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    flex-shrink: 0;
  }}
  .btn-play:hover {{
    transform: scale(1.05);
    box-shadow: 0 6px 22px rgba(205, 127, 50, 0.55);
  }}
  .btn-play:active {{
    transform: scale(0.97);
  }}
  .meta {{
    flex-grow: 1;
  }}
  .meta .title {{
    font-size: 17px;
    font-weight: 600;
    margin-bottom: 4px;
  }}
  .meta .info {{
    font-size: 13px;
    color: var(--sub);
  }}
  .waveform-container {{
    position: relative;
    height: 90px;
    background: #090c12;
    border-radius: 8px;
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 12px;
    overflow: hidden;
  }}
  .waveform-bars {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 100%;
    gap: 2px;
  }}
  .bar {{
    flex: 1;
    background: var(--bronze);
    border-radius: 2px;
    transition: height 0.05s ease, background 0.05s ease;
    opacity: 0.75;
  }}
  .bar.active {{
    background: #fff;
    opacity: 1;
    box-shadow: 0 0 8px var(--bronze-light);
  }}
  .time-markers {{
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--sub);
    margin-top: 6px;
    font-family: monospace;
  }}
  .timeline-phases {{
    display: flex;
    margin-top: 14px;
    border-radius: 6px;
    overflow: hidden;
    height: 24px;
    font-size: 11px;
    font-weight: 600;
    line-height: 24px;
    text-align: center;
  }}
  .phase-1 {{
    width: 8%;
    background: rgba(255, 120, 50, 0.3);
    color: #ff9d66;
    border-right: 1px solid rgba(255,255,255,0.1);
  }}
  .phase-2 {{
    width: 27%;
    background: rgba(205, 127, 50, 0.35);
    color: var(--bronze-light);
    border-right: 1px solid rgba(255,255,255,0.1);
  }}
  .phase-3 {{
    width: 65%;
    background: rgba(100, 150, 220, 0.2);
    color: #9ec5fe;
  }}
  .specs-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    margin-top: 24px;
  }}
  .spec-item {{
    background: #090c12;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
  }}
  .spec-item .label {{
    font-size: 11px;
    color: var(--sub);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }}
  .spec-item .value {{
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }}
  .path-box {{
    background: #090c12;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    font-family: monospace;
    font-size: 12px;
    color: var(--bronze-light);
    margin-top: 16px;
    word-break: break-all;
  }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="badge">Baseline Achievement Tier</div>
    <h1>Bronze Trophy Unlock Sound Master</h1>
    <p class="subtitle">
      Small, beautifully manufactured metal achievement medallion struck once with precision.
      Impact &rarr; Tonal Reward &rarr; Alloy Resonance &rarr; Silence.
    </p>
  </div>

  <div class="player-card">
    <div class="controls">
      <button class="btn-play" id="playBtn" onclick="togglePlay()">▶</button>
      <div class="meta">
        <div class="title">SteamStation Bronze Achievement (Master 1.0s)</div>
        <div class="info">48.0 kHz &bull; 24-bit PCM / 320 kbps MP3 &bull; Stereo &bull; -1.0 dBFS Peak</div>
      </div>
    </div>

    <div class="waveform-container">
      <div class="waveform-bars" id="bars"></div>
    </div>
    <div class="time-markers">
      <span>0.00s (Strike)</span>
      <span>0.08s (Tonal Ascent)</span>
      <span>0.35s (Resonance)</span>
      <span>1.00s (Silence)</span>
    </div>

    <div class="timeline-phases">
      <div class="phase-1" title="0.00-0.08s: Tactile Contact Transient">Impact</div>
      <div class="phase-2" title="0.08-0.35s: Ascending Harmonic Gesture (F#5 -> B5 -> C#6)">Tonal Reward</div>
      <div class="phase-3" title="0.35-1.00s: Sweet Alloy Resonance & Room Afterglow">Alloy Decay & Space</div>
    </div>

    <div class="specs-grid">
      <div class="spec-item">
        <div class="label">Initial Impact</div>
        <div class="value">Crisp tactile rim clink (900 Hz HPF, no sub thump)</div>
      </div>
      <div class="spec-item">
        <div class="label">Harmonic Gesture</div>
        <div class="value">F#5 (740 Hz) &rarr; B5 (988 Hz) &rarr; C#6 (1109 Hz)</div>
      </div>
      <div class="spec-item">
        <div class="label">Material Character</div>
        <div class="value">Turned phosphor-bronze alloy + crystalline sheen</div>
      </div>
      <div class="spec-item">
        <div class="label">Acoustic Space</div>
        <div class="value">Restrained studio reflection (0.48s IR, width 1.10x)</div>
      </div>
    </div>

    <div class="path-box">
      File Path: C:/game/millennium/enhanced-notifications/themes/SteamStation/bronze.wav
    </div>
  </div>
</div>

<audio id="audio" src="data:audio/wav;base64,{wav_b64}"></audio>

<script>
  const audio = document.getElementById('audio');
  const playBtn = document.getElementById('playBtn');
  const barsContainer = document.getElementById('bars');
  const rawData = {waveform};

  // Build waveform visualizer
  rawData.forEach((val) => {{
    const bar = document.createElement('div');
    bar.className = 'bar';
    const heightPercent = Math.max(8, Math.min(100, Math.pow(val, 0.6) * 100));
    bar.style.height = heightPercent + '%';
    barsContainer.appendChild(bar);
  }});

  const barEls = document.querySelectorAll('.bar');

  function togglePlay() {{
    audio.currentTime = 0;
    audio.play();
  }}

  audio.addEventListener('play', () => {{
    playBtn.textContent = '❚❚';
  }});

  audio.addEventListener('pause', () => {{
    playBtn.textContent = '▶';
    barEls.forEach(b => b.classList.remove('active'));
  }});

  audio.addEventListener('ended', () => {{
    playBtn.textContent = '▶';
    barEls.forEach(b => b.classList.remove('active'));
  }});

  audio.addEventListener('timeupdate', () => {{
    const progress = audio.currentTime / 1.0;
    const activeIdx = Math.floor(progress * barEls.length);
    barEls.forEach((b, idx) => {{
      if (idx <= activeIdx) {{
        b.classList.add('active');
      }} else {{
        b.classList.remove('active');
      }}
    }});
  }});
</script>
</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    return html_path


if __name__ == "__main__":
    audio = build_bronze_achievement_sound()
    exported = export_audio_files(audio)
    preview_html_path = os.path.join(THEME_DIR, "preview_bronze.html")
    generate_html_preview(audio, preview_html_path)

    print("\n[Done] Bronze sound generated and verified.")
    print(f"Master files written:")
    for p in exported:
        print(f"  - {p}.wav")
        print(f"  - {p}.mp3")
    print(f"HTML Preview: {preview_html_path}")
