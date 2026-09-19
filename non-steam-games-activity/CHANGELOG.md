# Changelog

All notable changes to **Non-Steam Games Activity**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Backend complete, tested, and verified loading in the live Steam client. No UI
yet, so the plugin does not render anything — not yet releasable.

### Added

- **Steam path discovery** (`steam_paths.lua`) — resolves the Steam root via
  `millennium.steam_path()` and the active user from `loginusers.vdf`
  (`MostRecent`), falling back to the most recently written userdata directory.
  No hardcoded paths.
- **App id conversion** (`gameid.lua`) — converts between the 32-bit `appid` the
  UI uses and the 64-bit `gameid` Steam's capture store is keyed by
  (`gameid = (appid << 32) | 0x02000000`). Lua numbers are doubles and cannot
  hold a gameid exactly, so the arithmetic runs on decimal strings in base-10⁷
  limbs.
- **Shortcut parsing** (`shortcuts.lua`) — reads the binary `shortcuts.vdf` by
  scanning type-tagged fields, extracting appid, name, exe, launch options and
  tags.
- **Screenshot parsing** (`captures.lua`) — reads the text-format
  `screenshots.vdf` index, resolves each entry to an absolute path, and verifies
  the file exists before returning it.
- **Recording parsing** (`captures.lua`) — enumerates `gamerecordings/clips/`,
  reads `clip.pb` with a minimal protobuf reader for recorded-at timestamp,
  duration and resolution, and locates `thumbnail.jpg` and the DASH
  `session.mpd`.
- **Session index** (`captures.lua`) — reads `gamerecording.pb` for play-session
  windows.
- **Activity timeline** (`timeline.lua`) — groups entries into local-time days,
  newest first, plus `post_game_summary()` scoped to the most recent play
  session (matching Steam's own layout) with a newest-day fallback for media
  predating Steam Game Recording.
- **Image serving** (`assets.lua`) — capture images as base64 data URIs, since
  Millennium's `steamloopback.host` interception is jailed to `<Steam>/steamui/`
  and cannot reach `userdata/`. Reads are restricted to the capture directories,
  `..` is rejected, and per-call and per-file size budgets apply. Steam's own
  thumbnails are ~11 KB, so a page of them is ~0.4 MB of JSON; full-size images
  are fetched one at a time on demand.
- **RPC surface** (`rpc.lua`) — `GetActivity`, `GetLibraryStats`, `GetAsset`,
  `GetAssets`, `GetDiagnostics`.
- **Test suite** (`tests/`) — 82 assertions running the real backend modules
  against a real Steam install, with Millennium's modules stubbed. Machine
  specific expectations are isolated in a `FIXTURE` table and can be skipped
  with `NSGA_SKIP_FIXTURES=1`.

- **Plugin scaffold** — `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`,
  and `dev.ps1`, which builds and deploys a parallel `-dev` copy so a released
  build stays installed. Steam is discovered via `-SteamPath`, `$env:STEAM_PATH`,
  the registry, then the default path.
- **Frontend groundwork** — `rpc.ts` (typed client mirroring the Lua RPC surface),
  `assets.ts` (in-memory cache, since base64 data URIs are not browser-cacheable),
  and `index.tsx`, which currently only fetches diagnostics and logs them. It
  never throws out of the load hook: a plugin that fails should leave Steam
  untouched.

### Fixed

Caught by the test suite before any of this ran inside Steam:

- **Screenshots leaking between games.** `screenshots.vdf` block detection used
  key length to tell a game id from a screenshot index, but a Steam appid
  (`238960`) has the same shape as an index (`0`). AM2R reported **222**
  screenshots instead of 2. Block type is now determined by brace depth.
- **Recording metadata reading as zero.** The protobuf reader recursed into every
  length-delimited field, but the wire format does not distinguish a nested
  message from a string — the timeline name was parsed as a message and
  desynchronised the rest. Only known-message fields are re-parsed now.
- **Fields after a 64-bit id being misread.** The varint reader stopped early on
  values too large for a Lua double, leaving the byte offset mid-value. It now
  consumes the whole varint and returns nil for the value.
- **Every RPC call failing with "plugin not running".** The builder bakes
  `plugin.json`'s `name` into the bundle and Millennium routes RPC by that baked
  name, so renaming the manifest to `<name>-dev` *after* building left the
  frontend calling one name and the backend registered under another. `dev.ps1`
  now renames before building and restores the source manifest afterwards.
- **A BOM corrupting Millennium's config.** `dev.ps1` used PowerShell's
  `-Encoding UTF8`, which prepends a byte-order mark that breaks strict JSON
  parsers. It now writes UTF-8 without a BOM.
- **Native-game recordings being missed.** Clips for native Steam games are keyed
  by the raw appid (`clip_435150_…`), not the composed gameid used for non-Steam
  games. The lookup now picks the id form by app type and anchors the match
  between underscores, so `435150` cannot match `4351501`.

### Known limitations

- No frontend — nothing renders in Steam yet.
- Recordings are MPEG-DASH, so they cannot play in a plain `<video>` element.
- Big Picture is not implemented (ADR-0016).
- Only `clips/` has been observed; background `video/` recordings are handled by
  the same code but unverified.
