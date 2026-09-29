import { logger } from "../../logger";
import { rpc } from "../../rpc";
import { dispatchAchievementToast } from "./dispatcher";
import {
    ensureAchievementsStoreHooked,
    getLocalAchievements,
    getLocalSchema,
    getLocalUnlocks,
    updateShortcutState,
} from "./store-port";
import type { SteamAppAchievements } from "../../steam/achievement-types";

import { dispatchLaunchToast, handleAppLaunchAchievements } from "./launch-toast";
import { checkObserverUnlocks, startAchievementsObserver } from "./observer-session";
import { setting } from "../../settings/settings";

export {
    ensureAchievementsStoreHooked,
    getLocalAchievements,
    getLocalSchema,
    getLocalUnlocks,
    dispatchLaunchToast,
    handleAppLaunchAchievements,
    dispatchAchievementToast,
    checkObserverUnlocks,
    startAchievementsObserver,
};

let fakeListenerRegistered = false;

/**
 * Initializes the native achievements subsystem on plugin load.
 */
export function initAchievements(): void {
    if (!fakeListenerRegistered && typeof window !== 'undefined') {
        fakeListenerRegistered = true;
        window.addEventListener('cartridges:trigger_fake_achievement', (e: Event) => {
            const detail = (e as CustomEvent)?.detail;
            const targetAppId = detail?.shortcutAppId || detail?.appid;
            const achievement = detail?.achievement || {
                id: 'fake_achievement_' + Date.now(),
                name: 'Retro Champion',
                description: 'Unlocked an achievement via RetroAchievements emulator!',
                icon: 'https://media.retroachievements.org/Badge/00001.png',
                global_pct: 100,
            };
            if (targetAppId) {
                dispatchAchievementToast(targetAppId, achievement);
            }
        });
    }

    if (ensureAchievementsStoreHooked()) return;

    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        if (ensureAchievementsStoreHooked() || attempts >= 10) {
            clearInterval(interval);
        }
    }, 500);
}

/**
 * Loads and caches achievements for a shortcut mapped to a native Steam app.
 */
export async function loadAchievementsForApp(
    shortcutAppId: number,
    nativeAppId: number,
): Promise<SteamAppAchievements | null> {
    ensureAchievementsStoreHooked();

    try {
        const hardcore = setting('raHardcoreMode');
        const res = await rpc.cartridgesAchievementsGet(shortcutAppId, nativeAppId, hardcore);
        if (res.error) {
            logger.warn(`Failed loading achievements for shortcut ${shortcutAppId}:`, res.error);
            return null;
        }

        if (res.schema) {
            const built = updateShortcutState(
                shortcutAppId,
                nativeAppId,
                res.schema,
                res.unlocks || {},
            );
            logger.info(
                `Achievements loaded for shortcut ${shortcutAppId} (native ${nativeAppId}): ` +
                `${built?.nAchieved ?? 0} / ${built?.nTotal ?? 0} unlocked.`,
            );
            return built;
        }
    } catch (e) {
        logger.error(`Error loading achievements for shortcut ${shortcutAppId}:`, e);
    }
    return null;
}

/**
 * Triggers an achievement unlock: persists locally, updates UI stores, and dispatches native toast.
 * If targetAchievementId is omitted, picks the next locked achievement.
 */
export async function triggerAchievement(
    shortcutAppId: number,
    targetAchievementId?: string,
): Promise<boolean> {
    ensureAchievementsStoreHooked();

    const current = getLocalAchievements(shortcutAppId);
    let itemToUnlock = targetAchievementId
        ? current?.vecUnachieved.find((a) => a.strID === targetAchievementId)
        : current?.vecUnachieved[0];

    if (!itemToUnlock) {
        // If not in unachieved or current is empty, check schema directly
        const schema = Array.from([
            getLocalSchema(shortcutAppId),
            // or find schema with this achievement id
        ]).find(Boolean);
        const item = schema?.achievements.find((a) => !targetAchievementId || a.id === targetAchievementId);
        if (item) {
            itemToUnlock = {
                strID: item.id,
                strName: item.name,
                strDescription: item.description,
                strImage: item.icon,
                bAchieved: false,
                rtUnlocked: 0,
                flAchieved: item.global_pct,
            };
        }
    }

    if (!itemToUnlock) {
        logger.warn(`Cannot unlock: no achievement found for shortcut ${shortcutAppId}`);
        return false;
    }

    const unlockTime = Math.floor(Date.now() / 1000);
    try {
        const res = await rpc.cartridgesAchievementsUnlock(
            shortcutAppId,
            itemToUnlock.strID,
            unlockTime,
        );

        if (res.error) {
            logger.error(`Failed to record achievement unlock via RPC: ${res.error}`);
            return false;
        }

        // Update local state with latest unlocks
        const existingSchema = getLocalSchema(current?.nTotal ? (current as any).nativeAppId : 0)
            || (current ? {
                native_appid: 0,
                total: current.nTotal,
                achievements: [...current.vecAchieved, ...current.vecUnachieved].map((a) => ({
                    id: a.strID,
                    name: a.strName,
                    description: a.strDescription,
                    icon: a.strImage,
                    global_pct: a.flAchieved ?? 0,
                })),
            } : undefined);

        if (existingSchema) {
            updateShortcutState(shortcutAppId, existingSchema.native_appid, existingSchema, res.unlocks);
        }

        // Dispatch native toast notification
        dispatchAchievementToast(shortcutAppId, {
            id: itemToUnlock.strID,
            name: itemToUnlock.strName,
            description: itemToUnlock.strDescription,
            icon: itemToUnlock.strImage,
            global_pct: itemToUnlock.flAchieved,
            rtime_unlocked: unlockTime,
        });

        return true;
    } catch (e) {
        logger.error(`Error triggering achievement ${itemToUnlock.strID}:`, e);
        return false;
    }
}

/**
 * Resets all unlocked achievements for a shortcut.
 */
export async function resetAchievements(shortcutAppId: number): Promise<boolean> {
    ensureAchievementsStoreHooked();

    try {
        const res = await rpc.cartridgesAchievementsReset(shortcutAppId);
        if (res.error) {
            logger.error(`Failed resetting achievements: ${res.error}`);
            return false;
        }

        const current = getLocalAchievements(shortcutAppId);
        if (current) {
            const schema = {
                native_appid: 0,
                total: current.nTotal,
                achievements: [...current.vecAchieved, ...current.vecUnachieved].map((a) => ({
                    id: a.strID,
                    name: a.strName,
                    description: a.strDescription,
                    icon: a.strImage,
                    global_pct: a.flAchieved ?? 0,
                })),
            };
            updateShortcutState(shortcutAppId, 0, schema, {});
        }
        logger.info(`Reset achievements for shortcut ${shortcutAppId}`);
        return true;
    } catch (e) {
        logger.error(`Error resetting achievements for shortcut ${shortcutAppId}:`, e);
        return false;
    }
}
