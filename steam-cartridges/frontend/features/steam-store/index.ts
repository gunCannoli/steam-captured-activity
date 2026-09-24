import { logger } from "../../logger";
import {
    rpc,
    type ConsolidatedMetadata,
    type StoreApplied,
    type StoreMapping,
    type StoreState,
} from "../../rpc";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { applyCustomArtworkFromUrls } from "../artwork/artwork";
import { enrichGameDetails, revertGameDetails } from "../game-info/metadata";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { storeEnrichedAppIds } from "./enriched";
import { knownAppName, matchKnownNative } from "./known-apps";
import { cdnArtworkUrls } from "./resolve";
import { assetUrlsFromItem, loadStoreItem, metadataFromStoreItem } from "./store-item";

/** Appids handled this session (one lookup per game per session, as in the web path). */
const processed = new Set<number>();
/** Metadata already fetched this session, re-applied on later views. */
const metaCache = new Map<number, ConsolidatedMetadata>();

async function resolveMapping(
    appid: number,
): Promise<{ mapping: StoreMapping | null; applied: StoreApplied | null; retry?: boolean }> {
    const state = await rpc.steamStoreGetMapping(appid);
    if (state.mapping) return { mapping: state.mapping, applied: state.applied };

    const title = resolveShortcutTitle(appid);
    if (!title) return { mapping: null, applied: null, retry: true };

    // Step 2: a unique exact match among natives Steam already knows (no network).
    const known = matchKnownNative(title);
    if (known !== undefined && !state.rejected.includes(known)) {
        const res = await rpc.steamStoreSaveKnownMatch(appid, known, knownAppName(known) ?? title);
        if (res.mapping) return { mapping: res.mapping, applied: null };
        if (res.skipped) return { mapping: null, applied: null };
    }

    // Step 3: store search; only an exact match is applied, the rest are suggestions.
    const found = await rpc.steamStoreSearch(appid, title);
    if (found.mapping) return { mapping: found.mapping, applied: null };
    if (found.suggestions?.length) {
        logger.info(`Steam Store: ${found.suggestions.length} suggestion(s) for "${title}"; accept one in settings.`);
    } else if (found.error) {
        logger.warn(`Steam Store search failed for "${title}": ${found.error}`);
    }
    return { mapping: null, applied: null };
}

interface Loaded {
    metadata: ConsolidatedMetadata | null;
    urls: ReturnType<typeof cdnArtworkUrls>;
}

/** StoreItemCache first (ADR-0009 ladder), backend appdetails as the fallback. */
async function loadNative(appid: number, steamAppid: number): Promise<Loaded> {
    const urls = cdnArtworkUrls(steamAppid);
    const item = await loadStoreItem(steamAppid);
    let metadata = item ? metadataFromStoreItem(item, steamAppid, appid) : null;
    if (item) {
        const hashed = assetUrlsFromItem(item);
        for (const key of Object.keys(hashed) as (keyof typeof urls)[]) {
            if (hashed[key]) urls[key] = hashed[key]!;
        }
    }
    if (!metadata) {
        const res = await rpc.steamStoreGetAppDetails(steamAppid, appid).catch(() => null);
        metadata = res?.metadata ?? null;
    }
    return { metadata, urls };
}

async function applyArtwork(appid: number, mapping: StoreMapping, applied: StoreApplied | null, urls: Loaded["urls"]) {
    // A different game was mapped before: clear only the slots this plugin wrote.
    if (applied && applied.steam_appid !== mapping.steam_appid) {
        const apps = (window as any).SteamClient?.Apps;
        for (const slot of applied.slots) {
            try {
                await apps?.ClearCustomArtworkForApp?.(appid, slot);
            } catch {}
        }
    }
    const slots = await applyCustomArtworkFromUrls(appid, urls);
    // Record only what succeeded; a failed slot (404, size limit) stays unrecorded.
    await rpc.steamStoreRecordArtwork(appid, mapping.steam_appid, slots);
    logger.info(`Steam Store: applied ${slots.length} art slot(s) from ${mapping.steam_appid} to ${appid}.`);
}

/** Desktop and Big Picture entry point for a steam-store game. */
export async function handleSteamStoreView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const cached = metaCache.get(appid);
    if (cached) {
        enrichGameDetails(appid, cached);
        storeEnrichedAppIds.add(appid);
    }
    if (processed.has(appid)) return;
    processed.add(appid);

    try {
        const { mapping, applied, retry } = await resolveMapping(appid);
        if (retry) {
            processed.delete(appid);
            return;
        }
        if (!mapping) return;

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
        if (metadata) {
            metaCache.set(appid, metadata);
            if (enrichGameDetails(appid, metadata)) storeEnrichedAppIds.add(appid);
        } else {
            logger.warn(`Steam Store: no metadata for ${mapping.steam_appid}.`);
        }

        if (applied?.steam_appid !== mapping.steam_appid) {
            await applyArtwork(appid, mapping, applied, urls);
        }
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
    }
}

/** Drop this session's memory of a game so the next view starts fresh. */
function forget(appid: number): void {
    processed.delete(appid);
    metaCache.delete(appid);
    storeEnrichedAppIds.delete(appid);
}

/**
 * Remove the mapping, clear the art slots this plugin wrote (and only those),
 * and revert Game Info. `reject` remembers the match so it is never re-applied.
 */
export async function clearSteamStore(appid: number, reject: boolean) {
    const res = await rpc.steamStoreClearMapping(appid, reject);
    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    for (const slot of res.slots ?? []) {
        try {
            await apps?.ClearCustomArtworkForApp?.(appid, slot);
        } catch (err) {
            logger.warn(`Could not clear art slot ${slot} for ${appid}:`, err);
        }
    }
    revertGameDetails(appid);
    forget(appid);
    return res;
}

/** Manual mapping (settings panel or CDP): saves, then re-runs the view. */
export async function setSteamStoreMapping(appid: number, steamAppid: number, name?: string) {
    const res = await rpc.steamStoreSetMapping(appid, steamAppid, name);
    if (res.mapping) {
        forget(appid);
        await handleSteamStoreView(appid);
    }
    return res;
}

/** A user accepted a suggestion: same as a manual mapping. */
export const acceptSteamStoreSuggestion = setSteamStoreMapping;

export async function rejectSteamStoreSuggestion(appid: number, steamAppid: number) {
    return rpc.steamStoreRejectSuggestion(appid, steamAppid);
}

export function steamStoreState(): Promise<StoreState> {
    return rpc.steamStoreGetState();
}

/** Bucket left steam-store: revert in-memory Game Info; persisted art stays until Clear (ADR-0033). */
export function leaveSteamStore(appid: number): void {
    if (storeEnrichedAppIds.has(appid)) revertGameDetails(appid);
    forget(appid);
}
