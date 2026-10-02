import { logger } from '../logger';
import { rpc } from '../rpc';
import { setting, onSettingChange } from '../settings/settings';
import { parseJsonc } from './jsonc';
import { achievementIdOf, type SteamNotification } from '../kernel/notification';
import { buildAnimationCss, buildCss, resolveTheme, type ResolvedStyle, type ResolvedTheme, type ToastSelectors } from './theme';
import { tierOfNotification, type AchievementTheme, type Tier } from './achievements';
import { STEAM_DEFAULT_THEME } from './schema';

/**
 * The active theme, with every asset loaded, its sounds pre-decoded and its CSS cached.
 *
 * Loading happens once per theme change (startup, theme setting, "Reload themes"). Toast-time reads
 * (`themeStyle`, `themeCss`, `animationCss`, `themeSound`, `achievementTheme`, `tierFor`) are cached values:
 * no disk, RPC or network work per toast.
 */

export interface LoadedTheme {
    name: string;
    theme: ResolvedTheme;
    /** Decoded audio per asset path; missing or undecodable paths are absent. */
    audio: Map<string, AudioBuffer>;
    /** Asset path -> data URL (the banner's icons, and the sounds); missing assets are absent. */
    assets: Map<string, string>;
}

/** The theme's `achievements` block, ready for the banner: built once per load, null without the block. */
export interface LoadedAchievementTheme {
    name: string;
    theme: AchievementTheme;
    /** Asset path -> data URL; missing assets are absent. */
    assets: Map<string, string>;
    /** Decoded sound per tier; a tier without one gets the notification sound (or Steam's chime). */
    sounds: Map<Tier, { buffer: AudioBuffer; volume: number }>;
}

/** What went wrong in the last load: `error` when the theme could not be used at all, else the fields that fell back. */
export interface ThemeIssues {
    name: string;
    error: string | null;
    warnings: string[];
}

let loaded: LoadedTheme | null = null;
let achievements: LoadedAchievementTheme | null = null;
let issues: ThemeIssues | null = null;
let loading: Promise<void> | null = null;
let audioContext: AudioContext | null = null;
let selectors: ToastSelectors = {};
/** The theme's CSS, built once per theme load; undefined = not built yet. */
let cssCache: string | undefined;
/** The theme's entrance/exit CSS, built once per theme load; undefined = not built yet. */
let animationCache: string | undefined;
const listeners = new Set<() => void>();

export function activeTheme(): LoadedTheme | null {
    return loaded;
}

/** The achievement banner's theme, or null: no theme loaded, or it has no `achievements` block. */
export function achievementTheme(): LoadedAchievementTheme | null {
    return achievements;
}

/** The last load's problems; null when it had none. */
export function themeIssues(): ThemeIssues | null {
    return issues;
}

export function onThemeChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function audio(): AudioContext {
    audioContext ??= new AudioContext();
    return audioContext;
}

/** Set once at startup, before the first toast. */
export function setSelectors(value: ToastSelectors): void {
    selectors = value;
    cssCache = undefined;
    animationCache = undefined;
}

/** The one style every notification gets, or null with no theme loaded. */
export function themeStyle(): ResolvedStyle | null {
    return loaded?.theme.style ?? null;
}

/** The theme's CSS (the same for every notification), generated once per theme and cached. '' = leave stock. */
export function themeCss(): string {
    if (!loaded) return '';
    cssCache ??= buildCss(loaded.theme.style, selectors);
    return cssCache;
}

/** The theme's entrance and exit CSS (one block for every type), cached. '' = Steam's own slide. */
export function animationCss(): string {
    if (!loaded) return '';
    animationCache ??= buildAnimationCss(loaded.theme, selectors);
    return animationCache;
}

/** The theme's sound: a decoded clip, `false` to mute, or `null` for Steam's own. */
export function themeSound(): { buffer: AudioBuffer; volume: number } | false | null {
    const spec = themeStyle()?.sound;
    if (spec === false) return false;
    if (!spec) return null;
    const buffer = loaded?.audio.get(spec.path);
    return buffer ? { buffer, volume: spec.volumePct / 100 } : null;
}

/** Tier memo keyed by the notification's data object: computed once, read by sound, banner, placement and captures. */
const tiers = new WeakMap<object, Tier>();

export function tierFor(n: SteamNotification): Tier {
    const memo = tiers.get(n.data);
    if (memo) return memo;
    let tier: Tier = 'normal';
    try {
        tier = tierOfNotification({ id: achievementIdOf(n), globalPct: n.data.global_achieved_pct() }, achievements?.theme ?? null);
    } catch (error) {
        logger.warn('Could not determine rarity tier; using normal.', error);
    }
    tiers.set(n.data, tier);
    return tier;
}

function dataUrlToArrayBuffer(url: string): ArrayBuffer {
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/** Every sound path the theme uses: the notification sound and each tier's. */
function soundPaths(theme: ResolvedTheme): Set<string> {
    const paths = new Set<string>();
    if (theme.style.sound) paths.add(theme.style.sound.path);
    for (const tier of Object.values(theme.achievements?.tiers ?? {})) if (tier.sound) paths.add(tier.sound.path);
    return paths;
}

/** "Steam default": no theme, so every surface leaves Steam's look, sound and display time alone. */
function clear(): void {
    loaded = null;
    achievements = null;
    issues = null;
    cssCache = undefined;
    animationCache = undefined;
    logger.info('Steam default: no theme loaded.');
    for (const listener of listeners) listener();
}

async function load(name: string): Promise<void> {
    if (name === STEAM_DEFAULT_THEME) return clear();
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
        const decoded = new Map<string, AudioBuffer>();
        for (const path of soundPaths(theme)) {
            const url = assets.get(path);
            if (!url) continue;
            try {
                decoded.set(path, await audio().decodeAudioData(dataUrlToArrayBuffer(url)));
            } catch (error) {
                warn(`Could not decode ${path}; using the fallback sound.`, error);
            }
        }

        loaded = { name, theme, audio: decoded, assets };
        achievements = null;
        if (theme.achievements) {
            const sounds = new Map<Tier, { buffer: AudioBuffer; volume: number }>();
            for (const tier of Object.values(theme.achievements.tiers)) {
                const buffer = tier.sound ? decoded.get(tier.sound.path) : undefined;
                if (tier.sound && buffer) sounds.set(tier.tier, { buffer, volume: tier.sound.volumePct / 100 });
            }
            achievements = { name, theme: theme.achievements, assets, sounds };
        }
        logger.info(`Theme "${name}" loaded (${assets.size} assets, ${decoded.size} sounds${achievements ? ', achievement banner' : ''}).`);
    } catch (error) {
        // An unusable theme means stock Steam, never a half-styled toast.
        loaded = null;
        achievements = null;
        failure = error instanceof Error ? error.message : String(error);
        logger.error(`Theme "${name}" could not be loaded; toasts stay stock.`, error);
    }
    cssCache = undefined;
    animationCache = undefined;
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
