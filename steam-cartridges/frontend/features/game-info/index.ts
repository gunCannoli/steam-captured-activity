import { logger } from "../../logger";
import { rpc, type ConsolidatedMetadata } from "../../rpc";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { storeEnrichedAppIds } from "../steam-store/enriched";
import { enrichGameDetails, revertGameDetails } from "./metadata";
import {
    getBucket,
    invalidateMembership,
    onBucketsChanged,
    setMetadataAppidSource,
    waitForCollections,
} from "../buckets";
import {
    patchGameInfoComponent,
    setCachedStores,
    enrichedAppIds,
} from "./game-info-patch";

/** In-memory cache of library metadata */
const libraryCache = new Map<number, ConsolidatedMetadata>();

/** Set of appids we have already enriched this session */
const processedApps = new Set<number>();

/** Web-scraping source for one shortcut view (dispatched by features/source-view.ts). */
export async function handleWebScrapingView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    // Buckets gate the web source (ADR-0033): only web-scraping games are enriched.
    const bucket = getBucket(appid).bucket;
    if (bucket !== "web-scraping") {
        if (bucket !== "steam-store" && enrichedAppIds.has(appid)) revertGameDetails(appid);
        return;
    }

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

export async function initGameInfo(): Promise<void> {
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

    // Bypass Big Picture native shortcut filter on Game Info tab
    patchGameInfoComponent();

    // Preload all cached metadata into appDetailsStore immediately
    try {
        const all = await rpc.getAllMetadata();
        const ready = all?.success && all.library
            ? await waitForCollections()
            : false;
        if (all?.success && all.library) {
            // Cache everything; enrich only web-scraping games. On a collections
            // timeout the preload enriches nothing (views still enrich lazily).
            if (!ready) {
                logger.warn(
                    "Collections not ready; skipping Game Info preload (views enrich lazily).",
                );
            }
            let count = 0;
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    libraryCache.set(appid, meta);
                    if (
                        ready &&
                        getBucket(appid).bucket === "web-scraping" &&
                        enrichGameDetails(appid, meta)
                    ) {
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

    setMetadataAppidSource(() => libraryCache.keys());

    // ===== Bucket changes (no restart needed) =====
    onBucketsChanged(() => {
        invalidateMembership();
        for (const appid of [...enrichedAppIds]) {
            const bucket = getBucket(appid).bucket;
            // steam-store games keep their enrichment (its view handler owns it);
            // anything else, or a game that left steam-store, is reverted.
            if (bucket === "steam-store") continue;
            if (bucket !== "web-scraping" || storeEnrichedAppIds.has(appid)) {
                revertGameDetails(appid);
                storeEnrichedAppIds.delete(appid);
            }
        }
        for (const [appid, meta] of libraryCache) {
            if (
                !enrichedAppIds.has(appid) &&
                getBucket(appid).bucket === "web-scraping"
            ) {
                enrichGameDetails(appid, meta);
            }
        }
    });

    logger.info("Game Metadata Provider ready.");
}
