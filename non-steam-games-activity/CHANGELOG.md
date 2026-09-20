# Changelog

All notable changes to **Non-Steam Games Activity**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Non-Steam games now use **Steam's own app detail sections**, not a rebuilt copy
of them. Library grid works; the per-day activity feed and Big Picture are still
to come.

### Changed

- **The post-game summary is now rendered by Steam itself.** Steam was never
  missing this UI for non-Steam games — it filters it out by app type in its
  section registry (`BIsModOrShortcut() && (s = ["nonsteam", "notes",
  "screenshots"])`). The plugin restores the section and feeds Steam's own
  `CGamePlaySession`; Steam draws the pager, day separators, date labels
  ("Today"/"Yesterday"/"Sep 20"), hover states and media viewer.
  See [ADR-0022](../docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)
  and [steam-components.md](../docs/steam-components.md).
- **Captures come from Steam's own APIs**, not the backend:
  `SteamClient.Apps.GetScreenshotsInTimeRange` and the recording service's
  `GetClips`. Both work unmodified for a shortcut. Clips need the **64-bit
  gameid** — Steam's own helper truncates it to 32 bits, which is the actual
  reason non-Steam clips never appear natively.
- **No image crosses the RPC boundary** for the detail page. Steam serves its
  own captures over `steamloopback.host` and hands back absolute URLs.
- Steam's "information is unavailable" placeholder is removed by dropping it
  from the section set rather than hiding the node with CSS, and only when
  there is content to replace it with — a game with no captures keeps Steam's
  honest explanation instead of gaining an empty panel.

### Removed

- `components/` (activity, carousel, media cards, hover, class maps),
  `assets.ts` and `steam-media.ts` — roughly 800 lines of hand-built UI that
  Steam now renders. A resolved Steam component cannot drift from native; a
  hand-built copy can and did.

### Added

- **Provider API** (`registerSummaryProvider`) — provider plugins contribute
  summary *events*, not markup, and a failing provider is skipped rather than
  taking the page down.
- **Signature-based module resolution** (`steam/modules.ts`) — resolves Steam's
  stores and components by prototype method names, never by numeric module id
  (those reshuffle between builds).

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

- **The activity page** — a session-scoped post-game summary above a day-grouped
  activity feed, mirroring the layout Steam uses for its own games. Steam's grey
  "information is unavailable" placeholder is hidden while the plugin is active
  and restored on teardown.
- **Media cards** — screenshot thumbnails and recording poster frames with
  duration badges. Thumbnails are batched over one RPC call per page; full-size
  images load only when opened.
- **Runtime class resolution** (`components/classes.ts`) — Steam's hashed CSS
  module names are looked up at runtime, never hardcoded, so the UI survives
  client updates.
- **Refresh on quit** — closing a game clears the asset cache and re-renders any
  open page for it, so new captures appear without restarting Steam.

- **Library grid enrichment** — non-Steam games with screenshots now carry a
  recent-activity timestamp derived from their newest capture, so Steam's own
  sorting and date labels work for games it has no play record of. Timestamps
  only ever move forward.

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

- Recording playback is not implemented; clicking a clip logs its path.
- The "Last Played" column stays blank for games Steam did not launch itself:
  that field has a custom setter backed by protobuf state and cannot be written
  safely. Recent-activity ordering does reflect captures.
- Recordings are MPEG-DASH, so they cannot play in a plain `<video>` element.
- Big Picture is not implemented (ADR-0016).
- Only `clips/` has been observed; background `video/` recordings are handled by
  the same code but unverified.
