# TASK — current status & what's next

Lean tracker: **what we're doing and what's next, nothing else.** Shipped
work (with verification logs and rationale) lives in
[CHANGELOG.md](CHANGELOG.md) (workspace) and each plugin's own
`CHANGELOG.md`. Detailed root cause, ordered steps and execution records
live in per-feature plans under [docs/plans/](docs/plans/) — link to them,
don't duplicate them here. ADRs are in [docs/decisions.md](docs/decisions.md).

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-achievements` and `enhanced-notifications` are separate plugins that
theme Steam's toasts and sounds.

---

## Now

**steam-cartridges P5 — native achievements & RetroAchievements provider.**
- Native PC & Emulator Saves: Keyless schema ingestion, out-of-process in-game observers (CODEX/Goldberg/RUNE/Unity/Godot), native toasts (`NotificationStore.OnNotification`), Big Picture play bar, and individual full-screen achievements page (`AchievementsFullStore`) implemented and verified live (*Jotunnslayer* `2315502503`).
- RetroAchievements & Emulators: Zero-friction credential discovery from `retroarch.cfg`, ROM hash extraction (`ra_hasher.js`), schema and unlock ingestion (`retroachievements.lua`), and real-time RetroArch log observer verified live (*Super Mario World* `2713503983`).
Plan: [docs/plans/steam-cartridges-achievements-plan.md](docs/plans/steam-cartridges-achievements-plan.md). Reference: [docs/steam-cartridges-achievements.md](docs/steam-cartridges-achievements.md).

## Next

- **steam-cartridges P6** — optional SteamGridDB rules. Blocked on P5.
- **enhanced-achievements 1.0 release** — audit items done
  (`enhanced-achievements/CHANGELOG.md` § 1.0.0); remaining: visual settings-panel
  check, U7 in-game overlay verification, stale `themes/ps5.json` cleanup,
  report the Millennium FCTrampoline bug upstream (no AI attribution — Routine 6),
  optional `@steambrew/ttc` bump, then tag/publish 1.0.0.
- **Phase 9 — provider contract.** Formalize the `retroachievements`/`steamgriddb`/`retroarch`
  IPC contract per [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it)
  and [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).
  Architecture: [docs/millennium-architecture.md](docs/millennium-architecture.md).

## Waiting on the user

- Alpha testing checklist (U1–U9, real hardware/real unlocks only) —
  [phase7-and-alpha-plan.md § User test checklist](docs/plans/phase7-and-alpha-plan.md#user-test-checklist-only-the-user-can-verify).

## Blocked upstream

- **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
  (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
  Re-test and drop the workaround in both plugins' `settings.ts` once fixed.

## Active failures & blockers

(none open)

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[docs/plugins.md](docs/plugins.md#build-nothing-steam-already-builds). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-debug.md § 3 The inspection method](docs/steam-debug.md#3-the-inspection-method).
