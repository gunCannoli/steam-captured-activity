import { logger } from "../../logger";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import type { AchievementSchemaRecord, AchievementUnlockRecord } from "../../rpc";
import type { SteamAppAchievements } from "./types";
import { buildAchievementProgress, buildSteamAchievements } from "./achievements-core";
import { resolveSingleton } from "../../steam/modules";

const achievementsMap = new Map<number, SteamAppAchievements>();
const schemasMap = new Map<number, AchievementSchemaRecord>();
const unlocksMap = new Map<number, Record<string, AchievementUnlockRecord>>();

let storeHooked = false;
let fullStoreHooked = false;

interface AchievementsFullStore {
    m_mapMyAchievements: Map<number, any>;
    m_mapGlobalAchievements: Map<number, any>;
    m_mapPlayerAchievements: Map<string, any>;
    m_mapInflightMyAchievementsRequests?: Map<number, boolean>;
    m_mapInflightAchievementsRequests?: Map<string, boolean>;
    GetMyAchievements: (appid: number) => any;
    GetGlobalAchievements: (appid: number) => any;
    GetPlayerAchievements: (appid: number, accountid: any) => any;
    LoadMyAchievements: (appid: number) => Promise<void>;
    LoadFriendAchievements?: (appid: number, accountid: any) => Promise<void>;
}

let cachedFullStore: AchievementsFullStore | undefined;

function resolveAchievementsFullStore(): AchievementsFullStore | undefined {
    if (cachedFullStore) return cachedFullStore;
    cachedFullStore = resolveSingleton<AchievementsFullStore>("AchievementsFullStore", [
        "GetMyAchievements",
        "GetGlobalAchievements",
        "LoadMyAchievements",
    ]);
    return cachedFullStore;
}

/**
 * Feeds Steam's full achievements singleton store (module 32179 / p6)
 * so that full-page views (Big Picture Mode and desktop individual views)
 * render native achievements instead of "Failed to load achievement data".
 */
export function feedAchievementsFullStore(
    shortcutAppId: number,
    achievements: SteamAppAchievements,
): void {
    const store = resolveAchievementsFullStore();
    if (!store) return;

    const achieved: Record<string, any> = {};
    const unachieved: Record<string, any> = {};
    const globalPcts: Record<string, number> = {};

    for (const a of achievements.vecAchieved) {
        achieved[a.strID] = {
            strID: a.strID,
            strName: a.strName,
            strDescription: a.strDescription,
            strImage: a.strImage,
            bAchieved: true,
            bHidden: false,
            rtUnlocked: a.rtUnlocked,
            flAchieved: a.flAchieved ?? 0,
            flCurrentProgress: 0,
        };
        globalPcts[a.strID] = a.flAchieved ?? 0;
    }

    for (const a of achievements.vecUnachieved) {
        unachieved[a.strID] = {
            strID: a.strID,
            strName: a.strName,
            strDescription: a.strDescription,
            strImage: a.strImage,
            bAchieved: false,
            bHidden: false,
            rtUnlocked: 0,
            flAchieved: a.flAchieved ?? 0,
            flCurrentProgress: 0,
        };
        globalPcts[a.strID] = a.flAchieved ?? 0;
    }

    store.m_mapMyAchievements.set(shortcutAppId, {
        data: {
            achieved,
            unachieved,
            hidden: {},
        },
    });

    store.m_mapGlobalAchievements.set(shortcutAppId, {
        data: globalPcts,
    });
}

/**
 * Monkey-patches AchievementsFullStore methods so that full-screen views
 * never send failing GetMyAchievementsForApp requests to Steam for shortcuts.
 */
export function ensureAchievementsFullStoreHooked(): boolean {
    if (fullStoreHooked) return true;

    const store = resolveAchievementsFullStore();
    if (!store) return false;

    const proto = Object.getPrototypeOf(store);
    if (!proto) return false;

    const origLoadMy = proto.LoadMyAchievements;
    if (typeof origLoadMy === "function") {
        proto.LoadMyAchievements = async function (appId: number) {
            const id = Number(appId);
            if (id >= NON_STEAM_APPID_MIN) {
                const local = achievementsMap.get(id);
                if (local) {
                    feedAchievementsFullStore(id, local);
                    this.m_mapInflightMyAchievementsRequests?.delete(id);
                    return;
                }
            }
            return origLoadMy.call(this, appId);
        };
    }

    const origGetMy = proto.GetMyAchievements;
    if (typeof origGetMy === "function") {
        proto.GetMyAchievements = function (appId: number) {
            const id = Number(appId);
            if (id >= NON_STEAM_APPID_MIN) {
                const local = achievementsMap.get(id);
                if (local && !this.m_mapMyAchievements.has(id)) {
                    feedAchievementsFullStore(id, local);
                }
            }
            return origGetMy.call(this, appId);
        };
    }

    const origGetGlobal = proto.GetGlobalAchievements;
    if (typeof origGetGlobal === "function") {
        proto.GetGlobalAchievements = function (appId: number) {
            const id = Number(appId);
            if (id >= NON_STEAM_APPID_MIN) {
                const local = achievementsMap.get(id);
                if (local && !this.m_mapGlobalAchievements.has(id)) {
                    feedAchievementsFullStore(id, local);
                }
            }
            return origGetGlobal.call(this, appId);
        };
    }

    const origGetPlayer = proto.GetPlayerAchievements;
    if (typeof origGetPlayer === "function") {
        proto.GetPlayerAchievements = function (appId: number, accountId: any) {
            const id = Number(appId);
            if (id >= NON_STEAM_APPID_MIN) {
                const local = achievementsMap.get(id);
                if (local) {
                    const achieved: Record<string, any> = {};
                    const unachieved: Record<string, any> = {};
                    for (const a of local.vecAchieved) achieved[a.strID] = a;
                    for (const a of local.vecUnachieved) unachieved[a.strID] = a;
                    return { data: { achieved, unachieved } };
                }
            }
            return origGetPlayer.call(this, appId, accountId);
        };
    }

    const origLoadFriend = proto.LoadFriendAchievements;
    if (typeof origLoadFriend === "function") {
        proto.LoadFriendAchievements = async function (appId: number, accountId: any) {
            const id = Number(appId);
            if (id >= NON_STEAM_APPID_MIN) {
                const key = `${id}_${accountId}`;
                this.m_mapInflightAchievementsRequests?.delete(key);
                return;
            }
            return origLoadFriend.call(this, appId, accountId);
        };
    }

    fullStoreHooked = true;
    logger.info("Successfully hooked AchievementsFullStore for non-Steam individual achievements page.");
    return true;
}

/**
 * Monkey-patches AppDetailsStore.GetAchievements to serve mirrored non-Steam achievements.
 */
export function ensureAchievementsStoreHooked(): boolean {
    ensureAchievementsFullStoreHooked();

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

    // Synchronize full individual achievements store (Big Picture and desktop)
    try {
        feedAchievementsFullStore(shortcutAppId, achievements);
    } catch (e) {
        logger.warn("Could not feed AchievementsFullStore:", e);
    }

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
    if (schema) {
        if (nativeAppId > 0) {
            schemasMap.set(nativeAppId, schema);
        }
        schemasMap.set(shortcutAppId, schema);
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
