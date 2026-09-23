import { Steam } from "steambrew-utils";
import {
    onLocationChange,
    onPopupCreate,
    PopupType,
} from "steambrew-utils/watchers";
import { logger } from "./logger";
import { rpc } from "./rpc";
import { watchGamepadAppid } from "./steam/gamepad-appid";
import { enrichGameDetails } from "./steam/metadata";
import { patchGameInfoComponent } from "./steam/game-info-patch";

const NON_STEAM_APPID_MIN = 0x8000_0000;

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

    // Bypass Big Picture native shortcut filter on Game Info tab
    patchGameInfoComponent();

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

        // ===== Big Picture Navigation =====
        if (type === PopupType.Gamepad) {
            const stopWatching = watchGamepadAppid((appid) => {
                if (appid >= NON_STEAM_APPID_MIN) {
                    void handleAppView(appid);
                }
            });

            return () => stopWatching();
        }

        return undefined;
    });

    logger.info("Game Metadata Provider ready.");
}
