# Surfaces

**This doc's job:** the only code allowed to write into Steam. Part of the
steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

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
| `frontend/surfaces/captures/{summary,activity,achievement-days,session,publish,deps}.ts` | `captures`'s parts, one file each (the headline, cards and Big Picture style moved to steam-captured-activity, ADR-0062) |
| `frontend/surfaces/game-info/index.ts` | `game-info` surface: `createGameInfoSurface`, `gameInfoWriter` (§ game-info below) |
| `frontend/surfaces/game-info/{patch,metadata,deps}.ts` | `game-info`'s hooks, enrich/revert (the badges come from the record since M10), injected deps |
| `frontend/surfaces/game-info/playbar.ts` | part `playbar` of `game-info` (§ playbar below; a surface of its own until M10) |
| `frontend/steam/overview-proxy.ts` | `createPatchedOverview`; importable only by `surfaces/game-info` (guardrail 1) |
| `frontend/surfaces/achievements/index.ts` | `achievements` surface: `createAchievementsSurface`, `achievementsStore` (§ achievements below) |
| `frontend/surfaces/achievements/{core,store}.ts` | Hook installation, local schema/unlock reads |
| `frontend/steam/achievement-types.ts` | Steam's own achievement shapes; importable by surfaces |
| `frontend/surfaces/toasts/index.ts` | `toasts` surface: `createToastsSurface` (§ toasts below) |
| `frontend/surfaces/toasts/{achievement,launch,deps}.ts` | The two `NotificationStore` writes, injected deps |
| `frontend/surfaces/native-links/index.ts` | `native-links` surface: `createNativeLinksSurface` (§ native-links below) |
| `frontend/surfaces/native-links/core.ts` | Pure redirect logic (tested with node) |
| `frontend/surfaces/artwork/index.ts` | `artwork` surface: `createArtworkSurface`, `artworkWriter` (§ artwork below) |
| `frontend/surfaces/artwork/{artwork,logo,deps}.ts` | Slot writes from the image bin, logo position, injected deps (`images`, `bus`) |
| `frontend/surfaces/artwork/icon.ts` | The library icon write and restore (`SetShortcutIcon`, icon plan) |
| `frontend/surfaces/library-home/index.ts` | `library-home` surface: `createLibraryHomeSurface`, `ready()` (§ library-home below) |
| `frontend/surfaces/library-home/grid.ts` | The grid patch, async registration |

## Steam targets touched

Per surface — see each surface's `## <id>` section below for its `touches`
list and the guardrail that governs each target.

## May import / must never import

Per migration plan § 4.1:
`surfaces/<name>/` may import `kernel/`, `steam/`, and its own folder, and
must never import another surface, `app/`, `ports/`, or `sensors/`. ADR-0044 (M10) adds what a surface may be
**given**: its `SurfaceDeps`, pure reads and the `bus` for its own result event; never a function that reaches the
backend or another surface (`tests/architecture.test.ts` checks `index.tsx`'s `create*Surface` blocks).

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
5. It reads the record in `render()`; a Steam-side input arrives as a kernel event whose handler `index.tsx`
   subscribes; its result goes out as its own event on the `bus` it is given (ADR-0044). No D3 setters.
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

**reads:** `identity`, `metadata`, `achievements` (M10: a changed `achievements` part re-renders the sections on a
timer, after the achievements surface fed Steam's stores in the same pass; the `refreshSections` injection is gone).

**Kill switch:** `sections` (`disabledFeatures`). Checked inside `patchedGetSections` on every call (D6).

**Injected deps:**
- `SurfaceDeps` (`isEnabled`, `reportError`), passed to `createSectionsSurface`.

**API:**
- `onCapturesPublished({ appid, hasContent })` — `index.tsx` subscribes it to `captures.published` (M10; was the
  `setContentListener` setter).

**`render(appid, record)`** (M4c; M5b adds the `metadata` half):
`setExtraSections(appid, native ? NATIVE_SECTIONS : isEnabled("community") && media ok with items ? ["community"] : undefined)`
(`NATIVE_SECTIONS = ["friends", "community", "achievements"]`, moved here from `steam-store/index.ts`).
Also tracks whether the shortcut has Game Info (`record?.metadata?.status === "ok"`, or `"error"`
with `data`) in a local `hasGameInfoByAppid` map and re-renders on change — replaces the old
`setGameInfoProbe`/`isAppEnriched` push wiring (M5b: probe deleted, sections now reads the record
directly). `clear(appid)` drops both. `setExtraSectionsSink` and `setGameInfoProbe` are gone —
nothing outside this file calls `setExtraSections`, and nothing pushes a Game Info probe in any more.

**Hooks:** `patchedGetSections` (fail-open: Steam's `base.call` runs first; a throw in our part returns Steam's own result and counts against `sections`).

**Record-driven in:** M4c (`identity`); M5b (`metadata`); M6 (`achievements`); F2 (`media`, the Community section for an unmapped shortcut).

## captures

The only code that writes Steam's spotlight, activity and `StoreItemCache`
stores, from Steam's own captures (ADR-0022) and the record: screenshots and clips, never rebuilt or re-encoded.
Shortcuts only. The captures **in the Activity feed** (the "{Username} captured" day cards, for every game) are the
separate [steam-captured-activity](../steam-captured-activity.md) plugin's (ADR-0062): this surface publishes a
shortcut's own feed events (achievements, "Added to library", "Played for the first time", a mapped game's native
events) and sets a new entry on each change; that plugin merges its events into it.

**touches:**

| Target | Guardrail |
| --- | --- |
| `AppSpotlightStore.GetOrCreateAppData` | 1 |
| `AppActivityStore.m_mapAppActivity` | 1 |
| `StoreItemCache.m_mapApps` | 1, 5 (never deletes a stub, only adds) |
| `StoreItemCache.m_setUnavailableApps` | 1, 5 |
| `StoreItemCache.BIsAppMissing` | 1 |

**reads:** `identity` (M4c), `achievements` (ADR-0056). **Achievements in the feed** (ADR-0056): each day with unlocks
of any source becomes one Steam "achieved" event (`achievement-days.ts` groups, `activity.ts` builds it on the shared
event base `steam/stores.activityEventBase()`, with Steam's achievement class fields: `m_rgAchievements`,
`m_rtOldestAchievement`, an `achievements` getter, `eEventType` 2); setting `activityShowAchievements`. Every publish
builds a **new** activity object and hands it to `AppActivityStore.m_mapAppActivity` only when the feed changed (a
signature): the open feed re-renders when that observable map gets a new object, not when the old one is mutated
(verified live 2026-10-02). `onSynced` adds a store sync's new unlocks to the Post-Game Summary like `onUnlocked`.
Also (M6b, K14) `addSessionAchievement(appid, item)`: the Post-Game Summary
session write (`appSpotlightStore.GetOrCreateAppData(appid).m_session.AddAchievement`) moved here from
`features/achievements/observer-session.ts`, the last Steam write outside `surfaces/`. `index.tsx` calls it for each id of
`achievements.unlocked`; fail-open, and off with the `captures` switch. `touches` gains `AppSpotlightStore.m_session.AddAchievement`.

**Kill switches:** two, one surface (D6) — `captures` (the surface as a whole; switching it off
skips `store-cache` too, since the runner never calls `install()` on a disabled surface) plus `store-cache` for its
own part. `headline` and `activity-cards` are retired (ADR-0062).

**Injected deps:**
- `SurfaceDeps & { activityOptions(): ActivityOptions; bus }`, passed to `createCapturesSurface`; `activityOptions()` replaces importing `settings` directly (the two activity display settings); `bus` carries `captures.published` (M10).

**API:**
- `onUnlocked` — the Post-Game Summary line for each item of `achievements.unlocked` (M10).
- `registerSummaryProvider`, the `Summary*` types — re-exported from `surfaces/captures`. `headlineJsxDiagnostics` and `activityCardsJsxDiagnostics` left with the jsx patches (ADR-0062; the new plugin exports `headlineJsxDiagnostics` and `cardsJsxDiagnostics`).

**`render(appid, record)`** (M4c): `setNativeActivitySource(appid, record?.identity?.data?.native?.appid)`
then `void patch(appid)` (was the steam-store `republish`, wired through `setCapturesSinks`). Called
only when `identity` changed (the runner gates on `reads`). `setCapturesSinks` is gone.

**Hooks:** `BIsAppMissing` (fail-open under `store-cache`).

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

**reads:** `identity`, `metadata` (M10: a new Steam match in `identity` re-renders every window, guardrail 11 — was
`app/steam-store`'s `setGameInfoRefresher` call).

**Kill switches:** `game-info` (checked at the top of every hook, D6) and `playbar` for its PlayBar part.

**Injected deps:**
- `SurfaceDeps & { metadataOf(appid): GameMetadata | undefined }`, passed to `createGameInfoSurface`: a pure read of
  `records.get(appid)?.metadata?.data`. The badge categories are `metadata.badge_category_ids`, decided by
  `app/metadata` with `domain/category-policy` (M10: the `controllerContext` dep and the policy file left the surface).

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

**A part of `game-info` since M10** (`surfaces/game-info/playbar.ts`, installed by `game-info`'s `install()` under
its own kill switch `playbar`): restores the ⓘ "Show/Hide game details" button on a shortcut's desktop PlayBar. It
uses `game-info`'s own overview hooks and instance tracking, which as a separate surface it could only get through
injection (surface → surface, ADR-0044). The button opens Game Info, so it shows only while **both** `playbar` and
`game-info` are enabled. `PlayBar.render` and `PlayBar.props` are in `game-info`'s `touches`.

**touches:**

| Target | Guardrail |
| --- | --- |
| `PlayBar.render` | 1 |
| `PlayBar.props` | 1 |

**reads:** `metadata` (record-driven from M5, D4).

**Kill switch:** `playbar`. `on()` checks `isEnabled("playbar") && isEnabled("game-info")` — both must be on.

**Deps:** `game-info`'s `deps` and, in the same folder, `ensureAppOverviewHooked` and `trackInstance`.

**Hooks:** the props getter (`hookPlayBarProps`, the `requireMetadata: false` path moved verbatim from game-info's `hookComponentProps`) and `render` are both fail-open — a throw returns Steam's original props/render and counts against `playbar`.

**Shared code:** `steam/overview-proxy.ts`'s `createPatchedOverview`, importable only by `surfaces/game-info` (guardrail 1, enforced by an architecture test).

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

**Injected deps:** `SurfaceDeps` (M10: `refreshSections` is gone; `sections` re-renders from the record).
`install()` retries the store hook for 5 s itself (moved from `index.tsx`). Guardrail 8 (M10 fix): our achievements go
into `appData.details.achievements` only where Steam created `details`; nothing creates it.

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

**ADR-0045 (2026-09-30):** the start-up preload renders every shortcut with stored achievements. The progress cache
entry has Steam's own shape (`appid`, `unlocked`, `total`, `percentage`, `all_unlocked`, `cache_time` = now, `vetted`),
written under the unsigned and the signed id; Steam persists it to its `achievement_progress.json` like an owned
game's. Steam replaces the whole cache after login, so `sensors/progress-cache` re-renders every record when the map
appears or is replaced. The `details.achievements` write reads `appDetailsStore.m_mapAppData.get(id)`, never
`GetAppData(id)`, which creates an entry for an unknown id. The `sections` surface coalesces its achievements refresh
to one per tick.

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

**API:** event handlers `index.tsx` subscribes (M10): `onUnlocked` (one toast per item of `achievements.unlocked`,
whose items `app/achievements` builds from the record) and `onLaunchToast` (`achievements.launch-toast`, emitted by the
launch toast policy in `app/achievements.ts`); `installTestHook()` (the documented `cartridges:trigger_fake_achievement`
CDP hook, D8). `dispatchAchievementToast` (D8) stays a public export of `index.tsx`.

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

## community

Feeds Steam's own Community Content section (desktop section `community`, Big Picture COMMUNITY tab) with a
shortcut's community media: IGDB trailers (Steam's YouTube card), IGDB and ScreenScraper screenshots and artwork
(Steam's image cards and viewer). Features plan F2, ADR-0046. Pure logic in `core.ts`.

**touches:**

| Target | Guardrail |
| --- | --- |
| `CommunityContentLoader.LoadCommunityContentAndVotes` (the loader class's prototype) | 2 (one Map lookup per page), 12 (one class for every window) |
| `CommunityContentLoader.OnBind`, `OnResize` (after-patches, same prototype) | 2 (two property checks, then a guarded `LoadAdditionalContent` once), 12 |
| `jsx:community-section` | 2, 17 (learn-once: property checks until the section class is seen, then disposed; the patch runs on a timer, never in the render) |
| `jsx:community-cards` (`replaceType`, persistent once a feed exists) | 2 (a few property reads per element, `cardElement` and friends in `core.ts`), 1 (made-up accounts stay below 2^31), 17 |

**reads:** `media`. **Injected deps:** `SurfaceDeps` + `imageOf(appid, key)` (the media bin, a pure read).

**Kill switch:** `community`. Off: the loader patch calls Steam's own loader and `sections` does not add the section.
Fail-open: a throw in the patch returns Steam's own loader and counts against `community`; a failed learn leaves the
section stock.

**First page loads early (2026-09-30).** Steam loads the first page from a 1 s timer that needs `m_bOnScreen` already true,
or from an IntersectionObserver change `false` to `true`. When the observer's first callback arrives after the timer (a busy
page open) neither fires and the section stays empty until remounted, which users hit as "switch tab/page and come back".
For a shortcut with a feed the load needs no network, so the `OnBind`/`OnResize` after-patches call the loader's
`LoadAdditionalContent()` once (`core.shouldLoadFirstPage`: nothing requested yet, `m_nNextPage` 1, placeholder rows built
so the user's "disable community content" setting still applies). `LoadAdditionalContent` is guarded by Steam's own state.
Native apps keep Steam's timing. Each card's author icon is the source's own logo, inline (`icons.ts`): IGDB's published
SVG logo in white on its brand purple rgb(145, 71, 255), and ScreenScraper's profile emblem (white background made
transparent) as a 96 px palette PNG (6 KB); not
Steam's "?" avatar.

**Stale loader (2026-09-30).** Steam reuses the section for the next app but its `componentDidUpdate` only resets the
placeholder rows: the loader keeps the previous app's id, page counter, cards and "out of content" state (seen live: a section for
one game holding another's 17 cards and never loading its own). An after-patch on the section's `componentDidUpdate`
(`rebuildStaleLoader`, decided by `core.loaderIsStale`) builds a fresh loader for the new app, binds it (which loads our feed at
once) and sets `m_bOnScreen` from the element's real position, because Steam's own code clears it and its observer only reports
a change. Fail-open. Not reproduced by navigation alone (each navigation remounted); proven by giving a mounted section a stale
loader and calling its `componentDidUpdate`. `communityDiagnostics().loaderRebuilds` counts it.

**Cards and viewer (2026-09-30, ADR-0046).** For our cards only (published file id from 9e14): Steam's vote, award, comment
and Report components render nothing and the card's gamepad menu is removed; the viewer Steam opens on an image click gets a
creator and a date (`file_details`), no comment thread and no appid (an appid makes Steam look up app info for a non-Steam
app and assert); Steam's "Created by" avatar and name render the source's inline icon and name for the made-up accounts
(IGDB 2147483101, ScreenScraper 2147483102, below 2^31: above it Steam's signed conversion fails a protobuf uint32 assert
when it opens the comment thread); the viewer's placeholder game icon (`AppIcon` with the default avatar as `src`) renders as
an empty span. While one of our viewers is open (`openViewers`, counted by the viewer wrapper with Steam's own React hooks
through `SP_REACT`) three more tweaks apply, so a native item's viewer is never touched: the label reads "Added by" instead of
"Created by" (English text only), the date row is dropped (the only date we have is when the media was fetched, not when it was
made), and the big image's height cap follows the window (`max(260px, min(600px, 100vh - 330px))`) instead of Steam's fixed
600 px, so the Close button is not pushed under Steam's footer bar on a shorter window.

**Manuals (F2c, ADR-0048):** a `manual` item becomes an Artwork card that always reports `MANUAL_CARD_WIDTH` x
`MANUAL_CARD_HEIGHT` (960 x 540: Steam's ordinary small cell, class 34; see steam-components.md). Its image is the
manual's first page (`deps.coverOf`, a `blob:` URL from `kernel/manual-shelf`, rendered by `app/manuals`) and, until that
exists, an inline SVG placeholder (`core.manualCoverUrl`: one image, a `#manual-<appid>-<key>` fragment per shortcut).
`render` maps each cover URL back to its manual (`manualsByUrl`, else `manualOfUrl` for the placeholder), so `viewerMeta`
matches each cover to its own manual. `isScrollLabel` finds the viewer's "Scroll down for comments" line and the hook
swaps in `MANUAL_SCROLL_TEXT` ("Scroll down to view the manual"; only a manual viewer has children, so only it shows the
line). When Steam's viewer opens on a cover, the viewer wrapper passes `children` = the page column
(`manual.ts`, `createManualPages`) instead of `undefined`; Steam scrolls it on the D-pad and the mouse wheel. The column
reads `kernel/manual-shelf` (`manualOf`, `onManuals`) and, from an effect, emits the surface's own result event
`community.manual-opened` (`bus`), which `app/manuals` handles. No new Steam target: it is a branch of the existing
`jsx:community-cards` hook.

**Loading and ordering (2026-10-01):** `sections` adds the Community section while a shortcut's media is unknown or pending
(`sections/community.ts`), so Steam shows its own placeholder rows at once. The patched loader returns a *held* promise for a
shortcut that is not `settled` yet (`core.createFirstPageHold`, 120 s limit) and answers it from `render` when the media is
final: the feed, or an empty page when none will come. A feed whose manual has no first-page cover yet waits up to
`COVER_WAIT_MS` (8 s, once per shortcut per session) for it. The viewer's lookup (`viewerMeta`) knows **both** a manual's
cover URL and its placeholder URL, because Steam keeps the feed it was served: a card built before the cover existed still
opens the pages. Steam places cards with a shuffled template, so the manual is not guaranteed the first cell.

**API:** `communityDiagnostics()` (`patched`, `feeds`, `served`, `firstPageLoads`, `cardsHidden`, `cardsHook`, `jsx`), exported by `index.tsx` for the live probe.

**Record-driven in:** F2.

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

**Kill switch:** `artwork`. Checked at the top of every write (`applyCustomArtwork`, `clearSlot`, `ensureLogoPosition`, `clearLogoPosition`, `applyIcon`) — while off, no slot is written or cleared, the logo position is not touched and the library icon is neither set nor restored.

**Injected deps (M10):**
- `SurfaceDeps & { images; bus }`, passed to `createArtworkSurface`: `images` is the kernel image bin (read only: the
  slot bytes `app/artwork` fetched before the plan reached the record); `bus` carries `artwork.applied` (what was
  written), which `app/artwork` records through the port (`SteamStoreRecordArtwork`, `SteamStoreRecordIcon`); a refused
  record comes back as a clear plan in the record (P4 H5). The icon file is stored by `app/artwork`
  (`SteamStoreSaveIcon`) before the plan exists, so `IconPlan` carries its `path`. The surface fetches nothing and
  calls no backend (before M10 it took `downloadImage`, `recordArtwork`, `saveIcon`, `recordIcon`).

**`render(appid, record)`** (M5c; M10): when `record.artwork.status` is `ok`, run `record.artwork.data` (an `ArtworkPlan`): clear `clear` slots (and the logo position when slot 2 is cleared), write `write` from the image bin (a slot with no bytes is reported failed), ensure the logo position when slot 2 is ours, then the library icon when the plan has one (`icon.path`: `SetShortcutIcon(appid, path)`; `icon.restore`: `SetShortcutIcon(appid, restore)`, a Clear), then emit `artwork.applied` (not for a Clear). Plans run one at a time per shortcut (a Clear followed by a write never interleaves). `features/steam-store` no longer writes art; `app/steam-store` asks `app/artwork.clearSlots()` and the surface clears.

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
- `SurfaceDeps & { stats }`, passed to `createLibraryHomeSurface`: O(1) reads of `app/library-stats` (M10), which loads
  the capture stats through the port at start-up and after a game quits. The surface calls no backend.

**API:**
- `refresh` — re-exported from `surfaces/library-home`.
- `ready()` — resolves once the grid patch registers (or fails); never rejects. Registration is async (it waits for stats and the store), so `install()` starts it and `index.tsx` awaits `ready()` to keep the original start-up order.

**Hooks:** the `OnAppOverviewChange` afterPatch is fail-open.

**Record-driven in:** not record-driven by design (M10): capture stats are Steam's own data (ADR-0022), read from `app/library-stats`.

**M3 complete:** `library-home` is the last surface. `frontend/renderers/` no longer exists — every
Steam write lives under `frontend/surfaces/`. One exception remains until M6b: K14
(`observer-session.ts` writes the spotlight session directly). The feature freeze (§ 5) ends here.
- M6b (2026-09-29): `achievements` becomes record-driven (`render` feeds the stores from `record.achievements`); `toasts` is driven by
  `achievements.unlocked`; `captures` gains `addSessionAchievement` (K14). `store-port.ts` and `toast-port.ts` are gone
  (the `PURGE(M6)` ports).
- 2026-09-29 (post-M6): K17 fixed (`toasts` protobuf resolver) and K19 fixed (`achievements` `GetAchievements` wrapper).
- Icon plan (2026-09-29): `artwork` touches `SteamClient.Apps.SetShortcutIcon` (the shortcut's library icon,
  `surfaces/artwork/icon.ts`); `ArtworkPlan.icon`.
- M10 (2026-09-30, ADR-0044): no surface fetches, calls the backend or calls another surface. `artwork` reads the
  image bin and emits `artwork.applied`; `library-home` reads `app/library-stats`; `playbar` is a part of `game-info`;
  `sections` follows the record and `captures.published`; `achievements` fixes guardrail 8 and retries its own hook;
  `toasts` and `captures` take `achievements.unlocked`; `captures` styles the windows the view sensor reports;
  `game-info` writes the record's badges and refreshes on a new Steam match. One `jsxRuntime()` in `steam/modules`.

## library-shortcuts

**One job (ADR-0056, ADR-0058):** add the shortcut app/store-sync asks for (auto-add of an installed Epic or Xbox game) and file it
in its store's collection; and repoint an Xbox UWP shortcut to the current version's exe after an app update. Event-driven:
`store.add-requested` in, `store.shortcut-added` out; `store.repair-requested` in, `store.shortcut-repaired` out.

**touches:** `SteamClient.Apps.AddShortcut`, `SteamClient.Apps.SetShortcutName`, `SteamClient.Apps.SetShortcutLaunchOptions`,
`SteamClient.Apps.SetShortcutExe`, `SteamClient.Apps.SetShortcutStartDir`, `collectionStore.NewUnsavedCollection`,
`Collection.AsDragDropCollection.AddApps`.

**reads:** none. **Kill switch:** `library-shortcuts`.

**Facts (verified live 2026-10-02):** `AddShortcut(name, exe, startDir, launchOptions)` resolves to the new appid and
writes `shortcuts.vdf` at once; it ignores the name (named after the exe) and the launch options (stored empty), so both
are set right after; renaming keeps the appid. The collection calls are Steam UI's own and not yet verified on this
build: fail-open (the shortcut is added, the log says the collection was skipped). `userCollections` is read only once
`m_mapCollectionsFromStorage` exists (guardrail 13). `SetShortcutExe` / `SetShortcutStartDir` keep the appid (verified live
2026-10-03 on BURIED STARS, appid 4069313383 unchanged).

## launch-hold

**One job (ADR-0057, Epic Steam Overlay Workaround):** hold Steam's launch of an Epic shortcut while app/epic-launcher has a
running Epic launcher closed, so Steam starts the launcher itself and its overlay reaches the game. Event-driven:
`launch.hold-mode` (the appids to hold: the Epic launcher-link copies while the setting is on, else none) and `launch.release`
in, `launch.held` out. Every other launch goes to Steam untouched. It decides nothing and fetches nothing.

**touches:** `SteamClient.Apps.RunGame`.

**reads:** none. **Kill switch:** `launch-hold` (off = Steam launches at once; the reaper still runs).

**Facts (verified live 2026-10-03, launch-tracking plan E8):** `RunGame` is an own, writable, configurable property of
`SteamClient.Apps`; Steam's Play paths look it up when called (the library Play action with its Big Picture branch, module
`5808`; the game list, `59718`) and ignore its return value. Holding it 0.7 s while the launcher closed worked from Steam's
own Play button. A launch from outside Steam's UI does not pass through it. Fail-open: a held launch goes on after 10 s; a
second Play press while held is dropped (the first goes on). Uninstall restores Steam's original.
