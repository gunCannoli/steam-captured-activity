# Millennium Plugins: Guide & Guardrails

**This doc's job:** how to build, change, deploy, test and publish a plugin in
this workspace, and every rule that keeps a change from regressing Steam's UI.
If you are writing or fixing plugin code, the rules are here and nowhere else.

Not here: _what_ the plugins do and why
([millennium-architecture.md](millennium-architecture.md),
[decisions.md](decisions.md)); what Steam's internals look like
([steam-architecture.md](steam-architecture.md) →
[steam-components.md](steam-components.md)); SDK reference and data formats
([knowledgebase.md](knowledgebase.md)); inspecting the live client
([steam-debug.md](steam-debug.md)).

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

Before writing a component, go and look: [steam-architecture.md](steam-architecture.md)
for the map, [steam-debug.md § 3](steam-debug.md#3-the-inspection-method) for the
method. It takes minutes.

**2. Can you put your data into Steam's store?**

If Steam models the thing, write to Steam's model and let it render
([ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
Steam's stores are MobX singletons with ordinary public methods that do not
validate app type — the post-game summary is `CGamePlaySession.AddClip` /
`BAddScreenshotNotification`, and the library grid is fields on `AppOverview`
(store map: [steam-architecture.md § 2](steam-architecture.md#2-core-stores--modules)).

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
> wrong rung. See [steam-styles.md](steam-styles.md).

### Rules that apply on every rung

**Never hardcode Steam's CSS classes** — they are build-hashed
([ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)).
And **never resolve anything by numeric module id**: ids reshuffle between
builds. Resolve by a stable signature — real `prototype` method names, which
survive minification — or a class-map probe key
([steam-architecture.md § 3](steam-architecture.md#3-stable-resolution-signatures)).

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
- **Never author custom CSS to imitate Steam** ([steam-styles.md](steam-styles.md)).
- **Respect third-party APIs.** Cache hard, never poll, send a descriptive `User-Agent`
  ([ADR-0007](decisions.md#adr-0007-cache-retroachievements-responses-on-disk)).

---

## Guardrails & Regression Prevention (MUST READ BEFORE WRITING CODE)

These rules are drawn directly from real, hard-won regression debugging across Steam's
Activity, Game Info, Your Stuff and toast windows. Violating them causes immediate
user-facing breaks. Numbers are stable — code comments cite them.

### 1. Prototype Hook Coupling (`BIsModOrShortcut` vs `GetGameID`)

- **The Trap:** Steam's native `AppOverview.prototype.GetGameID()` implementation is:
    ```javascript
    GetGameID() { return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString(); }
    ```
    Game Info (inner component `k`, module `15448`) drops descriptions and credits
    and renders `#AppDetails_Shortcut_Explanation` whenever
    `overview.BIsModOrShortcut()` is true. Hooking it to return `false` for
    enriched shortcuts makes `GetGameID()` evaluate to `this.appid.toString()`
    (`"4263274102"`).
- **The Ripple Effect:** The "YOUR STUFF" tab's Media section (module `57150`, component `Ae.E`)
  queries captures with `listSource: { type: "app", gameid: overview.gameid }`, and
  `overview.gameid` delegates to `GetGameID()`. Shortcut captures in `screenshots.vdf`
  and `window.g_GRS` are stored under the composed 64-bit ID (`"18310622842007322624"`).
  Querying by `appid.toString()` returns 0 items, silently wiping the "YOUR STUFF" tab
  into its empty placeholder.
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
  `enhanced-notifications/frontend/style/injector.ts` and
  [plans/enhanced-notifications-toast-window-bugfix.md](plans/enhanced-notifications-toast-window-bugfix.md).
  Check the UI mode before trusting a live test ([steam-debug.md § 4](steam-debug.md#4-big-picture-mode-gamepad-ui-quirks--traps)).

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

Millennium ships only its embedded Lua VM, so get a standalone interpreter from
[luabinaries](https://luabinaries.sourceforge.net/) to test backend logic outside
Steam. Put it in `tools/lua/` (gitignored).

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
- [ ] Two-way navigation lifecycle verified (`node scratch/test_nav_cycle.js`)
- [ ] No gate hides data that was shown before (guardrail 14); no check weakened (guardrail 15)
- [ ] `README.md` + `CHANGELOG.md` present
- [ ] Added to the plugin table in the workspace [README](../README.md)
- [ ] Tests run outside Steam
