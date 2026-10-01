import { logger } from '../logger';
import { rpc } from '../rpc';
import { setting, onSettingChange } from '../settings/settings';
import { parseJsonc } from './jsonc';
import { buildAnimationCss, buildCss, resolveTheme, type ResolvedStyle, type ResolvedTheme, type ToastSelectors } from './theme';

/**
 * The active theme, with sounds pre-decoded and per-type CSS cached.
 *
 * Loading happens once per theme change. Toast-time reads (`styleFor`,
 * `cssFor`, `soundFor`) are map lookups: no disk, RPC or network work per toast.
 */

export interface LoadedTheme {
    name: string;
    theme: ResolvedTheme;
    /** Decoded audio per asset path; missing or undecodable paths are absent. */
    audio: Map<string, AudioBuffer>;
}

let loaded: LoadedTheme | null = null;
let loading: Promise<void> | null = null;
let audioContext: AudioContext | null = null;
let selectors: ToastSelectors = {};
const cssCache = new Map<string, string>();
/** The theme's entrance/exit CSS, built once per theme load; undefined = not built yet. */
let animationCache: string | undefined;
const listeners = new Set<() => void>();

export function activeTheme(): LoadedTheme | null {
    return loaded;
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
    animationCache = undefined;
}

export function styleFor(typeName: string): ResolvedStyle | null {
    return loaded?.theme.styleFor(typeName) ?? null;
}

/** Scoped CSS for a type, generated once per theme and cached. '' = leave stock. */
export function cssFor(typeName: string): string {
    const style = styleFor(typeName);
    if (!style) return '';
    let css = cssCache.get(typeName);
    if (css === undefined) {
        css = buildCss(typeName, style, selectors);
        cssCache.set(typeName, css);
    }
    return css;
}

/** The theme's entrance and exit CSS (one block for every type), cached. '' = Steam's own slide. */
export function animationCss(): string {
    if (!loaded) return '';
    animationCache ??= buildAnimationCss(loaded.theme, selectors);
    return animationCache;
}

/** Theme sound for a type: a decoded clip, `false` to mute, or `null` for Steam's own. */
export function soundFor(typeName: string): { buffer: AudioBuffer; volume: number } | false | null {
    const spec = styleFor(typeName)?.sound;
    if (spec === false) return false;
    if (!spec) return null;
    const buffer = loaded?.audio.get(spec.path);
    return buffer ? { buffer, volume: spec.volumePct / 100 } : null;
}

function dataUrlToArrayBuffer(url: string): ArrayBuffer {
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function load(name: string): Promise<void> {
    try {
        const file = await rpc.loadTheme(name);
        const theme = resolveTheme(parseJsonc(file.text));
        const decoded = new Map<string, AudioBuffer>();
        if (theme.assetPaths.length) {
            const urls = await rpc.loadAssets(file.dir, theme.assetPaths);
            for (const [path, url] of Object.entries(urls)) {
                if (!url) {
                    logger.warn(`Theme "${name}": sound unavailable, keeping Steam's: ${path}`);
                    continue;
                }
                try {
                    decoded.set(path, await audio().decodeAudioData(dataUrlToArrayBuffer(url)));
                } catch (error) {
                    logger.warn(`Theme "${name}": could not decode ${path}; keeping Steam's sound.`, error);
                }
            }
        }
        loaded = { name, theme, audio: decoded };
        cssCache.clear();
        animationCache = undefined;
        for (const warning of theme.warnings) logger.warn(`Theme "${name}": ${warning}`);
        logger.info(`Theme "${name}" loaded (${decoded.size} sounds).`);
    } catch (error) {
        loaded = null;
        cssCache.clear();
        animationCache = undefined;
        logger.error(`Theme "${name}" could not be loaded; toasts stay stock.`, error);
    }
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
