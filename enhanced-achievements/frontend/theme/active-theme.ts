import { logger } from '../logger';
import { rpc } from '../rpc';
import { setting, onSettingChange } from '../settings/settings';
import { resolveTheme, type ResolvedTheme, type Tier } from './theme';

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

let loaded: LoadedTheme | null = null;
let loading: Promise<void> | null = null;
let audioContext: AudioContext | null = null;

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
        for (const listener of listeners) listener();
        return;
    }
    try {
        const file = await rpc.loadTheme(name);
        const theme = resolveTheme(JSON.parse(file.text));
        for (const warning of theme.warnings) logger.warn(`Theme "${name}": ${warning}`);

        const assets = new Map<string, string>();
        if (theme.assetPaths.length) {
            const urls = await rpc.loadAssets(file.dir, theme.assetPaths);
            for (const [path, url] of Object.entries(urls)) {
                if (url) assets.set(path, url);
                else logger.warn(`Theme "${name}": asset unavailable, falling back: ${path}`);
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
                        logger.warn(`Theme "${name}": could not decode ${spec.path}; using Steam's chime.`, error);
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
        logger.error(`Theme "${name}" could not be loaded; using Steam's stock toast and chime.`, error);
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
