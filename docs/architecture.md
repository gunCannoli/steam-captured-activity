# Architecture

How the plugin suite is put together. For *why*, see [decisions.md](decisions.md);
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
   │  └─ gameid.ts        # 32-bit appid ↔ 64-bit gameid (BigInt)        ✅
   └─ renderers/
      ├─ library-app.tsx  # coordinates publish/clear per app            ✅
      ├─ gamepad-app.tsx  # Big Picture
      └─ library-home.tsx # patch AppOverview so the grid shows stats    ✅
```

There is no `components/` directory any more, and that is the point: the
hand-built post-game summary, carousel, media cards and class-module maps were
deleted once Steam's own components were confirmed reachable
([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

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

| Method | Returns |
| --- | --- |
| `GetLibraryStats()` | `{ "<appid>": { screenshots, newest } }` for the grid |
| `GetDiagnostics()` | what the backend can see — check this first |

What remains is the one thing Steam genuinely does not hold: evidence a shortcut
was played, for games Steam never launched itself.

The **provider** surface is separate and still to come (Phase 8); a provider
contributes summary *events* through the frontend's `registerSummaryProvider`,
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
  "since": 0
}
```

```jsonc
// contribution — what a provider returns
{
  "status": "ok",              // ok | unsupported | needs-setup | error
  "message": null,             // shown to the user when not "ok"
  "stats":    [ { "label": "Play Time", "value": "2h 44m", "icon": "playtime" } ],
  "timeline": [ { "type": "achievement", "at": 1766332001,
                  "title": "Ridley's Lair", "icon": "https://…/Badge/12345.png",
                  "image": "C:\\emu\\RetroArch\\screenshots\\…-cheevo-4620.png" } ],
  "sections": [ { "id": "achievements", "title": "Achievements",
                  "kind": "badge-grid", "order": 10, "data": { /* … */ } } ]
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
  (this plugin's own, requested once from screenscraper.fr) *and* an end
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

### 4. `game-metadata`

Publisher, developer, original release date, genres — the box-back facts Steam
shows for an owned game but has none of for a shortcut. Two sources considered:

- **IGDB** (igdb.com, run by Twitch) — the more consistent, actively-maintained
  data model, but auth is a **Twitch OAuth client-credentials flow**
  (`POST id.twitch.tv/oauth2/token` with a Twitch app's `client_id`/`client_secret`
  → bearer token), meaning the user needs a Twitch developer application, not
  just an API key. Rate limit is **4 requests/second, 8 concurrent** — fine
  once cached, since this data never changes after a game ships.
- **TheGamesDB** — simpler auth (a single API key), community-maintained so
  field completeness and quality vary per entry more than IGDB's.

Planned: IGDB when the user configures Twitch credentials, TheGamesDB as the
lower-effort default, matched by title (retro titles rarely collide) with a
manual-override escape hatch mirroring
[ADR-0008](decisions.md#adr-0008-resolve-romgameid-by-cached-history-first-manual-override-last)'s
pattern. Contributes a `sections` entry — publisher, developer, release date,
genre tags — as `kind: "list"` (label/value pairs; no new `kind` needed, per
ADR-0013's rule to keep that vocabulary small), displayed once per game, not
per session. Aggressively cacheable: this is the one provider whose data is
permanently static once fetched, so it never needs a refresh trigger beyond
"first time this game is viewed."

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

**Big Picture** renders the same components from the same section registry as
desktop — verified live: its "ACTIVITY" tab draws the identical Post-Game
Summary component, gated by the identical `setSections.has("postgamesummary")`.
Nothing needs to be built or cloned for its UI.

The open problem is different: Big Picture's window (`Steam Big Picture Mode`)
runs a **separate bundle** with no `window.Millennium` and no shared module
cache — this plugin's frontend never executes there at all, not a rendering
gap. Confirmed from Millennium's own source, not just observation: its plugin
loader attaches to one CDP target by exact title match at startup and never
looks again, and its other injector explicitly excludes the host Big Picture's
window shares. **Not fixable from this repo** — it needs a Millennium engine
change. [ADR-0016](decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)'s
"second renderer" plan is superseded by
[ADR-0023](decisions.md#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one),
which has the full source-level finding and the reusable test procedure
([steam-components.md § Inspecting Big Picture](steam-components.md#inspecting-big-picture-phase-6-answered)).

**Serving local images** no longer needs base64 for the detail page. The
constraint in [ADR-0017](decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)
was real — *our* plugin cannot serve files through `steamloopback.host` — but it
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

| Data | Cached | Invalidated |
| --- | --- | --- |
| `shortcuts.vdf` parse | in-memory | file mtime |
| `screenshots.vdf` parse | in-memory | file mtime |
| Provider contributions | per appid, backend | on app quit, or TTL |
| Provider network responses | provider's own disk cache | provider's policy |

Primary refresh trigger is `onAppLaunch`'s `onQuit` — exactly when new screenshots and
unlocks exist. No polling.

---

## Failure modes

The page degrades; it never blanks — that is the bug we are fixing
([ADR-0010](decisions.md#adr-0010-every-data-source-degrades-independently)).

| Missing | Result |
| --- | --- |
| No providers installed | Steam screenshots, recordings, timeline — the core page |
| Provider errors or hangs | Rendered without it; nothing user-visible |
| Provider needs setup | Inline prompt in its own section only |
| No captures for a game | Empty-state invitation, not Steam's grey box |
| Non-emulator game (AM2R) | Full core page; emulator providers return `unsupported` |

---

## Out of scope for v1

- Writing back to Steam's own databases
- Friends/social features — no equivalent data exists for non-Steam games
- Editing or deleting captures (Steam's own UI owns that)
- Non-Windows paths (the logic is portable; only discovery is Windows-tested)
