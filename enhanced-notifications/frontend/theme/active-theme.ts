import { logger } from '../logger';
import { rpc } from '../rpc';
import { setting, onSettingChange } from '../settings/settings';
import { parseJsonc } from './jsonc';
import { achievementIdOf, type SteamNotification } from '../kernel/notification';
import { buildAnimationCss, buildCss, resolveTheme, themeForMode, type ResolvedStyle, type ResolvedTheme, type ThemeMode, type ToastSelectors } from './theme';
import { tierOfNotification, type AchievementTheme, type Tier } from './achievements';
import { STEAM_DEFAULT_THEME } from './schema';

/**
 * The active theme, with every asset loaded, its sounds pre-decoded and its CSS cached.
 *
 * Loading happens once per theme change (startup, theme setting, "Reload themes"). Toast-time reads
 * (`themeStyle`, `themeCss`, `animationCss`, `themeSound`, `achievementTheme`, `tierFor`) are cached values:
 * no disk, RPC or network work per toast.
 *
 * A theme has two looks (ADR-0068): desktop, and Big Picture (its `bigpicture` block merged over the rest). Every read
 * takes the mode; left out, it is Steam's current one (`setModeSource`, wired by index.tsx: this layer never reads
 * Steam). Both looks share one asset load.
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
/** The Big Picture look; the same object as `loaded` when the theme has no `bigpicture` block. */
let loadedBp: LoadedTheme | null = null;
let achievements: LoadedAchievementTheme | null = null;
let achievementsBp: LoadedAchievementTheme | null = null;
let modeSource: () => ThemeMode = () => 'desktop';
let issues: ThemeIssues | null = null;
let loading: Promise<void> | null = null;
let audioContext: AudioContext | null = null;
let selectors: ToastSelectors = {};
/** The theme's CSS per mode, built once per theme load; absent = not built yet. */
const cssCache = new Map<ThemeMode, string>();
/** The theme's entrance/exit CSS per mode, built once per theme load; absent = not built yet. */
const animationCache = new Map<ThemeMode, string>();
const listeners = new Set<() => void>();

/** Where the current mode comes from (index.tsx: Steam's UI mode). Set once at start-up. */
export function setModeSource(source: () => ThemeMode): void {
    modeSource = source;
}

/** Steam switched between desktop and Big Picture: with a `bigpicture` block, every surface follows the other look. */
export function modeChanged(): void {
    if (loaded && loadedBp !== loaded) for (const listener of listeners) listener();
}

export function currentMode(): ThemeMode {
    return modeSource();
}

export function activeTheme(mode: ThemeMode = modeSource()): LoadedTheme | null {
    return mode === 'bigpicture' ? loadedBp : loaded;
}

/** The achievement banner's theme, or null: no theme loaded, or it has no `achievements` block (in that mode). */
export function achievementTheme(mode: ThemeMode = modeSource()): LoadedAchievementTheme | null {
    return mode === 'bigpicture' ? achievementsBp : achievements;
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
    cssCache.clear();
    animationCache.clear();
}

/** The one style every notification gets, or null with no theme loaded. */
export function themeStyle(mode: ThemeMode = modeSource()): ResolvedStyle | null {
    return activeTheme(mode)?.theme.style ?? null;
}

/** The theme's CSS (the same for every notification), generated once per theme and mode and cached. '' = leave stock. */
export function themeCss(mode: ThemeMode = modeSource()): string {
    const t = activeTheme(mode);
    if (!t) return '';
    let css = cssCache.get(mode);
    if (css === undefined) cssCache.set(mode, (css = buildCss(t.theme.style, selectors)));
    return css;
}

/** The theme's entrance and exit CSS (one block for every type), cached per mode. '' = Steam's own slide. */
export function animationCss(mode: ThemeMode = modeSource()): string {
    const t = activeTheme(mode);
    if (!t) return '';
    let css = animationCache.get(mode);
    if (css === undefined) animationCache.set(mode, (css = buildAnimationCss(t.theme, selectors)));
    return css;
}

/** The theme's sound: a decoded clip, `false` to mute, or `null` for Steam's own. */
export function themeSound(mode: ThemeMode = modeSource()): { buffer: AudioBuffer; volume: number } | false | null {
    const spec = themeStyle(mode)?.sound;
    if (spec === false) return false;
    if (!spec) return null;
    const buffer = activeTheme(mode)?.audio.get(spec.path);
    return buffer ? { buffer, volume: spec.volumePct / 100 } : null;
}

/** Tier memo keyed by the notification's data object: computed once, read by sound, banner, placement and captures. */
const tiers = new WeakMap<object, Tier>();

export function tierFor(n: SteamNotification): Tier {
    const memo = tiers.get(n.data);
    if (memo) return memo;
    let tier: Tier = 'normal';
    try {
        tier = tierOfNotification({ id: achievementIdOf(n), globalPct: n.data.global_achieved_pct() }, achievementTheme()?.theme ?? null);
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

/** Every sound path the theme uses: the notification sound and each tier's, in both looks. */
function soundPaths(theme: ResolvedTheme): Set<string> {
    const paths = new Set<string>();
    for (const look of [theme, theme.bigPicture]) {
        if (!look) continue;
        if (look.style.sound) paths.add(look.style.sound.path);
        for (const tier of Object.values(look.achievements?.tiers ?? {})) if (tier.sound) paths.add(tier.sound.path);
    }
    return paths;
}

/** One look's achievement banner, with its tiers' decoded sounds; null without an `achievements` block. */
function bannerOf(name: string, theme: ResolvedTheme, assets: Map<string, string>, decoded: Map<string, AudioBuffer>): LoadedAchievementTheme | null {
    if (!theme.achievements) return null;
    const sounds = new Map<Tier, { buffer: AudioBuffer; volume: number }>();
    for (const tier of Object.values(theme.achievements.tiers)) {
        const buffer = tier.sound ? decoded.get(tier.sound.path) : undefined;
        if (tier.sound && buffer) sounds.set(tier.tier, { buffer, volume: tier.sound.volumePct / 100 });
    }
    return { name, theme: theme.achievements, assets, sounds };
}

/** "Steam default": no theme, so every surface leaves Steam's look, sound and display time alone. */
function clear(): void {
    loaded = loadedBp = null;
    achievements = achievementsBp = null;
    issues = null;
    cssCache.clear();
    animationCache.clear();
    logger.info('Steam default: no theme loaded.');
    for (const listener of listeners) listener();
}

/** Make a resolved theme the active one: decode its sounds once, build both looks. */
async function install(name: string, theme: ResolvedTheme, assets: Map<string, string>, warn: (text: string, error?: unknown) => void): Promise<void> {
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
    achievements = bannerOf(name, theme, assets, decoded);
    const bp = themeForMode(theme, 'bigpicture');
    loadedBp = bp === theme ? loaded : { name, theme: bp, audio: decoded, assets };
    achievementsBp = bp === theme ? achievements : bannerOf(name, bp, assets, decoded);
    const extras = `${achievements ? ', achievement banner' : ''}${bp === theme ? '' : ', own Big Picture look'}`;
    logger.info(`Theme "${name}" loaded (${assets.size} assets, ${decoded.size} sounds${extras}).`);
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

        await install(name, theme, assets, warn);
    } catch (error) {
        // An unusable theme means stock Steam, never a half-styled toast.
        loaded = loadedBp = null;
        achievements = achievementsBp = null;
        failure = error instanceof Error ? error.message : String(error);
        logger.error(`Theme "${name}" could not be loaded; toasts stay stock.`, error);
    }
    cssCache.clear();
    animationCache.clear();
    issues = failure || warnings.length ? { name, error: failure, warnings } : null;
    for (const listener of listeners) listener();
}

/** (Re)load the theme named by the `theme` setting. Ends a Theme Creator test (`loadDraft`) too. */
export function reloadTheme(): Promise<void> {
    const name = setting('theme');
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = null;
    draftActive = false;
    const next = (loading ?? Promise.resolve()).then(() => load(name));
    loading = next;
    return next;
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;
let draftActive = false;
/** The longest a creator test may stay active, whatever the caller asks (theme creator plan § 4.8). */
const DRAFT_MAX_MS = 120_000;

/** A Theme Creator test is active (its draft is the active theme). */
export function draftLoaded(): boolean {
    return draftActive;
}

/**
 * Theme Creator only (settings/creator, its "Test on screen"; plan § 4.8, D6): the draft as the active theme for at most
 * `lifetimeMs` (capped at 2 minutes), through the same install path as a theme file but from memory, never the `theme`
 * setting and never a file, so nothing persists if Steam stops mid-test. Every surface follows it through
 * `onThemeChange`. `assets`: what the creator already loaded (path -> data URL). Ends by `clearDraft`, the timer, or any
 * theme reload.
 */
export async function loadDraft(raw: unknown, assets: ReadonlyMap<string, string>, lifetimeMs: number): Promise<void> {
    const theme = resolveTheme(raw);
    const next = (loading ?? Promise.resolve()).then(async () => {
        await install('Theme Creator test', theme, new Map(assets), (text, error) => logger.warn(`Theme Creator test: ${text}`, error));
        cssCache.clear();
        animationCache.clear();
        for (const listener of listeners) listener();
    });
    loading = next;
    await next;
    draftActive = true;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void clearDraft(), Math.max(1000, Math.min(DRAFT_MAX_MS, lifetimeMs)));
}

/** End a Theme Creator test: the `theme` setting's theme again (listeners fire, durations restored). No-op without one. */
export function clearDraft(): Promise<void> {
    if (!draftActive) return Promise.resolve();
    return reloadTheme();
}

export function initActiveTheme(): Promise<void> {
    onSettingChange((key) => {
        if (key === 'theme') void reloadTheme();
    });
    return reloadTheme();
}
