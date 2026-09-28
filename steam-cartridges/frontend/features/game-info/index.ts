import { logger } from "../../logger";
import { rpc, type ConsolidatedMetadata } from "../../rpc";
import { onSettingChange } from "../../settings/settings";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { storeEnrichedAppIds } from "../steam-store/enriched";
import { loadControllerInference } from "./controller";
import { enrichGameDetails, revertGameDetails } from "./metadata";
import { normalizeMetadata } from "./normalize";
import { gameInfoPlan } from "./policy";
import {
    collectionsReady,
    getBucket,
    invalidateMembership,
    onBucketsChanged,
    setMetadataAppidSource,
} from "../buckets";
import {
    patchGameInfoComponent,
    setCachedStores,
    setMetadataResolver,
    enrichedAppIds,
} from "./game-info-patch";

/** In-memory cache of library metadata */
const libraryCache = new Map<number, ConsolidatedMetadata>();

export function getCachedLibraryMetadata(appid: number): ConsolidatedMetadata | undefined {
    return libraryCache.get(appid >>> 0) || libraryCache.get(appid) || libraryCache.get(appid | 0);
}

/** Set of appids we have already enriched this session */
const processedApps = new Set<number>();

/**
 * Game Info for one view of a shortcut without store data (dispatched by
 * features/source-view.ts). Local DB always; the web fetch for web-scraping
 * games and for steam-store games with no Steam match (ADR-0035, ADR-0036).
 */
export async function handleWebScrapingView(appid: number, storeMatched?: boolean): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const { bucket, via } = getBucket(appid);
    const plan = gameInfoPlan(bucket, via, storeMatched);

    if (plan.applyLocal && libraryCache.has(appid)) {
        enrichGameDetails(appid, libraryCache.get(appid)!);
    }
    if (!plan.fetchWeb) return;

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

        const clean = normalizeMetadata(res.metadata);
        libraryCache.set(appid, clean);
        const applied = enrichGameDetails(appid, clean);
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
    setMetadataResolver(getCachedLibraryMetadata, enrichGameDetails);

    // Controller support per shortcut from its emulator, before any badge is written (ADR-0038 addendum).
    await loadControllerInference();

    // Preload all cached metadata into appDetailsStore immediately. Local data
    // applies to every shortcut that is not steam-store (ADR-0035), so this does
    // not wait for collections; getBucket returns 'pending' until they load
    // (guardrail 13: it never reads collectionStore computeds before then).
    try {
        const all = await rpc.getAllMetadata();
        if (all?.success && all.library) {
            let count = 0;
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    const clean = normalizeMetadata(meta);
                    libraryCache.set(appid, clean);
                    const { bucket, via } = getBucket(appid);
                    if (
                        gameInfoPlan(bucket, via).applyLocal &&
                        enrichGameDetails(appid, clean)
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
        if (!collectionsReady()) return;
        // A game that left steam-store drops the store's Game Info (ADR-0033) ...
        for (const appid of [...storeEnrichedAppIds]) {
            if (getBucket(appid).bucket === "steam-store") continue;
            revertGameDetails(appid);
            storeEnrichedAppIds.delete(appid);
        }
        // ... and every shortcut that is not steam-store shows its local Game Info (ADR-0035).
        for (const [appid, meta] of libraryCache) {
            const { bucket, via } = getBucket(appid);
            if (!enrichedAppIds.has(appid) && gameInfoPlan(bucket, via).applyLocal) {
                enrichGameDetails(appid, meta);
            }
        }
    });

    // ===== "Default to full controller support" (no restart needed) =====
    onSettingChange((key) => {
        if (key !== "defaultFullController") return;
        for (const [appid, meta] of libraryCache) {
            // Steam Store data never depends on the setting (ADR-0038 addendum).
            if (enrichedAppIds.has(appid) && !storeEnrichedAppIds.has(appid)) {
                enrichGameDetails(appid, meta);
            }
        }
    });

    logger.info("Game Metadata Provider ready.");
}
