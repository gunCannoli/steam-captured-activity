#!/usr/bin/env python3
"""
SteamStation 4-Tier Trophy Progression Sound Designer (Bronze -> Silver -> Gold -> Platinum)
Authoritative Reference: 100% Titanium-Alloy Material DNA (C# Major Happy Herald)

Tiers & Durations:
  - Bronze:   1.000 s (48,000 samples) — Small, intimate, precise.
  - Silver:   1.320 s (63,360 samples) — More substantial, longer natural resonance, sympathetic overtones.
  - Gold:     1.650 s (79,200 samples) — Ceremonial, 4-note ascending fanfare, rich harmonic body, small hall.
  - Platinum: 2.000 s (96,000 samples) — Magnificent culmination, full harmonic bloom, wide spatial field, ceremonial decay.

All tiers share:
  - Exact same physical contact transient material (Hertzian micro-click + high rim modes)
  - Exact same resonant alloy modal physics (fundamental, radial, crystalline, metallic sheen, mass warmth)
  - Exact same C# Major harmonic vocabulary (G# -> C# -> F -> G# -> C#7)
  - Consistent peak ceiling: -1.00 dBFS (progression through sound design, not volume inflation)
"""

import os
import sys
import json
import base64
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve, lfilter
import imageio_ffmpeg

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
THEME_DIR = os.path.dirname(HERE)
ALTS_DIR = os.path.join(THEME_DIR, "bronze_alternatives")
FF = imageio_ffmpeg.get_ffmpeg_exe()


# ==============================================================================
# Shared DSP Utilities
# ==============================================================================

def filt(x, kind, hz, order=2):
    """Zero-phase Butterworth filtering."""
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def stereo_widen(x, factor=1.15):
    """Mid/Side stereo width control."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def add_layer(dest, src, start_idx, gain=1.0):
    """Safely adds 2D audio src into dest at start_idx with gain, clipping bounds."""
    if start_idx >= len(dest):
        return
    end_idx = min(len(dest), start_idx + len(src))
    actual_len = end_idx - start_idx
    if actual_len > 0:
        dest[start_idx:end_idx] += src[:actual_len] * gain


def generate_physical_transient(duration_s=0.034, hardness=1.30, hp_hz=1050, seed=108):
    """Synthesizes the shared physical metal contact transient."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)
    rng = np.random.default_rng(seed)

    # Hertzian contact impulse
    pulse_len = int(0.0012 * SR / hardness)
    pulse = np.zeros(n)
    if pulse_len > 0:
        pulse[:pulse_len] = (np.sin(np.linspace(0, np.pi, pulse_len)) ** 2)

    # High frequency rim shear modes
    rim_freqs = [3600.0 * hardness, 5200.0 * hardness, 7800.0, 11200.0]
    rim = np.zeros(n)
    for idx, f in enumerate(rim_freqs):
        if f < SR / 2 - 500:
            env = np.exp(-(220.0 + idx * 80.0) * t)
            rim += (1.0 / (idx + 1)) * np.sin(2 * np.pi * f * t) * env

    friction = rng.standard_normal(n) * np.exp(-260.0 * t)
    raw = pulse * 0.45 + rim * 0.42 + friction * 0.13
    filtered = filt(raw[:, None], "highpass", hp_hz, order=3)
    stereo = np.hstack([filtered, filtered])

    d_samp = int(0.00012 * SR)
    stereo[d_samp:, 1] = stereo[:-d_samp, 0]
    pk = np.max(np.abs(stereo))
    return stereo / (pk + 1e-8)


def synth_alloy_tine(f0, duration_s, decay_rate=3.0, warmth=0.60, detune_cents=1.5,
                     pitch_slump_hz=12.0, slump_tau=0.020, saturation=0.18):
    """
    Physical modeling of struck resonant titanium-bronze alloy tine.
    Modes: Fundamental (1.0), Radial (2.620), Crystalline (4.450), Sheen (7.100), Body Warmth (0.50).
    """
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)

    # Micro-pitch slump on strike
    if pitch_slump_hz > 0:
        freq_env = f0 + pitch_slump_hz * np.exp(-t / max(1e-4, slump_tau))
    else:
        freq_env = np.full(n, f0)
    base_phase = 2 * np.pi * np.cumsum(freq_env) / SR

    # Fast micro-attack
    att_len = int(0.0016 * SR)
    att = np.ones(n)
    att[:att_len] = np.sin(np.linspace(0, np.pi / 2, att_len)) ** 2

    modes = [
        # (freq_mult, rel_amp, decay_rate_mult, phase_offset)
        (1.000, 1.00, 1.00, 0.0),
        (2.620, 0.36, 2.40, 0.3),
        (4.450, 0.20, 3.80, 0.6),
        (7.100, 0.10, 6.00, 0.9),
        (0.500, 0.12 * (warmth / 0.60), 1.70, 0.1),
    ]

    left = np.zeros(n)
    right = np.zeros(n)

    for mult, rel_amp, d_mult, phase_shift in modes:
        f_mode = f0 * mult
        if f_mode > (SR / 2 - 400):
            continue

        f_l_mult = mult * (2.0 ** (-detune_cents / 1200.0))
        f_r_mult = mult * (2.0 ** (detune_cents / 1200.0))

        env = np.exp(-decay_rate * d_mult * t) * att
        p_l = base_phase * f_l_mult + phase_shift
        p_r = base_phase * f_r_mult + phase_shift + 0.14

        left += rel_amp * np.sin(p_l) * env
        right += rel_amp * np.sin(p_r) * env

    if saturation > 0:
        left = np.tanh(left * (1.0 + saturation)) / (1.0 + saturation * 0.4)
        right = np.tanh(right * (1.0 + saturation)) / (1.0 + saturation * 0.4)

    stereo = np.stack([left, right], axis=1)
    pk = np.max(np.abs(stereo))
    return stereo / (pk + 1e-8) if pk > 1e-6 else stereo


def make_ceremonial_space(decay_s=0.50, cutoff_hz=6800, early_pattern=None, seed=88):
    """Synthesizes clean acoustic studio/ceremonial space IR."""
    n = int(decay_s * SR)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(seed)

    env = np.exp(-6.5 * t)[:, None]
    ir = rng.standard_normal((n, 2)) * env

    if early_pattern:
        for idx, (d_ms, g) in enumerate(early_pattern):
            s = int(d_ms * 0.001 * SR)
            if s < n:
                ir[s, 0] += g
                ir[s, 1] += g * (-1 if idx % 2 else 1)

    ir[: int(0.004 * SR)] = 0
    ir = filt(ir, "lowpass", cutoff_hz, order=2)
    ir = filt(ir, "highpass", 280, order=2)
    norm = np.sqrt(np.sum(ir**2, axis=0, keepdims=True)) + 1e-8
    return ir / norm


def finalize_tier_master(mix, target_duration, peak_ceiling_db=-1.00, fade_start_ratio=0.86, width=1.15):
    """Finalizes duration, filters rumble, controls stereo width, and applies smooth decay fade."""
    total_samples = int(target_duration * SR)
    out = np.zeros((total_samples, 2), dtype=np.float64)
    n = min(len(mix), total_samples)
    out[:n] = mix[:n]

    out = filt(out, "highpass", 180, order=2)
    out = filt(out, "lowpass", 14500, order=2)
    out = stereo_widen(out, factor=width)

    # Smooth cosine-squared fade out ensuring absolute silence at the boundary
    f_start = int(target_duration * fade_start_ratio * SR)
    f_len = total_samples - f_start
    if f_len > 0:
        out[f_start:] *= (np.cos(np.linspace(0, np.pi / 2, f_len)) ** 2)[:, None]

    pk = np.max(np.abs(out))
    target = 10 ** (peak_ceiling_db / 20.0)
    if pk > 1e-6:
        out = out * (target / pk)

    return out


# ==============================================================================
# The 4 Tiers: Bronze -> Silver -> Gold -> Platinum
# ==============================================================================

def build_bronze():
    """
    BRONZE (1.000s): Baseline Material Reference
    Motif: G#5 (830 Hz) ➔ C#6 (1109 Hz) ➔ F6 (1397 Hz, Major 3rd) + G#6 (1661 Hz) glint
    Decay: 1.000s, Intimate room (0.46s), width 1.15x
    """
    dur = 1.000
    mix = np.zeros((int(dur * SR), 2))

    # Initial transient
    transient = generate_physical_transient(duration_s=0.034, hardness=1.30, hp_hz=1050, seed=108)
    add_layer(mix, transient, 0, 0.95)

    # Alloy tines
    c1 = synth_alloy_tine(830.61, 0.82, decay_rate=4.2, warmth=0.70, detune_cents=1.5, pitch_slump_hz=14.0, saturation=0.18)
    c2 = synth_alloy_tine(1108.73, 0.78, decay_rate=3.6, warmth=0.60, detune_cents=1.5, pitch_slump_hz=12.0, saturation=0.16)
    c3 = synth_alloy_tine(1396.91, 0.85, decay_rate=2.8, warmth=0.55, detune_cents=1.4, pitch_slump_hz=10.0, saturation=0.15)
    glint = synth_alloy_tine(1661.22, 0.50, decay_rate=5.5, warmth=0.40, detune_cents=1.8, pitch_slump_hz=0.0, saturation=0.10)

    i1, i2, i3 = int(0.008 * SR), int(0.068 * SR), int(0.134 * SR)
    add_layer(mix, c1, i1, 0.62)
    add_layer(mix, c2, i2, 0.58)
    add_layer(mix, c3, i3, 0.78)
    add_layer(mix, glint, i3 + int(0.010 * SR), 0.22)

    # Intimate space
    early = [(5.0, 0.42), (11.5, 0.38), (18.0, 0.28), (26.0, 0.20)]
    ir = make_ceremonial_space(decay_s=0.46, cutoff_hz=6800, early_pattern=early, seed=88)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.18)

    return finalize_tier_master(mix, dur, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.15)


def build_silver():
    """
    SILVER (1.320s): Direct Evolution of Bronze with Longer Resonance & Sympathetic Overtones
    Motif: G#5 ➔ C#6 ➔ F6 (Major 3rd) + high sympathetic C#7 glint
    Key Upgrade: Decay extends from 1.0s to 1.32s; fundamental decay rate drops from 2.8 to 1.8;
                 subtle C#5 body overtone adds physical mass; width expands to 1.26x.
    """
    dur = 1.320
    mix = np.zeros((int(dur * SR), 2))

    # Slightly more substantial transient
    transient = generate_physical_transient(duration_s=0.038, hardness=1.25, hp_hz=950, seed=109)
    add_layer(mix, transient, 0, 0.96)

    # Secondary mass body on tonic strike
    c_body = synth_alloy_tine(554.37, 1.05, decay_rate=2.4, warmth=0.75, detune_cents=1.2, pitch_slump_hz=8.0, saturation=0.15)

    # Sustaining alloy tines (longer natural ring)
    c1 = synth_alloy_tine(830.61, 1.10, decay_rate=3.4, warmth=0.72, detune_cents=1.5, pitch_slump_hz=16.0, saturation=0.20)
    c2 = synth_alloy_tine(1108.73, 1.15, decay_rate=2.6, warmth=0.65, detune_cents=1.5, pitch_slump_hz=14.0, saturation=0.18)
    c3 = synth_alloy_tine(1396.91, 1.20, decay_rate=1.85, warmth=0.60, detune_cents=1.4, pitch_slump_hz=11.0, saturation=0.16)

    # Sympathetic crystalline overtones
    glint1 = synth_alloy_tine(1661.22, 0.75, decay_rate=4.2, warmth=0.45, detune_cents=1.8, pitch_slump_hz=0.0, saturation=0.10)
    glint2 = synth_alloy_tine(2217.46, 0.65, decay_rate=5.0, warmth=0.35, detune_cents=2.0, pitch_slump_hz=0.0, saturation=0.08)

    i1, i2, i3 = int(0.008 * SR), int(0.070 * SR), int(0.138 * SR)
    add_layer(mix, c1, i1, 0.64)
    add_layer(mix, c_body, i2, 0.32)  # subtle physical mass
    add_layer(mix, c2, i2, 0.60)
    add_layer(mix, c3, i3, 0.82)
    add_layer(mix, glint1, i3 + int(0.010 * SR), 0.22)
    add_layer(mix, glint2, i3 + int(0.016 * SR), 0.18)

    # Slightly more spacious reflection
    early = [(6.0, 0.44), (13.0, 0.40), (21.0, 0.32), (30.0, 0.24)]
    ir = make_ceremonial_space(decay_s=0.62, cutoff_hz=7000, early_pattern=early, seed=90)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.22)

    return finalize_tier_master(mix, dur, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.26)


def build_gold():
    """
    GOLD (1.650s): Ceremonial Developed Musical Gesture & Rich Harmonic Body
    Motif: G#5 (10ms) ➔ C#6 (85ms) ➔ F6 (170ms) ➔ G#6 (250ms) with Major 6th A#6 & C#7 halo
    Key Upgrade: 4-step ascending ceremonial gesture; fundamental decay rate drops to 1.25;
                 richer mid-mass body (G#4, C#5); width expands to 1.38x in a small ceremonial hall.
    """
    dur = 1.650
    mix = np.zeros((int(dur * SR), 2))

    # Ceremonial substantial transient
    transient = generate_physical_transient(duration_s=0.044, hardness=1.20, hp_hz=850, seed=110)
    add_layer(mix, transient, 0, 0.96)

    # Deep body resonance on contact and tonic
    c_sub = synth_alloy_tine(415.30, 1.35, decay_rate=2.0, warmth=0.85, detune_cents=1.0, pitch_slump_hz=10.0, saturation=0.20)
    c_mid = synth_alloy_tine(554.37, 1.40, decay_rate=1.8, warmth=0.80, detune_cents=1.2, pitch_slump_hz=12.0, saturation=0.20)

    # 4-Step Ascending Fanfare Gesture:
    # 1. Foundation: G#5 (830.61 Hz)
    # 2. Lift: C#6 (1108.73 Hz)
    # 3. Bright Major 3rd: F6 (1396.91 Hz)
    # 4. Ceremonial Crown: G#6 (1661.22 Hz) blooming with A#6 (1864.66 Hz) & C#7 (2217.46 Hz)
    c1 = synth_alloy_tine(830.61, 1.45, decay_rate=2.8, warmth=0.75, detune_cents=1.5, pitch_slump_hz=18.0, saturation=0.22)
    c2 = synth_alloy_tine(1108.73, 1.45, decay_rate=2.2, warmth=0.70, detune_cents=1.5, pitch_slump_hz=15.0, saturation=0.20)
    c3 = synth_alloy_tine(1396.91, 1.50, decay_rate=1.5, warmth=0.65, detune_cents=1.4, pitch_slump_hz=12.0, saturation=0.18)
    c4 = synth_alloy_tine(1661.22, 1.40, decay_rate=1.25, warmth=0.55, detune_cents=1.6, pitch_slump_hz=8.0, saturation=0.16)

    # Harmonic halo overtones
    halo_6th = synth_alloy_tine(1864.66, 1.05, decay_rate=2.6, warmth=0.45, detune_cents=1.8, pitch_slump_hz=0.0, saturation=0.10)
    halo_oct = synth_alloy_tine(2217.46, 0.95, decay_rate=3.2, warmth=0.40, detune_cents=2.0, pitch_slump_hz=0.0, saturation=0.08)

    i1 = int(0.010 * SR)  # 10 ms
    i2 = int(0.085 * SR)  # 85 ms
    i3 = int(0.170 * SR)  # 170 ms
    i4 = int(0.250 * SR)  # 250 ms (ceremonial crown)

    add_layer(mix, c_sub, i1, 0.35)
    add_layer(mix, c1, i1, 0.62)
    add_layer(mix, c_mid, i2, 0.38)
    add_layer(mix, c2, i2, 0.60)
    add_layer(mix, c3, i3, 0.74)
    add_layer(mix, c4, i4, 0.78)
    add_layer(mix, halo_6th, i4 + int(0.012 * SR), 0.22)
    add_layer(mix, halo_oct, i4 + int(0.020 * SR), 0.20)

    # Small ceremonial hall IR
    early = [(7.0, 0.48), (15.0, 0.44), (25.0, 0.36), (36.0, 0.28), (48.0, 0.22)]
    ir = make_ceremonial_space(decay_s=0.90, cutoff_hz=7200, early_pattern=early, seed=92)
    wet = fftconvolve(c4[:, 0], ir[:, 0])
    wet_r = fftconvolve(c4[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i4, 0.26)

    return finalize_tier_master(mix, dur, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.38)


def build_platinum():
    """
    PLATINUM (2.000s): Magnificent Culmination & Full Harmonic Bloom
    Motif: Physical Impact ➔ Tonal Statement ➔ Ascending Development ➔ Crown ➔ Harmonic Bloom
           Full-spectrum metallic constellation: G#4, C#5, G#5, C#6, F6, G#6, C#7, F7.
    Key Upgrade: Complete harmonic opening outward; fundamental decay rate drops to 0.88;
                 deep physical resonance, shimmering high glints, wide ceremonial space (1.52x),
                 0.7s gentle dissolving ceremonial decay.
    """
    dur = 2.000
    mix = np.zeros((int(dur * SR), 2))

    # Authoritative, polished physical impact
    transient = generate_physical_transient(duration_s=0.052, hardness=1.15, hp_hz=720, seed=112)
    add_layer(mix, transient, 0, 0.98)

    # Substantial physical mass undertones
    deep_g = synth_alloy_tine(415.30, 1.75, decay_rate=1.4, warmth=0.90, detune_cents=1.0, pitch_slump_hz=12.0, saturation=0.22)
    deep_c = synth_alloy_tine(554.37, 1.80, decay_rate=1.2, warmth=0.85, detune_cents=1.2, pitch_slump_hz=14.0, saturation=0.22)

    # Complete Herald Phrase:
    # 1. Statement: G#5 (830.61 Hz) ➔ C#6 (1108.73 Hz)
    # 2. Development: F6 (1396.91 Hz)
    # 3. Resolution: G#6 (1661.22 Hz)
    c1 = synth_alloy_tine(830.61, 1.80, decay_rate=2.2, warmth=0.78, detune_cents=1.5, pitch_slump_hz=20.0, saturation=0.24)
    c2 = synth_alloy_tine(1108.73, 1.80, decay_rate=1.7, warmth=0.72, detune_cents=1.5, pitch_slump_hz=16.0, saturation=0.22)
    c3 = synth_alloy_tine(1396.91, 1.85, decay_rate=1.2, warmth=0.68, detune_cents=1.4, pitch_slump_hz=13.0, saturation=0.20)
    c4 = synth_alloy_tine(1661.22, 1.85, decay_rate=0.88, warmth=0.60, detune_cents=1.6, pitch_slump_hz=10.0, saturation=0.18)

    # The Platinum Bloom (Sympathetic Constellation Overtones):
    # C#7 (2217.46 Hz) & F7 (2793.83 Hz, crystalline Major 3rd sky glint)
    bloom_c7 = synth_alloy_tine(2217.46, 1.45, decay_rate=1.6, warmth=0.45, detune_cents=2.0, pitch_slump_hz=0.0, saturation=0.12)
    bloom_f7 = synth_alloy_tine(2793.83, 1.25, decay_rate=2.2, warmth=0.40, detune_cents=2.2, pitch_slump_hz=0.0, saturation=0.10)

    # Sympathetic chord bed (the metal resonates throughout the space)
    sym_bed = synth_alloy_tine(1108.73, 1.65, decay_rate=0.95, warmth=0.60, detune_cents=2.5, pitch_slump_hz=0.0, saturation=0.15)

    i1 = int(0.010 * SR)  # 10 ms
    i2 = int(0.080 * SR)  # 80 ms
    i3 = int(0.160 * SR)  # 160 ms
    i4 = int(0.240 * SR)  # 240 ms
    i_bloom = int(0.330 * SR)  # 330 ms (the bloom opens outward)

    add_layer(mix, deep_g, i1, 0.40)
    add_layer(mix, c1, i1, 0.60)
    add_layer(mix, deep_c, i2, 0.45)
    add_layer(mix, c2, i2, 0.62)
    add_layer(mix, c3, i3, 0.74)
    add_layer(mix, c4, i4, 0.82)
    add_layer(mix, sym_bed, i_bloom, 0.35)
    add_layer(mix, bloom_c7, i_bloom, 0.26)
    add_layer(mix, bloom_f7, i_bloom + int(0.020 * SR), 0.20)

    # Expansive ceremonial acoustic field
    early = [(8.0, 0.50), (18.0, 0.46), (29.0, 0.38), (42.0, 0.30), (58.0, 0.24), (75.0, 0.18)]
    ir = make_ceremonial_space(decay_s=1.35, cutoff_hz=7500, early_pattern=early, seed=95)
    wet = fftconvolve(mix[:, 0], ir[:, 0])
    wet_r = fftconvolve(mix[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i4, 0.30)

    return finalize_tier_master(mix, dur, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.52)


# ==============================================================================
# Suite Manifest & Exporter
# ==============================================================================

TIERS = [
    {
        "id": "bronze",
        "title": "Bronze Trophy",
        "tier_name": "Bronze",
        "badge": "Baseline Intimate",
        "duration": 1.000,
        "notes": "G#5 ➔ C#6 ➔ F6 (Major 3rd)",
        "character": "Small, beautifully manufactured metal medallion struck once with precision. Crisp physical transient, bright Major 3rd resolution, intimate room.",
        "builder": build_bronze,
    },
    {
        "id": "silver",
        "title": "Silver Trophy",
        "tier_name": "Silver",
        "badge": "Extended Resonance",
        "duration": 1.320,
        "notes": "G#5 ➔ C#6 ➔ F6 + C#7 Sympathetic",
        "character": "More substantial precious object. Same core motif vibrating naturally for longer with sympathetic upper overtones and wider stereo presence.",
        "builder": build_silver,
    },
    {
        "id": "gold",
        "title": "Gold Trophy",
        "tier_name": "Gold",
        "badge": "Ceremonial Herald",
        "duration": 1.650,
        "notes": "G#5 ➔ C#6 ➔ F6 ➔ G#6 (A#6 & C#7 Halo)",
        "character": "Ceremonial treasure. 4-step ascending fanfare phrase, rich mid-body mass, luxurious sustain, and small ceremonial acoustic hall.",
        "builder": build_gold,
    },
    {
        "id": "platinum",
        "title": "Platinum Trophy",
        "tier_name": "Platinum",
        "badge": "Magnificent Bloom",
        "duration": 2.000,
        "notes": "Full Constellation: G#4 ➔ C#5 ➔ G#5 ➔ C#6 ➔ F6 ➔ G#6 ➔ C#7 ➔ F7",
        "character": "The ultimate achievement. The physical sound blooms outward into a full-spectrum metallic constellation with deep resonance and 0.7s dissolving decay.",
        "builder": build_platinum,
    },
]


def render_all_tiers():
    """Renders all 4 tiers, exports WAVs/MP3s to target directories, and builds interactive player."""
    os.makedirs(THEME_DIR, exist_ok=True)
    os.makedirs(ALTS_DIR, exist_ok=True)
    sfx_dir = os.path.join(THEME_DIR, "sfx")
    os.makedirs(sfx_dir, exist_ok=True)

    rendered_data = []

    print("\n" + "="*70)
    print("STEAMSTATION 4-TIER TROPHY SUITE SYNTHESIS (TITANIUM-ALLOY DNA)")
    print("="*70)

    for item in TIERS:
        print(f"Rendering [{item['tier_name'].upper()}] (Target: {item['duration']:.2f}s)...")
        audio = item["builder"]()
        dur = len(audio) / SR

        pk = np.max(np.abs(audio))
        pk_db = 20 * np.log10(max(1e-6, pk))
        act_mask = np.abs(audio).max(axis=1) > (pk * 0.05)
        rms = np.sqrt(np.mean(audio[act_mask]**2)) if np.any(act_mask) else 1e-4
        rms_db = 20 * np.log10(max(1e-6, rms))

        # Downsample waveform (100 points)
        mono = np.mean(audio, axis=1)
        pts = 100
        chunk = len(mono) // pts
        wf = [round(float(np.max(np.abs(mono[i*chunk:(i+1)*chunk]))), 3) for i in range(pts)]

        pcm = np.clip(audio, -1.0, 1.0).astype(np.float32).tobytes()

        # Destination paths:
        # 1. Main root: {tier}.wav and {tier}.mp3
        # 2. SFX alias: steamstation_{tier}.wav and steamstation_{tier}.mp3
        tier_id = item["id"]
        main_wav = os.path.join(THEME_DIR, f"{tier_id}.wav")
        main_mp3 = os.path.join(THEME_DIR, f"{tier_id}.mp3")
        sfx_wav = os.path.join(sfx_dir, f"steamstation_{tier_id}.wav")
        sfx_mp3 = os.path.join(sfx_dir, f"steamstation_{tier_id}.mp3")

        targets = [
            (main_wav, main_mp3),
            (sfx_wav, sfx_mp3),
        ]

        if tier_id == "bronze":
            # Also keep bronze_alt_08_titanium synced
            alt_wav = os.path.join(ALTS_DIR, "bronze_alt_08_titanium.wav")
            alt_mp3 = os.path.join(ALTS_DIR, "bronze_alt_08_titanium.mp3")
            targets.append((alt_wav, alt_mp3))

        for w_p, m_p in targets:
            subprocess.run(
                [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
                 "-c:a", "pcm_s24le", w_p],
                input=pcm, check=True
            )
            subprocess.run(
                [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
                 "-c:a", "libmp3lame", "-b:a", "320k", m_p],
                input=pcm, check=True
            )

        with open(main_wav, "rb") as f:
            wav_b64 = base64.b64encode(f.read()).decode("ascii")

        rendered_data.append({
            "id": tier_id,
            "title": item["title"],
            "tier_name": item["tier_name"],
            "badge": item["badge"],
            "duration": round(dur, 3),
            "notes": item["notes"],
            "character": item["character"],
            "peak_db": round(pk_db, 1),
            "rms_db": round(rms_db, 1),
            "wav_filename": f"{tier_id}.wav",
            "mp3_filename": f"{tier_id}.mp3",
            "waveform": wf,
            "wav_b64": wav_b64,
        })

        print(f"  [OK] {item['tier_name'].upper():8s} -> {dur:.3f}s | Peak: {pk_db:+.1f} dBFS | RMS: {rms_db:+.1f} dBFS")

    html_path = os.path.join(THEME_DIR, "preview_trophy_progression.html")
    generate_progression_html(rendered_data, html_path)

    print("\n" + "="*70)
    print("TROPHY PROGRESSION SUITE MASTERED SUCCESSFULLY!")
    print(f"Interactive Player: {html_path}")
    print("="*70 + "\n")
    return rendered_data


def generate_progression_html(items, output_path):
    """Generates the interactive 4-tier comparison suite with full sequential playback."""
    json_items = json.dumps(items)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation — 4-Tier Trophy Audio Progression Suite</title>
<style>
  :root {{
    --bg: #080b10;
    --card: #111622;
    --card-hover: #161d2d;
    --border: #1f2738;
    --text: #e6edf3;
    --sub: #8b949e;
    --bronze: #cd7f32;
    --silver: #c0c6cc;
    --gold: #e5a93c;
    --platinum: #40c4ff;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 30px 20px 60px;
    display: flex;
    justify-content: center;
  }}
  .container {{
    max-width: 900px;
    width: 100%;
  }}
  .header {{
    text-align: center;
    margin-bottom: 24px;
  }}
  .badge-top {{
    display: inline-block;
    padding: 5px 14px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    background: rgba(64, 196, 255, 0.15);
    color: var(--platinum);
    border: 1px solid rgba(64, 196, 255, 0.35);
    margin-bottom: 12px;
  }}
  h1 {{ font-size: 28px; font-weight: 700; margin-bottom: 8px; }}
  .subtitle {{ color: var(--sub); font-size: 14px; max-width: 680px; margin: 0 auto; line-height: 1.5; }}

  .progression-banner {{
    background: linear-gradient(135deg, #131a29, #1b2438);
    border: 1px solid #2d3b55;
    border-radius: 12px;
    padding: 16px 20px;
    margin: 20px 0 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }}
  .prog-text {{
    display: flex;
    flex-direction: column;
    gap: 4px;
  }}
  .prog-title {{
    font-size: 15px;
    font-weight: 700;
    color: #fff;
  }}
  .prog-desc {{
    font-size: 12px;
    color: var(--sub);
  }}
  .btn-sequence {{
    background: linear-gradient(135deg, #0070d1, #40c4ff);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(64, 196, 255, 0.3);
    transition: transform 0.12s ease;
  }}
  .btn-sequence:hover {{ transform: scale(1.03); }}
  .btn-sequence:active {{ transform: scale(0.97); }}

  .tier-list {{
    display: flex;
    flex-direction: column;
    gap: 16px;
  }}
  .tier-card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 22px;
    display: flex;
    align-items: center;
    gap: 18px;
    transition: all 0.15s ease;
    cursor: pointer;
  }}
  .tier-card:hover {{
    background: var(--card-hover);
    border-color: #313d54;
    transform: translateY(-1px);
  }}
  .tier-card.bronze {{ border-left: 5px solid var(--bronze); }}
  .tier-card.silver {{ border-left: 5px solid var(--silver); }}
  .tier-card.gold {{ border-left: 5px solid var(--gold); }}
  .tier-card.platinum {{ border-left: 5px solid var(--platinum); }}

  .tier-card.active {{
    box-shadow: 0 6px 24px rgba(0,0,0,0.6);
    background: #171f2f;
  }}
  .tier-card.bronze.active {{ border-color: var(--bronze); }}
  .tier-card.silver.active {{ border-color: var(--silver); }}
  .tier-card.gold.active {{ border-color: var(--gold); }}
  .tier-card.platinum.active {{ border-color: var(--platinum); }}

  .btn-play {{
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: none;
    color: #fff;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.1s ease;
  }}
  .btn-play:hover {{ transform: scale(1.08); }}
  .btn-play:active {{ transform: scale(0.95); }}
  .bronze .btn-play {{ background: linear-gradient(135deg, #cd7f32, #e09858); box-shadow: 0 2px 10px rgba(205,127,50,0.4); }}
  .silver .btn-play {{ background: linear-gradient(135deg, #9aa2a8, #d0d5d9); box-shadow: 0 2px 10px rgba(192,198,204,0.4); }}
  .gold .btn-play {{ background: linear-gradient(135deg, #c78f24, #f5c45b); box-shadow: 0 2px 10px rgba(229,169,60,0.4); }}
  .platinum .btn-play {{ background: linear-gradient(135deg, #0288d1, #40c4ff); box-shadow: 0 2px 10px rgba(64,196,255,0.4); }}

  .tier-info {{
    flex-grow: 1;
    min-width: 0;
  }}
  .tier-head {{
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }}
  .tier-title {{
    font-size: 17px;
    font-weight: 700;
    color: #fff;
  }}
  .tag-badge {{
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 600;
  }}
  .bronze .tag-badge {{ background: rgba(205,127,50,0.15); color: #e09858; border: 1px solid rgba(205,127,50,0.35); }}
  .silver .tag-badge {{ background: rgba(192,198,204,0.15); color: #d0d5d9; border: 1px solid rgba(192,198,204,0.35); }}
  .gold .tag-badge {{ background: rgba(229,169,60,0.15); color: #f5c45b; border: 1px solid rgba(229,169,60,0.35); }}
  .platinum .tag-badge {{ background: rgba(64,196,255,0.15); color: #80d8ff; border: 1px solid rgba(64,196,255,0.35); }}

  .tag-dur {{
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: #1b2333;
    color: #9ec5fe;
    font-family: monospace;
    font-weight: 600;
  }}
  .tier-desc {{
    font-size: 13px;
    color: var(--sub);
    line-height: 1.45;
    margin-bottom: 6px;
  }}
  .tier-notes {{
    font-size: 12px;
    color: #8b949e;
    font-family: monospace;
  }}
  .tier-notes b {{ color: #c9d1d9; }}

  .wf-box {{
    width: 150px;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    background: #080b10;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid #1a2336;
  }}
  .bar {{
    flex: 1;
    border-radius: 1px;
    opacity: 0.6;
    transition: opacity 0.1s ease, height 0.1s ease;
  }}
  .bronze .bar {{ background: var(--bronze); }}
  .silver .bar {{ background: var(--silver); }}
  .gold .bar {{ background: var(--gold); }}
  .platinum .bar {{ background: var(--platinum); }}
  .tier-card.active .bar {{ opacity: 1; }}

  .footer-links {{
    text-align: center;
    margin-top: 32px;
    font-size: 13px;
    color: var(--sub);
  }}
  .footer-links a {{
    color: #58a6ff;
    text-decoration: none;
    margin: 0 10px;
  }}
  .footer-links a:hover {{ text-decoration: underline; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="badge-top">Authoritative Suite Evolution</div>
    <h1>SteamStation Trophy Audio Suite</h1>
    <p class="subtitle">
      One shared physical titanium-alloy material and C# Major musical DNA, progressively evolved through resonance, harmonic richness, musical development, spatial scale, and decay.
    </p>
  </div>

  <div class="progression-banner">
    <div class="prog-text">
      <div class="prog-title">▶ Full Trophy Progression Audition</div>
      <div class="prog-desc">Listen to all four tiers in sequence: Bronze (1.0s) &rarr; Silver (1.3s) &rarr; Gold (1.6s) &rarr; Platinum (2.0s).</div>
    </div>
    <button class="btn-sequence" id="btnSequence" onclick="playSequence()">▶ Play Full Progression</button>
  </div>

  <div class="tier-list" id="tierList"></div>

  <div class="footer-links">
    <a href="preview_bronze_alternatives.html">&larr; 10 Bronze Alternatives Explorer</a> &bull;
    <a href="sfx/preview.html">Classic & Hybrid Soundboard</a>
  </div>
</div>

<audio id="player"></audio>

<script>
  const tiers = {json_items};
  const list = document.getElementById('tierList');
  const player = document.getElementById('player');
  const seqBtn = document.getElementById('btnSequence');
  let isSequencePlaying = false;
  let sequenceIndex = 0;

  tiers.forEach((item, idx) => {{
    const card = document.createElement('div');
    card.className = `tier-card ${{item.id}}`;
    card.id = `card-${{item.id}}`;

    let barsHtml = '';
    item.waveform.forEach(val => {{
      const h = Math.max(8, Math.min(100, Math.pow(val, 0.6) * 100));
      barsHtml += `<div class="bar" style="height:${{h}}%"></div>`;
    }});

    card.innerHTML = `
      <button class="btn-play" onclick="playTier(${{idx}}, event)">▶</button>
      <div class="tier-info" onclick="playTier(${{idx}}, event)">
        <div class="tier-head">
          <span class="tier-title">${{item.title}}</span>
          <span class="tag-badge">${{item.badge}}</span>
          <span class="tag-dur">${{item.duration}}s</span>
        </div>
        <div class="tier-desc">${{item.character}}</div>
        <div class="tier-notes"><b>Motif:</b> ${{item.notes}} &bull; <b>Ceiling:</b> ${{item.peak_db}} dBFS &bull; <b>RMS:</b> ${{item.rms_db}} dBFS</div>
      </div>
      <div class="wf-box" onclick="playTier(${{idx}}, event)">
        ${{barsHtml}}
      </div>
    `;

    list.appendChild(card);
  }});

  function playTier(idx, e) {{
    if (e) e.stopPropagation();
    isSequencePlaying = false;
    seqBtn.textContent = '▶ Play Full Progression';

    const item = tiers[idx];
    document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`card-${{item.id}}`);
    if (card) card.classList.add('active');

    player.src = 'data:audio/wav;base64,' + item.wav_b64;
    player.currentTime = 0;
    player.play();
  }}

  function playSequence() {{
    if (isSequencePlaying) {{
      player.pause();
      isSequencePlaying = false;
      seqBtn.textContent = '▶ Play Full Progression';
      document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
      return;
    }}

    isSequencePlaying = true;
    sequenceIndex = 0;
    seqBtn.textContent = '❚❚ Stop Progression';
    runNextSequenceStep();
  }}

  function runNextSequenceStep() {{
    if (!isSequencePlaying || sequenceIndex >= tiers.length) {{
      isSequencePlaying = false;
      seqBtn.textContent = '▶ Play Full Progression';
      document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
      return;
    }}

    const idx = sequenceIndex;
    const item = tiers[idx];
    document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`card-${{item.id}}`);
    if (card) card.classList.add('active');

    player.src = 'data:audio/wav;base64,' + item.wav_b64;
    player.currentTime = 0;
    player.play();

    player.onended = () => {{
      if (!isSequencePlaying) return;
      sequenceIndex++;
      setTimeout(() => {{
        runNextSequenceStep();
      }}, 550); // 550ms breath between tiers
    }};
  }}

  player.onended = () => {{
    if (!isSequencePlaying) {{
      document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
    }}
  }};

  window.addEventListener('keydown', (e) => {{
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key >= '1' && e.key <= '4') {{
      playTier(parseInt(e.key) - 1);
    }} else if (e.code === 'Space') {{
      e.preventDefault();
      playSequence();
    }}
  }});
</script>
</body>
</html>
"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    render_all_tiers()
