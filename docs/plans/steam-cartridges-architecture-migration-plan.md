# Plan: steam-cartridges Architecture Migration (ports & adapters)

**Status:** Accepted 2026-09-28 · roadmap. Next: child plan M0a.
**Kind:** Umbrella plan. It sets the target architecture, the migration order and
the rules every child plan must follow. It has no before/after code blocks: each
child plan in §7 is written separately, to [the plan writing standard](README.md),
right before it is executed, against the code as it is on that day.
**ADR:** [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) (accepted).
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Why: root cause of the regression pattern

The user had to uninstall `steam-cartridges` on 2026-09-28 because Steam's UI kept
crashing. Over the last several sessions, most new features broke a view that was
already working. The cause is structural. The evidence below comes from the tree at
`ec16203`.

### 1.1 Every feature can reach every other feature

`frontend/features/*` import each other's internals directly:

| Importer | Reaches into |
| --- | --- |
| `features/steam-store/index.ts` | `achievements`, `artwork/artwork`, `game-info/game-info-patch`, `game-info/metadata`, `game-info/normalize`, `renderers/library-app`, `steam/activity`, `steam/sections` |
| `features/scraper/on-update.ts` | `achievements`, `buckets`, `buckets/auto-routing`, `buckets/resolve`, `game-info/metadata`, `game-info/normalize`, `renderers/library-app` |
| `features/scraper/sync-manager.ts` | `achievements`, `buckets`, `buckets/auto-routing`, `buckets/resolve` |
| `steam/sections.ts` (a Steam binding) | `features/game-info/game-info-patch` (a feature) |
| `settings/settings.ts` | `features/buckets/resolve`; and `steam/activity.ts` imports `settings/settings` (a cycle through settings) |
| `settings/settings-panel.tsx` (2707 lines) | `achievements`, `buckets`, `buckets/resolve`, `game-info/controller`, `scraper/sync-manager` |

So the steam-store feature changes Game Info state, achievements and the activity
store, and the scraper changes metadata and achievements. When one file changes,
the effects spread in ways nobody can predict.

### 1.2 No single owner of Steam mutations

Steam's shared objects are patched from about a dozen places, none of which own them:

| Steam target (shared by the whole client) | Patched from |
| --- | --- |
| `AppOverview.prototype.GetGameID`, `.BHasStoreCategory` (every app, native included) | `features/game-info/game-info-patch.ts` `ensureAppOverviewHooked` (walks the prototype chain from any overview it sees) |
| Game Info `k`, container `G`, PlayBar `XC` — `prototype.render` **and** a `props` accessor on the prototype | `game-info-patch.ts` `hookComponentProps`, `patchKComponent` (commit `ec16203`) |
| `CAppDetailsSections.prototype.GetSections` | `steam/sections.ts` (which also imports game-info state) |
| `react/jsx-runtime` `jsx`/`jsxs` | **four** independent hooks: `steam/gamepad-appid.ts`, `steam/headline-patch.ts`, `steam/activity-cards-patch.ts`, `features/steam-store/native-sections.ts` |
| `appStore.GetAppOverviewByAppID`, `Navigator.App` | `features/steam-store/native-sections.ts` |
| `StoreItemCache.m_mapApps`, `.m_setUnavailableApps`, `BIsAppMissing` | `steam/activity.ts` |
| `collectionStore.OnAppOverviewChange` | `renderers/library-home.tsx` |
| `AppDetailsStore` app data (`descriptionsData`, `associationData`, `details.achievements`), `m_setStoreCategories` | `features/game-info/metadata.ts`, `features/achievements/store.ts` |

### 1.3 Side effects inside Steam's render path

`hookComponentProps` (commit `ec16203`, `game-info-patch.ts:344`) installs a `props`
**getter** on three Steam class prototypes. On every read of `this.props`, the getter:

- adds `this` to a set,
- calls `ensureAppOverviewHooked` (a prototype-chain walk),
- fires `onTriggerAppView` (starts the whole source-view pipeline, which includes network calls), and
- calls `onEnrichGameDetails`, which writes to `AppDetailsStore` while React is rendering.

This breaks [guardrail 2](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced)
and makes Steam's render impure: MobX store writes inside a render cause re-render
loops and error boundaries. **This is the leading suspect for the crash, but it has
not been verified.** Child plan M0 confirms or rules it out with evidence.

### 1.4 The same trigger is detected three times

"The user opened a shortcut's page" is detected in three places, and each one starts work:

1. `index.tsx` `onPopupCreate` → desktop `onLocationChange` and Big Picture `watchGamepadAppid` → `patchLibraryApp`
2. `features/source-view.ts` `initSourceView` → its own `onLocationChange` and `watchGamepadAppid` → `onSourceView`
3. `game-info-patch.ts` → the `props` getter and `G.render` → `onTriggerAppView` → `onSourceView`

The `inflight`/`rerun`/`deferred` sets in `source-view.ts` exist only to paper over this.

### 1.5 The appid is normalized ad hoc

`appid >>> 0`, `appid | 0`, `isNonSteamAppId` and triple-key lookups
(`map.get(a) || map.get(a >>> 0) || map.get(a | 0)`) are repeated per feature. Each
new feature has to remember the signed-int32 trap
([knowledgebase](../knowledgebase.md#signed-vs-unsigned-32-bit-appid-in-cef)), and
several regressions came from forgetting it (dataflow audit Finding 1, Animaniacs).

### 1.6 Nothing enforces the boundaries

The guardrails in [plugins.md](../plugins.md) are prose. There is no test that fails
when a feature imports another feature, when two modules patch the same Steam target,
or when a hot hook does I/O. There is also no kill switch: the only way to stop a
crashing feature was to uninstall the whole plugin.

**Ruled out as the primary cause:** the individual bugs fixed in the dataflow audit
(credentials, `ipairs`, TTLs). Those were fixed, and the next feature still regressed
another view. The coupling is the problem, not any one bug.

---

## 2. Target data flows (the user's spec)

Everything below serves these three flows. Each box is one owned module.

### Flow A — main pipeline (a shortcut exists or is viewed)

```
 [Registry]           [Resolver]                        [Metadata]         [Achievements]
 shortcut added  ──►  native Steam match?  ──yes──►  Steam appdetails  ──►  Steam schema
 or first seen        (manual → owned → store search)
                          │ no
                          ▼
                      web identity         ──────►  IGDB / ScreenScraper ─►  RA / local
                      (IGDB id, RA game id,                                  emulator / trophies
                       ROM hash, SS id)
                          │ none → "unresolved" (local data and captures still show)
                          ▼
                    ┌────────────────── GameRecord (read model, per shortcut) ──────────────────┐
                    └──► Surfaces inject into Steam's non-Steam game page (desktop + Big Picture)
```

Full or partial data is normal. Each part of the record has its own status, and a
surface renders whatever parts are `ok`.

### Flow B — daily freshness, only on page open

```
 ViewSensor: shortcut.viewed(appid) ─► Freshness policy: part checked > 24h ago?
      ├─ no  → surfaces render the cached record, no network
      └─ yes → refresh only that appid's stale parts → record.updated → affected surfaces re-render
```

Games that are never opened are never fetched again. The startup batch
(`sync-manager.ts` `triggerSync`) is reduced to Flow A for **newly added** shortcuts only.

### Flow C — live achievements

```
 LifecycleSensor: app launched ─► Achievement observer session (backend channels: logs,
 emulator, RA) ─► achievements.unlocked(appid, ids) ─► Achievements service persists
      ├─► Toast surface (NotificationStore)      └─► Achievements surface re-feeds Steam stores
 app quit ─► stop session ─► captures surface refresh (new screenshots/clips)
```

---

## 3. Options considered

| Option | Verdict |
| --- | --- |
| **Separate Millennium plugins per service** (true microservices) | **Rejected for now.** All frontends share one `SharedJSContext`, so a crashing surface in plugin B still crashes Steam's UI. Splitting into plugins does not isolate the failure that forced the uninstall. It also multiplies the settings, deploy and IPC contract ([ADR-0012](../decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins) cost), while Phase 9 is still unwritten. The contracts below are designed so that a source can move out to a provider plugin later with no core change. |
| **MVC** | Only partly fits. There is no view to write: Steam renders ([ADR-0022](../decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)). Our "view" is a set of adapters that write into Steam's stores, and MVC has no concept for the many external sources (IGDB, RA, Steam store). |
| **Hexagonal (ports & adapters) modular monolith** | **Recommended.** Steam is both an input port (sensors) and an output port (surfaces). IGDB, RA, ScreenScraper and the Steam store are source adapters behind service ports. The domain in the middle (routing, resolution, freshness, normalization) is pure and testable without Steam. One read model (`GameRecord`) decouples producers from consumers. This gives the "new feature touches one part" property at the module level, and the isolation the crash needs at the surface level. |

---

## 4. Target architecture

### 4.1 Layers and the dependency rule

```
                ┌──────────────────────────── frontend ────────────────────────────┐
  Steam UI ──►  sensors/  ──events──►  app/ (use cases)  ──►  ports/backend ──RPC──┼──► backend services
                                           │                                       │        │
                                           ▼                                       │     sources/ (IGDB, RA,
                                      kernel/record  (GameRecord read model)       │      SS, Steam store,
                                           │  record.updated                       │      local files)
                                           ▼                                       │        │
  Steam UI ◄──  surfaces/  (the ONLY code that writes to Steam)                    │     storage/ (JSON files)
                └──────────────────────────────────────────────────────────────────┘
```

**Import rule (enforced by a test, M0):**

| Module | May import | Must never import |
| --- | --- | --- |
| `kernel/` | nothing of ours | Steam, `@steambrew/*`, RPC, any other folder |
| `domain/` (pure frontend policy: display rules, normalization; routing and freshness live in the backend per §11) | `kernel/` | Steam, RPC, sensors, surfaces |
| `sensors/` | `kernel/`, `steam/` (read-only resolution) | `surfaces/`, `app/`, other sensors |
| `app/` (use cases, orchestration) | `kernel/`, `domain/`, `ports/` | `steam/`, `surfaces/`, `sensors/` internals |
| `ports/backend/` | `kernel/` | everything else |
| `surfaces/<name>/` | `kernel/`, `steam/`, its own folder | **another surface**, `app/`, `ports/`, `sensors/` |
| `steam/` (module resolution, `jsx-hook`, store types) | `kernel/`, `logger` | features, surfaces, settings |
| `settings/<panel>` | `kernel/`, `ports/` | surfaces, sensors |
| `index.tsx` | everything (composition root only, no logic) | — |

The one-way flow is: sensors emit events, `app/` updates the record, and surfaces
read the record. A surface never triggers a fetch, and a service never touches Steam.

### 4.2 The kernel (small, stable, rarely changed)

- **`kernel/appid.ts`** — `ShortcutId` branded type, created **only** by
  `toShortcutId(raw)`, which applies `>>> 0` and the non-Steam range check. It also
  provides the gameid conversion (BigInt) and `toSignedKey` for the few Steam APIs
  that need it. Every map in the plugin is keyed by `ShortcutId`, so triple-key
  lookups are no longer possible.
- **`kernel/events.ts`** — a typed in-process bus: `shortcut.viewed`,
  `shortcut.left`, `shortcut.launched`, `shortcut.quit`, `record.updated`
  `{appid, parts[]}`, `achievements.unlocked`, `settings.changed`. Handlers run in
  isolation: one handler throwing never stops the others.
- **`kernel/record.ts`** — `GameRecord` plus an in-memory read model
  (`get(appid)` is O(1) and safe from hot hooks):

  ```ts
  GameRecord {
    appid: ShortcutId; gameid: string; title: string; exe: string;
    route:        { bucket; via };                       // policy result
    identity:     Part<{ native?: {appid, source}; web?: {igdb?, ra?, ss?, romHash?} }>;
    metadata:     Part<GameMetadata>;                    // description, credits, date, categories
    achievements: Part<AchievementSet>;                  // normalized schema + unlocks
    media:        Part<CommunityMedia>;                  // trailers, manuals, links
    artwork:      Part<ArtworkPlan>;
  }
  Part<T> = { status: "ok" | "partial" | "unsupported" | "needs-setup" | "error" | "pending";
              data?: T; source?: string; fetchedAt?: number; checkedAt?: number }
  ```
  Captures are **not** in the record. They stay Steam's own data, read live
  (ADR-0022), because that core must not depend on anything.
- **`kernel/surface.ts`** — the `Surface` contract and the isolation runner (§4.4).

Additive changes to `GameRecord` (a new optional part) are allowed in any child plan.
Changing or removing a field needs an ADR.

### 4.3 Services (backend-first, one per concern)

The backend owns I/O and merging ([ADR-0004](../decisions.md#adr-0004-backend-owns-all-io-and-merging-the-frontend-only-renders)).
Each service is a set of flat Lua files: the backend keeps its flat `require` layout
(P0 T5, `main.lua`), so folders are expressed as filename prefixes.

| Service | Files (target) | Owns | Sources (adapters) |
| --- | --- | --- | --- |
| Registry | `registry_*.lua` | shortcuts.vdf parse, known-shortcut index, "added since last run" diff | `shortcuts.lua`, `steam_paths.lua` |
| Resolver | `resolve_*.lua` | identity: native match first, then web ids; negative-result TTL separate from positive | `src_steam_search`, `src_igdb_search`, `src_ra_hash`; frontend supplies owned-app candidates and collection membership as **context** |
| Metadata | `metadata_*.lua` | normalized `GameMetadata`, local DB (`library_metadata.json`, `custom_override` preserved) | `src_steam_appdetails`, `src_igdb`, `src_screenscraper` |
| Achievements | `ach_*.lua` | schema + unlocks store, observer channels, normalization | `src_steam_schema`, `src_retroachievements`, `src_ps3/ps4_trophies`, `src_engine_logs`, `src_emulators` |
| Media | `media_*.lua` | trailers, manuals, links | `src_screenscraper_media`, `src_igdb_community` |
| Freshness | `fresh_*.lua` | per-part `checkedAt`/TTL, per-source throttle, circuit breaker | — |

**Source contract** (the same shape as the planned provider contract, so a source can
become a provider plugin later, per [ADR-0013](../decisions.md#adr-0013-providers-return-data-the-core-renders-it)
and [ADR-0014](../decisions.md#adr-0014-providers-are-isolated-and-fail-silently)):

```lua
source = { id = "igdb", supports = function(ctx) → bool,
           fetch = function(ctx) → { status, data, ttl } }   -- always pcall-wrapped by the service
```

**RPC facade** (the new surface area, versioned):

- `GetGameRecord(appid)` returns the assembled record from disk (no network).
- `EnsureFresh(appid, parts, context)` runs stale parts through the sources and returns the updated record.
- `ListShortcuts()` / `GetNewShortcuts()` return registry data.
- Achievement observer calls stay as their own group.

Old RPC names stay registered as aliases until the last child plan removes their
callers ([knowledgebase: an unregistered RPC crashes the host](../knowledgebase.md#backend-rpc-crash-trap-unregistered-methods--unhandled-errors)).
A test asserts that every name in `ports/backend` is registered in `main.lua`.

Persisted file formats **do not change** in this migration: `library_metadata.json`,
`steam_store.json`, mappings and `achievements.json` are read and written by their new
owners with the same shape. A format change would be its own plan, with a migration
in `migrate.lua`.

### 4.4 Surfaces: the only code that touches Steam

Each surface owns a declared, non-overlapping set of Steam targets:

```ts
interface Surface {
  id: string;                                   // "sections", "captures", "game-info", …
  touches: string[];                            // e.g. ["CAppDetailsSections.GetSections"]
  install(): void;                              // resolve modules once (guardrail 3), patch once
  render(record: GameRecord | undefined, appid: ShortcutId): void;  // idempotent write into Steam stores
  clear(appid: ShortcutId): void;               // never deletes StoreItemCache stubs (guardrail 5)
  uninstall(): void;
}
```

| Surface | Takes over from | Steam targets it owns |
| --- | --- | --- |
| `sections` | `steam/sections.ts` | `GetSections`, memo reset + `forceUpdate` (guardrails 10, 11) |
| `captures` | `steam/summary.ts`, `steam/activity.ts`, `headline-patch.ts`, `activity-cards-patch.ts`, `renderers/library-app.tsx` | `appSpotlightStore`, `appActivityStore`, `StoreItemCache` stubs and immunity |
| `game-info` | `features/game-info/game-info-patch.ts`, `metadata.ts` | `k`/`G` render proxy, `descriptionsData`, `associationData`, `rt_original_release_date`, categories |
| `playbar` | `game-info-patch.ts` `targetPlayBar` | PlayBar ⓘ toggle |
| `achievements` | `features/achievements/store.ts` | `AppDetailsStore` achievements, `appAchievementProgressCache` |
| `toasts` | `features/achievements/dispatcher.ts`, `launch-toast.ts` | `NotificationStore.OnNotification` |
| `native-links` | `features/steam-store/native-sections*.ts` | `GetAppOverviewByAppID` (tagged substitute), `Navigator.App`, links bar |
| `community` | `renderers/community-tab.tsx`, `steam/community-store.ts` | `CWorkshopStore`, custom tab |
| `artwork` | `features/artwork/artwork.ts`, `steam-store/art-plan.ts` | `SetCustomArtworkForApp` |
| `library-home` | `renderers/library-home.tsx` | `OnAppOverviewChange` grid fields |

Shared infrastructure, which is not a surface and owns no targets: `steam/modules.ts`
(one webpack scan) and **one** `steam/jsx-hook.ts` dispatcher. The four current jsx
hooks become handlers registered on a single `keepJsxPatched` installation, each
wrapped in its own try/catch and O(1).

**Isolation runner (the fix for "remove the whole plugin"):**

1. Each surface is installed in its own try/catch. If it fails to install, only that surface is off.
2. Each Steam render hook a surface installs follows **fail-open**: it wraps its
   logic in try/catch, and on any error it calls Steam's original render with the
   original props. It never throws into Steam's render.
3. Render hooks and getters are **pure reads** of the record (O(1) `Map.get`). No
   events, fetches, store writes or prototype walks
   ([guardrail 2](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced)).
   Store writes happen only in `Surface.render`, which is called from the event loop
   and never from inside a Steam render.
4. Error budget: after N errors in a session (initially 5), the runner uninstalls that
   surface and logs once. Steam falls back to stock for that view.
5. **Kill switches:** each surface and each service has a switch in plugin settings
   (`disabledSurfaces`, `disabledServices`), read before install. A crash is then
   bisected by switching surfaces off, not by uninstalling.
6. **Safe mode (boot sentinel):** the backend writes `boot.pending` on load, and the
   frontend clears it 60 s after init with no surface errors. If Steam starts and
   finds `boot.pending` from the previous run twice in a row, the frontend installs
   only `sections` + `captures` (the capture tier, which is the core promise) and
   logs which surfaces were skipped.
7. A test asserts that no two surfaces declare the same `touches` entry.

### 4.5 Sensors: the only code that detects what the user is doing

| Sensor | Replaces | Emits |
| --- | --- | --- |
| `view-sensor` | the three detectors in §1.4 | `shortcut.viewed` / `shortcut.left`, deduplicated per appid (desktop route + Big Picture jsx handler) |
| `lifecycle-sensor` | `onAppLaunch` in `index.tsx` | `shortcut.launched` / `shortcut.quit` |
| `collections-sensor` | `features/buckets/collections.ts`, `ready.ts` | membership snapshots, only after `collectionsReady()` ([guardrail 13](../plugins.md#13-never-read-a-steam-mobx-computed-before-its-source-exists)) |
| `owned-apps-sensor` | owned-match part of `steam-store/resolve.ts` | native candidates for the resolver's context |

### 4.6 What "a new feature touches only its part" means in practice

| New feature | Files touched | Files not touched |
| --- | --- | --- |
| New metadata source (e.g. MobyGames) | `src_mobygames.lua`, the metadata source list, one settings panel | every surface, the resolver, achievements |
| New achievement source (e.g. Xenia) | `src_xenia.lua`, the achievements source list | game-info, captures, sections |
| New thing shown on the page from existing data | one new surface folder + its `touches` | services, other surfaces |
| New record field | `kernel/record.ts` (additive), the producing service, the consuming surface | everything else |
| New routing rule type | backend `resolve_policy.lua` + its Lua tests | surfaces, other services |

A child plan whose diff crosses more boundaries than its row allows must explain why
in its root-cause section, or it is rejected.

---

## 5. Migration strategy

**Strangler, one owner at a time.** Every child plan moves **one** module (one surface,
one sensor or one service) behind its contract, deletes the old path in the same plan,
and leaves the rest of the plugin byte-identical. There is no big-bang rewrite and no
long-lived parallel implementation.

**Behaviour freeze during migration.** No new features merge into `steam-cartridges`
until M3 is complete. Bug fixes go into the new structure when the module has already
moved, and into the old one otherwise.

**The baseline is the contract.** M0 records the Routine 1–3 outputs (the four views on
desktop and Big Picture, the nav cycle, the parity check for Jotunnslayer, and
Animaniacs achievements) as the baseline. Every child plan's live verification must
reproduce it exactly ([guardrail 15](../plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour):
the baseline changes only through an accepted ADR).

---

## 6. Preconditions (before M0)

1. Working tree is clean:
   ```
   git status
   ```
   Expected output: `nothing to commit, working tree clean`. Last known good base is
   `c2bd158` (this plan), on top of `22bac99` (engine-log codename discovery).
2. `npm run check` in `steam-cartridges/` exits 0 with no output after the npm banner.
3. `npm run test:ts` ends `ℹ fail 0`. Record the pass count; the dataflow audit recorded 64.
4. `NSGA_STEAM_ROOT=C:/game/steam lua tests/test_backend.lua` ends with 0 failures. Record the count.
5. ADR-0039 (§9) accepted — done 2026-09-28.

---

## 7. Child plans (each written and executed separately)

Order matters: safety first, then the Steam-facing side where the crashes live, then
the services. Each row is one plan file, `docs/plans/steam-cartridges-arch-<id>-<name>-plan.md`.

| # | Plan | Scope | Exit criterion |
| --- | --- | --- | --- |
| **M0a** | Crash triage | Reproduce and root-cause the current UI crash with the dev plugin installed (CDP console + `SharedJSContext` error boundary stack, [steam-debug.md § 7](../steam-debug.md#7-cost-efficient-debugging)). Test the §1.3 suspect first by reverting `hookComponentProps` on a scratch branch. Fix it with the **smallest** change in the current structure. | Plugin reinstalled, Routines 1–3 pass, crash cause written in CHANGELOG with evidence |
| **M0b** | Safety harness | Kill switches, per-surface try/catch around the existing install calls in `index.tsx`, fail-open wrappers on the existing Steam render hooks, boot sentinel / safe mode (§4.4 items 1, 2, 4–6). No moves yet. | Turning any one feature off leaves the other three Routine 1 views intact; safe mode proven by a simulated failed boot |
| **M0c** | Baseline + architecture tests | Save the baseline outputs (§5) under `steam-cartridges/tests/baseline/`. Add `tests/architecture.test.ts`: import-rule checker (§4.1) running against an **allowlist of today's violations** that may only shrink; RPC-name registration check; `touches` overlap check (active from M1). | `npm run test:ts` green with the new tests; allowlist committed |
| **M1** | Kernel | `kernel/appid.ts`, `events.ts`, `record.ts`, `surface.ts`, with unit tests. Nothing uses them yet. | New tests pass; plugin bundle unchanged in behaviour |
| **M2** | Sensors | `view-sensor` + `lifecycle-sensor` replace the §1.4 detectors; `source-view.ts` becomes a subscriber; the getter-side `onTriggerAppView` is deleted. Then `collections-sensor`. | One `shortcut.viewed` per navigation (logged); nav cycle passes |
| **M3.1–M3.10** | Surfaces, one plan each, in this order: `sections` → `captures` → `game-info` → `playbar` → `achievements` → `toasts` → `native-links` → `community` → `artwork` → `library-home` | Move the code behind `Surface`, read from the record instead of feature-module state, register its jsx handler on the shared hook. The allowlist shrinks each time. | Baseline reproduced; that surface's allowlist entries removed |
| **M4** | Resolver service | Routing policy (buckets, auto-routing) ported to backend `resolve_policy.lua`, with the `routing-rules`/`buckets` TS tests ported to Lua first as the parity oracle; the frontend passes collection membership + owned-app candidates as context; identity resolution to backend `resolve_*`; negative TTL fix (dataflow Finding 4) kept. | Jotunnslayer parity 17/0; every shortcut's `identity` part populated or `unsupported` |
| **M5** | Metadata service | Metadata sources behind the source contract; `GetGameRecord` serves `metadata`; the `game-info` surface reads only the record. | 220/220 coverage unchanged; AM2R Game Info intact with bucket `none` ([ADR-0035](../decisions.md#adr-0035-local-game-info-is-a-capture-tier-feature-buckets-gate-only-fetching)) |
| **M6** | Achievements service | Sources + observer channels behind the contract; Flow C events; the toast and achievements surfaces subscribe. Absorbs open items of the achievements, native-mirror and retrogames plans. | Animaniacs 0/98, Castlevania 66, live unlock toast on a real run (user test) |
| **M7** | Freshness + ingestion | Flow B (24 h per part, on view only) and "new shortcut" ingestion replace `sync-manager` batch and `on-update.ts`. | No network calls for an unopened game over a session (logged); stale part refreshed on open |
| **M8** | Settings split | `settings-panel.tsx` (2707 lines) split into one panel per service/surface, talking only to `ports/`. | All 7 tabs render; no settings key renamed |
| **M9** | Cleanup + docs | Remove RPC aliases with no callers, empty the allowlist, update [millennium-architecture.md](../millennium-architecture.md) module layout, the [plugins.md](../plugins.md) guardrail index and AGENTS.md; add guardrail 17 ("Only surfaces write to Steam; hooks are pure reads"). | Allowlist empty; docs match the tree |

Afterwards, not in this migration: extract a source into a provider plugin (TASK.md
Phase 9). This should only need an adapter that calls `Collect()` over the provider
contract instead of a local `src_*.lua`.

**Plans this one absorbs:** open steps in
[steam-cartridges-achievements-plan.md](steam-cartridges-achievements-plan.md),
[steam-cartridges-native-achievements-mirror-plan.md](steam-cartridges-native-achievements-mirror-plan.md),
[steam-cartridges-retrogames-achievements-plan.md](steam-cartridges-retrogames-achievements-plan.md)
(into M6),
[steam-cartridges-community-plan.md](steam-cartridges-community-plan.md) (into M3.8 / media service), and
[steam-cartridges-settings-redesign-plan.md](steam-cartridges-settings-redesign-plan.md) (into M8).
Each child plan states which of their steps it carries over, and closes the old plan.

---

## 8. Rules for every child plan

### 8.1 Required contents

Everything in [README.md](README.md) (root cause, preconditions, literal before/after
blocks, a command after every step, do-not-touch, banned actions, dry-run, failure
rule, guardrail checklist, commit, live verification), plus:

- **Boundary statement:** which single module moves, and the import-allowlist entries it removes.
- **`touches` declaration** for any surface it creates.
- **Baseline diff:** the live verification output compared line by line with `tests/baseline/`.

### 8.2 Do-not-touch (whole migration)

1. Persisted file formats: `library_metadata.json` (including `custom_override`), `steam_store.json`, mappings, `achievements.json`, plugin settings keys and defaults.
2. [Guardrail 1](../plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid): never hook `BIsModOrShortcut` on `AppOverview.prototype`; the scoped proxy stays inside the `game-info`/`playbar` surfaces.
3. [Guardrail 5](../plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization): `StoreItemCache` stubs are never deleted, `m_setUnavailableApps` is purged on ingest, and nothing is ever written into `appStore.m_mapApps`.
4. [Guardrail 8](../plugins.md#8-dedicated-metadata-association-never-overwrite-appdatadetails): never assign `appData.details = {}`.
5. [Guardrail 16](../plugins.md#16-millennium-settings-panel-resolution--build-name-divergence): the dual-alias block in `definePlugin` and the `dev.ps1` `-SkipBuild` check.
6. `steam/jsx-hook.ts` semantics (write guard, chain walk); it is shared by identical copy with `enhanced-achievements`.
7. The core promise ([ADR-0012](../decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)): `sections` + `captures` work with every service disabled and no network.

### 8.3 Banned actions (whole migration)

The README list (no `dev.ps1` deploy or Steam restart unless the plan's live step says so, no
SharedJSContext reload, no probe or throwaway plugins, no edits to Millennium's
`config.json` or plugin config, no library/collection/shortcut changes, no
`npm install`/upgrade, no `git push --force`, no `--no-verify`), plus:

- No new cross-feature import outside the allowlist; the allowlist never grows.
- No Steam write outside `surfaces/`.
- No store write, event emit, RPC or prototype walk inside a Steam render, getter or prototype hook.
- No mixing a module move and a behaviour change in one plan.

### 8.4 Failure rule

As in [README.md](README.md): run a failing command at most twice, then append it
to `TASK.md` § Active failures & blockers and stop. Additionally, if a live baseline
check differs from `tests/baseline/`, stop. Do not update the baseline.

### 8.5 Guardrail checklist this migration touches

| Guardrail | How the architecture enforces it |
| --- | --- |
| 1 ID coupling | proxy lives only in `game-info`/`playbar` surfaces; `touches` test forbids `AppOverview.BIsModOrShortcut` |
| 2 O(1) hooks | hooks read `record.get()` only; banned action 8.3 |
| 3 single-pass modules | `Surface.install` resolves once; `steam/modules.ts` is the only scanner |
| 4 multi-tab smoke / 6 two-way nav / 9 CDP suite | baseline in `tests/baseline/`, required in every child plan |
| 5 stubs | owned by `captures`; `clear()` contract forbids deleting stubs |
| 7 categories | owned by `game-info`, which alone writes `m_setStoreCategories` |
| 8 details | owned by `game-info`/`achievements`; do-not-touch 4 |
| 10/11 memo + re-render | owned by `sections`; other surfaces request a refresh through `record.updated` |
| 12 popups | `view-sensor` and `toasts` document their window assumptions |
| 13 MobX computed | only `collections-sensor` reads `collectionStore` |
| 14 gates | domain routing gates fetching only; surfaces always render local parts |
| 15 checks | baseline never edited by a migration plan |
| 16 build name | do-not-touch 5 |

---

## 9. ADR

**[ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) (accepted):** steam-cartridges is a ports-and-adapters modular monolith; only surfaces
write to Steam.** It records §3 (options), §4.1 (dependency rule), §4.4 (surfaces,
isolation, kill switches, safe mode) and the `GameRecord` read model. It amends
[ADR-0004](../decisions.md#adr-0004-backend-owns-all-io-and-merging-the-frontend-only-renders)
(the frontend also owns sensors and surfaces, which are Steam I/O) and
[ADR-0033](../decisions.md#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)
(collections are read by a sensor, and routing policy is pure domain code). It keeps
ADR-0012/13/14 as the path to provider plugins.

---

## 10. Commit instructions (this plan only)

```powershell
git add docs/plans/steam-cartridges-architecture-migration-plan.md TASK.md CHANGELOG.md
git commit -m "docs(plans): steam-cartridges architecture migration plan (ports & adapters)"
```

With the attribution line from the session's system instructions. This repo is exempt from Routine 6.

## 11. User decisions (2026-09-28)

1. **Pipeline logic lives in the backend** (M4–M7): resolution, freshness and
   metadata/achievement selection. The frontend is sensors, surfaces and a thin `app/`
   that calls `GetGameRecord` / `EnsureFresh`.
2. **New shortcuts are fetched in the background** at startup, rate-limited. All
   other refreshes happen only when the page is opened (Flow B).
3. **Feature freeze** on `steam-cartridges` until M3 is complete.

Recorded in [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam).
