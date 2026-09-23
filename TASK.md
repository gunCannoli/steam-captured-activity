# TASK — `non-steam-games-activity`

Lean tracker: **current status + what's next.** Detailed history, verification
logs and rationale live in
[non-steam-games-activity/CHANGELOG.md](non-steam-games-activity/CHANGELOG.md),
[docs/decisions.md](docs/decisions.md) (ADRs) and
[docs/steam-components.md](docs/steam-components.md) (Steam internals). Don't
duplicate that detail here — link to it.

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

---

## Status

| Area                               | State                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post-Game Summary (desktop)        | ✅ Shipped. Real Steam component, fed via `steam/summary.ts`.                                                                                                                                                                                        |
| Library grid                       | ✅ Shipped. Last-played dates populated from captures.                                                                                                                                                                                               |
| Post-Game Summary (Big Picture)    | ✅ Shipped. Real Steam component via React Portal & store feeding ([ADR-0029](docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)).                  |
| Per-day Activity feed              | ✅ Shipped ([ADR-0030](docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing)); Phase 3b shipped (BPM 16:9 thumbnail sizing, native headline '{Username} recorded', unified captures). |
| Core Refresh & Caching             | ✅ Shipped. `onAppLaunch` lifecycle invalidation + mtime caching in `shortcuts.vdf` & `screenshots.vdf`.                                                                                                                                             |
| Native Achievements                | 🔬 Verified in Steam client. Next implementation phase (Phase 5).                                                                                                                                                                                    |
| Achievement Notifications & Toasts | 🔬 Verified in Steam client. `NotificationStore.OnNotification` mapped.                                                                                                                                                                              |
| Game Recording & Auto-Captures     | 🔬 Verified in Steam client. RPCs & timeline markers mapped (`80026`).                                                                                                                                                                               |
| Game Info & Metadata Enrichment    | ✅ Complete. Phase 8 & 8b shipped (`library_metadata.json`, IGDB, short description, BPM filter bypass).                                                                                                                                             |
| Docs Housekeeping & Architecture   | ✅ Shipped. Purged `steam-styles.md`, added `docs/steam-architecture.md`, updated `CHANGELOG.md`.                                                                                                                                                    |
| Provider contract                  | ⬜ Architecture planned ([docs/architecture.md](docs/architecture.md)).                                                                                                                                                                              |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Multi-Session Roadmap

### Phase 3b: Daily Activity Feed BPM Thumbnail Sizing & Headline Refinement (✅ Complete)

- **BPM Thumbnail Metrics:** Constrain `.CarouselThumb` and `.ImageWrapper img` in Big Picture Mode to Steam's native 16:9 thumbnail dimensions (320×180px), preventing 1440p/4K raw screenshots from stretching to 2560px/3840px and blowing out the container.
- **Headline Wording:** Intercept the headline renderer for non-Steam captures to display `"{Username} recorded"` instead of the community UGC string `"{Username} shared X screenshots"`, aligning with Steam's native achievement headline convention (`"{Username} achieved"`).
- **Clips & Screenshots Integration:** Ingest recordings alongside screenshots into the chronological day list so all captures appear in a unified feed.

### Phase 4: Core Refresh & Caching Hardening (✅ Complete)

- Complete `onAppLaunch` → `onQuit` lifecycle invalidation for active shortcuts.
- Add mtime-keyed caching to `shortcuts.vdf` and captures index backend readers.
- Keep core completely zero-network and self-contained ([ADR-0012](docs/decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)).

### Phase 5: Native Achievement Integration (Desktop & Big Picture)

- **Desktop Sidebar:** Re-enable `"achievements"` in `CAppDetailsSections.GetSections()` and feed `AppDetailsStore.GetAchievements(appid)` (module `78057` / `57665`) with `{ nAchieved, nTotal, vecHighlight, vecUnachieved }`.
- **Post-Game Summary:** Feed `CGamePlaySession.prototype.AddAchievement(achievement, unlockTime)` so unlocked achievements appear in the summary card strip alongside screenshots and clips.
- **Big Picture Play Bar:** Feed `appAchievementProgressCache.m_achievementProgress.mapCache` with `{ unlocked, total }` so quick stats display under the Play button.
- **Data Adapters:** Ingest schemas and unlocks from local emulator sources (RPCS3 `TROPCONF.SFM`/`TROPUSR.DAT`, RetroArch/rcheevos logs, DuckStation, PCSX2) and generic JSON.

### Phase 6: Achievement Notifications & Audio Customization

- **Native Toast Triggering:** Synthesize achievement popups using `window.NotificationStore.OnNotification(id, NotificationType.Achievement, binaryPayload)` (`CAchievementNotification` protobuf).
- **Sound System Customization:** Hook `NotificationStore.ChooseSound` / `PlayNotificationSound` or trigger custom audio chimes (PlayStation trophy chime, Xbox rare achievement chime, RetroAchievements chime, Steam classic).
- **Toast Styling & Badging:** Leverage Steam's native toast rendering (no hand-built DOM) with optional CSS accenting.

### Phase 7: Native Auto-Captures on Achievement Unlock

- **Auto-Screenshot:** Trigger native screenshot capture via `GameRecording.TakeScreenshot#1` or `SteamClient.Screenshots`, automatically saving and cataloging the screenshot into the shortcut's screenshot directory so it instantly appears in the Activity feed.
- **Timeline Achievement Markers:** Invoke `GameRecording.UserAddTimelineEntry#1` to place a golden achievement icon marker onto Steam's active game recording timeline at the exact moment of unlock.
- **Instant Replay Clip:** Call `GameRecording.SaveClip#1` to cut an automated highlight clip (e.g. preceding 15–30 seconds) into `gamerecordings/clips/` when an achievement triggers.

### Phase 8: Game Info & Metadata Enrichment (Optional Provider) (✅ Complete)

- **Consolidated Local JSON Database (`library_metadata.json`):** Single, human-readable file mapping non-Steam game metadata. Supports manual tweaks and `custom_override` flag so user edits are never clobbered.
- **IGDB & Twitch OAuth2 Backend:** Automatically requests and caches Twitch access tokens, queries IGDB v4 APICalypse games endpoint, and extracts descriptions, developer/publisher credits, franchises, and release dates.
- **Native Game Modes & Categories:** Maps IGDB `game_modes` into native Steam category badges (`Single-player: 2`, `Multiplayer: 1`, `Co-op: 9`, `Shared/Split Screen: 24`, `Full Controller Support: 28`) injected into `appStore.GetAppOverviewByAppID(appid).m_setStoreCategories`.
- **Custom Artwork:** Deferred per requirements to prioritize metadata accuracy and game info richness.

### Phase 8b: Big Picture Game Info Filter Bypass & Enriched Metadata Display (✅ Complete)

- **Bypass Big Picture Shortcut Filter:** Steam's inner Game Info component (`k` in module `15448`) tests `this.props.overview.BIsModOrShortcut()`; if `true`, it suppresses descriptions, developer/publisher credits, and release dates, rendering `#AppDetails_Shortcut_Explanation`.
- **Targeted Prototype Interception:** Hooked `AppOverview.prototype.BIsModOrShortcut` when invoked from `k.render` to return `false` if `appDetailsStore` contains enriched descriptions or developer credits for the shortcut.
- **64-bit GameID Integrity Preserved:** Leaves all other callers (such as `GetGameID()`) completely untouched, ensuring 64-bit shortcut identifiers (`m_gameid: 18310622842007322624`) continue working seamlessly for screenshot and recording lookups.
- **Multi-Window Reactive Refresh:** Implemented cross-window fiber traversal via `g_PopupManager` (module `41433`/`75380`) in `refreshGameInfoInstances()`, automatically triggering `forceUpdate()` on mounted `k` components across both Desktop and Big Picture popup windows.
- **Verified Live in Big Picture Mode:** Verified on AM2R (`4263274102`) that Game Info cleanly renders native description snippet, developer (`DoctorM64`), publisher (`DoctorM64`), controller/single-player badges, and user collections with zero shortcut explanation warnings.

### Side Task 1: Activity Feed Native Post-Game Summary Component Reuse & Media Player Integration

- **Native Summary Card Structure:** For daily grouped activity items (e.g. September 20 with 2 screenshots and 2 recordings), replace custom CSS metric cards with Steam's native `SummaryContainer` / `PostGameSummaryCard` component structures.
- **Unified Media Interaction:** Retain native hover and click handlers so clicking video clips opens Steam's native media player rather than static images.
- **Heterogeneous Event Aggregation:** Properly aggregate all 4 items for AM2R's September 20 session (2 recordings + 2 screenshots) and prepare for future achievement unlock cards in the same daily bucket.

### Side Task 2: IGDB Metadata Schema Simplification & Disambiguation Refinement

- **Schema Consolidation:** Simplify `library_metadata.json` schema to retain a single canonical `description` field, removing redundant `short_description` and `summary` fields.
- **Disambiguation & Main Game Priority:** Improve search and ranking logic in `igdb.lua` to prioritize parent/main game entries over port editions, remakes, or DLCs (e.g., ensuring _Battletoads & Double Dragon_ matches the full game overview rather than a 16-bit port summary).
- **Franchise & Brand Ownership:** Refine franchise parsing to reflect IP/brand ownership semantics rather than generic series tags where appropriate.

### Phase 9: Provider Contract & Multi-Plugin Architecture

- Formalize the provider IPC contract (`retroachievements`, `steamgriddb`, `retroarch`) adhering to [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it) and [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[AGENTS.md](AGENTS.md#working-agreements). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-components.md § Reproducing this](docs/steam-components.md#reproducing-this-the-inspection-method).
