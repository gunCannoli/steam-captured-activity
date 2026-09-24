# Steam Architecture & Module Reference

**This doc's job:** the one-page map of Steam's client internals — where
everything runs, which store or module owns each feature, and the **stable
signature** to resolve each one by. Start here when investigating a feature,
then follow the links into [steam-components.md](steam-components.md) for the
full trace.

Not here: deep traces and verified inspection sessions
([steam-components.md](steam-components.md)); how to probe the client
([steam-debug.md](steam-debug.md)); the rules and the reuse ladder for plugin
code ([plugins.md](plugins.md)).

---

## 1. Runtime Topology

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
- **Desktop vs. Big Picture:** Both run off the same JavaScript runtime in `SharedJSContext`. Big Picture is simply a fullscreen popup window rendering Gamepad UI components ([steam-components.md § Big Picture Mode](steam-components.md#big-picture-mode)).
- **Not every popup is tracked.** Most windows register with `g_PopupManager`; BrowserView popups (Quick Access, main menu, Big Picture's toast window) do not ([plugins.md guardrail 12](plugins.md#12-popup-hooks-do-not-see-every-window)).

---

## 2. Core Stores & Modules

Module ids are one build's breadcrumbs; resolve by § 3.

| Feature Area            | Module / Store                                    | Key Methods & Properties                                                                           | Purpose in Plugins                                                                                                 | Deep dive |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| **App Detail Sections** | `CAppDetailsSections`                             | `prototype.GetSections(overview, details)`                                                         | Section registry. Filtered by `BIsModOrShortcut()`. Re-enable `"postgamesummary"`, `"activity"`, `"achievements"`. | [skeleton](steam-components.md#the-app-detail-page-skeleton) |
| **Post-Game Summary**   | `CAppSpotlightStore` (`window.appSpotlightStore`) | `GetOrCreateAppData(appid).m_session`, `PushSessionEvent`, `AddAchievement`, `AddClip`             | Populates the top hero summary card with screenshots, clips, and achievements.                                     | [summary](steam-components.md#post-game-summary) |
| **Activity Feed**       | `appActivityStore`                                | `GetAppActivity(appid)`, `appActivityByDay`, `CActivityDay.prototype.AddEvent`                     | Populates chronological per-day activity feed cards.                                                               | [activity](steam-components.md#activity-feed) |
| **Store Item Cache**    | `StoreItemCache` (`window.StoreItemCache`)        | `m_mapApps.set(appid, stubApp)`, `GetStoreItem(appid)`                                             | In-memory stubbing to satisfy Steam's `storeApp.BIsVisible()` event guard without network requests.                | [blocker](steam-components.md#the-store-record-blocker) |
| **Native Achievements** | `AppDetailsStore`                                 | `GetAchievements(appid)`, `GetAppData(appid).details.achievements`                                 | Populates the native desktop achievement sidebar (`HighlightDiv`, percentage bar, locked list).                    | [achievements](steam-components.md#native-achievement-ui--backing-store) |
| **Play Bar Progress**   | `appAchievementProgressCache`                     | `m_achievementProgress.mapCache.get(appid)`                                                        | Supplies `{ unlocked, total }` counts displayed under the Big Picture Play button.                                 | [achievements](steam-components.md#native-achievement-ui--backing-store) |
| **Notification Engine** | `window.NotificationStore`                        | `OnNotification(id, type, pbData)`, `ChooseSound`, `PlayNotificationSound`                         | Dispatches genuine native toasts, sounds, and animations (`CAchievementNotification`).                             | [notifications](steam-components.md#achievement-notifications-notificationstore) |
| **Game Recording RPCs** | `CGameRecordingService` (resolve by signature, not module id) | `GetClips`, `GameRecording.SaveClip#1`, `UserAddTimelineEntry#1`, `TakeScreenshot#1` (frame from already-recorded video, not a live grab) | Reads clips; inserts timeline markers, creates instant replay clips, triggers timeline screenshots. `SteamClient.Screenshots.*` is read/manage only — nothing under `SteamClient.*` triggers a live capture. | [recording](steam-components.md#game-recording-rpcs--timeline-markers) |
| **Live recording store** | `window.g_GRS` (`CGameRecordingStore`)           | `m_mapActiveTimelines`, loader `BIsTimelineRunning`/`GetRunningTimelineDurationMS`/`GetGameID`/`GetTimelineStartBeforeGlobalZeroMS`, `m_mapRunningTimelines` | Per-game running timelines and live recording state; read fresh every time, never cached. | [recording](steam-components.md#game-recording-rpcs--timeline-markers) |
| **Recording Timeline**  | `TimelineManager` (module `22588`)                | `AddEventToTimeline`, `AddUserMarker`, `InsertEntryIntoTimelineSorted`                             | Client-side timeline state and clip name generator.                                                                | — |
| **Custom Artwork**      | `SteamClient.Apps`                                | `SetCustomArtworkForApp(appid, base64, ext, type)`                                                 | Sets portrait (0), hero (1), logo (2), and wide capsule (3) artwork directly.                                      | [artwork](steam-components.md#custom-artwork-api) |
| **Gamepad Tabbed Page** | `GamepadTabbedPage`                               | Intercept `props.tabs` via `react/jsx-runtime`                                                     | Injects custom tabs (e.g. RetroAchievements, Game Info) into Big Picture's tab bar.                                | [tabs](steam-components.md#tab-construction--custom-tab-injection) |
| **Gamepad Components**  | Gamepad UI Library                                | `<Focusable>`, `DialogButton`, `<Carousel>`, `showModal`                                           | Native Big Picture UI building blocks with automatic controller navigation.                                        | [navigation](steam-components.md#gamepad-navigation-system) |
| **AppOverview Model**   | `AppOverview.prototype`                           | `GetGameID()`, `BIsModOrShortcut()`, `BHasStoreCategory()`, `m_gameid`, `rt_original_release_date` | Fundamental per-app data model. Hook `GetGameID` whenever modifying `BIsModOrShortcut` ([guardrail 1](plugins.md#1-prototype-hook-coupling-bismodorshortcut-vs-getgameid)). | — |
| **Game Info Container** | Module `15448` (`G` & `k`)                        | `onCollapseStarted`, `onCollapseComplete`, `setBoxHeight`, `descriptionsData`, `associationData`   | Renders native summary capsule, description, developer/publisher credits, release date, and category badges.       | [game info](steam-components.md#game-info-tab--metadata) |
| **Your Stuff Media**    | Module `57150` (`Ae.E`)                           | `listSource: { type: "app", gameid: overview.gameid }`                                             | Renders Big Picture "YOUR STUFF" media section (screenshots & clips). Requires 64-bit composed ID `m_gameid`.      | [guardrail 1](plugins.md#1-prototype-hook-coupling-bismodorshortcut-vs-getgameid) |

---

## 3. Stable Resolution Signatures

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
| `NotificationStore` & toasts  | `window.NotificationStore`; dispatcher, eTypes and toast windows per [steam-components.md § Resolution signatures & toast windows](steam-components.md#resolution-signatures--toast-windows) | `enhanced-achievements`, `enhanced-notifications` |
| Post-Game Summary styles      | class-map probe key `GamePlaySummaryContainer` (the page spans four CSS modules: [list](steam-components.md#rendered-dom-and-css-modules)) | `non-steam-games-activity/frontend/index.tsx` |
| Activity feed styles          | class-map probe key `AppActivityDay` / `AppActivityDate`                                              | `stores.ts`, `activity.ts` |
| Big Picture toast placeholder | class-map probe key `GamepadToastPlaceholder`                                                         | `enhanced-notifications/frontend/steam/selectors.ts` |

The store singletons are long-lived MobX objects: resolve once and cache.
