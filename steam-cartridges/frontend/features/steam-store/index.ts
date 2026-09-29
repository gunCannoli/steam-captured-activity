import { logger } from "../../logger";
import {
    rpc,
    type ArtworkUrls,
    type ConsolidatedMetadata,
    type StoreApplied,
    type StoreState,
} from "../../rpc";
import type { Identity, Part } from "../../kernel/record";
import { normalizeMetadata } from "../game-info/normalize";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { artworkPlan, mergeArtResult, pickUrls, slotList } from "./art-plan";
import { storeEnrichedAppIds } from "./enriched";
import { cdnArtworkUrls } from "./resolve";
import { assetUrlsFromItem, loadStoreItem, metadataFromStoreItem } from "./store-item";
import { loadAchievementsForApp } from "../achievements";

/** Artwork slots and logo position (surfaces/artwork), wired in index.tsx (plan § 7.0 D3). */
let artwork: {
    applyFromUrls(appid: number, urls: ArtworkUrls): Promise<number[]>;
    clearSlot(appid: number, slot: number): Promise<void>;
    ensureLogoPosition(appid: number): Promise<void>;
    clearLogoPosition(appid: number): Promise<void>;
} = {
    applyFromUrls: async () => [],
    clearSlot: async () => {},
    ensureLogoPosition: async () => {},
    clearLogoPosition: async () => {},
};

export function setArtworkSink(writer: typeof artwork): void {
    artwork = writer;
}
const applyCustomArtworkFromUrls = (appid: number, urls: ArtworkUrls) => artwork.applyFromUrls(appid, urls);
const ensureLogoPosition = (appid: number) => artwork.ensureLogoPosition(appid);
const clearLogoPosition = (appid: number) => artwork.clearLogoPosition(appid);

/** app/identity, for invalidation after a manual mapping write (plan § 7.0 D3, D8: public API). */
let identitySource: { invalidate(appid: number): void; ensure(appid: number, route: { bucket: "steam-store" | "web-scraping" | "none"; via: string }): Promise<Part<Identity>> } = {
    invalidate: () => {},
    ensure: async () => ({ status: "pending" }),
};

export function setIdentitySource(source: typeof identitySource): void {
    identitySource = source;
}

/** Game-info surface calls, wired in index.tsx (plan § 7.0 D3). */
let gameInfo: {
    enrich(appid: number, meta: ConsolidatedMetadata): boolean;
    revert(appid: number): void;
    refresh(): void;
} = { enrich: () => false, revert: () => {}, refresh: () => {} };

export function setGameInfoSink(writer: typeof gameInfo): void {
    gameInfo = writer;
}
const enrichGameDetails = (appid: number, meta: ConsolidatedMetadata) => gameInfo.enrich(appid, meta);
const revertGameDetails = (appid: number) => gameInfo.revert(appid);
const refreshGameInfoInstances = () => gameInfo.refresh();

/** Appids handled this session (one lookup per game per session, as in the web path). */
const processed = new Set<number>();
/** Metadata already fetched this session, re-applied on later views. */
const metaCache = new Map<number, ConsolidatedMetadata>();
/** A lookup that failed (offline, HTTP error) may run again on a view after this time (P4 H3). */
const RETRY_MS = 5 * 60_000;
const retryAt = new Map<number, number>();
/** Games whose failed art slots were already retried this session (P4 H5). */
const artRetried = new Set<number>();

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
    steamAppid: number,
    applied: StoreApplied | null,
    urls: Loaded["urls"],
): Promise<number[]> {
    const plan = artworkPlan(applied, steamAppid, artRetried.has(appid));
    if (applied?.steam_appid === steamAppid) artRetried.add(appid);
    if (plan.write.length === 0) return slotList(applied?.slots);

    // A different game was mapped before: clear only the slots this plugin wrote.
    for (const slot of plan.clear) {
        try {
            await artwork.clearSlot(appid, slot);
        } catch {}
    }
    const written = await applyCustomArtworkFromUrls(appid, pickUrls(urls, plan.write));
    const { slots, failed } = mergeArtResult(applied, steamAppid, plan, written);
    const res = await rpc.steamStoreRecordArtwork(appid, steamAppid, slots, failed);
    if (res?.error) {
        // The mapping was cleared while we were writing: remove what we just wrote (P4 H5).
        for (const slot of written) {
            try {
                await artwork.clearSlot(appid, slot);
            } catch {}
        }
        logger.warn(`Steam Store: art for ${appid} discarded (${res.error}).`);
        return [];
    }
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${steamAppid} to ${appid}; ${failed.length} failed.`);
    return slots;
}

/** Per-session answer to "did the Steam Store supply this game's Game Info?" (ADR-0036). */
const matched = new Map<number, boolean>();

/**
 * Desktop and Big Picture entry point for a steam-store game. `identity` comes
 * from `app.identity.ensure` (migration plan M4c); this keeps only the
 * metadata and artwork half of the old `resolveMapping` pipeline (until
 * M5b/M5c). Resolves to true when store data was applied, false when there is
 * no Steam match (or its data could not load; the caller then falls back to
 * web scraping, ADR-0036), undefined when identity is not known yet (`pending`).
 */
export async function handleSteamStoreView(appid: number, identity: Part<Identity>): Promise<boolean | undefined> {
    if (appid < NON_STEAM_APPID_MIN) return undefined;

    const cached = metaCache.get(appid);
    if (cached) {
        enrichGameDetails(appid, cached);
        storeEnrichedAppIds.add(appid);
    }

    if (identity.status === "pending") return undefined;

    const steamAppid = identity.data?.native?.appid;
    if (steamAppid === undefined) {
        matched.set(appid, false);
        return false;
    }

    if (processed.has(appid)) {
        const at = retryAt.get(appid);
        if (at === undefined || Date.now() < at) return matched.get(appid);
        retryAt.delete(appid);
    }
    processed.add(appid);

    try {
        // Parity C + D: Steam's own Links/Friends/Community sections and activity
        // feed read the native app; sections, native-links and captures are
        // record-driven from `record.identity` now (surfaces, plan M4c).
        refreshGameInfoInstances(); // guardrail 11: the sections already rendered with the shortcut appid
        void loadAchievementsForApp(appid, steamAppid);

        const { metadata, urls } = await loadNative(appid, steamAppid);
        if (metadata) {
            metaCache.set(appid, metadata);
            if (enrichGameDetails(appid, metadata)) storeEnrichedAppIds.add(appid);
        } else {
            logger.warn(`Steam Store: no metadata for ${steamAppid}.`);
            retryAt.set(appid, Date.now() + RETRY_MS);
        }
        matched.set(appid, metadata !== null);

        const applied = (await rpc.steamStoreGetMapping(appid)).applied;
        const slots = await applyArtwork(appid, steamAppid, applied, urls);
        // Parity E: our logo needs a position or Steam never draws it.
        if (slots.includes(2)) await ensureLogoPosition(appid);
        return metadata !== null;
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
        return matched.get(appid);
    }
}

/**
 * Drop this session's memory of a game so the next view starts fresh.
 * Native-links, sections and captures are record-driven (plan M4c): they
 * clear themselves once `record.identity` no longer has a native match,
 * which the caller gets by invalidating and re-resolving identity.
 */
function forget(appid: number): void {
    processed.delete(appid);
    metaCache.delete(appid);
    storeEnrichedAppIds.delete(appid);
    retryAt.delete(appid);
    artRetried.delete(appid);
    matched.delete(appid);
}

/**
 * Remove the mapping, clear the art slots this plugin wrote (and only those),
 * and revert Game Info. `reject` remembers the match so it is never re-applied.
 */
export async function clearSteamStore(appid: number, reject: boolean) {
    const res = await rpc.steamStoreClearMapping(appid, reject);
    for (const slot of slotList(res.slots)) {
        try {
            await artwork.clearSlot(appid, slot);
        } catch (err) {
            logger.warn(`Could not clear art slot ${slot} for ${appid}:`, err);
        }
    }
    if (slotList(res.slots).includes(2)) await clearLogoPosition(appid);
    revertGameDetails(appid);
    forget(appid);
    identitySource.invalidate(appid);
    await identitySource.ensure(appid, { bucket: "steam-store", via: "manual" });
    return res;
}

/** Manual mapping (settings panel or CDP): saves, then re-runs the view. */
export async function setSteamStoreMapping(appid: number, steamAppid: number, name?: string) {
    const res = await rpc.steamStoreSetMapping(appid, steamAppid, name);
    if (res.mapping) {
        forget(appid);
        identitySource.invalidate(appid);
        const identity = await identitySource.ensure(appid, { bucket: "steam-store", via: "manual" });
        await handleSteamStoreView(appid, identity);
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
