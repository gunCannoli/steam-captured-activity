import { EClientNotificationType } from '@steambrew/client';
import { logger } from '../logger';
import type { SteamNotification } from '../kernel/notification';

/**
 * Steam's NotificationStore, found once at start-up (read-only: nothing here
 * writes into Steam; the hook and the surfaces do that).
 *
 * Same verified mechanics as enhanced-achievements (docs/steam-components.md §
 * Resolution signatures & toast windows): `PlayNotificationSound` is a plain
 * prototype method that asks `this.ChooseSound(config, n)`, and each type's
 * config (with `toastDurationMS`) is reachable through a stand-in call.
 *
 * Type names come from the SDK's `EClientNotificationType`, verified 1:1 with
 * `notification.eType`, so themes never use numbers.
 */

export interface TypeConfig {
    toastDurationMS?: number;
    showToast?: unknown;
}

export interface NotificationStoreHandle {
    store: object;
    proto: { PlayNotificationSound(this: unknown, n: SteamNotification): void; ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown };
    /** eType -> Steam's per-type config, and Steam's own toast duration for it. */
    configs: Map<number, { config: TypeConfig; pristineMs: number | undefined }>;
}

/** eType -> name, built once from the SDK enum. */
const names = new Map<number, string>();
let handle: NotificationStoreHandle | null = null;

/** Every known type name (for building the whole theme's CSS once). */
export function knownTypeNames(): string[] {
    return [...names.values()];
}

/** O(1): Steam's name for a notification type, or null if unknown. */
export function typeName(eType: number | undefined): string | null {
    return eType === undefined ? null : (names.get(eType) ?? null);
}

/** The resolved store, or null (not resolved, or Steam lacks it). */
export function notificationStore(): NotificationStoreHandle | null {
    return handle;
}

/**
 * Steam's own `toastDurationMS` for a type config, before any plugin wrote it.
 * SAME HELPER in enhanced-achievements (plugins may not import each other):
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
    for (const eType of names.keys()) {
        captured = undefined;
        try {
            p.PlayNotificationSound.call(standIn, { eType });
        } catch {
            continue;
        }
        const config = captured as TypeConfig | undefined; // assigned in standIn
        if (config && typeof config === 'object') configs.set(eType, { config, pristineMs: pristineDuration(config) });
    }
    return configs;
}

/** Resolve the store once, at start-up. null: Steam lacks what we need, leave it stock. */
export function resolveNotificationStore(): NotificationStoreHandle | null {
    const store = Reflect.get(globalThis, 'NotificationStore') as object | undefined;
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
    handle = { store, proto: p, configs };
    return handle;
}
