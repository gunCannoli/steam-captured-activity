import { logger } from "../logger";
import {
    appActivityStore,
    clipsSince,
    friendStore,
    screenshotsSince,
    screenshotEventClass,
    storeItemCache,
    workshopStore,
    type AppActivity,
    type AppActivityDay,
    type SteamClip,
    type SteamScreenshot,
} from "./stores";

/**
 * The Per-Day Activity Feed API.
 *
 * Like the Post-Game Summary, we never hand-roll activity DOM. Steam already has
 * `ActivityFeedContainer`, `AppActivityDay`, `EventHeadline`, and `ScreenshotCarousel`
 * (module 80478), and renders them in:
 *   - Desktop: via the `activity` section in LeftColumn (steam/sections.ts)
 *   - Big Picture: via `ae.W` in the native "ACTIVITY" tab
 *
 * For non-Steam games, Steam hides the section by app type and skips activity
 * queries. Upstream event renderers guard on `StoreItemCache.GetStoreItemWithLegacyVisibilityCheck`
 * and resolve media via `workshopStore.GetPublishedFiles`.
 *
 * By injecting a lightweight in-memory StoreItem stub (zero network requests)
 * and populating `workshopStore` with local capture loopback URLs, Steam's genuine
 * components render the dated activity feed, author headline ("X shared 2 screenshots"),
 * interactive carousels, and full-screen viewers natively.
 */

/** File IDs registered in workshopStore for an app, tracked for clean teardown. */
const registeredFilesByApp = new Map<number, string[]>();

/** Apps with fake in-memory StoreItems injected into StoreItemCache. */
const injectedStoreApps = new Set<number>();

/** Compute local midnight in unix seconds for a given timestamp. */
function getLocalMidnight(timestamp: number): number {
    const d = new Date(timestamp * 1000);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

let isStoreCacheHooked = false;

/**
 * Hook StoreItemCache.prototype.BIsAppMissing to ensure non-Steam shortcut appids
 * (>= 0x8000_0000) are never treated as missing/unavailable store items.
 *
 * This provides permanent immunity against negative-cache poisoning
 * (StoreItemCache.m_setUnavailableApps) caused by asynchronous React unmount hooks
 * issuing 404 store requests when navigating between shortcuts and native games.
 */
export function ensureStoreCacheHooked(): boolean {
    if (isStoreCacheHooked) return true;
    const storeCache = storeItemCache();
    if (!storeCache) return false;

    const proto = Object.getPrototypeOf(storeCache);
    if (!proto || typeof proto.BIsAppMissing !== "function") return false;

    isStoreCacheHooked = true;
    const origBIsAppMissing = proto.BIsAppMissing;

    proto.BIsAppMissing = function (appid: number) {
        if (typeof appid === "number" && appid >= 0x8000_0000) {
            return false;
        }
        return origBIsAppMissing.apply(this, arguments);
    };
    logger.info("Installed StoreItemCache.BIsAppMissing shortcut immunity hook.");
    return true;
}

export interface MediaItem {
    id: string;
    url: string;
    caption: string;
    timestamp: number;
    width: number;
    height: number;
    isClip: boolean;
    rawScreenshot?: SteamScreenshot;
    rawClip?: SteamClip;
}

/**
 * Publish an app's captures into Steam's Activity Feed.
 *
 * Returns the number of events/captures published.
 */
export async function publishActivity(
    appid: number,
    gameid: string,
): Promise<number> {
    const [screenshots, clips] = await Promise.all([
        screenshotsSince(appid, 0),
        clipsSince(gameid, 0),
    ]);
    if (screenshots.length === 0 && clips.length === 0) return 0;

    const actStore = appActivityStore();
    const storeCache = storeItemCache();
    const wsStore = workshopStore();
    const fs = friendStore();
    const currentSteamID = fs?.currentUserSteamID;

    if (!actStore || !storeCache || !wsStore || !currentSteamID) {
        logger.warn("Activity feed stores or SteamID not available for", appid);
        return 0;
    }

    // Guarantee that any past negative-cache blacklist entry is purged
    if (storeCache.m_setUnavailableApps?.has(appid)) {
        storeCache.m_setUnavailableApps.delete(appid);
    }
    ensureStoreCacheHooked();

    // 1. Ensure fake StoreItem exists in StoreItemCache so dt's visibility guard passes
    if (!storeCache.m_mapApps.has(appid)) {
        const sampleApp = storeCache.m_mapApps.values().next().value;
        const fakeApp = Object.create(
            sampleApp ? Object.getPrototypeOf(sampleApp) : Object.prototype,
        );
        fakeApp.m_unID = fakeApp.m_unAppID = appid;
        fakeApp.m_bVisible = true;
        fakeApp.m_strName = "";
        fakeApp.m_eItemType = 0;
        fakeApp.m_eAppType = 1;
        fakeApp.m_rgStoreTags = [];
        fakeApp.m_rgStoreTagIDs = [];
        fakeApp.m_DataRequested = {
            include_assets: true,
            include_platforms: true,
            include_release: true,
            include_tag_count: 0,
        };
        fakeApp.BIsVisible = () => true;
        fakeApp.BIsApplicationOrTool = () => false;
        fakeApp.GetName = () => "";
        fakeApp.GetAssets = () => ({ GetCommunityIconURL: () => "" });
        fakeApp.BContainDataRequest = () => true;

        storeCache.m_mapApps.set(appid, fakeApp);
        injectedStoreApps.add(appid);
    }

    // 2. Resolve event class constructor
    const V = screenshotEventClass();

    // 3. Obtain or instantiate CAppActivity
    let appActivity = actStore.m_mapAppActivity.get(appid);
    const sampleEntry = actStore.m_mapAppActivity.values().next().value as
        | AppActivity
        | undefined;
    const CAppActivity = sampleEntry?.constructor as
        | (new (appid: number) => AppActivity)
        | undefined;

    if (!appActivity) {
        if (CAppActivity) {
            appActivity = new CAppActivity(appid);
        } else {
            appActivity = {
                m_unAppID: appid,
                m_mapActivityByDay: new Map(),
                get lastAddedEventType() {
                    const first = this.appActivityByDay?.[0];
                    return first && first.events.length > 0
                        ? first.events[0].eEventType
                        : 0;
                },
                get lastAddedPartnerEvent() {
                    return null;
                },
                BHasEvents() {
                    return this.appActivityByDay.length > 0;
                },
                get appActivityByDay() {
                    return Array.from(this.m_mapActivityByDay.keys())
                        .sort((a, b) => b - a)
                        .map((k) => this.m_mapActivityByDay.get(k)!)
                        .filter((d) => d && d.BHasEvents());
                },
            };
        }
        actStore.m_mapAppActivity.set(appid, appActivity!);
    }
    if (!appActivity) return 0;

    // 4. Combine and group captures by local midnight
    const mediaItems: MediaItem[] = [
        ...screenshots.map((s): MediaItem => ({
            id: `nonsteam_${appid}_${s.hHandle || s.nCreated}`,
            url: s.strUrl,
            caption: s.strCaption || "",
            timestamp: s.nCreated,
            width: s.nWidth,
            height: s.nHeight,
            isClip: false,
            rawScreenshot: s,
        })),
        ...clips.map((c): MediaItem => ({
            id: `nonsteam_${appid}_clip_${c.clip_id}`,
            url: c.thumbnail_url,
            caption: "Clip",
            timestamp: c.date_clipped || c.date_recorded,
            width: c.thumbnail_width || 1920,
            height: c.thumbnail_height || 1080,
            isClip: true,
            rawClip: c,
        })),
    ].sort((a, b) => b.timestamp - a.timestamp);

    const byDay = new Map<number, MediaItem[]>();
    for (const item of mediaItems) {
        const day = getLocalMidnight(item.timestamp);
        let list = byDay.get(day);
        if (!list) {
            list = [];
            byDay.set(day, list);
        }
        list.push(item);
    }

    appActivity.m_mapActivityByDay.clear();
    const sampleDay = sampleEntry?.appActivityByDay?.[0];
    const CDay = sampleDay?.constructor as
        | (new () => AppActivityDay)
        | undefined;
    const fileIdsForApp: string[] = [];

    for (const [dayBegin, dayMedia] of byDay.entries()) {
        let day: AppActivityDay | undefined =
            appActivity.m_mapActivityByDay.get(dayBegin);
        if (!day) {
            if (CDay) {
                const createdDay = new CDay();
                createdDay.m_rtDayBegin = dayBegin;
                day = createdDay;
            } else {
                const eventsList: any[] = [];
                day = {
                    m_rtDayBegin: dayBegin,
                    get dayBegin() {
                        return this.m_rtDayBegin;
                    },
                    set dayBegin(v: number) {
                        this.m_rtDayBegin = v;
                    },
                    m_rgEvents: eventsList,
                    get events() {
                        return this.m_rgEvents.filter((e: any) => e.BIsValid());
                    },
                    BHasEvents() {
                        return this.events.length > 0;
                    },
                    get isValid() {
                        return this.events.length > 0;
                    },
                    GetLatestEventTime() {
                        return this.m_rgEvents.length
                            ? this.m_rgEvents[0].rtEventTime
                            : this.m_rtDayBegin;
                    },
                    GetEarliestEventTime() {
                        return this.m_rgEvents.length
                            ? this.m_rgEvents[this.m_rgEvents.length - 1]
                                  .rtEventTime
                            : this.m_rtDayBegin;
                    },
                    SortEvents() {
                        this.m_rgEvents.sort(
                            (a: any, b: any) => b.rtEventTime - a.rtEventTime,
                        );
                    },
                    AddEvent(e: any) {
                        this.m_rgEvents.push(e);
                    },
                };
            }
            appActivity.m_mapActivityByDay.set(dayBegin, day!);
        }

        if (!day) continue;

        const dayFileIds: string[] = [];
        for (const item of dayMedia) {
            dayFileIds.push(item.id);
            fileIdsForApp.push(item.id);

            wsStore.m_mapPublishedFiles.set(item.id, {
                file: {
                    publishedfileid: item.id,
                    file_url: item.url,
                    preview_url: item.url,
                    file_description: item.caption,
                    visibility: 0,
                    creator: currentSteamID.ConvertTo64BitString(),
                    time_created: item.timestamp,
                    image_width: item.width,
                    image_height: item.height,
                },
            });
        }

        // 5. Construct native screenshot event (type 13: FilePublished_Screenshot)
        const fakeEvent = Object.create(V ? V.prototype : Object.prototype);
        fakeEvent.m_rgScreenshots = dayFileIds;
        fakeEvent.m_bIsValid = true;
        fakeEvent.unUniqueID = dayFileIds[0];
        fakeEvent.rtEventTime = dayMedia[0]?.timestamp ?? 0;
        fakeEvent.steamIDActor = currentSteamID;
        fakeEvent.steamIDTarget = currentSteamID;
        fakeEvent.eEventType = 13; // FilePublished_Screenshot
        fakeEvent.bIsGameActivity = false;
        fakeEvent.bIsNonSteam = true;
        fakeEvent.m_mediaItems = dayMedia;
        fakeEvent.commentThreads = [];
        fakeEvent.activeThread = 0;
        // Base class getter defines Number(this.gameid), which overflows for 64-bit shortcut ids.
        // Explicitly set 32-bit appid and string gameid.
        fakeEvent.gameid = appid.toString();
        Object.defineProperty(fakeEvent, "appid", {
            get: () => appid,
            configurable: true,
        });
        fakeEvent.BIsValid = () => true;
        fakeEvent.GetCurrentPublishedFileID = () =>
            dayFileIds[fakeEvent.activeThread || 0] || dayFileIds[0];
        fakeEvent.SetActiveCommentThread = (idx: number) => {
            fakeEvent.activeThread = idx;
        };
        fakeEvent.GetActiveCommentThread = () => null;
        fakeEvent.GetParentalFeature = () => 0;

        if (day.m_rgEvents?.clear) {
            day.m_rgEvents.clear();
            day.m_rgEvents.push(fakeEvent);
        } else if (Array.isArray(day.m_rgEvents)) {
            day.m_rgEvents.length = 0;
            day.m_rgEvents.push(fakeEvent);
        }
    }

    registeredFilesByApp.set(appid, fileIdsForApp);
    logger.info(
        `Published ${mediaItems.length} capture(s) (${screenshots.length} shot(s), ${clips.length} clip(s)) across ${byDay.size} day(s) in activity feed for ${appid}.`,
    );
    return mediaItems.length;
}

/** Drop an app's activity feed entries and associated fake store/workshop records. */
export function clearActivity(appid: number): void {
    const actStore = appActivityStore();
    if (actStore) {
        actStore.m_mapAppActivity.delete(appid);
    }

    // Retain in-memory stub in StoreItemCache.m_mapApps!
    // In-memory stubs consume negligible RAM (~150 bytes) and must persist indefinitely.
    // Deleting them triggers asynchronous 404 store requests from unmounting hooks,
    // permanently blacklisting the appid in StoreItemCache.m_setUnavailableApps.
    injectedStoreApps.delete(appid);

    const fileIds = registeredFilesByApp.get(appid);
    if (fileIds) {
        const wsStore = workshopStore();
        if (wsStore) {
            for (const fileId of fileIds) {
                wsStore.m_mapPublishedFiles.delete(fileId);
            }
        }
        registeredFilesByApp.delete(appid);
    }
}
