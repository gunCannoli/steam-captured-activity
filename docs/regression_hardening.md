# Regression Audit & Architectural Hardening Specification

**Status:** Ready for Implementation · **Priority:** Critical Blocker · **Date:** 2026-09-23  
**Target:** `non-steam-games-activity` (Core) & `steamgriddb-artwork` (Provider)

---

## 1. Executive Summary & The Live Regression

In Big Picture Mode, non-Steam shortcuts (e.g. AM2R, appid `4263274102`) rendered the Activity Feed properly on initial clean launch. However, after navigating away to another game (such as native Steam game *Bloodstained*, appid `692850`) or returning to the Library, navigating back to AM2R rendered the Activity section with **visible Day Headers ("SEPTEMBER 20", "SEPTEMBER 19", "OCT 24, 2025") and divider rules, but with completely empty body content (`<div></div>`)**.

This document provides the complete live trace, root cause breakdown, exact Webpack module anatomy, ready-to-run test scripts, and the step-by-step code changes required to permanently resolve this regression.

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
   - Stub is removed from StoreItemCache.m_mapApps.

3. The Asynchronous React Unmount / Queue Trap:
   - While the detail page components unmount asynchronously, Steam's internal hook
     useStoreItemCache (function p in Webpack module 82594) runs its effect:
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

## 3. Webpack Module Anatomy & Decompiled Signatures

### Module `80478` — Activity Day & Event Renderer (`dt` and `lt`)

Steam's native Activity day renderer iterates over the day's events:
```javascript
(0, n.jsx)("div", {
  className: Z().AppDayContents,
  children: s.map((e) => (0, n.jsx)(dt, { event: e, rollup: r }, e.unUniqueID)),
});
```

Inside the per-event renderer component `dt`:
```javascript
const dt = (0, a.PA)(function (e) {
  const { event: t, rollup: r } = e,
    i = t.appid,
    [a, o] = s.useState(!1),
    l = it(i, r),
    d = nt(i),
    u = (0, x.W5)(g.BV.Library.App.Root(i)),
    [p] = lt(i, D.A.k_DataRequest_Assets); // <--- Store lookup hook
  
  if (!t.BIsValid()) return null;
  if (t.eEventType == m._Q.PostedAnnouncement) return ...;
  
  // THE VISIBILITY GUARD THAT DROPS THE EVENT BODY:
  if (i && (!p || !p.BIsVisible())) return null; // <--- Returns null if p is undefined!
  
  ...
});
```

And `lt` is defined as:
```javascript
function lt(e, t) {
  const r = (0, f.If)();
  return (0, F.t7)(e, t, r); // Delegates to useStoreItemCache in module 82594
}
```

---

### Module `82594` — `useStoreItemCache` Hook (`F.t7`)

Decompiled source of function `p(e, t, r, i)` in module `82594`:
```javascript
function p(e, t, r, i) {
  const o = useRef(undefined),
        p = useRef(undefined),
        A = useForceUpdate();
  o.current = e;
  const [g, h] = useState(undefined),
        { include_assets: C, ... } = r;

  useEffect(() => {
    const r = { include_assets: C, ... };
    let s = null;
    return !e || e < 0 || c.A.Get().BHasStoreItem(e, t, r) || (void 0 !== g && i && i == p.current) || (
      i !== p.current && (h(undefined), p.current = i),
      s = CancelToken.source(),
      c.A.Get().QueueStoreItemRequest(e, t, r).then(t => {
        s?.token.reason || o.current !== e || h(t == a.R), A();
      })
    ), () => s?.cancel("useStoreItemCache: unmounting");
  }, [e, t, i, g, C, _, f, b, y, B, w, S, v, M, I, x, R, T, j, k, A]);

  if (!e) return [null, u];
  if (!1 === g) return [void 0, u];
  
  // THE ROOT CAUSE: Steam checks if the item is blacklisted as missing!
  if (c.A.Get().BIsStoreItemMissing(e, t)) return [void 0, u];
  
  if (!c.A.Get().BHasStoreItem(e, t, r)) return [void 0, d];
  const D = c.A.Get().GetStoreItemWithLegacyVisibilityCheck(e, t);
  return D ? [D, m] : [null, u];
}
```

---

### Module `52492` — `StoreItemCache` Singleton (`c.A`)

Steam's `StoreItemCache` implements:
```javascript
BIsStoreItemMissing(e, t) {
  switch (t) {
    case d.c6.qI:
      return this.BIsAppMissing(e); // <--- Checks appid
    case d.c6.RD:
      return this.BIsPackageMissing(e);
    default:
      return !0;
  }
}

BIsAppMissing(e) {
  return this.m_setUnavailableApps.has(e); // <--- Reads Set<number>
}
```

---

## 4. Step-by-Step Implementation Instructions

### Step 1: Prevent In-Memory Stub Deletion in `clearActivity`

**File:** `non-steam-games-activity/frontend/steam/activity.ts` (lines 320–344)

In `clearActivity(appid: number)`:
- Keep the `actStore.m_mapAppActivity.delete(appid)` call.
- Keep the workshop files cleanup in `wsStore.m_mapPublishedFiles`.
- **REMOVE** the call to `storeCache.m_mapApps.delete(appid)`.

```typescript
export function clearActivity(appid: number): void {
    const actStore = appActivityStore();
    if (actStore) {
        actStore.m_mapAppActivity.delete(appid);
    }

    // DO NOT delete fakeApp from StoreItemCache.m_mapApps!
    // In-memory stubs consume negligible RAM (~150 bytes) and must persist indefinitely.
    // Deleting them causes concurrent React unmount hooks to trigger 404 store requests,
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

---

### Step 2: Purge Negative Cache in `publishActivity`

**File:** `non-steam-games-activity/frontend/steam/activity.ts` (around line 85)

Inside `publishActivity(appid: number, gameid: string)`:
Immediately after obtaining `storeCache`:

```typescript
    const storeCache = storeItemCache();
    if (storeCache) {
        // Guarantee that any past negative-cache blacklist entry is purged
        if (storeCache.m_setUnavailableApps?.has(appid)) {
            storeCache.m_setUnavailableApps.delete(appid);
        }
    }
```

---

### Step 3: Install Prototype Immunity Hook on `StoreItemCache.prototype.BIsAppMissing`

**File:** `non-steam-games-activity/frontend/steam/activity.ts`

Create and invoke `ensureStoreCacheHooked()`:

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
        // All non-Steam shortcuts have appid >= 0x8000_0000 (2,147,483,648).
        // They are local shortcuts and can NEVER be treated as "missing" store apps.
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

Call `ensureStoreCacheHooked()` in:
1. `publishActivity(appid, gameid)`
2. `OnPluginLoaded()` in `non-steam-games-activity/frontend/index.tsx`

---

## 5. Ready-to-Run Verification Harness

The scratch harness is already established at:
`C:\Users\limap\.gemini\antigravity\brain\8900a1b8-3a06-4e50-9fc3-c110ab94b4a4\scratch\`

### Automated Navigation Loop Test Script: `scratch/test_nav_cycle.js`

Run this script to automatically navigate from AM2R ➔ Bloodstained ➔ AM2R and query live DOM state:

```powershell
node scratch/test_nav_cycle.js
```

**Expected output when fixed:**
```json
1. Navigating to Bloodstained (692850)...
2. Navigating back to AM2R (4263274102)...
3. Checking AppActivityDay in AM2R...
Result: {
  "result": {
    "type": "object",
    "value": [
      {
        "text": "September 20",
        "childrenCount": 2,
        "hasEvent": true
      },
      {
        "text": "September 19",
        "childrenCount": 2,
        "hasEvent": true
      },
      {
        "text": "Oct 24, 2025",
        "childrenCount": 2,
        "hasEvent": true
      }
    ]
  }
}
```

---

## 6. Verification Checklist

Before closing Phase 4b, the agent must verify:
- [ ] TypeScript compile passes with zero errors: `npm run check` (in `non-steam-games-activity`).
- [ ] Bundle builds cleanly: `npm run build`.
- [ ] Deployed to live Steam: `powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart`.
- [ ] Reload Steam frontend (`Ctrl+R` in CEF DevTools).
- [ ] Run `node scratch/test_nav_cycle.js`: Verify `hasEvent: true` across all days.
- [ ] Multi-Tab Verification in Big Picture Mode:
  - **Post-Game Summary:** 4 clips + 1 screenshot rendered in top strip.
  - **Activity Feed:** All daily buckets render with `{Username} captured` headline and 16:9 media cards.
  - **Your Stuff Tab:** Displays 10 screenshots and 24 clips with duration badges (not empty placeholder).
  - **Game Info Tab:** Displays capsule art, description, credits, release date, and category badges.
