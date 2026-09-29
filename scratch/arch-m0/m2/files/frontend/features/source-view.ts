import { toShortcutId } from "../kernel/appid";
import { getBucket, waitForCollections } from "./buckets";
import { handleWebScrapingView } from "./game-info";
import { handleSteamStoreView, leaveSteamStore } from "./steam-store";
import { storeEnrichedAppIds } from "./steam-store/enriched";
import { loadAchievementsForApp } from "./achievements";

import { handleGameOpenUpdate } from "./scraper/on-update";

/** Appids currently being dispatched (desktop and Big Picture can both fire). */
const inflight = new Set<number>();
/** Views seen before collections were ready; replayed once they are. */
const deferred = new Set<number>();
/** A view that arrived while the same appid was in flight; replayed once afterwards (P4 H6). */
const rerun = new Set<number>();

/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    const rawAppid = toShortcutId(appid);
    if (rawAppid === undefined) return;
    if (inflight.has(rawAppid)) {
        rerun.add(rawAppid);
        return;
    }
    inflight.add(rawAppid);
    try {
        const { bucket, via } = getBucket(rawAppid);
        if (via === "pending") {
            // Local Game Info only until collections load (ADR-0035); replayed then.
            deferred.add(rawAppid);
            await handleWebScrapingView(rawAppid);
            void loadAchievementsForApp(rawAppid, 0);
            void handleGameOpenUpdate(rawAppid);
            return;
        }
        if (bucket === "steam-store") {
            // ADR-0036: Steam Store first; no Steam match -> web scraping fallback;
            // not known yet (title missing) -> local Game Info only.
            const matched = await handleSteamStoreView(rawAppid);
            if (matched !== true) {
                await handleWebScrapingView(rawAppid, matched);
                void loadAchievementsForApp(rawAppid, 0);
            }
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
            if (storeEnrichedAppIds.has(rawAppid)) leaveSteamStore(rawAppid);
            await handleWebScrapingView(rawAppid);
            void loadAchievementsForApp(rawAppid, 0);
        }

        // Smart On-Update check: activities, achievements & metadata in the background
        void handleGameOpenUpdate(rawAppid);
    } finally {
        inflight.delete(rawAppid);
        if (rerun.delete(rawAppid)) void onSourceView(rawAppid);
    }
}

/**
 * Replays views that arrived before collections were ready. Views themselves come from
 * the view sensor (sensors/view, migration plan M2): index.tsx subscribes onSourceView to
 * shortcut.viewed. A Steam render never triggers a view (M0a).
 */
export function initSourceView(): void {
    void waitForCollections().then(() => {
        const list = [...deferred];
        deferred.clear();
        list.forEach((a) => void onSourceView(a));
    });
}
