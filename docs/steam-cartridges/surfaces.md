# Surfaces

**This doc's job:** the only code allowed to write into Steam. Part of the
steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

Every Steam mutation (patched method, store write, DOM/CSS injection) lives
under `frontend/surfaces/<id>/`, one folder per surface. Each surface
declares its `touches` (the exact Steam targets it writes), its own kill
switch (checked at call time, D6), and fail-open hooks (a throw returns
Steam's own result and counts against the surface's error budget, never
propagates). `assertDisjointTouches` (kernel) fails the architecture test if
two surfaces claim the same target. No other layer may patch a Steam
prototype, write a Steam store, or inject DOM/CSS.

## Contract

```ts
// frontend/kernel/surface.ts
export interface Surface {
    id: string;
    touches: string[];
    reads: RecordPart[];
    install(): void;
    render(appid: ShortcutId, record: GameRecord | undefined): void;
    clear(appid: ShortcutId): void;
    uninstall(): void;
}
export interface SurfaceDeps {
    isEnabled(id: string): boolean;
    reportError(id: string, err: unknown): void;
}
export interface SurfaceStatus { id: string; installed: boolean; disabled: boolean; errors: number; lastError?: string }
export interface SurfaceRunnerOptions {
    isEnabled: (id: string) => boolean;
    errorBudget?: number;
    log?: (level: "warn" | "error", message: string, err?: unknown) => void;
}
export interface SurfaceRunner {
    register(surface: Surface): void;
    installAll(): void;
    render(appid: ShortcutId, record: GameRecord | undefined, changed?: RecordPart[]): void;
    clear(appid: ShortcutId): void;
    reportError(id: string, err: unknown): void;
    status(): SurfaceStatus[];
}
export function assertDisjointTouches(surfaces: Pick<Surface, "id" | "touches">[]): void;
export function createSurfaceRunner(opts: SurfaceRunnerOptions): SurfaceRunner;
```

## Files

| File | Role |
| --- | --- |
| `frontend/kernel/surface.ts` | `Surface`, `SurfaceDeps`, `SurfaceRunner` contract (kernel, not a surface itself) |
| `frontend/surfaces/sections/index.ts` | `sections` surface (§ sections below) |
| `frontend/surfaces/captures/index.ts` | `captures` surface: `createCapturesSurface`, re-exports (§ captures below) |
| `frontend/surfaces/captures/{summary,activity,headline,activity-cards,publish,bpm-style,deps}.ts` | `captures`'s six parts, one file each |
| `frontend/surfaces/game-info/index.ts` | `game-info` surface: `createGameInfoSurface`, `gameInfoWriter` (§ game-info below) |
| `frontend/surfaces/game-info/{patch,metadata,category-policy,deps}.ts` | `game-info`'s hooks, enrich/revert, category filtering, injected deps |
| `frontend/surfaces/playbar/index.ts` | `playbar` surface: `createPlaybarSurface` (§ playbar below) |
| `frontend/steam/overview-proxy.ts` | `createPatchedOverview`; importable only by `surfaces/game-info` and `surfaces/playbar` (guardrail 1) |
| `frontend/surfaces/achievements/index.ts` | `achievements` surface: `createAchievementsSurface`, `achievementsStore` (§ achievements below) |
| `frontend/surfaces/achievements/{core,store}.ts` | Hook installation, local schema/unlock reads |
| `frontend/steam/achievement-types.ts` | Steam's own achievement shapes; importable by surfaces |

## Steam targets touched

Per surface — see each surface's `## <id>` section below for its `touches`
list and the guardrail that governs each target.

## May import / must never import

Per [migration plan § 4.1](../plans/steam-cartridges-architecture-migration-plan.md#41-layers-and-the-dependency-rule):
`surfaces/<name>/` may import `kernel/`, `steam/`, and its own folder, and
must never import another surface, `app/`, `ports/`, or `sensors/`.

## Tests

Surfaces are exercised through the migration plan § 0.5 live baseline
(render loop, Properties ×2, nav cycle, `check_all_tabs.js`), plus each
step's switch-off check (`disabledFeatures` set to the surface's id; the
view it owns falls back to Steam's stock behaviour, every other § 0.5 check
still passes). No unit tests yet — surfaces have no pure logic to extract
until the service steps (M4+) feed them through `render()`.

## How to add a surface

1. Create `frontend/surfaces/<id>/index.ts` (plus any helper files in the
   same folder) exporting `create<Id>Surface(deps: SurfaceDeps): Surface`.
2. List every Steam target it writes in `touches`, one entry per target
   (`assertDisjointTouches` fails the build if another surface already
   claims one).
3. Wrap every hook in a fail-open try/catch: on error, return Steam's own
   result and call `deps.reportError(id, err)`. Check `deps.isEnabled(id)`
   at the top of each hook, not only at install (D6).
4. `render(appid, record)` stays a no-op until the service step that
   produces the record parts it reads exists (D4) — list the parts it will
   read in `reads` regardless.
5. Callers reach the surface's API only through a D3 setter wired in
   `index.tsx`'s `init()`, never through a direct import.
6. Register and install it where its old start-up call was:
   `runner.register(create<Id>Surface(surfaceDeps))`, then
   `runner.installAll()` covers every registered surface in one call.

## History

- M3.1 (2026-09-28): created. `sections` is the first surface (moved from
  `steam/sections.ts`); `SurfaceDeps` added to `kernel/surface.ts`.
- M3.2 (2026-09-28): `captures` surface added (moved from `steam/summary.ts`,
  `steam/activity.ts`, `steam/headline-patch.ts`, `steam/activity-cards-patch.ts`,
  `renderers/library-app.tsx`, and the Big Picture `<style>` block out of `index.tsx`).
- M3.3 (2026-09-28): `game-info` surface added (moved from `features/game-info/game-info-patch.ts`,
  `metadata.ts`, `category-policy.ts`). `GameMetadata`/`GameCategories` move to `kernel/record.ts` (D12).
- M3.4 (2026-09-28): `playbar` surface added, split out of `game-info` (the PlayBar ⓘ button).
  `steam/overview-proxy.ts` created; an architecture test now asserts only `surfaces/game-info`
  and `surfaces/playbar` import it (guardrail 1). New kill switch `playbar` (User-visible).
- M3.5 (2026-09-28): `achievements` surface added (moved from `features/achievements/store.ts`,
  `achievements-core.ts`). `steam/achievement-types.ts` created for Steam's own achievement shapes.
  `AchievementSchemaItem`/`AchievementSchemaRecord`/`AchievementUnlockRecord` move to `kernel/record.ts` (D12).

## sections

Restores the app-detail sections Steam hides from shortcuts
(`postgamesummary`, `activity`, `achievements`, `info`), and drops the grey
"information is unavailable" placeholder once something better is showing.

**touches:**

| Target | Guardrail |
| --- | --- |
| `CAppDetailsSections.GetSections` | 1 (one patch owns this prototype method) |
| `CAppDetailsSections.m_setSectionsMemo` | 1 |

**reads:** `identity`, `metadata`, `achievements` (record-driven from M4; `render()` is a no-op until then, D4).

**Kill switch:** `sections` (`disabledFeatures`). Checked inside `patchedGetSections` on every call (D6).

**Injected deps:**
- `SurfaceDeps` (`isEnabled`, `reportError`), passed to `createSectionsSurface`.
- `setGameInfoProbe(fn)` — wired to game-info's `isAppEnriched` in `index.tsx` (D3); tells `sections` whether to drop the placeholder even without captures.

**API (reached only through these setters):**
- `setHasContent(appid, hasContent)` — wired from `library-app`'s content listener via `setContentListener`.
- `setExtraSections(appid, names)` — wired from `steam-store` via `setExtraSectionsSink`.
- `refreshSections()` — wired from the achievements store via `setSectionsRefresher`.

**Hooks:** `patchedGetSections` (fail-open: Steam's `base.call` runs first; a throw in our part returns Steam's own result and counts against `sections`).

**Record-driven in:** M4 (the resolver/RPC facade is the first `record.updated` producer).

## captures

The only code that writes Steam's spotlight, activity and `StoreItemCache`
stores and the activity feed's jsx, from Steam's own captures (ADR-0022):
screenshots and clips, never rebuilt or re-encoded.

**touches:**

| Target | Guardrail |
| --- | --- |
| `AppSpotlightStore.GetOrCreateAppData` | 1 |
| `AppActivityStore.m_mapAppActivity` | 1 |
| `StoreItemCache.m_mapApps` | 1, 5 (never deletes a stub, only adds) |
| `StoreItemCache.m_setUnavailableApps` | 1, 5 |
| `StoreItemCache.BIsAppMissing` | 1 |
| `CWorkshopStore.m_mapPublishedFiles` | 1, 13 (the only live writer; the other, `steam/community-store.ts`, was unreachable and purged in M3.0, D7) |
| `jsx:headline` | 2 |
| `jsx:activity-cards` | 2 |
| `BPM.style#nsga-bpm-activity-thumbs` | 12 (Big Picture only, via `onPopupCreate`) |

**reads:** none yet (record-driven from M4, D4).

**Kill switches:** four, one surface (D6) — `captures` (the surface as a whole; switching it off
skips `store-cache`, `headline` and `activity-cards` too, since the runner never calls `install()`
on a disabled surface) plus `store-cache`, `headline`, `activity-cards` for their own part.
Each part installs under its own id inside `captures`'s `install()`, so one part's failure
doesn't take down the others.

**Injected deps:**
- `SurfaceDeps & { activityOptions(): ActivityOptions }`, passed to `createCapturesSurface`; `activityOptions()` replaces importing `settings` directly (the two activity display settings).

**API (reached only through these setters):**
- `setCapturesSinks({ setNativeActivitySource, republish })` — wired from `steam-store` (D3).
- `setCapturesRefresher(fn)` — wired from `scraper/on-update` (D3).
- `registerSummaryProvider`, the `Summary*` types, `headlineJsxDiagnostics`, `activityCardsJsxDiagnostics` — re-exported from `surfaces/captures`; `index.tsx`'s public API (D8) is unchanged.

**Hooks:** `BIsAppMissing` (fail-open under `store-cache`), the headline observer (fail-open under `headline`), the activity-cards `replaceType` (fail-open under `activity-cards`).

**Record-driven in:** M4.

## game-info

Writes Game Info into Steam (descriptions, developer/publisher, release date,
category badges) and hooks Steam's own Game Info components (`k`, `G`) so a
shortcut shows the same accordion drawer a native game does.

**touches:**

| Target | Guardrail |
| --- | --- |
| `GameInfo.k.render` | 1 |
| `GameInfo.k.props` | 1 |
| `GameInfo.G.render` | 1 |
| `GameInfo.G.props` | 1 |
| `PlayBar.render` | 1 (until M3.4, when `playbar` takes it) |
| `PlayBar.props` | 1 (until M3.4) |
| `AppOverview.GetGameID` | 1 |
| `AppOverview.BHasStoreCategory` | 1 |
| `AppOverview.rt_original_release_date` | 1 |
| `AppOverview.m_setStoreCategories` | 1 |
| `AppDetailsStore.descriptionsData` | 1 |
| `AppDetailsStore.associationData` | 1 |

**reads:** `metadata` (record-driven from M5, D4).

**Kill switch:** `game-info`. Checked at the top of every hook (D6).

**Injected deps:**
- `SurfaceDeps & { controllerContext(appid): ControllerContext; metadataOf(appid): GameMetadata | undefined }`, passed to `createGameInfoSurface`. `metadataOf` is `features/game-info`'s `getCachedLibraryMetadata`.

**API (reached only through these setters):**
- `setGameInfoWriter(gameInfoWriter)` — wired to `features/game-info` (D3).
- `setGameInfoSink(gameInfoWriter)` — wired to `steam-store` (D3).
- `setGameInfoEnricher(gameInfoWriter.enrich)` — wired to `scraper/on-update` (D3).
- `setGameInfoProbe` — `sections` reads `isAppEnriched` through this (wired in M3.1).

**Hooks:** all seven Game Info/PlayBar/AppOverview hooks are fail-open — `render` runs Steam's original on error, the `props` getter returns `this._nsga_raw_props`, `GetGameID`/`BHasStoreCategory` return the original's result. `install` = `setCachedStores` + `patchGameInfoComponent`.

**Webpack scanner:** `steamRequire()` from `steam/modules.ts` — the same one scanner every surface shares (guardrail 3); the old `getSteamRequire` retry-on-every-call duplicate is deleted.

**Record-driven in:** M5.

## playbar

Restores the ⓘ "Show/Hide game details" button on a shortcut's desktop
PlayBar. Split out of `game-info` because the two are on different Steam
components and the code has no other reason to be in the same surface; the
button opens Game Info, so it shows only while **both** `playbar` and
`game-info` are enabled — the same behaviour as before the split, when
`game-info` alone owned it.

**touches:**

| Target | Guardrail |
| --- | --- |
| `PlayBar.render` | 1 |
| `PlayBar.props` | 1 |

**reads:** `metadata` (record-driven from M5, D4).

**Kill switch:** `playbar`. `on()` checks `isEnabled("playbar") && isEnabled("game-info")` — both must be on.

**Injected deps:**
- `SurfaceDeps & { hookOverview(overview): void; track(inst): void }`, passed to `createPlaybarSurface`. `hookOverview` is game-info's `ensureAppOverviewHooked`; `track` is game-info's `trackInstance`, so `refreshGameInfoInstances` re-renders the PlayBar too.

**API:** none — `playbar` has no callers besides its own `install()`; it patches `PlayBar` directly once resolved.

**Hooks:** the props getter (`hookPlayBarProps`, the `requireMetadata: false` path moved verbatim from game-info's `hookComponentProps`) and `render` are both fail-open — a throw returns Steam's original props/render and counts against `playbar`.

**Shared code:** `steam/overview-proxy.ts`'s `createPatchedOverview`, importable only by `surfaces/game-info` and `surfaces/playbar` (guardrail 1, enforced by an architecture test).

**Record-driven in:** M5.

## achievements

Steam's achievement stores (`AppDetailsStore.GetAchievements`,
`AchievementsFullStore`, the progress cache) for shortcuts, so a mapped
game's Achievements section shows RetroAchievements/local data through
Steam's own native UI.

**touches:**

| Target | Guardrail |
| --- | --- |
| `AppDetailsStore.GetAchievements` | 1 |
| `AchievementsFullStore.LoadMyAchievements` | 1 |
| `AchievementsFullStore.GetMyAchievements` | 1 |
| `AchievementsFullStore.GetGlobalAchievements` | 1 |
| `AchievementsFullStore.GetPlayerAchievements` | 1 |
| `AchievementsFullStore.LoadFriendAchievements` | 1 |
| `AchievementsFullStore.m_mapMyAchievements` | 1 |
| `AchievementsFullStore.m_mapGlobalAchievements` | 1 |
| `appAchievementProgressCache.m_achievementProgress` | 1 |
| `AppDetailsStore.AppDetailsChanged(achievements)` | 1 |

**reads:** `achievements` (record-driven from M6, D4).

**Kill switch:** `achievements`. All six hooks are fail-open through one shared `failOpen()` helper (handles both sync throws and rejected promises).

**Injected deps:**
- `SurfaceDeps & { refreshSections(): void }`, passed to `createAchievementsSurface`. `refreshSections` is `sections`'s setter (wired in M3.1), so an achievement update can re-trigger the sections re-render.

**API (reached only through this port):**
- `features/achievements/store-port.ts` (D3; `PURGE(M6)`, marked in M3.8) exposes the same five function names the old `store.ts` had, so the feature files only changed an import path.

**Hooks:** all six fail-open through `failOpen()`; the retry loop in `initAchievements` (features/achievements) is unchanged — Steam may not have created the achievement stores yet at install time.

**Record-driven in:** M6.
