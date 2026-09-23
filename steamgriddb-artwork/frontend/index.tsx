import { Steam } from "steambrew-utils";
import {
    onLocationChange,
    onPopupCreate,
    PopupType,
} from "steambrew-utils/watchers";
import { logger } from "./logger";
import { rpc, type ConsolidatedMetadata } from "./rpc";
import { watchGamepadAppid } from "./steam/gamepad-appid";
import { enrichGameDetails } from "./steam/metadata";
import {
    patchGameInfoComponent,
    setAppViewTrigger,
    setCachedStores,
} from "./steam/game-info-patch";

const NON_STEAM_APPID_MIN = 0x8000_0000;

/** In-memory cache of library metadata */
const libraryCache = new Map<number, ConsolidatedMetadata>();

/** Set of appids we have already enriched this session */
const processedApps = new Set<number>();

function appIdFromPath(pathname: string): number | undefined {
    const match = /^\/library\/app\/(\d+)/.exec(pathname);
    if (!match?.[1]) return undefined;
    const appid = Number(match[1]);
    return Number.isFinite(appid) ? appid : undefined;
}

function resolveShortcutTitle(appid: number): string | undefined {
    try {
        const overview = (window as any).appStore?.GetAppOverviewByAppID?.(
            appid,
        );
        if (overview?.display_name) return overview.display_name;

        const shortcut = (window as any).SteamClient?.Apps?.GetShortcutData?.(
            appid,
        );
        if (shortcut?.strAppName) return shortcut.strAppName;
    } catch (err) {
        logger.warn(`Could not read shortcut title for ${appid}:`, err);
    }
    return undefined;
}

async function handleAppView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    if (libraryCache.has(appid)) {
        enrichGameDetails(appid, libraryCache.get(appid)!);
    }

    if (processedApps.has(appid)) return;
    processedApps.add(appid);

    const title = resolveShortcutTitle(appid);
    if (!title) {
        logger.info(
            `Shortcut title not yet available for ${appid}; will retry on next view.`,
        );
        processedApps.delete(appid);
        return;
    }

    logger.info(`Fetching Game Info & Metadata for: "${title}" (${appid})`);

    try {
        const res = await rpc.getGameMetadata(appid, title);
        if (!res || !res.success || !res.metadata) {
            logger.info(
                `No metadata returned for "${title}" (${res?.message || "unknown"}).`,
            );
            return;
        }

        libraryCache.set(appid, res.metadata);
        const applied = enrichGameDetails(appid, res.metadata);
        if (applied) {
            logger.info(
                `Successfully enriched Game Info for ${appid} from ${res.source || "db"}.`,
            );
        }
    } catch (err) {
        logger.warn(`Failed to process metadata for ${appid}:`, err);
    }
}

export default async function OnPluginLoaded() {
    logger.info("Game Metadata & Info Provider initializing...");

    const status = await rpc.getStatus().catch((err) => {
        logger.warn("Could not query provider backend status:", err);
        return null;
    });

    if (status?.has_twitch) {
        logger.info(
            `Twitch/IGDB credentials active. Database contains ${status.db_count || 0} cached game(s).`,
        );
    } else {
        logger.warn(
            "Twitch credentials missing. Set twitch_client_id and twitch_client_secret in .env.",
        );
    }

    // Cache SharedJSContext singletons for stores before portals render
    setCachedStores((window as any).appDetailsStore, (window as any).appStore);
    setAppViewTrigger((appid: number) => {
        void handleAppView(appid);
    });

    // Bypass Big Picture native shortcut filter on Game Info tab
    patchGameInfoComponent();

    // Preload all cached metadata into appDetailsStore immediately
    try {
        const all = await rpc.getAllMetadata();
        if (all?.success && all.library) {
            let count = 0;
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    libraryCache.set(appid, meta);
                    if (enrichGameDetails(appid, meta)) {
                        count++;
                    }
                }
            }
            logger.info(
                `Preloaded Game Info for ${count} non-Steam game(s) from local database.`,
            );
        }
    } catch (err) {
        logger.warn("Could not preload library metadata cache:", err);
    }

    // ===== Big Picture Navigation =====
    // Big Picture renders through a SharedJSContext portal; react/jsx-runtime interception
    // captures the active appid without depending on window popups.
    watchGamepadAppid((appid) => {
        if (appid >= NON_STEAM_APPID_MIN) {
            void handleAppView(appid);
        }
    });

    // ===== Desktop Window Navigation =====
    onPopupCreate((_popup, type) => {
        if (type === PopupType.Desktop) {
            const stopWatching = onLocationChange(
                () => Steam.MainWindowBrowserManager?.m_lastLocation,
                ({ pathname }) => {
                    const appid = appIdFromPath(pathname);
                    if (appid !== undefined && appid >= NON_STEAM_APPID_MIN) {
                        void handleAppView(appid);
                    }
                },
            );

            return () => stopWatching();
        }

        return undefined;
    });

    logger.info("Game Metadata Provider ready.");
}
