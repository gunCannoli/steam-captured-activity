# non-steam-games-activity

The core plugin. Rebuilds Steam's game activity page for **any** non-Steam game,
using the screenshots and recordings Steam has already captured.

No emulator, no API key, no network. Providers
([architecture](../docs/architecture.md)) add achievements, playtime and artwork
on top of this.

## Status

**Step 1 complete — backend data layer.** Parses real data, fully tested, not yet
wired to any UI.

| Module | Does | State |
| --- | --- | --- |
| `steam_paths.lua` | Find Steam root + active user | ✅ tested |
| `gameid.lua` | appid ↔ 64-bit gameid | ✅ tested |
| `shortcuts.lua` | Parse binary `shortcuts.vdf` | ✅ tested |
| `captures.lua` | Parse `screenshots.vdf` + recordings (`clip.pb`) | ✅ tested |
| `timeline.lua` | Day grouping + post-game summary | ✅ tested |
| `rpc.lua` | Frontend-callable methods | ✅ shape tested |
| `frontend/` | The UI | ❌ not started |

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
| `GetDiagnostics` | `{}` | what the backend can see — use this first |

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
