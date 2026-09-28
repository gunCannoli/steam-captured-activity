# Plan: Retro Games Community & Media in steam-cartridges

**Status:** Plan Complete · Execution Ready  
**Reference Architecture:** [docs/millennium-architecture.md](../millennium-architecture.md)  
**Parent Documentation:** [docs/steam-components.md](../steam-components.md) · [docs/plugins.md](../plugins.md) · [docs/knowledgebase.md](../knowledgebase.md)  
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Context & Root Cause Analysis

### Current State & Problem
Steam hides all Community features from non-Steam shortcuts:
- **Big Picture Mode:** The native "COMMUNITY" tab renders an empty placeholder (`? No additional content`) because shortcuts lack a Valve Community Hub ID, Steam Workshop files, and Steam Community feeds.
- **Desktop Client:** The `community` and `communitycontent` sections in the left-column registry (`CAppDetailsSections`) remain unpopulated or show a generic fallback.
- **Retro Games Isolation:** Emulated and non-Steam games miss trailers, digital manuals, high-resolution fanart, titlescreens, speedrun guides, and wiki links that native games enjoy on Steam.

### Learnings from the Complete Data Flow Audit (`steam-cartridges-dataflow-audit-plan.md`)
1. **AppId Representation & Signedness:** Steam CEF passes `overview.appid` as a signed 32-bit integer when $> \text{0x7FFFFFFF}$ (`3858889198` becomes `-436078098`). All frontend handlers, `CWorkshopStore` item keys, and backend lookups against `shortcuts.vdf` MUST normalize `appid >>> 0` (in JS/TS) and `if appid < 0 then appid = appid + 0x100000000 end` (in Lua).
2. **Millennium libcurl User-Agent Requirement:** Passing `headers = { ["User-Agent"] = "..." }` is ignored by Millennium's native curl binding unless `user_agent = "..."` is supplied directly in the options table. Requests to external APIs (ScreenScraper, IGDB, YouTube) must pass `user_agent` to prevent Cloudflare/WAF 403 Forbidden errors.
3. **RPC Boundary Safety:** Calling an unregistered RPC method or allowing unhandled Lua `error()` calls to bubble across the host boundary triggers `EXCEPTION_ACCESS_VIOLATION (0xC0000005)` in Millennium's native DLL, terminating the backend process. Handlers must catch errors in `pcall` and return `{ error = "..." }` with silent fallback per ADR-0014.
4. **Data Directory Path:** Media and community files must reside under `<Steam>/millennium/config/steam-cartridges/media/<appid>/` and `.../community/` via `data_dir.path()` (ADR-0032), never in hardcoded or non-standard paths.
5. **Synchronous Render Lifecycle:** If community media is loading or unavailable, `community-tab.tsx` must render clean native fallback views (`<Focusable>`, `<DialogButton>`) without throwing or mounting React Error Boundaries.

### Solution Architecture
1. **ScreenScraper (Media & Historical Assets):**
   - High-resolution in-game screenshots (`screens`) and title screens (`sstitle`).
   - Fanart, backdrops, and wheel logos (`wheel`).
   - Digital game manuals (PDF and multi-page scans).
   - Video gameplay previews / snaps (MP4).
2. **IGDB (Community, Media & Trailers):**
   - Gameplay trailers and teaser videos (YouTube video IDs rendered via Steam-native media player).
   - Promotional artworks and high-res concept art.
   - Community resources: official game sites, subreddits, wikis, Discord servers, and speedrun leaderboards.
3. **Steam Native Integration:**
   - Inject community media items into Steam's in-memory `CWorkshopStore` using loopback URLs (`https://steamloopback.host/...`).
   - Feed Steam's genuine `<Carousel>`, `Focusable`, and media viewer components in the Big Picture "COMMUNITY" tab and Desktop community sections.
   - Zero DLL injection, passive memory and loopback observation only.

---

## 2. Preconditions

Before beginning execution of any phase:
1. Working tree is clean: `git status` reports no untracked or unstaged changes.
2. TypeScript compilation is clean: `npm run check` in `steam-cartridges/` exits with code 0.
3. Unit test suite passes 100%: `npm run test:ts` in `steam-cartridges/` exits with code 0 (64/64 tests passing).
4. Steam Client is running in dev mode (`127.0.0.1:8080`).

---

## 3. Ordered Implementation Steps

### Step 1: ScreenScraper Media & Manuals Backend Provider
- **File:** `steam-cartridges/backend/screenscraper_media.lua`
- **Symbols:** `M.fetch_media`, `M.GetGameMedia`, `M.GetGameManual`
- **Actions:**
  - Implement `fetch_media(appid, rom_path, system_id, crc, md5)` querying ScreenScraper's `jeuInfos.php` API.
  - Supply `user_agent = "steam-cartridges/1.0"` in `http.get` options to satisfy libcurl headers.
  - Normalize signed 32-bit `appid` (`if appid < 0 then appid = appid + 0x100000000 end`) before matching `shortcuts.parse(paths.shortcuts)` entries.
  - Parse media sections: `medias/screenshot`, `medias/titlescreen`, `medias/fanart`, `medias/video-normalized`, and `medias/manual`.
  - Cache downloaded media in `<Steam>/millennium/config/steam-cartridges/media/<appid>/`:
    - `screenshots/` (in-game and titlescreen images).
    - `videos/` (gameplay MP4 previews).
    - `manuals/` (PDF or image scans).
  - Expose RPC methods: `GetGameMedia` and `GetGameManual`.
- **Post-Step Check Command:**
  ```powershell
  npm run check
  ```
  *Expected output:* Exits with code 0.

---

### Step 2: IGDB Community & Trailers Backend Provider
- **File:** `steam-cartridges/backend/igdb_community.lua`
- **Symbols:** `http_post`, `M.fetch_community_data`, `M.GetGameTrailers`, `M.GetGameCommunityLinks`
- **Actions:**
  - In `http_post`, supply `user_agent = "steam-cartridges/1.0"` in `http.request` / `http.post` options.
  - Normalize signed 32-bit `appid` in `GetGameTrailers` and `GetGameCommunityLinks` (`if appid < 0 then appid = appid + 0x100000000 end`).
  - Query IGDB `/games` with fields: `videos.*`, `artworks.*`, `websites.*`, `storyline`, `summary`.
  - Extract YouTube trailer IDs (`videos` where `category = 1` for trailer or `category = 2` for gameplay).
  - Map `websites.category` to recognizable community destinations:
    - `1`: Official Website
    - `2`: Fandom / Wiki
    - `3`: Wikipedia
    - `14`: Reddit
    - `18`: Discord
    - `20`: Speedrun.com
  - Cache metadata in `<Steam>/millennium/config/steam-cartridges/community/<appid>.json`.
  - Expose RPC methods: `GetGameTrailers` and `GetGameCommunityLinks`.
- **Post-Step Check Command:**
  ```powershell
  npm run check
  ```
  *Expected output:* Exits with code 0.

---

### Step 3: Steam Store Loopback Media Server & Workshop Registration
- **File:** `steam-cartridges/frontend/steam/community-store.ts`
- **File:** `steam-cartridges/frontend/steam/community-core.ts`
- **Symbols:** `registerCommunityMedia`, `buildWorkshopMediaItems`
- **Actions:**
  - Normalize `rawAppid = appid >>> 0` on all input parameters.
  - Map local cached media and ScreenScraper captures to loopback URLs:
    `https://steamloopback.host/cartridges/media/<appid>/...`.
  - Register media items into `CWorkshopStore.m_mapPublishedFiles` using synthesized 64-bit IDs so Steam's native image viewers, carousels, and fullscreen lightbox view them seamlessly.
  - Feed video trailers into Steam's `CGameRecordingStore` / timeline or native video iframe player.
- **Post-Step Check Command:**
  ```powershell
  npm run check
  npm run test:ts
  ```
  *Expected output:* `check` exits 0; `test:ts` passes all 64 tests.

---

### Step 4: Big Picture Mode "COMMUNITY" Tab Populator & Native Fallbacks
- **File:** `steam-cartridges/frontend/renderers/community-tab.tsx`
- **File:** `steam-cartridges/frontend/features/steam-store/native-sections.ts`
- **Actions:**
  - Hook Big Picture's native "COMMUNITY" tab using Steam's Gamepad UI component library:
    - **Trailers & Videos Carousel:** First row featuring YouTube / ScreenScraper gameplay trailers with play button and duration badge.
    - **Community Art Gallery:** ScreenScraper fanart, title screens, and promotional artworks rendered with `<Carousel>` and fullscreen zoom.
    - **Digital Game Manual Viewer:** Modal document reader allowing players to flip through original retro game manuals with gamepad D-pad/triggers.
    - **Community Hub Links Bar:** Focusable action buttons linking to Wikipedia, Speedrun leaderboards, Discord, and guides.
    - **Safe Fallback State:** If no external community items exist for a game, render a clean, styled placeholder using `<Focusable>` and `<DialogButton>` without throwing or unmounting.
  - On Desktop: Populate `communitycontent` section in LeftColumn with equivalent thumbnails and community links.
- **Post-Step Check Command:**
  ```powershell
  npm run check
  ```
  *Expected output:* Exits with code 0.

---

### Step 5: Settings Panel Configuration & Toggles
- **File:** `steam-cartridges/frontend/settings/settings.ts`
- **File:** `steam-cartridges/frontend/settings/settings-panel.tsx`
- **Actions:**
  - Add configuration keys:
    - `communityShowTrailers`: boolean (default `true`).
    - `communityShowManuals`: boolean (default `true`).
    - `communityShowArtworks`: boolean (default `true`).
    - `communityShowExternalLinks`: boolean (default `true`).
  - Add toggles to `settings-panel.tsx` in the Settings modal overlay.
- **Post-Step Check Command:**
  ```powershell
  npm run check
  npm run test:ts
  ```
  *Expected output:* `check` exits 0; `test:ts` reports `ℹ pass 64`, `ℹ fail 0`.

---

## 4. Do-Not-Touch List

1. **StoreItemCache.m_mapApps:** Never delete shortcut stubs upon unpatching. Stubs must remain to prevent negative-cache poisoning (`m_setUnavailableApps`).
2. **Support Links Filter:** `cleanLinksProps` in `native-sections-core.ts` must continue stripping Valve Support (`helpwithgame`) links for non-Steam shortcuts.
3. **Headline Patch Scoping:** `headline-patch.ts` must continue scoping `' captured'` string replacements strictly to screenshot events (`eEventType === 13 || undefined`), preserving native localized strings for types 3 and 30.
4. **Zero In-Process Memory Modification:** All integrations must use Steam's web runtime and loopback host. Never perform DLL injection or memory patching.
5. **AppOverview Prototype:** Never break `target.m_gameid` or `this.m_gameid` return contract on `GetGameID` (Guardrail 1).

---

## 5. Banned Actions

1. No `git push --force` or history rewriting without authorization.
2. No AI attribution trailers (`Co-Authored-By`, `Generated with...`) in git commits or PR descriptions (Routine 6).
3. No reloading `SharedJSContext` via `location.reload()` (causes blocking Save As dialog).
4. No pointing non-Steam games to Valve's `helpwithgame` support URL.
5. No hardcoded paths: always use `millennium.steam_path()` and `data_dir.path()`.
6. No calling unregistered RPC method names in Millennium (crashes backend process with `0xC0000005`).

---

## 6. Guardrail Checklist

| Guardrail | Description | Status / Proof |
| --- | --- | --- |
| **Guardrail 1** | Prototype Hook Coupling (`BIsModOrShortcut` vs `GetGameID`) | Preserved — media source uses composed 64-bit ID for captures, 32-bit for store. |
| **Guardrail 2** | Section Registry Restoration | Preserved — hooks into `CAppDetailsSections` without mutating unowned apps. |
| **Guardrail 5** | Store Record Blocker | Preserved — `fakeApp` in `StoreItemCache` provides required getters without network requests. |
| **Guardrail 6** | Component Reuse Over Pixel Measuring | Preserved — uses Steam's `<Focusable>`, `<Carousel>`, and `DialogButton` components. |
| **Guardrail 12** | Popup Target Topology | Preserved — all stores modified in `SharedJSContext` and ported to BPM popups. |
| **Guardrail 15** | Verification Polling | Preserved — automated tests poll for asynchronous data load before asserting. |

---

## 7. Failure Rule

If any check command fails:
1. Re-run once to eliminate transient timing glitches.
2. On second failure, stop immediately. Append the failing command, the step number, and the last 30 lines of output to `TASK.md` under "Active Failures & Blockers".
3. Exit without attempting workarounds.

---

## 8. Live Verification Suite

After deploying the feature with `powershell -ExecutionPolicy Bypass -File dev.ps1`, run:
```powershell
node scratch/check_all_tabs.js
```
Expected output:
```
PASS  1. Post-Game Summary
PASS  2. Activity feed: "{Username} captured" cards (hasEvent)
PASS  3. Your Stuff: media items
PASS  4. Game Info: description, developer, release date
PASS  4. Game Info: no grey shortcut warning
PASS  collectionStore health: userCollections readable
PASS  Native B Game Info: no error boundary
PASS  A -> B -> A: Post-Game Summary intact
PASS  A -> B -> A: no error boundary
PASS  A -> B -> A: activity cards intact (hasEvent)
```
