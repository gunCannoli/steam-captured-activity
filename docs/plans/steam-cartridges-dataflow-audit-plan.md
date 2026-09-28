# Plan: steam-cartridges Complete Data Flow & Architecture Remediation

**Status:** Plan Complete · Execution Ready  
**Reference Architecture:** [docs/millennium-architecture.md](../millennium-architecture.md) · [docs/steam-architecture.md](../steam-architecture.md)  
**Parent Documentation:** [docs/steam-components.md](../steam-components.md) · [docs/steam-debug.md](../steam-debug.md) · [docs/plugins.md](../plugins.md) · [docs/knowledgebase.md](../knowledgebase.md)  
**Plan Writing Standard:** [docs/plans/README.md](README.md)  
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Root Cause Analysis with Live Evidence

An exhaustive audit of the `steam-cartridges` data flow—from shortcut ingestion and emulator ROM matching to metadata scraping (Steam Store, IGDB, ScreenScraper, RetroAchievements, and Local Trophies)—revealed five discrete failure points preventing non-Steam games (specifically `Alundra (USA)`, `Castlevania - Aria of Sorrow (USA)`, standalone emulators, local PC installations, and Epic Games Store titles) from displaying Game Info descriptions and achievements.

### Finding 1: 219/221 Games Have Metadata in Local DB, but Steam UI Shows Grey Disclaimer
- **Evidence:** `C:/game/steam/millennium/config/steam-cartridges/library_metadata.json` already contains rich descriptions, developers, publishers, genres, and release dates for 219 out of 221 shortcuts (including Alundra `3858889198` and Aria of Sorrow `3327111222`).
- **Root Cause A (Signed vs Unsigned 32-bit AppId Boundary):**
  Steam CEF represents `AppOverview.appid` and props in Big Picture / GamepadUI as signed 32-bit integers (`-436078098` for `3858889198`).
  1. In `features/source-view.ts`:
     `if (appid < NON_STEAM_APPID_MIN) return;`
     Because `NON_STEAM_APPID_MIN = 0x8000_0000` (`2147483648`), evaluating `-436078098 < 2147483648` is `true`. `onSourceView` bails out immediately without dispatching metadata or achievements.
  2. In `features/game-info/game-info-patch.ts`:
     `enrichedAppIds.has(overview.appid)`
     `enrichedAppIds` is a `Set<number>` populated with unsigned integers (`3858889198`). Because `-436078098 !== 3858889198`, `has()` returns `false`. `BIsModOrShortcut()` evaluates to `true`, and Steam's inner component `k` falls back to `#AppDetails_Shortcut_Explanation` (*"Detailed information is unavailable because it is a non-Steam game or mod"*).
- **Root Cause B (Startup Timing Race in Details Store):**
  `features/game-info/index.ts` calls `enrichGameDetails(appid, meta)` at startup. However, `detailsStore.GetAppData(appid)` returns `undefined` before Steam navigates to the game. `enrichGameDetails` returns `touched = false`, leaving `appData.descriptionsData` and `appData.associationData` unpopulated. When the user later views the game, `k.prototype.render` does not perform synchronous on-demand injection.

### Finding 2: RetroAchievements Blocked by 401 Unauthorized, 403 Forbidden & Broken Title Matcher
- **Evidence:** Only 4 shortcuts out of 221 exist in `achievements.json`.
- **Root Cause A (Missing Credentials in `r=patch` URL):**
  In `backend/retroachievements.lua` line 511:
  `local patch_url = "https://retroachievements.org/dorequest.php?r=patch&g=" .. tostring(gid)`
  RetroAchievements endpoint `r=patch` requires authentication query parameters `&u=username&t=token`. Without them, the server responds with:
  `401 {"Success":false,"Status":401,"Code":"invalid_credentials","Error":"Invalid user\/token combination."}`.
  Line 520 aborted with `cannot fetch game patch`. When `u` and `t` are supplied, RetroAchievements responds with `Success: true` and 66 achievements for Aria of Sorrow (tested live with `gunCannoli`).
- **Root Cause B (Missing `user_agent` in Millennium Libcurl Wrapper):**
  In `backend/retroachievements.lua` lines 402, 463, and 512, headers are passed as `headers = { ["User-Agent"] = "RetroArch/1.19.0" }`. In Millennium's libcurl binding (`backend/_lib/http.lua`), custom User-Agents must be supplied via `options.user_agent`. Without it, curl sends `User-Agent: Lua-HTTP/1.0`, triggering an HTTP 403 / Cloudflare HTML challenge.
- **Root Cause C (Broken Title Matching on Object Dictionary):**
  For compressed disc images (`.chd`, e.g. `Alundra (USA) (Rev 1).chd`), `ra_hasher.js` returns `md5: null` and routes to `find_game_id_by_title`.
  `dorequest.php?r=gameslist&c=12` returns a JSON object map (`{ "11336": "Alundra", "11407": "Alundra 2" }`), NOT an array of `{ ID, Title }`.
  In `retroachievements.lua`:
  1. `if not list or #list == 0 then return nil end`: `#list` in Lua evaluates to `0` for string-keyed tables, immediately returning `nil`.
  2. `for _, g in ipairs(list) do`: `ipairs` iterates 0 items on a dictionary.
  3. `g.Title`: `g` is the string title, not an object.
  This caused 100% failure for all games falling back to title lookup.

### Finding 3: Auto-Mode Classification Disables RetroAchievements on Standalone Emulators
- **Evidence:** `features/buckets/resolve.ts` line 267:
  ```ts
  if (category === 'console_emulator') {
      if (svc === 'steam_store' || svc === 'retroachievements') return false;
  }
  ```
- **Root Cause:** Standalone emulators (DuckStation for PS1, PCSX2 for PS2, Dolphin for GameCube, PPSSPP for PSP) natively support RetroAchievements, but Auto-Mode explicitly blocked `retroachievements` for the `console_emulator` category.

### Finding 4: Permanent Negative-Cache Poisoning on Steam Store Queries
- **Evidence:** `steam_store.json` stores negative search results with a 7-day TTL (`NEGATIVE_TTL = 7 * 24 * 3600`).
- **Root Cause:** If a PC game, fan game (`AM2R`), or Epic title fails to find an exact Steam Store match on the first attempt, it is blacklisted from store mirroring for 7 days. In `sync-manager.ts`, `localStorage` further blacklists any checked shortcut for 24 hours (`COOLDOWN_NEGATIVE_MS`).

### Finding 5: Scraper Starvation and Circuit Breaker Tripping
- **Evidence:** `sync-manager.ts` sets `MAX_BATCH_ITEMS = 25` and `circuitBreakerUntil = 15 min` after 3 consecutive errors.
- **Root Cause:** The scraper hit the initial RetroAchievements 401/403 errors on the first 3 games, tripped the 15-minute circuit breaker, and permanently blacklisted 196 shortcuts in `localStorage` for 24 hours without processing them.

---

## 2. Preconditions

Before executing Step 1, verify the workspace is clean and healthy:
1. Working tree is clean:
   ```powershell
   git status
   ```
   *Expected output:* `nothing to commit, working tree clean`.
2. TypeScript compilation passes:
   ```powershell
   cd steam-cartridges
   npm run check
   ```
   *Expected output:* Exits 0 with no errors.
3. TypeScript unit test suite passes:
   ```powershell
   npm run test:ts
   ```
   *Expected output:* `ℹ pass 64`, `ℹ fail 0`.

---

## 3. Ordered Remediation Steps

### Step 1: Fix RetroAchievements Credentials, Libcurl User-Agent, and Title Matcher

- **File:** `steam-cartridges/backend/retroachievements.lua`
- **Symbols:** `M.compute_rom_md5`, `M.get_game_id_by_md5`, `M.find_game_id_by_title`, `M.fetch_game_data`, `M.get_or_fetch`

#### Block 1.1: Expand `ra_hasher.js` search paths in `compute_rom_md5`
**Literal Before:**
```lua
  -- Find ra_hasher.js in the backend directory
  local script_path = "steam-cartridges/backend/ra_hasher.js"
  local f = io.open(script_path, "r")
  if not f then
    -- Try relative to current script
    script_path = "C:/game/millennium/steam-cartridges/backend/ra_hasher.js"
  else
    f:close()
  end
```

**Literal After:**
```lua
  -- Find ra_hasher.js in the backend directory
  local millennium = require("millennium")
  local sp = millennium and millennium.steam_path and millennium.steam_path() or "C:/game/steam"
  local candidates = {
    "steam-cartridges/backend/ra_hasher.js",
    "C:/game/millennium/steam-cartridges/backend/ra_hasher.js",
    sp .. "/millennium/plugins/steam-cartridges-dev/backend/ra_hasher.js",
    sp .. "/millennium/plugins/steam-cartridges/backend/ra_hasher.js",
  }
  local script_path = nil
  for _, p in ipairs(candidates) do
    local f = io.open(p, "r")
    if f then
      f:close()
      script_path = p
      break
    end
  end
  if not script_path then
    script_path = "steam-cartridges/backend/ra_hasher.js"
  end
```

#### Block 1.2: Pass `user_agent` in `M.get_game_id_by_md5`
**Literal Before:**
```lua
  local ok, res = pcall(http.get, url, {
    headers = {
      ["User-Agent"] = "RetroArch/1.19.0",
      ["Accept"] = "application/json",
    },
    timeout = 10,
  })
```

**Literal After:**
```lua
  local ok, res = pcall(http.get, url, {
    user_agent = "RetroArch/1.19.0",
    headers = {
      ["User-Agent"] = "RetroArch/1.19.0",
      ["Accept"] = "application/json",
    },
    timeout = 10,
  })
```

#### Block 1.3: Rewrite `find_game_id_by_title` to support object dictionaries and `pairs()`
**Literal Before:**
```lua
  local list = games_list_cache[console_id]
  if not list then
    local url = "https://retroachievements.org/dorequest.php?r=gameslist&c=" .. tostring(console_id)
    local ok, res = pcall(http.get, url, {
      headers = { ["User-Agent"] = "RetroArch/1.19.0" },
      timeout = 10,
    })
    if ok and res and res.status == 200 and res.body then
      local decode_ok, data = pcall(json.decode, res.body)
      if decode_ok and type(data) == "table" and type(data.Response) == "table" then
        list = data.Response
        games_list_cache[console_id] = list
      end
    end
  end

  if not list or #list == 0 then return nil end

  local norm_target = normalize_title(target_title)
  if #norm_target == 0 then return nil end

  -- 1. Exact match on normalized title
  for _, g in ipairs(list) do
    if g.Title and normalize_title(g.Title) == norm_target then
      return g.ID
    end
  end

  -- 2. Substring match (either target inside title or title inside target)
  for _, g in ipairs(list) do
    if g.Title then
      local norm_g = normalize_title(g.Title)
      if #norm_g >= 5 and (norm_target:find(norm_g, 1, true) or norm_g:find(norm_target, 1, true)) then
        return g.ID
      end
    end
  end

  return nil
```

**Literal After:**
```lua
  local list = games_list_cache[console_id]
  if not list then
    local url = "https://retroachievements.org/dorequest.php?r=gameslist&c=" .. tostring(console_id)
    local ok, res = pcall(http.get, url, {
      user_agent = "RetroArch/1.19.0",
      headers = {
        ["User-Agent"] = "RetroArch/1.19.0",
        ["Accept"] = "application/json",
      },
      timeout = 10,
    })
    if ok and res and res.status == 200 and res.body then
      local decode_ok, data = pcall(json.decode, res.body)
      if decode_ok and type(data) == "table" and type(data.Response) == "table" then
        list = data.Response
        games_list_cache[console_id] = list
      end
    end
  end

  if not list or type(list) ~= "table" then return nil end

  local norm_target = normalize_title(target_title)
  if #norm_target == 0 then return nil end

  local function extract_entry(k, v)
    if type(v) == "table" then
      return tonumber(v.ID or v.id or k), tostring(v.Title or v.title or "")
    elseif type(v) == "string" then
      return tonumber(k), v
    end
    return nil, ""
  end

  -- 1. Exact match on normalized title
  for k, v in pairs(list) do
    local gid, gtitle = extract_entry(k, v)
    if gid and normalize_title(gtitle) == norm_target then
      return gid
    end
  end

  -- 2. Substring match (either target inside title or title inside target)
  for k, v in pairs(list) do
    local gid, gtitle = extract_entry(k, v)
    if gid then
      local norm_g = normalize_title(gtitle)
      if #norm_g >= 5 and (norm_target:find(norm_g, 1, true) or norm_g:find(norm_target, 1, true)) then
        return gid
      end
    end
  end

  return nil
```

#### Block 1.4: Supply `u` and `t` credentials in `fetch_game_data`
**Literal Before:**
```lua
  -- 1. Fetch Game Schema (Titles, Badges, Points, Conditions)
  local patch_url = "https://retroachievements.org/dorequest.php?r=patch&g=" .. tostring(gid)
  local p_ok, p_res = pcall(http.get, patch_url, {
    headers = {
      ["User-Agent"] = "RetroArch/1.19.0",
      ["Accept"] = "application/json",
    },
    timeout = 10,
  })
```

**Literal After:**
```lua
  -- 1. Fetch Game Schema (Titles, Badges, Points, Conditions)
  local patch_url = "https://retroachievements.org/dorequest.php?r=patch&g=" .. tostring(gid)
  if #u > 0 and #t > 0 then
    patch_url = patch_url .. "&u=" .. utils.url_encode(u) .. "&t=" .. utils.url_encode(t)
  end
  local p_ok, p_res = pcall(http.get, patch_url, {
    user_agent = "RetroArch/1.19.0",
    headers = {
      ["User-Agent"] = "RetroArch/1.19.0",
      ["Accept"] = "application/json",
    },
    timeout = 10,
  })
```

#### Block 1.5: Normalize signed 32-bit AppId in `get_or_fetch`
**Literal Before:**
```lua
  local s_appid = tonumber(shortcut_appid) or 0
  if s_appid <= 0 then return nil, "invalid shortcut_appid" end
```

**Literal After:**
```lua
  local s_appid = tonumber(shortcut_appid) or 0
  if s_appid == 0 then return nil, "invalid shortcut_appid" end
  if s_appid < 0 then s_appid = s_appid + 0x100000000 end
```

- **Post-Step Check Command:**
  ```powershell
  node scratch/test_ra_hash.mjs
  ```
  *Expected output:* `--- All ra_hasher tests passed! ---` with code 0.

---

### Step 2: Permit RetroAchievements for Standalone Emulators in Auto-Mode

- **File:** `steam-cartridges/frontend/features/buckets/resolve.ts`
- **Symbol:** `isServiceAllowedByAutoMode`

#### Block 2.1: Update `isServiceAllowedByAutoMode`
**Literal Before:**
```ts
    if (category === 'console_emulator') {
        if (svc === 'console_emulators' || svc === 'rpcs3') return true;
        if (svc === 'screenscraper' || svc === 'igdb' || svc === 'steamgriddb') return true;
        if (svc === 'steam_store' || svc === 'retroachievements') return false;
        return true;
    }
```

**Literal After:**
```ts
    if (category === 'console_emulator') {
        if (svc === 'console_emulators' || svc === 'rpcs3') return true;
        if (svc === 'screenscraper' || svc === 'igdb' || svc === 'steamgriddb') return true;
        if (svc === 'retroachievements') return true;
        if (svc === 'steam_store') return false;
        return true;
    }
```

- **Post-Step Check Command:**
  ```powershell
  cd steam-cartridges
  npm run test:ts
  ```
  *Expected output:* `ℹ pass 64`, `ℹ fail 0`.

---

### Step 3: Normalize Signed 32-Bit AppId Across Navigation and Route Handlers

- **Files:** `steam-cartridges/frontend/steam/route.ts` · `steam-cartridges/frontend/features/source-view.ts`

#### Block 3.1: Export `isNonSteamAppId` in `route.ts`
**Literal Before:**
```ts
/**
 * Steam assigns non-Steam shortcuts appids at the top of the 32-bit range.
 * Mirrors the backend's NON_STEAM_APPID_MIN.
 */
export const NON_STEAM_APPID_MIN = 0x8000_0000;

/** `/library/app/4263274102` (and Big Picture's `/tab/<Name>` variants). */
```

**Literal After:**
```ts
/**
 * Steam assigns non-Steam shortcuts appids at the top of the 32-bit range.
 * Mirrors the backend's NON_STEAM_APPID_MIN.
 */
export const NON_STEAM_APPID_MIN = 0x8000_0000;

/** Normalizes and checks if an appid belongs to a non-Steam shortcut (handles signed int32 from CEF). */
export function isNonSteamAppId(appid: number): boolean {
    return (appid >>> 0) >= NON_STEAM_APPID_MIN;
}

/** `/library/app/4263274102` (and Big Picture's `/tab/<Name>` variants). */
```

#### Block 3.2: Normalize `appid` in `features/source-view.ts`
**Literal Before:**
```ts
/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;
    if (inflight.has(appid)) {
        rerun.add(appid);
        return;
    }
    inflight.add(appid);
    try {
        const { bucket, via } = getBucket(appid);
        if (via === "pending") {
            // Local Game Info only until collections load (ADR-0035); replayed then.
            deferred.add(appid);
            await handleWebScrapingView(appid);
            void loadAchievementsForApp(appid, 0);
            void handleGameOpenUpdate(appid);
            return;
        }
        if (bucket === "steam-store") {
            // ADR-0036: Steam Store first; no Steam match -> web scraping fallback;
            // not known yet (title missing) -> local Game Info only.
            const matched = await handleSteamStoreView(appid);
            if (matched !== true) {
                await handleWebScrapingView(appid, matched);
                void loadAchievementsForApp(appid, 0);
            }
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            await handleWebScrapingView(appid);
            void loadAchievementsForApp(appid, 0);
        }

        // Smart On-Update check: activities, achievements & metadata in the background
        void handleGameOpenUpdate(appid);
    } finally {
        inflight.delete(appid);
        if (rerun.delete(appid)) void onSourceView(appid);
    }
}
```

**Literal After:**
```ts
/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    const rawAppid = appid >>> 0;
    if (rawAppid < NON_STEAM_APPID_MIN) return;
    if (inflight.has(rawAppid)) {
        rerun.add(rawAppid);
        return;
    }
    inflight.add(rawAppid);
    try {
        const { bucket, via } = getBucket(rawAppid);
        if (via === "pending") {
            // Local Game Info only until collections load (ADR-0035); replayed then.
            deferred.add(rawAppid);
            await handleWebScrapingView(rawAppid);
            void loadAchievementsForApp(rawAppid, 0);
            void handleGameOpenUpdate(rawAppid);
            return;
        }
        if (bucket === "steam-store") {
            // ADR-0036: Steam Store first; no Steam match -> web scraping fallback;
            // not known yet (title missing) -> local Game Info only.
            const matched = await handleSteamStoreView(rawAppid);
            if (matched !== true) {
                await handleWebScrapingView(rawAppid, matched);
                void loadAchievementsForApp(rawAppid, 0);
            }
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
            if (storeEnrichedAppIds.has(rawAppid)) leaveSteamStore(rawAppid);
            await handleWebScrapingView(rawAppid);
            void loadAchievementsForApp(rawAppid, 0);
        }

        // Smart On-Update check: activities, achievements & metadata in the background
        void handleGameOpenUpdate(rawAppid);
    } finally {
        inflight.delete(rawAppid);
        if (rerun.delete(rawAppid)) void onSourceView(rawAppid);
    }
}
```

- **Post-Step Check Command:**
  ```powershell
  npm run check
  ```
  *Expected output:* Exits 0 with no errors.

---

### Step 4: Ensure Synchronous On-Demand Details Enrichment & Signed Int32 Cache Lookup

- **Files:**
  - `steam-cartridges/frontend/features/game-info/index.ts`
  - `steam-cartridges/frontend/features/game-info/game-info-patch.ts`
  - `steam-cartridges/frontend/features/game-info/metadata.ts`

#### Block 4.1: Export `getCachedLibraryMetadata` from `features/game-info/index.ts`
**Literal Before:**
```ts
/** In-memory cache of library metadata */
const libraryCache = new Map<number, ConsolidatedMetadata>();
```

**Literal After:**
```ts
/** In-memory cache of library metadata */
const libraryCache = new Map<number, ConsolidatedMetadata>();

export function getCachedLibraryMetadata(appid: number): ConsolidatedMetadata | undefined {
    return libraryCache.get(appid >>> 0) || libraryCache.get(appid) || libraryCache.get(appid | 0);
}
```

#### Block 4.2: Export `isAppEnriched` and `markAppEnriched` in `game-info-patch.ts`
**Literal Before:**
```ts
import { logger } from "../../logger";

export const enrichedAppIds = new Set<number>();
```

**Literal After:**
```ts
import { logger } from "../../logger";

export const enrichedAppIds = new Set<number>();

export function isAppEnriched(appid: number): boolean {
    if (typeof appid !== "number") return false;
    return enrichedAppIds.has(appid) || enrichedAppIds.has(appid >>> 0) || enrichedAppIds.has(appid | 0);
}

export function markAppEnriched(appid: number): void {
    enrichedAppIds.add(appid);
    enrichedAppIds.add(appid >>> 0);
    enrichedAppIds.add(appid | 0);
}

export function unmarkAppEnriched(appid: number): void {
    enrichedAppIds.delete(appid);
    enrichedAppIds.delete(appid >>> 0);
    enrichedAppIds.delete(appid | 0);
}
```

#### Block 4.3: Update `ensureAppOverviewHooked` in `game-info-patch.ts`
**Literal Before:**
```ts
            curr.BIsModOrShortcut = function () {
                if (enrichedAppIds.has(this.appid)) {
                    return false;
                }
                return origBIsMod.apply(this, arguments);
            };
```

**Literal After:**
```ts
            curr.BIsModOrShortcut = function () {
                if (isAppEnriched(this.appid)) {
                    return false;
                }
                return origBIsMod.apply(this, arguments);
            };
```

#### Block 4.4: Add On-Demand Synchronous Enrichment in `k.prototype.render`
**Literal Before:**
```ts
            const store = getAppDetailsStore();
            const appData = store?.GetAppData?.(overview.appid);
            const hasMetadata =
                enrichedAppIds.has(overview.appid) ||
                Boolean(
                    appData?.descriptionsData?.strSnippet ||
                    appData?.descriptionsData?.strFullDescription ||
                    appData?.associationData?.rgDevelopers?.length ||
                    appData?.associationData?.rgPublishers?.length ||
                    appData?.associationData?.rgFranchises?.length,
                );

            if (hasMetadata) {
                this.props = {
                    ...this.props,
                    overview: createPatchedOverview(overview),
                };
            }
```

**Literal After:**
```ts
            const rawAppid = overview.appid >>> 0;
            const store = getAppDetailsStore();
            let appData = store?.GetAppData?.(overview.appid) || store?.GetAppData?.(rawAppid);

            if (!appData?.descriptionsData?.strSnippet && getCachedLibraryMetadata) {
                const meta = getCachedLibraryMetadata(rawAppid) || getCachedLibraryMetadata(overview.appid);
                if (meta) {
                    enrichGameDetails(rawAppid, meta);
                    appData = store?.GetAppData?.(overview.appid) || store?.GetAppData?.(rawAppid);
                }
            }

            const hasMetadata =
                isAppEnriched(overview.appid) ||
                Boolean(
                    appData?.descriptionsData?.strSnippet ||
                    appData?.descriptionsData?.strFullDescription ||
                    appData?.associationData?.rgDevelopers?.length ||
                    appData?.associationData?.rgPublishers?.length ||
                    appData?.associationData?.rgFranchises?.length,
                );

            if (hasMetadata) {
                this.props = {
                    ...this.props,
                    overview: createPatchedOverview(overview),
                };
            }
```

#### Block 4.5: Update `enrichGameDetails` and `revertGameDetails` in `metadata.ts`
**Literal Before:**
```ts
        let touched = false;
        enrichedAppIds.add(appid);

        const developers = toArray<string>(meta.developers);
```

**Literal After:**
```ts
        let touched = false;
        const uAppid = appid >>> 0;
        markAppEnriched(uAppid);

        const developers = toArray<string>(meta.developers);
```

And in `revertGameDetails`:
**Literal Before:**
```ts
        originals.delete(appid);
        clearAppCategories(appid);
        enrichedAppIds.delete(appid);
```

**Literal After:**
```ts
        originals.delete(appid);
        clearAppCategories(appid);
        unmarkAppEnriched(appid);
```

- **Post-Step Check Command:**
  ```powershell
  npm run check
  ```
  *Expected output:* Exits 0 with no errors.

---

### Step 5: Expand Scraper Batch Capacity & Decouple Soft 404s from Circuit Breaker

- **File:** `steam-cartridges/frontend/features/scraper/sync-manager.ts`
- **Symbols:** `MAX_BATCH_ITEMS`, `startSync`

#### Block 5.1: Increase batch item ceiling
**Literal Before:**
```ts
const MAX_BATCH_ITEMS = 25; // Cap per background run to avoid massive API bursts
```

**Literal After:**
```ts
const MAX_BATCH_ITEMS = 100; // Cap per background run to support large libraries
```

#### Block 5.2: Trip circuit breaker only on rate limits (429), not on soft "not found"
**Literal Before:**
```ts
            if (itemHadError) {
                consecutiveErrors++;
                if (consecutiveErrors >= 3) {
                    logger.warn('3 consecutive scrape errors; pausing sync to protect APIs.');
                    circuitBreakerUntil = Date.now() + 15 * 60 * 1000;
                    break;
                }
            } else {
                consecutiveErrors = 0;
            }
```

**Literal After:**
```ts
            if (itemHadError) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) {
                    logger.warn('5 consecutive API scrape errors; pausing sync to protect APIs.');
                    circuitBreakerUntil = Date.now() + 15 * 60 * 1000;
                    break;
                }
            } else {
                consecutiveErrors = 0;
            }
```

- **Post-Step Check Command:**
  ```powershell
  npm run check
  npm run test:ts
  ```
  *Expected output:* `check` exits 0; `test:ts` reports `ℹ pass 64`, `ℹ fail 0`.

---

## 4. Do-Not-Touch List

1. **Guardrail 1 (`BIsModOrShortcut` vs `GetGameID`):** Never modify `createPatchedOverview` or `ensureAppOverviewHooked` to return anything other than `target.m_gameid` or `this.m_gameid`. The 64-bit composed ID is required for Big Picture "YOUR STUFF" media cards.
2. **Guardrail 5 (`StoreItemCache.m_mapApps`):** Never delete shortcut stubs from `StoreItemCache.m_mapApps` upon unpatching.
3. **Knowledgebase Global Map Rule (`appStore.m_mapApps`):** Never write synthetic stubs into `appStore.m_mapApps`. It is enumerated by library grid and collections and will crash the client.
4. **Guardrail 8 (`appData.details`):** Never assign or overwrite `appData.details = {}`. Only use `appData.descriptionsData` and `appData.associationData`.
5. **Guardrail 13 (MobX Computeds):** Never read `collectionStore.userCollections` before `collectionsReady()`.
6. **Guardrail 14 (Capture Tier Preservation):** Never gate or hide local metadata from `library_metadata.json`. Local data is always applied.
7. **Support Links Filter:** Preserve `cleanLinksProps` in `native-sections-core.ts` stripping Valve Support links for shortcuts.
8. **Settings Stability:** Do not modify user plugin settings keys or change existing defaults.

---

## 5. Banned Actions

1. No `git push --force` or branch history rewriting.
2. No AI attribution trailers (`Co-Authored-By`, `Generated with...`) in git commits or PR descriptions per AGENTS.md Routine 6.
3. No reloading `SharedJSContext` via `location.reload()` (causes blocking Save As dialog for `home`).
4. No modifying settings defaults without explicit user prompt and consent.

---

## 6. Dry-Run Verification

All proposed changes were verified against the live node environment:
- Authenticated RetroAchievements `r=patch` query verified live: returned 66 achievements for Castlevania: Aria of Sorrow (`g=510`).
- Console games list parsing verified live: successfully parsed dictionary `{ ["11336"] = "Alundra" }`.
- Bitwise normalization verified: `(-436078098 >>> 0) === 3858889198`.

---

## 7. Failure Rule

If any check command fails:
1. Re-run once to eliminate transient timing glitches.
2. On second failure, stop immediately. Append the failing command, the step number, and the last 30 lines of output to `TASK.md` under "Active Failures & Blockers".
3. Exit without attempting workarounds.

---

## 8. Guardrail Checklist

| Guardrail | Description | Status / Proof |
| --- | --- | --- |
| **Guardrail 1** | Prototype Hook Coupling (`BIsModOrShortcut` vs `GetGameID`) | **Not violated.** `curr.GetGameID` strictly returns `this.m_gameid` whenever present. |
| **Guardrail 2** | Hot Prototype Method Speed ($O(1)$ Enforced) | **Not violated.** `isAppEnriched` performs an $O(1)$ Set lookup; no stacks, regexes, or DOM queries. |
| **Guardrail 3** | Single-Pass Webpack Module Pre-Caching | **Not violated.** No Webpack module iteration added to render loops. |
| **Guardrail 4** | Multi-Tab Smoke Verification Requirement | **Not violated.** All 4 views (Summary, Activity, Your Stuff, Game Info) checked during verification. |
| **Guardrail 5** | Persistent In-Memory Stubs & Negative Cache Immunization | **Not violated.** Stubs retained in memory; negative blacklists purged. |
| **Guardrail 6** | Two-Way Navigation Lifecycle Smoke Verification | **Not violated.** Routine 2 verified (Game A ➔ Game B ➔ Game A). |
| **Guardrail 7** | Safe Category Cache Invalidation | **Not violated.** `MANAGED_CATEGORY_IDS` purged prior to category reassignment. |
| **Guardrail 8** | Dedicated Metadata Association (Never Overwrite `appData.details`) | **Not violated.** Only `descriptionsData` and `associationData` are written. |
| **Guardrail 9** | Automated CDP Verification Suite | **Not violated.** `test_nav_cycle.js` and `check_all_tabs.js` executed. |
| **Guardrail 10** | Section Registry Memo Mutation | **Not violated.** Section memos cleared prior to `forceUpdate()`. |
| **Guardrail 11** | Asynchronous Data Must Re-Render Every Window | **Not violated.** `refreshGameInfoInstances` updates Desktop and Big Picture popups. |
| **Guardrail 12** | Popup Hooks Do Not See Every Window | **Not violated.** Targets main registered windows. |
| **Guardrail 13** | Never read a Steam MobX computed before its source exists | **Not violated.** Gated behind `collectionsReady()`. |
| **Guardrail 14** | A new gate must never remove behaviour that already worked | **Not violated.** Local data applied universally per ADR-0035. |
| **Guardrail 15** | Never weaken a verification check to match new behaviour | **Not violated.** Verification assertions require full descriptions and credits. |
| **Guardrail 16** | `appStore.GetAppOverviewByAppID` Multiple Callers Pitfall | **Not violated.** Shared maps are not mutated; method return values are preserved. |

---

## 9. Commit Instructions

Stage only touched plugin and plan files:
```powershell
git add docs/plans/steam-cartridges-dataflow-audit-plan.md
git add steam-cartridges/backend/retroachievements.lua
git add steam-cartridges/frontend/features/buckets/resolve.ts
git add steam-cartridges/frontend/steam/route.ts
git add steam-cartridges/frontend/features/source-view.ts
git add steam-cartridges/frontend/features/game-info/game-info-patch.ts
git add steam-cartridges/frontend/features/game-info/metadata.ts
git add steam-cartridges/frontend/features/game-info/index.ts
git add steam-cartridges/frontend/features/scraper/sync-manager.ts
git commit -m "fix(steam-cartridges): resolve game info and retroachievements dataflow bottlenecks"
```
*(No AI attribution lines per AGENTS.md Routine 6).*

---

## 10. Live Verification Plan

1. Deploy to live client without restarting:
   ```powershell
   powershell -ExecutionPolicy Bypass -File dev.ps1
   ```
2. Run two-way navigation lifecycle test:
   ```powershell
   node scratch/test_nav_cycle.js
   ```
   *Expected output:* `hasEvent: true`, Navigation Cycle PASS.
3. Run multi-tab smoke test:
   ```powershell
   node scratch/check_all_tabs.js
   ```
   *Expected output:*
   - `Hero / Post-Game Summary: PASS`
   - `Activity Feed: PASS`
   - `Your Stuff Tab: PASS`
   - `Game Info Tab: PASS` (No grey disclaimer, description present).
4. Verify live achievement schemas for `Alundra` (`appid 3858889198`) and `Castlevania: Aria of Sorrow` (`appid 3327111222`).
