// The record facade RPC client (migration plan M4b/M4c; M5a extends it with
// metadata and GetAllRecords). Imports kernel types only; transport from
// ports/transport.ts.
import type { AchievementUnlockRecord, ArtworkUrls, GameMetadata, Identity, Part, RecordPart } from "../kernel/record";
import { call } from "./transport";

export interface ProviderStatus {
    has_twitch: boolean;
    has_sgdb: boolean;
    has_screenscraper?: boolean;
    has_retroachievements?: boolean;
    status: "ready" | "needs_credentials";
    db_count: number;
}



export interface EmulatorStatusItem {
    name: string;
    detected: boolean;
    path?: string;
    username?: string;
    authenticated: boolean;
}

export interface RetroStatusResponse {
    emulators: EmulatorStatusItem[];
    env_fallback: boolean;
    env_username?: string;
}

export interface OwnedCandidate {
    appid: number;
    name: string;
}

export interface FreshContext {
    /** The shortcut's display name (""  when unknown). */
    title: string;
    /** The frontend's evaluated routing policy (ADR-0040). */
    route: { bucket: "steam-store" | "web-scraping" | "none"; via: string };
    /** Identity only: natives Steam already knows (sensors/owned-apps). */
    owned?: OwnedCandidate[];
    /** Metadata only (M5): StoreItemCache data for identity.native. */
    storeItem?: GameMetadata | null;
    /** Metadata only (M5): igdb enabled and allowed by routing. */
    allowWeb?: boolean;
    /** Metadata only (M5d): screenscraperEnabled and allowed by routing. */
    allowScreenscraper?: boolean;
    /** Metadata and artwork: the identity the frontend already knows. An "ok" result with no
     *  native match is never persisted, so the backend cannot recover it from disk. */
    identity?: Part<Identity>;
    /** Artwork only (M5c): hashed StoreItemCache URLs for the mapped native app. */
    artUrls?: ArtworkUrls;
    /** Artwork only (M5c): services.steamgriddbEnabled and routing allow SteamGridDB. */
    allowSgdb?: boolean;
    /** true = disk and context only (bulk re-evaluation). */
    noNetwork?: boolean;
    /** Achievements only (M6a): setting raHardcoreMode. */
    hardcore?: boolean;
    /** M7a: ignore TTLs, never a custom_override record. */
    force?: boolean;
}

export interface RecordResponse {
    appid: number;
    parts: Partial<Record<RecordPart, Part<unknown>>>;
    /** Set instead of parts when the call failed. */
    error?: string;
    /** Sources the backend has paused (429, or repeated failures), by source id (M7a). */
    paused?: Record<string, number>;
}

export const backend = {
    /** Disk only. */
    getGameRecord(appid: number): Promise<RecordResponse> {
        return call<RecordResponse>("GetGameRecord", { appid });
    },
    ensureFresh(appid: number, parts: RecordPart[], ctx: FreshContext): Promise<RecordResponse> {
        return call<RecordResponse>("EnsureFresh", { appid, parts, context: ctx });
    },
    /** New unlocks since the last check (M6a). `new_unlocks` may arrive as `{}` (K1): normalize it. */
    checkUnlocks(appid: number, native: number, title?: string): Promise<{ new_unlocks?: unknown; error?: string }> {
        return call<{ new_unlocks?: unknown; error?: string }>("CheckUnlocks", { appid, native, title });
    },
    /** Test hook and manual unlock (`triggerAchievement`, public API). */
    unlockAchievement(appid: number, achievementId: string, unlockTime?: number) {
        return call<{ ok: boolean; unlocks: Record<string, AchievementUnlockRecord>; error?: string }>(
            "CartridgesAchievementsUnlock",
            { shortcut_appid: appid, achievement_id: achievementId, unlock_time: unlockTime },
        );
    },
    resetAchievements(appid: number) {
        return call<{ ok: boolean; unlocks: Record<string, AchievementUnlockRecord>; error?: string }>(
            "CartridgesAchievementsReset",
            { shortcut_appid: appid },
        );
    },
    /** Shortcuts not seen before (M7a). The first call seeds the library and returns none. */
    getNewShortcuts(): Promise<{ shortcuts?: unknown }> {
        return call<{ shortcuts?: unknown }>("GetNewShortcuts", {});
    },
    markKnown(appids: number[]): Promise<{ ok?: boolean; error?: string }> {
        return call<{ ok?: boolean; error?: string }>("MarkKnown", { appids });
    },
    /** Disk only: every DB record and every saved mapping (M5a). */
    getAllRecords(): Promise<{ records: Record<string, RecordResponse["parts"]> }> {
        return call<{ records: Record<string, RecordResponse["parts"]> }>("GetAllRecords", {});
    },
    /** Provider credentials present, and how many games the database holds. */
    getStatus(): Promise<ProviderStatus> {
        return call<ProviderStatus>("GetStatus");
    },
    saveServiceCredentials(credentials: Record<string, string>) {
        return call<{ success: boolean; error?: string }>("SaveServiceCredentials", credentials);
    },
    /** Which emulators the RetroAchievements source can read (M8b, moved from rpc.ts). */
    getRetroStatus(): Promise<RetroStatusResponse> {
        return call<RetroStatusResponse>("CartridgesAchievementsGetRetroStatus");
    },
};
