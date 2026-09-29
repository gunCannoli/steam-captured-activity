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
import { refreshGameInfoInstances } from "../game-info/game-info-patch";
import { enrichGameDetails, revertGameDetails } from "../game-info/metadata";
import { normalizeMetadata } from "../game-info/normalize";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { setNativeActivitySource } from "../../steam/activity";
import { setExtraSections } from "../../steam/sections";
import { patch as patchLibraryApp } from "../../renderers/library-app";
import { artworkPlan, mergeArtResult, pickUrls, slotList } from "./art-plan";
import { storeEnrichedAppIds } from "./enriched";
import { knownAppName, matchKnownNative } from "./known-apps";
import { clearLogoPosition, ensureLogoPosition } from "./logo";
import { setNativeAppid } from "./native-sections";
import { cdnArtworkUrls } from "./resolve";
import { assetUrlsFromItem, loadStoreItem, metadataFromStoreItem } from "./store-item";
import { loadAchievementsForApp } from "../achievements";

/** Appids handled this session (one lookup per game per session, as in the web path). */
const processed = new Set<number>();
/** Metadata already fetched this session, re-applied on later views. */
const metaCache = new Map<number, ConsolidatedMetadata>();
/** A lookup that failed (offline, HTTP error) may run again on a view after this time (P4 H3). */
const RETRY_MS = 5 * 60_000;
const retryAt = new Map<number, number>();
/** Games whose failed art slots were already retried this session (P4 H5). */
const artRetried = new Set<number>();

async function resolveMapping(
    appid: number,
): Promise<{ mapping: StoreMapping | null; applied: StoreApplied | null; retry?: boolean; error?: boolean }> {
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
        return { mapping: null, applied: null, error: true };
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
        metadata = res?.metadata ? normalizeMetadata(res.metadata) : null;
    }
    return { metadata, urls };
}

/** Returns the slots recorded as ours afterwards. */
async function applyArtwork(
    appid: number,
    mapping: StoreMapping,
    applied: StoreApplied | null,
    urls: Loaded["urls"],
): Promise<number[]> {
    const plan = artworkPlan(applied, mapping.steam_appid, artRetried.has(appid));
    if (applied?.steam_appid === mapping.steam_appid) artRetried.add(appid);
    if (plan.write.length === 0) return slotList(applied?.slots);

    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    // A different game was mapped before: clear only the slots this plugin wrote.
    for (const slot of plan.clear) {
        try {
            await apps?.ClearCustomArtworkForApp?.(appid, slot);
        } catch {}
    }
    const written = await applyCustomArtworkFromUrls(appid, pickUrls(urls, plan.write));
    const { slots, failed } = mergeArtResult(applied, mapping.steam_appid, plan, written);
    const res = await rpc.steamStoreRecordArtwork(appid, mapping.steam_appid, slots, failed);
    if (res?.error) {
        // The mapping was cleared while we were writing: remove what we just wrote (P4 H5).
        for (const slot of written) {
            try {
                await apps?.ClearCustomArtworkForApp?.(appid, slot);
            } catch {}
        }
        logger.warn(`Steam Store: art for ${appid} discarded (${res.error}).`);
        return [];
    }
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${mapping.steam_appid} to ${appid}; ${failed.length} failed.`);
    return slots;
}

/** Steam sections a mapped shortcut gets back (parity plan C3; data comes from the native app). */
const NATIVE_SECTIONS = ["friends", "community", "achievements"] as const;

/** Per-session answer to "did the Steam Store supply this game's Game Info?" (ADR-0036). */
const matched = new Map<number, boolean>();

/**
 * Desktop and Big Picture entry point for a steam-store game. Resolves to
 * true when store data was applied, false when there is no Steam match (or its
 * data could not load; the caller then falls back to web scraping, ADR-0036),
 * undefined when it is not known yet (title not available).
 */
export async function handleSteamStoreView(appid: number): Promise<boolean | undefined> {
    if (appid < NON_STEAM_APPID_MIN) return undefined;

    const cached = metaCache.get(appid);
    if (cached) {
        enrichGameDetails(appid, cached);
        storeEnrichedAppIds.add(appid);
    }
    if (processed.has(appid)) {
        const at = retryAt.get(appid);
        if (at === undefined || Date.now() < at) return matched.get(appid);
        retryAt.delete(appid);
    }
    processed.add(appid);

    try {
        const { mapping, applied, retry, error } = await resolveMapping(appid);
        if (retry) {
            processed.delete(appid);
            return undefined;
        }
        if (error) retryAt.set(appid, Date.now() + RETRY_MS);
        if (!mapping) {
            matched.set(appid, false);
            return false;
        }

        // Parity C + D: Steam's own Links/Friends/Community sections and activity
        // feed read the native app; re-publish so the feed picks up its events.
        setNativeAppid(appid, mapping.steam_appid);
        setNativeActivitySource(appid, mapping.steam_appid);
        setExtraSections(appid, NATIVE_SECTIONS);
        refreshGameInfoInstances(); // guardrail 11: the sections already rendered with the shortcut appid
        void patchLibraryApp(appid);
        void loadAchievementsForApp(appid, mapping.steam_appid);

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
        if (metadata) {
            metaCache.set(appid, metadata);
            if (enrichGameDetails(appid, metadata)) storeEnrichedAppIds.add(appid);
        } else {
            logger.warn(`Steam Store: no metadata for ${mapping.steam_appid}.`);
            retryAt.set(appid, Date.now() + RETRY_MS);
        }
        matched.set(appid, metadata !== null);

        const slots = await applyArtwork(appid, mapping, applied, urls);
        // Parity E: our logo needs a position or Steam never draws it.
        if (slots.includes(2)) await ensureLogoPosition(appid);
        return metadata !== null;
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
        return matched.get(appid);
    }
}

/** Drop this session's memory of a game so the next view starts fresh. */
function forget(appid: number): void {
    processed.delete(appid);
    metaCache.delete(appid);
    storeEnrichedAppIds.delete(appid);
    retryAt.delete(appid);
    artRetried.delete(appid);
    matched.delete(appid);
    setNativeAppid(appid, undefined);
    setNativeActivitySource(appid, undefined);
    setExtraSections(appid, undefined);
}

/**
 * Remove the mapping, clear the art slots this plugin wrote (and only those),
 * and revert Game Info. `reject` remembers the match so it is never re-applied.
 */
export async function clearSteamStore(appid: number, reject: boolean) {
    const res = await rpc.steamStoreClearMapping(appid, reject);
    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    for (const slot of slotList(res.slots)) {
        try {
            await apps?.ClearCustomArtworkForApp?.(appid, slot);
        } catch (err) {
            logger.warn(`Could not clear art slot ${slot} for ${appid}:`, err);
        }
    }
    if (slotList(res.slots).includes(2)) await clearLogoPosition(appid);
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

export function steamStoreState(): Promise<StoreState> {
    return rpc.steamStoreGetState();
}

/** Bucket left steam-store: revert in-memory Game Info; persisted art stays until Clear (ADR-0033). */
export function leaveSteamStore(appid: number): void {
    if (storeEnrichedAppIds.has(appid)) revertGameDetails(appid);
    forget(appid);
}
