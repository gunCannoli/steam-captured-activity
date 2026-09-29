import type {
    AchievementSchemaItem,
    AchievementSchemaRecord,
    AchievementUnlockRecord,
    ArtworkUrls,
    GameCategories,
    GameMetadata,
} from "./kernel/record";
import { call } from "./ports/transport";

// ---------------------------------------------------------------------------
// Payload shapes — these mirror backend/rpc.lua. Keep them in sync.
// ---------------------------------------------------------------------------

export interface LibraryStat {
  screenshots: number;
  /** Unix seconds of the newest capture; 0 when unknown. */
  newest: number;
}

// ---------------------------------------------------------------------------

// ---- Web metadata + artwork (ex steamgriddb-artwork), unchanged ----

// Game Info payload shapes live in the kernel (migration plan § 7.0 D12); the old names stay.
export type { GameCategories };
export type ConsolidatedMetadata = GameMetadata;

export interface ProviderStatus {
    has_twitch: boolean;
    has_sgdb: boolean;
    has_screenscraper?: boolean;
    has_retroachievements?: boolean;
    status: "ready" | "needs_credentials";
    db_count: number;
}



export interface MetadataResponse {
    success?: boolean;
    source?: "local_db" | "igdb" | "fallback";
    metadata?: ConsolidatedMetadata;
    error?: string;
    message?: string;
}

// Artwork payload shapes live in the kernel (migration plan § 7.0 D12); the old names stay.
export type { ArtworkUrls };

// ---- Steam Store bucket (P3) ----

export type StoreSource = "manual" | "owned" | "search";
export interface StoreMapping {
    steam_appid: number;
    name: string;
    source: StoreSource;
    at?: number;
}
export interface StoreSuggestion {
    steam_appid: number;
    name: string;
    reason: "edition" | "near";
}
import type { StoreApplied } from "./kernel/record";
export type { StoreApplied };
export interface StoreState {
    mappings: Record<string, StoreMapping>;
    suggestions: Record<string, StoreSuggestion[]>;
    rejected: Record<string, number[]>;
    applied_artwork: Record<string, StoreApplied>;
}

// ---------------------------------------------------------------------------

export interface AutoRoutingProfile {
    category: 'retroarch' | 'console_emulator' | 'pc';
    program?: string;
}

export const rpc = {
  getLibraryStats: () => call<Record<string, LibraryStat>>('GetLibraryStats'),

    getStatus: () => call<ProviderStatus>("GetStatus"),
    saveServiceCredentials: (credentials: Record<string, string>) =>
        call<{ success: boolean; error?: string }>("SaveServiceCredentials", credentials),
    getGameMetadata: (appid: number, title: string) =>
        call<MetadataResponse>("GetGameMetadata", { appid, title }),
    refreshGameMetadata: (appid: number, title: string) =>
        call<MetadataResponse>("RefreshGameMetadata", { appid, title }),
    getAllMetadata: () =>
        call<{
            success: boolean;
            library: Record<string, ConsolidatedMetadata>;
        }>("GetAllMetadata"),
    /** Controller support inferred from each shortcut's emulator (parity plan F); unknown games are absent. */
    getControllerInference: () =>
        call<{ games?: Record<string, boolean> }>("GetControllerInference"),
    /** Auto-routing category profiles inferred from shortcut executable and launch options. */
    getAutoRoutingProfiles: () =>
        call<{ profiles?: Record<string, AutoRoutingProfile> }>("GetAutoRoutingProfiles"),

    steamStoreGetState: () => call<StoreState>("SteamStoreGetState"),
    steamStoreGetMapping: (appid: number) =>
        call<{ mapping: StoreMapping | null; rejected: number[]; applied: StoreApplied | null }>(
            "SteamStoreGetMapping",
            { appid },
        ),
    steamStoreSetMapping: (appid: number, steam_appid: number, name?: string) =>
        call<{ mapping?: StoreMapping; error?: string }>("SteamStoreSetMapping", { appid, steam_appid, name }),
    steamStoreSaveKnownMatch: (appid: number, steam_appid: number, name: string) =>
        call<{ mapping?: StoreMapping; skipped?: string; error?: string }>("SteamStoreSaveKnownMatch", {
            appid,
            steam_appid,
            name,
        }),
    steamStoreSearch: (appid: number, title: string) =>
        call<{ mapping?: StoreMapping; suggestions?: StoreSuggestion[]; skipped?: string; error?: string }>(
            "SteamStoreSearch",
            { appid, title },
        ),
    steamStoreClearMapping: (appid: number, reject: boolean) =>
        call<{ steam_appid?: number; slots: number[]; error?: string }>("SteamStoreClearMapping", { appid, reject }),
    steamStoreGetAppDetails: (steam_appid: number, appid?: number, force?: boolean) =>
        call<{ metadata?: ConsolidatedMetadata; cached?: boolean; error?: string }>("SteamStoreGetAppDetails", {
            steam_appid,
            appid,
            force,
        }),
    steamStoreRecordArtwork: (
        appid: number,
        steam_appid: number | undefined,
        slots: number[],
        failed: number[],
        extra?: { source?: "steamgriddb"; tried?: number[] },
    ) =>
        call<{ ok?: boolean; error?: string }>("SteamStoreRecordArtwork", { appid, steam_appid, slots, failed, ...extra }),
    steamStoreDownloadImage: (url: string) =>
        call<{ base64?: string; ext?: string; error?: string }>("SteamStoreDownloadImage", { url }),

    cartridgesAchievementsGet: (shortcut_appid: number, native_appid: number, hardcore?: boolean) =>
        call<AchievementStateResponse>("CartridgesAchievementsGet", { shortcut_appid, native_appid, hardcore }),
    cartridgesAchievementsUnlock: (shortcut_appid: number, achievement_id: string, unlock_time?: number) =>
        call<{ ok: boolean; unlocks: Record<string, AchievementUnlockRecord>; error?: string }>(
            "CartridgesAchievementsUnlock",
            { shortcut_appid, achievement_id, unlock_time },
        ),
    cartridgesAchievementsReset: (shortcut_appid: number) =>
        call<{ ok: boolean; unlocks: Record<string, AchievementUnlockRecord>; error?: string }>(
            "CartridgesAchievementsReset",
            { shortcut_appid },
        ),
    cartridgesAchievementsCheckUnlocks: (shortcut_appid: number, native_appid: number, game_title?: string) =>
        call<CheckUnlocksResponse>("CartridgesAchievementsCheckUnlocks", {
            shortcut_appid,
            native_appid,
            game_title,
        }),
    cartridgesAchievementsGetRetroStatus: () =>
        call<RetroStatusResponse>("CartridgesAchievementsGetRetroStatus"),
};

export interface DetectedUnlockItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    global_pct?: number;
    rtime_unlocked?: number;
}

export interface CheckUnlocksResponse {
    new_unlocks?: DetectedUnlockItem[];
    error?: string;
}

// Achievement payload shapes live in the kernel (migration plan § 7.0 D12); the old names stay.
export type { AchievementSchemaItem, AchievementSchemaRecord, AchievementUnlockRecord };



export interface AchievementStateResponse {
    schema?: AchievementSchemaRecord;
    unlocks?: Record<string, AchievementUnlockRecord>;
    error?: string;
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


