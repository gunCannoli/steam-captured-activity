# Steam components — how Steam's UI is really built

**This doc's job:** the deep reference for what Steam's client actually does —
the app detail page's section registry, the Post-Game Summary and Activity
stores, Big Picture's portal architecture, and the achievement, notification,
recording and artwork subsystems. It answers one question: _what does Steam
already do, so that we can call it instead of imitating it?_

Everything here was **read out of the live Steam client** over CEF devtools
(from 2026-09-20): module factories pulled from `webpackChunksteamui`, stores
poked with real appids, DOM verified on screen. No inference from screenshots.

It opens with the **map** (runtime topology, which store owns what, and every
stable resolution signature — start there), then the deep traces.

Not here: how to inspect the client yourself ([steam-debug.md](steam-debug.md));
the rules for plugin code that touches any of this ([plugins.md](plugins.md));
the index of all docs ([README.md](README.md)).

> **Numeric module ids and minified names in this doc are one build's
> breadcrumbs** — how the code was read, not how to resolve it. Production code
> resolves by signature ([§ Map: stable resolution signatures](#map-stable-resolution-signatures)).

---

## Map: runtime topology

Steam's web frontend runs as a multi-target Chromium Embedded Framework (CEF) application:

```
SharedJSContext (Single Runtime Truth)
  ├── Global Stores: appSpotlightStore, appActivityStore, StoreItemCache, NotificationStore
  ├── React Portals & Section Patches
  ├── Background Services & Timelines
  │
  ├──► Desktop Window  (SP Desktop_...)  ── renders standard desktop UI
  ├──► Big Picture     (SP BPM_...)      ── renders Gamepad UI (ports into SharedJSContext)
  └──► Toast / menu popups               ── about:blank portals, also rendered from SharedJSContext
```

- **`SharedJSContext`:** Every store, MobX observable, and background service lives here. When modifying data or registering React Portals, do so in `SharedJSContext`.
- **Desktop vs. Big Picture:** Both run off the same JavaScript runtime in `SharedJSContext`. Big Picture is simply a fullscreen popup window rendering Gamepad UI components ([§ Big Picture Mode](#big-picture-mode)).
- **Not every popup is tracked.** Most windows register with `g_PopupManager`; BrowserView popups (Quick Access, main menu, Big Picture's toast window) do not ([plugins.md guardrail 12](plugins.md#12-popup-hooks-do-not-see-every-window)).
- **AppId Representation & Signedness:** Steam's CEF runtime represents shortcut `overview.appid` values $> \text{0x7FFFFFFF}$ as signed 32-bit integers (e.g. `3858889198` appears as `-436078098`). Normalization with `(appid >>> 0)` is strictly required across all Map/Set caches, store queries, and routing comparisons ([knowledgebase.md § The two identifiers](knowledgebase.md#the-two-identifiers)).

---

## Map: core stores & modules

Module ids are one build's breadcrumbs; resolve by § 3.

| Feature Area            | Module / Store                                    | Key Methods & Properties                                                                           | Purpose in Plugins                                                                                                 | Deep dive |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| **App Detail Sections** | `CAppDetailsSections`                             | `prototype.GetSections(overview, details)`                                                         | Section registry. Filtered by `BIsModOrShortcut()`. Re-enable `"postgamesummary"`, `"activity"`, `"achievements"`. | [skeleton](#the-app-detail-page-skeleton) |
| **Post-Game Summary**   | `CAppSpotlightStore` (`window.appSpotlightStore`) | `GetOrCreateAppData(appid).m_session`, `PushSessionEvent`, `AddAchievement`, `AddClip`             | Populates the top hero summary card with screenshots, clips, and achievements.                                     | [summary](#post-game-summary) |
| **Activity Feed**       | `appActivityStore`                                | `GetAppActivity(appid)`, `appActivityByDay`, `CActivityDay.prototype.AddEvent`                     | Populates chronological per-day activity feed cards.                                                               | [activity](#activity-feed) |
| **Store Item Cache**    | `StoreItemCache` (`window.StoreItemCache`)        | `m_mapApps.set(appid, stubApp)`, `GetStoreItem(appid)`                                             | In-memory stubbing to satisfy Steam's `storeApp.BIsVisible()` event guard without network requests.                | [blocker](#the-store-record-blocker) |
| **Native Achievements** | `AppDetailsStore`                                 | `GetAchievements(appid)`, `GetAppData(appid).details.achievements`                                 | Populates the native desktop achievement sidebar (`HighlightDiv`, percentage bar, locked list).                    | [achievements](#native-achievement-ui--backing-store) |
| **Play Bar Progress**   | `appAchievementProgressCache`                     | `m_achievementProgress.mapCache.get(appid)`                                                        | Supplies `{ unlocked, total }` counts displayed under the Big Picture Play button.                                 | [achievements](#native-achievement-ui--backing-store) |
| **Notification Engine** | `window.NotificationStore`                        | `OnNotification(id, type, pbData)`, `ChooseSound`, `PlayNotificationSound`                         | Dispatches genuine native toasts, sounds, and animations (`CAchievementNotification`).                             | [notifications](#achievement-notifications-notificationstore) |
| **Game Recording RPCs** | `CGameRecordingService` (resolve by signature, not module id) | `GetClips`, `GameRecording.SaveClip#1`, `UserAddTimelineEntry#1`, `TakeScreenshot#1` (frame from already-recorded video, not a live grab) | Reads clips; inserts timeline markers, creates instant replay clips, triggers timeline screenshots. `SteamClient.Screenshots.*` is read/manage only — nothing under `SteamClient.*` triggers a live capture. | [recording](#game-recording-rpcs--timeline-markers) |
| **Live recording store** | `window.g_GRS` (`CGameRecordingStore`)           | `m_mapActiveTimelines`, loader `BIsTimelineRunning`/`GetRunningTimelineDurationMS`/`GetGameID`/`GetTimelineStartBeforeGlobalZeroMS`, `m_mapRunningTimelines` | Per-game running timelines and live recording state; read fresh every time, never cached. | [recording](#game-recording-rpcs--timeline-markers) |
| **Recording Timeline**  | `TimelineManager` (module `22588`)                | `AddEventToTimeline`, `AddUserMarker`, `InsertEntryIntoTimelineSorted`                             | Client-side timeline state and clip name generator.                                                                | — |
| **Custom Artwork**      | `SteamClient.Apps`                                | `SetCustomArtworkForApp(appid, base64, ext, type)`                                                 | Sets portrait (0), hero (1), logo (2), and wide capsule (3) artwork directly.                                      | [artwork](#custom-artwork-api) |
| **Gamepad Tabbed Page** | `GamepadTabbedPage`                               | Intercept `props.tabs` via `react/jsx-runtime`                                                     | Injects custom tabs (e.g. RetroAchievements, Game Info) into Big Picture's tab bar.                                | [tabs](#tab-construction--custom-tab-injection) |
| **Gamepad Components**  | Gamepad UI Library                                | `<Focusable>`, `DialogButton`, `<Carousel>`, `showModal`                                           | Native Big Picture UI building blocks with automatic controller navigation.                                        | [navigation](#gamepad-navigation-system) |
| **AppOverview Model**   | `AppOverview.prototype`                           | `GetGameID()`, `BIsModOrShortcut()`, `BHasStoreCategory()`, `m_gameid`, `rt_original_release_date` | Fundamental per-app data model. **Never hook `BIsModOrShortcut` on prototype** — breaks `GetIconURLForApp` and shortcut icons. Use scoped props proxy inside component `k` ([guardrail 1](plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid)). | — |
| **Shortcut Icons**      | `SteamClient.Apps` / `GetIconURLForApp`           | `RequestIconDataForApp(appid)`, `app.icon_data`, `app.icon_data_format`                             | Steam lazy-loads shortcut icons via `RequestIconDataForApp`. Requires `e.BIsModOrShortcut() === true`. | [plugins](plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid) |
| **App Overview Lookup** | `appStore.GetAppOverviewByAppID(appid)`           | Returns `null` for any unowned app — normal, not a bug. Called unguarded by Steam's own Friends module (module 2326) and used (correctly) by `Navigator.App`'s early-return. **Multiple callers, one method — a patch for one can silently break another.** | [pitfalls](knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all) · [m_mapApps trap](knowledgebase.md#appstorem_mapapps-is-the-global-enumerated-backing-store-for-the-entire-library--never-write-into-it) |
| **Game Info Container** | Module `15448` (`G` & `k`)                        | `onCollapseStarted`, `onCollapseComplete`, `setBoxHeight`, `descriptionsData`, `associationData`   | Renders native summary capsule, description, developer/publisher credits, release date, and category badges. Requires on-demand synchronous enrichment in `k.prototype.render` before paint to avoid `#AppDetails_Shortcut_Explanation` ("Detailed information is unavailable"). | [game info](#game-info-tab--metadata) |
| **Community & Workshop**| `CWorkshopStore` (`m_mapPublishedFiles`); Community Content loader (module `77163`, class `ae`) | `m_mapPublishedFiles`, `GetPublishedFileDetails`; `LoadCommunityContentAndVotes(appid, page)` | Workshop store: published file records (our activity cards write it). The Community Content section is **not** fed from it: its loader fetches `library/appcommunityfeed/<appid>` itself.  | [community](#community-media--workshop-store) |
| **Your Stuff Media**    | Module `57150` (`Ae.E`)                           | `listSource: { type: "app", gameid: overview.gameid }`                                             | Renders Big Picture "YOUR STUFF" media section (screenshots & clips). Requires 64-bit composed ID `m_gameid`.      | [guardrail 1](plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid) |

### When Steam fills each achievement store for an owned game

A plugin that feeds a store for a shortcut fills it at the same moment Steam fills it for an owned game (ADR-0045).
Verified live 2026-09-30.

| Store | Filled for an owned game | steam-cartridges for a shortcut |
| --- | --- | --- |
| `appAchievementProgressCache` | At start-up, after login, from `librarycache/achievement_progress.json` (`Init` → `LoadCacheFile`, which **replaces** `m_achievementProgress`); refreshed from the server when an entry's `cache_time` is older than `rt_last_time_played`; the whole map is saved back (`SaveCacheFile`) after each refresh | After each replacement of the map (`sensors/progress-cache`) and on every record change |
| `AppDetailsStore.GetAchievements` | On request (`RequestAchievements`) | On request (the hook answers from the surface's map) |
| `AchievementsFullStore` | On request (`LoadMyAchievements`) | On request (the hooks answer from the surface's map) |

---

## Map: stable resolution signatures

> Added by P0: `window.collectionStore` (`userCollections`, `GetCollectionListForAppID`) and `window.StoreItemCache` (`QueueAppRequest`, `GetApp`); see steam-components.md "Collections" and "Store item data".

Numeric webpack module ids reshuffle between Steam client builds; real
`prototype` method names and CSS class-map keys survive minification. In plugin
code, resolve with the SDK — `findModuleExport` for classes and singletons,
`findClassModule` for CSS maps — resolve **once** at startup and cache
([guardrail 3](plugins.md#3-single-pass-webpack-module-pre-caching)). For a
one-off probe in DevTools, use the module-cache walk in
[steam-debug.md § 3](steam-debug.md#3-the-inspection-method). Prefer a `window`
global where Steam exposes one.

| Target                        | Stable signature (all methods on `prototype` unless noted)                                            | Used in |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------- |
| `CAppSpotlightStore`          | `GetPostGameSummary` + `StopShowingGamePlaySpotlight` + `GetOrCreateAppData` (or `window.appSpotlightStore`) | `non-steam-games-activity/frontend/steam/stores.ts` |
| `CAppDetailsSections`         | `GetSections` + `SeekToSection` + `RegisterSection`                                                   | `stores.ts` |
| `CAppActivityStore`           | `window.appActivityStore`, else `GetAppActivity` + `RestoreActivity`                                   | `stores.ts` |
| `StoreItemCache`              | `window.StoreItemCache`, else `GetStoreItemWithLegacyVisibilityCheck`                                 | `stores.ts` |
| `CGameRecordingService`       | `GetClips` + `GetAndTrimPostGameHighlights` (several modules expose `GetClips`)                       | `stores.ts` |
| `AppDetailsStore`             | `GetAchievements` + `GetAssociations`                                                                 | — (Phase 5) |
| Game Info container (`G`)     | `onCollapseStarted` + `onCollapseComplete` + `setBoxHeight`                                           | `steamgriddb-artwork/frontend/steam/game-info-patch.ts` |
| `Pageable` (summary pager)    | `OnUpdateArrows` + `ScrollToFirstChild` + `onCloseButtonClicked`                                      | — (Steam renders it now) |
| `Carousel` (summary scroller) | `BindScrollingContainer` + `UpdateScrollArrows` + `ScheduleUpdateScrollArrows`                        | — (Steam renders it now) |
| `NotificationStore` & toasts  | `window.NotificationStore`; dispatcher, eTypes and toast windows per [§ Resolution signatures & toast windows](#resolution-signatures--toast-windows) | `enhanced-notifications` |
| Post-Game Summary styles      | class-map probe key `GamePlaySummaryContainer` (the page spans four CSS modules: [list](#rendered-dom-and-css-modules)) | `non-steam-games-activity/frontend/index.tsx` |
| Activity feed styles          | class-map probe key `AppActivityDay` / `AppActivityDate`                                              | `stores.ts`, `activity.ts` |
| Big Picture toast placeholder | class-map probe key `GamepadToastPlaceholder`                                                         | `enhanced-notifications/frontend/steam/selectors.ts` |
| App-page links bar / Friends / Community Content / partner event overlay | factory-source needles, one module each ([table](#resolution-signatures-one-module-each-on-this-build)) | `steam-cartridges` `features/steam-store/native-sections.ts` (parity plan C, H) — **before patching `appStore.GetAppOverviewByAppID`'s return value for this section, read [knowledgebase.md's multi-caller pitfall](knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all) first** |
| Window `Navigator` (`App`, `SteamWeb`, `AppProperties`, …) | `SteamUIStore.WindowStore.SteamUIWindows[i].Navigator` (a plain object per window) | parity plan G · `App()` early-returns on `appStore.GetAppOverviewByAppID` being null ([steam-components.md](#navigatorapp-module-874)) — a second, independent consumer of the same method as the Friends section above |
| Steam URL ids (`GameHub`, `HelpAppPage`, `StoreAppPage`, …) | `window.urlStore.ResolveURL(id, appid)` | parity gate check 15 |
| Game Info feature badges → store category ids | module with `n$` + the `#AppDetails_Feature_*` table ([mapping](#store-categories-and-feature-badges)) | `features/game-info/category-policy.ts` |
| `CWorkshopStore`              | `m_mapPublishedFiles` (keyed by published file id) or `window.WorkshopStore`                         | `surfaces/captures` (activity cards) |
| Community Content loader (`ae`, not exported) | the section class `oe`: jsx element with `{ appid, labelId }` whose prototype has `BindInnerContainer`, `AutoLoadAdditionalContent`, `CheckAndLoadInitialContent`; its `m_loader`'s prototype | `surfaces/community` (features plan F2) |
| Steam's Play (launch)         | `SteamClient.Apps.RunGame(gameid, "", -1, launchSource)`: an own, writable, configurable property, looked up at call time by the library Play action (with its Big Picture branch) and the game list; the return value is ignored. Wrapping it holds a launch (verified live 2026-10-03, launch-tracking plan E8). A `steam://rungameid` or desktop-shortcut launch does not pass through it | `steam-cartridges-third-party/frontend/epic-launcher.ts` (ADR-0067) |

The store singletons are long-lived MobX objects: resolve once and cache.

---

## TL;DR — the finding that matters

Steam's Post-Game Summary and Activity sections **are not missing for non-Steam
games. They are switched off by a one-line app-type filter.**

```js
// module 59856, CAppDetailsSections.GetSections()
e.BIsModOrShortcut() && (s = n); // n = ["nonsteam", "notes", "screenshots"]
```

For a shortcut, Steam replaces the full 18-section list with a 3-section list.
`postgamesummary` and `activity` are dropped before rendering — not because the
data is absent, but because the section registry filters on app type.

Both backing stores work **perfectly well** with a non-Steam appid. Probed live:

| Store call, appid `4263274102` (AM2R) | Result                                    |
| ------------------------------------- | ----------------------------------------- |
| `GetOrCreateAppData(appid)`           | ✅ real `CAppData`, real `m_session`      |
| `m_session.PushSessionEvent({...})`   | ✅ accepted                               |
| `GetPostGameSummary(appid)`           | ✅ returns the session once it has events |
| `yX.GetAppActivity(appid)`            | ✅ real object, `appActivityByDay: []`    |

**Verified end to end:** patching `GetSections` to re-add the two sections and
pushing one synthetic screenshot event made Steam render its own
`GamePlaySummaryContainer`, `GamePlaySummaryHeader`, `SummaryContainer` and
`SummaryContainerChildren` on AM2R's page — native pager, native close button,
native "Sep 20" date header, native card sizing and clip badge. Zero markup of
ours. Screenshot confirmed on screen, then reverted.

So the shape of the plugin should be:

```
our backend data  ─►  Steam's own stores  ─►  Steam's own components
```

not

```
our backend data  ─►  our components that look like Steam's
```

---

## The app detail page skeleton

Module `59856` is the composition root. Exports: `N_` (the sections component,
holds `GetSections`), `AC`, `UL`.

### The section registry

`GetSections(overview, details)` returns a `Set<string>`. Three candidate lists:

```js
// full list — normal games
s = [
    "info",
    "spotlightdlc",
    "spotlightreview",
    "postgamesummary",
    "friends",
    "achievements",
    "notes",
    "cards",
    "dlc",
    "screenshots",
    "review",
    "activity",
    "activityrollup",
    "community",
    "additionalcontent",
    "mastersubincluded",
    "timedtrialbanner",
    "playtestinvites",
];

// app_type == E6 || P_ (application / tool)
i = [
    "info",
    "spotlightdemo",
    "friends",
    "achievements",
    "notes",
    "cards",
    "dlc",
    "screenshots",
    "review",
    "activity",
    "activityrollup",
    "playtestinvites",
];

// BIsModOrShortcut()  ← non-Steam games land here
n = ["nonsteam", "notes", "screenshots"];
```

Then conditionally added: `workshop`, `offline` (offline mode), `controller`
(when controllers are connected). Big Picture (`LAUNCHER_TYPE`) filters out
`community`.

Results are memoised in `this.m_setSectionsMemo`, compared **by size only** —
so a patch that swaps members without changing the count can be ignored. Set the
memo explicitly when patching.

### Column layout

`render()` places each section into one of three columns:

| Column                                                                                               | Sections, in render order                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Spotlights` (top, spans; moves to left column when `rightPanelWidth >= SpotlightBreakToLeftColumn`) | `timedtrialbanner`, `spotlightdlc`, `playtestinvites`, `spotlightreview`, **`postgamesummary`**, `spotlightdemo`                                    |
| `RightColumn`                                                                                        | `controller`, `mastersubincluded`, `friends`, **`additionalcontent`**, `achievements`, `notes`, `cards`, `dlc`, `workshop`, `screenshots`, `review` |
| `LeftColumn`                                                                                         | `nonsteam`, `offline`, `activityrollup`, **`activity`**, `community`                                                                                |

Every right/left-column section is wrapped in `ue` (exported as `UL`) which
registers it for scroll-seeking, inside an error boundary `c.tH`. The
`postgamesummary` spotlight is **not** wrapped — it renders bare.

This explains the on-screen geometry: the summary is a wide panel above, the
activity feed is the left column below it, and "Recordings and screenshots" /
"Notes" sit in the narrow right column.

---

## Post-Game Summary

Module `53074`, export `T`. Styles: module `68854`.

### Data flow

```
CAppSpotlightStore (module 74827, export Ri)   ← singleton, MobX
   └─ m_mapAppData : Map<appid, CAppData>
        └─ m_session          : CGamePlaySession
        └─ m_postGameSummary  : CGamePlaySession | null
```

The component is two functions deep:

```js
function v({ details }) {
    const summary = useMemo(() => Ri.GetPostGameSummary(details.unAppID));
    return summary ? <M details={details} summary={summary} /> : null;
}
```

`GetPostGameSummary` is trivial — the gate is entirely upstream:

```js
GetPostGameSummary(e) { return this.GetOrCreateAppData(e).m_postGameSummary }

async UpdatePostGameSummaryForApp_Internal(e) {
  e.m_bLoadedPreviousSessionData || await this.LoadPreviousSessionData(e);
  e.m_postGameSummary = e.m_session.HasSessionEvents() ? e.m_session : null;
}
```

So: **`m_postGameSummary` is just `m_session` when it has events.** For a
shortcut, `LoadPreviousSessionData` finds nothing, so it stays `null`.

### `CGamePlaySession` — the injection surface

Read verbatim off the live class:

```js
class CGamePlaySession {
  m_rgSessionEvents = [];                    // MobX observable
  PushSessionEvent(e)                        // keeps recordingHighlights last
  BAddScreenshotNotification(e)              // handles "written" / "deleted"
  AddAchievement(e)                          // only if e.achievement.bAchieved
  AddTradingCard(e)
  AddClip(e)                                 // dedupes on clip_id
  RemoveClip(clipId)
  SetRecordingHighlights(e)                  // [] removes the highlights event
  GetSessionEvents()  ClearSessionEvents()  HasSessionEvents()
}
```

`PushSessionEvent` has one ordering rule: it pulls any existing
`m_recordingHighlights` event out and re-appends it after the new event, so
highlights always sort last.

### The session event union

A session event is a **plain object with exactly one populated key**:

```ts
type SessionEvent =
    | { m_screenshot: Screenshot }
    | { m_clip: Clip }
    | { m_recordingHighlights: Highlight[] }
    | { m_achievement: { achievement: Achievement } }
    | { m_tradingCard: TradingCard };
```

Real payloads captured live:

```jsonc
// m_screenshot  (Bloodstained, appid 692850)
{
  "nAppID": 692850, "strGameID": "692850", "hHandle": 583,
  "nWidth": 3840, "nHeight": 2160, "nCreated": 1789773563,
  "ePrivacy": 2, "strCaption": "", "bSpoilers": false,
  "strUrl": "https://steamloopback.host/screenshots/692850/screenshots/20260918201923_1.jpg",
  "bUploaded": false, "ugcHandle": "18446744073709551615", "publishedFileID": "0"
}

// m_clip  (Divinity: Original Sin 2, appid 435150)
{
  "clip_id": "clip_435150_20260919_164525", "game_id": "435150",
  "duration_ms": "5562", "date_recorded": 1789836319,
  "start_timeline_id": "timeline_43515020260919_164501",
  "start_offset_ms": "18129", "file_size": "12359219",
  "date_clipped": 1789836325,
  "thumbnail_url": "https://steamloopback.host/gamerecordings/clips/clip_435150_20260919_164525/thumbnail.jpg",
  "thumbnail_width": 1920, "thumbnail_height": 1080, "temporary": false
}
```

Note `strUrl` and `thumbnail_url` are **`steamloopback.host` URLs that Steam
itself serves** from `userdata` and `gamerecordings`. This is a different route
from the one an earlier base64-over-RPC design avoided
([ADR-0017](decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)):
that ADR found _this plugin's own_ paths unservable through
`steamloopback.host`, but these are _Steam's own_ objects with _Steam's own_
URLs, already resolved this way — no base64, confirmed shipped in
`steam/stores.ts`.

### Render algorithm

The builder walks `GetSessionEvents()` **backwards** (newest first) and emits a
flat list into a carousel. Per event it derives four things: a `Date`, a React
key, the child element, and a _type token_ (`l.vu5` screenshot, `l.DJE` clip,
`l.qhh` highlights, `l.ocM` achievement, `l.UkI` trading card).

Separator rules, exactly:

- `bSameDay = isSameDay(prevDate, thisDate)` (`41180.JD`)
- **New day** → push `EventDaySeparator` (a vertical rule), and the next item
  renders its date header.
- **Same day** → push `TypeSeparator`; it gets the `SpaceOnly` modifier when the
  two adjacent types are "compatible", where compatible means _same type, or
  both are media_ (screenshot / clip / highlights). So media items sit in one
  run with only spacing between them, while a media→achievement boundary draws
  a visible divider.
- Consecutive same-day achievements are **paired**: two achievements collapse
  into one `SummaryAchievementStack` (max 2).
- `bShort` starts `true` and is cleared by any non-single-achievement event; it
  drives the `GamePlaySummaryShort` class (a shorter panel for an
  achievements-only summary).

Date header (`F` → `j`): `includeHeader` is `!bSameDay`, and the label is
`46108._l(unixSeconds)` — Steam's relative formatter, which yields
`#Time_Today`, `#Time_Yesterday`, a same-year date like `Sep 20`, or a full date
across years. **This is the answer to "Today / Yesterday / 24 October": one
shared helper, not per-call formatting.**

### Element tree

```jsx
<Focusable className={GamePlaySummaryContainer + (bShort && GamePlaySummaryShort)}>
  <SomeWrapper>                                  {/* 55116.q */}
    <Pageable.Zz>                                {/* 34461.Zz */}
      {bShort && <div className={GamePlaySummaryHeader}>#AppSpotlight_PostGameSummary</div>}
      <CollapsibleSection                        {/* 4584.C */}
        name="#AppSpotlight_PostGameSummary"
        bNoHeader={bShort} customheader={header}
        bShowCloseButton onCloseButtonClicked={() => Ri.StopShowingGamePlaySpotlight(appid)}
        buttonSize="small" headerPadding="0px 8px 0px 0px">
        {(ref, fnUpdateArrows) => (
          <Carousel                              {/* 26271.Q */}
            className={SummaryCarouselContainer}
            leftMargin={32} edgeMask="none"
            ref={ref} fnUpdateArrows={fnUpdateArrows}
            fnRenderScrollingDiv={...SummaryCarouselScrollingContainer}>
            {children}
            <div className={ForcedCarouselPadding} data-carousel="ignore" />
          </Carousel>
        )}
      </CollapsibleSection>
    </Pageable.Zz>
  </SomeWrapper>
</Focusable>
```

`data-carousel="ignore"` marks separators and padding so the carousel does not
treat them as pageable items — the plugin's own carousel work must honour this.

### Leaf renderers

| Event        | Component                                                      | Module  |
| ------------ | -------------------------------------------------------------- | ------- |
| screenshot   | `u.R` with `screenshot={3499.Bo(raw)}`, `sizeAxis="height"`    | `21597` |
| clip         | `$d` — `PostGameSummaryClip`, opens `Media.Clip({state:{id}})` | `17110` |
| highlights   | `$B`                                                           | `17110` |
| achievement  | `57665.hs` — `featured showStats`                              | `57665` |
| trading card | `22165.dI` — `cardScale={1.1}`                                 | `22165` |

`3499.Bo` is the adapter that turns a raw `m_screenshot` into the shape the
screenshot component wants — worth reusing rather than reconstructing.

### Class keys (module `68854`)

```
GamePlaySummaryContainer  GamePlaySummaryHeader  GamePlaySummaryEvents
GamePlaySummaryShort      SummaryContainer       SummaryContainerChildren
SummaryScreenshot         SummaryTradingCard     SummaryAchievementStack
SummaryAchievement        SummaryAchievementIcon EventCarousel
ForcedCarouselPadding     EventHeaderBlock       EventDaySeparator
SummaryCarouselContainer  SummaryCarouselScrollingContainer
```


### Reading captures through Steam's own APIs

Steam already indexes non-Steam captures. Both calls work unmodified for a
shortcut and return absolute `steamloopback.host` URLs Steam serves itself, so no
image crosses the RPC boundary:

```js
await SteamClient.Apps.GetScreenshotsInTimeRange(appid, since, 0); // 32-bit appid
await service.GetClips({ game_id: gameid, created_after: since }); // 64-bit gameid
```

**Steam's own gameid helper truncates to 32 bits.** `bY(4263274102)` returns
`1861238`, not `18310622842007322624`. That single bug is why non-Steam clips
never appear natively — the service is willing, Steam just asks about the wrong
game. Compose the gameid yourself
([knowledgebase.md § The two identifiers](knowledgebase.md#the-two-identifiers)).

The core feeds `m_session` via `BAddScreenshotNotification` / `AddClip`, oldest
first, then sets `m_postGameSummary`; Steam renders the rest.

### Rendered DOM and CSS modules

Captured with `outerHTML` on native pages (Divinity: Original Sin 2, `435150`;
Fields of Mistria for the pager). Readable halves of the class pairs only —
Steam ships e.g. `KniunRMLsSnzOWTG-tq81 PostGameSummaryClip Panel`.

```
PageableContainer.Panel
├─ HeaderPageControls
│  ├─ GamePlaySummaryHeader              -- "Post-Game Summary" (CSS uppercases it)
│  └─ PageClickContainer
│     ├─ PageLeft.Small [.Disabled]      -- arrow SVG, scaleX(-1)
│     ├─ PageRight.Small [.Disabled]
│     └─ PageableCloseButton.Small       -- the "X"
└─ BoxCarousel.SummaryCarouselContainer
   └─ BoxCarouselContents.SummaryCarouselScrollingContainer   -- display:flex, row
      └─ [role=list] (display:contents)
         ├─ [role=listitem].SummaryContainer        -- ONE per tile, not per day
         │  ├─ EventHeaderBlock                     -- "Today" on a day's first tile only
         │  └─ SummaryContainerChildren             -- exactly one tile
         │     └─ [role=button].PostGameSummaryClip.Panel  style="aspect-ratio: 1.77778 / 1"
         │        ├─ img.ClipThumbnail
         │        └─ CornerContent > DurationText.Clip  (Steam's clip SVG + "0:06")
         ├─ div.TypeSeparator.SpaceOnly [data-carousel="ignore"]
         ├─ [role=listitem].SummaryContainer
         │  └─ … [role=button].SummaryScreenshot.ClickableScreenshot.Panel
         │        ├─ img.ClickableScreenshotImg.UseHeight
         │        └─ ScreenshotShareIcon (hover)
         └─ … ForcedCarouselPadding [data-carousel="ignore"]
```

- Header, pager arrows and close button share one `HeaderPageControls` row,
  sibling of the carousel inside one `PageableContainer`.
- Tiles size fluidly by inline `aspect-ratio` (16:9), not fixed pixels.
- `.Disabled` on the arrows is a class Steam toggles from scroll position.

The page's classes come from **four separate CSS modules** — found by searching
the module cache for each class name, not guessed:

| Probe key                  | Also exports                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SummaryCarouselContainer` | `SummaryCarouselScrollingContainer`, `GamePlaySummaryHeader`, `SummaryContainer`, `SummaryContainerChildren`, `SummaryScreenshot`, `EventHeaderBlock`, `TypeSeparator`, `ForcedCarouselPadding` |
| `PageableContainer`        | `HeaderPageControls`, `PageClickContainer`, `PageLeft`, `PageRight`, `PageableCloseButton`, `Disabled`, `Small`                                                                                 |
| `PostGameSummaryClip`      | `ClipThumbnail`, `CornerContent`, `DurationText`                                                                                                                                                |
| `ClickableScreenshotImg`   | `ClickableScreenshot`, `ScreenshotShareIcon`, `UseWidth`, `UseHeight`                                                                                                                           |

Several values are already two-token strings (`PageableContainer.Small ===
"_3qlJ0L41KQFqUTzVQKFERC Small"`). Why both facts matter for plugin code:
[plugins.md § Rules that apply on every rung](plugins.md#rules-that-apply-on-every-rung).

### Pageable and Carousel — the real summary pager

`@steambrew/client`'s exported `Carousel` is a virtualizer and is **not** what the
summary uses. The real pair is unexported:

- **`Pageable`** (module `4584`, export `C`) renders `PageableContainer` →
  `HeaderPageControls` → `PageableContent`. Its `children` is a **render-prop**,
  `(ref, fnUpdateArrows) => ReactNode`. It owns `bLeftArrowEnabled` /
  `bRightArrowEnabled` and renders the arrows **only when at least one is true** —
  which is why a one-row summary shows no arrows at all.
- **`Carousel`** (module `26271`, export `Q`) — a `ResizeObserver` re-checks
  overflow; `UpdateScrollArrows` computes left (`scrollLeft >= 1`) and right
  (`scrollLeft + clientWidth < scrollWidth`) and reports via `fnUpdateArrows`;
  `ScrollLeft`/`ScrollRight` scroll to the next tile not fully visible (not a
  fixed amount); children with `data-carousel="ignore"` are skipped; it animates
  `scrollLeft` by hand ([knowledgebase.md § CEF no-ops](knowledgebase.md#steams-embedded-cef-two-silent-no-ops)).

Two easy misreadings of `Pageable`'s props:

- `name` alone (no `customheader`) renders Pageable's own generic `Name`+`Rule`
  header, not the summary's `GamePlaySummaryHeader` div. Native always passes
  `customheader`.
- `bNoHeader` gates the **entire** header div, `customheader` included. Native
  sets it only for an achievements-only ("short") summary. Media-tile content
  always wants `bNoHeader={false}`.

The pager chevron (module `50376`) takes `singlearrow` (skips the second
`<polyline>` of its default double chevron) and `angle={0|180}`.

The usage is the [element tree](#element-tree) above.

---

## Activity feed

Module `80478`. Styles: module `17076`. Store: module `12750`, export `yX`.

**This one is network-backed, and that is the key difference from the summary.**

```js
useEffect(() => {
    hasSteamConnection && setTimeout(() => yX.FetchLatestActivity(appid), 500);
});
const activity = yX.GetAppActivity(appid);
const days = activity?.appActivityByDay;
```

`CAppActivityStore` prototype: `FetchLatestActivity`, `FetchLatestActivityFromServer`,
`FetchActivityHistory`, `GetAppActivity`, `RestoreActivity`, …

Confirmed live: Bloodstained returns **40 days**; AM2R returns a valid store
object with **0 days**. The server has nothing to say about a shortcut, and
never will.

**Mount order and progressive reveal (verified live 2026-09-24, desktop, 4 A→B→A cycles).**
`GetAppActivity(appid)` with no map entry calls `RequestRestoreActivity` → `RestoreActivity`:
`await RestoreCachedActivity` (a MobX flow; it only `set`s when the local cache has events, which a
shortcut never has), then `m_mapAppActivity.set(appid, new CAppActivity(appid))` plus a server fetch. The core's
`clearActivity` deletes the entry on navigation away, so on every return Steam creates the empty
entry first (`0` days, fetch requested). `publishActivity` then fills **that same object**, about 0.3 to 1.2 s
later. On every visit the store ended at 3 days for AM2R. The component renders
`appActivityByDay.slice(0, nDaysToDisplay)`. `ShowMoreContent()` raises `nDaysToDisplay` **one day
at a time**, so the DOM shows 1 day, then 2, several hundred ms after the store is full. Compare the
store, not DOM day counts ([plugins.md guardrail 15](plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour)).

### Structure

```
CAppActivity
  m_mapActivityByDay
  appActivityByDay : CActivityDay[]     // computed, newest first
  m_bNoMoreHistoryAvailable

CActivityDay
  m_rtDayBegin                          // unix seconds, midnight local
  m_rgEvents : CActivityEvent[]         // MobX observable array
  get events() { return this.m_rgEvents.filter(e => e.BIsValid() &&
                        !BIsFeatureBlocked(e.GetParentalFeature())) }
  get isValid()                         // true if ANY event BIsValid()
  AddEvent(e) { this.m_rgEvents.push(e) }     // ← plain push, no validation
  AddScreenshotEvent / AddVideoEvent / AddAchievementEvent / AddUserStatusEvent
  AddRecommendedGameEvent / AddReceivedGameEvent / AddWishlistedGameEvent
  AddPartnerEvent / AddSteamTradingCardEvent / RemoveEvent
  SortEvents() { sort by rtEventTime DESC }
```

### The event base class

All events extend one base (`E` in module `12750`):

```js
gameid  unUniqueID  rtEventTime  steamIDActor  steamIDTarget
eEventType  eEventSubType  eGameActivityType  bIsGameActivity
commentThreads  activeThread

InitFromUserNewsEvent(eType, gameid, rtTime, actor, target)
InitFromGameActivity(eActivityType, eSubType, gameid, rtTime, actor)
get appid() { return Number(this.gameid) }
BIsValid() { return true }             // overridden per subclass
GetParentalFeature() { ... }           // own content vs. others'
GetHeadline() { return "#AppActivity_..." }
```

Subclasses seen live: achievements (`eEventType: 2`), partner events
(`eEventType: 1002`), screenshots (`V`, valid iff `m_bIsValid`), videos (`H`),
trading cards, recommendations, received/wishlisted games, user status.

### The store-record blocker

**✅ Verified live.** Every event needs a store record.

Feeding this feed is not merely hard, it is **closed** for a non-Steam game, and
the reason is upstream of the event data entirely.

Steam's per-event renderer (module `80478`) opens with:

```js
const [p] = lt(i, D.A.k_DataRequest_Assets);   // i = event.appid
...
if (i && (!p || !p.BIsVisible())) return null;
```

`lt` is a direct **store** lookup — no fallback, no local path. A non-Steam game
has no store record at all:

| `GetApp(appid)`         | Result                          |
| ----------------------- | ------------------------------- |
| `692850` (Bloodstained) | record, `BIsVisible() === true` |
| `4263274102` (AM2R)     | **nothing**                     |

So the guard fires for **every event type**, and no amount of correct event data
gets past it.

**Verified end to end.** Restoring `activity` and pushing a valid event into a
real `CActivityDay` produced Steam's real ACTIVITY section, with a correct
`Yesterday` heading, a `Rule` divider and `Load More Activity` — and an empty
`<div></div>` where the event body belongs. The event itself was fine:
`BIsValid() === true`, actor matching the current user, `day.events.length === 1`,
`day.isValid === true`. It is the store lookup that kills it.

Two event types were checked specifically, in case one avoided the guard:

- `PlayedGameFirstTime` — also renders a game capsule (`ot`) whose first line is
  `if (!r) return null` on the same store record. Doubly blocked.
- `AchievementUnlocked` — its achievement list renders purely from
  `event.achievements`, needing no store data, so it _would_ work if the outer
  guard let it through. It does not.

### How the store-record blocker was cleared

**✅ Verified live & shipped.**

The guard was cleared by satisfying Steam's store cache directly in memory, with no network path:

```js
GetStoreItem(id, type) { ... return map.get(id) }   // pure map read, no fetch
BIsVisible()           { return this.m_bVisible }   // plain boolean field
BHasStoreItem(id,t,r)  { return map.has(id) && map.get(id).BContainDataRequest(r) }
```

And because the React hook only calls `QueueStoreItemRequest` when `BHasStoreItem` is
false, an in-memory stub that satisfies it guarantees **no network request is ever made**.

The implementation in `frontend/steam/activity.ts` resolves four specific runtime traps:

1. **In-Memory Store Item Stubbing:**
   Constructed via `Object.create(Object.getPrototypeOf(templateApp))` (or fallback object),
   setting `m_unID = m_unAppID = appid`, `m_bVisible = true`, `m_strName = name`, and:

    ```js
    fake.m_DataRequested = {
        include_assets: true,
        include_platforms: true,
        include_release: true,
        include_tag_count: 0,
    };
    storeItemCache.m_mapApps.set(appid, fake);
    ```

2. **The AppID Bitwidth / IEEE 754 Precision Trap:**
   Event base class `E` (module `12750`) defines:

    ```js
    get appid() { return Number(this.gameid); }
    ```

    For a non-Steam game, `gameid` is 64-bit (`(appid << 32) | 0x02000000`). JavaScript `Number()`
    loses integer precision above $2^{53} - 1$, turning e.g. AM2R's `18310622842007322624` into
    `18310622842007323000`. When `lt()` queries `StoreItemCache` using that corrupted float, it
    misses the cache and returns `undefined`.
    **Fix:** Explicitly set `event.gameid = appid.toString()` and define an explicit property getter:

    ```js
    Object.defineProperty(event, "appid", {
        get: () => appid,
        configurable: true,
    });
    ```

3. **The `GetLatestEventTime` Contract on `CActivityDay`:**
   Module `80478` (`st` / `Sr`) calls `day.GetLatestEventTime()` to build the React component key
   and header timestamp (`V._l(day.GetLatestEventTime(), true)`). If missing from a custom day
   fallback, React crashes with `TypeError: e.GetLatestEventTime is not a function`.
   **Fix:** Custom day objects must implement `GetLatestEventTime()`, `GetEarliestEventTime()`,
   `SortEvents()`, and `BHasEvents()`.

4. **Workshop Store Preview Resolution:**
   The screenshot carousel component queries `workshopStore.GetPublishedFileRecord(publishedFileId)`.
   Injecting records into `workshopStore.m_mapPublishedFiles` with `m_strPreviewUrl = strUrl`
   supplies Steam's loopback screenshot URLs directly into the native viewer.

**Verified end to end (Desktop & Big Picture Mode):**

- AM2R (4 screenshots across 2 dates): Renders native cards `"cannoliGun shared 2 screenshots"` on
  Sep 20 and Oct 24, 2025, active loopback previews, carousel thumbnails, and "Load More Activity".
- Controller D-pad navigation functions seamlessly in Big Picture Mode's "ACTIVITY" tab.
- Empty case (ActRaiser, 0 captures): Keeps Steam's honest disclaimer box cleanly without errors.
- Teardown: `clearActivity(appid)` clears the day records on navigation away but **keeps** the `StoreItemCache` stub — deleting it poisons Steam's negative cache ([plugins.md guardrail 5](plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization)).

Achievement data for non-Steam games comes from providers
([ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)); where Steam renders it is
[§ Achievements, notifications, recording & artwork](#achievements-notifications-recording--artwork).

### Achievement events for a shortcut (verified live 2026-10-02, ADR-0056)

Steam's achievement event is class `P` in module 12750 (found by the source string `m_rtOldestAchievement`), **not
exported**: only the screenshot class `hO` is. It is built only inside the day class's `AddAchievementEvent`:

```js
class P extends E {
  m_rgAchievements = []; m_rtOldestAchievement = undefined;
  constructor(rtTime, steamIDActor, gameid) { super(); this.InitFromUserNewsEvent(AchievementUnlocked /* 2 */, gameid, rtTime, steamIDActor) }
  AddAchievement(a, rtUnlocked) { /* push {...a, rtUnlocked, bAchieved: true}; keep the oldest time; comment thread "<oldest>","2" */ }
  get achievements() { return this.m_rgAchievements }
}
// a live entry of m_rgAchievements: { strName, strDescription, strImage, flAchieved, strID, rtUnlocked, bAchieved }
```

An object on `E`'s prototype (`Object.getPrototypeOf(hO.prototype)`, `steam/stores.activityEventBase()`) with P's fields
renders as Steam's own card for a shortcut: "SEPTEMBER 26 · cannoliGun achieved All Exits · 100% clear the game" with
the RetroAchievements badge (Super Mario World, 2713503983). **The feed re-renders only on a new object:** the activity
section keeps the `CAppActivity` it mounted with; `forceUpdate` on its components did nothing, and mutating the object's
day map did nothing, but `appActivityStore.m_mapAppActivity.set(appid, newObject)` (a MobX observable map) updated the
open feed within 2 s. So `captures` builds a new object on each publish and sets it only when the feed changed.

### Why we cannot feed the _stock_ screenshot/video events

```js
async AddScreenshotEvent(e, t) {
  ...
  await n.AddScreenshot(e.publishedfileid())   // ← published UGC id
}
```

`AddScreenshotEvent` and `AddVideoEvent` resolve **`publishedfileid`** — a
Steam Workshop/UGC handle obtained by uploading. Local captures from a non-Steam
game have no such id (`publishedFileID: "0"`). These two entry points are
therefore closed to us.

`AddEvent(e)` is not. It is an unguarded `push`, and the only contract an event
must satisfy to survive the `events` getter is:

- `BIsValid()` → `true`
- `GetParentalFeature()` → a feature enum the parental filter accepts
- `rtEventTime` (number) for `SortEvents`
- `gameid`, `unUniqueID`, `eEventType` for rendering/keys

That is a small, stable contract we can implement.

### Day labels

Same helper as the summary: `46108._l`, giving `#Time_Today`, `#Time_Yesterday`,
`Sep 20`, or a full date. The heading element is `AppActivityDate` inside
`AppActivityDay` (class module `17076`).

### Localisation tokens

The activity feed's vocabulary is entirely `#AppActivity_*` — these are the
**social/community** feed strings (`PostedScreenshot`, `PostedVideo`, `Achieved`,
`Achieved_PlusMore`, `PlayedGameFirstTime`, `ReceivedNewGame`, `RecommendedGame`,
`AddedGameToWishlist`, `SteamTradingCards_*`, `NoActivity`, `EndofFeed`,
`FetchMore`, comment/rating strings, …). Full list in the scratchpad probe.

Notably `#AppActivity_PlayedGameFirstTime` is the "played X for the first time"
line, and `#AppActivity_NoActivity` is the empty state.

---

## Additional content

Module `59856`, renders when `vecMusicAlbums.length || strManualURL`:

```js
return t.vecMusicAlbums.length || t.strManualURL ? (
    <Section label="#AppDetails_SectionTitle_AdditionalContent">
        {t.strManualURL && <Manual overview={r} details={t} />}
        ...
    </Section>
) : null;
```

The manual item (the Divinity 2 case) uses class keys `AdditionalItem` +
`Manual`, label `#AppDetails_AdditionalContent_GameManual`, and resolves the
URL through `f.jb(details.strManualURL)`.

Both inputs come from `details` (`CAppDetails`). A non-Steam game has neither, so
this section is genuinely empty for us — **unless** we populate `strManualURL`
on the details object, which is the same data-patching trick as everything else
here. Lower priority than the two main sections.

---

## Section title inventory

Every section title Steam defines, from the loc tokens
(`#AppDetails_SectionTitle_*`):

```
Achievements  Activity  AdditionalContent  CloudStatus  Community  Controller
DLC  DiskSpaceRequired  Friends  Friends_Software  GameNotes  Hardware
IncludedWith  LastLaunched  LastPlayed  Links  Media  Media_BPM  OfflineMode
OpenFriends  PlayTime  PlayTimeLeft  Screenshots  SelectedBeta  SignIn
TradingCards  Updates  UsageTime  Workshop
```

And the tabs (`#AppDetails_Tab_*`), which are what Big Picture routes to:

```
Achievements  Activity  Community  Controller  DLC  Friends  GameInfo
Information  Reviews  Screenshots  Settings  TradingCards  WhatsNew
Workshop  YourStuff
```

---

## The simulate hooks

`CAppSpotlightStore` ships test affordances, useful for development:

```
BSimulateSummaryFakeAchievement   SimulatePressSummary
SimulateSummaryClear              SimulateSummaryForceNewDay
SimulateNewDLC
```

`SimulateSummaryForceNewDay` in particular exercises the day-separator path
without waiting for midnight.

---

## Big Picture Mode

The earlier assumption (ADR-0023, ADR-0024) that Big Picture runs as a separate JavaScript bundle with an unreachable module cache and store was **proven false** (ADR-0029). Big Picture runs in the **exact same JavaScript runtime as Desktop (`SharedJSContext`)**, rendering through a multi-window React Portal. As a result, **the exact same store-feeding and section-restoration technique used on Desktop (ADR-0022) works out of the box in Big Picture Mode** — no hand-built clone markup or DOM injection needed.

How to switch modes and inspect the Big Picture target: [steam-debug.md](steam-debug.md#4-big-picture-mode-gamepad-ui-quirks--traps).

### The multi-window React portal architecture

Steam's client uses a multi-window design centered around a single headless frame:

| Window / Target              | What it is                                                            | JavaScript Environment                                                                                    |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **`SharedJSContext`**        | The client's central engine (`https://steamloopback.host/index.html`) | Runs the full JavaScript bundle: `library.js`, `sp.js` (chunk `3714`), MobX stores, React tree            |
| **`Steam Big Picture Mode`** | The visible gamepad window (`about:blank?createflags=...`)            | An empty popup window containing only `<div id="popup_target"></div>`. **Loads zero scripts of its own.** |

#### The "Separate Bundle" Trap Explained

Inspecting the `Steam Big Picture Mode` target directly via DevTools initially showed:

```js
// Evaluated inside the "Steam Big Picture Mode" target:
typeof window.webpackChunksteamui; // "undefined"
typeof window.appStore; // "undefined"
typeof window.Millennium; // "undefined"
typeof window.SteamClient; // "object" (native Chromium bridge)
```

This led an earlier pass (ADR-0023) to infer that Big Picture was a separate bundle with an isolated module cache. **That was an artifact of where the query was run.** The popup window has no `<script>` tags and defines no globals.

Instead, Steam's main React application running inside `SharedJSContext` opens the popup window via `PopupManager` and renders the entire Gamepad UI into it using:

```jsx
ReactDOM.createPortal(
    <GamepadUIRoot />,
    popupWindow.document.getElementById("popup_target"),
);
```

#### The fiber proof

**✅ Verified live.**

Comparing the React Fiber root in `SharedJSContext` with the rendered elements inside the Big Picture popup proved they are the **same React tree**:

- `SharedJSContext` `#root`: `__reactContainer$2x6thximn4h`, `_reactListeningwb7s4ax711`
- `Steam Big Picture Mode` `#popup_target`: `__reactFiber$2x6thximn4h`, `_reactListeningwb7s4ax711`

The Fiber suffix (`2x6thximn4h`) is generated once per React instance at startup. Because both windows share the identical suffix, **all Big Picture React components run in `SharedJSContext`**.

Webpack chunk `3714` (`sp.js`, the Big Picture entry point) pushes directly into `self.webpackChunksteamui` in `SharedJSContext`. Every store (`appSpotlightStore`, `appActivityStore`, `appDetailsStore`, `appStore`) is a live singleton in `SharedJSContext`.

---

### How Big Picture builds the app detail page

Big Picture's app detail page is composed of several layered components spanning modules `18057`, `40478`, `59856`, and `3375`:

```
x.BV.Library.App.Root()  (/library/app/:appid, module 18057)
 └─ Xd.xA (module 40478)
      └─ L (React.Component: calls p.H.RegisterForAppData, m.O.FetchDataForApp, Ri.EnterAppDetailsPage)
           └─ Hp (module 3375)
                └─ re.AC.Provider value={Xe}  (CAppDetailsSectionsContext, module 59856.AC)
                     └─ Xd.kg (module 40478, export E)
                          └─ T.N_ (CAppDetailsSections, module 59856 export N_)
                               ├─ GetSections(overview, details)  ← SHARED SECTION REGISTRY
                               └─ de (consumes useContext(re.AC) → renders Xe)
                                    └─ Xe (module 3375: AppDetailsRoot)
                                         └─ it (module 3375: Gamepad Tab Strip)
                                              ├─ WhatsNew ("ACTIVITY" tab)  → at()
                                              ├─ YourStuff ("YOUR STUFF" tab) → ot()
                                              ├─ Community ("COMMUNITY" tab)  → lt()
                                              └─ GameInfo ("GAME INFO" tab)   → ct()
```

#### Step-by-Step Breakdown

1. **Route & Data Loading (Module `40478`):**
   When navigating to `/library/app/:appid`, component `L` mounts. It registers for app data and invokes:

    ```js
    A.Ri.EnterAppDetailsPage(this.props.appid); // Ri = CAppSpotlightStore
    ```

    When unmounting, it invokes:

    ```js
    A.Ri.ExitAppDetailsPage(this.props.appid);
    ```

2. **Context Switching (`CAppDetailsSectionsContext`, Module `59856.AC`):**
   Module `3375` defines `Hp`:

    ```js
    function Hp(overview, details) {
        return (
            <re.AC.Provider value={Xe}>
                <Xd.kg
                    overview={overview}
                    details={details}
                    LaunchingDetails={Ju.rp}
                />
            </re.AC.Provider>
        );
    }
    ```

    `re.AC` is `CAppDetailsSectionsContext`.
    - On **Desktop**, `re.AC` takes its default value: a renderer that outputs the Desktop three-column layout (`Spotlights`, `RightColumn`, `LeftColumn`).
    - In **Big Picture**, `Hp` overrides `re.AC` with `value={Xe}` — the Big Picture Gamepad tab renderer!

3. **The Shared Section Registry (Module `59856.N_`):**
   `Xd.kg` renders `T.N_`, which is `CAppDetailsSections` (`le` in module `59856`).
   In its `render()` method:

    ```js
    render() {
      const sections = this.GetSections(this.props.overview, this.props.details);
      return (
        <div className={Container}>
          ...
          <de parentComponent={this} setSections={sections} ... />
        </div>
      );
    }
    ```

    `de` simply consumes the context:

    ```js
    function de(props) {
        const Renderer = useContext(ce); // ce = CAppDetailsSectionsContext
        return <Renderer {...props} />;
    }
    ```

    `GetSections()` is the **exact same method** that Desktop uses!

4. **Big Picture Tab Composition (Module `3375`):**
   `Xe` renders `AppDetailsRoot` and passes `setSections` into `it(props)`.
   `it` builds the 4 gamepad tabs:
    - **`WhatsNew` (Label: `#AppDetails_Tab_Activity`, on screen: "ACTIVITY"):**
      Calls `at({ setSections, details, overview })`.
        ```jsx
        function at(e) {
            return (
                <>
                    {e.setSections.has("friends") && (
                        <ce.gr details={e.details} />
                    )}
                    {e.setSections.has("postgamesummary") && (
                        <Ge.T details={e.details} />
                    )}{" "}
                    {/* Module 53074.T: Post-Game Summary */}
                    {e.setSections.has("playtestinvites") && (
                        <_e.aL overview={e.overview} />
                    )}
                    {e.setSections.has("spotlightdemo") && (
                        <_e.Be overview={e.overview} details={e.details} />
                    )}
                    {e.setSections.has("spotlightreview") && (
                        <_e.Cz parent={e.details} overview={e.overview} />
                    )}
                    {e.setSections.has("activity") && (
                        <ae.W appid={e.details.unAppID} />
                    )}{" "}
                    {/* Module 80478: Activity Feed */}
                    {e.setSections.has("timedtrialbanner") && (
                        <ge.P overview={e.overview} details={e.details} />
                    )}
                </>
            );
        }
        ```
    - **`YourStuff` (Label: `#AppDetails_Tab_YourStuff`, on screen: "YOUR STUFF"):**
      Calls `ot({ setSections, details, overview })`:
      Renders `achievements`, `cards`, `dlc`, `workshop`, `screenshots`, `review`, and `notes`.
    - **`Community` (Label: `#AppDetails_Tab_Community`, on screen: "COMMUNITY"):**
      Calls `lt({ setSections, details, overview })`:
      Renders `community`.
    - **`GameInfo` (Label: `#AppDetails_Tab_GameInfo`, on screen: "GAME INFO"):**
      Calls `ct({ setSections, details, overview })`:
      Renders `info` (`GameInfoContainer`, `CollectionsHeader`, `GameInfoQuickLinks`).

---

### Why non-Steam games were blank in Big Picture

For a shortcut or non-Steam game, Steam's `GetSections()` filters:

```js
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
```

`s` contains none of the sections checked by `at()` (`postgamesummary`, `activity`, `friends`, etc.).
Furthermore:

- `nonsteam` (the grey disclaimer box) is not rendered anywhere by Big Picture's tabs.
- `notes` and `screenshots` are rendered in the `YourStuff` tab.

Consequently, `at()` receives a set with zero matching entries and renders an empty Fragment `<></>`. The "ACTIVITY" tab was not broken — it simply had nothing enabled to display.

---

### Native Post-Game Summary in Big Picture

**✅ Verified live.**

Because Big Picture evaluates `e.setSections.has("postgamesummary") && <Ge.T details={e.details} />`, and `Ge.T` (module `53074`) reads from `window.appSpotlightStore.GetPostGameSummary(appid)`:

**Restoring `postgamesummary` in `GetSections` and populating `CAppSpotlightStore` makes Steam render its native Post-Game Summary in Big Picture Mode automatically.**

Verified live on AM2R (appid `4263274102`):

- Pushed capture events into `appSpotlightStore.GetOrCreateAppData(4263274102).m_session`.
- Restored `postgamesummary` in `GetSections`.
- Navigated Big Picture to AM2R.
- **Result:** Steam rendered its genuine, fully styled native component tree inside Big Picture's "ACTIVITY" tab:
    - `_1OMmVJHDgNwOt0Wqn0hrf9 GamePlaySummaryContainer Panel`
    - `_3FIjYetykQsFYR08l1v7Ls FocusRingRoot` (native controller focus highlight!)
    - `P_gQ8X-yCsgXeXpP68KS0 GamePlaySummaryHeader` ("Post-Game Summary")
    - `SMWMsB-gz3WbYRK2HOm7i PageableContainer Panel`
    - `_3fiHsLeD_6rtm6bM9lHlVL BoxCarousel SummaryCarouselContainer`
    - `_3CJctA7pLVdwHzNF5JmORE SummaryCarouselScrollingContainer`
    - Relative date headers ("Today", "Yesterday")
    - Individual capture cards with full controller D-pad/stick navigation and click-to-open media playback!
- Tested clean degradation on ActRaiser (`2788628389`, no captures): `hasSummary: false`, page renders stock without errors or empty boxes.

#### Comparison: Native Summary vs Clone

| Feature                      | Hand-built Clone (`gamepad-app.tsx`)     | Steam's Real Component (`Ge.T` via `stores.ts`) |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------- |
| **Lines of Plugin Code**     | ~280 lines of React/CSS                  | **0 lines of UI markup**                        |
| **Controller Focus & D-pad** | Broken (plain `div`s, no focus engine)   | **Native** (`FocusRingRoot`, `BoxCarousel`)     |
| **Paging & Carousels**       | None (overflow scroll)                   | **Native** (`PageableContainer`, auto-pagers)   |
| **Day Grouping & Headers**   | None                                     | **Native** ("Today", "Yesterday", date headers) |
| **Media Playback on Click**  | Custom hooks needed                      | **Native** (opens Steam's media viewer)         |
| **Visual Styling Drift**     | High (must re-measure per Steam build)   | **Zero** (updates automatically with Steam)     |
| **DOM Anchor Fragility**     | High (broke inside tab button, ADR-0028) | **Zero** (Steam places its own component)       |

---

### Navigation & lifecycle signals

In Big Picture Mode, routing does not update `window.location` (it uses React Router / in-place view state transitions). However, two robust signals exist to detect app detail navigation:

#### A. The Store Lifecycle Hook (`EnterAppDetailsPage` / `ExitAppDetailsPage`) — **Recommended**

Steam's own app details container (`L` in module `40478`) calls these methods on `appSpotlightStore` (module `74827` / `window.appSpotlightStore`) whenever entering or leaving an app detail page:

```ts
const store = spotlightStore();
const origEnter = store.EnterAppDetailsPage;
store.EnterAppDetailsPage = function (appid: number) {
    // User entered app detail page for appid (both Desktop and Big Picture!)
    return origEnter.apply(this, arguments);
};

const origExit = store.ExitAppDetailsPage;
store.ExitAppDetailsPage = function (appid: number) {
    // User left app detail page
    return origExit.apply(this, arguments);
};
```

This works identically across both Desktop and Big Picture Mode without relying on URL polling or DOM mutation observers.

#### B. React JSX Element Interception (`watchGamepadAppid`)

As discovered in ADR-0027, wrapping `react/jsx-runtime` (`jsx` / `jsxs`) from `SharedJSContext` intercepts element creation across all windows. Filtering for `typeof props.appid === 'number' && Array.isArray(props.rgSections)` reliably detects when Big Picture's tabbed page component mounts.

#### C. Programmatic Big Picture Navigation

To navigate Big Picture programmatically from `SharedJSContext`:

```js
const navigator = window.__wreq(49171).z.GetNavigator();
navigator.App(appid); // Navigate to app details page
navigator.Home(); // Navigate to library home
```

---

### Gamepad navigation system

Big Picture Mode (GamepadUI) relies on a declarative spatial navigation system managed by `GamepadNavigationManager` (module `41433` / `SteamUIStore.m_GamepadNavigationManager`). Because Big Picture executes in `SharedJSContext`, all navigation components and trees live in the same runtime.

#### A. The `<Focusable>` Component (Module `12975`, Export `K`)

`<Focusable>` is the fundamental building block for all interactive elements in Big Picture Mode. It wraps DOM nodes into navigation nodes (`NavNode`) and automatically coordinates focus, spatial routing, CSS focus classes, and gamepad activation.

```tsx
interface FocusableProps extends React.HTMLAttributes<HTMLDivElement> {
    // Spatial layout of children
    "flow-children"?: "row" | "column" | "grid" | "none";

    // Gamepad actions (automatically mapped to keyboard equivalents)
    onActivate?: (e: Event) => void; // (A) button / Enter key (sets onClick & onOKButton)
    onCancel?: (e: Event) => void; // (B) button / Escape key (sets onCancelButton)
    onOKButton?: (e: Event) => void; // (A) button
    onCancelButton?: (e: Event) => void; // (B) button
    onSecondaryButton?: (e: Event) => void; // (X) button
    onOptionsButton?: (e: Event) => void; // (Y) button
    onMenuButton?: (e: Event) => void; // Start / Menu button

    // Directional navigation overrides
    onMoveUp?: (e: Event) => boolean;
    onMoveDown?: (e: Event) => boolean;
    onMoveLeft?: (e: Event) => boolean;
    onMoveRight?: (e: Event) => boolean;

    // Focus configuration
    focusable?: boolean; // Default: true if onOKButton / onActivate is provided
    focusableIfEmpty?: boolean;
    autoFocus?: boolean; // Take focus when tree mounts
    fnCanTakeFocus?: () => boolean; // Dynamic predicate
    navKey?: string; // Explicit node key for restoration
    navRef?: React.Ref<NavNode>; // Access to internal NavNode

    // Styling & classes
    focusClassName?: string; // Added when focused (merged with 'gpfocus')
    focusWithinClassName?: string; // Added when child has focus (merged with 'gpfocuswithin')
    noFocusRing?: boolean; // Suppress the animated focus highlight

    // Action Bar / Controller Legend integration
    actionDescriptionMap?: Record<number, string>;
    onOKActionDescription?: string;
    onCancelActionDescription?: string;
    onSecondaryActionDescription?: string;
    onOptionsActionDescription?: string;
    onMenuActionDescription?: string;
}
```

When rendered, `<Focusable>` automatically appends the base classes `Panel Focusable` to the DOM element. When receiving controller focus, it applies `gpfocus` (or custom `focusClassName`) and triggers focus ring measurement.

#### B. The `<FocusRingRoot>` Component

Interactive sections (such as `GamePlaySummaryContainer`) wrap their content in `<FocusRingRoot>`. It observes the active navigation target inside its subtree and draws Steam's native glowing, animated focus highlight over the focused `<Focusable>` element.

- Renders an overlay `<div className="FocusRingRoot"></div>`.
- When focus shifts between sibling elements, `<FocusRingRoot>` animates the outline's position and bounding box smoothly across the transition.
- Calling `OnForceMeasureFocusRing()` forces an immediate bounding-box recalculation if layout changes dynamically.

#### C. Gamepad Button Enums (Module `61657`, Export `pR`)

Steam defines all controller inputs in a standard numeric enum used throughout Big Picture navigation and action maps:

| Button Name                          | Enum Value | Standard Physical Mapping          |
| ------------------------------------ | ---------- | ---------------------------------- |
| `INVALID`                            | `0`        | None                               |
| `OK`                                 | `1`        | **(A)** / Cross / Enter            |
| `CANCEL`                             | `2`        | **(B)** / Circle / Escape          |
| `SECONDARY`                          | `3`        | **(X)** / Square                   |
| `OPTIONS`                            | `4`        | **(Y)** / Triangle                 |
| `BUMPER_LEFT`                        | `5`        | **LB** / L1                        |
| `BUMPER_RIGHT`                       | `6`        | **RB** / R1                        |
| `TRIGGER_LEFT`                       | `7`        | **LT** / L2                        |
| `TRIGGER_RIGHT`                      | `8`        | **RT** / R2                        |
| `DIR_UP` / `DOWN` / `LEFT` / `RIGHT` | `9`–`12`   | D-Pad / Directional Input          |
| `SELECT`                             | `13`       | View / Share / Back                |
| `START`                              | `14`       | Menu / Start / Options             |
| `LSTICK_CLICK` / `RSTICK_CLICK`      | `15`–`16`  | L3 / R3                            |
| `REAR_LEFT_UPPER` / `LOWER`          | `23`–`24`  | L4 / L5 (Steam Deck grip buttons)  |
| `REAR_RIGHT_UPPER` / `LOWER`         | `25`–`26`  | R4 / R5 (Steam Deck grip buttons)  |
| `STEAM_GUIDE`                        | `27`       | Steam / Guide / PS button          |
| `STEAM_QUICK_MENU`                   | `28`       | **(...)** Quick Access Menu button |

#### D. The Controller Footer Legend & `actionDescriptionMap`

At the bottom of Big Picture Mode, Steam displays the controller action legend (e.g. `(A) Select  (B) Back  (Y) Options`). This is not hardcoded into pages: it is driven dynamically by the currently focused `<Focusable>` or parent `<GamepadNavigationTreeRoot>`.

To show hints for your component:

```tsx
<Focusable
    onActivate={handleOpen}
    onSecondaryButton={handleDelete}
    actionDescriptionMap={{
        [GamepadButton.OK]: "Open Screenshot",
        [GamepadButton.SECONDARY]: "Delete Capture",
    }}
>
    ...
</Focusable>
```

When focus enters this element, Steam's footer automatically displays the controller glyphs and action labels, switching button icons automatically depending on whether an Xbox, PlayStation, Switch, or Steam Deck controller is connected.

---

### Native dialogs and modals

Plugins do not need custom modal overlays in Big Picture Mode. Steam provides a complete, controller-navigable dialog system in `SharedJSContext` that renders directly into the Big Picture window.

#### A. Opening a Native Modal (`showModal`)

Module `13869` exports `pg` (`showModal`):

> **Steam build 1791918634 (verified live 2026-10-14):** the module is `12302`; `mK(modal, window, props)` is the sized
> `showModal` (`popupWidth` / `popupHeight`, `bNeverPopOut`, `bForcePopOut`) and `pg` is the same with
> `bHideMainWindowForPopouts: true`. Its measuring call moved into a helper, so `RequestModalMeasure` is in the module but
> no longer in the export's own source: resolve by module (`RequestModalMeasure` and `bNeverPopOut`) and export
> (`bNeverPopOut` and `popupWidth`), as `enhanced-notifications/frontend/steam/modal.ts` does.
> **ConfigContext:** from this build Steam's `ConfirmModal` reads a React context (module `6739`: `QO` the context, `rP` the
> asserting reader, `ss` = `ConfigContextRoot({ IN_GAMEPADUI, IN_DESKTOPUI, IN_VR, children })` the provider) and logs
> "Trying to use ConfigContext without a provider!" when a plugin's dialog tree has none, through either `showModal`.
> Wrap the dialog in `ss` (resolve it by the assert string and `IN_DESKTOPUI` + `.Provider`), forwarding the
> `closeModal` Steam injects into the root element. **File dialog:** `SteamClient.System.OpenFileDialog({ strTitle,
> rgFilters: [{ strFileTypeName, rFilePatterns, bUseAsDefault }], strInitialFile, bChooseDirectory, bSaveMode })`
> resolves to the chosen path (Steam's "Choose icon" and "Add a Non-Steam Game" use it).

```ts
import { showModal } from '@steambrew/client'; // Or req(13869).pg

// Locate the Big Picture popup window:
const bpmWindow = g_PopupManager.GetPopups().find(
  p => p.window?.name?.startsWith('SP BPM_') || p.strTitle === 'Steam Big Picture Mode'
)?.window;

// Spawn native modal:
await showModal(
  <ConfirmModal
    strTitle="Non-Steam Activity"
    strDescription="Native Big Picture dialogs work out of the box!"
    strOKButtonText="Awesome"
    bAlertDialog={true}
  />,
  bpmWindow,
  { strTitle: "Non-Steam Activity" }
);
```

#### B. Pre-Built Dialog Components (Module `10606`)

- **`ConfirmModal` (Module `10606.o0`):** Standard Steam confirmation / alert dialog. Supports `strTitle`, `strDescription`, `strOKButtonText`, `strCancelButtonText`, `bAlertDialog`, `bDestructiveWarning`, and `focusButton` (`'ok'` | `'cancel'`).
- **`GenericDialog` (Module `10606.NL`):** Base dialog container supporting custom children, custom button bars, and gamepad navigation entrapment.

Modals opened this way automatically receive:

- Focus trapping (controller navigation cannot leave the dialog).
- Blurred backdrop over the Gamepad UI.
- Native sound effects on open, close, and confirm.
- Proper (B) button dismissal.

---

### Tab construction & custom tab injection

#### A. How Steam Constructs Tabs (Module `3375`)

Big Picture's app detail page constructs its tabs inside function `it(props)` in module `3375`. It passes an array of tab descriptors to `GamepadTabbedPage` (`F` in module `3375`):

```tsx
const tabs: GamepadTabDescriptor[] = [
  {
    id: "WhatsNew",
    title: "#AppDetails_Tab_Activity",     // Screen: "ACTIVITY"
    content: <ActivityTabContent ... />
  },
  {
    id: "YourStuff",
    title: "#AppDetails_Tab_YourStuff",    // Screen: "YOUR STUFF"
    content: <YourStuffTabContent ... />,
    feature: Se.WJ
  },
  {
    id: "Community",
    title: "#AppDetails_Tab_Community",    // Screen: "COMMUNITY"
    content: <CommunityTabContent ... />,
    feature: Se.qR
  },
  {
    id: "GameInfo",
    title: "#AppDetails_Tab_GameInfo",     // Screen: "GAME INFO"
    renderTabAddon: () => <GameInfoIcon overview={overview} />,
    content: <GameInfoTabContent ... />
  }
];
```

#### B. Tab Descriptor Interface

Each entry in `props.tabs` supports:

- **`id`** (`string`): Unique identifier for state persistence and navigation.
- **`title`** (`string`): Localization token (`"#AppDetails_Tab_..."`) or literal text string.
- **`content`** (`React.ReactElement`): The panel content rendered when the tab is active.
- **`renderTabAddon`** (`() => React.ReactElement`, optional): Extra badge, controller glyph, or icon rendered inside the tab button header.
- **`feature`** (`number`, optional): Permission / feature flag required for the tab to display.

#### C. Injecting Custom Tabs (The SteamHunter Pattern)

Because `react/jsx-runtime` is shared between `SharedJSContext` and Big Picture, plugins can intercept the element creation of `GamepadTabbedPage` (`jsx`/`jsxs`) and append or prepend custom tabs directly into `props.tabs`:

```tsx
beforePatch(jsxRuntime, "jsx", (args) => {
    const [type, props] = args;
    if (
        props &&
        Array.isArray(props.tabs) &&
        typeof props.onShowTab === "function"
    ) {
        if (!props.tabs.some((t) => t.id === "CustomProviderTab")) {
            props.tabs.push({
                id: "CustomProviderTab",
                title: "RETROACHIEVEMENTS",
                content: <RetroAchievementsTab appid={props.appid} />,
            });
        }
    }
});
```

Steam's `GamepadTabbedPage` handles all tab button layout, controller bumper tab-switching (LB / RB), focus management, and transition animations automatically.

---

### Media playback & fullscreen viewers

When a user selects a screenshot or clip in the native Post-Game Summary in Big Picture Mode:

- Steam activates `ClickableScreenshot` (`_3JNo1hUKCpMJiJSM2dD5Kq`).
- It transitions Big Picture to the native media viewer page (`GamepadPage PadForHeader PadForFooter`).
- Fullscreen zoom, pan via thumbsticks, slideshow navigation (LB / RB), and (B) back-navigation to app details are handled entirely by Steam's native runtime.

---

## Achievements, notifications, recording & artwork

Everything here was verified directly against Steam's live client runtime (`SharedJSContext`) and module definitions via CEF DevTools.

### Native achievement UI & backing store

Steam does not require custom HTML to show achievements. It already possesses a complete native achievements UI for both Desktop and Big Picture Mode:

1. **Desktop Right-Column Section (`achievements`):**
    - In `CAppDetailsSections.GetSections()`, the `"achievements"` key maps to `I.tm` (module `57665`, class `H`).
    - Component `H.render()` calls `AppDetailsStore.GetAchievements(this.unAppID)` (module `78057`, export `H`).
    - If `achievements.vecHighlight` and `achievements.nTotal > 0` are present, Steam renders the native achievement panel with percentage bar (`HighlightDiv`, `AllAchieved`), featured unlocked badges, and collapsible locked list.
    - **MobX Reactivity Requirement:** Component `H` observes `this.GetAppData(e).details?.achievements`. When achievements arrive asynchronously via RPC, writing `appData.details.achievements = achievements`, calling `appDetailsStore.AppDetailsChanged(appid)`, and calling `refreshSections()` ensures MobX re-renders the panel immediately.
2. **Post-Game Summary Strip:**
    - `CGamePlaySession.prototype.AddAchievement(achievement, unlockTimestamp)` in `CAppSpotlightStore` (module `74827`) pushes achievements directly into the session card strip alongside screenshots and clips.
3. **Big Picture Play Bar Progress:**
    - Big Picture reads `{ unlocked, total }` directly from `window.appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)` to populate the quick stats bar under the Play button.
4. **Full-Page Achievements View (Desktop & Big Picture):**
    - Full-page views query `AchievementsFullStore` (module `32179` / `p6`). Feeding `m_mapMyAchievements` and `m_mapGlobalAchievements` prevents "Failed to load achievement data" errors when users click "View My Achievements" or open `/library/app/<appid>/achievements`.

### Achievement notifications (`NotificationStore`)

Steam's notification engine can be instructed to emit genuine achievement toasts complete with sound, animation, and overlay integration:

- **Dispatch Endpoint:** `window.NotificationStore.OnNotification(notificationId, NotificationType.Achievement, binaryPayload)`
    - Enum value: `NotificationType.Achievement` (`u.uM.ok`).
    - Payload Protobuf: `CAchievementNotification` (`u.R8.fromObject(...)`) with schema:
        ```ts
        interface AchievementPayload {
            achievement_id: string;
            appid: number;
            name: string;
            description: string;
            image_url: string;
            achieved: boolean;
            rtime_unlocked: number; // unix seconds
            current_progress?: number;
            max_progress?: number;
            global_achieved_pct?: number;
        }
        ```
- **Sound & Customization:**
    - `NotificationStore.ChooseSound(config, notification)` and `NotificationStore.PlayNotificationSound(notification)`.
    - Plugins can intercept the sound decision or play custom audio assets (e.g. PlayStation trophy chime, Xbox rare achievement chime, RetroAchievements chime) alongside the dispatch.

#### Resolution signatures & toast windows

**✅ Verified live 2026-09-24** (`enhanced-achievements` Step 0, now `enhanced-notifications`; toast-window rows updated by the Big Picture toast fix).

Module ids and minified names are one build's breadcrumbs; these are the stable
handles `enhanced-notifications` resolves by. Probes: `enhanced-notifications/tests/probes/`.

| Target | Stable signature | Verified facts |
| --- | --- | --- |
| `NotificationStore` | `window.NotificationStore` | `PlayNotificationSound(n)` is a plain prototype method: `const r = Q[n.eType]; const i = this.ChooseSound(r, n); i && PlayNavSound(i)`. `ProcessNotification` is a **bound, non-writable, non-configurable own property**, so it cannot be wrapped. **✅ Verified live 2026-09-25:** `ProcessNotification` itself also calls `this.ChooseSound(config, n)` once on arrival (a "would it make a sound" check, nothing played); only the `PlayNotificationSound` path plays. So count or intercept plays through `PlayNotificationSound`, never through `ChooseSound` alone. `OnNotification` is also a non-writable, non-configurable own property. |
| Toast lifetime (desktop) | `t.m_notification` in the desktop toast stack loop (module breadcrumb `48197`) | **✅ Verified live 2026-09-25.** States `NotShown → FadingIn (300 ms) → Showing → FadingOut (300 ms) → Finished`. In `Showing`, **every frame**: if `m_notification.fnNotificationResolved` is set, the toast stays until it returns true; otherwise it leaves after `max(m_notification.nToastDurationMS, V)`. Both are read from the notification object each frame, and it is the **same object** the dispatcher receives as `group.notifications[0]`, so a plugin can own a toast's lifetime by setting `fnNotificationResolved` on it after mount (`enhanced-notifications`' achievement banner does, with a cap). Client notifications arrive with `fnNotificationResolved` from `OnNotification`'s 4th argument (undefined for achievements). Big Picture reads both through a hook at render time (`R(ref, nToastDurationMS, fnNotificationResolved, dismiss)`), so setting it after mount is too late there; its single popup already shows one toast at a time. The in-game overlay path (`AddAppOverlayNotification`) copies `fnNotificationResolved` onto its own object: unverified live. **At most 3 desktop toast popups show at once** (observed live 2026-09-25): with 3 achievement popups held open, a downloads toast waited about 5 s, until one closed, before its popup was created. So holding popups delays other toast types while they are held. |
| Achievement type | `n.data.getClassName() === "CClientNotificationAchievement"` | `eType` is `5` on this build. Discover it by calling the original `PlayNotificationSound` on a stand-in `{ ChooseSound(cfg) { … } }` for each eType: it hands back each type's config `Q[eType]` (with `.proto`, `.toastDurationMS`) without playing anything. |
| Sound mute | `ChooseSound(config, n)` | Already honours Steam's `play_sound_on_toast` setting (and `bCritical`). Steam's chime goes `PlayNavSound(id)` → `m_fnCallbackOnPlaySound.Dispatch` to a native player (id `5` = toast achievement), not WebAudio in SharedJSContext. |
| Toast duration | `Q[achievementType].toastDurationMS` | Read by both `ProcessNotification` (`t.nToastDurationMS = e.toastDurationMS \|\| 5e3`) and the in-game overlay path (`AddAppOverlayNotification`). Setting it on the config applies to every later toast. |
| Toast dispatcher | Exported function whose source has `group` and either `switch(e){case` (up to Steam build 1785799196) or `.group.eType` (from 1791918634: `function q(ai){...an=xn(ai.group.eType); return an ? jsx(<analytics context>, {children: jsx(an, {className, group, ...})}) : null}`, a table lookup instead of the switch; verified live 2026-10-14, module `25666` export `Tm`), in the module containing `global_achieved_pct()` and `"Missing activate function"`. Resolve by those markers, never by id or by one minified shape | The achievement renderer (`ht`) is **not exported**; its dispatcher (`Tm`/`Ke`) is. Created as `jsx(dispatcher, { location, group: { eType, notifications: [n] }, onDismiss })` inside the toast container. `react/jsx-runtime`'s `jsx` is a writable export (ADR-0027). |
| Toast windows | CDP titles `notificationtoasts_<n>_desktop`, `notificationtoasts_uid<n>` (Big Picture) | All `about:blank` portals rendered from SharedJSContext. Desktop frame: fixed **284×71** (DPR 1.25). Big Picture frame: **300×80**. In-game overlay toasts use the same dispatcher via `ge("notificationtoasts", …, appid)` (code-verified; not yet verified with a real in-game unlock). **How each is created** (fixed and verified live 2026-09-24, see CHANGELOG.md): desktop and the in-game overlay get **one popup per toast**, opened through Steam's popup manager (`g_PopupManager`), so `Millennium.AddWindowCreateHook` sees it. Big Picture gets **one persistent popup**, created once via `SteamClient.BrowserView.CreatePopup` + `window.open` and reused for every toast (`SetVisible`); it is **not** registered with `g_PopupManager`, so it is reachable only via the `GamepadToastPlaceholder` div Steam renders into the (tracked) Big Picture main window — walk that div's React fiber to a hook holding the popup object, then call `GetViewWindow()`. Gamescope/Steam Deck underlay mode renders the toast **embedded** in the main window (`ToastContainerEmbedded`), no separate window at all. **Big Picture placement and motion (verified live 2026-10-01):** the placeholder is `position: fixed` (bottom right by default; 1180,734 and 320×80 in a 1500×844 window) and the toast view follows its rect, re-measured when a toast shows (the popup object carries a `m_DynamicCSSObserver`): CSS `top/left` on the placeholder moved the view to (30, 19), so the Big Picture toast position is CSS on that div (`enhanced-notifications/frontend/surfaces/style/injector.ts`). Steam animates with `.GamepadToastPopup > * { animation-name: <slide in from 300px>, <fade out>; animation-duration: 300ms, 300ms; animation-delay: 0s, var(--toast-duration) }`, `--toast-duration` inline on `GamepadToastPopup` from the type's duration; that child is rebuilt for each toast. **Types beyond the SDK enum:** the firmware update test toast is eType 61, which `EClientNotificationType` (ends at 58) does not name; Steam still has a type config for it. |
| Completion | `window.appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)` → `{ unlocked, total, all_unlocked }` | On an achievement notification Steam only **queues** a refresh (`OnAchievementNotification → QueueCacheUpdate`), so at toast time the entry is the pre-unlock state: `!all_unlocked && unlocked + 1 >= total` means this unlock completes the game. |
| Test toast | `NotificationStore.TestAchievement(appid)` | Async (awaits `RequestAppDetails`). Always sends `global_achieved_pct: 10`. **Source (verified 2026-09-25):** picks a random entry of `(await appDetailsStore.RequestAppDetails(appid)).achievements.vecHighlight` (`strID`, `strName`, `strDescription`, `strImage`); with none, it makes one up ("won a race" / "You placed 1st!", an app 270880 image). Posts with `this.m_nNextTestNotificationID++`. Concurrent calls race on `RequestAppDetails`, so which call's toast arrives first is not guaranteed; tag each synthetic toast by its own payload (e.g. its `achievement_id`), never by a time window. For other rarities, build the payload with `Q[type].proto.fromObject({...}).serializeBinary()` and call `OnNotification(id, type, bytes)`. |
| Desktop toast stack | The stack manager owning per-toast popups (module breadcrumb `48197`, function `Q`) | **Verified live 2026-09-25** (see `git show 080b5d4:enhanced-achievements/CHANGELOG.md`). Runs a `requestAnimationFrame` loop that repositions **every** toast popup on **every frame** of a 300ms fade-in and a 300ms fade-out (`W=U=300`), anchored at Steam's own corner with a **fixed 283px width** (`H=283`) regardless of the popup's real size. It calls `toast.m_popup.SteamClient.Window.MoveTo(x, y, m_flDPI)` — `(x, y)` in the popup's `screen.avail*` CSS-px space, third arg the **DPI**, not a boolean — but only when its own cached `m_nLastX/m_nLastY` differ from the new value; it never reads the window's real position, so an external `MoveTo` is silently overwritten on the next frame. On the toast popup itself, `SteamClient.Window.MoveTo` is an **own, writable, configurable** property (not a shared prototype method), so a plugin can replace it for one popup without touching any other window — this is how `enhanced-notifications` pins its achievement banner's position (`frontend/surfaces/banner/window-pin.ts`). **More, verified live 2026-10-01** (`enhanced-notifications/tests/probes/toast-placement.mjs`, 1920x1032 avail, bottom-right): Steam's "fade" is the window **sliding**, not opacity: the first `MoveTo` puts the toast past the anchored edge (y 1102), it slides to rest (y 962 = availHeight − 70) over ~300 ms, and slides back past the edge to leave; the stack step is the toast height (70), the **newest toast sits at the corner** and older ones move inward (962 → 892 when a second one arrives); lifetime is ~300 ms in + the type's `toastDurationMS` + ~300 ms out, then the popup closes. By the **first** `MoveTo` the popup has rendered its toast: `notification.eType` is readable from a fiber's `memoizedProps.notification` above its content. `enhanced-notifications` remaps each move to its theme corner (`frontend/surfaces/style/toast-window.ts`). |
| Desktop stack: when it pops a toast | `he` / `Ce` in module `48197`; `NotificationStore` (`60917`) `BAnyToastDisplayAlone`, `BNextToastDisplayAlone`, `PopNextToastNotification` | **Verified live 2026-10-02.** An effect pops toasts from `m_rgNotificationToasts` into the on-screen list (at most 3 on desktop, 1 for the Big Picture view `ge`). It stops when a toast on screen is `displayToastAlone`, or the next one is and the list is not empty; `_e(t) = typeConfig[t.eType].displayToastAlone === true` (Steam sets it on types 33-35 only; it is writable: true on every type = one toast at a time). It also pops nothing unless its react-query cache of `SteamClient.Window.DefaultMonitorHasFullscreenWindow` (key `["SteamClient","DefaultMonitorHasFullscreenWindow"]`, staleTime 5 s) is fresh: stale reads as `undefined` (`for(!r&&m&&void 0!==h||(n=0)...)`). The query refetches only when its `enabled` input flips (`!!currentToast && m && list.length < limit && desktop`): a toast arriving in an empty queue, or a full stack freeing a slot. With toasts shown one at a time and more waiting, nothing flips and the stack **stalls for good** once a toast lasts past 5 s (seen live: 49 toasts waiting, none shown, the cache 9 minutes stale). Steam calls `NotificationStore.SetContextRenderingToast(context, isRendering)` when the on-screen list goes empty or non-empty, the moment to unstick it. Unstick it with the query observer's own `refetch()` (the `he` fiber's hooks; `enhanced-notifications/frontend/steam/toast-stack.ts`), or by emptying the queue (`ClearAllToastNotifications`). The QueryClient is not exported. |
| Desktop toast hover | The toast card `DesktopToastPopup` (CSS module key; one hashed class) | **Verified live 2026-10-02.** Three rules: `::before { content: ""; position: absolute; inset: 0; background: radial-gradient(155.42% 100% at 0% 0%, rgb(31,42,57) 0, rgb(31,42,57) 0%, rgba(26,160,255,.325) 100%); opacity: 0; transition: opacity .3s linear }` and `:hover::before { opacity: .5 }`; `:hover .DesktopToastBackground { color: rgb(26,159,255); opacity: .1 }` (the Steam logo watermark, resting at `opacity: .05`); `cursor: pointer`. The card and every ancestor are `position: static`, so the overlay is sized to the **whole toast window**: a rounded `overflow: hidden` card does not clip it, and it follows an animation only while that animation's transform runs. In an achievement banner's popup the card is 0 px tall (the banner overflows it), so the overlay and the logo cover the window square and stay while Steam holds the popup. `enhanced-notifications` positions the card (`position: relative`) for themed toasts and draws its own hover inside the banner (`frontend/banner/styles.ts`). |
| `SetNotificationPosition` | `ActiveWindowInstance.SetNotificationPosition(posEnum, horizontalInset, verticalInset)` (module breadcrumb `78506`) | **Do not use for per-toast placement.** It sets `m_notificationPosition` on the **window instance**, global to every toast in that window (friends, downloads, other plugins), not scoped to one popup. It is not read by the desktop toast stack's own `MoveTo` loop above — writing it live and then reading `ActiveWindowInstance.NotificationPosition` back showed no effect on where toasts actually rendered. Steam's own position enum has only four values: `TopLeft=0, TopRight=1, BottomLeft=2, BottomRight=3` (module breadcrumb `44846`); it has no centered positions. |

#### Big Picture toast view: how Steam places and shows it

**✅ Verified live 2026-10-01** (Steam build of Sep 5 2026; source read from modules `48197` toast containers,
`73375` BrowserView placeholder, `26711` class map; traced with `enhanced-notifications/tests/probes/bp-toast-trace.mjs`).
Investigation and fix: [enhanced-notifications-bigpicture-toast-fix-plan.md](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md).

- **Which toast is on screen.** Big Picture's container (`pe` in `48197`) keeps its own display list (`Ce`, max 1)
  and fills it in an effect with `NotificationStore.PopNextToastNotification(context)` (context `0`; an appid for
  in-game overlay toasts). The pop runs inside a React state updater, so **before** the next toast renders. A
  writable prototype method. `NotificationStore.CurrentToastSubscribableValue` is a different signal: it fires
  when a toast **arrives**, also while another toast is still on screen (queued), and drops back to `null` within
  a few ms. Steam's toast component (`M`) calls `PlayNotificationSound` in a `useEffect` on its `notification`
  prop, so `onShown` (the shared hook) fires once per displayed toast, after commit.
- **Where it goes.** The placeholder (`m4` in `73375`, class `GamepadToastPlaceholder`) re-measures itself with
  `getBoundingClientRect()` in a `useLayoutEffect` **with no deps**, and calls `browserView.SetBounds(x, y, w, h)`
  only when the rect differs from the last one it sent. So the view moves only when that component re-renders
  (a toast shown or hidden, a class change, the Big Picture window's visibility changing): **CSS that moves the
  placeholder mid-toast does not move the view** until the next re-render. Per toast: `SetBounds(rect)`, then
  `SetVisible(true)`; on hide `SetVisible(false)` and `SetBounds(0, 0, 0, 0)` (the view keeps its last on-screen
  place). `window.screenX/Y` of the view lags `SetBounds` by about 25 ms (one or two frames).
- **Placeholder CSS (stock).** `position: fixed; bottom: 30px; right: 0; width: 300px; height: 40px; padding: 20px 0 20px 20px`
  (a 320×80 rect). `PositionTop`: `top: 50px; bottom: unset`. `PositionLeft`: `left: 0; right: unset; padding: 0 20px 0 0`.
  `InGame`: `bottom: -10px` (`top: 10px` with `PositionTop`). `Warning` (eTypes 6 LowBattery, 22 LowDiskSpace, 62):
  `width: 150px; height: 28px` (a 170×68 rect, so a right- or bottom-anchored toast changes place between a Warning
  toast and the next one). `TinyToast` is never set on this build (its test returns false). Inline: `margin` from
  `NotificationPosition`'s insets, `display: none` while hidden.
- **Motion.** `.GamepadToastPopup > *` runs `toastEnter` (`translateX(300px)` → `0`, 300 ms,
  `cubic-bezier(0, 0.73, 0.48, 1)`) and `toastExit` (opacity 1 → 0, 300 ms, delay `var(--toast-duration)`), both
  `forwards`. Swapping that element's animation mid-toast restarts it: the toast jumps 300 px sideways (out of its
  frame) and slides back. The view is hidden `nToastDurationMS + 600` ms after it showed.
- **Our use.** enhanced-notifications takes the type of the toast on screen from the pop
  (`enhanced-notifications/frontend/steam/toast-pop.ts`, an own property on the store instance), never from
  the current-toast value.
- **In game: two toast views (verified live 2026-10-08, AM2R in Big Picture; `enhanced-notifications/tests/probes/ingame-views.mjs`).**
  With a game running, Big Picture has two toast containers: its own view (`notificationtoasts_uid<n>`, placeholder
  in the Big Picture window) and the game overlay's (another `notificationtoasts_uid<m>`, placeholder in the
  `SP Overlay: <pid>/...` window, also with the `InGame` class). Both pop from the **same** queue with context `0`
  (`m_mapAppOverlayToasts` stayed empty), each showing one toast at a time, so two toasts close together are split:
  one in the overlay view (over the game) and one in Big Picture's own view (**behind the game, never seen**). Stock
  Steam does this with every plugin off. `displayToastAlone` holds a container only while its own list is busy, so it
  does not serialize the two. **The overlay view hides in the opposite order to the main one:** `SetBounds(0, 0, 0, 0)`
  first, then `SetVisible(false)`; the view reports itself at `0, 0, 320, 80` for a frame, i.e. at the top-left at full
  size. Anything of a toast still opaque at that moment flashes in the top-left corner (stock content is already at
  opacity 0). Toast-sound types: types 14 and 56 have no `sound` in their config (silent in stock Steam). The screenshot
  shutter is `OnScreenshotStarted` -> `PlayNavSound(Screenshot)`, not a toast sound.
- **Which app has focus (verified live 2026-10-08).** Steam's own record is the focus-change event
  (`SteamClient.System.UI.RegisterForFocusChangeEvents`: `{ focusedApp: { appid, pid, windowid, strExeName },
  rgFocusable: [...] }`). Each Big Picture window keeps its appid as
  `SteamUIStore.WindowStore.SteamUIWindows[i].m_CompositionStateStore.m_currentlyFocusedAppid.Value`. When no window
  has the Windows foreground (for example a minimised RDP client), the focused app is 413080, "Steam Controller Configs -
  Desktop", even with a game running. `document.visibilityState` of the Big Picture window is not a reliable "game in
  front" signal: it is CEF's occlusion state and flips with the desktop (ADR-0064).
- **Hidden window.** While the Big Picture window is not in front (`document.visibilityState === "hidden"`), the
  placeholder does not call `SetVisible(true)` itself, its rAF stops, and CSS animations in the toast view never get
  a start time (the achievement banner stays at opacity 0). Live checks of toast visuals need Big Picture in
  front.

### Game Recording RPCs & timeline markers

Steam's 2024 Game Recording system exposes structured RPCs through Steam's CM
transport, verified live 2026-09-24 (docs/plans/phase7-and-alpha-plan.md § A1;
no real capture, clip or marker was created — only dry probes with a bogus
game id, all failing cleanly). Module ids below are build breadcrumbs, not
stable — resolve by signature only.

> **⚠️ Trap: a burst of `GetClips` at start-up empties Steam's clip list for the whole session (found 2026-10-07).**
> `steam-cartridges` published a Post-Game Summary for every shortcut when the start-up achievements preload updated
> their records: ~450 `GetClips` calls within seconds of each start. After that, `GetClips` answered EResult 1 with
> **no clips, for every game**, and Steam's own media manager (`LazyLoadClips`) loaded 0, until the next start; clips
> saved during the session still appeared (added by `OnClipCreated`). The files on disk were intact. With the burst
> gone (only an open page publishes), all 8 clips listed after every start. Ask Steam's recording service only for
> what a page shows, never for the whole library at once. Also: the 2026-09-24 "dry" `SaveClip` probe did write a
> clip (`clip_1_20260924_194009`, `clip.pb` 11 bytes, name `probe`, no video), and the launch-tracking
> `StartRecording` / `StopRecording` probes of 2026-10-03 left two 53 ms clips with no video or thumbnail; all three
> were moved to `userdata/<id>/gamerecordings_quarantine_20261007/`.
>
> In recording mode Manual, a session recorded with Ctrl+F11 (or `g_GRS.StartRecording` / `StopRecording`) leaves
> `gamerecording.pb` listing the session's timeline after its video was saved into the clip and `video/` was emptied
> at game exit; the media view shows it as a "background recording" that cannot be opened (seen after the user's own
> Ctrl+F11 on 2026-10-07, so it is not specific to enhanced-notifications). Confirmed a Steam bug by the user the same
> day: with every plugin disabled a Ctrl+F11 recording still adds the broken tile, and it is gone after a Steam
> restart (only the clip stays). Nothing to fix on our side.
>
> **Capture events** (for listeners): `SteamClient.GameSessions.RegisterForScreenshotNotification` (`strOperation`
> `started` / `written` / `deleted`, `unAppID`, `hScreenshot`, `details`), and on the recording service
> `RegisterForNotifyClipCreated` (`CGameRecording_ClipCreated_Notification { summary }`) and
> `RegisterForNotifyClipDeleted` (`CGameRecording_ClipDeleted_Notification { clip_id, game_id }`); handlers get a message
> (`msg.Body().toObject()`) and return an EResult. Several listeners per notification are normal (Steam's own clip
> manager and media view both register).

**Resolution.** The service: the export object of the module whose source
contains `"GameRecording.TakeScreenshot#1"`, with
`v.TakeScreenshotHandler?.name === "GameRecording.TakeScreenshot#1"` and
functions `TakeScreenshot`, `SaveClip`, `UserAddTimelineEntry` (this build:
module `80026`, export `xM`). `SteamClient.GameRecording` is **not** the RPC
service — it only has `RegisterForAudioSessionsChanged` /
`SetAudioSessionCaptureState`. There is **no `SteamClient.*` trigger for a live
capture**; `SteamClient.Screenshots.*` is read/manage only.

**Calling convention.** Steam's own callers (`CGameRecordingStore`) pass plain
objects; the service converts them to protobuf itself:
`const res = await svc.TakeScreenshot({...}); res.GetEResult(); res.BSuccess(); res.Body().toObject();`.
It never throws on a bad request (it resolves with a failing `EResult`); it can
reject only with no transport ("Transport Error").

1. **`GameRecording.TakeScreenshot#1`** — request `{ game_id, timeline_id,
   timeline_offset_ms, source_clip_id? }`; response `{ screenshot_id }`.
   **It extracts a frame from already-recorded video at that timeline offset**
   (backs the timeline menu's "Take Screenshot at Current Playback"), not a
   F12-style live grab — it needs background or manual recording already
   running at that moment.
2. **`GameRecording.SaveClip#1`** — request `{ game_id, start: {timeline_id,
   offset_ms}, end: {timeline_id, offset_ms}, name, src_clip_id?, temporary
   (must be `false` to keep it), force_thumbnail }`; response `{ summary:
   {clip_id, game_id, duration_ms, date_recorded, thumbnail_url, …} }`.
3. **`GameRecording.UserAddTimelineEntry#1`** — request `{ game_id, entry:
   {timeline_id, entry_id: "" on create, time (ms, uint64 string), type,
   game_mode, range_title, range_duration, range_possible_clip,
   timestamp_title, marker_icon, marker_description, marker_priority,
   screenshot_handle, achievement_name, tag[], phase_id, attributes[]},
   clip_id? }`; response `{ entry_id }`.

**Markers on a shortcut's timeline are refused (verified live 2026-10-15, Metroid Fusion shortcut, RetroArch, recording
mode Manual).** `UserAddTimelineEntry` from SharedJSContext answers **EResult 42 (NoMatch)** for the shortcut's running
timeline (`BIsTimelineRunning` true, ~1-2 min in), for both an `Event` (type 2, `range_title`, `marker_icon`) and Steam's
own user-marker shape (`{ timeline_id, entry_id: "", time, type: 5, marker_icon: "steam_marker", marker_priority: 0 }`, the
exact entry `AddUserMarkerAtGlobalMS` in module `60869` sends through `g_GRS.CreateUserTimelineMarkers`), and also
**while a manual recording runs** (`g_GRS.StartRecording`, `recording_type 2`). So the cause is neither the timeline
starting late nor missing video. Not yet known: whether Steam's own overlay "add marker" works on a shortcut (if it fails
too, it is Steam's limit for non-Steam games), and whether the same call works for a native game from SharedJSContext.
Side effects seen: stopping a manual recording ends the timeline and starts a new one; the test clip was deleted with
`g_GRS.DeleteClip(clipId)` (EResult 1, no files left).

**`ETimelineEntryType`** (protobuf wire enum, a network contract, not a
webpack id): `GameMode=1, Event=2, StateDescription=3, Achievement=4,
UserMarker=5, Screenshot=6, Error=7`. Rendering, from Steam's proto→UI
converter: `UserMarker` (5) always draws as `steam_marker` (icon and title
dropped on reload); `Event` (2) keeps `marker_icon`, `range_title`,
`marker_description`; `Achievement` (4) keeps only `achievement_name` and is
looked up via `GetAchievementInfo(appid, achievement_name)` — only resolves
for apps with a Steam achievement schema. **Steam already writes an
`Achievement`-type entry on its own games' unlocks**, so a plugin-added marker
for a native Steam game would duplicate it; only add one for non-Steam
shortcuts (whose achievements have no Steam schema entry).

**Live recording state:** `window.g_GRS`, an instance of `CGameRecordingStore`
(created by the client's own store init on both desktop and gamepad startup
paths). `g_GRS.m_mapActiveTimelines: Map<timelineId, {loader, release}>`; the
loader has `BIsTimelineRunning(tid)`, `GetRunningTimelineDurationMS(tid)`
(a `performance.now()`-based live offset), `GetGameID()` (uint64 string —
native games use the plain appid, shortcuts the composed 64-bit gameid, per
AGENTS.md § two identifiers), `GetTimelineStartBeforeGlobalZeroMS(tid)`, and
`m_mapRunningTimelines: Map<tid, {m_metadata, m_runningRecording}>`, where
`m_runningRecording` is `{recording_id, start_offset_ms, duration_ms,
recording_type}` while video is being written, `null` otherwise. **Stale
entries stay in `m_mapActiveTimelines`** after a timeline stops (Steam calls
`release()` but never deletes the map entry), so `BIsTimelineRunning` is
mandatory before trusting an entry. `g_GRS` must be read fresh on every use,
never cached — Steam can recreate it.

**Manual recording from code (✅ verified live 2026-10-07, AM2R shortcut, recording mode Manual).** `g_GRS`
also does what the overlay's record button and the Ctrl+F11 hotkey do:

- `g_GRS.StartRecording(gameId)` → `GameRecording.StartRecording#1` `{ game_id }`; resolves with the RPC result
  (EResult 1). Within 3 s the timeline's `m_runningRecording` appears with `recording_type: 2` (manual).
- `g_GRS.StopRecording(gameId)` → `GameRecording.StopRecording#1` `{ game_id }`; on success Steam adds the clip
  summary to its own store (`GetClipSummariesForGame(gameId)`): a clip of the whole recording (11 s), no `SaveClip`
  needed.
- `g_GRS.TakeScreenshot(gameId, timelineId, offsetMs, sourceClipId?)` → `{ handle, result }`. A frame inside a
  recorded range is saved as a real screenshot (4K JPG under `screenshots/<gameid>/`, then
  `SteamClient.Screenshots.GetLastScreenshotTaken()`). **A frame 1 s behind live, 8 s into a recording, fails with
  EResult 9 (FileNotFound)**: the newest video is not on disk yet; how far behind live is safe was not measured.
  Passing `sourceClipId` returns 8 (InvalidParam); leave it out.
- `GameRecording.SetPerGameSettings#1` takes `{ gameid, enabled, minutes, bitrate, infinite }` (per-game
  background recording; read from the message definition, not called).

There is still no live, F12-style grab: nothing in `SteamClient.*` or the recording service takes one.

**Dry-probe EResults** (bogus `game_id: "1"`, `timeline_id:
"timeline_0_nonexistent"`): `GetState({})` → 1 OK; `GetTimelinesForApp` → 1,
empty; `TakeScreenshot` → 8 (InvalidParam); `SaveClip` (`temporary: true`) →
79 (InvalidState); `UserAddTimelineEntry` (type 5) → 42 (NoMatch).

Implementation: `enhanced-notifications/frontend/surfaces/captures/recording.ts` (the only
file touching these objects) and `frontend/capture/plan.ts` (pure planning) and
`frontend/surfaces/captures/captures.ts` (scheduling). Full spec:
[docs/plans/phase7-and-alpha-plan.md](plans/phase7-and-alpha-plan.md) § A1–A2.

### Custom artwork API

SteamClient provides a high-level API to assign custom artwork to any shortcut without manual file copying:

```ts
SteamClient.Apps.SetCustomArtworkForApp(
    appid,
    base64Data,
    extension,
    imageType,
);
```

- **`imageType 0`**: Tall portrait capsule (600 × 900)
- **`imageType 1`**: Wide hero background banner (1920 × 620)
- **`imageType 2`**: Transparent logo PNG
- **`imageType 3`**: Wide library capsule (920 × 430)

Clearing custom artwork: `SteamClient.Apps.ClearCustomArtworkForApp(appid, imageType)`.

**P0 findings (2026-09-24).** Both methods exist (plus `SetCustomLogoPositionForApp`). The run was read-only, so the 3-5 MB base64 limit, the `grid/` file and clear behaviour are **unverified: P3 must add a self-check on a test shortcut**. `AppOverview` exposes only hash fields (`icon_hash`, `library_capsule_filename`, `header_filename`, `rt_store_asset_mtime`), so **user-set art in a slot is not detectable** from it: P3 records only slots it wrote and clears only those. `appDetailsStore.RequestCustomImageInfo` exists and is a candidate to check.

### Collections (`collectionStore`)

Verified live 2026-09-24 (`scratch/cartridges/p0-t1-collections.mjs`, `p0-t1b.mjs`).

- `window.collectionStore` is a class instance (`OnAppOverviewChange` is an own field). `userCollections` is an **Array** (22 here, including `favorite`, `uncategorized`, `type-music`). Also `GetCollection(id)`, `GetCollectionListForAppID(appid)` (collections holding the app, shortcuts included), `AddOrRemoveApp`, `SaveCollection`, `DeleteCollection`.
- Per collection: `id` (also `m_strId`; `uc-...` user, `srm-<base64 name>` static, `favorite`), `displayName`, `bIsDynamic`, `bIsEditable`, `allApps` (AppOverview[]), `apps` (a Map keyed by numeric appid, so `apps.has(appid)` is O(1)), `m_filter` (set for dynamic), `m_setAddedManually`, `m_setRemovedManually`. Methods: `AddApps`, `RemoveApps`, `Save`, `Delete`, `FreezeToStatic`.
- Shortcuts appear in membership for **both** static (`Fav`, `SNES`) and dynamic (`Installed`, `Not Played`) collections. Use `apps.has` / `GetCollectionListForAppID`.
- Readiness: populated once the client UI has loaded. Wait on `collectionStore.m_mapCollectionsFromStorage` (a plain field, created in the first `OnCloudStorageChanged`). Never read `userCollections` or any other collectionStore computed before then. They are MobX keepAlive computeds, and a throw before they track anything poisons them for the session, which breaks Steam's `CollectionsHeader` for every app.
- Change signal: not observed. `AddApps`/`RemoveApps`/`Save` are the mutators; P2 re-resolves on view per ADR-0033. Nothing was hooked.

### Store item data for arbitrary apps

Verified 2026-09-24 (`p0-t3-sic*.mjs`, `p0-t2-cdn.mjs`).

- `appStore.allApps`: 690 entries here: native by `app_type` (1: 309, 2: 5, 4: 151, 8: 1, 8192: 2, 65536: 2) plus 220 shortcuts (`1073741824`). 470 have `appid < 0x80000000`. Usable fields: `display_name`, `sort_as`, `app_type`. Owned and known apps, not the whole store.
- `window.StoreItemCache` (Steam's CM transport) **loads unowned apps**: `QueueAppRequest(appid, {include_assets:true, include_basic_info:true, include_release:true, include_full_description:true})`, wait ~4 s, then `BHasApp`/`GetApp`. Verified with 2820820 (absent from `appStore`). Item fields: `m_strName`, `m_BasicInfo` (short_description, developers[], publishers[]), `m_ReleaseInfo` (`steam_release_date`), `m_StoreCategories` (id lists), `m_rgStoreTags`, `m_strFullDescriptionBBCode`, and `GetAssets()` with `GetLibraryHeroURL`, `GetLibraryCapsuleURL(_2x)`, `GetHeaderURL`, `GetMainCapsuleURL`. Steam's own data, no scraping.
- Asset URLs are hashed paths under `shared.steamstatic.com/store_item_assets/steam/apps/<id>/<hash>/...`: take them from `GetAssets()`, do not hand-build.
- No client-side title to appid search exists; `storesearch` stays step 3. A frontend `fetch` to store search failed (`Failed to fetch`), so search stays in the backend.
- Frontend `fetch()` of `cdn.akamai.steamstatic.com/steam/apps/435150/` succeeds (200) for `library_hero.jpg` (354759 B), `library_600x900.jpg` (61149 B), `logo.png` (262681 B), `header.jpg` (52895 B): no backend download needed for unhashed paths of an existing app.

### Game Info tab & metadata

The Big Picture `GameInfo` tab (`/library/app/<appid>/tab/GameInfo`) and desktop metadata panels query `CAppDetailsStore`:

- `GetDescriptions(appid)`: Provides `strFullDescription`, `strSnippet`.
- `GetAssociations(appid)`: Provides `rgDevelopers`, `rgPublishers`, `rgFranchises`.
- `strManualURL`: Provides community guides / digital manual links.
  Feeding these in-memory stubs satisfies the native Game Info tab without modifying Steam's tab layout components.

#### Game Info Component Architecture & The Shortcut Warning Trap (`#AppDetails_Shortcut_Explanation`)

Module `15448` exports the Game Info container `G` and inner component `k`. In stock Steam:

```js
// module 15448, k.prototype.render
const appData = store?.GetAppData?.(overview.appid);
const hasMetadata = Boolean(appData?.descriptionsData?.strSnippet || appData?.associationData?.rgDevelopers?.length);

if (!hasMetadata && overview.BIsModOrShortcut()) {
    return React.createElement("div", { className: styles.ShortcutExplanation }, 
        Localize("#AppDetails_Shortcut_Explanation") // "Detailed information is unavailable because it is a non-Steam game or mod"
    );
}
```

Three independent failure modes caused non-Steam games to display the grey shortcut warning or miss Game Info on desktop:
1. **CEF Signed int32 Mismatch:** Steam CEF passes `overview.appid` as a signed 32-bit integer (e.g. `3858889198` becomes `-436078098`). Store queries and cached Map lookups without bitwise normalization (`appid >>> 0`) missed cached records.
2. **Asynchronous Navigation Race:** When a user navigates directly to Game Info or switches tabs before background scraping/route listeners finish, `GetAppData(appid)` returns undefined.
3. **MobX `@observer` Prototype Render Trap:** Steam wraps class components `XC` (PlayBar, module 56262) and `k` (Game Info, module 15448) with MobX's `makeClassComponentObserver` (`y.PA`). On first render, MobX attaches an own-property `this.render` directly to the instance, closing over the original unpatched render function. Patching `Component.prototype.render` after module load is bypassed because own properties take precedence over prototype properties during re-renders.

**Remediation Pattern (Prototype `props` Accessor & Synchronous Enrichment):**
1. **Prototype `props` Accessor:** By defining an accessor descriptor (`get`/`set`) for `props` on `Component.prototype` (`k.prototype` and `targetPlayBar.prototype`), constructor assignments (`this.props = e`) invoke the prototype setter rather than creating an instance own-property. Every subsequent render (including inside MobX instance reactions) accesses `this.props.overview`, invoking the prototype getter which returns the scoped proxy (`BIsModOrShortcut: () => false`) without touching `AppOverview.prototype` (preserving Guardrail 1).
2. **Desktop Game Info Drawer & ⓘ Button:**
   - Desktop Game Info is not a tab like Big Picture (`/tab/GameInfo`), but an accordion drawer rendered by `x.b` in module `15448` (wrapping `k`) under the hero banner.
   - It is controlled by the ⓘ button on the desktop PlayBar (`XC` in module `56262`) via `onGameInfoToggle`.
   - In stock Steam, the ⓘ button is guarded by `!t.BIsModOrShortcut()`, and the `"info"` section is stripped from `CAppDetailsSections.GetSections()` for shortcuts (`s = ["nonsteam", "notes", "screenshots"]`).
   - Restoring `"info"` in `RESTORED_SECTIONS` and hooking `props` on `targetPlayBar.prototype` and `k.prototype` fully restores the native ⓘ toggle button and expandable drawer on desktop normal mode.

**Steam rebuilds overview fields after we write them** (✅ verified live
2026-09-28). After a one-time enrichment of AM2R (`4263274102`), Steam's later
refresh of the app overview left `rt_original_release_date === 0` and
`m_setStoreCategories` empty, while `appData.descriptionsData` (our object)
survived. So a "write once" enrichment is not enough for overview fields. Before
2026-09-28 this was hidden by a render loop that re-wrote them ~150 times a second.
The M0a fix re-checks, on each Game Info render, whether the release date and
categories are still ours, and writes again only if not.

### Community media & Workshop store

Verified live 2026-09-30 (read-only CDP, module source dumps; native 435150 as the sample). Used by
features plan F2 (plan removed once done: `git show 585cc5c:docs/plans/steam-cartridges-f2-community-media-plan.md`) and ADR-0046. The earlier text here (media
files served through `steamloopback.host`, stubs in `m_mapPublishedFiles` feeding the section) came from a deleted
plan and was never true: the section does not read `CWorkshopStore`.

- **One component, both UIs.** Desktop section `community` and Big Picture's COMMUNITY tab (module `3375`, `lt`:
  `setSections.has("community") && jsx(wb, { appid: overview.appid })`) render `wb` (module `77163`). A shortcut's
  section list has no `community` unless we add it (`surfaces/sections`), so the tab is empty for an unmapped shortcut.
- **Classes.** `wb` = `le` (a function component: `useId`, then `jsx(oe, { labelId, ...props })`). `oe` is a mobx
  observer class holding `m_loader = new ae(appid)`; `ae` (not exported) is the loader. States `ne`: Init 0, Loading 1,
  MoreContent 2, OutOfContent 3, Errored 4. The first page loads 1 s after the section is bound **and** on screen
  (`DelayCheckAndLoadInitialContent`, an IntersectionObserver); later pages as the user scrolls. Client setting
  `library_disable_community_content` shows a Load button instead.
- **The fetch.** `ae.LoadCommunityContentAndVotes(appid, page)`: `f.uc` (module `14688`) GETs
  `${communityURL}library/appcommunityfeed/<appid>` (`rgSections: [2,4,3,9]`) and returns `hub[]`; then `F.dK`
  (module `20414`) asks `PublishedFile.GetUserVoteSummary` for those ids. Returns `{ vecContent, mapVotes }`. A page with
  no items ends the feed (OutOfContent, `#AppDetails_CommunityFeed_OutOfContent`). The method is a plain prototype
  method, called as `this.LoadCommunityContentAndVotes(...)`: patching `ae.prototype` covers every instance. A
  throwaway `new oe({ appid: 0, labelId: "" })` (constructor only: no mount, no request) exposes that prototype;
  verified: its loader shares the mounted section's prototype.
- **Card types** (`item.type`, EWorkshopFileType enum in module `44846`): `3` Artwork (`CvG`), `4` Video (`ADn`),
  `5` Screenshot (`pmA`), `9` WebGuide (`z41`), `10` IntegratedGuide (`QPp`); any other type renders nothing.
  - Artwork / Screenshot → `ye`: `preview_image_url` in an image; a click runs `Se`: `PublishedFile.GetDetails` for
    the id (CM service call), `ThreadStore.FindOrLoadThreadByPublishedFileID(new SteamID(creator.steamid), id)`, then
    Steam's fullscreen viewer (module `94715` export `N`: `{ strURL: full_image_url, strTitle, children: comments }`).
    Right-click: "Save screenshot" → `SteamClient.Browser.StartDownload(full_image_url)`.
  - Video → `Te` (exported as `kB`): 16:9 preview with Steam's play icon; activating it plays `youtube_video_id` inline
    in Steam's own YouTube player (module `4042` `N1`, `youtube-nocookie.com`). Only YouTube ids: no MP4.
  - Guide → `fe`: preview, title, BBCode `description` (module `82325` `T`, `[url]` supported); activating the card
    navigates to `CommunityFilePage` for the id.
  - Every card: author row (`creator.avatar`, `creator.name`; click → `SteamIDPage(creator.steamid)`), a menu with
    **Report** (`sharedfiles/reportitem` POST), and for artwork/screenshot/video **award**, **vote up/down**
    (`sharedfiles/voteup|votedown` POST) and a **comments** count (→ `CommunityFilePage`). A count shows only when it is
    not `null` (`comment_count`, `votes_for`, sum of `reactions`).
- **Card size.** `pe(item)`: video → 8 (VideoAspect), guides → 65; an image by aspect and width from `image_width` /
  `image_height`. An image **without** a size gets 0, matches no row template and is dropped (`No matching template`).
  The rule (module `77163`, verified 2026-10-01): `aspect = w / h`; shape = `aspect > 2.5 ? 16 : aspect > 1.4 ? 32 : 64`
  (`<= 0.8` → 128, a **tall** card); width = `w >= 1024 ? 4 : w > 512 ? 2 : 1`; size = shape | width. So a 16:9 image is
  **34** from 513 to 1023 px wide (IGDB screenshots at 1000 x 583: the ordinary small cell, about 317 x 262 to 373 on a
  1920-wide window) but **36** from 1024 px (1280 x 720, 1920 x 1080: a large cell, 317 x 426 to 618). A card's cell is
  fixed by these two numbers, **not** by the image: the card shows the image whatever its real dimensions, so a card can
  report a size that differs from its picture (the manual card reports 960 x 540 for a 1280 x 720 cover).
- **Row layout: the order of the cards is not the order of the feed** (verified 2026-10-01). `ae.AddCommunityContent`
  turns each item into a card `{ eSize, nWidth, item }` (`nWidth` from `Ae()`: 0 for a tall card, 3 for shape 16, 2 for
  size 8, else 1), then places the cards in one of two ways. (1) While `m_bHasEmptyRows` is true (Steam built
  placeholder rows when the section was bound) every placeholder cell takes the **first card of exactly the same `eSize`
  and `nWidth`**; a row with a cell no card fills is deleted (`No match for item`, in `webhelper_js.txt`). (2) Otherwise
  `BuildRowsForCards` takes the first card, keeps the row templates (`me()`: `Singles` eMatch 31 and several `OneTall`,
  eMatch 135, each with a tall card) whose `eMatch` shares a bit with it, **shuffles them with `Math.random`** (`o.fW`),
  and fills the first template that `he()` can complete from the rest of the list (an `nItemSpace` cell takes the first
  card whose weight fits; an `eFixedCard` cell takes the first card with that bit). A card no template can start is
  removed from the list (`splice(0, 1)`). Consequences: the same feed can lay out differently on every load, the first
  feed item is **not** guaranteed the top-left cell, and a card whose size no template can start may be dropped.
  Observed 2026-10-01: with the manual card reported at 1280 x 720 (size 36) it was dropped; at 960 x 540 (size 34) it
  shows, but in the third row of the first layout seen.
- **Fields the card code reads** (live sample): `published_file_id` (string), `type`, `title`, `description`,
  `preview_image_url`, `full_image_url`, `image_width`, `image_height`, `youtube_video_id`, `comment_count`,
  `votes_for`, `content_descriptorids` (**must be an array**: filtered with `indexOf` against the user's content
  preferences), `spoiler_tag`, `rating_stars`, `maybe_inappropriate_sex`, `maybe_inappropriate_violence`,
  `creator { name, steamid, avatar, online_state }`, `reactions []`. `new SteamID("0")` is valid.
- **Images from other hosts load in Steam's UI:** no CSP on `steamloopback.host/index.html`; `images.igdb.com` and
  `img.youtube.com` load in an `<img>` and answer `fetch` with CORS. ScreenScraper does not allow a cross-origin fetch
  ([knowledgebase](knowledgebase.md#image-hosts-seen-from-steams-ui)).

## Links, navigation and native content for a mapped shortcut

Verified live 2026-09-25, desktop, read-only CDP (module ids are this build's
breadcrumbs; resolve by the signatures at the end). Subjects: shortcut
2315502503 (Jotunnslayer, Epic copy, Game Info enriched), native 2820820 (not
owned), 435150 (owned). Used by
[ADR-0038](decisions.md#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app).
A live crash found in this same area (the Friends section, unowned native apps —
Steam's own `ne(appid)` helper in module 2326 calling
`appStore.GetAppOverviewByAppID(appid).BIsApplicationOrTool()` with no null guard)
was fixed 2026-09-26; see
[knowledgebase.md's `appStore.GetAppOverviewByAppID` entry](knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all)
for the reusable lesson and CHANGELOG.md for the fix record.

### Store categories and feature badges

- Game Info's inner component (module `15448`) draws 15 `FeaturesList` badges with
  `n$({ overview, feature })` (module `28346`, feature table `w`). Each asks module
  `14629` `Xr(overview)(feature)`, which calls `overview.BHasStoreCategory(id)`:

  | Badge (`#AppDetails_Feature_*`) | Store category ids | Other source |
  | --- | --- | --- |
  | SinglePlayer | 2 | — |
  | MultiPlayer | 1, 36, 37, 27, 20, 24 | — |
  | CoOp | 9, 38, 39 | — |
  | FullController | 28 | `xbox_controller_support == 2` |
  | PartialController (only when not full) | 18, 28 | `xbox_controller_support` 1 or 2 |
  | PS4 / PS5 controller | 55, 56 / 57, 58 | — |
  | VRSupport | 31 | `vr_supported` |
  | HDR | 61 | — |
  | SteamAchievements | 22 | — |
  | SteamCloud | 23 | — |
  | SteamWorkshop | 30 | — |
  | RemotePlayTogether | 44 | — |
  | SteamInputAPI | 59 | — |
  | FamilySharing | 62 | — |

  There is **no Shared/Split Screen badge**: 24 only feeds MultiPlayer. 29 (Trading
  Cards) and 60 exist only as library filters.
- `StoreItemCache` items split categories into three groups,
  `m_StoreCategories = { supported_player_categoryids, feature_categoryids, controller_categoryids }`,
  with accessors `GetStoreCategories_SupportedPlayers / _Features / _Controller()`.
  2820820: `[2, 1, 9, 39, 24]` / `[22, 29, 23, 44, 62]` / `[28]`; 435150:
  `[2, 1, 49, 36, 37, 9, 38, 39, 24]` / `[22, 29, 13, 30, 23, 17, 42, 43, 44, 62]` / `[28]`.
  The feature group is Steam services (plus 13 captions and 17 level editor). Items
  also expose `GetTagIDs()` (20 ids), `GetAllLanguagesWithSomeSupport()`,
  `GetFilteredReviewSummary()`, `GetPlatforms()`.
- `AppOverview` of an owned app also carries `m_setStoreTags`, `metacritic_score`,
  `bitfield_supported_languages`, `review_score_*` / `review_percentage_*` and
  `steam_hw_compat_category_packed` (all zero on a shortcut). They feed library
  sorting and dynamic-collection filters, not the app page.

### The links bar (module `52470`, export `Qd`)

- Built in a computed only when `!overview.BIsModOrShortcut()`, from
  `i = overview.appid` (a demo's parent for `app_type` demo): Store Page
  `urlStore.BuildStoreAppURL(appid, "primarylinks")`; DLC `BuildStoreAppDlcURL` when
  `details.bAvailableContentOnStore`; Community Hub `link: "GameHub"`; Points Shop
  `BuildAppPointsShopURL` when the app has points-shop cards; Discussions
  `"GameHubDiscussions"`; Guides `"GameHubGuides"`; Workshop `"SteamWorkshopPage"`
  when the `workshopVisible` prop is true; Market `"CommunityMarketApp"` when
  `marketPresence`; Support `"HelpAppPage"` unless kiosk mode.
- Each entry renders `P` (export `aX`): `url ?? urlStore.ResolveURL(link, appid)`,
  opened with `Navigator.SteamWeb` (module `18057` `Qt`, Steam's in-client browser).
  Desktop row `O`, Big Picture carousel `z`.
- Rendered with jsx by the desktop page (module `59856`,
  `jsx(k.Qd, { overview, details, workshopVisible, marketPresence })`) and by Big
  Picture's Game Info (module `3375`, inside `GameInfoQuickLinks`).
- **For a shortcut:** no links until Game Info is enriched; then our prototype hook
  (`game-info-patch.ts` `ensureAppOverviewHooked`, `BIsModOrShortcut` false for
  `enrichedAppIds`) makes Steam build them from the shortcut appid. Live props:
  `https://store.steampowered.com/app/2315502503?snr=5000_5100__`, `GameHub` /
  `GameHubDiscussions` / `GameHubGuides` / `HelpAppPage` with `appid: 2315502503`.
- `window.urlStore` (CURLStore, module `87935` `B7`) resolves Steam's URL ids from
  `SteamClient.URL.GetSteamURLList`. For 2820820: `GameHub` →
  `https://steamcommunity.com/app/2820820/`, `GameHubDiscussions` → `…/discussions/`,
  `GameHubGuides` → `…/guides/`, `SteamWorkshopPage` → `…/workshop/`, `HelpAppPage` →
  `https://help.steampowered.com/en/wizard/HelpWithGame/?appid=2820820`, `StoreAppPage` →
  `https://store.steampowered.com/app/2820820/`, `GameHubNews` / `AppNewsPage` → the
  store news hub.

### Header buttons: Manage and Properties

- The desktop header (module `56262`) has the gear "Manage" button, which opens the
  app context menu (module `5808`, class `Fe`), the ⓘ Game Info toggle (shown when
  `!BIsModOrShortcut()`) and the favourite star.
- `Fe` builds its items from `app_type` and local install state, not from
  `BIsModOrShortcut`: "Properties…" is `navigator.AppProperties(appid)` (the
  shortcut's own dialog), and the Manage submenu holds desktop shortcut, custom
  artwork, browse local files, hide and "Remove non-Steam game from your library".
- Only "Mark as Private" (`Ge`) keys on `BIsModOrShortcut()`. Our prototype hook
  makes it enabled for an enriched shortcut, where it would send the shortcut appid
  to the private-apps service. **Fixed 2026-09-29 (K4):** `native-links` gives that menu item apps that report `BIsModOrShortcut() === true` for shortcuts (identified once from the component source token `GameAction_MarkAsPrivate_NoShortcuts`), and Steam disables it with its own note.
- **The Properties dialog is a separate popup, rendered from SharedJSContext**
  (✅ verified live 2026-09-28). `Navigator.AppProperties(appid)` opens a
  `g_PopupManager`-registered window (CDP target titled with the game's name,
  URL `about:blank?createflags=4114&minwidth=842&minheight=601…`). It appears in
  `g_PopupManager.m_mapPopups`. For a shortcut, its DOM contains elements whose
  class names contain `Shortcut`, so a "find the Game Info element by
  `[class*=Shortcut]`" query matches the **Properties** dialog as well. Its React
  tree is large, and it re-renders whenever the app's overview or details change.
  Plugin code that force-updates "every window" therefore force-updates
  Properties too. That is what hung Steam
  (migration plan § 1.3).

### `Navigator.App` (module `874`)

- Each Steam UI window has a plain `Navigator` object
  (`SteamUIStore.WindowStore.SteamUIWindows[i].Navigator`, the same object as
  `SteamUIStore.ActiveWindowInstance.Navigator`). Components get it from React
  context or from that global (module `79112` `br()`). Keys: `Home`, `App`,
  `MyAchievements`, `FriendAchievements`, `GlobalAchievements`, `AllCollections`,
  `Collection`, `Downloads`, `AppProperties`, `Console`, `Chat`, `Settings`,
  `SteamWeb`, `SteamWebTab`, `ExternalWeb`, `Media`, … The properties are writable
  (`configurable: true`).
- `App(appid, { strCollectionId, gidPartnerEvent }, extra)` returns at once when
  `appStore.GetAppOverviewByAppID(appid)` is missing, i.e. for every unowned app.
  With `gidPartnerEvent` it pushes `/library/app/<appid>` with route state
  `event_to_show: { appid, eventid, clanSteamID, additionalParams }` (module `58437`
  `KV`).
- Live: `Navigator.App(2820820, { gidPartnerEvent })` from the shortcut page left the
  route unchanged.

### Partner event overlay (module `46776`, export `z`)

- Drawn at library level over any page: desktop (module `53822`, `ca()`) and Big
  Picture (module `3375`, `RA()`) read `event_to_show` from the current route
  state and render `z({ onClose, showAppIcon, appid, initialEventID, clanSteamID, additionalParams })`.
- Class `dr`: `GetClanEventModel(initialEventID)` (cached by GID), otherwise
  `LoadAdjacentPartnerEvents(gid, clan, appid, 0, 3, …)`. `BHasValidEvent()` is false
  when `props.appid && event.appid != props.appid`, and then it renders nothing. The
  app icon calls `navigator.App(props.appid)`.
- Live, on `/library/app/2315502503`: `event_to_show: { appid: 2315502503, eventid: "692016318956700209" }`
  drew nothing; `{ appid: 2820820, … }` drew the Jotunnslayer news with its adjacent
  events. Closed with `MainWindowBrowserManager.m_history.replace(path, {})`.

### Activity news cards (module `80478`)

- `dt` sends `PostedAnnouncement` (1002) straight to `Be`, before the store-item
  visibility check that other event types need (for `event.appid`).
- A news card click is `fe(navigator, eventModel)`, i.e.
  `navigator.App(eventModel.appid, { gidPartnerEvent: eventModel.GID })`. Comments open
  `COMMUNITY_BASE_URL + "app/<event.appid>/eventcomments/<forumTopicGID>"`.
- 2820820's entry holds one event: class `J`, `eEventType` 1002, `appid` 2820820 (a
  getter from `gameid`), `announcementGID` "692016318956700210", `unUniqueID` 1 (a
  per-store counter, not an identity). Its model: `GID` "692016318956700209", clan
  103582791474423883, type 28.

### Community Content (module `77163`, export `wb`) and Friends (module `2326`)

**Module ids moved with Steam build 1791918634 (2026-10-14):** the cards and their author row (`AuthorSection`: avatar
`b.Ul` with `strAvatarURL: creator.avatar`, `onClick: SteamIDPage(creator.steamid)`; name a plain `div`) are in module `88317`,
the image viewer (`N`, "Created by" row: avatar `fH` with `friend`, name with `persona` and an `onContextMenu`) in `39608`.
The ids below are the older build's; resolve by content (`showVotingControls`, `ArtworkModalDetails`), never by id.

Verified live 2026-09-30 (Big Picture): a card is `Ce` > `_e` (image card `ye`, author row `ve`, menu button `Ie` with prop
`onReported`, controls row `xe` with prop `showVotingControls`); `xe` has the award, thumbs and comments buttons. An image click
runs `Se(event, card)`: `PublishedFile.GetDetails` for the card's id, then module `94715`'s `N({ strURL, strTitle, children:
comment thread, appid, file_details })`. The viewer (`I` in `94715`) shows the "Created by" row only when `file_details` is
set (`{ creator: steamid string, time_created, file_description }`; the row looks the creator up in the friends store and renders
its persona); an appid in it makes Steam load app info (asserts for a non-Steam app). Desktop mode on this machine failed to
open the viewer with `CVRPathHelpers not found` (a Steam-internal native call, native cards too); Big Picture opens it.

**Loading state** (verified live 2026-10-01). When the section is bound Steam builds placeholder rows (`m_bHasEmptyRows`;
10 rows, two CSS-animated elements on this build) and shows them while `LoadCommunityContentAndVotes` is pending; the cards
replace them when the promise resolves. So a plugin that answers late keeps Steam's own loading animation for free:
`surfaces/community` returns a held promise for a shortcut whose media is still being fetched, and answers it with the
feed (or an empty page) when the media settles. The section itself must be in the page's section list first
(`surfaces/sections` adds `community` while the media is unknown or pending, `wantsCommunitySection`), otherwise nothing
shows until the feed is ready (16 s of blank page on a cold game). Steam keeps the feed it was served: a cover or
image that arrives after the first page is served does not reach the cards already built, and the viewer is handed the
URL the **card** had, so every URL a card could have carried must stay known to the viewer hook.

**The viewer's text and layout** (`I` in `94715`, verified 2026-10-01): props `{ children, closeModal, appid, file_details,
title, artworkURL, window, nMaxScreenPercentage, screenshot, ... }`. The image is `ArtworkImage` (capped at
`maxHeight: 600px` in Big Picture); under it `ArtworkModalDetails` holds the header (the Close button
`ModalArtCloseButton`, then, **only when `children` is set**, a `ScrollForMore` div:
`jsxs("div", { className: "…ScrollForMore…", children: [arrow, text, arrow] })`) and a `ChildrenContainer` that renders
`children`. The text is the localisation token `#ArtworkModal_ScrollForMore` ("Scroll down for comments") when
`file_details` is set, else `#ArtworkModal_ScrollForDetails`; it is a plain string child of a string-typed `div`, so a
jsx hook can swap it (we do, for a manual: "Scroll down to view the manual"). The container scrolls on the D-pad (100 px
per press, smooth) and the mouse wheel. Right-click on the image: "Save screenshot" (`StartDownload(artworkURL)`).
Desktop mode opened the viewer on 2026-10-01 for the manual card (earlier notes of `CVRPathHelpers not found` did not
reproduce for it).

- `wb({ appid })` → class `oe` → loader `ae(appid)` (`m_unAppID`); it loads pages when
  on screen (unless `library_disable_community_content` is set, which shows a Load
  button). Cards open `CommunityFilePage` by `published_file_id`: no appid involved.
  Rendered by the desktop page (section `community`, `{ appid: overview.appid }`) and
  Big Picture (`lt`, when `setSections.has("community")`).
- Live: the loader under `[class*="CommunityContentContainer"]` had
  `m_unAppID` 2315502503. The section shows at all only because the prototype hook
  makes `GetSections` return the native list for an enriched shortcut.
- Friends: desktop `yj({ details })`, Big Picture `w4({ details })`, both read
  `details.unAppID`.

### Resolution signatures (one module each on this build)

| Component | Factory-source needles | Module here |
| --- | --- | --- |
| Links bar | `"#AppDetails_Links_Store"` + `"primarylinks"` | `52470` (`Qd`, `aX`) |
| Friends section | `"CommunityFriendsThatPlay"` + `"#AppDetails_SectionTitle_Friends"` | `2326` |
| Community Content | `"#AppDetails_SectionTitle_Community"` + `LoadAdditionalContent` | `77163` (`wb`, `kB`) |
| Partner event overlay | `"LibraryAppPartnerEventsPage unmounting"` + `LoadAdjacentPartnerEvents` | `46776` (`z`) |
| Navigator | `SteamUIStore.WindowStore.SteamUIWindows[i].Navigator` (global, no scan) | `874` |
| URL ids | `window.urlStore.ResolveURL(id, appid)` (global) | `87935` |
