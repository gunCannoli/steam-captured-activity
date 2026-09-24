# Millennium Plugins: Guide, Architecture & Guardrails

How to add a plugin to this workspace, develop it, maintain regression-free UI/store hooks, and publish it as a
standalone public repo.

For _what_ the plugins do and why, see [docs/architecture.md](architecture.md)
and [docs/decisions.md](decisions.md). For Millennium's SDK mechanics in
detail, see [docs/knowledgebase.md](knowledgebase.md).

---

## Layout

Each plugin is a self-contained subfolder. Nothing outside its own folder may be
imported, because that folder is what gets published:

```
millennium-plugins/                 <- this repo (private)
├─ README.md · CHANGELOG.md · plugins.md · AGENTS.md · TASK.md
├─ docs/                            <- workspace-wide docs, NOT published
└─ <plugin-name>/                   <- published as its own public repo
   ├─ plugin.json                   <- manifest (required)
   ├─ README.md                     <- written for users, not for us
   ├─ CHANGELOG.md
   ├─ package.json · tsconfig.json
   ├─ dev.ps1
   ├─ backend/
   │  ├─ main.lua                   <- entry point
   │  └─ _lib/                      <- vendored Millennium type stubs
   ├─ frontend/
   │  └─ index.tsx                  <- entry point
   └─ tests/
```

> A plugin must not `require` or import anything from `docs/` or another
> plugin's folder. Providers talk to the core over the RPC contract
> ([ADR-0013](decisions.md#adr-0013-providers-return-data-the-core-renders-it)),
> never by importing its code.

---

## 1. Scaffold

```bash
mkdir -p <plugin-name>/{backend/_lib,frontend,tests}
```

`plugin.json` is the only required file:

```json
{
    "$schema": "https://raw.githubusercontent.com/SteamClientHomebrew/Millennium/main/src/system/plugin-schema.json",
    "name": "<plugin-name>",
    "common_name": "<Display Name>",
    "description": "<one line>",
    "version": "0.1.0",
    "useBackend": true,
    "backendType": "lua"
}
```

Notes that cost time to learn:

- `name` must be globally unique across all Millennium plugins — it cannot shadow
  another plugin's name.
- The schema lives at `src/system/`, **not** `src/sys/`. Published plugins
  reference the latter and it 404s.
- `backendType: "lua"` is not in the published schema but every current plugin
  sets it. The docs' Python examples are legacy
  ([ADR-0002](decisions.md#adr-0002-luajit-backend-not-python)).

Copy the vendored Lua type stubs from an installed plugin — they are `---@meta`
declarations for Millennium's built-ins, not implementations:

```bash
cp "$STEAM/millennium/plugins/<any-plugin>/backend/_lib/"*.lua <plugin-name>/backend/_lib/
```

Available: `json`, `fs`, `http`, `logger`, `millennium`, `utils`, `datetime`.

---

## 2. Backend (LuaJIT)

`backend/main.lua` returns a lifecycle table. Anything assigned to a **global**
becomes callable from the frontend:

```lua
local millennium = require("millennium")
local RPC = require("rpc")

GetActivity = RPC.GetActivity    -- global = exposed to the frontend

local function on_load()
  millennium.ready()             -- REQUIRED, or the frontend hangs forever
end

return {
  on_load = on_load,
  on_frontend_loaded = function() end,
  on_unload = function() end,
}
```

RPC crosses the boundary as **strings**, so JSON-encode both ways:

```lua
local function method(name, func)
  return function(payload)
    local ok, data = pcall(json.decode, payload or "{}")
    if not ok or type(data) ~= "table" then data = {} end

    local success, result = pcall(func, data)
    if not success then
      logger:error("RPC " .. name .. " failed: " .. tostring(result))
      return json.encode({ error = tostring(result) })
    end
    if result == nil then return "null" end   -- never return bare nil
    return json.encode(result)
  end
end
```

> **Returning bare `nil` crashes Millennium** — it tries to parse the result as
> an integer. Always return the string `'null'`.

Useful backend APIs: `millennium.steam_path()`, `millennium.get_user_settings()`,
`millennium.set_user_settings_key()`, `millennium.version()`,
`utils.base64_encode()`, `fs.*`, `http.get/post`.

---

## 3. Frontend (TypeScript + Steam's React)

`package.json` — mirror the reference plugin
([k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes)):

```json
{
    "scripts": {
        "check": "tsc --noEmit",
        "build": "millennium-ttc --build prod",
        "dev": "powershell -ExecutionPolicy Bypass -File dev.ps1"
    },
    "dependencies": {
        "@steambrew/client": "^5.8.5",
        "steambrew-utils": "0.0.0-beta-20260816131110"
    },
    "devDependencies": {
        "@steambrew/ttc": "^2.8.7",
        "typescript": "^5.9.3",
        "oxfmt": "^0.53.0",
        "oxlint": "^1.68.0"
    }
}
```

`frontend/index.tsx`'s default export is the load hook:

```tsx
export default async function OnPluginLoaded() {
    /* register watchers */
}
```

**Never hardcode Steam's CSS classes** — they are build-hashed and change between
client versions. Resolve them at runtime, and borrow Steam's own formatters and
translations so the UI looks native
([ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)):

```ts
const PlayBar = findClassModule((m) => m.GameStat) as Record<string, string>;
const formatDuration = findModuleExport((e) =>
    e?.toString?.()?.includes('"#Played_"'),
);
Steam.LocalizationManager.LocalizeString("#AppDetails_SectionTitle_PlayTime");
```

### Build nothing Steam already builds

Work down this ladder. **Stop at the first rung that applies** — every rung
below is more code you own and more that can drift from native.

**1. Is Steam already rendering this, just not for your case?**

This is the rung that matters most, and the one that is easiest to skip past.
Steam hides whole features by **app type**, not by capability. A section that
looks "missing" for a non-Steam game is usually present and filtered out:

```js
// Steam's app-details section registry
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
```

Everything behind that filter worked fine with a shortcut's appid the whole
time. Restoring the section name and feeding Steam's own store produced the
real component — pager, day separators, date labels, media viewer — and let us
delete ~1200 lines of careful, tested, _unnecessary_ reimplementation
([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

Before writing a component, go and look. The method is in
[steam-components.md](steam-components.md); it takes minutes.

**2. Can you put your data into Steam's store?**

If Steam models the thing, write to Steam's model and let it render
([ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
Steam's stores are MobX singletons with ordinary public methods — the
post-game summary is `CGamePlaySession.AddClip` /
`BAddScreenshotNotification`, and the library grid is fields on `AppOverview`.

**3. Can you render Steam's real component yourself?**

Resolve it out of Steam's module cache and render it directly, even if
`@steambrew/client` does not export it. Also check what the SDK _does_ export
first — `Carousel`, `SuspensefulImage`, `Focusable`/`FocusRing`, `Button`,
`TextField`, `Panel`, `Tabs`, `Modal`, `Dropdown`, `SliderField`,
`ToggleField` and more are real, shipped components. Reusing them means focus,
keyboard and gamepad behaviour come for free.

**4. Only then, clone Steam's DOM shape.**

Last resort, for when no component is reachable. Clone the literal tree — same
nesting, same classes resolved via `findClassModule`, same `Panel` utility
class — and hide Steam's original in that slot with one scoped rule:

```tsx
<div data-mine="playtime" className={`${C.GameStat} ${C.Playtime} Panel`}>
    <style>{`.${C.GameStat}.${C.Playtime}:not([data-mine]){display:none!important}`}</style>
    {/* ...clone the rest of Steam's tree here... */}
</div>
```

Only render a clone when you have the data, matching how Steam's own container
only shows populated stats.

> **A clone is a liability, not an achievement.** The Post-Game Summary was
> cloned faithfully, passed testing, and was still discarded: it needed five
> CSS modules resolved by probe key (one of them **ambiguous across two
> different modules**, which silently reintroduced an already-fixed bug), and
> Steam's own spacing misbehaved against content it was never measured for. If
> you find yourself measuring pixels to match Steam, you are probably on the
> wrong rung.

**Big Picture Mode (Gamepad UI) uses the exact same store-feeding architecture (Rung 2).**
Earlier investigations assumed Big Picture was a separate bundle with unreachable stores (ADR-0023/ADR-0024).
Live inspection (ADR-0029) proved otherwise:

- The `Steam Big Picture Mode` popup window contains **no scripts or module bundle**. It is a bare `about:blank` window with `<div id="popup_target"></div>`.
- Big Picture is rendered directly from `SharedJSContext` via `ReactDOM.createPortal`. Both Desktop and Big Picture share the same React runtime, section registry (`CAppDetailsSections`), and MobX store singletons (`appSpotlightStore`, `appActivityStore`, `StoreItemCache`).
- Feeding Steam's stores automatically renders Steam's real native components in Big Picture's "ACTIVITY" tab (`Ge.T` for summary, `ae.W` for activity), with full controller D-pad navigation, focus rings, and responsive layouts.
- **Navigation detection via `react/jsx-runtime`:** Because Big Picture navigation is purely client-side React state and never touches `window.location` (ADR-0026), `watchGamepadAppid` in `steam/gamepad-appid.ts` wraps `react/jsx-runtime`'s `jsx`/`jsxs` exports via `beforePatch`, filtering on `{ appid, rgSections }` to detect app transitions reliably with zero DOM polling (ADR-0027).

### Rules that apply on every rung

**Never hardcode Steam's CSS classes** — they are build-hashed
([ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)).
And **never resolve anything by numeric module id**: ids reshuffle between
builds. Resolve by a stable signature — real `prototype` method names, which
survive minification — or a class-map probe key.

**Resolve ONE `findClassModule` probe per CSS module, never per feature.**
Classes seen together in one captured `outerHTML` do **not** imply they live in
the same webpack module. Reusing one probe across modules makes
`findClassModule` silently return `undefined` for the others' keys, and React
renders those elements with **no class at all** — no error, just a tile with
`className="Panel"` and none of its sizing. Verify co-membership by walking the
module cache ([knowledgebase.md § Classes seen together are not necessarily one
module](knowledgebase.md#classes-seen-together-in-one-element-are-not-necessarily-one-css-module-verified-the-hard-way-building-non-steam-games-activity)),
and sanity-check a resolved map by dumping it whole rather than trusting that a
name "sounds right".

**Always keep a graceful fallback.** Every lookup into Steam's internals can
fail on a future build. A failed resolve must degrade the page to stock, never
crash it.

If a project ends up with a dedicated stylesheet of hand-tuned colors, shadows
and spacing meant to _look like_ Steam, that is the signal something should
have been reused instead.

Both the desktop client and Big Picture arrive through `onPopupCreate`; Big
Picture is a separate popup window (`SP BPM_`), not a separate sandbox
([ADR-0016](decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)).

### Core architectural principles

- **The core never reaches the network.** Network access is a provider concern.
  See [ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).
- **Steam's DOM is not a public API.** Class names are hashed and change between
  builds. Resolve via `findClassModule` at runtime; never hardcode a hashed class.
  See [ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules).
- **Prefer patching Steam's data over its DOM** ([ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
- **Never author custom CSS to imitate Steam.** Hand-written styles break across Steam builds
  and fail controller navigation. If custom UI is strictly necessary, clone existing native
  block structures from CEF DevTools and use resolved CSS module classes or
  Steam's `<Focusable>` components. See [docs/steam-styles.md](steam-styles.md).
- **Respect third-party APIs.** Cache hard, never poll, send a descriptive `User-Agent`
  ([ADR-0007](decisions.md#adr-0007-cache-retroachievements-responses-on-disk)).

---

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

### 5. Persistent In-Memory Stubs & Negative Cache Immunization

- **The Trap:** Aggressively deleting in-memory stubs (`storeCache.m_mapApps.delete(appid)`) from
  shared singletons inside view unmount / unpatch hooks (`clearActivity`).
- **The Ripple Effect:** React components unmounting asynchronously detect a cache miss and call
  `QueueStoreItemRequest`. Because non-Steam shortcuts have no store entry, Steam's backend returns 404,
  permanently adding the appid to `StoreItemCache.m_setUnavailableApps` (Steam's internal negative blacklist).
  When the user returns to the game, `useStoreItemCache` checks `BIsStoreItemMissing()` (which tests
  `m_setUnavailableApps.has(appid)`), evaluates to `true`, and returns `undefined`. The event renderer
  (`dt` in module 80478) then returns `null`, wiping out all daily activity events into an empty `<div></div>`!
- **The Mandatory Guardrails:**
    1. **Never delete shortcut stubs from `StoreItemCache.m_mapApps`** on view unpatch. They cost trivial RAM (~150 bytes) and keep Steam's store cache satisfied indefinitely.
    2. **Always purge negative caches on ingestion:** In `publishActivity`, call `storeCache.m_setUnavailableApps.delete(appid)`.
    3. **Immunize via Prototype Hook:** Hook `StoreItemCache.prototype.BIsAppMissing` to return `false` whenever `appid >= 0x8000_0000`.
- **Reference:** Full live trace and specification in [knowledgebase.md § Trap 8](knowledgebase.md#trap-8-negative-cache-poisoning--stub-lifetime-in-storeitemcache).

### 6. Two-Way Navigation Lifecycle Smoke Verification (Game A ➔ Game B ➔ Game A)

- **The Trap:** Testing only a single "clean restart ➔ open game" navigation path. Single-pass testing
  never exercises asynchronous unmount hooks, negative cache blacklisting, or route transition race conditions.
- **The Mandatory Guardrail:** Every UI or store verification MUST execute a two-way navigation lifecycle loop:
    1. Open Non-Steam Shortcut A (verify all sections render).
    2. Navigate to Native Game B (or Library Home).
    3. Navigate back to Non-Steam Shortcut A (verify all sections, daily buckets, and cards remain 100% intact).

### 7. Safe Category Cache Invalidation

- **The Trap:** Adding categories directly to `overview.m_setStoreCategories.add(catId)` without clearing
  previously assigned managed categories.
- **The Ripple Effect:** When switching between titles or re-enriching, categories accumulate in memory,
  causing false badges (e.g. false "Achievements" or "Controller Support" badges on titles that lack them).
- **The Mandatory Guardrail:** Before adding categories, always purge managed category IDs:
    ```typescript
    for (const catId of Object.values(STEAM_CATEGORIES)) {
        overview.m_setStoreCategories.delete(catId);
    }
    ```

### 8. Dedicated Metadata Association (Never Overwrite `appData.details`)

- **The Trap:** Initializing synthetic `appData.details = {}` to feed developer/publisher credits.
- **The Ripple Effect:** Native Steam components (`GameStatsSection`) expect internal store-only arrays
  (`vecChildConfigApps`, `unEntitledContentApp`). Overwriting `details` with an empty object throws unhandled
  TypeErrors and crashes the Game Info view.
- **The Mandatory Guardrail:** Never overwrite `appData.details`. Exclusively feed Steam's dedicated data channels:
    - Descriptions: `appData.descriptionsData = { strSnippet, strFullDescription }`
    - Credits: `appData.associationData = { rgDevelopers, rgPublishers, rgFranchises }`

### 9. Automated CDP Verification Suite

Before concluding any work, run the automated diagnostic scripts in `scratch/`:
```powershell
node scratch/test_nav_cycle.js   # Verifies two-way navigation lifecycle (hasEvent: true)
node scratch/check_all_tabs.js    # Verifies Post-Game Summary, Activity, Your Stuff, Game Info
```

---

## 4. Develop

```bash
pnpm install
pnpm check                 # tsc --noEmit
pnpm build                 # millennium-ttc --build prod
pnpm dev                   # build + deploy + restart Steam
```

`dev.ps1` deploys a parallel `<name>-dev` copy so the released plugin stays
installed, and enables it in Millennium's `config.json`. **Take the Steam path as
a parameter** — the reference plugin hardcodes `C:\Program Files (x86)\Steam` and
silently deploys nowhere on a non-default install
([ADR-0011](decisions.md#adr-0011-do-not-hardcode-steam-or-retroarch-paths)).

A deployed plugin folder contains only `plugin.json`, `.millennium/Dist/` and
`backend/`. Source `frontend/` is not deployed.

- Backend changes need a **Steam restart**.
- Frontend changes need only a reload (`Ctrl+R` in the Steam devtools).
- Run Steam with `-dev` to expose CEF devtools at `http://localhost:8080`.

---

## 5. Test

Millennium ships only its embedded Lua VM, so get a standalone interpreter from
[luabinaries](https://luabinaries.sourceforge.net/) to test backend logic outside
Steam. Put it in `tools/lua/` (gitignored).

The pattern used by `non-steam-games-activity`: a harness stubs Millennium's
`fs` / `utils` / `logger` / `millennium` / `json` modules, then the **real**
backend modules run against a **real** Steam install — no mock data.

```bash
NSGA_STEAM_ROOT="C:\game\steam" lua tests/test_backend.lua
```

Keep machine-specific expectations in one `FIXTURE` table with a skip flag, so
the suite still runs on another install. This caught three real bugs that would
have been hard to spot as wrong-looking output inside Steam.

---

## 6. Publish as a public repo

Plugins are developed here privately and published per-plugin when ready. This
repo documents a specific machine; the plugin folder does not.

**Before the first publish:**

- [ ] `README.md` written for _users_ — what it does, install, configure. Not a
      development log.
- [ ] `CHANGELOG.md` has a real `[0.1.0]` entry with a date
- [ ] `plugin.json` has `version`, `description`, and ideally `thumbnail`
- [ ] A `LICENSE` file
- [ ] No absolute paths, user ids, or machine details in the folder
- [ ] No secrets — grep for `token`, `password`, `api_key`
- [ ] Tests pass

Then split the folder into its own repo, keeping that folder's history:

```bash
gh repo create <plugin-name> --public \
  --description "<one line>"

git subtree split --prefix=<plugin-name> -b publish/<plugin-name>
git push git@github.com:<user>/<plugin-name>.git publish/<plugin-name>:main
git branch -D publish/<plugin-name>
```

Subsequent releases repeat the same three commands — `subtree split` is
idempotent and replays only new commits.

> `git subtree` is one-way by design: develop here, publish outward. Do not
> commit directly to the public repo, or the next push will conflict. Accept
> external PRs by applying them here and re-splitting.

To list the plugin on [steambrew.app](https://steambrew.app/plugins), open a PR
against Millennium's plugin database with the public repo URL.

---

## Checklist for a new plugin

- [ ] Folder created; `plugin.json` with a unique `name`
- [ ] `_lib` stubs copied
- [ ] `backend/main.lua` calls `millennium.ready()`
- [ ] RPC methods never return bare `nil`
- [ ] `dev.ps1` takes the Steam path as a parameter
- [ ] No hardcoded Steam CSS classes (resolve via `findClassModule`)
- [ ] Prototype hooks are strictly $O(1)$ (no stack traces, regexes, or DOM queries)
- [ ] If hooking `BIsModOrShortcut`, also hook `GetGameID` returning `this.m_gameid`
- [ ] Store stubs retained in memory across unmounts (`StoreItemCache.m_mapApps`)
- [ ] Multi-tab verification passed (Summary, Activity, Your Stuff, Game Info)
- [ ] Two-way navigation lifecycle verified (`node scratch/test_nav_cycle.js`)
- [ ] `README.md` + `CHANGELOG.md` present
- [ ] Added to the plugin table in the workspace [README](../README.md)
- [ ] Tests run outside Steam

