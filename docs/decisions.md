# Decisions

Architecture decision records. Each captures _why_ a choice was made, what was
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
> path _the_ foundation of the plugin. It now describes the `retroarch` provider only.
> The core joins Steam to its own captures by exact arithmetic instead — see
> [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).

---

## ADR-0004: Backend owns all I/O and merging; the frontend only renders

**Status:** Accepted · 2026-09-19

### Context

The frontend runs in Chromium's sandbox — no filesystem, and cross-origin HTTP is
constrained. It _could_ still make some API calls directly, which would cut an RPC hop.

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
const formatDuration = findModuleExport((e) =>
    e?.toString?.()?.includes('"#Played_"'),
);
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
- Cost: a _cross-game_ "everything I did on this date" view would need a different
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

- High precision: matching against games the user has _actually played_ on RA is a
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

The failure we are replacing is _the blank page_. Reproducing it on a partial failure
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
_for_ retro games, and a game we could not resolve to a ROM got nothing. Two problems
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
  Steam's own data. Works for _every_ non-Steam game. Never touches the network.
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

**Status:** Accepted · 2026-09-19 · the "separate renderer" plan is superseded by
[ADR-0023](#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one);
the backend-sharing conclusion below still holds

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

|                  | count | median     | mean    |
| ---------------- | ----- | ---------- | ------- |
| Steam thumbnails | 615   | **11 KB**  | 11 KB   |
| Full screenshots | 616   | **931 KB** | 1047 KB |

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

The library grid should show _something_ for non-Steam games that have clearly
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
    Media.Screenshot({
        state: {
            id: t.id,
            filter: { listSource: { type: "app", gameid: t.strGameID } },
        },
    });
    ```

    The viewer needs list state, passed as a navigator _state object_, that
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
over-correcting — a _missing_ panel, undersized tiles and no shadows.

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

---

## ADR-0022: Render through Steam's own app detail sections instead of rebuilding them

**Status:** accepted · supersedes the rendering half of
[ADR-0020](#adr-0020-match-steams-measured-styles-open-media-through-client-apis)
and [ADR-0021](#adr-0021-measure-steams-styles-from-the-live-client-and-keep-a-style-bible),
and narrows [ADR-0017](#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)

### Context

The plugin hand-built the post-game summary: its own carousel, media cards,
hover states, day grouping and date labels, styled from measured values and
rendered into Steam's DOM with `data-nsga` markers and a stylesheet that hid
Steam's placeholder.

It worked, and it kept not quite matching. Each Steam detail rediscovered by
hand was a thing that could drift: five separate CSS modules had to be resolved
by probe key, one of which (`PostGameSummaryClip`) turned out to be **ambiguous
across two different modules**, silently reintroducing a fixed bug with no code
change. That is a permanent maintenance tax on a copy that can only ever
approximate the original.

A live read of Steam's module cache showed the copy was unnecessary. From
`webpackChunksteamui`:

```js
// Steam's app-details section registry
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
```

**Steam is not missing this UI for non-Steam games; it filters it out by app
type.** Every component and store behind it accepts a shortcut's appid:

- `CAppSpotlightStore.GetOrCreateAppData(appid)` → a real session object
- `SteamClient.Apps.GetScreenshotsInTimeRange(appid, …)` → 4 real screenshots
- the recording service's `GetClips({ game_id })` → 3 real clips

The clips call needs the **64-bit gameid**; Steam's own helper truncates it to
32 bits, which is the actual reason non-Steam clips never appear natively.

Verified end to end: restoring the section name and pushing the captures into
Steam's own session made Steam render its real summary — pager, day separators,
`Today` label, clip badges, media viewer — with zero markup of ours.

### Decision

- **Do not build UI that Steam already builds.** Restore the section in Steam's
  registry and feed Steam's store; let Steam render.
- **Resolve Steam's internals by signature, never by numeric module id** —
  prototype method names survive minification, module ids reshuffle per build.
- **Remove Steam's `nonsteam` placeholder by dropping it from the section set**,
  not by hiding the rendered node with CSS, and only once there is content to
  replace it with.
- **Expose a provider API** (`registerSummaryProvider`) so provider plugins
  contribute events rather than markup, consistent with
  [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).
- Delete the hand-built components rather than keep them as a fallback. A
  second rendering path that is never exercised is a liability, and the graceful
  degradation we need is "Steam's stock page", which costs nothing.

### Consequences

- ~800 lines of components, class maps and image plumbing deleted. The renderer
  is ~60 lines of coordination.
- The page cannot drift from native, because it _is_ native. A Steam UI refresh
  carries us along instead of breaking us.
- No image crosses the RPC boundary for the detail page: Steam serves its own
  captures over `steamloopback.host` and hands us absolute URLs. ADR-0017's
  constraint still holds for files Steam does not index, but does not apply
  here.
- The style bible ([steam-styles.md](steam-styles.md)) is no longer needed to
  _build_ the summary. It is kept as reference for anything we do still draw.
- Cost: we depend on Steam's internal shapes. Mitigated by signature-based
  resolution and by degrading to the stock page whenever a lookup fails — a
  Steam update makes the section disappear, not the client crash.
- Cost: publishing is async, so the first render precedes the data. The section
  patch tracks live component instances and forces a re-render, clearing
  `m_setSectionsMemo` first because Steam compares that cache **by size alone**
  and our change swaps one member for another.

---

## ADR-0023: Big Picture is a separate bundle, not a separate renderer within the same one

**Status:** Accepted · 2026-09-21 · supersedes item 5 and the "second renderer"
framing of [ADR-0016](#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer) ·
its "not fixable from this repo" conclusion is corrected by
[ADR-0024](#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store) —
the module cache finding below still holds, the reachability one did not

### Context

ADR-0016 concluded Big Picture needed only "a second renderer" alongside the
existing plugin, on the strength of: `onPopupCreate` already reports gamepad
popups, routes are shared, and the known Millennium limitation (issue #754) was
read as CSS-only, not JS.

ADR-0022 then changed what "renderer" means for this plugin: there is no
renderer any more. The frontend restores a section in Steam's own registry and
feeds Steam's own store; Steam's own component draws the page. So the real
question for Big Picture became narrower: **does that same patch reach the
Big Picture window?**

Verified live, 2026-09-21, by switching UI mode from `SharedJSContext`
(`SteamClient.UI.SetUIMode(4)` → Big Picture, `(7)` → back) and inspecting the
new `Steam Big Picture Mode` devtools target directly:

```js
typeof window.webpackChunksteamui; // "undefined"
typeof window.appStore; // "undefined"
typeof window.Millennium; // "undefined"  ← the plugin loader itself
typeof window.SteamClient; // "object"     ← only the native bridge
```

Big Picture is not a popup sharing `SharedJSContext`'s module cache — it is a
**separate bundle** with its own webpack instance. `window.Millennium` being
absent means Millennium never runs `OnPluginLoaded()` there at all: not the
frontend's DOM-patching code, not the `steam/` module that patches
`GetSections`, nothing. This is a stronger and more specific finding than #754:
it is not that injected CSS fails to reach the inner DOM, it is that **no
plugin code of any kind executes in that window**.

Reading Big Picture's own source (module `3375`, shared with desktop)
confirmed the payoff for closing that gap is large: Big Picture's "ACTIVITY"
tab already renders `Ge.T` — the identical Post-Game Summary component desktop
uses — gated by the identical `setSections.has("postgamesummary")` check, fed
by the identical `GetSections()` call. Nothing needs to be built or cloned for
Big Picture's UI; the section patch and the store-feeding code in `steam/`
would work unchanged the moment they run in that window.

### Root cause, confirmed from Millennium's own source (2026-09-21)

Cloned `SteamClientHomebrew/Millennium` and read the engine directly rather
than inferring further from behaviour. The mechanism is single-target **by
design**, in two independent places:

**1. The plugin frontend loader attaches to exactly one CDP target, ever.**
`plugin_loader::init_devtools()` (`src/engine/plugin_loader.cc`):

```cpp
constexpr auto targetFrame = "SharedJSContext";
...
auto it = std::find_if(targets["targetInfos"].begin(), targets["targetInfos"].end(),
    [&](const auto& target) { return target.value("title", "") == targetFrame; });
...
auto result = m_cdp->send_host("Target.attachToTarget", attach_params).get();
m_cdp->set_shared_js_session_id(result.at("sessionId").get<std::string>());
```

This runs once at Steam startup, blocking until a target titled exactly
`SharedJSContext` appears, attaches to it, and never looks for another target
for the process lifetime (`cdp_client` holds one `m_shared_js_session_id`,
singular, used by every plugin-frontend CDP call). Big Picture's window has a
different CDP title (`Steam Big Picture Mode`) and is never considered.

**2. Millennium's other injector (`webkit_world_mgr`, used for CSS themes and
generic webkit hooks on arbitrary pages) explicitly excludes the host both
windows share.** `target_url::allows_webkit_injection()`
(`src/engine/target_url.cc`):

```cpp
bool target_url::allows_webkit_injection(...) const {
    if (!m_valid) return false;
    if (!is_safe_for_js()) return false;
    if (m_host == k_steam_loopback) return false;   // ← "steamloopback.host", excluded unconditionally
    if (is_steam_owned()) return true;
    ...
}
```

So even the general-purpose, multi-target injector would refuse Big Picture's
window on host alone, before title is ever considered. Between the two, there
is no path in the current engine that reaches a Gamepad UI window.

This matches [issue #754](https://github.com/SteamClientHomebrew/Millennium/issues/754)
(closed, no fix, no maintainer comment on cause) almost exactly — its own
description, "the modern Gamepad UI runs in a nested, isolated context or
different WebKit view that Millennium's current injection methods do not
penetrate," is correct, and now confirmed at the source level: it is a
different CDP _target_, and the single-target-by-title design in
`plugin_loader.cc` is why "different injection methods" don't reach it either.

### Decision (superseded — see ADR-0024)

> The original decision below concluded Big Picture "cannot be fixed from
> inside this plugin." That conflated two different questions: whether
> Millennium loads our _bundle_ into that window (no, confirmed — the finding
> above still stands) with whether that window is _reachable at all_ from
> `SharedJSContext` (yes, it is, via `Steam.PopupManager`/`g_PopupManager`,
> which needs no Millennium injection). [ADR-0024](#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store)
> has the corrected decision and the implementation. Left here for the record.

- ~~This cannot be fixed from inside this plugin.~~ It cannot be fixed by
  _feeding Steam's own component_ — that part of the finding holds, because
  `CAppDetailsSections`/`CAppSpotlightStore` are objects in a module cache
  this bundle cannot reach. But the window's DOM is a different resource, and
  it is reachable. See ADR-0024.
- **Still worth reporting upstream** independent of the above: #754 covers
  CSS; source-level confirmation that plugin _JavaScript_ never runs in a
  Gamepad window either is new information Millennium's maintainers may want.

### Consequences

- Phase 6 shipped via ADR-0024's cross-window DOM technique, not by waiting on
  Millennium. The dependency on Millennium's engine described above is real
  for the store-feeding approach, but turned out not to gate Big Picture
  support entirely.
- `docs/steam-components.md § Inspecting Big Picture` carries the full
  verification detail and the reusable procedure (`SetUIMode`/`GetUIMode`,
  plus how to re-clone and grep Millennium's engine) — still useful for
  re-confirming the module-cache finding, independent of the DOM-reachability
  correction.
- Confirmed live, 2026-09-21: AM2R's Big Picture "ACTIVITY" tab rendered
  completely blank _before_ ADR-0024's fix (no summary, no Steam placeholder
  either) — the visible symptom of `GetSections()` never being patched there.
  Screenshot on file.

---

## ADR-0024: Reach Big Picture by cloning DOM across windows, not by feeding its store

**Status:** Accepted · 2026-09-21 · corrects the "not fixable from this repo"
conclusion of [ADR-0023](#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one)

### Context

ADR-0023 concluded Big Picture was unreachable without a Millennium engine
change, based on reading Millennium's C++ plugin loader: it attaches to
exactly one CDP target (`SharedJSContext`), by title, once, at startup. That
finding is still correct — it explains why `webpackChunksteamui`,
`CAppSpotlightStore` and every other module-cache object are absent inside
`Steam Big Picture Mode` (verified again live: `window.webpackChunksteamui`
is `undefined` _inside that window_, and it has its own separate React fiber
tree). None of that is wrong.

What was wrong was treating "Millennium never injects our bundle into that
window" as "we cannot reach that window at all." The user pointed at
[k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes/tree/f2c14ecbc0cfcdff6bba5f1d703231ec6037588f)
(cloned into `research/`, gitignored, for reference) — its playtime feature
_does_ show up in Big Picture, and it needs no Millennium change to do it.

Reading its `frontend/index.tsx` and `frontend/renderers/library-app.tsx`
shows the mechanism, and it was verified live before writing any of our own
code:

```js
// SharedJSContext — g_PopupManager is a real, live global here
const pm = window.g_PopupManager;
for (const p of pm.GetPopups()) {
    if (p.window?.name?.startsWith("SP BPM_")) {
        bpm = p;
        break;
    }
}
bpm.window.document.body.appendChild(el); // el created in SharedJSContext
```

Verified: `bpm.window.document` is fully readable and writable from
`SharedJSContext` — same-process, same-origin, direct object reference, no
CDP involved at all. A `<div>` created with `document.createElement` in
`SharedJSContext` and appended into `bpm.window.document.body` renders live
on screen (confirmed by screenshot). `Steam.PopupManager` /
`Steam.GamepadWindowName` in `steambrew-utils` are a thin wrapper over exactly
this global.

**The two findings are not in tension; they describe different resources:**

| Resource                                                                            | Reachable from SharedJSContext?                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Big Picture's `document` / DOM                                                      | **Yes** — `popup.window.document`, direct reference                                                                                                        |
| Big Picture's webpack module cache (`CAppDetailsSections`, `CAppSpotlightStore`, …) | **No** — separate bundle, confirmed `undefined`                                                                                                            |
| Big Picture's compiled CSS / class hashes                                           | **Yes** — one build-wide stylesheet; a hash resolved from `SharedJSContext`'s own module cache is valid to apply to a node rendered into Big Picture's DOM |

So feeding Steam's own component (the desktop approach, ADR-0022) is still
impossible for Big Picture — there is no object to feed. But rendering our
own markup into that DOM, using real Steam class names resolved from our own
side, works exactly as it did before ADR-0022, for the one surface where
ADR-0022's technique cannot reach.

### Decision

- **Big Picture gets its own renderer, `renderers/gamepad-app.tsx`**, built on
  rung 4 of the reuse ladder (AGENTS.md) — clone Steam's DOM shape, styled
  with class names resolved from `SharedJSContext` via a new
  `resolveClassMap()` in `steam/modules.ts`. This is not a relapse to the
  pre-ADR-0022 approach: it is the _only_ rung available here, because rungs
  1–3 all require an object living in Big Picture's own bundle, and none of
  the ones we need are exported there.
- **`index.tsx` handles `PopupType.Gamepad`** alongside `PopupType.Desktop`,
  reading location from `popup.window.opener.location` (there is no
  `MainWindowBrowserManager` equivalent inside Big Picture's own bundle to
  read from), matching `steambrew-utils`'s own convention for gamepad popups.
- Kept deliberately small: one non-scrolling strip of recent captures, no
  attempt to reproduce the desktop carousel's paging, day grouping or hover
  states. Steam's own summary already sets that bar; matching it exactly here
  would mean rebuilding everything ADR-0022 deleted, for one surface.
- The activity-feed store record and desktop's summary are unaffected — this
  is additive, gated entirely on `PopupType.Gamepad`.

### Consequences

- Big Picture goes from "blocked, not actionable" to "shipped via a documented
  last-resort technique," without needing anything from Millennium upstream.
- This reintroduces exactly the kind of code ADR-0022 spent effort removing —
  hand-built markup with resolved class names, one clone-and-hide component —
  but scoped to the one place it is unavoidable, not the default.
- Cost: this markup can drift from Steam's real summary on a future Big
  Picture UI change, the same risk every clone-and-hide component carries
  (AGENTS.md's warning about ADR-0022's own history applies here too). Revisit
  if Millennium ever gains a supported way to inject a plugin bundle into a
  Gamepad popup (the ADR-0023 root cause) — that would let this be replaced
  with the same feed-Steam's-store technique desktop uses.
- `docs/steam-components.md` and `docs/plugins.md` updated with the cross-window
  DOM technique as a named option below "clone Steam's DOM," for the case
  (rare) where even the DOM is in a different window than the code resolving
  the classes.

---

## ADR-0025: Watch the Big Picture popup's own `location`, not its `opener`'s

**Status:** Accepted · 2026-09-21 · corrects a claim made in
[ADR-0016](#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)
(item 3) and repeated in
[ADR-0024](#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store)

### Context

The first live smoke test of Big Picture support (blocked on since ADR-0024 shipped;
see [TASK.md](../TASK.md)) showed nothing in the ACTIVITY tab for a non-Steam game —
not a broken render, an _absent_ one. `gamepad-app.tsx`'s `patch()` never ran at all.

`index.tsx`'s `PopupType.Gamepad` branch watches
`onLocationChange(() => window.opener?.location, …)`, where `window` is the Big
Picture popup. ADR-0016 attributed this to "the reference plugin['s]" behavior and
called it "`steambrew-utils`'s own convention for gamepad popups"; ADR-0024 repeated
the claim without re-checking it. Neither was verified against a live Big Picture
window before Sept 21 — Big Picture had never been smoke-tested until now, and
`steambrew-utils`'s actual source (`dist/watchers/index.mjs`) contains no reference to
`opener` at all: `onLocationChange` is a generic poller that takes any
`() => Location | undefined` and diffs `pathname`/`search`/`hash`. There is no
"gamepad convention" baked into the library; the choice of _which_ location to poll
was entirely this plugin's own, made once in ADR-0016 and never checked.

**Verified live** (CEF devtools, `Steam` v2.x, this machine, 2026-09-21):

1. `popup.window.opener` **is SharedJSContext's own `window`** — confirmed with a
   cross-window marker (`window.__x = <value>` set from the `SharedJSContext` CDP
   target, then read back as `opener.__x` from inside the `Steam Big Picture Mode`
   target: same value, same object).
2. **SharedJSContext's own `location.pathname` never changes.** It stayed at
   `/routes/library/home` — its initial load URL — through repeated `SetUIMode`
   switches between Desktop and Gamepad and repeated in-Big-Picture navigation.
   This matches the "Development Quirks" doc's framing of SharedJSContext as
   headless and DOM-less (see knowledgebase.md's official-docs section): it is the
   parent that spawns every visible window, not one itself, so it has no route of
   its own to reflect.
3. **The popup's own `window.location` does update** on navigation — confirmed with
   `history.pushState` inside the Big Picture target itself, which is ordinary,
   engine-guaranteed browser behavior no app code can opt out of.
4. **SharedJSContext can read the popup's own `window.location` cross-window with no
   restriction** — same-origin (`steamloopback.host`), confirmed by evaluating
   `popup.window.location.pathname` directly from the `SharedJSContext` target.

So `window.opener?.location` was, structurally, always going to poll a value that
can never become `/library/app/<appid>` — not a flaky signal, a permanently wrong
one. This fully explains the empty ACTIVITY tab: the branch that calls `patchGamepadApp`
was gated behind a condition that could never fire.

Why this went unnoticed until now: ADR-0016's claim was written from reading the
reference plugin, not from testing our own popup handle, and Big Picture was marked
"implemented, awaiting smoke test" from the day `gamepad-app.tsx` shipped (ADR-0024)
until this session. The reference plugin's playtime feature most likely doesn't need
location tracking at all — playtime updates by patching `CollectionStore` reactively
(rung 2 of the reuse ladder), which re-renders on every store notification regardless
of which window or route is showing it, so it was never exercising this code path the
way our per-route summary strip does.

### Decision

Watch the popup's own location instead:

```ts
const stopWatching = onLocationChange(
    () => window.location, // `window` is `popup.window` — its own, not its opener's
    ({ pathname }) => {
        /* unchanged */
    },
);
```

No other change needed — `onLocationChange` already normalises `/routes` prefixes and
diffs correctly regardless of source, and `window.location` is a completely ordinary
`Location` object with no cross-origin restriction from `SharedJSContext`.

### Consequences

- Big Picture's summary strip can now actually render — this was a full blocker, not
  a degradation; nothing downstream of the watcher could have worked.
- **Correction to ADR-0016 and ADR-0024**: neither the reference plugin's behavior nor
  `steambrew-utils` itself mandates reading `opener.location` on gamepad popups. Both
  ADRs' text is left in place per this project's convention (don't rewrite history),
  but a reader following either should come here first, not copy `opener.location`
  forward into a future provider or renderer.
- **Process note, same lesson as ADR-0023 → ADR-0024**: a claim about a third-party
  library's "convention," made by reading example code rather than that library's own
  source, is exactly the kind of thing "awaiting smoke test" is for. The fix, once
  found, was a one-line change; the finding took a live CDP session because the wrong
  assumption looked identical to a reasonable one until actually measured.
- No change needed to `gamepad-app.tsx` itself, `resolveClassMap`, or the anchor-finding
  logic in `patch()` — none of that was ever reached, so none of it is implicated by
  this bug. It still needs its own verification once the watcher fix lets `patch()`
  actually run for the first time.
- **This fix is necessary but, per live testing, not sufficient** — continuing the same
  smoke test past this fix surfaced a second, deeper problem with the same watcher's
  premise. See [ADR-0026](#adr-0026-big-pictures-real-navigation-does-not-touch-location-at-all).

---

## ADR-0026: Big Picture's real navigation does not touch `location` at all

**Status:** Proposed · 2026-09-21 · found while smoke-testing
[ADR-0025](#adr-0025-watch-the-big-picture-popups-own-location-not-its-openers)'s fix;
further corrects [ADR-0016](#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)
item 4

### Context

ADR-0025's fix (watch `popup.window.location` instead of `popup.window.opener.location`)
was verified working _mechanically_: a location change on the popup's own window now
reliably triggers `patch()`. But finishing the smoke test — driving Big Picture through
its **real** UI, not a synthetic `history.pushState` stand-in — surfaced a bigger problem
underneath the one ADR-0025 fixed.

**Verified live** (CEF devtools, real gamepad-style input via `Input.dispatchKeyEvent`,
this session, immediately after ADR-0025's fix):

1. Focused a "Recent Games" tile, pressed Enter (a real activation, not a synthetic
   navigation): the view swapped to a real game's app-details page — visible tab strip
   "ACTIVITY / YOUR STUFF / COMMUNITY / GAME INFO", the real Play button, real last-played
   text. `location.pathname` **stayed at `/routes/library/home`** throughout.
   `history.length` stayed `0` — no entry was pushed.
2. Repeated properly, ruling out "that was just a lightweight overlay shortcut": backed
   out, opened the real Library section (`View more in your Library`), filtered to
   **Non-Steam** (223 games), focused a real non-Steam tile ("1944: The Loop Master",
   appid `4271101655`), pressed Enter. Same result: real app-details page rendered
   (`Play / 1944: The Loop Master / ACTIVITY / YOUR STUFF / COMMUNITY / GAME INFO`),
   `location.pathname` unchanged, `history.length` still `0`.

Big Picture's app-details view, for at least this navigation path (browse Library →
select a game), is an **in-place view-state swap**, not a route change. No `Location`
object — not `opener`'s (ADR-0016/0024's original, wrong per ADR-0025), not the popup's
own (ADR-0025's fix) — can ever reflect which game is currently shown, because _none of
them change_ when this navigation happens. ADR-0025's fix was still correct and necessary
(the popup's own location is the only one that's even theoretically live), but the whole
premise of "watch `location`, extract an appid from the pathname" does not hold for Big
Picture, regardless of which window's `location` is polled.

This directly contradicts ADR-0016 item 4's claim that "`/library/app/<appid>` appears in
[both desktop and gamepad] modes," sourced from grepping `cef_log.txt` for that path
pattern. That log _does_ contain real entries for that pattern, including non-Steam
appids (e.g. `2726721891`) — but the log doesn't tag which UI mode was active when each
line was written, and desktop is independently confirmed (shipped, ADR-0022) to use real
routes via `Steam.MainWindowBrowserManager`. The simplest explanation consistent with
today's direct, repeated, live observation is that every one of those log lines came from
desktop sessions, and ADR-0016's "appears in both modes" was an unverified inference from
a mode-agnostic log — the same class of mistake ADR-0023 made and ADR-0024 corrected, now
recurring one layer deeper.

**A viable alternative signal exists and is confirmed reachable.** Big Picture's DOM is
reachable from `SharedJSContext` (ADR-0024's whole premise), and so — one level further
in than a plain DOM read — are individual elements' React fiber trees, which are ordinary
object properties (`__reactFiber$…`, keyed by a random per-render suffix) sitting on the
DOM nodes themselves. Verified live: anchored on the "Play" text (a stable landmark
present on every app-details view), walking `fiber.return` a few levels and reading
`fiber.memoizedProps` surfaced a `props.appid` field with the exact real appid
(`4271101655`, matching "1944: The Loop Master") on both of the two different games
tested. This reaches the same information the (unreachable) `CAppDetailsSections`/
`CAppSpotlightStore` objects would have given directly (ADR-0023/0024), by going through
the DOM's own fiber pointers instead of the module cache.

### Decision

**Not yet made — this ADR is Proposed, not Accepted.** Two real paths forward exist and
the trade-off is a judgment call:

1. **Fiber-prop extraction.** Replace the location watcher with a
   `MutationObserver`/polling approach that looks for the "Play" (or similar) landmark
   text in the popup's DOM, walks its fiber tree the same way just verified, and reads
   `appid` off `memoizedProps`. More code, and reads a genuinely private React internal
   (`memoizedProps` field names are not a React public API and carry no stability
   guarantee across a Steam Chromium/React upgrade) — a real risk, but one already
   somewhat priced in: this plugin already resolves Steam internals by signature
   (`findClassModule`, prototype-method probes) rather than any public contract, and a
   failed resolve degrades to "summary doesn't render" the same way a failed
   `findClassModule` probe does elsewhere (AGENTS.md's fallback rule).
2. **Leave Big Picture unsupported for now**, ship the ADR-0025 fix anyway (it is a real,
   confirmed correctness improvement even if insufficient alone — a future Millennium or
   Big Picture change could make `location` live again, and there's no reason to leave a
   proven-wrong `opener` read in place while that's decided), and downgrade Big Picture in
   TASK.md from "awaiting smoke test" to "blocked: real navigation is unobservable via
   `location`," pending a decision on option 1.

### Consequences (either direction)

- Either way, ADR-0025's fix ships — it is strictly correct on its own terms.
- If (1): another rung-4-adjacent technique joins the reuse ladder's last resort, and
  `docs/plugins.md`/`steam-components.md` need a new documented pattern ("read live state
  off a React fiber anchored on a stable text landmark, not off a Location") alongside
  the existing "clone DOM across windows" one.
- If (2): Big Picture support stays shipped-but-inert (the strip never renders under
  normal use) until this is revisited — worth being honest about in any release notes
  rather than claiming Big Picture support that doesn't actually activate.
- Either way: **ADR-0016 item 4 is retracted.** Big Picture routes are not confirmed to
  exist for the app-details view; only desktop's are. A future investigation should not
  cite `cef_log.txt` alone for a "which UI mode" claim without also checking which window
  was foregrounded when the relevant lines were written.

---

## ADR-0027: Patch `react/jsx-runtime` to reach Big Picture's real render pipeline

**Status:** Accepted · 2026-09-21 · supersedes both options in
[ADR-0026](#adr-0026-big-pictures-real-navigation-does-not-touch-location-at-all) with a
third, and narrows (does not overturn) the "separate bundle" finding in
[ADR-0023](#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one).
Implemented in `steam/gamepad-appid.ts`, wired into `index.tsx`'s Gamepad branch. Verified
working end-to-end, live: Big Picture's real summary strip (real clip/screenshot URLs, real
durations) rendered inside the real ACTIVITY tab for a real non-Steam game (AM2R, appid
`4263274102`), reproduced twice from a clean Steam restart. See "Verification" below.

### Context

ADR-0026 left two options on the table for reading which non-Steam game Big Picture is
currently showing, both worse than what turned out to exist: build a fiber-prop walk
anchored on a text landmark, or ship Big Picture inert. The user pointed at
[BossSloth/SteamHunter-plugin](https://github.com/BossSloth/SteamHunter-plugin) (commit
`3662d0f`), whose README claims full Big Picture / controller support for a feature
(an added "Achievement Groups" tab) with no separate Big-Picture renderer file anywhere
in its tree — worth checking whether the claim held up, rather than assuming it from a
screenshot.

Reading `frontend/createElementOverride.tsx`: it patches `react/jsx-runtime`'s `jsx` and
`jsxs` exports directly via `beforePatch` (from `@steambrew/client`, the same package and
version this repo already depends on — `^5.8.5`), found via `findModuleByExport`. No
`onPopupCreate`, no `PopupType` branching, no popup awareness at all — `index.tsx` calls
`installCreateElementPatches()` exactly once, unconditionally. The whole technique rests
on intercepting **every** React element Steam's UI ever creates, anywhere, and reading or
rewriting its `(type, props)` before React uses them
(`frontend/createElementOverride.tsx#L60-79` in that repo — `beforePatch(runtime, prop,
handler)` where `runtime` is the located `react/jsx-runtime` module).

**Verified live** (CEF devtools, this session, immediately following ADR-0026's findings):

1. From `SharedJSContext`, located `react/jsx-runtime` via the same module-cache walk
   this repo already uses elsewhere (`resolveClassMap`'s technique, generalized) — found
   at webpack module key `3326`, matching the number in SteamHunter's own code comment
   exactly.
2. Wrapped its `jsx`/`jsxs` with a call counter, reset it to 0, then interacted with the
   Big Picture popup **only** (arrow-key focus navigation, no desktop interaction at all):
   the counter reached **9,526**. Big Picture's own rendering measurably, heavily calls
   through the exact module instance patched from `SharedJSContext`.
3. Wrapped again to log any intercepted element whose `props` contained an `appid` key,
   then opened a real game's app-details page inside Big Picture via genuine
   `Input.dispatchKeyEvent` (not synthetic navigation — the same rigor ADR-0026 required
   of itself). Captured repeated samples of the live `appid`, directly off intercepted
   props, the instant Big Picture rendered that page — no DOM presence, no text-landmark
   anchor, no fiber walk needed.
4. `beforePatch` and `findModuleByExport` are confirmed present in this repo's own
   installed `@steambrew/client@5.8.5` (`build/utils/patcher.d.ts`,
   `build/webpack.d.ts`) — no SDK patch or newer version needed. SteamHunter's one vendored
   patch (`patches/@steambrew%2Fclient@5.8.patch`) only removes duplicate global
   `.d.ts` declarations (a compile-time conflict), and does not touch either function's
   runtime implementation.

**This does not overturn ADR-0023.** `window.webpackChunksteamui` inside the Big Picture
popup is still confirmed `undefined` (re-checked live, same result as ADR-0023/0024/0026)
— Steam's _own_ application code (the section registry, `CAppDetailsSections`,
`CAppSpotlightStore`, all of module `68854` and friends) is still genuinely compiled into
a bundle-local module cache, unreachable from `SharedJSContext`. What's different is
`react/jsx-runtime`: a generic vendor dependency, evidently loaded once and shared across
both bundles rather than duplicated per-bundle (consistent with any normal webpack
multi-entry build that dedupes common libraries into a shared chunk). ADR-0023's
investigation only ever checked `webpackChunksteamui` for reachability; it never checked
whether _any_ module was shared, because nothing suggested looking for one. Rungs 2–3 of
the reuse ladder (feed Steam's store, render Steam's real component) still do not apply
to Big Picture's _own_ components for that reason — but intercepting React's own element
creation turns out to be a viable rung of its own, sitting between "feed the store" and
"clone the DOM."

### Decision

Replace `gamepad-app.tsx`'s location-watching entirely with a `jsx`/`jsxs` patch that:

1. Locates `react/jsx-runtime` once via `findModuleByExport`, the same signature-based
   resolution this repo already uses for everything else (never a raw module id — ids
   reshuffle between builds; `AGENTS.md`'s existing rule already covers this).
2. Filters intercepted calls for the specific component shape that carries a non-Steam
   `appid` in Big Picture's app-details view (needs a live probe, analogous to
   `resolveClassMap`'s work, to find a stable filter — e.g. a prototype/displayName
   check, not `'appid' in props` alone, which is too broad and will catch unrelated
   components across all of Steam's UI).
3. On a match for a non-Steam appid, drives `gamepad-app.tsx`'s existing
   `patch()`/`unpatch()` — the render side (clone Steam's summary DOM shape, append into
   the popup's document) is unaffected by this ADR and stays exactly as ADR-0024 built
   it. Only the _signal_ that decides when to patch changes, from a `location` poll to a
   `jsx`-call interception.
4. Optionally, further out: SteamHunter's technique goes beyond reading props — it also
   _rewrites_ the intercepted `(type, props)` before React uses them (adding a whole tab
   to an existing tab array). That opens a path to rendering directly into Big Picture's
   own component tree — closer to rung 3 (render Steam's real component) in spirit —
   rather than `gamepad-app.tsx`'s clone-and-hide (rung 4). Left for a follow-up decision,
   not bundled into this ADR: the appid-detection fix is independently valuable and
   should not wait on deciding how far to push the render side.

### Consequences

- Resolves ADR-0026 with a strictly better mechanism than either option it left open: no
  fragile text-landmark anchor, no shipping Big Picture inert.
- **New risk class, distinct from the class-name risk already accepted elsewhere.**
  `beforePatch`ing a shared runtime function is a global, always-on interception of
  _every_ element Steam's UI creates anywhere (confirmed: 9,526 calls from a few
  keypresses). The filter in step 2 must be cheap and must fail closed — a bug here
  doesn't just skip our feature, it runs on every element Steam ever renders, desktop
  included. `AGENTS.md`'s "always keep a graceful fallback" rule applies with more force
  here than to any other resolved-signature lookup in this codebase.
- `setInterval`-based re-patch-if-swapped (SteamHunter's own pattern, `1000`ms) is worth
  adopting verbatim: they note in comments this handles an observed unpatch/swap on first
  game launch of a session — a real, previously-unknown Steam behavior worth carrying
  into our own knowledgebase rather than rediscovering later.
- `docs/plugins.md`'s reuse ladder gets a new named technique alongside "clone DOM across
  windows" (ADR-0024) — this is not a replacement for that ladder's rungs, it's an
  additional tool for the specific case for "a shared vendor module reaches a window
  believed unreachable," worth checking before assuming a bundle boundary is a hard wall.
- Desktop is unaffected — `steam/summary.ts`'s existing store-feeding approach
  (ADR-0009/0022) remains preferred there; this ADR is scoped to Big Picture, where that
  approach is confirmed unavailable (ADR-0023).

### Verification

Implemented as `watchGamepadAppid()` in `steam/gamepad-appid.ts`, replacing the Gamepad
branch's `onLocationChange` call in `index.tsx`; `gamepad-app.tsx`'s render side
(clone-and-hide, ADR-0024) is unchanged. Filter used: `typeof props.appid === 'number' &&
Array.isArray(props.rgSections)` — narrower than `'appid' in props' alone, which live
testing showed matches a recommended-games carousel, a friends-currently-playing widget,
and a page pager tracking `previousAppid`/`preloadAppid`, dozens of false positives per
navigation. `rgSections`isolates the one component that receives the page's section
list alongside its appid; verified on two different non-Steam games, exactly one match
per navigation, zero false positives while arrow-key-browsing the library grid. The
intercepted function's own`.name` is deliberately not part of the filter — the same
one-letter minified name matched both the target component and an unrelated
"friend + playtime" widget on different renders.

Getting from "the signal fires with the right appid" to "the strip actually renders"
surfaced two more, separate, pre-existing bugs in `gamepad-app.tsx` — both real,
independent of this ADR's own mechanism, and never caught earlier because nothing had
ever driven `patch()` against genuinely rendered Big Picture content before this smoke
test:

1. **Case-sensitive text match, matched against the wrong case.** `patch()`'s anchor
   search looked for `el.textContent?.trim() === 'ACTIVITY'`. Live inspection found the
   real DOM text is `"Activity"` (title case) on a `TabTitle`-classed span with
   `text-transform: uppercase` applied — the same pattern already documented for
   desktop's Post-Game Summary header (steam-components.md). `textContent` reflects the
   DOM, not the CSS-rendered text, so the exact-case match could never succeed,
   regardless of timing. Fixed to match case-insensitively.
2. **A render-timing race the anchor search didn't account for.** Even after fixing (1),
   an immediate anchor search still failed live, repeatedly, while the _exact same query_
   run by hand moments later succeeded. `watchGamepadAppid`'s signal fires from inside
   React's own `jsx()` call — before React commits that tree to the real DOM — and Big
   Picture's page transitions carry their own animation on top of that. `findAnchor()`
   now polls (starting at 200ms, up to ~8s total — an initial ~1.5s budget was verified
   live to still be too short) instead of looking once. Its retry loop also does not
   abort on the first exception: an earlier version did, and that alone explained every
   observed failure during this fix's own testing — each one logged within about one
   retry interval of the navigation event, nowhere near the actual multi-second budget,
   because a single transient DOM-query error (plausible mid-transition) discarded the
   whole retry budget on attempt one. It now retries through ordinary errors and only
   stops early if `window.closed` is genuinely true.

**Live verification, reproduced twice from a clean Steam restart**: entered Big Picture,
browsed Library → Non-Steam → a real non-Steam game (AM2R, appid `4263274102`, confirmed
to have 4 real screenshots + clips beforehand) via genuine `Input.dispatchKeyEvent`
input, not synthetic navigation. The real summary strip rendered inside the real
ACTIVITY tab, with real clip/screenshot URLs (`gamerecordings/clips/clip_1831062284...`,
matching AM2R's real gameid) and real clip durations (0:23, 0:03, 0:15) visible in the
live DOM.

One methodological note worth keeping: several apparent failures during this session's
debugging turned out to be artifacts of repeated `SetUIMode` toggling and popup
open/close cycles corrupting live state between test runs (stale `window` references,
a popup that reports itself open via `UIMode` but has no reachable window), not bugs in
the code under test — resolved each time by a full Steam restart rather than continued
toggling. `Runtime.enable` on a fresh CDP connection was also observed replaying
buffered console history from earlier in the session, which briefly produced a false
impression of a persistent bug; live DOM/state queries (not console log timestamps) were
the reliable signal throughout.

---

## ADR-0028: Big Picture's clone is visually broken, and the fix is to go looking for real components, not to keep patching the clone

**Status:** Proposed · 2026-09-21 · found by the user inspecting ADR-0027's verified
render on real hardware; a fix is deliberately **not** included in this ADR — see
Decision

### Context

ADR-0027 got the summary strip rendering in Big Picture's real ACTIVITY tab, verified by
DOM inspection. Live inspection is not the same as looking at it: the user's own
screenshot of the rendered result, next to a screenshot of desktop's native Post-Game
Summary for comparison, shows the Big Picture render is badly broken —

- **No "Post-Game Summary" header text visible at all** (the code does render one — see
  below for why it doesn't show).
- **No day grouping** ("Yesterday"), unlike native.
- **Tiles sit flush against each other with no spacing or consistent rounding**,
  unlike native's clearly separated, evenly-rounded cards.
- **A raw Xbox-controller glyph sits inline in the tile row** as if it were a capture
  thumbnail — not something `SummaryStrip` renders; almost certainly a native Steam
  UI element now colliding with our injected content in the same container.
- Overall it reads as a debug strip glued onto the page, not a Steam-native section —
  exactly the failure mode AGENTS.md's reuse ladder warns about: _"If you are measuring
  pixels to match Steam, you are probably on the wrong rung."_

**Root cause, found by re-reading `patch()`'s anchor logic against the screenshot
(not yet re-verified live — this is a strong, specific hypothesis, not a repeated live
observation the way ADR-0025–0027's findings were):**

```ts
const tabStrip = [...window.document.querySelectorAll("*")].find(
    (el) =>
        el.childElementCount === 0 &&
        el.textContent?.trim().toLowerCase() === "activity",
);
const anchor = tabStrip?.closest("[class]")?.parentElement;
```

`tabStrip` is the leaf `<span class="TabTitle">Activity</span>`. `Element.closest()`
matches the starting element itself if it satisfies the selector — and `tabStrip`
already has a `class` attribute — so `tabStrip.closest('[class]')` returns `tabStrip`,
not some ancestor content wrapper. `.parentElement` of that is therefore the **tab
button** in the tab strip (confirmed live during ADR-0027's testing, though not
recognized as a bug at the time: `_3eEbSktrstBdLk0dVpnKVI Tab ... Selected ...
RightAddon Panel Focusable`), not the ACTIVITY tab's _content panel_ below it. The
entire multi-tile `SummaryStrip` is being appended **inside a small tab-button-sized
UI element in the tab bar itself**, not into the page body. Every symptom in the
screenshot is consistent with this: content clipped by the tab button's own height, no
room for the header, and a real Steam icon from that same row now sharing space with
our injected tiles.

This is a real, independent, pre-existing bug in the anchor logic (present since
ADR-0024, never visible before ADR-0027 because nothing had ever rendered into it) —
distinct from the two `gamepad-app.tsx` bugs ADR-0027 already found and fixed
(case-sensitive text match, retry timing).

### The bigger question this raises

A wrong anchor selector is a one-line fix. But it's not the real issue: even anchored
correctly, `gamepad-app.tsx` is a **hand-built clone** (rung 4 of AGENTS.md's reuse
ladder) with inline styles guessed to _look like_ native — the exact pattern AGENTS.md
already warns is fragile and high-maintenance, backed by this same repo's own history
(the desktop Post-Game Summary was cloned once, passed testing, and was still discarded
for a resolved-real-component approach — ADR-0022). Getting the clone's spacing,
grouping, and header right by hand is real, ongoing work, and it will still drift from
native on the next Big Picture UI refresh.

**ADR-0027 changes what's worth trying before committing to more clone work.** Rungs
2–3 of the reuse ladder (feed Steam's store, render Steam's real component) were ruled
out for Big Picture by ADR-0023 on the grounds that `webpackChunksteamui` — Steam's own
application code, where `CAppDetailsSections`/`CAppSpotlightStore` live — is genuinely
bundle-local and unreachable from `SharedJSContext`. That finding still holds; ADR-0027
did not overturn it. But ADR-0023's investigation only ever checked _that one_ module
for shared-ness, because nothing at the time suggested checking others. ADR-0027 found,
by accident of investigating a completely different problem, that `react/jsx-runtime` —
a generic vendor dependency — **is** shared across both bundles. That was not an
isolated fact about React specifically; it's evidence that Big Picture's build shares
_some_ modules and not others, and the boundary was never mapped.

The question worth answering before writing more clone code: **do `@steambrew/client`'s
own exported components** (`Panel`, `Tabs`, `Focusable`, `Carousel`, `SuspensefulImage`
— the same building blocks desktop already prefers per `docs/plugins.md`'s reuse ladder)
**also resolve to shared module instances reachable from Big Picture**, the same way
`react/jsx-runtime` turned out to be? If so, `gamepad-app.tsx` could build its strip out
of Steam's _real_ React components — real spacing, real focus/keyboard behavior, no
hand-tuned CSS to keep in sync — rather than a clone. That would take Big Picture from
rung 4 to rung 3 of the ladder for the first time, closing exactly the gap this ADR's
screenshot exposes, and durably: a resolved real component cannot visually drift the
way a clone can.

### Decision

**Proposed, not decided or built.** Two things need doing, in order, before writing any
more Big Picture UI code:

1. **Fix the anchor bug** (`tabStrip.closest('[class]')` matching itself) — small,
   mechanical, no new investigation needed. Likely fix: walk up from `tabStrip` past
   the tab button to the tab strip's own container, then find _its_ sibling content
   panel (needs a fresh live probe of the DOM around the tab strip to find the right
   landmark — not guessed from memory, per this codebase's own verification standard).
2. **Investigate shared-module reachability for `@steambrew/client`'s own components**,
   the same way ADR-0027 investigated `react/jsx-runtime`: from `SharedJSContext`,
   resolve one of the SDK's exported components (or the module it comes from) and test
   — with a live marker, not assumption — whether the _same instance_ is what Big
   Picture's own bundle uses when it renders a `Tabs`/`Panel`/`Focusable`. If yes, this
   ADR converts to Accepted with a rung-3 rebuild of `gamepad-app.tsx`. If no (Steam's
   own component library turns out to be bundled per-entry rather than shared, unlike
   raw React), the clone approach stands, but _at minimum_ gets (1)'s fix and closer
   attention to matching native spacing/grouping by measurement (steam-styles.md's
   existing "measure, don't guess" standard, ADR-0021) rather than the current
   placeholder styling.

### Consequences

- Until either is done, Big Picture's summary strip should be treated as **functionally
  verified, visually not release-ready** — TASK.md and CHANGELOG.md should say so
  plainly rather than imply the ADR-0027 milestone means the feature looks native.
- If (2) succeeds, it's a second instance of the same lesson ADR-0027 taught: a bundle
  boundary believed absolute (ADR-0023) can hide exceptions worth checking for, and the
  method (a live cross-window marker test) is now established and repeatable, not a
  one-off trick.
- If (2) fails, no time is lost — the clone was always going to need this attention, and
  a confirmed "no" is itself useful, permanent knowledge (matching how ADR-0023's
  original "unreachable" finding, though later narrowed by ADR-0027, was still correct
  and useful for the specific module it checked).

---

## ADR-0029: Big Picture runs in `SharedJSContext` via React Portal; native component rendering and store feeding supersede DOM cloning

**Status:** Accepted · 2026-09-22 · supersedes [ADR-0023](#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one),
[ADR-0024](#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store), and
[ADR-0028](#adr-0028-big-pictures-clone-is-visually-broken-and-the-fix-is-to-go-looking-for-real-components-not-to-keep-patching-the-clone) ·
validates the question raised in ADR-0028 (step 2) with a complete resolution

### Context

ADR-0023 concluded Big Picture was a separate bundle with an isolated module cache because evaluating
`window.webpackChunksteamui` and `window.appStore` inside the `Steam Big Picture Mode` popup window returned
`undefined`. ADR-0024 accepted that finding and introduced `renderers/gamepad-app.tsx` — a hand-built clone
appended into the popup's document. ADR-0027 discovered `react/jsx-runtime` was surprisingly shared. ADR-0028
then observed that the hand-built clone was visually broken (injected into a small tab-button element rather than
the content panel, lacking native focus rings and spacing), and proposed investigating whether Steam's own
components were shared across the boundary.

**Verified live via CEF DevTools (2026-09-22):**

1. **The popup window contains zero scripts.** `Steam Big Picture Mode` is an `about:blank` popup containing
   only `<div id="popup_target"></div>`. The reason `webpackChunksteamui` was undefined there is not because
   it is a separate bundle — it has **no bundle at all**.
2. **Big Picture is rendered from `SharedJSContext` via `ReactDOM.createPortal`.** Steam's main runtime in
   `SharedJSContext` mounts Gamepad UI directly into the popup's `#popup_target`.
3. **The React Fiber trees are identical.** Comparing `#root` in `SharedJSContext` with `#popup_target` in
   the Big Picture popup showed matching React Fiber instance IDs (`__reactContainer$2x6thximn4h` and
   `__reactFiber$2x6thximn4h`). All Big Picture React components execute in `SharedJSContext`.
4. **The section registry is shared.** Big Picture's tabbed page component consumes `CAppDetailsSectionsContext`
   (`re.AC`), whose parent `Xd.kg` renders `T.N_` (`CAppDetailsSections`, module `59856`). Its `GetSections()`
   method is the **exact same function** patched for Desktop in ADR-0022.
5. **The native Post-Game Summary is already built into Big Picture.** Function `at(e)` in module `3375`
   (the "ACTIVITY" tab renderer) contains:
    ```jsx
    {
        e.setSections.has("postgamesummary") && <Ge.T details={e.details} />;
    }
    ```
    `Ge.T` (module `53074.T`) is the **identical native Post-Game Summary component** that Desktop uses.
    It reads directly from `window.appSpotlightStore.GetPostGameSummary(appid)`.
6. **Populating `appSpotlightStore` makes Steam render natively in Big Picture.** Tested live on AM2R
   (appid `4263274102`): restoring `postgamesummary` in `GetSections` and pushing capture events into
   `appSpotlightStore` in `SharedJSContext` instantly caused Big Picture to render Steam's genuine native
   `GamePlaySummaryContainer`, `FocusRingRoot`, `GamePlaySummaryHeader`, `PageableContainer`, and
   `SummaryCarouselContainer`. Controller D-pad navigation, focus rings, and media clicks all functioned
   natively. Tested clean degradation on ActRaiser (appid `2788628389`, no captures): `hasSummary: false`,
   stock page with zero errors.

### Decision

- **Delete `renderers/gamepad-app.tsx` completely.** The hand-built clone (rung 4 of AGENTS.md's reuse ladder)
  is retired.
- **Feed Steam's store for Big Picture Mode using the exact same path as Desktop.** In `frontend/index.tsx`,
  `PopupType.Gamepad` simply calls `patchLibraryApp(appid)` and `unpatchLibraryApp(appid)`.
- **Rely on Steam's native component rendering.** Steam's `Ge.T` renders in Big Picture's "ACTIVITY" tab
  automatically, with native focus highlights, controller navigation, date grouping, and responsive layout.

### Consequences

- **Deletes ~280 lines of hand-built clone code** and unnecessary CSS overrides.
- Completely resolves the visual breakage and tab-button anchor collision diagnosed in ADR-0028.
- Big Picture gains full controller support (focus rings, D-pad carousel scrolling, LB/RB navigation) with
  zero ongoing maintenance or risk of UI drift.
- Unifies the plugin architecture: a single store-feeding pipeline serves both Desktop and Big Picture Mode.

---

## ADR-0030: Native Activity Feed restored via `appActivityStore` injection and `StoreItemCache` stubbing

**Status:** Accepted · 2026-09-22

### Context

Steam's app-details view contains an `activity` section (rendering chronological per-day activity: screenshots,
recordings, status updates, partner announcements). Like `postgamesummary`, Steam disables it for non-Steam
games by default in `CAppDetailsSections.GetSections()`:
`e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"])`.

While restoring the section string `'activity'` was straightforward, feeding it was blocked by four deep runtime
constraints:

1. **The Store Visibility Guard (`lt` in module 80478):**
   Steam's per-event renderer starts with:
    ```js
    const [storeItem] = lt(event.appid, D.A.k_DataRequest_Assets);
    if (event.appid && (!storeItem || !storeItem.BIsVisible())) return null;
    ```
    For a non-Steam game, Steam's `StoreItemCache` (`b.f4`) has no store entry, so `lt()` returns `undefined` and
    the event body renders as an empty `<div></div>`.
2. **The AppID Bitwidth / IEEE 754 Precision Trap:**
   Event base class `E` (module 12750) computes its appid as `get appid() { return Number(this.gameid); }`.
   Non-Steam shortcuts use 64-bit composite gameids (`(appid << 32) | 0x02000000`). When converted to a
   JavaScript IEEE 754 64-bit float via `Number()`, precision is lost above $2^{53} - 1$ (e.g. AM2R's gameid
   `18310622842007322624` truncates to `18310622842007323000`). Any store lookup keyed by `event.appid` fails
   to find the original 32-bit appid.
3. **The `GetLatestEventTime` Contract on `CActivityDay`:**
   Steam's day renderer `st` (module 80478) expects day instances to implement `day.GetLatestEventTime()` to format
   the React key and the date headline (`V._l(day.GetLatestEventTime(), true)`). If missing from a custom day
   object or fallback, React crashes with `TypeError: e.GetLatestEventTime is not a function`, caught by Steam's
   error boundary.
4. **Workshop Media Lookup:**
   The native `FilePublished_Screenshot` component resolves thumbnail and full image URLs via
   `workshopStore.GetPublishedFileRecord(publishedFileId)`. Without entries in `workshopStore.m_mapPublishedFiles`,
   the image renders as a broken asset.

### Decision

Implement `publishActivity(appid, gameid)` in `frontend/steam/activity.ts` using Steam's own stores:

1. **In-Memory StoreItem Stubbing:**
   Inject a minimal, visible in-memory `StoreItem` stub into `StoreItemCache.m_mapApps.set(appid, stub)`.
   The stub provides `BIsVisible: () => true`, `BContainDataRequest: () => true`, `appid`, and the shortcut name.
   It makes zero network requests and is strictly scoped to non-Steam appids (`appid >= 0x8000_0000`).
2. **Explicit 32-bit AppID Override:**
   Instantiate the native screenshot event class `V` (from `appActivityStore.m_mapAppActivity`'s template event,
   or fallback `FilePublished_Screenshot`, event type 13). Assign `event.gameid = appid.toString()` and define
   an explicit property override `Object.defineProperty(event, 'appid', { get: () => appid })`. This guarantees
   `event.appid` returns the exact 32-bit integer matching `StoreItemCache`.
3. **Full `CActivityDay` Interface Contract:**
   Ensure each day container provides `GetLatestEventTime()`, `GetEarliestEventTime()`, `SortEvents()`, and
   `BHasEvents()`, grouped by local midnight (`getLocalMidnight()`).
4. **Loopback Workshop Injection:**
   Register each screenshot in `workshopStore.m_mapPublishedFiles.set(publishedFileId, record)` with
   `m_strPreviewUrl = strUrl`, pointing to Steam's native loopback screenshot URL.
5. **Single-Store Publishing & Teardown:**
   Publish in parallel with `publishSummary()`. When navigating away or unmounting, `clearActivity(appid)` cleans
   `appActivityStore.m_mapAppActivity`, `StoreItemCache.m_mapApps`, and `workshopStore.m_mapPublishedFiles`.
6. **Clean Layout Hierarchy:**
   Replace `'nonsteam'` (`REPLACED_SECTIONS = ['nonsteam']`) only when captures exist (`appsWithContent.has(appid)`).
   When an app has captures, the stock "Information Unavailable" box is dropped, allowing the Left Column to cleanly
   render Post-Game Summary followed by the per-day Activity Feed. Games with 0 captures cleanly retain the stock
   disclaimer with zero errors.

### Consequences

- **Native Activity Feed renders on both Desktop and Big Picture Mode** with zero hand-built DOM.
- Shows real dated cards ("cannoliGun shared 2 screenshots"), clickable carousel thumbnails, active image viewers,
  and "Load More Activity" buttons.
- Fully controller-navigable in Big Picture Mode's ACTIVITY tab.
- In-memory store cache stubbing is temporary and completely isolated to non-Steam appids, with zero network side effects.

---

## ADR-0031: Decouple `GetGameID` from `BIsModOrShortcut` on `AppOverview.prototype` and enforce $O(1)$ prototype lookups

**Status:** Accepted · 2026-09-23

### Context

Steam's native Game Info tab in Big Picture Mode (inner component `k` in module `15448`) suppresses rich metadata
(descriptions, developer/publisher credits, release dates, and category badges) when `overview.BIsModOrShortcut()`
returns `true`, rendering the `#AppDetails_Shortcut_Explanation` placeholder instead.

To bypass this suppression and render enriched metadata, `AppOverview.prototype.BIsModOrShortcut` was hooked to return
`false` for enriched shortcuts. However, this introduced two severe regressions:

1. **The "YOUR STUFF" Tab Media Regression (Cross-Tab Prototype Coupling):**
   Steam's native `AppOverview.prototype.GetGameID()` implementation delegates directly to `BIsModOrShortcut()`:

    ```javascript
    GetGameID() { return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString(); }
    ```

    When `BIsModOrShortcut()` returned `false`, `GetGameID()` fell back to `this.appid.toString()` (`"4263274102"`).
    The "YOUR STUFF" tab's Media section (module `57150`, component `Ae.E`) queries captures via
    `overview.gameid` (which invokes `GetGameID()`). Because shortcut screenshots (`screenshots.vdf`) and clips
    (`window.g_GRS`) are indexed by the 64-bit composed ID (`"18310622842007322624"`), querying by `appid.toString()`
    returned 0 items, collapsing the Media section into the empty "You can take a screenshot..." placeholder.

2. **The 30-Second Big Picture Navigation Freeze ($O(N)$ Stack Inspection in Hot Prototype Paths):**
   An earlier attempt to detect whether `BIsModOrShortcut()` was being called by the Game Info component inspected
   the call stack via `new Error().stack`. Because `BIsModOrShortcut()` is evaluated hundreds of times per second
   across React render passes, MobX reactions, and controller navigations, generating V8 stack traces completely
   froze the JavaScript main thread.

### Decision

1. **Decouple `GetGameID` on `AppOverview.prototype`:**
   In `steamgriddb-artwork/frontend/steam/game-info-patch.ts`, walk the prototype chain (`ensureAppOverviewHooked`)
   and hook `GetGameID` alongside `BIsModOrShortcut`:
    ```typescript
    curr.GetGameID = function () {
        if (this.m_gameid) return this.m_gameid;
        return origGetGameID.apply(this, arguments);
    };
    ```
    Whenever an AppOverview has `m_gameid` (which shortcuts always do), `GetGameID()` is guaranteed to return the
    64-bit composed ID regardless of the value returned by `BIsModOrShortcut()`.
2. **Enforce Instant $O(1)$ Prototype Set Lookups:**
   Replace all call stack inspections with an in-memory `Set<number>` lookup (`enrichedAppIds.has(this.appid)`).
   Hooks on prototype methods must strictly execute in constant time ($O(1)$) with zero stack evaluation, regex parsing,
   or DOM queries.
3. **Guard Section Registry Restoration in Core:**
   In `non-steam-games-activity/frontend/steam/sections.ts`, update `isShortcut(overview)` to check
   `overview.appid >= 0x8000_0000 || overview.BIsModOrShortcut()`, ensuring core detail sections
   (`postgamesummary`, `activity`) are never suppressed when metadata hooks bypass `BIsModOrShortcut()`.

### Consequences

- **Both "YOUR STUFF" and "GAME INFO" tabs function simultaneously** with 100% data integrity.
- "YOUR STUFF" displays all screenshots and clips with duration badges and item counts.
- "GAME INFO" displays capsule art, smart summary descriptions, developer/publisher credits, release date, and category badges.
- Big Picture navigation latency dropped from 30+ seconds down to 27 milliseconds.

---

## ADR-0032: Merge `non-steam-games-activity` and `steamgriddb-artwork` into `steam-cartridges`

**Status:** Accepted · 2026-09-24 · **Supersedes [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins) in part** (the scope of the core plugin; the provider split for third-party plugins stands) · **Amended by [ADR-0036](#adr-0036-default-bucket-is-steam-store-with-a-web-fallback-per-collection-title-rules)** ("no bucket, no network" is replaced: the default bucket is Steam Store)

### Context

Two of our plugins patch the same app-detail page for the same shortcuts and
already depend on each other's behaviour at runtime: `steamgriddb-artwork` hooks
`AppOverview.prototype.BIsModOrShortcut`/`GetGameID`, and
`non-steam-games-activity/frontend/steam/sections.ts` had to add an
`appid >= 0x8000_0000` guard to survive that hook
([ADR-0031](#adr-0031-decouple-getgameid-from-bismodorshortcut-on-appoverviewprototype-and-enforce-o1-prototype-lookups)).
They also ship five byte-identical files (`backend/_lib/*`, `steam_paths.lua`,
`frontend/steam/jsx-hook.ts`), one near-identical one (`gamepad-appid.ts`, only
its jsx label differs) and a diverged one (`shortcuts.lua`; the artwork copy also
parses shortcut `tags`). Each plugin installs its own jsx wrapper for the same
Big Picture appid signal. The planned Steam Store and achievements features
(docs/steam-cartridges.md) need both halves at once.

ADR-0012 says the core never reaches the network. The artwork half does
(IGDB, SteamGridDB), and the Steam Store bucket will (store search, `appdetails`,
CDN).

### Decision

- One plugin, `steam-cartridges` ("Steam Cartridges"), built from
  `non-steam-games-activity` as the base. The artwork plugin's modules move in
  unchanged; duplicates collapse to one copy. The merge (P1) is refactor-only.
- **The network rule is restated, not dropped:** the capture features (sections,
  summary, activity, library grid) stay zero-network and apply to every
  shortcut. Network modules run **only for games the user has placed in a source
  bucket** ([ADR-0033](#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)),
  and the default bucket is `none`. A fresh install with no configuration makes
  no network request.
- Persistent plugin data lives in `<steam>/millennium/config/steam-cartridges/`
  (precedent: `enhanced-achievements` themes), never in the plugin folder, which
  `dev.ps1` deletes on every deploy. The folder name is the base name, so the
  `-dev` copy and the release share data. Settings use the Millennium
  Configuration API through one `settings.ts` carrying the #903 workaround.
- Secrets (SteamGridDB key, Twitch credentials) are read from that data folder
  at runtime, are never logged, and never enter the repo. A one-time migration
  copies them and `library_metadata.json` from the legacy locations.
- `non-steam-games-activity` and `steamgriddb-artwork` are retired: `dev.ps1`
  disables both (released and `-dev`) and removes their `-dev` folders. They
  must never run beside `steam-cartridges`: the section registry, store stubs
  and prototype hooks would be installed twice.
- The external provider contract ([ADR-0013](#adr-0013-providers-return-data-the-core-renders-it),
  [ADR-0014](#adr-0014-providers-are-isolated-and-fail-silently)) is unchanged for
  third-party plugins. Internal source modules follow ADR-0014's status
  semantics (`unsupported` is silent).

### Consequences

- One jsx wrapper instead of two for the Big Picture appid signal; one settings
  page; one backend.
- The plugin is no longer "the core that never touches the network". The
  guarantee users get instead: no bucket, no network.
- Rolling back means re-enabling the two old plugins; their data is copied, not
  moved, so it is still in place.
- Cost: one larger plugin to regression-test. Mitigated by P1 changing no
  behaviour and by Routines 1–3.

---

## ADR-0033: Exclusive source buckets, resolved in the frontend from Steam's collections

**Status:** Accepted · 2026-09-24 · **Amended by [ADR-0035](#adr-0035-local-game-info-is-a-capture-tier-feature-buckets-gate-only-fetching)** (buckets gate fetching, not the display of local Game Info; the "Upgrading … hides existing Game Info" consequence below is reversed) · **Amended by [ADR-0036](#adr-0036-default-bucket-is-steam-store-with-a-web-fallback-per-collection-title-rules)** (default `steam-store`, not `none`; `none` becomes a per-collection choice; rules gain title patterns)

### Context

Each shortcut needs one answer to "where do its metadata and artwork come from":
Steam's own data for a game that is on Steam (**Steam Store**), or web scrapers
for everything else (**Web Scraping**). Users already group shortcuts into Steam
collections (`Retro`, `SNES`, `My Epic Games`), so collections are the natural
unit. The user decided (docs/steam-cartridges.md § 9): games in no assigned
collection are ignored, and no emulator guessing.

Collection membership exists only in Steam's frontend (`collectionStore`); the
Lua backend cannot see it.

### Decision

- Buckets: `steam-store`, `web-scraping`, `none`. The fallback is fixed at
  `none` (user decision 1) and is not a setting.
- Config is **one ordered list of collection assignments**
  (`[{ id, name, bucket }]`) plus per-game overrides. A collection appears at
  most once, so a collection cannot sit in both buckets by construction. The
  list order is the precedence order. Collections are keyed by Steam's
  collection **id**; `name` is kept for display and to re-find a renamed or
  re-created collection.
- Resolution for a shortcut: per-game override, else the first assignment in list
  order whose collection contains the game, else `none`. A game in collections
  assigned to different buckets is a **conflict**: it still resolves by that
  order, and the settings page lists it.
- **Persisted data is non-Steam only** (2026-09-24 addendum). The config holds
  the ordered collection list (`id`, `name`, bucket: the user's own grouping, not
  game data), and per-game overrides keyed by **shortcut** appid. Collection
  membership is never stored (read live from `collectionStore`), and no native
  Steam app id, title or metadata is ever written to the config.
- Only shortcuts (`appid >= 0x8000_0000`) are ever bucketed. Native apps inside
  a collection are skipped.
- Resolution runs in the frontend (`features/buckets/`), lazily when an app page
  is viewed and once at startup for the metadata preload. It is a pure function
  over (config, membership), not a hot-path hook. The backend never decides a
  bucket; the doc's `backend/buckets.lua` is dropped.
- Buckets gate only the **source features** (metadata, artwork, later
  achievements). The capture features apply to every shortcut regardless.
- Leaving a bucket reverts that game's in-memory enrichment on its next view.
  Persisted artwork is removed only by the explicit per-game clear/undo
  (P3), and only artwork the plugin recorded as its own.

### Consequences

- "Changing a collection reflects without restart" comes for free: the next
  view re-resolves. No collection observer is needed for correctness.
- Upgrading from `steamgriddb-artwork` hides existing Game Info enrichment until
  the user assigns collections. That follows from decision 1; the settings page
  says how many games have cached metadata but no bucket.
- Cost: the backend trusts the frontend to call web sources only for
  web-scraping games. Acceptable: both run in the same plugin.
- Reversal would need a new ADR if membership ever has to be known in Lua (for
  example to prefetch while Steam is closed).

---

## ADR-0034: Achievement sourcing per bucket; locked-only for unowned Steam games

**Status:** Accepted · 2026-09-24 · P0 trace T4 named the keyless schema source

### Context

Phase 5 of docs/steam-cartridges.md shows achievements for shortcuts through
Steam's own UI (the `achievements` section, `AppDetailsStore.GetAchievements`,
`CGamePlaySession.AddAchievement`, `appAchievementProgressCache`;
steam-components.md § Native achievement UI). Sources differ by game: a Steam
Store bucket game has a native appid whose schema Steam knows; a RetroArch game
has RetroAchievements; most other games have nothing. Unlock state for a Steam
game exists only if the user owns it on Steam (user decision 2).

Licenses of the references (checked 2026-09-24): `PlayniteAchievements` MIT,
`game-data-linker` MIT, `Playnite-LocalAchievements-Plugin` GPLv3.

### Decision

- Source by bucket and identity: Steam Store game with a resolved native appid →
  **Steam native**; Web Scraping game launched through RetroArch with a resolved
  RA GameID ([ADR-0008](#adr-0008-resolve-romgameid-by-cached-history-first-manual-override-last))
  → **RetroAchievements**; anything else → no source, and nothing is rendered
  (no section, no empty state, no error).
- Steam native schema: Steam's client stores first (keyless). Then keyless public
  endpoints. A Steam Web API key is optional and only extends coverage. P0 T4
  chose store `appdetails` `achievements` (total plus highlighted names and icons).
- Unlock state: only from Steam's own per-user caches for an **owned** native
  appid. Otherwise the list renders locked-only, labelled "no unlock tracking"
  (decision 2). Unlocks are never inferred.
- RetroAchievements credentials come from `retroarch.cfg` (`cheevos_*`) at
  runtime and are never stored, copied or logged. Responses are cached on disk
  ([ADR-0007](#adr-0007-cache-retroachievements-responses-on-disk)).
- Sources are **internal modules** behind one registry
  (`{ id, supports(ctx), load(ctx) }`), not plugins discovered at runtime. Whether
  RA is later exposed via the external `Collect()` contract gets its own ADR.
- Ideas may be ported from the MIT references with attribution. No code from the
  GPLv3 LocalAchievements plugin.

### Consequences

- A user with no RA account and no Steam copy sees no achievements, which is
  correct rather than broken.
- An unowned Steam Store game shows a full but locked list. That is honest, and
  the label explains it.
- Cost: two schema paths (client store vs. endpoint) to maintain until P0 shows
  one is enough.

---

## ADR-0035: Local Game Info is a capture-tier feature; buckets gate only fetching

**Status:** Accepted · 2026-09-24 (user: Game Info must keep working for shortcuts; "ignore apps in no collection" must not remove behaviour that worked before) · **Amends [ADR-0033](#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)** · **Amended by [ADR-0036](#adr-0036-default-bucket-is-steam-store-with-a-web-fallback-per-collection-title-rules)** (local data also shows for a steam-store game until the store answers, and stays when it has no Steam match)

### Context

Before the merge, `steamgriddb-artwork` applied `library_metadata.json` to every
shortcut that had an entry, at startup and on every view. P2 (commit `123eb2b`)
gated **all** Game Info on the `web-scraping` bucket, including this local data. With
no buckets configured (the default), AM2R and 26 other shortcuts with cached
metadata lost their description, credits, release date and badges, and showed the
grey `#AppDetails_Shortcut_Explanation` box again. Verified live 2026-09-24: plugin
config `{}`, `bucketReport().games[4263274102] = { bucket: 'none', via: 'default' }`,
`unbucketedWithMetadata = 27`, no `descriptionsData`, `BIsModOrShortcut() === true`.
ADR-0033 had listed this as an accepted consequence; the render-bugfix then weakened
`scratch/check_all_tabs.js` check 4 to accept the grey box, which hid it.

The user decision "apps in no collection are ignored" was about **sources**: no
bucket, no network ([ADR-0032](#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges)).
Reading metadata the user already has on disk is neither a source nor a network call.

### Decision

- **Local tier (every shortcut, like captures):** an entry in the local metadata DB
  (`<steam>/millennium/config/steam-cartridges/library_metadata.json`) is applied to
  Game Info for every shortcut whose bucket is not `steam-store`, including `none`
  and `pending`. No network, no bucket needed. Preload at startup does not wait for
  collections.
- **Fetch tier (bucket-gated, unchanged):** only `web-scraping` games may call
  `GetGameMetadata` (IGDB). Only `steam-store` games use the store handler. `none`
  and `pending` never fetch.
- **Precedence:** `steam-store` data replaces local data while the game is in that
  bucket. Leaving `steam-store` reverts the store data and re-applies local data.
  Leaving `web-scraping` keeps local data (it is on disk); it only stops fetching.
- The pure rule lives in `features/game-info/policy.ts` (`gameInfoPlan`) with unit tests.

### Consequences

- Upgrading from `steamgriddb-artwork` keeps all existing Game Info. A shortcut that
  was never scraped stays grey until the user puts it in Web Scraping.
- "No bucket, no network" still holds.
- `scratch/check_all_tabs.js` check 4 again requires enriched Game Info for AM2R.
- Cost: two tiers write the same Game Info fields; `steam-store` must always win
  while assigned, which the precedence rule and its tests pin down.

---

## ADR-0036: Default bucket is Steam Store with a web fallback; per-collection title rules

**Status:** Accepted · 2026-09-24 (user decision A) · **Amends [ADR-0032](#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges)** (network rule), **[ADR-0033](#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)** (default, rule shape) and **[ADR-0035](#adr-0035-local-game-info-is-a-capture-tier-feature-buckets-gate-only-fetching)** (local tier for steam-store games)

### Context

ADR-0033 sent every shortcut outside an assigned collection to `none`, and
ADR-0032 turned that into "no bucket, no network". With that default,
*Jotunnslayer: Hordes of Hel* (an Epic copy of native app 2820820) shows local
IGDB data for the wrong product (the Conan DLC: its description and an
Apr 8, 2026 release date) and none of Steam's own data. Parity baseline, live
2026-09-24: 3 PASS / 10 FAIL (superseded 2026-09-26: 17 PASS / 0 FAIL, see TASK.md).

The user decided (2026-09-24): games in no collection are still bucketed; the
default is Steam Store; metadata scraping is the fallback when there is no Steam
match; Steam Store has priority; buckets stay exclusive per collection; each
collection can be tuned with inclusion and exclusion rules.

Also found live: our Game Info enrichment writes store categories onto
`AppOverview`, and Steam's dynamic collections filter on categories (this
library has a "GAMEPAD SUPPORT" collection). A game's membership can change
because we enriched it.

### Decision

- Buckets stay `steam-store` | `web-scraping` | `none`. When no rule claims a
  shortcut, its bucket is **`steam-store`**. The default is fixed, not a setting.
- **Steam Store first.** A steam-store game with a Steam match (P3 order:
  manual mapping, then a unique known native, then an exact `storesearch` hit;
  emulator guard and rejections unchanged) gets Steam's own data. **No match**
  (no exact hit, suggestions only, emulator exe, rejected, negative-cached, or the
  store data failed to load) means a **web-scraping fallback** for that view:
  local Game Info plus the IGDB fetch, which still needs Twitch credentials. If
  the answer is not known yet (the title is missing), only local data is shown.
- **Config v2:** one ordered list of collection rules
  `{ id, name, bucket, include: string[], exclude: string[] }`, plus per-shortcut
  overrides. A collection appears once, so exclusivity holds by construction; the
  list order is the precedence. `bucket: "none"` means never fetch for that
  collection's games.
- **Title patterns**, kept minimal and testable: case-insensitive; with no
  wildcard a pattern matches a substring; with `*` (any run) or `?` (one
  character) it must match the whole title; never a regex built from user text;
  at most 32 patterns of at most 100 characters per list. A non-empty `include`
  makes the rule claim only matching titles. A title matching `exclude` skips the
  rule and falls through to later rules, then the default.
- **Resolution:** override, else the first rule whose collection holds the
  shortcut and whose patterns admit its title, else `steam-store`. A game claimed
  by rules of different buckets is a conflict: it resolves by order and the
  settings page lists it (as before).
- A v1 config (`assignments`) is migrated in memory. Its `default: "none"` is not
  carried over.
- **Resolutions are sticky per session**: computed once per shortcut, reset when
  the bucket settings change. Collection membership changes (including ones our
  own category enrichment causes) never flip a bucket mid-session.
- **Network, restated (amends ADR-0032).** A fresh install now looks a shortcut up
  on the Steam Store **lazily, when its page is viewed**: `StoreItemCache`
  (Steam's own transport) and the backend `storesearch` (at most 1 request/s on
  the wall clock, 8 s timeout, offline circuit breaker, 7-day negative cache;
  P4 hardening, implemented — see CHANGELOG.md). There is no startup sweep. IGDB
  is reached only for the fallback, and only with credentials. `none` (rule or
  override) still means no network for that game.
- **Local tier (amends ADR-0035).** Local Game Info shows for every shortcut
  until the store answers, stays when there is no match, and is replaced while
  store data is applied.

### Consequences

- Jotunnslayer resolves to its Steam match with no configuration.
- Each viewed shortcut costs one `storesearch` request, once; after that the
  mapping or the negative cache answers. The 210 RetroArch shortcuts skip the
  lookup (emulator guard) and fall back to web scraping.
- A wrong exact-title match remains possible. The mitigations are unchanged:
  unique exact matches only, Clear with reject, manual mapping. Users who want no
  lookups set a collection rule to Neither, or an override.
- A collection membership change takes effect after a restart or any bucket
  settings change. The settings page says so.
- Replaces decision 1 in [steam-cartridges.md § 9](steam-cartridges.md#9-risks-and-open-questions).

---

## ADR-0037: A mapped shortcut borrows its native app's Steam sections; the P5 gate is native parity

**Status:** Accepted · 2026-09-25 (user decision B) · **Refines [ADR-0032](#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges)** (which linker features are dropped) · builds on [ADR-0022](#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them) and [ADR-0009](#adr-0009-prefer-patching-steams-data-over-patching-its-dom) · **Amended by [ADR-0038](#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app)** (badge policy, navigation redirect, gate of 17 checks)

### Context

The user decided (2026-09-24) that P5 (achievements) starts only when the page of
*Jotunnslayer: Hordes of Hel* (Epic shortcut 2315502503) holds as much data as
native app 2820820, and that there are no user-created achievements. Live
(2026-09-25, `scratch/check_parity.mjs`): 3 PASS / 10 FAIL. Besides Game Info fields, the shortcut lacks the store links,
Friends who play, Community Content and the app's news, all of which Steam's own
section components render for any appid. `research/game-data-linker` rebuilt
these by scraping (`fetch_news`, `fetch_partner_events`,
`fetch_community_content`, `fetch_friend_*`); steam-cartridges.md § 3.3 had
dropped them as "out of scope".

### Decision

- For a shortcut **with a Steam Store match**, Steam's own Links, Friends and
  Community Content components receive the **native appid** (a props rewrite in
  the jsx runtime, resolved once at startup by localisation-token signatures;
  O(1) per element), `friends` and `community` join its section list, and the
  native app's activity events (Steam's own `appActivityStore` objects) join the
  shortcut's feed. Steam fetches and renders all of it through its own transport.
- The linker's scrapers stay dropped: no news-hub, community or persona scraping,
  no Web API calls for news. Epic/Xbox stay dropped.
- A shortcut without a match gets Steam's stock behaviour for these sections
  (no links: a shortcut appid has no store page).
- Owner-only surfaces (playtime, cloud, trading cards, DLC ownership, workshop
  subscriptions, "My Review") and store-page-only data (screenshots, trailers,
  tags, requirements, languages, reviews, metacritic) are not rebuilt; the Store
  Page link reaches them. An unowned native app shows none of the owner-only
  surfaces either.
- **P5 gate:** `node scratch/check_parity.mjs` prints `17 PASS / 0 FAIL` plus the
  Big Picture and regression checks (Routines 2/3, AGENTS.md) — **met, verified
  live 2026-09-26** (see TASK.md). P5 itself remains blocked on a separate open
  bug: [docs/plans/steam-cartridges-friends-boat-crash.md](plans/steam-cartridges-friends-boat-crash.md).

### Consequences

- Links on an unmatched shortcut's Game Info disappear. They pointed at a store
  page that does not exist (`store.steampowered.com/app/<shortcut appid>`).
- A match now also costs Steam's own requests for friends, community and news of
  the native app, like opening an owned game.
- A wrong match now also shows another game's friends and news; the mitigations
  of ADR-0036 (exact unique title, Clear with reject, manual mapping) apply.
- Three more signature-resolved components; a Steam update that moves one leaves
  that section stock and logs a warning.

---

## ADR-0038: A mapped shortcut shows only what is true of its copy; its links, news and community content open the native app

**Status:** Accepted · 2026-09-25 (user decisions: badge policy; link and navigation parity) · **Amends [ADR-0037](#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity)** (answers its open question Q1, adds the navigation redirect, the gate grows to 17 checks)

### Context

ADR-0037 hands Steam's own sections the native appid of a mapped shortcut and
left one question open: should Steam-service features of the native app show
on a non-Steam copy? A live read-only session on 2026-09-25
([steam-components.md § Links, navigation and native content](steam-components.md#links-navigation-and-native-content-for-a-mapped-shortcut))
found:

- Steam's Game Info draws 15 feature badges from `BHasStoreCategory`. Six are
  Steam services (Achievements 22, Cloud 23, Workshop 30, Remote Play Together
  44, Steam Input API 59, Family Sharing 62). `StoreItemCache` groups an app's
  categories into players, controller and features. Our store-item mapping reads
  all three and maps 44 to a flag that `metadata.ts` writes, so the Epic copy of
  Jotunnslayer would show "Remote Play Together" once Part A maps it.
- Once Game Info is enriched, our `BIsModOrShortcut` prototype hook makes Steam
  build the header links (Store Page, Community Hub, Discussions, Guides,
  Support) from the shortcut appid: every one is a dead page.
- A native news card calls `Navigator.App(<native appid>)`, which returns at once
  for an app missing from `appStore` (every unowned app): the click does
  nothing. The event overlay renders only when its `appid` is the event's app.
- Community Content loads for the shortcut appid.

The user decided (2026-09-25): the non-native copy shows only tags and badges
that are true for it; Steam-only features are not ported. The header links,
activity feed and community content must work by pointing at the linked native
app.

### Decision

- **Badge policy (mechanical).** A shortcut carries only store categories from an
  allow-list: the `supported_player_categoryids` and `controller_categoryids` ids
  with a known meaning, 1, 2, 9, 20, 24, 27, 36, 37, 38, 39, 49 and 18, 28, 55, 56,
  57, 58. The `feature_categoryids` group is never read. Anything else is
  dropped; the Steam services seen on native apps are named for tests and the
  gate: 22, 23, 29, 30, 42, 43, 44, 59, 62. When the Steam Store supplied ids,
  they replace the old flags; local and IGDB flags never map `achievements` or
  `remote_play_together`. The `full_controller` default of local data stays
  (guardrail 14; open question to the user).
- **Other store data.** Description, credits and both release dates are ported
  (ADR-0036/0037). Genres, user tags, languages, ratings and requirements are
  true of the game but have no app-page surface (Steam uses them for library
  sorting and dynamic-collection filters); they are not written until a later
  ADR. Steam Deck / SteamOS compatibility, achievements on Steam, playtime,
  cloud and cards belong to the Steam copy: never.
- **Links.** The header links come from Steam's own links component with the
  native appid (ADR-0037); their URLs are Steam's own (`urlStore`), opened in
  Steam's in-client browser. Nothing is hand-built. DLC, Points Shop, Workshop
  and Market appear only when Steam shows them.
- **Manage and Properties stay the shortcut's.** They act on the local copy (exe,
  launch options, artwork, removal) and Steam builds them from the app type, not
  from our hooks.
- **Navigation.** Each Steam UI window's `Navigator.App` is patched once with the
  SDK patcher: an unowned native appid mapped from a shortcut goes to the
  shortcut. The partner event overlay is the fourth component whose `appid` prop
  the jsx hook rewrites to the native app. A news card click therefore opens the
  native event over the shortcut's page. An owned native app keeps its own page.
- **Activity and Community Content** come from the native app (ADR-0037 Parts C
  and D) and click through Steam's own paths above. Community cards open by
  file id. From `research/game-data-linker`: `fetch_community_content` and
  `fetch_partner_events` are adapted to Steam's own components; the activity
  feed injection is adapted to Steam's own feed; `fetch_published_file_previews`
  is dropped (Steam loads its own previews).
- **Gate:** `scratch/check_parity.mjs` has 17 checks: 14 badges, 15 header links,
  16 news click-through, 17 the Community Content loader's appid. Check 11 now
  keys news by announcement GID (`unUniqueID` is a per-store counter), a stricter
  key. The Big Picture badge list in the parity plan § 9 is corrected to Steam's
  real table (there is no Shared/Split Screen badge). P5 starts at
  `17 PASS / 0 FAIL` plus the plan's § 9.

### Consequences

- A shortcut whose local or IGDB data claimed achievements or Remote Play
  Together loses that badge (user-decided). No other badge changes for
  unmatched games.
- One more patched Steam object (the window `Navigator`), resolved without a
  module scan; if it is missing, clicks stay stock and a warning is logged.
- The global `BIsModOrShortcut` hook still enables "Mark as Private" for an
  enriched shortcut (recorded in steam-components.md; not addressed here).
- A wrong store match now also sends news clicks and header links to the wrong
  native app; ADR-0036's mitigations apply.

### Addendum (2026-09-25, user decision): the Full Controller Support badge

Answers the open question above (parity plan § 12 Q2) and replaces "the
`full_controller` default of local data stays".

- **Precedence, shortcuts only:** Steam Store controller data (`store_category_ids`,
  or the explicit flags of a `source: 'steam-store'` record) > emulator inference >
  the setting "Default to full controller support" > no badge. Nothing below Steam
  data can override it.
- **Inference** is a fixed table (`backend/emulator_controllers.lua`, parity plan
  Step 37b): RetroArch core from `-L` in `Exe`/`LaunchOptions` (ADR-0003) or the
  standalone emulator's exe. Consoles, handhelds and arcade = yes; keyboard/mouse
  systems (DOS, ScummVM, PC-88/PC-98, PC, Mac) = no; anything else = not inferred.
  Core names come from the machine's `C:\emu\RetroArch\cores` and `info\`.
  Collections are not used.
- **Setting** `defaultFullController` (boolean, default off) in the plugin settings,
  a `ToggleField` row, stored with the Millennium#903 pattern of `settings.ts`.
- Local / IGDB records carry no controller data (IGDB and the fallback record
  hard-code `full_controller = true`), so their controller flags are ignored. With
  the setting off, a native-PC shortcut without Steam data (AM2R) loses the badge it
  showed before: a user decision, recorded here per guardrail 14.
- `is_emulator` now reads the program token of `Exe`; before, it never matched a
  RetroArch shortcut, because Steam stores the whole command there.
