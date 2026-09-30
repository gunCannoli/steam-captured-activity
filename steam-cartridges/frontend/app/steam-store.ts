import { logger } from "../logger";
import { backend, type StoreState } from "../ports/backend";
import type { GameMetadata, Identity, Part } from "../kernel/record";
import { NON_STEAM_APPID_MIN } from "../kernel/appid";
import { iconRestoreOf, slotList } from "../domain/art-plan";

type Route = { bucket: "steam-store" | "web-scraping" | "none"; via: string };

/** app/identity, for invalidation after a manual mapping write (plan § 7.0 D3, D8: public API). */
let identitySource: { invalidate(appid: number): void; ensure(appid: number, route: Route): Promise<Part<Identity>> } = {
    invalidate: () => {},
    ensure: async () => ({ status: "pending" }),
};

export function setIdentitySource(source: typeof identitySource): void {
    identitySource = source;
}

/** app/metadata, re-run after a manual mapping write (plan § 7.0 D3). */
let metadataSource: { ensure(appid: number, route: Route, identity: Part<Identity>): Promise<Part<GameMetadata>> } = {
    ensure: async () => ({ status: "pending" }),
};

export function setMetadataSource(source: typeof metadataSource): void {
    metadataSource = source;
}

/** app/artwork: the record-driven artwork plan (M5c). `clearSlots` asks the surface to clear the
 *  slots the backend just forgot (and put the library icon back, icon plan); the surface is the
 *  only code that writes them. */
let artworkSource: {
    ensure(appid: number, route: Route, identity: Part<Identity>): Promise<unknown>;
    invalidate(appid: number): void;
    clearSlots(appid: number, slots: number[], iconRestore?: string): void;
} = { ensure: async () => ({ status: "pending" }), invalidate: () => {}, clearSlots: () => {} };

export function setArtworkSource(source: typeof artworkSource): void {
    artworkSource = source;
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

/** Appids whose Steam-match side effects already ran this session. */
const processed = new Set<number>();

/**
 * Desktop and Big Picture entry point for a steam-store game. `identity` comes from
 * `app.identity.ensure` (M4c); Game Info (`app.metadata`, M5b) and artwork (`app.artwork`,
 * M5c) are record-driven — this keeps only the Steam-match side effects. Resolves to true
 * when there is a Steam match, false when there is none (the caller then falls back to
 * web scraping, ADR-0036), undefined when identity is not known yet (`pending`).
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
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
    }
    return true;
}

/**
 * Drop this session's memory of a game so the next view starts fresh.
 * Native-links, sections, captures, game-info and artwork are record-driven (plan M4c–M5c):
 * they follow the record parts, which the caller re-resolves after invalidating.
 */
function forget(appid: number): void {
    processed.delete(appid);
    identitySource.invalidate(appid);
    artworkSource.invalidate(appid);
}

/**
 * Remove the mapping, clear the art slots this plugin wrote (and only those), and put back
 * the library icon ours replaced while the shortcut still shows ours (icon plan).
 * `reject` remembers the match so it is never re-applied.
 */
export async function clearSteamStore(appid: number, reject: boolean) {
    const res = await backend.steamStoreClearMapping(appid, reject);
    artworkSource.clearSlots(appid, slotList(res.slots), iconRestoreOf(res));
    forget(appid);
    const identity = await identitySource.ensure(appid, { bucket: "steam-store", via: "manual" });
    await metadataSource.ensure(appid, { bucket: "steam-store", via: "manual" }, identity);
    return res;
}

/** Manual mapping (settings panel or CDP): saves, then re-runs the view. */
export async function setSteamStoreMapping(appid: number, steamAppid: number, name?: string) {
    const res = await backend.steamStoreSetMapping(appid, steamAppid, name);
    if (res.mapping) {
        forget(appid);
        const route: Route = { bucket: "steam-store", via: "manual" };
        const identity = await identitySource.ensure(appid, route);
        await metadataSource.ensure(appid, route, identity);
        await artworkSource.ensure(appid, route, identity);
        await handleSteamStoreView(appid, identity);
    }
    return res;
}

export function steamStoreState(): Promise<StoreState> {
    return backend.steamStoreGetState();
}

/** Bucket left steam-store: drop this session's memory. Game Info and artwork follow the record
 *  (the next resolution for the new route); persisted art stays until Clear (ADR-0033). */
export function leaveSteamStore(appid: number): void {
    processed.delete(appid);
}
