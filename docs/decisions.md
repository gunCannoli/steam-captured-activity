# Decisions

Architecture decision records. Each captures *why* a choice was made, what was
rejected, and what it costs — so a future reader (human or agent) does not silently
undo it.

Format: Context → Decision → Consequences. Newest ADRs go at the bottom.
To reverse one, write a new ADR that supersedes it rather than editing history.

Status legend: **Accepted** · **Proposed** · **Superseded**

---

## ADR-0001: Build on Millennium rather than a Steam skin or external app

**Status:** Accepted · 2026-09-19

### Context

The goal is a richer app detail page for non-Steam games. (This ADR was written when
the scope was retro games specifically; the framework choice is unaffected by the
widening in [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).)
Options:

1. A **Millennium plugin** — code runs inside Steam's UI with access to its React tree.
2. A **custom skin / CSS theme** — styling only, cannot add data.
3. An **external companion app** — a separate window showing the same info.

### Decision

Build a Millennium plugin.

### Consequences

- We can inject real React components into Steam's own pages and reuse its components,
  class names, formatters and translations — the result looks native, which is the
  entire point of the feature.
- We get a supported backend with filesystem and network access, which a skin cannot have.
- Cost: we are coupled to Steam's internal, unversioned UI. Client updates can break
  patches. Mitigated by [ADR-0005](#adr-0005-render-into-steams-own-dom-via-resolved-class-modules).
- Cost: users must install Millennium. Already true here (v3.4.1 is installed).

---

## ADR-0002: LuaJIT backend, not Python

**Status:** Accepted · 2026-09-19

### Context

Millennium historically documented a Python backend; much of the public documentation
still shows `backend/main.py`. Current plugins use LuaJIT with `"backendType": "lua"`.

Evidence from this machine: the installed `achievement-groups` plugin and the reference
`steam-non-steam-playtimes` plugin are **both** Lua, with no Python anywhere. Lua avoids
shipping or depending on a Python environment.

### Decision

Write the backend in LuaJIT. Set `"backendType": "lua"` in `plugin.json`.

### Consequences

- Matches every current plugin in the ecosystem; examples we can copy are Lua.
- No interpreter bundling, no virtualenv, faster startup, smaller distribution.
- Cost: a smaller standard library. We vendor `_lib/` helpers (`json`, `fs`, `http`,
  `logger`, `millennium`, `utils`, `datetime`), following the installed plugin's layout.
- Cost: `plugin.json`'s published schema does not yet list `backendType`, so editors may
  flag it. Accepted — every shipping plugin sets it.

---

## ADR-0003: Join Steam shortcuts to RetroArch data via the parsed ROM path

**Status:** Accepted · 2026-09-19

### Context

Steam identifies a shortcut by `AppName` and a generated `appid`. RetroArch identifies
everything by ROM filename. These differ: Steam shows `Zombies Ate My Neighbors`,
RetroArch uses `Zombies Ate My Neighbors (USA)`. Matching on display name would need
fuzzy logic at the very foundation of the plugin.

But `shortcuts.vdf` stores each shortcut's full launch command, which contains the
literal ROM path.

Candidate keys:

1. **Parsed ROM path from `Exe`** — exact, already present.
2. **Fuzzy display-name matching** — lossy, ambiguous for arcade ROMs.
3. **CRC32 from playlists** — exact in principle, but the playlists here have
   `crc32: "00000000|crc"` (unpopulated), so it is unavailable.
4. **Ask the user to map every game** — unusable at 210 games.

### Decision

Parse `Exe` from `shortcuts.vdf`, extract the quoted ROM path and the `-L <core>`
argument, and use the **ROM basename** (filename without extension) as the primary key
for all RetroArch-side lookups.

Measured on this library: **210/210** shortcuts parsed, **100%** of screenshots joined,
21/22 runtime logs joined (the miss is a stale log from a pre-rename filename).

### Consequences

- The Steam↔RetroArch link is exact and needs no heuristics or user input.
- The same key works for screenshots, runtime logs and playlist labels simultaneously.
- We also get the core name for free, which gives us the platform.
- Cost: breaks if a user renames or moves a ROM without updating the shortcut. That
  also breaks the shortcut itself, so it is self-evident to the user.
- Cost: only covers shortcuts that launch `retroarch.exe`. Direct-exe shortcuts (AM2R
  here) are simply not this provider's concern — under
  [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins) the
  `retroarch` provider returns `unsupported` and the core still renders a full page.

> **Scope note:** this ADR predates the core/provider split and originally made the ROM
> path *the* foundation of the plugin. It now describes the `retroarch` provider only.
> The core joins Steam to its own captures by exact arithmetic instead — see
> [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).

---

## ADR-0004: Backend owns all I/O and merging; the frontend only renders

**Status:** Accepted · 2026-09-19

### Context

The frontend runs in Chromium's sandbox — no filesystem, and cross-origin HTTP is
constrained. It *could* still make some API calls directly, which would cut an RPC hop.

### Decision

All disk reads, all HTTP, all caching and all merging happen in the backend. The
frontend calls `GetActivity(appid)` and renders the returned payload.

### Consequences

- One cache, one set of path logic, one source of truth. The RA API key never enters
  the renderer process.
- The frontend is easy to reason about and cheap to re-render.
- Cost: everything crosses a JSON string boundary, so payloads should stay lean — send
  a computed timeline, not raw source dumps.
- Cost: an extra hop of latency, which caching makes irrelevant.

---

## ADR-0005: Render into Steam's own DOM via resolved class modules

**Status:** Accepted · 2026-09-19

### Context

Steam's CSS class names are build-hashed and change between client versions. Three ways
to put UI on the page:

1. **Fork Steam's React components** — brittle, and duplicates their styling.
2. **Inject custom markup with our own CSS** — visibly foreign; will not match a restyle.
3. **Render into Steam's containers using classes resolved at runtime** via
   `findClassModule`, plus Steam's own formatters via `findModuleExport`.

### Decision

Option 3. Resolve class names and formatters at runtime; never hardcode a hashed class
string. Borrow `Steam.LocalizationManager.LocalizeString` for all labels.

```ts
const PlayBar = findClassModule((m) => m.GameStat) as Record<string, string>;
const formatDuration = findModuleExport((e) => e?.toString?.()?.includes('"#Played_"'));
```

### Consequences

- The UI inherits Steam's fonts, spacing, colors, date formats and translations, and
  follows future restyles automatically.
- Survives class-hash changes across client builds.
- Cost: `findModuleExport` predicates match on source text, so they can break if Steam
  changes a literal. Every lookup must have a null-guard and a graceful fallback.
- Cost: a component is only as stable as the container it renders into. Prefer patching
  data over DOM where possible ([ADR-0009](#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).

---

## ADR-0006: Build the timeline from `DateEarned`, not per-day queries

**Status:** Accepted · 2026-09-19

### Context

We need achievements grouped by date. RetroAchievements offers:

- `API_GetAchievementsEarnedOnDay.php?u&d=YYYY-MM-DD` — one call **per day**, all games.
- `API_GetGameInfoAndUserProgress.php?u&g=<id>` — one call **per game**, returning every
  achievement with a `DateEarned` when earned.

There is no `GetAchievementsEarnedBetween` endpoint. Covering a year of history with
per-day calls would be 365 requests for one page view.

### Decision

Use `GetGameInfoAndUserProgress` — one request per game — and derive the timeline by
bucketing `DateEarned` values locally.

### Consequences

- One HTTP request per game page instead of one per day. Kind to a donation-funded API.
- The same response also gives locked achievements, badges, points and completion
  percentage — everything the achievements panel needs, from one call.
- Client-side date bucketing means we control grouping and timezone handling.
- Cost: a *cross-game* "everything I did on this date" view would need a different
  source. Out of scope for v1; `GetAchievementsEarnedOnDay` remains available for it.

---

## ADR-0007: Cache RetroAchievements responses on disk

**Status:** Accepted · 2026-09-19

### Context

RetroAchievements is free and community-funded. Steam fires `OnAppOverviewChange` in
large batches, and users navigate between library pages rapidly. Naive fetching would
produce request storms against a volunteer-run service.

### Decision

Cache every RA response to `cache/ra/<gameid>.json` with a fetched-at timestamp. Serve
from cache first and refresh in the background. Send a descriptive `User-Agent`
identifying the plugin and version. Never poll on a timer.

Invalidate when the user **quits a game** (`onAppLaunch`'s `onQuit`) — that is precisely
when new unlocks exist — plus a TTL as a backstop.

### Consequences

- Pages render instantly from cache; the API is hit roughly once per play session.
- The plugin works offline, showing last-known data.
- Cost: data can be briefly stale. Acceptable — and the quit trigger covers the case
  users actually notice.
- Cost: cache invalidation logic to maintain. Mitigated by having exactly one writer.

---

## ADR-0008: Resolve ROM→GameID by cached history first, manual override last

**Status:** Accepted · 2026-09-19

### Context

ROM basename → RetroAchievements `GameID` is the one link with no exact local key.
`Chrono Trigger (USA)` is guessable; `xmvsf`, `kof98` and `dmnfrnt` are not. Guessing
wrong is worse than not guessing: it would show a stranger's achievements on your game.

RetroAchievements identifies games by ROM **hash**. Hashing locally is possible in
principle but each system has its own hashing rules (headers skipped, discs handled
specially, archives unpacked) — a large amount of work to reimplement correctly.

### Decision

Resolve in this order, stopping at the first hit:

1. **Manual override** (`overrides.json`) — always wins.
2. **Learned map** — any mapping previously confirmed.
3. **User history** — fuzzy-match the ROM basename against titles from
   `GetUserRecentlyPlayedGames`, after stripping region/revision tags
   (`(USA)`, `(En,Ja)`, `(Rev 1)`, `(v1.00)`).
4. **Unresolved** — show playtime and manual screenshots, plus a "link this game"
   action. **Never guess silently.**

Anything resolved at step 3 or 4 is written back to the learned map.

### Consequences

- High precision: matching against games the user has *actually played* on RA is a
  small, relevant candidate set, not the whole database.
- Self-improving — each manual link is permanent.
- Honest failure: an unresolved game degrades visibly instead of showing wrong data.
- Cost: arcade and heavily-hacked ROMs usually need one manual link each.
- Cost: we do not support games the user has never launched with cheevos enabled.
  Acceptable — those have no achievement data to show anyway.
- Future option: implement RA's per-system hashing to resolve exactly. Would supersede
  steps 3–4. Deferred as a large, system-specific effort.

---

## ADR-0009: Prefer patching Steam's data over patching its DOM

**Status:** Accepted · 2026-09-19

### Context

To make playtime appear in the library grid, we can either mutate rendered DOM nodes or
patch the store method that feeds them. The reference plugin patches
`Steam.CollectionStore.OnAppOverviewChange` and writes
`minutes_playtime_forever` / `rt_last_time_played` onto app overview objects.

### Decision

Where Steam already has a field for what we want to show, patch the **data** and let
Steam render. Fall back to DOM rendering only for UI Steam has no data model for (the
activity timeline, the achievements panel).

Avoid patching hot generic methods. The reference plugin's `Array.prototype.map` patch
for the properties dialog is explicitly a last resort — and even it waits for
`Steam.MainWindowBrowserManager` first, cutting calls from ~15,000 to ~700 at startup.

### Consequences

- Sorting, filtering and grid rendering all work natively, because Steam believes the
  data is its own.
- Far fewer breakages from UI restructuring — data shapes change less often than markup.
- Cost: constrained to fields Steam already models.
- Cost: patching shared stores demands care — always `unpatch` on unload, and never
  patch a hot path without a cheap early-out guard.

---

## ADR-0010: Every data source degrades independently

**Status:** Accepted · 2026-09-19

### Context

The page draws on five sources: `shortcuts.vdf`, `retroarch.cfg`, runtime logs,
screenshots, and the RA API. Any of them can be missing — no API key, offline,
unresolved GameID, runtime logging disabled, RetroArch moved.

The failure we are replacing is *the blank page*. Reproducing it on a partial failure
would be a poor outcome.

### Decision

Treat each source as optional. Render whatever is available; never let one failure
blank the page. Each degraded state names what is missing and how to fix it.

### Consequences

- The plugin is useful on first run, before any configuration: playtime and screenshots
  come from local files alone.
- Errors are actionable rather than silent.
- Cost: more branches in the render path and more states to test.
- Cost: partial pages could confuse. Mitigated by explicit inline status, never an
  empty section.

---

## ADR-0011: Do not hardcode Steam or RetroArch paths

**Status:** Accepted · 2026-09-19

### Context

This machine uses non-default locations: Steam at `C:\game\steam` (not
`C:\Program Files (x86)\Steam`) and RetroArch portable at `C:\emu\RetroArch` (not
`%APPDATA%\RetroArch`). The reference plugin's `dev.ps1` hardcodes the default Steam
path and would silently deploy to a directory that does not exist here.

RetroArch's portable config compounds this: `retroarch.cfg` uses `:\` to mean "the
RetroArch install directory", so `":\screenshots"` is meaningless without knowing the root.

### Decision

Discover paths; never assume. Resolve Steam's root from Millennium's own runtime
context, and RetroArch's from the shortcut's `Exe` (which contains the full path to
`retroarch.exe`). Always expand the `:\` prefix against the discovered RetroArch root.
Allow explicit user overrides in settings. `dev.ps1` takes the Steam path as a
parameter or env var with the default only as a fallback.

### Consequences

- Works for portable installs, non-default drives, and multi-library setups.
- RetroArch's location comes free from [ADR-0003](#adr-0003-join-steam-shortcuts-to-retroarch-data-via-the-parsed-rom-path)'s parse — no extra discovery.
- Cost: more upfront path-resolution code than a constant.
- Cost: a user with no RetroArch shortcuts has no discovery source. Handled by the
  settings override and a dormant plugin state.

---

## ADR-0012: Split into a core plugin and optional provider plugins

**Status:** Accepted · 2026-09-19 · **Supersedes the monolithic scope of ADR-0001**

### Context

The original design made RetroArch and RetroAchievements structural: the plugin was
*for* retro games, and a game we could not resolve to a ROM got nothing. Two problems
surfaced:

1. **It excluded most of the library by construction.** AM2R — the game in the
   screenshot that motivated the whole project — launches an `.exe` directly, has no
   ROM and no RetroAchievements entry. The original architecture explicitly declared it
   out of scope, while Steam had already captured screenshots for it.
2. **Everything depended on the weakest link.** Playtime, screenshots and the timeline
   were all gated behind ROM→GameID resolution, the one genuinely fuzzy step.

Then the probe changed the picture: Steam stores non-Steam captures itself, keyed by an
id derived from the shortcut appid by **exact arithmetic**. 211 screenshots across 6
games, 100% present, all timestamped — with no emulator and no network involved.

### Decision

Split the system:

- **Core (`non-steam-games-activity`)** — owns the page and everything derived from
  Steam's own data. Works for *every* non-Steam game. Never touches the network.
- **Providers** — optional plugins that enrich games they recognise, via a fixed
  contract ([ADR-0013](#adr-0013-providers-return-data-the-core-renders-it)).
  `retroarch` and `retroachievements` become two providers among many.

The core must be fully useful with zero providers installed.

### Consequences

- The blank page is fixed for the entire library on day one, not just for emulated
  games — which is the actual user complaint.
- The core rests on exact arithmetic instead of fuzzy matching, so it is reliable.
  Uncertainty is pushed out to providers, where degrading is acceptable.
- Each provider ships, versions and fails independently. A RetroAchievements outage
  cannot blank an AM2R page.
- New sources (artwork, guides, other emulators) are additive, with no core changes.
- Cost: a contract to design and hold stable, and cross-plugin calls to make robust
  ([ADR-0014](#adr-0014-providers-are-isolated-and-fail-silently)).
- Cost: more plugins for a user to install for the full retro experience. Mitigated by
  the core being genuinely useful alone.

---

## ADR-0013: Providers return data; the core renders it

**Status:** Accepted · 2026-09-19

### Context

Providers need to show things on the page. Either they ship their own UI and inject it,
or they return structured data the core draws.

Letting providers render would mean every provider independently solving
`findClassModule` lookups, Steam's DOM structure and re-render timing — and each one
would break separately on a Steam update, with visual inconsistency between sections.

### Decision

Providers return **data only**: `stats`, `timeline` entries, and `sections` with a
declared `kind` (`badge-grid`, `list`, `links`, …). The core owns all rendering,
including provider sections.

A provider needing a new visual adds a `kind` and the core learns to draw it. Providers
never import `@steambrew/client` UI helpers or touch the DOM.

### Consequences

- One place knows Steam's DOM, so one place breaks and gets fixed on a Steam update.
- Visual consistency is automatic — every section uses the same components.
- Providers become simple and testable: JSON in, JSON out, no UI framework.
- Cost: a provider cannot ship a genuinely novel visual without a core change. Accepted
  — consistency is the point, and `kind` additions are small.
- Cost: the `kind` vocabulary must stay small and general, or it becomes a UI framework
  by accident.

---

## ADR-0014: Providers are isolated and fail silently

**Status:** Accepted · 2026-09-19

### Context

The core calls into plugins it does not control. A provider may be absent, disabled,
broken, hung on a network call, or returning malformed data. The bug we are fixing is
a blank page — reintroducing it because one optional provider threw would be absurd.

Also, most providers do not apply to most games: `retroachievements` has nothing for
AM2R, and that is normal, not an error.

### Decision

- Every provider call is wrapped (`pcall`) and bounded by a **timeout**.
- A failure is logged and dropped. The page renders without that provider.
- Contributions are validated before merging; malformed data is discarded.
- Four statuses: `ok`, `unsupported`, `needs-setup`, `error`.
  **`unsupported` is silent** — the normal case of a provider not recognising a game.
  Only `needs-setup` and `error` surface, and only within that provider's own section.

### Consequences

- The core page always renders. No provider can take it down.
- Users are not nagged about providers irrelevant to the game they are looking at.
- Actionable problems ("add your API key") still reach the user, scoped to where they
  matter.
- Cost: silent failures can hide real bugs. Mitigated by always logging, and by
  `needs-setup` being distinct from `unsupported`.
- Cost: a timeout may cut off a slow-but-working provider. Accepted — cached data
  should make provider calls fast, and a late page is worse than a partial one.

---

## ADR-0015: Serve capture images by reference, with a base64 fallback

**Status:** Superseded by [ADR-0017](#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first) · 2026-09-19

> The spike this ADR called for was run. `steamloopback.host` **cannot** reach
> our files, so the "by reference" option does not exist and the fallback became
> the design. See ADR-0017.

### Context

Screenshots are JPEGs on disk (3840×2160 here, ~MBs each). The frontend runs in
Chromium's sandbox and cannot read the filesystem; `file://` is blocked from Steam's
origin. Options:

1. **`steamloopback.host`** — Steam's CEF treats this as its own local origin and
   already serves local files through it. Likely the intended route, but not documented
   for plugin use and **not yet verified**.
2. **Base64 over RPC** — definitely works (the RPC channel is strings), but a 4K JPEG
   becomes megabytes of JSON per image.
3. **A local HTTP server in the backend** — works, but means opening a port, which is
   heavyweight and a security surface for showing a picture.

Steam's own UI clearly renders these thumbnails already (see the attachment), so a
supported path exists.

### Decision

Attempt **`steamloopback.host`** first and verify early — it is on the critical path
for the core's main feature, so prove or disprove it before building the media grid.

Fall back to **base64 over RPC** if it does not work, with:
- **thumbnails only** in the initial payload (Steam already generates them),
- full images fetched on demand, one at a time, when the user opens one.

Do not open a local HTTP server.

### Consequences

- If `steamloopback.host` works, images are effectively free — no copying, no encoding.
- The fallback is correct but heavier; thumbnail-first keeps the page payload sane
  either way.
- Deciding this early avoids designing the timeline around an image strategy that
  turns out to be unavailable.
- Cost: this ADR is **Proposed**, not Accepted. It must be resolved by a spike before
  the media grid is built, and updated with what was found.

---

## ADR-0016: Support Big Picture through the same backend, with a separate renderer

**Status:** Accepted · 2026-09-19

### Context

Steam has two UIs: the desktop client and Big Picture / Gamepad UI. If they needed
separate investigations and separate data layers, that would roughly double the work
and would be much cheaper to learn now than after Phase 4 is built.

What the investigation found:

1. **Big Picture is a separate popup window, not a separate process or sandbox.** The
   SDK identifies popups by window name: `SP Desktop_` → desktop, **`SP BPM_` →
   gamepad**. `onPopupCreate` fires for both, and explicitly handles an
   already-open gamepad window via `Steam.PopupManager.GetExistingPopup(Steam.GamepadWindowName)`.
2. **`PopupType.Gamepad` is first-class in `steambrew-utils`**, alongside `Desktop`,
   `Modal`, `ContextMenu` and `Unknown`.
3. **The reference plugin already supports both**, and shows the one API difference:
   the current location is read from `Steam.MainWindowBrowserManager.m_lastLocation`
   on desktop, but from `popup.window.opener.location` on gamepad.
4. **Routes are shared.** `/library/app/<appid>` appears in both modes (confirmed in
   `cef_log.txt`, including non-Steam appids such as `2790030801`). Big Picture adds
   **tab sub-routes** — `/library/app/<appid>/tab/GameInfo`, `/tab/WhatsNew` — rather
   than one long scrolling page.
5. **The known Millennium Big Picture limitation ([issue #754](https://github.com/SteamClientHomebrew/Millennium/issues/754), closed) is about CSS
   injection**, not plugin JavaScript. It reports that injected CSS does not reach the
   Gamepad UI's inner DOM. It does not say React/JS injection fails, and the SDK's
   explicit gamepad support contradicts that reading.

### Decision

Treat Big Picture as **the same plugin with a second renderer**, not a second project.

- **Backend is shared, unchanged.** It deals in appids and files and knows nothing
  about which UI is asking. No Big Picture investigation is needed at that layer.
- **The frontend already iterates popups**, so gamepad windows arrive for free. Read
  the location per popup type (item 3 above).
- **Rendering is Big-Picture-specific** and deferred. It is a different layout
  (tab-based, controller-focused, 10-foot type scale) with its own class modules, so it
  needs its own renderer resolved via `findClassModule` against the gamepad window —
  never reuse desktop class names.
- **Ship desktop first** (Phase 4), then add the gamepad renderer as its own phase
  behind the same `GetActivity` payload.
- **Do not rely on injected CSS** for anything structural in Big Picture, given #754.
  Style through resolved class modules and inline styles on our own nodes.

### Consequences

- No duplicated data layer: one backend, one RPC contract, two renderers. The core
  design ([ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins))
  needs no revision, and providers are unaffected.
- Desktop ships without waiting on Big Picture, and Big Picture cannot block it.
- Cost: focus/navigation must be controller-driven in Big Picture. A mouse-oriented
  media grid is not usable with a gamepad, so the gamepad renderer needs focusable
  elements using Steam's own focus primitives — not a restyle of the desktop markup.
- Cost: unverified on this machine. Big Picture has not been opened during this work,
  so the gamepad class modules and tab structure are **documented from logs and SDK
  source, not observed**. The gamepad phase must begin by confirming them live.
- Risk: if #754's isolation turns out to affect JS as well, the gamepad renderer is
  blocked. Cheap to test — log from inside a gamepad popup before building anything.

---

## ADR-0017: Serve capture images as base64 data URIs, thumbnails first

**Status:** Superseded by [ADR-0019](#adr-0019-use-steams-own-media-apis-routes-and-components) · 2026-09-19 · Supersedes [ADR-0015](#adr-0015-serve-capture-images-by-reference-with-a-base64-fallback)

> The spike behind this ADR tested `steamloopback.host/<path>`, which maps to
> `<Steam>/steamui/` and cannot reach `userdata/`. That conclusion was correct but
> the search was too narrow: Steam also serves captures under a **`screenshots/`
> route** on the same host. Images load directly by URL, so base64 is
> unnecessary. See ADR-0019.

### Context

[ADR-0015](#adr-0015-serve-capture-images-by-reference-with-a-base64-fallback)
proposed serving images by reference through `steamloopback.host` and called for a
spike before building any UI. The spike is done, and it settles the question.

**`steamloopback.host` cannot serve our images.** Millennium intercepts that host and
maps URLs to local files, but `local_path_from_lb_url` in
`src/instrumentation/loopback/src/url.rs` resolves every path against
**`<Steam>/steamui/`** and accepts only `Component::Normal` segments. Its own tests
assert that `..` traversal, Windows absolute paths and UNC paths are all rejected.
Our captures live under `<Steam>/userdata/`, outside that jail, with no link into
`steamui/`. The interception is real and does serve `image/jpeg` — just not for
anything we own.

That leaves base64 over the RPC channel. Measured on this machine:

| | count | median | mean |
| --- | --- | --- | --- |
| Steam thumbnails | 615 | **11 KB** | 11 KB |
| Full screenshots | 616 | **931 KB** | 1047 KB |

Base64 adds ~33%. A real AM2R thumbnail is 14 KB raw → 18 KB encoded, so a
20-thumbnail page costs ~0.4 MB of JSON. The same page of full-size images would be
~25 MB.

A local HTTP server was reconsidered and rejected again: opening a port and a
security surface to display a picture is disproportionate when 0.4 MB of JSON works.

### Decision

Serve images as **base64 data URIs** over RPC, thumbnails first.

- `GetAssets` batches **thumbnails** for a page; `GetAsset` fetches **one full image**
  on demand when the user opens it.
- Steam already generates the thumbnails, so there is nothing to resize.
- `assets.lua` enforces a **path allowlist**: only files under the screenshot and
  recording roots are readable, `..` is rejected outright, and only image MIME types
  are served. The frontend can only echo back paths we gave it, but a bug must not
  turn this into an arbitrary file reader.
- A per-call byte budget (8 MB default) and a 12 MB single-file ceiling stop one
  request from flooding the channel.

### Consequences

- Images work with no new surface area: no port, no scheme handler, no extra process.
- The thumbnail/full split keeps the common case (a page of media) small and the
  expensive case (a full 4K screenshot) explicit and user-initiated.
- The path allowlist means the RPC cannot be repurposed into a file reader, and it is
  covered by tests that attempt real traversal and absolute-path reads.
- Cost: a full-size image costs ~1.3 MB of JSON to open. Acceptable for a deliberate
  click; it would not be acceptable per page.
- Cost: data URIs are not cacheable by the browser the way a URL would be. The
  frontend should hold decoded thumbnails in memory for the life of the page.
- If Millennium ever widens the loopback jail or adds a plugin asset route, revisit —
  serving by URL would be strictly better.

---

## ADR-0018: Write only observable `AppOverview` fields, and patch the prototype

**Status:** Accepted · 2026-09-19

### Context

The library grid should show *something* for non-Steam games that have clearly
been played. Steam records playtime for shortcuts it launched itself, but plenty
of entries sit at zero: on the dev machine, Breath of the Wild has 14
screenshots from March 2026 and `rt_last_time_played = 0`. A screenshot is hard
evidence the game ran, so the newest capture is a sound lower bound.

Implementing it surfaced two traps, both of which fail **silently**:

1. **Not every `AppOverview` field is a plain property.** Steam declares them
   with metadata (read from its own bundle):

   ```js
   rt_recent_activity_time: { observable: true },
   rt_last_time_played:     { fnCustomSetter: (e, t) => e.SetLastTimePlayed(t),
                              fnCustomComparator: …, observable: true },
   ```

   Assigning `rt_last_time_played` bypasses `SetLastTimePlayed` and writes a
   shadow property. It reads back correctly, so it looks like it worked — and is
   then discarded on Steam's next sync.

2. **`collectionStore` is a class instance**, so `OnAppOverviewChange` lives on
   its prototype. `afterPatch(store, …)` reports success and never fires.
   Confirmed by printing the live function source: it was still Steam's original.

Both were only caught because the code logged how many apps it had actually
changed. Without that counter, "patch registered" plus zero effect is
indistinguishable from working.

### Decision

- Write only fields declared as plain observables — `rt_recent_activity_time`
  and `rt_last_time_played_or_installed`. **Do not write `rt_last_time_played`**;
  it needs `SetLastTimePlayed`, which is not part of any stable surface.
- Patch whichever object actually owns the method: check
  `hasOwnProperty`, else fall back to the prototype.
- Only ever move a timestamp **forward**, so Steam's own value wins when newer.
- Log the number of records actually changed, not just that a patch registered.

### Consequences

- The grid's recent-activity ordering reflects real play for games Steam has no
  record of. Verified live: zeroed values were restored to exact capture
  timestamps when `OnAppOverviewChange` fired.
- Cost: the "Last Played" column proper stays blank for those games, because the
  field behind it is not safely writable. Showing the right data in a nearby
  field beats writing a value Steam will silently drop.
- Cost: patching a prototype affects every instance. Acceptable here — there is
  one `collectionStore`, and the handler early-outs on non-Steam appids.
- Any future `AppOverview` write must first check for `fnCustomSetter` in
  Steam's bundle. Assume nothing is a plain property.

---

## ADR-0019: Use Steam's own media APIs, routes and components

**Status:** Accepted · 2026-09-19 · **Supersedes [ADR-0017](#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)**

### Context

User testing of the Phase 4 page found that clicking a screenshot or recording
did nothing, and that our layout diverges from Steam's: the native post-game
summary is a single row of 3–4 items with arrows, recordings animate on hover,
and a clip carries a golden scissors glyph with its duration.

Investigating those reports turned up capability we had assumed absent:

1. **`SteamClient.Screenshots` is a first-class API.** `GetAllLocalScreenshots()`
   returns records with `hHandle`, `nAppID`, `strGameID`, `nCreated`, dimensions
   and `strUrl`, plus `GetLocalScreenshotPath`, `ShowScreenshotInSystemViewer`
   and `ShowScreenshotsOnDisk`.

2. **Captures load directly by URL.** `strUrl` is
   `screenshots/<gameid>/screenshots/<file>.jpg`, served from the loopback
   origin. Verified live: the full image loads at **3840×2160** and the
   thumbnail (`…/screenshots/thumbnails/<file>.jpg`) at **200×112**.
   ADR-0017 concluded otherwise because the spike only tested paths under
   `steamloopback.host/` that map to `<Steam>/steamui/`; the `screenshots/`
   route was never tried.

3. **Steam has media routes.** Its navigator defines
   `Media.Screenshot → /media?item={"type":"screenshot","id":<hHandle>}`,
   `Media.Clip → {"type":"clip","id":…}` and
   `Media.Recording → {"type":"recording","id":<gameid>,playbackDefinition}`.
   Navigating there opens Steam's own viewer — including a DASH player we do
   not have to write.

4. **The post-game summary has its own class module**: `GamePlaySummaryContainer`,
   `SummaryCarouselContainer`, `SummaryCarouselScrollingContainer`,
   `SummaryScreenshot`, `SummaryAchievement`, `PostGameSummaryClip`,
   `ClipThumbnail`, `EventCarousel`, `hoverAnimation`.

### Decision

Prefer Steam's own mechanisms over reimplementation, in this order:

1. **Images by URL, not base64.** Render `strUrl` (thumbnail variant in grids)
   straight into `<img>`. This removes the RPC round trip, the 33% encoding
   overhead, the budget logic and the in-memory cache, and restores normal
   browser caching.
2. **Clicks navigate to Steam's media routes**, so screenshots and clips open in
   the native viewer and recordings play without us shipping an MSE player.
3. **Reuse Steam's summary classes** via `findClassModule`, so the carousel,
   hover animation and clip styling match natively.
4. Keep `assets.lua` as a **fallback** for captures absent from Steam's index —
   it is tested and cheap to retain — but it is no longer the primary path.

`hHandle` becomes part of the payload: it is the id Steam's routes take. The
backend already parses `screenshots.vdf`; it will map each entry to its handle
via `GetAllLocalScreenshots` on the frontend, since handles are a client concept.

### Consequences

- The page gains working clicks, native playback, and Steam's real look, while
  we own less code.
- Payloads shrink to metadata; a page of thumbnails costs no JSON at all.
- Cost: a dependency on undocumented routes and client APIs. Mitigated by
  feature-detecting each one and falling back to the base64 path.
- Cost: ADR-0017's implementation was largely wasted. The lesson is narrow and
  worth stating: **when a spike returns "not possible", check whether the
  question was too narrow before building around the answer.** The right
  question was "how does Steam itself load these?", not "can this one host route
  reach this one directory?"
- Big Picture (ADR-0016) benefits too: reusing Steam's components is far more
  likely to work under Gamepad UI than a hand-built grid.

---

## ADR-0020: Match Steam's measured styles; open media through client APIs

**Status:** Accepted · 2026-09-19

### Context

A second round of user testing compared our page against a native one side by
side and found three problems:

1. **Clicking a capture showed a blank black screen.** Navigating to
   `/media/item/screenshot/<handle>` (the real route — the earlier
   `?item=` query form was wrong) loads the page but renders nothing.
   Steam's own call site explains why:

   ```js
   Media.Screenshot({ state: { id: t.id,
     filter: { listSource: { type: "app", gameid: t.strGameID } } } })
   ```

   The viewer needs list state, passed as a navigator *state object*, that
   `Navigate(url)` cannot express. The item id is also the media item's `id`,
   which is not the same as `hHandle`.

2. **Double background.** Measuring the native page showed every summary
   container is transparent — `GamePlaySummaryContainer`,
   `SummaryCarouselContainer` and its scrolling child all report
   `rgba(0,0,0,0)`. The dark panel comes from the enclosing
   `AppDetailsSection`. Our own `.nsga-summary` panel produced a box inside a box.

3. **Wrong typography.** Steam's `GamePlaySummaryHeader` measures
   **14px / weight 400 / 1px letter-spacing / uppercase / `rgb(148,161,166)`**.
   Ours was 13px / 700 / 0.5px in a different grey.

### Decision

- **Measure, do not guess, when matching Steam.** Read computed styles off a
  native page and copy the values, rather than approximating from a screenshot.
- **Add no background of our own** in a position where Steam's own containers
  are transparent.
- Borrow a Steam class only where it helps. `SummaryCarouselScrollingContainer`
  gives useful spacing; `SummaryCarouselContainer` brings a panel that doubles
  up, so our own layout class is used there instead.
- **Open screenshots with `SteamClient.Screenshots.ShowScreenshotInSystemViewer(appid, handle)`.**
  It is a stable client API that reliably shows the image. Recordings reveal
  their folder via `ShowScreenshotsOnDisk`.

### Consequences

- The page matches Steam's type and spacing, with no doubled panels.
- Clicking a screenshot shows it, instead of a black screen.
- Cost: screenshots open in the OS viewer rather than Steam's in-client overlay,
  which is less integrated. Reaching the native overlay needs the navigator's
  state object; if a future SDK exposes it, revisit.
- Cost: recordings still do not play in-client. DASH needs an MSE player, so
  revealing the folder is the honest fallback.
- The `hHandle` vs media-item `id` distinction is recorded so nobody assumes
  they are interchangeable again.

---

## ADR-0021: Measure Steam's styles from the live client, and keep a style bible

**Status:** Accepted · 2026-09-19

### Context

Matching Steam's look by eye took three rounds of user testing and still missed:
wrong header weight and colour, a doubled background panel, then — after
over-correcting — a *missing* panel, undersized tiles and no shadows.

The root cause was method, not care. Each round compared screenshots and
adjusted by guess. One round of `getComputedStyle` against a native page
produced exact values immediately, and revealed two things a screenshot cannot:

- The carousel panel is a **`radial-gradient`**, not a `background-color`.
  Checking `backgroundColor` returns `rgba(0,0,0,0)`, which is what caused the
  panel to be removed as "transparent" — it looked correct by that measure and
  wrong on screen.
- Steam's section headers are **weight 400**, not bold. They read as prominent
  from uppercase and 1px letter-spacing.

### Decision

- **Measure, never approximate.** Before styling anything to match Steam, read
  `getComputedStyle` off the equivalent native element and copy the values.
- **Record findings in [docs/steam-styles.md](steam-styles.md)**, with the
  element each value came from, so they are reusable and reviewable rather than
  rediscovered per component.
- Check `backgroundImage` as well as `backgroundColor`; Steam uses gradients
  where a flat colour would be expected.
- Select native elements by `[class*="ReadableName"]`. Steam's DOM carries both
  the hashed and readable halves, so this survives build changes without
  hardcoding a hash (consistent with
  [ADR-0005](#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)).

### Consequences

- The page matches Steam's spacing, type and depth without further guesswork.
- Future components start from recorded values instead of another testing round.
- Cost: measurements are taken from one Steam build and could drift. The bible
  documents how to re-measure, which makes that cheap.
- Cost: the bible must be kept honest — a value edited by eye and left
  unrecorded is worse than none, because it looks authoritative.
