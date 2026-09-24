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
| Achievement Banner & Sound (Phase 6)         | 📝 Planned — [docs/enhanced-achievements-plan.md § 5](docs/enhanced-achievements-plan.md#5-phase-6-execution-plan--themed-banner--sound). Not scaffolded. |
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

### Phase 6: Achievement Banner & Sound (`enhanced-achievements`) — NEXT

> **Plan:** [docs/enhanced-achievements-plan.md § 5](docs/enhanced-achievements-plan.md#5-phase-6-execution-plan--themed-banner--sound).
> **Schema:** [themes.md](enhanced-achievements/themes.md) · themes like [steam_ps_exemple.json](enhanced-achievements/steam_ps_exemple.json) · shipped setting defaults [settings.json](enhanced-achievements/settings.json).

- [ ] **Step 0 — Live re-verify (no code).** Resolve every hook point by signature, not module id: `NotificationStore`, the achievement `eType`, the toast renderer, the toast container, completion data for `exceptional`, and **which window paints in-game overlay toasts**. Record the signatures in `steam-components.md § 11B`.
- [ ] **Step 1 — Scaffold** per [plugins.md § 1](docs/plugins.md#1-scaffold): `plugin.json`, `_lib`, `main.lua` with `millennium.ready()`, parameterised `dev.ps1` that also deploys `themes/`. Move example themes into `themes/`; keep `research/` out of the published folder.
- [ ] **Step 2 — Settings** via Millennium's Configuration API: `settings.json` defaults bundled into the frontend, `stored ?? default`, cached in memory and kept current with `subscribePluginConfig`. Panel through `definePlugin({ content })` using `ToggleField` / `Dropdown` / `SliderField`, plus Preview-per-tier, Reload themes and Open themes folder. No theme builder: themes stay shareable JSON.
- [ ] **Step 3 — Themes.** Backend RPCs `ListThemes` / `LoadTheme` (bundled + user folder, assets as data URLs, loaded once). Frontend resolves the four tiers once per load. Tests for tier selection + inheritance outside Steam.
- [ ] **Step 4 — Sound hook** on `PlayNotificationSound`: achievements only, O(1), falls through to Steam's chime on any failure, respects Steam's own mute.
- [ ] **Step 5 — Banner** replaces only the inner toast (Steam keeps container, queue, timing, click/dismiss). Renderer resolved once; `jsx` patch is an identity compare; error boundary renders Steam's original.
- [ ] **Step 6 — Verify** Desktop, Big Picture, overlay; live settings changes; fallbacks (missing sound, broken theme, plugin off); non-achievement toasts unchanged; **core Routines 1–3 with both plugins enabled**; new `scratch/test_achievement_toast.js`.
- [ ] **Confirm:** user themes folder (recommended `<steam>/millennium/config/enhanced-achievements/themes/`; plan § Open decisions).

**Guardrails for this plugin:** never touch `AppOverview`, `StoreItemCache`,
`CAppDetailsSections` or the activity/spotlight stores; no imports from the core
plugin; no per-toast disk/RPC/network work. Full table in the plan.

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
