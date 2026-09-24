# AGENTS.md

Guidance for AI agents working in this repository.

## What this repo is

A workspace for building **Millennium** plugins (Steam Client homebrew mods).

The product is a **core plugin plus optional provider plugins**:

- **`non-steam-games-activity`** (the backbone) — gives **any** non-Steam game
  Steam's own rich app detail page, using only data Steam already has: the
  screenshots and recordings Steam itself captured. It does not rebuild that
  page — Steam hides it from shortcuts by app type, so the plugin restores the
  section and feeds Steam's own store. No emulator, no network, no API key.
- **Providers** — optional plugins that enrich the timeline for games they recognise:
  `retroachievements`, `retroarch`, guides, artwork, and so on.

The core must be useful alone and must never depend on a provider. See
[docs/architecture.md](docs/architecture.md).

## Read this before writing code

| Doc                                                      | What it holds                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [TASK.md](TASK.md)                                       | **Start here** — current status, multi-session roadmap, what is next                                                        |
| [CHANGELOG.md](CHANGELOG.md)                             | **Repository history** — all decisions, deprecations, and milestones live here so other docs stay lean                      |
| [docs/steam-architecture.md](docs/steam-architecture.md) | **Steam architecture directory** — cheat sheet of modules, stores, RPCs, and APIs for plugin developers                     |
| [docs/steam-debug.md](docs/steam-debug.md)               | **CEF DevTools guide** — how to inspect `http://localhost:8080`, target topology, Desktop vs Big Picture quirks             |
| [docs/knowledgebase.md](docs/knowledgebase.md)           | Millennium SDK, Steam's local data formats, provider sources, verified facts                                                |
| [docs/architecture.md](docs/architecture.md)             | Core/provider split, data flow, IPC, and provider contracts                                                                 |
| [docs/steam-components.md](docs/steam-components.md)     | **Deep reference** — section registry, stores, event shapes, achievements, notifications, recording RPCs, inspection method |
| [docs/steam-styles.md](docs/steam-styles.md)             | UI styling guidance — why hand-measuring pixels was superseded by component reuse and native block cloning                  |
| [docs/decisions.md](docs/decisions.md)                   | ADRs — _why_ things are the way they are                                                                                    |

Do not re-derive facts already recorded there. Do not contradict an ADR without
writing a new one that supersedes it.

## The two identifiers — do not confuse them

This trips up everything. Steam uses **two different ids** for a non-Steam game:

| Id         | Width  | Where it appears                                                            |
| ---------- | ------ | --------------------------------------------------------------------------- |
| **appid**  | 32-bit | `shortcuts.vdf`, library URLs (`/library/app/<appid>`), `AppOverview.appid` |
| **gameid** | 64-bit | screenshot folders, `screenshots.vdf`, recordings                           |

They convert exactly (**✅ verified**, 9/9 folders on this machine):

```
gameid = (appid << 32) | 0x02000000
appid  = gameid >> 32
```

`0x02000000` is `33554432` — the constant low word marking a shortcut. The frontend
sees appids; the screenshot store is keyed by gameid. Always convert explicitly.

**Recordings do not follow the same rule.** `gamerecordings/` holds clips for native
Steam games too, and those are keyed by the **raw appid**:

```
clips/clip_18310622842007322624_…   non-Steam (composed gameid)
clips/clip_435150_…                 native Steam game (plain appid)
```

So pick the id form by app type, and anchor the match between underscores — a bare
substring search for `435150` also matches `4351501` and any gameid containing it.

## Hard-won environment facts

Non-default on this machine. Never hardcode standard paths — use
`millennium.steam_path()` and discover the rest.

| Thing             | Value here                                    | Default it is NOT              |
| ----------------- | --------------------------------------------- | ------------------------------ |
| Steam             | `C:\game\steam`                               | `C:\Program Files (x86)\Steam` |
| Plugins           | `C:\game\steam\millennium\plugins`            | —                              |
| Millennium config | `C:\game\steam\millennium\config\config.json` | —                              |
| Steam user id     | `83513586`                                    | —                              |
| RetroArch         | `C:\emu\RetroArch` (portable)                 | `%APPDATA%\RetroArch`          |

RetroArch is **portable**: `retroarch.cfg` uses `:\` to mean "the RetroArch install
dir", so `screenshot_directory = ":\screenshots"` → `C:\emu\RetroArch\screenshots`.
Expand it; never treat `:\` as literal.

The reference plugin's `dev.ps1` hardcodes the default Steam path. Our copy must take
it as a parameter.

## Conventions

- **Backend is LuaJIT**, not Python (`"backendType": "lua"`). The Python examples in
  the public docs are legacy.
- **Frontend is TypeScript + Steam's own React**, built with `millennium-ttc`.
- **Backend is LuaJIT**, not Python (`"backendType": "lua"`). The Python examples in
  the public docs are legacy.
- **Frontend is TypeScript + Steam's own React**, built with `millennium-ttc`.
- **Package manager is npm** (`npm run check`, `npm run build`). On Windows PowerShell, use `-ExecutionPolicy Bypass -File dev.ps1` for deploy scripts.
- Never commit secrets. `cheevos_token` / `cheevos_password` live in `retroarch.cfg` —
  read at runtime, never copy into the repo, logs, or docs.

## Guardrails & Regression Prevention (MUST READ BEFORE WRITING CODE)

These rules are drawn directly from real, hard-won regression debugging across Steam's
Activity, Game Info, and Your Stuff tabs. Violating them causes immediate user-facing breaks.

### 1. Prototype Hook Coupling (`BIsModOrShortcut` vs `GetGameID`)
- **The Trap:** Steam's native `AppOverview.prototype.GetGameID()` implementation is:
  ```javascript
  GetGameID() { return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString(); }
  ```
  If you hook or proxy `BIsModOrShortcut()` to return `false` (e.g. to allow the Game Info
  tab to render descriptions and credits without `#AppDetails_Shortcut_Explanation`),
  `GetGameID()` will evaluate to `this.appid.toString()` (`"4263274102"`).
- **The Ripple Effect:** The "YOUR STUFF" tab's Media section (module `57150`, component `Ae.E`)
  queries captures using `overview.gameid` (which delegates to `GetGameID()`). Shortcut
  captures in `screenshots.vdf` and `window.g_GRS` are stored under the composed 64-bit ID
  (`"18310622842007322624"`). Querying by `appid.toString()` returns 0 items, silently wiping
  the "YOUR STUFF" tab into an empty placeholder!
- **The Mandatory Guardrail:** Whenever hooking or proxying `BIsModOrShortcut`, you **MUST**
  also hook `GetGameID` on `AppOverview.prototype` so that it returns `this.m_gameid` whenever
  present:
  ```typescript
  curr.GetGameID = function () {
      if (this.m_gameid) return this.m_gameid;
      return origGetGameID.apply(this, arguments);
  };
  ```
- **Section Registry Safeguard:** In `sections.ts`, never rely solely on `BIsModOrShortcut()`.
  Always test `overview.appid >= 0x8000_0000 || overview.BIsModOrShortcut()` so shortcut
  section restoration is never suppressed when metadata hooks are active.

### 2. Zero Expensive Operations in Hot Prototype Methods ($O(1)$ Strictly Enforced)
- **The Trap:** `AppOverview` prototype methods (`BIsModOrShortcut`, `GetGameID`, `BHasStoreCategory`)
  are called hundreds of times per second by React renders, MobX reactions, and controller navigations.
- **The Ripple Effect:** Running `new Error().stack` inside `BIsModOrShortcut` froze Steam Big Picture
  navigation for 30+ seconds.
- **The Mandatory Guardrail:** All prototype hooks must run in $O(1)$ constant time (e.g.
  `enrichedAppIds.has(this.appid)`). Never generate error stacks, never execute regexes,
  and never perform DOM queries inside high-frequency prototype hooks.

### 3. Single-Pass Webpack Module Pre-Caching
- **The Trap:** Webpack's module registry (`req.m`) contains thousands of modules.
- **The Mandatory Guardrail:** Scan Webpack modules **once** at plugin startup (`initCardComponents()`),
  storing component references in module-scoped variables. Never iterate `req.m` inside component
  render paths, React elements, or recurring callbacks — doing so creates an $O(N^2)$ choke on the UI.

### 4. Multi-Tab Smoke Verification Requirement
- **The Trap:** Verifying only the tab you are working on creates invisible regressions on other tabs
  (e.g. Game Info fixes breaking Your Stuff; Activity styling breaking Big Picture layout).
- **The Mandatory Guardrail:** Before declaring any UI or data change complete, verify ALL four core
  views for a non-Steam shortcut:
  1. **Post-Game Summary / Hero:** Top card renders screenshots, clips, and play evidence.
  2. **Activity Feed:** Daily bucketed cards render with 16:9 thumbnails and `{Username} captured` headline.
  3. **Your Stuff Tab:** Media section displays captures, duration badges, and item count (not the empty placeholder).
  4. **Game Info Tab:** Capsule, description, developer/publisher credits, release date, and category badges render without the grey shortcut warning.

## Working agreements

- **Verify against real local data before asserting.** These docs were built by reading
  this machine's actual `shortcuts.vdf`, `screenshots.vdf`, `retroarch.cfg` and
  screenshot folders. Keep that standard: check the file, don't guess the format.
  Probe scripts belong in the scratchpad, not the repo.
- **The core never reaches the network.** Network access is a provider concern.
  See [ADR-0012](docs/decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).
- **Steam's DOM is not a public API.** Class names are hashed and change between
  builds. Resolve via `findClassModule` at runtime; never hardcode a hashed class.
  See [ADR-0005](docs/decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules).
- **Before building UI, check whether Steam already builds it.** This is the
  first question, not the last. Steam hides whole features from non-Steam games
  by **app type**, not by capability — its app-details section registry swaps
  the full list for `["nonsteam", "notes", "screenshots"]` when
  `BIsModOrShortcut()`. Every component and store behind that filter accepted a
  shortcut's appid the whole time. Restoring the section name and feeding
  Steam's own store produced the real Post-Game Summary and let us **delete
  ~1200 lines** of careful, tested, unnecessary reimplementation
  ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
  The inspection takes minutes and the method is written down:
  [docs/steam-components.md](docs/steam-components.md#reproducing-this-the-inspection-method).
  Work down this ladder and stop at the first rung that applies:
    1. **Restore what Steam already renders** — is it filtered out, not missing?
    2. **Feed Steam's own store** and let it render
       ([ADR-0009](docs/decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
    3. **Render Steam's real component**, resolved from its module cache even
       when `@steambrew/client` does not export it.
    4. **Only then clone Steam's DOM** — last resort.

    A resolved Steam component cannot drift from native (spacing tweaks,
    animation changes, a future UI refresh); a hand-built copy can and will. The
    Post-Game Summary was cloned faithfully, passed testing, and was still
    discarded: it needed five CSS modules resolved by probe key — one of them
    **ambiguous across two different modules**, which silently reintroduced an
    already-fixed bug with no code change — and Steam's own spacing misbehaved
    against content it was never measured for. **If you are measuring pixels to
    match Steam, you are probably on the wrong rung.**

    Resolve by a stable, minification-proof signature (real `prototype` method
    names — these are not mangled, only variable/module bindings are — or a
    class-map probe key), **never by a raw numeric module id**, which reshuffles
    between Steam builds. Always keep a graceful fallback, so a Steam update
    degrades the page instead of crashing it.

- **Never author custom CSS to imitate Steam.** This was the mistake ADR-0022 and
  ADR-0029 corrected. Hand-written styles break across Steam builds and fail
  controller navigation. If custom UI is strictly necessary, clone existing native
  block structures from CEF DevTools and use resolved CSS module classes or
  Steam's `<Focusable>` components. See [docs/steam-styles.md](docs/steam-styles.md).
- **Prefer patching Steam's data over its DOM** ([ADR-0009](docs/decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
- **Respect third-party APIs.** RetroAchievements is donation-funded: cache hard,
  never poll, send a descriptive `User-Agent` ([ADR-0007](docs/decisions.md#adr-0007-cache-retroachievements-responses-on-disk)).
- **Keep `CHANGELOG.md` as the historical record.** All major decisions,
  breakthroughs, and deprecations belong in [CHANGELOG.md](CHANGELOG.md). This
  allows active technical documentation (`docs/steam-architecture.md`, `TASK.md`)
  to stay lean, clean, and forward-looking.
- **Push to GitHub when a session's work is done.** Once a batch of work is
  complete (docs updated, changes verified, TASK.md reflects the true state),
  commit and push to `origin/main` rather than leaving it sitting in the
  working tree. Don't wait to be asked. Still confirm before pushing if
  something in the diff looks destructive or unverified.

## Build & run

Run commands inside the respective plugin directory (`non-steam-games-activity` or `steamgriddb-artwork`):

```bash
npm install
npm run check        # tsc --noEmit
npm run build        # millennium-ttc --build prod
powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart  # Deploy to live plugins dir without restarting
powershell -ExecutionPolicy Bypass -File dev.ps1             # Deploy + restart Steam
```

`dev.ps1` deploys a parallel `-dev` copy so the released plugin stays installed.
Backend changes need a Steam restart; frontend changes need only a reload (`Ctrl+R`
in the Steam devtools).

### Debugging with CEF DevTools

Steam must run with `-dev -cef-enable-debugging` to expose DevTools on
`http://localhost:8080`. Use the root script:

```powershell
.\start-steam-dev.ps1               # Start Steam with DevTools enabled on http://localhost:8080
.\start-steam-dev.ps1 -Restart      # Clean restart Steam into dev mode
.\start-steam-dev.ps1 -BigPicture   # Launch directly into Big Picture Mode with DevTools
.\start-steam-dev.ps1 -OpenBrowser  # Open http://localhost:8080/ in your browser
```

For target mapping (`SharedJSContext` vs Big Picture popup vs Desktop window),
probing webpack modules, and Big Picture inspection traps, see
[docs/steam-debug.md](docs/steam-debug.md).
