import { logger } from "../logger";
import type { ConsolidatedMetadata } from "../rpc";
import {
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
 * 37: Shared/Split Screen Co-op
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
    SPLIT_SCREEN_COOP: 37,
    REMOTE_PLAY_TOGETHER: 44,
} as const;

function toArray<T>(val: unknown): T[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "object") return Object.values(val as Record<string, T>);
    return [];
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

        const developers = toArray<string>(meta.developers);
        const publishers = toArray<string>(meta.publishers);
        const franchises = toArray<string>(meta.franchises);

        // 1. Populate appDetailsStore (Big Picture Game Info tab & details)
        const detailsStore = getAppDetailsStore();
        if (detailsStore?.GetAppData) {
            const appData = detailsStore.GetAppData(appid);
            if (appData) {
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
                        detailsStore.AppDetailsChanged(appid);
                    } catch {}
                }
                touched = true;
            }
        }

        // 2. Populate appCategoriesCache and AppOverview (Categories, Game Modes, Controller Support, Release Date)
        const cats = meta.categories || {};
        const catSet = new Set<number>();
        if (cats.single_player) catSet.add(STEAM_CATEGORIES.SINGLE_PLAYER);
        if (cats.multiplayer) catSet.add(STEAM_CATEGORIES.MULTIPLAYER);
        if (cats.coop) catSet.add(STEAM_CATEGORIES.COOP);
        if (cats.split_screen) {
            catSet.add(STEAM_CATEGORIES.SPLIT_SCREEN);
            if (cats.coop) catSet.add(STEAM_CATEGORIES.SPLIT_SCREEN_COOP);
        }
        if (cats.full_controller !== false) {
            catSet.add(STEAM_CATEGORIES.FULL_CONTROLLER);
        }
        if (cats.partial_controller) {
            catSet.add(STEAM_CATEGORIES.PARTIAL_CONTROLLER);
        }
        if (cats.achievements) {
            catSet.add(STEAM_CATEGORIES.ACHIEVEMENTS);
        }
        if (cats.remote_play_together) {
            catSet.add(STEAM_CATEGORIES.REMOTE_PLAY_TOGETHER);
        }

        setAppCategories(appid, catSet);

        const appStore = getAppStore();
        if (appStore?.GetAppOverviewByAppID) {
            const overview = appStore.GetAppOverviewByAppID(appid);
            if (overview) {
                ensureAppOverviewHooked(overview);

                // Ensure m_setStoreCategories is an active Set and clear previous managed categories
                if (
                    !overview.m_setStoreCategories ||
                    typeof overview.m_setStoreCategories.add !== "function"
                ) {
                    overview.m_setStoreCategories = new Set<number>();
                } else {
                    for (const catId of Object.values(STEAM_CATEGORIES)) {
                        overview.m_setStoreCategories.delete(catId);
                    }
                }

                for (const catId of catSet) {
                    overview.m_setStoreCategories.add(catId);
                }

                if (cats.full_controller !== false) {
                    overview.xbox_controller_support = 2;
                } else if (cats.partial_controller) {
                    overview.xbox_controller_support = 1;
                }

                // Release Date
                if (meta.release_date && meta.release_date > 0) {
                    overview.rt_original_release_date = meta.release_date;
                    overview.rt_steam_release_date = meta.release_date;
                }

                touched = true;
            }
        }

        if (touched) {
            refreshGameInfoInstances();
            logger.info(
                `Enriched native Game Info & Categories for ${appid} ("${meta.title}"): ` +
                    `[Dev: ${(meta.developers || []).join(", ") || "none"}, ` +
                    `Franchise: ${(meta.franchises || []).join(", ") || "none"}, ` +
                    `Modes: ${meta.categories?.single_player ? "Single " : ""}${meta.categories?.multiplayer ? "Multi " : ""}${meta.categories?.coop ? "Co-op " : ""}]`,
            );
        }
        return touched;
    } catch (err) {
        logger.warn(`Could not enrich native Game Info for ${appid}:`, err);
        return false;
    }
}
