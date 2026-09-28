async function call<R>(name: string, payload: object = {}): Promise<R> {
  const millennium = (window as any)['Millennium'];
  const callFn = millennium ? millennium['callServerMethod'] : undefined;
  const candidatePlugins = ['steam-cartridges-dev', 'steam-cartridges'];
  let lastError: any;
  for (const plugin of candidatePlugins) {
    try {
      if (typeof callFn === 'function') {
        const raw = await callFn.call(millennium, plugin, name, {
          payload: JSON.stringify(payload),
        });
        return JSON.parse(raw as string) as R;
      }
    } catch (err: any) {
      lastError = err;
      if (String(err).includes('plugin not running')) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Payload shapes — these mirror backend/rpc.lua. Keep them in sync.
// ---------------------------------------------------------------------------

export interface LibraryStat {
  screenshots: number;
  /** Unix seconds of the newest capture; 0 when unknown. */
  newest: number;
}

export interface Diagnostics {
  ok: boolean;
  error?: string;
  steam_root?: string;
  user_id?: string;
  shortcuts?: number;
  games_with_media?: number;
  screenshots?: number;
}

// ---------------------------------------------------------------------------

// ---- Web metadata + artwork (ex steamgriddb-artwork), unchanged ----

export interface ProviderStatus {
    has_twitch: boolean;
    has_sgdb: boolean;
    has_screenscraper?: boolean;
    has_retroachievements?: boolean;
    status: "ready" | "needs_credentials";
    db_count: number;
}

export interface GameCategories {
    single_player?: boolean;
    multiplayer?: boolean;
    coop?: boolean;
    split_screen?: boolean;
    full_controller?: boolean;
    partial_controller?: boolean;
    achievements?: boolean;
    remote_play_together?: boolean;
}

export interface ConsolidatedMetadata {
    appid: number;
    title: string;
    igdb_id?: number;
    matched_title?: string;
    short_description?: string;
    summary?: string;
    description?: string;
    developers?: string[];
    publishers?: string[];
    franchises?: string[];
    release_date?: number;
    /** First release (Early Access start) when it differs from release_date; Steam Store only. */
    original_release_date?: number;
    genres?: string[];
    categories?: GameCategories;
    /** Steam's own player + controller category ids (StoreItemCache); filtered by category-policy.ts. */
    store_category_ids?: number[];
    custom_override?: boolean;
    /** Set by the Steam Store bucket. */
    source?: string;
    steam_appid?: number;
}

export interface MetadataResponse {
    success?: boolean;
    source?: "local_db" | "igdb" | "fallback";
    metadata?: ConsolidatedMetadata;
    error?: string;
    message?: string;
}

export interface ImageAsset {
    base64: string;
    ext: string;
}

export interface ArtworkBundle {
    portrait?: ImageAsset;
    hero?: ImageAsset;
    logo?: ImageAsset;
    wide?: ImageAsset;
}

export interface ArtworkUrls {
    portrait?: string;
    hero?: string;
    logo?: string;
    wide?: string;
}

export interface GameArtworkResponse {
    success?: boolean;
    error?: string;
    message?: string;
    game?: {
        id: number;
        name: string;
        release_date?: number;
    };
    urls?: ArtworkUrls;
    artwork?: ArtworkBundle;
}

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
export interface StoreApplied {
    steam_appid: number;
    slots: number[];
    /** Slots attempted but not written (retried once per session, P4 H5). */
    failed?: number[];
    at?: number;
}
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

  getDiagnostics: () => call<Diagnostics>('GetDiagnostics'),

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
    saveGameMetadata: (appid: number, metadata: ConsolidatedMetadata) =>
        call<{ success: boolean; metadata: ConsolidatedMetadata }>(
            "SaveGameMetadata",
            { appid, metadata },
        ),
    getArtworkForGame: (title: string, steamAppId?: number) =>
        call<GameArtworkResponse>("GetArtworkForGame", {
            title,
            steam_appid: steamAppId,
        }),

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
    steamStoreRejectSuggestion: (appid: number, steam_appid: number) =>
        call<{ ok?: boolean; error?: string }>("SteamStoreRejectSuggestion", { appid, steam_appid }),
    steamStoreGetAppDetails: (steam_appid: number, appid?: number, force?: boolean) =>
        call<{ metadata?: ConsolidatedMetadata; cached?: boolean; error?: string }>("SteamStoreGetAppDetails", {
            steam_appid,
            appid,
            force,
        }),
    steamStoreRecordArtwork: (appid: number, steam_appid: number, slots: number[], failed: number[]) =>
        call<{ ok?: boolean; error?: string }>("SteamStoreRecordArtwork", { appid, steam_appid, slots, failed }),
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
    getGameMedia: (appid: number) =>
        call<GameMediaResponse>("GetGameMedia", { appid }),
    getGameManual: (appid: number) =>
        call<GameManualResponse>("GetGameManual", { appid }),
    getGameTrailers: (appid: number, title?: string) =>
        call<GameTrailersResponse>("GetGameTrailers", { appid, title }),
    getGameCommunityLinks: (appid: number, title?: string) =>
        call<GameCommunityLinksResponse>("GetGameCommunityLinks", { appid, title }),
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

export interface AchievementSchemaItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    global_pct: number;
}

export interface AchievementSchemaRecord {
    native_appid: number;
    total: number;
    achievements: AchievementSchemaItem[];
    fetched_at?: number;
}

export interface AchievementUnlockRecord {
    unlocked_time: number;
}

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

export interface GameMediaResponse {
    success?: boolean;
    media?: {
        appid: number;
        rom_title?: string;
        screenshots?: string[];
        titlescreen?: string;
        fanart?: string;
        video?: string;
        manual?: string;
    };
    error?: string;
}

export interface GameManualResponse {
    success?: boolean;
    manual_url?: string;
    message?: string;
    error?: string;
}

export interface GameTrailerItem {
    video_id: string;
    name: string;
    category: number;
    url: string;
    thumbnail: string;
}

export interface GameTrailersResponse {
    success?: boolean;
    trailers?: GameTrailerItem[];
    error?: string;
}

export interface GameCommunityLinkItem {
    name: string;
    category: number;
    url: string;
}

export interface GameArtworkCommunityItem {
    image_id: string;
    url: string;
    thumbnail: string;
}

export interface GameCommunityLinksResponse {
    success?: boolean;
    links?: GameCommunityLinkItem[];
    artworks?: GameArtworkCommunityItem[];
    error?: string;
}


