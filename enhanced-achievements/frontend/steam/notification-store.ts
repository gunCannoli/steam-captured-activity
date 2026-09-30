import { logger } from '../logger';
import type { SteamNotification } from '../kernel/notification';

/**
 * Steam's NotificationStore, found once at start-up (read-only: nothing here
 * writes into Steam; the hook, the surfaces and the sensor do that).
 *
 * Verified live (docs/steam-components.md § Resolution signatures & toast
 * windows):
 * - `PlayNotificationSound(n)` is a plain prototype method: it looks up the
 *   per-type config and asks `this.ChooseSound(config, n)`, which already
 *   honours Steam's "play sound on toast" setting.
 * - `ProcessNotification` is a bound, non-writable own property, so it cannot
 *   be wrapped. The toast duration comes from the per-type config's
 *   `toastDurationMS` instead, which both the desktop and in-game overlay paths read.
 * - Achievement notifications carry `data.getClassName() ===
 *   "CClientNotificationAchievement"`. The numeric eType is discovered from
 *   that at startup, never hardcoded.
 */

const ACHIEVEMENT_CLASS = 'CClientNotificationAchievement';

export interface NotificationStoreHandle {
    store: { OnNotification(id: number, eType: number, bytes: Uint8Array): void; m_nNextTestNotificationID?: number };
    proto: { PlayNotificationSound(this: unknown, n: SteamNotification): void; ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown };
    achievementType: number;
    config: { toastDurationMS?: number; proto?: unknown };
    pristineDurationMs: number | undefined;
}

interface TypeConfig {
    toastDurationMS?: number;
    proto?: new () => { getClassName?(): string };
}

interface ProgressCache {
    m_achievementProgress?: { mapCache?: Map<number, { unlocked?: unknown; total?: unknown; all_unlocked?: unknown }> };
}

let handle: NotificationStoreHandle | null = null;

/** The numeric eType of achievement notifications on this Steam build; null until the store is resolved. */
export function achievementEType(): number | null {
    return handle?.achievementType ?? null;
}

/** The resolved store, or null (not resolved, or Steam lacks it). */
export function notificationStore(): NotificationStoreHandle | null {
    return handle;
}

/** O(1): is this an unlocked-achievement notification (not a progress toast)? */
export function isAchievementUnlock(n: SteamNotification | undefined): n is SteamNotification {
    if (!n || handle === null || n.eType !== handle.achievementType) return false;
    try {
        return n.data.achieved() === true;
    } catch {
        return false;
    }
}

/** O(1): Steam's achievement progress for an app, as its cache holds it right now. */
export function progressFor(appid: number): { unlocked?: unknown; total?: unknown; all_unlocked?: unknown } | undefined {
    const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as ProgressCache | undefined;
    return cache?.m_achievementProgress?.mapCache?.get(appid);
}

/**
 * Find the per-type config for achievements. `PlayNotificationSound` only
 * reads `this.ChooseSound` and the config table, so calling the original on a
 * stand-in object hands us each type's config without playing anything.
 */
function discoverAchievementType(p: NotificationStoreHandle['proto']): { eType: number; config: TypeConfig } | null {
    let captured: TypeConfig | undefined;
    const standIn = {
        ChooseSound(config: TypeConfig) {
            captured = config;
            return null;
        },
    };
    for (let eType = 0; eType < 256; eType++) {
        captured = undefined;
        try {
            p.PlayNotificationSound.call(standIn, { eType } as SteamNotification);
        } catch {
            continue;
        }
        // Assigned inside standIn.ChooseSound, which TS cannot see.
        const config = captured as TypeConfig | undefined;
        if (!config?.proto) continue;
        let className: string | undefined;
        try {
            className = new config.proto().getClassName?.();
        } catch {
            continue;
        }
        if (className === ACHIEVEMENT_CLASS) return { eType, config };
    }
    return null;
}

/**
 * Steam's own `toastDurationMS` for a type config, before any plugin wrote it.
 * SAME HELPER in enhanced-notifications (plugins may not import each other):
 * the first plugin to see a config records its value in a shared global
 * WeakMap, so whichever loads second still restores Steam's value, not the
 * other plugin's.
 */
function pristineDuration(config: object & { toastDurationMS?: number }): number | undefined {
    const g = globalThis as { __enhancedPristineToastDurations?: WeakMap<object, number | undefined> };
    const stash = (g.__enhancedPristineToastDurations ??= new WeakMap());
    if (!stash.has(config)) stash.set(config, config.toastDurationMS);
    return stash.get(config);
}

/** Resolve the store once, at start-up. null: Steam lacks what we need, leave it stock. */
export function resolveNotificationStore(): NotificationStoreHandle | null {
    const candidate = Reflect.get(globalThis, 'NotificationStore') as NotificationStoreHandle['store'] | undefined;
    const p = candidate ? (Object.getPrototypeOf(candidate) as NotificationStoreHandle['proto']) : null;
    if (!candidate || typeof p?.PlayNotificationSound !== 'function' || typeof p.ChooseSound !== 'function') {
        logger.warn('NotificationStore not found; enhanced-achievements is inactive.');
        return null;
    }
    const found = discoverAchievementType(p);
    if (!found) {
        logger.warn('Could not identify the achievement notification type; enhanced-achievements is inactive.');
        return null;
    }
    handle = { store: candidate, proto: p, achievementType: found.eType, config: found.config, pristineDurationMs: pristineDuration(found.config) };
    return handle;
}
