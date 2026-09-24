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
import { enrichedAppIds, setAppViewTrigger } from "./game-info/game-info-patch";
import { revertGameDetails } from "./game-info/metadata";
import { handleSteamStoreView, leaveSteamStore } from "./steam-store";
import { storeEnrichedAppIds } from "./steam-store/enriched";

/** Appids currently being dispatched (desktop and Big Picture can both fire). */
const inflight = new Set<number>();
/** Views seen before collections were ready; replayed once they are. */
const deferred = new Set<number>();

/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN || inflight.has(appid)) return;
    inflight.add(appid);
    try {
        const { bucket, via } = getBucket(appid);
        if (via === "pending") {
            deferred.add(appid);
            return;
        }
        if (bucket === "web-scraping") {
            // Came from steam-store: drop its Game Info before the web source fills in.
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            await handleWebScrapingView(appid);
        } else if (bucket === "steam-store") {
            await handleSteamStoreView(appid);
        } else {
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            else if (enrichedAppIds.has(appid)) revertGameDetails(appid);
        }
    } finally {
        inflight.delete(appid);
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
