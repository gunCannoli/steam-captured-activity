import { Steam } from "steambrew-utils";
import {
    onLocationChange,
    onPopupCreate,
    PopupType,
} from "steambrew-utils/watchers";
import { watchGamepadAppid } from "../steam/gamepad-appid";
import { NON_STEAM_APPID_MIN, appIdFromPath } from "../steam/route";
import { getBucket, waitForCollections } from "./buckets";
import { handleWebScrapingView } from "./game-info";
import { setAppViewTrigger } from "./game-info/game-info-patch";
import { handleSteamStoreView, leaveSteamStore } from "./steam-store";
import { storeEnrichedAppIds } from "./steam-store/enriched";

/** Appids currently being dispatched (desktop and Big Picture can both fire). */
const inflight = new Set<number>();
/** Views seen before collections were ready; replayed once they are. */
const deferred = new Set<number>();
/** A view that arrived while the same appid was in flight; replayed once afterwards (P4 H6). */
const rerun = new Set<number>();

/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;
    if (inflight.has(appid)) {
        rerun.add(appid);
        return;
    }
    inflight.add(appid);
    try {
        const { bucket, via } = getBucket(appid);
        if (via === "pending") {
            // Local Game Info only until collections load (ADR-0035); replayed then.
            deferred.add(appid);
            await handleWebScrapingView(appid);
            return;
        }
        if (bucket === "steam-store") {
            await handleSteamStoreView(appid);
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            await handleWebScrapingView(appid);
        }
    } finally {
        inflight.delete(appid);
        if (rerun.delete(appid)) void onSourceView(appid);
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
        if (appid >= NON_STEAM_APPID_MIN) void onSourceView(appid);
    });

    onPopupCreate((_popup, type) => {
        if (type !== PopupType.Desktop) return undefined;
        return onLocationChange(
            () => Steam.MainWindowBrowserManager?.m_lastLocation,
            ({ pathname }) => {
                const appid = appIdFromPath(pathname);
                if (appid !== undefined && appid >= NON_STEAM_APPID_MIN) {
                    void onSourceView(appid);
                }
            },
        );
    });
}
