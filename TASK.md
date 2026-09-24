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
housekeeping.

| Area                                         | State                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Native Achievements (Phase 5)                | 🔬 Hook points verified in Steam client; not implemented.                                                                     |
| Achievement Banner & Sound (Phase 6)         | ✅ Desktop + Big Picture verified live; in-game overlay still to verify. |
| Enhanced Notifications (all toast types)     | ✅ Desktop verified; Big Picture, friends/messages, overlay to verify. |
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

### enhanced-notifications — remaining

Built and verified on desktop (see [CHANGELOG.md](CHANGELOG.md), [plan](docs/enhanced-notifications-plan.md)).

- [ ] **Big Picture:** verify styling (a popup scan was added for Big Picture's early-created toast window; the re-check was inconclusive).
- [ ] **Friend/message toasts:** enable Steam's Friends notifications and verify.
- [ ] **In-game overlay:** verify both plugins with a real game.
- [ ] **Core regression** (Routines 1–2, `scratch/`) with all three plugins enabled.
- [ ] **Shared jsx patch (code done 2026-09-24, NOT yet tested)**: fixes the latent chain growth. Details below.

### Shared jsx runtime patch — verify next session

**Problem:** `non-steam-games-activity` (SDK `beforePatch` + 5 s watchdog) and
`enhanced-achievements` (hand-rolled wrapper + 5 s re-wrap) both re-patched
whenever `runtime.jsx` was not their own function. With both loaded, each saw
the other on top and wrapped again every 5 s, so the chain could grow without
bound. The hand-rolled wrapper also had no `__millenniumPatch` link, so the
SDK's `unpatch()` would throw walking through it.

**Step 0 finding (SDK source, `@steambrew/client/build/utils/patcher.js`):** the
SDK patcher is not a shared registry; each patch stacks a wrapper, but every
wrapper links to the next via `fn.__millenniumPatch.original`. No Millennium
change is needed.

**Done (committed, deployed as `-dev`, untested):**
- `steam/jsx-hook.ts` (`keepJsxPatched`), identical copies in
  `non-steam-games-activity` and `enhanced-achievements`: SDK
  `replacePatch`/`beforePatch`; liveness = walk SDK links for our patch, else a
  sentinel probe (`runtime.jsx(SENTINEL, {})`); re-install only if not found;
  `diagnostics()` = installs / live / chainDepth / probed.
- `enhanced-achievements/frontend/steam/toast-patch.ts` uses it (`replaceType`);
  exports `jsxDiagnostics`.
- `non-steam-games-activity/frontend/steam/gamepad-appid.ts` uses it (`observe`);
  old watchdog removed; exports `jsxDiagnostics`. Its `dev.ps1` now builds with `npx`.
- `scratch/jsx_chain.js`: one-run diagnosis of 4 scenarios.
- Rules: [docs/plugins.md § Sharing the jsx runtime between plugins](docs/plugins.md#sharing-the-jsx-runtime-between-plugins).

**Verify (one pass, read the PASS/FAIL pointers):**
1. `node scratch/jsx_chain.js` (Steam already restarted with both builds):
   - **1 steady:** depth stable, installs 1 each, all live. FAIL "no jsxDiagnostics export" means a plugin isn't deployed/loaded.
   - **2 foreign wrapper:** live via probe, no re-install. FAIL: probe not reaching handler (check `replacePatch` `callOriginal` path for SENTINEL).
   - **3 dropped reference:** each re-installs once, same depth. FAIL: `ensure()` interval not running, or walk found a stale patch.
   - **4 banner:** `.ea-banner` renders. FAIL here with 1–3 passing means the `replaceType` swap regressed (compare with the old hand-rolled wrapper in git history).
2. `cd enhanced-achievements && node tests/smoke.mjs && node tests/tiers.mjs && node tests/settings-sound.mjs`.
3. `node scratch/test_nav_cycle.js` and `node scratch/check_all_tabs.js` (the core plugin's appid detection in Big Picture now runs through the new hook: check "A -> B -> A" in check_all_tabs).
4. `cd enhanced-notifications && node tests/categories.mjs` (coexistence; `claims('banner')` depends on `toastPatchInstalled()`, now `diagnostics().every(live)`).
5. If all pass: update CHANGELOG, then consider retrying the jsx approach in `enhanced-notifications` through `keepJsxPatched` (its earlier mystery may have been chain churn).

**Reminder:** never reload SharedJSContext to test; redeploy with a graceful `dev.ps1` restart.
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
