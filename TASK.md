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
`enhanced-notifications` themes Steam's toasts and sounds, achievements included (enhanced-achievements merged into it, ADR-0050).

---

## Now

**enhanced-notifications simpler theme format (ADR-0052, 2026-10-02): code, themes and docs done, not live-verified.**
Unit tests pass except the bundled-asset check: `themes/ps5.jsonc` points at `PlayStation/*.svg` (the folder holds
`.png`), and the user's untracked `ps5.json` / `SteamStation.json` at a missing `ps5_assets/`; the user fixes the paths.
Then deploy with `dev.ps1`, `npm run test:live` (`achievements-bigpicture.mjs` changed: the banner now uses the theme's
corner), and look at the ps5 theme's toasts and Preview on desktop and in Big Picture (`text_align`, `game_icon`).
Follow-up: make Steam's own toasts honour `popup.scale` and `popup.layout` (banner only today); needs a live probe of
the per-toast popup's size (`ResizeTo`, `STEAM_TOAST_WIDTH` in `theme/placement.ts`) and of Steam's toast DOM.

**steam-cartridges community tab (2026-10-01): crash fixed, downloads kept on disk (ADR-0051).** Both live-verified by the
agent (Chrono Trigger after a restart: images 479 ms, was 11-23 s; `test:live` 13/13). Left for the user: plan § 7 of
[the investigation](docs/plans/steam-cartridges-community-crash-and-speed-investigation.md) (Chrono Trigger three times, then
after a restart), and a look at the "Keep downloaded media" slider in Settings → Community & Media (desktop and Big Picture).
When both pass, delete the investigation plan. Do not re-introduce parallel backend calls (no gain: the host serves one
request at a time).

**enhanced-achievements merged into enhanced-notifications (ADR-0050, 2026-10-01): code committed, waiting for the live
verification in [its plan § 9](docs/plans/enhanced-notifications-achievements-merge-plan.md)** (the user: disable
enhanced-achievements, move the ps5 theme and settings, deploy, `npm run test:live`, the by-hand checks). It supersedes
the live steps of the architecture-port and Big Picture fix plans that use enhanced-achievements as a separate plugin;
their by-hand checks are folded into § 9. When § 9 passes, delete all three plans and their patch folders. Entries
below that name enhanced-achievements now mean enhanced-notifications' achievement banner; "Force achievement position
in Big Picture" no longer exists.

**Merge enhanced-achievements into enhanced-notifications (ADR-0050, the user's decisions 2026-10-01): plan ready to
execute, dry-run on `080b5d4`:** [enhanced-notifications-achievements-merge-plan.md](docs/plans/enhanced-notifications-achievements-merge-plan.md)
(six patches, then a live verification that is the user's). Any change to either toast plugin before it runs makes its
patches stale: land those first or re-cut the plan.

**enhanced-notifications sibling port (ADR-0047): code committed (2026-09-30), waiting for the live verification in
[its plan § 9](docs/plans/enhanced-notifications-architecture-port-plan.md).** Deploy both toast plugins with `dev.ps1`, then
`npm run test:live` in both, then the by-hand checks.

**Big Picture toasts (2026-10-01): flicker fixed and "Force achievement position in Big Picture" added (ADR-0049); scripted live checks pass.** Left for a human, in Big Picture with it in front: the by-hand checks H1-H4 in [the fix plan § 11](docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md) (Preview pressed quickly with a `top_left` / `ps5` theme; an achievement right after a download; first toast after re-entering Big Picture; a possible one-frame flash after a LowBattery toast), and the new toggle: on, an achievement goes to enhanced-achievements' corner and the next toast back to enhanced-notifications'. Then delete the plan and its patch folder. Small follow-up: give enhanced-achievements' `tiers`, `safety` and `queue-stress` a Big Picture SKIP (they wait for the persistent toast window to close).

**enhanced-notifications: one style for every notification, random Preview, position / animation in Big Picture too (2026-10-01): done,
live-verified** on desktop and in Big Picture with test toasts (`test:live` 5/5 in each). Left for a human: look at it (a theme with
`"settings": { "position": "top_left", "animation": "ps5" }`, Preview pressed a few times), and an in-game overlay toast. Both toast
plugins now read `margin` / `padding` in CSS's clockwise order; the user's own `ps5.json` padding was converted (`[10, 15, 10, 10]`).

**F2 Community media: done and pushed (2026-09-30); a few live checks are still pending.** Live-verified by the agent: § 9.1
(feed, loader, cards, ScreenScraper `blob:` images, no URL or credential on disk), Routine 2 in desktop and Big Picture
(native game, AM2R, mapped game), `npm run test:live` 12/12 in desktop, trailer plays inline, image viewer in Big Picture
shows "Created by", the date and Close, controls hidden on our cards ([ADR-0046](docs/decisions.md), amended). Pending, in
order (the user, or an agent with the user's go-ahead):
1. **Big Picture by hand:** the viewer layout (tall images, the Close button position), the COMMUNITY tab with trailers, and that
   the author row and icons look right on a controller; also the first view of a shortcut after a Steam restart.
2. **Desktop image viewer:** it does not open on this machine (`CVRPathHelpers not found`, native cards too). Check whether that
   is this Steam build or this machine, and that our cards open it where native ones do.
3. **Right-click "Save screenshot"** on one IGDB image and one ScreenScraper `blob:` image (a `blob:` download may fail: note it).
4. **Author row click** (opens Steam's profile page for a made-up account: expected an error page; decide whether to hide the click).
5. **A long first page / "no more content"** on a shortcut with a 20+ item feed (Super Mario World) in Big Picture.
6. **Section reuse between games:** the stale-loader repair is proven on a simulated stale section only; navigation alone
   remounted the section every time here. Open a few shortcuts one after another in Big Picture (and on a controller) and
   confirm each COMMUNITY tab shows its own game's cards, never another game's or an empty section.
7. **F2c manuals** (ADR-0048): Big Picture checked by the user (Captain Commando); Chrono Trigger (7.5 MiB, 80 pages) fixed and
   live-checked in desktop 2026-10-01, as are the loading skeleton and the captions. Earlier note: live-checked in desktop 2026-10-01 (backend, first-page cover, viewer with 20 pages,
   "Scroll down to view the manual", fonts released, `test:live` 13/13); still open: **Steam places cards with a
   `Math.random` template shuffle, so the manual is not guaranteed the top-left cell** (decide: leave it, or wrap the
   loader's `AddCommunityContent` to move its cell first); a game whose media was cached before manuals has none for
   7 days (`media_ok`; decide whether to bump the cache); and the rest of [the plan § 11](docs/plans/steam-cartridges-f2c-manuals-plan.md)
   in Big Picture (D-pad scrolling, Routine 2).
   ScreenScraper videos and IGDB links are not started; ScreenScraper stays limited to its image types and the manual
   (title screen, screenshot, fanart, boxes, mixes, cartridge, flyer, HyperSpin theme) by the user's decisions (2026-09-30).
Vote, award, comment and Report controls are hidden on our cards, so the plan's § 9.3 rows for them are moot.

**enhanced-achievements Reset dialog, 4-value margin/padding, ps5 fade, ripple (2026-09-30, `39919c2`): deployed, not restarted.**
After a Steam restart, check on desktop: Reset keeps one dialog open (Resetting..., then the outcome, Close) and its window
(480 x 250) is not clipped; in Big Picture the same flow; a toast with `"padding": [10, 5, 4, 7]` (clockwise since 2026-10-01: 10 top, 5 right, 4 bottom, 7 left), the ps5 fade and the ripple;
a theme with a typo, picked and then reloaded, opens the theme-problems popup (560 x 360) listing it, and none opens at Steam's start.

**F1 Game Data editor: the user did a live check (2026-09-30); follow-ups are coded, waiting for a second live check.** Settings now use
enhanced-achievements' spacing ([plugins.md guardrail 18](docs/plugins.md#18-settings-panel-layout-reference-enhanced-achievements)),
Troubleshooting is gone, Game Data is the **Manual Edit** block in Library Audit, and the popup has a Controller support dropdown (the
`controllerOverrides` setting now reaches Game Info). Deploy with `dev.ps1`, then look at every section and the popup (desktop and Big Picture),
set Multi-player, Co-op and a controller option on a game whose data is wrong and check its Game Info, then run `check_settings_panel.mjs`,
`click_settings_panel.mjs` and `npm run test:live`. Then mark F1 done in the [features plan](docs/plans/steam-cartridges-features-plan.md).

**Lesson carried from the achievements preload (ADR-0045):** a dry run that never restarts Steam cannot see start-up order
(it failed live three times: `appStore` empty at boot, `{}` for an empty list (K1), Steam replacing its progress cache after
login). For F2's learn-once jsx observer and loader patch, run the plan's live probe right after a Steam restart and before
opening any game page, and read `C:\game\steam\logs\webhelper_js.txt` for `exceeded its error budget` after each deploy.

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
