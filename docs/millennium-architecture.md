# Millennium Plugin Suite Architecture

**This doc's job:** how _our_ plugin suite is put together — the core/provider
split, data flow, module layout, RPC surface and provider contract — and the map
of every other doc. For _why_, see [decisions.md](decisions.md).

---

## Where to look (doc map)

The doc map, the per-situation guide and the orchestrator roles live in the
index: [README.md](README.md). Start there.

---

## Shape of the system

One **core** plugin, plus optional **provider** plugins. The core owns the page and
Steam-native data. Providers contribute extra material for games they recognise.

```
            ┌───────────────────────────────────────────────┐
            │      steam-cartridges  (CORE)                 │
            │                                               │
            │  • restores Steam's own detail sections       │
            │  • feeds them Steam's screenshots + clips     │
            │  • the library grid's play evidence           │
            │  • the provider registry                      │
            │  • Game Info and artwork (app/, surfaces/)    │
            │  • data: millennium/config/steam-cartridges/  │
            │                                               │
            │  no network · no emulator · no API key        │
            └───────────────┬───────────────────────────────┘
                            │ provider contract
        ┌───────────────────┼───────────────────┬────────────────┐
        ▼                   ▼                   ▼                ▼
┌───────────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
│ retroarch     │  │ retroachieve-  │  │ guides-      │  │ game-        │
│               │  │ ments          │  │ artwork      │  │ metadata     │
│ playtime,     │  │ achievements,  │  │ manuals, box │  │ publisher,   │
│ emulator      │  │ badges, dates  │  │ art (Screen- │  │ developer,   │
│ screenshots   │  │                │  │ Scraper /    │  │ release date │
│               │  │                │  │ Archive.org) │  │ (IGDB/TGDB)  │
└───────────────┘  └────────────────┘  └──────────────┘  └──────────────┘
```

See [Providers planned](#providers-planned) below for what each one needs and
where its data comes from — this diagram is a map, not the spec.

**The core must be fully useful with zero providers installed.** That is the design
constraint everything else follows from ([ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)).
Install the core and the AM2R page in the screenshot already becomes a real activity
page. Add `retroachievements` and retro games gain achievements. Neither knows about
the other.

---

## Regression Prevention & Pre-Modification Review Index

Before modifying a feature area, **read the guardrails it touches**. Steam shares
store singletons, prototypes, and class modules across all detail tabs, so a
change in one area can silently break another. The rules themselves live in
[plugins.md § Guardrails](plugins.md#guardrails--regression-prevention-must-read-before-writing-code);
this table only routes you to them.

| When adding/modifying...                                         | Guardrails ([plugins.md](plugins.md))                                                                                                                                                                                                                              | Steam reference                                                                                                                  | Source Files Involved                                                                                                                                                          |
| :--------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Game Info** (Descriptions, Credits, Release Dates, Categories) | [1 ID coupling](plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid), [2 O(1) hooks](plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced), [7 categories](plugins.md#7-safe-category-cache-invalidation), [8 details](plugins.md#8-dedicated-metadata-association-never-overwrite-appdatadetails) | [Game Info tab](steam-components.md#game-info-tab--metadata)                                                                     | `steam-cartridges/frontend/features/game-info/game-info-patch.ts`<br>`steam-cartridges/frontend/features/game-info/metadata.ts`<br>`steam-cartridges/backend/web_metadata_db.lua`                       |
| **Your Stuff** (Media, Screenshots, Video Clips)                 | [1 ID coupling](plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid)                                                                                                                                                                                 | [The two identifiers](knowledgebase.md#the-two-identifiers)                                                                      | `steam-cartridges/frontend/features/game-info/game-info-patch.ts`<br>`steam-cartridges/frontend/steam/sections.ts`                                                               |
| **Activity Feed** (Chronological Per-Day Cards)                  | [3 single-pass](plugins.md#3-single-pass-webpack-module-pre-caching), [5 stubs & negative cache](plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization), [6 two-way nav](plugins.md#6-two-way-navigation-lifecycle-smoke-verification-game-a--game-b--game-a) | [Activity feed](steam-components.md#activity-feed), [ADR-0030](decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing) | `steam-cartridges/frontend/steam/activity.ts`<br>`steam-cartridges/frontend/steam/activity-cards-patch.ts`<br>`steam-cartridges/frontend/steam/headline-patch.ts` |
| **Post-Game Summary** (Top Hero Card Strip)                      | [10 registry memo](plugins.md#10-section-registry-memo-mutation), [11 re-render every window](plugins.md#11-asynchronous-data-must-re-render-every-window)                                                                                                          | [Post-Game Summary](steam-components.md#post-game-summary), [ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them) | `steam-cartridges/frontend/steam/summary.ts`<br>`steam-cartridges/frontend/steam/sections.ts`                                                                  |
| **Achievements & Notifications** (Phase 5/6)                     | [2 O(1) hooks](plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced) (jsx handlers), [12 popup hooks](plugins.md#12-popup-hooks-do-not-see-every-window), [jsx sharing](plugins.md#sharing-the-jsx-runtime-between-plugins)          | [Achievements, notifications…](steam-components.md#achievements-notifications-recording--artwork)                                 | `steam-cartridges/frontend/features/achievements/`<br>`enhanced-achievements/`<br>`enhanced-notifications/`                                                                                                                          |

Area-specific invariants not covered by a numbered guardrail:

- **Game Info release date:** write unix seconds to `overview.rt_original_release_date`.
- **Achievements:** only set `categories.achievements` when real achievements exist;
  feed `appAchievementProgressCache` alongside `AppDetailsStore`; dispatch real
  toasts through `NotificationStore.OnNotification`, never custom toast DOM.

---

## Core: `steam-cartridges`

### Why this works without any provider

Steam already captures screenshots and recordings for non-Steam games, files them
under a per-game id, **and already has the UI to show them**. It hides those
sections from shortcuts with a one-line app-type filter in its section registry.
The core removes that filter and feeds Steam's own stores; Steam renders
([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

Verified on this machine: **211 non-Steam screenshots across 6 games, 100% present on
disk**, every one carrying a creation timestamp. See
[knowledgebase.md § Steam's own capture store](knowledgebase.md#steams-own-capture-store).

### The id conversion

Steam uses a 32-bit `appid` in the UI and a 64-bit `gameid` in the capture store:

```
gameid = (appid << 32) | 0x02000000
appid  = gameid >> 32
```

Verified against all 9 screenshot folders. This conversion is the core's entire
"join" — it is arithmetic, not a heuristic, which is what makes the core reliable
where providers must be probabilistic.

### Data flow

**App detail page** — no backend involved. Steam's own APIs already serve a
shortcut's captures, so the data never leaves the client:

```
  SteamClient.Apps.GetScreenshotsInTimeRange(appid) ─┐
  CGameRecordingService.GetClips({ game_id })       ─┤
  registerSummaryProvider(…)  ← provider plugins    ─┘
                            │
                            ▼  sorted oldest-first
        CGamePlaySession.BAddScreenshotNotification / AddClip
                            │
        steam/sections.ts ──┴──► Steam's OWN component renders
        (restore the section)     pager · day separators · date
                                  labels · hover · media viewer
```

**Library grid** — the one thing Steam does not hold, so the backend still reads it:

```
  screenshots.vdf ─► captures.library_stats ─► { appid: { screenshots, newest } }
                            │ JSON over callServerMethod
                            ▼
                     library-home.tsx ─► patch AppOverview fields
```

The frontend does not render the detail page; Steam does
([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
Where the backend is still involved, it owns the I/O
([ADR-0004](decisions.md#adr-0004-backend-owns-all-io-and-merging-the-frontend-only-renders)).

### Module layout

`<layer>` is the layer of [steam-cartridges.md § 3](steam-cartridges.md#3-layer-docs); the description is each file's own header line. Generated from `git ls-files steam-cartridges/frontend steam-cartridges/backend` at M9b (2026-09-29).

```
backend/_lib/
  datetime.lua                       service (backend)  @meta
  fs.lua                             service (backend)  @meta
  http.lua                           service (backend)  @meta
  json.lua                           service (backend)  @meta
  logger.lua                         service (backend)  @meta
  millennium.lua                     service (backend)  @meta
  utils.lua                          service (backend)  @meta

backend/
  ach_service.lua                    service (backend)  Achievement schema and unlocks for a shortcut: which source answers? (migration plan M6a).
  achievements_observer.lua          service (backend)  steam-cartridges - In-game achievement observer (Phase 5).
  achievements_rpc.lua               service (backend)  RPC endpoints for the native achievements subsystem (P5).
  achievements_store.lua             service (backend)  Persistent achievement state & keyless schema ingestion (ADR-0032 & P5).
  art_service.lua                    service (backend)  Artwork resolution: which art may a shortcut get, and from where? (migration plan M5c).
  captures.lua                       service (backend)  Reads Steam's own screenshot index, for the library grid.
  data_dir.lua                       service (backend)  The plugin's own data folder: <Steam>/millennium/config/steam-cartridges
  emulator_controllers.lua           service (backend)  Full Controller Support inferred from how a shortcut launches (parity plan
  fresh_policy.lua                   service (backend)  When is a part of a record stale? (migration plan M7a).
  gameid.lua                         service (backend)  Converts between Steam's two ids for a non-Steam game.
  igdb_community.lua                 service (backend)  steam-cartridges - IGDB Community, Media & Trailers Provider.
  main.lua                           service (backend)  steam-cartridges - backend entry point.
  metadata_service.lua               service (backend)  Metadata resolution: which Game Info to show for a shortcut? (migration plan M5a).
  migrate.lua                        service (backend)  One-time migration from the two legacy plugins to the data folder
  net.lua                            service (backend)  The one outgoing HTTP entry point (migration plan M7a).
  ps3_trophies.lua                   service (backend)  steam-cartridges - RPCS3 Local PlayStation 3 Trophy Provider (Phase 5).
  ps4_trophies.lua                   service (backend)  steam-cartridges - shadPS4 Local PlayStation 4 Trophy Provider.
  ra_hasher.js                       service (backend)  steam-cartridges/backend/ra_hasher.js
  record_rpc.lua                     service (backend)  The record facade: EnsureFresh (resolves stale
  registry.lua                       service (backend)  Which shortcuts has the plugin already seen? (migration plan M7a, Flow B).
  resolve_identity.lua               service (backend)  Identity resolution: is this shortcut a Steam game? (migration plan M4b).
  retroachievements.lua              service (backend)  steam-cartridges - RetroAchievements provider (Phase 5).
  rpc.lua                            service (backend)  The methods the frontend can call.
  screenscraper_media.lua            service (backend)  steam-cartridges - ScreenScraper media & manuals provider.
  shortcuts.lua                      service (backend)  Parses Steam's binary shortcuts.vdf (non-Steam game entries).
  silent_exec.lua                    service (backend)  Silent process execution helper for Windows GUI environments.
  steam_paths.lua                    service (backend)  Locates Steam's root and the active user's userdata directory.
  steam_store_appdetails.lua         service (backend)  Store appdetails: fallback metadata source for a mapped native app
  steam_store_emulators.lua          service (backend)  Emulator executables: shortcuts that launch these never get an automatic
  steam_store_normalize.lua          service (backend)  Title normalisation and match classification for the Steam Store bucket.
  steam_store_rpc.lua                service (backend)  RPC handlers for the Steam Store bucket. Names are prefixed `SteamStore` so
  steam_store_search.lua             service (backend)  Store search: title -> native Steam appid (resolution step 3).
  steam_store_store.lua              service (backend)  Persistent Steam Store state: <data dir>/steam_store.json (ADR-0032).
  steam_store_throttle.lua           service (backend)  One global gate for store.steampowered.com: serial, at most one request per
  web_config.lua                     service (backend)  Read key from file if it exists
  web_igdb.lua                       service (backend)  Robust multi-binding HTTP POST wrapper
  web_metadata_db.lua                service (backend)  
  web_rpc.lua                        service (backend)  Web-metadata and artwork RPC handlers (ex steamgriddb-artwork).
  web_sgdb.lua                       service (backend)  URL encode helper

frontend/app/
  achievements.ts                    app                app/achievements: a shortcut's achievements in its record, and Flow C (launch -> observe -
  artwork.ts                         app                app/artwork: decides which art a shortcut gets and puts the plan in its record; the
  bus.ts                             app                app: the plugin's one event bus (migration plan M2, ADR-0039). Sensors emit into it;
  controller.ts                      app                Structural copy of surfaces/game-info/category-policy ControllerContext (plan § 7.0 D3).
  identity.ts                        app                app/identity: resolves whether a shortcut has a native Steam match, through
  ingest.ts                          app                app/ingest: the background job that fetches data for shortcuts (migration plan M7b; replac
  metadata.ts                        app                app/metadata: selects Game Info for a shortcut through one EnsureFresh call
  records.ts                         app                app/records: the one place a GameRecord is created (migration plan M4c).
  render-queue.ts                    app                app/render-queue: coalesces record.updated events into one render per appid
  routing.ts                         app                
  steam-store.ts                     app                
  view.ts                            app                app/view: what happens when the user opens a shortcut's page (migration plan M7b; moved fr

frontend/domain/
  art-plan.ts                        domain             Per-slot artwork bookkeeping for a steam-store game (P4 H5). Pure, `import
  metadata-normalize.ts              domain             Metadata shape guard (P4 H1; migration plan M5b, moved from

frontend/domain/routing/
  pending.ts                         domain             Collection-dependent resolution is deferred (`pending`) until the store is ready.
  policy.ts                          domain             Pure bucket resolution (ADR-0033, amended by ADR-0036). No runtime imports,

frontend/domain/
  steam-cdn.ts                       domain             Pure helpers for the Steam Store bucket. Only `import type` allowed so the
  store-item.ts                      domain             Pure mapping from Steam's own StoreItemCache to our metadata shape (migration

frontend/
  index.tsx                          composition root   

frontend/kernel/
  appid.ts                           kernel             Kernel: the one place appids are normalized (migration plan M1, ADR-0039).
  events.ts                          kernel             Kernel: the typed in-process event bus (migration plan M1, ADR-0039).
  record.ts                          kernel             Kernel: the GameRecord read model (migration plan M1, ADR-0039).
  surface.ts                         kernel             Kernel: the Surface contract and its isolation runner (migration plan M1/M3, ADR-0039).

frontend/
  logger.ts                          shared             Shared logger.

frontend/ports/
  backend.ts                         ports              The record facade RPC client (migration plan M4b/M4c; M5a extends it with
  transport.ts                       ports              The one function that calls the backend (migration plan M4c; moved from rpc.ts

frontend/safety/
  boot.ts                            safety             Safety: boot sentinel (migration plan M0b, ADR-0039).
  features.ts                        safety             Safety: kill switches, error budget and safe mode (migration plan M0b, ADR-0039).

frontend/sensors/collections/
  index.ts                           sensor             Collections sensor (migration plan M2, ADR-0039): the only code that reads Steam's

frontend/sensors/lifecycle/
  index.ts                           sensor             Lifecycle sensor (migration plan M2, ADR-0039): the only code that detects a shortcut

frontend/sensors/owned-apps/
  index.ts                           sensor             Sensor `owned-apps` (migration plan M4c, ADR-0039): native games Steam

frontend/sensors/store-item/
  index.ts                           sensor             Queues Steam's own StoreItemCache request for a native app and polls until it

frontend/sensors/view/
  core.ts                            sensor             View sensor, pure part (migration plan M2, ADR-0039). Turns raw Steam signals into
  index.ts                           sensor             View sensor (migration plan M2, ADR-0039): the only code that detects which shortcut

frontend/settings/
  components.tsx                     settings           Shared building blocks of the settings panels (migration plan M8c, moved verbatim).
  context.ts                         settings           The only way settings panels reach the app (migration plan M8b, § 7.0 D3): `index.tsx` cal
  defaults.ts                        settings           Setting keys, types and defaults (migration plan M8a). Type-only imports: node can load th
  panel.tsx                          settings           Settings panel shell (migration plan M8c): the sections in their fixed order.

frontend/settings/panels/
  achievements.tsx                   settings           Settings: Achievement sources (migration plan M8c, moved verbatim).
  activity.tsx                       settings           Settings: Activity Feed (migration plan M8c, moved verbatim).
  audit.tsx                          settings           Settings: Library Audit (migration plan M8c; reads the app through the panel context and t
  community.tsx                      settings           Settings: Community & Media (migration plan M8c; adds one help line).
  metadata.tsx                       settings           Settings: Metadata services (migration plan M8c, moved verbatim).
  notifications.tsx                  settings           Settings: Notifications (migration plan M8c, moved verbatim).
  rules.tsx                          settings           Settings: Routing Rules (migration plan M8c, moved verbatim).

frontend/settings/
  settings.ts                        settings           
  sync-progress.tsx                  settings           Settings: the sticky sync progress bar and its hook (migration plan M8c).

frontend/steam/
  achievement-types.ts               steam binding      Steam's own achievement shapes (AppDetailsStore, AchievementsFullStore, NotificationStore)
  gameid.ts                          steam binding      Steam's two ids for a non-Steam game.
  gamepad-appid.ts                   steam binding      Detects which app Big Picture's app-details view is currently showing.
  jsx-hook.ts                        steam binding      A self-healing patch on Steam's shared `react/jsx-runtime` (`jsx` / `jsxs`),
  modules.ts                         steam binding      Access to Steam's own webpack module cache.
  overview-proxy.ts                  steam binding      The scoped AppOverview proxy (guardrail 1): hands one component an overview whose
  route.ts                           steam binding      `/library/app/4263274102` (and Big Picture's `/tab/<Name>` variants).
  shortcut.ts                        steam binding      The shortcut's display title, from appStore or Steam's shortcut data.
  stores.ts                          steam binding      Typed bindings onto Steam's own stores and services.

frontend/surfaces/achievements/
  core.ts                            surface            Transforms backend schema and unlocks into Steam's native AppDetailsStore format.
  index.ts                           surface            Surface `achievements` (migration plan M3.5, ADR-0039): Steam's achievement stores
  store.ts                           surface            Surface `achievements` (migration plan M3.5, ADR-0039): the only code that feeds Steam's

frontend/surfaces/artwork/
  artwork.ts                         surface            Surface `artwork` (migration plan M3.9): writes custom artwork slots through
  deps.ts                            surface            Surface `artwork`: what the composition root gives it (migration plan M3.9, § 7.0 D3/D6).
  index.ts                           surface            Surface `artwork` (migration plan M3.9, record-driven since M5c, ADR-0039): the only code 
  logo.ts                            surface            Surface `artwork` (migration plan M3.9): the logo position that makes a custom logo

frontend/surfaces/captures/
  activity-cards.ts                  surface            
  activity.ts                        surface            
  bpm-style.ts                       surface            Surface `captures`: Big Picture activity thumbnail styling (migration plan M3.2).
  deps.ts                            surface            Surface `captures`: what the composition root gives it (migration plan M3.2, § 7.0 D3/D6).
  headline.ts                        surface            
  index.ts                           surface            Surface `captures` (migration plan M3.2, ADR-0039): the only code that writes Steam's
  publish.ts                         surface            Brings the native app detail sections to a non-Steam game's page.
  session.ts                         surface            Surface `captures`: the Post-Game Summary session write (migration plan M6b, K14). Moved f
  summary.ts                         surface            

frontend/surfaces/game-info/
  category-policy.ts                 surface            Which Steam store categories a shortcut may carry (parity plan Part F,
  deps.ts                            surface            Surface `game-info`: what the composition root gives it (migration plan M3.3, § 7.0 D3/D6)
  index.ts                           surface            Surface `game-info` (migration plan M3.3, ADR-0039): the only code that writes Game Info
  metadata.ts                        surface            
  patch.ts                           surface            Surface `game-info` (migration plan M3.3, ADR-0039): Steam's Game Info components and the

frontend/surfaces/library-home/
  grid.ts                            surface            Surface `library-home` (migration plan M3.10): moved from renderers/library-home.tsx.
  index.ts                           surface            Surface `library-home` (migration plan M3.10, ADR-0039): fills in the library grid's

frontend/surfaces/native-links/
  core.ts                            surface            Pure part of the section appid redirection (parity plan C). No imports, so
  index.ts                           surface            Surface `native-links` (migration plan M3.7, ADR-0039). Moved from

frontend/surfaces/playbar/
  index.ts                           surface            Surface `playbar` (migration plan M3.4, ADR-0039): restores the ⓘ "Show/Hide game details"

frontend/surfaces/sections/
  index.ts                           surface            Surface `sections` (migration plan M3.1, ADR-0039): the only code that patches Steam's

frontend/surfaces/toasts/
  achievement.ts                     surface            Surface `toasts` (migration plan M3.6): Steam's native achievement toast through
  deps.ts                            surface            Surface `toasts`: what the composition root gives it (migration plan M3.6, § 7.0 D6).
  index.ts                           surface            Surface `toasts` (migration plan M3.6, ADR-0039): the only code that shows Steam
  launch.ts                          surface            Surface `toasts` (migration plan M3.6): the "Achievements Enabled" launch notification
```

There is no `components/` directory: all UI is rendered by Steam's own components. Earlier attempts to clone Big Picture's DOM (`gamepad-app.tsx`, ADR-0024) were deleted in ADR-0029: Gamepad UI runs in `SharedJSContext` via a React Portal, so Desktop and Big Picture share one pipeline.

`gameid.lua` exists because Lua numbers are doubles and cannot hold a 64-bit gameid exactly; it does the arithmetic on decimal strings in base-10⁷ limbs.

### Backend contracts

**`steam_paths.lua`** — `millennium.steam_path()` for the root; resolve the active
user by scanning `userdata/` (prefer `loginusers.vdf`'s `MostRecent`, else the
most-recently-modified directory). Never hardcode `83513586`.

**`shortcuts.lua`** — binary VDF. Scan for typed field markers (`0x01` string,
`0x02` int32) rather than implementing full VDF; we need `appid`, `AppName`, `Exe`,
`LaunchOptions`, `tags`. Verified: parses 223/223 entries here.

**`captures.lua`** — `screenshots.vdf` is **text** VDF (unlike `shortcuts.vdf`).
Per entry: `filename`, `thumbnail`, `creation` (unix seconds), `width`, `height`.
Paths are relative to `userdata/<id>/760/remote/`. Recordings live in
`userdata/<id>/gamerecordings/` (`clips/`, `video/`, `timelines/`).

> Verify a file exists before listing it — the index can outlive deleted files.
> Here 211/211 were present, but that is not guaranteed.

### RPC surface

Deliberately small. The backend used to assemble the whole detail page —
`GetActivity` built a session-scoped summary from `clip.pb` and
`gamerecording.pb`, and `GetAsset`/`GetAssets` shipped images as base64. Steam's
own APIs replaced all of it (ADR-0022), so those methods, `timeline.lua`,
`assets.lua` and the recording parsers were removed. Git history has them if the
anything needs them back.

| Method              | Returns                                               |
| ------------------- | ----------------------------------------------------- |
| `GetLibraryStats()` | `{ "<appid>": { screenshots, newest } }` for the grid |
| `GetDiagnostics()`  | what the backend can see — check this first           |

What remains is the one thing Steam genuinely does not hold: evidence a shortcut
was played, for games Steam never launched itself.

The **provider** surface is separate and still to come (Phase 8); a provider
contributes summary _events_ through the frontend's `registerSummaryProvider`,
or data through its own RPC, and never renders markup
([ADR-0013](decisions.md#adr-0013-providers-return-data-the-core-renders-it)).

---

## The provider contract

A provider is an ordinary Millennium plugin that also exposes two backend methods.
The core discovers enabled plugins, calls them, and merges what comes back.

### `Describe() → { id, name, capabilities[] }`

Declares what the provider can contribute: `"timeline"`, `"stats"`, `"section"`,
`"artwork"`.

### `Collect(context) → contribution`

The core passes everything it knows; the provider decides if it recognises the game.

```jsonc
// context — what the core gives every provider
{
    "appid": 2890139989,
    "gameid": "12413045740871320064",
    "name": "Zombies Ate My Neighbors",
    "exe": "\"C:\\emu\\RetroArch\\retroarch.exe\" -L cores\\snes9x_libretro.dll \"C:\\emu\\roms\\snes\\Zombies Ate My Neighbors (USA).zip\"",
    "launchOptions": "",
    "tags": ["SNES"],
    "since": 0,
}
```

```jsonc
// contribution — what a provider returns
{
    "status": "ok", // ok | unsupported | needs-setup | error
    "message": null, // shown to the user when not "ok"
    "stats": [{ "label": "Play Time", "value": "2h 44m", "icon": "playtime" }],
    "timeline": [
        {
            "type": "achievement",
            "at": 1766332001,
            "title": "Ridley's Lair",
            "icon": "https://…/Badge/12345.png",
            "image": "C:\\emu\\RetroArch\\screenshots\\…-cheevo-4620.png",
        },
    ],
    "sections": [
        {
            "id": "achievements",
            "title": "Achievements",
            "kind": "badge-grid",
            "order": 10,
            "data": {
                /* … */
            },
        },
    ],
}
```

Rules that keep this from rotting:

- **Providers never render.** They return data; the core renders it. A provider that
  needs new visuals adds a `kind`, and the core learns to draw it
  ([ADR-0013](decisions.md#adr-0013-providers-return-data-the-core-renders-it)).
- **`unsupported` is normal, not an error.** `retroachievements` returns it for AM2R
  and says nothing. Only `needs-setup` and `error` surface to the user.
- **Providers are isolated.** A crashing, hanging or absent provider must not affect
  the page. The core applies a timeout and renders without it
  ([ADR-0014](decisions.md#adr-0014-providers-are-isolated-and-fail-silently)).
- **The core calls providers; providers never call each other.** Two providers wanting
  the same fact both derive it, or the core promotes that fact into `context`.

### Discovery

The core reads Millennium's `config.json` for `plugins.enabledPlugins`, and treats any
plugin exposing `Describe`/`Collect` as a provider. Nothing to register by hand:
installing a provider and enabling it is the whole setup.

---

## Providers planned

Roughly in build order. Each is an independent plugin; none of them can block
or depend on another (`the core calls providers; providers never call each
other`, above).

### 1. `retroarch`

Recognises a game when `exe` contains `retroarch.exe`. Parses the `-L <core>` argument
and the quoted ROM path; the **ROM basename** is the key to all RetroArch data
([ADR-0003](decisions.md#adr-0003-join-steam-shortcuts-to-retroarch-data-via-the-parsed-rom-path)).
Verified: 210/210 shortcuts parse.

Contributes playtime and last-played from `.lrtl` runtime logs, plus emulator
screenshots. Also publishes `romBasename` and `core` for other providers to use —
the two providers below both need exactly that identity to look anything up.

### 2. `retroachievements`

Needs a `romBasename` (from the `retroarch` provider, or its own parse) and a user API
key. Resolves ROM → RA GameID by cached history, never by silent guess
([ADR-0008](decisions.md#adr-0008-resolve-romgameid-by-cached-history-first-manual-override-last)).
Contributes achievements with `DateEarned` into the timeline, a badge-grid section,
and completion stats.

The strongest signal it adds: RetroArch's `cheevos_auto_screenshot` names captures
`<rom>-cheevo-<id>.png`, linking an image directly to an unlock
([ADR-0006](decisions.md#adr-0006-build-the-timeline-from-dateearned-not-per-day-queries)).

Full API reference in [knowledgebase.md](knowledgebase.md#part-3--retroachievements) —
already written, this provider mostly assembles pieces already documented there.

### 3. `guides-artwork`

Manuals, box art, and reference material for a game that has none of Steam's own
Community Hub content (there is no store page for a ROM). Two sources considered:

- **ScreenScraper** (screenscraper.fr) — the more complete source: box art, wheel
  art, manuals, control-scheme diagrams, videos, looked up by ROM CRC/MD5/SHA1 —
  the exact hashes RetroArch playlists already carry
  ([knowledgebase.md](knowledgebase.md#playlists)), so no fuzzy name matching
  needed. Requires **two layers of credentials**: a developer id/password
  (this plugin's own, requested once from screenscraper.fr) _and_ an end
  user's own login (`ssid`/`sspassword`) — meaning **every user of this
  provider needs their own free ScreenScraper account**, not just an API key
  typed once. Rate limits scale with the user's contribution level to the
  ScreenScraper database and return `429`/`430` on a limit hit, so this needs
  the same disk cache + backoff discipline as `retroachievements`
  ([ADR-0007](decisions.md#adr-0007-cache-retroachievements-responses-on-disk)).
- **Archive.org** — no API key at all, and its Advanced Search API
  (`archive.org/advancedsearch.php`) plus per-item metadata
  (`archive.org/metadata/<identifier>`) can find manual scans in existing
  community collections (e.g. `retrokit-manuals`). Coverage is far patchier and
  matching is by title search, not a hash, so it is the honest-fallback tier
  rather than the primary source.

Planned resolution order: ScreenScraper by hash when the user has configured
credentials → Archive.org title search as a no-setup fallback → `unsupported`.
Contributes a `sections` entry, never into the timeline — this is static
reference material, not something that happened on a date. Manuals/scans are a
`kind: "links"` list (title + URL, per ADR-0013's existing vocabulary); box
art and screenshots earn a new `kind: "gallery"` only if `links` genuinely
cannot express a grid of images — that decision is deferred to when this
provider is actually built, not made speculatively here.

### 4. `game-metadata` (Implemented as `steamgriddb-artwork` provider)

Publisher, developer, original release date, genres, and category badges — the box-back
facts Steam shows for an owned game, but hides from shortcuts.

Implemented in `steam-cartridges` (`app/metadata.ts`, `surfaces/game-info`; ex `steamgriddb-artwork`, merged in P1):

- **Local Database Single Source of Truth:** Stored as `C:\game\steam\library_metadata.json`
  with 2-space indentation. Easily user-editable and preserved with `custom_override`.
- **Twitch OAuth & IGDB v4 Backend:** APICalypse queries (`igdb.lua`) with client-credentials
  caching.
- **Smarter Scraper Disambiguation:** Ingests launch commands and emulator cores from
  `shortcuts.vdf`. Scores canonical references (e.g. boosting primary `chrono-trigger`
  and matching SNES platform hints over 2018 PC re-release `chrono-trigger--3`).
- **Summary vs Storyline Priority:** Strictly prioritizes `summary` > `parent_game.summary` >
  `storyline` to prevent narrative walkthroughs from replacing general game overviews.
- **Smart Sentence Boundary Truncation (`truncate_smart`):** Splits cleanly on punctuation
  (`. ! ?`) targeting ~400 characters with leeway.
- **Native Store Feeding (Zero Custom DOM):** Feeds `descriptionsData` (`strSnippet`,
  `strFullDescription`) and `associationData` (`rgDevelopers`, `rgPublishers`, `rgFranchises`).
  Sets `overview.rt_original_release_date = meta.release_date` for native release date display,
  and hooks `AppOverview.prototype.BHasStoreCategory` to render Steam's native SVG category badges.
- **Filter Bypass & `GetGameID` Decoupling:** Hooks `AppOverview.prototype.BIsModOrShortcut`
  to return `false` for enriched shortcuts (preventing `#AppDetails_Shortcut_Explanation`),
  while hooking `GetGameID` to guarantee `this.m_gameid` is returned so that the **Your Stuff**
  media queries are never corrupted.

---

## Frontend integration

**Library home** — `beforePatch(Steam.CollectionStore, 'OnAppOverviewChange')`, write
`minutes_playtime_forever` / `rt_last_time_played` onto non-Steam overviews so Steam's
own sorting and grid work ([ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).

**App detail page** — we render nothing. Steam already has the components; it
hides them from shortcuts and never loads their data, so the frontend only:

1. **Restores the sections.** Steam's registry swaps the full section list for
   `["nonsteam", "notes", "screenshots"]` when `BIsModOrShortcut()`. Patching
   `GetSections` puts `postgamesummary` back and removes `nonsteam` (its grey
   "information is unavailable" box) once we have something to show instead.
2. **Feeds Steam's store.** `CGamePlaySession.BAddScreenshotNotification` /
   `AddClip` take the captures; `m_postGameSummary` is the gate the component
   reads. Steam renders the pager, day separators, date labels and media viewer.

Both data sources are Steam's own and work unmodified for a shortcut:
`SteamClient.Apps.GetScreenshotsInTimeRange(appid, …)` and the recording
service's `GetClips({ game_id })`. The clips call needs the **64-bit gameid** —
Steam's own helper truncates it to 32 bits, which is the actual reason non-Steam
clips never appear natively.

Because the publish is async, the first render has already happened by the time
content arrives. The section patch tracks live component instances and
`forceUpdate`s them (clearing `m_setSectionsMemo` first, since Steam compares
that cache **by size alone** and our change swaps one member for another).

See [steam-components.md](steam-components.md) for the full trace, and
[ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them).

**Big Picture** runs the same page, drawn from the same section registry as
desktop's — verified live: its "ACTIVITY" tab draws the identical Post-Game
Summary component (`Ge.T`) and Activity Feed component (`ae.W`) desktop uses.
Crucially, Big Picture is rendered directly from `SharedJSContext` via
`ReactDOM.createPortal` into the popup window's `#popup_target` (ADR-0029).
There is no separate bundle or isolated module cache: all stores
(`appSpotlightStore`, `appActivityStore`, `StoreItemCache`) execute in
`SharedJSContext`. Feeding them serves both Desktop and Big Picture Mode
identically with full controller D-pad navigation, focus rings, and media carousels.

**Serving local images** no longer needs base64 for the detail page. The
constraint in [ADR-0017](decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)
was real — _our_ plugin cannot serve files through `steamloopback.host` — but it
does not apply here, because **Steam serves its own captures over that origin**
and hands us absolute URLs:

```
https://steamloopback.host/screenshots/18310622842007322624/screenshots/20260920024456_1.jpg
https://steamloopback.host/gamerecordings/clips/clip_1831…_20260919_163736/thumbnail.jpg
```

Verified live for a non-Steam game. Since we pass Steam's own objects straight
back to Steam's own components, no image crosses the RPC boundary at all.
`assets.lua` and the base64 pipeline remain only for anything that needs a file
Steam does not already index.

---

## Caching & refresh

| Data                       | Cached                    | Invalidated         |
| -------------------------- | ------------------------- | ------------------- |
| `shortcuts.vdf` parse      | in-memory                 | file mtime          |
| `screenshots.vdf` parse    | in-memory                 | file mtime          |
| Provider contributions     | per appid, backend        | on app quit, or TTL |
| Provider network responses | provider's own disk cache | provider's policy   |

Primary refresh trigger is `onAppLaunch`'s `onQuit` — exactly when new screenshots and
unlocks exist. No polling.

---

## Failure modes

The page degrades; it never blanks — that is the bug we are fixing
([ADR-0010](decisions.md#adr-0010-every-data-source-degrades-independently)).

| Missing                  | Result                                                  |
| ------------------------ | ------------------------------------------------------- |
| No providers installed   | Steam screenshots, recordings, timeline — the core page |
| Provider errors or hangs | Rendered without it; nothing user-visible               |
| Provider needs setup     | Inline prompt in its own section only                   |
| No captures for a game   | Empty-state invitation, not Steam's grey box            |
| Non-emulator game (AM2R) | Full core page; emulator providers return `unsupported` |

---

## Out of scope for v1

- Writing back to Steam's own databases
- Friends/social features — no equivalent data exists for non-Steam games
- Editing or deleting captures (Steam's own UI owns that)
- Non-Windows paths (the logic is portable; only discovery is Windows-tested)
