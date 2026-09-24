# Regression Audit & Architectural Hardening Specification

**Status:** Ready for Implementation · **Priority:** Critical Blocker · **Date:** 2026-09-23  
**Target:** `non-steam-games-activity` (Core) & `steamgriddb-artwork` (Provider)

---

## 1. Executive Summary & The Live Regression

In Big Picture Mode, non-Steam games (such as AM2R, appid `4263274102`) rendered the Activity Feed correctly on initial launch. However, after navigating to another game (e.g. Bloodstained) or returning to the Library, navigating back to AM2R rendered the Activity section with **visible Day Headers ("SEPTEMBER 20", "SEPTEMBER 19", "OCT 24, 2025") and divider rules, but with completely empty body content (`<div></div>`)**.

This document details the exact live trace, verified root cause, systemic vulnerability analysis, and the required implementation tasks for the next agent.

---

## 2. Root Cause Breakdown (Live CDP Trace)

### The Breakdown Sequence

```
1. Initial Navigation to Game A (AM2R, appid 4263274102):
   - publishActivity(appid, gameid) executes.
   - Injects in-memory stub fakeApp into StoreItemCache.m_mapApps.
   - Feed renders properly with thumbnails, headline ("cannoliGun captured"), and clips.

2. Navigation Away (to Library or Game B):
   - watchGamepadAppid detects app change.
   - Triggers unpatchLibraryApp(4263274102) -> clearActivity(4263274102).
   - clearActivity executes:
       storeCache.m_mapApps.delete(appid);
   - Stub is removed from StoreItemCache.

3. The Asynchronous React Unmount / Queue Trap:
   - While the detail page components unmount, Steam's internal hook
     useStoreItemCache (function p in Webpack module 82594) runs:
       c.A.Get().QueueStoreItemRequest(appid, storeItemType, requestParams);
   - Because m_mapApps no longer has 4263274102, Steam treats it as a store cache miss.
   - Steam dispatches a backend store query for 4263274102.
   - Because 4263274102 >= 0x8000_0000 is a local shortcut, the Steam store returns 404 (Not Found).
   - Steam's StoreItemCache handler permanently blacklists the appid:
       this.m_setUnavailableApps.add(4263274102);

4. Return Navigation to Game A:
   - publishActivity runs again and repopulates storeCache.m_mapApps with fakeApp.
   - Steam's event renderer (module 80478, component dt) executes for each daily event:
       const [p] = lt(event.appid, D.A.k_DataRequest_Assets);
       if (event.appid && (!p || !p.BIsVisible())) return null;
   - Inside lt:
       function lt(appid, req) {
         return useStoreItemCache(appid, req); // p(e, t, r, i) in module 82594
       }
   - useStoreItemCache checks:
       if (StoreItemCache.BIsStoreItemMissing(appid, type)) return [undefined, u];
   - BIsStoreItemMissing calls BIsAppMissing(appid):
       BIsAppMissing(appid) { return this.m_setUnavailableApps.has(appid); }
   - Because 4263274102 is present in m_setUnavailableApps, BIsStoreItemMissing evaluates to TRUE!
   - useStoreItemCache immediately returns [undefined, u].
   - dt evaluates `if (!p || !p.BIsVisible()) return null;` -> RETURNS null!
   - Steam renders <div class="AppDayContents"><div></div></div> (an empty <div></div>)!
```

### Live CDP Proof of the Breakdown & Resolution

During live debugging on `http://127.0.0.1:8080`:
1. **Live Reproduction:** Executing `nav.App(692850)` (Bloodstained) followed by `nav.App(4263274102)` (AM2R) reproduced the exact blank state with `hasEvent: false` across all three day blocks.
2. **Store Inspection:** Querying `window.StoreItemCache` revealed:
   - `m_setUnavailableApps.has(4263274102) === true`
   - `BIsStoreItemMissing(4263274102, 0) === true`
   - `GetStoreItemWithLegacyVisibilityCheck(4263274102, 0)` returned the active stub object!
3. **Instant Resolution:** Evaluating:
   ```javascript
   window.StoreItemCache.m_setUnavailableApps.delete(4263274102);
   ```
   and triggering navigation re-evaluation **instantly restored all events, headlines, and media cards across all three daily buckets (`September 20`, `September 19`, `Oct 24, 2025`)**.

---

## 3. Systemic Vulnerability Analysis: Why Do Regressions Recur?

| Vulnerability | Mechanism | Manifestation | Rule to Enforce |
|---|---|---|---|
| **1. Aggressive Lifecycle Destructors** | Modifying/deleting global singleton state on component unmount (`m_mapApps.delete(appid)`). | Cache misses trigger downstream network fetch routines that poison blacklists. | **Global In-Memory Stubs are Persistent:** Never delete lightweight shortcut metadata from global stores during view transitions. |
| **2. Unmonitored Blacklists** | Steam tracks failures in negative caches (`m_setUnavailableApps`). | Even when data is restored, negative caches block renderers. | **Purge Negative Caches on Ingestion:** Always clear negative cache entries (`m_setUnavailableApps.delete(appid)`) upon publishing. |
| **3. Single-Pass vs Lifecycle Verification Gap** | Only verifying clean boot ➔ open game. | View transition regressions go undetected until production use. | **Two-Way Lifecycle Testing:** Verify `Game A -> Game B -> Game A` before declaring any task complete. |
| **4. Prototype Method Coupling** | Hooking one prototype method (`BIsModOrShortcut`) alters other methods (`GetGameID`). | Cross-tab breakdown (e.g. Your Stuff tab wiping out). | **Decouple Linked Prototype Methods:** Always pair prototype overrides with downstream property locks (ADR-0031). |

---

## 4. Implementation Specification (For Next Agent)

The next agent implementing this phase must execute the following modifications:

### File 1: `non-steam-games-activity/frontend/steam/activity.ts`

1. **Stop Deleting Stubs on Unpatch:**
   In `clearActivity(appid: number)`:
   - Retain activity cleanup: `actStore.m_mapAppActivity.delete(appid);`
   - Retain workshop URL cleanup: `wsStore.m_mapPublishedFiles.delete(fileId);`
   - **DELETE** `storeCache.m_mapApps.delete(appid);`. The stub in `m_mapApps` must remain permanently in memory. It costs ~150 bytes, requires zero network queries, and prevents React unmount hooks from issuing 404 store requests.

2. **Purge the Unavailable Blacklist on Publish:**
   In `publishActivity(appid: number, gameid: string)`:
   - Before returning or rendering, check:
     ```typescript
     if (storeCache.m_setUnavailableApps?.has(appid)) {
         storeCache.m_setUnavailableApps.delete(appid);
     }
     ```

3. **Install Safety Hook on `StoreItemCache.prototype.BIsAppMissing`:**
   In `non-steam-games-activity/frontend/steam/activity.ts` (or stores setup):
   - Hook `StoreItemCache.prototype.BIsAppMissing`:
     ```typescript
     const origBIsAppMissing = storeCacheProto.BIsAppMissing;
     storeCacheProto.BIsAppMissing = function(appid: number) {
         if (typeof appid === "number" && appid >= 0x8000_0000) {
             return false;
         }
         return origBIsAppMissing.apply(this, arguments);
     };
     ```
   - This provides $O(1)$ immunity against any future store queries blacklisting non-Steam shortcuts.

---

## 5. Verification Checklist

Before closing this phase, the implementing agent must verify:
- [ ] Clean build and compile (`npm run check` passes with 0 errors).
- [ ] Deployed with `dev.ps1 -NoRestart`.
- [ ] **Two-Way Navigation Loop Verified Live on Port 8080:**
  1. Open AM2R in Big Picture Mode: Verify Post-Game Summary and Activity cards render.
  2. Navigate to Bloodstained (or Library Home): Verify clean transition.
  3. Navigate back to AM2R: Verify all Day Headers, `{Username} captured` headlines, and media cards render with **zero blank days**.
- [ ] Multi-tab verification on AM2R: Post-Game Summary, Activity, Your Stuff (Media items present), and Game Info (credits + description present).
