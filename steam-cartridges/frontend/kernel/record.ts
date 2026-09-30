// Kernel: the GameRecord read model (migration plan M1, ADR-0039).
// One record per shortcut. Services fill parts; surfaces read them. get() is a plain
// Map lookup, so it is safe from Steam's hot hooks (plugins.md guardrail 2).
import type { ShortcutId } from "./appid";
import type { EventBus } from "./events";

export type PartStatus = "ok" | "partial" | "unsupported" | "needs-setup" | "error" | "pending";

export interface Part<T> {
    status: PartStatus;
    data?: T;
    /** Which source produced `data` (e.g. "steam-store", "igdb", "local_db"). */
    source?: string;
    /** Unix ms when `data` was fetched from its source. */
    fetchedAt?: number;
    /** Unix ms when freshness was last checked, even if nothing changed. */
    checkedAt?: number;
    /** Shown to the user only for needs-setup / error (ADR-0014). */
    message?: string;
}

export interface Identity {
    native?: { appid: number; source: "manual" | "owned" | "search" };
    web?: { igdb?: number; ra?: number; ss?: number; romHash?: string };
}

/** Player and controller flags from a metadata source (moved from rpc.ts in M3.3, plan § 7.0 D12). */
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

/**
 * Normalized Game Info of one shortcut, as the backend stores it in library_metadata.json
 * (moved from rpc.ts `ConsolidatedMetadata` in M3.3, plan § 7.0 D12; rpc.ts keeps that name).
 */
export interface GameMetadata {
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

/** One achievement of a schema (moved from rpc.ts in M3.5, plan § 7.0 D12). */
export interface AchievementSchemaItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    global_pct: number;
}

/** An app's achievement schema as the backend stores it (moved from rpc.ts in M3.5). */
export interface AchievementSchemaRecord {
    native_appid: number;
    total: number;
    achievements: AchievementSchemaItem[];
    fetched_at?: number;
}

/** When one achievement was unlocked (moved from rpc.ts in M3.5). */
export interface AchievementUnlockRecord {
    unlocked_time: number;
}

/** Artwork URLs per slot (moved from rpc.ts in M3.9, plan § 7.0 D12). */
export interface ArtworkUrls {
    portrait?: string;
    hero?: string;
    logo?: string;
    wide?: string;
    /** The library icon: not a SetCustomArtworkForApp slot, written with SetShortcutIcon (icon plan). */
    icon?: string;
}

/** Field shapes are filled in by the service steps (M4-M7); kept open until then. */
/** A shortcut's achievements as the backend resolves them (`ach_service.lua`, M6a). */
export interface AchievementSet {
    schema: AchievementSchemaRecord;
    unlocks: Record<string, AchievementUnlockRecord>;
}
export type CommunityMedia = Record<string, unknown>;
/** What the backend recorded as written for a shortcut's art (steam_store.json applied_artwork). */
export interface StoreApplied {
    /** Absent for SteamGridDB art (a shortcut with no Steam match). */
    steam_appid?: number;
    source?: string;
    slots: number[];
    /** Slots attempted but not written (retried once per session, P4 H5). */
    failed?: number[];
    /** SteamGridDB: every slot ever attempted, so a slot the user cleared is never refilled. */
    tried?: number[];
    at?: number;
}

/**
 * What the artwork surface writes for one shortcut (M5c): computed by app/artwork.ts from the
 * backend's `artwork` part and the pure art plan. `urls` holds only the slots in `write`.
 */
export interface ArtworkPlan {
    source: "steam-cdn" | "steamgriddb" | "cleared";
    steamAppid?: number;
    urls: ArtworkUrls;
    write: number[];
    clear: number[];
    /** Every slot attempted so far (SteamGridDB only), recorded with the written slots. */
    tried: number[];
    /** Slots already ours (kept), recorded again with the newly written ones. */
    kept: number[];
    /** Distinguishes two otherwise identical plans (a repeated Clear must re-render). */
    at: number;
    /** The shortcut's library icon, when it changes (icon plan). */
    icon?: IconPlan;
}

/**
 * The shortcut's library icon (not an artwork slot): `url` = store that image and point the
 * shortcut at it; `restore` = put back the shortcuts.vdf icon value ours replaced ("" = the exe).
 */
export type IconPlan = { url: string } | { restore: string };

export interface GameRecord {
    appid: ShortcutId;
    gameid: string;
    title: string;
    exe: string;
    route?: { bucket: "steam-store" | "web-scraping" | "none"; via: string };
    identity?: Part<Identity>;
    metadata?: Part<GameMetadata>;
    achievements?: Part<AchievementSet>;
    media?: Part<CommunityMedia>;
    artwork?: Part<ArtworkPlan>;
}

export type RecordPart = "route" | "identity" | "metadata" | "achievements" | "media" | "artwork";

export interface RecordStore {
    get(appid: ShortcutId): GameRecord | undefined;
    /** Create or replace the identity fields of a record, keeping its parts. */
    upsert(base: Pick<GameRecord, "appid" | "gameid" | "title" | "exe">): GameRecord;
    /**
     * Set parts of a record. Emits `record.updated` with only the parts whose value
     * actually changed (compared by JSON), so an unchanged write re-renders nothing
     * (guardrail 17). Returns the changed part names.
     */
    update(appid: ShortcutId, parts: Partial<Pick<GameRecord, RecordPart>>): RecordPart[];
    all(): GameRecord[];
}

export function createRecordStore(bus: EventBus): RecordStore {
    const records = new Map<ShortcutId, GameRecord>();
    return {
        get: (appid) => records.get(appid),
        upsert(base) {
            const prev = records.get(base.appid);
            const next: GameRecord = { ...(prev ?? {}), ...base };
            records.set(base.appid, next);
            return next;
        },
        update(appid, parts) {
            const rec = records.get(appid);
            if (!rec) return [];
            const changed: RecordPart[] = [];
            for (const key of Object.keys(parts) as RecordPart[]) {
                const value = parts[key];
                if (JSON.stringify(rec[key]) === JSON.stringify(value)) continue;
                (rec as any)[key] = value;
                changed.push(key);
            }
            if (changed.length > 0) bus.emit("record.updated", { appid, parts: changed });
            return changed;
        },
        all: () => [...records.values()],
    };
}
