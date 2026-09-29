import { logger } from "../../logger";
import { rpc, type ConsolidatedMetadata } from "../../rpc";
import { onSettingChange } from "../../settings/settings";
import { isNonSteamAppId } from "../../steam/route";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { storeEnrichedAppIds } from "../steam-store/enriched";
import { loadControllerInference } from "./controller";
import { normalizeMetadata } from "./normalize";
import { gameInfoPlan } from "./policy";
import {
    collectionsReady,
    getBucket,
    invalidateMembership,
    onBucketsChanged,
    setMetadataAppidSource,
} from "../buckets";

/** The game-info surface, wired in index.tsx (plan § 7.0 D3). No-ops until then. */
let gameInfo: {
    enrich(appid: number, meta: ConsolidatedMetadata): boolean;
    revert(appid: number): void;
    isEnriched(appid: number): boolean;
} = { enrich: () => false, revert: () => {}, isEnriched: () => false };

export function setGameInfoWriter(writer: typeof gameInfo): void {
    gameInfo = writer;
}
const enrichGameDetails = (appid: number, meta: ConsolidatedMetadata) => gameInfo.enrich(appid, meta);
const revertGameDetails = (appid: number) => gameInfo.revert(appid);
const enrichedAppIds = { has: (appid: number) => gameInfo.isEnriched(appid) };

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
    const rawAppid = appid >>> 0;
    if (!isNonSteamAppId(rawAppid)) return;

    const { bucket, via } = getBucket(rawAppid);
    const plan = gameInfoPlan(bucket, via, storeMatched);

    const meta = libraryCache.get(rawAppid) || libraryCache.get(appid);
    if (plan.applyLocal && meta) {
        enrichGameDetails(rawAppid, meta);
    }
    if (!plan.fetchWeb) return;

    if (processedApps.has(rawAppid) || processedApps.has(appid)) return;
    processedApps.add(rawAppid);

    const title = resolveShortcutTitle(rawAppid) || resolveShortcutTitle(appid);
    if (!title) {
        logger.info(
            `Shortcut title not yet available for ${rawAppid}; will retry on next view.`,
        );
        processedApps.delete(rawAppid);
        return;
    }

    logger.info(`Fetching Game Info & Metadata for: "${title}" (${rawAppid})`);

    try {
        const res = await rpc.getGameMetadata(rawAppid, title);
        if (!res || !res.success || !res.metadata) {
            logger.info(
                `No metadata returned for "${title}" (${res?.message || "unknown"}).`,
            );
            return;
        }

        const clean = normalizeMetadata(res.metadata);
        libraryCache.set(rawAppid, clean);
        libraryCache.set(rawAppid | 0, clean);
        const applied = enrichGameDetails(rawAppid, clean);
        if (applied) {
            logger.info(
                `Successfully enriched Game Info for ${rawAppid} from ${res.source || "db"}.`,
            );
        }
    } catch (err) {
        logger.warn(`Failed to process metadata for ${rawAppid}:`, err);
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

    // The Game Info components are patched by the game-info surface (surfaces/game-info, plan M3.3).

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
                const rawAppid = appid >>> 0;
                if (Number.isFinite(appid) && isNonSteamAppId(rawAppid)) {
                    const clean = normalizeMetadata(meta);
                    libraryCache.set(rawAppid, clean);
                    libraryCache.set(rawAppid | 0, clean);
                    const { bucket, via } = getBucket(rawAppid);
                    if (
                        gameInfoPlan(bucket, via).applyLocal &&
                        enrichGameDetails(rawAppid, clean)
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
