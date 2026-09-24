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
    genres?: string[];
    categories?: GameCategories;
    custom_override?: boolean;
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

// ---------------------------------------------------------------------------

export const rpc = {
  getLibraryStats: () => call<Record<string, LibraryStat>>('GetLibraryStats'),

  getDiagnostics: () => call<Diagnostics>('GetDiagnostics'),

    getStatus: () => call<ProviderStatus>("GetStatus"),
    getGameMetadata: (appid: number, title: string) =>
        call<MetadataResponse>("GetGameMetadata", { appid, title }),
    getAllMetadata: () =>
        call<{
            success: boolean;
            library: Record<string, ConsolidatedMetadata>;
        }>("GetAllMetadata"),
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
};
