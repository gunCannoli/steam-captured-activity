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
            │  • owns the app detail page UI                │
            │  • Steam screenshots + recordings (local)     │
            │  • the activity timeline                      │
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

Steam already captures screenshots and recordings for non-Steam games and files them
under a per-game id. It simply never renders them on the app page. The core reads that
store and builds the page Steam declined to build.

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

```
                    ┌──────── BACKEND (LuaJIT) ────────────────────┐
                    │                                              │
  screenshots.vdf ─►│ captures ─► [{ path, takenAt, w, h, type }]  │
                    │      │                                       │
  gamerecordings/ ─►│ recordings ─► [{ path, startedAt, duration }]│
                    │      │                                       │
  shortcuts.vdf ───►│ shortcuts ─► appid, name, exe, launchOpts    │
                    │      │                                       │
                    │      ├──► providers.collect(context) ────────┼──► provider
                    │      │         (parallel, best-effort)       │    plugins
                    │      │                                       │
                    │      └──► timeline ─► merge + group by date  │
                    └───────────────────┬──────────────────────────┘
                                        │ JSON over callServerMethod
                    ┌───────────────────▼──────────────────────────┐
                    │          FRONTEND (Steam React/CEF)          │
                    │  library-app ─► render into .GameStatsSection│
                    │     PostGameSummary · Timeline · Media       │
                    │     + provider-contributed sections          │
                    └──────────────────────────────────────────────┘
```

All I/O and merging happen in the backend; the frontend only renders
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
│  ├─ captures.lua        # screenshots.vdf + recordings         ✅
│  ├─ timeline.lua        # group entries by date                 ✅
│  ├─ providers.lua       # registry: discover, call, isolate     ☐
│  ├─ assets.lua          # base64 data URIs + path allowlist     ✅
│  └─ _lib/               # vendored json fs http logger …        ✅
├─ tests/
│  ├─ harness.lua         # stubs Millennium's modules            ✅
│  └─ test_backend.lua    # runs real modules on real data        ✅
└─ frontend/
   ├─ index.tsx           # OnPluginLoaded — diagnostics only so far   ✅
   ├─ rpc.ts              # typed client for the backend               ✅
   ├─ assets.ts           # thumbnail / full-image cache               ✅
   ├─ styles.ts           # scoped CSS on Steam's theme vars            ✅
   ├─ renderers/
   │  ├─ library-app.tsx  # the app detail page (desktop)               ✅
   │  ├─ gamepad-app.tsx  # the app detail page (Big Picture)
   │  └─ library-home.tsx # patch AppOverview so the grid shows stats  ✅
   └─ components/
      ├─ post-game-summary.tsx
      ├─ timeline.tsx
      ├─ media-grid.tsx      # screenshots + recordings
      └─ provider-section.tsx # renders whatever a provider returned
```

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

**`timeline.lua`** — merges core captures with provider entries into dated buckets,
newest first. Provider entries are interleaved by timestamp, not appended.

### RPC surface

| Method | Returns |
| --- | --- |
| `GetActivity(appid)` | full payload for one app detail page |
| `GetLibraryStats(appids[])` | batched minimal stats for the grid |
| `GetAsset(path)` | one image as a base64 data URI |
| `GetAssets(paths[])` | several images (thumbnails) in one round trip |

`GetActivity` payload:

```jsonc
{
  "appid": 4263274102,
  "gameid": "18310622842007322624",
  "name": "AM2R - Another Metroid 2 Remake",
  "media": {
    "screenshots": [ { "path": "…/20251024002134_1.jpg", "thumb": "…", "takenAt": 1761276095 } ],
    "recordings":  [ { "path": "…", "startedAt": 0, "durationSec": 0 } ]
  },
  "timeline": [
    { "date": "2025-10-24",
      "entries": [ { "type": "screenshot", "at": 1761276095, "path": "…" } ] }
  ],
  "providers": [
    { "id": "retroachievements", "status": "ok", "sections": [ /* see below */ ] }
  ]
}
```

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

**App detail page** — `onPopupCreate` → `onLocationChange`; on `/library/app/<appid>`
with `appid >= NON_STEAM_APP_APPID_MASK`, fetch and render into
`.${PlayBarClasses.GameStatsSection}`. Each injected node carries a `data-nsga`
attribute so re-renders replace rather than duplicate, and a scoped `<style>` hides
Steam's empty placeholder.

**Big Picture** is the same plugin with a second renderer. It is a separate popup
window (`SP BPM_`), which `onPopupCreate` already reports as `PopupType.Gamepad`, so
the backend and the `GetActivity` payload are unchanged. Only the rendering differs:
tab sub-routes (`/library/app/<appid>/tab/<Name>`), its own class modules, and
controller focus. Desktop ships first
([ADR-0016](decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)).

**Serving local images** is settled: `steamloopback.host` is jailed to
`<Steam>/steamui/` and cannot reach `userdata/`, so capture images cross the RPC
boundary as **base64 data URIs**. Thumbnails (~11 KB each) are batched with
`GetAssets`; a full image (~1 MB) is fetched with `GetAsset` only when opened.
`assets.lua` enforces a path allowlist so the RPC cannot become a file reader
([ADR-0017](decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)).

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
