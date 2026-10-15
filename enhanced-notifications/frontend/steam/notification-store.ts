import { EClientNotificationType } from '@steambrew/client';
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
 *   honours Steam's "play sound on toast" setting. Each type's config (with
 *   `toastDurationMS`) is reachable through a stand-in call.
 * - `ProcessNotification` is a bound, non-writable own property, so it cannot
 *   be wrapped. The toast duration comes from the per-type config's
 *   `toastDurationMS` instead, which both the desktop and in-game overlay paths read.
 * - Type names come from the SDK's `EClientNotificationType`, verified 1:1 with
 *   `notification.eType`, so themes never use numbers.
 * - Achievement notifications carry `data.getClassName() ===
 *   "CClientNotificationAchievement"`. Their eType is discovered from that at
 *   startup, never hardcoded.
 */

const ACHIEVEMENT_CLASS = 'CClientNotificationAchievement';

export interface TypeConfig {
    toastDurationMS?: number;
    showToast?: unknown;
    /** The type's protobuf class: how achievements are recognised, and how synthetic achievement toasts are built. */
    proto?: new () => { getClassName?(): string };
}

export interface NotificationStoreHandle {
    store: { OnNotification(id: number, eType: number, bytes: Uint8Array): void; m_nNextTestNotificationID?: number };
    proto: { PlayNotificationSound(this: unknown, n: SteamNotification): void; ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown };
    /** eType -> Steam's per-type config, and Steam's own toast duration for it. */
    configs: Map<number, { config: TypeConfig; pristineMs: number | undefined }>;
    /** The achievement type: its eType and config. null when this Steam build has none we recognise (the banner, its sound, the 100% toast and captures stay off). */
    achievement: { eType: number; config: TypeConfig; pristineMs: number | undefined } | null;
}

interface ProgressCache {
    m_achievementProgress?: { mapCache?: Map<number, { unlocked?: unknown; total?: unknown; all_unlocked?: unknown }> };
}

/** eType -> name, built once from the SDK enum, plus `Type<n>` for types Steam has and the enum lacks. */
const names = new Map<number, string>();
/** How far past the SDK enum's last value start-up asks Steam for a type config. */
const UNNAMED_TYPES_PAST_SDK = 32;
let handle: NotificationStoreHandle | null = null;

/** O(1): Steam's name for a notification type, or null if unknown. */
export function typeName(eType: number | undefined): string | null {
    return eType === undefined ? null : (names.get(eType) ?? null);
}

/** Steam's eType for a type name (the SDK enum's, or `Type<n>`), or null. O(types): for clicks, never a hot path. */
export function eTypeOf(name: string): number | null {
    for (const [eType, n] of names) if (n === name) return eType;
    return null;
}

/** The resolved store, or null (not resolved, or Steam lacks it). */
export function notificationStore(): NotificationStoreHandle | null {
    return handle;
}

/** The numeric eType of achievement notifications on this Steam build; null until resolved, or when it has none. */
export function achievementEType(): number | null {
    return handle?.achievement?.eType ?? null;
}

/** O(1): is this an unlocked-achievement notification (not a progress toast)? */
export function isAchievementUnlock(n: SteamNotification | undefined): n is SteamNotification {
    const eType = achievementEType();
    if (!n || eType === null || n.eType !== eType) return false;
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
 * Steam's own `toastDurationMS` for a type config, before any plugin wrote it.
 * Recorded in a global WeakMap the first time a config is seen (by this plugin,
 * or before it was merged by enhanced-achievements, which used the same helper),
 * so a second load of the plugin in one session still restores Steam's value,
 * not the value the first load wrote.
 */
function pristineDuration(config: object & { toastDurationMS?: number }): number | undefined {
    const g = globalThis as { __enhancedPristineToastDurations?: WeakMap<object, number | undefined> };
    const stash = (g.__enhancedPristineToastDurations ??= new WeakMap());
    if (!stash.has(config)) stash.set(config, config.toastDurationMS);
    return stash.get(config);
}

/** Collect each type's config via a stand-in call (plays nothing). */
function discoverConfigs(p: NotificationStoreHandle['proto']): NotificationStoreHandle['configs'] {
    for (const [key, value] of Object.entries(EClientNotificationType as unknown as Record<string, unknown>)) {
        if (typeof value === 'number' && value > 0) names.set(value, key);
    }
    const configs: NotificationStoreHandle['configs'] = new Map();
    let captured: TypeConfig | undefined;
    const standIn = {
        ChooseSound(config: TypeConfig) {
            captured = config;
            return null;
        },
    };
    // Steam has types the SDK enum lacks (verified live 2026-10-01: the firmware update toast is eType 61, the enum
    // ends at 58), so ask past its end too; a type Steam has a config for but the SDK cannot name is `Type<n>`.
    const last = Math.max(0, ...names.keys()) + UNNAMED_TYPES_PAST_SDK;
    for (let eType = 1; eType <= last; eType++) {
        captured = undefined;
        try {
            p.PlayNotificationSound.call(standIn, { eType } as SteamNotification);
        } catch {
            continue;
        }
        const config = captured as TypeConfig | undefined; // assigned in standIn
        if (!config || typeof config !== 'object') continue;
        configs.set(eType, { config, pristineMs: pristineDuration(config) });
        if (!names.has(eType)) names.set(eType, `Type${eType}`);
    }
    return configs;
}

/** The type whose protobuf class is Steam's achievement notification, or null. */
function findAchievementType(configs: NotificationStoreHandle['configs']): NotificationStoreHandle['achievement'] {
    for (const [eType, { config, pristineMs }] of configs) {
        if (typeof config.proto !== 'function') continue;
        let className: string | undefined;
        try {
            className = new config.proto().getClassName?.();
        } catch {
            continue;
        }
        if (className === ACHIEVEMENT_CLASS) return { eType, config, pristineMs };
    }
    return null;
}

/** Resolve the store once, at start-up. null: Steam lacks what we need, leave it stock. */
export function resolveNotificationStore(): NotificationStoreHandle | null {
    const store = Reflect.get(globalThis, 'NotificationStore') as NotificationStoreHandle['store'] | undefined;
    const p = store ? (Object.getPrototypeOf(store) as NotificationStoreHandle['proto']) : null;
    if (!store || typeof p?.PlayNotificationSound !== 'function' || typeof p.ChooseSound !== 'function') {
        logger.warn('NotificationStore not found; enhanced-notifications is inactive.');
        return null;
    }
    const configs = discoverConfigs(p);
    if (!names.size) {
        logger.warn('EClientNotificationType unavailable; enhanced-notifications is inactive.');
        return null;
    }
    const achievement = findAchievementType(configs);
    if (!achievement) logger.warn('Could not identify the achievement notification type; the achievement banner, its sounds and captures are off.');
    handle = { store, proto: p, configs, achievement };
    return handle;
}
