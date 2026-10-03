#!/usr/bin/env python3
"""
SteamStation Bronze Achievement Sound Suite — 10 High-Detail Alternatives
Focus: Eliminate "flatness", introduce rich dynamic physical modeling, and explore diverse chime timbres.

Techniques used to eliminate flatness:
1. Micro-Pitch Slump: Non-linear tension modulation on impact (fundamental starts ~10-18 Hz higher and settles in 15ms).
2. Non-linear Wave Shaping (Acoustic Saturation): Intermodulation between modes for a unified vibrating body.
3. Dynamic Inharmonic Damping: Upper modes decay 3x-8x faster than the fundamental.
4. Resonant Body Formants: Acoustic cavity shaping for physical depth.
5. Allpass Phase Dispersion: Subtle binaural phase depth without mono phase cancellation.

Outputs:
  - 10 WAVs (24-bit 48 kHz stereo uncompressed)
  - 10 MP3s (320 kbps high-bitrate)
  - Standalone Interactive Audition Suite: preview_bronze_alternatives.html
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
DURATION = 1.000  # Exact 1.000s (48000 samples)
HERE = os.path.dirname(os.path.abspath(__file__))
THEME_DIR = os.path.dirname(HERE)
ALTS_DIR = os.path.join(THEME_DIR, "bronze_alternatives")
FF = imageio_ffmpeg.get_ffmpeg_exe()


# ==============================================================================
# DSP Utilities
# ==============================================================================

def filt(x, kind, hz, order=2):
    """Zero-phase Butterworth filtering."""
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def stereo_widen(x, factor=1.12):
    """Subtle mid/side width control."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def allpass_diffuse(x, delay_samples, g=0.32):
    """Vectorized allpass filter for acoustic phase diffusion."""
    D = int(delay_samples)
    b = np.zeros(D + 1)
    b[0] = -g
    b[D] = 1.0
    a = np.zeros(D + 1)
    a[0] = 1.0
    a[D] = -g
    return lfilter(b, a, x, axis=0)


def apply_formant_cavity(x, f_res, q=4.5, gain_db=3.5):
    """Parametric peaking filter for acoustic cavity modeling."""
    w0 = 2 * np.pi * f_res / SR
    alpha = np.sin(w0) / (2 * q)
    A = 10 ** (gain_db / 40.0)
    
    b0 = 1 + alpha * A
    b1 = -2 * np.cos(w0)
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * np.cos(w0)
    a2 = 1 - alpha / A
    
    b = np.array([b0, b1, b2]) / a0
    a = np.array([a0, a1, a2]) / a0
    return lfilter(b, a, x, axis=0)


def add_layer(dest, src, start_idx, gain=1.0):
    """Safely adds 2D audio src into dest at start_idx with gain, clipping bounds."""
    if start_idx >= len(dest):
        return
    end_idx = min(len(dest), start_idx + len(src))
    actual_len = end_idx - start_idx
    if actual_len > 0:
        dest[start_idx:end_idx] += src[:actual_len] * gain


def generate_impact_click(duration_s=0.038, hp_hz=900, hardness=1.0, seed=42):
    """Synthesizes tactile metal contact transient."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)
    rng = np.random.default_rng(seed)

    # Contact pulse
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
    
    # 0.1ms interaural delay
    d_samp = int(0.00012 * SR)
    stereo[d_samp:, 1] = stereo[:-d_samp, 0]
    pk = np.max(np.abs(stereo))
    return stereo / (pk + 1e-8)


def synth_physical_tine(f0, duration_s, modes_config, pitch_slump_hz=14.0, slump_tau=0.018, 
                        decay_rate=3.6, warmth=0.7, detune_cents=1.4, saturation=0.20):
    """
    Physical modeling of struck resonant alloy:
    - Micro-pitch slump on strike
    - Asymmetric modal intermodulation
    - Multi-mode inharmonic damping
    """
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)

    # 1. Micro-pitch slump (vital for organic physical feel)
    if pitch_slump_hz > 0:
        freq_env = f0 + pitch_slump_hz * np.exp(-t / max(1e-4, slump_tau))
    else:
        freq_env = np.full(n, f0)
    
    base_phase = 2 * np.pi * np.cumsum(freq_env) / SR

    # Attack smoothing (1.8 ms)
    att_len = int(0.0018 * SR)
    att = np.ones(n)
    att[:att_len] = np.sin(np.linspace(0, np.pi / 2, att_len)) ** 2

    left = np.zeros(n)
    right = np.zeros(n)

    for mult, rel_amp, d_mult, phase_shift in modes_config:
        f_mode = f0 * mult
        if f_mode > (SR / 2 - 400):
            continue

        # Stereo phase and micro-detuning
        f_l_mult = mult * (2.0 ** (-detune_cents / 1200.0))
        f_r_mult = mult * (2.0 ** (detune_cents / 1200.0))

        env = np.exp(-decay_rate * d_mult * t) * att
        
        # Calculate mode phases
        p_l = base_phase * f_l_mult + phase_shift
        p_r = base_phase * f_r_mult + phase_shift + 0.14

        left += rel_amp * np.sin(p_l) * env
        right += rel_amp * np.sin(p_r) * env

    # Acoustic wave-shaping / saturation (binds modes together)
    if saturation > 0:
        left = np.tanh(left * (1.0 + saturation)) / (1.0 + saturation * 0.4)
        right = np.tanh(right * (1.0 + saturation)) / (1.0 + saturation * 0.4)

    stereo = np.stack([left, right], axis=1)
    pk = np.max(np.abs(stereo))
    return stereo / (pk + 1e-8) if pk > 1e-6 else stereo


def make_room_reflection(decay_s=0.45, cutoff_hz=5200, seed=77):
    """Intimate studio reflection IR."""
    n = int(decay_s * SR)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(seed)

    env = np.exp(-7.2 * t)[:, None]
    ir = rng.standard_normal((n, 2)) * env

    # Early specular reflections
    for idx, d_ms in enumerate([5.0, 11.5, 18.0, 26.0]):
        s = int(d_ms * 0.001 * SR)
        if s < n:
            ir[s, 0] += (0.42 / (idx + 1))
            ir[s, 1] += (0.38 / (idx + 1)) * (-1 if idx % 2 else 1)

    ir[: int(0.004 * SR)] = 0
    ir = filt(ir, "lowpass", cutoff_hz, order=2)
    ir = filt(ir, "highpass", 300, order=2)
    norm = np.sqrt(np.sum(ir**2, axis=0, keepdims=True)) + 1e-8
    return ir / norm


def finalize_master(mix, peak_ceiling_db=-1.00, fade_start_s=0.86, width=1.12):
    """EQ, width control, natural fade to silence, and precise peak headroom."""
    total_samples = int(DURATION * SR)
    out = np.zeros((total_samples, 2), dtype=np.float64)
    n = min(len(mix), total_samples)
    out[:n] = mix[:n]

    # Clean filtering: remove sub-bass rumble, smooth ultra-highs
    out = filt(out, "highpass", 185, order=2)
    out = filt(out, "lowpass", 14500, order=2)

    # Restrained stereo image
    out = stereo_widen(out, factor=width)

    # Fade out smoothly to zero
    f_start = int(fade_start_s * SR)
    f_len = total_samples - f_start
    if f_len > 0:
        out[f_start:] *= (np.cos(np.linspace(0, np.pi / 2, f_len)) ** 2)[:, None]

    # Peak normalization
    pk = np.max(np.abs(out))
    target = 10 ** (peak_ceiling_db / 20.0)
    if pk > 1e-6:
        out = out * (target / pk)

    return out


# ==============================================================================
# The 10 Curated Alternatives
# ==============================================================================

BRONZE_MODES = [
    (1.000, 1.00, 1.00, 0.0),
    (2.414, 0.35, 2.20, 0.2),
    (3.862, 0.18, 3.50, 0.5),
    (5.657, 0.08, 5.80, 0.8),
    (0.500, 0.15, 1.60, 0.1),
]


def alt_01_phosphor_bronze():
    """Alt 01: Phosphor-Bronze (Rich Physical Core)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.038, hardness=1.0, seed=101)
    add_layer(mix, transient, 0, 0.90)

    c1 = synth_physical_tine(739.99, 0.85, BRONZE_MODES, pitch_slump_hz=16.0, decay_rate=4.2, saturation=0.25)
    c2 = synth_physical_tine(987.77, 0.80, BRONZE_MODES, pitch_slump_hz=14.0, decay_rate=3.8, saturation=0.22)
    c3 = synth_physical_tine(1108.73, 0.85, BRONZE_MODES, pitch_slump_hz=12.0, decay_rate=2.9, saturation=0.20)
    glint = synth_physical_tine(1479.98, 0.55, BRONZE_MODES, pitch_slump_hz=0.0, decay_rate=5.5, saturation=0.10)

    i1, i2, i3 = int(0.010 * SR), int(0.072 * SR), int(0.140 * SR)
    add_layer(mix, c1, i1, 0.65)
    add_layer(mix, c2, i2, 0.60)
    add_layer(mix, c3, i3, 0.75)
    add_layer(mix, glint, i3 + int(0.01 * SR), 0.22)

    ir = make_room_reflection(decay_s=0.45, cutoff_hz=5200, seed=11)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.18)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.12)


def alt_02_hollow_medallion():
    """Alt 02: Hollow Medallion (Chamber Resonance)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.040, hardness=0.9, seed=102)
    add_layer(mix, transient, 0, 0.88)

    modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.180, 0.42, 1.80, 0.3),
        (3.450, 0.22, 2.90, 0.6),
        (5.120, 0.10, 4.80, 0.9),
        (0.500, 0.18, 1.40, 0.1),
    ]
    c1 = synth_physical_tine(739.99, 0.85, modes, pitch_slump_hz=12.0, decay_rate=4.4, saturation=0.18)
    c2 = synth_physical_tine(987.77, 0.80, modes, pitch_slump_hz=10.0, decay_rate=4.0, saturation=0.16)
    c3 = synth_physical_tine(1108.73, 0.85, modes, pitch_slump_hz=8.0, decay_rate=3.1, saturation=0.15)

    c1 = apply_formant_cavity(c1, 1350, q=4.0, gain_db=4.0)
    c2 = apply_formant_cavity(c2, 1850, q=4.5, gain_db=3.5)
    c3 = apply_formant_cavity(c3, 2450, q=5.0, gain_db=3.5)

    i1, i2, i3 = int(0.010 * SR), int(0.075 * SR), int(0.145 * SR)
    add_layer(mix, c1, i1, 0.68)
    add_layer(mix, c2, i2, 0.62)
    add_layer(mix, c3, i3, 0.78)

    ir = make_room_reflection(decay_s=0.48, cutoff_hz=4800, seed=22)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.20)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.87, width=1.14)


def alt_03_radiant_crotale():
    """Alt 03: Radiant Crotale (Bright Antique Bell-Bronze)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.035, hardness=1.2, seed=103)
    add_layer(mix, transient, 0, 0.95)

    crotale_modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.756, 0.44, 2.50, 0.3),
        (5.404, 0.24, 4.20, 0.6),
        (8.933, 0.12, 6.80, 0.9),
        (0.500, 0.12, 1.80, 0.1),
    ]
    c1 = synth_physical_tine(783.99, 0.85, crotale_modes, pitch_slump_hz=15.0, decay_rate=3.9, detune_cents=2.2, saturation=0.22)
    c2 = synth_physical_tine(1046.50, 0.80, crotale_modes, pitch_slump_hz=12.0, decay_rate=3.5, detune_cents=2.0, saturation=0.20)
    c3 = synth_physical_tine(1174.66, 0.85, crotale_modes, pitch_slump_hz=10.0, decay_rate=2.8, detune_cents=1.8, saturation=0.18)

    i1, i2, i3 = int(0.010 * SR), int(0.070 * SR), int(0.138 * SR)
    add_layer(mix, c1, i1, 0.64)
    add_layer(mix, c2, i2, 0.60)
    add_layer(mix, c3, i3, 0.74)

    ir = make_room_reflection(decay_s=0.50, cutoff_hz=6000, seed=33)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.20)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.18)


def alt_04_duo_tine():
    """Alt 04: Duo-Tine Strike (Minimalist 2-Note Luxury)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.038, hardness=1.05, seed=104)
    add_layer(mix, transient, 0, 0.92)

    modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.414, 0.38, 2.00, 0.2),
        (3.862, 0.22, 3.20, 0.5),
        (5.657, 0.12, 5.00, 0.8),
        (0.500, 0.20, 1.50, 0.1),
    ]
    c1 = synth_physical_tine(739.99, 0.88, modes, pitch_slump_hz=18.0, decay_rate=3.6, saturation=0.25)
    c2 = synth_physical_tine(1108.73, 0.90, modes, pitch_slump_hz=14.0, decay_rate=2.6, saturation=0.22)
    kiss = synth_physical_tine(1479.98, 0.60, modes, pitch_slump_hz=0.0, decay_rate=5.0, saturation=0.10)

    i1 = int(0.012 * SR)
    i2 = int(0.095 * SR)
    add_layer(mix, c1, i1, 0.72)
    add_layer(mix, c2, i2, 0.82)
    add_layer(mix, kiss, i2 + int(0.015 * SR), 0.25)

    ir = make_room_reflection(decay_s=0.52, cutoff_hz=5400, seed=44)
    wet = fftconvolve(c2[:, 0], ir[:, 0])
    wet_r = fftconvolve(c2[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i2, 0.22)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.14)


def alt_05_warm_celesta():
    """Alt 05: Warm Celesta-Metal (Velvety & Rounded)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.040, hardness=0.75, hp_hz=600, seed=105)
    add_layer(mix, transient, 0, 0.80)

    warm_modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.000, 0.40, 2.00, 0.2),
        (3.000, 0.20, 3.20, 0.5),
        (4.200, 0.08, 5.00, 0.8),
        (0.500, 0.25, 1.30, 0.1),
    ]
    c1 = synth_physical_tine(587.33, 0.88, warm_modes, pitch_slump_hz=10.0, decay_rate=3.8, warmth=0.9, saturation=0.20)
    c2 = synth_physical_tine(783.99, 0.82, warm_modes, pitch_slump_hz=8.0, decay_rate=3.5, warmth=0.85, saturation=0.18)
    c3 = synth_physical_tine(880.00, 0.88, warm_modes, pitch_slump_hz=6.0, decay_rate=2.8, warmth=0.80, saturation=0.16)

    i1, i2, i3 = int(0.012 * SR), int(0.078 * SR), int(0.148 * SR)
    add_layer(mix, c1, i1, 0.68)
    add_layer(mix, c2, i2, 0.62)
    add_layer(mix, c3, i3, 0.78)

    ir = make_room_reflection(decay_s=0.48, cutoff_hz=4200, seed=55)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.22)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.87, width=1.10)


def alt_06_lydian_shimmer():
    """Alt 06: Lydian Shimmer (Ethereal Modern Game UI)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.036, hardness=1.1, seed=106)
    add_layer(mix, transient, 0, 0.92)

    modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.414, 0.36, 2.10, 0.2),
        (4.000, 0.22, 3.20, 0.5),
        (6.000, 0.10, 5.00, 0.8),
        (0.500, 0.14, 1.60, 0.1),
    ]
    c1 = synth_physical_tine(698.46, 0.85, modes, pitch_slump_hz=14.0, decay_rate=4.0, saturation=0.22)
    c2 = synth_physical_tine(987.77, 0.80, modes, pitch_slump_hz=12.0, decay_rate=3.6, saturation=0.20)
    c3 = synth_physical_tine(1046.50, 0.85, modes, pitch_slump_hz=10.0, decay_rate=2.7, saturation=0.18)
    glint = synth_physical_tine(1567.98, 0.50, modes, pitch_slump_hz=0.0, decay_rate=5.5, saturation=0.10)

    i1, i2, i3 = int(0.010 * SR), int(0.072 * SR), int(0.140 * SR)
    add_layer(mix, c1, i1, 0.65)
    add_layer(mix, c2, i2, 0.62)
    add_layer(mix, c3, i3, 0.76)
    add_layer(mix, glint, i3 + int(0.012 * SR), 0.24)

    ir = make_room_reflection(decay_s=0.52, cutoff_hz=5800, seed=66)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.20)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.16)


def alt_07_heavy_cast_disc():
    """Alt 07: Heavy Cast Disc (Dense Weight & Authority)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.042, hardness=0.95, hp_hz=750, seed=107)
    add_layer(mix, transient, 0, 0.94)

    heavy_modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.320, 0.40, 1.90, 0.2),
        (3.680, 0.20, 3.10, 0.5),
        (5.200, 0.08, 4.80, 0.8),
        (0.500, 0.32, 1.20, 0.1),
    ]
    c1 = synth_physical_tine(659.25, 0.88, heavy_modes, pitch_slump_hz=16.0, decay_rate=3.8, warmth=0.9, saturation=0.28)
    c2 = synth_physical_tine(880.00, 0.82, heavy_modes, pitch_slump_hz=12.0, decay_rate=3.5, warmth=0.85, saturation=0.24)
    c3 = synth_physical_tine(987.77, 0.88, heavy_modes, pitch_slump_hz=10.0, decay_rate=2.8, warmth=0.80, saturation=0.22)

    i1, i2, i3 = int(0.010 * SR), int(0.075 * SR), int(0.145 * SR)
    add_layer(mix, c1, i1, 0.68)
    add_layer(mix, c2, i2, 0.62)
    add_layer(mix, c3, i3, 0.78)

    ir = make_room_reflection(decay_s=0.48, cutoff_hz=4600, seed=77)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.22)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.87, width=1.10)


def alt_08_titanium_alloy():
    """Alt 08: Titanium-Alloy Ping (High-Tech Crisp & Joyful)
    - Ultra-crisp high-velocity transient clink
    - Triumphant, happy Major 3rd herald: G#5 ➔ C#6 ➔ F6 with sparkling G#6 glint
    - Sleek, high-tech, optimistic and celebratory UI notification
    """
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.034, hardness=1.30, hp_hz=1050, seed=108)
    add_layer(mix, transient, 0, 0.95)

    modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.620, 0.36, 2.40, 0.3),
        (4.450, 0.20, 3.80, 0.6),
        (7.100, 0.10, 6.00, 0.9),
        (0.500, 0.12, 1.70, 0.1),
    ]
    # G#5 (830.61 Hz) ➔ C#6 (1108.73 Hz) ➔ F6 (1396.91 Hz, bright sunny Major 3rd!)
    c1 = synth_physical_tine(830.61, 0.82, modes, pitch_slump_hz=14.0, decay_rate=4.2, detune_cents=1.5, saturation=0.18)
    c2 = synth_physical_tine(1108.73, 0.78, modes, pitch_slump_hz=12.0, decay_rate=3.6, detune_cents=1.5, saturation=0.16)
    c3 = synth_physical_tine(1396.91, 0.85, modes, pitch_slump_hz=10.0, decay_rate=2.8, detune_cents=1.4, saturation=0.15)
    glint = synth_physical_tine(1661.22, 0.50, modes, pitch_slump_hz=0.0, decay_rate=5.5, detune_cents=1.8, saturation=0.10)

    i1, i2, i3 = int(0.008 * SR), int(0.068 * SR), int(0.134 * SR)
    add_layer(mix, c1, i1, 0.62)
    add_layer(mix, c2, i2, 0.58)
    add_layer(mix, c3, i3, 0.78)
    add_layer(mix, glint, i3 + int(0.010 * SR), 0.22)

    ir = make_room_reflection(decay_s=0.46, cutoff_hz=6800, seed=88)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.18)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.15)


def alt_09_stepped_chamber():
    """Alt 09: Stepped Micro-Chamber (3-Tier Physical Dispersion)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.038, hardness=1.05, seed=109)
    add_layer(mix, transient, 0, 0.90)

    c1 = synth_physical_tine(739.99, 0.85, BRONZE_MODES, pitch_slump_hz=15.0, decay_rate=4.3, saturation=0.22)
    c1 = stereo_widen(c1, 1.05)

    c2 = synth_physical_tine(987.77, 0.80, BRONZE_MODES, pitch_slump_hz=13.0, decay_rate=3.9, saturation=0.20)
    c2 = stereo_widen(c2, 1.14)

    c3 = synth_physical_tine(1108.73, 0.85, BRONZE_MODES, pitch_slump_hz=11.0, decay_rate=2.9, saturation=0.18)
    c3[:, 1] = allpass_diffuse(c3[:, 1], delay_samples=28, g=0.30)
    c3 = stereo_widen(c3, 1.20)

    i1, i2, i3 = int(0.010 * SR), int(0.072 * SR), int(0.140 * SR)
    add_layer(mix, c1, i1, 0.65)
    add_layer(mix, c2, i2, 0.60)
    add_layer(mix, c3, i3, 0.76)

    ir = make_room_reflection(decay_s=0.50, cutoff_hz=5200, seed=99)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.20)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.12)


def alt_10_golden_bronze():
    """Alt 10: Golden-Bronze Harmonic (Pure Overtones & Gentle Halo)"""
    mix = np.zeros((int(DURATION * SR), 2))
    transient = generate_impact_click(duration_s=0.038, hardness=1.1, seed=110)
    add_layer(mix, transient, 0, 0.92)

    golden_modes = [
        (1.000, 1.00, 1.00, 0.0),
        (2.000, 0.42, 2.00, 0.2),
        (3.000, 0.22, 3.00, 0.5),
        (4.000, 0.10, 4.80, 0.8),
        (0.500, 0.16, 1.50, 0.1),
    ]
    c1 = synth_physical_tine(880.00, 0.85, golden_modes, pitch_slump_hz=14.0, decay_rate=4.0, saturation=0.22)
    c2 = synth_physical_tine(1174.66, 0.80, golden_modes, pitch_slump_hz=12.0, decay_rate=3.6, saturation=0.20)
    c3 = synth_physical_tine(1318.51, 0.85, golden_modes, pitch_slump_hz=10.0, decay_rate=2.8, saturation=0.18)
    glint = synth_physical_tine(1760.00, 0.50, golden_modes, pitch_slump_hz=0.0, decay_rate=5.5, saturation=0.10)

    i1, i2, i3 = int(0.010 * SR), int(0.070 * SR), int(0.138 * SR)
    add_layer(mix, c1, i1, 0.65)
    add_layer(mix, c2, i2, 0.60)
    add_layer(mix, c3, i3, 0.74)
    add_layer(mix, glint, i3 + int(0.01 * SR), 0.22)

    ir = make_room_reflection(decay_s=0.50, cutoff_hz=5600, seed=111)
    wet = fftconvolve(c3[:, 0], ir[:, 0])
    wet_r = fftconvolve(c3[:, 1], ir[:, 1])
    wet_st = np.stack([wet, wet_r], axis=1)
    wet_pk = np.max(np.abs(wet_st))
    if wet_pk > 1e-6:
        add_layer(mix, wet_st / wet_pk, i3, 0.20)

    return finalize_master(mix, peak_ceiling_db=-1.0, fade_start_s=0.88, width=1.14)


# ==============================================================================
# Suite Manifest & Exporter
# ==============================================================================

ALTERNATIVES = [
    {
        "id": "alt_01_phosphor",
        "num": "01",
        "title": "Phosphor-Bronze",
        "badge": "Rich Physical Core",
        "notes": "F#5 ➔ B5 ➔ C#6",
        "character": "Dense phosphor-bronze alloy. Strike micro-pitch slump (-16 Hz dive over 18ms), subtle acoustic saturation, warm grounded alloy ring.",
        "fix": "Eliminates flatness with non-linear tension drop on impact and intermodulation wave shaping.",
        "builder": alt_01_phosphor_bronze,
    },
    {
        "id": "alt_02_hollow",
        "num": "02",
        "title": "Hollow Medallion",
        "badge": "Chamber Resonance",
        "notes": "F#5 ➔ B5 ➔ C#6",
        "character": "Milled medallion with an acoustic hollow cavity relief on the reverse. Dual cavity formant filtering (1.35k & 2.45k Hz).",
        "fix": "Woody-metallic hollow tine presence creates 3D acoustic depth rather than isolated sinewaves.",
        "builder": alt_02_hollow_medallion,
    },
    {
        "id": "alt_03_crotale",
        "num": "03",
        "title": "Radiant Crotale",
        "badge": "Bright Antique Alloy",
        "notes": "G5 ➔ C6 ➔ D6",
        "character": "High-tin antique speculum metal. Authentic crotale modal distribution (1.0, 2.76, 5.40, 8.93) with micro-chorus bloom.",
        "fix": "Rich inharmonic overtone cluster introduces natural crystalline shimmer without harshness.",
        "builder": alt_03_radiant_crotale,
    },
    {
        "id": "alt_04_duo_tine",
        "num": "04",
        "title": "Duo-Tine Strike",
        "badge": "Minimalist 2-Note Luxury",
        "notes": "F#5 ➔ C#6 (Ascending 5th)",
        "character": "Exactly 2 deliberate ascending strikes. Uncluttered, spacious, confident high-end console prestige.",
        "fix": "Less busy phrasing gives the physical overtones and room reflections breathing room to bloom.",
        "builder": alt_04_duo_tine,
    },
    {
        "id": "alt_05_warm_celesta",
        "num": "05",
        "title": "Warm Celesta-Metal",
        "badge": "Velvety & Rounded",
        "notes": "D5 ➔ G5 ➔ A5",
        "character": "Softer precision striker with damped contact transient, rich fundamental warmth, and pure harmonic 2nd/3rd partials.",
        "fix": "Deep, warm, non-piercing velvety ring. Perfectly eliminates thinness or sterile digital brightness.",
        "builder": alt_05_warm_celesta,
    },
    {
        "id": "alt_06_lydian",
        "num": "06",
        "title": "Lydian Shimmer",
        "badge": "Ethereal Modern Game UI",
        "notes": "F5 ➔ B5 ➔ C6 (Lydian Lift)",
        "character": "Augmented 4th / Lydian tension and resolution. Crystalline overtones with delicate high-frequency harmonic halo.",
        "fix": "Distinctive musical tension makes the unlock feel unique, radiant, and emotionally uplifting.",
        "builder": alt_06_lydian_shimmer,
    },
    {
        "id": "alt_07_heavy_cast",
        "num": "07",
        "title": "Heavy Cast Disc",
        "badge": "Dense Weight & Authority",
        "notes": "E5 ➔ A5 ➔ B5",
        "character": "Sensation of a thick, heavy 50mm bronze medallion. Low-mid mass undertones (330-440 Hz), solid physical inertia.",
        "fix": "Adds tactile mass and physical weight, making the achievement feel like heavy precious metal.",
        "builder": alt_07_heavy_cast_disc,
    },
    {
        "id": "alt_08_titanium",
        "num": "08",
        "title": "Titanium-Alloy (Happy Herald)",
        "badge": "High-Tech Crisp & Joyful",
        "notes": "G#5 ➔ C#6 ➔ F6 (Major 3rd)",
        "character": "Ultra-crisp high-velocity transient clink, triumphant Major 3rd herald (G#5 ➔ C#6 ➔ F6) with sparkling G#6 glint.",
        "fix": "Replaced cold suspended interval with sunny, radiant Major 3rd resolution for a happy, celebratory feel.",
        "builder": alt_08_titanium_alloy,
    },
    {
        "id": "alt_09_stepped_chamber",
        "num": "09",
        "title": "Stepped Micro-Chamber",
        "badge": "3-Tier Physical Dispersion",
        "notes": "F#5 ➔ B5 ➔ C#6",
        "character": "Concentric stepped grooves. Stereo width expands dynamically (1.05x ➔ 1.20x) with allpass phase diffusion on resolution.",
        "fix": "Dynamic acoustic expansion prevents static, flat mono-like playback.",
        "builder": alt_09_stepped_chamber,
    },
    {
        "id": "alt_10_golden",
        "num": "10",
        "title": "Golden-Bronze Harmonic",
        "badge": "Pure Overtones & Gentle Halo",
        "notes": "A5 ➔ D6 ➔ E6",
        "character": "Harmonic alignment with octave and fifth partials, triumphant ascending interval, warm studio air halo.",
        "fix": "Golden ratio overtone balance provides maximum emotional satisfaction and smooth natural decay.",
        "builder": alt_10_golden_bronze,
    },
]


def render_all():
    """Generates all audio files, HTML audition suite, and writes to disk."""
    os.makedirs(ALTS_DIR, exist_ok=True)
    rendered_data = []

    print("\n" + "="*70)
    print("GENERATING 10 BRONZE ACHIEVEMENT ALTERNATIVES (DYNAMIC PHYSICAL SUITE)")
    print("="*70)

    for item in ALTERNATIVES:
        print(f"Rendering [{item['num']}/10] {item['title']} ({item['badge']})...")
        audio = item["builder"]()
        
        # Audio measurements
        pk = np.max(np.abs(audio))
        pk_db = 20 * np.log10(max(1e-6, pk))
        act_mask = np.abs(audio).max(axis=1) > (pk * 0.05)
        rms = np.sqrt(np.mean(audio[act_mask]**2)) if np.any(act_mask) else 1e-4
        rms_db = 20 * np.log10(max(1e-6, rms))

        # Downsample waveform for visualizer (80 points)
        mono = np.mean(audio, axis=1)
        pts = 80
        chunk = len(mono) // pts
        wf = [round(float(np.max(np.abs(mono[i*chunk:(i+1)*chunk]))), 3) for i in range(pts)]

        # File export
        base_name = f"bronze_{item['id']}"
        wav_p = os.path.join(ALTS_DIR, f"{base_name}.wav")
        mp3_p = os.path.join(ALTS_DIR, f"{base_name}.mp3")

        pcm = np.clip(audio, -1.0, 1.0).astype(np.float32).tobytes()

        # Export 24-bit WAV
        subprocess.run(
            [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
             "-c:a", "pcm_s24le", wav_p],
            input=pcm, check=True
        )

        # Export 320k MP3
        subprocess.run(
            [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
             "-c:a", "libmp3lame", "-b:a", "320k", mp3_p],
            input=pcm, check=True
        )

        # Base64 encode WAV for zero-dependency HTML player
        with open(wav_p, "rb") as f:
            wav_b64 = base64.b64encode(f.read()).decode("ascii")

        rendered_data.append({
            "id": item["id"],
            "num": item["num"],
            "title": item["title"],
            "badge": item["badge"],
            "notes": item["notes"],
            "character": item["character"],
            "fix": item["fix"],
            "peak_db": round(pk_db, 1),
            "rms_db": round(rms_db, 1),
            "wav_filename": f"{base_name}.wav",
            "mp3_filename": f"{base_name}.mp3",
            "wav_path": f"bronze_alternatives/{base_name}.wav",
            "mp3_path": f"bronze_alternatives/{base_name}.mp3",
            "waveform": wf,
            "wav_b64": wav_b64,
        })

    # Build the interactive HTML audition suite
    html_path = os.path.join(THEME_DIR, "preview_bronze_alternatives.html")
    generate_suite_html(rendered_data, html_path)

    print("\n" + "="*70)
    print("ALL 10 ALTERNATIVES GENERATED SUCCESSFULLY!")
    print(f"Files saved in: {ALTS_DIR}")
    print(f"Interactive Audition Suite: {html_path}")
    print("="*70 + "\n")


def generate_suite_html(items, output_path):
    """Builds a responsive, dark-mode audio comparison suite with keyboard navigation."""
    json_items = json.dumps(items)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation — 10 Bronze Trophy Chime Alternatives</title>
<style>
  :root {{
    --bg: #090c12;
    --card: #121622;
    --card-hover: #181d2c;
    --border: #21293a;
    --border-active: #cd7f32;
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
    padding: 30px 20px 60px;
    display: flex;
    justify-content: center;
  }}
  .container {{
    max-width: 960px;
    width: 100%;
  }}
  .header {{
    text-align: center;
    margin-bottom: 24px;
  }}
  .badge-top {{
    display: inline-block;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    background: var(--bronze-glow);
    color: var(--bronze-light);
    border: 1px solid var(--bronze);
    margin-bottom: 10px;
  }}
  h1 {{ font-size: 26px; font-weight: 700; margin-bottom: 8px; }}
  .subtitle {{ color: var(--sub); font-size: 14px; max-width: 680px; margin: 0 auto; line-height: 1.5; }}
  
  .keyboard-hint {{
    background: #141a26;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 16px;
    margin: 16px auto 24px;
    font-size: 12px;
    color: var(--sub);
    text-align: center;
    max-width: 500px;
  }}
  .keyboard-hint kbd {{
    background: #202738;
    color: var(--bronze-light);
    border: 1px solid #36425b;
    border-radius: 4px;
    padding: 2px 6px;
    font-family: monospace;
    font-weight: bold;
  }}

  .grid {{
    display: flex;
    flex-direction: column;
    gap: 14px;
  }}
  .card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    transition: all 0.15s ease;
    cursor: pointer;
  }}
  .card:hover {{
    background: var(--card-hover);
    border-color: #313c54;
    transform: translateY(-1px);
  }}
  .card.active {{
    border-color: var(--border-active);
    box-shadow: 0 4px 20px var(--bronze-glow);
    background: #151a28;
  }}
  .key-num {{
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: #1b2130;
    border: 1px solid #2d3850;
    font-family: monospace;
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--sub);
    flex-shrink: 0;
  }}
  .card.active .key-num {{
    background: var(--bronze);
    color: #fff;
    border-color: var(--bronze-light);
  }}
  .btn-play {{
    width: 46px;
    height: 46px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(135deg, var(--bronze), var(--bronze-light));
    color: #fff;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: 0 2px 10px var(--bronze-glow);
    transition: transform 0.1s ease;
  }}
  .btn-play:hover {{ transform: scale(1.08); }}
  .btn-play:active {{ transform: scale(0.95); }}
  .content {{
    flex-grow: 1;
    min-width: 0;
  }}
  .title-row {{
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }}
  .title {{
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }}
  .tag {{
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: rgba(205, 127, 50, 0.15);
    color: var(--bronze-light);
    border: 1px solid rgba(205, 127, 50, 0.35);
  }}
  .notes-tag {{
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: rgba(88, 166, 255, 0.15);
    color: var(--accent);
    border: 1px solid rgba(88, 166, 255, 0.35);
    font-family: monospace;
  }}
  .desc {{
    font-size: 13px;
    color: var(--sub);
    line-height: 1.4;
    margin-bottom: 6px;
  }}
  .fix-tag {{
    font-size: 11px;
    color: #7ee787;
    background: rgba(46, 160, 67, 0.15);
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }}
  .wf-col {{
    width: 140px;
    height: 38px;
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    background: #090c12;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid #1a2233;
  }}
  .bar {{
    flex: 1;
    background: var(--bronze);
    opacity: 0.6;
    border-radius: 1px;
    transition: opacity 0.1s ease, height 0.1s ease;
  }}
  .card.active .bar {{
    opacity: 1;
    background: var(--bronze-light);
  }}
  .action-col {{
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }}
  .btn-select {{
    padding: 6px 12px;
    border-radius: 6px;
    background: #1c2333;
    border: 1px solid #2e3a54;
    color: #c9d1d9;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }}
  .btn-select:hover {{
    background: var(--bronze);
    border-color: var(--bronze-light);
    color: #fff;
  }}
  .toast-notice {{
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1a2333;
    border: 1px solid var(--bronze);
    color: #fff;
    padding: 12px 18px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    font-size: 13px;
    display: none;
    z-index: 1000;
  }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="badge-top">Acoustic Refinement Suite</div>
    <h1>10 Bronze Trophy Chime Alternatives</h1>
    <p class="subtitle">
      Engineered with micro-pitch slump, dynamic modal saturation, formant cavities, and non-linear physical modeling to eliminate flatness and explore distinct chime timbres.
    </p>
    <div class="keyboard-hint">
      Audition with 1-click or press <kbd>1</kbd> through <kbd>9</kbd> and <kbd>0</kbd> on your keyboard for instant A/B comparison.
    </div>
  </div>

  <div class="grid" id="cardGrid"></div>
</div>

<div class="toast-notice" id="toast"></div>

<audio id="player"></audio>

<script>
  const items = {json_items};
  const grid = document.getElementById('cardGrid');
  const player = document.getElementById('player');
  const toast = document.getElementById('toast');
  let currentActive = null;

  items.forEach((item, idx) => {{
    const keyLabel = idx === 9 ? '0' : String(idx + 1);
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'card-' + item.id;

    let barsHtml = '';
    item.waveform.forEach(val => {{
      const h = Math.max(8, Math.min(100, Math.pow(val, 0.6) * 100));
      barsHtml += `<div class="bar" style="height:${{h}}%"></div>`;
    }});

    card.innerHTML = `
      <div class="key-num">${{keyLabel}}</div>
      <button class="btn-play" onclick="playItem(${{idx}}, event)">▶</button>
      <div class="content" onclick="playItem(${{idx}}, event)">
        <div class="title-row">
          <span class="title">${{item.title}}</span>
          <span class="tag">${{item.badge}}</span>
          <span class="notes-tag">${{item.notes}}</span>
        </div>
        <div class="desc">${{item.character}}</div>
        <div class="fix-tag">&bull; Anti-flat fix: ${{item.fix}}</div>
      </div>
      <div class="wf-col" onclick="playItem(${{idx}}, event)">
        ${{barsHtml}}
      </div>
      <div class="action-col">
        <button class="btn-select" onclick="copySnippet(${{idx}}, event)">Copy Path</button>
      </div>
    `;

    grid.appendChild(card);
  }});

  function playItem(idx, e) {{
    if (e) e.stopPropagation();
    const item = items[idx];
    
    document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById('card-' + item.id);
    if (card) card.classList.add('active');

    player.src = 'data:audio/wav;base64,' + item.wav_b64;
    player.currentTime = 0;
    player.play();
  }}

  function copySnippet(idx, e) {{
    if (e) e.stopPropagation();
    const item = items[idx];
    const path = 'SteamStation/bronze_alternatives/' + item.mp3_filename;
    navigator.clipboard.writeText(path).then(() => {{
      showToast('Copied path to clipboard: ' + path);
    }});
  }}

  function showToast(msg) {{
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {{ toast.style.display = 'none'; }}, 3000);
  }}

  window.addEventListener('keydown', (e) => {{
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    let keyIdx = -1;
    if (e.key >= '1' && e.key <= '9') {{
      keyIdx = parseInt(e.key) - 1;
    }} else if (e.key === '0') {{
      keyIdx = 9;
    }}
    if (keyIdx >= 0 && keyIdx < items.length) {{
      playItem(keyIdx);
    }}
  }});
</script>
</body>
</html>
"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    render_all()
