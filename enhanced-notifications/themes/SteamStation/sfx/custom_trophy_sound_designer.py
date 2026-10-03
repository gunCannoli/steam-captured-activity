#!/usr/bin/env python3
"""SteamStation Custom Tiered Trophy Sound Designer.

100% Original Sound Design - Zero PlayStation Audio Files.
Engineered around the core principle of a subtle chime + ambient sound bed
that starts simple and grows progressively richer, deeper, and more spacious
as trophy rarity rises:
  - Bronze & Silver: ~1.0 second
  - Gold: ~1.5 seconds
  - Platinum: ~2.0 seconds

Generates three distinct, bespoke acoustic styles:
  1. Prism (Original Flagship): Pure crystalline glass chimes + airy ambient shimmer
  2. Velvet (Warm Bells): Rich orchestral bell tines + deep atmospheric swells
  3. Electro (Modern Deck): Sleek high-tech PC transients + futuristic spatial pads

Usage:
  python custom_trophy_sound_designer.py             # Generates all sets and preview player
  python custom_trophy_sound_designer.py --open      # Generates and opens preview in browser
"""

import os
import sys
import json
import zipfile
import argparse
import subprocess
import webbrowser
import numpy as np
import imageio_ffmpeg
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
THEME_DIR = os.path.dirname(HERE)
CUSTOM_TIERS_DIR = os.path.join(HERE, "custom_tiers")
FF = imageio_ffmpeg.get_ffmpeg_exe()


def load_steam_audio(filename):
    """Loads a Steam audio file as float64 stereo at 48 kHz, trimming leading silence."""
    p = os.path.join(THEME_DIR, filename)
    if not os.path.isfile(p):
        return None
    raw = subprocess.run(
        [FF, "-v", "error", "-i", p, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    pk = np.abs(x).max()
    if pk > 1e-5:
        on = np.argmax(np.abs(x).max(1) > pk * 0.003)
        x = x[max(0, on - int(0.003 * SR)) :]
    return x


def filt(x, kind, hz, order=2):
    """Butterworth filter helper."""
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def stereo_widen(x, factor=1.40):
    """Mid/Side stereo widen (>1) or narrow (<1)."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def synthesize_modal_chime(f0, duration_s, decay_mult=1.0, warmth=0.75, detune_cents=2.2, inharmonic=False):
    """Synthesizes an acoustic chime strike using physical vibrational modes of struck metal bars/tubes.

    Overtones follow the physics of vibrational modes in struck cylindrical / bar resonators:
    Fundamental (1.0), Mode 2 (2.756), Mode 3 (5.404), Mode 4 (8.933), Sub-harmonic hum (0.5).
    """
    if inharmonic:
        modes = [
            (1.000, 1.00, 3.2 * decay_mult),
            (2.185, 0.45, 5.0 * decay_mult),
            (3.842, 0.28, 7.8 * decay_mult),
            (6.120, 0.15, 11.5 * decay_mult),
            (0.500, 0.35 * warmth, 2.2 * decay_mult),
        ]
    else:
        modes = [
            (1.000, 1.00, 3.0 * decay_mult),
            (2.756, 0.42, 5.5 * decay_mult),
            (5.404, 0.22, 8.8 * decay_mult),
            (8.933, 0.10, 13.5 * decay_mult),
            (0.500, 0.30 * warmth, 2.2 * decay_mult),
        ]

    n_samples = int(duration_s * SR)
    t = np.linspace(0, duration_s, n_samples)
    left = np.zeros(n_samples)
    right = np.zeros(n_samples)

    for mult, amp, decay_rate in modes:
        f = f0 * mult
        if f > (SR / 2 - 500):
            continue
        # Slight stereo decorrelation via micro-detuning (natural acoustic chorus)
        f_l = f * (2.0 ** (-detune_cents / 1200.0))
        f_r = f * (2.0 ** (detune_cents / 1200.0))
        env = np.exp(-decay_rate * (t / duration_s * 2.5))
        left += amp * np.sin(2 * np.pi * f_l * t) * env
        right += amp * np.sin(2 * np.pi * f_r * t + 0.25) * env

    sig = np.stack([left, right], axis=1)
    pk = np.max(np.abs(sig))
    return sig / (pk + 1e-8)


def synth_ambient_bed(freqs, duration_s, decay_exp=2.8, detune_cents=4.5, lfo_rate=0.3):
    """Synthesizes a lush, organic stereo ambient drone pad with gentle chorus LFO motion."""
    n_samples = int(duration_s * SR)
    t = np.linspace(0, duration_s, n_samples)
    left = np.zeros(n_samples)
    right = np.zeros(n_samples)

    for i, f in enumerate(freqs):
        f_l = f * (2.0 ** (-detune_cents / 1200.0))
        f_r = f * (2.0 ** (detune_cents / 1200.0))
        lfo = 1.0 + 0.18 * np.sin(2 * np.pi * (lfo_rate + 0.04 * i) * t)
        env = np.exp(-decay_exp * (t / duration_s))
        left += np.sin(2 * np.pi * f_l * t) * env * lfo
        right += np.sin(2 * np.pi * f_r * t + (np.pi / 4.0) * (i + 1)) * env * (2.0 - lfo)

    stereo = np.stack([left, right], axis=1)
    pk = np.max(np.abs(stereo))
    return stereo / (pk + 1e-8) if pk > 1e-6 else stereo


synth_ambient_drone = synth_ambient_bed


def generate_diffuse_reverb_ir(decay_s, tone_hz=6500, seed=42):
    """Synthesizes a smooth stereo diffuse reverb impulse response."""
    rng = np.random.default_rng(seed)
    n = int(decay_s * SR)
    env = np.exp(-6.2 * np.linspace(0, 1, n))[:, None]
    ir = rng.standard_normal((n, 2)) * env
    ir = filt(ir, "lowpass", tone_hz, order=2)
    ir[: int(0.008 * SR)] = 0  # 8ms pre-delay
    norm = np.sqrt((ir**2).sum(axis=0, keepdims=True)) + 1e-8
    return ir / norm


def apply_convolution_hall(x, ir, mix_level=0.35, width=1.45):
    """Convolves audio with diffuse IR for authentic 3D spatial diffusion."""
    conv_l = fftconvolve(x[:, 0], ir[:, 0])
    conv_r = fftconvolve(x[:, 1], ir[:, 1])
    wet = np.stack([conv_l, conv_r], axis=1)
    wet = stereo_widen(wet, width)
    wet_pk = np.max(np.abs(wet))
    if wet_pk > 1e-6:
        wet /= wet_pk
    return wet * mix_level


def mix_layers(*layers):
    """Mixes multiple 2D numpy audio arrays, zero-padding to the maximum length."""
    max_len = max(len(l) for l in layers)
    out = np.zeros((max_len, 2), dtype=np.float64)
    for l in layers:
        out[: len(l)] += l
    return out


def extract_steam_transient(toast_audio, duration_ms=35, hp_freq=800):
    """Extracts the tactile PC transient click from Steam in mono (or synthesizes one)."""
    if toast_audio is not None and len(toast_audio) > int(0.05 * SR):
        t_len = int(duration_ms * 0.001 * SR)
        t_chunk = toast_audio[:t_len].copy()
        flat_len = int(0.010 * SR)
        env = np.ones(len(t_chunk))
        if len(t_chunk) > flat_len:
            env[flat_len:] = np.cos(np.linspace(0, np.pi / 2, len(t_chunk) - flat_len)) ** 2
        t_chunk *= env[:, None]
        t_chunk = filt(t_chunk, "highpass", hp_freq, order=3)
        mono = 0.5 * (t_chunk[:, 0] + t_chunk[:, 1])
        return np.stack([mono, mono], axis=1)
    # Fallback procedural tactile strike
    n = int(duration_ms * 0.001 * SR)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(123)
    click = rng.standard_normal(n) * np.exp(-14.0 * t)
    click = filt(np.stack([click, click], axis=1), "highpass", hp_freq, order=3)
    return click / np.max(np.abs(click))


def master_sound(x, target_duration, target_rms_db=-15.0, fade_out_s=0.25, peak_ceiling_db=-0.3):
    """Trims to exact duration target, applies fade, normalizes loudness, and soft-saturates."""
    target_len = int(target_duration * SR)
    out = np.zeros((target_len, 2), dtype=np.float64)
    n = min(len(x), target_len)
    out[:n] = x[:n]

    # Smooth cosine-squared fade out at the end
    fade_len = int(fade_out_s * SR)
    if fade_len > 0 and target_len > fade_len:
        out[-fade_len:] *= (np.cos(np.linspace(0, np.pi / 2, fade_len)) ** 2)[:, None]

    # RMS normalization across active portion
    act = out[np.abs(out).max(1) > np.abs(out).max() * 0.05]
    if len(act) > 0:
        cur_rms = np.sqrt((act**2).mean())
        if cur_rms > 1e-6:
            target_rms = 10 ** (target_rms_db / 20.0)
            out *= target_rms / cur_rms

    # Musical soft limiting ceiling via tanh
    ceiling = 10 ** (peak_ceiling_db / 20.0)
    pk = np.abs(out).max()
    if pk > ceiling * 0.8:
        out = np.tanh(out / pk * 1.45) / np.tanh(1.45) * ceiling

    return out


def write_audio_pair(base_path, audio_data):
    """Writes both MP3 (192k) and WAV files."""
    pcm = np.clip(audio_data, -1.0, 1.0).astype(np.float32).tobytes()
    mp3_path = base_path + ".mp3"
    wav_path = base_path + ".wav"

    subprocess.run(
        [
            FF,
            "-v",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ac",
            "2",
            "-ar",
            str(SR),
            "-i",
            "-",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            mp3_path,
        ],
        input=pcm,
        check=True,
    )
    subprocess.run(
        [FF, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-", wav_path],
        input=pcm,
        check=True,
    )
    return mp3_path, wav_path


# ==============================================================================
# STYLE 1: PRISM (Original Flagship - Pure Glass Chimes & Crystalline Shimmer)
# Tonality: F Major / C Lydian (Bright, inspiring, ethereal)
# ==============================================================================


def build_prism_bronze(toast):
    """Bronze (~1.0s): Singular pure F5 crystalline chime + quick subtle warm ambient decay."""
    dur = 1.00
    st_pop = extract_steam_transient(toast, duration_ms=35, hp_freq=800)

    # Chime: Single pure F5 chime strike (698.46 Hz)
    f0 = 698.46
    chime = synthesize_modal_chime(f0, duration_s=0.75, decay_mult=1.35, warmth=0.7)

    # Ambient: Subtle warm atmospheric undertone (F4 = 349.2 Hz, C5 = 523.3 Hz)
    ambient = synth_ambient_drone([349.23, 523.25], dur, decay_exp=4.5, detune_cents=3.5, lfo_rate=0.4)
    ambient = filt(ambient, "lowpass", 1300)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 2.80  # Tactile PC pop
    mix[: len(chime)] += chime * 0.70  # Singular pure chime
    mix[: len(ambient)] += ambient * 0.18  # Subtle ambient warmth

    return master_sound(mix, target_duration=dur, target_rms_db=-16.8, fade_out_s=0.18)


def build_prism_silver(toast):
    """Silver (~1.0s): Ascending 2-tone chime interval (F5 ➔ C6) + airy stereo shimmer bed."""
    dur = 1.00
    st_pop = extract_steam_transient(toast, duration_ms=35, hp_freq=800)

    # Chime 1: Root F5 (698.46 Hz) at t=15ms
    chime1 = synthesize_modal_chime(698.46, duration_s=0.70, decay_mult=1.2, warmth=0.7)
    # Chime 2: Ascending 5th C6 (1046.50 Hz) at t=110ms
    chime2 = synthesize_modal_chime(1046.50, duration_s=0.65, decay_mult=1.1, warmth=0.6)

    # Ambient: Airy bandpassed stereo shimmer bed (width 1.35x)
    ambient = synth_ambient_drone([349.23, 523.25, 880.0], dur, decay_exp=3.6, detune_cents=4.5, lfo_rate=0.45)
    ambient = filt(ambient, "bandpass", [380, 2600])
    ambient = stereo_widen(ambient, 1.35)

    ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6000, seed=12)
    hall = apply_convolution_hall(chime2, ir, mix_level=0.28, width=1.35)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 2.90
    mix[: len(chime1)] += chime1 * 0.65

    i2 = int(0.110 * SR)
    mix[i2 : min(mix_len, i2 + len(chime2))] += chime2[: max(0, mix_len - i2)] * 0.58
    mix[i2 : min(mix_len, i2 + len(hall))] += hall[: max(0, mix_len - i2)] * 0.28
    mix[: len(ambient)] += ambient * 0.24

    return master_sound(mix, target_duration=dur, target_rms_db=-15.5, fade_out_s=0.20)


def build_prism_gold(toast, launch):
    """Gold (~1.5s): 3-note ascending arpeggio (F5 ➔ A5 ➔ C6) + blooming warm stereo swell."""
    dur = 1.50
    st_pop = extract_steam_transient(toast, duration_ms=40, hp_freq=750)

    # Low-mid warm bloom from Steam launch sound
    if launch is not None:
        low_bloom = filt(launch[: int(1.1 * SR)], "bandpass", [110, 850])
        low_bloom *= (np.cos(np.linspace(0, np.pi / 2, len(low_bloom))) ** 2)[:, None]
    else:
        low_bloom = np.zeros((int(0.6 * SR), 2))

    # Chime Triad: F5 (698.46 Hz) ➔ A5 (880.00 Hz) ➔ C6 (1046.50 Hz)
    c1 = synthesize_modal_chime(698.46, duration_s=1.10, decay_mult=0.9, warmth=0.8)
    c2 = synthesize_modal_chime(880.00, duration_s=1.00, decay_mult=0.85, warmth=0.75)
    c3 = synthesize_modal_chime(1046.50, duration_s=0.90, decay_mult=0.8, warmth=0.7)

    # High crystalline glint overtone at 320ms (F6 = 1396.9 Hz)
    glint = synthesize_modal_chime(1396.91, duration_s=0.70, decay_mult=0.6, warmth=0.5)

    # Convolution shimmer hall
    ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=7000, seed=33)
    hall = apply_convolution_hall(c3, ir, mix_level=0.35, width=1.50)

    # Lush ambient drone pad
    ambient = synth_ambient_drone([174.61, 349.23, 523.25, 880.0], dur, decay_exp=2.6, detune_cents=5.0, lfo_rate=0.3)
    ambient = stereo_widen(ambient, 1.45)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.00
    mix[: len(low_bloom)] += low_bloom * 0.65
    mix[: len(c1)] += c1 * 0.65

    i2 = int(0.120 * SR)
    mix[i2 : min(mix_len, i2 + len(c2))] += c2[: max(0, mix_len - i2)] * 0.55

    i3 = int(0.240 * SR)
    mix[i3 : min(mix_len, i3 + len(c3))] += c3[: max(0, mix_len - i3)] * 0.52

    i_g = int(0.340 * SR)
    mix[i_g : min(mix_len, i_g + len(glint))] += glint[: max(0, mix_len - i_g)] * 0.35

    mix[i3 : min(mix_len, i3 + len(hall))] += hall[: max(0, mix_len - i3)] * 0.32
    mix[: len(ambient)] += ambient * 0.30

    return master_sound(mix, target_duration=dur, target_rms_db=-14.8, fade_out_s=0.28)


def build_prism_platinum(toast, launch):
    """Platinum (~2.0s): Celestial 4-note constellation chord + reverse riser + expansive space."""
    dur = 2.00
    st_pop = extract_steam_transient(toast, duration_ms=45, hp_freq=750)

    # 70ms reverse ambient breath riser before the impact
    riser_len = int(0.070 * SR)
    riser = synth_ambient_drone([349.23, 523.25, 880.0, 1046.50], 0.070, decay_exp=-3.8, detune_cents=6.0)
    riser *= (np.sin(np.linspace(0, np.pi / 2, riser_len)) ** 2)[:, None]

    # Sub-bass cinematic rumble (40-160 Hz)
    if launch is not None:
        sub = filt(launch[: int(1.4 * SR)], "bandpass", [38, 180])
        sub *= (np.cos(np.linspace(0, np.pi / 2, len(sub))) ** 2)[:, None]
    else:
        sub = np.zeros((int(0.8 * SR), 2))

    # Multi-voice celestial chord (F4 bass, F5, A5, C6, high E6 glint)
    c_f4 = synthesize_modal_chime(349.23, duration_s=1.60, decay_mult=0.75, warmth=0.9)
    c_f5 = synthesize_modal_chime(698.46, duration_s=1.50, decay_mult=0.75, warmth=0.8)
    c_a5 = synthesize_modal_chime(880.00, duration_s=1.40, decay_mult=0.75, warmth=0.75)
    c_c6 = synthesize_modal_chime(1046.50, duration_s=1.30, decay_mult=0.75, warmth=0.7)
    c_e6 = synthesize_modal_chime(1318.51, duration_s=1.00, decay_mult=0.70, warmth=0.6)  # Ethereal Major 7th
    glint = synthesize_modal_chime(1760.00, duration_s=0.80, decay_mult=0.55, warmth=0.4)  # High sparkle

    chord_mix = mix_layers(c_f4 * 0.70, c_f5 * 0.65, c_a5 * 0.55, c_c6 * 0.52, c_e6 * 0.40)
    chord_mix = stereo_widen(chord_mix, 1.60)

    # Grand convolution hall
    ir = generate_diffuse_reverb_ir(decay_s=1.8, tone_hz=7500, seed=77)
    hall = apply_convolution_hall(chord_mix, ir, mix_level=0.45, width=1.70)

    # Deep celestial space drone
    drone = synth_ambient_drone(
        [87.31, 174.61, 349.23, 523.25, 698.46], dur, decay_exp=2.0, detune_cents=6.5, lfo_rate=0.25
    )
    drone = stereo_widen(drone, 1.65)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)

    # Riser at the very start
    mix[:riser_len] += riser * 0.45
    hit_idx = riser_len

    mix[hit_idx : hit_idx + len(st_pop)] += st_pop * 3.10
    mix[hit_idx : min(mix_len, hit_idx + len(sub))] += sub[: max(0, mix_len - hit_idx)] * 0.90
    mix[hit_idx : min(mix_len, hit_idx + len(chord_mix))] += chord_mix[: max(0, mix_len - hit_idx)] * 0.85

    # Delayed sparkle glint
    i_g = hit_idx + int(0.480 * SR)
    if i_g < mix_len:
        mix[i_g : min(mix_len, i_g + len(glint))] += glint[: max(0, mix_len - i_g)] * 0.40

    mix[hit_idx : min(mix_len, hit_idx + len(hall))] += hall[: max(0, mix_len - hit_idx)] * 0.40
    mix[: len(drone)] += drone * 0.38

    return master_sound(mix, target_duration=dur, target_rms_db=-14.0, fade_out_s=0.35)


# ==============================================================================
# STYLE 2: VELVET (Warm Bell Tines & Deep Atmospheric Swells)
# Tonality: D Major / G Lydian (Warm, rich, comforting, orchestral)
# ==============================================================================


def build_velvet_bronze():
    """Velvet Bronze (~1.0s): Warm struck bell tine (D5 = 587.3 Hz) with rounded acoustic halo."""
    dur = 1.00
    chime = synthesize_modal_chime(587.33, duration_s=0.75, decay_mult=1.4, warmth=0.9)
    drone = synth_ambient_drone([293.66, 440.00], dur, decay_exp=4.2, detune_cents=4.0, lfo_rate=0.3)
    drone = filt(drone, "lowpass", 1100)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(chime)] += chime * 0.85
    mix[: len(drone)] += drone * 0.22
    return master_sound(mix, target_duration=dur, target_rms_db=-16.8, fade_out_s=0.18)


def build_velvet_silver():
    """Velvet Silver (~1.0s): Ascending warm bell interval (D5 ➔ A5) + gentle stereo air pad."""
    dur = 1.00
    b1 = synthesize_modal_chime(587.33, duration_s=0.70, decay_mult=1.2, warmth=0.85)
    b2 = synthesize_modal_chime(880.00, duration_s=0.65, decay_mult=1.1, warmth=0.80)
    drone = synth_ambient_drone([293.66, 440.00, 587.33], dur, decay_exp=3.6, detune_cents=4.5, lfo_rate=0.35)
    drone = stereo_widen(drone, 1.35)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(b1)] += b1 * 0.75
    i2 = int(0.120 * SR)
    mix[i2 : min(mix_len, i2 + len(b2))] += b2[: max(0, mix_len - i2)] * 0.65
    mix[: len(drone)] += drone * 0.28
    return master_sound(mix, target_duration=dur, target_rms_db=-15.5, fade_out_s=0.20)


def build_velvet_gold():
    """Velvet Gold (~1.5s): 3-tone harmonic chime (D5 ➔ F#5 ➔ A5) + warm low drone swell."""
    dur = 1.50
    b1 = synthesize_modal_chime(587.33, duration_s=1.10, decay_mult=0.9, warmth=0.88)
    b2 = synthesize_modal_chime(739.99, duration_s=1.00, decay_mult=0.85, warmth=0.82)
    b3 = synthesize_modal_chime(880.00, duration_s=0.95, decay_mult=0.8, warmth=0.78)

    ir = generate_diffuse_reverb_ir(decay_s=1.2, tone_hz=5500, seed=55)
    hall = apply_convolution_hall(b3, ir, mix_level=0.35, width=1.50)

    drone = synth_ambient_drone([146.83, 293.66, 440.00, 587.33], dur, decay_exp=2.6, detune_cents=5.0)
    drone = stereo_widen(drone, 1.45)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(b1)] += b1 * 0.70
    i2 = int(0.130 * SR)
    mix[i2 : min(mix_len, i2 + len(b2))] += b2[: max(0, mix_len - i2)] * 0.60
    i3 = int(0.260 * SR)
    mix[i3 : min(mix_len, i3 + len(b3))] += b3[: max(0, mix_len - i3)] * 0.55
    mix[i3 : min(mix_len, i3 + len(hall))] += hall[: max(0, mix_len - i3)] * 0.32
    mix[: len(drone)] += drone * 0.32
    return master_sound(mix, target_duration=dur, target_rms_db=-14.8, fade_out_s=0.28)


def build_velvet_platinum():
    """Velvet Platinum (~2.0s): Grand warm bell symphony + sub-resonance + 2-second acoustic hall."""
    dur = 2.00
    riser_len = int(0.065 * SR)
    riser = synth_ambient_drone([293.66, 440.00, 587.33], 0.065, decay_exp=-3.5)
    riser *= (np.sin(np.linspace(0, np.pi / 2, riser_len)) ** 2)[:, None]

    b_low = synthesize_modal_chime(293.66, duration_s=1.60, decay_mult=0.75, warmth=0.95)
    b1 = synthesize_modal_chime(587.33, duration_s=1.50, decay_mult=0.75, warmth=0.88)
    b2 = synthesize_modal_chime(739.99, duration_s=1.40, decay_mult=0.75, warmth=0.82)
    b3 = synthesize_modal_chime(880.00, duration_s=1.30, decay_mult=0.75, warmth=0.78)
    b_oct = synthesize_modal_chime(1174.66, duration_s=1.10, decay_mult=0.70, warmth=0.65)

    chord = mix_layers(b_low * 0.75, b1 * 0.70, b2 * 0.60, b3 * 0.55, b_oct * 0.45)
    chord = stereo_widen(chord, 1.65)

    ir = generate_diffuse_reverb_ir(decay_s=1.7, tone_hz=6500, seed=88)
    hall = apply_convolution_hall(chord, ir, mix_level=0.45, width=1.70)

    drone = synth_ambient_drone(
        [73.42, 146.83, 293.66, 440.00, 587.33], dur, decay_exp=2.0, detune_cents=6.5, lfo_rate=0.22
    )
    drone = stereo_widen(drone, 1.65)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[:riser_len] += riser * 0.40
    hit_idx = riser_len
    mix[hit_idx : min(mix_len, hit_idx + len(chord))] += chord[: max(0, mix_len - hit_idx)] * 0.85
    mix[hit_idx : min(mix_len, hit_idx + len(hall))] += hall[: max(0, mix_len - hit_idx)] * 0.40
    mix[: len(drone)] += drone * 0.38
    return master_sound(mix, target_duration=dur, target_rms_db=-14.0, fade_out_s=0.35)


# ==============================================================================
# STYLE 3: ELECTRO (Modern Steam Deck & Sleek Cyber Chimes)
# Tonality: Eb Major / Bb (Crisp, high-tech, futuristic UI)
# ==============================================================================


def build_electro_bronze(toast):
    """Electro Bronze (~1.0s): Crisp digital click + minimalist glass ping (Eb6 = 1244.5 Hz)."""
    dur = 1.00
    st_pop = extract_steam_transient(toast, duration_ms=25, hp_freq=950)
    chime = synthesize_modal_chime(1244.51, duration_s=0.55, decay_mult=1.6, warmth=0.5)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.10
    mix[: len(chime)] += chime * 0.70
    return master_sound(mix, target_duration=dur, target_rms_db=-16.8, fade_out_s=0.15)


def build_electro_silver(toast):
    """Electro Silver (~1.0s): Snappy click + dual ping interval (Eb6 ➔ Bb6)."""
    dur = 1.00
    st_pop = extract_steam_transient(toast, duration_ms=25, hp_freq=950)
    c1 = synthesize_modal_chime(1244.51, duration_s=0.55, decay_mult=1.4, warmth=0.5)
    c2 = synthesize_modal_chime(1864.66, duration_s=0.50, decay_mult=1.3, warmth=0.45)
    ambient = synth_ambient_drone([622.25, 932.33], dur, decay_exp=4.0, detune_cents=4.0)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.10
    mix[: len(c1)] += c1 * 0.65
    i2 = int(0.090 * SR)
    mix[i2 : min(mix_len, i2 + len(c2))] += c2[: max(0, mix_len - i2)] * 0.55
    mix[: len(ambient)] += ambient * 0.20
    return master_sound(mix, target_duration=dur, target_rms_db=-15.5, fade_out_s=0.18)


def build_electro_gold(toast, launch):
    """Electro Gold (~1.5s): Sub thump + 3-step ascending digital arpeggio."""
    dur = 1.50
    st_pop = extract_steam_transient(toast, duration_ms=30, hp_freq=850)
    if launch is not None:
        thump = filt(launch[: int(0.7 * SR)], "bandpass", [60, 250])
    else:
        thump = np.zeros((int(0.5 * SR), 2))

    c1 = synthesize_modal_chime(622.25, duration_s=0.90, decay_mult=1.0, warmth=0.7)
    c2 = synthesize_modal_chime(932.33, duration_s=0.85, decay_mult=0.95, warmth=0.6)
    c3 = synthesize_modal_chime(1244.51, duration_s=0.80, decay_mult=0.9, warmth=0.55)

    ir = generate_diffuse_reverb_ir(decay_s=1.0, tone_hz=8000, seed=44)
    hall = apply_convolution_hall(c3, ir, mix_level=0.32, width=1.45)

    ambient = synth_ambient_drone([311.13, 622.25, 932.33], dur, decay_exp=2.8, detune_cents=5.0)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.20
    mix[: len(thump)] += thump * 0.70
    mix[: len(c1)] += c1 * 0.65
    i2 = int(0.100 * SR)
    mix[i2 : min(mix_len, i2 + len(c2))] += c2[: max(0, mix_len - i2)] * 0.55
    i3 = int(0.200 * SR)
    mix[i3 : min(mix_len, i3 + len(c3))] += c3[: max(0, mix_len - i3)] * 0.50
    mix[i3 : min(mix_len, i3 + len(hall))] += hall[: max(0, mix_len - i3)] * 0.30
    mix[: len(ambient)] += ambient * 0.28
    return master_sound(mix, target_duration=dur, target_rms_db=-14.8, fade_out_s=0.22)


def build_electro_platinum(toast, launch):
    """Electro Platinum (~2.0s): Cyber riser + sub impact + sparkling glass cluster."""
    dur = 2.00
    st_pop = extract_steam_transient(toast, duration_ms=35, hp_freq=850)
    riser_len = int(0.060 * SR)
    riser = synth_ambient_drone([622.25, 1244.51], 0.060, decay_exp=-4.0)
    riser *= (np.sin(np.linspace(0, np.pi / 2, riser_len)) ** 2)[:, None]

    if launch is not None:
        sub = filt(launch[: int(1.2 * SR)], "bandpass", [40, 180])
    else:
        sub = np.zeros((int(0.8 * SR), 2))

    c1 = synthesize_modal_chime(311.13, duration_s=1.50, decay_mult=0.8, warmth=0.85)
    c2 = synthesize_modal_chime(622.25, duration_s=1.40, decay_mult=0.8, warmth=0.75)
    c3 = synthesize_modal_chime(932.33, duration_s=1.30, decay_mult=0.75, warmth=0.65)
    c4 = synthesize_modal_chime(1244.51, duration_s=1.20, decay_mult=0.7, warmth=0.55)
    c5 = synthesize_modal_chime(1864.66, duration_s=0.90, decay_mult=0.6, warmth=0.45)

    cluster = mix_layers(c1 * 0.70, c2 * 0.65, c3 * 0.55, c4 * 0.50, c5 * 0.40)
    cluster = stereo_widen(cluster, 1.65)

    ir = generate_diffuse_reverb_ir(decay_s=1.6, tone_hz=8500, seed=99)
    hall = apply_convolution_hall(cluster, ir, mix_level=0.42, width=1.70)

    drone = synth_ambient_drone([155.56, 311.13, 622.25, 932.33], dur, decay_exp=2.1, detune_cents=6.0)
    drone = stereo_widen(drone, 1.65)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[:riser_len] += riser * 0.45
    hit_idx = riser_len
    mix[hit_idx : hit_idx + len(st_pop)] += st_pop * 3.30
    mix[hit_idx : min(mix_len, hit_idx + len(sub))] += sub[: max(0, mix_len - hit_idx)] * 0.90
    mix[hit_idx : min(mix_len, hit_idx + len(cluster))] += cluster[: max(0, mix_len - hit_idx)] * 0.85
    mix[hit_idx : min(mix_len, hit_idx + len(hall))] += hall[: max(0, mix_len - hit_idx)] * 0.40
    mix[: len(drone)] += drone * 0.35
    return master_sound(mix, target_duration=dur, target_rms_db=-14.0, fade_out_s=0.30)


# ==============================================================================
# HTML Preview Generator & Packager
# ==============================================================================


def generate_preview_html(sets_data, html_path):
    """Builds interactive HTML player for auditioning bespoke trophy tiers."""
    json_data = json.dumps(sets_data, indent=2)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation Custom Trophy Sound Suite (100% Bespoke)</title>
<style>
  :root {{
    --bg: #090c12;
    --card: #121622;
    --card-hover: #192032;
    --border: #21293c;
    --accent: #0070d1;
    --accent-steam: #66c0f4;
    --bronze: #d98845;
    --silver: #e2e8f0;
    --gold: #f5b041;
    --platinum: #38bdf8;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --active: #00ffaa;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    padding: 24px;
    max-width: 1120px;
    margin: 0 auto;
  }}
  header {{
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
  }}
  .top-row {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }}
  h1 {{ font-size: 26px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 12px; }}
  h1 span {{ font-size: 13px; font-weight: 600; background: rgba(56, 189, 248, 0.15); color: var(--platinum); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.35); }}
  p.subtitle {{ color: var(--text-dim); margin-top: 6px; font-size: 14px; max-width: 900px; }}

  /* Toolbar */
  .toolbar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #0f131d;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 14px;
  }}
  .toolbar-left, .toolbar-right {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }}
  .btn-tool {{
    background: #181f2f;
    border: 1px solid #2d3852;
    color: #fff;
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    transition: all 0.15s ease;
  }}
  .btn-tool:hover {{ background: #26324d; border-color: var(--accent-steam); }}
  .btn-primary {{ background: #0070d1; border-color: #0070d1; }}
  .btn-primary:hover {{ background: #0084f7; border-color: #0084f7; }}
  .btn-progression {{
    background: linear-gradient(135deg, rgba(217, 136, 69, 0.25), rgba(56, 189, 248, 0.25));
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #fff;
    font-weight: 600;
  }}
  .btn-progression:hover {{
    background: linear-gradient(135deg, rgba(217, 136, 69, 0.4), rgba(56, 189, 248, 0.4));
    border-color: var(--platinum);
    box-shadow: 0 0 16px rgba(56, 189, 248, 0.3);
  }}
  .btn-zip {{
    background: rgba(245, 176, 65, 0.12);
    border-color: rgba(245, 176, 65, 0.35);
    color: var(--gold);
    font-weight: 600;
  }}
  .btn-zip:hover {{ background: var(--gold); color: #090c12; }}

  /* Set Selector Tabs */
  .set-tabs {{
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
  }}
  .tab-btn {{
    background: #121624;
    border: 1px solid #242c40;
    color: #8c97ad;
    padding: 9px 18px;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }}
  .tab-btn:hover {{ color: #fff; border-color: #3b4764; }}
  .tab-btn.active {{
    background: #0070d1;
    color: #fff;
    border-color: #0070d1;
    box-shadow: 0 2px 12px rgba(0, 112, 209, 0.4);
  }}

  /* Tiers Grid */
  .tiers-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(245px, 1fr));
    gap: 16px;
    margin-bottom: 28px;
  }}
  .tier-card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: all 0.2s ease;
    position: relative;
  }}
  .tier-card:hover {{
    background: var(--card-hover);
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  }}
  .tier-card.is-playing {{
    border-color: var(--active);
    box-shadow: 0 0 22px rgba(0, 255, 170, 0.25);
  }}

  .tier-card.bronze {{ border-top: 4px solid var(--bronze); }}
  .tier-card.silver {{ border-top: 4px solid var(--silver); }}
  .tier-card.gold {{ border-top: 4px solid var(--gold); }}
  .tier-card.platinum {{ border-top: 4px solid var(--platinum); }}

  .tier-top {{ display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }}
  .tier-badge {{
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  .badge-bronze {{ background: rgba(217, 136, 69, 0.15); color: var(--bronze); border: 1px solid rgba(217, 136, 69, 0.35); }}
  .badge-silver {{ background: rgba(226, 232, 240, 0.15); color: var(--silver); border: 1px solid rgba(226, 232, 240, 0.35); }}
  .badge-gold {{ background: rgba(245, 176, 65, 0.15); color: var(--gold); border: 1px solid rgba(245, 176, 65, 0.35); }}
  .badge-platinum {{ background: rgba(56, 189, 248, 0.15); color: var(--platinum); border: 1px solid rgba(56, 189, 248, 0.35); }}

  .tier-dur {{ font-size: 13px; font-weight: 600; color: #8c97ad; background: #090c12; padding: 3px 8px; border-radius: 4px; }}

  .tier-center {{ margin-bottom: 18px; }}
  .tier-name {{ font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 4px; }}
  .tier-desc {{ font-size: 12.5px; color: var(--text-dim); line-height: 1.4; }}

  .chime-spec {{
    background: #0b0e16;
    border: 1px solid #1a2130;
    border-radius: 6px;
    padding: 8px 10px;
    margin-top: 10px;
    font-size: 11.5px;
    color: #9ab;
  }}
  .chime-spec strong {{ color: #e6edf3; }}

  .tier-bottom {{ display: flex; flex-direction: column; gap: 10px; }}
  .play-bar {{ display: flex; align-items: center; gap: 10px; }}
  .big-play-btn {{
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #181f30;
    border: 1px solid #2e3b55;
    color: #fff;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }}
  .big-play-btn:hover {{ background: #0070d1; border-color: #0070d1; transform: scale(1.05); }}
  .tier-card.is-playing .big-play-btn {{ background: var(--active); color: #090c12; border-color: var(--active); }}

  .dl-row {{ display: flex; gap: 6px; }}
  .btn-dl {{
    flex: 1;
    background: #141a27;
    border: 1px solid #253147;
    color: var(--accent-steam);
    padding: 6px 10px;
    border-radius: 5px;
    font-size: 11.5px;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    transition: all 0.15s ease;
  }}
  .btn-dl:hover {{ background: #0070d1; color: #fff; border-color: #0070d1; }}
  .btn-dl.wav {{ color: #b5c7e8; }}
  .btn-dl.wav:hover {{ background: #1e3f6b; color: #fff; }}

  /* Hierarchy Banner */
  .hierarchy-banner {{
    background: #0f131d;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }}
  .hierarchy-steps {{
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }}
  .h-step {{
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    background: #141824;
    border: 1px solid #232c40;
    padding: 5px 12px;
    border-radius: 20px;
  }}

  /* Code snippet block */
  .code-section {{
    background: #0e121a;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-top: 24px;
  }}
  .code-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
  .code-header h4 {{ font-size: 13.5px; font-weight: 600; color: #fff; }}
  pre {{
    background: #06080d;
    border: 1px solid #182030;
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
    font-size: 12px;
    color: #66c0f4;
    font-family: Consolas, Monaco, monospace;
  }}
</style>
</head>
<body>

<header>
  <div class="top-row">
    <h1>
      ✨ SteamStation Bespoke Trophy Sound Suite
      <span>100% Original Synthesis</span>
    </h1>
    <div style="display:flex; gap:10px;">
      <a href="preview_hybrids.html" class="btn-tool" style="text-decoration:none;">&larr; Hybrid A/B Sounds</a>
    </div>
  </div>
  <p class="subtitle">
    Pure bespoke sound design featuring a subtle modal chime and an ambient sound bed that grows in harmonic depth, spatial width, and duration as the achievement is rarer:
    <b>Bronze (1.0s)</b> &rarr; <b>Silver (1.0s)</b> &rarr; <b>Gold (1.5s)</b> &rarr; <b>Platinum (2.0s)</b>. Built without any PlayStation sound files.
  </p>
</header>

<div class="toolbar">
  <div class="toolbar-left">
    <button class="btn-tool btn-progression" id="btn-progression">▶ Play Hierarchy Progression (Bronze ➔ Platinum)</button>
    <button class="btn-tool" id="btn-stop">■ Stop All</button>
  </div>
  <div class="toolbar-right">
    <a href="SteamStation_Custom_Trophies_MP3.zip" download class="btn-tool btn-zip">📦 Download All MP3s (.ZIP)</a>
    <a href="SteamStation_Custom_Trophies_WAV.zip" download class="btn-tool btn-zip">📦 Download All WAVs (.ZIP)</a>
  </div>
</div>

<div class="hierarchy-banner">
  <div class="hierarchy-steps">
    <div class="h-step"><span style="color:var(--bronze)">🥉 Bronze: 1.0s</span> (Subtle chime + clean decay)</div>
    <span>&rarr;</span>
    <div class="h-step"><span style="color:var(--silver)">🥈 Silver: 1.0s</span> (2-Tone interval + airy shimmer)</div>
    <span>&rarr;</span>
    <div class="h-step"><span style="color:var(--gold)">🥇 Gold: 1.5s</span> (3-Note bloom + warm low swell)</div>
    <span>&rarr;</span>
    <div class="h-step"><span style="color:var(--platinum)">🏆 Platinum: 2.0s</span> (Celestial chord + 2s spatial pad)</div>
  </div>
  <div style="font-size:12px; color:var(--text-dim)">Zero Bootleg Audio • Bespoke Synthesis</div>
</div>

<div class="set-tabs" id="tabs-container"></div>

<main id="tiers-container" class="tiers-grid"></main>

<div class="code-section">
  <div class="code-header">
    <h4>⚙️ SteamStation.json Theme Integration</h4>
    <button class="btn-tool" id="btn-copy-config">📋 Copy JSON Config</button>
  </div>
  <pre id="code-snippet"></pre>
</div>

<script>
const DATA = {json_data};
let activeAudio = null;
let currentBtn = null;
let currentCard = null;
let activeSetIdx = 0;
let progressionTimer = null;

function stopCurrent() {{
  if (progressionTimer) {{
    clearTimeout(progressionTimer);
    progressionTimer = null;
  }}
  if (activeAudio) {{
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }}
  if (currentBtn) {{
    currentBtn.textContent = "▶";
    currentBtn = null;
  }}
  if (currentCard) {{
    currentCard.classList.remove("is-playing");
    currentCard = null;
  }}
}}

function playAudio(url, btn, cardEl) {{
  if (activeAudio && currentBtn === btn) {{
    stopCurrent();
    return;
  }}
  stopCurrent();

  activeAudio = new Audio(url);
  currentBtn = btn;
  currentCard = cardEl;
  btn.textContent = "■";
  if (cardEl) cardEl.classList.add("is-playing");

  activeAudio.onended = () => stopCurrent();
  activeAudio.onerror = () => stopCurrent();
  activeAudio.play().catch(e => console.warn(e));
}}

document.getElementById("btn-stop").onclick = stopCurrent;

// Setup Style Selector Tabs
const tabsContainer = document.getElementById("tabs-container");
DATA.forEach((s, idx) => {{
  const b = document.createElement("button");
  b.className = "tab-btn" + (idx === 0 ? " active" : "");
  b.innerHTML = `${{s.name}} <span style="font-size:11px; opacity:0.7">(${{s.character}})</span>`;
  b.onclick = () => {{
    activeSetIdx = idx;
    document.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("active"));
    b.classList.add("active");
    renderTiers();
  }};
  tabsContainer.appendChild(b);
}});

function renderTiers() {{
  stopCurrent();
  const set = DATA[activeSetIdx];
  const container = document.getElementById("tiers-container");
  container.innerHTML = "";

  set.tiers.forEach(t => {{
    const card = document.createElement("div");
    card.className = `tier-card ${{t.id}}`;

    card.innerHTML = `
      <div class="tier-top">
        <span class="tier-badge badge-${{t.id}}">${{t.icon}} ${{t.title}}</span>
        <span class="tier-dur">${{t.duration}}s</span>
      </div>
      <div class="tier-center">
        <h3 class="tier-name">${{t.name}}</h3>
        <p class="tier-desc">${{t.description}}</p>
        <div class="chime-spec">
          <div><strong>Chime:</strong> ${{t.chime_details}}</div>
          <div style="margin-top:4px"><strong>Ambient:</strong> ${{t.ambient_details}}</div>
        </div>
      </div>
      <div class="tier-bottom">
        <div class="play-bar">
          <button class="big-play-btn" title="Play ${{t.title}}">▶</button>
          <div style="font-size:11.5px; color:#8c97ad">
            <div>RMS: <strong>${{t.rms_db}} dB</strong></div>
            <div>Peak: <strong>${{t.peak_db}} dB</strong></div>
          </div>
        </div>
        <div class="dl-row">
          <a href="${{t.mp3_path}}" download="${{t.mp3_filename}}" class="btn-dl">⬇ MP3</a>
          <a href="${{t.wav_path}}" download="${{t.wav_filename}}" class="btn-dl wav">⬇ WAV</a>
        </div>
      </div>
    `;

    const pBtn = card.querySelector(".big-play-btn");
    pBtn.onclick = () => playAudio(t.mp3_path, pBtn, card);

    container.appendChild(card);
  }});

  updateConfigSnippet(set);
}}

function updateConfigSnippet(set) {{
  const pre = document.getElementById("code-snippet");
  const b = set.tiers.find(t => t.id === "bronze");
  const s = set.tiers.find(t => t.id === "silver");
  const g = set.tiers.find(t => t.id === "gold");
  const p = set.tiers.find(t => t.id === "platinum");

  const snippet = `"achievements": {{
  "normal": {{
    "sound": ["SteamStation/sfx/${{b.mp3_filename}}", 80]
  }},
  "magic": {{
    "threshold": 25,
    "sound": ["SteamStation/sfx/${{s.mp3_filename}}", 85]
  }},
  "rare": {{
    "threshold": 10,
    "sound": ["SteamStation/sfx/${{g.mp3_filename}}", 90]
  }},
  "exceptional": {{
    "sound": ["SteamStation/sfx/${{p.mp3_filename}}", 100]
  }}
}}`;
  pre.textContent = snippet;
}}

document.getElementById("btn-copy-config").onclick = () => {{
  const pre = document.getElementById("code-snippet");
  navigator.clipboard.writeText(pre.textContent).then(() => {{
    const b = document.getElementById("btn-copy-config");
    b.textContent = "✅ Copied!";
    setTimeout(() => b.textContent = "📋 Copy JSON Config", 1800);
  }});
}};

// Progression Player: Plays Bronze -> Silver -> Gold -> Platinum in sequence
document.getElementById("btn-progression").onclick = () => {{
  stopCurrent();
  const set = DATA[activeSetIdx];
  let curr = 0;

  function playNext() {{
    if (curr >= set.tiers.length) return;
    const tier = set.tiers[curr];
    const cards = document.querySelectorAll(".tier-card");
    const targetCard = cards[curr];
    const targetBtn = targetCard ? targetCard.querySelector(".big-play-btn") : null;

    playAudio(tier.mp3_path, targetBtn, targetCard);

    progressionTimer = setTimeout(() => {{
      curr++;
      playNext();
    }}, (tier.duration * 1000) + 380);
  }}

  playNext();
}};

renderTiers();
</script>

</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"[UI] Generated Custom Trophy Preview Player: {html_path}")


def main():
    parser = argparse.ArgumentParser(description="SteamStation Bespoke Tiered Trophy Sound Designer")
    parser.add_argument("--open", action="store_true", help="Open evaluation player in browser")
    args = parser.parse_args()

    os.makedirs(CUSTOM_TIERS_DIR, exist_ok=True)

    print("=======================================================")
    print("Designing Bespoke SteamStation Trophy Sounds (Zero PS Audio)")
    print("Duration Targets: Bronze: 1.0s, Silver: 1.0s, Gold: 1.5s, Platinum: 2.0s")
    print("=======================================================\n")

    toast = load_steam_audio("deck_ui_achievement_toast.wav")
    launch = load_steam_audio("deck_ui_launch_game.wav")

    styles = [
        {
            "id": "prism",
            "name": "Prism Suite",
            "character": "Original Flagship",
            "description": "Pure crystalline glass chimes + airy ambient shimmer with PC tactile attacks.",
            "generators": {
                "bronze": lambda: (
                    build_prism_bronze(toast),
                    1.00,
                    "Singular pure F5 crystalline chime strike (698 Hz)",
                    "Subtle warm F4/C5 ambient drone decaying cleanly in 0.8s",
                ),
                "silver": lambda: (
                    build_prism_silver(toast),
                    1.00,
                    "Ascending 2-tone chime interval (F5 ➔ C6, +7 semitones)",
                    "Airy bandpassed stereo shimmer pad (width 1.35x)",
                ),
                "gold": lambda: (
                    build_prism_gold(toast, launch),
                    1.50,
                    "3-Note ascending chime arpeggio (F5 ➔ A5 ➔ C6)",
                    "Warm low bloom swell + stereo convolution hall (width 1.50x)",
                ),
                "platinum": lambda: (
                    build_prism_platinum(toast, launch),
                    2.00,
                    "Celestial 4-note constellation chord + high E6/G6 glint",
                    "Reverse breath riser + deep sub-bass + expansive 2s ambient tail",
                ),
            },
        },
        {
            "id": "velvet",
            "name": "Velvet Suite",
            "character": "Warm Orchestral Bells",
            "description": "Rich modal bell tines, warm atmospheric swells, and deep acoustic depth.",
            "generators": {
                "bronze": lambda: (
                    build_velvet_bronze(),
                    1.00,
                    "Warm struck bell tine (D5 = 587 Hz)",
                    "Soft acoustic halo with smooth 0.8s decay",
                ),
                "silver": lambda: (
                    build_velvet_silver(),
                    1.00,
                    "Ascending warm bell interval (D5 ➔ A5, +7 semitones)",
                    "Smooth stereo air pad with gentle chorus motion",
                ),
                "gold": lambda: (
                    build_velvet_gold(),
                    1.50,
                    "3-Tone harmonic chime (D5 ➔ F#5 ➔ A5)",
                    "Warm low drone swell (D3/A3) + expansive acoustic hall",
                ),
                "platinum": lambda: (
                    build_velvet_platinum(),
                    2.00,
                    "Grand warm bell symphony + high A6 glint",
                    "Deep sub-resonance + 2-second expansive orchestral pad",
                ),
            },
        },
        {
            "id": "electro",
            "name": "Electro Suite",
            "character": "Modern Deck UI",
            "description": "Snappy high-tech PC transients, sleek micro-chimes, and cyber-spatial tails.",
            "generators": {
                "bronze": lambda: (
                    build_electro_bronze(toast),
                    1.00,
                    "Minimalist glass ping (Eb6 = 1244 Hz) + snappy click",
                    "Clean instant release, zero reverb clutter",
                ),
                "silver": lambda: (
                    build_electro_silver(toast),
                    1.00,
                    "Dual ping interval (Eb6 ➔ Bb6, +7 semitones)",
                    "Shimmering cyber-air tail resolving at 1.0s",
                ),
                "gold": lambda: (
                    build_electro_gold(toast, launch),
                    1.50,
                    "3-Step ascending digital arpeggio (Eb5 ➔ G5 ➔ Bb5)",
                    "Low digital sub-thump + controlled diffusion space",
                ),
                "platinum": lambda: (
                    build_electro_platinum(toast, launch),
                    2.00,
                    "Cascading multi-frequency glass cluster",
                    "Cyber riser swell + sub-drop punch + 2s spatial pad",
                ),
            },
        },
    ]

    tier_meta = {
        "bronze": {
            "title": "Bronze Trophy",
            "icon": "🥉",
            "name": "Subtle Chime",
            "desc": "Clean, focused, minimal notification designed to inform without interrupting intense gameplay.",
        },
        "silver": {
            "title": "Silver Trophy",
            "icon": "🥈",
            "name": "Crystalline Chime",
            "desc": "Brighter 2-tone chime interval with airy stereo shimmer space.",
        },
        "gold": {
            "title": "Gold Trophy",
            "icon": "🥇",
            "name": "Harmonic Chime",
            "desc": "Rich 3-note harmonic bloom with warm low-mid foundation and expanded stereo swell.",
        },
        "platinum": {
            "title": "Platinum Trophy",
            "icon": "🏆",
            "name": "Celestial Chime",
            "desc": "Grand triumphant signature with sub-bass depth, reverse breath riser, and 2-second celestial space.",
        },
    }

    manifest_sets = []

    for s_info in styles:
        print(f"--- Rendering Style: {s_info['name']} ({s_info['character']}) ---")
        rendered_tiers = []
        for t_id in ["bronze", "silver", "gold", "platinum"]:
            fn_prefix = f"trophy_{s_info['id']}_{t_id}"
            gen_fn = s_info["generators"][t_id]
            audio, target_dur, chime_info, ambient_info = gen_fn()

            base_out = os.path.join(CUSTOM_TIERS_DIR, fn_prefix)
            mp3_p, wav_p = write_audio_pair(base_out, audio)

            # If this is the flagship Prism set, also overwrite directly as the default sfx files
            if s_info["id"] == "prism":
                flagship_base = os.path.join(HERE, f"steamstation_{t_id}")
                write_audio_pair(flagship_base, audio)

            dur = len(audio) / SR
            pk = np.abs(audio).max()
            act = audio[np.abs(audio).max(1) > pk * 0.05]
            rms = np.sqrt((act**2).mean()) if len(act) else 1e-4
            pk_db = round(float(20 * np.log10(max(1e-5, pk))), 1)
            rms_db = round(float(20 * np.log10(max(1e-5, rms))), 1)

            print(f"  * {t_id.capitalize():8s}: {dur:.2f}s | Peak: {pk_db:+.1f} dBFS | RMS: {rms_db:+.1f} dBFS")

            meta = tier_meta[t_id]
            rendered_tiers.append(
                {
                    "id": t_id,
                    "title": meta["title"],
                    "icon": meta["icon"],
                    "name": meta["name"],
                    "description": meta["desc"],
                    "duration": round(dur, 2),
                    "chime_details": chime_info,
                    "ambient_details": ambient_info,
                    "mp3_filename": f"{fn_prefix}.mp3",
                    "wav_filename": f"{fn_prefix}.wav",
                    "mp3_path": f"custom_tiers/{fn_prefix}.mp3",
                    "wav_path": f"custom_tiers/{fn_prefix}.wav",
                    "peak_db": pk_db,
                    "rms_db": rms_db,
                }
            )

        manifest_sets.append(
            {
                "id": s_info["id"],
                "name": s_info["name"],
                "character": s_info["character"],
                "description": s_info["description"],
                "tiers": rendered_tiers,
            }
        )

    # Build ZIP packages
    mp3_zip = os.path.join(HERE, "SteamStation_Custom_Trophies_MP3.zip")
    wav_zip = os.path.join(HERE, "SteamStation_Custom_Trophies_WAV.zip")

    with zipfile.ZipFile(mp3_zip, "w", zipfile.ZIP_DEFLATED) as zm:
        for f in sorted(os.listdir(CUSTOM_TIERS_DIR)):
            if f.endswith(".mp3"):
                zm.write(os.path.join(CUSTOM_TIERS_DIR, f), arcname=f)
        for t_id in ["bronze", "silver", "gold", "platinum"]:
            fn = f"steamstation_{t_id}.mp3"
            p = os.path.join(HERE, fn)
            if os.path.isfile(p):
                zm.write(p, arcname=fn)

    with zipfile.ZipFile(wav_zip, "w", zipfile.ZIP_DEFLATED) as zw:
        for f in sorted(os.listdir(CUSTOM_TIERS_DIR)):
            if f.endswith(".wav"):
                zw.write(os.path.join(CUSTOM_TIERS_DIR, f), arcname=f)
        for t_id in ["bronze", "silver", "gold", "platinum"]:
            fn = f"steamstation_{t_id}.wav"
            p = os.path.join(HERE, fn)
            if os.path.isfile(p):
                zw.write(p, arcname=fn)

    print(f"\n[ZIP] Created Custom Trophy Packages:")
    print(f"  * MP3: SteamStation_Custom_Trophies_MP3.zip ({os.path.getsize(mp3_zip)/1024:.1f} KB)")
    print(f"  * WAV: SteamStation_Custom_Trophies_WAV.zip ({os.path.getsize(wav_zip)/1024/1024:.1f} MB)")

    preview_html_path = os.path.join(HERE, "preview_custom_trophies.html")
    generate_preview_html(manifest_sets, preview_html_path)

    if args.open:
        webbrowser.open("file://" + os.path.abspath(preview_html_path))

    print("\n[Done] All bespoke trophy sounds generated successfully.")
    print(f"Audition in browser: file:///{preview_html_path.replace(os.sep, '/')}")


if __name__ == "__main__":
    main()
