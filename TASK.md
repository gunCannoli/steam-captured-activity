# TASK — current status & what's next

Lean tracker: **open work only.** Everything shipped — with verification logs
and rationale — lives in [CHANGELOG.md](CHANGELOG.md) (workspace) and
[non-steam-games-activity/CHANGELOG.md](non-steam-games-activity/CHANGELOG.md)
(plugin). ADRs are in [docs/decisions.md](docs/decisions.md), Steam internals in
[docs/steam-components.md](docs/steam-components.md). Don't duplicate that
detail here — link to it.

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-achievements` is a separate plugin that themes Steam's achievement
toasts and sounds.

---

## Status

**Shipped** (details in [CHANGELOG.md](CHANGELOG.md)): Post-Game Summary
(desktop & Big Picture), library grid, per-day Activity feed, core refresh &
caching, Phase 4b lifecycle hardening, Game Info & metadata enrichment, docs
housekeeping, shared self-healing jsx runtime patch (verified across all three
frontend plugins).

| Area                                         | State                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Native Achievements (Phase 5)                | 🔬 Hook points verified in Steam client; not implemented.                                                                     |
| Achievement Banner & Sound (Phase 6)         | ✅ Desktop + Big Picture verified live; in-game overlay still to verify. |
| Enhanced Notifications (all toast types)     | ✅ Desktop and Big Picture verified live; friends/messages depend on Steam's Friends notification settings; overlay to verify. |
| Auto-Captures on Unlock (Phase 7)            | 🔬 Game Recording RPCs mapped; not implemented.                                                                               |
| Provider contract (Phase 9)                  | ⬜ Architecture planned ([docs/architecture.md](docs/architecture.md)).                                                        |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Multi-Session Roadmap

### Phase 5: Native Achievement Integration (Desktop & Big Picture)

- **Desktop Sidebar:** Re-enable `"achievements"` in `CAppDetailsSections.GetSections()` and feed `AppDetailsStore.GetAchievements(appid)` (module `78057` / `57665`) with `{ nAchieved, nTotal, vecHighlight, vecUnachieved }`.
- **Post-Game Summary:** Feed `CGamePlaySession.prototype.AddAchievement(achievement, unlockTime)` so unlocked achievements appear in the summary card strip alongside screenshots and clips.
- **Big Picture Play Bar:** Feed `appAchievementProgressCache.m_achievementProgress.mapCache` with `{ unlocked, total }` so quick stats display under the Play button.
- **Data Adapters:** Ingest schemas and unlocks from local emulator sources (RPCS3 `TROPCONF.SFM`/`TROPUSR.DAT`, RetroArch/rcheevos logs, DuckStation, PCSX2) and generic JSON.

### Phase 6: Achievement Banner & Sound (`enhanced-achievements`) — remaining

Shipped and verified on desktop and Big Picture (see [CHANGELOG.md](CHANGELOG.md),
[plan § 5 status](docs/plans/enhanced-achievements-plan.md#5-phase-6-execution-plan--themed-banner--sound)).

- [ ] **In-game overlay:** verify with a real unlock in a running game (same dispatcher, code-verified only).
- [ ] **Millennium Configuration API bug:** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903), fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904). Once a fixed release ships, re-test and drop the workaround in `settings.ts`.

### `enhanced-notifications` — Big Picture toast window fixed

Fixed 2026-09-24 (see [docs/plans/enhanced-notifications-toast-window-bugfix.md](docs/plans/enhanced-notifications-toast-window-bugfix.md)
for the full diagnosis). Corrects the entry this replaced: **desktop styling was never
broken** — that diagnosis mixed up desktop and Big Picture, having run its live check
in Big Picture and misread it as "no toast window is ever caught". Desktop toasts
(`notificationtoasts_<id>_desktop`, one popup per toast via `g_PopupManager`) were
already caught by `Millennium.AddWindowCreateHook` the whole time.

The real bug: Big Picture's toast is a single persistent
`SteamClient.BrowserView.CreatePopup` + `window.open` popup, created once and reused
for every toast, and it is **never registered with `g_PopupManager`** — so neither
`AddWindowCreateHook` nor `GetPopups()` (the old `scanPopups` fallback) ever see it.
Fix: reach it from the `GamepadToastPlaceholder` div Steam renders into the Big
Picture main window (which *is* in `g_PopupManager`) — two `.return` hops up its React
fiber, a hook holds the `BrowserViewPopup` object, `GetViewWindow()` is the toast
window. `style/injector.ts`'s `scanBigPictureToastWindows()` runs this once per toast
shown, no new timers, no `window.open`/prototype patches, no hardcoded class hashes.

Verified live: `node tests/categories.mjs` PASSes downloads/recording/system/achievement
on both desktop and Big Picture (friends/messages SKIP — depend on Steam's Friends
notification settings), including after exiting and re-entering Big Picture (new toast
window, old one pruned).

### enhanced-notifications — remaining

- [ ] **In-game overlay:** verify both plugins with a real game (desktop overlay toasts
  should already be caught via `g_PopupManager`; Big Picture overlay toasts use the same
  `pe` component inside the overlay window and are unverified — see plan § (c)9).
- [ ] **Friend/message toasts:** enable Steam's Friends notifications and verify content styling (currently SKIP, not exercised).
- [ ] **Core regression** (Routines 1–2, `scratch/`) with all three plugins enabled.
- [ ] **Publish prep** ([plugins.md § 6](docs/plugins.md#6-publish-as-a-public-repo)): `LICENSE`; a bundled theme whose assets can ship (the example themes point at local files).

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
