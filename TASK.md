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
| Enhanced Notifications (all toast types)     | ⚠️ Desktop styling broken for non-achievement toasts (toast window invisible to popup-tracking APIs); Big Picture, friends/messages, overlay to verify. |
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
[plan § 5 status](docs/enhanced-achievements-plan.md#5-phase-6-execution-plan--themed-banner--sound)).

- [ ] **In-game overlay:** verify with a real unlock in a running game (same dispatcher, code-verified only).
- [ ] **Millennium Configuration API bug:** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903), fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904). Once a fixed release ships, re-test and drop the workaround in `settings.ts`.

### `enhanced-notifications`: toast window invisible to both popup-tracking APIs — needs discovery

**Symptom:** `tests/categories.mjs` fails for every category except `achievement`
(handed off to `enhanced-achievements`): friends/messages/downloads/recording/system
toasts never get `data-en-type` set or the theme `<style>` injected, so they render
stock, unthemed. `style/injector.ts`'s own doc comment claims
`Millennium.AddWindowCreateHook` (`onPopup`) plus a `g_PopupManager.GetPopups()`
fallback (`scanPopups`, added for Big Picture's early-created toast window) together
cover every toast window. Verified live (2026-09-24) that this is false: installing a
logging callback on **both** `Millennium.AddWindowCreateHook` and
`window.g_PopupManager.AddPopupCreatedCallback`, then triggering
`previewCategory('system')`, shows **neither ever fires** for the toast window, and
`g_PopupManager.GetPopups()` never lists it either — even though the toast's own CDP
target genuinely appears (`notificationtoasts_uid32`).
`non-steam-games-activity`'s `onPopupCreate` (from `steambrew-utils`, itself built on
`g_PopupManager.AddPopupCreatedCallback`/`AddPopupDestroyedCallback`) is proven to
work for desktop/gamepad popups, so this is specific to how toast windows are
created, not a broken API in general.

**Not fixed this session — start here:**
1. Find the real creation signal for `notificationtoasts_*` windows. Candidates to
   check: a dedicated toast/notification manager object (`window.__TOASTER_INSTANCE`
   was seen on `window` — not yet explored), a CEF-level browser-created event
   separate from Millennium's popup hooks, or reaching the toast window via whatever
   call actually opens it (e.g. a return value from a `window.open`-style call inside
   Steam's own notification code) instead of a creation callback.
2. If no creation hook exists, a poll-based fallback (short-interval scan for new
   `notificationtoasts_*` windows) is the likely workaround — but confirm one doesn't
   already exist before adding a new poll loop (see [docs/plugins.md](docs/plugins.md)
   guardrails on avoiding redundant polling).
3. Once toast windows are reliably caught, re-run
   `cd enhanced-notifications && node tests/categories.mjs` — expect all 6 categories
   to pass (or SKIP for friends/messages if Steam's Friends notification settings are off).
4. Update this file and [CHANGELOG.md](CHANGELOG.md) with the fix.

### enhanced-notifications — remaining (after the fix above)

Built and verified on desktop for achievement coexistence only (see
[CHANGELOG.md](CHANGELOG.md), [plan](docs/enhanced-notifications-plan.md)).

- [ ] **Category styling on desktop:** blocked on the toast-window-detection fix above.
- [ ] **Big Picture:** verify styling once desktop styling works.
- [ ] **Friend/message toasts:** enable Steam's Friends notifications and verify.
- [ ] **In-game overlay:** verify both plugins with a real game.
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
