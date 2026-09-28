# Changelog

All notable changes to **Steam Cartridges** (formerly Non-Steam Games Activity).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- **Desktop Game Info Drawer & ⓘ Button Toggle Restoration (2026-09-28)**:
  - PlayBar ⓘ Button Restoration: Restored the native ⓘ ("Show game details" / "Hide game details") button on the desktop PlayBar (`XC` / `be` in module `56262`) for non-Steam shortcuts.
  - Section Filter Optimization: Re-enabled `"info"` in `RESTORED_SECTIONS` and automatically drop the redundant grey shortcut explanation `"nonsteam"` once metadata is populated, letting the native Game Info accordion expand cleanly without warnings.
  - MobX `@observer` Prototype Bypass Resolution: Discovered that Steam decorates class components with MobX's `makeClassComponentObserver`, caching unpatched renders on instance properties. Implemented prototype `props` accessor descriptors (`get`/`set`) across `k`, `targetG`, and `targetPlayBar`, ensuring all MobX reaction renders access a scoped proxy with `BIsModOrShortcut: () => false` without prototype pollution on `AppOverview.prototype`.
  - Dynamic Instance Refresh: Upgraded `refreshGameInfoInstances` to strip stale own-property `props` and force component re-renders when route or metadata state changes.

- **Data Flow & Architecture Remediation (2026-09-28)**:
  - RetroAchievements Schema & Authenticated Matching: Added `User-Agent: RetroArch/1.19.0` to bypass Cloudflare 403 blocks; rewrote `find_game_id_by_title` to support JSON object dictionary responses (`{ ["11336"] = "Alundra" }`); appended credentials `&u=` and `&t=` to `patch_url` to eliminate HTTP 401 `invalid_credentials`; normalized signed int32 `shortcut_appid` in `M.get_or_fetch`.
  - Console Emulators Auto-Mode: Enabled `retroachievements` in Auto-Mode for `console_emulator` category (DuckStation, PCSX2, Dolphin, PPSSPP).
  - Synchronous On-Demand Game Info Enrichment: Fixed signed int32 vs unsigned uint32 AppId lookup mismatch (`appid >>> 0`) in `game-info-patch.ts`, eliminating the grey shortcut explanation `#AppDetails_Shortcut_Explanation` ("Detailed information is unavailable because it is a non-Steam game or mod") and rendering description, developers, publishers, and release date synchronously upon Game Info component mount.
  - Scraper Batch Expansion: Increased `MAX_BATCH_ITEMS` to 100 and decoupled non-fatal scrape errors from premature circuit breaker trips (raised error threshold to 5).

- **Minimal Settings Panel & Modal Overlays (2026-09-27)**:
  - Redesigned settings panel into a clean, minimal UI matching `enhanced-achievements`. Removed all verbose paragraph texts and reduced descriptions to single phrases.
  - Active-only service lists: `{Metadata}` and `{Achievements}` display only active services with `[ Remove ]` buttons.
  - Dynamic `+ Add Service` / `+ Add Source`: automatically hidden when all available services are added; shown when unadded services exist.
  - Popups & modals: registration forms, rule creation, emulator status table, and library audit lists open in clean Steam-themed modal overlays (`SettingsModal`) instead of bloating the main panel.

- **Native Activity Feed Events & Support Link Isolation (2026-09-27)**:
  - Added native activity feed events for non-Steam shortcuts: `{User} added {Game} to their library` (`eEventType = 3`) and `{User} played {Game} for the first time` (`eEventType = 30`).
  - Integrated into daily activity buckets with proper `AppActivityDay` prototypes, `m_rgEvents` sorting, and icon asset hooks.
  - Added settings toggles: `activityShowAddedToLibrary` and `activityShowFirstPlayed` with persistence in Millennium settings.
  - Removed "Support" (*helpwithgame*) link button from the Game Info action bar for non-Steam shortcuts (both mapped and unmapped) to isolate Valve support endpoints.
  - Scoped headline hook so capture headlines show `" captured"` without clobbering native library/play headlines.

- **Settings Panel Redesign: Metadata, Achievements, Rules, and Revision**:
  - Adopted `enhanced-achievements` visual patterns (`PanelSection`, `PanelSectionRow`, `ItemRow`, `Field`, `DialogButton`, `Toggle`, `Dropdown`).
  - `{Metadata}`: Support for Steam Store Mirror, ScreenScraper (with auto-discovered `.env` dev credentials), and Twitch/IGDB credentials, with persistent `.env` storage via `SaveServiceCredentials`.
  - `{Achievements}`: Service cards for Steam Store Mirror, RetroAchievements, and Multi-Emulator status (RPCS3, RetroArch, DuckStation, PCSX2, Dolphin, PPSSPP), Hardcore Mode toggle, and live test toast trigger.
  - `{Rules}`: Rule builder for targeting services with `include`/`exclude` actions against `game_name`, `collection`, and `regex` patterns.
  - `{Revision}`: Game audit counting shortcuts with missing controller support, store mapping, or achievements, with interactive inline fix drawer supporting per-game controller overrides (`full`, `partial`, `none`, `auto`).

- **RPCS3 Local PlayStation 3 Trophies & Multi-Emulator Settings (Phase 5)**:
  - Local offline PlayStation 3 trophy support for RPCS3: parses `TROPCONF.SFM` XML schema (titles, descriptions, Sony trophy types P/G/S/B, hidden status) and `TROPUSR.DAT` binary unlock database (32-byte record stride, timestamps).
  - RPCS3 observer: tails `RPCS3.log` for `{Emu.Trophy} Trophy Unlocked` patterns and directly polls `TROPUSR.DAT` for zero-latency detection.
  - Multi-emulator auto-discovery & authentication: detects credentials and install paths across RetroArch, DuckStation, PCSX2, Dolphin/Primehack, PPSSPP, and RPCS3, plus `.env` fallback detection (`retroachievements_api`).
  - Added `raHardcoreMode: boolean` setting (default `true`), enforcing official RetroAchievements hardcore leaderboard rules and passing `h=1` (hardcore) vs `h=0` (softcore) to unlock queries.
  - Interactive settings panel: live emulator detection table and "Test Retro Toast Notification" button dispatching `cartridges:trigger_fake_achievement`.

- **RetroAchievements & Emulator Observer Engine (Phase 5)**:
  - Integration with RetroAchievements for retro shortcuts (RetroArch, DuckStation, PCSX2).
  - Zero-friction auth: dynamically reads `cheevos_username` and `cheevos_token` from local `retroarch.cfg`.
  - ROM hash extractor (`ra_hasher.js`): zip deflation, SMC copier header stripping, and MD5 computation to identify RetroAchievements `GameID`.
  - Ingests official patch data (badge URLs, titles, descriptions, points) and user unlock history into `achievements.json`.
  - Out-of-process real-time log observer tails `retroarch.log`, `duckstation.log`, and `emulog.txt` for `[RCHEEVOS]` unlock events, triggering native Steam notification toasts and updating Big Picture UI.

- **Native Achievements & Big Picture Full-Screen Page (Phase 5)**:
  - Non-Steam shortcuts mirror native Steam Store achievement schemas (titles, descriptions, icons, global unlock percentages).
  - Out-of-process in-game observers detect achievements in real time from local emulator saves (Goldberg, CODEX, RUNE, GSE) and engine runtime logs (Unity `Player.log`, Godot `godot.log`, Unreal `Saved/Logs`) with zero DLL injection.
  - Feeds Steam's native `NotificationStore.OnNotification` (popup toast + sound chime 5), Post-Game Summary hero banner, desktop library right column, and Big Picture play bar.
  - Hooked `AchievementsFullStore` (module `32179` / `p6`) on prototype methods `LoadMyAchievements`, `GetMyAchievements`, `GetGlobalAchievements`, and `GetPlayerAchievements`. Non-Steam shortcuts navigating to `/routes/library/app/<appid>/achievements/my/individual` render Steam's genuine full-screen achievements page instead of "Failed to load achievement data".
  - Configurable "Local Achievements Enabled" startup notification (`all_runs`, `first_run`, `off`).

- `steam/jsx-hook.ts` (shared with enhanced-achievements): heals within a microtask of any write to `jsx`/`jsxs`, not only on the 5 s timer. Millennium core restores a stale `jsx` whenever a toast window renders, dropping every plugin's patch for up to 5 s (docs/plugins.md § Sharing the jsx runtime). Verified: `scratch/jsx_chain.js` 9/9.

- Steam Store bucket (P3): games in a Steam Store collection get native art and Game Info from an exact, unique title match (known natives, then store search); suggestions and manual appid in settings; Clear removes the match and only the art this plugin wrote.
- Buckets (P2): ordered collection assignments + per-game overrides in one `buckets` config key; Game Info and IGDB lookups now run only for Web Scraping games, and revert live when a collection changes. Settings panel added. **Games need a bucket to keep Game Info.**
- Merged `steamgriddb-artwork` (web metadata, Game Info, artwork RPCs) and renamed to `steam-cartridges`. Data folder `<Steam>/millennium/config/steam-cartridges`; no RPC renamed.

Non-Steam games now use **Steam's own app detail sections** on both Desktop and
Big Picture Mode. Library grid, Post-Game Summary, and chronological per-day
Activity Feed all render natively using Steam's own components and stores.

### Known limits

- **"Last Played" stays blank for games Steam did not launch itself.** That
  `AppOverview` field has a custom setter backed by protobuf state and cannot
  be written safely; recent-activity ordering does reflect captures instead
  ([ADR-0018](../docs/decisions.md#adr-0018-write-only-observable-appoverview-fields-and-patch-the-prototype)).
- **Social interaction chrome is omitted for non-Steam games.** Post comments,
  ratings, and developer announcement feeds require Steam Community / store
  backends that shortcuts lack. Only capture events (screenshots and clips)
  are populated in the activity timeline.

### Changed

- **The post-game summary and activity feed are rendered by Steam itself.**
  Steam was never missing this UI for non-Steam games — it filters it out by
  app type in its section registry (`BIsModOrShortcut() && (s = ["nonsteam",
"notes", "screenshots"])`). The plugin restores `postgamesummary` and
  `activity`, feeds Steam's own stores, and lets Steam draw the carousels,
  day separators, date labels, hover states, and media viewers.
  See [ADR-0022](../docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
  [ADR-0029](../docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning),
  and [ADR-0030](../docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing).
- **Big Picture uses the exact same store-feeding pipeline as Desktop.** Big
  Picture runs directly from `SharedJSContext` via React Portal. Native Post-Game
  Summary (`Ge.T`) and Activity Feed (`ae.W`) render in the "ACTIVITY" tab with
  native controller D-pad navigation, focus rings, and responsive layout.
- **Captures come from Steam's own APIs**, not the backend:
  `SteamClient.Apps.GetScreenshotsInTimeRange` and the recording service's
  `GetClips`. Both work unmodified for a shortcut. Clips need the **64-bit
  gameid** — Steam's own helper truncates it to 32 bits, which is the actual
  reason non-Steam clips never appear natively.
- **No image crosses the RPC boundary** for the detail page. Steam serves its
  own captures over `steamloopback.host` and hands back absolute URLs.
- Steam's "information is unavailable" placeholder is removed by dropping it
  from the section set (`REPLACED_SECTIONS = ['nonsteam']`) only when there
  is content to replace it with — a game with no captures keeps Steam's
  honest explanation instead of gaining an empty panel.

### Removed

- `renderers/gamepad-app.tsx` (~280 lines) — the hand-built Big Picture clone
  is deleted. Native component rendering via `SharedJSContext` supersedes DOM
  cloning completely ([ADR-0029](../docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)).
- `components/` (activity, carousel, media cards, hover, class maps),
  `assets.ts` and `steam-media.ts` — roughly 800 lines of hand-built UI that
  Steam now renders. A resolved Steam component cannot drift from native; a
  hand-built copy can and did.
- **Backend: `GetActivity`, `GetAsset`, `GetAssets`, `timeline.lua`,
  `assets.lua`, and the recording/protobuf/session-window parsing half of
  `captures.lua`** (~700 lines) — superseded by reading captures straight
  from Steam's own client APIs. `captures.lua` now only parses the screenshot
  index the library grid needs; `rpc.lua` is down to `GetLibraryStats` and
  `GetDiagnostics`.

### Added

- **Per-day Activity Feed** (`steam/activity.ts`) — publishes chronological
  captures grouped by local midnight into `appActivityStore`. Stubs an in-memory
  `StoreItem` in `StoreItemCache` to satisfy Steam's event visibility guard
  without network requests, overrides `event.appid` with a 32-bit integer getter
  to prevent IEEE 754 precision loss from 64-bit shortcut gameids, implements
  `CActivityDay` container methods (`GetLatestEventTime`), and registers
  loopback URLs into `workshopStore.m_mapPublishedFiles` for native screenshot
  carousel thumbnails and full viewers ([ADR-0030](../docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing)).
- **Big Picture appid detection** (`steam/gamepad-appid.ts`) — watches
  `react/jsx-runtime` element creation filtered on `{appid, rgSections}` to
  detect Big Picture navigation events reliably ([ADR-0027](../docs/decisions.md#adr-0027-patch-reactjsx-runtime-to-reach-big-pictures-real-render-pipeline)).
- **Provider API** (`registerSummaryProvider`) — provider plugins contribute
  summary _events_, not markup, and a failing provider is skipped rather than
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
  name, so renaming the manifest to `<name>-dev` _after_ building left the
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

| #   | Scenario                                                    | Expected                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open a non-Steam game with screenshots + a clip (e.g. AM2R) | Post-Game Summary shows them, grouped by day                                                                                                                                                                                                                                                                                                                                                             |
| 2   | Open a non-Steam game with **no captures**                  | Steam's own placeholder shown; no empty panel                                                                                                                                                                                                                                                                                                                                                            |
| 3   | Open a **native** Steam game                                | Plugin does not touch the page at all                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | Click a screenshot / a clip in the summary                  | Opens Steam's real media viewer                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | Play a game, quit, reopen its page                          | New captures appear without restarting Steam                                                                                                                                                                                                                                                                                                                                                             |
| 6   | Library grid                                                | Recent-activity timestamps visible; sorting still works                                                                                                                                                                                                                                                                                                                                                  |
| 7   | Restart Steam                                               | Plugin loads clean; no console errors                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | Disable the plugin                                          | Steam returns to its stock page with no leftovers                                                                                                                                                                                                                                                                                                                                                        |
| 9   | **Big Picture** — open a non-Steam game's page              | Summary strip shows recent screenshots/clips in the ACTIVITY tab — 🟡 **functionally passed, visually failed, 2026-09-21**: real gamepad-style input, reproduced twice from a clean Steam restart (AM2R, appid `4263274102`), captures do render — but in the wrong container, with no header/spacing/grouping matching native (ADR-0028). Do not mark this row fully passed until ADR-0028 is resolved. |
| 10  | Switch desktop → Big Picture → desktop                      | Both render correctly; no duplicate/orphaned state — not yet run                                                                                                                                                                                                                                                                                                                                         |

Also confirm: no secrets in logs, and `GetDiagnostics` reports accurate counts
for this install.

Only `clips/` has been observed for recordings; background `video/` is handled
by the same code path but unverified.
