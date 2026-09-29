import { logger } from "../../logger";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { NON_STEAM_APPID_MIN } from "../../steam/route";

/** Re-reads an app's captures; wired to the captures surface in index.tsx (plan § 7.0 D3). */
let refreshLibraryApp: (appid: number) => Promise<void> = async () => {};

export function setCapturesRefresher(fn: (appid: number) => Promise<void>): void {
    refreshLibraryApp = fn;
}

const lastOnOpenCheck = new Map<number, number>();
const ON_OPEN_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes per game throttle

/**
 * Smart On-Update handler called whenever a game is opened in Steam: checks for new activities
 * (screenshots and clips captured during play or externally). Achievements are not checked here
 * any more: `app/achievements.ts` loads them per view and polls unlocks while a game runs (M6b).
 *
 * Non-blocking: executes in the background while local cached UI renders instantly.
 */
export async function handleGameOpenUpdate(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const now = Date.now();
    const lastCheck = lastOnOpenCheck.get(appid) || 0;
    if (now - lastCheck < ON_OPEN_COOLDOWN_MS) {
        return; // Throttled: recently checked
    }
    lastOnOpenCheck.set(appid, now);

    const title = resolveShortcutTitle(appid) || `Shortcut ${appid}`;
    logger.info(`[On-Update] Checking updates for "${title}" (${appid})...`);

    try {
        await refreshLibraryApp(appid);
    } catch (e) {
        logger.warn(`[On-Update] Failed refreshing captures for ${appid}:`, e);
    }
}
