# Steam Client Modification Baseline & Comprehensive Regression Hardening Guide

**Status:** Active Repository Baseline · **Priority:** Foundational Architectural Standard  
**Applies to:** `non-steam-games-activity` (Core), `steamgriddb-artwork` (Metadata/Artwork), and all future providers.

---

## 1. Executive Summary & Philosophy

Modifying the Steam client (both Desktop and Big Picture Mode / Gamepad UI) requires interacting with Steam's internal Webpack modules, MobX backing stores, and React prototype chains. Because Steam runs in an asynchronous Chromium Embedded Framework (CEF) runtime where `SharedJSContext` serves as a persistent singleton host while popup windows mount and unmount via `ReactDOM.createPortal`, **uncoordinated modifications in one tab silently break completely unrelated tabs**.

This document is the **master baseline and diagnostic playbook**. It consolidates every hard-won lesson, documents every regression we have encountered across every tab (**Activity**, **Game Info**, **Your Stuff**, and **Global UI Performance**), defines the architectural rules for safe Steam modification, and provides automated CDP debugging tools so any agent can diagnose and verify fixes in seconds.

---

## 2. Complete Catalog of Regressions Across All Tabs

### A. The "YOUR STUFF" Tab Media Wipeout (ID Coupling Breakdown)

* **Tab Affected:** Big Picture Mode ➔ "YOUR STUFF" ➔ Media Section (`Ae.E` in module `57150`).
* **User-Facing Symptom:** Navigating to a non-Steam shortcut with existing screenshots and recordings showed the empty placeholder: *"You can take a screenshot by pressing..."*.
* **Root Cause & Decompiled Breakdown:**
  Steam's native `AppOverview.prototype.GetGameID()` is implemented as:
  ```javascript
  GetGameID() {
      return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString();
  }
  ```
  To allow the Game Info tab to render rich descriptions and developer credits, `AppOverview.prototype.BIsModOrShortcut` was hooked to return `false` for enriched shortcuts.
  However, the Media section queries captures via `overview.gameid` (which delegates to `GetGameID()`). Because `BIsModOrShortcut()` returned `false`, `GetGameID()` evaluated to `this.appid.toString()` (`"4263274102"`). Shortcut screenshots in `screenshots.vdf` and clips in `window.g_GRS` are strictly keyed by the composed 64-bit ID (`"18310622842007322624"`). Querying by 32-bit `appid` returned 0 items!
* **The Permanent Baseline Rule:**
  **Never alter `BIsModOrShortcut` without explicitly decoupling `GetGameID` on `AppOverview.prototype`:**
  ```typescript
  curr.GetGameID = function () {
      if (this.m_gameid) return this.m_gameid;
      return origGetGameID.apply(this, arguments);
  };
  ```
  In section registry logic (`sections.ts`), never test `overview.BIsModOrShortcut()` alone; always use `overview.appid >= 0x8000_0000 || overview.BIsModOrShortcut()`.

---

### B. The "ACTIVITY" Tab Blank Body (Negative Cache Poisoning)

* **Tab Affected:** Big Picture Mode ➔ "ACTIVITY" Tab (and Desktop Activity section).
* **User-Facing Symptom:** On initial launch, daily activity events rendered. But after navigating away (`AM2R -> Bloodstained / Library -> AM2R`), the Day Headers ("SEPTEMBER 20", "SEPTEMBER 19", "OCT 24, 2025") and divider rules remained visible, but the body content was an **empty `<div></div>`** with zero cards or headlines.
* **Root Cause & Decompiled Breakdown:**
  1. On view unpatch, `clearActivity(appid)` aggressively called `storeCache.m_mapApps.delete(appid)`.
  2. Asynchronously unmounting React components in module `82594` (`useStoreItemCache`, function `p`) detected a cache miss and called `QueueStoreItemRequest(appid)`.
  3. Because non-Steam shortcuts have no store entry, Steam's backend returned 404.
  4. Steam permanently added the appid to its negative cache: `StoreItemCache.m_setUnavailableApps.add(appid)`.
  5. On return navigation, `publishActivity` re-added the stub to `m_mapApps`, but in module `82594`:
     ```javascript
     if (c.A.Get().BIsStoreItemMissing(e, t)) return [void 0, u]; // Returns undefined!
     ```
     `BIsStoreItemMissing(appid)` checked `this.m_setUnavailableApps.has(appid)` ➔ evaluated to `true`!
  6. In module `80478`, the event component `dt` evaluated:
     ```javascript
     const [p] = lt(event.appid, D.A.k_DataRequest_Assets);
     if (event.appid && (!p || !p.BIsVisible())) return null; // Returns null!
     ```
     The entire event component returned `null`, rendering `<div className="AppDayContents"><div></div></div>`.
* **The Permanent Baseline Rule:**
  1. **In-memory stubs in `StoreItemCache.m_mapApps` must NEVER be deleted on view unmount.** They cost trivial RAM (~150 bytes) and keep Steam's store cache satisfied indefinitely.
  2. **Purge negative caches on publish:** Call `storeCache.m_setUnavailableApps.delete(appid)`.
  3. **Hook `StoreItemCache.prototype.BIsAppMissing`:** Return `false` for any `appid >= 0x8000_0000`.

---

### C. Big Picture 30-Second Navigation Freeze ($O(N)$ Hot-Path Overhead)

* **Tab Affected:** Big Picture Mode ➔ Entire UI & Navigation.
* **User-Facing Symptom:** Navigating between games in Big Picture Mode caused a 30+ second complete UI freeze where controller inputs were queued and audio stuttered.
* **Root Cause & Decompiled Breakdown:**
  Inside `AppOverview.prototype.BIsModOrShortcut`, an implementation attempted to check caller context by evaluating `new Error().stack`.
  Because `AppOverview` methods are called **hundreds of times per second** across MobX reactions, focus navigation trees, and React render loops, generating V8 stack traces completely choked the main thread.
* **The Permanent Baseline Rule:**
  **All prototype hooks must run in constant time ($O(1)$ strictly enforced).**
  Never generate error stacks, never execute regular expressions, and never perform DOM queries inside hot prototype methods. Only use fast in-memory Set lookups:
  ```typescript
  curr.BIsModOrShortcut = function () {
      if (enrichedAppIds.has(this.appid)) return false;
      return origBIsMod.apply(this, arguments);
  };
  ```

---

### D. Render-Loop Module Registry Scans ($O(N^2)$ Choke)

* **Tab Affected:** Activity Feed & Card Rendering.
* **User-Facing Symptom:** Significant UI frame drops and sluggish scrolling when viewing large capture feeds.
* **Root Cause & Decompiled Breakdown:**
  Webpack module scanning (`Object.keys(req.m)`) was executed inside component render functions or event handlers. With thousands of modules in Steam's client bundle, scanning `req.m` on every render produced an $O(N^2)$ CPU stall.
* **The Permanent Baseline Rule:**
  **Single-Pass Module Pre-Caching:** Scan `req.m` **once** at plugin startup (`initCardComponents()`), caching resolved component references in module-scoped variables.

---

### E. Activity Card Sizing Blowout & Flex-Shrink Cutouts

* **Tab Affected:** Big Picture Activity Feed Cards.
* **User-Facing Symptoms:**
  1. High-resolution screenshots (1440p/4K) stretched across the full viewport.
  2. CSS scoping conflicts caused parent flex containers to compress cards down into tiny ~80px cutouts.
* **Root Cause & Decompiled Breakdown:**
  Steam's community `ScreenshotCarousel` CSS classes (`CarouselThumb` vs `CarouselThumbs`) share substring patterns. Broad attribute selectors `[class*="CarouselThumb"]` applied thumbnail sizing rules to the parent container, breaking flex layout.
* **The Permanent Baseline Rule:**
  Disambiguate attribute selectors:
  ```css
  [class*="CarouselThumbs"] {
      display: flex !important;
      flex-direction: row !important;
      overflow-x: auto !important;
      gap: 16px !important;
      width: 100% !important;
  }
  [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) {
      width: 320px !important;
      height: 180px !important;
      flex: 0 0 320px !important;
  }
  ```

---

### F. Game Info Crash via Synthetic `appData.details` Mutation

* **Tab Affected:** Game Info Tab / Desktop Sidebar.
* **User-Facing Symptom:** Client crash or silent disappearance of the Game Info tab.
* **Root Cause & Decompiled Breakdown:**
  To feed developer metadata, an earlier patch initialized `appData.details = {}`. Native Steam components (`GameStatsSection`) expected internal store-only arrays (`vecChildConfigApps`, `unEntitledContentApp`) on `appData.details`. Accessing properties on an empty object triggered unhandled TypeErrors.
* **The Permanent Baseline Rule:**
  Never synthetically overwrite `appData.details`. Feed descriptions and credits strictly through Steam's dedicated data structures:
  `appData.descriptionsData = { strSnippet, strFullDescription }`
  `appData.associationData = { rgDevelopers, rgPublishers, rgFranchises }`

---

### G. Stale Category Badges & False Achievements Badge

* **Tab Affected:** Game Info Tab ➔ Right-hand Feature Badges (`FeaturesList`).
* **User-Facing Symptom:** Games without achievements (e.g. AM2R) displayed the "Achievements" badge, and switching games retained badges from previous titles.
* **Root Cause & Decompiled Breakdown:**
  `overview.m_setStoreCategories` is a persistent `Set<number>`. When switching titles or re-enriching, categories were added with `.add()` without clearing previously assigned managed categories, causing badges to accumulate indefinitely.
* **The Permanent Baseline Rule:**
  Before adding categories, always purge managed category IDs from `overview.m_setStoreCategories`:
  ```typescript
  for (const catId of Object.values(STEAM_CATEGORIES)) {
      overview.m_setStoreCategories.delete(catId);
  }
  ```

---

### H. Multi-Window Reactivity Desynchronization

* **Tab Affected:** Big Picture Mode Popup (`SP BPM_uid0`).
* **User-Facing Symptom:** Desktop UI updated immediately, but Big Picture Mode remained stale until navigating away and back.
* **Root Cause & Decompiled Breakdown:**
  Big Picture runs in a separate popup window whose DOM is mounted from `SharedJSContext` via a React portal. Updating MobX store records in `SharedJSContext` does not always trigger React fiber updates in child popup windows unless the window's mounted fiber instances are explicitly refreshed.
* **The Permanent Baseline Rule:**
  Discover active popup windows via `window.g_PopupManager.GetExistingPopup("SP BPM_uid0")` and walk mounted fiber trees to call `forceUpdate()` on live instances across both contexts.

---

## 3. The Steam Client Modification Architecture & Baseline Rules

To prevent regressions when adding new features (such as Achievements, Audio Chimes, Timeline Markers, or Guides), all code must adhere to this **Universal Modification Ladder**:

```
                  ┌─────────────────────────────────────────────────────────────┐
                  │          THE STEAM CLIENT MODIFICATION LADDER               │
                  └─────────────────────────────────────────────────────────────┘
  Rung 1 (BEST):  Restore what Steam already renders (Filter bypassing in sections)
        │
  Rung 2:         Feed Steam's own stores (appSpotlightStore, appActivityStore)
        │
  Rung 3:         Render Steam's real components (resolved via prototype signature)
        │
  Rung 4:         Safe Prototype Hooking (strictly decoupled, O(1) set lookups)
        │
  Rung 5 (LAST):  Clone Steam DOM / Custom UI (Only if no native component exists)
```

### The Invariable Rules:
1. **Never author hand-crafted CSS to imitate Steam.** Use resolved class modules or clone native DOM structures from CEF DevTools.
2. **Never delete in-memory stubs from global caches during unmount transitions.**
3. **Never inspect call stacks (`new Error().stack`) in prototype methods.**
4. **All prototype hooks must run in $O(1)$ constant time.**
5. **Always test a two-way navigation lifecycle loop (`Game A ➔ Game B ➔ Game A`).**

---

## 4. Drop-In Implementation: Phase 4b (Activity Resilience Fix)

The following changes must be applied to `non-steam-games-activity/frontend/steam/activity.ts` to implement the Phase 4b fix:

### 1. In `clearActivity(appid: number)`:
Do **NOT** delete the stub from `storeCache.m_mapApps`:
```typescript
export function clearActivity(appid: number): void {
    const actStore = appActivityStore();
    if (actStore) {
        actStore.m_mapAppActivity.delete(appid);
    }

    // Retain in-memory stub in StoreItemCache.m_mapApps!
    // In-memory stubs cost trivial RAM (~150 bytes) and must persist indefinitely.
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
```

### 2. In `publishActivity(appid: number, gameid: string)`:
Purge any prior negative-cache poisoning:
```typescript
    const storeCache = storeItemCache();
    if (storeCache) {
        if (storeCache.m_setUnavailableApps?.has(appid)) {
            storeCache.m_setUnavailableApps.delete(appid);
        }
    }
```

### 3. Install Immunity Hook on `StoreItemCache.prototype.BIsAppMissing`:
```typescript
let isStoreCacheHooked = false;

export function ensureStoreCacheHooked(): boolean {
    if (isStoreCacheHooked) return true;

    const cache = storeItemCache();
    if (!cache) return false;

    let proto = Object.getPrototypeOf(cache);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "BIsAppMissing")) {
        proto = Object.getPrototypeOf(proto);
    }

    if (!proto || proto.__nsga_bisappmissing_hooked) {
        isStoreCacheHooked = true;
        return true;
    }

    proto.__nsga_bisappmissing_hooked = true;
    const origBIsAppMissing = proto.BIsAppMissing;

    proto.BIsAppMissing = function (appid: number) {
        if (typeof appid === "number" && appid >= 0x8000_0000) {
            return false;
        }
        return origBIsAppMissing.apply(this, arguments);
    };

    isStoreCacheHooked = true;
    logger.info("Hooked StoreItemCache.prototype.BIsAppMissing for non-Steam shortcut immunity.");
    return true;
}
```
Invoke `ensureStoreCacheHooked()` in `publishActivity` and `OnPluginLoaded()` in `index.tsx`.

---

## 5. Fast Diagnostic Playbook & Automated CDP Tooling

The repository includes a ready-to-run diagnostic suite located in:
`C:\Users\limap\.gemini\antigravity\brain\8900a1b8-3a06-4e50-9fc3-c110ab94b4a4\scratch\`

### 1. The Two-Way Navigation Loop Test (`test_nav_cycle.js`)
Executes the full lifecycle test (`Bloodstained ➔ AM2R ➔ Bloodstained ➔ AM2R`) and inspects the live DOM:
```powershell
node scratch/test_nav_cycle.js
```
* **Success Output:** `hasEvent: true` across all daily buckets.
* **Failure Output:** `hasEvent: false` (empty `<div></div>` body).

### 2. Multi-Tab Diagnostic Script (`check_all_tabs.js`)
Queries all four tabs simultaneously and outputs a health report:
```powershell
node scratch/check_all_tabs.js
```
Checks:
- [x] Post-Game Summary: Count of clips and screenshots rendered.
- [x] Activity Feed: Event count, date headers, and headline phrasing.
- [x] Your Stuff: Item count and media visibility.
- [x] Game Info: Description length, developer credits, release date, and category badge count.

### 3. Rapid Diagnosis Decision Tree

```
Symptom: Activity Feed has Date Headers ("September 20") but no cards or headlines.
➔ Cause: StoreItemCache.m_setUnavailableApps has blacklisted the appid.
➔ Verify: node scratch/cdp.js "window.StoreItemCache.m_setUnavailableApps.has(4263274102)"
➔ Fix: Ensure clearActivity does NOT delete from m_mapApps and hook BIsAppMissing.

Symptom: "YOUR STUFF" tab displays empty "You can take a screenshot..." placeholder.
➔ Cause: overview.GetGameID() is returning appid.toString() instead of 64-bit m_gameid.
➔ Verify: node scratch/cdp.js "window.appStore.GetAppOverviewByAppID(4263274102).GetGameID()"
➔ Fix: Ensure AppOverview.prototype.GetGameID returns this.m_gameid whenever present.

Symptom: Big Picture navigation freezes for 30 seconds when browsing games.
➔ Cause: new Error().stack or regex execution inside hot prototype methods.
➔ Verify: Search codebase for "new Error().stack" in frontend prototype hooks.
➔ Fix: Replace with instant O(1) in-memory Set.has(appid) check.

Symptom: Game Info tab crashes or is completely missing.
➔ Cause: Synthetic appData.details = {} mutation breaking GameStatsSection.
➔ Fix: Remove appData.details mutation; only assign descriptionsData and associationData.
```

---

## 6. Pre-Commit Verification Checklist

Before opening a pull request or ending any coding session:
1. `npm run check` in both plugins (0 TypeScript errors).
2. `npm run build` in both plugins (clean bundle build).
3. Deploy via `powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart`.
4. Run `node scratch/test_nav_cycle.js` (verify two-way lifecycle resilience).
5. Verify all four tabs live on port 8080: Post-Game Summary, Activity, Your Stuff, Game Info.
6. Commit changes and push to `origin/main` on GitHub.
