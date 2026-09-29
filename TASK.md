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

**steam-cartridges architecture migration (ports & adapters).** The plugin was
uninstalled on 2026-09-28 because Steam's UI kept crashing. Plan:
[steam-cartridges-architecture-migration-plan.md](docs/plans/steam-cartridges-architecture-migration-plan.md).
Accepted as [ADR-0039](docs/decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)
(pipeline in the backend, new shortcuts fetched in the background).

The crash is root-caused and the fix is validated live (plan § 1.3): a render feedback
loop that ran ~150 times a second on every shortcut page; opening **Properties**
saturated Steam's shared renderer.

**M0–M3 done (2026-09-28).** Render loop fixed (M0a); kill switches, error budget, safe
mode (M0b-1); architecture ratchet + RPC registration check (M0c); kernel — `ShortcutId`,
events, `GameRecord`, `Surface` (M1); sensors — view, lifecycle, collections (M2); dead-code
purge, then every Steam write moved into its own surface under `frontend/surfaces/` —
`sections`, `captures`, `game-info`, `playbar`, `achievements`, `toasts`, `native-links`,
`artwork`, `library-home` — each with a kill switch and fail-open hooks (M3.0–M3.10;
`frontend/renderers/` no longer exists). **The § 5 feature freeze on `steam-cartridges` has
ended.** Found along the way: K16 (kill switches were silently inert since M0b-1, fixed in
M3.1), K17 and K18 (pre-existing achievement-toast and Support-link gaps, tracked in plan § 12
for a bugfix plan). Live-verified throughout (render-loop PASS, `check_all_tabs.js` 11/11 PASS
in Big Picture on every batch).

**M4.0 done (2026-09-28).** Backend RPC inventory (`docs/steam-cartridges/rpc.md`): 25 live, 7
unwired (matches plan § 7.10 exactly), 0 dead — nothing deleted. K8 fixed (RetroArch fixture
215). New migration v2 removes five orphaned `library_metadata.json` records (backed up first,
skips manual edits); `tests/test_migrate.lua` added (7 checks, `ALL PASS`). The Lua test
harness's JSON stub is now a real recursive decoder (was flat-only, silently mis-parsed nested
records).

**M4a–M4c done (2026-09-29).** Routing policy moved behind `frontend/domain/routing`
(pure, node-testable) with a stateful wrapper in `app/routing.ts` (ADR-0040); every former
`features/buckets` caller reaches it through a D3 setter. Backend identity service
(`backend/resolve_identity.lua`) and record facade RPCs (`GetGameRecord`, `EnsureFresh`,
`backend/record_rpc.lua`) added. Frontend now resolves a shortcut's Steam Store match through
one `EnsureFresh` call (`app/identity.ts`) instead of up to three round trips; `sections`,
`native-links` and `captures` are record-driven for `identity` (`app/records.ts`,
`app/render-queue.ts`, `frontend/ports/`). `features/steam-store/known-apps.ts` and its TS
title matcher are deleted — the backend's `normalize` is the only matcher now
(`sensors/owned-apps` supplies native candidates as context instead).
`npm run check` clean, `npm run test:ts` 100/100, `npm run build` succeeds; Lua suites unchanged
except the new `tests/test_identity.lua` (16/16). **Live-verified 2026-09-29**: § 0.5 baseline
(render loop PASS; Properties OK for WUCHANG and Jotunnslayer, popups as documented; nav cycle
6/6 PASS; `check_all_tabs.js` 11/11 PASS) plus M4c's own `check_parity.mjs` (16 PASS / 1 FAIL —
matches the M3.7 baseline exactly, K18 only). Dev plugin left deployed and enabled.

**M5a done (2026-09-29, implementer; live verification pending § 0.5).** Backend metadata
service (`backend/metadata_service.lua`) selects Game Info by the same order as today
(local record → Steam Store match → IGDB → fallback), reachable through the extended record
facade (`GetGameRecord`/`EnsureFresh` now also resolve `metadata`; new `GetAllRecords` bulk
read). `npm run check` clean, `npm run test:ts` 100/100 (unchanged — backend only); Lua suites
unchanged except the new `tests/test_metadata_service.lua` (24/24). Nothing calls the new part
or RPC yet — no behaviour change until M5b.

**M5b done (2026-09-29, implementer; live verification pending § 0.5).** Frontend adopts
metadata: `app/metadata.ts` resolves Game Info through one `EnsureFresh` call per view and
`GetAllRecords()` once at start-up; `surfaces/game-info` is now record-driven
(`render(appid, record)` enriches/reverts from `record.metadata`, replacing the old push
pipeline). `features/game-info/index.ts`, `policy.ts` and `tests/game-info-policy.test.ts` are
deleted (selection ported to the backend in M5a). New sensor `sensors/store-item`
(`domain/store-item.ts` holds its pure mapping half). `npm run check` clean, `npm run test:ts`
94/94 (-6: the deleted policy test, ported to Lua); Lua suites unchanged; `npm run build`
succeeds. Nothing behaviour-visible changes — the exit checks (pending live verification) prove
Game Info stays identical per shortcut.

**M5c done (2026-09-29, implementer; live verification pending § 0.5).** SteamGridDB artwork for
shortcuts with no Steam match (`backend/art_service.lua`, `app/artwork.ts`, `domain/art-plan.ts`); the
`artwork` surface is record-driven and `features/steam-store` no longer writes art. Empty slots only,
`services.steamgriddbEnabled`, SteamGridDB key entry in the settings panel (Metadata section, same
pattern as ScreenScraper/IGDB; the panel gets a full revision after the migration). Also fixed two gaps
in my earlier M5a/M5b work: an empty title sent to `EnsureFresh` for metadata, and steam-store shortcuts
with no Steam match never reaching IGDB (identity is now passed as context). `npm run check` clean,
`npm run test:ts` 104/104, `npm run build` succeeds, new `tests/test_art_service.lua` ALL PASS.

Notes for the next step (M5d, then batch live verification of M5a–M5d):
- `features/steam-store/resolve.ts` (`cdnArtworkUrls`) has no caller left in the frontend (the backend has its
  own `art_service.cdn_urls`); M9a's file list still names it — delete it there instead of moving it (D13).
- `GetArtworkForGame` stays registered but has no caller (`art_service` calls `web_sgdb` directly); § 7.10 row 1
  is now served by M5c.
- Live checks for M5c (§ 7 M5c Exit): an unmatched web-scraping shortcut with no custom art gets four slots;
  a shortcut whose portrait the user set keeps it; Clear removes only our slots; AM2R (bucket `none`) makes no
  SteamGridDB request (backend log). Also re-check M5b's exits (`audit_missing_metadata.mjs`, a web-scraping game
  shows IGDB data) since the identity/title fix changes that path. Needs a SteamGridDB key in the panel.

**M5d done (2026-09-29, implementer; live verification pending § 0.5).** ScreenScraper as a Game Info source
(IGDB first, then ScreenScraper, then the fallback record; `screenscraper_media.fetch_jeu` shared with media). Lua
tests use a hand-shaped `jeuInfos` fixture — compare it with a real response during live verification.

**M5 live-verified 2026-09-29** (dev plugin left deployed and enabled). § 0.5 baseline reproduced: `count_cycle` PASS
(`enrich(page)=1`), Properties OK for WUCHANG and Jotunnslayer, nav cycle 6/6, `check_all_tabs` 11/11;
`audit_missing_metadata.mjs` 0 missing; `check_parity.mjs` 16 PASS / 1 FAIL (K18 only, the M3.7 baseline); safety
diagnostics clean. **Found and fixed one regression:** the first M5 build scored parity 14/3 because
`metadata.preload()` also wrote `identity` for every mapped shortcut at boot, so `captures` requested Steam's
`GetAppActivity` for each mapped native app before Steam was ready and those fetches stuck (knowledgebase Part 7).
M5c end-to-end on Firestriker (only its hero slot was empty): SteamGridDB filled exactly that file; Clear removed
exactly it. On this library 218 of 220 shortcuts already have all four slots, so M5c makes no request for them.

Still open for M5:
- ~~M5d live network check~~ **done 2026-09-29**: the repo-root `.env` `screenscraper_dev_*` credentials (read by `web_config`'s
  legacy path) returned real `jeuInfos.php` responses (Sonic The Hedgehog, Streets of Rage 2); every mapped field's
  shape matched the fixture and the Lua mapper gave the right values. Not yet exercised through the running plugin
  (no shortcut currently needs a ScreenScraper lookup: all 220 already have Game Info).
- M5c's exit text assumed AM2R is in bucket `none`; it is currently `steam-store` (unmatched) with all four slots
  already set, so it makes no request either way.
- Firestriker's hero was cleared again by the Clear test; the deployed dev plugin refills it on the next view.

**M6a done (2026-09-29, implementer; live verification batched with M6b).** `backend/ach_service.lua` (sources behind `supports`
rules; PC games silent, K2), `CheckUnlocks` RPC, `achievements` part in `EnsureFresh`; K7 fixed (`test_backend.lua` is `ALL PASS`), K1
backend half (`cjson.array_mt`). New `tests/test_ach_service.lua` (18 checks). The achievements reference doc is now
`docs/steam-cartridges/service-achievements.md`.

**M6b done (2026-09-29, implementer; live verification next).** `app/achievements.ts` (record part + Flow C), `achievements` /
`toasts` / `captures` surfaces record- or event-driven (K14 fixed), `frontend/features/achievements/` deleted, public API unchanged (D8).
`npm run test:ts` 114/114 (+10), allowlist -7, build succeeds, all Lua suites `ALL PASS`. K17 (the achievement toast's protobuf is not
found on this Steam build) is still open and will keep the *toast* from showing; the unlock itself and the game page listing are unaffected.

**M6 live-verified 2026-09-29** (dev plugin left deployed and enabled). § 0.5 baseline: render loop PASS (`enrich(page)=2` on the first view after
a restart, `0` warm; `achievementLoads(page)=0`, was 1), both Properties OK, nav cycle 6/6, `check_all_tabs` 11/11; `check_parity` 16/1 (K18 only),
`audit_missing_metadata` 0 missing, safety diagnostics clean. M6 exits: AM2R logs one `Achievements …: unsupported` and no "cannot extract rom path"
line (K2); Animaniacs 0/98; Castlevania: Aria of Sorrow 66; WUCHANG loads `ok steam 0/40` with no `newUnlocks.map` error and `checkObserverUnlocks`
returns a number (K1); `git grep appSpotlightStore -- frontend/features frontend/app` is empty (K14). The unlock path was exercised with
`triggerAchievement` on Animaniacs: Steam's store went 0 → 1 → 0 of 98 (reset afterwards). **Still the user's test:** a real unlock during play. The
toast was blocked by K17 and the page-load errors were K19; **both fixed the same day (below)**. Not tested live: the launch toast and the 2 s in-game polling
session (they need a real launch); both are unit-tested (`tests/app-achievements.test.ts`).

**Post-M6 bugfixes (2026-09-29), all three open issues closed.** **K17** (no toast): the notification protobuf's setters live on an
instance's prototype on this build, so the resolver's `Class.prototype` check found nothing; it now instantiates candidates. Live: the dispatch
returns `true` and Steam opens its `notificationtoasts` window (contents not screenshotted). **K19** (two `RequestAchievements` TypeErrors on every
shortcut page): Steam's own `GetAchievements` throws for a shortcut whose `details` is null, and our wrapper fell through to it (predates M6); it
now answers `undefined`, decided by the tested pure `getAchievementsAction`. Live: no exception on AM2R, WUCHANG or Castlevania; the remaining
`Uncaught (in promise)` object rejections also occur on native games (730, 570), so they are Steam's. **`enrich(page)=2`**: not reproducible in
four fresh loads (1, 1, 1, 1 after two cold starts and two deploys), so no defect was found; `count_cycle` sums enrichments of *any* game in its
window, and it now prints the enriched appids so a future 2 is attributable. Tests: `test:ts` 118/118 (+4). Baseline re-run green (a stale
WUCHANG Properties window left by an earlier run briefly made that check report `popup=[]`; closed and rerun).

**M7a and M7b done (2026-09-29, implementer; live verification next).** Backend: `net.lua` (the one HTTP entry point, per-source counters and
breakers), `fresh_policy.lua` (TTL table, `freshness.json`), `registry.lua` (`known_shortcuts.json`); K15 fixed. Frontend: `app/ingest.ts` replaces the sync
manager (only new shortcuts at start-up, user decision 2), `app/view.ts` replaces `features/source-view.ts`; `features/scraper/` deleted. `test:ts` 136/136,
`test_freshness.lua` 43 checks, all Lua suites `ALL PASS`, build succeeds. **The first start after this update seeds `known_shortcuts.json` with the current
library and fetches nothing** (by design, so there is no 220-game storm); the positive case (one new shortcut is fetched) needs the user to add a shortcut.

**M7 live-verified 2026-09-29** (dev plugin left deployed and enabled). Start-up: `known_shortcuts.json` seeded with 220, `http_calls` empty (no storm).
Opening AM2R for the first time refreshed its metadata (`igdb` +3 requests = one refresh: token, search, fallback); opening it again, or after another game,
added none. Simulated "the user adds a shortcut" by removing Firestriker (3381982601) from `known_shortcuts.json` with Steam closed: the next start fetched exactly
that game (2 `igdb` requests, a `freshness.json` entry, registry back to 220) and nothing else. § 0.5 baseline green: `enrich(page)=0` (warm), both Properties OK,
nav cycle 6/6, `check_all_tabs` 11/11, parity 16/1 (K18 only), audit 0 missing, safety clean, no `RequestAchievements` exception. Not shown live: the 24 h expiry
(the clock cannot be moved) and K15 (no `custom_override` record exists and creating one would change your data); both are covered by `tests/test_freshness.lua`.
Every game's first page open after this update refreshes its metadata once (no freshness entry yet counts as stale), then not again for 24 h.

M8a-M8c done (defaults pinned; `settings/context.ts` + ports wrappers; `settings-panel.tsx` split into `settings/panel.tsx`, `components.tsx`, `sync-progress.tsx`, `panels/*`; allowlist -2). M8d done and M8 live-verified 2026-09-29 (8 panel titles render, § 0.5 baseline green, a feature switched off persists across restart); the open list M8-1 to M8-3 is closed (see the plan). Next: M9 (`Build`: detailed specs the implementer builds per plan § 0.10). No `Spec` steps remain. Nothing else is open for the user.

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

(none open)

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[docs/plugins.md](docs/plugins.md#build-nothing-steam-already-builds). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-debug.md § 3 The inspection method](docs/steam-debug.md#3-the-inspection-method).
