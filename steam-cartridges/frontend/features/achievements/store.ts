import { logger } from "../../logger";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import type { AchievementSchemaRecord, AchievementUnlockRecord } from "../../rpc";
import type { SteamAppAchievements } from "./types";
import { buildAchievementProgress, buildSteamAchievements } from "./achievements-core";

const achievementsMap = new Map<number, SteamAppAchievements>();
const schemasMap = new Map<number, AchievementSchemaRecord>();
const unlocksMap = new Map<number, Record<string, AchievementUnlockRecord>>();

let storeHooked = false;

/**
 * Monkey-patches AppDetailsStore.GetAchievements to serve mirrored non-Steam achievements.
 */
export function ensureAchievementsStoreHooked(): boolean {
    if (storeHooked) return true;

    const store = (window as any).appDetailsStore;
    if (!store || typeof store.GetAchievements !== "function") {
        return false;
    }

    const origGetAchievements = store.GetAchievements.bind(store);
    store.GetAchievements = function (appId: number) {
        const id = Number(appId);
        if (id >= NON_STEAM_APPID_MIN && achievementsMap.has(id)) {
            return achievementsMap.get(id);
        }
        return origGetAchievements(appId);
    };

    storeHooked = true;
    logger.info("Successfully hooked appDetailsStore.GetAchievements for non-Steam games.");
    return true;
}

/**
 * Updates achievements state for a shortcut and synchronizes with Steam's internal caches.
 */
export function setShortcutAchievements(
    shortcutAppId: number,
    achievements: SteamAppAchievements,
): void {
    achievementsMap.set(shortcutAppId, achievements);

    // Synchronize Big Picture Mode play bar cache
    try {
        const progress = buildAchievementProgress(achievements);
        if (progress) {
            const cache = (window as any).appAchievementProgressCache?.m_achievementProgress?.mapCache;
            if (cache && typeof cache.set === "function") {
                cache.set(shortcutAppId, progress);
            }
        }
    } catch (e) {
        logger.warn("Could not update Big Picture achievement progress cache:", e);
    }

    // Trigger re-render of desktop right-column section and other observers
    try {
        (window as any).appDetailsStore?.AppDetailsChanged?.(shortcutAppId);
    } catch (e) {
        logger.warn("Failed to notify appDetailsStore of achievement change:", e);
    }
}

/**
 * Updates full state from backend schema & unlocks.
 */
export function updateShortcutState(
    shortcutAppId: number,
    nativeAppId: number,
    schema: AchievementSchemaRecord | undefined,
    unlocks: Record<string, AchievementUnlockRecord> = {},
): SteamAppAchievements | null {
    if (nativeAppId > 0 && schema) {
        schemasMap.set(nativeAppId, schema);
    }
    unlocksMap.set(shortcutAppId, unlocks);

    const built = buildSteamAchievements(schema, unlocks);
    if (built) {
        setShortcutAchievements(shortcutAppId, built);
    }
    return built;
}

export function getLocalAchievements(shortcutAppId: number): SteamAppAchievements | undefined {
    return achievementsMap.get(shortcutAppId);
}

export function getLocalSchema(nativeAppId: number): AchievementSchemaRecord | undefined {
    return schemasMap.get(nativeAppId);
}

export function getLocalUnlocks(shortcutAppId: number): Record<string, AchievementUnlockRecord> | undefined {
    return unlocksMap.get(shortcutAppId);
}
