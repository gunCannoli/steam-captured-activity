# TASK — current status & what's next

Lean tracker: **open work only.** Everything shipped — with verification logs
and rationale — lives in [CHANGELOG.md](CHANGELOG.md) (workspace) and each
plugin's own `CHANGELOG.md`. ADRs are in [docs/decisions.md](docs/decisions.md),
Steam internals in [docs/steam-components.md](docs/steam-components.md). Don't
duplicate that detail here — link to it.

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-achievements` and `enhanced-notifications` are separate plugins that
theme Steam's toasts and sounds.

---

## Status

| Native Achievements (P5) | ⬜ Unblocked 2026-09-26 (Friends-section crash fixed) — not yet started |
| Provider contract (Phase 9) | ⬜ Architecture planned ([docs/millennium-architecture.md](docs/millennium-architecture.md)) |

---

### enhanced-achievements 1.0 release: remaining (audit items done, see enhanced-achievements/CHANGELOG.md § 1.0.0)

- [ ] **Visual check of the settings panel** (not automatable here): theme dropdown on three rows (label, description, full-width dropdown); a theme-problem line appears only for a broken theme.
- [ ] U7 in-game overlay with a real unlock: the popup hold assumes the overlay honours `fnNotificationResolved` (code-read, unverified). Worst case: Steam's timer.
- [ ] Your user-folder `themes/ps5.json` shadows the new bundled `ps5.jsonc` and has no `assets/` beside it (trophy icons missing). Delete it or copy the assets.
- [ ] Report the Millennium FCTrampoline stale-`jsx` restore upstream (docs/plugins.md § Sharing the jsx runtime). No AI attribution (Routine 6).
- [ ] Optional: `@steambrew/ttc` 2.8.7 → 3.3.7, only with a full live pass after.
- [ ] Tag/publish 1.0.0 (`dev.ps1 -Package`, U9 fresh install).

- [ ] **User's live smoke test** across all rounds — not yet run.
- [ ] Open questions (not blocking, defaults already applied): default animation pair, `ps5` timings, queue overflow behaviour; `queue.enabled` default off vs on, `duration_s: 0` edge case.

## Alpha testing (user)

Only verifiable with a real game running. Steps and expected results:
[phase7-and-alpha-plan.md § User test checklist](docs/plans/phase7-and-alpha-plan.md#user-test-checklist-only-the-user-can-verify)
and each plugin's README ("How to test").

- [ ] **U1–U5:** real-unlock captures — screenshot, clip, coalescing, Steam's own
      achievement marker, non-Steam shortcut (via a real unlock; the settings
      panel's "Test captures" button was removed 2026-09-25, see `fireTestUnlock`
      in `tests/captures.mjs` for the equivalent CDP-driven check).
- [ ] **U6:** no captures when in-game toasts are disabled (settings warning shows).
- [ ] **U7:** in-game overlay, both plugins (desktop overlay toasts should be caught
      via `g_PopupManager`; Big Picture overlay toasts are code-verified only).
- [ ] **U8:** `enhanced-notifications` friends/messages styling with Steam's Friends
      notifications on (currently SKIP in `tests/categories.mjs`).
- [ ] **U9:** fresh install from a `dev.ps1 -Package` zip under the release name.

## Blocked upstream

- [ ] **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
      (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
      Once a fixed release ships, re-test and drop the workaround in both plugins' `settings.ts`.

---

## Roadmap

### steam-cartridges (merger + buckets + achievements)

Parent plan: [docs/steam-cartridges.md](docs/steam-cartridges.md). ADRs
[0032–0038](docs/decisions.md#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges).

- [x] **P0–P4 + native parity (Parts A–H)**: research closure, plugin merger,
      bucket engine, Steam Store bucket, offline hardening, and full native
      parity for a mapped shortcut (Game Info fields, Steam's own
      links/friends/community sections, native news, logo position, badge
      policy) — all implemented and CHANGELOG'd. Live-verified 2026-09-26:
      `node scratch/check_parity.mjs` → **17 PASS / 0 FAIL** (twice, fresh
      boots); `test_nav_cycle.js` 5/5 PASS; `check_all_tabs.js` all PASS
      (Big Picture). User's parity-plan open questions (Q2–Q4) answered
      2026-09-26: full-controller badge only for emulator-inferred systems;
      UI slowness and missing native data both traced to a stale deployed
      build, resolved by redeploy.
    - [ ] Never run (fixtures absent, not approved): `tests/buckets.mjs`, `tests/steam-store.mjs`.
    - [ ] P3 unverified assumptions: `StoreItemCache` field/method names in
          `store-item.ts` (`m_StoreCategories` shape, `GetAssets()`,
          `GetLibraryCapsuleURL_2x`); `SetCustomArtworkForApp`/`ClearCustomArtworkForApp`
          size limits and real clear behaviour; `os.rename` overwrite semantics
          in Millennium's Lua; real `storesearch`/`appdetails` response shapes
          against the hand-shaped fixtures (re-record with curl).
- [ ] **P5** achievements (Steam native, RetroAchievements): unblocked
      2026-09-26 (parity gate green, Friends-section crash fixed) — not yet
      started.
- [ ] **P6** optional SteamGridDB rules: blocked on P5

## Active Failures & Blockers

(none open)

### Phase 9: Provider Contract & Multi-Plugin Architecture

- Formalize the provider IPC contract (`retroachievements`, `steamgriddb`, `retroarch`) adhering to [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it) and [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[docs/plugins.md](docs/plugins.md#build-nothing-steam-already-builds). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-debug.md § 3 The inspection method](docs/steam-debug.md#3-the-inspection-method).
