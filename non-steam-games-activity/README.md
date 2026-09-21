# non-steam-games-activity

The core plugin. Gives **any** non-Steam game the app detail page Steam already
knows how to draw — using the screenshots and recordings Steam has already
captured.

No emulator, no API key, no network. Providers
([architecture](../docs/architecture.md)) add achievements, playtime and artwork
on top of this.

## How it works

**On desktop, it does not build UI.** Steam has the components; it hides them
from shortcuts and never loads their data. Steam's app-details section
registry swaps the full section list for a three-item one:

```js
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"])
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
Decision: [ADR-0022](../docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them).

**Big Picture is different, and does build its own UI.** It runs in a
separate webpack bundle with its own module cache — the section-feeding
technique above has no `CAppSpotlightStore` to reach from there. Instead,
`renderers/gamepad-app.tsx` renders a small clone of the summary (styled with
real Steam class names, resolved from the desktop bundle since the CSS itself
is shared) and appends it directly into the Big Picture popup's document via
`Steam.PopupManager` — a live cross-window `Window`/`document` reference that
needs no Millennium injection. Decision:
[ADR-0024](../docs/decisions.md#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store).

## Status

Post-game summary and library grid work in the live client. Verified from a
clean Steam start:

| Case | Result |
| --- | --- |
| AM2R (4 screenshots + 3 clips) | 7 tiles, native panel, placeholder gone |
| A shortcut with no captures | Steam's own placeholder kept, no empty panel |
| Divinity: Original Sin 2 (native) | unaffected |

On load the plugin logs:

```
Non-Steam Games Activity  Ready. Non-Steam games now use Steam's own detail sections.
```

| Module | Does | State |
| --- | --- | --- |
| `steam/modules.ts` | Steam's webpack cache; resolve by signature, incl. class maps | ✅ verified in Steam |
| `steam/sections.ts` | Restore the sections Steam hides | ✅ verified in Steam |
| `steam/summary.ts` | Feed `CGamePlaySession`; provider API | ✅ verified in Steam |
| `steam/stores.ts` | Typed store/service/payload shapes | ✅ verified in Steam |
| `steam/gameid.ts` | appid ↔ 64-bit gameid (BigInt) | ✅ matches real folders |
| `renderers/library-app.tsx` | Publish/clear per app (desktop) | ✅ verified in Steam |
| `renderers/gamepad-app.tsx` | Clone-and-hide summary strip (Big Picture) | 🧪 implemented, awaiting smoke test |
| `renderers/library-home.tsx` | Patch `AppOverview` so the grid sorts | ✅ verified in Steam |
| `steam_paths.lua` | Find Steam root + active user | ✅ tested |
| `shortcuts.lua` | Parse binary `shortcuts.vdf` | ✅ tested |
| `captures.lua` | Parse `screenshots.vdf` (grid counts) | ✅ tested |
| `gameid.lua` | appid ↔ gameid, decimal limbs | ✅ tested |
| `rpc.lua` | `GetLibraryStats`, `GetDiagnostics` | ✅ shape tested |
| Activity feed (per-day list) | In progress — see below | ⚠ |

### The per-day activity feed (in progress)

Steam's ACTIVITY section can be restored the same way the summary was, and its
day headings render correctly ("Yesterday", "Oct 24, 2025"). Every **event
body** comes back empty, because the per-event renderer starts with:

```js
if (appid && (!storeApp || !storeApp.BIsVisible())) return null;
```

`storeApp` is a **store** record, and a non-Steam game has none.

That record turns out to be fakeable with no network call — `GetStoreItem` is a
pure map read and `BIsVisible()` a plain field, so an object built with
`Object.create` and inserted into the store's map satisfies the guard. Verified
live. What remains is wiring it through the plugin's existing re-render path,
and deciding whether injecting into Steam's shared store cache is acceptable.

Steps and the risk note are in [TASK.md](../TASK.md).

Until then the section stays off, and Steam's own "information is unavailable"
box is left in place: it is accurate, and at normal window widths it is the only
other thing in that column — removing it just leaves the page blank below the
summary.

### Why the backend is small

It used to assemble the whole page: `GetActivity` built a session-scoped
summary from `clip.pb` protobuf and `gamerecording.pb`, and `GetAsset`/
`GetAssets` shipped images across as base64. Steam's own APIs replaced all of
it, so those methods, `timeline.lua`, `assets.lua` and the recording parsers
were removed. They are in git history if anything needs them back.

What remains is the one thing Steam genuinely does not have: evidence a
shortcut was played, for games Steam never launched itself.

## RPC methods

| Method | Payload | Returns |
| --- | --- | --- |
| `GetLibraryStats` | `{}` | `{ "<appid>": { screenshots, newest } }` for the grid |
| `GetDiagnostics` | `{}` | what the backend can see — use this first |

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
[docs/steam-components.md § Reproducing this](../docs/steam-components.md#reproducing-this-the-inspection-method).

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
  routes RPC by it, so a dev rename must happen *before* building. Renaming
  after leaves the frontend calling `<name>` while the backend is `<name>-dev`,
  and every call fails with "plugin not running".
- Windows PowerShell's `-Encoding UTF8` writes a **BOM**, which breaks strict
  JSON parsers — including Millennium's own `config.json`. Write UTF-8 without
  one via `System.IO.File`.
- `steamloopback.host` cannot serve **our** files: Millennium resolves it
  against `<Steam>/steamui/` only. That is why `assets.lua` existed. It does not
  stop us using the URLs **Steam itself** hands out for its own captures, which
  is what the detail page now does.
