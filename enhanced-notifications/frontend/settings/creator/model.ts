/**
 * The Theme Creator's small pure helpers (theme creator plan § 6.0): the preview's sample texts and sets, colour
 * conversion for Steam's colour picker, and the Sound pack panel's rows. UI logic, not theme logic, so it lives with the
 * creator; theme editing is theme/draft.ts. Pure (tests/creator.test.ts).
 */
import { TIERS, type Tier } from '../../theme/achievements.ts';
import { getAt, libraryPath, modePath, setAt, unsetAt, type CreatorDraft, type Path } from '../../theme/draft.ts';
import type { ThemeMode } from '../../theme/theme.ts';

// --- what the preview's toasts say -------------------------------------------------------------------

export interface Sample {
    title: string;
    body: string;
    subtext?: string;
    /** Which icon the mock shows: the sample game's, or a neutral glyph for system toasts. */
    icon: 'game' | 'download' | 'clip' | 'cloud' | 'battery' | 'system';
}

/** Sample text per preview id (surfaces/preview: Steam's test toasts). `{game}` is the sample game's name. */
export const SAMPLES: Record<string, Sample> = {
    // An achievement drawn as a notification (no banner): `{game}` is the achievement's name here.
    Achievement: { title: 'Achievement unlocked', body: '{game}', icon: 'game' },
    DownloadComplete: { title: 'Download complete', body: '{game}', subtext: 'Ready to play', icon: 'download' },
    GameRecordingInstantClip: { title: 'Clip saved', body: '15 seconds', icon: 'clip' },
    GameRecordingStart: { title: 'Recording started', body: '{game}', icon: 'clip' },
    CloudSyncFailure: { title: 'Cloud sync failed', body: '{game}', subtext: 'Your files could not be synced', icon: 'cloud' },
    CloudSyncConflict: { title: 'Cloud sync conflict', body: '{game}', subtext: 'Choose which files to keep', icon: 'cloud' },
    LowBatteryNotification: { title: 'Low battery', body: '15% remaining', icon: 'battery' },
    HardwareUpdateNotification: { title: 'Hardware update', body: 'A controller update is ready', icon: 'system' },
    PlaytimeWarning: { title: 'Playtime warning', body: '{game}', subtext: '15 minutes left today', icon: 'game' },
};

export function sampleFor(id: string, game: string): Sample {
    const s = SAMPLES[id] ?? { title: id, body: '{game}', icon: 'system' as const };
    const fill = (t: string | undefined) => t?.replace('{game}', game);
    return { ...s, title: fill(s.title)!, body: fill(s.body)!, subtext: fill(s.subtext) };
}

/** The sample achievement when the library offers none (plan § 4.6). */
export const SAMPLE_ACHIEVEMENT = { name: 'First Steps', description: 'Finish the tutorial' };

// --- preview sets ---------------------------------------------------------------------------------------

export type PreviewSetId = 'choose' | 'random' | 'tiers' | 'mixed' | 'stack';

export const PREVIEW_SETS: { id: PreviewSetId; label: string; description: string }[] = [
    { id: 'tiers', label: 'Achievement tiers (4)', description: 'Normal, Magic, Rare and Exceptional' },
    { id: 'choose', label: 'Choose 4 notifications', description: 'The four notifications you pick' },
    { id: 'random', label: '4 random notifications', description: 'Four different notifications, shuffled on demand' },
    { id: 'mixed', label: 'Mixed', description: 'Two notifications and two achievement tiers' },
    { id: 'stack', label: 'Stack of one type', description: 'The same notification four times' },
];

export const DEFAULT_CHOSEN = ['DownloadComplete', 'GameRecordingInstantClip', 'CloudSyncFailure', 'LowBatteryNotification'];

export type PreviewItem = { kind: 'notification'; id: string } | { kind: 'achievement'; tier: Tier };

/** Four distinct ids from `ids` (fewer when there are fewer). */
export function randomFour(ids: readonly string[], random: () => number = Math.random): string[] {
    const pool = [...ids];
    const out: string[] = [];
    while (out.length < 4 && pool.length) out.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]!);
    return out;
}

/** What the stage shows for a set. `chosen` / `random`: the user's four and the last shuffle; never Achievement. */
export function previewItems(set: PreviewSetId, chosen: readonly string[], random: readonly string[]): PreviewItem[] {
    const notes = (ids: readonly string[]) => ids.filter((id) => id !== 'Achievement').map((id): PreviewItem => ({ kind: 'notification', id }));
    switch (set) {
        case 'tiers':
            return TIERS.map((tier) => ({ kind: 'achievement', tier }));
        case 'choose':
            return notes(chosen).slice(0, 4);
        case 'random':
            return notes(random).slice(0, 4);
        case 'mixed':
            return [...notes(chosen).slice(0, 2), { kind: 'achievement', tier: 'normal' }, { kind: 'achievement', tier: 'rare' }];
        case 'stack':
            return Array.from({ length: 4 }, () => notes(chosen.slice(0, 1))[0] ?? { kind: 'notification', id: 'DownloadComplete' });
    }
}

// --- colours ------------------------------------------------------------------------------------------

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHex(v: unknown): v is string {
    return typeof v === 'string' && HEX.test(v);
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` -> `[h, s, l, a]` (h 0-360, s and l 0-100, a 0-1). */
export function hexToHsl(hex: string): [number, number, number, number] {
    let h = hex.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let hue = 0;
    let sat = 0;
    if (max !== min) {
        const d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hue *= 60;
    }
    return [Math.round(hue), Math.round(sat * 100), Math.round(l * 100), Math.round(a * 1000) / 1000];
}

/** `[h, s, l, a]` -> `#rrggbb`, or `#rrggbbaa` when not opaque. */
export function hslToHex(h: number, s: number, l: number, a = 1): string {
    const sat = s / 100;
    const lig = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const f = (n: number) => lig - sat * Math.min(lig, 1 - lig) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const byte = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${byte(f(0))}${byte(f(8))}${byte(f(4))}${a < 1 ? byte(a) : ''}`;
}

/** Steam's ColorPickerModal answers `hsla(h, s%, l%, a)` (or `hsl(...)`); anything else: null. */
export function parseHslString(v: string): string | null {
    const m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v.trim());
    if (!m) return null;
    return hslToHex(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4]));
}

// --- the Sound pack panel --------------------------------------------------------------------------------

export type SoundTarget = 'notification' | Tier;
export const SOUND_TARGETS: SoundTarget[] = ['notification', ...TIERS];
export type CueChoice = 'keep' | 'subtle' | 'distinct' | 'grand';
export const CUES = ['subtle', 'distinct', 'grand'] as const;

/** The hint shown while a target is on Keep (plan § 4.7): a common pairing, never preselected. */
export const PAIRING_HINT: Record<SoundTarget, string> = {
    notification: 'often Subtle',
    normal: 'often Subtle',
    magic: 'often Subtle',
    rare: 'often Distinct',
    exceptional: 'often Grand',
};

/** Where a target's sound sits in the document (desktop-shaped path). */
export function soundPath(target: SoundTarget): Path {
    return target === 'notification' ? ['sound'] : ['achievements', target, 'sound'];
}

/** The cue of `pack` a target plays now in this mode, or null (another pack, a file, Steam's, muted, unset). */
export function currentCue(draft: CreatorDraft, mode: ThemeMode, target: SoundTarget, pack: string): (typeof CUES)[number] | null {
    const v = getAt(draft.raw, modePath(mode, soundPath(target)));
    const file = Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
    if (!file) return null;
    const pick = draft.pendingCopies[file];
    if (pick) return pick.pack === pack ? (CUES.find((c) => c === pick.cue) ?? null) : null;
    // A saved theme holds the copy Save made: `<name>/<pack>_<cue>.wav`.
    const m = /(?:^|\/)([A-Za-z0-9_]+)_(subtle|distinct|grand)(?:-\d+)?\.wav$/.exec(file);
    return m && m[1] === pack ? (m[2] as (typeof CUES)[number]) : null;
}

/**
 * Apply the Sound pack panel (plan § 4.7, R14): each target not on Keep gets `pack`'s cue at its volume, as a library
 * pick (`sounds/<pack>/<cue>.wav` plus a `pendingCopies` entry). Tier targets are ignored without an `achievements`
 * block in the theme. One new draft (one undo step); a Keep target is untouched whatever it held.
 */
export function applyPack(
    draft: CreatorDraft,
    mode: ThemeMode,
    pack: string,
    choices: Partial<Record<SoundTarget, { cue: CueChoice; volume: number }>>,
): CreatorDraft {
    let raw = draft.raw;
    const pendingCopies = { ...draft.pendingCopies };
    const hasBanner = getAt(raw, ['achievements']) !== undefined || getAt(raw, ['bigpicture', 'achievements']) !== undefined;
    for (const target of SOUND_TARGETS) {
        const choice = choices[target];
        if (!choice || choice.cue === 'keep') continue;
        if (target !== 'notification' && !hasBanner) continue;
        const path = libraryPath(pack, choice.cue);
        pendingCopies[path] = { kind: 'library', pack, cue: choice.cue };
        raw = setAt(raw, modePath(mode, soundPath(target)), [path, Math.max(0, Math.min(100, Math.round(choice.volume)))]);
    }
    // Drop library picks nothing names any more.
    const used = JSON.stringify(raw);
    for (const p of Object.keys(pendingCopies)) if (!used.includes(JSON.stringify(p))) delete pendingCopies[p];
    return { ...draft, raw, pendingCopies };
}

/** One sound for one target (the single sound picker): a library cue, a file path, Steam's (unset) or mute (false). */
export function setSound(draft: CreatorDraft, mode: ThemeMode, target: SoundTarget, sound: { pack: string; cue: string; volume: number } | { file: string; volume: number } | 'steam' | 'mute'): CreatorDraft {
    const path = modePath(mode, soundPath(target));
    const pendingCopies = { ...draft.pendingCopies };
    let raw: CreatorDraft['raw'];
    if (sound === 'steam') raw = mode === 'bigpicture' && getAt(draft.raw, soundPath(target)) !== undefined ? setAt(draft.raw, path, null) : unsetAt(draft.raw, path);
    else if (sound === 'mute') raw = setAt(draft.raw, path, false);
    else if ('pack' in sound) {
        const file = libraryPath(sound.pack, sound.cue);
        pendingCopies[file] = { kind: 'library', pack: sound.pack, cue: sound.cue };
        raw = setAt(draft.raw, path, [file, sound.volume]);
    } else raw = setAt(draft.raw, path, [sound.file, sound.volume]);
    const used = JSON.stringify(raw);
    for (const p of Object.keys(pendingCopies)) if (!used.includes(JSON.stringify(p))) delete pendingCopies[p];
    return { ...draft, raw, pendingCopies };
}

/** A free name: `base`, else `base_2`, `base_3`, ... not in `taken` (case-insensitive, as Windows file names are). */
export function freeName(base: string, taken: readonly string[]): string {
    const lower = new Set(taken.map((t) => t.toLowerCase()));
    const clean = base.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 34) || 'my_theme';
    if (!lower.has(clean.toLowerCase())) return clean;
    for (let n = 2; ; n++) if (!lower.has(`${clean}_${n}`.toLowerCase())) return `${clean}_${n}`;
}
