import { logger } from "../logger";
import { setting } from "../settings/settings";
import { isNonSteamAppId } from "./route";
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
    type AppActivityStore,
    type SteamClip,
    type SteamScreenshot,
} from "./stores";

const ACTIVITY_TIMESTAMPS_KEY = "steam-cartridges:activity-timestamps";

interface AppActivityTimestamps {
    addedToLibrary?: number;
    firstPlayed?: number;
}

function getActivityTimestamps(appid: number): AppActivityTimestamps {
    try {
        const raw = localStorage.getItem(ACTIVITY_TIMESTAMPS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            return data[appid] || {};
        }
    } catch {
        // ignore
    }
    return {};
}

function saveActivityTimestamps(appid: number, patch: Partial<AppActivityTimestamps>): void {
    try {
        const raw = localStorage.getItem(ACTIVITY_TIMESTAMPS_KEY);
        const data = raw ? JSON.parse(raw) : {};
        data[appid] = { ...data[appid], ...patch };
        localStorage.setItem(ACTIVITY_TIMESTAMPS_KEY, JSON.stringify(data));
    } catch {
        // ignore
    }
}

function getCommunityIconUrl(appid: number, overview: any): string {
    if (overview?.icon_data) {
        const fmt = overview.icon_data_format || "png";
        return overview.icon_data.startsWith("data:")
            ? overview.icon_data
            : `data:image/${fmt};base64,${overview.icon_data}`;
    }
    if (typeof (window as any).SteamClient?.Apps?.RequestIconDataForApp === "function") {
        (window as any).SteamClient.Apps.RequestIconDataForApp(appid);
    }
    return "";
}

function createActivityDay(dayBegin: number): AppActivityDay {
    const eventsList: any[] = [];
    return {
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
                ? this.m_rgEvents[this.m_rgEvents.length - 1].rtEventTime
                : this.m_rtDayBegin;
        },
        SortEvents() {
            this.m_rgEvents.sort(
                (a: any, b: any) => (b.rtEventTime ?? 0) - (a.rtEventTime ?? 0),
            );
        },
        AddEvent(e: any) {
            this.m_rgEvents.push(e);
        },
    };
}

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

/**
 * Shortcut appid -> native appid whose Steam activity (partner events / news,
 * friend events) joins the shortcut's feed (parity plan D). Set by the Steam
 * Store bucket for mapped games only.
 */
const nativeActivitySource = new Map<number, number>();

export function setNativeActivitySource(appid: number, nativeAppid: number | undefined): void {
    if (nativeAppid === undefined) nativeActivitySource.delete(appid);
    else nativeActivitySource.set(appid, nativeAppid);
}

/**
 * Steam's own activity for a native app, as [day key, day] pairs. `GetAppActivity`
 * makes Steam restore its cache and fetch from the server (verified live
 * 2026-09-25: unowned 2820820 returned one partner event, type 1002). A native
 * day's `m_rtDayBegin` is unset, so the key comes from `m_mapActivityByDay`.
 * Polls until Steam stops loading, at most 8 s.
 */
async function nativeActivityDays(nativeAppid: number | undefined): Promise<[number, AppActivityDay][]> {
    const store = appActivityStore() as (AppActivityStore & { m_setAppsLoading?: Set<number>; m_setAppFetchRequested?: Set<number> }) | undefined;
    if (nativeAppid === undefined || !store) return [];
    for (let i = 0; i < 16; i++) {
        const entry = store.GetAppActivity(nativeAppid);
        const busy = store.m_setAppsLoading?.has(nativeAppid) || store.m_setAppFetchRequested?.has(nativeAppid);
        if (entry && !busy) return [...entry.m_mapActivityByDay.entries()];
        await new Promise((r) => setTimeout(r, 500));
    }
    const entry = store.m_mapAppActivity.get(nativeAppid);
    return entry ? [...entry.m_mapActivityByDay.entries()] : [];
}

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
        if (typeof appid === "number" && isNonSteamAppId(appid)) {
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
    const showAdded = setting("activityShowAddedToLibrary") !== false;
    const showFirstPlayed = setting("activityShowFirstPlayed") !== false;

    const [screenshots, clips, nativeDays] = await Promise.all([
        screenshotsSince(appid, 0),
        clipsSince(gameid, 0),
        nativeActivityDays(nativeActivitySource.get(appid)),
    ]);
    if (screenshots.length === 0 && clips.length === 0 && nativeDays.length === 0 && !showAdded && !showFirstPlayed) return 0;

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

    const overview = (window as any).appStore?.GetAppOverviewByAppID?.(appid);
    const displayName = overview?.display_name || "";
    const iconUrl = getCommunityIconUrl(appid, overview);

    // 1. Ensure fake StoreItem exists in StoreItemCache so dt's visibility guard passes
    let fakeApp = storeCache.m_mapApps.get(appid);
    if (!fakeApp) {
        const sampleApp = storeCache.m_mapApps.values().next().value;
        fakeApp = Object.create(
            sampleApp ? Object.getPrototypeOf(sampleApp) : Object.prototype,
        );
        fakeApp.m_unID = fakeApp.m_unAppID = appid;
        fakeApp.m_bVisible = true;
        fakeApp.m_strName = displayName;
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
        fakeApp.BContainDataRequest = () => true;

        storeCache.m_mapApps.set(appid, fakeApp);
        injectedStoreApps.add(appid);
    }
    fakeApp.GetName = () => displayName;
    fakeApp.GetAssets = () => ({ GetCommunityIconURL: () => iconUrl });

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
    const fileIdsForApp: string[] = [];

    for (const [dayBegin, dayMedia] of byDay.entries()) {
        let day: AppActivityDay | undefined =
            appActivity.m_mapActivityByDay.get(dayBegin);
        if (!day) {
            day = createActivityDay(dayBegin);
            appActivity.m_mapActivityByDay.set(dayBegin, day);
        }
        if (!Array.isArray(day.m_rgEvents)) {
            day.m_rgEvents = [];
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
        fakeEvent.BSupportsCommentThreads = () => false;
        fakeEvent.BUserCanDelete = () => false;

        if (day.m_rgEvents?.clear) {
            day.m_rgEvents.clear();
            day.m_rgEvents.push(fakeEvent);
        } else if (Array.isArray(day.m_rgEvents)) {
            day.m_rgEvents.length = 0;
            day.m_rgEvents.push(fakeEvent);
        }
    }

    // Native news and friend events for a mapped shortcut (parity plan D): Steam's
    // own event objects, added to the same local day as our captures.
    let nativeEvents = 0;
    for (const [nativeKey, nativeDay] of nativeDays) {
        const dayBegin = getLocalMidnight(nativeKey);
        let day = appActivity.m_mapActivityByDay.get(dayBegin);
        if (!day) {
            day = createActivityDay(dayBegin);
            appActivity.m_mapActivityByDay.set(dayBegin, day);
        }
        if (!Array.isArray(day.m_rgEvents)) {
            day.m_rgEvents = [];
        }
        for (const event of [...(nativeDay.m_rgEvents ?? [])]) {
            day.m_rgEvents.push(event);
            nativeEvents++;
        }
        day.SortEvents?.();
    }

    // 6. Synthetic native activity events: Added to Library and Played First Time
    let syntheticCount = 0;
    if (showAdded || showFirstPlayed) {
        const storedTimestamps = getActivityTimestamps(appid);
        const mediaTimestamps = mediaItems.map((m) => m.timestamp);
        const earliestMedia = mediaTimestamps.length > 0 ? Math.min(...mediaTimestamps) : undefined;
        const now = Math.floor(Date.now() / 1000);

        let addedTime = storedTimestamps.addedToLibrary;
        if (!addedTime) {
            if (earliestMedia) {
                addedTime = earliestMedia - 3600;
            } else if (overview?.rt_last_time_played && overview.rt_last_time_played > 0) {
                addedTime = overview.rt_last_time_played - 3600;
            } else {
                addedTime = now;
            }
            saveActivityTimestamps(appid, { addedToLibrary: addedTime });
        }

        const hasPlayEvidence = (overview?.minutes_playtime_forever && overview.minutes_playtime_forever > 0) ||
            (overview?.rt_last_time_played && overview.rt_last_time_played > 0) ||
            mediaItems.length > 0;

        let firstPlayedTime = storedTimestamps.firstPlayed;
        if (hasPlayEvidence && !firstPlayedTime) {
            if (overview?.rt_last_time_played && overview.rt_last_time_played > 0) {
                const playtimeSec = (overview.minutes_playtime_forever || 1) * 60;
                firstPlayedTime = overview.rt_last_time_played - playtimeSec;
                if (earliestMedia && earliestMedia < firstPlayedTime) {
                    firstPlayedTime = earliestMedia;
                }
            } else if (earliestMedia) {
                firstPlayedTime = earliestMedia;
            } else {
                firstPlayedTime = addedTime + 60;
            }
            if (firstPlayedTime < addedTime) {
                addedTime = firstPlayedTime - 3600;
                saveActivityTimestamps(appid, { addedToLibrary: addedTime });
            }
            saveActivityTimestamps(appid, { firstPlayed: firstPlayedTime });
        }

        const getOrCreateDay = (time: number): AppActivityDay => {
            const dayBegin = getLocalMidnight(time);
            let day = appActivity.m_mapActivityByDay.get(dayBegin);
            if (!day) {
                day = createActivityDay(dayBegin);
                appActivity.m_mapActivityByDay.set(dayBegin, day);
            }
            if (!Array.isArray(day.m_rgEvents)) {
                day.m_rgEvents = [];
            }
            return day;
        };

        if (showAdded && addedTime) {
            const addedDay = getOrCreateDay(addedTime);
            if (addedDay) {
                const addedEvent = Object.create(V ? V.prototype : Object.prototype);
                addedEvent.eEventType = 3; // ReceivedNewGame
                addedEvent.gameid = appid.toString();
                Object.defineProperty(addedEvent, "appid", {
                    get: () => appid,
                    configurable: true,
                });
                addedEvent.unUniqueID = `added_${appid}_${addedTime}`;
                addedEvent.rtEventTime = addedTime;
                addedEvent.steamIDActor = currentSteamID;
                addedEvent.steamIDTarget = currentSteamID;
                addedEvent.bIsGameActivity = false;
                addedEvent.bIsNonSteam = true;
                addedEvent.BIsValid = () => true;
                addedEvent.GetFilteredAppIds = () => [appid];
                addedEvent.commentThreads = [];
                addedEvent.activeThread = 0;
                addedEvent.GetActiveCommentThread = () => null;
                addedEvent.GetParentalFeature = () => 0;
                addedEvent.BSupportsCommentThreads = () => false;
                addedEvent.BUserCanDelete = () => false;

                addedDay.m_rgEvents.push(addedEvent);
                syntheticCount++;
            }
        }

        if (showFirstPlayed && hasPlayEvidence && firstPlayedTime) {
            const playedDay = getOrCreateDay(firstPlayedTime);
            if (playedDay) {
                const playedEvent = Object.create(V ? V.prototype : Object.prototype);
                playedEvent.eEventType = 30; // PlayedGameFirstTime
                playedEvent.gameid = appid.toString();
                Object.defineProperty(playedEvent, "appid", {
                    get: () => appid,
                    configurable: true,
                });
                playedEvent.unUniqueID = `played_${appid}_${firstPlayedTime}`;
                playedEvent.rtEventTime = firstPlayedTime;
                playedEvent.steamIDActor = currentSteamID;
                playedEvent.steamIDTarget = currentSteamID;
                playedEvent.bIsGameActivity = false;
                playedEvent.bIsNonSteam = true;
                playedEvent.BIsValid = () => true;
                playedEvent.BIsApplicationOrTool = () => false;
                playedEvent.commentThreads = [];
                playedEvent.activeThread = 0;
                playedEvent.GetActiveCommentThread = () => null;
                playedEvent.GetParentalFeature = () => 0;
                playedEvent.BSupportsCommentThreads = () => false;
                playedEvent.BUserCanDelete = () => false;

                playedDay.m_rgEvents.push(playedEvent);
                syntheticCount++;
            }
        }
    }

    // Sort events in each day chronologically descending
    for (const day of appActivity.m_mapActivityByDay.values()) {
        day.SortEvents?.();
        if (Array.isArray(day.m_rgEvents)) {
            day.m_rgEvents.sort((a: any, b: any) => (b.rtEventTime ?? 0) - (a.rtEventTime ?? 0));
        }
    }

    registeredFilesByApp.set(appid, fileIdsForApp);
    logger.info(
        `Published ${mediaItems.length} capture(s) (${screenshots.length} shot(s), ${clips.length} clip(s)), ${nativeEvents} native event(s), and ${syntheticCount} synthetic activity event(s) across ${appActivity.m_mapActivityByDay.size} day(s) in activity feed for ${appid}.`,
    );
    return mediaItems.length + nativeEvents + syntheticCount;
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
