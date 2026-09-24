# steam-cartridges

The core plugin (formerly `non-steam-games-activity`, merged with `steamgriddb-artwork` in P1, ADR-0032). Gives **any** non-Steam game the app detail page Steam already
knows how to draw — using the screenshots and recordings Steam has already
captured.

No emulator, no API key, no network. Providers
([architecture](../docs/millennium-architecture.md)) add achievements, playtime and artwork
on top of this.

## Metadata and artwork (ex steamgriddb-artwork)

The `features/game-info` module enriches Steam's Game Info tab for shortcuts
(IGDB metadata, cached in `library_metadata.json`), and the backend exposes
`GetArtworkForGame` for SteamGridDB. Credentials live in the plugin data folder
`<Steam>/millennium/config/steam-cartridges/.env` (keys `twitch_client_id`,
`twitch_client_secret`, `steamgriddb_api`; never commit values). On first start
`migrate.run()` copies any legacy credentials and `<Steam>/library_metadata.json`
there; originals are left in place.

## How it works

**On desktop, it does not build UI.** Steam has the components; it hides them
from shortcuts and never loads their data. Steam's app-details section
registry swaps the full section list for a three-item one:

```js
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
```

So the plugin does two things and Steam does the rest:

1. **Restores the section** — puts `postgamesummary` back, and removes
   `nonsteam` (Steam's grey "information is unavailable" box) once there is
   content to replace it with.
2. **Feeds Steam's own store** — pushes captures into `CGamePlaySession`.
   Steam renders the pager, day separators, `Today`/`Yesterday` labels, hover
   states and the media viewer.

Captures come from Steam's own APIs, which work unmodified for a shortcut:
`SteamClient.Apps.GetScreenshotsInTimeRange` and the recording service's
`GetClips`. Steam serves both over `steamloopback.host`, so **no image crosses
the RPC boundary** for this page.

Full trace: [docs/steam-components.md](../docs/steam-components.md).
Decisions: [ADR-0022](../docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
[ADR-0029](../docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning),
and [ADR-0030](../docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing).

**Big Picture uses the exact same store-feeding architecture.** Big Picture
does not run in an isolated bundle — its popup window is mounted directly from
`SharedJSContext` via `ReactDOM.createPortal`. The underlying section registry
and stores (`appSpotlightStore`, `appActivityStore`, `StoreItemCache`) are identical.
Feeding them automatically renders Steam's native components in Big Picture's
"ACTIVITY" tab, complete with controller D-pad navigation, focus rings, and
native media carousels.

## Status

Post-game summary, per-day activity feed, and library grid work in the live client.
Verified from a clean Steam start:

| Case                              | Result                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| AM2R (4 screenshots + 3 clips)    | Native summary carousel + 2-day activity feed, placeholder gone |
| A shortcut with no captures       | Steam's own placeholder kept, zero errors                       |
| Divinity: Original Sin 2 (native) | Unaffected                                                      |

On load the plugin logs:

```
Non-Steam Games Activity  Ready. Non-Steam games now use Steam's own detail sections.
```

| Module                       | Does                                                           | State                   |
| ---------------------------- | -------------------------------------------------------------- | ----------------------- |
| `steam/modules.ts`           | Steam's webpack cache; resolve by signature                    | ✅ verified in Steam    |
| `steam/sections.ts`          | Restore sections (`postgamesummary`, `activity`)               | ✅ verified in Steam    |
| `steam/summary.ts`           | Feed `CGamePlaySession`; provider API                          | ✅ verified in Steam    |
| `steam/activity.ts`          | Feed `CAppActivityStore`, stub `StoreItemCache`, workshop URLs | ✅ verified in Steam    |
| `steam/stores.ts`            | Typed store/service/payload shapes & resolvers                 | ✅ verified in Steam    |
| `steam/gameid.ts`            | appid ↔ 64-bit gameid (BigInt)                                 | ✅ matches real folders |
| `renderers/library-app.tsx`  | Publish/clear per app (Desktop & Big Picture)                  | ✅ verified in Steam    |
| `renderers/library-home.tsx` | Patch `AppOverview` so the grid sorts                          | ✅ verified in Steam    |
| `steam_paths.lua`            | Find Steam root + active user                                  | ✅ tested               |
| `shortcuts.lua`              | Parse binary `shortcuts.vdf`                                   | ✅ tested               |
| `captures.lua`               | Parse `screenshots.vdf` (grid counts)                          | ✅ tested               |
| `gameid.lua`                 | appid ↔ gameid, decimal limbs                                  | ✅ tested               |
| `rpc.lua`                    | `GetLibraryStats`, `GetDiagnostics`                            | ✅ shape tested         |

### The per-day activity feed

Steam's native `activity` section is restored alongside `postgamesummary`.
The per-event renderer (`module 80478`) requires a store record (`lt()`), 32-bit
`event.appid` resolution without float truncation, and `CActivityDay` container
methods (`GetLatestEventTime`).

`steam/activity.ts` satisfies these directly in memory without network access:

- Injects an in-memory `StoreItem` stub into `StoreItemCache.m_mapApps`
- Forces an exact 32-bit integer getter on `event.appid`
- Implements `GetLatestEventTime()`, `SortEvents()`, and local midnight grouping on days
- Registers loopback URLs into `workshopStore.m_mapPublishedFiles`
- Drops the stock `nonsteam` placeholder box when captures exist (`REPLACED_SECTIONS`)

### Why the backend is small

It used to assemble the whole page: `GetActivity` built a session-scoped
summary from `clip.pb` protobuf and `gamerecording.pb`, and `GetAsset`/
`GetAssets` shipped images across as base64. Steam's own APIs replaced all of
it, so those methods, `timeline.lua`, `assets.lua` and the recording parsers
were removed. They are in git history if anything needs them back.

What remains is the one thing Steam genuinely does not have: evidence a
shortcut was played, for games Steam never launched itself.

## RPC methods

| Method            | Payload | Returns                                               |
| ----------------- | ------- | ----------------------------------------------------- |
| `GetLibraryStats` | `{}`    | `{ "<appid>": { screenshots, newest } }` for the grid |
| `GetDiagnostics`  | `{}`    | what the backend can see — use this first             |

## Develop

```bash
pnpm install
pnpm check                  # tsc --noEmit
pnpm build                  # production bundle
pnpm dev                    # build + deploy to Steam + restart
```

`dev.ps1` deploys a parallel `-dev` copy so a released build stays installed. It
discovers Steam via `-SteamPath` → `$env:STEAM_PATH` → registry → default, and
takes `-Pnpm <path>`, `-NoRestart` (frontend-only changes need just `Ctrl+R` in
the devtools) and `-SkipBuild`.

Backend changes need a Steam restart. Run Steam with `-dev` for CEF devtools on
`http://localhost:8080`.

## Inspecting Steam's own UI

Before writing any component, check whether Steam already has one. The method,
the CDP harness and the traps are in
[docs/steam-debug.md § 3 The inspection method](../docs/steam-debug.md#3-the-inspection-method).

## Tests

Millennium does not ship a standalone Lua, so get one from
[luabinaries](https://luabinaries.sourceforge.net/) and run:

```bash
NSGA_STEAM_ROOT="C:\game\steam" lua tests/test_backend.lua
```

The suite stubs Millennium's `fs`/`utils`/`logger`/`millennium` modules
(`tests/harness.lua`) and runs the **real** backend modules against a **real**
Steam install — no mock data.

`FIXTURE` at the top of `test_backend.lua` records the dev machine's library.
On another install those counts differ; run with `NSGA_SKIP_FIXTURES=1` for
invariant checks only.

The frontend has no unit tests on purpose: it is almost entirely calls into
Steam's live internals, which a mock would not exercise meaningfully. It is
verified against the running client instead — see the Status table.

## Notes for the next change

**On reusing Steam's UI** (the important ones):

- **Look before you build.** Steam hides sections from non-Steam games by app
  type, not by capability. A "missing" feature is usually a filter.
- **Resolve by prototype signature, never by numeric module id.** Ids reshuffle
  between builds; method names survive minification.
- **`GetSections` returns its memo, not the set it just built**, and compares
  that cache **by size alone**. Mutate the returned set in place, and refresh
  the memo — a swap that keeps the count identical is otherwise ignored.
- Publishing is async, so the first render precedes the data. The section patch
  tracks live component instances and forces a re-render.
- Steam's own gameid helper **truncates a shortcut's gameid to 32 bits**, which
  is the real reason non-Steam clips never appear natively. Ask the recording
  service with the full 64-bit value.

**On Steam's data formats** (still true, still bites):

- `screenshots.vdf` is **text** VDF; `shortcuts.vdf` is **binary**. Different
  parsers.
- In `screenshots.vdf`, nesting depth — not key length — distinguishes a game
  from a screenshot index. A Steam appid (`238960`) looks exactly like an index
  (`0`). Getting this wrong silently merges one game's screenshots into another.
- `appid` in `shortcuts.vdf` is a signed int32 used as unsigned; mask before
  converting.
- Lua numbers are doubles, so 64-bit gameids are handled as decimal strings with
  manual limb arithmetic in `gameid.lua`. Do not "simplify" it to `<<` / `|`.
  (The frontend uses `BigInt` and can.)

**On Millennium**:

- An RPC method must never return bare `nil` — Millennium tries to parse the
  result as an integer. Return `'null'`.
- The plugin name is **baked into the bundle at build time** and Millennium
  routes RPC by it, so a dev rename must happen _before_ building. Renaming
  after leaves the frontend calling `<name>` while the backend is `<name>-dev`,
  and every call fails with "plugin not running".
- Windows PowerShell's `-Encoding UTF8` writes a **BOM**, which breaks strict
  JSON parsers — including Millennium's own `config.json`. Write UTF-8 without
  one via `System.IO.File`.
- `steamloopback.host` cannot serve **our** files: Millennium resolves it
  against `<Steam>/steamui/` only. That is why `assets.lua` existed. It does not
  stop us using the URLs **Steam itself** hands out for its own captures, which
  is what the detail page now does.
