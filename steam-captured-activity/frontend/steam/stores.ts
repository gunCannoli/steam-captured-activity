import { resolveClass, resolveService, resolveSingleton } from "./modules";

/**
 * Typed bindings onto Steam's own stores and services: the ones the Activity feed reads. A trimmed copy of
 * steam-cartridges' steam/stores.ts (plugins never import each other); every shape was read off the live client, see
 * docs/steam-components.md. Resolution is by prototype signature only, never by module id.
 */

/** One entry of `SteamClient.Apps.GetScreenshotsInTimeRange`. */
export interface SteamScreenshot {
    nAppID: number;
    strGameID: string;
    hHandle: number;
    nWidth: number;
    nHeight: number;
    nCreated: number;
    ePrivacy: number;
    strCaption: string;
    bSpoilers: boolean;
    /** Absolute `https://steamloopback.host/...` URL. Steam serves this itself. */
    strUrl: string;
    bUploaded: boolean;
    ugcHandle: string;
    publishedFileID: string;
}

/** One clip, as `CGameRecordingService.GetClips` returns it. */
export interface SteamClip {
    clip_id: string;
    game_id: string;
    duration_ms: string;
    date_recorded: number;
    start_timeline_id: string;
    start_offset_ms: string;
    file_size: string;
    date_clipped: number;
    temporary: boolean;
    thumbnail_url: string;
    thumbnail_width: number;
    thumbnail_height: number;
}

/** The section registry component that decides which sections a page shows. */
export interface AppDetailsSections {
    prototype: {
        GetSections(overview: unknown, details: unknown): Set<string>;
        m_setSectionsMemo?: Set<string>;
    };
}

/** A service notification as Steam hands it to a handler; the handler answers an EResult (1 = OK). */
export interface RecordingNotification {
    Body(): { toObject(): Record<string, any> };
}
type NotificationHandler = (msg: RecordingNotification) => number;

/** Steam's game-recording CM service. */
interface GameRecordingService {
    GetClips(request: { game_id: string; created_after: number }): Promise<{
        Body(): { clip(): Array<{ toObject(): SteamClip }> | undefined };
    }>;
    /** `GameRecording.NotifyClipCreated#1`: `{ summary: <a clip, as GetClips lists it> }`. */
    RegisterForNotifyClipCreated?(handler: NotificationHandler): { unregister(): void } | null;
    /** `GameRecording.NotifyClipDeleted#1`: `{ clip_id, game_id }` (CGameRecording_ClipDeleted_Notification). */
    RegisterForNotifyClipDeleted?(handler: NotificationHandler): { unregister(): void } | null;
}

/** One day's worth of activity feed events. */
export interface AppActivityDay {
    m_rtDayBegin?: number;
    m_rgEvents: any;
    events?: any[];
    BHasEvents?(): boolean;
    SortEvents?(): void;
}

/** Per-app activity state (Steam's CAppActivity). */
export interface AppActivity {
    m_unAppID: number;
    m_bNoMoreHistoryAvailable?: boolean;
    m_mapActivityByDay: Map<number, AppActivityDay>;
    appActivityByDay?: AppActivityDay[];
}

/** Steam's `CAppActivityStore` singleton. */
export interface AppActivityStore {
    m_mapAppActivity: Map<number, AppActivity>;
    /** Apps whose server fetch is in flight; FetchLatestActivity returns at once for an app in it. */
    m_setAppFetchRequested?: Set<number>;
    GetAppActivity(appid: number): AppActivity | undefined;
    RestoreActivity(appid: number): Promise<void>;
}

/** Steam's in-memory `StoreItemCache` singleton. */
export interface StoreItemCache {
    m_mapApps: Map<number, any>;
    m_setUnavailableApps?: Set<number>;
    BIsAppMissing?(appid: number): boolean;
}

/** One published file record in Steam's workshop store. */
export interface PublishedFileRecord {
    publishedfileid: string;
    file_url: string;
    preview_url: string;
    file_description: string;
    visibility: number;
    creator: string;
    time_created?: number;
    image_width?: number;
    image_height?: number;
}

/** Steam's `CWorkshopStore` singleton. */
export interface WorkshopStore {
    m_mapPublishedFiles: Map<string, { file?: PublishedFileRecord }>;
}

/** Steam's `CSteamID` shape. */
export interface SteamID {
    ConvertTo64BitString(): string;
}

/** Steam's `CFriendStore` singleton. */
export interface FriendStore {
    currentUserSteamID?: SteamID;
}

/** The app-details sections component: `GetSections` paired with the scroll-seek and registration methods. */
export function appDetailsSections(): AppDetailsSections | undefined {
    return resolveClass<AppDetailsSections>("CAppDetailsSections", ["GetSections", "SeekToSection", "RegisterSection"]);
}

/** The game-recording service; `GetAndTrimPostGameHighlights` tells it from other modules with a `GetClips`. */
function gameRecordingService(): GameRecordingService | undefined {
    return resolveService<GameRecordingService>("CGameRecordingService", ["GetClips", "GetAndTrimPostGameHighlights"]);
}

export function appActivityStore(): AppActivityStore | undefined {
    const globalStore = Reflect.get(globalThis, "appActivityStore") as AppActivityStore | undefined;
    if (globalStore) return globalStore;
    return resolveSingleton<AppActivityStore>("CAppActivityStore", ["GetAppActivity", "RestoreActivity"]);
}

export function storeItemCache(): StoreItemCache | undefined {
    const globalCache = Reflect.get(globalThis, "StoreItemCache") as StoreItemCache | undefined;
    if (globalCache) return globalCache;
    return resolveSingleton<StoreItemCache>("StoreItemCache", ["GetStoreItemWithLegacyVisibilityCheck"]);
}

export function workshopStore(): WorkshopStore | undefined {
    const globalWs = Reflect.get(globalThis, "workshopStore") as WorkshopStore | undefined;
    if (globalWs) return globalWs;
    return resolveSingleton<WorkshopStore>("CWorkshopStore", ["GetPublishedFiles"]);
}

export function friendStore(): FriendStore | undefined {
    const globalFs = Reflect.get(globalThis, "friendStore") as FriendStore | undefined;
    if (globalFs) return globalFs;
    return resolveSingleton<FriendStore>("CFriendStore", ["currentUserSteamID", "GetFriendState"]);
}

/** The constructor of Steam's screenshot activity event (`V` in module 12750). */
export function screenshotEventClass(): any | undefined {
    return resolveClass<any>("CScreenshotEvent", ["AddScreenshot", "GetCurrentPublishedFileID"]);
}

/** `GetScreenshotsInTimeRange` returns at most this many, the newest first (measured live 2026-10-07: 100 of 152). */
const SCREENSHOT_PAGE = 100;
/** Pages read per app at most, so a sweep stays bounded (2,000 screenshots). */
const MAX_SCREENSHOT_PAGES = 20;

/**
 * Screenshots Steam indexed for this app, keyed by the 32-bit appid for Steam games and shortcuts alike, with
 * loopback URLs Steam serves itself. A deleted screenshot is gone from this list (Steam's own index). Steam answers
 * a page of the newest SCREENSHOT_PAGE; the next page is the range ending just before the oldest one.
 */
export async function screenshotsOf(appid: number): Promise<SteamScreenshot[]> {
    const apps = (Reflect.get(globalThis, "SteamClient") as unknown as { Apps?: Record<string, unknown> } | undefined)?.Apps;
    const fn = apps?.GetScreenshotsInTimeRange as ((appid: number, start: number, end: number) => Promise<SteamScreenshot[]>) | undefined;
    if (typeof fn !== "function") return [];
    const all: SteamScreenshot[] = [];
    try {
        let end = 0; // 0: no upper bound
        for (let page = 0; page < MAX_SCREENSHOT_PAGES; page++) {
            const list = (await fn.call(apps, appid, 0, end)) ?? [];
            all.push(...list);
            if (list.length < SCREENSHOT_PAGE) break;
            const oldest = Math.min(...list.map((s) => s.nCreated));
            if (!(oldest > 1)) break;
            end = oldest - 1;
        }
    } catch {
        /* what was read so far */
    }
    return all;
}

/**
 * Clips Steam recorded for this game. Takes the clip game id (kernel/appid clipGameId): Steam's own helper truncates
 * a shortcut's 64-bit gameid, which is why its feed finds no clips for non-Steam games.
 */
export async function clipsOf(gameid: string): Promise<SteamClip[]> {
    const service = gameRecordingService();
    if (!service) return [];
    try {
        const response = await service.GetClips({ game_id: gameid, created_after: 0 });
        return (response.Body().clip() ?? []).map((c) => c.toObject());
    } catch {
        return [];
    }
}

/** What Steam says when a screenshot is taken or deleted (`SteamClient.GameSessions.RegisterForScreenshotNotification`). */
export interface ScreenshotNotification {
    strOperation: "started" | "written" | "deleted" | string;
    unAppID: number;
    hScreenshot?: number;
}

/**
 * Steam's own capture events, the ones its spotlight store and media view listen to (verified 2026-10-07 in Steam's
 * source: modules 12750 and 65528 register the screenshot notification, 57622 and 2773 the clip ones; several
 * listeners are normal). Each `on*` returns an unregister function, or undefined when Steam has no such API.
 */
export const captureEvents = {
    onScreenshot(fn: (n: ScreenshotNotification) => void): (() => void) | undefined {
        const sessions = (Reflect.get(globalThis, "SteamClient") as any)?.GameSessions;
        const reg = sessions?.RegisterForScreenshotNotification;
        if (typeof reg !== "function") return undefined;
        const handle = reg.call(sessions, fn);
        return () => handle?.unregister?.();
    },
    onClipCreated(fn: (body: Record<string, any>) => void): (() => void) | undefined {
        return onClip("RegisterForNotifyClipCreated", fn);
    },
    onClipDeleted(fn: (body: Record<string, any>) => void): (() => void) | undefined {
        return onClip("RegisterForNotifyClipDeleted", fn);
    },
};

function onClip(
    name: "RegisterForNotifyClipCreated" | "RegisterForNotifyClipDeleted",
    fn: (body: Record<string, any>) => void,
): (() => void) | undefined {
    const service = gameRecordingService();
    const reg = service?.[name];
    if (typeof reg !== "function") return undefined;
    const handle = reg.call(service, (msg: RecordingNotification) => {
        try {
            fn(msg.Body().toObject());
        } catch {
            /* a listener never breaks Steam's dispatch */
        }
        return 1; // EResult OK, as Steam's own handlers answer
    });
    return handle ? () => handle.unregister() : undefined;
}
