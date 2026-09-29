// Steam's own achievement shapes (AppDetailsStore, AchievementsFullStore, NotificationStore).
// Moved from features/achievements/types.ts in M3.5 so surfaces can use them.
/**
 * Types for Steam's native achievements system and internal stores.
 */

export interface SteamAchievementItem {
    strID: string;
    strName: string;
    strDescription: string;
    strImage: string;
    bAchieved: boolean;
    rtUnlocked: number;
    flMinProgress?: number;
    flCurrentProgress?: number;
    flMaxProgress?: number;
    flAchieved?: number; // Global unlock percentage
}

export interface SteamAppAchievements {
    nTotal: number;
    nAchieved: number;
    vecHighlight: SteamAchievementItem[];
    vecAchieved: SteamAchievementItem[];
    vecUnachieved: SteamAchievementItem[];
}

export interface AchievementProgress {
    unlocked: number;
    total: number;
    all_unlocked: boolean;
}

