# Changelog

Workspace-level history: documentation, conventions, and decisions that span
plugins. Each plugin keeps its own changelog for anything user-facing —
see [non-steam-games-activity/CHANGELOG.md](non-steam-games-activity/CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repo is private and unversioned; entries are grouped by date.

## [Unreleased]

- **Phase 6 Plan Hardened Against Regression Guardrails (`enhanced-achievements`):**
    - **Guardrail-conformant execution plan:** Replaced the roadmap in [`docs/enhanced-achievements-plan.md`](docs/enhanced-achievements-plan.md) with a step-by-step Phase 6 plan (live re-verify → scaffold → config/themes → sound hook → banner → verification) plus a Phase 7 outline. Hook points are now resolved by signature instead of the numeric module ids (`11374`, `ht`) the draft used, which `docs/plugins.md` forbids.
    - **Scope boundaries & plugin guardrails:** The plugin may hook only `NotificationStore` and the achievement toast renderer. It must never touch `AppOverview`, `StoreItemCache`, the section registry or the activity/spotlight stores, never import from the core plugin, and never do per-toast disk, RPC or network work. Every hook falls through to Steam's original on failure. The core regression routines (1–3) must pass with both plugins enabled.
    - **Open risks surfaced:** Whether in-game overlay toasts render from `SharedJSContext`; whether 100% completion is knowable at toast time (needed for the `exceptional` tier); where user settings and themes live so updates don't overwrite them.
    - **Settings split:** [`enhanced-achievements/settings.json`](enhanced-achievements/settings.json) now holds the active theme, banner/sound toggles and capture defaults; themes hold only visuals and sound, with optional per-tier capture overrides. [`themes.md`](enhanced-achievements/themes.md) was rewritten to match, adding tier-selection order, a no-rarity-data fallback, merge semantics, icon shorthand and asset path resolution. `theme_exemple.json` now uses the canonical `"topright"`.
    - **Doc repair:** Commit `5ccf645` re-introduced stale lines next to their replacements in `docs/plugins.md`, `README.md`, `docs/architecture.md` (including two phantom table columns) and `themes.md`; these were removed.
    - **`TASK.md` pruned:** Shipped work (Phase 4b, shipped status rows) moved out; `TASK.md` now lists open phases only.

- **Documentation Streamlining & Lean `AGENTS.md` Refactor:**
    - **Consolidated Plugin Guide & Guardrails into `docs/plugins.md`:** Moved all 9 mandatory regression guardrails, failure traps, the 4-rung UI modification ladder, and plugin creation scaffolding guidelines into [`docs/plugins.md`](docs/plugins.md), keeping root [`plugins.md`](plugins.md) as a direct entry pointer.
    - **Lean `AGENTS.md`:** Streamlined [`AGENTS.md`](AGENTS.md) down from 317 lines to 160 lines, focusing strictly on core non-Steam identifiers (`appid` vs composed `gameid`), environment facts, and 5 standard agent operating routines (Multi-Tab Smoke Verification, Two-Way Navigation Lifecycle, Automated CDP Suite, Build & Run, End-of-Session Prune/Sync/Auto-Push).
    - **Cross-Reference Hygiene:** Updated all workspace documentation (`README.md`, `TASK.md`, `docs/decisions.md`, `docs/architecture.md`) to point cleanly to `docs/plugins.md`.

- **Enhanced Achievements Architecture & Investigation Plan (Phase 6 & 7):**
    - **Live Steam Client Reverse-Engineering:** Used CDP probing against `SharedJSContext` (`127.0.0.1:8080`) to map the entire native notification engine (`NotificationStore` in module `60917`), sound playback interception (`PlayNotificationSound`, `ChooseSound`), and toast rendering (`function ht` in module `11374`).
    - **Sound & Banner Interception Hooks:** Confirmed that hooking `PlayNotificationSound` cleanly silences the default Steam chime (`j.PN.ToastAchievement`) and triggers custom audio playback via HTML5 `AudioContext` with per-tier volume control, while patching `ht` allows rendering themed banners with zero UI drift.
    - **Steam Game Recording & Capture RPCs Mapped:** Identified `CGameRecordingService` (module `80026`, export `xM`) RPCs: `UserAddTimelineEntry` (golden trophy timeline markers), `SaveClip` (instant replay buffer extraction), and `TakeScreenshot`.
    - **Schema & Theme Specification:** Updated [`enhanced-achievements/themes.md`](enhanced-achievements/themes.md) and [`enhanced-achievements/steam_ps_exemple.json`](enhanced-achievements/steam_ps_exemple.json) to incorporate auto-screenshot delay (`screenshot.delay_ms`), auto-recording duration/delay (`recording.duration_s`, `recording.delay_ms`), and timeline markers across rarity tiers (`normal`, `magic`, `rare`, `exceptional`).
    - **Authored Comprehensive Implementation Plan:** Created [`docs/enhanced-achievements-plan.md`](docs/enhanced-achievements-plan.md) detailing plugin structure, hook points, theme inheritance rules, and phase-by-phase execution roadmap.

- **Lifecycle Cache Hardening & Navigation Resilience (Phase 4b Shipped):**
    - **Eliminated Cache Deletion on Unpatch:** Removed `storeCache.m_mapApps.delete(appid)` from `clearActivity` in `activity.ts`. In-memory StoreItem stubs now persist indefinitely across navigations (~150 bytes), preventing asynchronous 404 store requests from unmounting React hooks.
    - **Negative Cache Purging on Ingestion:** Explicitly delete `storeCache.m_setUnavailableApps?.delete(appid)` in `publishActivity` to purge any historical negative-cache poisoning prior to rendering.
    - **`StoreItemCache.prototype.BIsAppMissing` Shortcut Immunity Hook:** Hooked `BIsAppMissing` on `StoreItemCache.prototype` to return `false` whenever `appid >= 0x8000_0000`. This permanently immunizes non-Steam shortcuts from being treated as missing or unavailable store items.
    - **Two-Way Navigation Lifecycle Verification:** Verified two-way navigation loop (`AM2R -> Bloodstained -> AM2R`) via automated CDP test harness (`scratch/test_nav_cycle.js`), confirming `hasEvent: true` across all daily buckets. Verified all 4 core views (Post-Game Summary, Activity Feed, Your Stuff, Game Info) live in Big Picture Mode with zero regressions.

- **Regression Audit & Phase 4b Hardening Plan:**
    - **Live CDP Reproduction:** Traced the Big Picture blank Activity feed bug occurring on return navigation (`AM2R -> Bloodstained -> AM2R`), finding that the Day Headers rendered with an empty `<div></div>` body (`hasEvent: false`).
    - **Root Cause Identified (Module `82594`):** On unpatch, `clearActivity` deleted `fakeApp` from `StoreItemCache.m_mapApps`. Concurrent unmounting React hooks (`useStoreItemCache`) detected a cache miss, queued a 404 store request, and permanently poisoned `StoreItemCache.m_setUnavailableApps` (`BIsStoreItemMissing(appid) === true`), causing event renderer `dt` in module `80478` to return `null`. Deleting `m_setUnavailableApps.has(4263274102)` immediately restored all 3 days of events.
    - **Permanent Consolidation into Core Docs:** Codified all findings, permanent invariants, and diagnostic procedures permanently into `AGENTS.md` (Guardrails 1–9), `docs/knowledgebase.md` (Traps 1–9), and `docs/architecture.md` (Pre-Modification Review Index), retiring the temporary audit document.

- **Regression Prevention & Architecture Hardening (Guardrails & ADR-0031):**
    - **Guardrails in `AGENTS.md`:** Codified 4 unbreakable rules for AI agents: prototype hook coupling (`BIsModOrShortcut` vs `GetGameID`), zero expensive operations ($O(1)$ strictly enforced in hot prototype methods), single-pass Webpack module pre-caching, and multi-tab smoke test verification.
    - **Regression Prevention Index in `docs/architecture.md`:** Created a pre-modification review table mapping every feature area (Game Info, Your Stuff, Activity Feed, Post-Game Summary, Achievements & Notifications) to specific reference documents, affected files, and critical hazards/invariants to review before writing code.
    - **Critical Traps in `docs/knowledgebase.md`:** Documented Traps 1–7 covering ID coupling breakdown chains, $O(1)$ performance chokes, Webpack scan render-loop chokes, section memo in-place mutation, and multi-window Reactivity.
    - **ADR-0031 in `docs/decisions.md`:** Recorded the architectural decision to decouple `GetGameID` from `BIsModOrShortcut` on `AppOverview.prototype` and enforce constant-time $O(1)$ prototype lookups.

- **Smarter Scraper Logic & Canonical Platform Disambiguation (Side Task 4):**
    - **Launch Command & Core Ingestion:** Ingested shortcut launch targets, emulator cores (`snes9x`, `genesis_plus_gx`, `fceumm`, `duckstation`, etc.), and ROM file paths directly from `shortcuts.vdf` via backend `shortcuts.lua` and `steam_paths.lua`.
    - **Platform Clue Detection:** Mapped command lines and tags to retro platform hints (SNES, NES, Genesis, GBA, GB, N64, PS1, PSP, Arcade).
    - **Canonical Reference Scoring:** Scored IGDB candidates to favor canonical primary releases (boosting clean slugs like `chrono-trigger` and `battletoads-slash-double-dragon` while penalizing re-release variant slugs `--<num>`), matching platforms (boosting SNES Chrono Trigger `1802` from 1995 over 2018 PC port `206320`), and prioritizing top entries over brief port stubs (boosting Battletoads `7776` over `242267`).
- **Description vs Storyline Priority & Smart Sentence Truncation (Side Task 5):**
    - **Summary-Over-Storyline Priority:** Enforced strict priority of `summary` > `parent_game.summary` > `storyline` for the `description` field, preventing in-game plot/storyline walkthroughs from replacing general game overviews (verified on AM2R `4263274102`).
    - **Smart Sentence Boundary Truncation:** Implemented `truncate_smart` in `igdb.lua` cutting cleanly at sentence-ending punctuation (`.`, `!`, `?`) targeting ~400 characters with leeway, ensuring full complete thoughts without overflowing Steam's Game Info box.
- **Native Release Date Display Verification (Side Task 3):**
    - Verified live in Big Picture Mode that `overview.rt_original_release_date = meta.release_date` natively triggers Steam's `div.Release > div.Date` component, displaying `Aug 5, 2016` on AM2R and `Mar 11, 1995` on Chrono Trigger without custom UI injection.
- **Big Picture Navigation Performance & RPC Recovery (Smoke Test Fixes):**
    - **Eliminated Call-Stack Overhead in `BIsModOrShortcut`:** Replaced expensive `new Error().stack` inspection inside `AppOverview.prototype.BIsModOrShortcut` with an instantaneous $O(1)$ set lookup (`enrichedAppIds.has(this.appid)`), reducing BPM navigation freeze from 30+ seconds down to 27 milliseconds.
    - **Single-Pass Module Scan Pre-caching:** Cleaned up card component resolution in `activity-cards-patch.ts`, executing `initCardComponents()` once on plugin startup rather than iterating Webpack's module registry on every render.
    - **Dynamic RPC Bracket Access:** Replaced AST-rewritten `Millennium.callServerMethod` with `(window as any)['Millennium']['callServerMethod']`, resolving `-dev` suffix failures and restoring metadata population across all non-Steam shortcuts.
- **Activity Card Cutout & Big Picture Performance Fix (Side Task 1):**
    - **Container Selector Disambiguation:** Disambiguated CSS attribute selectors by scoping card widths to `[class*="CarouselThumb"]:not([class*="CarouselThumbs"])` and adding `NonSteamActivityCardsRow` with `width: 100% !important`, preventing parent flex rows from clipping cards down into ~80px cutouts.
- **Game Info Achievements Badge & Category Cache Fix (Side Task 2):**
    - **AM2R Achievements Category Removal:** Corrected AM2R (`4263274102`) in `library_metadata.json` so `categories.achievements` is `false`, ensuring non-achievement games do not display false achievement badges.
    - **Category Cache Invalidation:** `enrichGameDetails` now purges previously tracked `STEAM_CATEGORIES` from `overview.m_setStoreCategories` before applying new ones, preventing stale badges from persisting in memory.
    - **AppDetails Crash Prevention:** Removed synthetic assignment of `appData.details = {}` in `enrichGameDetails`, preventing native `GameStatsSection` crashes caused by missing store-only fields (`vecChildConfigApps`, `unEntitledContentApp`). All developer, publisher, franchise, and description metadata are cleanly served through `appData.associationData` and `appData.descriptionsData`.
- **Daily Activity Feed BPM Thumbnail Sizing & Headline Refinement (Phase 3b):**
    - **Big Picture Mode Thumbnail Sizing:** Injected scoped CSS into the Gamepad popup document (`[class*="CarouselThumb"]`) enforcing Steam's native 16:9 thumbnail dimensions (320×180px with `object-fit: cover`), preventing raw high-resolution (1440p/4K) captures from stretching across the entire screen.
    - **Unified Ingestion of Recordings & Screenshots:** `publishActivity` in `activity.ts` now collects both `screenshotsSince(appid, 0)` and `clipsSince(gameid, 0)` in parallel, registering clip thumbnails and screenshots together in `workshopStore` under chronological daily buckets.
    - **Action Headline Phrasing (`{Username} captured`):** Intercepted `react/jsx-runtime` (`jsx` and `jsxs`) for non-Steam events (`event.bIsNonSteam` / `event.appid >= NON_STEAM_APPID_MIN`), transforming community UGC text (`"{Username} shared X screenshots"`) into Steam's concise native gaming action convention (`"{Username} captured"`, mirroring `"{Username} achieved"`).
- **Game Info & Metadata Enrichment Provider (`library_metadata.json` + IGDB)** (Phase 8 & 8b):
    - **Single Source of Truth (`library_metadata.json`):** Consolidated, human-readable JSON database stored in Steam's root directory (`C:\game\steam\library_metadata.json`). Formatted with clean 2-space indentation so users can directly tweak titles, summaries, descriptions, credits, or categories in any text editor. Preserves manual edits via `custom_override`. Consolidated to a single canonical `description` field (Side Task 2).
    - **Twitch OAuth & IGDB v4 Backend:** Automatic client-credentials token caching and APICalypse queries (`igdb.lua`) extracting developer and publisher credits, franchises, genres, and release timestamps. Prioritizes canonical parent/main games over ports and DLCs.
    - **Native Game Modes & Category Flags:** Translates IGDB `game_modes` into Steam category badges (`m_setStoreCategories`): Single-player (2), Multi-player (1), Co-op (9), Shared/Split Screen (24), and Full Controller Support (28 with `xbox_controller_support = 2`).
    - **Native Game Modes & Category Badges:** Translates metadata into Steam's native `FeaturesList` category badges (`Single-player: 2`, `Multi-player: 1`, `Co-op: 9`, `Shared/Split Screen: 24`, `Full Controller Support: 28`, `Partial Controller Support: 18`, `Achievements: 22`, `Remote Play Together: 44`). Hooked `AppOverview.prototype.BHasStoreCategory` dynamically across the prototype chain (`ensureAppOverviewHooked`) to query our category cache, reliably rendering Steam's native SVG icons and labels on the right-hand side of Game Info.
    - **Native Big Picture "Game Info" Tab Ingestion:** Directly feeds `CAppDetailsStore.GetAppData(appid).descriptionsData` (`strSnippet`, `strFullDescription`) and `associationData` (`rgDevelopers`, `rgPublishers`, `rgFranchises`).
    - **Big Picture Filter Bypass via Targeted Prototype Interception (Phase 8b):** Discovered that Steam's inner Game Info component (`k` in module `15448`) tests `overview.BIsModOrShortcut()`; if true, it suppresses descriptions, developer/publisher credits, and release dates, rendering `#AppDetails_Shortcut_Explanation`. Solved by walking the prototype chain (`ensureAppOverviewHooked`) to hook `BIsModOrShortcut` when invoked from `k.render`, returning `false` for enriched shortcuts to cleanly unlock native `GameDescription`, `Stats`, and `FeaturesList` while leaving `GetGameID()` and 64-bit shortcut identifiers (`m_gameid`) completely unaltered.
    - **Cross-Window Reactive Update & Instant Cache:** Discovered active Big Picture Mode document via `window.g_PopupManager.GetExistingPopup("SP BPM_uid0")` to find mounted component fibers across all popup windows, triggering instant `forceUpdate()` when metadata arrives. Maintained an in-memory `libraryCache` in `index.tsx` for immediate synchronous application upon navigating to any shortcut.
    - **Verified Live in Big Picture Mode:** Verified live in Big Picture Mode on AM2R (`4263274102`), Battletoads (`3586085683`), and Chrono Trigger (`1234567890`) that Game Info cleanly renders full native description, developers, publishers, franchises, release dates, and category badges with zero shortcut explanation warnings.
- **Native Post-Game Summary Card Reuse & Video Playback Dialog (Side Task 1):**
    - BPM daily activity items now mount Steam's native `PostGameSummaryClip` and `SummaryScreenshot` component cards directly inside the BPM feed.
    - Preserved duration badges, hover states, and native click actions, launching Steam's native fullscreen video playback dialog (`OnShowPlaybackControlsDialog`) on clip click.
    - Heterogeneous aggregation groups screenshots and recordings under a single `{Username} captured` banner.
- **`docs/steam-architecture.md`** — Quick-reference directory and cheat sheet of
  Steam's core webpack modules, backing stores (`appSpotlightStore`, `appActivityStore`,
  `AppDetailsStore`, `StoreItemCache`), notification engine (`NotificationStore`),
  game recording RPCs (`CGameRecordingService`), and high-level `SteamClient` APIs.
- **`start-steam-dev.ps1`** — Root automation script to start Steam with CEF
  debugging on port 8080, query active DevTools targets, and distinguish
  `SharedJSContext` from popups.
- **`docs/steam-debug.md`** — CEF DevTools guide covering target topology, console
  filters, and Big Picture inspection traps.
- **Native Achievement & Notification Research** — Verified live on port 8080:
    - `AppDetailsStore.GetAchievements(appid)` (module `78057`) feeds the native
      desktop achievements sidebar.
    - `window.NotificationStore.OnNotification(id, NotificationType.Achievement, binaryPayload)`
      dispatches genuine native achievement toasts with full sound and animation.
    - `CGameRecordingService` (module `80026`) exposes `GameRecording.UserAddTimelineEntry#1`,
      `GameRecording.SaveClip#1`, and `GameRecording.TakeScreenshot#1` for timeline markers,
      instant highlight replays, and screenshot capture.
    - `SteamClient.Apps.SetCustomArtworkForApp` sets portrait, hero, logo, and wide capsules.
- **Reference Codebases Cloned** (`research/`):
    - `research/game-data-linker`: Ingestion patterns for Epic/Xbox links, SteamGridDB artwork, and activity feeds.
    - `research/PlayniteAchievements`: In-game monitoring architecture, rcheevos emulator log tailing, local RPCS3 trophy parsing (`TROPCONF.SFM`/`TROPUSR.DAT`), and sound customization.
- **Native Activity Feed Restored** (ADR-0030) — In-memory `StoreItem` stubbing in
  `StoreItemCache` satisfies Steam's `storeApp.BIsVisible()` event guard without network
  calls. Unlocked chronological per-day activity feed cards on both Desktop and Big Picture.
- **Big Picture React Portal Architecture** (ADR-0029) — Proved Big Picture runs
  in the same `SharedJSContext` runtime as Desktop. Portals and store feeding supersede
  DOM cloning completely.
- **Section Registry Restoration** (ADR-0022) — Restoring `"postgamesummary"` and
  `"activity"` in `CAppDetailsSections.prototype.GetSections` allowed deleting ~1200
  lines of hand-built UI.

### Fixed

- **"YOUR STUFF" Tab Media Regression & `GetGameID` Decoupling:**
    - **Root Cause:** In `steamgriddb-artwork/frontend/steam/game-info-patch.ts`, hooking `AppOverview.prototype.BIsModOrShortcut` to return `false` for enriched shortcuts caused Steam's native `GetGameID()` implementation (`return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString()`) to evaluate to `this.appid.toString()` (`"4263274102"`). Shortcut captures in `screenshots.vdf` and `window.g_GRS` are keyed by the composed 64-bit ID (`"18310622842007322624"`). Querying by `appid.toString()` returned 0 items in module `57150`, rendering the empty "you can take a screenshot" placeholder.
    - **Solution:** Hooked `GetGameID` on `AppOverview.prototype` in `ensureAppOverviewHooked` to return `this.m_gameid` whenever present. This completely decouples 64-bit shortcut identification from the `BIsModOrShortcut` flag.
    - **Section Protection:** Updated `isShortcut` in `non-steam-games-activity/frontend/steam/sections.ts` to test `overview.appid >= 0x8000_0000` alongside `BIsModOrShortcut()`, ensuring core detail sections (`postgamesummary`, `activity`) are never accidentally filtered when `BIsModOrShortcut()` is bypassed.
    - **Verified Live in Big Picture Mode:** Both "YOUR STUFF" (displaying 10 screenshots, 24 clips, duration badges, and "Manage my 8 items") and "GAME INFO" (displaying full smart summary, credits, release date, and category badges without shortcut warning) render concurrently with 100% data integrity.

### Changed

- **`docs/steam-styles.md` purged & rewritten** — Deleted 150+ lines of obsolete
  hand-measured pixel dimensions and gradients. The document now serves as a lean
  guide reinforcing the rule: clone existing native blocks from CEF DevTools or reuse
  native components; never author custom CSS to imitate Steam.
- **`AGENTS.md` updated** — Incorporated `docs/steam-architecture.md` into the
  required reading table, updated the styling agreement to forbid hand-written CSS,
  and designated `CHANGELOG.md` as the repository's historical truth.
- **`TASK.md` updated** — Expanded into a structured multi-session roadmap covering
  Core Caching (Phase 4), Native Achievements (Phase 5), Achievement Notifications
  (Phase 6), Auto-Captures & Timeline Markers (Phase 7), and Artwork/Metadata (Phase 8).
- **`non-steam-games-activity/frontend/steam/sections.ts`** — Removed stale comments
  claiming `activity` was disabled, documenting the ADR-0030 `StoreItemCache` solution.

### Removed

- Hand-built Big Picture clone (`renderers/gamepad-app.tsx`, ~280 lines) deleted.
- Hand-built Desktop summary and carousel components (~800 lines) deleted.
- Obsolete backend RPCs and timeline parsing (`timeline.lua`, `assets.lua`, ~700 lines) deleted.

---

## 2026-09-19

### Added

- **Workspace scaffolding** — `README.md`, `CHANGELOG.md`, `plugin.md`,
  `.gitignore`, and per-plugin changelogs.
- **`docs/knowledgebase.md`** — Millennium SDK mechanics, Steam's local data
  formats (`shortcuts.vdf`, `screenshots.vdf`, `gamerecordings/`), and
  RetroAchievements / RetroArch as provider sources.
- **`docs/architecture.md`** — The core/provider split, data flow, module layout,
  and provider contract.
- **`docs/decisions.md`** — Initial set of architectural decisions (ADR-0001 through ADR-0017).

### Changed

- **Restructured from a single retro-games plugin into a core plus providers**
  (ADR-0012). Probing Steam's own capture store showed the core could stand on exact
  arithmetic instead of fuzzy ROM matching.
- **First live load.** The plugin built, deployed, and ran in Steam, reporting 223
  shortcuts and 211 screenshots.
