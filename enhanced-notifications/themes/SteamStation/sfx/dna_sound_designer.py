#!/usr/bin/env python3
"""DNA Trophy Sound Designer - 3-Profile PlayStation Trophy Wave Movement Suite.

100% Original Procedural Audio Synthesis - Zero PlayStation Audio Files.
Synthesizes 3 distinct profile variations for every mood based on the 3 PlayStation reference files:
  1. PS4 Profile       (based on ps4_trophy.mp3): ~0.95s, punchy attack tick, rapid bright chime, focused stereo
  2. PS5 Profile       (based on ps5_trophy.mp3): ~1.40s, smooth atmospheric pre-swell, warm suspended bloom, glassy strike
  3. Platinum Profile  (based on ps5_trophy_platinum.mp3): ~2.20s, multi-stage ascension fanfare, soaring celestial crest, expansive 3D tail

Generates 21 moods across all 3 profiles = 63 bespoke audio files:
  - 10 Original DNA Moods (Epic, Sci-Fi, Fantasiac, Medieval, Religious, Arcaic, Guitar, Harp, Drums, Afric Ancient)
    * Medieval features reworked majestic Royal Herald Trumpets and Cathedral Carillons for Bloom & Platinum.
  - 5 Expanded Favorite Variations:
    * Epic II: Sovereign Fanfare
    * Fantasiac II: Starlight Music Box
    * Guitar II: 12-String Resonance
    * Harp II: Bardic High Flourish
    * Afric Ancient II: Sacred Kora & Gourd
  - 1 Space Galaxy Sci-Fi: Cosmic Nebula & Pulsar
  - 3 Robotic Styles: Cyber Droid, Quantum AI Core, Heavy Industrial Mech
  - 2 Retro Gaming Styles: 8-Bit NES Chiptune, 16-Bit Classic FM RPG Victory

Features:
  - Per-sequence ZIP downloads (one-click download of all 3 variations for any mood).
  - Complete master ZIP package (all 63 tracks organized into PS4, PS5, PLATINUM).
  - Interactive preview player with profile filtering, dynamic canvas visualizer, and toast simulator.
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
OUT_DIR = os.path.join(HERE, "dna_trophies")
ZIPS_DIR = os.path.join(OUT_DIR, "zips")
FF = imageio_ffmpeg.get_ffmpeg_exe()

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(ZIPS_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Core DSP & Synthesis Primitives
# ---------------------------------------------------------------------------

def filt(x, kind, hz, order=2):
    """Butterworth filter helper."""
    hz = np.clip(hz, 20, SR / 2 - 200)
    sos = butter(order, hz, kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def stereo_widen(x, factor=1.40):
    """Mid/Side stereo widen (>1.0) or narrow (<1.0)."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * factor
    return np.stack([mid + side, mid - side], axis=1)


def generate_diffuse_reverb_ir(decay_s, tone_hz=6000, pre_delay_ms=10, seed=42):
    """Synthesizes a decorrelated stereo diffuse reverb impulse response."""
    rng = np.random.default_rng(seed)
    n = int(decay_s * SR)
    env = np.exp(-6.5 * np.linspace(0, 1, n))[:, None]
    ir = rng.standard_normal((n, 2)) * env
    ir = filt(ir, "lowpass", tone_hz, order=2)
    pre_len = int(pre_delay_ms * 0.001 * SR)
    if pre_len > 0:
        ir[:pre_len] = 0.0
    norm = np.sqrt((ir**2).sum(axis=0, keepdims=True)) + 1e-8
    return ir / norm


def apply_convolution_hall(x, ir, mix_level=0.30, width=1.40, dry_level=0.75):
    """Convolves stereo audio with diffuse IR for authentic 3D spatial acoustic diffusion."""
    conv_l = fftconvolve(x[:, 0], ir[:, 0])
    conv_r = fftconvolve(x[:, 1], ir[:, 1])
    wet = np.stack([conv_l, conv_r], axis=1)
    wet = stereo_widen(wet, width)
    wet_pk = np.max(np.abs(wet))
    if wet_pk > 1e-6:
        wet /= wet_pk
    return mix_tracks(x * dry_level, wet * mix_level)


def mix_tracks(*tracks):
    """Mixes multiple 2D stereo numpy audio arrays, zero-padding to maximum length."""
    valid_tracks = [t for t in tracks if t is not None and len(t) > 0]
    if not valid_tracks:
        return np.zeros((int(SR * 1.0), 2), dtype=np.float64)
    processed = []
    for t in valid_tracks:
        if t.ndim == 1:
            t = np.repeat(t[:, None], 2, axis=1)
        elif t.ndim == 2 and t.shape[1] == 1:
            t = np.repeat(t, 2, axis=1)
        processed.append(t)
    max_len = max(len(t) for t in processed)
    out = np.zeros((max_len, 2), dtype=np.float64)
    for t in processed:
        out[: len(t)] += t
    return out


def master_sound(x, target_duration, target_rms_db=-16.0, fade_out_s=0.25, peak_ceiling_db=-0.5):
    """Trims/pads to target duration, applies cosine-squared fade out, normalizes loudness, and soft-saturates."""
    target_len = int(target_duration * SR)
    out = np.zeros((target_len, 2), dtype=np.float64)
    n = min(len(x), target_len)
    out[:n] = x[:n]

    fade_len = int(fade_out_s * SR)
    if fade_len > 0 and target_len > fade_len:
        ramp = 0.5 * (1.0 + np.cos(np.linspace(0, np.pi, fade_len)))
        out[-fade_len:, 0] *= ramp
        out[-fade_len:, 1] *= ramp

    active_mask = np.abs(out).max(axis=1) > 0.005
    if np.any(active_mask):
        rms = np.sqrt(np.mean(out[active_mask] ** 2))
    else:
        rms = np.sqrt(np.mean(out ** 2)) + 1e-9

    target_rms = 10.0 ** (target_rms_db / 20.0)
    gain = target_rms / (rms + 1e-9)
    out *= gain

    ceiling = 10.0 ** (peak_ceiling_db / 20.0)
    pk = np.max(np.abs(out))
    if pk > ceiling:
        out = np.tanh(out / ceiling) * ceiling

    return np.clip(out, -1.0, 1.0)


def export_audio_files(base_name, sig):
    """Exports stereo numpy audio array as 16-bit 48kHz WAV and 320kbps MP3."""
    wav_path = os.path.join(OUT_DIR, f"{base_name}.wav")
    mp3_path = os.path.join(OUT_DIR, f"{base_name}.mp3")

    i16 = (np.clip(sig, -1.0, 1.0) * 32767.0).astype(np.int16)
    raw_bytes = i16.tobytes()

    cmd_wav = [
        FF, "-y",
        "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0",
        "-c:a", "pcm_s16le",
        wav_path
    ]
    p_wav = subprocess.Popen(cmd_wav, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p_wav.communicate(input=raw_bytes)

    cmd_mp3 = [
        FF, "-y",
        "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0",
        "-c:a", "libmp3lame", "-b:a", "320k",
        mp3_path
    ]
    p_mp3 = subprocess.Popen(cmd_mp3, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p_mp3.communicate(input=raw_bytes)

    return wav_path, mp3_path

# ---------------------------------------------------------------------------
# Specialized Synthesis Engines
# ---------------------------------------------------------------------------

def synth_karplus_strong(freq_hz, duration_s, pick_pos=0.20, hardness=0.85, decay_time=1.5):
    """Karplus-Strong physical plucked string algorithm with stable decay time."""
    n_samples = int(duration_s * SR)
    period = int(round(SR / freq_hz))
    if period < 2: period = 2

    rng = np.random.default_rng(int(freq_hz * 100) % 100000)
    burst = rng.uniform(-1.0, 1.0, period)

    pick_idx = int(period * pick_pos)
    if pick_idx > 0 and pick_idx < period:
        comb = np.zeros(period)
        comb[0] = 1.0
        comb[pick_idx] = -1.0
        burst = np.convolve(burst, comb, mode="same")

    b_lp = np.array([1.0 - hardness, hardness])
    burst = np.convolve(burst, b_lp, mode="same")
    burst = burst / (np.max(np.abs(burst)) + 1e-8)

    buf = np.copy(burst)
    out = np.zeros(n_samples)
    rho = float(np.exp(-1.0 / (freq_hz * decay_time)))

    for i in range(n_samples):
        idx = i % period
        val = buf[idx]
        out[i] = val
        next_idx = (idx + 1) % period
        filtered = 0.5 * (val + buf[next_idx])
        buf[idx] = filtered * rho

    out = out / (np.max(np.abs(out)) + 1e-8)
    d_samp = max(1, int(0.0007 * SR))
    left = out
    right = np.concatenate([np.zeros(d_samp), out[:-d_samp]])
    return np.stack([left, right], axis=1)


def synth_modal_bar(fund_hz, duration_s, modes, strike_hardness=0.8, decay_mult=1.0, attack_ms=3.0):
    """Physical modal resonator for metallic bells, glass tines, xylophones and bars."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n)
    stereo_sig = np.zeros((n, 2), dtype=np.float64)

    att_len = max(1, int(attack_ms * 0.001 * SR))
    att_ramp = np.sin(np.linspace(0, np.pi / 2, att_len)) ** 2
    strike_env = np.ones(n)
    strike_env[:att_len] = att_ramp

    for i, (f_ratio, amp, dec_rate) in enumerate(modes):
        f = fund_hz * f_ratio
        if f >= SR / 2 - 100: continue
        d = dec_rate / decay_mult
        env = np.exp(-d * t) * strike_env
        pan = np.sin(i * 1.85) * 0.35
        left_gain = (1.0 - pan) * amp
        right_gain = (1.0 + pan) * amp
        osc = np.sin(2 * np.pi * f * t) * env
        stereo_sig[:, 0] += osc * left_gain
        stereo_sig[:, 1] += osc * right_gain

    pk = np.max(np.abs(stereo_sig))
    if pk > 1e-8:
        stereo_sig /= pk
    return stereo_sig


def synth_fm_crystal(fc, fm, duration_s, mod_index_max=3.0, decay_exp=3.5):
    """2-Operator FM synthesis for crystalline metallic tones and cyber-optic chimes."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n)
    i_mod = mod_index_max * np.exp(-decay_exp * t)
    carrier_env = np.exp(-(decay_exp * 0.8) * t)

    mod_sig = np.sin(2 * np.pi * fm * t)
    left = np.sin(2 * np.pi * fc * t + i_mod * mod_sig) * carrier_env
    t_dt = t + 0.0004
    right = np.sin(2 * np.pi * (fc * 1.002) * t_dt + (i_mod * 0.95) * mod_sig) * carrier_env

    stereo = np.stack([left, right], axis=1)
    pk = np.max(np.abs(stereo))
    if pk > 1e-8: stereo /= pk
    return stereo


def synth_brass_formant_swell(f0, duration_s, rise_time_s=0.15, formants=None):
    """Multi-saw brass swell through resonant vocal/horn acoustic formants."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n)
    if formants is None:
        formants = [(450, 4.0, 1.0), (1100, 3.5, 0.7), (2400, 5.0, 0.4)]

    detunes = [0.998, 1.000, 1.002]
    saw = np.zeros(n)
    for d in detunes:
        freq = f0 * d
        saw += 2.0 * ((t * freq) % 1.0) - 1.0
    saw /= len(detunes)

    n_rise = max(1, int(rise_time_s * SR))
    env = np.ones(n)
    env[:n_rise] = (np.sin(np.linspace(0, np.pi / 2, n_rise))) ** 2
    env[n_rise:] = np.exp(-3.2 * (t[n_rise:] - rise_time_s))

    out_mono = np.zeros(n)
    for f_center, q, gain in formants:
        bw = f_center / q
        low = max(20, f_center - bw / 2)
        high = min(SR / 2 - 200, f_center + bw / 2)
        filtered = filt(saw[:, None], "bandpass", [low, high], order=2)[:, 0]
        out_mono += filtered * gain

    out_mono *= env
    pk = np.max(np.abs(out_mono))
    if pk > 1e-8: out_mono /= pk

    left = out_mono
    delay_n = int(0.0008 * SR)
    right = np.concatenate([np.zeros(delay_n), out_mono[:-delay_n]])
    return np.stack([left, right], axis=1)


def synth_royal_trumpet(freq_hz, duration_s, attack_s=0.04):
    """Sovereign royal fanfare trumpet with brilliant brass harmonics."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n)
    harmonics = [
        (1.0, 1.0), (2.0, 0.85), (3.0, 0.70), (4.0, 0.55),
        (5.0, 0.40), (6.0, 0.30), (7.0, 0.20), (8.0, 0.15)
    ]
    raw = np.zeros(n)
    for h, amp in harmonics:
        f = freq_hz * h
        if f < SR / 2 - 100:
            raw += amp * np.sin(2 * np.pi * f * t)
    
    n_att = max(1, int(attack_s * SR))
    env = np.ones(n)
    env[:n_att] = np.sin(np.linspace(0, np.pi / 2, n_att)) ** 2
    env[n_att:] = np.exp(-3.0 * (t[n_att:] - attack_s))
    
    filtered = filt(raw[:, None], "bandpass", [180, 7500], order=2)[:, 0] * env
    pk = np.max(np.abs(filtered))
    if pk > 1e-8: filtered /= pk
    
    d_samp = max(1, int(0.0006 * SR))
    left = filtered
    right = np.concatenate([np.zeros(d_samp), filtered[:-d_samp]])
    return np.stack([left, right], axis=1)


def synth_8bit_pulse(freq_hz, duration_s, duty=0.5):
    """Authentic 8-bit NES 2A03 variable duty cycle pulse wave."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)
    phase = (t * freq_hz) % 1.0
    sig = np.where(phase < duty, 0.75, -0.75)
    env = np.exp(-3.8 * t)
    mono = sig * env
    d_samp = max(1, int(0.0005 * SR))
    right = np.concatenate([np.zeros(d_samp), mono[:-d_samp]])
    return np.stack([mono, right], axis=1)


def synth_8bit_triangle(freq_hz, duration_s):
    """Authentic 8-bit NES stepped triangle wave bass."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n, endpoint=False)
    phase = (t * freq_hz) % 1.0
    sig = 2.0 * np.abs(2.0 * (phase - np.floor(phase + 0.5))) - 1.0
    env = np.exp(-4.2 * t)
    mono = sig * env * 0.8
    return np.repeat(mono[:, None], 2, axis=1)


def synth_8bit_noise(duration_s, period=16):
    """Authentic NES 15-bit shift-register pseudo-random noise."""
    n = int(duration_s * SR)
    reg = 1
    out = np.zeros(n)
    step = 0
    val = 0.5
    for i in range(n):
        if step % period == 0:
            bit = (reg ^ (reg >> 1)) & 1 if period <= 32 else (reg ^ (reg >> 6)) & 1
            reg = (reg >> 1) | (bit << 14)
            val = 0.6 if (reg & 1) else -0.6
        out[i] = val
        step += 1
    t = np.linspace(0, duration_s, n)
    mono = out * np.exp(-22.0 * t)
    return np.repeat(mono[:, None], 2, axis=1)


def synth_8bit_fast_arp(freqs, duration_s, speed_hz=45.0, duty=0.25):
    """Classic 8-bit rapid arpeggio (60Hz frequency cycling)."""
    n = int(duration_s * SR)
    out = np.zeros(n)
    t = np.linspace(0, duration_s, n, endpoint=False)
    samples_per_frame = int(SR / speed_hz)
    
    phase = 0.0
    for i in range(n):
        note_idx = (i // samples_per_frame) % len(freqs)
        cur_freq = freqs[note_idx]
        phase += cur_freq / SR
        phase_norm = phase % 1.0
        val = 0.75 if phase_norm < duty else -0.75
        out[i] = val
        
    env = np.exp(-3.5 * t)
    mono = out * env
    d_samp = max(1, int(0.0006 * SR))
    right = np.concatenate([np.zeros(d_samp), mono[:-d_samp]])
    return np.stack([mono, right], axis=1)


def synth_16bit_fm_horn(freq_hz, duration_s, attack_ms=25.0):
    """16-bit console FM synthesized brass (YM2612 / SPC700 style)."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n)
    
    n_att = max(1, int(attack_ms * 0.001 * SR))
    env = np.ones(n)
    env[:n_att] = np.sin(np.linspace(0, np.pi / 2, n_att)) ** 2
    env[n_att:] = np.exp(-3.5 * (t[n_att:] - attack_ms * 0.001))
    
    mod = np.sin(2 * np.pi * (freq_hz * 2.0) * t) * 1.8 * np.exp(-4.0 * t)
    car = np.sin(2 * np.pi * freq_hz * t + mod) * env
    car_harm = np.sin(2 * np.pi * (freq_hz * 3.0) * t + mod * 0.5) * env * 0.35
    mono = car + car_harm
    pk = np.max(np.abs(mono))
    if pk > 1e-8: mono /= pk
    
    d_samp = max(1, int(0.0008 * SR))
    right = np.concatenate([np.zeros(d_samp), mono[:-d_samp]])
    return np.stack([mono, right], axis=1)


def synth_servo_motor(duration_s, start_hz=400.0, end_hz=1600.0):
    """Robotic high-precision micro-servo motor whir and click."""
    n = int(duration_s * SR)
    t = np.linspace(0, duration_s, n)
    f_curve = start_hz + (end_hz - start_hz) * (t / duration_s) ** 1.5
    carrier = np.sin(2 * np.pi * np.cumsum(f_curve) / SR)
    
    pw = 0.5 + 0.3 * np.sin(2 * np.pi * 80.0 * t)
    pulse = np.where((t * f_curve) % 1.0 < pw, 0.6, -0.6)
    
    env = np.sin(np.pi * (t / duration_s)) ** 2
    mono = (carrier * 0.5 + pulse * 0.5) * env
    return np.repeat(mono[:, None], 2, axis=1)

# ---------------------------------------------------------------------------
# The 21 Mood Suite Implementations
# ---------------------------------------------------------------------------

# 1. Epic (Cinematic Orchestral)
def generate_epic(style='ps5'):
    chime_modes = [(1.0, 1.0, 2.5), (2.0, 0.6, 3.5), (2.75, 0.4, 4.5), (4.0, 0.25, 6.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6000, pre_delay_ms=8, seed=101)
        t_timp = np.linspace(0, dur, int(dur * SR))
        timp_sig = np.sin(2 * np.pi * (140.0 * np.exp(-18.0 * t_timp) + 65.0) * t_timp) * np.exp(-6.5 * t_timp)
        timp = np.repeat(timp_sig[:, None], 2, axis=1)
        brass = synth_brass_formant_swell(261.63, duration_s=0.6, rise_time_s=0.04) * 0.75
        chime = synth_modal_bar(523.25, duration_s=0.85, modes=chime_modes, decay_mult=0.9) * 0.85
        dry = mix_tracks(timp * 0.70, brass, chime)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=5800, pre_delay_ms=12, seed=102)
        t_hit = 0.08
        n_hit = int(t_hit * SR)
        t_timp = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        timp_sig = np.sin(2 * np.pi * (120.0 * np.exp(-14.0 * t_timp) + 55.0) * t_timp) * np.exp(-5.0 * t_timp)
        timp = np.zeros((int(dur * SR), 2))
        timp[n_hit:n_hit + len(timp_sig)] = np.repeat(timp_sig[:, None], 2, axis=1)
        brass_c3 = synth_brass_formant_swell(130.81, duration_s=1.2, rise_time_s=0.12)
        brass_g3 = synth_brass_formant_swell(196.00, duration_s=1.1, rise_time_s=0.14) * 0.8
        brass = mix_tracks(brass_c3, brass_g3)
        chime_c5 = synth_modal_bar(523.25, duration_s=1.2, modes=chime_modes, decay_mult=1.1)
        chime_g5 = synth_modal_bar(784.00, duration_s=1.1, modes=chime_modes, decay_mult=1.0) * 0.65
        chimes = mix_tracks(chime_c5, chime_g5)
        aligned_chimes = np.zeros((int(dur * SR), 2))
        aligned_chimes[n_hit:n_hit + len(chimes)] = chimes[:min(len(chimes), len(aligned_chimes) - n_hit)]
        dry = mix_tracks(timp * 0.65, brass * 0.55, aligned_chimes * 0.85)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.35, dry_level=0.75), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.25
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=5500, pre_delay_ms=16, seed=103)
        t_hit = 0.12
        n_hit = int(t_hit * SR)
        t_timp = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        timp_sig = np.sin(2 * np.pi * (110.0 * np.exp(-12.0 * t_timp) + 52.0) * t_timp) * np.exp(-4.2 * t_timp)
        timp = np.zeros((int(dur * SR), 2))
        timp[n_hit:n_hit + len(timp_sig)] = np.repeat(timp_sig[:, None], 2, axis=1)
        brass_c3 = synth_brass_formant_swell(130.81, duration_s=1.8, rise_time_s=0.20)
        brass_g3 = synth_brass_formant_swell(196.00, duration_s=1.7, rise_time_s=0.22) * 0.85
        brass_c4 = synth_brass_formant_swell(261.63, duration_s=1.6, rise_time_s=0.25) * 0.70
        brass_bed = mix_tracks(brass_c3, brass_g3, brass_c4)
        chime_c5 = synth_modal_bar(523.25, duration_s=1.8, modes=chime_modes, decay_mult=1.3)
        chime_g5 = synth_modal_bar(784.00, duration_s=1.7, modes=chime_modes, decay_mult=1.2) * 0.75
        chime_c6 = synth_modal_bar(1046.50, duration_s=1.5, modes=chime_modes, decay_mult=1.0) * 0.45
        chimes = mix_tracks(chime_c5, chime_g5, chime_c6)
        aligned_chimes = np.zeros((int(dur * SR), 2))
        aligned_chimes[n_hit:n_hit + len(chimes)] = chimes[:min(len(chimes), len(aligned_chimes) - n_hit)]
        dry = mix_tracks(timp * 0.75, brass_bed * 0.60, aligned_chimes * 0.90)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-15.5)

# 2. Sci-Fi (Futuristic Cybernetic)
def generate_scifi(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=8500, pre_delay_ms=6, seed=201)
        t_click = np.linspace(0, 0.015, int(0.015 * SR))
        rng = np.random.default_rng(201)
        click_raw = rng.standard_normal(len(t_click)) * np.exp(-180.0 * t_click)
        click = filt(click_raw[:, None], "bandpass", [4000, 12000], order=3)
        click_stereo = np.repeat(click, 2, axis=1) * 0.8
        fm_core = synth_fm_crystal(fc=880.0, fm=1320.0, duration_s=0.85, mod_index_max=2.8, decay_exp=4.2)
        dry = mix_tracks(click_stereo, fm_core)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=8000, pre_delay_ms=8, seed=202)
        t_sweep = np.linspace(0, 0.35, int(0.35 * SR))
        f_sweep = 1600.0 + 3200.0 * (t_sweep / 0.35) ** 2
        sweep_osc = np.sin(2 * np.pi * np.cumsum(f_sweep) / SR) * np.exp(-4.5 * t_sweep)
        sweep_stereo = np.stack([sweep_osc, np.roll(sweep_osc, int(0.002 * SR))], axis=1) * 0.35
        fm_core = synth_fm_crystal(fc=880.0, fm=1320.0, duration_s=1.2, mod_index_max=3.0, decay_exp=3.5)
        fm_accent = synth_fm_crystal(fc=1108.7, fm=1663.0, duration_s=1.1, mod_index_max=2.2, decay_exp=3.8) * 0.45
        dry = mix_tracks(sweep_stereo, fm_core, fm_accent)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.40, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.15
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=8000, pre_delay_ms=10, seed=203)
        t_click = np.linspace(0, 0.025, int(0.025 * SR))
        rng = np.random.default_rng(203)
        click_raw = rng.standard_normal(len(t_click)) * np.exp(-120.0 * t_click)
        click = filt(click_raw[:, None], "bandpass", [3500, 11000], order=3)
        click_stereo = np.repeat(click, 2, axis=1) * 0.7
        fm_core = synth_fm_crystal(fc=880.0, fm=1320.0, duration_s=1.7, mod_index_max=3.2, decay_exp=3.0)
        fm_sparkle = synth_fm_crystal(fc=1760.0, fm=2640.0, duration_s=1.4, mod_index_max=2.0, decay_exp=4.2) * 0.50
        fm_accent = synth_fm_crystal(fc=1108.7, fm=1663.0, duration_s=1.5, mod_index_max=2.5, decay_exp=3.6) * 0.45
        t_tail = np.linspace(0, 0.8, int(0.8 * SR))
        warp = np.sin(2 * np.pi * 440.0 * t_tail + 2.5 * np.sin(2 * np.pi * 14.0 * t_tail)) * np.exp(-3.5 * t_tail)
        warp_stereo = np.repeat(warp[:, None], 2, axis=1) * 0.35
        dry = mix_tracks(click_stereo, fm_core, fm_sparkle, fm_accent, warp_stereo)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 3. Fantasiac (Enchanted Ethereal)
def generate_fantasy(style='ps5'):
    glass_modes = [(1.0, 1.0, 2.5), (2.32, 0.5, 4.0), (4.25, 0.3, 6.0), (6.65, 0.15, 8.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=7500, pre_delay_ms=8, seed=301)
        gliss1 = synth_modal_bar(880.0, duration_s=0.8, modes=glass_modes, decay_mult=0.9)
        gliss2 = synth_modal_bar(1318.5, duration_s=0.7, modes=glass_modes, decay_mult=0.85) * 0.7
        main_glass = synth_modal_bar(440.0, duration_s=0.85, modes=glass_modes, decay_mult=0.95)
        dry = mix_tracks(main_glass * 0.8, gliss1 * 0.6, gliss2 * 0.4)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.25, width=1.15, dry_level=0.80), target_duration=dur, target_rms_db=-16.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=7500, pre_delay_ms=10, seed=302)
        notes = [698.46, 880.0, 1046.50, 1318.51]
        tines = []
        for i, f in enumerate(notes):
            t = synth_modal_bar(f, duration_s=1.2 - i*0.02, modes=glass_modes, decay_mult=1.2)
            padded = np.zeros((int(dur * SR), 2))
            st = int(i * 0.025 * SR)
            padded[st:st + len(t)] = t[:min(len(t), len(padded) - st)]
            tines.append(padded * 0.6)
        main_glass = synth_modal_bar(349.23, duration_s=1.2, modes=glass_modes, decay_mult=1.3)
        celesta = synth_modal_bar(523.25, duration_s=1.0, modes=[(1.0, 1.0, 3.5), (2.75, 0.3, 6.0)], attack_ms=8.0) * 0.4
        dry = mix_tracks(mix_tracks(*tines), main_glass * 0.8, celesta)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.40, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=7500, pre_delay_ms=14, seed=303)
        notes = [698.46, 880.0, 987.77, 1046.50, 1318.51, 1567.98, 2093.00]
        gliss_layers = []
        for i, freq in enumerate(notes):
            delay_s = i * 0.024
            tine = synth_modal_bar(freq, duration_s=1.8 - delay_s, modes=glass_modes, decay_mult=1.4)
            pan = -0.6 + 1.2 * (i / (len(notes) - 1))
            tine_panned = np.zeros_like(tine)
            tine_panned[:, 0] = tine[:, 0] * (1.0 - pan) * 0.5
            tine_panned[:, 1] = tine[:, 1] * (1.0 + pan) * 0.5
            padded = np.zeros((int(dur * SR), 2))
            start_idx = int(delay_s * SR)
            padded[start_idx:start_idx + len(tine_panned)] = tine_panned[:min(len(tine_panned), len(padded) - start_idx)]
            gliss_layers.append(padded * 0.55)
        n_hit = int(0.14 * SR)
        main_glass = synth_modal_bar(349.23, duration_s=1.8, modes=glass_modes, decay_mult=1.6)
        fifth_glass = synth_modal_bar(523.25, duration_s=1.7, modes=glass_modes, decay_mult=1.5) * 0.7
        oct_glass = synth_modal_bar(1396.91, duration_s=1.5, modes=glass_modes, decay_mult=1.2) * 0.45
        chime_cluster = mix_tracks(main_glass, fifth_glass, oct_glass)
        aligned_cluster = np.zeros((int(dur * SR), 2))
        aligned_cluster[n_hit:n_hit + len(chime_cluster)] = chime_cluster[:min(len(chime_cluster), len(aligned_cluster) - n_hit)]
        celesta = synth_modal_bar(523.25, duration_s=1.3, modes=[(1.0, 1.0, 3.5), (2.75, 0.3, 6.0)], attack_ms=8.0) * 0.4
        dry = mix_tracks(mix_tracks(*gliss_layers), aligned_cluster * 0.85, celesta)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 4. Medieval (Royal Castle Courtyard) - Reworked for Sovereign Majesty on Bloom & Platinum!
def generate_medieval(style='ps5'):
    bell_modes = [(0.5, 0.4, 2.0), (1.0, 1.0, 3.0), (1.2, 0.5, 4.0), (1.5, 0.6, 4.5), (2.0, 0.7, 5.5)]
    if style == 'ps4':
        # Baseline Chime (user approved: hammered dulcimer + carillon bell)
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=5200, pre_delay_ms=8, seed=401)
        dulc = synth_karplus_strong(440.00, duration_s=0.8, pick_pos=0.18, hardness=0.85, decay_time=0.8)
        carillon = synth_modal_bar(440.00, duration_s=0.85, modes=bell_modes, decay_mult=0.9)
        dry = mix_tracks(dulc * 0.65, carillon * 0.80)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        # SOVEREIGN ROYAL MAJESTY BLOOM (~1.40s)
        # Noble herald trumpets sounding a royal fifth (D4 - A4 - D5),
        # combined with cascading cathedral carillon bells echoing across castle ramparts!
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.5, tone_hz=5800, pre_delay_ms=12, seed=402)
        t_hit = 0.05
        n_hit = int(t_hit * SR)
        tpt_d4 = synth_royal_trumpet(293.66, duration_s=1.2, attack_s=0.04) * 0.75
        tpt_a4 = synth_royal_trumpet(440.00, duration_s=1.1, attack_s=0.05) * 0.85
        tpt_d5 = synth_royal_trumpet(587.33, duration_s=1.0, attack_s=0.06) * 0.70
        brass_fanfare = mix_tracks(tpt_d4, tpt_a4, tpt_d5)

        carillon_d4 = synth_modal_bar(293.66, duration_s=1.3, modes=bell_modes, decay_mult=1.3)
        carillon_fsharp = synth_modal_bar(369.99, duration_s=1.2, modes=bell_modes, decay_mult=1.2) * 0.75
        carillon_a4 = synth_modal_bar(440.00, duration_s=1.2, modes=bell_modes, decay_mult=1.2) * 0.80
        carillon_d5 = synth_modal_bar(587.33, duration_s=1.1, modes=bell_modes, decay_mult=1.1) * 0.65
        carillons = mix_tracks(carillon_d4, carillon_fsharp, carillon_a4, carillon_d5)

        dulc1 = synth_karplus_strong(293.66, duration_s=1.2, pick_pos=0.18, hardness=0.85, decay_time=1.2) * 0.50
        dulc2 = synth_karplus_strong(587.33, duration_s=1.0, pick_pos=0.20, hardness=0.85, decay_time=1.0) * 0.40

        aligned_fanfare = np.zeros((int(dur * SR), 2))
        aligned_fanfare[n_hit:n_hit + len(brass_fanfare)] = brass_fanfare[:min(len(brass_fanfare), len(aligned_fanfare) - n_hit)]

        dry = mix_tracks(aligned_fanfare * 0.85, carillons * 0.80, dulc1, dulc2)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.32, width=1.45, dry_level=0.76), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        # SUPREME ROYAL CORONATION MAJESTY (~2.25s)
        # Multi-stage imperial herald fanfare (D4 -> F#4 -> A4 -> D5 -> soaring A5),
        # colossal cathedral carillon tower chord, and sovereign timpani impact!
        dur = 2.25
        ir = generate_diffuse_reverb_ir(decay_s=2.3, tone_hz=6000, pre_delay_ms=16, seed=403)
        t_timp = np.linspace(0, 1.8, int(1.8 * SR))
        timp = np.repeat((np.sin(2 * np.pi * (146.83 * np.exp(-14.0 * t_timp) + 55.0) * t_timp) * np.exp(-4.5 * t_timp))[:, None], 2, axis=1) * 0.85

        fanfare_notes = [
            (0.00, 293.66, 1.8, 0.75),
            (0.06, 369.99, 1.7, 0.70),
            (0.12, 440.00, 1.8, 0.85),
            (0.18, 587.33, 1.8, 0.90),
            (0.24, 880.00, 1.6, 0.75),
        ]
        fanfare_layers = []
        for st_s, freq, d_note, vol in fanfare_notes:
            sig = synth_royal_trumpet(freq, duration_s=d_note, attack_s=0.04) * vol
            p = np.zeros((int(dur * SR), 2))
            idx = int(st_s * SR)
            p[idx:idx + len(sig)] = sig[:min(len(sig), len(p) - idx)]
            fanfare_layers.append(p)
        fanfare_mix = mix_tracks(*fanfare_layers)

        c_d4 = synth_modal_bar(293.66, duration_s=2.0, modes=bell_modes, decay_mult=1.5)
        c_a4 = synth_modal_bar(440.00, duration_s=1.9, modes=bell_modes, decay_mult=1.4) * 0.8
        c_d5 = synth_modal_bar(587.33, duration_s=1.8, modes=bell_modes, decay_mult=1.3) * 0.75
        c_fsharp5 = synth_modal_bar(739.99, duration_s=1.6, modes=bell_modes, decay_mult=1.2) * 0.6
        c_a5 = synth_modal_bar(880.00, duration_s=1.5, modes=bell_modes, decay_mult=1.1) * 0.5
        carillon_mix = mix_tracks(c_d4, c_a4, c_d5, c_fsharp5, c_a5)

        dry = mix_tracks(timp * 0.80, fanfare_mix * 0.90, carillon_mix * 0.85)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-15.5)

# 5. Religious / Sacred (Cathedral Sanctuary)
def generate_religious(style='ps5'):
    church_modes = [
        (0.500, 0.75, 1.8), (1.000, 1.00, 2.5), (1.189, 0.55, 3.2),
        (1.498, 0.65, 3.8), (2.000, 0.85, 4.5), (3.000, 0.35, 6.0), (4.000, 0.20, 8.0)
    ]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=5200, pre_delay_ms=10, seed=501)
        bell = synth_modal_bar(523.25, duration_s=0.85, modes=church_modes[1:], decay_mult=0.9)
        sanctus = synth_modal_bar(1046.50, duration_s=0.85, modes=[(1.0, 1.0, 3.0), (2.76, 0.4, 5.0)], decay_mult=0.9) * 0.6
        dry = mix_tracks(bell * 0.8, sanctus)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.25, width=1.10, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.5, tone_hz=5000, pre_delay_ms=14, seed=502)
        great_bell = synth_modal_bar(261.63, duration_s=1.3, modes=church_modes, decay_mult=1.2)
        t_ch = np.linspace(0, 1.2, int(1.2 * SR))
        env_ch = np.sin(np.linspace(0, np.pi/2, int(0.2*SR)))**2
        ch_raw = np.sin(2 * np.pi * 261.63 * t_ch) + np.sin(2 * np.pi * 392.00 * t_ch) * 0.8
        ch_env = np.zeros(len(t_ch))
        ch_env[:len(env_ch)] = env_ch
        ch_env[len(env_ch):] = np.exp(-3.0 * (t_ch[len(env_ch):] - 0.2))
        choir = np.repeat((ch_raw * ch_env)[:, None], 2, axis=1) * 0.35
        sanctus = synth_modal_bar(1046.50, duration_s=1.1, modes=[(1.0, 1.0, 3.0), (2.76, 0.4, 5.0)], decay_mult=1.1) * 0.55
        dry = mix_tracks(great_bell * 0.85, choir, sanctus)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.32, width=1.40, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.35
        ir = generate_diffuse_reverb_ir(decay_s=2.4, tone_hz=4800, pre_delay_ms=18, seed=503)
        great_bell = synth_modal_bar(130.81, duration_s=2.2, modes=church_modes, decay_mult=1.5)
        fifth_bell = synth_modal_bar(196.00, duration_s=2.0, modes=church_modes, decay_mult=1.4) * 0.75
        oct_bell = synth_modal_bar(261.63, duration_s=1.8, modes=church_modes, decay_mult=1.3) * 0.70
        bells = mix_tracks(great_bell, fifth_bell, oct_bell)
        t_ch = np.linspace(0, 2.0, int(2.0 * SR))
        env_ch = np.sin(np.linspace(0, np.pi/2, int(0.35*SR)))**2
        ch_raw = (np.sin(2 * np.pi * 130.81 * t_ch) + np.sin(2 * np.pi * 196.00 * t_ch) * 0.8 + np.sin(2 * np.pi * 261.63 * t_ch) * 0.7)
        ch_env = np.zeros(len(t_ch))
        ch_env[:len(env_ch)] = env_ch
        ch_env[len(env_ch):] = np.exp(-2.2 * (t_ch[len(env_ch):] - 0.35))
        choir = np.repeat((ch_raw * ch_env)[:, None], 2, axis=1) * 0.35
        sanctus_c6 = synth_modal_bar(1046.50, duration_s=1.6, modes=[(1.0, 1.0, 3.0), (2.76, 0.4, 5.0)], decay_mult=1.2) * 0.6
        sanctus_g6 = synth_modal_bar(1567.98, duration_s=1.4, modes=[(1.0, 1.0, 3.0), (2.76, 0.4, 5.0)], decay_mult=1.1) * 0.4
        sanctus = mix_tracks(sanctus_c6, sanctus_g6)
        dry = mix_tracks(bells * 0.85, choir, sanctus)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.40, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 6. Arcaic (Ancient Mediterranean)
def generate_arcaic(style='ps5'):
    bowl_modes = [(1.00, 1.00, 2.0), (2.71, 0.60, 3.2), (5.14, 0.30, 4.8), (8.22, 0.15, 6.5)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=5000, pre_delay_ms=8, seed=601)
        bowl = synth_modal_bar(330.0, duration_s=0.85, modes=bowl_modes, decay_mult=0.9)
        lyre = synth_karplus_strong(495.0, duration_s=0.8, pick_pos=0.15, hardness=0.75, decay_time=0.8) * 0.7
        dry = mix_tracks(bowl * 0.8, lyre)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=4800, pre_delay_ms=10, seed=602)
        bowl_e3 = synth_modal_bar(164.81, duration_s=1.3, modes=bowl_modes, decay_mult=1.2)
        bowl_b3 = synth_modal_bar(246.94, duration_s=1.2, modes=bowl_modes, decay_mult=1.1) * 0.75
        bowls = mix_tracks(bowl_e3, bowl_b3)
        lyre1 = synth_karplus_strong(329.63, duration_s=1.1, pick_pos=0.18, hardness=0.80, decay_time=1.0)
        lyre2 = synth_karplus_strong(493.88, duration_s=1.0, pick_pos=0.18, hardness=0.80, decay_time=0.9) * 0.8
        lyre_mix = np.zeros((int(dur * SR), 2))
        lyre_mix[:len(lyre1)] += lyre1 * 0.6
        t_d = int(0.035 * SR)
        lyre_mix[t_d:t_d + len(lyre2)] += lyre2 * 0.5
        dry = mix_tracks(bowls * 0.85, lyre_mix)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=4600, pre_delay_ms=14, seed=603)
        gong = synth_modal_bar(110.00, duration_s=2.0, modes=bowl_modes, decay_mult=1.5)
        bowl_e3 = synth_modal_bar(164.81, duration_s=1.8, modes=bowl_modes, decay_mult=1.3) * 0.8
        bowl_b3 = synth_modal_bar(246.94, duration_s=1.7, modes=bowl_modes, decay_mult=1.2) * 0.7
        bowls = mix_tracks(gong, bowl_e3, bowl_b3)
        lyre_freqs = [220.00, 246.94, 293.66, 329.63, 440.00]
        lyre_layers = []
        for i, f in enumerate(lyre_freqs):
            plk = synth_karplus_strong(f, duration_s=1.5 - i*0.1, pick_pos=0.20, hardness=0.82, decay_time=1.2)
            padded = np.zeros((int(dur * SR), 2))
            st = int(i * 0.032 * SR)
            padded[st:st + len(plk)] = plk[:min(len(plk), len(padded) - st)] * 0.55
            lyre_layers.append(padded)
        dry = mix_tracks(bowls * 0.85, mix_tracks(*lyre_layers))
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 7. Guitar (Acoustic Flageolet)
def generate_guitar(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6500, pre_delay_ms=6, seed=701)
        h1 = synth_karplus_strong(659.25, duration_s=0.85, pick_pos=0.12, hardness=0.92, decay_time=1.2)
        dry = h1
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=6200, pre_delay_ms=8, seed=702)
        h_e = synth_karplus_strong(659.25, duration_s=1.25, pick_pos=0.12, hardness=0.92, decay_time=1.4)
        h_b = synth_karplus_strong(987.77, duration_s=1.20, pick_pos=0.12, hardness=0.92, decay_time=1.3) * 0.8
        mixed = np.zeros((int(dur * SR), 2))
        mixed[:len(h_e)] += h_e
        t_d = int(0.04 * SR)
        mixed[t_d:t_d + len(h_b)] += h_b
        body = filt(mixed, "bandpass", [180, 450], order=2) * 0.4
        dry = mix_tracks(mixed * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.10
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=6200, pre_delay_ms=10, seed=703)
        h_e4 = synth_karplus_strong(329.63, duration_s=1.8, pick_pos=0.14, hardness=0.90, decay_time=1.6)
        h_b4 = synth_karplus_strong(493.88, duration_s=1.7, pick_pos=0.13, hardness=0.91, decay_time=1.5) * 0.85
        h_e5 = synth_karplus_strong(659.25, duration_s=1.6, pick_pos=0.12, hardness=0.92, decay_time=1.4) * 0.80
        h_gsharp5 = synth_karplus_strong(830.61, duration_s=1.5, pick_pos=0.11, hardness=0.93, decay_time=1.3) * 0.70
        h_b5 = synth_karplus_strong(987.77, duration_s=1.4, pick_pos=0.10, hardness=0.94, decay_time=1.2) * 0.65
        t_delays = [0, int(0.035 * SR), int(0.070 * SR), int(0.105 * SR), int(0.140 * SR)]
        flourish = np.zeros((int(dur * SR), 2))
        layers = [h_e4, h_b4, h_e5, h_gsharp5, h_b5]
        for d_idx, layer in zip(t_delays, layers):
            flourish[d_idx:d_idx + len(layer)] += layer
        body = filt(flourish, "bandpass", [160, 480], order=2) * 0.45
        dry = mix_tracks(flourish * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 8. Harp (Celtic Concert Strings)
def generate_harp(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6800, pre_delay_ms=8, seed=801)
        p1 = synth_karplus_strong(523.25, duration_s=0.85, pick_pos=0.22, hardness=0.80, decay_time=1.0)
        p2 = synth_karplus_strong(659.25, duration_s=0.80, pick_pos=0.22, hardness=0.80, decay_time=0.95) * 0.8
        mixed = np.zeros((int(dur * SR), 2))
        mixed[:len(p1)] += p1
        t_d = int(0.02 * SR)
        mixed[t_d:t_d + len(p2)] += p2
        dry = mixed
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=6500, pre_delay_ms=10, seed=802)
        chord_c_maj9 = [261.63, 329.63, 392.00, 493.88, 587.33]
        harp_layers = []
        for i, f in enumerate(chord_c_maj9):
            delay_s = i * 0.022
            plucked = synth_karplus_strong(f, duration_s=1.2 - delay_s, pick_pos=0.22, hardness=0.82, decay_time=1.3)
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(plucked)] = plucked[:min(len(plucked), len(padded) - st)]
            harp_layers.append(padded)
        harp_arpeggio = mix_tracks(*harp_layers)
        dry = harp_arpeggio
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.40, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=6500, pre_delay_ms=12, seed=803)
        flourish_notes = [130.81, 196.00, 261.63, 329.63, 392.00, 493.88, 523.25, 659.25, 783.99, 1046.50]
        harp_layers = []
        for i, f in enumerate(flourish_notes):
            delay_s = i * 0.020
            plucked = synth_karplus_strong(f, duration_s=1.8 - delay_s, pick_pos=0.22, hardness=0.84, decay_time=1.5)
            pan = -0.55 + 1.1 * (i / (len(flourish_notes) - 1))
            panned = np.zeros_like(plucked)
            panned[:, 0] = plucked[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = plucked[:, 1] * (1.0 + pan) * 0.5
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(panned)] = panned[:min(len(panned), len(padded) - st)]
            harp_layers.append(padded)
        harp_arpeggio = mix_tracks(*harp_layers)
        soundboard = filt(harp_arpeggio, "bandpass", [140, 480], order=2) * 0.35
        dry = mix_tracks(harp_arpeggio * 0.85, soundboard)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 9. Drums (Cinematic Percussion)
def generate_drums(style='ps5'):
    drum_modes = [(1.0, 1.0, 3.0), (1.5, 0.6, 4.0), (2.0, 0.5, 5.0), (2.75, 0.25, 7.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.75, tone_hz=5500, pre_delay_ms=6, seed=901)
        t_body = np.linspace(0, dur, int(dur * SR))
        sub_sig = np.sin(2 * np.pi * (200.0 * np.exp(-22.0 * t_body) + 55.0) * t_body) * np.exp(-7.0 * t_body)
        t_snap = np.linspace(0, 0.015, int(0.015 * SR))
        rng = np.random.default_rng(901)
        snap = filt(rng.standard_normal(len(t_snap))[:, None] * np.exp(-160.0 * t_snap)[:, None], "bandpass", [2200, 6500]) * 0.9
        aligned = np.zeros((int(dur * SR), 2))
        aligned[:len(sub_sig)] += np.repeat(sub_sig[:, None], 2, axis=1) * 0.85
        aligned[:len(snap)] += np.repeat(snap, 2, axis=1)
        dry = aligned
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.00, dry_level=0.82), target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=5200, pre_delay_ms=8, seed=902)
        t_hit = 0.05
        n_hit = int(t_hit * SR)
        t_body = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        sub_sig = np.sin(2 * np.pi * (180.0 * np.exp(-16.0 * t_body) + 52.0) * t_body) * np.exp(-5.5 * t_body)
        tuned = synth_modal_bar(146.83, duration_s=1.1, modes=drum_modes, decay_mult=1.1) * 0.6
        aligned = np.zeros((int(dur * SR), 2))
        aligned[n_hit:n_hit + len(sub_sig)] += np.repeat(sub_sig[:, None], 2, axis=1) * 0.85
        aligned[n_hit:n_hit + len(tuned)] += tuned
        dry = aligned
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.30, dry_level=0.78), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.10
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=5200, pre_delay_ms=12, seed=903)
        t_rise = np.linspace(0, 0.07, int(0.07 * SR))
        rng = np.random.default_rng(903)
        rise_noise = rng.standard_normal(len(t_rise)) * (t_rise / 0.07) ** 3
        rise_filt = filt(rise_noise[:, None], "bandpass", [600, 3200], order=2) * 0.4
        t_hit = 0.06
        n_hit = int(t_hit * SR)
        t_body = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        sub_sig = np.sin(2 * np.pi * np.cumsum(180.0 * np.exp(-18.0 * t_body) + 50.0) / SR) * np.exp(-5.5 * t_body)
        t_snap = np.linspace(0, 0.018, int(0.018 * SR))
        snap = filt(rng.standard_normal(len(t_snap))[:, None] * np.exp(-140.0 * t_snap)[:, None], "bandpass", [2000, 6000]) * 0.8
        tuned = synth_modal_bar(146.83, duration_s=1.6, modes=drum_modes, decay_mult=1.3) * 0.70
        aligned = np.zeros((int(dur * SR), 2))
        len_sub = min(len(sub_sig), len(aligned) - n_hit)
        aligned[n_hit:n_hit + len_sub] += np.repeat(sub_sig[:len_sub, None], 2, axis=1) * 0.85
        len_snap = min(len(snap), len(aligned) - n_hit)
        aligned[n_hit:n_hit + len_snap] += np.repeat(snap[:len_snap], 2, axis=1)
        len_sing = min(len(tuned), len(aligned) - n_hit)
        aligned[n_hit:n_hit + len_sing] += tuned[:len_sing]
        riser = np.zeros((int(dur * SR), 2))
        riser[:len(rise_filt)] = np.repeat(rise_filt, 2, axis=1)
        dry = mix_tracks(riser, aligned)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.50, dry_level=0.75), target_duration=dur, target_rms_db=-15.5)

# 10. Afric Ancient (Earthen African Heritage)
def generate_afric_ancient(style='ps5'):
    kalimba_modes = [(1.00, 1.00, 2.5), (6.27, 0.35, 6.0), (17.55, 0.10, 12.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6000, pre_delay_ms=8, seed=1001)
        tine1 = synth_modal_bar(349.23, duration_s=0.85, modes=kalimba_modes, decay_mult=0.9)
        tine2 = synth_modal_bar(523.25, duration_s=0.80, modes=kalimba_modes, decay_mult=0.85) * 0.8
        dry = mix_tracks(tine1, tine2)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=5800, pre_delay_ms=10, seed=1002)
        tine_c4 = synth_modal_bar(261.63, duration_s=1.2, modes=kalimba_modes, decay_mult=1.2)
        tine_f4 = synth_modal_bar(349.23, duration_s=1.1, modes=kalimba_modes, decay_mult=1.1) * 0.8
        tine_c5 = synth_modal_bar(523.25, duration_s=1.0, modes=kalimba_modes, decay_mult=1.0) * 0.7
        t_udu = np.linspace(0, 0.6, int(0.6 * SR))
        udu = np.repeat((np.sin(2 * np.pi * 78.0 * t_udu) * np.exp(-8.0 * t_udu))[:, None], 2, axis=1) * 0.6
        dry = mix_tracks(tine_c4, tine_f4, tine_c5, udu)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=5800, pre_delay_ms=12, seed=1003)
        tine_c4 = synth_modal_bar(261.63, duration_s=1.8, modes=kalimba_modes, decay_mult=1.4)
        tine_f4 = synth_modal_bar(349.23, duration_s=1.7, modes=kalimba_modes, decay_mult=1.3) * 0.85
        tine_g4 = synth_modal_bar(392.00, duration_s=1.6, modes=kalimba_modes, decay_mult=1.3) * 0.75
        tine_c5 = synth_modal_bar(523.25, duration_s=1.5, modes=kalimba_modes, decay_mult=1.2) * 0.65
        t_roll = [0, int(0.032 * SR), int(0.064 * SR), int(0.096 * SR)]
        tines_mixed = np.zeros((int(dur * SR), 2))
        tines_mixed[t_roll[0]:t_roll[0] + len(tine_c4)] += tine_c4
        tines_mixed[t_roll[1]:t_roll[1] + len(tine_f4)] += tine_f4
        tines_mixed[t_roll[2]:t_roll[2] + len(tine_g4)] += tine_g4
        tines_mixed[t_roll[3]:t_roll[3] + len(tine_c5)] += tine_c5
        buzz_env = np.exp(-3.5 * np.linspace(0, 1.2, int(1.2 * SR)))
        rng = np.random.default_rng(1003)
        buzz = filt(rng.standard_normal(len(buzz_env))[:, None] * buzz_env[:, None] * 0.18, "bandpass", [1800, 5200])
        buzz_stereo = np.repeat(buzz, 2, axis=1)
        t_udu = np.linspace(0, 0.8, int(0.8 * SR))
        udu_stereo = np.repeat((np.sin(2 * np.pi * 78.0 * t_udu) * np.exp(-8.0 * t_udu))[:, None], 2, axis=1) * 0.65
        balafon = synth_modal_bar(261.63, duration_s=1.2, modes=[(1.0, 1.0, 4.0), (2.75, 0.3, 8.0)], attack_ms=6.0) * 0.45
        dry = mix_tracks(tines_mixed * 0.80, buzz_stereo * 0.35, udu_stereo, balafon)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.50, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 11. Epic II: Sovereign Fanfare (Brass Choir & Heroic Timpani)
def generate_epic_fanfare(style='ps5'):
    chime_modes = [(1.0, 1.0, 2.5), (2.0, 0.7, 3.5), (2.75, 0.4, 4.5), (4.0, 0.25, 6.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=6200, pre_delay_ms=8, seed=1101)
        t_timp = np.linspace(0, dur, int(dur * SR))
        timp = np.repeat((np.sin(2 * np.pi * (160.0 * np.exp(-18.0 * t_timp) + 65.0) * t_timp) * np.exp(-6.5 * t_timp))[:, None], 2, axis=1) * 0.75
        tpt1 = synth_royal_trumpet(261.63, duration_s=0.7, attack_s=0.03) * 0.8
        tpt2 = synth_royal_trumpet(392.00, duration_s=0.7, attack_s=0.03) * 0.7
        chime = synth_modal_bar(523.25, duration_s=0.85, modes=chime_modes, decay_mult=0.9) * 0.8
        dry = mix_tracks(timp, tpt1, tpt2, chime)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.24, width=1.10, dry_level=0.80), target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.5, tone_hz=5800, pre_delay_ms=12, seed=1102)
        t_hit = 0.06
        n_hit = int(t_hit * SR)
        t_timp = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        timp_sig = np.sin(2 * np.pi * (130.0 * np.exp(-14.0 * t_timp) + 55.0) * t_timp) * np.exp(-5.0 * t_timp)
        timp = np.zeros((int(dur * SR), 2))
        timp[n_hit:n_hit + len(timp_sig)] = np.repeat(timp_sig[:, None], 2, axis=1) * 0.7
        b_c3 = synth_royal_trumpet(130.81, duration_s=1.2, attack_s=0.06) * 0.7
        b_g3 = synth_royal_trumpet(196.00, duration_s=1.2, attack_s=0.07) * 0.75
        b_c4 = synth_royal_trumpet(261.63, duration_s=1.1, attack_s=0.08) * 0.85
        b_e4 = synth_royal_trumpet(329.63, duration_s=1.0, attack_s=0.09) * 0.70
        brass_choir = mix_tracks(b_c3, b_g3, b_c4, b_e4)
        chimes = synth_modal_bar(523.25, duration_s=1.2, modes=chime_modes, decay_mult=1.1)
        aligned_brass = np.zeros((int(dur * SR), 2))
        aligned_brass[n_hit:n_hit + len(brass_choir)] = brass_choir[:min(len(brass_choir), len(aligned_brass) - n_hit)]
        dry = mix_tracks(timp, aligned_brass * 0.85, chimes * 0.75)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.32, width=1.40, dry_level=0.76), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.25
        ir = generate_diffuse_reverb_ir(decay_s=2.3, tone_hz=5600, pre_delay_ms=16, seed=1103)
        t_timp = np.linspace(0, 1.8, int(1.8 * SR))
        timp = np.repeat((np.sin(2 * np.pi * (120.0 * np.exp(-12.0 * t_timp) + 50.0) * t_timp) * np.exp(-4.2 * t_timp))[:, None], 2, axis=1) * 0.85
        fanfare_notes = [
            (0.00, 130.81, 1.8, 0.75),
            (0.05, 196.00, 1.8, 0.75),
            (0.10, 261.63, 1.7, 0.85),
            (0.16, 329.63, 1.7, 0.85),
            (0.22, 392.00, 1.6, 0.90),
            (0.28, 523.25, 1.5, 0.85),
        ]
        brass_layers = []
        for st_s, freq, d_note, vol in fanfare_notes:
            sig = synth_royal_trumpet(freq, duration_s=d_note, attack_s=0.05) * vol
            p = np.zeros((int(dur * SR), 2))
            idx = int(st_s * SR)
            p[idx:idx + len(sig)] = sig[:min(len(sig), len(p) - idx)]
            brass_layers.append(p)
        brass_full = mix_tracks(*brass_layers)
        chime_c5 = synth_modal_bar(523.25, duration_s=1.8, modes=chime_modes, decay_mult=1.4)
        chime_g5 = synth_modal_bar(784.00, duration_s=1.7, modes=chime_modes, decay_mult=1.3) * 0.75
        chimes = mix_tracks(chime_c5, chime_g5)
        dry = mix_tracks(timp, brass_full * 0.90, chimes * 0.80)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-15.5)

# 12. Fantasiac II: Starlight Music Box (Glass Reeds & Celestial Harmonica)
def generate_fantasy_musicbox(style='ps5'):
    box_modes = [(1.0, 1.0, 3.2), (3.0, 0.45, 5.0), (6.1, 0.20, 8.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=8000, pre_delay_ms=6, seed=1201)
        n1 = synth_modal_bar(1318.51, duration_s=0.8, modes=box_modes, decay_mult=1.0)
        n2 = synth_modal_bar(1661.22, duration_s=0.75, modes=box_modes, decay_mult=0.95) * 0.8
        n3 = synth_modal_bar(1975.53, duration_s=0.70, modes=box_modes, decay_mult=0.90) * 0.75
        p = np.zeros((int(dur * SR), 2))
        p[:len(n1)] += n1
        p[int(0.03*SR):int(0.03*SR)+len(n2)] += n2
        p[int(0.06*SR):int(0.06*SR)+len(n3)] += n3
        t_tick = np.linspace(0, 0.008, int(0.008*SR))
        tick = np.repeat((np.exp(-400.0 * t_tick))[:, None], 2, axis=1) * 0.3
        dry = mix_tracks(p * 0.85, tick)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.24, width=1.15, dry_level=0.80), target_duration=dur, target_rms_db=-16.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=7800, pre_delay_ms=10, seed=1202)
        notes = [987.77, 1318.51, 1661.22, 1975.53, 2637.02]
        layers = []
        for i, f in enumerate(notes):
            sig = synth_modal_bar(f, duration_s=1.1 - i*0.03, modes=box_modes, decay_mult=1.2)
            padded = np.zeros((int(dur * SR), 2))
            st = int(i * 0.035 * SR)
            padded[st:st + len(sig)] = sig[:min(len(sig), len(padded) - st)] * 0.65
            layers.append(padded)
        t_harm = np.linspace(0, 1.2, int(1.2 * SR))
        aura = np.sin(2 * np.pi * 659.25 * t_harm) * np.sin(np.pi * (t_harm / 1.2)) * 0.25
        aura_stereo = np.repeat(aura[:, None], 2, axis=1)
        dry = mix_tracks(mix_tracks(*layers), aura_stereo)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.32, width=1.45, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=8000, pre_delay_ms=14, seed=1203)
        lullaby = [987.77, 1318.51, 1661.22, 1975.53, 2217.46, 2637.02, 3322.44, 3951.07]
        layers = []
        for i, f in enumerate(lullaby):
            delay_s = i * 0.028
            sig = synth_modal_bar(f, duration_s=1.8 - delay_s, modes=box_modes, decay_mult=1.4)
            pan = -0.5 + 1.0 * (i / (len(lullaby) - 1))
            panned = np.zeros_like(sig)
            panned[:, 0] = sig[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = sig[:, 1] * (1.0 + pan) * 0.5
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(panned)] = panned[:min(len(panned), len(padded) - st)] * 0.60
            layers.append(padded)
        main_bell = synth_modal_bar(659.25, duration_s=1.8, modes=box_modes, decay_mult=1.5) * 0.7
        dry = mix_tracks(mix_tracks(*layers), main_bell)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 13. Guitar II: 12-String Resonance (Double-Course Flageolets & Spanish Resonance)
def generate_guitar_12string(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6800, pre_delay_ms=6, seed=1301)
        # Double-course 12th-fret pair (E5 + E6)
        h1 = synth_karplus_strong(659.25, duration_s=0.85, pick_pos=0.12, hardness=0.92, decay_time=1.2)
        h2 = synth_karplus_strong(1318.51, duration_s=0.80, pick_pos=0.11, hardness=0.94, decay_time=1.1) * 0.75
        dry = mix_tracks(h1 * 0.8, h2)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.15, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.35, tone_hz=6500, pre_delay_ms=8, seed=1302)
        # Cascading double-course harmonics: E4+E5, B4+B4, G#5+G#6
        c1_low = synth_karplus_strong(329.63, duration_s=1.2, pick_pos=0.13, hardness=0.90, decay_time=1.4)
        c1_hi = synth_karplus_strong(659.25, duration_s=1.2, pick_pos=0.12, hardness=0.92, decay_time=1.3) * 0.85
        c2_low = synth_karplus_strong(493.88, duration_s=1.1, pick_pos=0.12, hardness=0.92, decay_time=1.3)
        c2_hi = synth_karplus_strong(987.77, duration_s=1.1, pick_pos=0.11, hardness=0.93, decay_time=1.2) * 0.80
        c3_hi = synth_karplus_strong(1661.22, duration_s=1.0, pick_pos=0.10, hardness=0.95, decay_time=1.1) * 0.70
        flourish = np.zeros((int(dur * SR), 2))
        flourish[:len(c1_low)] += (c1_low + c1_hi) * 0.5
        t_d1 = int(0.04 * SR)
        flourish[t_d1:t_d1 + len(c2_low)] += (c2_low + c2_hi) * 0.45
        t_d2 = int(0.08 * SR)
        flourish[t_d2:t_d2 + len(c3_hi)] += c3_hi * 0.4
        body = filt(flourish, "bandpass", [170, 480], order=2) * 0.4
        dry = mix_tracks(flourish * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.40, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.10
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=6400, pre_delay_ms=10, seed=1303)
        # Spanish rasgueado flourish into singing high flageolets
        t_brush = np.linspace(0, 0.05, int(0.05 * SR))
        rng = np.random.default_rng(1303)
        brush = filt(rng.standard_normal(len(t_brush))[:, None] * np.exp(-60.0 * t_brush)[:, None], "bandpass", [800, 3500]) * 0.5
        pairs = [
            (0.00, 329.63, 659.25),
            (0.035, 493.88, 987.77),
            (0.070, 659.25, 1318.51),
            (0.105, 830.61, 1661.22),
            (0.140, 987.77, 1975.53)
        ]
        p_layers = []
        for st_s, f_low, f_hi in pairs:
            s_low = synth_karplus_strong(f_low, duration_s=1.7 - st_s, pick_pos=0.13, hardness=0.90, decay_time=1.6)
            s_hi = synth_karplus_strong(f_hi, duration_s=1.7 - st_s, pick_pos=0.11, hardness=0.93, decay_time=1.4) * 0.85
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            pair_mix = mix_tracks(s_low * 0.5, s_hi * 0.5)
            p[st:st + len(pair_mix)] = pair_mix[:min(len(pair_mix), len(p) - st)]
            p_layers.append(p)
        full_plucks = mix_tracks(*p_layers)
        body = filt(full_plucks, "bandpass", [150, 480], order=2) * 0.45
        dry = mix_tracks(full_plucks * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 14. Harp II: Bardic High Flourish (Gaelic Wire Harp & Soaring Pentatonic)
def generate_harp_bardic(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=7200, pre_delay_ms=6, seed=1401)
        # 4-note wire harp snap in D Pentatonic (A5, B5, D6, F#6)
        notes = [880.00, 987.77, 1174.66, 1479.98]
        p = np.zeros((int(dur * SR), 2))
        for i, f in enumerate(notes):
            sig = synth_karplus_strong(f, duration_s=0.8 - i*0.02, pick_pos=0.16, hardness=0.90, decay_time=1.1)
            st = int(i * 0.02 * SR)
            p[st:st + len(sig)] += sig * 0.5
        dry = p
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.15, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=7000, pre_delay_ms=10, seed=1402)
        # Cascading Celtic Pentatonic sweep (D4, E4, F#4, A4, B4, D5, F#5)
        pent = [293.66, 329.63, 369.99, 440.00, 493.88, 587.33, 739.99]
        layers = []
        for i, f in enumerate(pent):
            delay_s = i * 0.022
            sig = synth_karplus_strong(f, duration_s=1.2 - delay_s, pick_pos=0.16, hardness=0.90, decay_time=1.3)
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(sig)] = sig[:min(len(sig), len(padded) - st)] * 0.55
            layers.append(padded)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.45, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=7000, pre_delay_ms=12, seed=1403)
        full_gaelic = [146.83, 220.00, 293.66, 369.99, 440.00, 493.88, 587.33, 739.99, 880.00, 1174.66, 1479.98]
        layers = []
        for i, f in enumerate(full_gaelic):
            delay_s = i * 0.020
            sig = synth_karplus_strong(f, duration_s=1.8 - delay_s, pick_pos=0.15, hardness=0.91, decay_time=1.5)
            pan = -0.6 + 1.2 * (i / (len(full_gaelic) - 1))
            panned = np.zeros_like(sig)
            panned[:, 0] = sig[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = sig[:, 1] * (1.0 + pan) * 0.5
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(panned)] = panned[:min(len(panned), len(padded) - st)] * 0.55
            layers.append(padded)
        harp_mix = mix_tracks(*layers)
        soundboard = filt(harp_mix, "bandpass", [130, 420], order=2) * 0.35
        dry = mix_tracks(harp_mix * 0.85, soundboard)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 15. Afric Ancient II: Sacred Kora & Gourd (21-String West African Harp & Calabash)
def generate_afric_kora(style='ps5'):
    kora_modes = [(1.0, 1.0, 2.5), (3.1, 0.4, 5.0), (7.5, 0.15, 9.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6000, pre_delay_ms=8, seed=1501)
        k1 = synth_karplus_strong(349.23, duration_s=0.85, pick_pos=0.25, hardness=0.85, decay_time=1.0)
        k2 = synth_karplus_strong(523.25, duration_s=0.80, pick_pos=0.25, hardness=0.85, decay_time=0.9) * 0.8
        t_click = np.linspace(0, 0.015, int(0.015 * SR))
        click = np.repeat((np.exp(-220.0 * t_click))[:, None], 2, axis=1) * 0.4
        dry = mix_tracks(k1 * 0.7, k2 * 0.6, click)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.35, tone_hz=5800, pre_delay_ms=10, seed=1502)
        kora_notes = [261.63, 349.23, 392.00, 440.00, 523.25]
        layers = []
        for i, f in enumerate(kora_notes):
            sig = synth_karplus_strong(f, duration_s=1.2 - i*0.02, pick_pos=0.24, hardness=0.86, decay_time=1.2)
            padded = np.zeros((int(dur * SR), 2))
            st = int(i * 0.028 * SR)
            padded[st:st + len(sig)] = sig[:min(len(sig), len(padded) - st)] * 0.6
            layers.append(padded)
        t_udu = np.linspace(0, 0.6, int(0.6 * SR))
        udu = np.repeat((np.sin(2 * np.pi * 72.0 * t_udu) * np.exp(-7.0 * t_udu))[:, None], 2, axis=1) * 0.65
        dry = mix_tracks(mix_tracks(*layers), udu)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.38, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=5800, pre_delay_ms=12, seed=1503)
        griot_scale = [174.61, 261.63, 349.23, 392.00, 440.00, 523.25, 698.46, 783.99, 1046.50]
        layers = []
        for i, f in enumerate(griot_scale):
            delay_s = i * 0.025
            sig = synth_karplus_strong(f, duration_s=1.8 - delay_s, pick_pos=0.24, hardness=0.87, decay_time=1.4)
            pan = -0.5 + 1.0 * (i / (len(griot_scale) - 1))
            panned = np.zeros_like(sig)
            panned[:, 0] = sig[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = sig[:, 1] * (1.0 + pan) * 0.5
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(panned)] = panned[:min(len(panned), len(padded) - st)] * 0.6
            layers.append(padded)
        t_udu = np.linspace(0, 0.8, int(0.8 * SR))
        udu = np.repeat((np.sin(2 * np.pi * 72.0 * t_udu) * np.exp(-6.5 * t_udu))[:, None], 2, axis=1) * 0.70
        balafon = synth_modal_bar(349.23, duration_s=1.2, modes=kora_modes, attack_ms=6.0) * 0.5
        dry = mix_tracks(mix_tracks(*layers), udu, balafon)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.50, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 16. Space Galaxy (Cosmic Nebula & Pulsar Beacons)
def generate_space_galaxy(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=9000, pre_delay_ms=8, seed=1601)
        # Pulsar radio chirp (2400 Hz -> 3600 Hz in 0.08s) + sub-pulse
        t_ch = np.linspace(0, 0.12, int(0.12 * SR))
        chirp = np.sin(2 * np.pi * (2400.0 + 1200.0 * (t_ch/0.12)**2) * t_ch) * np.exp(-25.0 * t_ch)
        chirp_stereo = np.repeat(chirp[:, None], 2, axis=1) * 0.75
        t_sub = np.linspace(0, 0.8, int(0.8 * SR))
        sub = np.repeat((np.sin(2 * np.pi * 65.0 * t_sub) * np.exp(-6.0 * t_sub))[:, None], 2, axis=1) * 0.7
        fm = synth_fm_crystal(fc=1200.0, fm=1800.0, duration_s=0.8, mod_index_max=2.5, decay_exp=4.5) * 0.7
        dry = mix_tracks(chirp_stereo, sub, fm)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.25, width=1.20, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.5, tone_hz=8500, pre_delay_ms=12, seed=1602)
        # Cosmic nebula riser (0.3s) into stardust crystal chord
        t_riser = np.linspace(0, 0.35, int(0.35 * SR))
        riser_osc = np.sin(2 * np.pi * (800.0 + 2400.0 * (t_riser/0.35)**2) * t_riser) * (t_riser / 0.35)**2
        riser_stereo = np.repeat(riser_osc[:, None], 2, axis=1) * 0.4
        t_sub = np.linspace(0, 1.2, int(1.2 * SR))
        sub = np.repeat((np.sin(2 * np.pi * 55.0 * t_sub) * np.exp(-4.5 * t_sub))[:, None], 2, axis=1) * 0.75
        fm1 = synth_fm_crystal(fc=987.77, fm=1481.65, duration_s=1.2, mod_index_max=3.0, decay_exp=3.5)
        fm2 = synth_fm_crystal(fc=1479.98, fm=2219.97, duration_s=1.1, mod_index_max=2.2, decay_exp=3.8) * 0.6
        aligned_crystals = np.zeros((int(dur * SR), 2))
        n_st = int(0.08 * SR)
        crystal_mix = mix_tracks(fm1, fm2)
        aligned_crystals[n_st:n_st + len(crystal_mix)] = crystal_mix[:min(len(crystal_mix), len(aligned_crystals) - n_st)]
        dry = mix_tracks(riser_stereo, sub, aligned_crystals * 0.85)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.32, width=1.50, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.3, tone_hz=8500, pre_delay_ms=16, seed=1603)
        # Deep space voyage: Dark matter sub-swell -> pulsar activation -> supernova stardust
        t_sub = np.linspace(0, 2.0, int(2.0 * SR))
        sub = np.repeat((np.sin(2 * np.pi * 48.0 * t_sub) * np.exp(-3.5 * t_sub))[:, None], 2, axis=1) * 0.85
        t_p = np.linspace(0, 0.4, int(0.4 * SR))
        pulsar = np.sin(2 * np.pi * 3200.0 * t_p) * np.sin(2 * np.pi * 24.0 * t_p) * np.exp(-8.0 * t_p)
        pulsar_stereo = np.repeat(pulsar[:, None], 2, axis=1) * 0.5
        c_notes = [987.77, 1234.71, 1479.98, 1975.53, 2959.96]
        layers = []
        for i, f in enumerate(c_notes):
            sig = synth_fm_crystal(fc=f, fm=f*1.5, duration_s=1.7 - i*0.05, mod_index_max=2.8, decay_exp=3.0)
            p = np.zeros((int(dur * SR), 2))
            st = int((0.10 + i * 0.03) * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        stardust_chord = mix_tracks(*layers)
        dry = mix_tracks(sub, pulsar_stereo, stardust_chord * 0.85)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.65, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 17. Robotic I: Cyber Droid (Light Companion Droid)
def generate_robotic_droid(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.75, tone_hz=7500, pre_delay_ms=6, seed=1701)
        # Double servo snap + digital logic chirp
        s1 = synth_servo_motor(0.06, 600.0, 1800.0) * 0.7
        t_ch = np.linspace(0, 0.1, int(0.1 * SR))
        chirp = np.sin(2 * np.pi * 1400.0 * t_ch) * np.exp(-30.0 * t_ch)
        chirp_s = np.repeat(chirp[:, None], 2, axis=1) * 0.7
        bell = synth_fm_crystal(fc=1200.0, fm=1800.0, duration_s=0.75, mod_index_max=2.2, decay_exp=5.0) * 0.8
        dry = mix_tracks(s1, chirp_s, bell)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=7500, pre_delay_ms=8, seed=1702)
        # Servo whir swell into cheerful 3-tone vocoder confirmation
        servo = synth_servo_motor(0.18, 400.0, 1600.0) * 0.65
        triad = [880.0, 1108.7, 1320.0]
        tones = []
        for i, f in enumerate(triad):
            t_sig = synth_fm_crystal(fc=f, fm=f*2.0, duration_s=1.0, mod_index_max=2.4, decay_exp=4.0)
            p = np.zeros((int(dur * SR), 2))
            st = int((0.08 + i * 0.04) * SR)
            p[st:st + len(t_sig)] = t_sig[:min(len(t_sig), len(p) - st)] * 0.6
            tones.append(p)
        dry = mix_tracks(servo, *tones)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.15
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=7500, pre_delay_ms=10, seed=1703)
        # Power-on sequence: diagnostics blips -> servo calibration -> triumphant boot chime
        blips = []
        for i in range(4):
            t_b = np.linspace(0, 0.04, int(0.04 * SR))
            fb = 1200.0 + i * 300.0
            sig_b = np.sin(2 * np.pi * fb * t_b) * np.exp(-40.0 * t_b)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.045 * SR)
            p[st:st + len(sig_b)] = np.repeat(sig_b[:, None], 2, axis=1) * 0.5
            blips.append(p)
        servo = np.zeros((int(dur * SR), 2))
        s_raw = synth_servo_motor(0.25, 500.0, 2200.0) * 0.7
        servo[int(0.18*SR):int(0.18*SR)+len(s_raw)] = s_raw
        chime_notes = [880.0, 1108.7, 1320.0, 1760.0]
        chimes = []
        for i, f in enumerate(chime_notes):
            c_sig = synth_fm_crystal(fc=f, fm=f*2.0, duration_s=1.6 - i*0.1, mod_index_max=2.8, decay_exp=3.2)
            p = np.zeros((int(dur * SR), 2))
            st = int((0.26 + i * 0.035) * SR)
            p[st:st + len(c_sig)] = c_sig[:min(len(c_sig), len(p) - st)] * 0.6
            chimes.append(p)
        dry = mix_tracks(mix_tracks(*blips), servo, mix_tracks(*chimes))
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 18. Robotic II: Quantum AI Core (Neural Supercomputer)
def generate_robotic_quantum(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=8500, pre_delay_ms=6, seed=1801)
        # Sharp laser optic tick + quantum calculation frequency strike
        t_l = np.linspace(0, 0.02, int(0.02 * SR))
        laser = np.sin(2 * np.pi * (3800.0 - 2400.0 * (t_l/0.02)) * t_l) * np.exp(-150.0 * t_l)
        laser_s = np.repeat(laser[:, None], 2, axis=1) * 0.8
        q_sine = synth_fm_crystal(fc=1056.0, fm=1584.0, duration_s=0.85, mod_index_max=2.5, decay_exp=4.2)
        dry = mix_tracks(laser_s, q_sine)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.15, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=8500, pre_delay_ms=8, seed=1802)
        # Quantum phase-shift swell blooming into pristine holographic sine chord (528, 792, 1056 Hz)
        t_phase = np.linspace(0, 0.25, int(0.25 * SR))
        sw = np.sin(2 * np.pi * 528.0 * t_phase + 3.0 * np.sin(2 * np.pi * 16.0 * t_phase)) * (t_phase / 0.25)
        sw_s = np.repeat(sw[:, None], 2, axis=1) * 0.4
        c1 = synth_fm_crystal(fc=528.0, fm=792.0, duration_s=1.2, mod_index_max=2.2, decay_exp=3.2)
        c2 = synth_fm_crystal(fc=792.0, fm=1188.0, duration_s=1.1, mod_index_max=2.0, decay_exp=3.4) * 0.8
        c3 = synth_fm_crystal(fc=1056.0, fm=1584.0, duration_s=1.0, mod_index_max=1.8, decay_exp=3.6) * 0.7
        aligned_chord = np.zeros((int(dur * SR), 2))
        st = int(0.06 * SR)
        chord_mix = mix_tracks(c1, c2, c3)
        aligned_chord[st:st + len(chord_mix)] = chord_mix[:min(len(chord_mix), len(aligned_chord) - st)]
        dry = mix_tracks(sw_s, aligned_chord * 0.85)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.45, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=8500, pre_delay_ms=12, seed=1803)
        # Singularity activation: matrix pulse -> super-position sweep -> transcendent crystalline epiphany
        t_pulse = np.linspace(0, 0.15, int(0.15 * SR))
        pulse = np.sin(2 * np.pi * (1600.0 + 3200.0 * (t_pulse/0.15)**2) * t_pulse) * (t_pulse / 0.15)**2
        pulse_s = np.repeat(pulse[:, None], 2, axis=1) * 0.5
        q_freqs = [528.0, 792.0, 1056.0, 1320.0, 1584.0, 2112.0]
        layers = []
        for i, f in enumerate(q_freqs):
            sig = synth_fm_crystal(fc=f, fm=f*1.5, duration_s=1.8 - i*0.05, mod_index_max=2.5, decay_exp=3.0)
            p = np.zeros((int(dur * SR), 2))
            st = int((0.08 + i * 0.025) * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(pulse_s, mix_tracks(*layers) * 0.85)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 19. Robotic III: Heavy Industrial Mech (Titan Combat Mech)
def generate_robotic_mech(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.75, tone_hz=5000, pre_delay_ms=6, seed=1901)
        # Heavy hydraulic clamp impact + metallic reactor click
        t_sub = np.linspace(0, dur, int(dur * SR))
        sub = np.repeat((np.sin(2 * np.pi * (180.0 * np.exp(-22.0 * t_sub) + 50.0) * t_sub) * np.exp(-7.0 * t_sub))[:, None], 2, axis=1) * 0.85
        t_cl = np.linspace(0, 0.025, int(0.025 * SR))
        rng = np.random.default_rng(1901)
        clamp = filt(rng.standard_normal(len(t_cl))[:, None] * np.exp(-140.0 * t_cl)[:, None], "bandpass", [1500, 5500]) * 0.85
        dry = mix_tracks(sub, clamp)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.00, dry_level=0.82), target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.35, tone_hz=4800, pre_delay_ms=8, seed=1902)
        # Pneumatic pressure release hiss building into heavy mech footfall thud and energizing power core chime
        t_hiss = np.linspace(0, 0.12, int(0.12 * SR))
        rng = np.random.default_rng(1902)
        hiss = filt(rng.standard_normal(len(t_hiss))[:, None] * ((t_hiss / 0.12)[:, None])**2, "bandpass", [2000, 7000]) * 0.45
        t_hit = 0.08
        n_hit = int(t_hit * SR)
        t_sub = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        sub_sig = np.sin(2 * np.pi * (160.0 * np.exp(-16.0 * t_sub) + 48.0) * t_sub) * np.exp(-5.5 * t_sub)
        sub = np.zeros((int(dur * SR), 2))
        sub[n_hit:n_hit + len(sub_sig)] = np.repeat(sub_sig[:, None], 2, axis=1) * 0.85
        core_chime = synth_modal_bar(220.0, duration_s=1.1, modes=[(1.0, 1.0, 3.0), (2.8, 0.5, 5.0), (5.2, 0.25, 7.0)], decay_mult=1.1) * 0.65
        dry = mix_tracks(hiss, sub, core_chime)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.30, dry_level=0.78), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.25
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=4800, pre_delay_ms=12, seed=1903)
        # Titan system reboot: massive hydraulic purge -> titanium joint lock -> roaring fusion power surge
        t_purge = np.linspace(0, 0.16, int(0.16 * SR))
        rng = np.random.default_rng(1903)
        purge = filt(rng.standard_normal(len(t_purge))[:, None] * ((t_purge / 0.16)[:, None])**2, "bandpass", [1800, 8000]) * 0.5
        t_hit = 0.10
        n_hit = int(t_hit * SR)
        t_sub = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        sub_sig = np.sin(2 * np.pi * (140.0 * np.exp(-14.0 * t_sub) + 42.0) * t_sub) * np.exp(-4.5 * t_sub)
        sub = np.zeros((int(dur * SR), 2))
        sub[n_hit:n_hit + len(sub_sig)] = np.repeat(sub_sig[:, None], 2, axis=1) * 0.90
        core1 = synth_modal_bar(110.0, duration_s=1.8, modes=[(1.0, 1.0, 2.5), (2.7, 0.6, 4.0)], decay_mult=1.4)
        core2 = synth_modal_bar(220.0, duration_s=1.7, modes=[(1.0, 1.0, 3.0), (2.8, 0.5, 5.0)], decay_mult=1.3) * 0.8
        core3 = synth_modal_bar(440.0, duration_s=1.5, modes=[(1.0, 1.0, 3.5), (3.0, 0.4, 6.0)], decay_mult=1.2) * 0.6
        dry = mix_tracks(purge, sub, core1 * 0.7, core2 * 0.65, core3 * 0.5)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.50, dry_level=0.75), target_duration=dur, target_rms_db=-15.5)

# 20. Retro 8-Bit Gaming (NES 2A03 Chiptune)
def generate_retro_8bit(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Iconic 8-bit Coin / 1-Up rapid rising arpeggio (C5 -> E5 -> G5 -> C6 in 0.12s)
        arp = synth_8bit_fast_arp([523.25, 659.25, 783.99, 1046.50], duration_s=0.85, speed_hz=50.0, duty=0.25)
        blip = synth_8bit_noise(0.04, period=16) * 0.4
        dry = mix_tracks(arp * 0.85, blip)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # 8-bit Stage Clear Victory Fanfare (dual-square harmony in thirds, walking triangle bassline, noise snare)
        melody_notes = [(0.0, 523.25), (0.08, 659.25), (0.16, 783.99), (0.24, 1046.50)]
        lead_layers = []
        for st_s, f in melody_notes:
            sig = synth_8bit_pulse(f, duration_s=0.9 - st_s, duty=0.5)
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            lead_layers.append(p)
        lead = mix_tracks(*lead_layers)
        bass = synth_8bit_triangle(130.81, duration_s=1.1) * 0.65
        snare = synth_8bit_noise(0.08, period=24) * 0.4
        dry = mix_tracks(lead, bass, snare)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Grand 8-bit Boss Defeated / World Saved Fanfare!
        fanfare = [
            (0.00, 523.25), (0.07, 659.25), (0.14, 783.99),
            (0.21, 1046.50), (0.28, 1318.51), (0.35, 1567.98), (0.42, 2093.00)
        ]
        lead_layers = []
        for st_s, f in fanfare:
            sig = synth_8bit_pulse(f, duration_s=1.6 - st_s, duty=0.25)
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.50
            lead_layers.append(p)
        lead = mix_tracks(*lead_layers)
        harm = synth_8bit_fast_arp([1046.50, 1318.51, 1567.98, 2093.00], duration_s=1.6, speed_hz=60.0, duty=0.125) * 0.45
        aligned_harm = np.zeros((int(dur * SR), 2))
        aligned_harm[int(0.42*SR):int(0.42*SR)+len(harm)] = harm[:min(len(harm), len(aligned_harm)-int(0.42*SR))]
        bass = synth_8bit_triangle(130.81, duration_s=1.8) * 0.70
        snare = synth_8bit_noise(0.12, period=32) * 0.5
        dry = mix_tracks(lead, aligned_harm, bass, snare)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 21. Retro 16-Bit Classic Gaming (SNES / Genesis FM RPG Victory)
def generate_retro_16bit(style='ps5'):
    bell_modes = [(1.0, 1.0, 3.0), (2.0, 0.5, 4.0), (3.0, 0.3, 5.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.75, tone_hz=6500, pre_delay_ms=8, seed=2101)
        # Crisp 16-bit Item Found / Quest Clear FM brass & bell chime
        horn = synth_16bit_fm_horn(523.25, duration_s=0.8, attack_ms=18.0) * 0.75
        bell = synth_modal_bar(1046.50, duration_s=0.8, modes=bell_modes, decay_mult=0.9) * 0.75
        dry = mix_tracks(horn, bell)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.18, width=1.10, dry_level=0.84), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=6200, pre_delay_ms=10, seed=2102)
        # 16-bit RPG Victory Fanfare (triad FM horns + marimba chime)
        h1 = synth_16bit_fm_horn(392.00, duration_s=1.1, attack_ms=25.0) * 0.7
        h2 = synth_16bit_fm_horn(523.25, duration_s=1.1, attack_ms=25.0) * 0.8
        h3 = synth_16bit_fm_horn(659.25, duration_s=1.0, attack_ms=25.0) * 0.75
        horns = mix_tracks(h1, h2, h3)
        bell_notes = [783.99, 1046.50, 1318.51]
        b_layers = []
        for i, f in enumerate(bell_notes):
            sig = synth_modal_bar(f, duration_s=1.0 - i*0.03, modes=bell_modes, decay_mult=1.1)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.035 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            b_layers.append(p)
        dry = mix_tracks(horns * 0.85, mix_tracks(*b_layers))
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.26, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=6200, pre_delay_ms=12, seed=2103)
        # Legendary 16-bit Royal Crystal Theme / Ending Credits Fanfare!
        fanfare = [
            (0.00, 261.63, 1.8), (0.06, 392.00, 1.7), (0.12, 523.25, 1.8),
            (0.18, 659.25, 1.7), (0.24, 783.99, 1.6), (0.30, 1046.50, 1.5)
        ]
        h_layers = []
        for st_s, f, d_n in fanfare:
            sig = synth_16bit_fm_horn(f, duration_s=d_n, attack_ms=22.0)
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.60
            h_layers.append(p)
        horns = mix_tracks(*h_layers)
        crystal_gliss = [1046.50, 1318.51, 1567.98, 2093.00]
        c_layers = []
        for i, f in enumerate(crystal_gliss):
            sig = synth_modal_bar(f, duration_s=1.5 - i*0.04, modes=bell_modes, decay_mult=1.3)
            p = np.zeros((int(dur * SR), 2))
            st = int((0.30 + i * 0.035) * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            c_layers.append(p)
        crystals = mix_tracks(*c_layers)
        dry = mix_tracks(horns * 0.85, crystals)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.34, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)


# ---------------------------------------------------------------------------
# The 10 8-Bit Bell & Gong Instrument Variations (NES 2A03 Chiptune)
# ---------------------------------------------------------------------------

# 22. 8-Bit China Bells (Bianzhong Pentatonic Chimes)
def generate_8bit_china(style='ps5'):
    p_notes = [392.00, 440.00, 523.25, 587.33, 659.25, 783.99] # G4, A4, C5, D5, E5, G5
    if style == 'ps4':
        dur = 0.95
        # Crisp 3-note ascending 8-bit pentatonic chime (G4 -> C5 -> D5) with noise strike
        arp = synth_8bit_fast_arp([392.00, 523.25, 587.33], duration_s=0.85, speed_hz=40.0, duty=0.25)
        click = synth_8bit_noise(0.025, period=16) * 0.4
        dry = mix_tracks(arp * 0.85, click)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # 5-note pentatonic bloom with walking triangle bass and dual-pulse square harmony
        layers = []
        for i, f in enumerate(p_notes[:5]):
            sig = synth_8bit_pulse(f, duration_s=1.0 - i*0.03, duty=0.25)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.04 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        lead = mix_tracks(*layers)
        bass = synth_8bit_triangle(130.81, duration_s=1.1) * 0.65
        dry = mix_tracks(lead, bass)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Imperial Chinese royal chiptune fanfare across 2 octaves
        full_scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 1046.50]
        layers = []
        for i, f in enumerate(full_scale):
            sig = synth_8bit_pulse(f, duration_s=1.6 - i*0.04, duty=0.25)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.035 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.50
            layers.append(p)
        arp = synth_8bit_fast_arp([523.25, 659.25, 783.99, 1046.50], duration_s=1.5, speed_hz=55.0, duty=0.125) * 0.45
        aligned_arp = np.zeros((int(dur * SR), 2))
        st_arp = int(0.35 * SR)
        aligned_arp[st_arp:st_arp + len(arp)] = arp[:min(len(arp), len(aligned_arp) - st_arp)]
        bass = synth_8bit_triangle(130.81, duration_s=1.8) * 0.70
        snare = synth_8bit_noise(0.10, period=28) * 0.45
        dry = mix_tracks(mix_tracks(*layers), aligned_arp, bass, snare)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 23. 8-Bit Cathedral Church Bell
def generate_8bit_church(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Deep triangle toll on 130Hz + pulse strike on 261Hz
        bass = synth_8bit_triangle(130.81, duration_s=0.85) * 0.8
        pulse = synth_8bit_pulse(261.63, duration_s=0.80, duty=0.5) * 0.6
        dry = mix_tracks(bass, pulse)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # Solemn 2-bell chiptune toll (C3 + G3) with Gothic pulse sustain
        b1 = synth_8bit_triangle(130.81, duration_s=1.2) * 0.75
        b2 = synth_8bit_triangle(196.00, duration_s=1.1) * 0.65
        p1 = synth_8bit_pulse(261.63, duration_s=1.1, duty=0.5) * 0.55
        p2 = synth_8bit_pulse(392.00, duration_s=1.0, duty=0.5) * 0.45
        dry = mix_tracks(b1, b2, p1, p2)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Grand Castlevania-style Gothic cathedral carillon fanfare
        chords = [
            (0.00, 130.81, 261.63),
            (0.12, 196.00, 392.00),
            (0.24, 261.63, 523.25),
            (0.36, 329.63, 659.25),
            (0.48, 392.00, 783.99),
        ]
        layers = []
        for st_s, f_tri, f_pulse in chords:
            tri = synth_8bit_triangle(f_tri, duration_s=1.6 - st_s) * 0.7
            pul = synth_8bit_pulse(f_pulse, duration_s=1.6 - st_s, duty=0.5) * 0.55
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            mix_toll = mix_tracks(tri, pul)
            p[st:st + len(mix_toll)] = mix_toll[:min(len(mix_toll), len(p) - st)]
            layers.append(p)
        timp = synth_8bit_noise(0.12, period=32) * 0.55
        dry = mix_tracks(mix_tracks(*layers), timp)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 24. 8-Bit Temple Gong & Tam-Tam
def generate_8bit_gong(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Punchy chiptune gong strike: low triangle pitch drop (130 -> 65Hz) + metallic noise burst
        t_tri = np.linspace(0, dur, int(dur * SR))
        f_drop = 130.0 * np.exp(-12.0 * t_tri) + 65.0
        tri_sig = 2.0 * np.abs(2.0 * ((np.cumsum(f_drop)/SR) % 1.0 - 0.5)) - 1.0
        tri = np.repeat((tri_sig * np.exp(-5.5 * t_tri))[:, None], 2, axis=1) * 0.8
        crash = synth_8bit_noise(0.15, period=24) * 0.6
        dry = mix_tracks(tri, crash)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # Resonant temple gong swell: blooming metallic noise shimmer into warm triangle undertone
        t_tri = np.linspace(0, dur, int(dur * SR))
        f_drop = 110.0 * np.exp(-8.0 * t_tri) + 55.0
        tri_sig = 2.0 * np.abs(2.0 * ((np.cumsum(f_drop)/SR) % 1.0 - 0.5)) - 1.0
        tri = np.repeat((tri_sig * np.exp(-4.2 * t_tri))[:, None], 2, axis=1) * 0.85
        crash = synth_8bit_noise(0.35, period=20) * 0.55
        square_shimmer = synth_8bit_pulse(110.0, duration_s=1.2, duty=0.125) * 0.35
        dry = mix_tracks(tri, crash, square_shimmer)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Colossal 8-bit boss-battle tam-tam gong: deep seismic sweep + shimmering wash
        t_tri = np.linspace(0, dur, int(dur * SR))
        f_drop = 140.0 * np.exp(-6.0 * t_tri) + 48.0
        tri_sig = 2.0 * np.abs(2.0 * ((np.cumsum(f_drop)/SR) % 1.0 - 0.5)) - 1.0
        tri = np.repeat((tri_sig * np.exp(-3.5 * t_tri))[:, None], 2, axis=1) * 0.90
        crash1 = synth_8bit_noise(0.45, period=16) * 0.60
        crash2 = synth_8bit_noise(0.60, period=28) * 0.40
        sq1 = synth_8bit_pulse(96.0, duration_s=1.8, duty=0.125) * 0.35
        sq2 = synth_8bit_pulse(144.0, duration_s=1.7, duty=0.25) * 0.30
        dry = mix_tracks(tri, crash1, crash2, sq1, sq2)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 25. 8-Bit Tibetan Tingsha Chimes
def generate_8bit_tingsha(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # High crystalline 2A03 ping at 2637Hz (12.5% duty)
        p1 = synth_8bit_pulse(2637.02, duration_s=0.85, duty=0.125) * 0.75
        p2 = synth_8bit_pulse(2644.00, duration_s=0.85, duty=0.125) * 0.70 # binaural beating
        dry = mix_tracks(p1, p2)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        # Dual-tingsha strike with gentle 6Hz beating and floating triangle base
        p1 = synth_8bit_pulse(2637.02, duration_s=1.2, duty=0.125) * 0.70
        p2 = synth_8bit_pulse(2643.00, duration_s=1.2, duty=0.125) * 0.65
        p3 = synth_8bit_pulse(3951.07, duration_s=1.0, duty=0.125) * 0.40
        tri = synth_8bit_triangle(659.25, duration_s=1.1) * 0.35
        dry = mix_tracks(p1, p2, p3, tri)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        # Celestial chiptune meditation bell cascade
        tones = [1975.53, 2637.02, 3135.96, 3951.07, 5274.04]
        layers = []
        for i, f in enumerate(tones):
            sig1 = synth_8bit_pulse(f, duration_s=1.8 - i*0.05, duty=0.125) * 0.55
            sig2 = synth_8bit_pulse(f + 5.0, duration_s=1.8 - i*0.05, duty=0.125) * 0.50
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.04 * SR)
            t_mix = mix_tracks(sig1, sig2)
            p[st:st + len(t_mix)] = t_mix[:min(len(t_mix), len(p) - st)]
            layers.append(p)
        tri = synth_8bit_triangle(329.63, duration_s=1.8) * 0.40
        dry = mix_tracks(mix_tracks(*layers), tri)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)

# 26. 8-Bit Indonesian Gamelan
def generate_8bit_gamelan(style='ps5'):
    slendro = [261.63, 293.66, 349.23, 392.00, 466.16, 523.25] # C, D, F, G, Bb, C
    if style == 'ps4':
        dur = 0.95
        # Snappy 8-bit bronze pot strike with wooden mallet transient
        p1 = synth_8bit_pulse(349.23, duration_s=0.80, duty=0.5) * 0.75
        p2 = synth_8bit_pulse(523.25, duration_s=0.75, duty=0.25) * 0.65
        click = synth_8bit_noise(0.02, period=18) * 0.45
        dry = mix_tracks(p1, p2, click)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # Interlocking Slendro chiptune run with resonant percussive decay
        layers = []
        for i, f in enumerate(slendro[:5]):
            sig = synth_8bit_pulse(f, duration_s=1.0 - i*0.03, duty=0.5)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.035 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.6
            layers.append(p)
        bass = synth_8bit_triangle(130.81, duration_s=1.1) * 0.6
        dry = mix_tracks(mix_tracks(*layers), bass)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Celebratory Gamelan royal festival fanfare: rapid interlocking polyrhythms
        full_slendro = [130.81, 174.61, 261.63, 293.66, 349.23, 392.00, 466.16, 523.25, 587.33, 698.46]
        layers = []
        for i, f in enumerate(full_slendro):
            sig = synth_8bit_pulse(f, duration_s=1.6 - i*0.03, duty=0.25)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.032 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        arp = synth_8bit_fast_arp([349.23, 466.16, 523.25, 698.46], duration_s=1.5, speed_hz=50.0, duty=0.5) * 0.45
        aligned_arp = np.zeros((int(dur * SR), 2))
        st_arp = int(0.32 * SR)
        aligned_arp[st_arp:st_arp + len(arp)] = arp[:min(len(arp), len(aligned_arp) - st_arp)]
        bass = synth_8bit_triangle(130.81, duration_s=1.8) * 0.70
        snare = synth_8bit_noise(0.08, period=24) * 0.40
        dry = mix_tracks(mix_tracks(*layers), aligned_arp, bass, snare)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 27. 8-Bit Tubular Orchestral Bells
def generate_8bit_tubular(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Crisp 8-bit orchestral bell stab on C5 with octave overtone
        p1 = synth_8bit_pulse(523.25, duration_s=0.85, duty=0.5) * 0.75
        p2 = synth_8bit_pulse(1046.50, duration_s=0.80, duty=0.25) * 0.55
        p3 = synth_8bit_pulse(1567.98, duration_s=0.75, duty=0.125) * 0.35
        dry = mix_tracks(p1, p2, p3)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # Westminster-style chiptune bell melody (E5 -> C5 -> D5 -> G4)
        melody = [(0.0, 659.25), (0.08, 523.25), (0.16, 587.33), (0.24, 392.00)]
        layers = []
        for st_s, f in melody:
            sig = synth_8bit_pulse(f, duration_s=1.0 - st_s, duty=0.5)
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.6
            layers.append(p)
        bass = synth_8bit_triangle(196.00, duration_s=1.1) * 0.55
        dry = mix_tracks(mix_tracks(*layers), bass)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Triumphant symphonic chiptune victory carillon
        carillon = [
            (0.00, 523.25), (0.07, 659.25), (0.14, 783.99), (0.21, 1046.50),
            (0.28, 1318.51), (0.35, 1567.98), (0.42, 2093.00)
        ]
        layers = []
        for st_s, f in carillon:
            p1 = synth_8bit_pulse(f, duration_s=1.6 - st_s, duty=0.5) * 0.55
            p2 = synth_8bit_pulse(f * 2.0, duration_s=1.5 - st_s, duty=0.25) * 0.35
            mix_bell = mix_tracks(p1, p2)
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(mix_bell)] = mix_bell[:min(len(mix_bell), len(p) - st)]
            layers.append(p)
        bass = synth_8bit_triangle(130.81, duration_s=1.8) * 0.70
        snare = synth_8bit_noise(0.12, period=32) * 0.45
        dry = mix_tracks(mix_tracks(*layers), bass, snare)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 28. 8-Bit Steel Glockenspiel
def generate_8bit_glock(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Snappy 3-note glockenspiel flourish with bright 50% pulse sparkle
        notes = [1318.51, 1661.22, 1975.53] # E6, G#6, B6
        layers = []
        for i, f in enumerate(notes):
            sig = synth_8bit_pulse(f, duration_s=0.75 - i*0.02, duty=0.5)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.025 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.65
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        # Shimmering steel bell arpeggio with high harmonic sparkle
        scale = [987.77, 1318.51, 1661.22, 1975.53, 2637.02]
        layers = []
        for i, f in enumerate(scale):
            sig = synth_8bit_pulse(f, duration_s=1.1 - i*0.03, duty=0.5)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.03 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        # Fairy-tale retro victory fanfare with glockenspiel runs and bassline
        run = [987.77, 1318.51, 1661.22, 1975.53, 2637.02, 3322.44, 3951.07]
        layers = []
        for i, f in enumerate(run):
            sig = synth_8bit_pulse(f, duration_s=1.6 - i*0.03, duty=0.5)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.03 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.50
            layers.append(p)
        arp = synth_8bit_fast_arp([1975.53, 2637.02, 3322.44, 3951.07], duration_s=1.5, speed_hz=60.0, duty=0.25) * 0.4
        aligned_arp = np.zeros((int(dur * SR), 2))
        st_arp = int(0.24 * SR)
        aligned_arp[st_arp:st_arp + len(arp)] = arp[:min(len(arp), len(aligned_arp) - st_arp)]
        bass = synth_8bit_triangle(329.63, duration_s=1.8) * 0.60
        dry = mix_tracks(mix_tracks(*layers), aligned_arp, bass)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)

# 29. 8-Bit Glass & Metal Wind Chimes
def generate_8bit_windchimes(style='ps5'):
    cluster = [1760.00, 2093.00, 2637.02, 3135.96, 3520.00, 4186.01]
    if style == 'ps4':
        dur = 0.95
        # Quick 4-ping wind chime flutter
        layers = []
        for i, f in enumerate(cluster[:4]):
            sig = synth_8bit_pulse(f, duration_s=0.75 - i*0.02, duty=0.125)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.02 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.65
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)
    elif style == 'ps5':
        dur = 1.40
        # Cascading multi-pitch cluster with spatial stereo delay
        layers = []
        for i, f in enumerate(cluster):
            sig = synth_8bit_pulse(f, duration_s=1.1 - i*0.03, duty=0.125)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.025 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        # Enchanted wind chime storm: swirling celestial chiptune pings
        layers = []
        for i in range(12):
            f = cluster[i % len(cluster)] * (1.0 + (i // len(cluster)) * 0.25)
            sig = synth_8bit_pulse(f, duration_s=1.6 - i*0.03, duty=0.125)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.022 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.45
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)

# 30. 8-Bit Zen Rin Singing Gong
def generate_8bit_rin(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Pure 440Hz triangle strike with subtle high pulse ring
        tri = synth_8bit_triangle(440.0, duration_s=0.85) * 0.8
        pulse = synth_8bit_pulse(880.0, duration_s=0.80, duty=0.25) * 0.4
        dry = mix_tracks(tri, pulse)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        # Resonant Rin gong strike with singing 3Hz tremolo pulsation
        t_tri = np.linspace(0, dur, int(dur * SR))
        tri_sig = 2.0 * np.abs(2.0 * ((t_tri * 440.0) % 1.0 - 0.5)) - 1.0
        trem = 0.8 + 0.2 * np.sin(2 * np.pi * 3.5 * t_tri)
        tri = np.repeat((tri_sig * np.exp(-3.5 * t_tri) * trem)[:, None], 2, axis=1) * 0.8
        pulse = synth_8bit_pulse(880.0, duration_s=1.2, duty=0.25) * 0.4
        dry = mix_tracks(tri, pulse)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        # Deep meditative chiptune gong ceremony: resonant drone and celestial pulse
        t_tri = np.linspace(0, dur, int(dur * SR))
        tri_sig = 2.0 * np.abs(2.0 * ((t_tri * 220.0) % 1.0 - 0.5)) - 1.0
        trem = 0.85 + 0.15 * np.sin(2 * np.pi * 3.0 * t_tri)
        tri = np.repeat((tri_sig * np.exp(-2.8 * t_tri) * trem)[:, None], 2, axis=1) * 0.85
        p1 = synth_8bit_pulse(440.0, duration_s=1.8, duty=0.25) * 0.45
        p2 = synth_8bit_pulse(880.0, duration_s=1.7, duty=0.125) * 0.35
        p3 = synth_8bit_pulse(1320.0, duration_s=1.5, duty=0.125) * 0.25
        dry = mix_tracks(tri, p1, p2, p3)
        return master_sound(dry, target_duration=dur, target_rms_db=-16.0)

# 31. 8-Bit Nautical Ship's Bell
def generate_8bit_ship(style='ps5'):
    if style == 'ps4':
        dur = 0.95
        # Crisp single ship's bell strike with clapper click
        p1 = synth_8bit_pulse(1567.98, duration_s=0.85, duty=0.125) * 0.8
        click = synth_8bit_noise(0.015, period=16) * 0.5
        dry = mix_tracks(p1, click)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        # Classic naval double-strike ("ding-ding", 70ms apart)
        p1 = synth_8bit_pulse(1567.98, duration_s=1.1, duty=0.125) * 0.75
        p2 = synth_8bit_pulse(1567.98, duration_s=1.0, duty=0.125) * 0.75
        p = np.zeros((int(dur * SR), 2))
        p[:len(p1)] += p1
        st = int(0.075 * SR)
        p[st:st + len(p2)] += p2
        click = synth_8bit_noise(0.02, period=16) * 0.4
        dry = mix_tracks(p, click)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        # Royal maritime salute: four rhythmic double-strikes ringing out
        hits = [0.0, 0.075, 0.22, 0.295]
        layers = []
        for st_s in hits:
            sig = synth_8bit_pulse(1567.98, duration_s=1.6 - st_s, duty=0.125) * 0.65
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)]
            layers.append(p)
        overtone = synth_8bit_pulse(3135.96, duration_s=1.5, duty=0.125) * 0.40
        aligned_over = np.zeros((int(dur * SR), 2))
        st_o = int(0.295 * SR)
        aligned_over[st_o:st_o + len(overtone)] = overtone[:min(len(overtone), len(aligned_over) - st_o)]
        dry = mix_tracks(mix_tracks(*layers), aligned_over)
        return master_sound(dry, target_duration=dur, target_rms_db=-15.5)


# ---------------------------------------------------------------------------
# The 10 Non-8-Bit Acoustic Bell & Gong Instrument Variations (Physical Modal DSP)
# ---------------------------------------------------------------------------

# 32. Imperial Chinese Bianzhong (Acoustic)
def generate_bell_china(style='ps5'):
    bian_modes = [(1.0, 1.0, 2.4), (1.19, 0.75, 3.2), (2.0, 0.45, 4.0), (2.75, 0.35, 5.0), (3.6, 0.2, 6.5)]
    scale = [392.00, 440.00, 523.25, 587.33, 659.25]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6000, pre_delay_ms=8, seed=3201)
        b1 = synth_modal_bar(523.25, duration_s=0.85, modes=bian_modes, decay_mult=0.95)
        dry = b1
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=5800, pre_delay_ms=10, seed=3202)
        layers = []
        for i, f in enumerate(scale[:4]):
            sig = synth_modal_bar(f, duration_s=1.2 - i*0.03, modes=bian_modes, decay_mult=1.1)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.035 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.6
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.38, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=5800, pre_delay_ms=14, seed=3203)
        full_bian = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99]
        layers = []
        for i, f in enumerate(full_bian):
            sig = synth_modal_bar(f, duration_s=1.8 - i*0.04, modes=bian_modes, decay_mult=1.3)
            pan = -0.55 + 1.1 * (i / (len(full_bian) - 1))
            panned = np.zeros_like(sig)
            panned[:, 0] = sig[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = sig[:, 1] * (1.0 + pan) * 0.5
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.03 * SR)
            p[st:st + len(panned)] = panned[:min(len(panned), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 33. Great Cathedral Campanile Bell (Acoustic)
def generate_bell_church(style='ps5'):
    campanile_modes = [
        (0.500, 0.85, 1.8), (1.000, 1.00, 2.5), (1.189, 0.65, 3.2),
        (1.498, 0.55, 3.8), (2.000, 0.80, 4.5), (2.750, 0.30, 6.0)
    ]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=5000, pre_delay_ms=10, seed=3301)
        b = synth_modal_bar(261.63, duration_s=0.85, modes=campanile_modes, decay_mult=0.95)
        dry = b
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.25, width=1.10, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.5, tone_hz=4800, pre_delay_ms=14, seed=3302)
        b1 = synth_modal_bar(196.00, duration_s=1.3, modes=campanile_modes, decay_mult=1.2)
        b2 = synth_modal_bar(261.63, duration_s=1.2, modes=campanile_modes, decay_mult=1.1) * 0.8
        dry = mix_tracks(b1, b2)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.32, width=1.40, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.25
        ir = generate_diffuse_reverb_ir(decay_s=2.3, tone_hz=4600, pre_delay_ms=18, seed=3303)
        b_root = synth_modal_bar(130.81, duration_s=2.2, modes=campanile_modes, decay_mult=1.5)
        b_fifth = synth_modal_bar(196.00, duration_s=2.0, modes=campanile_modes, decay_mult=1.4) * 0.8
        b_oct = synth_modal_bar(261.63, duration_s=1.8, modes=campanile_modes, decay_mult=1.3) * 0.75
        dry = mix_tracks(b_root, b_fifth, b_oct)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 34. Deep Temple Chau Gong & Tam-Tam (Acoustic)
def generate_bell_gong(style='ps5'):
    gong_modes = [
        (1.00, 1.00, 2.0), (1.42, 0.75, 2.8), (1.95, 0.80, 3.5),
        (2.61, 0.65, 4.5), (3.30, 0.50, 5.5), (4.80, 0.40, 7.0)
    ]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=4800, pre_delay_ms=8, seed=3401)
        g = synth_modal_bar(110.00, duration_s=0.85, modes=gong_modes, decay_mult=0.95)
        dry = g
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=4600, pre_delay_ms=12, seed=3402)
        g1 = synth_modal_bar(82.41, duration_s=1.3, modes=gong_modes, decay_mult=1.2)
        g2 = synth_modal_bar(123.47, duration_s=1.2, modes=gong_modes, decay_mult=1.1) * 0.75
        dry = mix_tracks(g1, g2)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.40, dry_level=0.78), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=4500, pre_delay_ms=16, seed=3403)
        g_deep = synth_modal_bar(65.41, duration_s=2.1, modes=gong_modes, decay_mult=1.5)
        g_mid = synth_modal_bar(98.00, duration_s=2.0, modes=gong_modes, decay_mult=1.4) * 0.8
        g_high = synth_modal_bar(146.83, duration_s=1.8, modes=gong_modes, decay_mult=1.3) * 0.7
        dry = mix_tracks(g_deep, g_mid, g_high)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-15.5)

# 35. Tibetan Tingsha Prayer Bells (Acoustic)
def generate_bell_tingsha(style='ps5'):
    tingsha_modes = [(1.0, 1.0, 2.0), (2.05, 0.4, 3.5), (3.75, 0.15, 6.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=8500, pre_delay_ms=6, seed=3501)
        t1 = synth_modal_bar(2637.02, duration_s=0.85, modes=tingsha_modes, decay_mult=1.0)
        dry = t1
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.15, dry_level=0.82), target_duration=dur, target_rms_db=-16.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=8500, pre_delay_ms=8, seed=3502)
        t1 = synth_modal_bar(2637.02, duration_s=1.25, modes=tingsha_modes, decay_mult=1.2)
        t2 = synth_modal_bar(2643.00, duration_s=1.25, modes=tingsha_modes, decay_mult=1.2) * 0.9 # acoustic beating
        dry = mix_tracks(t1 * 0.55, t2 * 0.55)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.45, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=8500, pre_delay_ms=12, seed=3503)
        t1 = synth_modal_bar(2637.02, duration_s=1.9, modes=tingsha_modes, decay_mult=1.4)
        t2 = synth_modal_bar(2643.00, duration_s=1.9, modes=tingsha_modes, decay_mult=1.4) * 0.85
        t3 = synth_modal_bar(3951.07, duration_s=1.6, modes=tingsha_modes, decay_mult=1.3) * 0.60
        dry = mix_tracks(t1 * 0.5, t2 * 0.5, t3)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 36. Javanese Gamelan Bronze Metallophone (Acoustic)
def generate_bell_gamelan(style='ps5'):
    gamelan_modes = [(1.0, 1.0, 2.8), (2.78, 0.45, 4.5), (5.4, 0.20, 7.5)]
    pelog = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6200, pre_delay_ms=8, seed=3601)
        b1 = synth_modal_bar(392.00, duration_s=0.85, modes=gamelan_modes, decay_mult=0.95)
        dry = b1
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.35, tone_hz=6000, pre_delay_ms=10, seed=3602)
        layers = []
        for i, f in enumerate(pelog[:4]):
            sig = synth_modal_bar(f, duration_s=1.2 - i*0.03, modes=gamelan_modes, decay_mult=1.1)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.035 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.6
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.38, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=6000, pre_delay_ms=14, seed=3603)
        layers = []
        for i, f in enumerate(pelog):
            sig = synth_modal_bar(f, duration_s=1.8 - i*0.04, modes=gamelan_modes, decay_mult=1.3)
            pan = -0.5 + 1.0 * (i / (len(pelog) - 1))
            panned = np.zeros_like(sig)
            panned[:, 0] = sig[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = sig[:, 1] * (1.0 + pan) * 0.5
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.032 * SR)
            p[st:st + len(panned)] = panned[:min(len(panned), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 37. Symphonic Tubular Carillon Chimes (Acoustic)
def generate_bell_tubular(style='ps5'):
    tubular_modes = [(1.0, 1.0, 2.5), (2.76, 0.60, 3.8), (5.4, 0.35, 5.5), (8.9, 0.15, 7.5)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=6500, pre_delay_ms=8, seed=3701)
        ch = synth_modal_bar(523.25, duration_s=0.85, modes=tubular_modes, decay_mult=0.95)
        dry = ch
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=6200, pre_delay_ms=10, seed=3702)
        ch1 = synth_modal_bar(392.00, duration_s=1.2, modes=tubular_modes, decay_mult=1.2)
        ch2 = synth_modal_bar(523.25, duration_s=1.1, modes=tubular_modes, decay_mult=1.1) * 0.85
        ch3 = synth_modal_bar(659.25, duration_s=1.0, modes=tubular_modes, decay_mult=1.0) * 0.75
        dry = mix_tracks(ch1, ch2, ch3)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.40, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.25
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=6200, pre_delay_ms=14, seed=3703)
        chimes = [
            (0.00, 261.63), (0.06, 392.00), (0.12, 523.25),
            (0.18, 659.25), (0.24, 783.99), (0.30, 1046.50)
        ]
        layers = []
        for st_s, f in chimes:
            sig = synth_modal_bar(f, duration_s=1.8 - st_s, modes=tubular_modes, decay_mult=1.3)
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 38. Orchestral Steel Glockenspiel (Acoustic)
def generate_bell_glock(style='ps5'):
    glock_modes = [(1.0, 1.0, 3.2), (2.75, 0.40, 5.0), (5.4, 0.15, 8.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=7800, pre_delay_ms=6, seed=3801)
        g = synth_modal_bar(1567.98, duration_s=0.85, modes=glock_modes, decay_mult=0.95)
        dry = g
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.15, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.35, tone_hz=7500, pre_delay_ms=8, seed=3802)
        notes = [1046.50, 1318.51, 1567.98, 2093.00]
        layers = []
        for i, f in enumerate(notes):
            sig = synth_modal_bar(f, duration_s=1.1 - i*0.03, modes=glock_modes, decay_mult=1.1)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.03 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.40, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=7500, pre_delay_ms=12, seed=3803)
        run = [1046.50, 1318.51, 1567.98, 2093.00, 2637.02, 3135.96]
        layers = []
        for i, f in enumerate(run):
            sig = synth_modal_bar(f, duration_s=1.8 - i*0.04, modes=glock_modes, decay_mult=1.3)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.028 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.50
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 39. Celestial Brass & Crystal Wind Chimes (Acoustic)
def generate_bell_windchimes(style='ps5'):
    chime_modes = [(1.0, 1.0, 2.6), (2.75, 0.35, 4.5), (5.2, 0.15, 7.5)]
    cluster = [1318.51, 1661.22, 1975.53, 2637.02, 3322.44, 3951.07]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=8200, pre_delay_ms=6, seed=3901)
        layers = []
        for i, f in enumerate(cluster[:4]):
            sig = synth_modal_bar(f, duration_s=0.8 - i*0.02, modes=chime_modes, decay_mult=0.95)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.02 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.6
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.24, width=1.20, dry_level=0.80), target_duration=dur, target_rms_db=-16.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=8000, pre_delay_ms=10, seed=3902)
        layers = []
        for i, f in enumerate(cluster):
            sig = synth_modal_bar(f, duration_s=1.2 - i*0.03, modes=chime_modes, decay_mult=1.2)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.025 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.55
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.45, dry_level=0.76), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=8000, pre_delay_ms=14, seed=3903)
        layers = []
        for i in range(12):
            f = cluster[i % len(cluster)] * (1.0 + (i // len(cluster)) * 0.15)
            sig = synth_modal_bar(f, duration_s=1.8 - i*0.03, modes=chime_modes, decay_mult=1.4)
            p = np.zeros((int(dur * SR), 2))
            st = int(i * 0.022 * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)] * 0.45
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.38, width=1.60, dry_level=0.74), target_duration=dur, target_rms_db=-16.0)

# 40. Japanese Buddhist Rin Singing Bowl (Acoustic)
def generate_bell_rin(style='ps5'):
    rin_modes = [(1.0, 1.0, 2.0), (2.05, 0.45, 3.5), (3.8, 0.20, 6.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.9, tone_hz=5200, pre_delay_ms=8, seed=4001)
        r = synth_modal_bar(440.00, duration_s=0.85, modes=rin_modes, decay_mult=1.0)
        dry = r
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=5000, pre_delay_ms=12, seed=4002)
        r1 = synth_modal_bar(329.63, duration_s=1.25, modes=rin_modes, decay_mult=1.2)
        r2 = synth_modal_bar(493.88, duration_s=1.20, modes=rin_modes, decay_mult=1.1) * 0.75
        dry = mix_tracks(r1, r2)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.30, width=1.38, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=4800, pre_delay_ms=16, seed=4003)
        r1 = synth_modal_bar(220.00, duration_s=2.0, modes=rin_modes, decay_mult=1.5)
        r2 = synth_modal_bar(329.63, duration_s=1.8, modes=rin_modes, decay_mult=1.4) * 0.8
        r3 = synth_modal_bar(440.00, duration_s=1.7, modes=rin_modes, decay_mult=1.3) * 0.7
        dry = mix_tracks(r1, r2, r3)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.36, width=1.60, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)

# 41. High-Tensile Maritime Ship's Bell (Acoustic)
def generate_bell_ship(style='ps5'):
    ship_modes = [(1.0, 1.0, 2.2), (2.1, 0.65, 3.5), (3.8, 0.35, 5.5), (6.2, 0.15, 8.0)]
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=6800, pre_delay_ms=6, seed=4101)
        b = synth_modal_bar(1567.98, duration_s=0.85, modes=ship_modes, decay_mult=0.95)
        dry = b
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.0)
    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.35, tone_hz=6500, pre_delay_ms=8, seed=4102)
        b1 = synth_modal_bar(1567.98, duration_s=1.1, modes=ship_modes, decay_mult=1.1)
        b2 = synth_modal_bar(1567.98, duration_s=1.0, modes=ship_modes, decay_mult=1.1)
        p = np.zeros((int(dur * SR), 2))
        p[:len(b1)] += b1 * 0.7
        st = int(0.075 * SR)
        p[st:st + len(b2)] += b2 * 0.75
        dry = p
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-15.5)
    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=6500, pre_delay_ms=12, seed=4103)
        hits = [0.0, 0.075, 0.22, 0.295]
        layers = []
        for st_s in hits:
            sig = synth_modal_bar(1567.98, duration_s=1.6 - st_s, modes=ship_modes, decay_mult=1.2) * 0.65
            p = np.zeros((int(dur * SR), 2))
            st = int(st_s * SR)
            p[st:st + len(sig)] = sig[:min(len(sig), len(p) - st)]
            layers.append(p)
        dry = mix_tracks(*layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-15.5)


# ---------------------------------------------------------------------------
# Metadata Registry & Multi-Profile Suite (41 Total Mood Suites)
# ---------------------------------------------------------------------------

MOOD_DEFINITIONS = [
    # 1-10: Original DNA Moods
    ("epic", "Epic", "Cinematic Orchestral", "#e5a93c", ["brass", "timpani", "cinematic", "heroic"], "original", generate_epic),
    ("scifi", "Sci-Fi", "Futuristic Cybernetic", "#38bdf8", ["fm-synth", "cyber", "holographic", "crystal"], "scifi", generate_scifi),
    ("fantasy", "Fantasiac", "Enchanted Ethereal", "#c084fc", ["glass", "celesta", "fairy-dust", "lydian"], "original", generate_fantasy),
    ("medieval", "Medieval", "Royal Castle Courtyard", "#f59e0b", ["sovereign-herald", "royal-carillon", "cathedral", "castle"], "original", generate_medieval),
    ("religious", "Religious", "Cathedral Sanctuary", "#facc15", ["cathedral-bell", "choir", "organ", "sacred"], "original", generate_religious),
    ("arcaic", "Arcaic", "Ancient Mediterranean", "#d97706", ["bronze-bowl", "lyre", "ancient", "phrygian"], "original", generate_arcaic),
    ("guitar", "Guitar", "Acoustic Flageolet", "#fb923c", ["harmonics", "acoustic", "flageolet", "spruce"], "original", generate_guitar),
    ("harp", "Harp", "Celtic Concert Strings", "#a7f3d0", ["plucked-strings", "celtic", "arpeggio", "concert-hall"], "original", generate_harp),
    ("drums", "Drums", "Cinematic Percussion", "#ef4444", ["taiko", "rimshot", "sub-impact", "cinematic-percussion"], "original", generate_drums),
    ("afric_ancient", "Afric Ancient", "Earthen African Heritage", "#10b981", ["mbira", "kalimba", "balafon", "udu-clay"], "original", generate_afric_ancient),

    # 11-15: Expanded Favorite Variations
    ("epic_fanfare", "Cinematic Orchestral II", "Sovereign Brass Fanfare", "#f59e0b", ["brass-choir", "imperial", "fanfare", "timpani"], "expanded", generate_epic_fanfare),
    ("fantasy_musicbox", "Enchanted Ethereal II", "Starlight Music Box", "#e879f9", ["music-box", "glass-harmonica", "starlight", "celeste"], "expanded", generate_fantasy_musicbox),
    ("guitar_12string", "Acoustic Flageolet II", "12-String Resonance", "#fdba74", ["12-string", "double-course", "spanish", "harmonics"], "expanded", generate_guitar_12string),
    ("harp_bardic", "Celtic Concert Strings II", "Bardic High Flourish", "#6ee7b7", ["wire-harp", "gaelic", "pentatonic", "bardic"], "expanded", generate_harp_bardic),
    ("afric_kora", "Earthen African Heritage II", "Sacred Kora & Gourd", "#34d399", ["kora", "griot", "calabash", "west-african"], "expanded", generate_afric_kora),

    # 16-19: Space & Robotics
    ("space_galaxy", "Space Galaxy", "Cosmic Nebula & Pulsars", "#818cf8", ["space", "nebula", "pulsar", "dark-matter"], "scifi", generate_space_galaxy),
    ("robotic_droid", "Robotic I: Cyber Droid", "Light Companion Droid", "#22d3ee", ["servo-clicks", "vocoder", "companion-droid", "telemetry"], "robotic", generate_robotic_droid),
    ("robotic_quantum", "Robotic II: Quantum AI Core", "Neural Supercomputer", "#06b6d4", ["laser-optic", "quantum-phase", "pure-sine", "singularity"], "robotic", generate_robotic_quantum),
    ("robotic_mech", "Robotic III: Heavy Mech", "Titan Industrial Mech", "#64748b", ["hydraulic-purge", "titanium-clamp", "seismic-sub", "reactor"], "robotic", generate_robotic_mech),

    # 20-21: Retro & Classic Gaming Foundations
    ("retro_8bit", "8-Bit Retro Gaming", "NES 2A03 Chiptune", "#ec4899", ["nes", "chiptune", "square-wave", "8bit-victory"], "retro", generate_retro_8bit),
    ("retro_16bit", "16-Bit Classic Gaming", "SNES / Genesis RPG Victory", "#a855f7", ["snes", "genesis", "fm-brass", "rpg-victory"], "retro", generate_retro_16bit),

    # 22-31: The 10 8-Bit Bell Variations
    ("8bit_china", "8-Bit China Bells", "NES 2A03 Bianzhong Chimes", "#f43f5e", ["8bit-bell", "china-bell", "bianzhong", "pentatonic"], "8bit-bells", generate_8bit_china),
    ("8bit_church", "8-Bit Church Bell", "NES 2A03 Cathedral Campanile", "#e11d48", ["8bit-bell", "church-bell", "gothic", "triangle-bass"], "8bit-bells", generate_8bit_church),
    ("8bit_gong", "8-Bit Temple Gong", "NES 2A03 Tam-Tam Crash", "#be123c", ["8bit-bell", "temple-gong", "tam-tam", "noise-sweep"], "8bit-bells", generate_8bit_gong),
    ("8bit_tingsha", "8-Bit Tingsha Chimes", "NES 2A03 Tibetan Prayer Ping", "#fb7185", ["8bit-bell", "tingsha", "tibetan", "crystal-pulse"], "8bit-bells", generate_8bit_tingsha),
    ("8bit_gamelan", "8-Bit Gamelan Bells", "NES 2A03 Bronze Pot Chimes", "#fda4af", ["8bit-bell", "gamelan", "indonesian", "slendro"], "8bit-bells", generate_8bit_gamelan),
    ("8bit_tubular", "8-Bit Tubular Bells", "NES 2A03 Orchestral Carillon", "#f472b6", ["8bit-bell", "tubular-bells", "westminster", "chimes"], "8bit-bells", generate_8bit_tubular),
    ("8bit_glock", "8-Bit Glockenspiel", "NES 2A03 Steel Bar Sparkle", "#ec4899", ["8bit-bell", "glockenspiel", "steel-bell", "sparkle"], "8bit-bells", generate_8bit_glock),
    ("8bit_windchimes", "8-Bit Wind Chimes", "NES 2A03 Glass Breeze Cluster", "#db2777", ["8bit-bell", "wind-chimes", "cluster", "flutter"], "8bit-bells", generate_8bit_windchimes),
    ("8bit_rin", "8-Bit Zen Rin Gong", "NES 2A03 Singing Bowl Drone", "#9d174d", ["8bit-bell", "rin-gong", "zen", "vibrato-drone"], "8bit-bells", generate_8bit_rin),
    ("8bit_ship", "8-Bit Nautical Ship Bell", "NES 2A03 Maritime Double Strike", "#be185d", ["8bit-bell", "ship-bell", "nautical", "double-strike"], "8bit-bells", generate_8bit_ship),

    # 32-41: The 10 Acoustic (Non-8-Bit) Physical Modal Bells
    ("bell_china", "Imperial China Bells", "Acoustic Bianzhong Bronze", "#d97706", ["acoustic-bell", "bianzhong", "bronze-chime", "chinese-temple"], "acoustic-bells", generate_bell_china),
    ("bell_church", "Cathedral Campanile", "Acoustic Great Church Bell", "#b45309", ["acoustic-bell", "cathedral", "campanile", "bronze-carillon"], "acoustic-bells", generate_bell_church),
    ("bell_gong", "Temple Chau Gong", "Acoustic Orchestral Tam-Tam", "#92400e", ["acoustic-bell", "chau-gong", "tam-tam", "shimmer-wash"], "acoustic-bells", generate_bell_gong),
    ("bell_tingsha", "Tibetan Tingsha", "Acoustic Pure Prayer Cymbals", "#f59e0b", ["acoustic-bell", "tingsha", "tibetan-prayer", "binaural-chime"], "acoustic-bells", generate_bell_tingsha),
    ("bell_gamelan", "Javanese Gamelan", "Acoustic Bronze Metallophone", "#fbbf24", ["acoustic-bell", "gamelan", "javanese", "bronze-kettle"], "acoustic-bells", generate_bell_gamelan),
    ("bell_tubular", "Symphonic Tubular Bells", "Acoustic Orchestral Chimes", "#fcd34d", ["acoustic-bell", "tubular-bells", "orchestral", "carillon"], "acoustic-bells", generate_bell_tubular),
    ("bell_glock", "Steel Glockenspiel", "Acoustic German Steel Bars", "#fef08a", ["acoustic-bell", "glockenspiel", "steel-chime", "crystalline"], "acoustic-bells", generate_bell_glock),
    ("bell_windchimes", "Crystal Wind Chimes", "Acoustic Brass & Glass Cluster", "#cbd5e1", ["acoustic-bell", "wind-chimes", "glass-cluster", "ethereal-air"], "acoustic-bells", generate_bell_windchimes),
    ("bell_rin", "Zen Rin Singing Bowl", "Acoustic Buddhist Prayer Bronze", "#94a3b8", ["acoustic-bell", "rin-bowl", "singing-bowl", "zen-acoustic"], "acoustic-bells", generate_bell_rin),
    ("bell_ship", "Maritime Ship's Bell", "Acoustic High-Tensile Naval Brass", "#64748b", ["acoustic-bell", "naval-bell", "ship-bell", "maritime"], "acoustic-bells", generate_bell_ship),
]

STYLE_DEFINITIONS = [
    {
        "key": "ps4",
        "prefix": "trophy_ps4",
        "label": "PS4 Chime DNA",
        "ref": "ps4_trophy.mp3",
        "dur_label": "~0.95s",
        "desc": "Punchy tactile tick, rapid bright chime, focused stereo"
    },
    {
        "key": "ps5",
        "prefix": "trophy_ps5",
        "label": "PS5 Bloom DNA",
        "ref": "ps5_trophy.mp3",
        "dur_label": "~1.40s",
        "desc": "Warm air-intake swell, modern open suspended chord bloom, glassy strike"
    },
    {
        "key": "platinum",
        "prefix": "trophy_platinum",
        "label": "PS5 Platinum DNA",
        "ref": "ps5_trophy_platinum.mp3",
        "dur_label": "~2.20s",
        "desc": "Triumphant multi-stage fanfare arc, soaring celestial crest, expansive 3D tail"
    }
]

# ---------------------------------------------------------------------------
# Packaging & HTML Preview Player
# ---------------------------------------------------------------------------

def build_sequence_zip(mood_id, title, cat, variations):
    zip_fn = f"sequence_{mood_id}.zip"
    zip_path = os.path.join(ZIPS_DIR, zip_fn)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for var in variations:
            w = os.path.join(OUT_DIR, var["wav_file"])
            m = os.path.join(OUT_DIR, var["mp3_file"])
            folder = var["style_key"].upper()
            if os.path.isfile(w): z.write(w, f"{folder}/WAV/{var['wav_file']}")
            if os.path.isfile(m): z.write(m, f"{folder}/MP3/{var['mp3_file']}")
        readme = f"Mood: {title}\nCategory: {cat}\n3 Variations: PS4 Chime (~0.95s), PS5 Bloom (~1.40s), PS5 Platinum (~2.20s)\n100% Procedural DSP Audio"
        z.writestr("README.txt", readme)
    return f"zips/{zip_fn}"


def build_preview_html(results_by_mood):
    html_path = os.path.join(OUT_DIR, "preview_dna_trophies.html")
    
    rows_html = []
    for m in results_by_mood:
        mood_id, title, cat, color, tags, group, variations, zip_rel = m["id"], m["title"], m["category"], m["color"], m["tags"], m["group"], m["variations"], m["zip_rel"]
        badges = "".join([f'<span class="badge">{t}</span>' for t in tags])
        
        cards_cols = []
        for var in variations:
            style_key = var["style_key"]
            style_label = var["style_label"]
            dur = var["duration_s"]
            fn_mp3 = var["mp3_file"]
            fn_wav = var["wav_file"]
            
            cards_cols.append(f"""
            <div class="tier-card style-{style_key}">
              <div class="tier-head">
                <span class="tier-tag">{style_label}</span>
                <span class="dur">{dur:.2f}s</span>
              </div>
              <div class="tier-btns">
                <button class="play-btn" data-src="{fn_mp3}" data-title="{title} ({style_label})" data-color="{color}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <span>Play</span>
                </button>
                <button class="toast-btn" data-src="{fn_mp3}" data-title="{title} &bull; {style_label}" data-desc="Procedural DNA Audio" data-color="{color}" title="Simulate notification toast">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
                  <span>Toast</span>
                </button>
                <div class="dl-links">
                  <a href="{fn_wav}" download title="WAV">WAV</a>
                  <a href="{fn_mp3}" download title="MP3">MP3</a>
                </div>
              </div>
            </div>
            """)
            
        cards_row = "\n".join(cards_cols)
        
        rows_html.append(f"""
        <div class="mood-row group-{group}" style="--accent:{color}" data-mood="{mood_id}" data-group="{group}">
          <div class="mood-info">
            <span class="cat">{cat}</span>
            <h3>{title}</h3>
            <div class="tags">{badges}</div>
            <a href="{zip_rel}" download class="seq-dl-btn" title="Download all 3 variations of this mood as ZIP">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download Trio (ZIP)</span>
            </a>
          </div>
          <div class="tiers-grid">
            {cards_row}
          </div>
        </div>
        """)
        
    matrix_str = "\n".join(rows_html)
    
    html_content = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PlayStation DNA Trophy Suite · 3 Profiles &times; 41 Moods (123 Sounds)</title>
<style>
  :root {{
    --bg: #090c12;
    --card: #121622;
    --card-hover: #192032;
    --border: #21293c;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --cyan: #38bdf8;
    --amber: #f59e0b;
    --ps4-color: #64748b;
    --ps5-color: #0070d1;
    --plat-color: #38bdf8;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    padding: 24px;
    max-width: 1320px;
    margin: 0 auto;
    position: relative;
  }}
  header {{
    margin-bottom: 20px;
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
  h1 span {{
    font-size: 13px; font-weight: 600; background: rgba(56, 189, 248, 0.15);
    color: var(--cyan); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.35);
  }}
  p.subtitle {{ color: var(--text-dim); margin-top: 6px; font-size: 14px; max-width: 1000px; }}

  /* Visualizer Studio */
  .studio-bar {{
    background: #0f1523;
    border: 1px solid #23344d;
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }}
  .studio-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }}
  .studio-title {{ font-size: 14px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }}
  .studio-title span {{ color: #38bdf8; font-family: monospace; font-size: 13px; font-weight: 500; }}
  .visualizer-canvas {{
    width: 100%;
    height: 100px;
    background: #07090f;
    border: 1px solid #1a2336;
    border-radius: 6px;
    display: block;
  }}
  .studio-controls {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    color: var(--text-dim);
  }}

  /* Filter Bars */
  .filters-container {{
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 24px;
  }}
  .filter-bar {{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    background: #0f131d;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    align-items: center;
  }}
  .filter-label {{ font-size: 12px; color: var(--text-dim); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-right: 4px; }}
  .filter-btn {{
    background: #171d2b;
    color: #94a3b8;
    border: 1px solid #27344c;
    border-radius: 6px;
    padding: 5px 12px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }}
  .filter-btn:hover {{ color: #fff; background: #222d42; }}
  .filter-btn.active {{
    background: #0070d1;
    color: #fff;
    border-color: #38bdf8;
  }}

  /* Mood Matrix Rows */
  .matrix-container {{ display: flex; flex-direction: column; gap: 14px; }}
  .mood-row {{
    background: var(--card);
    border: 1px solid var(--border);
    border-left: 5px solid var(--accent);
    border-radius: 10px;
    padding: 16px 20px;
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 20px;
    align-items: center;
    transition: background 0.15s ease;
  }}
  .mood-row:hover {{ background: var(--card-hover); }}
  .mood-info {{ display: flex; flex-direction: column; gap: 6px; }}
  .mood-info .cat {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 700; }}
  .mood-info h3 {{ font-size: 17px; color: #fff; font-weight: 700; }}
  .mood-info .tags {{ display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }}
  .badge {{
    font-size: 10px;
    background: #1a2233;
    color: #94a3b8;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #27344a;
  }}
  .seq-dl-btn {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    background: #172235;
    color: #38bdf8;
    border: 1px solid #283e5e;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 600;
    text-decoration: none;
    width: fit-content;
    transition: all 0.15s ease;
  }}
  .seq-dl-btn:hover {{
    background: #38bdf8;
    color: #000;
    border-color: #38bdf8;
  }}

  .tiers-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }}
  .tier-card {{
    background: #0d111a;
    border: 1px solid #1e2638;
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 0.15s ease;
  }}
  .tier-card:hover {{ border-color: #334360; }}
  .tier-card.style-ps4 {{ border-top: 3px solid var(--ps4-color); }}
  .tier-card.style-ps5 {{ border-top: 3px solid var(--ps5-color); }}
  .tier-card.style-platinum {{ border-top: 3px solid var(--plat-color); }}

  .tier-head {{
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .tier-tag {{ font-size: 12px; font-weight: 700; color: #fff; }}
  .style-ps4 .tier-tag {{ color: #94a3b8; }}
  .style-ps5 .tier-tag {{ color: #38bdf8; }}
  .style-platinum .tier-tag {{ color: #67e8f9; }}
  .dur {{ font-size: 11px; color: var(--text-dim); font-family: monospace; }}

  .tier-btns {{
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }}
  .play-btn, .toast-btn {{
    background: #172030;
    color: #fff;
    border: 1px solid #28374f;
    border-radius: 4px;
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
  }}
  .play-btn:hover {{
    background: #38bdf8;
    color: #000;
    border-color: #38bdf8;
  }}
  .play-btn.playing {{
    background: #00ffaa;
    color: #000;
    border-color: #00ffaa;
  }}
  .toast-btn:hover {{ background: #253348; }}
  .dl-links {{ display: flex; gap: 4px; font-size: 11px; margin-left: auto; }}
  .dl-links a {{
    color: #94a3b8;
    text-decoration: none;
    padding: 3px 6px;
    background: #141b27;
    border-radius: 4px;
    border: 1px solid #222d3e;
  }}
  .dl-links a:hover {{ color: #fff; border-color: #3b82f6; }}

  /* Reference DNA Section */
  .orig-section {{
    margin-top: 36px;
    background: #0e121a;
    border: 1px solid #1f2736;
    border-radius: 8px;
    padding: 18px 20px;
  }}
  .orig-section h3 {{ font-size: 15px; color: #fff; margin-bottom: 6px; }}
  .orig-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin-top: 10px;
  }}
  .orig-btn {{
    background: #151a24;
    color: #94a3b8;
    border: 1px solid #273346;
    border-left: 4px solid #64748b;
    border-radius: 6px;
    padding: 10px 14px;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }}
  .orig-btn:hover {{ color: #fff; background: #1e2534; }}
  .orig-btn.playing {{ border-left-color: #00ffaa; color: #fff; }}

  /* Floating Toast */
  .toast-container {{
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 9999;
    pointer-events: none;
  }}
  .sim-toast {{
    background: linear-gradient(135deg, #1f1f1f 0%, #0f0f0f 100%);
    border: 1px solid #333;
    border-left: 5px solid #0070d1;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 320px;
    max-width: 420px;
    transform: translateX(120%);
    opacity: 0;
    transition: transform 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.28), opacity 0.35s ease;
  }}
  .sim-toast.show {{
    transform: translateX(0);
    opacity: 1;
  }}
  .toast-icon {{
    width: 38px;
    height: 38px;
    border-radius: 6px;
    background: #252a36;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
  }}
  .toast-content {{ display: flex; flex-direction: column; }}
  .toast-title {{ font-size: 13px; font-weight: 700; color: #fff; }}
  .toast-desc {{ font-size: 11px; color: #94a3b8; margin-top: 2px; }}

  @media (max-width: 960px) {{
    .mood-row {{ grid-template-columns: 1fr; }}
    .tiers-grid {{ grid-template-columns: 1fr; }}
  }}
</style>
</head>
<body>

<header>
  <div class="top-row">
    <h1>
      PlayStation DNA Trophy Suite
      <span>3 Profiles &times; 41 Moods (123 Sounds)</span>
    </h1>
    <div style="display:flex;gap:10px">
      <a href="DNA_Trophies_Complete_Suite.zip" download style="color:#000;font-weight:700;font-size:13px;text-decoration:none;background:#38bdf8;padding:8px 14px;border-radius:6px">&darr; Download All 123 (ZIP)</a>
      <a href="../preview.html" style="color:#38bdf8;font-size:13px;text-decoration:none;background:#151e2e;padding:8px 14px;border-radius:6px;border:1px solid #23344d">&larr; Back to SteamStation</a>
    </div>
  </div>
  <p class="subtitle">
    100% procedural sound design inspired by PlayStation trophy wave movements. Every mood features 3 variations:
    <strong>PS4 Chime DNA (~0.95s)</strong>, <strong>PS5 Bloom DNA (~1.40s)</strong>, and <strong>PS5 Platinum DNA (~2.20s)</strong>.
    Click any trio's "Download Trio (ZIP)" to download its complete 3-tier sequence.
  </p>
</header>

<div class="studio-bar">
  <div class="studio-header">
    <div class="studio-title">
      Active Wave Movement: <span id="activeSoundLabel">&mdash; None (Click Play)</span>
    </div>
    <div style="font-size:12px;color:#8b949e">Status: <span id="playbackStatus" style="color:#fff">Ready</span></div>
  </div>
  <canvas id="canvas" class="visualizer-canvas" width="1240" height="100"></canvas>
  <div class="studio-controls">
    <span>Direct HTML5 Audio Engine &bull; Zero CORS Restrictions</span>
    <span>48 kHz Stereo &bull; 100% Procedural DSP</span>
  </div>
</div>

<div class="filters-container">
  <div class="filter-bar">
    <span class="filter-label">Category Filter:</span>
    <button class="filter-btn group-btn active" data-group="all">All 41 Suites (123 Sounds)</button>
    <button class="filter-btn group-btn" data-group="8bit-bells">8-Bit Bells &amp; Gongs (10)</button>
    <button class="filter-btn group-btn" data-group="acoustic-bells">Acoustic Bells &amp; Gongs (10)</button>
    <button class="filter-btn group-btn" data-group="original">Original DNA (10)</button>
    <button class="filter-btn group-btn" data-group="expanded">Expanded Favorites (5)</button>
    <button class="filter-btn group-btn" data-group="robotic">Robotics (3)</button>
    <button class="filter-btn group-btn" data-group="scifi">Sci-Fi &amp; Space (2)</button>
    <button class="filter-btn group-btn" data-group="retro">Retro Foundations (2)</button>
  </div>

  <div class="filter-bar">
    <span class="filter-label">Profile Filter:</span>
    <button class="filter-btn profile-btn active" data-profile="all">All 3 Profiles</button>
    <button class="filter-btn profile-btn" data-profile="ps4">PS4 Chime DNA (~0.95s)</button>
    <button class="filter-btn profile-btn" data-profile="ps5">PS5 Bloom DNA (~1.40s)</button>
    <button class="filter-btn profile-btn" data-profile="platinum">PS5 Platinum DNA (~2.20s)</button>
  </div>
</div>

<main class="matrix-container">
  {matrix_str}
</main>

<div class="orig-section">
  <h3>Reference DNA Sources (PlayStation Originals)</h3>
  <p style="color:#64748b;font-size:13px">Compare the inspired bespoke moods against the original acoustic profiles:</p>
  <div class="orig-grid">
    <button class="orig-btn" data-src="../../ps4_trophy.mp3" data-title="PS4 Trophy (Original)" data-color="#64748b">
      <strong>PS4 Trophy</strong> (0.95s, Mono, C/G/C chime)
    </button>
    <button class="orig-btn" data-src="../../ps5_trophy.mp3" data-title="PS5 Trophy (Original)" data-color="#0070d1">
      <strong>PS5 Trophy</strong> (1.42s, Stereo, Fsus2 bloom)
    </button>
    <button class="orig-btn" data-src="../../ps5_trophy_platinum.mp3" data-title="PS5 Platinum (Original)" data-color="#40c4ff">
      <strong>PS5 Platinum</strong> (2.15s, Wide 3D, Multi-stage fanfare)
    </button>
  </div>
</div>

<div class="toast-container">
  <div class="sim-toast" id="simToast">
    <div class="toast-icon" id="toastIcon">🏆</div>
    <div class="toast-content">
      <div class="toast-title" id="toastTitle">Achievement Unlocked!</div>
      <div class="toast-desc" id="toastDesc">Bespoke DNA Notification Sound</div>
    </div>
  </div>
</div>

<script>
  let currentAudio = null;
  let activeBtn = null;
  let toastTimer = null;
  let animId = null;
  let wavePhase = 0;

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const label = document.getElementById('activeSoundLabel');
  const status = document.getElementById('playbackStatus');
  const toast = document.getElementById('simToast');
  const toastTitle = document.getElementById('toastTitle');
  const toastDesc = document.getElementById('toastDesc');

  let activeGroup = 'all';
  let activeProfile = 'all';

  function applyFilters() {{
    document.querySelectorAll('.mood-row').forEach(row => {{
      const rowGroup = row.getAttribute('data-group');
      const matchesGroup = (activeGroup === 'all' || rowGroup === activeGroup);
      if (matchesGroup) {{
        row.style.display = 'grid';
        row.querySelectorAll('.tier-card').forEach(card => {{
          if (activeProfile === 'all' || card.classList.contains('style-' + activeProfile)) {{
            card.style.display = 'flex';
          }} else {{
            card.style.display = 'none';
          }}
        }});
      }} else {{
        row.style.display = 'none';
      }}
    }});
  }}

  function triggerToast(title, desc, color) {{
    clearTimeout(toastTimer);
    toast.style.borderLeftColor = color || '#38bdf8';
    toastTitle.textContent = title || 'Achievement Unlocked!';
    toastDesc.textContent = desc || 'Procedural DNA Audio';
    toast.classList.add('show');
    toastTimer = setTimeout(() => {{
      toast.classList.remove('show');
    }}, 3500);
  }}

  function drawIdleWave() {{
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }}

  function stopAll() {{
    if (currentAudio) {{
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }}
    if (activeBtn) {{
      activeBtn.classList.remove('playing');
      const span = activeBtn.querySelector('span');
      if (span && span.textContent === 'Pause') span.textContent = 'Play';
      activeBtn = null;
    }}
    if (animId) {{
      cancelAnimationFrame(animId);
      animId = null;
    }}
    drawIdleWave();
    status.textContent = 'Ready';
  }}

  function startDynamicVisualizer(accentColor) {{
    if (animId) cancelAnimationFrame(animId);

    function render() {{
      if (!currentAudio || currentAudio.paused) {{
        drawIdleWave();
        return;
      }}

      animId = requestAnimationFrame(render);

      const dur = currentAudio.duration && isFinite(currentAudio.duration) ? currentAudio.duration : 2.0;
      const progress = Math.min(1.0, currentAudio.currentTime / dur);
      wavePhase += 0.14;

      let amp = 0.0;
      if (progress < 0.07) {{
        amp = progress / 0.07;
      }} else if (progress < 0.35) {{
        amp = 1.0 - 0.25 * ((progress - 0.07) / 0.28);
      }} else if (progress < 0.65) {{
        amp = 0.75 + 0.2 * Math.sin(progress * 25.0);
      }} else {{
        amp = Math.max(0.0, 0.75 * Math.exp(-3.5 * ((progress - 0.65) / 0.35)));
      }}

      ctx.fillStyle = '#07090f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 6;
      ctx.beginPath();

      const midY = canvas.height / 2;
      for (let x = 0; x < canvas.width; x += 3) {{
        const xNorm = x / canvas.width;
        const wave = Math.sin(xNorm * 20.0 + wavePhase) * 0.5 +
                     Math.sin(xNorm * 48.0 - wavePhase * 1.4) * 0.3 +
                     Math.sin(xNorm * 9.0 - wavePhase * 0.7) * 0.2;
        const y = midY + wave * amp * (canvas.height * 0.42);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }}
      ctx.stroke();
      ctx.shadowBlur = 0;
    }}

    render();
  }}

  function playSound(src, title, color, isToastTest = false, desc = '', btn = null) {{
    if (currentAudio && !currentAudio.paused && activeBtn === btn && !isToastTest) {{
      stopAll();
      label.innerHTML = `&mdash; Paused: <strong>${{title}}</strong>`;
      return;
    }}

    stopAll();

    activeBtn = btn;
    if (btn) {{
      btn.classList.add('playing');
      const span = btn.querySelector('span');
      if (span && span.textContent === 'Play') span.textContent = 'Pause';
    }}

    currentAudio = new Audio(src);

    label.innerHTML = `&mdash; Playing: <strong style="color:${{color}}">${{title}}</strong>`;
    status.textContent = 'Playing';

    if (isToastTest) {{
      triggerToast(title, desc, color);
    }}

    currentAudio.play().then(() => {{
      startDynamicVisualizer(color);
    }}).catch(err => {{
      console.error("Audio playback error:", err);
      status.textContent = 'Playback error: ' + err.message;
      if (btn) btn.classList.remove('playing');
    }});

    currentAudio.onended = () => {{
      stopAll();
      label.innerHTML = `&mdash; Finished: <strong>${{title}}</strong>`;
    }};

    currentAudio.onerror = (e) => {{
      console.error("Audio element error on src:", src, e);
      status.textContent = 'Failed to load audio: ' + src;
      stopAll();
    }};
  }}

  document.querySelectorAll('.play-btn').forEach(btn => {{
    btn.addEventListener('click', () => {{
      const src = btn.getAttribute('data-src');
      const title = btn.getAttribute('data-title');
      const color = btn.getAttribute('data-color');
      playSound(src, title, color, false, '', btn);
    }});
  }});

  document.querySelectorAll('.toast-btn').forEach(btn => {{
    btn.addEventListener('click', () => {{
      const src = btn.getAttribute('data-src');
      const title = btn.getAttribute('data-title');
      const desc = btn.getAttribute('data-desc');
      const color = btn.getAttribute('data-color');
      playSound(src, title, color, true, desc, btn);
    }});
  }});

  document.querySelectorAll('.orig-btn').forEach(btn => {{
    btn.addEventListener('click', () => {{
      const src = btn.getAttribute('data-src');
      const title = btn.getAttribute('data-title');
      const color = btn.getAttribute('data-color');
      playSound(src, title, color, false, '', btn);
    }});
  }});

  // Category Filter Buttons
  document.querySelectorAll('.group-btn').forEach(gBtn => {{
    gBtn.addEventListener('click', () => {{
      document.querySelectorAll('.group-btn').forEach(b => b.classList.remove('active'));
      gBtn.classList.add('active');
      activeGroup = gBtn.getAttribute('data-group');
      applyFilters();
    }});
  }});

  // Profile Filter Buttons
  document.querySelectorAll('.profile-btn').forEach(pBtn => {{
    pBtn.addEventListener('click', () => {{
      document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
      pBtn.classList.add('active');
      activeProfile = pBtn.getAttribute('data-profile');
      applyFilters();
    }});
  }});

  drawIdleWave();
</script>

</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    return html_path


def build_zip_bundle(all_tracks):
    zip_path = os.path.join(OUT_DIR, "DNA_Trophies_Complete_Suite.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for t in all_tracks:
            w = os.path.join(OUT_DIR, f"{t['id']}.wav")
            m = os.path.join(OUT_DIR, f"{t['id']}.mp3")
            folder = t["style_key"].upper()
            if os.path.isfile(w): z.write(w, f"{folder}/WAV/{t['id']}.wav")
            if os.path.isfile(m): z.write(m, f"{folder}/MP3/{t['id']}.mp3")
        man = os.path.join(OUT_DIR, "manifest.json")
        if os.path.isfile(man): z.write(man, "manifest.json")
    print(f"  -> Generated Master ZIP archive: {os.path.basename(zip_path)}")
    return zip_path


def build_manifest(all_tracks):
    manifest = {
        "title": "PlayStation DNA Trophy Suite (3 Profiles x 41 Moods = 123 Sounds)",
        "description": "100% Original Audio Synthesis inspired by PlayStation Trophy wave movements (PS4, PS5, PS5 Platinum)",
        "profiles": STYLE_DEFINITIONS,
        "tracks": all_tracks
    }
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest_path


def main():
    parser = argparse.ArgumentParser(description="DNA Trophy Sound Designer")
    parser.add_argument("--open", action="store_true", help="Open preview HTML in browser after build")
    args = parser.parse_args()

    print("=====================================================================")
    print("  DNA Trophy Sound Designer - 3 Profiles x 41 Moods (123 Sounds)")
    print("  1. PS4 Profile       (based on ps4_trophy.mp3, ~0.95s)")
    print("  2. PS5 Profile       (based on ps5_trophy.mp3, ~1.40s)")
    print("  3. Platinum Profile  (based on ps5_trophy_platinum.mp3, ~2.20s)")
    print("=====================================================================")
    print(f"Target Directory: {OUT_DIR}\n")

    all_tracks = []
    results_by_mood = []

    for mood_id, title, cat, color, tags, group, gen_func in MOOD_DEFINITIONS:
        print(f"\n--- Mood: [{title}] ({cat}) ---")
        mood_variations = []
        for s_def in STYLE_DEFINITIONS:
            s_key = s_def["key"]
            sound_id = f"trophy_{s_key}_{mood_id}"
            print(f"  Generating [{s_def['label']}] -> {sound_id}...")
            sig = gen_func(style=s_key)
            wav_path, mp3_path = export_audio_files(sound_id, sig)
            
            var_data = {
                "id": sound_id,
                "mood_id": mood_id,
                "title": title,
                "category": cat,
                "style_key": s_key,
                "style_label": s_def["label"],
                "duration_s": len(sig) / SR,
                "wav_file": os.path.basename(wav_path),
                "mp3_file": os.path.basename(mp3_path),
                "color": color,
                "tags": tags,
                "group": group
            }
            mood_variations.append(var_data)
            all_tracks.append(var_data)
            
        zip_rel = build_sequence_zip(mood_id, title, cat, mood_variations)
        print(f"  -> Generated Trio ZIP: {zip_rel}")

        results_by_mood.append({
            "id": mood_id,
            "title": title,
            "category": cat,
            "color": color,
            "tags": tags,
            "group": group,
            "variations": mood_variations,
            "zip_rel": zip_rel
        })

    print("\nBuilding Manifest, Interactive Preview Player & Master ZIP Bundle...")
    manifest_path = build_manifest(all_tracks)
    html_path = build_preview_html(results_by_mood)
    zip_path = build_zip_bundle(all_tracks)

    print("\n[SUCCESS] All 123 bespoke trophy sounds synthesized and verified!")
    print(f"Preview HTML: {html_path}")
    print(f"Manifest:     {manifest_path}")
    print(f"ZIP Bundle:   {zip_path}")

    if args.open:
        webbrowser.open(f"file:///{os.path.abspath(html_path).replace(os.sep, '/')}")


if __name__ == "__main__":
    main()
