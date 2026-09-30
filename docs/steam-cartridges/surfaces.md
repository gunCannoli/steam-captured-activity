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
| `frontend/surfaces/toasts/index.ts` | `toasts` surface: `createToastsSurface` (§ toasts below) |
| `frontend/surfaces/toasts/{achievement,launch,deps}.ts` | The two `NotificationStore` writes, injected deps |
| `frontend/surfaces/native-links/index.ts` | `native-links` surface: `createNativeLinksSurface` (§ native-links below) |
| `frontend/surfaces/native-links/core.ts` | Pure redirect logic (tested with node) |
| `frontend/surfaces/artwork/index.ts` | `artwork` surface: `createArtworkSurface`, `artworkWriter` (§ artwork below) |
| `frontend/surfaces/artwork/{artwork,logo,deps}.ts` | Slot writes, logo position, injected deps |
| `frontend/surfaces/artwork/icon.ts` | The library icon write and restore (`SetShortcutIcon`, icon plan) |
| `frontend/surfaces/library-home/index.ts` | `library-home` surface: `createLibraryHomeSurface`, `ready()` (§ library-home below) |
| `frontend/surfaces/library-home/grid.ts` | The grid patch, async registration |

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
- M3.6 (2026-09-28): `toasts` surface added, split from `features/achievements/dispatcher.ts`
  (achievement toast) plus the Steam write out of `launch-toast.ts` (launch toast). New kill
  switch `toasts` (User-visible). K17 logged: the achievement toast's webpack scanner already
  failed on this Steam build before the move; out of scope for a pure move (D14).
- M3.7 (2026-09-28): `native-links` surface added (moved from `features/steam-store/native-sections.ts`,
  `native-sections-core.ts`). K18 logged: the Support header link already failed parity check 15
  before the move; out of scope for a pure move (D14).
- M3.8 (2026-09-28): purge markers only, no new surface (`store-port.ts`/`toast-port.ts` marked `PURGE(M6)`).
- M3.9 (2026-09-28): `artwork` surface added (moved from `features/artwork/artwork.ts`,
  `features/steam-store/logo.ts`). New kill switch `artwork` (User-visible). `ArtworkUrls` moves
  to `kernel/record.ts` (D12).
- M3.10 (2026-09-28): `library-home` surface added (moved from `renderers/library-home.tsx`), the
  last surface. `frontend/renderers/` no longer exists. M3 is complete; the feature freeze (§ 5) ends.
- M5c (2026-09-29): `artwork` becomes record-driven (`render(appid, record)` executes `record.artwork`, an
  `ArtworkPlan` built by `app/artwork.ts`); `setArtworkSink` and `artworkWriter` are gone. New SteamGridDB source
  (`service-artwork.md`).
- M4c (2026-09-29): `sections`, `native-links` and `captures` become record-driven for `identity`:
  each `render(appid, record)` reads `record?.identity?.data?.native` instead of a sink written from
  `steam-store/index.ts`. `setExtraSectionsSink`, `setNativeLinksSink` and `setCapturesSinks` are gone.
- M5b (2026-09-29): `game-info` becomes record-driven for `metadata`: `render(appid, record)` enriches
  or reverts from `record.metadata` instead of the old push pipeline (`features/game-info/index.ts`,
  `policy.ts` deleted; selection ported to the backend, `service-metadata.md`). `sections` reads
  `record.metadata.status` directly instead of the `setGameInfoProbe`/`isAppEnriched` push wiring
  (also gone). `setGameInfoWriter` and `setGameInfoEnricher` are gone; `steam-store/index.ts` keeps
  only artwork (its metadata half — `metaCache`, `loadNative`, `matched` — moved to `app/metadata.ts`).

## sections

Restores the app-detail sections Steam hides from shortcuts
(`postgamesummary`, `activity`, `achievements`, `info`), and drops the grey
"information is unavailable" placeholder once something better is showing.

**touches:**

| Target | Guardrail |
| --- | --- |
| `CAppDetailsSections.GetSections` | 1 (one patch owns this prototype method) |
| `CAppDetailsSections.m_setSectionsMemo` | 1 |

**reads:** `identity`, `metadata`, `achievements` (`identity` and `metadata` are record-driven since
M4c/M5b; `achievements` still writes through its own sink until M6 adds that part).

**Kill switch:** `sections` (`disabledFeatures`). Checked inside `patchedGetSections` on every call (D6).

**Injected deps:**
- `SurfaceDeps` (`isEnabled`, `reportError`), passed to `createSectionsSurface`.

**API (reached only through these setters):**
- `setHasContent(appid, hasContent)` — wired from `library-app`'s content listener via `setContentListener`.
- `refreshSections()` — wired from the achievements store via `setSectionsRefresher`.

**`render(appid, record)`** (M4c; M5b adds the `metadata` half):
`setExtraSections(appid, record?.identity?.data?.native ? NATIVE_SECTIONS : undefined)`
(`NATIVE_SECTIONS = ["friends", "community", "achievements"]`, moved here from `steam-store/index.ts`).
Also tracks whether the shortcut has Game Info (`record?.metadata?.status === "ok"`, or `"error"`
with `data`) in a local `hasGameInfoByAppid` map and re-renders on change — replaces the old
`setGameInfoProbe`/`isAppEnriched` push wiring (M5b: probe deleted, sections now reads the record
directly). `clear(appid)` drops both. `setExtraSectionsSink` and `setGameInfoProbe` are gone —
nothing outside this file calls `setExtraSections`, and nothing pushes a Game Info probe in any more.

**Hooks:** `patchedGetSections` (fail-open: Steam's `base.call` runs first; a throw in our part returns Steam's own result and counts against `sections`).

**Record-driven in:** M4c (`identity`); M5b (`metadata`); M6 (`achievements`).

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

**reads:** `identity` (M4c). Also (M6b, K14) `addSessionAchievement(appid, item)`: the Post-Game Summary
session write (`appSpotlightStore.GetOrCreateAppData(appid).m_session.AddAchievement`) moved here from
`features/achievements/observer-session.ts`, the last Steam write outside `surfaces/`. `index.tsx` calls it for each id of
`achievements.unlocked`; fail-open, and off with the `captures` switch. `touches` gains `AppSpotlightStore.m_session.AddAchievement`.

**Kill switches:** four, one surface (D6) — `captures` (the surface as a whole; switching it off
skips `store-cache`, `headline` and `activity-cards` too, since the runner never calls `install()`
on a disabled surface) plus `store-cache`, `headline`, `activity-cards` for their own part.
Each part installs under its own id inside `captures`'s `install()`, so one part's failure
doesn't take down the others.

**Injected deps:**
- `SurfaceDeps & { activityOptions(): ActivityOptions }`, passed to `createCapturesSurface`; `activityOptions()` replaces importing `settings` directly (the two activity display settings).

**API (reached only through this setter):**
- `setCapturesRefresher(fn)` — wired from `scraper/on-update` (D3).
- `registerSummaryProvider`, the `Summary*` types, `headlineJsxDiagnostics`, `activityCardsJsxDiagnostics` — re-exported from `surfaces/captures`; `index.tsx`'s public API (D8) is unchanged.

**`render(appid, record)`** (M4c): `setNativeActivitySource(appid, record?.identity?.data?.native?.appid)`
then `void patch(appid)` (was the steam-store `republish`, wired through `setCapturesSinks`). Called
only when `identity` changed (the runner gates on `reads`). `setCapturesSinks` is gone.

**Hooks:** `BIsAppMissing` (fail-open under `store-cache`), the headline observer (fail-open under `headline`), the activity-cards `replaceType` (fail-open under `activity-cards`).

**Record-driven in:** M4c (`identity`).

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

**reads:** `metadata` (record-driven since M5b, D4).

**Kill switch:** `game-info`. Checked at the top of every hook (D6).

**Injected deps:**
- `SurfaceDeps & { controllerContext(appid): ControllerContext; metadataOf(appid): GameMetadata | undefined }`, passed to `createGameInfoSurface`. `metadataOf` now reads `records.get(appid)?.metadata?.data` (M5b; was `features/game-info`'s `getCachedLibraryMetadata`, deleted with that file).

**API (reached only through this setter):**
- `setGameInfoRefresher({ refresh })` (`app/steam-store.ts`) — wired to `refreshGameInfoInstances` from `index.tsx`; `steam-store`'s artwork path calls it after a Steam Store view (guardrail 11), narrowed to `refresh` only. `setGameInfoWriter`, `setGameInfoSink` and `setGameInfoEnricher` are gone (M5b): nothing outside this surface writes Game Info any more — `render(appid, record)` is the only writer.

**`render(appid, record)`** (M5b): `record.metadata.status` is `"ok"` (or `"error"` with `data`) →
`enrichGameDetails(appid, metadata.data)` (idempotent, M0a); otherwise, if the app was enriched →
`revertGameDetails(appid)`. Replaces the old push pipeline (`features/game-info/index.ts`'s
`handleWebScrapingView`, `initGameInfo` preload, the bucket-change hook — all deleted): a bucket
change no longer proactively re-scans every cached shortcut; the next view re-resolves `metadata`
through `app/metadata.ts`, which writes a new part and lets this `render()` react to it.

**Hooks:** all seven Game Info/PlayBar/AppOverview hooks are fail-open — `render` runs Steam's original on error, the `props` getter returns `this._nsga_raw_props`, `GetGameID`/`BHasStoreCategory` return the original's result. `install` = `setCachedStores` + `patchGameInfoComponent`.

**Webpack scanner:** `steamRequire()` from `steam/modules.ts` — the same one scanner every surface shares (guardrail 3); the old `getSteamRequire` retry-on-every-call duplicate is deleted.

**Record-driven in:** M5b.

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

**reads:** `achievements` (record-driven since M6b, D4).

**Kill switch:** `achievements`. All six hooks are fail-open through one shared `failOpen()` helper (handles both sync throws and rejected promises).

**Injected deps:**
- `SurfaceDeps & { refreshSections(): void }`, passed to `createAchievementsSurface`. `refreshSections` is `sections`'s setter (wired in M3.1), so an achievement update can re-trigger the sections re-render.

**`render(appid, record)`** (M6b): when `record.achievements` is `ok` with data, `updateShortcutState(appid, native, schema, unlocks)`
feeds Steam's stores (native from `record.identity`, else the schema's). `store-port.ts` is gone: nothing outside this
surface writes the achievement stores. `index.tsx` exports `getLocalAchievements` / `getLocalSchema` from here (public API,
D8) and hands `getLocalAchievements` to the settings panel and the sync manager through D3 setters.

**K19 (fixed 2026-09-29):** the `GetAchievements` wrapper no longer falls through to Steam's original for a shortcut with
nothing of ours: the original always throws there (`details` is null, so `RequestAchievements` dereferences null). The
decision is the pure `getAchievementsAction` in `core.ts` (tested): Steam app → original, our data → ours, shortcut without
data and without Steam-set `details` → `undefined`.

**Hooks:** all six fail-open through `failOpen()`; `index.tsx`'s `initAchievements` keeps the store-hook retry loop — Steam may not have created the achievement stores yet at install time.

**Record-driven in:** M6b (`achievements`).

## toasts

The two `NotificationStore` writes that pop a native Steam toast: an
achievement unlock and a game launch/first-play notification.

**touches:**

| Target | Guardrail |
| --- | --- |
| `NotificationStore.OnNotification` | 1 |
| `NotificationStore.ProcessNotification` | 1 |
| `NotificationStore.m_nNextTestNotificationID` | 1 |

**reads:** `achievements` (declared; the surface renders nothing per record — it is event-driven, below). No hooks, only direct writes; there is nothing to fail open (both dispatch functions return `false` while `toasts` is off).

**Kill switch:** `toasts`. Checked at the top of each dispatch function.

**Injected deps:** `SurfaceDeps`, passed to `createToastsSurface`.

**API:** `toast-port.ts` is gone (M6b). `index.tsx` subscribes to `achievements.unlocked` and shows one toast per id, reading the name,
description, icon and global % from `records.get(appid).achievements.data.schema`; the launch toast policy
(setting `localAchievementsNotifyOnLaunch`, only when the record has achievements) lives in `app/achievements.ts` and calls
`dispatchLaunchToast` through an injected `showLaunchToast`. `dispatchAchievementToast` (D8) stays a public export of `index.tsx`.

**K17 (fixed 2026-09-29):** on the current Steam build the achievement notification's protobuf setters
(`set_achievement_id`, `set_global_achieved_pct`) are on an *instance's* prototype, not on `Class.prototype`, so
`resolveAchievementProto()` never found the class. It now instantiates candidate classes from the module whose source
mentions `achievement_id` and `global_achieved_pct`. Live: `dispatchAchievementToast` returns `true` and Steam opens
its `notificationtoasts` window. The notification type id is the `ok` member of the type enum export (5).

**Record-driven in:** not applicable — `toasts` is event-driven (`achievements.unlocked`, a launch), never per-record.

## native-links

Hands Steam's own Links, Friends and Community sections the native appid of
a mapped shortcut, so those sections load the real game's data instead of
the shortcut's own (empty) page (parity plan C).

**touches:**

| Target | Guardrail |
| --- | --- |
| `appStore.GetAppOverviewByAppID` | 1 |
| `Navigator.App` | 1 |
| `jsx:native-sections` | 2, 3 (one webpack scan at startup; the jsx handler is one Map lookup on element type, then one on appid) |

**reads:** `identity` (M4c).

**Kill switch:** `native-links`. All three hooks are fail-open: the `GetAppOverviewByAppID` afterPatch returns the unmodified value, the `Navigator.App` beforePatch passes its arguments through unchanged, and the jsx observer does nothing.

**Injected deps:** `SurfaceDeps`, passed to `createNativeLinksSurface`.

**API:**
- `nativeSectionsDiagnostics` (D8) — `index.tsx`'s public export is unchanged.

**`render(appid, record)`** (M4c): `setNativeAppid(appid, record?.identity?.data?.native?.appid)`.
`clear(appid)` calls it with `undefined`. `setNativeLinksSink` is gone — `setNativeAppid` is only
called from inside this surface now.

**Known issue:** K18 — the Support ("HelpAppPage") header link isn't among the four
resolved link ids, so `check_parity.mjs` check 15 fails on both the pre-M3.7 and M3.7
builds. Out of scope for a pure move (D14); tracked for a bugfix plan after M3.

**Record-driven in:** M4c.

## artwork

The only code that writes a shortcut's custom artwork slots (portrait,
hero, logo, wide), logo position and library icon into Steam. No hooks. Record-driven
since M5c: `app/artwork.ts` decides which slots to clear and write and from
which URLs (Steam CDN for a shortcut with a Steam match, SteamGridDB for one
without) and puts that plan in `record.artwork`; this surface only executes it.

**touches:**

| Target | Guardrail |
| --- | --- |
| `SteamClient.Apps.SetCustomArtworkForApp` | 1 |
| `SteamClient.Apps.ClearCustomArtworkForApp` | 1 |
| `AppDetailsStore.SaveCustomLogoPosition` | 1 |
| `AppDetailsStore.ClearCustomLogoPosition` | 1 |
| `SteamClient.Apps.SetShortcutIcon` | 1 (the supported icon path: `BIsModOrShortcut` stays untouched) |

**reads:** `artwork` (record-driven since M5c, D4).

**Kill switch:** `artwork`. Checked at the top of every write (`applyCustomArtworkFromUrls`, `clearSlot`, `ensureLogoPosition`, `clearLogoPosition`, `applyIcon`) — while off, no slot is written or cleared, the logo position is not touched and the library icon is neither set nor restored.

**Injected deps:**
- `SurfaceDeps & { downloadImage(url); recordArtwork(appid, info); saveIcon(appid, url, source, steamAppid?); recordIcon(appid, info) }`, passed to `createArtworkSurface`. `saveIcon` stores our copy of the icon image (`SteamStoreSaveIcon`) and returns its path and `previous`; `recordIcon` remembers the icon set (`SteamStoreRecordIcon`) and returns `{ error }` when the match changed meanwhile, so the surface puts `previous` back. `downloadImage` replaces the direct `rpc.steamStoreDownloadImage` call; `recordArtwork` tells the backend which slots were written (`SteamStoreRecordArtwork`, `source: "steamgriddb"` for a shortcut with no Steam match) and returns `{ error }` when the mapping vanished meanwhile, so the surface undoes the write (P4 H5).

**`render(appid, record)`** (M5c): when `record.artwork.status` is `ok`, run `record.artwork.data` (an `ArtworkPlan`): clear `clear` slots (and the logo position when slot 2 is cleared), write `write` from `urls`, record what was written, then ensure the logo position when slot 2 is ours, then the library icon when the plan has one (`icon.url`: save, `SetShortcutIcon`, record; `icon.restore`: `SetShortcutIcon(appid, restore)`, a Clear). Plans run one at a time per shortcut (a Clear followed by a write never interleaves). `setArtworkSink` is gone — `features/steam-store` no longer writes art; it asks `app/artwork.clearSlots()` and the surface clears.

**Hooks:** none — `artwork` only writes, never patches a Steam method.

**Record-driven in:** M5c (`artwork`).

## library-home

Fills in the library grid's "last played" fields for shortcuts from their
capture timestamps, so a non-Steam game with recent activity sorts the way
a native game with recent playtime would.

**touches:**

| Target | Guardrail |
| --- | --- |
| `collectionStore.OnAppOverviewChange` | 1, 13 (a read-triggering write; membership itself is read-only, owned by `sensors/collections`) |
| `AppOverview.rt_recent_activity_time` | 1 |
| `AppOverview.rt_last_time_played_or_installed` | 1 |

**reads:** none — driven by capture stats (an RPC call), not the record, until M7 decides (D4).

**Kill switch:** `library-home`. The afterPatch is fail-open: it returns Steam's own value.

**Injected deps:**
- `SurfaceDeps & { loadLibraryStats(): Promise<Record<string, { newest?: number; screenshots?: number }>> }`, passed to `createLibraryHomeSurface`. `loadLibraryStats` replaces the direct `rpc.getLibraryStats` call.

**API:**
- `refresh` — re-exported from `surfaces/library-home`.
- `ready()` — resolves once the grid patch registers (or fails); never rejects. Registration is async (it waits for stats and the store), so `install()` starts it and `index.tsx` awaits `ready()` to keep the original start-up order.

**Hooks:** the `OnAppOverviewChange` afterPatch is fail-open.

**Record-driven in:** not decided — an RPC call until M7 (D4).

**M3 complete:** `library-home` is the last surface. `frontend/renderers/` no longer exists — every
Steam write lives under `frontend/surfaces/`. One exception remains until M6b: K14
(`observer-session.ts` writes the spotlight session directly). The feature freeze (§ 5) ends here.
- M6b (2026-09-29): `achievements` becomes record-driven (`render` feeds the stores from `record.achievements`); `toasts` is driven by
  `achievements.unlocked`; `captures` gains `addSessionAchievement` (K14). `store-port.ts` and `toast-port.ts` are gone
  (the `PURGE(M6)` ports).
- 2026-09-29 (post-M6): K17 fixed (`toasts` protobuf resolver) and K19 fixed (`achievements` `GetAchievements` wrapper).
- Icon plan (2026-09-29): `artwork` touches `SteamClient.Apps.SetShortcutIcon` (the shortcut's library icon,
  `surfaces/artwork/icon.ts`); `ArtworkPlan.icon`.
