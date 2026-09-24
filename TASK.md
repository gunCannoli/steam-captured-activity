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

| Area                               | State                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Post-Game Summary (desktop)        | ✅ Shipped. Real Steam component, fed via `steam/summary.ts`.                                                                                                                                                                                                                                                |
| Library grid                       | ✅ Shipped. Last-played dates populated from captures.                                                                                                                                                                                                                                                       |
| Post-Game Summary (Big Picture)    | ✅ Shipped. Real Steam component via React Portal & store feeding ([ADR-0029](docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)).                                                                          |
| Per-day Activity feed              | ✅ Shipped ([ADR-0030](docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing)); Phase 3b shipped; Phase 4b shipped (lifecycle cache hardening, permanent in-memory store stubs, `BIsAppMissing` shortcut immunity hook, negative cache purge). |
| Core Refresh & Caching             | ✅ Shipped. `onAppLaunch` lifecycle invalidation + mtime caching in `shortcuts.vdf` & `screenshots.vdf`.                                                                                                                                                                                                     |
| Native Achievements                | 🔬 Verified in Steam client. Next implementation phase (Phase 5).                                                                                                                                                                                                                                            |
| Achievement Notifications & Toasts | 🔬 Verified in Steam client. `NotificationStore.OnNotification` mapped.                                                                                                                                                                                                                                      |
| Game Recording & Auto-Captures     | 🔬 Verified in Steam client. RPCs & timeline markers mapped (`80026`).                                                                                                                                                                                                                                       |
| Game Info & Metadata Enrichment    | ✅ Complete. Phase 8 & 8b shipped; Side Tasks 1-5 + Your Stuff regression completed (platform/core disambiguation, canonical reference scoring, summary-over-storyline priority, smart sentence truncation, release date display, category badges, O(1) performance fix, GetGameID decoupling).              |
| Docs Housekeeping & Architecture   | ✅ Shipped. Purged `steam-styles.md`, added `docs/steam-architecture.md`, updated `CHANGELOG.md`.                                                                                                                                                                                                            |
| Provider contract                  | ⬜ Architecture planned ([docs/architecture.md](docs/architecture.md)).                                                                                                                                                                                                                                      |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Multi-Session Roadmap

### Phase 4b: Lifecycle Cache Hardening & Navigation Resilience (✅ Shipped)

> **Specification & Audit Trace:** See [CHANGELOG.md](CHANGELOG.md) and [docs/knowledgebase.md § Trap 8](docs/knowledgebase.md#trap-8-negative-cache-poisoning--stub-lifetime-in-storeitemcache).

- **Eliminate Cache Deletion on Unpatch:** Removed `storeCache.m_mapApps.delete(appid)` from `clearActivity(appid)` in `frontend/steam/activity.ts`. Stubs persist indefinitely to prevent asynchronous 404 store queries on view unmount.
- **Purge Negative Cache on Ingestion:** Added explicit `storeCache.m_setUnavailableApps?.delete(appid)` in `publishActivity(appid, gameid)` before rendering.
- **Install Safety Hook on `BIsAppMissing`:** Hooked `StoreItemCache.prototype.BIsAppMissing` to return `false` whenever `appid >= 0x8000_0000`, providing permanent immunity against negative cache poisoning.
- **Two-Way Lifecycle Verification:** Verified two-way navigation loop (`AM2R -> Bloodstained -> AM2R`) via automated CDP harness, confirming `hasEvent: true` across all daily buckets, and verified all 4 core views (Post-Game Summary, Activity, Your Stuff, Game Info) live in Big Picture Mode.

### Phase 5: Native Achievement Integration (Desktop & Big Picture)

- **Desktop Sidebar:** Re-enable `"achievements"` in `CAppDetailsSections.GetSections()` and feed `AppDetailsStore.GetAchievements(appid)` (module `78057` / `57665`) with `{ nAchieved, nTotal, vecHighlight, vecUnachieved }`.
- **Post-Game Summary:** Feed `CGamePlaySession.prototype.AddAchievement(achievement, unlockTime)` so unlocked achievements appear in the summary card strip alongside screenshots and clips.
- **Big Picture Play Bar:** Feed `appAchievementProgressCache.m_achievementProgress.mapCache` with `{ unlocked, total }` so quick stats display under the Play button.
- **Data Adapters:** Ingest schemas and unlocks from local emulator sources (RPCS3 `TROPCONF.SFM`/`TROPUSR.DAT`, RetroArch/rcheevos logs, DuckStation, PCSX2) and generic JSON.

### Phase 6: Achievement Notifications & Audio Customization (`enhanced-achievements`)

> **Architecture & Plan:** See [docs/enhanced-achievements-plan.md](docs/enhanced-achievements-plan.md), [themes.md](enhanced-achievements/themes.md), and [steam_ps_exemple.json](enhanced-achievements/steam_ps_exemple.json).

- **Themed Banner Replacement:** Intercept native achievement toast rendering (module `11374`, component `ht`) to apply JSON-defined themes (PlayStation, Xbox, Retro) with custom layouts, borders, glows, and animations.
- **Sound Interception:** Hook `NotificationStore.prototype.PlayNotificationSound` to silence the default Steam chime and play custom, high-fidelity audio assets per rarity tier (`normal`, `magic`, `rare`, `exceptional`) with volume control.
- **Easy Theme Creation:** Declarative JSON theme schema documented in `enhanced-achievements/themes.md` with inheritance.

### Phase 7: Native Auto-Captures on Achievement Unlock (`enhanced-achievements`)

- **Delayed Auto-Screenshot:** Configurable delay (`screenshot.delay_ms`) before triggering frame capture via `GameRecording.TakeScreenshot#1` or `SteamClient.Screenshots`, ensuring clean in-game capture without toast occlusion.
- **Instant Replay Clip:** Configurable duration (`recording.duration_s`) and delay (`recording.delay_ms`) saving a video clip around the unlock moment via `GameRecording.SaveClip#1`.
- **Timeline Achievement Markers:** Place golden achievement icon markers onto Steam's active game recording timeline at the exact moment of unlock via `GameRecording.UserAddTimelineEntry#1`.

### Phase 9: Provider Contract & Multi-Plugin Architecture

- Formalize the provider IPC contract (`retroachievements`, `steamgriddb`, `retroarch`) adhering to [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it) and [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[docs/plugins.md](docs/plugins.md#build-nothing-steam-already-builds). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-components.md § Reproducing this](docs/steam-components.md#reproducing-this-the-inspection-method).
