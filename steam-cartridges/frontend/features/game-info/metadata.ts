import { logger } from "../../logger";
import type { ConsolidatedMetadata } from "../../rpc";
import { MANAGED_CATEGORY_IDS, badgeCategoryIds } from "./category-policy";
import { controllerContext } from "./controller";
import {
    markAppEnriched,
    unmarkAppEnriched,
    clearAppCategories,
    ensureAppOverviewHooked,
    getAppDetailsStore,
    getAppStore,
    refreshGameInfoInstances,
    setAppCategories,
} from "./game-info-patch";

/**
 * Standard Steam Store Category IDs:
 * 1: Multi-player
 * 2: Single-player
 * 9: Co-op
 * 18: Partial Controller Support
 * 22: Steam Achievements
 * 24: Shared/Split Screen
 * 28: Full Controller Support
 * 39: Shared/Split Screen Co-op (37 is Shared/Split Screen PvP)
 * 44: Remote Play Together
 */
export const STEAM_CATEGORIES = {
    MULTIPLAYER: 1,
    SINGLE_PLAYER: 2,
    COOP: 9,
    PARTIAL_CONTROLLER: 18,
    ACHIEVEMENTS: 22,
    SPLIT_SCREEN: 24,
    FULL_CONTROLLER: 28,
    SPLIT_SCREEN_COOP: 39,
    REMOTE_PLAY_TOGETHER: 44,
} as const;

function toArray<T>(val: unknown): T[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "object") return Object.values(val as Record<string, T>);
    return [];
}

interface Originals {
    descriptionsData: unknown;
    associationData: unknown;
    rt_original_release_date: unknown;
    rt_steam_release_date: unknown;
    xbox_controller_support: unknown;
}

/** Values Steam had before our first enrichment, per appid (for revert). */
const originals = new Map<number, Partial<Originals>>();

function recordOriginals(appid: number, appData: any, overview: any): void {
    const saved = originals.get(appid) ?? {};
    if (appData && !("descriptionsData" in saved)) {
        saved.descriptionsData = appData.descriptionsData;
        saved.associationData = appData.associationData;
    }
    if (overview && !("xbox_controller_support" in saved)) {
        saved.rt_original_release_date = overview.rt_original_release_date;
        saved.rt_steam_release_date = overview.rt_steam_release_date;
        saved.xbox_controller_support = overview.xbox_controller_support;
    }
    originals.set(appid, saved);
}

/**
 * Undo enrichGameDetails for one app (the game left the web-scraping bucket).
 * Never touches appData.details (guardrail 8).
 */
export function revertGameDetails(appid: number): void {
    try {
        const saved = originals.get(appid);
        const appData = getAppDetailsStore()?.GetAppData?.(appid);
        if (saved && appData) {
            if ("descriptionsData" in saved) appData.descriptionsData = saved.descriptionsData;
            if ("associationData" in saved) appData.associationData = saved.associationData;
        }
        const overview = getAppStore()?.GetAppOverviewByAppID?.(appid);
        if (overview) {
            if (overview.m_setStoreCategories?.delete) {
                for (const catId of MANAGED_CATEGORY_IDS) overview.m_setStoreCategories.delete(catId);
            }
            if (saved && "xbox_controller_support" in saved) {
                overview.rt_original_release_date = saved.rt_original_release_date;
                overview.rt_steam_release_date = saved.rt_steam_release_date;
                overview.xbox_controller_support = saved.xbox_controller_support;
            }
        }
        const uAppid = appid >>> 0;
        originals.delete(appid);
        originals.delete(uAppid);
        clearAppCategories(appid);
        unmarkAppEnriched(appid);
        try {
            getAppDetailsStore()?.AppDetailsChanged?.(uAppid);
        } catch {}
        refreshGameInfoInstances();
        logger.info(`Reverted Game Info enrichment for ${appid}.`);
    } catch (err) {
        logger.warn(`Could not revert Game Info for ${appid}:`, err);
    }
}

/**
 * Enriches Steam's in-memory CAppDetailsStore and appStore (AppOverview)
 * so that Big Picture's "Game Info" tab and Desktop game panels display
 * descriptions, developers, publishers, franchises, release dates,
 * and category badges natively without custom UI injection.
 */
export function enrichGameDetails(
    appid: number,
    meta: ConsolidatedMetadata,
): boolean {
    try {
        let touched = false;
        const uAppid = appid >>> 0;
        markAppEnriched(uAppid);

        const developers = toArray<string>(meta.developers);
        const publishers = toArray<string>(meta.publishers);
        const franchises = toArray<string>(meta.franchises);

        // 1. Populate appDetailsStore (Big Picture Game Info tab & details)
        const detailsStore = getAppDetailsStore();
        if (detailsStore?.GetAppData) {
            const appData = detailsStore.GetAppData(uAppid) || detailsStore.GetAppData(appid) || detailsStore.GetAppData(appid | 0);
            if (appData) {
                recordOriginals(uAppid, appData, undefined);
                // Descriptions (canonical description for snippet and full description)
                const desc = meta.description || "";
                appData.descriptionsData = {
                    strSnippet: desc,
                    strFullDescription: desc,
                };

                // Associations (Developers, Publishers, Franchises)
                appData.associationData = {
                    rgDevelopers: developers.map((name) => ({
                        strName: name,
                        strURL: null,
                    })),
                    rgPublishers: publishers.map((name) => ({
                        strName: name,
                        strURL: null,
                    })),
                    rgFranchises: franchises.map((name) => ({
                        strName: name,
                        strURL: null,
                    })),
                };

                // Notify mobx observers if available
                if (typeof detailsStore.AppDetailsChanged === "function") {
                    try {
                        detailsStore.AppDetailsChanged(uAppid);
                    } catch {}
                }
                touched = true;
            }
        }

        // 2. Populate appCategoriesCache and AppOverview (Categories, Game Modes, Controller Support, Release Date)
        // Only categories true of the game itself: no Steam services (ADR-0038, parity plan F).
        // Controller: Steam Store data > emulator inference > the default setting > none (ADR-0038 addendum).
        const catSet = new Set<number>(badgeCategoryIds(meta, controllerContext(uAppid)));

        setAppCategories(uAppid, catSet);

        const appStore = getAppStore();
        if (appStore?.GetAppOverviewByAppID) {
            const overview = appStore.GetAppOverviewByAppID(uAppid) || appStore.GetAppOverviewByAppID(appid) || appStore.GetAppOverviewByAppID(appid | 0);
            if (overview) {
                recordOriginals(uAppid, undefined, overview);
                ensureAppOverviewHooked(overview);

                // Ensure m_setStoreCategories is an active Set and clear previous managed categories
                if (
                    !overview.m_setStoreCategories ||
                    typeof overview.m_setStoreCategories.add !== "function"
                ) {
                    overview.m_setStoreCategories = new Set<number>();
                } else {
                    for (const catId of MANAGED_CATEGORY_IDS) {
                        overview.m_setStoreCategories.delete(catId);
                    }
                }

                for (const catId of catSet) {
                    overview.m_setStoreCategories.add(catId);
                }

                // Steam's controller field follows the badge: 2 full, 1 partial, else Steam's own value.
                if (catSet.has(28)) {
                    overview.xbox_controller_support = 2;
                } else if (catSet.has(18)) {
                    overview.xbox_controller_support = 1;
                } else {
                    const saved = originals.get(uAppid) || originals.get(appid);
                    if (saved && "xbox_controller_support" in saved) {
                        overview.xbox_controller_support = saved.xbox_controller_support;
                    }
                }

                // Release Date
                if (meta.release_date && meta.release_date > 0) {
                    // Same two fields a native overview carries (parity plan B3).
                    overview.rt_original_release_date = meta.original_release_date || meta.release_date;
                    overview.rt_steam_release_date = meta.release_date;
                }

                touched = true;
            }
        }

        if (touched) {
            refreshGameInfoInstances();
            logger.info(
                `Enriched native Game Info & Categories for ${appid} ("${meta.title}"): ` +
                    `[Dev: ${developers.join(", ") || "none"}, ` +
                    `Franchise: ${franchises.join(", ") || "none"}, ` +
                    `Modes: ${meta.categories?.single_player ? "Single " : ""}${meta.categories?.multiplayer ? "Multi " : ""}${meta.categories?.coop ? "Co-op " : ""}]`,
            );
        }
        return touched;
    } catch (err) {
        logger.warn(`Could not enrich native Game Info for ${appid}:`, err);
        return false;
    }
}
