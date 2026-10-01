/**
 * Kernel: the shape of Steam's notification as this plugin reads it, the achievement data an unlock carries, and the
 * synthetic ids the achievement banner posts (previews, the 100% toast, the capture test). Every toast has `eType`;
 * only an achievement toast has the achievement `data`. Pure: no Steam, SDK or logger import.
 */

export interface AchievementData {
    appid(): number;
    name(): string;
    description(): string;
    image_url(): string;
    achieved(): boolean;
    global_achieved_pct(): number;
    achievement_id(): string;
}

export interface SteamNotification {
    eType: number;
    data: AchievementData;
    nToastDurationMS?: number;
    /** Unix seconds; set in OnNotification on arrival (Phase 7, unlock offset calc). */
    rtCreated?: number;
    notificationID?: number;
    /**
     * When set, Steam's desktop toast loop keeps the toast showing until this
     * returns true, instead of timing it by `nToastDurationMS` (read every frame).
     */
    fnNotificationResolved?: () => boolean;
}

/** Synthetic achievement ids this plugin posts. Never real Steam ids. */
export const PREVIEW_ID_PREFIX = 'EA_PREVIEW_';
export const COMPLETION_ID = 'EA_100_PERCENT';
export const TEST_UNLOCK_ID = 'EA_TEST';

export type SyntheticKind = 'preview' | 'completion' | 'test';

/** Which synthetic toast an achievement id is; null for a real unlock. `EA_PREVIEW_` with any suffix is 'preview'. */
export function syntheticKind(id: string | undefined): SyntheticKind | null {
    if (typeof id !== 'string') return null;
    if (id.startsWith(PREVIEW_ID_PREFIX)) return 'preview';
    if (id === COMPLETION_ID) return 'completion';
    if (id === TEST_UNLOCK_ID) return 'test';
    return null;
}

/** The notification's achievement id; undefined when the accessor is missing or throws. O(1). */
export function achievementIdOf(n: SteamNotification): string | undefined {
    try {
        const id = n.data.achievement_id?.();
        return typeof id === 'string' ? id : undefined;
    } catch {
        return undefined;
    }
}
