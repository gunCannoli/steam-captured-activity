#!/usr/bin/env python3
"""
Baseline Trophy Audio Progression Designer (Bronze -> Silver -> Gold -> Platinum)
Takes each baseline sound in themes/SteamStation/baseline as authoritative Bronze DNA,
and evolves Silver, Gold, and Platinum according to the nonlinear prestige curve:
  Bronze (1.000s, "NICE") -> Silver (1.320s, "NICE+") -> Gold (1.650s, "COOL") -> Platinum (2.000s, "MINDBLOWING")

Generates:
  - 4 Suites x 4 Tiers = 16 Audio Tracks (24-bit 48kHz WAV + 320kbps MP3)
  - Interactive HTML Audition Player with sequence playback and acoustic metrics
  - Complete ZIP packages for WAV and MP3
"""

import os
import sys
import json
import base64
import zipfile
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve, lfilter
import imageio_ffmpeg

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
THEME_DIR = os.path.dirname(HERE)
BASELINE_DIR = os.path.join(THEME_DIR, "baseline")
PROGRESSIONS_DIR = os.path.join(BASELINE_DIR, "progressions")
FF = imageio_ffmpeg.get_ffmpeg_exe()


# ==============================================================================
# DSP Utilities
# ==============================================================================

def filt(x, kind, hz, order=2):
    """Zero-phase Butterworth filter."""
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def stereo_widen(x, factor=1.15):
    """Mid/Side stereo width adjustment."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def dynamic_stereo_widen(x, t_start=0.20, t_end=0.55, w_start=1.05, w_end=1.65):
    """
    Dynamically automates Mid/Side stereo width over time.
    At t < t_start, sound is focused and intimate (w_start).
    Between t_start and t_end, width blossoms outward into an expansive 3D field (w_end).
    """
    n = len(x)
    t = np.linspace(0, n / SR, n, endpoint=False)
    
    # Smoothstep interpolation curve (3p^2 - 2p^3)
    p = np.clip((t - t_start) / max(1e-4, t_end - t_start), 0.0, 1.0)
    w_curve = w_start + (w_end - w_start) * (p * p * (3.0 - 2.0 * p))
    
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * w_curve
    return np.stack([mid + side, mid - side], axis=1)


def add_layer(dest, src, start_idx, gain=1.0):
    """Safely adds 2D audio src into dest at start_idx with gain, clipping bounds."""
    if start_idx >= len(dest):
        return
    end_idx = min(len(dest), start_idx + len(src))
    actual_len = end_idx - start_idx
    if actual_len > 0:
        dest[start_idx:end_idx] += src[:actual_len] * gain


def load_and_trim_baseline(path, threshold_ratio=0.005, pre_roll_ms=2.0):
    """Loads an audio file via ffmpeg, converts to float64 stereo at 48kHz, trims leading silence."""
    cmd = [FF, "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    res = subprocess.run(cmd, capture_output=True, check=True)
    audio = np.frombuffer(res.stdout, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    
    # Envelope to detect first transient onset
    env = np.max(np.abs(audio), axis=1)
    peak = np.max(env)
    if peak > 1e-5:
        onsets = np.where(env > peak * threshold_ratio)[0]
        if len(onsets):
            start_idx = max(0, onsets[0] - int(pre_roll_ms * 0.001 * SR))
            audio = audio[start_idx:]
    return audio


def isolate_transient(audio, duration_ms=35, hp_hz=850):
    """Extracts the initial tactile physical contact transient."""
    n = min(len(audio), int(duration_ms * 0.001 * SR))
    chunk = audio[:n].copy()
    
    flat_len = int(0.008 * SR)
    env = np.ones(n)
    if n > flat_len:
        env[flat_len:] = np.cos(np.linspace(0, np.pi / 2, n - flat_len)) ** 2
    chunk *= env[:, None]
    
    chunk = filt(chunk, "highpass", hp_hz, order=2)
    pk = np.max(np.abs(chunk))
    return chunk / (pk + 1e-8) if pk > 1e-6 else chunk


def synth_alloy_tine(f0, duration_s, decay_rate=3.0, warmth=0.60, detune_cents=1.5,
                     pitch_slump_hz=10.0, slump_tau=0.020, saturation=0.15):
    """
    Physical modeling of struck resonant alloy chime / bar.
    Modes: Fundamental (1.0), Radial (2.620), Crystalline (4.450), Sheen (7.100), Body Warmth (0.50).
    """
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)

    # Micro-pitch slump on strike (simulating non-linear tension variation on impact)
    if pitch_slump_hz > 0:
        freq_env = f0 + pitch_slump_hz * np.exp(-t / max(1e-4, slump_tau))
    else:
        freq_env = np.full(n, f0)
    base_phase = 2 * np.pi * np.cumsum(freq_env) / SR

    # Fast micro-attack
    att_len = int(0.0015 * SR)
    att = np.ones(n)
    att[:att_len] = np.sin(np.linspace(0, np.pi / 2, att_len)) ** 2

    modes = [
        # (freq_mult, rel_amp, decay_mult, phase_shift)
        (1.000, 1.00, 1.00, 0.0),
        (2.620, 0.35, 2.30, 0.3),
        (4.450, 0.18, 3.60, 0.6),
        (7.100, 0.08, 5.50, 0.9),
        (0.500, 0.12 * (warmth / 0.60), 1.60, 0.1),
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
        p_r = base_phase * f_r_mult + phase_shift + 0.12

        left += rel_amp * np.sin(p_l) * env
        right += rel_amp * np.sin(p_r) * env

    if saturation > 0:
        left = np.tanh(left * (1.0 + saturation)) / (1.0 + saturation * 0.4)
        right = np.tanh(right * (1.0 + saturation)) / (1.0 + saturation * 0.4)

    stereo = np.stack([left, right], axis=1)
    pk = np.max(np.abs(stereo))
    return stereo / (pk + 1e-8) if pk > 1e-6 else stereo


def make_ceremonial_space(decay_s=0.50, cutoff_hz=6800, early_pattern=None, seed=88):
    """Synthesizes a clean acoustic ceremonial studio/hall IR with binaural early reflections."""
    n = int(decay_s * SR)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(seed)

    env = np.exp(-6.5 * t)[:, None]
    ir = rng.standard_normal((n, 2)) * env

    if early_pattern:
        for idx, (d_ms, g) in enumerate(early_pattern):
            s_l = int(d_ms * 0.001 * SR)
            # 0.8ms Haas binaural micro-delay on opposite ear for true 3D spatial envelopment
            s_r = int((d_ms + 0.8) * 0.001 * SR)
            if s_l < n:
                ir[s_l, 0] += g
            if s_r < n:
                ir[s_r, 1] += g * (-1 if idx % 2 else 1)

    ir[: int(0.003 * SR)] = 0
    ir = filt(ir, "lowpass", cutoff_hz, order=2)
    ir = filt(ir, "highpass", 200, order=2)
    norm = np.sqrt(np.sum(ir**2, axis=0, keepdims=True)) + 1e-8
    return ir / norm


def finalize_tier_master(mix, target_duration, peak_ceiling_db=-1.00, fade_start_ratio=0.86,
                         width=1.15, dynamic_widen=False, hp_hz=160):
    """Finalizes duration, filters rumble, controls stereo width, and applies smooth decay fade."""
    total_samples = int(target_duration * SR)
    out = np.zeros((total_samples, 2), dtype=np.float64)
    n = min(len(mix), total_samples)
    out[:n] = mix[:n]

    out = filt(out, "highpass", hp_hz, order=2)
    out = filt(out, "lowpass", 15000, order=2)

    if dynamic_widen:
        # Dynamic bloom: opens outward from intimate 1.05x to expansive 1.65x
        out = dynamic_stereo_widen(out, t_start=0.20, t_end=0.55, w_start=1.05, w_end=1.65)
    else:
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
# Suite 1: Simple Process (Modern Alloy Tech Chime)
# Baseline: 36505577-simple-notify-completed-process-274737.mp3
# Motif: C7 (glint) -> Bb5 / Bb6 (Key of Bb Major)
# ==============================================================================

def build_suite1_tiers(base_audio):
    """Builds Bronze, Silver, Gold, Platinum for Suite 1 (Process Chime)."""
    transient = isolate_transient(base_audio, duration_ms=30, hp_hz=950)
    
    # 1. BRONZE (1.000s) — Baseline reference (clean, precise, intimate)
    dur_b = 1.000
    mix_b = np.zeros((int(dur_b * SR), 2))
    add_layer(mix_b, base_audio, 0, 1.0)
    bronze = finalize_tier_master(mix_b, dur_b, peak_ceiling_db=-1.0, fade_start_ratio=0.85, width=1.10, hp_hz=180)

    # 2. SILVER (1.320s) — Bronze + Refinement
    dur_s = 1.320
    mix_s = np.zeros((int(dur_s * SR), 2))
    add_layer(mix_s, base_audio, 0, 0.95)
    
    # Sympathetic alloy resonance extending naturally
    tine_bb5 = synth_alloy_tine(943.4, 1.15, decay_rate=2.6, warmth=0.65, detune_cents=1.5, pitch_slump_hz=10.0)
    tine_f6 = synth_alloy_tine(1413.5, 0.95, decay_rate=3.8, warmth=0.50, detune_cents=1.8, pitch_slump_hz=0.0)
    tine_d7 = synth_alloy_tine(2377.2, 0.70, decay_rate=4.8, warmth=0.35, detune_cents=2.0, pitch_slump_hz=0.0)
    
    add_layer(mix_s, tine_bb5, int(0.060 * SR), 0.45)
    add_layer(mix_s, tine_f6, int(0.080 * SR), 0.22)
    add_layer(mix_s, tine_d7, int(0.090 * SR), 0.16)
    
    early = [(6.0, 0.42), (13.0, 0.38), (22.0, 0.28)]
    ir_s = make_ceremonial_space(decay_s=0.55, cutoff_hz=7000, early_pattern=early, seed=101)
    wet_l = fftconvolve(mix_s[:, 0], ir_s[:, 0])
    wet_r = fftconvolve(mix_s[:, 1], ir_s[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_s, wet_st / w_pk, int(0.070 * SR), 0.20)
    silver = finalize_tier_master(mix_s, dur_s, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.24, hp_hz=160)

    # 3. GOLD (1.650s) — Ceremonial Herald & Ascending Fanfare
    dur_g = 1.650
    mix_g = np.zeros((int(dur_g * SR), 2))
    add_layer(mix_g, transient, 0, 0.95)
    add_layer(mix_g, base_audio, 0, 0.75)
    
    # Physical mass undertone (Bb4)
    bb4_body = synth_alloy_tine(471.7, 1.40, decay_rate=2.0, warmth=0.85, detune_cents=1.2, pitch_slump_hz=8.0)
    add_layer(mix_g, bb4_body, int(0.010 * SR), 0.38)
    
    # 4-Step Ascending Fanfare: Bb5 (10ms) -> D6 (80ms) -> F6 (160ms) -> Bb6 crown (240ms)
    f1 = synth_alloy_tine(943.4, 1.45, decay_rate=2.5, warmth=0.75, detune_cents=1.5, pitch_slump_hz=14.0)
    f2 = synth_alloy_tine(1189.2, 1.40, decay_rate=2.0, warmth=0.68, detune_cents=1.5, pitch_slump_hz=10.0)
    f3 = synth_alloy_tine(1413.5, 1.45, decay_rate=1.6, warmth=0.62, detune_cents=1.4, pitch_slump_hz=8.0)
    f4 = synth_alloy_tine(1886.8, 1.35, decay_rate=1.25, warmth=0.55, detune_cents=1.6, pitch_slump_hz=6.0)
    glint_d7 = synth_alloy_tine(2377.2, 0.95, decay_rate=3.0, warmth=0.40, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_g, f1, int(0.010 * SR), 0.55)
    add_layer(mix_g, f2, int(0.080 * SR), 0.58)
    add_layer(mix_g, f3, int(0.160 * SR), 0.72)
    add_layer(mix_g, f4, int(0.240 * SR), 0.78)
    add_layer(mix_g, glint_d7, int(0.255 * SR), 0.24)
    
    early_g = [(7.0, 0.48), (16.0, 0.42), (27.0, 0.34), (40.0, 0.26)]
    ir_g = make_ceremonial_space(decay_s=0.88, cutoff_hz=7200, early_pattern=early_g, seed=102)
    wet_l = fftconvolve(mix_g[:, 0], ir_g[:, 0])
    wet_r = fftconvolve(mix_g[:, 1], ir_g[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_g, wet_st / w_pk, int(0.240 * SR), 0.26)
    gold = finalize_tier_master(mix_g, dur_g, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.38, hp_hz=140)

    # 4. PLATINUM (2.000s) — The Bloom & Mindblowing Revelation
    dur_p = 2.000
    mix_p = np.zeros((int(dur_p * SR), 2))
    add_layer(mix_p, transient, 0, 0.98)
    add_layer(mix_p, base_audio, 0, 0.65)
    
    # Grounded substantial physical mass (deep Bb3 + Bb4)
    bb3_mass = synth_alloy_tine(235.8, 1.75, decay_rate=1.4, warmth=0.92, detune_cents=0.8, pitch_slump_hz=8.0)
    bb4_mass = synth_alloy_tine(471.7, 1.80, decay_rate=1.2, warmth=0.88, detune_cents=1.0, pitch_slump_hz=12.0)
    add_layer(mix_p, bb3_mass, int(0.005 * SR), 0.38)
    add_layer(mix_p, bb4_mass, int(0.010 * SR), 0.45)
    
    # Complete Ascending Herald Phrase
    c1 = synth_alloy_tine(943.4, 1.80, decay_rate=2.0, warmth=0.78, detune_cents=1.5, pitch_slump_hz=18.0)
    c2 = synth_alloy_tine(1189.2, 1.80, decay_rate=1.6, warmth=0.72, detune_cents=1.5, pitch_slump_hz=14.0)
    c3 = synth_alloy_tine(1413.5, 1.85, decay_rate=1.2, warmth=0.68, detune_cents=1.4, pitch_slump_hz=11.0)
    c4 = synth_alloy_tine(1886.8, 1.85, decay_rate=0.88, warmth=0.60, detune_cents=1.6, pitch_slump_hz=8.0)
    c5 = synth_alloy_tine(2377.2, 1.50, decay_rate=1.20, warmth=0.50, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_p, c1, int(0.010 * SR), 0.58)
    add_layer(mix_p, c2, int(0.075 * SR), 0.62)
    add_layer(mix_p, c3, int(0.145 * SR), 0.74)
    add_layer(mix_p, c4, int(0.220 * SR), 0.82)
    add_layer(mix_p, c5, int(0.290 * SR), 0.65)
    
    # THE BLOOM (opens outward at 320ms)
    i_bloom = int(0.320 * SR)
    bloom_bed = synth_alloy_tine(943.4, 1.65, decay_rate=0.85, warmth=0.62, detune_cents=2.2, pitch_slump_hz=0.0)
    bloom_chord = synth_alloy_tine(1413.5, 1.50, decay_rate=1.1, warmth=0.52, detune_cents=2.0, pitch_slump_hz=0.0)
    bloom_f7 = synth_alloy_tine(2827.0, 1.30, decay_rate=1.8, warmth=0.40, detune_cents=2.2, pitch_slump_hz=0.0)
    bloom_bb7 = synth_alloy_tine(3773.6, 1.10, decay_rate=2.4, warmth=0.35, detune_cents=2.5, pitch_slump_hz=0.0)
    
    add_layer(mix_p, bloom_bed, i_bloom, 0.38)
    add_layer(mix_p, bloom_chord, i_bloom + int(0.010 * SR), 0.28)
    add_layer(mix_p, bloom_f7, i_bloom + int(0.020 * SR), 0.24)
    add_layer(mix_p, bloom_bb7, i_bloom + int(0.035 * SR), 0.18)
    
    # Expansive 3D ceremonial space IR with Haas binaural delay
    early_p = [(8.0, 0.50), (18.0, 0.46), (30.0, 0.38), (44.0, 0.30), (60.0, 0.22), (78.0, 0.16)]
    ir_p = make_ceremonial_space(decay_s=1.35, cutoff_hz=7500, early_pattern=early_p, seed=103)
    wet_l = fftconvolve(mix_p[:, 0], ir_p[:, 0])
    wet_r = fftconvolve(mix_p[:, 1], ir_p[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_p, wet_st / w_pk, int(0.220 * SR), 0.32)
        
    platinum = finalize_tier_master(mix_p, dur_p, peak_ceiling_db=-1.0, fade_start_ratio=0.88,
                                    dynamic_widen=True, hp_hz=120)

    return bronze, silver, gold, platinum


# ==============================================================================
# Suite 2: Denielcz Bell (Resonant Pure Bell Strike)
# Baseline: denielcz-notify-463076.mp3
# Motif: C4 + C6 bell strike (Key of C Major)
# ==============================================================================

def build_suite2_tiers(base_audio):
    """Builds Bronze, Silver, Gold, Platinum for Suite 2 (Denielcz Bell)."""
    transient = isolate_transient(base_audio, duration_ms=40, hp_hz=800)
    
    # 1. BRONZE (1.000s) — Pure intimate bell strike
    dur_b = 1.000
    mix_b = np.zeros((int(dur_b * SR), 2))
    add_layer(mix_b, base_audio, 0, 1.0)
    bronze = finalize_tier_master(mix_b, dur_b, peak_ceiling_db=-1.0, fade_start_ratio=0.85, width=1.12, hp_hz=150)

    # 2. SILVER (1.320s) — Extended Bell Ring & Sympathetic Harmonics
    dur_s = 1.320
    mix_s = np.zeros((int(dur_s * SR), 2))
    add_layer(mix_s, base_audio, 0, 0.95)
    
    # Sympathetic G5 (5th) and E6 (Major 3rd) ringing naturally
    bell_g5 = synth_alloy_tine(783.99, 1.15, decay_rate=2.4, warmth=0.68, detune_cents=1.5, pitch_slump_hz=8.0)
    bell_e6 = synth_alloy_tine(1318.51, 1.05, decay_rate=2.8, warmth=0.55, detune_cents=1.6, pitch_slump_hz=0.0)
    add_layer(mix_s, bell_g5, int(0.040 * SR), 0.36)
    add_layer(mix_s, bell_e6, int(0.060 * SR), 0.28)
    
    early = [(6.0, 0.42), (14.0, 0.36), (24.0, 0.26)]
    ir_s = make_ceremonial_space(decay_s=0.58, cutoff_hz=6800, early_pattern=early, seed=201)
    wet_l = fftconvolve(mix_s[:, 0], ir_s[:, 0])
    wet_r = fftconvolve(mix_s[:, 1], ir_s[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_s, wet_st / w_pk, int(0.050 * SR), 0.22)
    silver = finalize_tier_master(mix_s, dur_s, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.25, hp_hz=140)

    # 3. GOLD (1.650s) — Ceremonial Bell Herald Fanfare
    dur_g = 1.650
    mix_g = np.zeros((int(dur_g * SR), 2))
    add_layer(mix_g, transient, 0, 0.95)
    add_layer(mix_g, base_audio, 0, 0.70)
    
    # Deep C3 body mass
    c3_body = synth_alloy_tine(130.81, 1.45, decay_rate=1.8, warmth=0.90, detune_cents=0.8, pitch_slump_hz=6.0)
    add_layer(mix_g, c3_body, int(0.005 * SR), 0.40)
    
    # 4-Step Bell Phrase: C5 (10ms) -> G5 (85ms) -> C6 (165ms) -> E6 crown (245ms)
    b1 = synth_alloy_tine(523.25, 1.45, decay_rate=2.4, warmth=0.80, detune_cents=1.5, pitch_slump_hz=14.0)
    b2 = synth_alloy_tine(783.99, 1.45, decay_rate=1.9, warmth=0.72, detune_cents=1.5, pitch_slump_hz=10.0)
    b3 = synth_alloy_tine(1046.50, 1.40, decay_rate=1.5, warmth=0.65, detune_cents=1.4, pitch_slump_hz=8.0)
    b4 = synth_alloy_tine(1318.51, 1.35, decay_rate=1.20, warmth=0.55, detune_cents=1.6, pitch_slump_hz=6.0)
    halo_g6 = synth_alloy_tine(1567.98, 0.95, decay_rate=2.8, warmth=0.40, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_g, b1, int(0.010 * SR), 0.54)
    add_layer(mix_g, b2, int(0.085 * SR), 0.58)
    add_layer(mix_g, b3, int(0.165 * SR), 0.72)
    add_layer(mix_g, b4, int(0.245 * SR), 0.78)
    add_layer(mix_g, halo_g6, int(0.260 * SR), 0.22)
    
    early_g = [(7.0, 0.48), (17.0, 0.42), (28.0, 0.32), (42.0, 0.24)]
    ir_g = make_ceremonial_space(decay_s=0.90, cutoff_hz=7000, early_pattern=early_g, seed=202)
    wet_l = fftconvolve(mix_g[:, 0], ir_g[:, 0])
    wet_r = fftconvolve(mix_g[:, 1], ir_g[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_g, wet_st / w_pk, int(0.245 * SR), 0.26)
    gold = finalize_tier_master(mix_g, dur_g, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.38, hp_hz=120)

    # 4. PLATINUM (2.000s) — Grand Ceremonial Bell Bloom & Triumph
    dur_p = 2.000
    mix_p = np.zeros((int(dur_p * SR), 2))
    add_layer(mix_p, transient, 0, 0.98)
    add_layer(mix_p, base_audio, 0, 0.65)
    
    # Rich physical bronze mass (C3 + G3)
    c3_mass = synth_alloy_tine(130.81, 1.80, decay_rate=1.3, warmth=0.92, detune_cents=0.8, pitch_slump_hz=8.0)
    g3_mass = synth_alloy_tine(195.99, 1.80, decay_rate=1.2, warmth=0.88, detune_cents=1.0, pitch_slump_hz=10.0)
    add_layer(mix_p, c3_mass, int(0.005 * SR), 0.42)
    add_layer(mix_p, g3_mass, int(0.010 * SR), 0.38)
    
    # Complete Herald Phrase
    c1 = synth_alloy_tine(523.25, 1.80, decay_rate=1.8, warmth=0.78, detune_cents=1.5, pitch_slump_hz=16.0)
    c2 = synth_alloy_tine(783.99, 1.80, decay_rate=1.5, warmth=0.72, detune_cents=1.5, pitch_slump_hz=12.0)
    c3 = synth_alloy_tine(1046.50, 1.85, decay_rate=1.1, warmth=0.68, detune_cents=1.4, pitch_slump_hz=9.0)
    c4 = synth_alloy_tine(1318.51, 1.85, decay_rate=0.85, warmth=0.60, detune_cents=1.6, pitch_slump_hz=6.0)
    c5 = synth_alloy_tine(1567.98, 1.50, decay_rate=1.10, warmth=0.50, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_p, c1, int(0.010 * SR), 0.58)
    add_layer(mix_p, c2, int(0.075 * SR), 0.62)
    add_layer(mix_p, c3, int(0.140 * SR), 0.74)
    add_layer(mix_p, c4, int(0.210 * SR), 0.82)
    add_layer(mix_p, c5, int(0.280 * SR), 0.68)
    
    # THE BLOOM (opens outward at 330ms)
    i_bloom = int(0.330 * SR)
    bloom_c6 = synth_alloy_tine(1046.50, 1.65, decay_rate=0.85, warmth=0.62, detune_cents=2.2, pitch_slump_hz=0.0)
    bloom_g6 = synth_alloy_tine(1567.98, 1.45, decay_rate=1.2, warmth=0.50, detune_cents=2.0, pitch_slump_hz=0.0)
    bloom_c7 = synth_alloy_tine(2093.00, 1.35, decay_rate=1.6, warmth=0.42, detune_cents=2.0, pitch_slump_hz=0.0)
    bloom_e7 = synth_alloy_tine(2637.02, 1.15, decay_rate=2.2, warmth=0.35, detune_cents=2.4, pitch_slump_hz=0.0)
    
    add_layer(mix_p, bloom_c6, i_bloom, 0.38)
    add_layer(mix_p, bloom_g6, i_bloom + int(0.010 * SR), 0.28)
    add_layer(mix_p, bloom_c7, i_bloom + int(0.020 * SR), 0.26)
    add_layer(mix_p, bloom_e7, i_bloom + int(0.035 * SR), 0.20)
    
    # Expansive 3D ceremonial space IR with Haas binaural delay
    early_p = [(8.0, 0.50), (19.0, 0.45), (31.0, 0.38), (46.0, 0.28), (62.0, 0.22), (80.0, 0.16)]
    ir_p = make_ceremonial_space(decay_s=1.35, cutoff_hz=7400, early_pattern=early_p, seed=203)
    wet_l = fftconvolve(mix_p[:, 0], ir_p[:, 0])
    wet_r = fftconvolve(mix_p[:, 1], ir_p[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_p, wet_st / w_pk, int(0.210 * SR), 0.32)
        
    platinum = finalize_tier_master(mix_p, dur_p, peak_ceiling_db=-1.0, fade_start_ratio=0.88,
                                    dynamic_widen=True, hp_hz=100)

    return bronze, silver, gold, platinum


# ==============================================================================
# Suite 3: Crystal Shimmer (Celestial Glass Cascade)
# Baseline: notification_message-best-notification-10-286664.mp3
# Motif: Ethereal high crystalline cluster (Key of A / Ethereal)
# ==============================================================================

def build_suite3_tiers(base_audio):
    """Builds Bronze, Silver, Gold, Platinum for Suite 3 (Crystal Shimmer)."""
    transient = isolate_transient(base_audio, duration_ms=45, hp_hz=1200)
    
    # 1. BRONZE (1.000s) — Focused, intimate crystalline chime
    dur_b = 1.000
    mix_b = np.zeros((int(dur_b * SR), 2))
    add_layer(mix_b, base_audio, 0, 1.2)
    bronze = finalize_tier_master(mix_b, dur_b, peak_ceiling_db=-1.0, fade_start_ratio=0.85, width=1.15, hp_hz=220)

    # 2. SILVER (1.320s) — Extended Crystal Resonance & Shimmer
    dur_s = 1.320
    mix_s = np.zeros((int(dur_s * SR), 2))
    add_layer(mix_s, base_audio, 0, 1.0)
    
    # Sympathetic crystalline overtones
    c_a6 = synth_alloy_tine(1760.00, 1.15, decay_rate=2.6, warmth=0.60, detune_cents=1.6, pitch_slump_hz=0.0)
    c_c7 = synth_alloy_tine(2217.46, 1.05, decay_rate=3.2, warmth=0.50, detune_cents=1.8, pitch_slump_hz=0.0)
    c_e7 = synth_alloy_tine(2637.02, 0.95, decay_rate=4.0, warmth=0.40, detune_cents=2.0, pitch_slump_hz=0.0)
    add_layer(mix_s, c_a6, int(0.040 * SR), 0.35)
    add_layer(mix_s, c_c7, int(0.060 * SR), 0.28)
    add_layer(mix_s, c_e7, int(0.080 * SR), 0.22)
    
    early = [(6.0, 0.44), (13.0, 0.38), (22.0, 0.28)]
    ir_s = make_ceremonial_space(decay_s=0.58, cutoff_hz=7500, early_pattern=early, seed=301)
    wet_l = fftconvolve(mix_s[:, 0], ir_s[:, 0])
    wet_r = fftconvolve(mix_s[:, 1], ir_s[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_s, wet_st / w_pk, int(0.050 * SR), 0.22)
    silver = finalize_tier_master(mix_s, dur_s, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.26, hp_hz=180)

    # 3. GOLD (1.650s) — Developed Celestial Arpeggiation & Grounding Body
    dur_g = 1.650
    mix_g = np.zeros((int(dur_g * SR), 2))
    add_layer(mix_g, transient, 0, 0.95)
    add_layer(mix_g, base_audio, 0, 0.70)
    
    # Physical mass body (A4 + E5) giving the crystal substantial weight
    a4_body = synth_alloy_tine(440.00, 1.45, decay_rate=2.0, warmth=0.85, detune_cents=1.0, pitch_slump_hz=8.0)
    e5_body = synth_alloy_tine(659.25, 1.40, decay_rate=1.8, warmth=0.75, detune_cents=1.2, pitch_slump_hz=10.0)
    add_layer(mix_g, a4_body, int(0.008 * SR), 0.38)
    add_layer(mix_g, e5_body, int(0.050 * SR), 0.35)
    
    # 4-Step Ascending Chime Phrase: A6 (10ms) -> C#7 (85ms) -> E7 (165ms) -> A7 crown (245ms)
    b1 = synth_alloy_tine(1760.00, 1.45, decay_rate=2.2, warmth=0.70, detune_cents=1.5, pitch_slump_hz=12.0)
    b2 = synth_alloy_tine(2217.46, 1.40, decay_rate=1.8, warmth=0.62, detune_cents=1.5, pitch_slump_hz=8.0)
    b3 = synth_alloy_tine(2637.02, 1.45, decay_rate=1.4, warmth=0.55, detune_cents=1.4, pitch_slump_hz=6.0)
    b4 = synth_alloy_tine(3520.00, 1.35, decay_rate=1.15, warmth=0.45, detune_cents=1.6, pitch_slump_hz=0.0)
    halo_b7 = synth_alloy_tine(3951.07, 0.95, decay_rate=2.5, warmth=0.35, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_g, b1, int(0.010 * SR), 0.56)
    add_layer(mix_g, b2, int(0.085 * SR), 0.60)
    add_layer(mix_g, b3, int(0.165 * SR), 0.72)
    add_layer(mix_g, b4, int(0.245 * SR), 0.78)
    add_layer(mix_g, halo_b7, int(0.260 * SR), 0.22)
    
    early_g = [(7.0, 0.50), (16.0, 0.44), (28.0, 0.34), (42.0, 0.26)]
    ir_g = make_ceremonial_space(decay_s=0.90, cutoff_hz=7800, early_pattern=early_g, seed=302)
    wet_l = fftconvolve(mix_g[:, 0], ir_g[:, 0])
    wet_r = fftconvolve(mix_g[:, 1], ir_g[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_g, wet_st / w_pk, int(0.245 * SR), 0.26)
    gold = finalize_tier_master(mix_g, dur_g, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.40, hp_hz=150)

    # 4. PLATINUM (2.000s) — Celestial Harmonic Bloom & Breath-taking Revelation
    dur_p = 2.000
    mix_p = np.zeros((int(dur_p * SR), 2))
    add_layer(mix_p, transient, 0, 0.98)
    add_layer(mix_p, base_audio, 0, 0.65)
    
    # Grounded substantial physical mass (A3 = 220Hz, A4 = 440Hz, E5 = 659Hz)
    a3_mass = synth_alloy_tine(220.00, 1.80, decay_rate=1.3, warmth=0.92, detune_cents=0.8, pitch_slump_hz=8.0)
    a4_mass = synth_alloy_tine(440.00, 1.80, decay_rate=1.2, warmth=0.86, detune_cents=1.0, pitch_slump_hz=10.0)
    add_layer(mix_p, a3_mass, int(0.005 * SR), 0.40)
    add_layer(mix_p, a4_mass, int(0.010 * SR), 0.44)
    
    # Complete Ascending Celestial Herald Phrase
    c1 = synth_alloy_tine(1760.00, 1.80, decay_rate=1.8, warmth=0.72, detune_cents=1.5, pitch_slump_hz=14.0)
    c2 = synth_alloy_tine(2217.46, 1.80, decay_rate=1.4, warmth=0.65, detune_cents=1.5, pitch_slump_hz=10.0)
    c3 = synth_alloy_tine(2637.02, 1.85, decay_rate=1.1, warmth=0.58, detune_cents=1.4, pitch_slump_hz=8.0)
    c4 = synth_alloy_tine(3520.00, 1.85, decay_rate=0.85, warmth=0.50, detune_cents=1.6, pitch_slump_hz=0.0)
    c5 = synth_alloy_tine(4434.92, 1.50, decay_rate=1.10, warmth=0.40, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_p, c1, int(0.010 * SR), 0.58)
    add_layer(mix_p, c2, int(0.070 * SR), 0.62)
    add_layer(mix_p, c3, int(0.135 * SR), 0.74)
    add_layer(mix_p, c4, int(0.205 * SR), 0.82)
    add_layer(mix_p, c5, int(0.280 * SR), 0.65)
    
    # THE BLOOM (opens outward at 320ms)
    i_bloom = int(0.320 * SR)
    bloom_root = synth_alloy_tine(1760.00, 1.65, decay_rate=0.85, warmth=0.60, detune_cents=2.2, pitch_slump_hz=0.0)
    bloom_chord = synth_alloy_tine(2637.02, 1.50, decay_rate=1.1, warmth=0.50, detune_cents=2.0, pitch_slump_hz=0.0)
    bloom_e8 = synth_alloy_tine(5274.04, 1.30, decay_rate=1.6, warmth=0.35, detune_cents=2.2, pitch_slump_hz=0.0)
    bloom_a8 = synth_alloy_tine(7040.00, 1.10, decay_rate=2.2, warmth=0.30, detune_cents=2.5, pitch_slump_hz=0.0)
    
    add_layer(mix_p, bloom_root, i_bloom, 0.38)
    add_layer(mix_p, bloom_chord, i_bloom + int(0.010 * SR), 0.28)
    add_layer(mix_p, bloom_e8, i_bloom + int(0.020 * SR), 0.24)
    add_layer(mix_p, bloom_a8, i_bloom + int(0.035 * SR), 0.18)
    
    # Expansive 3D ceremonial space IR with Haas binaural delay
    early_p = [(8.0, 0.52), (18.0, 0.46), (30.0, 0.38), (44.0, 0.28), (62.0, 0.22), (80.0, 0.16)]
    ir_p = make_ceremonial_space(decay_s=1.35, cutoff_hz=8000, early_pattern=early_p, seed=303)
    wet_l = fftconvolve(mix_p[:, 0], ir_p[:, 0])
    wet_r = fftconvolve(mix_p[:, 1], ir_p[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_p, wet_st / w_pk, int(0.205 * SR), 0.32)
        
    platinum = finalize_tier_master(mix_p, dur_p, peak_ceiling_db=-1.0, fade_start_ratio=0.88,
                                    dynamic_widen=True, hp_hz=120)

    return bronze, silver, gold, platinum


# ==============================================================================
# Suite 4: Universfield Warm (Acoustic Warm Bar / 5th Fanfare)
# Baseline: universfield-new-notification-012-363675.mp3
# Motif: G#4 (415 Hz) -> D#5 (622 Hz) (Key of G# Major)
# ==============================================================================

def build_suite4_tiers(base_audio):
    """Builds Bronze, Silver, Gold, Platinum for Suite 4 (Universfield Warm)."""
    transient = isolate_transient(base_audio, duration_ms=35, hp_hz=800)
    
    # 1. BRONZE (1.000s) — Pure intimate 2-note warm bar motif
    dur_b = 1.000
    mix_b = np.zeros((int(dur_b * SR), 2))
    add_layer(mix_b, base_audio, 0, 1.0)
    bronze = finalize_tier_master(mix_b, dur_b, peak_ceiling_db=-1.0, fade_start_ratio=0.85, width=1.12, hp_hz=140)

    # 2. SILVER (1.320s) — Extended Bar Resonance & Sympathetic 3rd
    dur_s = 1.320
    mix_s = np.zeros((int(dur_s * SR), 2))
    add_layer(mix_s, base_audio, 0, 0.95)
    
    # Sympathetic C5 (Major 3rd) connecting G#4 and D#5, plus high shimmering glints
    bar_c5 = synth_alloy_tine(523.25, 1.15, decay_rate=2.4, warmth=0.72, detune_cents=1.4, pitch_slump_hz=8.0)
    glint_g6 = synth_alloy_tine(1661.22, 1.00, decay_rate=3.5, warmth=0.50, detune_cents=1.8, pitch_slump_hz=0.0)
    glint_d7 = synth_alloy_tine(2489.02, 0.85, decay_rate=4.2, warmth=0.40, detune_cents=2.0, pitch_slump_hz=0.0)
    
    add_layer(mix_s, bar_c5, int(0.070 * SR), 0.38)
    add_layer(mix_s, glint_g6, int(0.120 * SR), 0.25)
    add_layer(mix_s, glint_d7, int(0.140 * SR), 0.18)
    
    early = [(6.0, 0.42), (14.0, 0.38), (22.0, 0.28)]
    ir_s = make_ceremonial_space(decay_s=0.58, cutoff_hz=7000, early_pattern=early, seed=401)
    wet_l = fftconvolve(mix_s[:, 0], ir_s[:, 0])
    wet_r = fftconvolve(mix_s[:, 1], ir_s[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_s, wet_st / w_pk, int(0.080 * SR), 0.22)
    silver = finalize_tier_master(mix_s, dur_s, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.25, hp_hz=130)

    # 3. GOLD (1.650s) — Developed Warm Ceremonial Fanfare
    dur_g = 1.650
    mix_g = np.zeros((int(dur_g * SR), 2))
    add_layer(mix_g, transient, 0, 0.95)
    add_layer(mix_g, base_audio, 0, 0.70)
    
    # Deep physical mass (G#3 = 207.65 Hz)
    g3_mass = synth_alloy_tine(207.65, 1.45, decay_rate=1.8, warmth=0.90, detune_cents=0.8, pitch_slump_hz=6.0)
    add_layer(mix_g, g3_mass, int(0.005 * SR), 0.42)
    
    # 4-Step Ascending Fanfare: G#4 (10ms) -> C5 (85ms) -> D#5 (165ms) -> G#5 crown (245ms)
    b1 = synth_alloy_tine(415.30, 1.45, decay_rate=2.5, warmth=0.82, detune_cents=1.5, pitch_slump_hz=14.0)
    b2 = synth_alloy_tine(523.25, 1.45, decay_rate=2.0, warmth=0.75, detune_cents=1.5, pitch_slump_hz=10.0)
    b3 = synth_alloy_tine(622.25, 1.40, decay_rate=1.6, warmth=0.68, detune_cents=1.4, pitch_slump_hz=8.0)
    b4 = synth_alloy_tine(830.61, 1.35, decay_rate=1.25, warmth=0.60, detune_cents=1.6, pitch_slump_hz=6.0)
    glint_c6 = synth_alloy_tine(1046.50, 0.95, decay_rate=2.8, warmth=0.45, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_g, b1, int(0.010 * SR), 0.54)
    add_layer(mix_g, b2, int(0.085 * SR), 0.58)
    add_layer(mix_g, b3, int(0.165 * SR), 0.72)
    add_layer(mix_g, b4, int(0.245 * SR), 0.78)
    add_layer(mix_g, glint_c6, int(0.260 * SR), 0.24)
    
    early_g = [(7.0, 0.48), (16.0, 0.42), (28.0, 0.32), (42.0, 0.24)]
    ir_g = make_ceremonial_space(decay_s=0.90, cutoff_hz=7200, early_pattern=early_g, seed=402)
    wet_l = fftconvolve(mix_g[:, 0], ir_g[:, 0])
    wet_r = fftconvolve(mix_g[:, 1], ir_g[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_g, wet_st / w_pk, int(0.245 * SR), 0.26)
    gold = finalize_tier_master(mix_g, dur_g, peak_ceiling_db=-1.0, fade_start_ratio=0.88, width=1.38, hp_hz=110)

    # 4. PLATINUM (2.000s) — Warm Trophy Cathedral Bloom
    dur_p = 2.000
    mix_p = np.zeros((int(dur_p * SR), 2))
    add_layer(mix_p, transient, 0, 0.98)
    add_layer(mix_p, base_audio, 0, 0.65)
    
    # Grounded substantial physical mass (G#3 + D#4)
    g3_mass = synth_alloy_tine(207.65, 1.80, decay_rate=1.3, warmth=0.94, detune_cents=0.8, pitch_slump_hz=8.0)
    d4_mass = synth_alloy_tine(311.13, 1.80, decay_rate=1.2, warmth=0.88, detune_cents=1.0, pitch_slump_hz=10.0)
    add_layer(mix_p, g3_mass, int(0.005 * SR), 0.42)
    add_layer(mix_p, d4_mass, int(0.010 * SR), 0.38)
    
    # Complete Ascending Herald Phrase
    c1 = synth_alloy_tine(415.30, 1.80, decay_rate=1.8, warmth=0.80, detune_cents=1.5, pitch_slump_hz=16.0)
    c2 = synth_alloy_tine(523.25, 1.80, decay_rate=1.5, warmth=0.74, detune_cents=1.5, pitch_slump_hz=12.0)
    c3 = synth_alloy_tine(622.25, 1.85, decay_rate=1.1, warmth=0.68, detune_cents=1.4, pitch_slump_hz=9.0)
    c4 = synth_alloy_tine(830.61, 1.85, decay_rate=0.85, warmth=0.62, detune_cents=1.6, pitch_slump_hz=6.0)
    c5 = synth_alloy_tine(1046.50, 1.50, decay_rate=1.10, warmth=0.52, detune_cents=1.8, pitch_slump_hz=0.0)
    
    add_layer(mix_p, c1, int(0.010 * SR), 0.58)
    add_layer(mix_p, c2, int(0.075 * SR), 0.62)
    add_layer(mix_p, c3, int(0.145 * SR), 0.74)
    add_layer(mix_p, c4, int(0.215 * SR), 0.82)
    add_layer(mix_p, c5, int(0.285 * SR), 0.68)
    
    # THE BLOOM (opens outward at 330ms)
    i_bloom = int(0.330 * SR)
    bloom_root = synth_alloy_tine(830.61, 1.65, decay_rate=0.85, warmth=0.62, detune_cents=2.2, pitch_slump_hz=0.0)
    bloom_chord = synth_alloy_tine(1046.50, 1.50, decay_rate=1.1, warmth=0.52, detune_cents=2.0, pitch_slump_hz=0.0)
    bloom_d6 = synth_alloy_tine(1244.51, 1.35, decay_rate=1.5, warmth=0.45, detune_cents=2.0, pitch_slump_hz=0.0)
    bloom_g6 = synth_alloy_tine(1661.22, 1.15, decay_rate=2.0, warmth=0.38, detune_cents=2.4, pitch_slump_hz=0.0)
    
    add_layer(mix_p, bloom_root, i_bloom, 0.38)
    add_layer(mix_p, bloom_chord, i_bloom + int(0.010 * SR), 0.28)
    add_layer(mix_p, bloom_d6, i_bloom + int(0.020 * SR), 0.26)
    add_layer(mix_p, bloom_g6, i_bloom + int(0.035 * SR), 0.20)
    
    # Expansive 3D ceremonial space IR with Haas binaural delay
    early_p = [(8.0, 0.50), (18.0, 0.46), (30.0, 0.38), (44.0, 0.28), (60.0, 0.22), (78.0, 0.16)]
    ir_p = make_ceremonial_space(decay_s=1.35, cutoff_hz=7400, early_pattern=early_p, seed=403)
    wet_l = fftconvolve(mix_p[:, 0], ir_p[:, 0])
    wet_r = fftconvolve(mix_p[:, 1], ir_p[:, 1])
    wet_st = np.stack([wet_l, wet_r], axis=1)
    w_pk = np.max(np.abs(wet_st))
    if w_pk > 1e-6:
        add_layer(mix_p, wet_st / w_pk, int(0.215 * SR), 0.32)
        
    platinum = finalize_tier_master(mix_p, dur_p, peak_ceiling_db=-1.0, fade_start_ratio=0.88,
                                    dynamic_widen=True, hp_hz=90)

    return bronze, silver, gold, platinum


# ==============================================================================
# Master File Exporter & HTML Generator
# ==============================================================================

def write_audio_file(base_path, audio_data):
    """Writes both 24-bit 48kHz WAV and 320kbps MP3."""
    os.makedirs(os.path.dirname(base_path), exist_ok=True)
    wav_path = base_path + ".wav"
    mp3_path = base_path + ".mp3"
    
    # 24-bit PCM WAV
    scaled = np.clip(audio_data, -1.0, 1.0)
    int_samples = (scaled * (2**23 - 1)).astype(np.int32)
    raw_24 = bytearray()
    for s in int_samples.reshape(-1):
        raw_24.extend(int(s).to_bytes(4, byteorder="little", signed=True)[:3])
    
    cmd_wav = [
        FF, "-y", "-v", "error",
        "-f", "s24le", "-ar", str(SR), "-ac", "2",
        "-i", "-",
        "-c:a", "pcm_s24le",
        wav_path
    ]
    subprocess.run(cmd_wav, input=bytes(raw_24), check=True)
    
    # 320kbps MP3
    cmd_mp3 = [
        FF, "-y", "-v", "error",
        "-i", wav_path,
        "-c:a", "libmp3lame", "-b:a", "320k",
        mp3_path
    ]
    subprocess.run(cmd_mp3, check=True)
    return wav_path, mp3_path


SUITES = [
    {
        "id": "1_process_chime",
        "title": "Candidate 1: Simple Process (Modern Alloy Tech Chime)",
        "short_title": "1. Modern Alloy",
        "filename": "36505577-simple-notify-completed-process-274737.mp3",
        "key": "Bb Major",
        "character": "Crisp futuristic digital-alloy chime. High crystalline tap resolving into focused Bb5/Bb6 body with rapid transient recovery.",
        "builder": build_suite1_tiers,
    },
    {
        "id": "2_denielcz_bell",
        "title": "Candidate 2: Denielcz Bell (Resonant Pure Bell Strike)",
        "short_title": "2. Pure Bell",
        "filename": "denielcz-notify-463076.mp3",
        "key": "C Major",
        "character": "Deep ceremonial bronze bell strike. Warm fundamental body C4 (261 Hz) + rich bell mode C6 (1038 Hz) and modal side-harmonics.",
        "builder": build_suite2_tiers,
    },
    {
        "id": "3_crystal_shimmer",
        "title": "Candidate 3: Crystal Shimmer (Celestial Glass Cascade)",
        "short_title": "3. Celestial Glass",
        "filename": "notification_message-best-notification-10-286664.mp3",
        "key": "A Ethereal",
        "character": "High-register crystalline glass cluster. Cascading high-frequency modal harmonics (D7, E7, G7, A7, B7, F8) with airy celestial decay.",
        "builder": build_suite3_tiers,
    },
    {
        "id": "4_universfield_warm",
        "title": "Candidate 4: Universfield Warm (Acoustic Warm Bar / 5th Fanfare)",
        "short_title": "4. Warm Bar",
        "filename": "universfield-new-notification-012-363675.mp3",
        "key": "G# Major",
        "character": "Warm, struck acoustic bar / chime. Ascending perfect 5th (G#4 ➔ D#5) with shimmering octave harmonics and rich physical resonance.",
        "builder": build_suite4_tiers,
    },
]

TIER_METADATA = [
    {
        "tier": "bronze",
        "title": "Bronze Trophy",
        "escalation": "NICE",
        "color": "#cd7f32",
        "target_dur": "1.000s",
        "role": "Small, precise, intimate, satisfying. Authoritative reference establishing material, transient, and harmonic DNA.",
    },
    {
        "tier": "silver",
        "title": "Silver Trophy",
        "escalation": "NICE+",
        "color": "#c0c6cc",
        "target_dur": "1.320s",
        "role": "Bronze + Refinement. Extended natural resonance, sympathetic overtones, subtle stereo air, tail lingers longer.",
    },
    {
        "tier": "gold",
        "title": "Gold Trophy",
        "escalation": "COOL",
        "color": "#e5a93c",
        "target_dur": "1.650s",
        "role": "Ceremonial presentation. Developed 4-step ascending fanfare, second harmonic layer, grounded mass body, ceremonial space.",
    },
    {
        "tier": "platinum",
        "title": "Platinum Trophy",
        "escalation": "MINDBLOWING",
        "color": "#40c4ff",
        "target_dur": "2.000s",
        "role": "Dramatic leap in prestige. Familiar impact ➔ dramatic Bloom outward ➔ ascending harmonic payoff ➔ wide surrounding space ➔ 0.85s lingering tail.",
    },
]


def generate_all():
    """Generates all 16 audio files, collects manifest data, and builds HTML player."""
    manifest = []
    print("=" * 70)
    print("SteamStation Baseline Trophy Progression Designer")
    print("=" * 70)
    
    os.makedirs(PROGRESSIONS_DIR, exist_ok=True)
    
    for s_idx, suite in enumerate(SUITES):
        s_id = suite["id"]
        suite_dir = os.path.join(PROGRESSIONS_DIR, s_id)
        os.makedirs(suite_dir, exist_ok=True)
        
        baseline_file = os.path.join(BASELINE_DIR, suite["filename"])
        print(f"\nProcessing [{suite['short_title']}]: {suite['filename']} ...")
        base_audio = load_and_trim_baseline(baseline_file)
        
        # Build 4 tiers
        bronze, silver, gold, platinum = suite["builder"](base_audio)
        tiers_audio = [bronze, silver, gold, platinum]
        
        suite_entry = {
            "id": s_id,
            "title": suite["title"],
            "short_title": suite["short_title"],
            "key": suite["key"],
            "character": suite["character"],
            "tiers": []
        }
        
        for t_idx, t_meta in enumerate(TIER_METADATA):
            tier_id = t_meta["tier"]
            audio_data = tiers_audio[t_idx]
            base_out = os.path.join(suite_dir, tier_id)
            wav_path, mp3_path = write_audio_file(base_out, audio_data)
            
            with open(mp3_path, "rb") as f:
                b64_mp3 = base64.b64encode(f.read()).decode("ascii")
                
            dur = len(audio_data) / SR
            peak = float(np.max(np.abs(audio_data)))
            peak_db = 20 * np.log10(peak + 1e-9)
            rms = float(np.sqrt(np.mean(audio_data**2)))
            rms_db = 20 * np.log10(rms + 1e-9)
            
            # Mid/side width calculation
            mid = (audio_data[:, 0] + audio_data[:, 1]) * 0.5
            side = (audio_data[:, 0] - audio_data[:, 1]) * 0.5
            w_ratio = float(np.sqrt(np.mean(side**2) + 1e-9) / np.sqrt(np.mean(mid**2) + 1e-9))
            
            rel_wav = f"progressions/{s_id}/{tier_id}.wav"
            rel_mp3 = f"progressions/{s_id}/{tier_id}.mp3"
            
            print(f"  [{t_meta['escalation']:11s}] {t_meta['title']:15s} | Dur: {dur:.3f}s | Peak: {peak_db:.2f} dBFS | RMS: {rms_db:.2f} dBFS | Width: {w_ratio:.2f}")
            
            suite_entry["tiers"].append({
                "tier": tier_id,
                "title": t_meta["title"],
                "escalation": t_meta["escalation"],
                "color": t_meta["color"],
                "target_dur": t_meta["target_dur"],
                "actual_dur": f"{dur:.3f}s",
                "peak_db": f"{peak_db:.2f} dBFS",
                "rms_db": f"{rms_db:.2f} dBFS",
                "width_ratio": f"{w_ratio:.2f}x",
                "role": t_meta["role"],
                "rel_wav": rel_wav,
                "rel_mp3": rel_mp3,
                "b64_mp3": b64_mp3,
            })
            
        manifest.append(suite_entry)
        
    manifest_path = os.path.join(PROGRESSIONS_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        compact_manifest = []
        for s in manifest:
            s_copy = dict(s)
            s_copy["tiers"] = [{k: v for k, v in t.items() if k != "b64_mp3"} for t in s["tiers"]]
            compact_manifest.append(s_copy)
        json.dump(compact_manifest, f, indent=2)
        
    print(f"\nManifest saved to: {manifest_path}")

    # Build ZIP archives
    zip_mp3 = os.path.join(BASELINE_DIR, "SteamStation_Baseline_Progressions_MP3.zip")
    zip_wav = os.path.join(BASELINE_DIR, "SteamStation_Baseline_Progressions_WAV.zip")
    with zipfile.ZipFile(zip_mp3, 'w', zipfile.ZIP_DEFLATED) as zm:
        for root, dirs, files in os.walk(PROGRESSIONS_DIR):
            for f in files:
                if f.endswith('.mp3'):
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, PROGRESSIONS_DIR)
                    zm.write(full, rel)
    with zipfile.ZipFile(zip_wav, 'w', zipfile.ZIP_DEFLATED) as zw:
        for root, dirs, files in os.walk(PROGRESSIONS_DIR):
            for f in files:
                if f.endswith('.wav'):
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, PROGRESSIONS_DIR)
                    zw.write(full, rel)
    print(f"Zip archives created:\n  - {zip_mp3} ({os.path.getsize(zip_mp3)/1024:.1f} KB)\n  - {zip_wav} ({os.path.getsize(zip_wav)/1024:.1f} KB)")

    build_html_preview(manifest)


def build_html_preview(manifest):
    """Builds the interactive HTML audition suite."""
    template = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation — Baseline Trophy Audio Progression Audition Suite</title>
<style>
  :root {
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
    --accent: #0070d1;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 30px 20px 80px;
    display: flex;
    justify-content: center;
  }
  .container {
    max-width: 960px;
    width: 100%;
  }
  .header {
    text-align: center;
    margin-bottom: 28px;
  }
  .badge-top {
    display: inline-block;
    padding: 5px 16px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    background: rgba(64, 196, 255, 0.15);
    color: var(--platinum);
    border: 1px solid rgba(64, 196, 255, 0.35);
    margin-bottom: 12px;
  }
  h1 { font-size: 30px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.5px; }
  .subtitle { color: var(--sub); font-size: 14px; max-width: 720px; margin: 0 auto; line-height: 1.6; }

  /* Header Actions / Downloads */
  .header-actions {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-top: 16px;
  }
  .btn-zip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #c9d1d9;
    background: #131a29;
    border: 1px solid #2a3850;
    text-decoration: none;
    transition: all 0.15s ease;
  }
  .btn-zip:hover {
    color: #fff;
    background: #1b263b;
    border-color: var(--platinum);
    transform: translateY(-1px);
  }

  /* Suite Selector Tabs */
  .suite-tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 10px;
    margin: 24px 0;
  }
  .suite-tab {
    background: #0f141f;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }
  .suite-tab:hover {
    background: #141b2a;
    border-color: #313d54;
  }
  .suite-tab.active {
    background: #172135;
    border-color: var(--platinum);
    box-shadow: 0 0 16px rgba(64, 196, 255, 0.2);
  }
  .suite-tab-num {
    font-size: 11px;
    font-weight: 700;
    color: var(--sub);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .suite-tab.active .suite-tab-num {
    color: var(--platinum);
  }
  .suite-tab-title {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Suite Banner */
  .suite-banner {
    background: linear-gradient(135deg, #131a29, #1b2438);
    border: 1px solid #2d3b55;
    border-radius: 12px;
    padding: 18px 22px;
    margin-bottom: 26px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }
  .banner-info {
    flex: 1;
    min-width: 280px;
  }
  .banner-title {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
  }
  .banner-desc {
    font-size: 13px;
    color: var(--sub);
    line-height: 1.5;
  }
  .btn-sequence {
    background: linear-gradient(135deg, #0070d1, #40c4ff);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 12px 22px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(64, 196, 255, 0.3);
    transition: transform 0.12s ease;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn-sequence:hover { transform: scale(1.03); }
  .btn-sequence:active { transform: scale(0.97); }

  /* Tier Cards */
  .tier-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 36px;
  }
  .tier-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 22px;
    display: flex;
    align-items: center;
    gap: 20px;
    transition: all 0.15s ease;
    cursor: pointer;
  }
  .tier-card:hover {
    background: var(--card-hover);
    border-color: #313d54;
    transform: translateY(-1px);
  }
  .tier-card.bronze { border-left: 5px solid var(--bronze); }
  .tier-card.silver { border-left: 5px solid var(--silver); }
  .tier-card.gold { border-left: 5px solid var(--gold); }
  .tier-card.platinum { border-left: 5px solid var(--platinum); }

  .tier-card.active {
    background: #172133;
    border-color: #3b4e72;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  .play-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #1a2233;
    border: 1px solid #2e3a50;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s ease;
    cursor: pointer;
  }
  .tier-card:hover .play-btn {
    background: var(--accent);
    border-color: var(--platinum);
    color: #fff;
    transform: scale(1.05);
  }
  .tier-card.active .play-btn {
    background: var(--platinum);
    color: #080b10;
  }

  .tier-content {
    flex: 1;
    min-width: 0;
  }
  .tier-header-line {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .tier-name {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }
  .badge-esc {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.6px;
    padding: 3px 8px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .badge-esc.nice { background: rgba(205, 127, 50, 0.2); color: var(--bronze); border: 1px solid var(--bronze); }
  .badge-esc.nice-plus { background: rgba(192, 198, 204, 0.2); color: var(--silver); border: 1px solid var(--silver); }
  .badge-esc.cool { background: rgba(229, 169, 60, 0.2); color: var(--gold); border: 1px solid var(--gold); }
  .badge-esc.mindblowing {
    background: rgba(64, 196, 255, 0.25);
    color: var(--platinum);
    border: 1px solid var(--platinum);
    box-shadow: 0 0 10px rgba(64, 196, 255, 0.35);
  }

  .track-downloads {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
  .btn-track-dl {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #8b949e;
    background: #182030;
    border: 1px solid #28354c;
    text-decoration: none;
    transition: all 0.15s ease;
  }
  .btn-track-dl:hover {
    color: #fff;
    background: #24324a;
    border-color: var(--platinum);
  }

  .tier-role {
    font-size: 13px;
    color: var(--sub);
    line-height: 1.45;
    margin-bottom: 8px;
  }
  .tier-metrics {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: #798394;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    flex-wrap: wrap;
  }
  .metric-item span { color: #a4b1c6; }

  /* Progression Visualization */
  .curve-box {
    background: #0d121c;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 30px;
  }
  .curve-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 14px;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .curve-bars {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 80px 1fr 120px;
    align-items: center;
    gap: 14px;
    font-size: 12px;
  }
  .bar-label { font-weight: 600; }
  .bar-track {
    height: 12px;
    background: #141b2a;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }
  .bar-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.4s ease;
  }
  .bar-fill.bronze { width: 22%; background: var(--bronze); }
  .bar-fill.silver { width: 36%; background: var(--silver); }
  .bar-fill.gold { width: 58%; background: var(--gold); }
  .bar-fill.platinum {
    width: 100%;
    background: linear-gradient(90deg, #0070d1, #40c4ff);
    box-shadow: 0 0 12px rgba(64, 196, 255, 0.5);
  }
  .bar-val {
    font-weight: 700;
    text-align: right;
    font-size: 11px;
  }

  audio { display: none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="badge-top">Sonic DNA Evolution • 4-Tier System</div>
    <h1>Trophy Audio Progression Audition Suite</h1>
    <div class="subtitle">
      Baseline Bronze is established as the authoritative sonic reference. Silver, Gold, and Platinum evolve through a strict non-linear prestige curve:
      <strong>Nice ➔ Nice+ ➔ Cool ➔ MINDBLOWING</strong>.
    </div>
    <div class="header-actions">
      <a href="SteamStation_Baseline_Progressions_MP3.zip" download class="btn-zip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        Download All MP3s (Zip)
      </a>
      <a href="SteamStation_Baseline_Progressions_WAV.zip" download class="btn-zip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        Download All WAVs 24-bit (Zip)
      </a>
    </div>
  </div>

  <!-- Suite Tabs -->
  <div class="suite-tabs" id="suiteTabs"></div>

  <!-- Active Suite Banner -->
  <div class="suite-banner" id="suiteBanner">
    <div class="banner-info">
      <div class="banner-title" id="bannerTitle">Loading...</div>
      <div class="banner-desc" id="bannerDesc">Loading...</div>
    </div>
    <button class="btn-sequence" id="btnSequence" onclick="playSequence()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      Play Progression Sequence
    </button>
  </div>

  <!-- Tier Cards -->
  <div class="tier-list" id="tierList"></div>

  <!-- Non-linear Prestige Curve -->
  <div class="curve-box">
    <div class="curve-title">
      <span>Nonlinear Prestige Escalation Curve</span>
      <span style="font-size: 11px; color: var(--sub); font-weight: 400;">Ceiling: -1.00 dBFS (Density & Space, not volume inflation)</span>
    </div>
    <div class="curve-bars">
      <div class="bar-row">
        <div class="bar-label" style="color: var(--bronze);">Bronze</div>
        <div class="bar-track"><div class="bar-fill bronze"></div></div>
        <div class="bar-val" style="color: var(--bronze);">Nice (1.0s)</div>
      </div>
      <div class="bar-row">
        <div class="bar-label" style="color: var(--silver);">Silver</div>
        <div class="bar-track"><div class="bar-fill silver"></div></div>
        <div class="bar-val" style="color: var(--silver);">Nice+ (1.32s)</div>
      </div>
      <div class="bar-row">
        <div class="bar-label" style="color: var(--gold);">Gold</div>
        <div class="bar-track"><div class="bar-fill gold"></div></div>
        <div class="bar-val" style="color: var(--gold);">Cool (1.65s)</div>
      </div>
      <div class="bar-row">
        <div class="bar-label" style="color: var(--platinum);">Platinum</div>
        <div class="bar-track"><div class="bar-fill platinum"></div></div>
        <div class="bar-val" style="color: var(--platinum);">MINDBLOWING (2.0s)</div>
      </div>
    </div>
  </div>
</div>

<script>
const SUITES = MANIFEST_JSON_PLACEHOLDER;

let activeSuiteIdx = 0;
let currentAudio = null;
let currentTierIdx = -1;
let sequenceTimeout = null;

function init() {
  renderTabs();
  renderActiveSuite();
}

function renderTabs() {
  const container = document.getElementById("suiteTabs");
  container.innerHTML = "";
  SUITES.forEach((suite, idx) => {
    const tab = document.createElement("div");
    tab.className = `suite-tab ${idx === activeSuiteIdx ? 'active' : ''}`;
    tab.onclick = () => selectSuite(idx);
    tab.innerHTML = `
      <div class="suite-tab-num">${suite.short_title}</div>
      <div class="suite-tab-title">${suite.key}</div>
    `;
    container.appendChild(tab);
  });
}

function selectSuite(idx) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  clearTimeout(sequenceTimeout);
  activeSuiteIdx = idx;
  currentTierIdx = -1;
  renderTabs();
  renderActiveSuite();
}

function renderActiveSuite() {
  const suite = SUITES[activeSuiteIdx];
  document.getElementById("bannerTitle").textContent = suite.title;
  document.getElementById("bannerDesc").textContent = suite.character;

  const tierList = document.getElementById("tierList");
  tierList.innerHTML = "";

  suite.tiers.forEach((t, idx) => {
    const card = document.createElement("div");
    card.id = `card-${t.tier}`;
    card.className = `tier-card ${t.tier}`;
    card.onclick = () => playTier(idx);

    const escClass = t.escalation.toLowerCase().replace("+", "-plus");

    card.innerHTML = `
      <div class="play-btn" id="btn-${t.tier}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </div>
      <div class="tier-content">
        <div class="tier-header-line">
          <span class="tier-name">${t.title}</span>
          <span class="badge-esc ${escClass}">${t.escalation}</span>
          <div class="track-downloads">
            <a href="${t.rel_wav}" download class="btn-track-dl" onclick="event.stopPropagation()">WAV (24-bit)</a>
            <a href="${t.rel_mp3}" download class="btn-track-dl" onclick="event.stopPropagation()">MP3 (320k)</a>
          </div>
        </div>
        <div class="tier-role">${t.role}</div>
        <div class="tier-metrics">
          <div class="metric-item">Duration: <span>${t.actual_dur}</span></div>
          <div class="metric-item">Peak: <span>${t.peak_db}</span></div>
          <div class="metric-item">RMS: <span>${t.rms_db}</span></div>
          <div class="metric-item">Width: <span>${t.width_ratio}</span></div>
        </div>
      </div>
    `;
    tierList.appendChild(card);
  });
}

function playTier(idx) {
  const suite = SUITES[activeSuiteIdx];
  const t = suite.tiers[idx];
  
  if (currentAudio) {
    currentAudio.pause();
  }
  clearTimeout(sequenceTimeout);

  document.querySelectorAll(".tier-card").forEach(c => c.classList.remove("active"));
  const card = document.getElementById(`card-${t.tier}`);
  if (card) card.classList.add("active");

  currentAudio = new Audio("data:audio/mp3;base64," + t.b64_mp3);
  currentAudio.play();

  currentAudio.onended = () => {
    card.classList.remove("active");
  };
}

function playSequence() {
  if (currentAudio) {
    currentAudio.pause();
  }
  clearTimeout(sequenceTimeout);

  const suite = SUITES[activeSuiteIdx];
  let step = 0;

  function nextStep() {
    if (step >= suite.tiers.length) {
      document.querySelectorAll(".tier-card").forEach(c => c.classList.remove("active"));
      return;
    }
    const t = suite.tiers[step];
    document.querySelectorAll(".tier-card").forEach(c => c.classList.remove("active"));
    const card = document.getElementById(`card-${t.tier}`);
    if (card) card.classList.add("active");

    currentAudio = new Audio("data:audio/mp3;base64," + t.b64_mp3);
    currentAudio.play();

    step++;
    const gapMs = (parseFloat(t.actual_dur) * 1000) + 450;
    sequenceTimeout = setTimeout(nextStep, gapMs);
  }

  nextStep();
}

window.addEventListener("DOMContentLoaded", init);
</script>
</body>
</html>
"""
    html = template.replace("MANIFEST_JSON_PLACEHOLDER", json.dumps(manifest))
    out1 = os.path.join(BASELINE_DIR, "preview_baseline_progressions.html")
    out2 = os.path.join(THEME_DIR, "preview_baseline_progressions.html")
    
    with open(out1, "w", encoding="utf-8") as f:
        f.write(html)
    with open(out2, "w", encoding="utf-8") as f:
        f.write(html)
        
    print(f"\nPreview HTML written to:\n  1. {out1}\n  2. {out2}")


if __name__ == "__main__":
    generate_all()
