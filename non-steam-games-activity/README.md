# non-steam-games-activity

The core plugin. Rebuilds Steam's game activity page for **any** non-Steam game,
using the screenshots and recordings Steam has already captured.

No emulator, no API key, no network. Providers
([architecture](../docs/architecture.md)) add achievements, playtime and artwork
on top of this.

## Status

**Phases 1–4 complete.** The activity page renders in the live Steam client:
Steam's grey "information is unavailable" box is replaced by a post-game summary
and a day-grouped activity feed.

On load the plugin logs:

```
Non-Steam Games Activity  Ready. 223 shortcuts, 211 screenshots across 6 non-Steam games.
```

| Module | Does | State |
| --- | --- | --- |
| `steam_paths.lua` | Find Steam root + active user | ✅ tested |
| `gameid.lua` | appid ↔ 64-bit gameid | ✅ tested |
| `shortcuts.lua` | Parse binary `shortcuts.vdf` | ✅ tested |
| `captures.lua` | Parse `screenshots.vdf` + recordings (`clip.pb`) | ✅ tested |
| `timeline.lua` | Day grouping + post-game summary | ✅ tested |
| `assets.lua` | Images as base64 data URIs, path-allowlisted | ✅ tested |
| `rpc.lua` | Frontend-callable methods | ✅ shape tested |
| `frontend/rpc.ts` | Typed client for the backend | ✅ loads in Steam |
| `frontend/assets.ts` | Thumbnail / full-image cache | ✅ built |
| `frontend/index.tsx` | Entry point (diagnostics only) | ✅ loads in Steam |
| `renderers/library-app.tsx` | Injects the page, hides the placeholder | ✅ verified in Steam |
| `components/` | Activity feed, media cards, class resolution | ✅ verified in Steam |
| `styles.ts` | Scoped CSS on Steam's theme variables | ✅ |
| Library grid / Big Picture | Phases 5–6 | ❌ not started |

Recordings are verified against a real 14s clip: the directory name embeds the
gameid, `clip.pb` yields the recorded-at timestamp, duration and resolution, and
`thumbnail.jpg` is a ready-made poster frame. Video is **MPEG-DASH**
(`session.mpd` + `.m4s` chunks), so it cannot be dropped into a `<video>` tag
without an MSE player — the thumbnail is the cheap path for a media card.

## RPC methods

| Method | Payload | Returns |
| --- | --- | --- |
| `GetActivity` | `{ appid }` | media, session-scoped `post_game_summary`, day-grouped `timeline` |
| `GetLibraryStats` | `{}` | `{ "<appid>": { screenshots } }` for the grid |
| `GetAsset` | `{ path }` | one image as a base64 data URI |
| `GetAssets` | `{ paths[], budget? }` | several images (thumbnails) at once |
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

## Tests

Millennium does not ship a standalone Lua, so get one from
[luabinaries](https://luabinaries.sourceforge.net/) and run:

```bash
NSGA_STEAM_ROOT="C:\game\steam" lua tests/test_backend.lua
```

The suite stubs Millennium's `fs`/`utils`/`logger`/`millennium` modules
(`tests/harness.lua`) and runs the **real** backend modules against a **real**
Steam install — no mock data.

`FIXTURE` at the top of `test_backend.lua` records the dev machine's library
(223 shortcuts, 6 games with media, 211 screenshots). On another install those
counts differ; run with `NSGA_SKIP_FIXTURES=1` for invariant checks only.

Current result: **all pass**, matching independently measured values.

## Notes for the next change

- `screenshots.vdf` is **text** VDF; `shortcuts.vdf` is **binary**. Different parsers.
- In `screenshots.vdf`, nesting depth — not key length — distinguishes a game
  from a screenshot index. A Steam appid (`238960`) looks exactly like an index
  (`0`). Getting this wrong silently merges one game's screenshots into another.
- `appid` in `shortcuts.vdf` is a signed int32 used as unsigned; mask before
  converting.
- Lua numbers are doubles, so 64-bit gameids are handled as decimal strings with
  manual limb arithmetic in `gameid.lua`. Do not "simplify" it to `<<` / `|`.
- An RPC method must never return bare `nil` — Millennium tries to parse the
  result as an integer. Return `'null'`.
- In `clip.pb`, a length-delimited protobuf field may be a string *or* a nested
  message; the wire format does not distinguish them. Re-parse only the fields
  known to be messages, or a string's bytes get read as field tags.
- A varint must be fully consumed even when it overflows a Lua double (the
  gameid is 64-bit), or every following field desynchronises.
- The plugin name is **baked into the bundle at build time** and Millennium
  routes RPC by it, so a dev rename must happen *before* building. Renaming
  after leaves the frontend calling `<name>` while the backend is `<name>-dev`,
  and every call fails with "plugin not running".
- Windows PowerShell's `-Encoding UTF8` writes a **BOM**, which breaks strict
  JSON parsers — including Millennium's own `config.json`. Write UTF-8 without
  one via `System.IO.File`.
- `steamloopback.host` **cannot** serve capture images: Millennium resolves it
  against `<Steam>/steamui/` only. Images go over RPC as base64 data URIs, and
  `assets.lua` restricts reads to the capture directories.
