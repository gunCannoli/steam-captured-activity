// Surface `achievements` (migration plan M3.5, ADR-0039): Steam's achievement stores
// (AppDetailsStore.GetAchievements, AchievementsFullStore, the progress cache) for shortcuts.
// The features reach its API only through store-port.ts, wired in index.tsx (plan § 7.0 D3).
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import {
    deps,
    ensureAchievementsStoreHooked,
    getLocalAchievements,
    getLocalSchema,
    getLocalUnlocks,
    updateShortcutState,
} from "./store";

/** What features/achievements/store-port.ts delegates to. */
export const achievementsStore = {
    hook: ensureAchievementsStoreHooked,
    getLocalAchievements,
    getLocalSchema,
    getLocalUnlocks,
    updateShortcutState,
};

export function createAchievementsSurface(d: SurfaceDeps & { refreshSections(): void }): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.refreshSections = d.refreshSections;
    return {
        id: "achievements",
        touches: [
            "AppDetailsStore.GetAchievements",
            "AchievementsFullStore.LoadMyAchievements",
            "AchievementsFullStore.GetMyAchievements",
            "AchievementsFullStore.GetGlobalAchievements",
            "AchievementsFullStore.GetPlayerAchievements",
            "AchievementsFullStore.LoadFriendAchievements",
            "AchievementsFullStore.m_mapMyAchievements",
            "AchievementsFullStore.m_mapGlobalAchievements",
            "appAchievementProgressCache.m_achievementProgress",
            "AppDetailsStore.AppDetailsChanged(achievements)",
        ],
        reads: ["achievements"],
        install() {
            // Steam may not have created the stores yet; features/achievements retries (initAchievements).
            ensureAchievementsStoreHooked();
        },
        render() {
            /* record-driven from M6 (plan § 7.0 D4) */
        },
        clear() {},
        uninstall() {
            /* the hooks stay until Steam restarts, as before M3.5 */
        },
    };
}
