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

**Handoff for the next session (2026-09-30), read first.**
- **Achievements preload (ADR-0045) is done and live-verified.** Pushed up to `3677055`. `a6c7676` (Reset Achievements
  `candidates()` synchronous, stale docs fixed) is committed locally and live-verified after a Steam restart
  (`enhanced-achievements/tests/reset.mjs` 8/8, `ach_preload.mjs` 6/6, `npm test` 116/116) but **not pushed**. Both `-dev`
  builds deployed in Steam are current.
- **Next is F2** (see Next). The order check holds: ADR-0045 exists, so F2 writes ADR-0046 unchanged. Baselines differ
  from the F2 plan's text: steam-cartridges `test:ts` is **B = 208** (the plan says 204 after the preload), `test_ach_service`
  is 23; every F2 expected count is relative to the B you measure in P4, as the plan says. P2 (`64e3350` is an ancestor) holds.
- **Expect Rule R (`git apply -3`) on F2's patches s3 and s5.** The preload plan also changed `surfaces/sections/index.ts`
  (`scheduleRefresh`), `app/achievements.ts` (`preload`, `rerenderAll`), `index.tsx` (import of `watchProgressCache`, the
  start-up block after `libraryHomeReady`), `record_rpc.lua` (`GetAllRecords`) and added `sensors/progress-cache`. A conflict
  from `-3` means stop (F2 plan § 10). F2 also needs a clean `git status` (P1).
- **F1's live check is still owed** (first item of Now) and the F2 plan wants it before F2's live verification. Whether F2's
  code may be written before it is the user's call.
- **Push:** `git push origin main` (AGENTS.md Routine 5) only after F2's step 8 and the user's live verification (F2 plan § 9).
  Until then `a6c7676` and the F2 commits stay local. Never add AI attribution to a commit.
- **Lesson to carry into F2:** a dry run that never restarts Steam cannot see start-up order. The preload plan passed its dry
  run and then failed live three times (Steam's `appStore` empty at boot, `{}` for an empty list (K1), Steam replacing its
  progress cache after login). For F2's learn-once jsx observer and loader patch, run the plan's live probe right after a
  Steam restart and before opening any game page, and read the Steam log
  (`C:\game\steam\logs\webhelper_js.txt`) for surface errors (`exceeded its error budget`) after each deploy.

**F1 Game Data editor: code committed on top of M10 (2026-09-30), waiting for live verification.** Deploy with `dev.ps1`, then
follow [the F1 plan § 7](docs/plans/steam-cartridges-f1-game-data-editor-plan.md) (`check_settings_panel.mjs` 9 titles,
`probes/game_editor.mjs`, `npm run test:live`, the by-hand check on desktop and Big Picture). Then mark F1 done in the
[features plan](docs/plans/steam-cartridges-features-plan.md); F2 is planned (see Next).

**Owed by a human:** the five visual hand checks listed in [verification.md](docs/steam-cartridges/verification.md) (never run after M10).
The shortcut library icon's optional last check (choose an icon by hand, confirm it is kept) is also yours.

**Done and live-verified, history in [CHANGELOG.md](CHANGELOG.md):** the `steam-cartridges` migration M0-M10 (ports and adapters,
[ADR-0039](docs/decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) to
[ADR-0044](docs/decisions.md#adr-0044-steam-cartridges-layers-stay-dumb-and-a-test-checks-what-each-layer-does)); the
`enhanced-achievements` migration E0a-E3 ([ADR-0043](docs/decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net)).
How to verify and roll back: [verification.md](docs/steam-cartridges/verification.md).

## Considerations (decided later, not scheduled)

- **Wrap `LoadCacheFile` instead of watching (ADR-0045 decision 5, option 2).** steam-cartridges re-applies its
  achievements when Steam replaces its progress cache after login, detected by polling the map's identity
  (`sensors/progress-cache`, 1 s, at most 10 min). If the poll ever proves too slow, too costly, or misses a user who logs
  in after 10 minutes, hook Steam's own load instead. Tips: the target is
  `window.appAchievementProgressCache.LoadCacheFile` (async; on the store's prototype, read it with
  `Object.getPrototypeOf(window.appAchievementProgressCache)` first, the class name is minified); call the original, then
  `achievements.rerenderAll()` (app layer, already exists); install it in a surface, never in a sensor (guardrail: only
  surfaces patch Steam), so it needs a `touches` entry (`appAchievementProgressCache.LoadCacheFile`), a kill switch and a
  line in `surfaces.md`; it runs once per login, so guardrail 2 (hot paths) is no concern. Other plugins may wrap the same
  method: always call the original and return its value so the wraps compose. Verify live with
  `tests/live/probes/ach_preload.mjs` right after a restart, and read
  `window.appAchievementProgressCache.m_achievementProgress.mapCache` identity before and after login (steam-components.md,
  "When Steam fills each achievement store"). Amend ADR-0045 (or supersede it) when done.
- **Surface `deps` singletons (F30).** Each `surfaces/*/deps.ts` is a module-level object that `create*Surface` overwrites. Rewriting the
  six surfaces as real factories would touch every Steam hook (the highest-risk code) for a benefit that has not occurred. Instead add one
  capability-ratchet rule in `tests/architecture.test.ts`: `index.tsx` calls each `create*Surface` at most once, and nothing outside a
  surface's folder imports its `deps`. Revisit the factory rewrite only if a surface ever needs a second instance.
- **K20:** load the controller inference at start-up (`void controller.load()` in `init()`), live-check AM2R's badge.

## Next

- **Execute the F2 plan** (Community media in Steam's own Community section): [steam-cartridges-f2-community-media-plan.md](docs/plans/steam-cartridges-f2-community-media-plan.md),
  ready and dry-run on `64e3350`. The achievements preload plan is done (it took ADR-0045; F2 writes ADR-0046); F1's
  live check is still owed. See the handoff at the top of Now. Its § 9.3 card interaction audit decides whether Steam's native cards stay.
- **Phase 9 — provider contract** ([ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it),
  [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently)), after the migration:
  a provider becomes one more source adapter behind the migration's source contract.
- **Provider Plugin Extraction**: Extract `retroachievements` and `screenscraper`/`igdb`
  into standalone provider plugins communicating via the Phase 9 IPC contract.

## Later

- Optional SteamGridDB artwork filter rules (`g{Author:maxKB}` per artwork type, off by
  default), from the removed `docs/steam-cartridges.md` § 6
  (`git show 0d599cf:docs/steam-cartridges.md`). After the migration, as a source adapter.

## Waiting on the user

- Alpha testing checklist (U1–U9, real hardware/real unlocks only) —
  [phase7-and-alpha-plan.md § User test checklist](docs/plans/phase7-and-alpha-plan.md#user-test-checklist-only-the-user-can-verify).

## Blocked upstream

- **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
  (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
  Re-test and drop the workaround in both plugins' `settings.ts` once fixed.

## Active failures & blockers

None.

---

## Before writing any code

Building a plugin or a feature? Follow the playbook in
[docs/plugins.md § Playbook](docs/plugins.md#playbook-creating-a-plugin-or-a-feature).
Every other doc, by situation: [docs/README.md](docs/README.md).
