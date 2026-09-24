# Steam Architecture & Module Reference

A high-level directory of Steam Client internals, webpack modules, backing stores, and APIs for plugin developers.

> **Deep Implementation Details:** For complete reverse-engineering traces, prototype dumps, and verified CEF DevTools inspection sessions, refer to [**`docs/steam-components.md`**](steam-components.md).

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
  └──► Big Picture     (SP BPM_...)      ── renders Gamepad UI (ports into SharedJSContext)
```

- **`SharedJSContext`:** Every store, MobX observable, and background service lives here. When modifying data or registering React Portals, do so in `SharedJSContext`.
- **Desktop vs. Big Picture:** Both run off the same JavaScript runtime in `SharedJSContext`. Big Picture is simply a fullscreen popup window rendering Gamepad UI components.

---

## 2. Core Stores & Modules Quick Reference

| Feature Area            | Module / Store                                    | Key Methods & Properties                                                                           | Purpose in Plugins                                                                                                 |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **App Detail Sections** | `CAppDetailsSections`                             | `prototype.GetSections(overview, details)`                                                         | Section registry. Filtered by `BIsModOrShortcut()`. Re-enable `"postgamesummary"`, `"activity"`, `"achievements"`. |
| **Post-Game Summary**   | `CAppSpotlightStore` (`window.appSpotlightStore`) | `GetOrCreateAppData(appid).m_session`, `PushSessionEvent`, `AddAchievement`, `AddClip`             | Populates the top hero summary card with screenshots, clips, and achievements.                                     |
| **Activity Feed**       | `appActivityStore`                                | `GetAppActivity(appid)`, `appActivityByDay`, `CActivityDay.prototype.AddEvent`                     | Populates chronological per-day activity feed cards.                                                               |
| **Store Item Cache**    | `StoreItemCache` (`window.StoreItemCache`)        | `m_mapApps.set(appid, stubApp)`, `GetStoreItem(appid)`                                             | In-memory stubbing to satisfy Steam's `storeApp.BIsVisible()` event guard without network requests.                |
| **Native Achievements** | `AppDetailsStore`                                 | `GetAchievements(appid)`, `GetAppData(appid).details.achievements`                                 | Populates the native desktop achievement sidebar (`HighlightDiv`, percentage bar, locked list).                    |
| **Play Bar Progress**   | `appAchievementProgressCache`                     | `m_achievementProgress.mapCache.get(appid)`                                                        | Supplies `{ unlocked, total }` counts displayed under the Big Picture Play button.                                 |
| **Notification Engine** | `window.NotificationStore`                        | `OnNotification(id, type, pbData)`, `ChooseSound`, `PlayNotificationSound`                         | Dispatches genuine native achievement toasts, sounds, and animations (`CAchievementNotification`).                 |
| **Game Recording RPCs** | `CGameRecordingService` (module `80026`)          | `GameRecording.SaveClip#1`, `UserAddTimelineEntry#1`, `TakeScreenshot#1`                           | Inserts golden timeline markers, creates instant replay clips, and triggers timeline screenshots.                  |
| **Recording Timeline**  | `TimelineManager` (module `22588`)                | `AddEventToTimeline`, `AddUserMarker`, `InsertEntryIntoTimelineSorted`                             | Client-side timeline state and clip name generator.                                                                |
| **Custom Artwork**      | `SteamClient.Apps`                                | `SetCustomArtworkForApp(appid, base64, ext, type)`                                                 | Sets portrait (0), hero (1), logo (2), and wide capsule (3) artwork directly.                                      |
| **Gamepad Tabbed Page** | `GamepadTabbedPage`                               | Intercept `props.tabs` via `react/jsx-runtime`                                                     | Injects custom tabs (e.g. RetroAchievements, Game Info) into Big Picture's tab bar.                                |
| **Gamepad Components**  | Gamepad UI Library                                | `<Focusable>`, `DialogButton`, `<Carousel>`, `showModal`                                           | Native Big Picture UI building blocks with automatic controller navigation.                                        |
| **AppOverview Model**   | `AppOverview.prototype`                           | `GetGameID()`, `BIsModOrShortcut()`, `BHasStoreCategory()`, `m_gameid`, `rt_original_release_date` | Fundamental per-app data model. Hook `GetGameID` whenever modifying `BIsModOrShortcut` to protect media queries.   |
| **Game Info Container** | Module `15448` (`G` & `k`)                        | `onCollapseStarted`, `onCollapseComplete`, `setBoxHeight`, `descriptionsData`, `associationData`   | Renders native summary capsule, description, developer/publisher credits, release date, and category badges.       |
| **Your Stuff Media**    | Module `57150` (`Ae.E`)                           | `listSource: { type: "app", gameid: overview.gameid }`                                             | Renders Big Picture "YOUR STUFF" media section (screenshots & clips). Requires 64-bit composed ID `m_gameid`.      |

---

## 3. Stable Resolution Cheat Sheet

Numeric webpack module IDs reshuffle between Steam client builds. **Always resolve modules and stores by minification-proof method signatures:**

```ts
/** Find an export by inspecting prototype method names */
export function findStore<T>(predicate: (proto: any) => boolean): T | null {
    let req: any;
    const key = "__res_" + Math.random().toString(36).slice(2);
    (window as any).webpackChunksteamui.push([
        [key],
        {
            [key]: (_m: any, _e: any, r: any) => {
                req = r;
            },
        },
        (r: any) => {
            r((r.s = key));
        },
    ]);

    for (const id in req.m) {
        try {
            const exp = req(id);
            for (const k of ["", "default", ...Object.keys(exp || {})]) {
                const item = k ? exp[k] : exp;
                if (item?.prototype && predicate(item.prototype)) return item;
                if (item && predicate(item)) return item;
            }
        } catch (_) {}
    }
    return null;
}
```

### Stable Signatures to Target:

- **`CAppSpotlightStore`:** `proto => typeof proto.GetPostGameSummary === 'function' && typeof proto.GetOrCreateAppData === 'function'`
- **`CAppDetailsSections`:** `proto => typeof proto.GetSections === 'function' && typeof proto.GetSubSections === 'function'`
- **`AppDetailsStore`:** `proto => typeof proto.GetAchievements === 'function' && typeof proto.GetAssociations === 'function'`
- **`StoreItemCache`:** `proto => typeof proto.GetStoreItem === 'function' && typeof proto.QueueStoreItemRequest === 'function'`
- **`GameRecordingService`:** `proto => typeof proto.SaveClip === 'function' && typeof proto.UserAddTimelineEntry === 'function'`
- **`Game Info Container (G)`:** `proto => typeof proto.onCollapseStarted === 'function' && typeof proto.onCollapseComplete === 'function' && typeof proto.setBoxHeight === 'function'`

---

## 4. The Component Reuse Hierarchy

When designing plugin features, always operate on the lowest valid rung:

1. **Rung 1: Restore Filtered Sections** — Re-enable sections Steam hides by app type in `GetSections()`.
2. **Rung 2: Feed Steam's Native Stores** — Inject data into `appSpotlightStore`, `appActivityStore`, or `AppDetailsStore`. Steam renders the entire UI automatically.
3. **Rung 3: Render Steam's Real Components** — In Big Picture, mount `<Focusable>`, `DialogButton`, or inject custom tabs via `GamepadTabbedPage`.
4. **Rung 4: Clone Native DOM Blocks (Last Resort)** — For custom UI, mirror existing native elements from CEF DevTools using resolved CSS module classes. Never hand-measure or hand-author CSS styles.
