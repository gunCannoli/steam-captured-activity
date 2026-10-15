// Domain: what the Activity feed shows from an app's captures. Pure (type-only imports, `.ts` specifiers), so the
// unit tests run it with node. Steam's objects come in as plain data; nothing here touches Steam.
import { isShortcutAppId } from "../kernel/appid.ts";

/** The fields of a Steam screenshot this plugin reads (`SteamClient.Apps.GetScreenshotsInTimeRange`). */
export interface ScreenshotLike {
    hHandle?: number;
    nCreated: number;
    nWidth: number;
    nHeight: number;
    strCaption?: string;
    strUrl: string;
}

/** The fields of a Steam clip this plugin reads (`CGameRecordingService.GetClips`). */
export interface ClipLike {
    clip_id: string;
    date_clipped?: number;
    date_recorded?: number;
    thumbnail_url: string;
    thumbnail_width?: number;
    thumbnail_height?: number;
}

/**
 * One capture as a card in the feed. The shape is the one the activity cards read (`m_mediaItems` on the event):
 * keep the field names, the jsx patch and Steam's own card components depend on them.
 */
export interface MediaItem {
    /** Unique in Steam's workshop store: `capture_<appid>_<handle>` or `capture_<appid>_clip_<clip id>`. */
    id: string;
    url: string;
    caption: string;
    /** Unix seconds. */
    timestamp: number;
    width: number;
    height: number;
    isClip: boolean;
    rawScreenshot?: unknown;
    rawClip?: unknown;
}

/** The captures of one local day: one "captured" event in the feed. */
export interface CaptureDay {
    /** Unix seconds of the day's start (`dayOf`). */
    day: number;
    /** Newest first. */
    items: MediaItem[];
}

/** Which apps the user wants (the two settings toggles). */
export interface Scope {
    steamGames: boolean;
    nonSteamGames: boolean;
}

/** Is this app covered by the user's settings? */
export function inScope(appid: number, scope: Scope): boolean {
    return isShortcutAppId(appid) ? scope.nonSteamGames : scope.steamGames;
}

export function screenshotItem(appid: number, s: ScreenshotLike): MediaItem {
    return {
        id: `capture_${appid}_${s.hHandle || s.nCreated}`,
        url: s.strUrl,
        caption: s.strCaption || "",
        timestamp: s.nCreated,
        width: s.nWidth,
        height: s.nHeight,
        isClip: false,
        rawScreenshot: s,
    };
}

export function clipItem(appid: number, c: ClipLike): MediaItem {
    return {
        id: `capture_${appid}_clip_${c.clip_id}`,
        url: c.thumbnail_url,
        caption: "Clip",
        timestamp: c.date_clipped || c.date_recorded || 0,
        width: c.thumbnail_width || 1920,
        height: c.thumbnail_height || 1080,
        isClip: true,
        rawClip: c,
    };
}

/**
 * Screenshots and clips grouped by `dayOf(timestamp)`, newest day first and newest capture first within a day.
 * A capture with no time (0) is left out: it has no day to go on.
 */
export function captureDays(
    appid: number,
    screenshots: readonly ScreenshotLike[],
    clips: readonly ClipLike[],
    dayOf: (unixSeconds: number) => number,
): CaptureDay[] {
    const items = [...screenshots.map((s) => screenshotItem(appid, s)), ...clips.map((c) => clipItem(appid, c))]
        .filter((i) => i.timestamp > 0)
        .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
    const byDay = new Map<number, MediaItem[]>();
    for (const item of items) {
        const day = dayOf(item.timestamp);
        const list = byDay.get(day);
        if (list) list.push(item);
        else byDay.set(day, [item]);
    }
    return [...byDay.entries()].sort((a, b) => b[0] - a[0]).map(([day, list]) => ({ day, items: list }));
}

/** What a feed shows, as one string: same signature, nothing to write (guardrail 17.2). */
export function signature(days: readonly CaptureDay[]): string {
    return days.map((d) => `${d.day}:${d.items.map((i) => i.id).join(",")}`).join("|");
}

/** Local midnight of a unix-seconds time, in unix seconds (the day Steam's feed groups by). */
export function localMidnight(unixSeconds: number): number {
    const d = new Date(unixSeconds * 1000);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

/**
 * The apps the sweep re-reads, most recently viewed last. `touch` moves an app to the end and returns the one that
 * fell out (over `max`), whose feed entries the caller removes.
 */
export interface Recent {
    touch(appid: number): number | undefined;
    delete(appid: number): void;
    has(appid: number): boolean;
    list(): number[];
}

export function createRecent(max: number): Recent {
    const order = new Set<number>();
    return {
        touch(appid) {
            order.delete(appid);
            order.add(appid);
            if (order.size <= max) return undefined;
            const oldest = order.values().next().value as number;
            order.delete(oldest);
            return oldest;
        },
        delete: (appid) => void order.delete(appid),
        has: (appid) => order.has(appid),
        list: () => [...order],
    };
}
