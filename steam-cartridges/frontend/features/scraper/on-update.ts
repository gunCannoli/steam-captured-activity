import { rpc } from "../../rpc";
import { logger } from "../../logger";
import { refresh as refreshLibraryApp } from "../../renderers/library-app";
import { checkObserverUnlocks } from "../achievements";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { listCollections, membersOf } from "../buckets";
import { getAutoRoutingProfile } from "../buckets/auto-routing";
import { isServiceAllowed } from "../buckets/resolve";
import { setting } from "../../settings/settings";
import { enrichGameDetails } from "../game-info/metadata";
import { normalizeMetadata } from "../game-info/normalize";
import { NON_STEAM_APPID_MIN } from "../../steam/route";

const lastOnOpenCheck = new Map<number, number>();
const ON_OPEN_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes per game throttle

/**
 * Smart On-Update handler called whenever a game is opened in Steam.
 * 
 * After initial scraping, when a game's details page is viewed:
 * 1. Checks for new activities (screenshots & clips captured during play or externally).
 * 2. Checks for new achievement/trophy unlocks (RPCS3, shadPS4, RetroArch, Goldberg) and triggers toasts.
 * 3. Checks if metadata needs refresh (if previously missing/failed or stale) and updates Game Info.
 * 
 * Non-blocking: executes smoothly in the background while local cached UI renders instantly.
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

    // 1. Check for new activities / captures / recordings
    try {
        await refreshLibraryApp(appid);
    } catch (e) {
        logger.warn(`[On-Update] Failed refreshing captures for ${appid}:`, e);
    }

    // 2. Check for new achievement / trophy unlocks
    try {
        const autoMode = setting("autoRoutingMode");
        const rules = setting("routingRules");
        const profile = getAutoRoutingProfile(appid);

        const collMap: Record<number, string[]> = {};
        for (const c of listCollections()) {
            const mem = membersOf(c.id);
            if (mem && mem.has(appid)) {
                if (!collMap[appid]) collMap[appid] = [];
                collMap[appid].push(c.name);
            }
        }
        const collNames = collMap[appid] || [];

        const achievementsAllowed =
            isServiceAllowed("retroachievements", appid, title, collNames, rules, autoMode, profile) ||
            isServiceAllowed("console_emulators", appid, title, collNames, rules, autoMode, profile) ||
            isServiceAllowed("steam_store", appid, title, collNames, rules, autoMode, profile);

        if (achievementsAllowed) {
            const storeRes = await rpc.steamStoreGetMapping(appid).catch(() => null);
            const nativeAppId = storeRes?.mapping?.steam_appid || 0;
            const unlockCount = await checkObserverUnlocks(appid, nativeAppId, title);
            if (unlockCount > 0) {
                logger.info(`[On-Update] Detected ${unlockCount} new unlock(s) on game open for "${title}"`);
            }
        }
    } catch (e) {
        logger.warn(`[On-Update] Failed checking achievement unlocks for ${appid}:`, e);
    }

    // 3. Check for metadata updates (if missing or previously failed)
    try {
        const metaRes = await rpc.getGameMetadata(appid, title).catch(() => null);
        if (metaRes?.success && metaRes.metadata) {
            const clean = normalizeMetadata(metaRes.metadata);
            enrichGameDetails(appid, clean);
        }
    } catch (e) {
        logger.warn(`[On-Update] Failed checking metadata update for ${appid}:`, e);
    }
}
