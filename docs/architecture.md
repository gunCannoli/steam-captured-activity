# Architecture

How the plugin suite is put together. For _why_, see [decisions.md](decisions.md);
for background facts, see [knowledgebase.md](knowledgebase.md).

---

## Shape of the system

One **core** plugin, plus optional **provider** plugins. The core owns the page and
Steam-native data. Providers contribute extra material for games they recognise.

```
            ┌───────────────────────────────────────────────┐
            │      non-steam-games-activity  (CORE)         │
            │                                               │
            │  • restores Steam's own detail sections       │
            │  • feeds them Steam's screenshots + clips     │
            │  • the library grid's play evidence           │
            │  • the provider registry                      │
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

Before modifying, creating, or refactoring features in this repository, **consult this index**.
Because Steam shares store singletons, prototypes, and class modules across all detail tabs,
a change in one feature area can silently cause a ripple effect and break another.

| When adding/modifying... | Docs to Review First | Source Files Involved | Critical Hazards & Invariants |
| :--- | :--- | :--- | :--- |
| **Game Info** (Descriptions, Credits, Release Dates, Categories) | • [knowledgebase.md § Trap 1: AppOverview ID Coupling](knowledgebase.md#trap-1-the-appoverview-id-coupling-trap-bismodorshortcut-vs-getgameid)<br>• [knowledgebase.md § Trap 2: O(1) Performance Choke](knowledgebase.md#trap-2-the-o1-performance-choke-in-prototype-hooks)<br>• [steam-architecture.md § 2: Core Stores](steam-architecture.md#2-core-stores--modules-quick-reference) | `steamgriddb-artwork/frontend/steam/game-info-patch.ts`<br>`steamgriddb-artwork/frontend/steam/metadata.ts`<br>`steamgriddb-artwork/backend/metadata.py` | 1. **Do not decouple `GetGameID`:** Overriding `BIsModOrShortcut() => false` causes native `GetGameID()` to evaluate to `this.appid.toString()`. `GetGameID` MUST also be hooked to return `this.m_gameid`, or the **Your Stuff** media tab breaks immediately!<br>2. **$O(1)$ strictly enforced:** Never generate `new Error().stack` or regex inside prototype hooks.<br>3. **Clear stale categories:** Delete previous `STEAM_CATEGORIES` before adding new ones.<br>4. **Release date:** Write unix seconds to `overview.rt_original_release_date`. |
| **Your Stuff** (Media, Screenshots, Video Clips) | • [knowledgebase.md § The Two Identifiers](knowledgebase.md#the-two-identifiers)<br>• [knowledgebase.md § Trap 1: AppOverview ID Coupling](knowledgebase.md#trap-1-the-appoverview-id-coupling-trap-bismodorshortcut-vs-getgameid)<br>• [steam-components.md § Screenshots & Media](steam-components.md) | `steamgriddb-artwork/frontend/steam/game-info-patch.ts`<br>`non-steam-games-activity/frontend/steam/sections.ts` | 1. **64-bit composed ID:** Media queries in module `57150` (`Ae.E`) query by `overview.gameid`. Verify `overview.gameid` returns `this.m_gameid` (`18310622842007322624`) and NOT 32-bit `appid.toString()`.<br>2. **Section recognition:** `isShortcut(overview)` must check `overview.appid >= 0x8000_0000 || overview.BIsModOrShortcut()`. |
| **Activity Feed** (Chronological Per-Day Cards) | • [decisions.md#adr-0030](decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing)<br>• [knowledgebase.md § Trap 3: Single-Pass Webpack Cache](knowledgebase.md#trap-3-the-single-pass-webpack-cache-choke)<br>• [knowledgebase.md § Trap 6: Activity Feed StoreItemCache Stubbing](knowledgebase.md#trap-6-activity-feed-storeitemcache-stubbing--css-scoping) | `non-steam-games-activity/frontend/steam/activity.ts`<br>`non-steam-games-activity/frontend/steam/day.ts`<br>`non-steam-games-activity/frontend/steam/activity-cards-patch.ts` | 1. **`StoreItemCache` stubbing:** Satisfy `storeApp.BIsVisible()` before dispatching events.<br>2. **Single-pass module resolution:** Call `initCardComponents()` once at plugin startup; never iterate `req.m` in render paths ($O(N^2)$ choke).<br>3. **CSS disambiguation:** Scope thumbnail rules to `[class*="CarouselThumb"]:not([class*="CarouselThumbs"])` with `width: 100% !important` to prevent flex collapse. |
| **Post-Game Summary** (Top Hero Card Strip) | • [decisions.md#adr-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)<br>• [decisions.md#adr-0029](decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)<br>• [knowledgebase.md § Trap 4: Section Registry Memo](knowledgebase.md#trap-4-section-registry-memo-mutation) | `non-steam-games-activity/frontend/steam/summary.ts`<br>`non-steam-games-activity/frontend/steam/sections.ts` | 1. **Registry memo:** Mutate `m_setSectionsMemo` in place and clear it before `forceUpdate()`.<br>2. **Re-render live instances:** Track instances and forceUpdate on async capture arrival.<br>3. **Zero hand-built DOM:** Use Steam's real `Ge.T` component via `CAppSpotlightStore`. |
| **Achievements & Notifications** (Phase 5/6) | • [steam-architecture.md § 2: Core Stores](steam-architecture.md#2-core-stores--modules-quick-reference)<br>• [steam-components.md § Achievements](steam-components.md#native-achievements-inspection-verified)<br>• [TASK.md § Phase 5](TASK.md#phase-5-native-achievement-integration-desktop--big-picture) | `enhanced-achievements/`<br>`AppDetailsStore`<br>`window.NotificationStore` | 1. **No false achievement tags:** Only set `categories.achievements` if real achievements exist (`achieved > 0` or schema present).<br>2. **Coordinate with Play Bar:** Feed `appAchievementProgressCache.m_achievementProgress.mapCache` alongside `AppDetailsStore`.<br>3. **Native notifications:** Use `NotificationStore.OnNotification` protobuf dispatch; do not inject custom toast DOM. |

---

## Core: `non-steam-games-activity`

### Why this works without any provider

Steam already captures screenshots and recordings for non-Steam games, files them
under a per-game id, **and already has the UI to show them**. It hides those
sections from shortcuts with a one-line app-type filter in its section registry.
The core removes that filter and feeds Steam's own stores; Steam renders
([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

Verified on this machine: **211 non-Steam screenshots across 6 games, 100% present on
disk**, every one carrying a creation timestamp. See
[knowledgebase.md § Steam's own capture store](knowledgebase.md#steams-own-capture-store-verified).

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

`✅` = built and tested · `⚠` = built, unverified · `☐` = not started

```
non-steam-games-activity/
├─ plugin.json                                                    ✅
├─ dev.ps1                                                        ✅
├─ backend/
│  ├─ main.lua            # lifecycle + RPC globals               ✅
│  ├─ rpc.lua             # JSON-in/JSON-out wrappers             ✅
│  ├─ steam_paths.lua     # steam_path(), active userdata id      ✅
│  ├─ gameid.lua          # appid <-> 64-bit gameid               ✅
│  ├─ shortcuts.lua       # parse binary shortcuts.vdf            ✅
│  ├─ captures.lua        # screenshots.vdf (grid counts)         ✅
│  ├─ providers.lua       # registry: discover, call, isolate     ☐
│  └─ _lib/               # vendored json fs http logger …        ✅
├─ tests/
│  ├─ harness.lua         # stubs Millennium's modules            ✅
│  └─ test_backend.lua    # runs real modules on real data        ✅
└─ frontend/
   ├─ index.tsx           # OnPluginLoaded + the provider API            ✅
   ├─ rpc.ts              # typed client for the backend                 ✅
   ├─ steam/              # bindings onto Steam's own internals
   │  ├─ modules.ts       # webpack cache; resolve by signature          ✅
   │  ├─ stores.ts        # typed store/service/payload shapes           ✅
   │  ├─ sections.ts      # restore the sections Steam hides             ✅
   │  ├─ summary.ts       # feed Steam's session + provider registry     ✅
   │  ├─ activity.ts      # feed Steam's activity store + store cache    ✅
   │  ├─ gamepad-appid.ts # detect Big Picture navigation via jsx patch  ✅
   │  └─ gameid.ts        # 32-bit appid ↔ 64-bit gameid (BigInt)        ✅
   └─ renderers/
      ├─ library-app.tsx  # coordinates publish/clear per app (Desktop & BPM) ✅
      └─ library-home.tsx # patch AppOverview so the grid shows stats    ✅
```

There is no `components/` directory: all UI is rendered by Steam's own components
(`Ge.T` for Post-Game Summary, `ae.W` for Activity Feed).
Earlier attempts to clone Big Picture's DOM (`gamepad-app.tsx`, ADR-0024) were completely
deleted in ADR-0029 after confirming Gamepad UI runs in `SharedJSContext` via React Portal.
Both Desktop and Big Picture Mode share the same store-feeding pipeline.

`gameid.lua` was not in the original plan; the 64-bit conversion needed its own
module because Lua numbers are doubles and cannot hold a gameid exactly. It does the
arithmetic on decimal strings in base-10⁷ limbs, verified against all 9 real folders
and cross-checked against 2007 native 64-bit integers.

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

Full API reference in [knowledgebase.md](knowledgebase.md#part-3-retroachievements) —
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

Implemented and shipped as the `steamgriddb-artwork` plugin:
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
