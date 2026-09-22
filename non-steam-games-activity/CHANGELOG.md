# Changelog

All notable changes to **Non-Steam Games Activity**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Non-Steam games now use **Steam's own app detail sections**, not a rebuilt copy
of them. Library grid works. Big Picture's summary strip renders and is
functionally correct, but is **not visually release-ready** — see below. The
per-day activity feed is still in progress — see below.

### Known limits

- **No per-day activity feed yet.** Steam's ACTIVITY section can be restored,
  and its day headings render, but every event body comes back empty: the
  per-event renderer requires a **store** record (`k_DataRequest_Assets`) that
  non-Steam games do not have. That record can be faked with no network call
  (verified live), but wiring it into the plugin's publish/re-render path is
  not done. The Post-Game Summary groups by day in the meantime.
- **Steam's "information is unavailable" box is left in place** on desktop.
  It is still accurate, and it is the only other thing in that column —
  removing it leaves the page blank under the summary.
- **Big Picture's summary strip renders in the wrong container and looks
  broken.** `patch()`'s anchor search resolves to the ACTIVITY tab's own
  *button* in the tab strip, not the content panel below it — the whole
  multi-tile strip gets injected into a small tab-button-sized element.
  Screenshot comparison against native: no "Post-Game Summary" header
  visible, no day grouping, tiles with no spacing, and a native Steam icon
  colliding with the tiles in the same row
  ([ADR-0028](../docs/decisions.md#adr-0028-big-pictures-clone-is-visually-broken-and-the-fix-is-to-go-looking-for-real-components-not-to-keep-patching-the-clone),
  **Proposed**, not fixed). Functionally verified (real captures, real appid
  detection — ADR-0027) but not visually usable yet.
- **Big Picture's summary is a clone, not Steam's real component**, and can
  drift from it on a future Big Picture UI change — see the Added entry below
  and [ADR-0024](../docs/decisions.md#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store).
  This is the opposite trade-off from desktop, and deliberate: Big Picture's
  `CAppDetailsSections`/`CAppSpotlightStore` are objects in a webpack module
  cache this plugin's `SharedJSContext` code cannot reach, confirmed from
  Millennium's own source
  ([ADR-0023](../docs/decisions.md#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one)).
  ADR-0027 narrowed this: `react/jsx-runtime` turns out to be shared between
  the two bundles even though Steam's own app code is not, which is why
  ADR-0028 proposes checking whether `@steambrew/client`'s own components are
  shared too, before writing more hand-tuned clone CSS.
- **"Last Played" stays blank for games Steam did not launch itself.** That
  `AppOverview` field has a custom setter backed by protobuf state and cannot
  be written safely; recent-activity ordering does reflect captures instead
  ([ADR-0018](../docs/decisions.md#adr-0018-write-only-observable-appoverview-fields-and-patch-the-prototype)).

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
- **Backend: `GetActivity`, `GetAsset`, `GetAssets`, `timeline.lua`,
  `assets.lua`, and the recording/protobuf/session-window parsing half of
  `captures.lua`** (~700 lines) — superseded by the `Added` entries above and
  by reading captures straight from Steam's own client APIs. `captures.lua`
  now only parses the screenshot index the library grid needs; `rpc.lua` is
  down to `GetLibraryStats` and `GetDiagnostics`. Everything below this line in
  `Added`/`Fixed` describes the pre-ADR-0022 backend for historical record —
  most of it (recording parsing, the activity timeline, base64 image serving)
  no longer exists in the shipped plugin.

### Added

- **Big Picture support** (`renderers/gamepad-app.tsx`) — a compact Post-Game
  Summary strip in the ACTIVITY tab. Unlike desktop, this *does* build its own
  markup: Big Picture runs in a separate webpack bundle with its own module
  cache (confirmed via Millennium's source, ADR-0023), so there is no Steam
  component to feed. Instead it renders a small clone, styled with class names
  resolved from the desktop bundle (one build-wide stylesheet, so the hashes
  are valid across both), and appends it directly into the Big Picture popup's
  document via `Steam.PopupManager` — no Millennium injection needed for that
  part, confirmed live. Technique matched to what
  [k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes)
  already does for its playtime feature. See
  [ADR-0024](../docs/decisions.md#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store).
- **Big Picture appid detection** (`steam/gamepad-appid.ts`) — knowing which
  game Big Picture is currently showing took three tries (`popup.window.opener
  .location`, wrong; `popup.window.location`, structurally right but Big
  Picture's real navigation never touches any window's `location` at all;
  finally, patching `react/jsx-runtime`'s `jsx`/`jsxs` exports globally via
  `beforePatch` and reading the live `appid` off intercepted element props —
  technique found in
  [BossSloth/SteamHunter-plugin](https://github.com/BossSloth/SteamHunter-plugin)).
  Filtered on `{appid, rgSections}`, verified live to be the one component
  that fires once per navigation with no false positives (a bare `'appid' in
  props` check matches a recommended-games carousel, a friends-playing
  widget, and a page pager — all real, all wrong). See
  [ADR-0025](../docs/decisions.md#adr-0025-watch-the-big-picture-popups-own-location-not-its-openers),
  [ADR-0026](../docs/decisions.md#adr-0026-big-pictures-real-navigation-does-not-touch-location-at-all),
  [ADR-0027](../docs/decisions.md#adr-0027-patch-react-jsx-runtime-to-reach-big-pictures-real-render-pipeline).
- **Provider API** (`registerSummaryProvider`) — provider plugins contribute
  summary *events*, not markup, and a failing provider is skipped rather than
  taking the page down.
- **Signature-based module resolution** (`steam/modules.ts`) — resolves Steam's
  stores and components by prototype method names, never by numeric module id
  (those reshuffle between builds). Extended with `resolveClassMap()` for Big
  Picture's clone-and-hide fallback.

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

Caught live, driving Big Picture through real gamepad-style input (2026-09-21) — the
first time anything had actually exercised these code paths against genuinely rendered
content, not the test suite:

- **Big Picture's ACTIVITY tab anchor never matched.** `patch()` searched for DOM text
  exactly equal to `'ACTIVITY'`, but the real DOM text is `"Activity"` (title case) —
  the visible all-caps is CSS `text-transform: uppercase`, so a case-sensitive match
  could never succeed regardless of anything else being correct. Now matches
  case-insensitively.
- **The same anchor search also lost a timing race.** `watchGamepadAppid`'s signal
  fires from inside React's own element-creation call, before React commits to the real
  DOM, and Big Picture's page-transition animation adds more delay on top. A single
  immediate lookup — and, in an earlier fix attempt, a lookup that gave up on its first
  transient query error rather than retrying — both failed live even though the exact
  same query succeeded when run by hand moments later. `findAnchor()` now polls (~8s
  budget) and only stops early if the window itself is genuinely closed.

### Before release — smoke test

Run against the live Steam client with the plugin installed; every row should
pass before calling v1 done.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Open a non-Steam game with screenshots + a clip (e.g. AM2R) | Post-Game Summary shows them, grouped by day |
| 2 | Open a non-Steam game with **no captures** | Steam's own placeholder shown; no empty panel |
| 3 | Open a **native** Steam game | Plugin does not touch the page at all |
| 4 | Click a screenshot / a clip in the summary | Opens Steam's real media viewer |
| 5 | Play a game, quit, reopen its page | New captures appear without restarting Steam |
| 6 | Library grid | Recent-activity timestamps visible; sorting still works |
| 7 | Restart Steam | Plugin loads clean; no console errors |
| 8 | Disable the plugin | Steam returns to its stock page with no leftovers |
| 9 | **Big Picture** — open a non-Steam game's page | Summary strip shows recent screenshots/clips in the ACTIVITY tab — 🟡 **functionally passed, visually failed, 2026-09-21**: real gamepad-style input, reproduced twice from a clean Steam restart (AM2R, appid `4263274102`), captures do render — but in the wrong container, with no header/spacing/grouping matching native (ADR-0028). Do not mark this row fully passed until ADR-0028 is resolved. |
| 10 | Switch desktop → Big Picture → desktop | Both render correctly; no duplicate/orphaned state — not yet run |

Also confirm: no secrets in logs, and `GetDiagnostics` reports accurate counts
for this install.

Only `clips/` has been observed for recordings; background `video/` is handled
by the same code path but unverified.
