#!/usr/bin/env python3
"""Hybrid Sound Designer for SteamStation Achievement Audio.

Deconstructs Steam UI sounds and PlayStation (PS4/PS5) trophy chimes into their
frequency bands, acoustic envelopes, and melodic intervals, then recombines them
using four hybrid sound design approaches:

  Approach A: Frequency & Envelope Split (Snappy Steam transient -> PS crystalline shimmer)
  Approach B: Timbre Swap (Steam melody played with PlayStation bell timbre & tail)
  Approach C1: Impulse Response Convolution (Steam click rings through PS acoustic resonator)
  Approach C2: Spectral Cross-Synthesis (PS bell carrier modulated by Steam dynamic envelope)
  Approach D: Master SteamStation Hybrid (Complete multi-layer integration with spatial stereo)

Usage:
  python hybrid_sound_designer.py                      # Random Steam + Random PS sound
  python hybrid_sound_designer.py --random             # Explicitly random pair
  python hybrid_sound_designer.py --steam desktop_toast_default.wav --ps ps5_trophy.mp3
  python hybrid_sound_designer.py --count 3            # Generate 3 random combinations
  python hybrid_sound_designer.py --all-combinations   # Render every Steam x PS pair
  python hybrid_sound_designer.py --open               # Open preview player in browser
"""

import os
import sys
import json
import random
import zipfile
import argparse
import subprocess
import webbrowser
import numpy as np
import imageio_ffmpeg
from scipy.signal import butter, sosfilt, fftconvolve, stft, istft, find_peaks
from scipy.ndimage import gaussian_filter1d

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
THEME_DIR = os.path.dirname(HERE)
DEFAULT_OUT_DIR = os.path.join(HERE, "hybrids")
FF = imageio_ffmpeg.get_ffmpeg_exe()

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CONSONANT_INTERVALS = [0, 3, 4, 5, 7, 8, 9, 12]  # Unison, m3, M3, P4, P5, m6, M6, Octave


def hz_to_note_str(hz):
    """Converts a frequency in Hz to musical note string, e.g. 523.2 Hz -> C5."""
    if hz <= 0:
        return "Unknown"
    midi = 69 + 12 * np.log2(hz / 440.0)
    note_idx = int(round(midi)) % 12
    octave = int(round(midi)) // 12 - 1
    cents = int(round((midi - round(midi)) * 100))
    cents_str = f"{cents:+d}c" if abs(cents) > 2 else ""
    return f"{NOTE_NAMES[note_idx]}{octave} ({hz:.1f} Hz {cents_str})".strip()


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


def pitch_shift_resample(x, semitones):
    """High-quality band-limited resampling pitch shifter."""
    if abs(semitones) < 0.04:
        return x.copy()
    ratio = 2.0 ** (semitones / 12.0)
    old_len = len(x)
    new_len = max(1, int(old_len / ratio))
    t_old = np.linspace(0, old_len - 1, old_len)
    t_new = np.linspace(0, old_len - 1, new_len)
    out = np.zeros((new_len, x.shape[1]), dtype=np.float64)
    for c in range(x.shape[1]):
        out[:, c] = np.interp(t_new, t_old, x[:, c])
    return out


def detect_dominant_pitch(x, fmin=200, fmax=2500):
    """Finds the dominant fundamental frequency using Hann-windowed FFT and peak analysis."""
    mono = x.mean(axis=1) if x.ndim > 1 else x
    win = min(len(mono), int(0.15 * SR))
    chunk = mono[:win] * np.hanning(win)
    fft = np.abs(np.fft.rfft(chunk, n=16384))
    freqs = np.fft.rfftfreq(16384, 1 / SR)
    mask = (freqs >= fmin) & (freqs <= fmax)
    peaks, props = find_peaks(fft[mask], height=np.max(fft[mask]) * 0.25)
    if len(peaks) > 0:
        return freqs[mask][peaks[np.argmax(props["peak_heights"])]]
    return freqs[mask][np.argmax(fft[mask])]


def tune_to_consonant_interval(f_steam, f_ps):
    """Calculates semitones shift needed to resolve Steam and PS tones to a consonant musical interval."""
    raw_semis = 12 * np.log2(f_ps / f_steam)
    octaves = np.floor(raw_semis / 12)
    interval = raw_semis % 12
    closest_consonant = min(CONSONANT_INTERVALS, key=lambda c: abs(c - interval))
    target_semis = octaves * 12 + closest_consonant
    shift_needed = target_semis - raw_semis
    interval_names = {
        0: "Unison",
        3: "Minor 3rd",
        4: "Major 3rd",
        5: "Perfect 4th",
        7: "Perfect 5th",
        8: "Minor 6th",
        9: "Major 6th",
        12: "Octave",
    }
    rel_name = interval_names.get(int(closest_consonant), f"{closest_consonant} semitones")
    return shift_needed, rel_name, raw_semis, target_semis


def detect_onsets_and_notes(steam_audio):
    """Detects onset timestamps and frequencies of melodic notes in Steam audio."""
    mono = steam_audio.mean(axis=1)
    hop = int(0.005 * SR)  # 5ms frames
    win = int(0.015 * SR)
    n_frames = max(1, (len(mono) - win) // hop)
    energies = np.array([np.sqrt(np.mean(mono[i * hop : i * hop + win] ** 2)) for i in range(n_frames)])
    diff = np.maximum(0, np.diff(energies, prepend=0))
    diff /= np.max(diff) + 1e-8
    peaks, _ = find_peaks(diff, height=0.12, distance=int(0.05 / 0.005))
    onsets = peaks * hop / SR

    notes = []
    for t in onsets:
        idx = int(t * SR)
        chunk_len = min(len(mono) - idx, int(0.07 * SR))
        if chunk_len < int(0.02 * SR):
            continue
        chk = mono[idx : idx + chunk_len] * np.hanning(chunk_len)
        fft = np.abs(np.fft.rfft(chk, n=8192))
        frq = np.fft.rfftfreq(8192, 1 / SR)
        mask = (frq >= 200) & (frq <= 2500)
        if mask.any() and np.max(fft[mask]) > 1e-4:
            top_f = frq[mask][np.argmax(fft[mask])]
            amp = np.sqrt(np.mean(chk**2))
            notes.append((t, top_f, amp))

    if not notes:
        # Fallback single note at t=0
        notes = [(0.0, detect_dominant_pitch(steam_audio), 1.0)]
    return notes


def boost_steam_volume(x, boost_factor=1.70, max_peak_db=-0.2):
    """Boosts Steam UI sounds by at least 60% with musical soft saturation ceiling.

    Level-matches Steam's tactile attack and chime with PlayStation's loud trophy sounds,
    increasing Steam volume by at least +60% to +80% (+4.1 to +5.5 dB) without harsh clipping.
    """
    pk = np.abs(x).max()
    act = x[np.abs(x).max(1) > pk * 0.05]
    cur_rms = np.sqrt((act**2).mean()) if len(act) else 1e-4

    # Previous baseline gain (-1.0 dB / pk)
    base_gain = (10 ** (-1.0 / 20)) / max(pk, 1e-5)

    # Minimum 60% boost (+60% linear gain = 1.60x, default 1.70x for +70% energetic presence)
    gain = base_gain * boost_factor
    boosted = x * gain

    ceiling = 10 ** (max_peak_db / 20)  # 0.977 (-0.2 dBFS ceiling)

    # Musical tanh soft saturation if boosted signal drives past ceiling
    peak_boosted = np.abs(boosted).max()
    if peak_boosted > ceiling:
        boosted = np.tanh(boosted / ceiling * 1.1) / np.tanh(1.1) * ceiling

    actual_rms = np.sqrt((boosted[np.abs(boosted).max(1) > np.abs(boosted).max() * 0.05] ** 2).mean())
    actual_gain_db = 20 * np.log10(max(1e-5, actual_rms / cur_rms))
    return boosted, actual_gain_db


def isolate_transient(steam_audio, duration_ms=40, hp_freq=750):
    """Isolates the initial snappy tactile PC pop of Steam in mono, highpassed at 750 Hz."""
    t_len = int(duration_ms * 0.001 * SR)
    t_chunk = steam_audio[:t_len].copy()
    # Smooth cosine-squared window (flat for first 12ms, then fades to 0)
    flat_len = int(0.012 * SR)
    env = np.ones(len(t_chunk))
    if len(t_chunk) > flat_len:
        env[flat_len:] = np.cos(np.linspace(0, np.pi / 2, len(t_chunk) - flat_len)) ** 2
    t_chunk *= env[:, None]

    # Butterworth highpass to isolate tactile mechanical click
    sos = butter(3, hp_freq, "highpass", fs=SR, output="sos")
    t_chunk = sosfilt(sos, t_chunk, axis=0)

    # Center in mono (desktop notification behavior)
    mono = 0.5 * (t_chunk[:, 0] + t_chunk[:, 1])
    return np.stack([mono, mono], axis=1)


def isolate_shimmer(ps_audio, duck_ms=25, width_factor=1.35):
    """Ducks the PlayStation attack over 20-30ms to prevent transient collision and widens stereo shimmer."""
    out = ps_audio.copy()
    duck_len = int(duck_ms * 0.001 * SR)
    if len(out) > duck_len:
        duck_env = np.sin(np.linspace(0, np.pi / 2, duck_len)) ** 2
        out[:duck_len] *= duck_env[:, None]

    # Mid/Side stereo widening
    mid = (out[:, 0] + out[:, 1]) * 0.5
    side = (out[:, 0] - out[:, 1]) * 0.5 * width_factor
    return np.stack([mid + side, mid - side], axis=1)


def master_audio(x, target_rms_db=-15.5, max_dur=1.75, true_peak_db=-0.3):
    """Applies duration trimming, RMS loudness normalization, and soft limiting ceiling."""
    max_len = int(max_dur * SR)
    if len(x) > max_len:
        fade_len = int(0.25 * SR)
        x = x[:max_len].copy()
        x[-fade_len:] *= (np.cos(np.linspace(0, np.pi / 2, fade_len)) ** 2)[:, None]
    else:
        fade_len = int(0.12 * SR)
        x[-fade_len:] *= (np.cos(np.linspace(0, np.pi / 2, fade_len)) ** 2)[:, None]

    # RMS normalization across active portion
    act = x[np.abs(x).max(1) > np.abs(x).max() * 0.05]
    if len(act) > 0:
        cur_rms = np.sqrt((act**2).mean())
        if cur_rms > 1e-6:
            target_rms = 10 ** (target_rms_db / 20)
            x = x * (target_rms / cur_rms)

    # True-peak soft limiting via tanh saturation
    ceiling = 10 ** (true_peak_db / 20)
    pk = np.abs(x).max()
    if pk > ceiling * 0.8:
        x = np.tanh(x / pk * 1.45) / np.tanh(1.45) * ceiling
    return x


# ==============================================================================
# The Four Hybrid Approaches
# ==============================================================================


def build_approach_a_split(steam, ps_tuned):
    """Approach A: Frequency & Envelope Split (Cleanest Hybrid).

    Steam transient attack (0-40ms, highpassed at 750Hz, centered mono, +62% boosted punch)
    transitions instantly into PlayStation crystalline shimmer and stereo tail.
    """
    st_trans = isolate_transient(steam, duration_ms=40, hp_freq=750)
    ps_shim = isolate_shimmer(ps_tuned, duck_ms=25, width_factor=1.35)

    out_len = max(len(st_trans), len(ps_shim))
    out = np.zeros((out_len, 2), dtype=np.float64)
    # Steam tactile attack boosted by +62% (3.00x) over PlayStation shimmer (0.65x)
    out[: len(st_trans)] += st_trans * 3.00
    out[: len(ps_shim)] += ps_shim * 0.65
    return master_audio(out)


def build_approach_b_timbre_swap(steam, ps_tuned):
    """Approach B: Timbre Swap (Play Steam's Melody with PlayStation's Synth).

    Detects Steam's melodic notes/timing, layers Steam's tactile attack click,
    then triggers pitch-shifted PS bell strikes at Steam's exact rhythm,
    followed by the lush PlayStation stereo shimmer.
    """
    notes = detect_onsets_and_notes(steam)

    # Extract clean PS bell strike sample (first 250ms with exponential decay)
    strike_len = min(len(ps_tuned), int(0.25 * SR))
    strike = ps_tuned[:strike_len].copy()
    strike *= np.exp(-4.0 * np.linspace(0, 1, strike_len))[:, None]
    ps_base_pitch = detect_dominant_pitch(strike)

    # PlayStation sustained shimmer tail
    tail_start = min(len(ps_tuned), int(0.18 * SR))
    ps_tail = ps_tuned[tail_start:].copy()
    # Widen tail
    mid = (ps_tail[:, 0] + ps_tail[:, 1]) * 0.5
    side = (ps_tail[:, 0] - ps_tail[:, 1]) * 0.5 * 1.35
    ps_tail = np.stack([mid + side, mid - side], axis=1)

    total_len = int((notes[-1][0] if notes else 0) * SR) + len(ps_tail) + int(0.1 * SR)
    out = np.zeros((total_len, 2), dtype=np.float64)

    # Layer initial tactile click from Steam (+74% boosted punch)
    st_trans = isolate_transient(steam, duration_ms=30, hp_freq=800)
    out[: len(st_trans)] += st_trans * 1.65

    for t, f, amp in notes:
        semis = 12 * np.log2(f / ps_base_pitch)
        shifted = pitch_shift_resample(strike, semis)
        i = int(t * SR)
        end = min(total_len, i + len(shifted))
        out[i:end] += shifted[: end - i] * 0.85

    # Bloom with PlayStation shimmer reverb tail after the final note
    last_i = int((notes[-1][0] if notes else 0.1) * SR)
    end_tail = min(total_len, last_i + len(ps_tail))
    out[last_i:end_tail] += ps_tail[: end_tail - last_i] * 0.70

    return master_audio(out)


def build_approach_c1_convolution(steam, ps_tuned):
    """Approach C1: Impulse Response Convolution.

    Steam's boosted sound (+70% dry presence) is convolved with the PlayStation shimmer IR.
    The tactile Steam click rings out through the acoustic geometry and resonance of PS.
    """
    # Extract clean IR from PS shimmer (after initial transient)
    ir_start = min(len(ps_tuned) - 100, int(0.05 * SR))
    ir = ps_tuned[ir_start:].copy()
    ir *= np.exp(-3.5 * np.linspace(0, 1, len(ir)))[:, None]
    ir /= np.sqrt((ir**2).sum(axis=0, keepdims=True)) + 1e-8

    conv_l = fftconvolve(steam[:, 0], ir[:, 0])
    conv_r = fftconvolve(steam[:, 1], ir[:, 1])
    conv = np.stack([conv_l, conv_r], axis=1)

    out = np.zeros((max(len(steam), len(conv)), 2), dtype=np.float64)
    out[: len(steam)] += steam * 1.45  # dry punchy Steam click (+70% boost)
    out[: len(conv)] += conv * 0.35  # wet acoustic convolution
    return master_audio(out)


def build_approach_c2_spectral(steam, ps_tuned):
    """Approach C2: Spectral Cross-Synthesis / Vocoding.

    Run PlayStation bell as the harmonic carrier and Steam envelope/transient as the modulator.
    """
    n_pts = min(len(steam), len(ps_tuned))
    f, t, Z_s = stft(steam[:n_pts].T, fs=SR, nperseg=1024, noverlap=768)
    _, _, Z_p = stft(ps_tuned[:n_pts].T, fs=SR, nperseg=1024, noverlap=768)

    mag_s = np.abs(Z_s)
    mag_p = np.abs(Z_p)
    phase_p = np.angle(Z_p)

    # Smooth Steam spectral envelope across frequency bins
    env_s = gaussian_filter1d(mag_s, sigma=4, axis=1)
    env_s /= np.max(env_s, axis=(1, 2), keepdims=True) + 1e-8

    Z_cross = (mag_p * (env_s**0.65)) * np.exp(1j * phase_p)
    _, voc = istft(Z_cross, fs=SR, nperseg=1024, noverlap=768)
    out = voc.T.copy()

    # Blend tactile pop at the onset (+78% boosted punch)
    st_trans = isolate_transient(steam, duration_ms=30, hp_freq=800)
    out_len = max(len(out), len(st_trans))
    res = np.zeros((out_len, 2), dtype=np.float64)
    res[: len(out)] += out
    res[: len(st_trans)] += st_trans * 1.25
    return master_audio(res)


def build_approach_d_master(steam, ps_tuned):
    """Approach D: Master SteamStation Hybrid.

    The ultimate hybrid integrating all four methods:
      1. Monophonic tactile Steam transient punch (t = 0-40ms, +63% boosted)
      2. Key-matched and harmonized PlayStation bell body
      3. Subtle convolution resonance tail from the Steam click
      4. Expansive wide stereo PlayStation shimmer reverb
      5. Sidechain ducking for pristine zero-collision transient clarity.
    """
    st_trans = isolate_transient(steam, duration_ms=40, hp_freq=750)
    ps_shim = isolate_shimmer(ps_tuned, duck_ms=25, width_factor=1.40)

    # Subtle convolution glue
    ir_start = min(len(ps_tuned) - 100, int(0.06 * SR))
    ir = ps_tuned[ir_start:].copy()
    ir *= np.exp(-4.0 * np.linspace(0, 1, len(ir)))[:, None]
    ir /= np.sqrt((ir**2).sum(axis=0, keepdims=True)) + 1e-8
    conv_l = fftconvolve(steam[:, 0], ir[:, 0])
    conv_r = fftconvolve(steam[:, 1], ir[:, 1])
    conv = np.stack([conv_l, conv_r], axis=1)

    max_len = max(len(st_trans), len(ps_shim), len(conv))
    out = np.zeros((max_len, 2), dtype=np.float64)
    out[: len(st_trans)] += st_trans * 3.10  # Steam tactile pop (+63% boost)
    out[: len(ps_shim)] += ps_shim * 0.65  # PlayStation shimmer
    out[: len(conv)] += conv * 0.20  # Convolution glue

    return master_audio(out)


# ==============================================================================
# Rendering and File Writing
# ==============================================================================


def write_file(path_no_ext, audio_data):
    """Writes both .mp3 and .wav versions of the audio."""
    pcm = np.clip(audio_data, -1, 1).astype(np.float32).tobytes()
    mp3_path = path_no_ext + ".mp3"
    wav_path = path_no_ext + ".wav"

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


def discover_sources(theme_dir=THEME_DIR):
    """Finds all eligible Steam and PlayStation audio files in SteamStation folder."""
    steam_names = [
        "deck_ui_achievement_toast.wav",
        "deck_ui_launch_game.wav",
    ]
    ps_names = [
        "ps5_trophy.mp3",
        "ps5_trophy_platinum.mp3",
        "ps4_trophy.mp3",
    ]

    steam_files = [f for f in steam_names if os.path.isfile(os.path.join(theme_dir, f))]
    ps_files = [f for f in ps_names if os.path.isfile(os.path.join(theme_dir, f))]

    return steam_files, ps_files


def run_hybrid_combination(steam_fn, ps_fn, out_dir=DEFAULT_OUT_DIR, prefix=None):
    """Processes a chosen Steam file and PlayStation file into all 5 hybrid variations."""
    os.makedirs(out_dir, exist_ok=True)
    steam_path = os.path.join(THEME_DIR, steam_fn)
    ps_path = os.path.join(THEME_DIR, ps_fn)

    print(f"\n=======================================================")
    print(f"Hybridizing Sound Pair:")
    print(f"  Steam Source:       {steam_fn}")
    print(f"  PlayStation Source: {ps_fn}")

    s_base = os.path.splitext(steam_fn)[0]
    p_base = os.path.splitext(ps_fn)[0]
    tag = f"{prefix}_" if prefix else ""
    pair_id = f"{tag}{s_base}_X_{p_base}"

    steam_raw = load_audio(steam_path)
    ps = load_audio(ps_path)

    # Boost Steam sounds to level-match PlayStation's loudness
    steam, steam_boost_db = boost_steam_volume(steam_raw)
    boosted_steam_base = f"source_boosted_{s_base}"
    write_file(os.path.join(out_dir, boosted_steam_base), steam)

    # Key matching and harmonic analysis
    f_steam = detect_dominant_pitch(steam)
    f_ps = detect_dominant_pitch(ps)
    tune_shift, interval_name, raw_semis, target_semis = tune_to_consonant_interval(f_steam, f_ps)

    print(f"  Steam Fundamental:  {hz_to_note_str(f_steam)} (boosted {steam_boost_db:+.1f} dB to match PS)")
    print(f"  PS Fundamental:     {hz_to_note_str(f_ps)}")
    print(f"  Harmonic Interval:  {interval_name} ({raw_semis:+.1f} st -> tuned to {target_semis:+.1f} st, shift: {tune_shift:+.2f} st)")

    # Tune PS sound to consonant interval if needed
    ps_tuned = pitch_shift_resample(ps, tune_shift) if abs(tune_shift) > 0.08 else ps.copy()

    variations = [
        (
            "Approach A (Frequency & Envelope Split)",
            f"hybrid_A_split_{pair_id}",
            "Steam snappy tactile pop -> PlayStation crystalline shimmer & stereo tail",
            build_approach_a_split(steam, ps_tuned),
        ),
        (
            "Approach B (Timbre Swap / Melodic Synth)",
            f"hybrid_B_timbre_{pair_id}",
            "Steam melodic pattern played with PS bell timbre & blooming shimmer tail",
            build_approach_b_timbre_swap(steam, ps_tuned),
        ),
        (
            "Approach C1 (Impulse Response Convolution)",
            f"hybrid_C1_conv_{pair_id}",
            "Steam dry click rings through the acoustic geometry of PlayStation chime",
            build_approach_c1_convolution(steam, ps_tuned),
        ),
        (
            "Approach C2 (Spectral Cross-Synthesis)",
            f"hybrid_C2_spectral_{pair_id}",
            "PlayStation bell carrier modulated by Steam spectral dynamic envelope",
            build_approach_c2_spectral(steam, ps_tuned),
        ),
        (
            "Approach D (Master SteamStation Hybrid)",
            f"hybrid_D_master_{pair_id}",
            "Complete multi-layer master: tactile pop + tuned body + IR resonance + stereo shimmer",
            build_approach_d_master(steam, ps_tuned),
        ),
    ]

    rendered_items = []
    for label, base_name, desc, audio in variations:
        out_base = os.path.join(out_dir, base_name)
        mp3, wav = write_file(out_base, audio)
        dur = len(audio) / SR
        pk = np.abs(audio).max()
        rms = np.sqrt((audio**2).mean())
        print(f"  -> Generated: {base_name}.mp3 ({dur:.2f}s, pk={pk:.2f}, rms={rms:.3f})")
        rendered_items.append(
            {
                "label": label,
                "filename": base_name + ".mp3",
                "wav_filename": base_name + ".wav",
                "mp3_path": mp3,
                "wav_path": wav,
                "description": desc,
                "duration": round(dur, 2),
                "peak_db": round(float(20 * np.log10(max(1e-5, pk))), 1),
                "rms_db": round(float(20 * np.log10(max(1e-5, rms))), 1),
            }
        )

    # Return pair metadata for preview HTML
    return {
        "pair_id": pair_id,
        "steam_file": steam_fn,
        "steam_path": steam_path,
        "steam_note": hz_to_note_str(f_steam),
        "steam_boost_db": round(float(steam_boost_db), 1),
        "steam_boosted_mp3": f"{boosted_steam_base}.mp3",
        "steam_boosted_wav": f"{boosted_steam_base}.wav",
        "ps_file": ps_fn,
        "ps_path": ps_path,
        "ps_note": hz_to_note_str(f_ps),
        "harmonic_interval": interval_name,
        "tune_shift_semitones": round(float(tune_shift), 2),
        "variations": rendered_items,
    }


MANIFEST_PATH = os.path.join(HERE, "hybrids_manifest.json")


def load_manifest():
    """Loads previously saved hybrid pairs from manifest."""
    if os.path.isfile(MANIFEST_PATH):
        try:
            with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_manifest(manifest_data):
    """Saves hybrid pairs to manifest."""
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)


def clean_stale_hybrids(out_dir, active_steam_files):
    """Removes obsolete audio files from out_dir that don't belong to active Steam sources."""
    if not os.path.isdir(out_dir):
        return
    active_stems = [os.path.splitext(f)[0] for f in active_steam_files]
    for fn in os.listdir(out_dir):
        if not (fn.endswith(".mp3") or fn.endswith(".wav")):
            continue
        if fn.startswith("hybrid_") or fn.startswith("source_boosted_"):
            # Exclude legacy _pair prefix or non-matching stems
            if "_pair" in fn or not any(stem in fn for stem in active_stems):
                try:
                    os.remove(os.path.join(out_dir, fn))
                except Exception:
                    pass


def create_zip_packs(out_dir):
    """Builds downloadable ZIP packages of all MP3 and WAV hybrid audio files."""
    mp3_zip = os.path.join(out_dir, "SteamStation_Hybrids_MP3_Pack.zip")
    wav_zip = os.path.join(out_dir, "SteamStation_Hybrids_WAV_Pack.zip")

    mp3_count = 0
    wav_count = 0
    with zipfile.ZipFile(mp3_zip, "w", zipfile.ZIP_DEFLATED) as zm:
        for f in sorted(os.listdir(out_dir)):
            if f.endswith(".mp3"):
                zm.write(os.path.join(out_dir, f), arcname=f)
                mp3_count += 1

    with zipfile.ZipFile(wav_zip, "w", zipfile.ZIP_DEFLATED) as zw:
        for f in sorted(os.listdir(out_dir)):
            if f.endswith(".wav"):
                zw.write(os.path.join(out_dir, f), arcname=f)
                wav_count += 1

    print(f"\n[ZIP] Created ZIP Packages in {out_dir}:")
    print(f"  * MP3 Pack: {mp3_count} files ({os.path.getsize(mp3_zip)/1024/1024:.1f} MB) -> SteamStation_Hybrids_MP3_Pack.zip")
    print(f"  * WAV Pack: {wav_count} files ({os.path.getsize(wav_zip)/1024/1024:.1f} MB) -> SteamStation_Hybrids_WAV_Pack.zip")


def generate_preview_html(all_pairs, html_path, latest_pair_id=None):
    """Generates an interactive HTML preview page for instant comparison and evaluation."""
    json_data = json.dumps(all_pairs, indent=2)

    html_content = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SteamStation Hybrid Sound Evaluation</title>
<style>
  :root {{
    --bg: #0c0e14;
    --card: #141722;
    --card-hover: #1c2130;
    --border: #23293a;
    --accent: #0070d1;
    --accent-steam: #66c0f4;
    --accent-gold: #e5a93c;
    --accent-ps: #00439c;
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
  h1 span {{ font-size: 13px; font-weight: 500; background: #0070d133; color: var(--accent-steam); padding: 4px 10px; border-radius: 20px; border: 1px solid #0070d155; }}
  p.subtitle {{ color: var(--text-dim); margin-top: 6px; font-size: 14px; max-width: 850px; }}

  /* Toolbar */
  .toolbar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #111520;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 14px;
  }}
  .toolbar-left {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }}
  .toolbar-right {{ display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
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
  .btn-primary {{
    background: #0070d1;
    border-color: #0070d1;
  }}
  .btn-primary:hover {{ background: #0084f7; border-color: #0084f7; }}
  
  .btn-zip {{
    background: rgba(229, 169, 60, 0.12);
    border-color: rgba(229, 169, 60, 0.35);
    color: #f0b849;
    font-weight: 600;
  }}
  .btn-zip:hover {{
    background: #e5a93c;
    color: #0c0e14;
    border-color: #e5a93c;
    box-shadow: 0 2px 10px rgba(229, 169, 60, 0.3);
  }}

  /* Search input */
  .search-input {{
    background: #171d2b;
    border: 1px solid #2d3852;
    color: #fff;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 13px;
    width: 240px;
    outline: none;
    transition: border-color 0.15s ease;
  }}
  .search-input:focus {{
    border-color: var(--accent-steam);
    box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.2);
  }}

  /* Volume slider */
  .vol-control {{ display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim); }}
  .vol-control input[type=range] {{ accent-color: var(--accent-steam); width: 80px; cursor: pointer; }}

  /* Filter bar */
  .filters {{
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 22px;
    flex-wrap: wrap;
  }}
  .filter-label {{ font-size: 11.5px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-right: 4px; }}
  .chip {{
    background: #131722;
    border: 1px solid #232b3e;
    color: #8c97ad;
    padding: 4px 11px;
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }}
  .chip:hover {{ color: #fff; border-color: #3d4a6b; }}
  .chip.active {{
    background: #0070d1;
    color: #fff;
    border-color: #0070d1;
  }}

  /* Pair Cards */
  .pair-card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    transition: border-color 0.2s;
  }}
  .pair-card.is-latest {{
    border-color: var(--accent-steam);
    box-shadow: 0 0 25px rgba(102, 192, 244, 0.15);
  }}
  .pair-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  }}
  .pair-title {{ font-size: 17.5px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 10px; }}
  .latest-badge {{
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    background: #66c0f4;
    color: #0c0e14;
    padding: 2px 7px;
    border-radius: 4px;
  }}
  .pair-idx {{
    font-size: 12px;
    color: #60708f;
    font-weight: 500;
  }}
  .tag {{
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 6px;
    background: #1f2536;
    color: #9ab;
  }}
  .tag.consonant {{
    background: rgba(0, 255, 170, 0.12);
    color: #00ffaa;
    border: 1px solid rgba(0, 255, 170, 0.3);
  }}

  /* Source Row */
  .sources-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 18px;
  }}
  .source-card {{
    background: #0f121a;
    border: 1px solid #1f2538;
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .source-card.steam {{ border-left: 4px solid var(--accent-steam); }}
  .source-card.ps {{ border-left: 4px solid var(--accent); }}
  .source-info h4 {{ font-size: 13px; font-weight: 600; color: #fff; }}
  .source-info p {{ font-size: 11.5px; color: var(--text-dim); margin-top: 1px; }}

  /* Variations Grid */
  .variations-list {{
    display: flex;
    flex-direction: column;
    gap: 9px;
  }}
  .var-item {{
    background: #11141e;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 11px 15px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    transition: all 0.15s ease;
  }}
  .var-item:hover {{
    background: var(--card-hover);
    border-color: #353e56;
  }}
  .var-item.is-playing {{
    border-color: var(--active);
    background: rgba(0, 255, 170, 0.05);
  }}
  .var-left {{
    display: flex;
    align-items: center;
    gap: 13px;
    flex: 1;
  }}
  .play-btn {{
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: #1c2232;
    border: 1px solid #333c54;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 15px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }}
  .play-btn:hover {{
    background: var(--accent);
    border-color: var(--accent);
    transform: scale(1.05);
  }}
  .var-item.is-playing .play-btn {{
    background: var(--active);
    color: #0c0e14;
    border-color: var(--active);
  }}
  .var-meta h3 {{ font-size: 14px; font-weight: 600; color: #fff; }}
  .var-meta p {{ font-size: 12px; color: var(--text-dim); margin-top: 2px; }}
  
  .var-right {{
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }}
  .metric-badge {{
    font-size: 11px;
    background: #171b26;
    color: #8c97ad;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #232a3b;
    white-space: nowrap;
  }}
  .badge-d {{
    background: rgba(229, 169, 60, 0.15);
    color: #e5a93c;
    border-color: rgba(229, 169, 60, 0.3);
    font-weight: 600;
  }}

  /* Download buttons */
  .btn-dl {{
    background: #172133;
    border: 1px solid #283754;
    color: #66c0f4;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 11.5px;
    font-weight: 600;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }}
  .btn-dl:hover {{
    background: #0070d1;
    color: #fff;
    border-color: #0070d1;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 112, 209, 0.35);
  }}
  .btn-dl.wav {{
    color: #b5c7e8;
    border-color: #313f5c;
  }}
  .btn-dl.wav:hover {{
    background: #254a7c;
    color: #fff;
    border-color: #3e6ea8;
  }}
  .btn-copy {{
    background: #181d2a;
    border: 1px solid #293247;
    color: #8c97ad;
    padding: 5px 9px;
    border-radius: 5px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }}
  .btn-copy:hover {{
    color: #fff;
    border-color: #4a597a;
    background: #202738;
  }}

  /* Instructions */
  .footer-box {{
    background: #0f121a;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-top: 32px;
    font-size: 13px;
    color: var(--text-dim);
  }}
  code {{
    background: #1a202c;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    color: #66c0f4;
  }}
</style>
</head>
<body>

<header>
  <div class="top-row">
    <h1>
      🎮 SteamStation Hybrid Sound Designer
      <span>A/B Audio Suite</span>
    </h1>
    <div style="display:flex; gap:10px;">
      <a href="preview_custom_trophies.html" class="btn-tool btn-primary" style="text-decoration:none;">✨ Bespoke Trophies (Zero PS) &rarr;</a>
      <a href="preview.html" class="btn-tool" style="text-decoration:none;">Classic Sounds &rarr;</a>
    </div>
  </div>
  <p class="subtitle">
    Audio hybridization suite deconstructing Steam UI and PlayStation (PS4/PS5) chimes into their frequency bands, acoustic envelopes, and melodic intervals. Click any sound to audition, or use the direct <b>⬇ MP3</b> / <b>⬇ WAV</b> buttons to download any hybrid instantly.
  </p>
</header>

<div class="toolbar">
  <div class="toolbar-left">
    <button class="btn-tool btn-primary" id="btn-shuffle">🎲 Play Random Hybrid</button>
    <button class="btn-tool" id="btn-stop">■ Stop All (Space)</button>
    <input type="text" id="search-box" placeholder="🔍 Search sounds (e.g. deck, pop, platinum)..." class="search-input">
  </div>
  <div class="toolbar-right">
    <a href="hybrids/SteamStation_Hybrids_MP3_Pack.zip" download class="btn-tool btn-zip" title="Download all MP3 hybrids in one ZIP archive">📦 Download All MP3s (.ZIP)</a>
    <a href="hybrids/SteamStation_Hybrids_WAV_Pack.zip" download class="btn-tool btn-zip" title="Download all WAV hybrids in one ZIP archive">📦 Download All WAVs (.ZIP)</a>
    <div class="vol-control">
      <span>Vol</span>
      <input type="range" id="vol-slider" min="0" max="1" step="0.05" value="0.9">
    </div>
  </div>
</div>

<div class="filters" id="filters-container">
  <span class="filter-label">Filter:</span>
  <button class="chip active" data-filter="all">All Combinations (<span id="count-all">0</span>)</button>
</div>

<main id="app"></main>

<div class="footer-box">
  <strong>💡 Tip:</strong> To re-run with a new random pair or generate other combinations via terminal:
  <br><br>
  <code>python hybrid_sound_designer.py --random --open</code>
  &nbsp;|&nbsp;
  <code>python hybrid_sound_designer.py --all-combinations</code>
</div>

<script>
const DATA = {json_data};
const LATEST_ID = {json.dumps(latest_pair_id)};
let activeAudio = null;
let currentBtn = null;
let currentItem = null;
let masterVolume = 0.9;
let activeFilter = "all";
let searchQuery = "";

// Setup volume slider
const volSlider = document.getElementById("vol-slider");
volSlider.oninput = (e) => {{
  masterVolume = parseFloat(e.target.value);
  if (activeAudio) activeAudio.volume = masterVolume;
}};

function stopCurrent() {{
  if (activeAudio) {{
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }}
  if (currentBtn) {{
    currentBtn.textContent = "▶";
    currentBtn = null;
  }}
  if (currentItem) {{
    currentItem.classList.remove("is-playing");
    currentItem = null;
  }}
}}

function playSound(url, btn, itemEl) {{
  if (activeAudio && currentBtn === btn) {{
    stopCurrent();
    return;
  }}
  stopCurrent();

  activeAudio = new Audio(url);
  activeAudio.volume = masterVolume;
  currentBtn = btn;
  currentItem = itemEl;
  btn.textContent = "■";
  if (itemEl) itemEl.classList.add("is-playing");

  activeAudio.onended = () => {{
    stopCurrent();
  }};
  activeAudio.onerror = (e) => {{
    console.error("Audio error:", e);
    stopCurrent();
  }};
  activeAudio.play().catch(e => console.warn("Playback prevented:", e));
}}

document.getElementById("btn-stop").onclick = stopCurrent;

document.addEventListener("keydown", (e) => {{
  if (e.code === "Space" && e.target.tagName !== "INPUT") {{
    e.preventDefault();
    stopCurrent();
  }} else if ((e.key === "r" || e.key === "R") && e.target.tagName !== "INPUT") {{
    playRandom();
  }}
}});

function playRandom() {{
  const playableButtons = Array.from(document.querySelectorAll(".var-item .play-btn"))
    .filter(b => b.closest(".pair-card").style.display !== "none");
  if (playableButtons.length > 0) {{
    const randBtn = playableButtons[Math.floor(Math.random() * playableButtons.length)];
    randBtn.click();
    randBtn.scrollIntoView({{ behavior: "smooth", block: "center" }});
  }}
}}

document.getElementById("btn-shuffle").onclick = playRandom;

// Setup search filter
const searchInput = document.getElementById("search-box");
searchInput.oninput = (e) => {{
  searchQuery = e.target.value.toLowerCase().trim();
  applyFilters();
}};

// Setup filter chips
const steamSources = new Set(DATA.map(p => p.steam_file));
const psSources = new Set(DATA.map(p => p.ps_file));
document.getElementById("count-all").textContent = DATA.length;

const filterContainer = document.getElementById("filters-container");
steamSources.forEach(s => {{
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = s.replace(/\\.wav|\\.mp3/, "");
  chip.onclick = () => setFilter("steam:" + s, chip);
  filterContainer.appendChild(chip);
}});

psSources.forEach(p => {{
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = p.replace(/\\.wav|\\.mp3/, "");
  chip.onclick = () => setFilter("ps:" + p, chip);
  filterContainer.appendChild(chip);
}});

function setFilter(filt, chipEl) {{
  activeFilter = filt;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  if (chipEl) chipEl.classList.add("active");
  applyFilters();
}}

function applyFilters() {{
  document.querySelectorAll(".pair-card").forEach(card => {{
    const s = card.dataset.steam;
    const p = card.dataset.ps;
    const textContent = card.innerText.toLowerCase();

    const matchesFilter = (activeFilter === "all") ||
      (activeFilter.startsWith("steam:") && activeFilter.slice(6) === s) ||
      (activeFilter.startsWith("ps:") && activeFilter.slice(3) === p);

    const matchesSearch = !searchQuery || textContent.includes(searchQuery);

    if (matchesFilter && matchesSearch) {{
      card.style.display = "";
    }} else {{
      card.style.display = "none";
    }}
  }});
}}

document.querySelector('[data-filter="all"]').onclick = function() {{
  setFilter("all", this);
}};

function copyJsonSnippet(filename, btn) {{
  const snippet = `"sound": ["SteamStation/sfx/hybrids/${{filename}}", 90]`;
  navigator.clipboard.writeText(snippet).then(() => {{
    const orig = btn.textContent;
    btn.textContent = "Copied! ✓";
    btn.style.color = "#00ffaa";
    btn.style.borderColor = "#00ffaa";
    setTimeout(() => {{
      btn.textContent = orig;
      btn.style.color = "";
      btn.style.borderColor = "";
    }}, 1600);
  }}).catch(() => {{
    prompt("Copy sound config for SteamStation.json:", snippet);
  }});
}}

const app = document.getElementById("app");

DATA.forEach((pair, idx) => {{
  const card = document.createElement("section");
  card.className = "pair-card" + (pair.pair_id === LATEST_ID ? " is-latest" : "");
  card.dataset.steam = pair.steam_file;
  card.dataset.ps = pair.ps_file;

  const isLatest = (pair.pair_id === LATEST_ID);

  const header = document.createElement("div");
  header.className = "pair-header";
  header.innerHTML = `
    <div>
      <div class="pair-title">
        <span class="pair-idx">#${{idx + 1}}</span>
        ${{pair.steam_file}} &nbsp;×&nbsp; ${{pair.ps_file}}
        ${{isLatest ? '<span class="latest-badge">Latest Run</span>' : ''}}
      </div>
      <div style="font-size:12px; color:#8c97ad; margin-top:3px">Harmonic Alignment: ${{pair.steam_note}} &nbsp;➔&nbsp; ${{pair.ps_note}}</div>
    </div>
    <div style="display:flex; gap:8px">
      <span class="tag consonant">Consonance: ${{pair.harmonic_interval}} (${{pair.tune_shift_semitones > 0 ? '+' : ''}}${{pair.tune_shift_semitones}} st)</span>
    </div>
  `;
  card.appendChild(header);

  // Sources row
  const sourcesGrid = document.createElement("div");
  sourcesGrid.className = "sources-grid";

  // Steam Source
  const steamCard = document.createElement("div");
  steamCard.className = "source-card steam";
  const stUrl = pair.steam_boosted_mp3 ? ("hybrids/" + pair.steam_boosted_mp3) : ("../" + pair.steam_file);
  const stDl = pair.steam_boosted_wav ? ("hybrids/" + pair.steam_boosted_wav) : ("../" + pair.steam_file);
  const boostBadge = pair.steam_boost_db ? ` • Level Matched (+${{pair.steam_boost_db}} dB)` : "";
  steamCard.innerHTML = `
    <div class="source-info">
      <h4>Steam: ${{pair.steam_file}}</h4>
      <p>Tactile Transient${{boostBadge}} • Pitch: ${{pair.steam_note}}</p>
    </div>
    <div style="display:flex; gap:6px; align-items:center;">
      <a href="${{stDl}}" download class="btn-dl" title="Download Level-Matched Steam Source">⬇</a>
      <button class="play-btn" title="Play Level-Matched Steam Source">▶</button>
    </div>
  `;
  const steamBtn = steamCard.querySelector(".play-btn");
  steamBtn.onclick = () => playSound(stUrl, steamBtn, steamCard);
  sourcesGrid.appendChild(steamCard);

  // PS Source
  const psCard = document.createElement("div");
  psCard.className = "source-card ps";
  psCard.innerHTML = `
    <div class="source-info">
      <h4>PlayStation: ${{pair.ps_file}}</h4>
      <p>Crystalline Shimmer • Pitch: ${{pair.ps_note}}</p>
    </div>
    <div style="display:flex; gap:6px; align-items:center;">
      <a href="../${{pair.ps_file}}" download="${{pair.ps_file}}" class="btn-dl" title="Download Source File">⬇</a>
      <button class="play-btn" title="Play PlayStation Source">▶</button>
    </div>
  `;
  const psBtn = psCard.querySelector(".play-btn");
  psBtn.onclick = () => playSound("../" + pair.ps_file, psBtn, psCard);
  sourcesGrid.appendChild(psCard);

  card.appendChild(sourcesGrid);

  // Variations list
  const varList = document.createElement("div");
  varList.className = "variations-list";

  pair.variations.forEach((v) => {{
    const item = document.createElement("div");
    item.className = "var-item";
    const isMaster = v.label.includes("Master");

    item.innerHTML = `
      <div class="var-left">
        <button class="play-btn" title="Play ${{v.label}}">▶</button>
        <div class="var-meta">
          <h3>${{v.label}}</h3>
          <p>${{v.description}}</p>
        </div>
      </div>
      <div class="var-right">
        <span class="metric-badge">${{v.duration}}s</span>
        <span class="metric-badge">${{v.rms_db}} dB</span>
        ${{isMaster ? '<span class="metric-badge badge-d">⭐ Master</span>' : ''}}
        <a href="hybrids/${{v.filename}}" download="${{v.filename}}" class="btn-dl" title="Download MP3 Audio File">⬇ MP3</a>
        <a href="hybrids/${{v.wav_filename}}" download="${{v.wav_filename}}" class="btn-dl wav" title="Download Uncompressed WAV File">⬇ WAV</a>
        <button class="btn-copy" title="Copy JSON sound config for SteamStation.json">📋 Copy JSON</button>
      </div>
    `;

    const btn = item.querySelector(".play-btn");
    btn.onclick = () => playSound("hybrids/" + v.filename, btn, item);

    const copyBtn = item.querySelector(".btn-copy");
    copyBtn.onclick = () => copyJsonSnippet(v.filename, copyBtn);

    varList.appendChild(item);
  }});

  card.appendChild(varList);
  app.appendChild(card);
}});
</script>

</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"\nPreview player written to: {html_path}")


def main():
    parser = argparse.ArgumentParser(description="SteamStation Hybrid Sound Designer")
    parser.add_argument("--random", action="store_true", help="Pick one Steam and one PS sound randomly")
    parser.add_argument("--steam", type=str, help="Specific Steam sound filename")
    parser.add_argument("--ps", type=str, help="Specific PlayStation sound filename")
    parser.add_argument("--count", type=int, default=24, help="Number of random pairs to generate")
    parser.add_argument("--all-combinations", action="store_true", help="Generate all Steam x PS combinations")
    parser.add_argument("--seed", type=int, help="Random seed for reproducibility")
    parser.add_argument("--out-dir", type=str, default=DEFAULT_OUT_DIR, help="Output directory")
    parser.add_argument("--open", action="store_true", help="Open the evaluation HTML preview in your browser")

    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        np.random.seed(args.seed)

    steam_files, ps_files = discover_sources()
    if not steam_files:
        sys.exit(f"Error: No Steam audio files found in {THEME_DIR}")
    if not ps_files:
        sys.exit(f"Error: No PlayStation audio files found in {THEME_DIR}")

    pairs_to_run = []

    # By default or if requested, generate all combinations (2 Steam x 3 PS = 6 combinations)
    if args.all_combinations or (not args.random and not args.steam and not args.ps):
        for s in steam_files:
            for p in ps_files:
                pairs_to_run.append((s, p))
    elif args.steam and args.ps:
        s_match = next((f for f in steam_files if args.steam.lower() in f.lower()), None)
        p_match = next((f for f in ps_files if args.ps.lower() in f.lower()), None)
        if not s_match:
            sys.exit(f"Could not find Steam file matching: {args.steam}")
        if not p_match:
            sys.exit(f"Could not find PlayStation file matching: {args.ps}")
        pairs_to_run.append((s_match, p_match))
    elif args.random:
        s = random.choice(steam_files)
        p = random.choice(ps_files)
        pairs_to_run.append((s, p))
    else:
        # Generate N pairs
        all_possible = [(s, p) for s in steam_files for p in ps_files]
        random.shuffle(all_possible)
        pairs_to_run = all_possible[: min(args.count, len(all_possible))]

    # Clean stale audio files from out_dir that don't belong to current active Steam sources
    clean_stale_hybrids(args.out_dir, steam_files)

    existing_manifest = [p for p in load_manifest() if p.get("steam_file") in steam_files]
    manifest_map = {p["pair_id"]: p for p in existing_manifest}

    new_results = []
    latest_id = None
    for i, (s_fn, p_fn) in enumerate(pairs_to_run):
        res = run_hybrid_combination(s_fn, p_fn, out_dir=args.out_dir, prefix=None)
        manifest_map[res["pair_id"]] = res
        new_results.append(res)
        latest_id = res["pair_id"]

    # Order manifest with newest / latest pair at top, then the rest
    combined_pairs = [manifest_map[latest_id]] + [
        p for pid, p in manifest_map.items() if pid != latest_id
    ]
    save_manifest(combined_pairs)

    # Build ZIP packages for MP3 and WAV
    create_zip_packs(args.out_dir)

    # Generate evaluation HTML preview
    preview_path = os.path.join(HERE, "preview_hybrids.html")
    generate_preview_html(combined_pairs, preview_path, latest_pair_id=latest_id)

    if args.open:
        print(f"Opening evaluation preview in default browser...")
        webbrowser.open("file://" + os.path.abspath(preview_path))

    print(f"\n[Done] Generated {len(combined_pairs)} combinations ({len(combined_pairs)*5} audio files).")
    print(f"Open in browser to evaluate: file:///{preview_path.replace(os.sep, '/')}")


if __name__ == "__main__":
    main()
