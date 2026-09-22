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

| Area                               | State                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post-Game Summary (desktop)        | ✅ Shipped. Real Steam component, fed via `steam/summary.ts`.                                                                                                                                                                       |
| Library grid                       | ✅ Shipped. Last-played dates populated from captures.                                                                                                                                                                              |
| Post-Game Summary (Big Picture)    | ✅ Shipped. Real Steam component via React Portal & store feeding ([ADR-0029](docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)). |
| Per-day Activity feed              | ✅ Shipped. Real Steam component, fed via `steam/activity.ts` on Desktop and Big Picture ([ADR-0030](docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing)).         |
| Native Achievements                | 🔬 Verified in Steam client. Next implementation phase.                                                                                                                                                                             |
| Achievement Notifications & Toasts | 🔬 Verified in Steam client. `NotificationStore.OnNotification` mapped.                                                                                                                                                             |
| Game Recording & Auto-Captures     | 🔬 Verified in Steam client. RPCs & timeline markers mapped (`80026`).                                                                                                                                                              |
| Custom Artwork & Metadata          | 🔬 Verified in Steam client. `SetCustomArtworkForApp` mapped.                                                                                                                                                                       |
| Docs Housekeeping & Architecture   | ✅ Shipped. Purged `steam-styles.md`, added `docs/steam-architecture.md`, updated `CHANGELOG.md`.                                                                                                                                   |
| Provider contract                  | ⬜ Architecture planned ([docs/architecture.md](docs/architecture.md)).                                                                                                                                                             |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Multi-Session Roadmap

### Phase 4: Core Refresh & Caching Hardening

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

### Phase 8: Metadata, Artwork & Game Info Enrichment (Optional Provider)

- **Automatic Artwork:** Ingest artwork (portrait capsule, hero banner, logo, wide capsule) via SteamGridDB / provider API and apply cleanly via `SteamClient.Apps.SetCustomArtworkForApp`.
- **Native Game Info Tab:** Feed `CAppDetailsStore.GetDescriptions` and `GetAssociations` to populate developer, publisher, release year, and community guide links in Big Picture's `GameInfo` tab and desktop metadata panels without UI hacking.

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
