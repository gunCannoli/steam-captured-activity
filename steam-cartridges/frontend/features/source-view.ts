import { Steam } from "steambrew-utils";
import {
    onLocationChange,
    onPopupCreate,
    PopupType,
} from "steambrew-utils/watchers";
import { watchGamepadAppid } from "../steam/gamepad-appid";
import { appIdFromPath, isNonSteamAppId } from "../steam/route";
import { getBucket, waitForCollections } from "./buckets";
import { handleWebScrapingView } from "./game-info";
import { setAppViewTrigger } from "./game-info/game-info-patch";
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
    const rawAppid = appid >>> 0;
    if (!isNonSteamAppId(rawAppid)) return;
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

/** Wires every place a game page can open (game-info patch, Big Picture, desktop). */
export function initSourceView(): void {
    void waitForCollections().then(() => {
        const list = [...deferred];
        deferred.clear();
        list.forEach((a) => void onSourceView(a));
    });
    setAppViewTrigger((appid) => void onSourceView(appid));

    // Big Picture renders through a SharedJSContext portal; react/jsx-runtime
    // interception captures the active appid without depending on popups.
    watchGamepadAppid((appid) => {
        if (isNonSteamAppId(appid)) void onSourceView(appid);
    });

    onPopupCreate((_popup, type) => {
        if (type !== PopupType.Desktop) return undefined;
        return onLocationChange(
            () => Steam.MainWindowBrowserManager?.m_lastLocation,
            ({ pathname }) => {
                const appid = appIdFromPath(pathname);
                if (appid !== undefined && isNonSteamAppId(appid)) {
                    void onSourceView(appid);
                }
            },
        );
    });
}
