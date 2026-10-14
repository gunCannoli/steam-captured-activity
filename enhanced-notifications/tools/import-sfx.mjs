// Builds the Theme Creator's sound library (theme creator plan § 5) from the procedurally generated sound pack zips.
//
//   node tools/import-sfx.mjs [sourceDir=../assets-src/sfx] [--force]
//
// For each `sequence_<x>.zip` in the table below: extracts only its three WAVs, writes them as
// themes/sounds/<pack>/{subtle,distinct,grand}.wav, checks each is a 48 kHz PCM WAV of the expected length (± 0.1 s),
// and writes themes/sounds/library.json. The MP3s and READMEs are not shipped (the READMEs use proprietary names).
// Re-runnable: a pack folder whose files differ is left alone unless --force. No dependencies; Windows' own tar.exe
// reads zips (Git Bash's GNU tar does not).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const source = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, '..', 'assets-src', 'sfx'));
const OUT = join(ROOT, 'themes', 'sounds');
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/** The cues: zip folder, file prefix, our name, nominal length. Never named after a console (R8). */
const CUES = [
    { id: 'subtle', label: 'Subtle', folder: 'PS4', prefix: 'trophy_ps4_', seconds: 0.95 },
    { id: 'distinct', label: 'Distinct', folder: 'PS5', prefix: 'trophy_ps5_', seconds: 1.4 },
    { id: 'grand', label: 'Grand', folder: 'PLATINUM', prefix: 'trophy_platinum_', seconds: 2.2 },
];

/** Zip suffix -> pack (plan § 5.1, the user's Q1). */
const PACKS = [
    ['8bit_church', '8bit_cathedral', '8-Bit Cathedral', 'Chiptune', 'Chiptune organ under stone arches'],
    ['8bit_gamelan', '8bit_gamelan', '8-Bit Gamelan', 'Chiptune', 'Chiptune bronze gongs and metallophones'],
    ['8bit_glock', '8bit_glockenspiel', '8-Bit Glockenspiel', 'Chiptune', 'Chiptune bells, bright and short'],
    ['retro_8bit', '8bit_chiptune', '8-Bit Chiptune', 'Chiptune', 'Square waves from the 8-bit era'],
    ['retro_16bit', '16bit_victory', '16-Bit Victory', 'Chiptune', 'A 16-bit victory jingle'],
    ['bell_glock', 'steel_glockenspiel', 'Steel Glockenspiel', 'Bells', 'Struck steel bars'],
    ['bell_tubular', 'tubular_bells', 'Tubular Bells', 'Bells', 'Orchestral chimes'],
    ['fantasy_musicbox', 'starlight_music_box', 'Starlight Music Box', 'Bells', 'A wind-up music box'],
    ['harp', 'celtic_harp', 'Celtic Harp', 'Strings', 'Celtic concert strings'],
    ['harp_bardic', 'bardic_harp', 'Bardic Harp', 'Strings', 'A bard\'s lap harp'],
    ['guitar', 'acoustic_flageolet', 'Acoustic Flageolet', 'Strings', 'Guitar harmonics'],
    ['guitar_12string', 'twelve_string', 'Twelve-String', 'Strings', 'A shimmering twelve-string guitar'],
    ['epic', 'cinematic', 'Cinematic', 'Orchestral', 'Brass and strings, film-score size'],
    ['medieval', 'royal_courtyard', 'Royal Courtyard', 'Orchestral', 'Fanfare in a castle courtyard'],
    ['afric_ancient', 'earthen_heritage', 'Earthen Heritage', 'World', 'Wooden percussion and earthy tones'],
    ['afric_kora', 'kora_and_gourd', 'Kora and Gourd', 'World', 'Kora strings over gourd percussion'],
    ['robotic_quantum', 'quantum_core', 'Quantum Core', 'Synth', 'Synthetic, glassy and digital'],
];

/** Sample rate, channels and length of a PCM WAV (RIFF chunks walked, so extra chunks are fine). */
export function wavInfo(buf) {
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
    let rate = 0, channels = 0, bits = 0, dataBytes = -1;
    for (let at = 12; at + 8 <= buf.length; ) {
        const id = buf.toString('ascii', at, at + 4);
        const size = buf.readUInt32LE(at + 4);
        if (id === 'fmt ') {
            channels = buf.readUInt16LE(at + 10);
            rate = buf.readUInt32LE(at + 12);
            bits = buf.readUInt16LE(at + 22);
        } else if (id === 'data') dataBytes = size;
        at += 8 + size + (size % 2);
    }
    if (!rate || dataBytes < 0) throw new Error('no fmt or data chunk');
    return { rate, channels, bits, seconds: dataBytes / (rate * channels * (bits / 8)) };
}

function main() {
    if (!existsSync(source)) throw new Error(`No source folder: ${source}`);
    mkdirSync(OUT, { recursive: true });
    const tmp = mkdtempSync(join(tmpdir(), 'import-sfx-'));
    const packs = [];
    let files = 0;
    let problems = 0;
    try {
        for (const [zipName, id, label, category, description] of PACKS) {
            const zip = join(source, `sequence_${zipName}.zip`);
            if (!existsSync(zip)) throw new Error(`Missing ${zip}`);
            const work = join(tmp, id);
            mkdirSync(work, { recursive: true });
            const members = CUES.map((c) => `${c.folder}/WAV/${c.prefix}${zipName}.wav`);
            execFileSync(TAR, ['-xf', zip, '-C', work, ...members]);
            const target = join(OUT, id);
            const seconds = {};
            const outputs = CUES.map((c, i) => {
                const data = readFileSync(join(work, members[i]));
                const info = wavInfo(data);
                seconds[c.id] = Math.round(info.seconds * 100) / 100;
                const ok = info.rate === 48000 && Math.abs(info.seconds - c.seconds) <= 0.1 + 1e-6; // ± 0.1 s, inclusive
                if (!ok) {
                    problems++;
                    console.log(`FAIL  ${id}/${c.id}.wav: ${info.rate} Hz, ${info.seconds.toFixed(2)} s (expected 48000 Hz, ${c.seconds} s)`);
                }
                return { path: join(target, `${c.id}.wav`), data };
            });
            const differs = outputs.some((o) => existsSync(o.path) && !readFileSync(o.path).equals(o.data));
            if (differs && !force) {
                problems++;
                console.log(`SKIP  ${id}: its files differ from the zip (re-run with --force to replace them)`);
            } else {
                mkdirSync(target, { recursive: true });
                for (const o of outputs) writeFileSync(o.path, o.data);
                files += outputs.length;
            }
            packs.push({ id, label, category, description, seconds });
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
    const manifest = { version: 1, cues: CUES.map(({ id, label, seconds }) => ({ id, label, seconds })), packs };
    writeFileSync(join(OUT, 'library.json'), JSON.stringify(manifest, null, 2) + '\n');
    const stray = readdirSync(OUT).filter((n) => n !== 'library.json' && !packs.some((p) => p.id === n));
    if (stray.length) console.log(`NOTE  not in the table (left alone): ${stray.join(', ')}`);
    console.log(`${problems ? 'FAIL' : 'PASS'}  ${packs.length} packs, ${files} files written, ${problems} problem(s)`);
    process.exit(problems ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
