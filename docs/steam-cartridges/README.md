# steam-cartridges architecture — overview

**This doc's job:** the layer list, the dependency rule, and how a new feature is
added under the migration (ADR-0039). Part of the steam-cartridges architecture;
index: [steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

The layer list (status as of M0c; see the migration plan's
[§ 0.2 status board](../plans/steam-cartridges-architecture-migration-plan.md#02-status-board)
for the authoritative, up-to-date state):

| Layer | Status |
| --- | --- |
| Safety: kill switches, error budget, boot sentinel / safe mode | done (M0b-1) — [safety.md](safety.md) |
| Architecture ratchet: import allowlist, RPC registration test | done (M0c) — this doc |
| Kernel: `ShortcutId`, events, `GameRecord`, `Surface` contract | done (M1) |
| Domain: pure routing policy (ADR-0040) | current (M4a) — this doc |
| Sensors: view, lifecycle, collections (owned apps: M4) | done (M2) — [sensors.md](sensors.md) |
| App: use cases (routing, M4a; records, identity: M4c) | current (M4a) |
| Surfaces: the only code that writes to Steam | done (M3.1–M3.10) — [surfaces.md](surfaces.md) |
| Resolver service + RPC facade | planned (M4b–M4c) |
| Metadata service | planned (M5) |
| Achievements service | planned (M6) |
| Freshness + ingestion | planned (M7) |
| Settings split | planned (M8) |

## Contract

Not applicable — this doc is the index, not a layer with exported types.

## Files

| File | Role |
| --- | --- |
| `tests/architecture.test.ts` | Import ratchet (cross-area imports) + RPC registration check |
| `tests/architecture-allowlist.json` | The frozen list of allowed cross-area import edges; can only shrink |

## Steam targets touched

None. This layer only tests the frontend's own source tree.

## May import / must never import

The full dependency rule (from migration plan § 4.1):

| Module | May import | Must never import |
| --- | --- | --- |
| `kernel/` | nothing of ours | Steam, `@steambrew/*`, RPC, any other folder |
| `domain/` (pure frontend policy) | `kernel/` | Steam, RPC, sensors, surfaces |
| `sensors/` | `kernel/`, `steam/` (read-only resolution) | `surfaces/`, `app/`, other sensors |
| `app/` (use cases, orchestration) | `kernel/`, `domain/`, `ports/` | `steam/`, `surfaces/`, `sensors/` internals |
| `ports/backend/` | `kernel/` | everything else |
| `surfaces/<name>/` | `kernel/`, `steam/`, its own folder | another surface, `app/`, `ports/`, `sensors/` |
| `steam/` (module resolution, `jsx-hook`, store types) | `kernel/`, `logger` | features, surfaces, settings |
| `settings/<panel>` | `kernel/`, `ports/` | surfaces, sensors |
| `index.tsx` | everything (composition root only, no logic) | — |

Every cross-area import not yet migrated to this shape is recorded in
`tests/architecture-allowlist.json` (53 entries as of M0c; 41 as of M2). The
allowlist never grows — a step that removes a module's old path deletes its
edges. Rule-allowed edges are listed in `LAYER_RULES` in
`tests/architecture.test.ts` (D1) and never in the allowlist.

## Tests

`tests/architecture.test.ts`, two checks:

1. **Import ratchet**: walks `frontend/`, computes every cross-area import edge
   (`areaOf(file) -> areaOf(target)`), and fails if an edge is not in
   `tests/architecture-allowlist.json` (a new forbidden import) or if an
   allowlisted edge no longer exists (stale entry — must be deleted, never left).
   Regenerate deliberately with `ARCH_WRITE_ALLOWLIST=1 npm run test:ts`, and only
   a migration plan step may do this.
2. **RPC registration**: every backend method name `frontend/rpc.ts` calls must be
   assigned as a global in `backend/main.lua`; calling an unregistered method
   crashes the backend host.

Live: migration plan § 0.5's full baseline (render loop, Properties ×2, nav
cycle, `check_all_tabs.js`) applies to every step; M0c also fixed
`check_all_tabs.js`'s `A -> B -> A: activity cards intact` line to compare
`appActivityStore` day counts instead of DOM card counts, since Steam reveals
cards progressively (was flaky).

## How to add a feature

From migration plan § 4.6 — what changes and what does not:

| New feature | Files touched | Files not touched |
| --- | --- | --- |
| New metadata source (e.g. MobyGames) | `src_mobygames.lua`, the metadata source list, one settings panel | every surface, the resolver, achievements |
| New achievement source (e.g. Xenia) | `src_xenia.lua`, the achievements source list | game-info, captures, sections |
| New thing shown on the page from existing data | one new surface folder + its `touches` | services, other surfaces |
| New record field | `kernel/record.ts` (additive), the producing service, the consuming surface | everything else |
| New routing rule type | `frontend/domain/routing/policy.ts` + its TS tests (ADR-0040) | surfaces, services |

A child plan whose diff crosses more boundaries than its row allows must explain
why in its root-cause section, or it is rejected.

## History

- M0c (2026-09-28): created. Import ratchet + RPC registration test
  (`tests/architecture.test.ts`, `tests/architecture-allowlist.json`, 53
  entries); fixed `check_all_tabs.js`'s `A -> B -> A: activity cards intact`
  flake (compares `appActivityStore` day counts, not DOM card counts).
- M4a (2026-09-29): `frontend/features/buckets/` moved behind `domain/routing/`
  (pure policy: `policy.ts`, `pending.ts`) and `app/routing.ts`
  (`createRouting`, the stateful factory every former buckets caller now
  reaches through a D3 setter). `LAYER_RULES` gained
  `[/^(app|settings|features\/.+)$/, /^domain$/]`; every `* -> features/buckets`
  and `features/buckets -> *` allowlist entry is gone. ADR-0040.
