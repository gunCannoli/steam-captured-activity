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

Next: **M5b → M5d**, then M6a onward (`Build`: detailed specs the implementer builds per plan
§ 0.10). No `Spec` steps remain. Nothing is open for the user.

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
