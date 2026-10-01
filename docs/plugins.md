# Millennium Plugins: Guide & Guardrails

**This doc's job:** how to build, change, deploy, test and publish a plugin in
this workspace, and every rule that keeps a change from regressing Steam's UI.
If you are writing or fixing plugin code, the rules are here and nowhere else.

Not here: _what_ the plugins do and why
([millennium-architecture.md](millennium-architecture.md),
[decisions.md](decisions.md)); what Steam's internals look like
([steam-components.md](steam-components.md), which opens with the map); SDK reference and data formats
([knowledgebase.md](knowledgebase.md)); inspecting the live client
([steam-debug.md](steam-debug.md)).

---

## Playbook: creating a plugin or a feature

The short path through the docs. Each step names the one doc to open; don't read
the rest. Index of everything: [README.md](README.md).

### A. Both cases, before any code

1. **Orient.** [AGENTS.md](../AGENTS.md) (ids, this machine's paths, routines), then [TASK.md](../TASK.md) *Now* so you don't collide with work in flight.
2. **Check the decisions.** Skim [decisions.md](decisions.md) for the topic. Don't contradict an ADR; supersede it with a new one.
3. **Build nothing Steam already builds.** Walk the [ladder](#build-nothing-steam-already-builds). Restoring a filtered section beat a rebuild by ~1200 lines ([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
4. **Find the Steam target.** [steam-components.md § Map](steam-components.md#map-core-stores--modules) names the store or module and its stable signature. For Steam's overall shape: [steam-architecture.md](steam-architecture.md). Facts outside Steam's UI (SDK, config API, file formats, provider APIs): [knowledgebase.md](knowledgebase.md).
5. **Prove it live before designing.** Probe the running client, cheapest method first: [steam-debug.md § 3](steam-debug.md#3-the-inspection-method) and [§ 7](steam-debug.md#7-cost-efficient-debugging). Never plan from a screenshot or memory.
6. **Read the guardrails.** All of [§ Guardrails](#guardrails--regression-prevention-must-read-before-writing-code). They are cited by code and tests.
7. **Write the plan** to [plans/README.md](plans/README.md) (root cause, ordered steps, verification). One plan per feature or fix, deleted once executed.

### B. A new plugin

1. Scaffold and layout: [§ Layout](#layout), [§ 1 Scaffold](#1-scaffold), [§ 2 Backend](#2-backend-luajit), [§ 3 Frontend](#3-frontend-typescript--steams-react).
2. Decide its place in the suite: core or provider, and what it may depend on ([millennium-architecture.md](millennium-architecture.md); a provider returns data, the core renders it: [ADR-0013](decisions.md#adr-0013-providers-return-data-the-core-renders-it), [ADR-0014](decisions.md#adr-0014-providers-are-isolated-and-fail-silently)). The core never depends on a provider.
3. Copy the shape of a migrated plugin, don't invent one: a safety net, one owner per Steam target, an architecture test with an empty allowlist. References: [enhanced-achievements/architecture.md](enhanced-achievements/architecture.md) (smaller) and [steam-cartridges.md](steam-cartridges.md).
4. Develop, deploy and test with `dev.ps1` ([§ 4](#4-develop), [§ 5](#5-test)). Close with the [checklist for a new plugin](#checklist-for-a-new-plugin).

### C. A new feature in an existing plugin

1. `steam-cartridges`: [steam-cartridges.md § 4 Adding a feature](steam-cartridges.md#4-adding-a-feature). Place each piece on its layer (surface, service or source, sensor, domain, app, port) and stay inside its "what changes, what does not" row.
2. `enhanced-achievements`: [How to add a feature](enhanced-achievements/architecture.md#how-to-add-a-feature).
3. Open the layer doc of each module you touch ([steam-cartridges.md § 3](steam-cartridges.md#3-layer-docs)) and update it in the same change.
4. The architecture tests are the judge. Never widen an allowlist to go green; an entry needs a plan step and a reason.

### D. Done means

1. `npm run check`, the TS tests and (backend) the Lua tests pass ([AGENTS.md Routine 4](../AGENTS.md#routine-4-build--run)).
2. Verified live on the running client: [AGENTS.md Routines 1–3](../AGENTS.md#agent-operating-routines) (four views, Game A ➔ B ➔ A, the CDP scripts). Never weaken a check to match new behaviour (guardrail 15).
3. Docs: the layer doc, [CHANGELOG.md](../CHANGELOG.md) (decisions and findings), an ADR if you decided something, and [TASK.md](../TASK.md) (move finished work out of *Now*).
4. Commit and push ([Routine 5](../AGENTS.md#routine-5-end-of-session-prune-sync--auto-push)). Nothing bound for `SteamClientHomebrew/Millennium` carries AI attribution ([Routine 6](../AGENTS.md#routine-6-no-ai-attribution-on-anything-that-reaches-steamclienthomebrewmillennium)).

---

## Layout

Each plugin is a self-contained subfolder. Nothing outside its own folder may be
imported, because that folder is what gets published:

```
millennium-plugins/                 <- this repo (private)
├─ README.md · CHANGELOG.md · AGENTS.md · TASK.md
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
> never by importing its code. Code shared between plugins (e.g.
> `steam/jsx-hook.ts`) is copied identically into each one.

Inside the frontend, a plugin that writes into Steam follows the same shape: pure decisions, one
`Surface` per Steam target with a kill switch, and an architecture test that enforces it. The worked
examples are [steam-cartridges](steam-cartridges/) (layer docs) and
[enhanced-achievements](enhanced-achievements/architecture.md) (one architecture doc).

---

## 1. Scaffold

```bash
mkdir -p <plugin-name>/{backend/_lib,frontend,tests}
```

`plugin.json` is the only required file (full field table:
[knowledgebase.md § plugin.json](knowledgebase.md#pluginjson)):

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

Frontend and webkit code run in Chromium's sandbox, so **anything touching the
disk or the network goes through the backend**.

RPC crosses the boundary as **strings**, so JSON-encode both ways. Lua side:

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

Frontend side (`Millennium.callServerMethod` is the only channel):

```ts
async function call<R>(route: `RPC.${string}`, payload: object): Promise<R> {
    return Millennium.callServerMethod(route.slice(4), {
        payload: JSON.stringify(payload),
    }).then((r) => JSON.parse(r));
}
```

> **Returning bare `nil` crashes Millennium** — it tries to parse the result as
> an integer. Always return the string `'null'`.

Useful backend APIs: `millennium.steam_path()`, `millennium.get_user_settings()`,
`millennium.set_user_settings_key()`, `millennium.version()`,
`utils.base64_encode()`, `fs.*`, `http.get/post`. For per-plugin settings use
the Configuration API — and read the v3.4.1 bug note first
([knowledgebase.md § Configuration API](knowledgebase.md#plugin-settings--the-configuration-api)).

---

## 3. Frontend (TypeScript + Steam's React)

`package.json` — mirror the existing plugins (originally the reference plugin
[k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes)):

```json
{
    "scripts": {
        "check": "tsc --noEmit",
        "build": "millennium-ttc --build prod",
        "build:dev": "millennium-ttc --build dev",
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

Identify a shortcut with `if (app.appid < NON_STEAM_APP_APPID_MASK) return;`
(`steambrew-utils`), and convert between its 32-bit appid and 64-bit gameid
explicitly ([knowledgebase.md § The two identifiers](knowledgebase.md#the-two-identifiers)).

**Borrow Steam's formatters and strings; never hand-format.** The plugin then
inherits Steam's dates, durations and translations, and follows any restyle:

```ts
const formatRelativeDate = findModuleExport((e) =>
    e?.toString?.()?.includes('"#Time_Today"'),
);
const formatDuration = findModuleExport((e) =>
    e?.toString?.()?.includes('"#Played_"'),
);
Steam.LocalizationManager.LocalizeString("#AppDetails_SectionTitle_PlayTime");
```

### Build nothing Steam already builds

Work down this ladder. **Stop at the first rung that applies** — every rung
below is more code you own and more that can drift from native. Desktop and Big
Picture share one runtime, so the same ladder applies to both
([ADR-0029](decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)).

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
real component — pager, day separators, date labels, media viewer, and in Big
Picture the controller focus rings — and let us delete ~1200 lines of careful,
tested, _unnecessary_ reimplementation
([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

Before writing a component, go and look: [steam-components.md § Map](steam-components.md#map-core-stores--modules)
for the map, [steam-debug.md § 3](steam-debug.md#3-the-inspection-method) for the
method. It takes minutes.

**2. Can you put your data into Steam's store?**

If Steam models the thing, write to Steam's model and let it render
([ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
Steam's stores are MobX singletons with ordinary public methods that do not
validate app type — the post-game summary is `CGamePlaySession.AddClip` /
`BAddScreenshotNotification`, and the library grid is fields on `AppOverview`
(store map: [steam-components.md § Map](steam-components.md#map-core-stores--modules)).

**3. Can you render Steam's real component yourself?**

Resolve it out of Steam's module cache and render it directly, even if
`@steambrew/client` does not export it. Check what the SDK _does_ export first
([knowledgebase.md § Frontend SDK](knowledgebase.md#frontend-sdk--steambrewclient-and-steambrew-utils))
— reusing those means focus, keyboard and gamepad behaviour come for free. In Big
Picture, a whole new feature set goes in as an extra tab on Steam's own
`GamepadTabbedPage` rather than a hand-built page
([steam-components.md § Tabs](steam-components.md#tab-construction--custom-tab-injection)).

**4. Only then, clone Steam's DOM shape.**

Last resort, for when no component is reachable and Steam models no data you
can write to (e.g. the reference plugin's play-bar playtime: there is no
per-shortcut playtime stat to feed). Clone the literal tree — same nesting, same
classes resolved via `findClassModule`, same `Panel` utility class, Steam's own
SVG path data — mount it as a sibling of Steam's element, and hide Steam's
original in that slot with one scoped rule:

```tsx
<div data-mine="playtime" className={`${C.GameStat} ${C.Playtime} Panel`}>
    <style>{`.${C.GameStat}.${C.Playtime}:not([data-mine]){display:none!important}`}</style>
    {/* ...clone the rest of Steam's tree here... */}
</div>
```

`:not([data-mine])` hides only Steam's unmarked element sharing that class pair,
never the clone, and cannot leak elsewhere. Only render a clone when you have the
data, matching how Steam's own container only shows populated stats. On
refresh, `replaceWith` a previously mounted clone instead of appending a second.

> **A clone is a liability, not an achievement.** The Post-Game Summary was
> cloned faithfully, passed testing, and was still discarded: it needed five
> CSS modules resolved by probe key (one of them **ambiguous across two
> different modules**, which silently reintroduced an already-fixed bug), and
> Steam's own spacing misbehaved against content it was never measured for. If
> you find yourself measuring pixels to match Steam, you are probably on the
> wrong rung.

### Rules that apply on every rung

**If you must style anything at all** (a custom panel on rung 3 or 4): never
hand-code CSS to imitate Steam. On desktop, use Steam's own components or
classes resolved with `findClassModule`. In Big Picture, use `<Focusable>`,
`DialogButton`, `Carousel` and Steam's modal containers, which bring controller
focus rings, D-pad navigation and sounds for free. Never build focus rings with
`:hover`/`:focus`. For the few container-level values you might still need, use
Steam's theme variables with these fallbacks:

- font: `"Motiva Sans", Arial, Helvetica, sans-serif`; headers 14px, weight 400
  (not bold), uppercase, `letter-spacing: 1px`; body 13px, weight 400
- `var(--color-text-primary, #e6e6e6)`, `var(--color-text-secondary, #8f98a0)`,
  `var(--color-background-dark, #101216)`, `var(--color-highlight, #1a9fff)`

(This replaces the old `docs/steam-styles.md`, removed 2026-09-28. Its "style
bible" of hand-measured pixel values was superseded by ADR-0022/0029/0030.)

**Never hardcode Steam's CSS classes** — they are build-hashed
([ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)).
And **never resolve anything by numeric module id**: ids reshuffle between
builds. Resolve by a stable signature — real `prototype` method names, which
survive minification — or a class-map probe key
([steam-components.md § Map: stable resolution signatures](steam-components.md#map-stable-resolution-signatures)).

**Resolve ONE `findClassModule` probe per CSS module, never per feature.**
Classes seen together in one captured `outerHTML` do **not** imply they live in
the same webpack module — the Post-Game Summary alone spans four. Reusing one
probe across modules makes `findClassModule` return `undefined` for the others'
keys, and React renders those elements with **no class at all** — no error, just
a tile with `className="Panel"` and none of its sizing. Verify co-membership by
searching the module cache for the class name
([steam-debug.md § 3](steam-debug.md#3-the-inspection-method)), and sanity-check a
resolved map by dumping it whole rather than trusting that a name "sounds right".

**Never pass a class modifier as a literal string.** `cx(M.DurationText, 'Clip')`
compiles, but many class values are already two-token strings
(`M.Small === "_3qlJ0L41KQFqUTzVQKFERC Small"`), so the literal drops the hash and
every rule scoped to it — twice this rendered the wrong size or colour with no
error. Always `cx(M.DurationText, M.Clip)`.

**Always keep a graceful fallback.** Every lookup into Steam's internals can
fail on a future build. A failed resolve must degrade the page to stock, never
crash it.

If a project ends up with a dedicated stylesheet of hand-tuned colors, shadows
and spacing meant to _look like_ Steam, that is the signal something should
have been reused instead.

### Sharing the jsx runtime between plugins

Several of our plugins hook Steam's shared `react/jsx-runtime` (`jsx`/`jsxs`):
`steam-cartridges` (Big Picture appid detection) and
`enhanced-achievements` (achievement banner). Rules:

- **Use `steam/jsx-hook.ts` (`keepJsxPatched`)**, a file copied identically into each
  plugin. It patches through the SDK patcher (`beforePatch` / `replacePatch`), so
  every wrapper links to the next via `fn.__millenniumPatch.original` and
  `unpatch()` works through the whole chain.
- **Never re-patch because "`runtime.jsx` is not my function".** Another plugin's
  patch on top makes that true forever, and two plugins doing it grow the chain
  every poll. `keepJsxPatched` re-installs only when its patch is not anywhere in
  the chain (walk the SDK links; if a foreign non-SDK wrapper hides the rest,
  call `runtime.jsx(SENTINEL, {})` and see whether the handler receives it).
- **Never hand-roll a wrapper** (`runtime.jsx = function…`): it has no
  `__millenniumPatch` link, so it breaks both the chain walk and the SDK's `unpatch()`.
- Handlers run for every element: O(1) only (guardrail 2).
- **Millennium itself drops every plugin's patch, all the time.** Its
  FCTrampoline (core `chunk-index.js`) swaps `SP_JSX_FACTORY.jsx`/`jsxs` for
  stubs while rendering some components, then restores a copy it took when the
  trampoline was *created*, before any plugin patched. Every toast window
  triggers it (verified live 2026-09-25: a single downloads toast dropped all
  plugins' patches within ~130 ms). A 5 s re-check alone leaves up to 5 s in
  which anything rendered loses the patch; that is how a queued achievement
  banner fell back to Steam's toast. So `keepJsxPatched` also installs a
  shared **write guard**: `jsx`/`jsxs` become accessors (the getter returns
  exactly what was last set, so the SDK patcher and Millennium behave as
  before) whose setter schedules every plugin's re-check in a microtask. After
  the fix, 5 ms sampling never caught the patch dead. Upstream fix would be to
  restore the value current at stub time; not yet reported.
- Verify with `node scratch/jsx_chain.js`: steady depth, foreign wrapper on top,
  dropped reference, and a banner still rendering. Toast-triggered drops:
  `jsxDiagnostics()` installs rise by 2 per toast (stub + restore) while `live`
  stays true.

### Core architectural principles

- **The core never reaches the network.** Network access is a provider concern.
  See [ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).
- **Steam's DOM is not a public API.** Resolve via `findClassModule` at runtime;
  never hardcode a hashed class
  ([ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)).
- **Prefer patching Steam's data over its DOM** ([ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
- **Never author custom CSS to imitate Steam** ([§ Rules that apply on every rung](#rules-that-apply-on-every-rung)).
- **Respect third-party APIs.** Cache hard, never poll, send a descriptive `User-Agent`
  ([ADR-0007](decisions.md#adr-0007-cache-retroachievements-responses-on-disk)).

---

## Guardrails & Regression Prevention (MUST READ BEFORE WRITING CODE)

These rules are drawn directly from real, hard-won regression debugging across Steam's
Activity, Game Info, Your Stuff and toast windows. Violating them causes immediate
user-facing breaks. Numbers are stable — code comments cite them.

### 1. Prototype Hook Coupling (`BIsModOrShortcut`, Shortcut Icons, and `GetGameID`)

- **The Trap:** Steam's native `AppOverview.prototype.GetGameID()` and `GetIconURLForApp()` depend on `BIsModOrShortcut()`:
    ```javascript
    GetGameID() { return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString(); }
    GetIconURLForApp(e) { return e.BIsModOrShortcut() && void 0 === e.icon_data ? (SteamClient.Apps.RequestIconDataForApp(e.appid), null) : ...; }
    ```
    Game Info (inner component `k`, module `15448`) drops descriptions and credits
    and renders `#AppDetails_Shortcut_Explanation` whenever `overview.BIsModOrShortcut()` is true.
- **The Catastrophic Ripple Effect of Prototype Pollution:** If you hook `BIsModOrShortcut` globally on `AppOverview.prototype`:
  1. `GetIconURLForApp` sees `BIsModOrShortcut() === false`, skips `RequestIconDataForApp`, and queries Steam CDN for native `icon_hash`. Because shortcuts lack CDN icons, **all non-native shortcut icons turn into missing grey placeholders** across the sidebar and grid!
  2. `overview.gameid` evaluates to `this.appid.toString()` instead of the 64-bit composed ID, wiping the "YOUR STUFF" tab's Media section.
  3. `sections.ts` registry checks fail, dropping Post-Game Summary, Activity, and Achievements.
- **The Mandatory Guardrail:** **NEVER hook `BIsModOrShortcut` on `AppOverview.prototype`**. Instead, use a scoped component props Proxy (`createPatchedOverview(overview)`) exclusively inside component `k`'s `render()`.
- **Signed Int32 CEF Trap:** In CEF, non-Steam 32-bit shortcut IDs (`>= 0x8000_0000`) frequently arrive as **signed negative 32-bit integers** (e.g. `3048673328` becomes `-1246293968`). Testing `overview.appid >= 0x8000_0000` evaluates to `false`! **Always use `isNonSteamAppId(appid)`** (`(appid >>> 0) >= 0x8000_0000`), and normalize across JS Maps and Lua backend (`if n < 0 then n = n + 0x100000000 end`).

### 2. Zero Expensive Operations in Hot Prototype Methods ($O(1)$ Strictly Enforced)

- **The Trap:** `AppOverview` prototype methods (`BIsModOrShortcut`, `GetGameID`, `BHasStoreCategory`)
  are called hundreds of times per second by React renders, MobX reactions, and controller navigations.
- **The Ripple Effect:** Running `new Error().stack` inside `BIsModOrShortcut` froze Steam Big Picture
  navigation for 30+ seconds.
- **The Mandatory Guardrail:** All prototype hooks (and `jsx` handlers) must run in $O(1)$
  constant time (e.g. `enrichedAppIds.has(this.appid)`). Never generate error stacks, never
  execute regexes, and never perform DOM queries inside high-frequency hooks.

### 3. Single-Pass Webpack Module Pre-Caching

- **The Trap:** Webpack's module registry (`req.m`) contains thousands of modules.
  Re-scanning it inside card render paths made the activity feed stutter and freeze.
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
- **A DOM probe can report success while the page looks wrong** — `querySelector` once found
  the summary while the screen still showed the grey box, because React had not re-rendered.
  For a genuinely visual claim, confirm on Desktop and Big Picture with one clipped, low-quality
  screenshot ([steam-debug.md § 7](steam-debug.md#7-cost-efficient-debugging)).

### 5. Persistent In-Memory Stubs & Negative Cache Immunization

- **Why stubs exist:** Steam's activity-event renderer (`dt`, module `80478`) returns `null` unless
  `StoreItemCache` has a visible record for the app. Shortcuts have none, so the core stubs
  `StoreItemCache.m_mapApps.set(appid, stub)` with `BIsVisible() → true` and a satisfied
  `m_DataRequested`, which also guarantees no store request is ever sent
  ([ADR-0030](decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing);
  mechanism in [steam-components.md § Activity feed](steam-components.md#how-the-store-record-blocker-was-cleared)).
- **The Trap:** Aggressively deleting those stubs (`storeCache.m_mapApps.delete(appid)`) from
  shared singletons inside view unmount / unpatch hooks (`clearActivity`).
- **The Ripple Effect:** React components unmounting asynchronously (`useStoreItemCache`, module
  `82594`) detect a cache miss and call `QueueStoreItemRequest`. Because non-Steam shortcuts have
  no store entry, Steam's backend returns 404, permanently adding the appid to
  `StoreItemCache.m_setUnavailableApps` (Steam's internal negative blacklist). When the user
  returns to the game, `BIsStoreItemMissing()` is `true`, the hook returns `undefined`, and the
  event renderer returns `null`, wiping all daily activity events into an empty `<div></div>`.
- **The Mandatory Guardrails:**
    1. **Never delete shortcut stubs from `StoreItemCache.m_mapApps`** on view unpatch. They cost trivial RAM (~150 bytes) and keep Steam's store cache satisfied indefinitely.
    2. **Always purge negative caches on ingestion:** In `publishActivity`, call `storeCache.m_setUnavailableApps.delete(appid)`.
    3. **Immunize via Prototype Hook:** Hook `StoreItemCache.prototype.BIsAppMissing` to return `false` whenever `appid >= 0x8000_0000`.
    4. **Scope card thumbnail CSS precisely:** `[class*="CarouselThumb"]:not([class*="CarouselThumbs"])` with `width: 100% !important`, or parent flex rows squash cards into ~80px cutouts.
- **The same "hook the method, never write into the shared map" shape recurs
  with `appStore`/`appStore.m_mapApps`** (a different store, same lesson):
  writing a same-prototype stub into `m_mapApps` fixed one crash but broke
  the entire library's rendering, since that map is enumerated globally.
  The safe fix patches `appStore.GetAppOverviewByAppID` itself — but even a
  correctly-scoped method patch can break an *unrelated* second caller of the
  same method if it changes what a `null` result means. See
  [knowledgebase.md's two `appStore` entries](knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all)
  for the full trap and the fix (tag the substitute value so only the
  intended caller treats it as real).

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

Before concluding any work, run the live diagnostic scripts in `steam-cartridges/tests/live/` (`npm run test:live` runs the whole set):

```powershell
node steam-cartridges/tests/live/test_nav_cycle.js   # Verifies two-way navigation lifecycle (hasEvent: true)
node steam-cartridges/tests/live/check_all_tabs.js    # Verifies Post-Game Summary, Activity, Your Stuff, Game Info
```

Plus the touched plugin's own `tests/` (e.g. `enhanced-notifications/tests/categories.mjs`).

### 10. Section Registry Memo Mutation

- **The Trap:** `CAppDetailsSections.prototype.GetSections` returns its memoized set
  (`this.m_setSectionsMemo`), not a new one, and compares memos **by size only** — so a patch that
  swaps one section for another is silently ignored.
- **The Mandatory Guardrail:** Mutate the set in place, and clear
  `instance.m_setSectionsMemo = undefined` before calling `instance.forceUpdate()`.

### 11. Asynchronous Data Must Re-Render Every Window

- **The Trap:** MobX observers in Steam react only to changes in Steam's own stores, not to plugin
  state. When captures or metadata arrive asynchronously, the page has already rendered without them.
- **The Mandatory Guardrail:** Write the data into Steam's store, then find every mounted instance
  across **all** documents (Desktop and the Big Picture popup, e.g.
  `g_PopupManager.GetExistingPopup("SP BPM_uid0")`), locate its fiber (`__reactFiber$…`) and
  `forceUpdate()` it.

### 12. Popup Hooks Do Not See Every Window

- **The Trap:** Some Steam popups are opened with `SteamClient.BrowserView.CreatePopup` +
  `window.open` and never registered with `g_PopupManager` — `QuickAccess`, `MainMenu`, and Big
  Picture's single persistent toast window. `Millennium.AddWindowCreateHook` (a thin wrapper over
  `g_PopupManager`), `onPopupCreate` and `g_PopupManager.GetPopups()` never see them. Desktop's
  per-toast popups _are_ registered — one popup type's behaviour says nothing about another's.
- **The Mandatory Guardrail:** Before relying on a popup hook, confirm the target window is
  registered. For an unregistered BrowserView popup, find a handle in a registered window's React
  tree (e.g. the `GamepadToastPlaceholder` element) and walk its fiber to a hook holding the popup
  object, duck-typed on its methods (`GetViewWindow()`) — never a minified name. Reference:
  `enhanced-notifications/frontend/surfaces/style/injector.ts` (fixed and verified live 2026-09-24; see
  CHANGELOG.md). Check the UI mode before trusting a live test
  ([steam-debug.md § 4](steam-debug.md#4-big-picture-mode-gamepad-ui-quirks--traps)).

### 13. Never read a Steam MobX computed before its source exists

- **The Trap:** `collectionStore.userCollections` is a keepAlive computed over `m_mapCollectionsFromStorage`,
  which Steam creates lazily. A read at plugin init throws before tracking any observable, MobX caches the
  error with no dependencies, and every later read (Steam's own `CollectionsHeader`) rethrows it. Symptom:
  "An error occurred while rendering this content" on unrelated pages, with a stack pointing at plugin init.
- **The Mandatory Guardrail:** Gate on a plain field first (`features/buckets/ready.ts`), defer the work until
  it exists, and never read the computed directly. A poisoned session only recovers after a Steam restart.

### 14. A new gate must never remove behaviour that already worked

- **The Trap:** P2 gated *all* Game Info on the `web-scraping` bucket. The default bucket is `none`, so
  every shortcut lost the local-DB Game Info it had before the merge (AM2R showed the grey shortcut box
  again), and the ADR recorded the loss as an accepted consequence.
- **The Mandatory Guardrail:** Gates (buckets, settings, feature flags) decide what may be **fetched or
  newly sourced**. They never hide data that is already local and was shown before
  ([ADR-0035](decisions.md#adr-0035-local-game-info-is-a-capture-tier-feature-buckets-gate-only-fetching)).
  If a change makes any of the four Routine 1 views worse for a default-configured shortcut, it is a
  regression, whatever the ADR says. It needs the user's explicit approval first.

### 15. Never weaken a verification check to match new behaviour

- **The Trap:** `check_all_tabs.js` check 4 was relaxed to "grey shortcut warning accepted" so it would
  pass on the regressed state. The script then reported PASS for a broken Game Info tab.
- **The Mandatory Guardrail:** A check changes only when the *expected* behaviour changes, and that change
  is in an ADR the user accepted. Timing flakes are fixed by **polling the data signal** (Steam's store,
  e.g. `appActivityStore.GetAppActivity(appid).appActivityByDay.length`) with a bounded timeout. Do not
  add a longer fixed wait, and do not compare DOM counts that Steam reveals progressively. The desktop
  activity feed reveals days one at a time (`nDaysToDisplay` / `ShowMoreContent`,
  [steam-components.md § Activity feed](steam-components.md#activity-feed)).

### 16. Millennium Settings Panel Resolution & Build Name Divergence

- **The Trap:** When `npm run build` or `millennium-ttc` runs, it bakes `plugin.json`'s `name` string into the compiled bundle (`__millennium_internal_plugin_name_do_not_use_or_change__ = pluginName`). Millennium registers the exported `content` panel into `window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName]`. When Millennium renders the Desktop Sidebar in the Steam client, it looks up the panel using the plugin's actual folder name on disk (e.g. `steam-cartridges-dev`). If `npm run build` ran with the base name `steam-cartridges` and was deployed without a dev-specific rebuild (or via `-SkipBuild`), Millennium looks up `MILLENNIUM_SIDEBAR_NAVIGATION_PANELS["steam-cartridges-dev"]`, gets `undefined`, and throws `TypeError: Cannot read properties of undefined (reading 'content')` or fails silently when clicking the plugin in Settings.
- **The Mandatory Guardrails:**
  1. **Dual-Alias Registration:** In `frontend/index.tsx`, `definePlugin` must ensure `MILLENNIUM_SIDEBAR_NAVIGATION_PANELS` and `PLUGIN_LIST` alias both base and `-dev` names:
     ```ts
     const panels = (window as any).MILLENNIUM_SIDEBAR_NAVIGATION_PANELS;
     if (panels) {
         if (panels[name] && !panels[devName]) panels[devName] = panels[name];
         if (panels[devName] && !panels[name]) panels[name] = panels[devName];
     }
     ```
  2. **`dev.ps1` SkipBuild Validation:** In `dev.ps1`, `-SkipBuild` must inspect `.millennium/Dist/index.js` to ensure it was actually compiled for `$devName`, triggering a rebuild if built against the release manifest name.

### 17. A render never starts work; a refresh never leaves its own components

- **The Trap (2026-09-28, the Properties-dialog hang):** three changes that were
  each harmless alone closed a loop.
  1. `G.render` and a `props` getter on Steam's Game Info classes called
     `onTriggerAppView` (commits `bf3839f`, `ec16203`), so **rendering** started the
     whole view pipeline (bucket, metadata, achievements RPC).
  2. `enrichGameDetails` always wrote a **new** `descriptionsData` object and
     called `AppDetailsChanged`, so every run re-rendered Game Info through MobX,
     even when nothing had changed.
  3. `refreshGameInfoInstances` walked every window in `g_PopupManager.m_mapPopups`,
     matched the first `[class*=Shortcut]` element, and force-updated **every**
     ancestor component up to the root (`typeof fiber.type === "function"`,
     since `cb8e0fe`).
  The result was render → view → enrich → re-render, about 150 times a second on
  every shortcut page (1,521 enrichments and 727 achievement RPCs in 10 s). It was
  invisible there, but opening **Properties** added that dialog's large tree to
  every trip, and the shared renderer thread never went idle again
  ([knowledgebase](knowledgebase.md#one-renderer-for-every-steam-window-a-busy-sharedjscontext-freezes-them-all)).
- **The Mandatory Guardrails:**
  1. Nothing called from a Steam render, getter, prototype hook or jsx handler may
     emit an event, start a view/fetch/RPC, or schedule work. Views come from the
     route and Big Picture watchers only.
  2. Every write into a Steam store is **idempotent**: if the data Steam holds is
     already ours and unchanged, write nothing and notify nothing.
  3. A refresh force-updates only instances of components **we patched**
     (flags such as `__nsga_props_hooked`), only in the main window and Big Picture,
     and never walks ancestors.
  4. Verify with `node steam-cartridges/tests/live/count_cycle.mjs` (must print `PASS render loop`)
     and `node steam-cartridges/tests/live/test_props.mjs <appid> --page` (must print `OK`)
     for any change to Game Info, sections or store feeding.

### 18. Settings panel layout (reference: `enhanced-achievements`)

- **The Trap:** a settings panel built from bare `PanelSectionRow`s, loose buttons and
  hand-written `fontSize: "12px"` notes looks thin and uneven: rows cramped against each
  other, a lone button floating under a list, a checkbox strip or a dropdown squeezed
  into the right half of a row, notes that do not line up with Steam's own labels.
  `enhanced-achievements/frontend/settings/rows.tsx` has the setup to copy (enhanced-notifications
  has an identical copy; steam-cartridges' copy is `frontend/settings/components.tsx`).
- **The Mandatory Guardrails:**
  1. **Use Steam's components.** `PanelSection`, `Field` (label + description, optional
     control), `Toggle`, `DialogButton`, `Dropdown`, `TextField`, `SliderField`. No
     hand-made rows, notes or checkboxes. Text that explains a control is that
     control's `Field` description, not a loose `<div>`.
  2. **A row has two columns at most**, and two only for a simple control: label and
     description on the left, one toggle or one (or two small) button(s) on the right.
  3. **A control that needs room gets the full row.** Anything with a dropdown, a text
     field, a textarea or a long button is three rows: the label, the description, then
     the control across the full width (`FullWidthRows`: two `Field`s, the second with
     `childrenContainerWidth="max"`). Never put a dropdown in a right-hand column, and
     never put several controls side by side in one row.
  4. **Spacing is a system, not per-row margins.** A *block* is a group of rows that read
     as one card; its rows touch (no gap). Blocks of a section are `BLOCK_GAP` (22 px)
     apart, set in one place: `<Blocks>` takes each block as one child (a fragment of
     rows) and adds `padding-top` (padding, because margins collapse into Steam's own
     trailing margin). Steam's `SliderField` and `TextField` end with 22 px of blank
     space of their own: `ItemRow trailing` cancels it, so a block's spacing never
     depends on its last control. Controls stacked inside one custom card are
     `CONTROL_GAP` (8 px) apart on the card's colour (`CARD_BACKGROUND`, measured live).
  5. **Group by meaning.** Options that belong together (an on/off toggle and the
     sliders it enables) are one block; unrelated options, and every button that opens
     a popup, are their own block. An "Add ..." button is a `ButtonRow` (label,
     description, button), not a bare button under a list.
  6. **Popups follow the same rules** (they are panels too): `Field`s and the shared rows
     inside a `PanelSection` and `Blocks`, player tags and other flags as toggle rows
     (not a checkbox strip), results as one two-column row each.
  7. **No diagnostics in a settings panel.** Kill switches, safe mode and error counters
     are not shown to the user (removed from steam-cartridges 2026-09-30); the log and
     `disabledFeatures` stay the tools for that.

### 19. Every restart ends with the boot health check

- **The Trap:** "Steam's UI is not loading" after a deploy gets blamed on the last change, and an
  agent starts reverting code. On 2026-10-01 the suspected change (F2c) had not even been written; the
  cause was Steam itself after the PC woke from sleep, started without DevTools
  ([steam-debug.md Trap 12](steam-debug.md#trap-12-steams-ui-is-not-loading-is-often-not-a-plugin)).
  The opposite also happens: a plugin that throws at start-up leaves Steam up but the plugin missing
  from `PLUGIN_LIST`, and nothing says so until a feature is found dead.
- **The Rule:** after every Steam restart, `node steam-health.mjs --wait 120` must PASS before any
  other live check counts. `dev.ps1` (all three plugins) and `start-steam-dev.ps1` run it for you,
  and `npm run test:live` runs it first. A FAIL that survives a clean restart
  (`start-steam-dev.ps1 -Restart`) is ours; one that does not is Steam's. Never weaken its thresholds to
  get a PASS (guardrail 15). A new plugin's `dev.ps1` and live runner call it the same way.

---

## 4. Develop

Run inside the plugin directory:

```powershell
npm install
npm run check                                                  # tsc --noEmit
npm run build                                                  # millennium-ttc --build prod
powershell -ExecutionPolicy Bypass -File dev.ps1               # build + deploy + graceful Steam restart
powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart    # deploy only
```

`dev.ps1 [-SteamPath <dir>] [-NoRestart] [-SkipBuild]` deploys a parallel
`<name>-dev` copy so the released plugin stays installed, and enables it in
Millennium's `config.json` (`plugins.enabledPlugins`). **It takes the Steam path
as a parameter** — the reference plugin hardcodes `C:\Program Files (x86)\Steam`
and silently deploys nowhere on a non-default install
([ADR-0011](decisions.md#adr-0011-do-not-hardcode-steam-or-retroarch-paths)).
A deployed plugin folder contains only `plugin.json`, `.millennium/Dist/` and
`backend/`; source `frontend/` is not deployed.

| Change                              | Action                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Backend (`backend/*.lua`, `plugin.json`) | `dev.ps1` (graceful restart)                                             |
| Frontend (`frontend/**`)            | `dev.ps1` (graceful restart) — **never** a SharedJSContext reload             |
| Section-registry patch only, already deployed | Navigate away from the app page and back to re-run `GetSections()` |

**Do not reload SharedJSContext** (`location.reload()`, `Page.reload`, or `Ctrl+R`
in its devtools). It can make the main window load its in-app route
(`https://steamloopback.host/routes/library/home`) as a document; CEF treats that
as a download and opens a blocking **"Save as" dialog for a file named `home`**,
with Steam's UI stuck behind it. It is intermittent (confirmed 2026-09-24). CEF
also replays its list of rejected route "downloads" about 2 s after every start
(`cef_log.txt`: `Rejected download of .../routes/...`) — that burst is history,
not a new dialog.

**Stop Steam gracefully.** The scripts run `steam.exe -shutdown` and wait for
every `steamwebhelper` to exit (about 6 s), force-killing only as a fallback.
Killing just `steam.exe` left webhelper windows running into the next start.

Start Steam with DevTools (`http://127.0.0.1:8080`) via `.\start-steam-dev.ps1`;
see [steam-debug.md](steam-debug.md).

---

## 5. Test

Millennium ships only its embedded Lua VM, so backend tests need a standalone
interpreter. Use **LuaJIT 2.1**, not plain Lua: the backend uses LuaJIT's `ffi`
(`silent_exec.lua`), which PUC Lua (e.g. luabinaries) does not have. On this machine
it is at `C:\dev\tools\lua` (on the user `PATH`; `lua` and `luajit` both work), built from
the official source with MinGW; its `README.txt` says how to rebuild it.

The pattern used by `steam-cartridges`: a harness stubs Millennium's
`fs` / `utils` / `logger` / `millennium` / `json` modules, then the **real**
backend modules run against a **real** Steam install — no mock data.

```bash
NSGA_STEAM_ROOT="C:\game\steam" lua tests/test_backend.lua
```

Keep machine-specific expectations in one `FIXTURE` table with a skip flag, so
the suite still runs on another install. This caught three real bugs that would
have been hard to spot as wrong-looking output inside Steam.

Frontend plugins run pure-logic tests with `npm test`
(`node --experimental-strip-types --test tests/*.test.ts`) and live checks as
CDP scripts in `tests/*.mjs` against the running client.

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
- [ ] No hardcoded Steam CSS classes (resolve via `findClassModule`, one probe per module)
- [ ] Prototype hooks are strictly $O(1)$ (no stack traces, regexes, or DOM queries)
- [ ] If hooking `BIsModOrShortcut`, also hook `GetGameID` returning `this.m_gameid`
- [ ] Store stubs retained in memory across unmounts (`StoreItemCache.m_mapApps`)
- [ ] Popup hooks confirmed to see the target window (guardrail 12)
- [ ] Multi-tab verification passed (Summary, Activity, Your Stuff, Game Info)
- [ ] Two-way navigation lifecycle verified (`node steam-cartridges/tests/live/test_nav_cycle.js`)
- [ ] No gate hides data that was shown before (guardrail 14); no check weakened (guardrail 15)
- [ ] `README.md` + `CHANGELOG.md` present
- [ ] Added to the plugin table in the workspace [README](../README.md)
- [ ] Tests run outside Steam
