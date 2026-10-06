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
- **Record findings in `docs/steam-styles.md`** (removed 2026-09-28; its remaining rules live in [plugins.md](plugins.md#rules-that-apply-on-every-rung)), with the
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
- The style bible (`steam-styles.md`, removed 2026-09-28) is no longer needed to
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

**Status:** Accepted · 2026-09-24 · P0 trace T4 named the keyless schema source · **Amended by [ADR-0056](#adr-0056-epic-and-xbox-copies-are-found-from-the-pc-filled-from-their-store-and-their-unlocks-are-synced)** (an Epic or Xbox copy's unlocks come from its store)

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
`steam-cartridges/tests/live/check_all_tabs.js` check 4 to accept the grey box, which hid it.

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
- `steam-cartridges/tests/live/check_all_tabs.js` check 4 again requires enriched Game Info for AM2R.
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
- Replaces decision 1 in `docs/steam-cartridges.md` § 9 (that research doc was removed 2026-09-28; read it with `git show 0d599cf:docs/steam-cartridges.md`).

---

## ADR-0037: A mapped shortcut borrows its native app's Steam sections; the P5 gate is native parity

**Status:** Accepted · 2026-09-25 (user decision B) · **Refines [ADR-0032](#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges)** (which linker features are dropped) · builds on [ADR-0022](#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them) and [ADR-0009](#adr-0009-prefer-patching-steams-data-over-patching-its-dom) · **Amended by [ADR-0038](#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app)** (badge policy, navigation redirect, gate of 17 checks)

### Context

The user decided (2026-09-24) that P5 (achievements) starts only when the page of
*Jotunnslayer: Hordes of Hel* (Epic shortcut 2315502503) holds as much data as
native app 2820820, and that there are no user-created achievements. Live
(2026-09-25, `steam-cartridges/tests/live/check_parity.mjs`): 3 PASS / 10 FAIL. Besides Game Info fields, the shortcut lacks the store links,
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
  no Web API calls for news. Epic/Xbox stay dropped (reversed by ADR-0056: copies are found and filled from their stores; friends and news stay dropped).
- A shortcut without a match gets Steam's stock behaviour for these sections
  (no links: a shortcut appid has no store page).
- Owner-only surfaces (playtime, cloud, trading cards, DLC ownership, workshop
  subscriptions, "My Review") and store-page-only data (screenshots, trailers,
  tags, requirements, languages, reviews, metacritic) are not rebuilt; the Store
  Page link reaches them. An unowned native app shows none of the owner-only
  surfaces either.
- **P5 gate:** `node steam-cartridges/tests/live/check_parity.mjs` prints `17 PASS / 0 FAIL` plus the
  Big Picture and regression checks (Routines 2/3, AGENTS.md) — **met, verified
  live 2026-09-26** (see CHANGELOG.md). A Friends-section crash on unowned mapped
  native apps found in this same area was fixed the same day (see CHANGELOG.md
  and [knowledgebase.md's `appStore.GetAppOverviewByAppID` entry](knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all)
  for the reusable lesson); P5 is unblocked.

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
- **Gate:** `steam-cartridges/tests/live/check_parity.mjs` has 17 checks: 14 badges, 15 header links,
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

### Addendum (2026-09-26, user decision): "achievements on Steam... belong to the
Steam copy: never" narrowed to the feature badge; the achievements section itself is in scope

The Decision section above says "Steam Deck / SteamOS compatibility,
**achievements on Steam**, playtime, cloud and cards belong to the Steam
copy: never." In context (the Badge policy bullet, category id 22) that
sentence was about the **Achievements feature badge** — the small icon on
Game Info saying "this game supports Steam Achievements" — grouped with
other Steam-service badges (Cloud, Workshop, Remote Play Together) that are
genuinely never true of a non-Steam copy. It was not a decision about
whether to render the **achievements section** (the right-column panel,
Post-Game Summary strip, and Big Picture play-bar progress) the way Links,
Friends and Community Content already are (ADR-0037).

**Narrowed scope:** the badge-never rule stands unchanged (category id 22
stays off the allow-list; a shortcut never claims "supports Steam
Achievements" as a feature). Separately, and newly decided here: **the
native app's real Steam achievement schema and (if owned) the user's own
unlock progress should be mirrored onto the mapped shortcut's achievements
section**, following the same "borrow the native app's Steam section"
principle ADR-0037 already established for Friends/Links/Community — this is
what is true of the copy in the sense that matters to the player (the same
game's real achievement list), not a Steam-service capability being falsely
claimed.

**Relationship to ADR-0034:** ADR-0034 already commits to a *fetch-and-feed*
mechanism for Steam-native achievement sourcing (our backend calls the
keyless store `appdetails` endpoint and feeds `AppDetailsStore` under the
**shortcut's own** appid, the same pattern as Game Info's
`descriptionsData`/`associationData`). ADR-0037's Friends/Links/Community
sections instead use a *redirect* mechanism (the jsx prop rewrite hands
Steam's own component the **native** appid and lets Steam's own transport
and caches answer it, no fetching). Both could produce the same visual
result for an owned native app; they differ in unowned-app coverage (redirect
depends on Steam already having the native app's data cached; fetch works
regardless) and in implementation cost/performance (redirect is zero extra
network and reuses code already proven safe for Friends; fetch adds a
request path and a cache to maintain). **This ADR does not choose between
them.** The next agent to implement this
(`docs/plans/steam-cartridges-native-achievements-mirror-plan.md`, removed 2026-09-28 and carried into migration plan M6; full text: `git show 0d599cf:docs/plans/steam-cartridges-native-achievements-mirror-plan.md`)
must live-investigate both against the real client (including UI performance
impact) before picking one, and record that choice back into this ADR or a
follow-up addendum.

This is layered *underneath*, not instead of, the agnostic local-unlock
detector in
`docs/plans/steam-cartridges-achievements-plan.md` (removed 2026-09-28; carried into migration plan M6):
that system is a separate, not-yet-implemented later phase that will also
trigger the *native* Steam achievement itself (communicating with Steam so
the unlock is real, not just displayed). Mirroring the native schema/progress
onto the shortcut's UI is the prerequisite piece that ships first.

---

## ADR-0039: steam-cartridges is a ports-and-adapters modular monolith; only surfaces write to Steam

**Completed 2026-09-29:** migration M0a-M9b done (plan header). **Status:** Accepted · 2026-09-28 (user decisions: pipeline in the backend; new shortcuts fetched in the background; feature freeze until surfaces are migrated) · **Amends [ADR-0004](#adr-0004-backend-owns-all-io-and-merging-the-frontend-only-renders)** (the frontend also owns Steam-facing sensors and surfaces) · **Amends [ADR-0033](#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)** (collections are read by a sensor and passed to the backend as context; bucket resolution moves to the backend resolver) · **Keeps [ADR-0012](#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)/[0013](#adr-0013-providers-return-data-the-core-renders-it)/[0014](#adr-0014-providers-are-isolated-and-fail-silently)** as the path to provider plugins

### Context

On 2026-09-28 the user uninstalled `steam-cartridges` because Steam's UI kept
crashing, and most recent features had regressed a view that already worked.
The audit that led to this decision (the migration plan, since deleted; see the CHANGELOG)
found the cause is structural:

- Features import each other's internals.
- About a dozen modules patch shared Steam targets (prototypes, stores, four
  separate `jsx` hooks), and none of them owns those targets.
- A `props` getter on three Steam class prototypes fires view events and writes
  to stores while Steam renders.
- Page views are detected three times.
- Appid normalization is repeated in each feature.
- No test enforces any boundary, and no feature can be switched off without
  uninstalling the plugin.

Three options were considered:

- **One Millennium plugin per service.** Rejected: every frontend shares
  `SharedJSContext`, so a crashing surface in any plugin still crashes Steam's
  UI.
- **MVC.** Does not fit: Steam renders the view (ADR-0022), and MVC has no place
  for many external sources.
- **Ports and adapters (hexagonal) inside one plugin.** Chosen.

### Decision

- **Layers:**
  - `kernel/`: the `ShortcutId` type, the event bus, the `GameRecord` read model and the `Surface` contract.
  - `domain/`: pure policy.
  - `sensors/`: read what the user does in Steam.
  - `app/`: thin use cases.
  - `ports/backend`: the RPC client.
  - `surfaces/`: write into Steam.
  - `steam/`: shared read-only module resolution and one jsx dispatcher.

  The import rule is in plan § 4.1 and is enforced by
  `tests/architecture.test.ts`. The allowlist of existing violations may only
  shrink.
- **Only surfaces write to Steam.** Each surface declares the Steam targets it
  `touches`, and no two surfaces declare the same target (tested). Hooks inside
  Steam's render, getters and prototype methods are pure O(1) reads of the
  record. They never emit events, fetch, write to stores or walk prototypes, and
  they fail open to Steam's original render.
- **Isolation:**
  - Each surface is installed and run in isolation, with an error budget.
  - Each surface and service has its own kill switch (`disabledSurfaces`, `disabledServices`).
  - A boot sentinel starts safe mode (`sections` and `captures` only) after two unclean starts.
- **The pipeline lives in the backend (user decision 1).** The backend owns:
  - Registry (shortcuts, and which ones were added since the last run).
  - Resolver (native Steam match first, then web identity; bucket policy runs here, with collection membership and owned-app candidates supplied by frontend sensors as context).
  - Metadata, achievements and media, each with source adapters of the shape `{ id, supports(ctx), fetch(ctx) → { status, data, ttl } }`, wrapped in `pcall`.
  - Freshness (a TTL per part).

  The frontend gets the record through `GetGameRecord` and `EnsureFresh`.
- **Refresh (user decision 2):**
  - A shortcut added since the last run is fetched in the background at startup, rate-limited.
  - Otherwise, data is refreshed only when the game's page is opened, and only for parts checked more than 24 h ago.
  - Games that are never opened are never fetched again.
- **Persisted formats do not change** in this migration.
- **Feature freeze (user decision 3):** no new `steam-cartridges` features until
  the surface migration (plan M3) is complete. Bug fixes go into whichever
  structure the module currently lives in.

### Consequences

- A new source, surface or policy touches only its own module (plan § 4.6). A
  diff crossing more boundaries has to justify it.
- A crash can be isolated by switching off one surface instead of uninstalling
  the plugin. The capture tier (the core promise of ADR-0012) survives in safe
  mode.
- Source adapters already have the provider-contract shape, so extracting one
  into a provider plugin (Phase 9) only needs an adapter that calls `Collect()`.
- Cost: a multi-plan migration (M0a–M9) with a feature freeze. Old RPC names
  stay registered as aliases until their callers are gone, because calling an
  unregistered RPC crashes the host.
- Cost: moving orchestration to the backend means porting TS logic (bucket
  resolution, the scraper queue) to Lua. The TS tests move with it or get Lua
  equivalents.

---

## ADR-0040: Routing policy stays pure TypeScript in the frontend domain layer

**Status:** Accepted · 2026-09-28 (migration plan M4a) · **Amends [ADR-0039](#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)** and § 11 decision 1 of the migration plan, for routing only

### Context

ADR-0039 put the pipeline — identity, fetching, storage, freshness — in the
backend, moved bucket resolution into "the Resolver," and expected routing to
follow. Routing policy is pure TypeScript in
`frontend/domain/routing`,
and one of its rule types has a `regex` condition matched with JavaScript
`RegExp` semantics (`isServiceAllowed`, `conditionType: 'regex'`). Lua has no
regex engine (only patterns, a different, less expressive language), so
porting that rule type would mean either reimplementing `RegExp` semantics in
Lua or silently narrowing what a routing rule can match.

### Decision

Routing policy — bucket resolution, collection rules, the multi-service
routing engine (`isServiceAllowed`, `isServiceAllowedByAutoMode`) — is pure
TypeScript in `frontend/domain/routing/` (`policy.ts`, `pending.ts`), wrapped
in a stateful factory in `frontend/app/routing.ts` (`createRouting`). The
frontend evaluates the policy and passes the resulting route (and which
services it allows) to the backend as **context** on `EnsureFresh`. The
backend keeps everything ADR-0039 already gave it: identity, fetching,
storage and freshness.

`domain/` is a leaf layer like `kernel/`: it may import only `kernel/`, and
every other layer may import `domain/` (`tests/architecture.test.ts`
`LAYER_RULES`).

### Consequences

- Routing rules keep full `RegExp` semantics; no rule-matching behavior
  changes for the user.
- `domain/routing` is pure and unit-tested without Steam or the backend
  (`tests/buckets.test.ts`, `tests/buckets-ready.test.ts`,
  `tests/routing-rules.test.ts`, `tests/app-routing.test.ts`).
- The backend resolver, metadata and achievement services (M4b onward) take
  the evaluated route as an opaque `{ bucket, via }` context value; they never
  re-derive it and never see a routing rule.
- Cost: one more frontend layer (`domain/`) than ADR-0039's diagram implied,
  and `app/routing.ts` is the frontend's first module with a genuine
  cross-file runtime import outside `tests/` — `tsconfig.json` gained
  `noEmit: true` and `allowImportingTsExtensions: true` so `tsc` and Node's
  `--experimental-strip-types` test runner can both resolve it.

## ADR-0041: jsx-runtime hooks stay one per concern

**Status:** Accepted · 2026-09-29 (migration plan M9a) · **Amends § 4.4 of the migration plan** ("one dispatcher")

### Context

Plan § 4.4 proposed one dispatcher for every `keepJsxPatched` install. After M3 there are four: the view sensor
(`steam/gamepad-appid.ts`), the captures headline, the captures activity cards and native-links.

### Decision

Keep them separate. Each runs one O(1) handler; `steam/jsx-hook.ts` already guarantees one chain position per label
and is shared by identical copy with `enhanced-achievements` (do-not-touch 6), so a dispatcher would change that shared
file for no measured gain. `tests/architecture.test.ts` fails if `keepJsxPatched` is called from anywhere except
`steam/gamepad-appid`, `surfaces/captures` and `surfaces/native-links`.

### Consequences

A fifth hook needs a new ADR (or a decision to merge), not a quiet call.

## ADR-0042: Game Info is re-applied from Steam's overview rebuild; the render-time check is only a fallback

**Status:** Accepted · 2026-09-29 (K6) · **Amends [ADR-0039](#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)** (only surfaces write to Steam, never on a Steam render stack)

### Context

Steam replaces an app's overview object when it refreshes the app (`appStore.UpdateAppOverview` builds a new
`AppOverview` and calls `collectionStore.OnAppOverviewChange(changed, removed)`), which drops the release date and
badge categories `surfaces/game-info` wrote. M0a fixed the render feedback loop by making the enrichment idempotent
and re-checking it on every Game Info render, so the repair was a Steam store write during a render (K6).

### Decision

1. `surfaces/game-info` patches `collectionStore.OnAppOverviewChange` (prototype owner; `UpdateAppOverview` is a
   read-only property and cannot be patched) and re-applies the enrichment for the changed enriched shortcuts on a
   `setTimeout(0)`, off Steam's stack.
2. The render-time check in the Game Info render patches **stays as a fallback** for a rebuild the event misses. It is
   allowed only because `enrichGameDetails` is idempotent (a repeat call with live data writes nothing). Every
   write is counted in `gameInfoRepairDiagnostics()` (`viaTrigger`, `viaRender`); `viaRender` is expected to stay 0.
3. `steam-cartridges/tests/live/probes/overview_repair.mjs` (part of `npm run test:live`) fails if the repair comes from a render.

### Consequences

A non-zero `viaRender` means the trigger missed a rebuild: find the missing path, do not remove the fallback.

## ADR-0043: enhanced-achievements has one owner per Steam target and a safety net

**Status:** Accepted · 2026-09-29 · Plan: executed and deleted (see the CHANGELOG) · The plugin was merged into enhanced-notifications by [ADR-0050](#adr-0050-enhanced-achievements-merges-into-enhanced-notifications); its decisions hold there · Same principles as [ADR-0039](#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam), applied in a lighter form

### Context

`enhanced-achievements` (about 6.4k lines) has regressed the same way `steam-cartridges` did: every bug in its
CHANGELOG was either two owners of one Steam target (the banner position raced Steam's per-frame moves; the 100%
toast was scheduled twice) or state changed from the wrong place (a hook-order error when a queued toast got its
turn; previews swapping tiers through a shared time-window flag; sounds played on arrival instead of with their
banner). One 482-line file, `steam/notifications.ts`, does six jobs inside one Steam prototype hook, and nothing
switches a failing part off: `init()` either hooks everything or nothing.

### Decision

1. **Safety net first.** Every part that writes into Steam has a feature id with a kill switch
   (`disabledFeatures` setting), a per-session error budget (5) and a boot sentinel that starts in safe mode
   (nothing hooked) after two unclean starts. A switched-off feature leaves Steam's stock behaviour and is handed
   back through `claims()`.
2. **One owner per Steam target.** Each Steam write (prototype wrapper, config field, popup method, jsx runtime,
   RPC) lives in exactly one file. `tests/architecture.test.ts` enforces it (`OWNERS`), plus an import ratchet
   that only shrinks and a list of pure files that `npm test` runs under node.
3. **One notification hook, one event.** A single `PlayNotificationSound` wrapper (`steam/notification-hook.ts`)
   observes every shown toast and offers one sound slot. A sensor turns a shown unlock into one
   `achievement.unlocked` event per notification, emitted one macrotask later (the only work this hook may hand
   off; it replaces the inline capture scheduling of phase-7 A1.7). Captures and the 100% toast subscribe to it.
4. **Surfaces write, nothing else does:** `banner`, `sound`, `duration`, `toasts`, `captures`, each with its
   declared `touches`, installed in isolation and uninstalled when its budget is spent.
5. **The toast scheduler (`banner/queue.ts`) is the only owner of banner lifetime**, including when a queued
   banner's sound plays. Nothing is admitted to it from a render.
6. **No shared package.** Plugins may not import each other; shared files stay copies, and a test fails when a
   copy drifts (`steam/jsx-hook.ts` with steam-cartridges, `pristineDuration` with enhanced-notifications).

### Consequences

- Steam-side changes (Millennium restoring `jsx`, a new toast stack) still happen; they now fail one feature, not
  the plugin, and the failing feature can be switched off without uninstalling.
- New features go into a new surface or a new event subscriber; a diff that touches another surface's file needs
  a reason in its plan.
- Not adopted from ADR-0039: the `GameRecord` read model, backend services and per-layer docs. One doc,
  `docs/enhanced-achievements/architecture.md`, covers the plugin.

---

## ADR-0044: steam-cartridges layers stay dumb, and a test checks what each layer does

**Status:** Accepted · 2026-09-30 (the user: "keep each layer boring and dumb only with its own job, preventing the
pollution that caused the migration in the first place"; the layers stay as they are) · Implemented by
the M10 gap batch ·
**Amends [ADR-0039](#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)**
(migration decisions D3 and D4, § 4.2 `GameRecord.route`, § 4.3 file layout, the § 4.1 settings row) ·
**Keeps [ADR-0040](#adr-0040-routing-policy-stays-pure-typescript-in-the-frontend-domain-layer),
[ADR-0041](#adr-0041-jsx-runtime-hooks-stay-one-per-concern), [ADR-0042](#adr-0042-game-info-is-re-applied-from-steams-overview-rebuild-the-render-time-check-is-only-a-fallback)**

### Context

The migration (ADR-0039) was enforced by an import ratchet only. The
audit found 30+ places where a layer did another layer's job
without an import edge: surfaces fetching and calling the backend through functions `index.tsx` injected (D3, meant
as a migration bridge, became permanent), surfaces calling each other the same way, `index.tsx` holding ~120 lines of
logic, the frontend keeping a retry TTL beside the backend's, triple-key appid lookups the kernel was built to end,
and one guardrail-8 write (`appData.details = {}`).

### Decision

1. **One job per layer, no new layers.** kernel: shapes, events, the record, pure containers. domain: pure policy.
   sensors: detect what the user does and what Steam knows. app: decide and orchestrate, with injected deps.
   ports: the only door to the network and the backend. surfaces: write to Steam what the record or an event says.
   steam: the one webpack scanner and jsx dispatcher. settings: the settings store and its panels.
   `index.tsx`: create and wire, nothing else (plus the safety bootstrap, the legacy-plugin guard and the
   guardrail-16 alias block). Backend: a service owns its data; a store stores, a source fetches; an RPC module is a
   facade nobody `require`s; `registry.shortcut` is the one `shortcuts.vdf` lookup.
2. **What a surface may be given (supersedes D3 after the migration):** its `SurfaceDeps`, pure reads (the record,
   a setting, the kernel image bin, app-loaded stats) and the `bus` to emit **its own result event**
   (`artwork.applied`, `captures.published`). Never a function that reaches the backend or another surface. A
   Steam-side input a surface needs arrives as a kernel event that `index.tsx` subscribes the surface's handler to
   (`window.opened`/`window.closed`, `achievements.unlocked`, `achievements.launch-toast`, `captures.published`).
   (Q1: the artwork write-back goes out as `artwork.applied` and `app/artwork` records it; the icon file is stored by
   `app/artwork` before the plan reaches the record.)
3. **app/ modules are `create*` factories** with their collaborators passed in: no module state, no setters, no
   value import of the backend port.
4. **Freshness belongs to the backend** (Q5). The frontend memo remembers only final answers (`ok`, `unsupported`)
   for the session; the backend's `fresh_policy` answers a repeat failure of identity or artwork from memory for its
   30-minute error TTL (no file format change).
5. **`GameRecord.route` is removed** (Q2; § 4.2 says removing a field needs an ADR: this one). The route is policy
   evaluated per view and passed as context; its one shape is the kernel's `Route`.
6. **Backend layout as built** (Q3): the § 4.3 `src_*` file names are not adopted; the `{ id, supports, fetch }`
   source contract binds every new source.
7. **settings may import domain** for types and validators (Q4); evaluating policy goes through `PanelContext` to
   `app/routing`. Settings changes travel on the settings store's own change events, not `window` events.
8. **Detection is the sensors'** (Q7): the view sensor reports window lifecycle; `captures` styles the window it is
   handed.
9. **index.tsx's public exports keep their names and behaviour** (Q8, D8); their bodies delegate to app/.
10. **A test checks what each layer does:** `tests/architecture.test.ts` gains a capability ratchet (forbidden
    identifiers per area, frozen exceptions each with its reason, only shrinking), a check that no surface is
    injected a backend call or another surface, the sanctioned second-listener list (ADR-0042), the unwired-RPC list
    (D13) and two backend rules (no RPC module as a library, no store that fetches).
11. **Order** (Q6): M10 runs before the F1 Game Data editor plan, whose patches are regenerated afterwards.

### Consequences

- A new feature finds its place by the table in `docs/steam-cartridges/README.md`; a diff that makes a layer do
  another's job fails `npm run test:ts` with the rule's reason, not in review.
- A Steam boundary still converts appids (Steam keys shortcuts signed or unsigned); those files are named exceptions.
- Cost: one batch of 13 commits touching most frontend files; each is revertible on its own (the M10 plan § 5).

## ADR-0045: steam-cartridges fills Steam's stores when Steam would; other plugins read Steam, not us

**Status:** Accepted · 2026-09-30 (the user chose option B: "consider steam-cartridges store data just as steam does it
so we dont just feed the fake data when the game is opened") · Implemented by
the achievements preload plan (plan removed once done: `git show 585cc5c:docs/plans/steam-cartridges-achievements-preload-plan.md`) ·
**Extends [ADR-0009](#adr-0009-prefer-patching-steams-data-over-patching-its-dom),
[ADR-0022](#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
[ADR-0039](#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)**

### Context

steam-cartridges fed a shortcut's achievements into Steam's stores only when its page opened. enhanced-achievements'
Reset Achievements, which reads Steam's `appAchievementProgressCache` for Steam games, saw no shortcut, so a
plugin-to-plugin read (`storedAchievementSummaries()`) was added. Every future plugin would need the same second path.
Steam fills that cache after login for every owned game, from its own file.

### Decision

1. steam-cartridges fills each Steam store for a shortcut **at the moment Steam fills it for an owned game**: eager
   stores after Steam's own load (the achievement progress cache), lazy stores on request (their hooks answer at any
   time, with no page visit needed). The timing table is in steam-components.md, "When Steam fills each achievement
   store".
2. What it writes has **Steam's own shape** (the progress entry carries `appid`, `percentage`, `cache_time`, `vetted`).
3. **Other plugins read a shortcut's data from Steam's stores**, never from a steam-cartridges read API. A write Steam
   has no command for (resetting a shortcut's achievements) stays a steam-cartridges public API for now; routing it
   through Steam's own `achievement_clear` is a separate, later decision (option C).
4. The start-up preload writes only the parts whose surfaces are safe to apply at boot (`achievements`, `metadata`),
   never `identity` (knowledgebase Part 7). It needs no library: Steam's `appStore` is empty at that moment.
5. Steam's `LoadCacheFile` replaces the whole progress cache after login (verified live; the first implementation
   wrote before it and lost everything). steam-cartridges therefore watches the cache map's identity
   (`sensors/progress-cache`, 1 s, at most 10 min, read-only) and renders every record again on the first map and on
   each replacement. The exact alternative, a prototype wrap of `LoadCacheFile`, is recorded in TASK.md
   (Considerations).

### Consequences

- enhanced-achievements lists Steam and non-Steam games with one code path; `storedAchievementSummaries()` is deleted.
- Steam saves our progress entries into its own `achievement_progress.json` (`SaveCacheFile` writes the whole map), so
  they survive a restart like an owned game's, and outlive the plugin if it is removed (Steam then shows the last
  counts; harmless, the entries are only read for those shortcuts). Re-applying after each load refreshes their
  `cache_time`, so Steam does not ask its server about a shortcut.
- Start-up renders one pass over every shortcut with stored achievements (~130 here); the sections refresh is
  coalesced to one per tick.
- A new store fed for shortcuts must say, in its layer doc, when Steam fills it for an owned game.

## ADR-0046: Community media feeds Steam's own Community Content loader; ScreenScraper bytes stay in memory

**Status:** Accepted · 2026-09-30 (user decision, features plan F2) · **Amends [ADR-0041](#adr-0041-jsx-runtime-hooks-stay-one-per-concern)** (a fourth, learn-once jsx site) · **Amended by [ADR-0051](#adr-0051-downloaded-media-stays-on-disk-while-its-game-is-opened-the-user-sets-the-days)** (ScreenScraper bytes may stay on disk, never a URL)

### Context

A shortcut with no Steam match has an empty Community section and COMMUNITY tab. Steam's Community Content section
(module 77163, desktop and Big Picture) does not read a store we can fill: its loader fetches
`library/appcommunityfeed/<appid>` itself (verified live 2026-09-30). The deleted community plan's loopback files and
`CWorkshopStore` stubs could not have worked. ScreenScraper media URLs carry the user's account, the frontend cannot
fetch them (no CORS), and Millennium's Lua `http.get` cuts binary bodies.

### Decision

- Feed Steam's own cards: the `community` surface patches the loader's `LoadCommunityContentAndVotes` prototype
  method to return our items (types 3 Artwork, 4 Video, 5 Screenshot) for a shortcut with a feed, and Steam's own
  loader for anything else. The class is reached by a jsx observer that disposes itself once the section class is
  seen (`surfaces/community`, a fourth `keepJsxPatched` site, transient).
- The `sections` surface adds `community` to an unmapped shortcut's sections only when it has media and `community`
  is on.
- Our cards use published file ids from 9e14 (15 digits), creator `{ name: source, steamid: "0" }`, null counts.
- IGDB media is asked by the igdb_id Game Info shows, never by title. ScreenScraper items are keys; the backend
  downloads an image into memory (`net.get_binary`, WinINet via FFI) on request; the frontend holds it as a `blob:`
  URL in a bounded bin. No media file on disk; no ScreenScraper URL outside the backend.

### Consequences

- Steam's own grid, viewer and YouTube player; nothing of ours is drawn.
- Amended 2026-09-30 after the live check (Big Picture): Steam's vote, award, comment and Report controls act on Valve's
  servers with our ids, so on our cards (file ids from 9e14) those components render nothing and the gamepad options
  menu is removed. The author row stays (Steam's own). Steam's image viewer opens with a creator and a date and without a
  comment thread (it shows "Created by", the date and Close, like a native item). Each source is a made-up Steam account
  below 2^31 (2147483101 IGDB, 2147483102 ScreenScraper); Steam's own "Created by" avatar and name components render the
  source's name and inline icon for them. All of it is `replaceType` on Steam's jsx elements (`surfaces/community`, a
  second, persistent hook), for our ids only; any other element is untouched.
- If a later check shows a visible fault, the fallback is to render our own grid from Steam's exported parts (`kB`
  YouTube player, the viewer module, the section CSS), which needs a new ADR.
- A Steam update that renames the loader method or its class's prototype methods leaves the section stock (the
  learn fails, reported to the `community` switch), never a crash.
- Steam's own first-page trigger can miss (its on-screen signal may arrive after its 1 s timer), so for a shortcut with a
  feed the surface also loads the first page when the loader is bound or resized (found live 2026-09-30). The probe
  `community_media.mjs` switches to desktop mode and brings Steam's window forward first: a hidden window never loads it.

---

## ADR-0047: enhanced-notifications uses enhanced-achievements' architecture and shares its notification hook

**Status:** Accepted · 2026-09-30 · Plan: [enhanced-notifications-architecture-port-plan.md](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-architecture-port-plan.md) · Decisions 3 and 4 (copies shared between the two toast plugins) ended with [ADR-0050](#adr-0050-enhanced-achievements-merges-into-enhanced-notifications) · Applies [ADR-0043](#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net) to a second plugin

### Context

`enhanced-notifications` was copied from `enhanced-achievements` before that plugin's migration (E0a-E3, ADR-0043).
It still had the old shape: one `steam/notifications.ts` that discovers Steam's types, wraps
`PlayNotificationSound`, decides every sound and writes every duration, a styling module wired straight from
`init()`, no kill switch, no error budget, no safe mode and no architecture test. Both plugins wrap the same Steam
method, each with its own code: nothing checked that the two wrappers compose, and the migration left
`enhanced-achievements` depending on a file path inside this plugin (its `pristineDuration` drift test).

### Decision

1. **Same safety net** as ADR-0043 decision 1, with this plugin's ids (`style`, `sound`, `duration`, `preview`),
   its own boot key and the same `disabledFeatures` setting. A tripped feature's surface is uninstalled.
2. **Same layers and checks** as ADR-0043 decisions 2 and 4: safety, kernel, pure domain, Steam access, surfaces,
   composition root; `tests/architecture.test.ts` with an import ratchet that starts empty, a pure-file list, one
   owner per Steam write, disjoint surface targets, registered RPCs and a live-runner check.
3. **One hook file for both plugins.** `steam/notification-hook.ts` and `kernel/surface.ts` are identical copies in
   both plugins, and each plugin's architecture test fails when they differ. The hook composes: calls on any object
   but the store pass through, each wrapper's listeners run once per toast, a handler that does not want a type calls
   `playSteam()`, which reaches the other plugin's wrapper. Achievement sounds are decided by exactly one plugin
   through `claims('sound')`. A unit test drives two copies on one fake store in both load orders.
4. **Siblings, not only neighbours.** Everything the two plugins do the same way is one shared copy: besides the hook
   and `kernel/surface.ts`, `theme/jsonc.ts` (both read `.jsonc` and `.json` themes as JSONC), `settings/rows.tsx` (the
   settings rows and spacing system of [guardrail 18](plugins.md#18-settings-panel-layout-reference-enhanced-notifications)),
   `pristineDuration`, and `backend/main.lua` (identical but for the plugin name: theme lookup, relative or absolute
   asset paths). Each plugin's architecture test checks every copy.
5. **Not adopted:** the event bus and sensors, the banner scheduler and the jsx runtime hook (nothing here needs them;
   the jsx route was ruled out live on 2026-09-24 for these toasts). Previews go through a `preview` surface and are
   injected into the settings panel, which never imports a surface.

### Consequences

- A change to a shared file is a change to both plugins, in one commit, with both test suites green.
- A failing styling, sound or duration path switches off alone and gives Steam's stock behaviour back for it; the
  others keep working.
- New features follow [enhanced-notifications.md](enhanced-notifications.md) § How to add a feature.

## ADR-0049: Big Picture has one toast position: enhanced-notifications' theme by default, enhanced-achievements' when forced

**Status:** Superseded by [ADR-0050](#adr-0050-enhanced-achievements-merges-into-enhanced-notifications) (2026-10-01: one plugin, the theme decides) · Investigation: [enhanced-notifications-bigpicture-toast-fix-plan.md](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md) · Extends [ADR-0047](#adr-0047-enhanced-notifications-uses-enhanced-achievements-architecture-and-shares-its-notification-hook) (ADR-0048 is reserved by the F2c manuals plan)

### Context

On desktop each toast has its own popup, so each plugin places its own toasts (enhanced-achievements pins its banner
popups; enhanced-notifications passes those moves through). Big Picture has **one** toast view, which Steam places
by measuring one `position: fixed` placeholder div each time a toast renders
([steam-components.md § Big Picture toast view](steam-components.md#big-picture-toast-view-how-steam-places-and-shows-it)).
enhanced-notifications moves that div with its theme's `position` / `margin`, so in Big Picture it also placed
achievement toasts, and enhanced-achievements' own `position` did nothing there. The user's call (2026-10-01): one
place, like the One Ring; enhanced-notifications' theme decides it by default, and enhanced-achievements gets a
toggle that forces its own position for achievement toasts, over anything else that sets it.

### Decision

1. **Default:** enhanced-notifications' theme decides Big Picture's one toast place, for every toast, achievements
   included (unchanged).
2. **Force:** enhanced-achievements setting `bigpicture.force_position` (off by default; "Force achievement position in
   Big Picture"). On, while an achievement toast shows, enhanced-achievements writes its own `<style
   id=enhanced-achievements-placement>` in the Big Picture window with its theme's `position` and the toast tier's
   banner `margin`. Its selector repeats Steam's readable class three times (`.GamepadToastPlaceholder` ×3) and every
   declaration is `!important`, so it outranks enhanced-notifications' rule and Steam's own position classes whatever
   the order in `<head>`. Each plugin writes only its own `<style>`; precedence is by specificity, not by one plugin
   removing the other's.
3. **When:** both plugins act at `NotificationStore.PopNextToastNotification`, which Steam calls before the toast renders
   and so before it measures the placeholder. The wrapper is one shared file, `steam/toast-pop.ts`, identical in both
   plugins (drift-checked), an own property on the store instance; the second plugin to load wraps the first, so both
   hear every pop in either load order. enhanced-achievements writes its style at an achievement's pop and clears it at
   the next non-achievement pop.
4. **Desktop is unchanged:** enhanced-achievements already places its own popups there.
5. **Kill switch** `placement` in enhanced-achievements (appended to its feature ids): off, nothing is written and the
   next pop clears what was.

### Consequences

- Without enhanced-notifications, achievement toasts in Big Picture stay at Steam's place unless the toggle is on.
- Another plugin that moves the placeholder with fewer than three classes, or without `!important`, loses to the toggle;
  one that goes further wins. Steam builds without the readable `GamepadToastPlaceholder` class would need the hashed
  class, as enhanced-notifications resolves it.
- Tests: enhanced-achievements `tests/bigpicture.test.ts` (the CSS and its specificity), both plugins'
  `tests/architecture.test.ts` (shared file, owners), enhanced-notifications `tests/bigpicture-type.test.ts` (two installs,
  both orders), enhanced-achievements `tests/bigpicture.mjs` (force off: enhanced-notifications' corner; force on: this
  theme's corner; the next download back).

---

## ADR-0048: A manual is a cover card that opens Steam's own viewer; pdf.js renders its pages on demand, behind a port

**Status:** Accepted · 2026-10-01 (user decisions 2026-09-30, features plan F2c) · Builds on [ADR-0046](#adr-0046-community-media-feeds-steams-own-community-content-loader-screenscraper-bytes-stay-in-memory)

### Context

The user wants a game's ScreenScraper manual (a PDF) as the first card of the Community section, at the size of an
ordinary card, opened and scrolled on a controller too. Steam's Community Content cards are Artwork (3), Video (4),
Screenshot (5) and Guide (9, 10); a Guide opens a Valve page. Steam's image viewer (module 94715) renders its `children`
in a scrolling area that the D-pad scrolls. ScreenScraper's URLs carry the user's account. Steam's CEF lists an
`application/pdf` plugin, but an embedded PDF takes the D-pad. Found while planning: ScreenScraper lookups sent
RetroAchievements console ids as ScreenScraper `systemeid` (RetroAchievements' 3 is the SNES, ScreenScraper's 3 the NES),
so a ROM shortcut never matched (the test game, Captain Commando, answered `not-found` for every key).

### Decision

- **Card:** an Artwork card, first in `domain/community-media.visibleMedia`, behind the existing `communityShowManuals`
  setting. *Amended 2026-10-01 (live):* it reports **960 x 540** to Steam (cell class 34, the ordinary small cell of IGDB
  screenshots; Steam sizes a card from the reported numbers, not the picture, and 1280 x 720 is class 36, which Steam's row
  layout dropped), and its image is the manual's **first page** on a 16:9 cover (1280 x 720, page fitted on the dark
  gradient), rendered by `app/manuals` once per session when the shortcut's media names a manual (`record.updated`, then
  `record.updated` again so the surface re-reads); the inline SVG "MANUAL" cover stays as the placeholder until then and
  when rendering fails. The cover and the pages never read the PDF at the same time (one document in the backend).
  Steam places cards by a `Math.random` template shuffle, so the manual is **not guaranteed the top-left cell** (see
  [steam-components.md](steam-components.md#community-media--workshop-store)).
- *Amended 2026-10-01 (live, Chrono Trigger):* chunk 0 reuses a backend copy younger than 10 min and the frontend retries a
  timed-out read, because a 7.5 MiB download can outlast the 30 s RPC limit; the cover and the pages share the chunks; every
  pdf.js step has a timeout so a hung document cannot block the queue. The viewer knows the placeholder URL as well as the
  cover URL: Steam keeps the feed it was served, and a card built before the cover opened a viewer with no pages.
- **Viewer text:** the viewer's "Scroll down for comments" line (shown because the viewer has `children`) reads "Scroll down
  to view the manual", replaced by a jsx hook like the "Added by" label.
- **Backend:** `screenscraper_media.manual_item` names the best-region `manuel(<region>)` key; `GetManualChunk` returns
  the PDF in 1 MiB base64 chunks: chunk 0 downloads it into memory (48 MiB cap, `net.get_binary`), the last chunk frees it,
  one document at a time. No URL leaves the backend; nothing is written to disk.
- **Placement (ADR-0039, ADR-0044):** the community surface emits its own result event `community.manual-opened` from an
  effect of the page column it renders as the viewer's `children`; `app/manuals` (subscribed by `install()`) reads the
  chunks through `ports/backend`, renders the pages through `ports/pdf` and puts them on `kernel/manual-shelf` (2 manuals,
  page URLs released on eviction); the surface reads the shelf. No surface is given a function that reaches the backend.
- **pdf.js 4.10.38, pinned:** 5.4.624 and 6.3.289 hang in `getDocument` in Steam's Chromium 126 (verified live
  2026-10-01; 4.10.38 rendered a test PDF in 136 ms). `ports/pdf.ts` is the only file that uses it: the library and its
  worker are embedded as text (`constSysfsExpr` with `basePath`) and evaluated from `blob:` URLs when the first manual
  opens; the worker is a module worker given as `workerPort`; pages are drawn on an `OffscreenCanvas` and kept as JPEG
  `blob:` URLs, 1400 px wide, at most 200 pages.
- **Phase 0:** `screenscraper_media.SS_SYSTEM` maps the console ids, and a ROM that ScreenScraper does not know falls back
  to the title search on that console.

### Consequences

- The production bundle grows from about 0.18 MB to about 1.9 MB, almost all of it two string literals that are not
  evaluated until a manual opens.
- While a manual renders, pdf.js adds its fonts to SharedJSContext's `document.fonts`; `destroy()` removes them (verified
  live). `disableFontFace` would leave the document alone but drops text set in non-embedded fonts (verified live), so it is
  not used.
- Reading a large manual blocks the Lua backend for the download, as an image download already does.
- `constSysfsExpr` with a `../..` path embeds nothing and the build still says Succeeded; the plan's build check looks for
  `Embedded 1 specific file`.
- Upgrading pdf.js needs a live render test in Steam's Chromium first.
- Phase 0 also changes which ScreenScraper record Game Info's ScreenScraper source gets for a ROM shortcut (it can now match).
- Rejected: Chromium's PDF embed (takes the D-pad), opening the PDF outside Steam (the URL carries the account; a temp
  file is against the no-disk rule), a Guide card (opens a Valve page), fetching the PDF with the media part (quota and
  memory on every page view), the surface calling `app/manuals` directly (ADR-0044), pdf.js's legacy build (larger, not needed).

---

## ADR-0050: enhanced-achievements merges into enhanced-notifications

**Status:** Accepted · 2026-10-01 · Plan: [enhanced-notifications-achievements-merge-plan.md](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-achievements-merge-plan.md) · Supersedes [ADR-0049](#adr-0049-big-picture-has-one-toast-position-enhanced-notifications-theme-by-default-enhanced-achievements-when-forced); ends decisions 3 and 4 of [ADR-0047](#adr-0047-enhanced-notifications-uses-enhanced-achievements-architecture-and-shares-its-notification-hook); [ADR-0043](#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net) holds in the merged plugin · Decision 2 amended by [ADR-0052](#adr-0052-one-theme-one-look-achievements-inherit-the-themes-settings-popup-and-text)

### Context

Two plugins themed Steam's toasts: enhanced-notifications every type with one style, enhanced-achievements the
achievement toast with a banner per rarity tier. Restyling every notification but achievements in a second plugin was
inconsistent, and keeping them apart cost a coordination layer (`claims()` / `coexistence.ts`), seven drift-checked
copies, a cross-plugin Big Picture position toggle (ADR-0049) and two install steps. The user's call (2026-10-01): one
plugin, enhanced-notifications as the baseline, the achievement features as optional extras of the theme file.

### Decision

1. **One plugin, `enhanced-notifications`.** enhanced-achievements' code moves in (banner, unlock sensor, event bus,
   captures, the 100% toast, Reset Achievements); its folder is deleted (it was never published).
2. **The theme decides.** An optional `achievements` block (EA's theme: `settings`, `layout`, `tiers`, with `themes`
   still read) replaces achievement toasts with the banner. Its `settings` inherit the theme's `position`, `animation`
   and `display_time_ms`. Without the block, or with one that cannot be used (a warning), achievement toasts get the
   theme's style like every toast. A tier without a sound gets the theme's `sound`.
3. **Behaviour stays in settings:** achievement queue, captures on unlock, Reset Achievements. "Themed style",
   "Themed sounds" and "Themed display time" apply to achievement toasts too. `bigpicture.force_position` is gone: in
   Big Picture the one toast place follows the toast on screen (the banner's corner and tier margin while it shows).
4. **Ownership inside one plugin:** `bannerDraws(eType)` in the composition root, injected into the style surface,
   replaces `claims()`. One sound surface and one duration surface for every type. Each toast popup's `MoveTo` keeps
   two writers in a fixed order, the style surface's remap (at window creation) and the banner's pin on top (its own
   popups only, passed through by the remap): the one documented exception to one owner per target, checked by
   `tests/architecture.test.ts`.
5. **No `TestAchievement` in previews:** a random preview's achievement is the banner's synthetic preview, whose ids
   the unlock sensor skips; `TestAchievement` posts a real achievement id and would trigger captures.

### Consequences

- One theme describes every toast; an Enhanced Achievements theme works pasted inside `"achievements": { ... }`.
- Running enhanced-achievements next to it would draw two banners: `npm run test:live` fails while it is loaded, and
  the README says to disable it.
- Shared copies left: `steam/jsx-hook.ts` with steam-cartridges. Feature ids appended: `banner`, `completion`,
  `captures`, `toasts`, `reset`. The plugin's settings namespace is enhanced-notifications'; the user sets the
  achievement settings again once.

## ADR-0051: Downloaded media stays on disk while its game is opened; the user sets the days

**Status:** Accepted · 2026-10-01 (user decision) · **Amends [ADR-0046](#adr-0046-community-media-feeds-steams-own-community-content-loader-screenscraper-bytes-stay-in-memory)** ("No media file on disk"; the rule that no ScreenScraper URL leaves the backend stands) · Builds on [ADR-0048](#adr-0048-a-manual-is-a-cover-card-that-opens-steams-own-viewer-pdfjs-renders-its-pages-on-demand-behind-a-port) · Evidence: [the community investigation § 6](plans/steam-cartridges-community-crash-and-speed-investigation.md#6-findings-2026-10-01-second-agent)

### Context

ADR-0046 kept ScreenScraper image bytes in memory only, so every Steam start downloaded a game's community media again:
measured on Chrono Trigger, 11-23 s before the first card (a 3-15 s `jeuInfos` lookup, then about 0.5 s per image, one at a
time) plus 4 s for the manual's PDF. Parallel downloads cannot help: Millennium's Lua host serves one request at a time. The
user's call (2026-10-01): keep everything fetched on disk, for 7 days by default; clear a game's files when it has not been
opened in that window; a settings slider from 0 to 30 days.

### Decision

1. **What:** the backend keeps a game's ScreenScraper images, its manual's PDF and the manual's rendered cover in
   `<data dir>/media_cache/<appid>/` (`media_cache.lua`), plus a marker for a key that is not an image. File names are
   media keys; a ScreenScraper URL or account never reaches the disk. IGDB media are public URLs Steam loads itself:
   nothing to keep.
2. **How long:** `opened.json` records each game's last page open (the media `EnsureFresh`). `PruneMediaCache(days)` runs
   at start-up and when the setting changes, and deletes every game folder whose last open is older than the days. A game
   opened daily keeps its files.
3. **The setting:** `mediaCacheDays`, "Keep downloaded media" (Community & Media), 0-30, default 7. 0 is ADR-0046's
   memory-only behaviour and clears the folder. The frontend passes the days with every call that may read or write.
4. A cached image or PDF is served without asking ScreenScraper; the record (`community_media.json`, 7-day freshness)
   still decides which keys a game shows.

### Consequences

- A game's Community section fills from disk after a restart (Chrono Trigger: 479 ms instead of 11-23 s; the PDF's first
  chunk 87 ms instead of 4 s). Disk use is bounded by the games opened in the window (Chrono Trigger: 12 MB, AM2R: 3.6 MB).
- The manual covers move from `manual_covers/` (removed by the first prune) into the per-game folder, so they expire too.
- A key whose media changed on ScreenScraper keeps its old bytes while the game stays opened; setting 0 days, then back,
  refreshes everything.

## ADR-0052: One theme, one look: achievements inherit the theme's settings, popup and text

**Status:** Accepted · 2026-10-02 (the user's decisions) · **Amends decision 2 of [ADR-0050](#adr-0050-enhanced-achievements-merges-into-enhanced-notifications)** (the `achievements` block's shape; an Enhanced Achievements theme no longer works pasted in)

### Context

After the merge a theme described the same card twice: `popup` for every toast, then `achievements.tiers.normal.banner`
with its own background, border, margin, padding and gap, `achievements.settings` with its own position, animation
and text alignment, and per-tier text styles. The user's PS5 theme repeated every value in both places.

### Decision

1. **`settings` is for every toast**, achievements included: `position`, `animation`, `display_time_ms` and the new
   `text_align`. `achievements.settings` is gone.
2. **`popup` is the card of every toast, and the banner starts from it.** The banner is layered: the theme's `popup`,
   then any popup key set directly in `achievements`, then `achievements.normal`, then the tier. A popup key on a tier
   is a plain key (`"magic": { "background": [...] }`): no `banner` / `box` wrapper. `popup` also takes `scale`,
   `width`, `height` and `layout`, which only the banner reads for now (Steam's own toasts keep their size and
   arrangement).
3. **One `text` block.** The banner's title and description use `text.title` and `text.body`; a tier's `text` only
   sets the words (the 100% toast's).
4. **The tiers sit directly in `achievements`** (`achievements.normal`, `.magic`, `.rare`, `.exceptional`), all
   optional. `achievements.layout` is a preset name or an object (a custom layout); the `"custom"` name is gone.
5. **`logo` becomes `game_icon: [visible, radius]`.**
6. **Clean break:** the old keys (`achievements.settings`, `tiers`, `themes`, a tier's `banner` / `box` /
   `background_color`, a tier text style, top-level `logo` and `themes`) load with a warning and are ignored. The
   bundled and example themes were converted.

### Consequences

- A theme states each value once; the PS5 theme lost its duplicated card.
- The banner can no longer sit in a different corner, or animate differently, from the other toasts.
- A tier can no longer recolour its title (the old reference theme's gold title on rare).
- Making Steam's own toasts honour `popup.scale` and `popup.layout` needs live probing of their window and DOM: a
  follow-up in TASK.md.

## ADR-0053: enhanced-notifications has no style, sound or display-time switches; "Steam default" is a theme

**Status:** Accepted · 2026-10-02 (the user's decisions) · **Amends decision 3 of [ADR-0050](#adr-0050-enhanced-achievements-merges-into-enhanced-notifications)** (the "Themed style", "Themed sounds" and "Themed display time" settings are gone)

### Context

The settings panel had a General section with three switches that each turned part of the theme off. A theme already
leaves Steam's own value for any key it does not set, so the switches repeated what the theme file says, and the panel
had no way to pick "no theme".

### Decision

1. **The three switches are removed** (`style.enabled`, `sound.enabled`, `duration.enabled`). A theme that has no
   `sound` keeps Steam's sounds, one without `settings.display_time_ms` keeps Steam's display time, and so on
   ([themes.md § Defaults](../enhanced-notifications/themes.md)).
2. **"Steam default" is the first entry of the theme list and the shipped default** (`theme` = `<steam>`, a name no
   file can have on Windows): no theme is loaded, so every surface leaves Steam's look, sound and display time alone.
3. **A `.json` and a `.jsonc` with the same name are both listed**; the `.jsonc` one reads `name (jsonc)`. The setting
   stores the bare name for the file a bare name finds (user folder first, `.jsonc` first) and the whole file name
   for the other one, so a stored bare name keeps its meaning. The "(yours)" tag is gone.
4. **Previews:** a random preview leaves achievements out when the theme has an `achievements` block, whose tiers get
   their own "Achievements Preview" section (hidden without the block); "Select Notification" previews one chosen type.

### Consequences

- Turning one part of a theme off means editing the theme (or a copy), not a switch.
- A user who had a switch off gets the theme's value after the update (the stored key is ignored).
- Users who never picked a theme now start on Steam default instead of `steam_midnight`.

## ADR-0054: Reset Achievements also clears the files a non-Steam game's unlocks come back from

**Status:** Accepted · 2026-10-02 (the user's decisions)

### Context

Resetting a non-Steam game only cleared steam-cartridges' own unlocks. The observer then read them back: from the Steam
emulator's `achievements.ini` at the next launch (the user's Wuchang reset on 2026-09-30 came back on 2026-10-02 from
`C:\Users\Public\Documents\Steam\RUNE\2277560`), and from engine and emulator logs, read again from the start after
every Steam restart because log positions lived in memory. The confirm popup said nothing about any of it.

### Decision

1. **steam-cartridges lists where a shortcut's unlocks also live** (`achievements_reset.sources`): `local` (CODEX /
   RUNE / GSE / Goldberg saves), `rpcs3` (`TROPUSR.DAT`), `shadps4` (its trophy XML), `retroachievements`.
2. **The confirm popup offers "Also reset {source}" per resettable source, off by default,** and its warning says what
   the reset reaches: Steam's account (a Steam game), only the list in Steam (no files found, or only RetroAchievements),
   files cleared after a backup, files kept (they come back), and the note of a source it cannot reach.
3. **A chosen file is copied to `<file>.bak-<date>` and edited in place**, never deleted: emulator INI `Achieved=0` /
   `UnlockTime=0`, Goldberg `earned=false`, RPCS3's own `LockTrophy` layout, shadPS4 `unlockstate="false"`. A file in an
   unexpected format is left alone and reported.
4. **RetroAchievements is never reset from here**: its API (`dorequest.php`) has no reset request; only the signed-in
   website does it. The popup warns, and an "Open RetroAchievements to reset manually" switch opens the game's page
   (`https://retroachievements.org/game/<id>`, whose "Manage progress" button resets it) in the user's browser after
   the reset; `openPage` opens nothing else.
5. **Log read positions persist** (`log_offsets.json`), and a reset marks the game's logs read to their end, so a log
   never brings back an unlock a reset cleared.
6. **The RPCS3 and shadPS4 readers now follow those emulators' real formats** (the old ones assumed a fixed-record
   `TROPUSR.DAT` for both). Built from their sources and unit-tested; not yet tested on a real file (TASK.md).

### Consequences

- A reset with "Also reset local achievements" sticks; without it the popup says the unlocks come back.
- The first check after this update reads logs once from the start (no positions saved yet), as before.
- Epic, Xbox and other stores' achievements are not seen by steam-cartridges, so they are neither listed nor reset. (ADR-0056: Epic and Xbox copies are synced now, and not offered for a reset at all.)

## ADR-0055: The notifications queue uses Steam's own "display alone" rule for every notification type

**Status:** Accepted · 2026-10-02 (the user's decision) · **Amends [ADR-0050](#adr-0050-enhanced-achievements-merges-into-enhanced-notifications)** (the achievement queue setting)

### Context

"Achievement queue" ordered only achievement banners, by holding each queued banner's popup open and invisible
(`fnNotificationResolved`). The user wanted every notification queued. Steam's desktop toast stack shows up to three
toasts, but already has a rule that serializes: a type whose config has `displayToastAlone: true` waits for an empty
stack and blocks the stack while it shows.

### Decision

1. The setting keeps its key (`queue.enabled`) and becomes "Notifications queue".
2. A new `queue` surface (its own kill switch) sets `displayToastAlone = true` on every type config while it is on,
   and Steam's own value (pristine, `true` only on types 33-35 here) when it is off, switched off or uninstalled.
3. No toast is held or hidden by the plugin for this: Steam pops the next toast itself when the previous one is gone.
4. The achievement banner keeps its own scheduler for its sound timing and as a fallback while the `queue` switch is off.

### Consequences

- Verified live: three toasts at once, 3 windows stock, never more than 1 with the queue on.
- Steam's stack stalls when toasts are serialized: it pops only while a 5 s cache is fresh and refreshes it only when an
  input flips. A watchdog in the `queue` surface refreshes it through the query's own observer when toasts wait with
  none on screen (steam-components.md, "Desktop stack: when it pops a toast").
- A burst drains slowly: the last toast shows several display times after it arrived.
- Big Picture is unchanged (it shows one toast at a time anyway).

## ADR-0056: Epic and Xbox copies are found from the PC, filled from their store, and their unlocks are synced

**Status:** Accepted · 2026-10-02 (the user's decisions) · **Amends [ADR-0034](#adr-0034-achievement-sourcing-per-bucket-locked-only-for-unowned-steam-games)** (unlocks also come from the copy's store) · **Amends [ADR-0037](#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity)** (Epic and Xbox are no longer dropped) · replaces invariant 1 of service-achievements.md

### Context

A non-Steam shortcut is often a copy of a game bought on the Epic Games Store or on Xbox (PC Game Pass). Those stores
know the game and the player's unlocks; steam-cartridges ignored them ("Epic/Xbox stay dropped", ADR-0037, and "never
requires Epic or Xbox credentials", service-achievements.md). Research (git show 9a7df2b:docs/plans/steam-cartridges-store-copies-plan.md,
Appendix A) found every copy on disk (Epic manifests, Store packages with an Xbox game config), Epic's own GraphQL
answering anonymously with game data, achievement lists and a public profile's unlocks, Microsoft's catalog answering
anonymously, and Xbox Live unlocks after a device-code sign-in. Unlocks of no source reached the Activity feed.

### Decision

1. **A copy is found, never typed:** from the store's install data on this PC (`store` part, `store_service.lua`).
2. **Steam first:** a copy with a Steam match keeps Steam's Game Info, art, community content and news. Without one: the
   copy's store, then IGDB, then ScreenScraper, for Game Info and the Community tab (store screenshots; no store
   trailers: Steam's card plays YouTube only). Art stays SteamGridDB.
3. **Unlocks are synced, not observed:** sources `epic` and `xbox` come first for a copy; synced when the page opens (at
   most every 15 min) and with `force` when the game quits. No launch toast, no polling, no unlock toast: the store's
   overlay notifies; a sync's new unlocks go to the Post-Game Summary (`achievements.synced`). Steam's list is kept when
   it covers every store id.
4. **Credentials:** Epic needs none (the account id is on disk; the profile's achievements must be public, the panel
   says how). Xbox stores only the refresh token, xuid and gamertag in the data folder's `.env` through `web_config`;
   tokens and device codes are never logged. The public client ids (Microsoft's `00000000402b5328`) are constants; the
   risk that a store blocks a borrowed client is accepted, and the source then fails silently (ADR-0014).
5. **Not resettable:** an Epic or Xbox copy is not offered by Reset Achievements (`achievementsResettable`).
6. **Unlocks of every source appear in the Activity feed** as Steam's own "achieved" event, one per day.
7. **Auto-add:** per store, off by default; adds installed games without a shortcut (launcher link for Epic,
   `shell:AppsFolder` for Xbox) into a collection named after the store; never removes one. It runs at start-up, when a toggle changes
   and every 60 s (2026-10-03, so a game installed while Steam runs needs no restart); a game is requested once per session. The plugin may write the
   user's library only through the `library-shortcuts` surface, and only when the user turned the toggle on.

### Consequences

- A store copy shows its store's Game Info and screenshots, and the player's store unlocks, with no setup (Epic) or one
  sign-in (Xbox). A private Epic profile shows a locked list and a note.
- Two new network services (Epic, Xbox) behind `net`'s breakers; one request per game for ids, remembered.
- Activity days now include achievements for every shortcut; the feed object is replaced on each change.
- The library can change on its own once the user turns auto-add on (new shortcuts, a new collection).
- Not verified yet: a GDK game (`MicrosoftGame.config`), the collection API, and launching through the Epic link form;
  the live checks in the plan cover them, and each fails open.

## ADR-0057: The Epic Steam Overlay Workaround closes the Epic launcher at Steam's Play and after the game

**Status:** Accepted · 2026-10-03 (the user's decisions A, B and E of the [launch-tracking plan § 8](plans/steam-cartridges-store-launch-tracking-plan.md#8-decisions-for-the-user-ask-after--7-with-the-recommendation))

### Context

Steam's overlay reaches a non-Steam game only when Steam created it: Steam tracks, and injects its overlay into, what a
process it started creates (plan § 2 F12). An Epic shortcut runs the Epic Games Launcher with the game's dashed launch
link; when the launcher is already running (it starts with Windows by default), the new instance only forwards the link and
the game starts outside Steam's tree: no overlay, no in-game toast, no recording. When Steam did start the launcher, it
keeps showing the game as running after the game exits, because the launcher lingers. No Millennium or `SteamClient` API can
re-target Steam's tracking or overlay (F20). Measured (plan § 7): a wrap of `SteamClient.Apps.RunGame` held Steam's own
Play for 0.7 s while an open launcher was closed, and the overlay attached to the game (E8); ending the launcher after the
game and Epic's cloud sync ended the running state 8-13 s after the game (E1).

### Decision

1. **One setting, `epicOverlayWorkaround` ("Epic Steam Overlay Workaround", Third-party), off by default.** It turns on both steps.
2. **At Play:** the `launch-hold` surface wraps `SteamClient.Apps.RunGame` and holds only the shortcuts `app/epic-launcher`
   lists in `launch.hold-mode` (the Epic copies started through the launcher link, `StoreEpicLaunchShortcuts`, while the setting is
   on); every other launch goes to Steam untouched. The app asks the backend (`StoreEpicPrelaunch`) to close a running launcher,
   then answers `launch.release`. Fail-open: a held launch goes on after 10 s, a failed backend call releases it at once, and the
   backend closes nothing for a request older than 3 s (a queued request must never close the launcher Steam has just started,
   found live: a busy backend delayed an answer 9 s).
3. **After the game:** a reaper (`StoreEpicReap`, ticked every 3 s by `app/epic-launcher` only while such a game runs) waits until
   the game's image has been gone 5 s, then for Epic's `Cloud Sync: Upload Complete` line (cap 30 s), then ends only the launcher
   processes started for this launch (`taskkill /T /F` by pid, start time at or after the launch).
4. **Never** with a download or install pending (`Manifests\Pending` not empty or a manifest with `bIsIncompleteInstall`), in
   either step. No command line is logged (the game's carries an exchange code).
5. **Existing Epic shortcuts are converted** to the launcher with the dashed link (the plugin is not released yet; the user's
   decision E). New shortcuts already use it (`store_epic_local.launch_spec`).

### Consequences

- The overlay, in-game toasts and Steam's recording work for Epic games launched from Steam's UI, and the running state ends
  with the game.
- The user's Epic launcher (store, friends) is closed at each Epic launch and after the game while the setting is on.
- A launch from outside Steam's UI (a desktop shortcut, a `steam://rungameid` link) is not held: the overlay then needs the
  launcher closed by hand; the reaper still ends the launcher after the game (it counts a launcher started up to 15 s before
  the launch event).
- Steam's Stop still ends the entry: the reaper sees the game gone and ends the launcher.
- Xbox games are not covered (no route puts them in Steam's tree; plan § 7).

## ADR-0058: Xbox UWP shortcuts run the game's own exe, and the plugin repoints them after an app update

**Status:** Accepted · 2026-10-04 (the user's decision C of the [launch-tracking plan § 8](plans/steam-cartridges-store-launch-tracking-plan.md#8-decisions-for-the-user-ask-after--7-with-the-recommendation), option U0)

### Context

An Xbox shortcut ran `explorer.exe shell:AppsFolder\<package>!App` (ADR-0056): Explorer exits at once, so Steam showed the
game as running for a second, counted no playtime and kept no timeline. Measured (plan § 7, F16, E3c-d): when anything starts
a UWP game's exe in its `WindowsApps` package folder, Windows starts `SystemUWPLauncher.exe` as that process's child, which
activates the game and lives exactly as long as it. As a shortcut's exe it gives Steam the running state, playtime and a
timeline for the whole game. It gives no overlay (the game still runs under Windows' activation service; no route puts a UWP
game in Steam's tree, plan § 7). The folder name holds the package version, so an app update leaves the shortcut pointing at
a folder that no longer exists. A GDK/Win32 package (Fortress Merge) relaunches itself outside Steam's tree from its exe (F18).

### Decision

1. **New UWP shortcuts run the game's own exe** (`store_xbox_local.u0_spec`: package root + the manifest's `Executable`, no
   launch options). A package is UWP when its manifest's `EntryPoint` is an app class, not `Windows.FullTrustApplication`. GDK
   and Win32 packages keep the Explorer launch.
2. **Repair after an app update:** at start-up and on the 60 s install tick (while the Xbox store is on), the backend lists the
   shortcuts whose exe is inside a `WindowsApps` folder of an installed UWP game but is not the current version's exe
   (`store_service.xbox_repairs`); `app/store-sync` asks the `library-shortcuts` surface to point them at the current exe and
   start folder (`SetShortcutExe`, `SetShortcutStartDir`; the appid stays, so playtime and activity stay). A request is made once
   per shortcut and target per session.
3. **Only shortcuts that already run a package's exe are repointed.** An Explorer shortcut or any other target is never changed
   by the repair. The user's existing UWP shortcuts were converted once by hand (decision E: the plugin is not released yet).
4. **Matching ignores the version:** an exe inside any version's package folder matches its game (`pfn_from_path`), so an
   outdated shortcut is not taken for a missing game and auto-add adds no duplicate.

### Consequences

- Steam shows Xbox UWP games running for as long as they run, with playtime and a timeline (enhanced-notifications no longer
  reports `no-running-timeline` for them; screenshots and clips still need a recording, which Steam does not make for a game
  outside its tree).
- No overlay, no in-game toast for these games; Steam's Stop ends `SystemUWPLauncher`, not the game.
- After an app update that happens while Steam runs, a launch within the next minute can fail once; the next tick repairs it.
- The plugin now changes a shortcut it did not just add; limited to package-exe shortcuts and logged per repair.

## ADR-0059: LuaJIT bytecode interpreter mode enforcement and atomic schema sync

**Status:** Accepted · 2026-10-05 · **Amends [ADR-0032](#adr-0032-steam-cartridges-hexagon-architecture-and-ports)** (stability guardrail for Millennium LuaVM IPC bridge)

### Context

On large RetroAchievements or trophy schemas (*Lufia II*, *The Lion King*, *Kirby: Nightmare in Dream Land*), `millennium.luavm64.exe` repeatedly crashed with `EXCEPTION_ACCESS_VIOLATION (0xC0000005)` at RVA `0x1087C` (`movdqu [r15], xmm0`) with `R15 = 0x38000`.

Minidump analysis and binary disassembly revealed:
1. Millennium C++ holds a pointer to its return `std::string` buffer in `R15` across Lua evaluation. Under the Windows x64 ABI, `R15` and `R14` are callee-saved registers.
2. The LuaJIT entry point `vm_pcall` (`0x140002f8a`) only saves and restores `rbp, rdi, rsi, rbx`, completely ignoring `R14` and `R15`.
3. In pure interpreter mode, LuaJIT bytecode does not touch `R14` or `R15`. However, when hot loops run (e.g. iterating 70+ achievements or serializing large JSON stores), LuaJIT's JIT trace compiler trips `HOTLOOP = 56` and compiles native traces that assign `R14 = 0x8000` and `R15 = 0x38000`.
4. Upon returning to C++, `R15` is left corrupted, causing `movdqu [r15], xmm0` to fault.
5. In addition, `achievements.json` (2.6 MB) was being serialized and written to disk twice in immediate succession (`store.save_schema` + `store.sync`).

### Decision

1. **Enforce pure interpreter execution via `jit.off()`:** Call `jit.off()` at backend initialization (`backend/main.lua`) and before dispatching RPC methods (`backend/rpc.lua`). LuaJIT's handcrafted assembly bytecode interpreter executes in ~3 ms per 1,000,000 iterations without compiling traces, eliminating register corruption across the Millennium C++ boundary.
2. **Atomic Schema & Sync Persistence:** Provide `achievements_store.save_schema_and_sync(shortcut_appid, schema_id, schema, unlocks, source)` to update the schema and shortcut unlocks in memory and write to disk once, reducing disk I/O and JSON serialization by 50%.
3. **Purge dead pretty-printing code:** Remove unused `format_json` in `web_metadata_db.lua`.

### Consequences

- Zero register corruption across the Millennium C++ RPC bridge.
- All RetroAchievements schemas, regardless of achievement count, load cleanly without tripping JIT trace compiler faults.
- Halved disk I/O for newly fetched or updated achievement schemas.

## ADR-0060: Page data first: priority lanes, paint from disk, then refresh

**Status:** Accepted · 2026-10-06 · Builds on [ADR-0051](#adr-0051-downloaded-media-stays-on-disk-while-its-game-is-opened-the-user-sets-the-days) (the Lua host serves one call at a time; no parallel backend calls). Audit and evidence: [the data flow plan](plans/steam-cartridges-dataflow-improvements-plan.md).

### Context

Achievements on a non-Steam game's page often appeared long after the page opened. Millennium's Lua host runs one
call at a time and its downloads block it, so the order of the calls *is* the order the page fills in. The audit found:
one global first-in-first-out call queue shared by the page, the background ingest, the 60 s store-sync tick and the
2 s in-game observer (whose `setInterval` piled calls up while the host was busy); a view that asked for achievements
only after Game Info, artwork and community media's first call; achievements with nothing stored (a PC game without a
source, a RetroAchievements miss) looked up again on every view, ingest run and observer poll; ROM hashes and
RetroAchievements GameIDs kept in memory only, so every Steam start paid them again; and start-up reading every stored
record twice.

### Decision

1. **Priority lanes in the port.** `ports/transport.ts` keeps one queue per lane (`view`, `normal`, `media`,
   `background`); when the host is free, the oldest call of the most urgent non-empty lane runs. A running call is never
   interrupted, and calls still run one at a time (ADR-0051 stands). The lane is the caller's choice (`app/`); the port
   only orders and times the calls (`rpcDiagnostics()`).
2. **Paint from disk, then refresh.** A view first reads Game Info and achievements as stored (`EnsureFresh` with
   `noNetwork`, view lane), then resolves the store copy and the Steam match, then asks a source only for a part that is
   missing or due. The backend owns the TTLs (`fresh_policy`) and marks a disk answer `stale` when it is due; the
   frontend never decides freshness. Game Info is refreshed before achievements (it is the top of the page and its
   fetch is short), both before artwork (`normal`) and community media (`media`).
3. **No repeated empty lookups.** `freshness.json` keeps a part's last non-ok status (`<part>_status`). With nothing
   stored, achievements answer a remembered `unsupported` for 24 h and a remembered `error` for 30 min; `force` (Sync
   now, the Review modal's Fetch) asks again. A failed refresh of a stored part keeps the stored part. The in-game
   observer resolves a missing schema once per session, and re-arms only after each check settles.
4. **RetroAchievements lookups persist.** `ra_cache.json` keeps a ROM's hash while its size and mtime are unchanged,
   and a hash's GameID (a definite miss for 7 days; a network failure is never stored).
5. **Start-up reads once.** One shared `GetAllRecords` feeds both preloads, in the view lane, before the library grid;
   controller inference and auto-routing profiles load once; ingest waits for the preloads, uses the background lane and
   asks one part per call.

### Consequences

- A page's own calls wait at most for the one call already running, never for background work queued before them.
- A known game's Game Info and achievements show after one short disk read each.
- A setting that would make an `unsupported` game supported (new credentials, a changed launch command) takes effect
  after 24 h or a forced fetch, not on the next view. This only covers games with **nothing stored** and no source
  (no ROM path, trophy folder or Steam match), so RetroAchievements is not involved.

**Amendment (2026-10-06, the user's review): RetroAchievements unlocks are asked on every page open.** One
RetroAchievements profile is played on several devices (and the website), so an unlock earned elsewhere must show when
the page opens. Before this, a game whose list was stored never asked its profile again (`get_or_fetch` returned the
stored copy). Now a stored RetroAchievements part comes due after 5 min (`TTL.achievements_ra`; the gap only absorbs
Steam reporting one view several times), and its refresh is one request by the stored GameID (no ROM hash, no title
search). The profile's unlocks are **merged** into the stored ones (an unlock seen here but not yet on the server is
kept); offline, the stored unlocks are answered. The refresh runs after the paint, so the page still shows what is stored
at once.
- Not done: splitting `achievements.json` so an unlock does not re-encode 2.6 MB (needs a migration; its own plan).
