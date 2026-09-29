import { logger } from "../../logger";
import { rpc, type ArtworkUrls, type StoreApplied, type StoreState } from "../../rpc";
import type { Identity, Part } from "../../kernel/record";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { artworkPlan, mergeArtResult, pickUrls, slotList } from "./art-plan";
import { cdnArtworkUrls } from "./resolve";
import { assetUrlsFromItem } from "../../domain/store-item";
import { loadAchievementsForApp } from "../achievements";

/** sensors/store-item, wired in index.tsx (plan § 7.0 D3: features may not import sensors). */
let storeItemSource: { load(steamAppid: number): Promise<any | null> } = { load: async () => null };

export function setStoreItemSource(source: typeof storeItemSource): void {
    storeItemSource = source;
}

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

/** app/metadata, for invalidation after a manual mapping write (plan § 7.0 D3). */
let metadataSource: { invalidate?(appid: number): void; ensure(appid: number, route: { bucket: "steam-store" | "web-scraping" | "none"; via: string }, identity: Part<Identity>): Promise<unknown> } = {
    ensure: async () => ({ status: "pending" }),
};

export function setMetadataSource(source: typeof metadataSource): void {
    metadataSource = source;
}

/** Game-info surface refresh call, for guardrail 11 (Game Info already rendered with the
 *  shortcut's own appid before the Steam Store match resolved); wired in index.tsx (D3).
 *  Not the old setGameInfoSink writer (M5b, § 7.9: Game Info writes come from record.metadata
 *  only now) — this is a narrower, refresh-only capability. */
let gameInfoRefresher: { refresh(): void } = { refresh: () => {} };

export function setGameInfoRefresher(writer: typeof gameInfoRefresher): void {
    gameInfoRefresher = writer;
}
const refreshGameInfoInstances = () => gameInfoRefresher.refresh();

/** Appids whose artwork was already applied this session (one lookup per game per session). */
const processed = new Set<number>();
/** Games whose failed art slots were already retried this session (P4 H5). */
const artRetried = new Set<number>();

/** Returns the slots recorded as ours afterwards. */
async function applyArtwork(
    appid: number,
    steamAppid: number,
    applied: StoreApplied | null,
    urls: ReturnType<typeof cdnArtworkUrls>,
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

/**
 * Desktop and Big Picture entry point for a steam-store game. `identity` comes
 * from `app.identity.ensure` (migration plan M4c); Game Info is record-driven
 * (`app.metadata`, `surfaces/game-info`, M5b) — this keeps only artwork.
 * Resolves to true when there is a Steam match (whether or not art could load),
 * false when there is no match (the caller then falls back to web scraping,
 * ADR-0036), undefined when identity is not known yet (`pending`).
 */
export async function handleSteamStoreView(appid: number, identity: Part<Identity>): Promise<boolean | undefined> {
    if (appid < NON_STEAM_APPID_MIN) return undefined;

    if (identity.status === "pending") return undefined;

    const steamAppid = identity.data?.native?.appid;
    if (steamAppid === undefined) return false;

    if (processed.has(appid)) return true;
    processed.add(appid);

    try {
        // Parity C + D: Steam's own Links/Friends/Community sections and activity
        // feed read the native app; sections, native-links and captures are
        // record-driven from `record.identity` now (surfaces, plan M4c).
        refreshGameInfoInstances(); // guardrail 11: the sections already rendered with the shortcut appid
        void loadAchievementsForApp(appid, steamAppid);

        const urls = cdnArtworkUrls(steamAppid);
        const item = await storeItemSource.load(steamAppid);
        if (item) {
            const hashed = assetUrlsFromItem(item);
            for (const key of Object.keys(hashed) as (keyof typeof urls)[]) {
                if (hashed[key]) urls[key] = hashed[key]!;
            }
        }

        const applied = (await rpc.steamStoreGetMapping(appid)).applied;
        const slots = await applyArtwork(appid, steamAppid, applied, urls);
        // Parity E: our logo needs a position or Steam never draws it.
        if (slots.includes(2)) await ensureLogoPosition(appid);
        return true;
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
        return true;
    }
}

/**
 * Drop this session's memory of a game so the next view starts fresh.
 * Native-links, sections, captures and game-info are record-driven (plan M4c/M5b):
 * they clear themselves once the corresponding record part changes, which the
 * caller gets by invalidating and re-resolving identity/metadata.
 */
function forget(appid: number): void {
    processed.delete(appid);
    artRetried.delete(appid);
}

/**
 * Remove the mapping, clear the art slots this plugin wrote (and only those).
 * `reject` remembers the match so it is never re-applied.
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
    forget(appid);
    identitySource.invalidate(appid);
    const identity = await identitySource.ensure(appid, { bucket: "steam-store", via: "manual" });
    await metadataSource.ensure(appid, { bucket: "steam-store", via: "manual" }, identity);
    return res;
}

/** Manual mapping (settings panel or CDP): saves, then re-runs the view. */
export async function setSteamStoreMapping(appid: number, steamAppid: number, name?: string) {
    const res = await rpc.steamStoreSetMapping(appid, steamAppid, name);
    if (res.mapping) {
        forget(appid);
        identitySource.invalidate(appid);
        const identity = await identitySource.ensure(appid, { bucket: "steam-store", via: "manual" });
        await metadataSource.ensure(appid, { bucket: "steam-store", via: "manual" }, identity);
        await handleSteamStoreView(appid, identity);
    }
    return res;
}

export function steamStoreState(): Promise<StoreState> {
    return rpc.steamStoreGetState();
}

/** Bucket left steam-store: drop this session's artwork memory. Game Info reverts itself
 *  (record-driven, plan M5b): the next metadata resolution for the new route writes a
 *  non-"ok" part, and the game-info surface's render() reverts on that change. */
export function leaveSteamStore(appid: number): void {
    forget(appid);
}
