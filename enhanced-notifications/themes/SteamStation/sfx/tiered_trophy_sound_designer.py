#!/usr/bin/env python3
"""SteamStation Tiered Trophy Sound Designer.

Creates custom, progressive trophy achievement sound effects inspired by both
Steam's tactile PC UI audio and PlayStation's crystalline trophy chimes:
  - Subtle chime + ambient sound that increases in depth, space, and complexity as rarity rises
  - Bronze & Silver: ~1.0 second
  - Gold: ~1.5 seconds
  - Platinum: ~2.0 seconds

Usage:
  python tiered_trophy_sound_designer.py             # Generates all sets and updates preview
  python tiered_trophy_sound_designer.py --open      # Generates and opens preview player
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
from scipy.ndimage import gaussian_filter1d

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
THEME_DIR = os.path.dirname(HERE)
TIERS_DIR = os.path.join(HERE, "tiers")
FF = imageio_ffmpeg.get_ffmpeg_exe()


def load_audio(path):
    """Loads an audio file as float64 stereo at 48 kHz, trimming leading silence."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Audio file not found: {path}")
    raw = subprocess.run(
        [FF, "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    # Trim leading silence (< -50 dB of peak)
    m = np.abs(x).max(1)
    peak = m.max()
    if peak > 1e-5:
        on = np.argmax(m > peak * 0.003)
        x = x[max(0, on - int(0.003 * SR)) :]
    return x


def filt(x, kind, hz, order=2):
    """Butterworth filter helper."""
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def pitch_shift(x, semitones):
    """Band-limited interpolation pitch shifter."""
    if abs(semitones) < 0.02:
        return x.copy()
    ratio = 2.0 ** (semitones / 12.0)
    old_len = len(x)
    new_len = max(1, int(old_len / ratio))
    t_old = np.linspace(0, old_len - 1, old_len)
    t_new = np.linspace(0, old_len - 1, new_len)
    out = np.zeros((new_len, 2), dtype=np.float64)
    for c in range(2):
        out[:, c] = np.interp(t_new, t_old, x[:, c])
    return out


def isolate_steam_transient(steam_audio, duration_ms=35, hp_freq=750):
    """Extracts the snappy tactile PC pop from Steam in mono."""
    t_len = int(duration_ms * 0.001 * SR)
    t_chunk = steam_audio[:t_len].copy()
    flat_len = int(0.010 * SR)
    env = np.ones(len(t_chunk))
    if len(t_chunk) > flat_len:
        env[flat_len:] = np.cos(np.linspace(0, np.pi / 2, len(t_chunk) - flat_len)) ** 2
    t_chunk *= env[:, None]
    t_chunk = filt(t_chunk, "highpass", hp_freq, order=3)
    mono = 0.5 * (t_chunk[:, 0] + t_chunk[:, 1])
    return np.stack([mono, mono], axis=1)


def stereo_widen(x, factor=1.35):
    """Mid/Side stereo widen (>1) or narrow (<1)."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def synth_ambient_drone(freqs, duration_s, decay_exp=3.0, detune_cents=4, lfo_rate=0.35):
    """Synthesizes a lush, organic stereo ambient drone pad with gentle chorus motion."""
    n_samples = int(duration_s * SR)
    t = np.linspace(0, duration_s, n_samples)
    left = np.zeros(n_samples)
    right = np.zeros(n_samples)
    for i, f in enumerate(freqs):
        f_l = f * (2.0 ** (-detune_cents / 1200.0))
        f_r = f * (2.0 ** (detune_cents / 1200.0))
        lfo = 1.0 + 0.18 * np.sin(2 * np.pi * (lfo_rate + 0.05 * i) * t)
        env = np.exp(-decay_exp * (t / duration_s))
        left += np.sin(2 * np.pi * f_l * t) * env * lfo
        right += np.sin(2 * np.pi * f_r * t + (np.pi / 4.0) * (i + 1)) * env * (2.0 - lfo)
    stereo = np.stack([left, right], axis=1)
    pk = np.max(np.abs(stereo))
    if pk > 1e-6:
        stereo /= pk
    return stereo


def generate_diffuse_reverb_ir(decay_s, tone_hz=6000, seed=42):
    """Generates a smooth stereo diffuse reverb impulse response."""
    rng = np.random.default_rng(seed)
    n = int(decay_s * SR)
    env = np.exp(-6.5 * np.linspace(0, 1, n))[:, None]
    ir = rng.standard_normal((n, 2)) * env
    ir = filt(ir, "lowpass", tone_hz, order=2)
    ir[: int(0.008 * SR)] = 0  # 8ms pre-delay
    norm = np.sqrt((ir**2).sum(axis=0, keepdims=True)) + 1e-8
    return ir / norm


def master_sound(x, target_duration, target_rms_db=-15.5, fade_out_s=0.25, peak_ceiling_db=-0.3):
    """Trims to target duration, shapes final envelope, normalizes RMS, and soft-saturates."""
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


def write_audio_files(base_path, audio_data):
    """Writes both MP3 (192k) and WAV (24-bit PCM) files."""
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
# SET 1: SteamStation Aurora (Flagship / Recommended)
# Balanced Steam tactile pop + pure crystalline bell chime + progressive ambient pads
# ==============================================================================


def build_aurora_bronze(toast, ps5):
    """Bronze (~1.0s): Subtle, grounded chime with quick-decaying ambient warmth."""
    dur = 1.00
    st_pop = isolate_steam_transient(toast, duration_ms=35, hp_freq=780)

    # Chime: Single clean PS5 bell strike ducked for initial 15ms
    chime_len = min(len(ps5), int(0.70 * SR))
    chime = ps5[:chime_len].copy()
    duck_len = int(0.018 * SR)
    chime[:duck_len] *= (np.sin(np.linspace(0, np.pi / 2, duck_len)) ** 2)[:, None]
    chime *= (np.cos(np.linspace(0, np.pi / 2, len(chime))) ** 2)[:, None]

    # Ambient bed: Subtle warm harmonic drone (F4 = 349.2 Hz, C5 = 523.3 Hz)
    drone = synth_ambient_drone([349.2, 523.3], dur, decay_exp=4.2, detune_cents=3, lfo_rate=0.4)
    drone = filt(drone, "lowpass", 1400)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 2.80  # Tactile pop
    mix[: len(chime)] += chime * 0.70  # Subtle crystalline bell
    mix[: len(drone)] += drone * 0.16  # Subtle warm ambient bed

    return master_sound(mix, target_duration=dur, target_rms_db=-16.5, fade_out_s=0.18)


def build_aurora_silver(toast, ps5):
    """Silver (~1.0s): Crisp double chime interval + airy stereo ambient shimmer."""
    dur = 1.00
    st_pop = isolate_steam_transient(toast, duration_ms=35, hp_freq=800)

    # Dual chime: Root bell strike (F5) at 12ms -> High crystalline bell (C6) at 115ms
    bell_root = ps5[: int(0.60 * SR)].copy()
    bell_root *= (np.cos(np.linspace(0, np.pi / 2, len(bell_root))) ** 2)[:, None]

    # Shifted upper chime (+7 semitones to C6)
    bell_high = pitch_shift(ps5[: int(0.55 * SR)], semitones=7.0)
    bell_high *= (np.cos(np.linspace(0, np.pi / 2, len(bell_high))) ** 2)[:, None]

    # Ambient shimmer: Airier bandpassed texture with stereo spread
    shimmer = filt(ps5, "bandpass", [1800, 7500])
    shimmer = stereo_widen(shimmer, 1.35)
    shimmer *= (np.exp(-3.5 * np.linspace(0, 1, len(shimmer))))[:, None]

    drone = synth_ambient_drone([349.2, 523.3, 880.0], dur, decay_exp=3.8, detune_cents=4, lfo_rate=0.45)
    drone = filt(drone, "bandpass", [400, 2800])

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 2.90
    mix[: len(bell_root)] += bell_root * 0.65
    i_high = int(0.115 * SR)
    end_h = min(mix_len, i_high + len(bell_high))
    mix[i_high:end_h] += bell_high[: end_h - i_high] * 0.55
    end_sh = min(mix_len, len(shimmer))
    mix[:end_sh] += shimmer[:end_sh] * 0.28
    mix[: len(drone)] += drone * 0.22

    return master_sound(mix, target_duration=dur, target_rms_db=-16.0, fade_out_s=0.20)


def build_aurora_gold(toast, launch, ps5):
    """Gold (~1.5s): Triad harmonic chime + blooming warm stereo ambient swell."""
    dur = 1.50
    st_pop = isolate_steam_transient(toast, duration_ms=40, hp_freq=750)

    # Low bloom foundation from launch_game (warmth in 150-700 Hz)
    low_bloom = filt(launch[: int(1.1 * SR)], "bandpass", [120, 950])
    low_bloom *= (np.cos(np.linspace(0, np.pi / 2, len(low_bloom))) ** 2)[:, None]

    # 3-note ascending harmonic chime: F5 (0ms) -> C6 (125ms) -> F6 (250ms)
    b1 = ps5[: int(0.70 * SR)]
    b2 = pitch_shift(ps5[: int(0.65 * SR)], 7.0)  # C6
    b3 = pitch_shift(ps5[: int(0.60 * SR)], 12.0)  # F6

    # Convolution IR resonance
    ir = generate_diffuse_reverb_ir(decay_s=1.2, tone_hz=6500, seed=10)
    conv_tail = np.stack([fftconvolve(b1[:, 0], ir[:, 0]), fftconvolve(b1[:, 1], ir[:, 1])], axis=1)
    conv_tail = stereo_widen(conv_tail, 1.45)

    # Lush ambient drone swell
    drone = synth_ambient_drone([174.6, 349.2, 523.3, 698.5], dur, decay_exp=2.8, detune_cents=5, lfo_rate=0.3)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.00
    mix[: len(low_bloom)] += low_bloom * 0.65
    mix[: len(b1)] += b1 * 0.65

    i2 = int(0.125 * SR)
    mix[i2 : min(mix_len, i2 + len(b2))] += b2[: max(0, mix_len - i2)] * 0.55

    i3 = int(0.250 * SR)
    mix[i3 : min(mix_len, i3 + len(b3))] += b3[: max(0, mix_len - i3)] * 0.50

    mix[: min(mix_len, len(conv_tail))] += conv_tail[:mix_len] * 0.35
    mix[: len(drone)] += drone * 0.30

    return master_sound(mix, target_duration=dur, target_rms_db=-15.5, fade_out_s=0.28)


def build_aurora_platinum(toast, launch, ps5p):
    """Platinum (~2.0s): Grand celestial bell chord + expansive 2-second ambient space."""
    dur = 2.00
    st_pop = isolate_steam_transient(toast, duration_ms=40, hp_freq=750)

    # 60ms reverse ambient breath riser before the impact
    riser_len = int(0.060 * SR)
    riser_audio = synth_ambient_drone([349.2, 523.3, 880.0], 0.060, decay_exp=-3.5)
    riser_audio *= (np.sin(np.linspace(0, np.pi / 2, riser_len)) ** 2)[:, None]

    # Cinematic sub-bass rumble (40-180 Hz)
    sub = filt(launch[: int(1.4 * SR)], "bandpass", [40, 220])
    sub *= (np.cos(np.linspace(0, np.pi / 2, len(sub))) ** 2)[:, None]

    # PS5 Platinum chord with mid/side widening
    plat_chord = stereo_widen(ps5p[: int(1.8 * SR)], 1.55)

    # High crystalline glint overtone at 550ms
    glint = pitch_shift(ps5p[: int(0.6 * SR)], 12.0)
    glint = filt(glint, "highpass", 2500)

    # Grand convolution hall
    ir = generate_diffuse_reverb_ir(decay_s=1.8, tone_hz=8000, seed=77)
    hall = np.stack([fftconvolve(plat_chord[:, 0], ir[:, 0]), fftconvolve(plat_chord[:, 1], ir[:, 1])], axis=1)
    hall = stereo_widen(hall, 1.65)

    # Deep celestial ambient space drone
    drone = synth_ambient_drone(
        [87.3, 174.6, 349.2, 523.3, 698.5], dur, decay_exp=2.2, detune_cents=6, lfo_rate=0.25
    )

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)

    # Place riser just before main transient hit
    hit_idx = riser_len
    mix[:riser_len] += riser_audio * 0.40

    mix[hit_idx : hit_idx + len(st_pop)] += st_pop * 3.10
    mix[hit_idx : min(mix_len, hit_idx + len(sub))] += sub[: max(0, mix_len - hit_idx)] * 0.85
    mix[hit_idx : min(mix_len, hit_idx + len(plat_chord))] += plat_chord[: max(0, mix_len - hit_idx)] * 0.80

    i_g = hit_idx + int(0.550 * SR)
    if i_g < mix_len:
        mix[i_g : min(mix_len, i_g + len(glint))] += glint[: max(0, mix_len - i_g)] * 0.45

    mix[hit_idx : min(mix_len, hit_idx + len(hall))] += hall[: max(0, mix_len - hit_idx)] * 0.42
    mix[: len(drone)] += drone * 0.38

    return master_sound(mix, target_duration=dur, target_rms_db=-15.0, fade_out_s=0.35)


# ==============================================================================
# SET 2: SteamStation Celestia (Lush Harmonic & Ethereal Space)
# Deeper atmospheric pads, extended chime bloom, wide cinematic imaging
# ==============================================================================


def build_celestia_bronze(toast, ps4):
    """Celestia Bronze (~1.0s): Warm PS4 dual-tone strike with soft acoustic halo."""
    dur = 1.00
    st_pop = isolate_steam_transient(toast, duration_ms=35, hp_freq=750)
    chime = ps4[: int(0.75 * SR)].copy()
    chime *= (np.cos(np.linspace(0, np.pi / 2, len(chime))) ** 2)[:, None]
    drone = synth_ambient_drone([415.3, 523.3], dur, decay_exp=4.0, detune_cents=4, lfo_rate=0.3)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 2.80
    mix[: len(chime)] += chime * 0.75
    mix[: len(drone)] += drone * 0.20
    return master_sound(mix, target_duration=dur, target_rms_db=-16.5, fade_out_s=0.18)


def build_celestia_silver(toast, ps5):
    """Celestia Silver (~1.0s): Shimmering bell with expansive air pad."""
    dur = 1.00
    st_pop = isolate_steam_transient(toast, duration_ms=35, hp_freq=800)
    chime = stereo_widen(ps5[: int(0.75 * SR)], 1.40)
    chime *= (np.cos(np.linspace(0, np.pi / 2, len(chime))) ** 2)[:, None]
    drone = synth_ambient_drone([349.2, 523.3, 880.0], dur, decay_exp=3.5, detune_cents=5, lfo_rate=0.4)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 2.90
    mix[: len(chime)] += chime * 0.70
    mix[: len(drone)] += drone * 0.28
    return master_sound(mix, target_duration=dur, target_rms_db=-16.0, fade_out_s=0.20)


def build_celestia_gold(launch, ps5):
    """Celestia Gold (~1.5s): Warm launch chord with majestic bell overtones."""
    dur = 1.50
    st_pop = isolate_steam_transient(launch, duration_ms=40, hp_freq=700)
    low_drone = filt(launch[: int(1.2 * SR)], "lowpass", 600)
    chime = pitch_shift(ps5[: int(1.1 * SR)], 4.0)  # Major 3rd
    chime = stereo_widen(chime, 1.50)
    drone = synth_ambient_drone([174.6, 349.2, 523.3, 698.5], dur, decay_exp=2.6, detune_cents=6, lfo_rate=0.28)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.00
    mix[: len(low_drone)] += low_drone * 0.75
    mix[: len(chime)] += chime * 0.65
    mix[: len(drone)] += drone * 0.35
    return master_sound(mix, target_duration=dur, target_rms_db=-15.5, fade_out_s=0.26)


def build_celestia_platinum(launch, ps5p):
    """Celestia Platinum (~2.0s): Deep celestial symphony with floating shimmer."""
    dur = 2.00
    st_pop = isolate_steam_transient(launch, duration_ms=45, hp_freq=700)
    sub = filt(launch[: int(1.5 * SR)], "bandpass", [35, 200])
    plat = stereo_widen(ps5p[: int(1.8 * SR)], 1.65)
    drone = synth_ambient_drone(
        [87.3, 174.6, 349.2, 523.3, 698.5], dur, decay_exp=2.0, detune_cents=7, lfo_rate=0.22
    )

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.10
    mix[: len(sub)] += sub * 0.90
    mix[: len(plat)] += plat * 0.85
    mix[: len(drone)] += drone * 0.42
    return master_sound(mix, target_duration=dur, target_rms_db=-15.0, fade_out_s=0.35)


# ==============================================================================
# SET 3: SteamStation Tactile (Snappy UI & Clean Focused Chimes)
# Crisp PC click emphasis, immediate notification clearance, zero mud
# ==============================================================================


def build_tactile_bronze(toast, ps5):
    """Tactile Bronze (~1.0s): Clean snappy pop + brief high chime glint."""
    dur = 1.00
    st_pop = isolate_steam_transient(toast, duration_ms=35, hp_freq=850)
    chime = filt(ps5[: int(0.50 * SR)], "highpass", 1200)
    chime *= (np.cos(np.linspace(0, np.pi / 2, len(chime))) ** 2)[:, None]

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.20
    mix[: len(chime)] += chime * 0.60
    return master_sound(mix, target_duration=dur, target_rms_db=-16.5, fade_out_s=0.15)


def build_tactile_silver(toast, ps5):
    """Tactile Silver (~1.0s): Punchy tactile attack + pristine glass interval."""
    dur = 1.00
    st_pop = isolate_steam_transient(toast, duration_ms=35, hp_freq=850)
    chime1 = filt(ps5[: int(0.50 * SR)], "highpass", 1000)
    chime2 = pitch_shift(filt(ps5[: int(0.45 * SR)], "highpass", 1500), 5.0)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.20
    mix[: len(chime1)] += chime1 * 0.60
    i2 = int(0.100 * SR)
    mix[i2 : i2 + len(chime2)] += chime2 * 0.50
    return master_sound(mix, target_duration=dur, target_rms_db=-16.0, fade_out_s=0.18)


def build_tactile_gold(toast, ps5):
    """Tactile Gold (~1.5s): Multi-tier chime with snappy PC transient."""
    dur = 1.50
    st_pop = isolate_steam_transient(toast, duration_ms=40, hp_freq=800)
    chime = ps5[: int(0.95 * SR)].copy()
    chime *= (np.cos(np.linspace(0, np.pi / 2, len(chime))) ** 2)[:, None]
    glint = pitch_shift(filt(ps5[: int(0.50 * SR)], "highpass", 2000), 12.0)

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.30
    mix[: len(chime)] += chime * 0.70
    i_g = int(0.180 * SR)
    mix[i_g : i_g + len(glint)] += glint * 0.45
    return master_sound(mix, target_duration=dur, target_rms_db=-15.5, fade_out_s=0.22)


def build_tactile_platinum(toast, launch, ps5p):
    """Tactile Platinum (~2.0s): Commanding tactile hit + Platinum chime resolve."""
    dur = 2.00
    st_pop = isolate_steam_transient(toast, duration_ms=40, hp_freq=800)
    sub = filt(launch[: int(1.1 * SR)], "bandpass", [60, 300])
    plat = ps5p[: int(1.5 * SR)].copy()
    plat *= (np.cos(np.linspace(0, np.pi / 2, len(plat))) ** 2)[:, None]

    mix_len = int(dur * SR)
    mix = np.zeros((mix_len, 2), dtype=np.float64)
    mix[: len(st_pop)] += st_pop * 3.30
    mix[: len(sub)] += sub * 0.75
    mix[: len(plat)] += plat * 0.80
    return master_sound(mix, target_duration=dur, target_rms_db=-15.0, fade_out_s=0.28)


# ==============================================================================
# HTML Preview Generator & Packager
# ==============================================================================


def generate_tiered_preview_html(sets_data, html_path):
    """Builds interactive HTML player for auditioning progressive trophy tiers."""
    json_data = json.dumps(sets_data, indent=2)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation Tiered Trophy Sound Suite</title>
<style>
  :root {{
    --bg: #0b0e14;
    --card: #131722;
    --card-hover: #1b2030;
    --border: #232a3d;
    --accent: #0070d1;
    --accent-steam: #66c0f4;
    --bronze: #cd7f32;
    --silver: #d1d8e0;
    --gold: #e5a93c;
    --platinum: #40c4ff;
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
    max-width: 1100px;
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
  h1 span {{ font-size: 13px; font-weight: 600; background: rgba(0, 112, 209, 0.2); color: var(--accent-steam); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(0, 112, 209, 0.4); }}
  p.subtitle {{ color: var(--text-dim); margin-top: 6px; font-size: 14px; max-width: 880px; }}

  /* Toolbar */
  .toolbar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #111520;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 14px;
  }}
  .toolbar-left, .toolbar-right {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }}
  .btn-tool {{
    background: #1c2234;
    border: 1px solid #333d59;
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
  .btn-tool:hover {{ background: #28324d; border-color: var(--accent-steam); }}
  .btn-primary {{ background: #0070d1; border-color: #0070d1; }}
  .btn-primary:hover {{ background: #0084f7; border-color: #0084f7; }}
  .btn-progression {{
    background: linear-gradient(135deg, rgba(205, 127, 50, 0.2), rgba(64, 196, 255, 0.2));
    border: 1px solid #40c4ff55;
    color: #fff;
    font-weight: 600;
  }}
  .btn-progression:hover {{
    background: linear-gradient(135deg, rgba(205, 127, 50, 0.4), rgba(64, 196, 255, 0.4));
    border-color: #40c4ff;
    box-shadow: 0 0 15px rgba(64, 196, 255, 0.25);
  }}
  .btn-zip {{
    background: rgba(229, 169, 60, 0.12);
    border-color: rgba(229, 169, 60, 0.35);
    color: #f0b849;
    font-weight: 600;
  }}
  .btn-zip:hover {{ background: #e5a93c; color: #0c0e14; border-color: #e5a93c; }}

  /* Set Selector Tabs */
  .set-tabs {{
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
  }}
  .tab-btn {{
    background: #141724;
    border: 1px solid #273046;
    color: #8c97ad;
    padding: 9px 18px;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }}
  .tab-btn:hover {{ color: #fff; border-color: #3f4c6e; }}
  .tab-btn.active {{
    background: #0070d1;
    color: #fff;
    border-color: #0070d1;
    box-shadow: 0 2px 12px rgba(0, 112, 209, 0.4);
  }}

  /* Tiers Grid */
  .tiers-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
    overflow: hidden;
  }}
  .tier-card:hover {{
    background: var(--card-hover);
    transform: translateY(-2px);
    box-shadow: 0 6px 22px rgba(0,0,0,0.4);
  }}
  .tier-card.is-playing {{
    border-color: var(--active);
    box-shadow: 0 0 20px rgba(0, 255, 170, 0.2);
  }}

  /* Tier colored accents */
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
  .badge-bronze {{ background: rgba(205, 127, 50, 0.15); color: var(--bronze); border: 1px solid rgba(205, 127, 50, 0.35); }}
  .badge-silver {{ background: rgba(209, 216, 224, 0.15); color: var(--silver); border: 1px solid rgba(209, 216, 224, 0.35); }}
  .badge-gold {{ background: rgba(229, 169, 60, 0.15); color: var(--gold); border: 1px solid rgba(229, 169, 60, 0.35); }}
  .badge-platinum {{ background: rgba(64, 196, 255, 0.15); color: var(--platinum); border: 1px solid rgba(64, 196, 255, 0.35); }}

  .tier-dur {{ font-size: 13px; font-weight: 600; color: #8c97ad; background: #0c0e14; padding: 3px 8px; border-radius: 4px; }}

  .tier-center {{ margin-bottom: 20px; }}
  .tier-name {{ font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 4px; }}
  .tier-desc {{ font-size: 12.5px; color: var(--text-dim); line-height: 1.4; }}

  .chime-spec {{
    background: #0d1017;
    border: 1px solid #1a2030;
    border-radius: 6px;
    padding: 8px 10px;
    margin-top: 10px;
    font-size: 11.5px;
    color: #9ab;
  }}
  .chime-spec strong {{ color: #e6edf3; }}

  .tier-bottom {{
    display: flex;
    flex-direction: column;
    gap: 10px;
  }}
  .play-bar {{
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .big-play-btn {{
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #1c2234;
    border: 1px solid #333d59;
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
  .tier-card.is-playing .big-play-btn {{ background: var(--active); color: #0c0e14; border-color: var(--active); }}

  .dl-row {{
    display: flex;
    gap: 6px;
  }}
  .btn-dl {{
    flex: 1;
    background: #161c2b;
    border: 1px solid #28334a;
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
  .btn-dl.wav:hover {{ background: #234673; color: #fff; }}

  /* Progression timeline visualizer */
  .timeline-bar {{
    background: #11141e;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 28px;
  }}
  .timeline-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }}
  .timeline-header h3 {{ font-size: 14px; font-weight: 600; color: #fff; }}
  .timeline-track {{
    height: 12px;
    background: #181d2a;
    border-radius: 6px;
    display: flex;
    overflow: hidden;
    gap: 2px;
  }}
  .tl-seg {{ height: 100%; border-radius: 3px; position: relative; transition: opacity 0.2s; }}
  .tl-bronze {{ width: 18%; background: var(--bronze); }}
  .tl-silver {{ width: 18%; background: var(--silver); }}
  .tl-gold {{ width: 28%; background: var(--gold); }}
  .tl-platinum {{ width: 36%; background: var(--platinum); }}

  /* Code block */
  .code-section {{
    background: #0f121a;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-top: 24px;
  }}
  .code-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }}
  .code-header h4 {{ font-size: 13.5px; font-weight: 600; color: #fff; }}
  pre {{
    background: #07090e;
    border: 1px solid #1a2030;
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
    font-size: 12px;
    color: #66c0f4;
    font-family: Consolas, Monaco, "Courier New", monospace;
  }}
</style>
</head>
<body>

<header>
  <div class="top-row">
    <h1>
      🏆 SteamStation Tiered Trophy SFX Suite
      <span>Custom Progressive Design</span>
    </h1>
    <div style="display:flex; gap:10px;">
      <a href="preview_hybrids.html" class="btn-tool" style="text-decoration:none;">&larr; Hybrid A/B Pairs</a>
    </div>
  </div>
  <p class="subtitle">
    Custom trophy sound effects combining Steam's tactile PC attack with PlayStation's crystalline chimes.
    Engineered with a subtle chime and an ambient sound bed that progressively builds in richness, depth, and spatial width
    from <b>Bronze (1.0s)</b> &rarr; <b>Silver (1.0s)</b> &rarr; <b>Gold (1.5s)</b> &rarr; <b>Platinum (2.0s)</b>.
  </p>
</header>

<div class="toolbar">
  <div class="toolbar-left">
    <button class="btn-tool btn-progression" id="btn-progression">▶ Play Full Progression (Bronze ➔ Platinum)</button>
    <button class="btn-tool" id="btn-stop">■ Stop All</button>
  </div>
  <div class="toolbar-right">
    <a href="SteamStation_Tiered_Trophies_MP3.zip" download class="btn-tool btn-zip">📦 Download All MP3s (.ZIP)</a>
    <a href="SteamStation_Tiered_Trophies_WAV.zip" download class="btn-tool btn-zip">📦 Download All WAVs (.ZIP)</a>
  </div>
</div>

<div class="timeline-bar">
  <div class="timeline-header">
    <h3>Acoustic Progression: Chime Harmonic Complexity & Ambient Sound Depth</h3>
    <span style="font-size:12px; color:var(--text-dim)">Total Rarity Hierarchy</span>
  </div>
  <div class="timeline-track">
    <div class="tl-seg tl-bronze" title="Bronze (1.0s) - Subtle, crisp transient, quick ambient tail"></div>
    <div class="tl-seg tl-silver" title="Silver (1.0s) - Crystalline 2-tone chime, airy stereo shimmer"></div>
    <div class="tl-seg tl-gold" title="Gold (1.5s) - 3-note harmonic bloom, warm low-mid swell"></div>
    <div class="tl-seg tl-platinum" title="Platinum (2.0s) - Celestial chord, deep sub-rumble, expansive 2s ambient space"></div>
  </div>
  <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:11.5px; color:#8c97ad">
    <span>🥉 Bronze: 1.0s</span>
    <span>🥈 Silver: 1.0s</span>
    <span>🥇 Gold: 1.5s</span>
    <span>🏆 Platinum: 2.0s</span>
  </div>
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

// Setup Set Selector Tabs
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

// Full Progression Player
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

    // Wait for duration + 350ms pause before triggering next tier
    progressionTimer = setTimeout(() => {{
      curr++;
      playNext();
    }}, (tier.duration * 1000) + 350);
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
    print(f"[UI] Generated Tiered Trophy Preview Player: {html_path}")


def main():
    parser = argparse.ArgumentParser(description="SteamStation Tiered Trophy Sound Designer")
    parser.add_argument("--open", action="store_true", help="Open evaluation player in browser")
    args = parser.parse_args()

    os.makedirs(TIERS_DIR, exist_ok=True)

    print("=======================================================")
    print("Designing SteamStation Progressive Trophy Sounds")
    print("Duration Targets: Bronze: 1.0s, Silver: 1.0s, Gold: 1.5s, Platinum: 2.0s")
    print("=======================================================\n")

    toast = load_audio(os.path.join(THEME_DIR, "deck_ui_achievement_toast.wav"))
    launch = load_audio(os.path.join(THEME_DIR, "deck_ui_launch_game.wav"))
    ps5 = load_audio(os.path.join(THEME_DIR, "ps5_trophy.mp3"))
    ps5p = load_audio(os.path.join(THEME_DIR, "ps5_trophy_platinum.mp3"))
    ps4 = load_audio(os.path.join(THEME_DIR, "ps4_trophy.mp3"))

    sets = [
        {
            "id": "aurora",
            "name": "SteamStation Aurora",
            "character": "Recommended Flagship",
            "description": "Tactile Steam PC click attack + pure crystalline PlayStation bells + organic ambient pads expanding across tiers.",
            "generators": {
                "bronze": lambda: (
                    build_aurora_bronze(toast, ps5),
                    1.00,
                    "Single F5 crystalline bell strike",
                    "Subtle warm F4/C5 ambient drone decaying cleanly",
                ),
                "silver": lambda: (
                    build_aurora_silver(toast, ps5),
                    1.00,
                    "F5 ➔ C6 ascending crystalline chime interval",
                    "Airy bandpassed stereo shimmer pad (width 1.35x)",
                ),
                "gold": lambda: (
                    build_aurora_gold(toast, launch, ps5),
                    1.50,
                    "F5 ➔ C6 ➔ F6 ascending 3-note harmonic bloom",
                    "Warm low-mid swell + convolution acoustic hall (width 1.5x)",
                ),
                "platinum": lambda: (
                    build_aurora_platinum(toast, launch, ps5p),
                    2.00,
                    "Multi-voice PS5 Platinum chord + octave sparkle glint",
                    "Reverse breath riser + deep sub-bass + celestial shimmer space (width 1.7x)",
                ),
            },
        },
        {
            "id": "celestia",
            "name": "SteamStation Celestia",
            "character": "Lush & Ethereal Space",
            "description": "Deeper choral ambient pads, prominent harmonic drones, and wide cinematic spatial diffusion.",
            "generators": {
                "bronze": lambda: (
                    build_celestia_bronze(toast, ps4),
                    1.00,
                    "Warm PS4 dual-tone bell strike",
                    "Soft atmospheric halo decaying at 1.0s",
                ),
                "silver": lambda: (
                    build_celestia_silver(toast, ps5),
                    1.00,
                    "Crystalline bell with stereo sparkle",
                    "Airy harmonic pad with gentle stereo chorus",
                ),
                "gold": lambda: (
                    build_celestia_gold(launch, ps5),
                    1.50,
                    "Major 3rd bell harmony on launch foundation",
                    "Warm choral drone swell + expanding stereo tail",
                ),
                "platinum": lambda: (
                    build_celestia_platinum(launch, ps5p),
                    2.00,
                    "Full Platinum chord with grand acoustic ring",
                    "Deep sub-rumble + expansive celestial hall diffusion",
                ),
            },
        },
        {
            "id": "tactile",
            "name": "SteamStation Tactile",
            "character": "Crisp UI & Focused Chimes",
            "description": "Snappy PC transient click emphasis, tighter ambient decay, and clear functional gameplay feedback.",
            "generators": {
                "bronze": lambda: (
                    build_tactile_bronze(toast, ps5),
                    1.00,
                    "High-passed crystalline bell glint",
                    "Minimal decay tail, instant clearance",
                ),
                "silver": lambda: (
                    build_tactile_silver(toast, ps5),
                    1.00,
                    "Snappy 2-tone glass interval",
                    "Short crystalline shimmer tail",
                ),
                "gold": lambda: (
                    build_tactile_gold(toast, ps5),
                    1.50,
                    "Fast arpeggiated chime + high sparkle",
                    "Controlled stereo reverb space",
                ),
                "platinum": lambda: (
                    build_tactile_platinum(toast, launch, ps5p),
                    2.00,
                    "Commanding tactile strike + Platinum resolve",
                    "Sub-impact bloom + focused shimmer reverb",
                ),
            },
        },
    ]

    tier_meta = {
        "bronze": {
            "title": "Bronze Trophy",
            "icon": "🥉",
            "name": "Tactile Chime",
            "desc": "Subtle, crisp notification designed to inform without interrupting intense gameplay.",
        },
        "silver": {
            "title": "Silver Trophy",
            "icon": "🥈",
            "name": "Crystalline Chime",
            "desc": "Brighter ascending chime interval with airy stereo shimmer space.",
        },
        "gold": {
            "title": "Gold Trophy",
            "icon": "🥇",
            "name": "Majestic Chime",
            "desc": "Rich 3-note harmonic bloom with warm low-mid resonance and expanded stereo swell.",
        },
        "platinum": {
            "title": "Platinum Trophy",
            "icon": "🏆",
            "name": "Celestial Chime",
            "desc": "Grand triumphant signature with sub-bass depth, reverse breath riser, and 2-second celestial space.",
        },
    }

    manifest_sets = []

    for s_info in sets:
        print(f"--- Rendering Set: {s_info['name']} ({s_info['character']}) ---")
        rendered_tiers = []
        for t_id in ["bronze", "silver", "gold", "platinum"]:
            fn_prefix = f"trophy_{s_info['id']}_{t_id}"
            gen_fn = s_info["generators"][t_id]
            audio, target_dur, chime_info, ambient_info = gen_fn()

            base_out = os.path.join(TIERS_DIR, fn_prefix)
            mp3_p, wav_p = write_audio_files(base_out, audio)

            # If this is the flagship Aurora set, also copy directly to sfx/ for convenience
            if s_info["id"] == "aurora":
                flagship_base = os.path.join(HERE, f"steamstation_{t_id}")
                write_audio_files(flagship_base, audio)

            dur = len(audio) / SR
            pk = np.abs(audio).max()
            rms = np.sqrt((audio**2).mean())
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
                    "mp3_path": f"tiers/{fn_prefix}.mp3",
                    "wav_path": f"tiers/{fn_prefix}.wav",
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
    mp3_zip = os.path.join(HERE, "SteamStation_Tiered_Trophies_MP3.zip")
    wav_zip = os.path.join(HERE, "SteamStation_Tiered_Trophies_WAV.zip")

    with zipfile.ZipFile(mp3_zip, "w", zipfile.ZIP_DEFLATED) as zm:
        for f in sorted(os.listdir(TIERS_DIR)):
            if f.endswith(".mp3"):
                zm.write(os.path.join(TIERS_DIR, f), arcname=f)
        for t_id in ["bronze", "silver", "gold", "platinum"]:
            fn = f"steamstation_{t_id}.mp3"
            p = os.path.join(HERE, fn)
            if os.path.isfile(p):
                zm.write(p, arcname=fn)

    with zipfile.ZipFile(wav_zip, "w", zipfile.ZIP_DEFLATED) as zw:
        for f in sorted(os.listdir(TIERS_DIR)):
            if f.endswith(".wav"):
                zw.write(os.path.join(TIERS_DIR, f), arcname=f)
        for t_id in ["bronze", "silver", "gold", "platinum"]:
            fn = f"steamstation_{t_id}.wav"
            p = os.path.join(HERE, fn)
            if os.path.isfile(p):
                zw.write(p, arcname=fn)

    print(f"\n[ZIP] Created Tiered Trophy Packages:")
    print(f"  * MP3: SteamStation_Tiered_Trophies_MP3.zip ({os.path.getsize(mp3_zip)/1024:.1f} KB)")
    print(f"  * WAV: SteamStation_Tiered_Trophies_WAV.zip ({os.path.getsize(wav_zip)/1024/1024:.1f} MB)")

    preview_html_path = os.path.join(HERE, "preview_tiered_trophies.html")
    generate_tiered_preview_html(manifest_sets, preview_html_path)

    if args.open:
        webbrowser.open("file://" + os.path.abspath(preview_html_path))

    print("\n[Done] All progressive trophy sounds generated successfully.")
    print(f"Audition in browser: file:///{preview_html_path.replace(os.sep, '/')}")


if __name__ == "__main__":
    main()
