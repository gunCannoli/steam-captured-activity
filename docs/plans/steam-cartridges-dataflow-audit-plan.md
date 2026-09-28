# Plan: steam-cartridges Complete Data Flow & Architecture Audit

**Status:** Plan Complete · Execution Ready  
**Reference Architecture:** [docs/millennium-architecture.md](../millennium-architecture.md)  
**Parent Documentation:** [docs/steam-components.md](../steam-components.md) · [docs/plugins.md](../plugins.md)  
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Context & Root Cause Analysis

### Overview
An exhaustive audit of the `steam-cartridges` data flow—from shortcut detection to metadata provider selection (Steam mirror vs. IGDB vs. ScreenScraper vs. RetroAchievements vs. Local PS3/PS4 trophies)—revealed the exact mechanisms preventing non-Steam games (including `Alundra (USA)`, `Castlevania - Aria of Sorrow (USA)`, standalone emulators, local PC installations, and Epic Games Store titles) from displaying Game Info and achievements.

### Key Finding 1: 219/221 Games Have Descriptions in DB, but Steam UI Hides Them
- **Evidence:** `C:/game/steam/millennium/config/steam-cartridges/library_metadata.json` already contains rich descriptions, developers, publishers, genres, and release dates for 219 out of 221 shortcuts (including Alundra, appid `3858889198`, and Aria of Sorrow, appid `3327111222`).
- **Root Cause:**
  1. `features/game-info/index.ts` calls `enrichGameDetails(appid, clean)` at startup. However, `detailsStore.GetAppData(appid)` returns `undefined` for apps that Steam has not yet navigated to. `enrichGameDetails` returns `false` when `GetAppData` is not yet populated, leaving `appData.descriptionsData` unwritten.
  2. `features/game-info/game-info-patch.ts` checks `enrichedAppIds.has(overview.appid)`. In Steam CEF, `overview.appid` is frequently represented as a signed 32-bit integer (`-436078098`), whereas `enrichedAppIds` stores the unsigned 32-bit integer (`3858889198`). Because `enrichedAppIds` is a simple `Set<number>` without unsigned/signed conversion, the lookup evaluates to `false`. Steam's component falls back to the stock shortcut disclaimer: *"Detailed information is unavailable because it is a non-Steam game or mod"*.

### Key Finding 2: RetroAchievements Blocked by 403 Forbidden & Broken Title Parser
- **Evidence:** Only 4 shortcuts out of 221 exist in `achievements.json`. 217 shortcuts are completely unbound.
- **Root Cause A (403 Client Block):**
  In `backend/retroachievements.lua` line 402:
  ```lua
  local ok, res = pcall(http.get, url, {
    headers = { ["User-Agent"] = "RetroArch/1.19.0" }
  })
  ```
  Millennium's internal libcurl wrapper sets `CURLOPT_USERAGENT` from `options.user_agent`, ignoring `options.headers["User-Agent"]`. RetroAchievements' `dorequest.php` API responds with HTTP 403:
  `{"Success":false,"Status":403,"Code":"unsupported_client","Error":"This client is not supported.","GameID":0}`.
- **Root Cause B (Broken Title Matcher for .chd and Compressed Discs):**
  `Alundra` is stored as `Alundra (USA) (Rev 1).chd`. Compressed discs return `md5: null` in `ra_hasher.js` and fall back to `find_game_id_by_title(target_title, cmd, launch_options)`.
  In `retroachievements.lua` lines 482-496:
  ```lua
  for _, g in ipairs(list) do
    if g.Title and normalize_title(g.Title) == norm_target then return g.ID end
  end
  ```
  `dorequest.php?r=gameslist&c=12` returns a JSON object map (`{ "11336": "Alundra", "11407": "Alundra 2" }`), NOT an array of `{ ID, Title }`. `ipairs` on a dictionary iterates 0 items, failing 100% of the time for all games falling back to title matching.

### Key Finding 3: Auto-Mode Classification Disables RetroAchievements on Standalone Emulators
- **Evidence:** `features/buckets/resolve.ts` line 267:
  ```ts
  if (category === 'console_emulator') {
      if (svc === 'steam_store' || svc === 'retroachievements') return false;
  }
  ```
  Standalone emulators like DuckStation (PS1), PCSX2 (PS2), Dolphin (GameCube), and PPSSPP (PSP) have native RetroAchievements integration. Classifying them as `console_emulator` explicitly strips `retroachievements` from allowed services.

### Key Finding 4: Permanent Negative-Cache Poisoning on Steam Store Queries
- **Evidence:** Fan games (e.g. `AM2R - Another Metroid 2 Remake`), Epic Games Store exclusives, or titles with subtitle mismatches get queried once via Steam Store search. When 0 exact matches return, `steam_store_store.lua` records them into `steam_store.json`'s `negative` table. They are permanently blacklisted from store mirroring and never re-evaluated.

### Key Finding 5: Background Scraper Throttling Starves Large Libraries
- **Evidence:** `features/scraper/sync-manager.ts` defines `MAX_BATCH_ITEMS = 25`, `MIN_FULL_SCAN_INTERVAL_MS = 15 min`, and `COOLDOWN_NEGATIVE_MS = 24 hours`.
- When the background sync processed the first 25 items and hit the RetroAchievements 403 error, the 3-consecutive-error circuit breaker tripped. The remaining 196 shortcuts were never scraped and were blacklisted for 24 hours.

### Key Finding 6: Architectural Complexity & Spaghetti Code
- **Overlapping Parallel Stores:** 4 distinct disk files (`library_metadata.json`, `achievements.json`, `steam_store.json`, `.env`) plus browser `localStorage` and multiple in-memory maps.
- **Id Representation Fragility:** Mixed usage of signed int32, unsigned uint32, string keys, and 64-bit GameIDs without universal conversion guards.
- **Minified React Fiber Walking:** `patchGameInfoComponent` searches for `fiber.type.name === 'k' || fiber.type.name === 'G'`, which breaks across CEF builds.

---

## 2. Preconditions

Before implementing fixes from this audit:
1. Working tree is clean: `git status` reports no untracked or unstaged changes.
2. TypeScript compiles cleanly: `npm run check` in `steam-cartridges/` exits with code 0.
3. Unit test suite passes 100%: `npm run test:ts` exits with code 0 (64/64 passing).

---

## 3. Ordered Remediation Steps

### Step 1: Fix RetroAchievements HTTP User-Agent & Title Matching Dictionary Parser
- **File:** `steam-cartridges/backend/retroachievements.lua`
- **Actions:**
  1. Pass `user_agent = "RetroArch/1.19.0"` in options table for all `http.get` calls in `get_game_id_by_md5`, `find_game_id_by_title`, and `fetch_game_data`.
  2. Rewrite `find_game_id_by_title` to iterate key-value pairs (`pairs(list)`) supporting both object dictionary (`list[gid] = title_str`) and array formats.
- **Verification:** `node scratch/test_ra_hash.mjs` verifying GameID 11336 is returned for Alundra and 510 for Castlevania: Aria of Sorrow.

### Step 2: Permit RetroAchievements for Standalone Emulators in Auto-Mode
- **File:** `steam-cartridges/frontend/features/buckets/resolve.ts`
- **Actions:**
  In `isServiceAllowedByAutoMode`, allow `retroachievements` for `console_emulator` category (DuckStation, PCSX2, Dolphin, PPSSPP).
- **Verification:** `npm run test:ts` (routing rules unit tests).

### Step 3: Normalize AppId Across All Sets & Lookups (Signed vs Unsigned)
- **File:** `steam-cartridges/frontend/features/game-info/game-info-patch.ts`
- **File:** `steam-cartridges/frontend/features/game-info/metadata.ts`
- **Actions:**
  Replace raw `enrichedAppIds.has(appid)` with helper `isAppEnriched(appid)` checking `appid`, `appid >>> 0`, and `appid | 0`.
- **Verification:** `npm run check` and live CDP navigation test.

### Step 4: Ensure On-Demand Details Enrichment on App Navigation
- **File:** `steam-cartridges/frontend/features/game-info/game-info-patch.ts`
- **Actions:**
  When `G.render()` or `k.render()` executes and `appDetailsStore.GetAppData(appid)` was previously unpopulated, immediately call `enrichGameDetails(appid, libraryCache.get(appid))` synchronously if cached metadata exists.
- **Verification:** `node scratch/check_all_tabs.js` verifying Game Info renders description and credits without requiring restart.

### Step 5: Batch Processing & Graceful Fallback in Sync Manager
- **File:** `steam-cartridges/frontend/features/scraper/sync-manager.ts`
- **Actions:**
  1. Increment batch size from 25 to 100, or allow user-triggered "Sync All" button to bypass batch cap.
  2. Treat non-fatal errors (e.g. game not on RA or not on Steam Store) as negative hits rather than consecutive fatal errors, preventing circuit breaker trip.
- **Verification:** `npm run check` and `npm run test:ts`.

---

## 4. Do-Not-Touch List

1. **Plugin Settings Preservation:** Do not alter existing plugin configuration keys or reset user preferences without explicit user prompt/consent.
2. **Support Links Filter:** `cleanLinksProps` in `native-sections-core.ts` must continue stripping Valve Support (`helpwithgame`) links for non-Steam shortcuts.
3. **Headline Patch Scoping:** `headline-patch.ts` must continue scoping `' captured'` string replacements strictly to screenshot events (`eEventType === 13 || undefined`).
4. **StoreItemCache Stubs:** Never delete shortcut stubs from `StoreItemCache.m_mapApps` upon unpatching.

---

## 5. Banned Actions

1. No `git push --force` or history rewriting.
2. No AI attribution trailers (`Co-Authored-By`, `Generated with...`) in git commits or PR descriptions.
3. No reloading `SharedJSContext` via `location.reload()` (causes blocking Save As dialog).
4. No modifying settings defaults without user approval.

---

## 6. Guardrail Checklist

| Guardrail | Description | Status / Proof |
| --- | --- | --- |
| **Guardrail 1** | Prototype Hook Coupling (`BIsModOrShortcut` vs `GetGameID`) | Preserved — uses composed 64-bit ID for captures, 32-bit for store. |
| **Guardrail 2** | Section Registry Restoration | Preserved — hooks into `CAppDetailsSections` without mutating unowned apps. |
| **Guardrail 5** | Store Record Blocker | Preserved — `fakeApp` in `StoreItemCache` provides required getters without network requests. |
| **Guardrail 6** | Component Reuse Over Pixel Measuring | Preserved — uses Steam's native components. |
| **Guardrail 8** | Details Store Isolation | Preserved — never mutates `appData.details` directly. |
| **Guardrail 13** | Collections Store Race Guard | Preserved — delays collection queries until `collectionsReady()`. |
| **Guardrail 15** | Verification Polling | Preserved — automated tests poll for asynchronous data load before asserting. |

---

## 7. Verification Plan

After executing remediation steps:
1. Run `node scratch/test_nav_cycle.js` (Two-way navigation lifecycle: Game A ➔ Game B ➔ Game A).
2. Run `node scratch/check_all_tabs.js` (Verifies Hero banner, Activity feed, Your Stuff, Game Info, Community tab).
3. Verify live unlock and schema fetch for `Alundra` (PS1) and `Castlevania: Aria of Sorrow` (GBA).
