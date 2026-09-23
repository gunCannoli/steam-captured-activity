# Changelog

Workspace-level history: documentation, conventions, and decisions that span
plugins. Each plugin keeps its own changelog for anything user-facing —
see [non-steam-games-activity/CHANGELOG.md](non-steam-games-activity/CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repo is private and unversioned; entries are grouped by date.

## [Unreleased]

### Added

- **Game Info & Metadata Enrichment Provider (`library_metadata.json` + IGDB)** (Phase 8):
    - **Single Source of Truth (`library_metadata.json`):** Consolidated, human-readable JSON database stored in Steam's root directory (`C:\game\steam\library_metadata.json`). Formatted with clean 2-space indentation so users can directly tweak titles, summaries, descriptions, credits, or categories in any text editor. Preserves manual edits via `custom_override`.
    - **Twitch OAuth & IGDB v4 Backend:** Automatic client-credentials token caching and APICalypse queries (`igdb.lua`) extracting storylines, developer and publisher credits, franchises, genres, and release timestamps.
    - **Native Game Modes & Category Flags:** Translates IGDB `game_modes` into Steam category badges (`m_setStoreCategories`): Single-player (2), Multi-player (1), Co-op (9), Shared/Split Screen (24), and Full Controller Support (28).
    - **Native Big Picture "Game Info" Tab Ingestion:** Directly feeds `CAppDetailsStore.GetAppData(appid).descriptionsData` (`strSnippet`, `strFullDescription`) and `associationData` (`rgDevelopers`, `rgPublishers`, `rgFranchises`).
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
