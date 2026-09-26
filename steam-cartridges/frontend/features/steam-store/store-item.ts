import type { ArtworkUrls, ConsolidatedMetadata, GameCategories } from '../../rpc';

/**
 * Metadata for a native app straight from Steam's own StoreItemCache (P0 T3:
 * loads unowned apps through Steam's transport). First rung of the ADR-0009
 * ladder; the backend `appdetails` call is the fallback.
 */

// Same mapping as backend/steam_store_appdetails.lua CATEGORY_FLAGS.
const CATEGORY_FLAGS: Record<number, keyof GameCategories> = {
    2: 'single_player',
    1: 'multiplayer',
    36: 'multiplayer',
    49: 'multiplayer',
    9: 'coop',
    38: 'coop',
    24: 'split_screen',
    37: 'split_screen',
    39: 'split_screen',
    28: 'full_controller',
    18: 'partial_controller',
    44: 'remote_play_together',
};

/** Category ids from `m_StoreCategories`, whatever shape holds them (arrays of ids or of {categoryid}). */
export function categoryIds(raw: unknown): number[] {
    const out: number[] = [];
    const visit = (v: unknown, depth: number) => {
        if (depth > 3 || v == null) return;
        if (typeof v === 'number') out.push(v);
        else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
        else if (typeof v === 'object') {
            const o = v as Record<string, unknown>;
            if (typeof o.categoryid === 'number') out.push(o.categoryid);
            else Object.values(o).forEach((x) => visit(x, depth + 1));
        }
    };
    visit(raw, 0);
    return out;
}

/** Pure: a StoreItemCache item -> ConsolidatedMetadata (explicit flags; achievements always false). */
export function metadataFromStoreItem(item: any, steamAppid: number, shortcutAppid: number): ConsolidatedMetadata | null {
    const title = item?.m_strName;
    if (!title) return null;
    const categories: GameCategories = {
        single_player: false,
        multiplayer: false,
        coop: false,
        split_screen: false,
        full_controller: false,
        partial_controller: false,
        achievements: false,
        remote_play_together: false,
    };
    for (const id of categoryIds(item.m_StoreCategories)) {
        const flag = CATEGORY_FLAGS[id];
        if (flag) categories[flag] = true;
    }
    const basic = item.m_BasicInfo ?? {};
    const names = (v: unknown): string[] =>
        (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
    const description = String(basic.short_description ?? '');
    return {
        appid: shortcutAppid,
        title,
        description,
        short_description: description,
        developers: names(basic.developers),
        publishers: names(basic.publishers),
        franchises: [],
        release_date: Number(item.m_ReleaseInfo?.steam_release_date) || 0,
        categories,
        source: 'steam-store',
        steam_appid: steamAppid,
    };
}

/** Hashed asset URLs from `GetAssets()`; the logo has no equivalent, so it falls back to the CDN path. */
export function assetUrlsFromItem(item: any): ArtworkUrls {
    const out: ArtworkUrls = {};
    try {
        const assets = item?.GetAssets?.();
        if (!assets) return out;
        const call = (name: string): string | undefined => {
            try {
                const v = assets[name]?.();
                return typeof v === 'string' && v ? v : undefined;
            } catch {
                return undefined;
            }
        };
        out.portrait = call('GetLibraryCapsuleURL_2x') ?? call('GetLibraryCapsuleURL');
        out.hero = call('GetLibraryHeroURL');
        out.wide = call('GetHeaderURL');
    } catch {
        /* fall back to CDN paths */
    }
    return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Queue the request and poll (Steam loads it asynchronously; ~4 s observed). */
export async function loadStoreItem(steamAppid: number, timeoutMs = 8000): Promise<any | null> {
    const cache = (window as any).StoreItemCache;
    if (!cache?.QueueAppRequest) return null;
    try {
        // Steam already failed to load it (delisted or unknown): go straight to the fallback (P4 H4).
        if (cache.BIsAppMissing?.(steamAppid)) return null;
        if (!cache.BHasApp?.(steamAppid)) {
            cache.QueueAppRequest(steamAppid, {
                include_assets: true,
                include_basic_info: true,
                include_release: true,
                include_full_description: true,
            });
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (cache.BHasApp?.(steamAppid)) {
                const item = cache.GetApp?.(steamAppid);
                if (item?.m_strName) return item;
            }
            await sleep(500);
        }
    } catch {
        /* fall through to the backend fallback */
    }
    return null;
}
