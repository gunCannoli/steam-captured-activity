# steam-cartridges architecture — overview

**This doc's job:** the layer list, the dependency rule, and how a new feature is
added under the migration (ADR-0039). Part of the steam-cartridges architecture;
index: [steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

The layer list (status as of M0c; see the migration plan's
§ 0.2 status board
for the authoritative, up-to-date state):

| Layer | Status |
| --- | --- |
| Safety: kill switches, error budget, boot sentinel / safe mode | done (M0b-1) — [safety.md](safety.md) |
| Architecture ratchet: import allowlist, RPC registration test | done (M0c) — this doc |
| Kernel: `ShortcutId`, events, `GameRecord`, `Surface` contract, image bin, category ids | done (M1; M10) |
| Domain: pure routing policy (ADR-0040) | current (M4a) — this doc |
| Sensors: view (and window lifecycle), lifecycle, collections, owned-apps, store-item, shortcuts | done (M2, M4c, M5b, M10) — [sensors.md](sensors.md) |
| App: use cases (routing M4a; records, render-queue, identity M4c; metadata M5b; artwork M5c; achievements M6b; ingest and view M7b; steam-store, controller, library-stats, session-memo as factories M10) | done (M10) |
| Ports: the backend RPC client (`transport.ts`, `backend.ts`) and the image fetch (`image.ts`, icon plan) | current (M4c, M5b) — [rpc.md](rpc.md) |
| Surfaces: the only code that writes to Steam (8; `playbar` is a part of `game-info` since M10) | done (M3.1–M3.10, M10) — [surfaces.md](surfaces.md) |
| Resolver service + RPC facade | done (M4b–M4c) — [service-resolver.md](service-resolver.md), [rpc.md](rpc.md) |
| Metadata service + RPC facade | done (M5a–M5b) — [service-metadata.md](service-metadata.md), [rpc.md](rpc.md) |
| Artwork service (SteamGridDB, Steam CDN) | done (M5c) — [service-artwork.md](service-artwork.md) |
| Media service (IGDB, ScreenScraper) + community surface | done (F2) — [service-media.md](service-media.md), [surfaces.md](surfaces.md#community) |
| Achievements service | planned (M6) |
| Freshness + ingestion | done (M7a-M7b) — [service-freshness.md](service-freshness.md) |
| Settings | done (M8) — [settings.md](settings.md) |
| Settings split | planned (M8) |

## Contract

Not applicable — this doc is the index, not a layer with exported types.

## Files

| File | Role |
| --- | --- |
| `tests/architecture.test.ts` | Import ratchet (cross-area imports) + RPC registration check |
| `tests/architecture-allowlist.json` | The frozen list of allowed cross-area import edges; can only shrink |
| `tests/architecture-capabilities-allowlist.json` | The accepted capability exceptions, each with its reason; can only shrink |
| `tests/architecture-unwired-rpcs.json` | Registered RPCs the frontend does not call, each with the plan that wires or deletes it |

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
| `settings/<panel>` | `kernel/`, `ports/`, `domain/` (types and validators only, ADR-0044) | surfaces, sensors, app |
| `safety/` | `logger` | everything else; only `index.tsx` imports it |
| `index.tsx` | everything (composition root only, no logic) | — |

### What a layer may do (ADR-0044, M10)

The import rule says whom a layer may import; this says what it may **do**. Both are tests.

| Layer | Its one job | Must not |
| --- | --- | --- |
| `kernel/` | shapes, events, the record, pure containers (image bin) | touch Steam or the browser, time, log |
| `domain/` | pure policy (routing, art plan, category policy, store-item mapping) | touch Steam or the browser, time, log |
| `sensors/` | detect what the user does and what Steam knows; emit events or expose reads | write to Steam, call the backend, fetch |
| `app/` | decide and orchestrate, `create*` factories with injected deps | touch Steam or `window`, keep module state, import the backend port as a value |
| `ports/` | the only door to the backend (`transport.ts`) and the network (`image.ts`) | touch Steam, decide |
| `surfaces/<name>/` | write to Steam what the record or an event says | fetch, call the backend, call another surface, detect, decide, be read by another layer |
| `steam/` | the one webpack scanner (`modules.ts`, including `jsxRuntime()`) and jsx dispatcher | features, surfaces, settings |
| `settings/` | the settings store and its panels | write Steam, evaluate policy itself (ask `app/routing` through `PanelContext`) |
| `index.tsx` | create and wire (plus the safety bootstrap, the legacy guard, the guardrail-16 alias block) | read Steam stores, decide, fan out events |
| backend | a service owns its data; a store stores, a source fetches; `registry.shortcut` is the one `shortcuts.vdf` lookup | use an RPC module as a library; a store that fetches |

**What a surface may be given:** its `SurfaceDeps`; pure reads (the record, a setting, the image bin, app-loaded
stats); the `bus` to emit its **own result event** (`artwork.applied`, `captures.published`). Never a function that
reaches the backend or another surface. A Steam-side input a surface needs arrives as a kernel event that `index.tsx`
subscribes the surface's handler to (`window.opened`/`window.closed`, `achievements.unlocked`,
`achievements.launch-toast`, `captures.published`).

**Exceptions** are listed, with their reason, in `tests/architecture-capabilities-allowlist.json` (the Steam
boundaries that convert appids, the transport reaching Millennium, the documented CDP test hook). The file only
shrinks; a new entry needs a migration plan step and its reason.

Every cross-area import not yet migrated to this shape is recorded in
`tests/architecture-allowlist.json` (53 entries as of M0c; 41 as of M2). The
allowlist never grows — a step that removes a module's old path deletes its
edges. Rule-allowed edges are listed in `LAYER_RULES` in
`tests/architecture.test.ts` (D1) and never in the allowlist.

## Tests

`tests/architecture.test.ts` (it runs twice per `npm run test:ts`: `tests/app-routing.test.ts` imports it):

1. **Import ratchet**: walks `frontend/`, computes every cross-area import edge
   (`areaOf(file) -> areaOf(target)`), and fails if an edge is not in
   `tests/architecture-allowlist.json` (a new forbidden import) or if an
   allowlisted edge no longer exists (stale entry — must be deleted, never left).
   Regenerate deliberately with `ARCH_WRITE_ALLOWLIST=1 npm run test:ts`, and only
   a migration plan step may do this.
2. **RPC registration**: every backend method name `frontend/ports/backend.ts` calls must be assigned as a global in
   `backend/main.lua`; calling an unregistered method crashes the backend host.
3. **Capability ratchet** (M10): the table above as rules (`CAPABILITIES`), with a self-test; frozen exceptions in
   `tests/architecture-capabilities-allowlist.json` (regenerate the keys with `ARCH_WRITE_CAPABILITIES=1 npm run
   test:ts`, then write each reason by hand).
4. **Surface injection** (M10): no `create*Surface({...})` block in `index.tsx` names `backend.` or another surface's export.
5. **Sanctioned listeners** (M10, ADR-0042): a `#` touches name on another surface's target must be listed.
6. **Unwired RPCs** (M10, D13): every registered RPC is named in `ports/backend.ts` or listed in
   `tests/architecture-unwired-rpcs.json` with the plan that wires it; every port method has a caller.
7. **Backend rules** (M10): no module requires an RPC module; no store requires `net`.

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
- M4c (2026-09-29): `ports/` created (`transport.ts`, `backend.ts`); `app/records.ts`,
  `app/render-queue.ts` and `app/identity.ts` added. `sections`, `native-links`
  and `captures` become record-driven for `identity` (`setExtraSectionsSink`,
  `setNativeLinksSink`, `setCapturesSinks` deleted). `sensors/owned-apps` added
  (moved from `features/steam-store/known-apps.ts`, deleted along with its
  TS-side matching helpers — the backend's `normalize` is now the only matcher).
  `LAYER_RULES` gained `[/^rpc$/, /^ports$/]` (temporary until M9). Identity now
  resolves through one `EnsureFresh` call instead of up to three round trips.
- M5a (2026-09-29): `backend/metadata_service.lua` added; `record_rpc.lua`'s
  `EnsureFresh`/`GetGameRecord` extended with `metadata`, new `GetAllRecords`.
  Backend only — nothing calls the new part or RPC yet.
- M5b (2026-09-29): `app/metadata.ts` added; `sensors/store-item` added (moved
  from `features/steam-store/store-item.ts`; its pure mapping half moved to
  `domain/store-item.ts`, D12). `game-info` becomes record-driven for
  `metadata` (`features/game-info/index.ts`, `policy.ts` and
  `tests/game-info-policy.test.ts` deleted — selection ported to the backend
  in M5a). `sections` reads `record.metadata.status` directly instead of the
  `setGameInfoProbe` push wiring (deleted). `features/steam-store/index.ts`
  keeps only artwork; a new D3 setter (`setStoreItemSource`) reaches
  `sensors/store-item` since `features -> sensors` is not an allowed edge.
- M5c (2026-09-29): `backend/art_service.lua`, `app/artwork.ts`, `domain/art-plan.ts` (moved from
  `features/steam-store/art-plan.ts`) added; `artwork` becomes record-driven (`setArtworkSink` deleted).
  SteamGridDB fills empty artwork slots for shortcuts with no Steam match. `services.steamgriddbEnabled`
  setting and a SteamGridDB key entry in the settings panel. Also fixed two M5b gaps: `app/metadata.ts`
  sent an empty title, and a `steam-store` shortcut with no Steam match never reached IGDB (the frontend
  now passes its known identity as context).
- M6a/M6b (2026-09-29): `backend/ach_service.lua` and `app/achievements.ts` added; `achievements` and `toasts` surfaces record-/event-driven,
  `captures` gains the Post-Game Summary session write (K14). `frontend/features/achievements/` is deleted (its `PURGE(M6)` ports with it).
- M7a/M7b (2026-09-29): `backend/net.lua`, `fresh_policy.lua`, `registry.lua`; `app/ingest.ts` and `app/view.ts` added. `frontend/features/scraper/`
  and `features/source-view.ts` are deleted; only `features/game-info/controller.ts` and `features/steam-store/` remain under `features/` (M9a moves them).
- M9a (2026-09-29): `frontend/features/`, `frontend/rpc.ts` and `safety/switches.ts` are gone (`app/steam-store.ts`, `app/controller.ts`, `domain/steam-cdn.ts`, `ports/backend.ts`; the switches instance is created in `index.tsx`). `tests/architecture-allowlist.json` is `[]`; ADR-0041 (one jsx hook per concern, guarded by a test). Seven RPC aliases deleted ([rpc.md](rpc.md)).
- M9b (2026-09-29): the live scripts moved to `steam-cartridges/tests/live/` (`npm run test:live`), the migration's execution aids were deleted.
- M10 (2026-09-30, ADR-0044): the layers' jobs are a test (capability ratchet, surface injection, sanctioned
  listeners, unwired RPCs, backend rules). D3 injection is over: surfaces get pure reads and a bus for their own
  result events. `settings -> domain` allowed for types and validators; `safety/` row added. Verification: [verification.md](verification.md).
