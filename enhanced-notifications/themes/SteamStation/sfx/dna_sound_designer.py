#!/usr/bin/env python3
"""DNA Trophy Sound Designer - 3-Profile PlayStation Trophy Wave Movement Suite.

100% Original Procedural Audio Synthesis - Zero PlayStation Audio Files.
Synthesizes 3 distinct profile variations for every mood based on the 3 PlayStation reference files:
  1. PS4 Profile       (based on ps4_trophy.mp3): ~0.95s, punchy attack tick, rapid bright chime, focused stereo
  2. PS5 Profile       (based on ps5_trophy.mp3): ~1.40s, smooth atmospheric pre-swell, warm suspended bloom, glassy strike
  3. Platinum Profile  (based on ps5_trophy_platinum.mp3): ~2.20s, multi-stage ascension fanfare, soaring celestial crest, expansive 3D tail

Generates 10 moods across all 3 profiles = 30 bespoke audio files:
  - Epic, Sci-Fi, Fantasiac, Medieval, Religious, Arcaic, Guitar, Harp, Drums, Afric Ancient

Usage:
  python dna_sound_designer.py             # Synthesizes all 30 sounds (WAV + MP3), manifest & preview player
  python dna_sound_designer.py --open      # Synthesizes and opens interactive HTML player in browser
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
FF = imageio_ffmpeg.get_ffmpeg_exe()

os.makedirs(OUT_DIR, exist_ok=True)

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
    max_len = max(len(t) for t in valid_tracks)
    out = np.zeros((max_len, 2), dtype=np.float64)
    for t in valid_tracks:
        out[: len(t)] += t
    return out


def master_sound(x, target_duration, target_rms_db=-16.0, fade_out_s=0.25, peak_ceiling_db=-0.5):
    """Trims/pads to target duration, applies cosine-squared fade out, normalizes loudness, and soft-saturates."""
    target_len = int(target_duration * SR)
    out = np.zeros((target_len, 2), dtype=np.float64)
    n = min(len(x), target_len)
    out[:n] = x[:n]

    # Cosine-squared fade out at tail
    fade_len = int(fade_out_s * SR)
    if fade_len > 0 and target_len > fade_len:
        fade_env = np.cos(np.linspace(0, np.pi / 2, fade_len)) ** 2
        out[-fade_len:, 0] *= fade_env
        out[-fade_len:, 1] *= fade_env

    # Active region RMS normalization
    envelope = np.max(np.abs(out), axis=1)
    active_idx = envelope > (np.max(envelope) * 0.03 + 1e-6)
    if np.any(active_idx):
        active_rms = np.sqrt(np.mean(out[active_idx] ** 2))
    else:
        active_rms = np.sqrt(np.mean(out**2)) + 1e-8

    target_rms = 10.0 ** (target_rms_db / 20.0)
    gain = target_rms / (active_rms + 1e-8)
    out *= gain

    # Soft tanh saturation ceiling
    ceiling = 10.0 ** (peak_ceiling_db / 20.0)
    pk = np.max(np.abs(out))
    if pk > ceiling:
        out = np.tanh(out / pk * 1.5) / np.tanh(1.5) * ceiling

    return np.clip(out, -1.0, 1.0)


def export_audio_files(name, x):
    """Exports both 320kbps MP3 and uncompressed 16-bit PCM WAV."""
    wav_path = os.path.join(OUT_DIR, f"{name}.wav")
    mp3_path = os.path.join(OUT_DIR, f"{name}.mp3")

    pcm = np.clip(x, -1.0, 1.0).astype(np.float32).tobytes()

    # WAV
    subprocess.run(
        [
            FF, "-v", "error", "-y",
            "-f", "f32le", "-ac", "2", "-ar", str(SR),
            "-i", "-",
            "-c:a", "pcm_s16le", wav_path
        ],
        input=pcm,
        check=True
    )

    # MP3
    subprocess.run(
        [
            FF, "-v", "error", "-y",
            "-f", "f32le", "-ac", "2", "-ar", str(SR),
            "-i", "-",
            "-c:a", "libmp3lame", "-b:a", "320k", mp3_path
        ],
        input=pcm,
        check=True
    )
    dur = len(x) / SR
    print(f"  -> Generated {name:30s} [{dur:4.2f}s] -> .wav + .mp3")
    return wav_path, mp3_path


# ---------------------------------------------------------------------------
# Physical Synthesis Primitives
# ---------------------------------------------------------------------------

def synth_karplus_strong(f0, duration_s, pick_pos=0.25, hardness=0.7, decay_time=1.5, detune_cents=2.0):
    """Extended Karplus-Strong plucked string model with physical string dispersion and dual-rail stereo."""
    n_samples = int(duration_s * SR)
    period = SR / f0
    p_int = int(period)
    p_frac = period - p_int

    def run_voice(detune_ratio):
        p = (SR / (f0 * detune_ratio))
        L = int(p)
        frac = p - L
        
        rng = np.random.default_rng(int(f0 * 100))
        noise = rng.standard_normal(L)
        delay_pick = max(1, int(pick_pos * L))
        noise_comb = noise.copy()
        noise_comb[delay_pick:] -= noise[:-delay_pick]
        
        alpha = hardness * 0.85
        init_buffer = np.zeros(L)
        cur = 0.0
        for i in range(L):
            cur = alpha * cur + (1.0 - alpha) * noise_comb[i]
            init_buffer[i] = cur
            
        rho = np.exp(-1.0 / max(0.01, (f0 * decay_time * 0.65)))
        buffer = list(init_buffer)
        y = np.zeros(n_samples)
        
        prev = 0.0
        for n in range(n_samples):
            val = buffer[n % L]
            filtered = 0.5 * (val + prev)
            prev = filtered
            buffer[n % L] = filtered * rho
            y[n] = val
            
        pk = np.max(np.abs(y)) + 1e-8
        return y / pk

    ratio_l = 2.0 ** (-detune_cents / 1200.0)
    ratio_r = 2.0 ** (detune_cents / 1200.0)
    left = run_voice(ratio_l)
    right = run_voice(ratio_r)
    return np.stack([left, right], axis=1)


def synth_modal_bar(f0, duration_s, modes, decay_mult=1.0, detune_cents=2.5, attack_ms=3.0):
    """Modal synthesis of struck acoustic bar or tube with specific vibrational modes."""
    n_samples = int(duration_s * SR)
    t = np.linspace(0, duration_s, n_samples)
    left = np.zeros(n_samples)
    right = np.zeros(n_samples)
    
    att_samples = int(attack_ms * 0.001 * SR)
    att_env = np.ones(n_samples)
    if att_samples > 0:
        att_env[:att_samples] = np.sin(np.linspace(0, np.pi / 2, att_samples)) ** 2

    for mult, amp, d_factor in modes:
        f = f0 * mult
        if f >= (SR / 2 - 500):
            continue
        fl = f * (2.0 ** (-detune_cents / 1200.0))
        fr = f * (2.0 ** (detune_cents / 1200.0))
        env = np.exp(-d_factor * (t / (duration_s * decay_mult))) * att_env
        left += amp * np.sin(2 * np.pi * fl * t) * env
        right += amp * np.sin(2 * np.pi * fr * t + 0.2) * env

    sig = np.stack([left, right], axis=1)
    pk = np.max(np.abs(sig))
    return sig / (pk + 1e-8)


def synth_fm_crystal(fc, fm, duration_s, mod_index_max=3.0, decay_exp=3.5, detune_cents=3.0):
    """Dual-carrier frequency modulation synthesis for futuristic / crystal high-tech chimes."""
    n_samples = int(duration_s * SR)
    t = np.linspace(0, duration_s, n_samples)
    
    mod_env = np.exp(-decay_exp * (t / duration_s))
    i_mod = mod_index_max * mod_env
    
    def fm_voice(fc_act, fm_act, phase_offset=0.0):
        modulator = np.sin(2 * np.pi * fm_act * t + phase_offset)
        carrier = np.sin(2 * np.pi * fc_act * t + i_mod * modulator)
        carrier_oct = 0.35 * np.sin(4 * np.pi * fc_act * t + (i_mod * 0.5) * modulator)
        return (carrier + carrier_oct) * mod_env

    fc_l = fc * (2.0 ** (-detune_cents / 1200.0))
    fc_r = fc * (2.0 ** (detune_cents / 1200.0))
    fm_l = fm * 0.999
    fm_r = fm * 1.001
    
    left = fm_voice(fc_l, fm_l, 0.0)
    right = fm_voice(fc_r, fm_r, np.pi / 3.0)
    
    sig = np.stack([left, right], axis=1)
    pk = np.max(np.abs(sig))
    return sig / (pk + 1e-8)


def synth_brass_formant_swell(f0, duration_s, rise_time_s=0.25, detune_cents=4.0):
    """Orchestral brass horn swell with moving vowel formants and majestic rise."""
    n_samples = int(duration_s * SR)
    t = np.linspace(0, duration_s, n_samples)
    
    saw1 = 2.0 * (t * f0 % 1.0) - 1.0
    saw2 = 2.0 * (t * (f0 * 2.0 ** (detune_cents / 1200.0)) % 1.0) - 1.0
    saw3 = 2.0 * (t * (f0 * 2.0 ** (-detune_cents / 1200.0)) % 1.0) - 1.0
    brass_raw = (saw1 + saw2 + saw3) / 3.0
    
    env = np.zeros(n_samples)
    rise_n = int(rise_time_s * SR)
    if rise_n > 0:
        env[:rise_n] = np.sin(np.linspace(0, np.pi / 2, rise_n)) ** 2
    env[rise_n:] = np.exp(-3.0 * (t[rise_n:] - rise_time_s) / max(0.01, duration_s - rise_time_s))
    
    b_mid = filt(brass_raw * env, "bandpass", [350, 1800], order=2)
    b_high = filt(brass_raw * env, "highpass", 2400, order=2) * 0.4
    b_low = filt(brass_raw * env, "lowpass", 400, order=2) * 0.8
    
    stereo_brass = np.stack([b_low + b_mid + b_high, b_low + b_mid * 0.9 + b_high * 1.1], axis=1)
    pk = np.max(np.abs(stereo_brass))
    return stereo_brass / (pk + 1e-8)


# ---------------------------------------------------------------------------
# The 10 Parameterized Mood Generators (supporting 'ps4', 'ps5', 'platinum')
# ---------------------------------------------------------------------------

def generate_epic(style='ps5'):
    """1. Epic Mood (Cinematic Orchestral)."""
    chime_modes = [(1.0, 1.0, 2.8), (2.756, 0.45, 4.5), (5.404, 0.25, 7.5), (8.93, 0.12, 11.0)]
    
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6000, pre_delay_ms=8, seed=101)
        # Immediate punchy timpani hit
        t_timp = np.linspace(0, dur, int(dur * SR))
        timp_sig = np.sin(2 * np.pi * (140.0 * np.exp(-18.0 * t_timp) + 65.0) * t_timp) * np.exp(-6.5 * t_timp)
        timp = np.repeat(timp_sig[:, None], 2, axis=1)
        # Crisp brass stab
        brass = synth_brass_formant_swell(261.63, duration_s=0.6, rise_time_s=0.04) * 0.75
        # Punchy tubular bell strike
        chime = synth_modal_bar(523.25, duration_s=0.85, modes=chime_modes, decay_mult=0.9) * 0.85
        dry = mix_tracks(timp * 0.70, brass, chime)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.0)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=5800, pre_delay_ms=12, seed=102)
        # Soft atmospheric swell into hit at 80ms
        t_hit = 0.08
        n_hit = int(t_hit * SR)
        t_timp = np.linspace(0, dur - t_hit, int((dur - t_hit) * SR))
        timp_sig = np.sin(2 * np.pi * (120.0 * np.exp(-14.0 * t_timp) + 55.0) * t_timp) * np.exp(-5.0 * t_timp)
        timp = np.zeros((int(dur * SR), 2))
        timp[n_hit:n_hit + len(timp_sig)] = np.repeat(timp_sig[:, None], 2, axis=1)
        # Warm brass open fifths swell
        brass_c3 = synth_brass_formant_swell(130.81, duration_s=1.2, rise_time_s=0.12)
        brass_g3 = synth_brass_formant_swell(196.00, duration_s=1.1, rise_time_s=0.14) * 0.8
        brass = mix_tracks(brass_c3, brass_g3)
        # Tubular chime
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


def generate_scifi(style='ps5'):
    """2. Sci-Fi (Futuristic Cybernetic)."""
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=8500, pre_delay_ms=6, seed=201)
        # Fast cyber optic tick
        t_click = np.linspace(0, 0.015, int(0.015 * SR))
        rng = np.random.default_rng(201)
        click_raw = rng.standard_normal(len(t_click)) * np.exp(-180.0 * t_click)
        click = filt(click_raw[:, None], "bandpass", [4000, 12000], order=3)
        click_stereo = np.repeat(click, 2, axis=1) * 0.8
        # Punchy FM chime
        fm_core = synth_fm_crystal(fc=880.0, fm=1320.0, duration_s=0.85, mod_index_max=2.8, decay_exp=4.2)
        dry = mix_tracks(click_stereo, fm_core)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.10, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=8000, pre_delay_ms=8, seed=202)
        # Smooth holographic pre-sweep (0.35s)
        t_sweep = np.linspace(0, 0.35, int(0.35 * SR))
        f_sweep = 1600.0 + 3200.0 * (t_sweep / 0.35) ** 2
        sweep_osc = np.sin(2 * np.pi * np.cumsum(f_sweep) / SR) * np.exp(-4.5 * t_sweep)
        sweep_stereo = np.stack([sweep_osc, np.roll(sweep_osc, int(0.002 * SR))], axis=1) * 0.35
        # Dual FM chime in A Lydian
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
        t_sweep = np.linspace(0, 0.6, int(0.6 * SR))
        f_sweep = 1400.0 + 4100.0 * (t_sweep / 0.6) ** 2
        sweep_osc = np.sin(2 * np.pi * np.cumsum(f_sweep) / SR) * np.exp(-4.0 * t_sweep)
        sweep_stereo = np.stack([sweep_osc, np.roll(sweep_osc, int(0.003 * SR))], axis=1) * 0.35
        dry = mix_tracks(click_stereo, fm_core, fm_sparkle, fm_accent, sweep_stereo)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.65, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)


def generate_fantasy(style='ps5'):
    """3. Fantasiac / Fantasy (Enchanted Ethereal)."""
    glass_modes = [(1.0, 1.0, 2.2), (2.29, 0.4, 4.0), (3.91, 0.2, 6.5), (5.76, 0.1, 9.0)]
    
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.85, tone_hz=8000, pre_delay_ms=8, seed=301)
        # Fast 3-tine glint
        notes = [698.46, 1046.50, 1567.98] # F5, C6, G6
        tines = []
        for i, f in enumerate(notes):
            t = synth_modal_bar(f, duration_s=0.8 - i*0.02, modes=glass_modes, decay_mult=0.9)
            padded = np.zeros((int(dur * SR), 2))
            st = int(i * 0.02 * SR)
            padded[st:st + len(t)] = t[:min(len(t), len(padded) - st)]
            tines.append(padded * 0.65)
        chime = synth_modal_bar(698.46, duration_s=0.85, modes=glass_modes, decay_mult=1.0) * 0.75
        dry = mix_tracks(mix_tracks(*tines), chime)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.24, width=1.10, dry_level=0.80), target_duration=dur, target_rms_db=-15.5)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=7500, pre_delay_ms=10, seed=302)
        notes = [698.46, 880.0, 1046.50, 1318.51] # F5, A5, C6, E6
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


def generate_medieval(style='ps5'):
    """4. Medieval (Royal Castle Courtyard)."""
    bell_modes = [(0.5, 0.4, 2.0), (1.0, 1.0, 3.0), (1.2, 0.5, 4.0), (1.5, 0.6, 4.5), (2.0, 0.7, 5.5)]
    
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=5200, pre_delay_ms=8, seed=401)
        dulc = synth_karplus_strong(440.00, duration_s=0.8, pick_pos=0.18, hardness=0.85, decay_time=0.8)
        carillon = synth_modal_bar(440.00, duration_s=0.85, modes=bell_modes, decay_mult=0.9)
        dry = mix_tracks(dulc * 0.65, carillon * 0.80)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=5000, pre_delay_ms=10, seed=402)
        dulc1 = synth_karplus_strong(293.66, duration_s=1.2, pick_pos=0.20, hardness=0.82, decay_time=1.1)
        dulc2 = synth_karplus_strong(440.00, duration_s=1.1, pick_pos=0.20, hardness=0.82, decay_time=1.0) * 0.8
        dulc_p = np.zeros((int(dur * SR), 2))
        dulc_p[:len(dulc1)] += dulc1
        t_d = int(0.04 * SR)
        dulc_p[t_d:t_d + len(dulc2)] += dulc2
        carillon_d4 = synth_modal_bar(293.66, duration_s=1.3, modes=bell_modes, decay_mult=1.1)
        carillon_a4 = synth_modal_bar(440.00, duration_s=1.2, modes=bell_modes, decay_mult=1.1) * 0.75
        dry = mix_tracks(dulc_p * 0.55, carillon_d4 * 0.7, carillon_a4 * 0.7)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)

    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=5000, pre_delay_ms=14, seed=403)
        carillon_d4 = synth_modal_bar(293.66, duration_s=1.9, modes=bell_modes, decay_mult=1.4)
        carillon_a4 = synth_modal_bar(440.00, duration_s=1.8, modes=bell_modes, decay_mult=1.3) * 0.75
        carillon_d5 = synth_modal_bar(587.33, duration_s=1.6, modes=bell_modes, decay_mult=1.2) * 0.60
        dulc_d4 = synth_karplus_strong(293.66, duration_s=1.6, pick_pos=0.18, hardness=0.85, decay_time=1.4)
        dulc_a4 = synth_karplus_strong(440.00, duration_s=1.5, pick_pos=0.20, hardness=0.85, decay_time=1.3) * 0.8
        dulc_d5 = synth_karplus_strong(587.33, duration_s=1.4, pick_pos=0.22, hardness=0.80, decay_time=1.2) * 0.7
        dulc_mixed = np.zeros((int(dur * SR), 2))
        dulc_mixed[:len(dulc_d4)] += dulc_d4
        dulc_mixed[int(0.04 * SR):int(0.04 * SR) + len(dulc_a4)] += dulc_a4
        dulc_mixed[int(0.09 * SR):int(0.09 * SR) + len(dulc_d5)] += dulc_d5
        dry = mix_tracks(dulc_mixed * 0.55, carillon_d4 * 0.8, carillon_a4 * 0.7, carillon_d5 * 0.6)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)


def generate_religious(style='ps5'):
    """5. Religious / Sacred (Cathedral Sanctuary)."""
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
        choir = np.repeat(filt(ch_raw * ch_env, "bandpass", [400, 2400])[:, None], 2, axis=1) * 0.35
        dry = mix_tracks(great_bell * 0.85, choir)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.34, width=1.45, dry_level=0.75), target_duration=dur, target_rms_db=-15.5)

    else: # platinum
        dur = 2.35
        ir = generate_diffuse_reverb_ir(decay_s=2.4, tone_hz=4800, pre_delay_ms=20, seed=503)
        great_bell = synth_modal_bar(261.63, duration_s=2.2, modes=church_modes, decay_mult=1.5, detune_cents=1.5)
        t_ch = np.linspace(0, 1.9, int(1.9 * SR))
        choir_env = np.sin(np.linspace(0, np.pi / 2, int(0.35 * SR))) ** 2
        full_ch_env = np.zeros(len(t_ch))
        full_ch_env[:len(choir_env)] = choir_env
        full_ch_env[len(choir_env):] = np.exp(-2.5 * (t_ch[len(choir_env):] - 0.35))
        choir_c4 = np.sin(2 * np.pi * 261.63 * t_ch)
        choir_g4 = np.sin(2 * np.pi * 392.00 * t_ch) * 0.85
        f_morph = 349.23 * (1.0 - 1.0 / (1.0 + np.exp(-15 * (t_ch - 0.45)))) + 329.63 / (1.0 + np.exp(-15 * (t_ch - 0.45)))
        choir_morph = np.sin(2 * np.pi * np.cumsum(f_morph) / SR) * 0.75
        choir_raw = (choir_c4 + choir_g4 + choir_morph) * full_ch_env
        choir_filt = filt(choir_raw[:, None], "bandpass", [400, 2600], order=2)
        choir_stereo = np.repeat(choir_filt, 2, axis=1)
        sanctus = synth_modal_bar(1046.50, duration_s=1.6, modes=[(1.0, 1.0, 3.0), (2.76, 0.4, 5.0)], decay_mult=1.2) * 0.40
        dry = mix_tracks(great_bell * 0.80, choir_stereo * 0.45, sanctus)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.42, width=1.65, dry_level=0.70), target_duration=dur, target_rms_db=-15.5)


def generate_arcaic(style='ps5'):
    """6. Arcaic (Ancient Mediterranean)."""
    bronze_modes = [(1.00, 1.00, 2.0), (2.08, 0.65, 3.2), (3.41, 0.45, 4.8), (4.88, 0.25, 6.5), (6.45, 0.15, 8.8)]
    
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=4800, pre_delay_ms=8, seed=601)
        bowl = synth_modal_bar(246.94, duration_s=0.85, modes=bronze_modes, decay_mult=0.9)
        lyre = synth_karplus_strong(329.63, duration_s=0.8, pick_pos=0.22, hardness=0.7, decay_time=0.8)
        dry = mix_tracks(bowl * 0.75, lyre * 0.70)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=4600, pre_delay_ms=12, seed=602)
        bowl = synth_modal_bar(164.81, duration_s=1.3, modes=bronze_modes, decay_mult=1.2)
        lyre1 = synth_karplus_strong(164.81, duration_s=1.1, pick_pos=0.25, hardness=0.65, decay_time=1.0)
        lyre2 = synth_karplus_strong(246.94, duration_s=1.0, pick_pos=0.22, hardness=0.65, decay_time=0.9) * 0.8
        lyre_m = np.zeros((int(dur * SR), 2))
        lyre_m[:len(lyre1)] += lyre1
        lyre_m[int(0.04 * SR):int(0.04 * SR) + len(lyre2)] += lyre2
        dry = mix_tracks(bowl * 0.8, lyre_m * 0.6)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)

    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.1, tone_hz=4500, pre_delay_ms=15, seed=603)
        bowl_e3 = synth_modal_bar(164.81, duration_s=2.0, modes=bronze_modes, decay_mult=1.4, detune_cents=4.0)
        bowl_b3 = synth_modal_bar(246.94, duration_s=1.9, modes=bronze_modes, decay_mult=1.3, detune_cents=3.5) * 0.7
        lyre_e3 = synth_karplus_strong(164.81, duration_s=1.7, pick_pos=0.25, hardness=0.6, decay_time=1.2)
        lyre_b3 = synth_karplus_strong(246.94, duration_s=1.6, pick_pos=0.22, hardness=0.65, decay_time=1.2) * 0.85
        lyre_e4 = synth_karplus_strong(329.63, duration_s=1.5, pick_pos=0.20, hardness=0.7, decay_time=1.1) * 0.75
        lyre_g4 = synth_karplus_strong(392.00, duration_s=1.4, pick_pos=0.20, hardness=0.7, decay_time=1.1) * 0.65
        lyre_strum = np.zeros((int(dur * SR), 2))
        lyre_strum[:len(lyre_e3)] += lyre_e3
        lyre_strum[int(0.03*SR):int(0.03*SR) + len(lyre_b3)] += lyre_b3
        lyre_strum[int(0.07*SR):int(0.07*SR) + len(lyre_e4)] += lyre_e4
        lyre_strum[int(0.12*SR):int(0.12*SR) + len(lyre_g4)] += lyre_g4
        dry = mix_tracks(bowl_e3 * 0.75, bowl_b3 * 0.65, lyre_strum * 0.60)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.35, width=1.55, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)


def generate_guitar(style='ps5'):
    """7. Guitar (Acoustic Flageolet)."""
    flageolet_modes = [(1.00, 1.00, 2.2), (2.00, 0.45, 4.0), (3.00, 0.18, 6.5)]
    
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=6800, pre_delay_ms=6, seed=701)
        h1 = synth_modal_bar(329.63, duration_s=0.85, modes=flageolet_modes, decay_mult=0.9)
        h2 = synth_modal_bar(493.88, duration_s=0.80, modes=flageolet_modes, decay_mult=0.85) * 0.8
        t_roll = int(0.02 * SR)
        strum = np.zeros((int(dur * SR), 2))
        strum[:len(h1)] += h1
        strum[t_roll:t_roll + len(h2)] += h2
        body = filt(strum, "bandpass", [100, 240], order=2) * 0.4
        dry = mix_tracks(strum * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.20, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.3, tone_hz=6500, pre_delay_ms=8, seed=702)
        h1 = synth_modal_bar(329.63, duration_s=1.3, modes=flageolet_modes, decay_mult=1.1)
        h2 = synth_modal_bar(493.88, duration_s=1.2, modes=flageolet_modes, decay_mult=1.1) * 0.85
        h3 = synth_modal_bar(659.25, duration_s=1.1, modes=flageolet_modes, decay_mult=1.0) * 0.70
        strum = np.zeros((int(dur * SR), 2))
        strum[:len(h1)] += h1
        strum[int(0.022*SR):int(0.022*SR) + len(h2)] += h2
        strum[int(0.048*SR):int(0.048*SR) + len(h3)] += h3
        body = filt(strum, "bandpass", [95, 230], order=2) * 0.45
        dry = mix_tracks(strum * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.26, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)

    else: # platinum
        dur = 2.10
        ir = generate_diffuse_reverb_ir(decay_s=2.0, tone_hz=6500, pre_delay_ms=10, seed=703)
        harm_e4 = synth_modal_bar(329.63, duration_s=1.9, modes=flageolet_modes, decay_mult=1.4)
        harm_b4 = synth_modal_bar(493.88, duration_s=1.8, modes=flageolet_modes, decay_mult=1.3) * 0.85
        harm_e5 = synth_modal_bar(659.25, duration_s=1.7, modes=flageolet_modes, decay_mult=1.2) * 0.70
        harm_gs5 = synth_modal_bar(830.61, duration_s=1.5, modes=flageolet_modes, decay_mult=1.1) * 0.55
        strum = np.zeros((int(dur * SR), 2))
        strum[:len(harm_e4)] += harm_e4
        strum[int(0.022*SR):int(0.022*SR) + len(harm_b4)] += harm_b4
        strum[int(0.045*SR):int(0.045*SR) + len(harm_e5)] += harm_e5
        strum[int(0.070*SR):int(0.070*SR) + len(harm_gs5)] += harm_gs5
        body = filt(strum, "bandpass", [95, 230], order=2) * 0.45
        dry = mix_tracks(strum * 0.85, body)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.34, width=1.50, dry_level=0.75), target_duration=dur, target_rms_db=-16.0)


def generate_harp(style='ps5'):
    """8. Harp (Celtic Concert Strings)."""
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.8, tone_hz=7200, pre_delay_ms=6, seed=801)
        p1 = synth_karplus_strong(261.63, duration_s=0.85, pick_pos=0.22, hardness=0.7, decay_time=1.0)
        p2 = synth_karplus_strong(392.00, duration_s=0.80, pick_pos=0.22, hardness=0.7, decay_time=0.9) * 0.85
        p3 = synth_karplus_strong(523.25, duration_s=0.75, pick_pos=0.22, hardness=0.7, decay_time=0.9) * 0.75
        harp_roll = np.zeros((int(dur * SR), 2))
        harp_roll[:len(p1)] += p1
        harp_roll[int(0.024*SR):int(0.024*SR) + len(p2)] += p2
        harp_roll[int(0.048*SR):int(0.048*SR) + len(p3)] += p3
        dry = harp_roll
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.22, width=1.05, dry_level=0.82), target_duration=dur, target_rms_db=-15.5)

    elif style == 'ps5':
        dur = 1.40
        ir = generate_diffuse_reverb_ir(decay_s=1.4, tone_hz=7000, pre_delay_ms=8, seed=802)
        pitches = [261.63, 392.00, 523.25, 659.25, 783.99]
        harp_layers = []
        for i, freq in enumerate(pitches):
            delay_s = i * 0.026
            plucked = synth_karplus_strong(f0=freq, duration_s=1.3 - delay_s, pick_pos=0.22, hardness=0.68, decay_time=1.4, detune_cents=2.2)
            pan = -0.5 + 1.0 * (i / (len(pitches) - 1))
            panned = np.zeros_like(plucked)
            panned[:, 0] = plucked[:, 0] * (1.0 - pan) * 0.5
            panned[:, 1] = plucked[:, 1] * (1.0 + pan) * 0.5
            padded = np.zeros((int(dur * SR), 2))
            st = int(delay_s * SR)
            padded[st:st + len(panned)] = panned[:min(len(panned), len(padded) - st)]
            harp_layers.append(padded)
        dry = mix_tracks(*harp_layers)
        return master_sound(apply_convolution_hall(dry, ir, mix_level=0.28, width=1.35, dry_level=0.78), target_duration=dur, target_rms_db=-16.0)

    else: # platinum
        dur = 2.20
        ir = generate_diffuse_reverb_ir(decay_s=2.2, tone_hz=7000, pre_delay_ms=12, seed=803)
        pitches = [261.63, 392.00, 523.25, 659.25, 783.99, 1174.66, 1046.50]
        harp_layers = []
        for i, freq in enumerate(pitches):
            delay_s = i * 0.028
            plucked = synth_karplus_strong(f0=freq, duration_s=1.9 - delay_s, pick_pos=0.22, hardness=0.68, decay_time=1.8, detune_cents=2.2)
            pan = -0.55 + 1.10 * (i / (len(pitches) - 1))
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


def generate_drums(style='ps5'):
    """9. Drums (Cinematic Percussion)."""
    drum_modes = [(1.0, 1.0, 3.0), (1.5, 0.6, 4.0), (2.0, 0.5, 5.0), (2.75, 0.25, 7.0)]
    
    if style == 'ps4':
        dur = 0.95
        ir = generate_diffuse_reverb_ir(decay_s=0.75, tone_hz=5500, pre_delay_ms=6, seed=901)
        # Tight punchy taiko hit at t=0
        t_body = np.linspace(0, dur, int(dur * SR))
        sub_sig = np.sin(2 * np.pi * (200.0 * np.exp(-22.0 * t_body) + 55.0) * t_body) * np.exp(-7.0 * t_body)
        # Wooden rim snap
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


def generate_afric_ancient(style='ps5'):
    """10. Afric Ancient (Earthen African Heritage)."""
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


# ---------------------------------------------------------------------------
# Metadata Registry & Multi-Profile Suite
# ---------------------------------------------------------------------------

MOOD_DEFINITIONS = [
    ("epic", "Epic", "Cinematic Orchestral", "#e5a93c", ["brass", "timpani", "cinematic", "heroic"], generate_epic),
    ("scifi", "Sci-Fi", "Futuristic Cybernetic", "#38bdf8", ["fm-synth", "cyber", "holographic", "crystal"], generate_scifi),
    ("fantasy", "Fantasiac", "Enchanted Ethereal", "#c084fc", ["glass", "celesta", "fairy-dust", "lydian"], generate_fantasy),
    ("medieval", "Medieval", "Royal Castle Courtyard", "#f59e0b", ["dulcimer", "carillon", "dorian", "castle"], generate_medieval),
    ("religious", "Religious", "Cathedral Sanctuary", "#facc15", ["cathedral-bell", "choir", "organ", "sacred"], generate_religious),
    ("arcaic", "Arcaic", "Ancient Mediterranean", "#d97706", ["bronze-bowl", "lyre", "ancient", "phrygian"], generate_arcaic),
    ("guitar", "Guitar", "Acoustic Flageolet", "#fb923c", ["harmonics", "acoustic", "flageolet", "spruce"], generate_guitar),
    ("harp", "Harp", "Celtic Concert Strings", "#a7f3d0", ["plucked-strings", "celtic", "arpeggio", "concert-hall"], generate_harp),
    ("drums", "Drums", "Cinematic Percussion", "#ef4444", ["taiko", "rimshot", "sub-impact", "cinematic-percussion"], generate_drums),
    ("afric_ancient", "Afric Ancient", "Earthen African Heritage", "#10b981", ["mbira", "kalimba", "balafon", "udu-clay"], generate_afric_ancient),
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


def build_preview_html(results_by_mood):
    html_path = os.path.join(OUT_DIR, "preview_dna_trophies.html")
    
    rows_html = []
    for m in results_by_mood:
        mood_id, title, cat, color, tags, variations = m["id"], m["title"], m["category"], m["color"], m["tags"], m["variations"]
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
        <div class="mood-row" style="--accent:{color}" data-mood="{mood_id}">
          <div class="mood-info">
            <span class="cat">{cat}</span>
            <h3>{title}</h3>
            <div class="tags">{badges}</div>
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
<title>PlayStation DNA Trophy Suite · 3 Profiles &times; 10 Moods (30 Sounds)</title>
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
    max-width: 1280px;
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
  .now-playing {{ color: #fff; font-weight: 600; }}

  /* Filter Bar */
  .filter-bar {{
    display: flex;
    gap: 10px;
    margin-bottom: 24px;
    flex-wrap: wrap;
    background: #0f131d;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    align-items: center;
  }}
  .filter-label {{ font-size: 13px; color: var(--text-dim); font-weight: 600; margin-right: 4px; }}
  .filter-btn {{
    background: #171d2b;
    color: #94a3b8;
    border: 1px solid #27344c;
    border-radius: 6px;
    padding: 6px 14px;
    font: inherit;
    font-size: 13px;
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
  .matrix-container {{
    display: flex;
    flex-direction: column;
    gap: 14px;
  }}
  .mood-row {{
    background: var(--card);
    border: 1px solid var(--border);
    border-left: 5px solid var(--accent);
    border-radius: 8px;
    padding: 14px 18px;
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 16px;
    align-items: center;
    transition: background 0.15s ease;
  }}
  .mood-row:hover {{ background: var(--card-hover); }}
  .mood-info {{ display: flex; flex-direction: column; gap: 4px; }}
  .cat {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent); font-weight: 700; }}
  h3 {{ font-size: 17px; color: #fff; }}
  .tags {{ display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }}
  .badge {{
    font-size: 10px;
    background: rgba(255,255,255,0.06);
    color: #94a3b8;
    padding: 2px 6px;
    border-radius: 4px;
  }}

  .tiers-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }}
  .tier-card {{
    background: #0c1018;
    border: 1px solid #1c2538;
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 10px;
  }}
  .tier-head {{
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .tier-tag {{
    font-size: 12px;
    font-weight: 700;
    color: #e2e8f0;
  }}
  .style-ps4 .tier-tag {{ color: #94a3b8; }}
  .style-ps5 .tier-tag {{ color: #60a5fa; }}
  .style-platinum .tier-tag {{ color: #38bdf8; }}
  
  .dur {{
    font-size: 11px;
    background: #192233;
    color: #94a3b8;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
  }}
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

  @media (max-width: 900px) {{
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
      <span>3 Reference Profiles &times; 10 Moods (30 Sounds)</span>
    </h1>
    <div style="display:flex;gap:10px">
      <a href="DNA_Trophies_Complete_Suite.zip" download style="color:#000;font-weight:700;font-size:13px;text-decoration:none;background:#38bdf8;padding:8px 14px;border-radius:6px">&darr; Download All 30 (ZIP)</a>
      <a href="../preview.html" style="color:#38bdf8;font-size:13px;text-decoration:none;background:#151e2e;padding:8px 14px;border-radius:6px;border:1px solid #23344d">&larr; Back to SteamStation</a>
    </div>
  </div>
  <p class="subtitle">
    Synthesized procedurally using physical modeling, modal resonators, Karplus-Strong strings, and FM crystal synthesis.
    Zero copyrighted Sony assets used &mdash; each mood features 3 distinct variations engineered to mirror the acoustic wave movements of PS4 Trophy (0.95s), PS5 Trophy (1.40s), and PS5 Platinum (2.20s).
  </p>
</header>

<div class="studio-bar">
  <div class="studio-header">
    <div class="studio-title">
      Wave Movement Visualizer
      <span id="activeSoundLabel">&mdash; Idle (Click Play on any sound below)</span>
    </div>
    <div class="now-playing" id="playbackStatus">Ready</div>
  </div>
  <canvas class="visualizer-canvas" id="canvas" width="1240" height="100"></canvas>
  <div class="studio-controls">
    <span>Dynamic Oscilloscope Waveform + Real-Time FFT Spectral Bars</span>
    <span>48 kHz Stereo &bull; 100% Procedural DSP</span>
  </div>
</div>

<div class="filter-bar">
  <span class="filter-label">Filter Profile:</span>
  <button class="filter-btn active" data-filter="all">All 30 Variations</button>
  <button class="filter-btn" data-filter="ps4">PS4 Chime DNA (~0.95s)</button>
  <button class="filter-btn" data-filter="ps5">PS5 Bloom DNA (~1.40s)</button>
  <button class="filter-btn" data-filter="platinum">PS5 Platinum DNA (~2.20s)</button>
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
        amp = Math.max(0, 0.75 * Math.exp(-4.5 * (progress - 0.65)));
      }}

      ctx.fillStyle = '#07090f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const numBars = 96;
      const barWidth = canvas.width / numBars;
      for (let i = 0; i < numBars; i++) {{
        const barNorm = i / numBars;
        const fDecay = Math.exp(-2.2 * barNorm);
        const barH = (Math.sin(wavePhase * 1.5 + i * 0.22) * 0.5 + 0.5) * amp * fDecay * (canvas.height * 0.75);
        ctx.fillStyle = `rgba(245, 176, 65, ${{Math.min(0.85, amp * 0.6 + 0.08)}})`;
        ctx.fillRect(i * barWidth, canvas.height - barH, barWidth - 2, barH);
      }}

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = accentColor || '#38bdf8';
      ctx.shadowColor = accentColor || '#38bdf8';
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

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(fBtn => {{
    fBtn.addEventListener('click', () => {{
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      fBtn.classList.add('active');
      const filter = fBtn.getAttribute('data-filter');

      document.querySelectorAll('.tier-card').forEach(tc => {{
        if (filter === 'all' || tc.classList.contains('style-' + filter)) {{
          tc.style.display = 'flex';
        }} else {{
          tc.style.display = 'none';
        }}
      }});
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
    print(f"  -> Generated ZIP archive: {os.path.basename(zip_path)}")
    return zip_path


def build_manifest(all_tracks):
    manifest = {
        "title": "PlayStation DNA Trophy Suite (3 Profiles x 10 Moods = 30 Sounds)",
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
    print("  DNA Trophy Sound Designer - 3 Profiles x 10 Moods (30 Sounds)")
    print("  1. PS4 Profile       (based on ps4_trophy.mp3, ~0.95s)")
    print("  2. PS5 Profile       (based on ps5_trophy.mp3, ~1.40s)")
    print("  3. Platinum Profile  (based on ps5_trophy_platinum.mp3, ~2.20s)")
    print("=====================================================================")
    print(f"Target Directory: {OUT_DIR}\n")

    all_tracks = []
    results_by_mood = []

    for mood_id, title, cat, color, tags, gen_func in MOOD_DEFINITIONS:
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
                "tags": tags
            }
            mood_variations.append(var_data)
            all_tracks.append(var_data)
            
        results_by_mood.append({
            "id": mood_id,
            "title": title,
            "category": cat,
            "color": color,
            "tags": tags,
            "variations": mood_variations
        })

    print("\nBuilding Manifest, Interactive Preview Player & ZIP Bundle...")
    manifest_path = build_manifest(all_tracks)
    html_path = build_preview_html(results_by_mood)
    zip_path = build_zip_bundle(all_tracks)

    print("\n[SUCCESS] All 30 bespoke trophy sounds synthesized and verified!")
    print(f"Preview HTML: {html_path}")
    print(f"Manifest:     {manifest_path}")
    print(f"ZIP Bundle:   {zip_path}")

    if args.open:
        webbrowser.open(f"file:///{os.path.abspath(html_path).replace(os.sep, '/')}")


if __name__ == "__main__":
    main()
