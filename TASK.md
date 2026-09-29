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
(pipeline in the backend, new shortcuts fetched in the background, feature freeze
on `steam-cartridges` until M3 is done).

The crash is root-caused and the fix is validated live (plan § 1.3): a render feedback
loop that ran ~150 times a second on every shortcut page; opening **Properties**
saturated Steam's shared renderer.
M0a done (render loop fixed). M0b-1 done (kill switches, error budget, safe mode).
M0c done (architecture ratchet, RPC registration check, check_all_tabs.js flake fix).
M1 done (kernel: `ShortcutId`, events, `GameRecord`, `Surface`; not yet adopted by any runtime code).
M2 done (sensors). M3.0 done (dead-code purge). M3.1 done (`sections` surface; also fixed K16 — kill switches were silently inert since M0b-1). M3.2 done (`captures` surface). M3.3 done (`game-info` surface). M3.4 done (`playbar` surface, new `playbar` kill switch). M3.5 done (`achievements` surface). Next: **M3.6** (`toasts` surface, Ready), then M3.7 → M3.10, then **M4.0 → M9b** (`Build`: detailed specs the implementer builds per plan § 0.10). No `Spec` steps remain. Nothing is open for the user.

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
