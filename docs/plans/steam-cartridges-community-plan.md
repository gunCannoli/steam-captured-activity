# Plan: Retro Games Community & Media in steam-cartridges

**Status:** Plan Complete · Execution Ready  
**Reference Architecture:** [docs/millennium-architecture.md](../millennium-architecture.md)  
**Parent Documentation:** [docs/steam-components.md](../steam-components.md) · [docs/plugins.md](../plugins.md)  
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Context & Root Cause Analysis

### Current State & Problem
Steam hides all Community features from non-Steam shortcuts:
- **Big Picture Mode:** The native "COMMUNITY" tab renders an empty placeholder (`? No additional content`) because shortcuts lack a Valve Community Hub ID, Steam Workshop files, and Steam Community feeds.
- **Desktop Client:** The `community` and `communitycontent` sections in the left-column registry (`CAppDetailsSections`) remain unpopulated or show a generic fallback.
- **Retro Games Isolation:** Emulated and non-Steam games miss trailers, digital manuals, high-resolution fanart, titlescreens, speedrun guides, and wiki links that native games enjoy on Steam.

### Solution: Multi-Source Community & Media Ingestion
Rather than leaving the Community tab empty or replacing it with an unstyled webview:
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
3. Unit test suite passes 100%: `npm run test:ts` in `steam-cartridges/` exits with code 0 (60/60 tests passing).
4. Steam Client is running in dev mode (`127.0.0.1:8080`).

---

## 3. Ordered Implementation Steps

### Step 1: ScreenScraper Media & Manuals Backend Provider
- **File:** `steam-cartridges/backend/screenscraper_media.lua` (New)
- **Actions:**
  - Implement `fetchMedia(romPath, systemId, crc, md5)` querying ScreenScraper's `jeuInfos.php` API.
  - Parse media sections: `medias/screenshot`, `medias/titlescreen`, `medias/fanart`, `medias/video-normalized`, and `medias/manual`.
  - Cache downloaded media in `userdata/cartridges/media/<appid>/`:
    - `screenshots/` (in-game and titlescreen images).
    - `videos/` (30s gameplay MP4 preview).
    - `manuals/` (PDF or image scans).
  - Expose RPC methods: `GetGameMedia(appid)` and `GetGameManual(appid)`.
- **Verification Command:** Run `lua tests/test_backend.lua` with mock ScreenScraper JSON response.

### Step 2: IGDB Community & Trailers Backend Provider
- **File:** `steam-cartridges/backend/igdb_community.lua` (New)
- **Actions:**
  - Query IGDB `/games` with fields: `videos.*`, `artworks.*`, `websites.*`, `storyline`, `summary`.
  - Extract YouTube trailer IDs (`videos` where `category = 1` for trailer or `category = 2` for gameplay).
  - Map `websites.category` to recognizable community destinations:
    - `1`: Official Website
    - `2`: Fandom / Wiki
    - `3`: Wikipedia
    - `14`: Reddit
    - `18`: Discord
    - `20`: Speedrun.com
  - Cache metadata in `userdata/cartridges/community/<appid>.json`.
  - Expose RPC methods: `GetGameTrailers(appid)` and `GetGameCommunityLinks(appid)`.
- **Verification Command:** Run `lua tests/test_backend.lua` verifying IGDB website and video parsing.

### Step 3: Steam Store Loopback Media Server & Workshop Registration
- **File:** `steam-cartridges/frontend/steam/community-store.ts` (New)
- **Actions:**
  - Map local cached media and ScreenScraper captures to loopback URLs:
    `https://steamloopback.host/cartridges/media/<appid>/...`.
  - Register media items into `CWorkshopStore.m_mapPublishedFiles` so Steam's native image viewers, carousels, and fullscreen lightbox view them seamlessly.
  - Feed video trailers into Steam's `CGameRecordingStore` / timeline or native video iframe player.
- **Verification Command:** Execute `npm run check` and verify `community-store.ts` compiles cleanly.

### Step 4: Big Picture Mode "COMMUNITY" Tab Populator
- **File:** `steam-cartridges/frontend/renderers/community-tab.tsx` (New)
- **File:** `steam-cartridges/frontend/features/steam-store/native-sections.ts`
- **Actions:**
  - Hook Big Picture's native "COMMUNITY" tab using Steam's Gamepad UI component library:
    - **Trailers & Videos Carousel:** First row featuring YouTube / ScreenScraper gameplay trailers with play button and duration badge.
    - **Community Art Gallery:** ScreenScraper fanart, title screens, and promotional artworks rendered with `<Carousel>` and fullscreen zoom.
    - **Digital Game Manual Viewer:** Modal document reader allowing players to flip through original retro game manuals with gamepad D-pad/triggers.
    - **Community Hub Links Bar:** Focusable action buttons linking to Wikipedia, Speedrun leaderboards, Discord, and guides.
  - On Desktop: Populate `communitycontent` section in LeftColumn with equivalent thumbnails and community links.
- **Verification Command:** `node scratch/check_all_tabs.js` verifying the "COMMUNITY" tab displays populated content without error boundaries.

### Step 5: Settings Panel Configuration
- **File:** `steam-cartridges/frontend/settings/settings.ts`
- **File:** `steam-cartridges/frontend/settings/settings-panel.tsx`
- **Actions:**
  - Add configuration keys:
    - `communityShowTrailers`: boolean (default `true`).
    - `communityShowManuals`: boolean (default `true`).
    - `communityShowArtworks`: boolean (default `true`).
    - `communityShowExternalLinks`: boolean (default `true`).
  - Add toggles to `settings-panel.tsx` in a dedicated "Community & Media" section.
- **Verification Command:** `npm run check` and `npm run test:ts`.

---

## 4. Do-Not-Touch List

- **StoreItemCache.m_mapApps:** Never delete shortcut stubs upon unpatching. Stubs must remain to prevent negative-cache poisoning (`m_setUnavailableApps`).
- **Support Links Filter:** `cleanLinksProps` in `native-sections-core.ts` must continue stripping Valve Support (`helpwithgame`) links for non-Steam shortcuts.
- **Headline Patch Scoping:** `headline-patch.ts` must continue scoping `' captured'` string replacements strictly to screenshot events (`eEventType === 13 || undefined`), preserving native localized strings for types 3 and 30.
- **Zero In-Process Memory Modification:** All integrations must use Steam's web runtime and loopback host. Never perform DLL injection or memory patching.

---

## 5. Banned Actions

1. No `git push --force` or history rewriting without authorization.
2. No AI attribution trailers (`Co-Authored-By`, `Generated with...`) in git commits or PR descriptions (Routine 6).
3. No reloading `SharedJSContext` via `location.reload()` (causes blocking Save As dialog).
4. No point non-Steam games to Valve's `helpwithgame` support URL.
5. No hardcoded paths: always use `millennium.steam_path()` and discovery mechanisms.

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

## 7. Live Verification Suite

After deploying the feature, run:
```powershell
node scratch/check_all_tabs.js
```
Expected output:
```
PASS  1. Post-Game Summary
PASS  2. Activity feed: "{Username} captured" cards (hasEvent)
PASS  3. Your Stuff: media items
PASS  4. Game Info: description, developer, release date
PASS  5. Community: trailers and media carousel populated
PASS  A -> B -> A: all sections intact without error boundaries
```
