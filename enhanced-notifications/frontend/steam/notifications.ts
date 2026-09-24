import { EClientNotificationType } from '@steambrew/client';
import { logger } from '../logger';
import { setting, onSettingChange } from '../settings/settings';
import { activeTheme, audio, onThemeChange, soundFor, styleFor } from '../theme/active-theme';
import type { Category } from '../theme/theme';

/**
 * NotificationStore hooks for every notification type: sound per type and
 * display time. Same verified mechanics as enhanced-achievements
 * (docs/steam-components.md § 11B): `PlayNotificationSound` is a plain
 * prototype method that asks `this.ChooseSound(config, n)`, and each type's
 * config (with `toastDurationMS`) is reachable through a stand-in call.
 *
 * Type names come from the SDK's `EClientNotificationType`, verified 1:1 with
 * `notification.eType`, so themes never use numbers.
 */

export interface SteamNotification {
    eType: number;
}

interface NotificationStoreProto {
    PlayNotificationSound(this: unknown, n: SteamNotification): void;
    ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown;
}

interface TypeConfig {
    toastDurationMS?: number;
    showToast?: unknown;
}

type Feature = 'banner' | 'sound' | 'duration';

let proto: NotificationStoreProto | null = null;
let originalPlaySound: NotificationStoreProto['PlayNotificationSound'] | null = null;
/** eType -> name, built once from the SDK enum. */
const names = new Map<number, string>();
/** eType -> Steam's per-type config, and its original toast duration. */
const configs = new Map<number, TypeConfig>();
const originalDurations = new Map<number, number | undefined>();

/** Every known type name (for building the whole theme's CSS once). */
export function knownTypeNames(): string[] {
    return [...names.values()];
}

/** O(1): Steam's name for a notification type, or null if unknown. */
export function typeName(eType: number | undefined): string | null {
    return eType === undefined ? null : (names.get(eType) ?? null);
}

// --- enhanced-achievements coexistence -------------------------------------------

/**
 * enhanced-achievements replaces achievement toasts entirely. When it is loaded
 * and claims a feature, achievement toasts are left to it. It publishes
 * `claims(feature)` on window.PLUGIN_LIST (Millennium exposes plugin exports
 * there). No import: plugins stay independent (docs/plugins.md § Layout).
 */
export function achievementsClaims(feature: Feature): boolean {
    const list = Reflect.get(globalThis, 'PLUGIN_LIST') as Record<string, { claims?: (f: Feature) => boolean }> | undefined;
    const ea = list?.['enhanced-achievements-dev'] ?? list?.['enhanced-achievements'];
    try {
        return typeof ea?.claims === 'function' && ea.claims(feature) === true;
    } catch {
        return false;
    }
}

/** Should this plugin handle `feature` for this notification type? */
export function handles(eType: number, feature: Feature): boolean {
    return names.get(eType) !== 'Achievement' || !achievementsClaims(feature);
}

// --- toast shown -------------------------------------------------------------------

const shownListeners = new Set<(eType: number) => void>();

/**
 * Fires when Steam shows a toast. Steam's toast container calls
 * `PlayNotificationSound(notification)` from an effect every time a toast is
 * displayed, whether or not a sound plays (verified live), so the sound hook is
 * also the one signal that covers desktop, Big Picture and overlay toasts.
 */
export function onToastShown(listener: (eType: number) => void): () => void {
    shownListeners.add(listener);
    return () => shownListeners.delete(listener);
}

function notifyShown(eType: number): void {
    for (const listener of shownListeners) {
        try {
            listener(eType);
        } catch (error) {
            logger.warn('Toast-shown listener threw:', error);
        }
    }
}

// --- sound ----------------------------------------------------------------------

function playClip(clip: { buffer: AudioBuffer; volume: number }): void {
    const ctx = audio();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = clip.volume;
    source.buffer = clip.buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
}

function installSoundHook(p: NotificationStoreProto, store: object): void {
    const original = p.PlayNotificationSound;
    const originalChoose = p.ChooseSound;
    originalPlaySound = original;

    p.PlayNotificationSound = function (this: { ChooseSound?: unknown }, n: SteamNotification) {
        // Only Steam's own calls (on the store) are toasts. Plugins, including
        // enhanced-achievements and our own discovery, call the method on a
        // stand-in object to read a type's config; those must pass through
        // untouched, or muting would clobber the stand-in's ChooseSound.
        if (this !== store) return original.call(this, n);
        if (typeof n?.eType === 'number') notifyShown(n.eType);
        try {
            const name = typeName(n?.eType);
            if (name && setting('sound.enabled') && handles(n.eType, 'sound')) {
                const clip = soundFor(name);
                const ctx = clip ? audio() : null;
                // `false` mutes; a clip replaces Steam's sound. Either way Steam still
                // decides whether a sound is wanted at all (its own mute setting).
                if (clip === false || (clip && ctx?.state === 'running')) {
                    let wanted = false;
                    this.ChooseSound = function (this: unknown, config: unknown, notification: SteamNotification) {
                        wanted = !!originalChoose.call(this, config, notification);
                        return null;
                    };
                    try {
                        original.call(this, n);
                    } finally {
                        delete this.ChooseSound;
                    }
                    if (wanted && clip) playClip(clip);
                    return;
                }
                if (ctx && ctx.state === 'suspended') void ctx.resume();
            }
        } catch (error) {
            logger.warn('Notification sound hook failed; using Steam sound.', error);
        }
        return original.call(this, n);
    };
}

// --- per-type configs & duration --------------------------------------------------

/** Collect each type's config via a stand-in call (plays nothing). */
function discoverConfigs(p: NotificationStoreProto): void {
    for (const [key, value] of Object.entries(EClientNotificationType as unknown as Record<string, unknown>)) {
        if (typeof value === 'number' && value > 0) names.set(value, key);
    }
    let captured: TypeConfig | undefined;
    const standIn = {
        ChooseSound(config: TypeConfig) {
            captured = config;
            return null;
        },
    };
    for (const eType of names.keys()) {
        captured = undefined;
        try {
            p.PlayNotificationSound.call(standIn, { eType });
        } catch {
            continue;
        }
        const config = captured as TypeConfig | undefined; // assigned in standIn
        if (config && typeof config === 'object') {
            configs.set(eType, config);
            originalDurations.set(eType, config.toastDurationMS);
        }
    }
}

function applyDurations(): void {
    const enabled = setting('duration.enabled') && activeTheme() !== null;
    for (const [eType, config] of configs) {
        if (!handles(eType, 'duration')) continue; // enhanced-achievements owns it
        const themed = enabled ? styleFor(names.get(eType)!)?.displayTimeMs : null;
        config.toastDurationMS = themed ?? originalDurations.get(eType);
    }
}

// --- preview ----------------------------------------------------------------------

type TestStore = Record<string, ((...args: unknown[]) => unknown) | undefined>;

/**
 * Steam's own test toast for each category. Friend and message toasts only
 * appear if Steam's Friends notification settings allow them (friend-online
 * toasts are off by default), so those previews can legitimately show nothing.
 */
const PREVIEWS: Record<Category, (store: TestStore, appid: number) => unknown> = {
    friends: (s) => s.TestFriendOnline?.(),
    messages: (s) => s.TestFriendMessage?.(),
    downloads: (s, appid) => s.TestDownloadComplete?.(appid),
    recording: (s) => s.TestGameRecordingInstantClip?.(),
    achievement: (s, appid) => s.TestAchievement?.(appid),
    system: (s, appid) => s.TestCloudSyncFailure?.(appid),
};

export async function previewCategory(category: Category): Promise<void> {
    const store = Reflect.get(globalThis, 'NotificationStore') as TestStore | undefined;
    if (!store) return;
    const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as { m_achievementProgress?: { mapCache?: Map<number, unknown> } } | undefined;
    const appid = cache?.m_achievementProgress?.mapCache?.keys().next().value ?? 480;
    void audio().resume(); // a click is a user gesture: unlock audio for the preview
    await PREVIEWS[category](store, appid);
}

// --- lifecycle --------------------------------------------------------------------

export function initNotifications(): boolean {
    const store = Reflect.get(globalThis, 'NotificationStore') as object | undefined;
    const p = store ? (Object.getPrototypeOf(store) as NotificationStoreProto) : null;
    if (!p || typeof p.PlayNotificationSound !== 'function' || typeof p.ChooseSound !== 'function') {
        logger.warn('NotificationStore not found; enhanced-notifications is inactive.');
        return false;
    }
    proto = p;
    discoverConfigs(p);
    if (!names.size) {
        logger.warn('EClientNotificationType unavailable; enhanced-notifications is inactive.');
        return false;
    }
    installSoundHook(p, store!);
    applyDurations();
    onThemeChange(applyDurations);
    onSettingChange((key) => key === 'duration.enabled' && applyDurations());
    logger.info(`Notification hooks installed (${configs.size} types).`);
    return true;
}

export function disposeNotifications(): void {
    if (proto && originalPlaySound) proto.PlayNotificationSound = originalPlaySound;
    for (const [eType, config] of configs) config.toastDurationMS = originalDurations.get(eType);
}
