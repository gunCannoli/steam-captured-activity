import type { AchievementSchemaRecord, AchievementUnlockRecord } from "../../rpc";
import type { SteamAchievementItem, SteamAppAchievements, AchievementProgress } from "./types";

/**
 * Transforms backend schema and unlocks into Steam's native AppDetailsStore format.
 */
export function buildSteamAchievements(
    schema: AchievementSchemaRecord | undefined,
    unlocks: Record<string, AchievementUnlockRecord> = {},
): SteamAppAchievements | null {
    if (!schema || !schema.achievements || schema.achievements.length === 0) {
        return null;
    }

    const achieved: SteamAchievementItem[] = [];
    const unachieved: SteamAchievementItem[] = [];

    for (const item of schema.achievements) {
        const unlock = unlocks[item.id];
        const isUnlocked = !!unlock;
        const entry: SteamAchievementItem = {
            strID: item.id,
            strName: item.name,
            strDescription: item.description,
            strImage: item.icon,
            bAchieved: isUnlocked,
            rtUnlocked: unlock?.unlocked_time ?? 0,
            flAchieved: item.global_pct,
        };

        if (isUnlocked) {
            achieved.push(entry);
        } else {
            unachieved.push(entry);
        }
    }

    // Achieved sorted by most recently unlocked first
    achieved.sort((a, b) => b.rtUnlocked - a.rtUnlocked);

    // Unachieved sorted by global popularity descending (most common first)
    unachieved.sort((a, b) => (b.flAchieved ?? 0) - (a.flAchieved ?? 0));

    // Highlights: up to 5 most recently achieved, or empty array if none unlocked
    const vecHighlight = achieved.slice(0, 5);

    return {
        nTotal: schema.total || schema.achievements.length,
        nAchieved: achieved.length,
        vecHighlight,
        vecAchieved: achieved,
        vecUnachieved: unachieved,
    };
}

/**
 * Computes Big Picture progress cache payload.
 */
export function buildAchievementProgress(
    achievements: SteamAppAchievements | null,
): AchievementProgress | null {
    if (!achievements) return null;
    return {
        unlocked: achievements.nAchieved,
        total: achievements.nTotal,
        all_unlocked: achievements.nTotal > 0 && achievements.nAchieved === achievements.nTotal,
    };
}
