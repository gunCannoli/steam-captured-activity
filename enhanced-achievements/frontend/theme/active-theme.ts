import { logger } from '../logger';
import { rpc } from '../rpc';
import { setting, onSettingChange } from '../settings/settings';
import { parseJsonc } from './jsonc';
import { achievementIdOf, type SteamNotification } from '../kernel/notification';
import { resolveTheme, tierOfNotification, type ResolvedTheme, type Tier } from './theme';

/**
 * The active theme, fully resolved, with every asset already loaded.
 *
 * Loading happens once per theme change (startup, theme setting, "Reload
 * themes"). Toast-time code only reads `activeTheme()` and the pre-decoded
 * sounds, which is O(1) and does no disk, RPC or network work.
 */

export interface LoadedTheme {
    name: string;
    theme: ResolvedTheme;
    /** Asset path -> data URL; missing assets are absent. */
    assets: Map<string, string>;
    /** Decoded sound per tier; absent tiers keep Steam's chime. */
    sounds: Map<Tier, { buffer: AudioBuffer; volume: number }>;
}

/** What went wrong in the last load: `error` when the theme could not be used at all, else the fields that fell back. */
export interface ThemeIssues {
    name: string;
    error: string | null;
    warnings: string[];
}

let loaded: LoadedTheme | null = null;
let issues: ThemeIssues | null = null;
let loading: Promise<void> | null = null;
let audioContext: AudioContext | null = null;

const listeners = new Set<() => void>();

export function activeTheme(): LoadedTheme | null {
    return loaded;
}

/** The last load's problems; null when it had none or no theme is selected. */
export function themeIssues(): ThemeIssues | null {
    return issues;
}

/** Tier memo keyed by the notification's data object: computed once, read by sound, banner and captures. */
const tiers = new WeakMap<object, Tier>();

export function tierFor(n: SteamNotification): Tier {
    const memo = tiers.get(n.data);
    if (memo) return memo;
    let tier: Tier = 'normal';
    try {
        tier = tierOfNotification({ id: achievementIdOf(n), globalPct: n.data.global_achieved_pct() }, activeTheme()?.theme ?? null);
    } catch (error) {
        logger.warn('Could not determine rarity tier; using normal.', error);
    }
    tiers.set(n.data, tier);
    return tier;
}

export function onThemeChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function audio(): AudioContext {
    audioContext ??= new AudioContext();
    return audioContext;
}

function dataUrlToArrayBuffer(url: string): ArrayBuffer {
    const base64 = url.slice(url.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function load(name: string): Promise<void> {
    if (!name) {
        // Deliberate "Steam default": no theme selected, not a load failure.
        loaded = null;
        issues = null;
        for (const listener of listeners) listener();
        return;
    }
    const warnings: string[] = [];
    const warn = (text: string, error?: unknown) => {
        warnings.push(text);
        if (error === undefined) logger.warn(`Theme "${name}": ${text}`);
        else logger.warn(`Theme "${name}": ${text}`, error);
    };
    let failure: string | null = null;
    try {
        const file = await rpc.loadTheme(name);
        const theme = resolveTheme(parseJsonc(file.text));
        for (const warning of theme.warnings) warn(warning);

        const assets = new Map<string, string>();
        if (theme.assetPaths.length) {
            const urls = await rpc.loadAssets(file.dir, theme.assetPaths);
            for (const [path, url] of Object.entries(urls)) {
                if (url) assets.set(path, url);
                else warn(`Asset unavailable, falling back: ${path}`);
            }
        }

        // Decode each distinct sound once; tiers often share a file.
        const sounds = new Map<Tier, { buffer: AudioBuffer; volume: number }>();
        const decoded = new Map<string, AudioBuffer | null>();
        for (const tier of Object.values(theme.tiers)) {
            const spec = tier.sound;
            if (!spec) continue;
            if (!decoded.has(spec.path)) {
                const url = assets.get(spec.path);
                let buffer: AudioBuffer | null = null;
                if (url) {
                    try {
                        buffer = await audio().decodeAudioData(dataUrlToArrayBuffer(url));
                    } catch (error) {
                        warn(`Could not decode ${spec.path}; using Steam's chime.`, error);
                    }
                }
                decoded.set(spec.path, buffer);
            }
            const buffer = decoded.get(spec.path);
            if (buffer) sounds.set(tier.tier, { buffer, volume: spec.volumePct / 100 });
        }

        loaded = { name, theme, assets, sounds };
        logger.info(`Theme "${name}" loaded (${assets.size} assets, ${sounds.size} tier sounds).`);
    } catch (error) {
        // An unusable theme means stock Steam, never a half-styled banner.
        loaded = null;
        failure = error instanceof Error ? error.message : String(error);
        logger.error(`Theme "${name}" could not be loaded; using Steam's stock toast and chime.`, error);
    }
    issues = failure || warnings.length ? { name, error: failure, warnings } : null;
    for (const listener of listeners) listener();
}

/** (Re)load the theme named by the `theme` setting. */
export function reloadTheme(): Promise<void> {
    const name = setting('theme');
    const next = (loading ?? Promise.resolve()).then(() => load(name));
    loading = next;
    return next;
}

export function initActiveTheme(): Promise<void> {
    onSettingChange((key) => {
        if (key === 'theme') void reloadTheme();
    });
    return reloadTheme();
}
