# Knowledgebase

**This doc's job:** verified facts that are _not_ Steam's UI code — the
Millennium framework and SDK, Steam's embedded CEF runtime, Steam's on-disk data
formats, the provider data sources, and prior art. Everything marked
**✅ verified** was read off this machine (from 2026-09-19); everything else is
from upstream docs.

Not here: how to write plugin code and the regression guardrails
([plugins.md](plugins.md)); Steam's stores, components and modules
([steam-architecture.md](steam-architecture.md) →
[steam-components.md](steam-components.md)); inspecting the live client
([steam-debug.md](steam-debug.md)). What the plugins are for:
[millennium-architecture.md](millennium-architecture.md).

- **Part 1 — Millennium**: the framework, SDK and configuration API
- **Part 2 — Steam's own data & runtime**: ids, capture/recording/shortcut files, CEF quirks
- **Parts 3–5 — Provider sources**: RetroAchievements, RetroArch, and the join key
- **Part 6 — Prior art**: other plugins we studied

---

## Part 1 — Millennium

### What it is

Millennium is an open-source framework that injects custom themes and plugins into
the **desktop Steam Client**. Steam's UI is Chromium/CEF running a React app;
Millennium hooks that runtime so plugin code executes _inside_ Steam's UI with access
to Steam's own React instance, stores, and components.

Installed version here: **v3.4.1** (`MillenniumInstaller-Windows.exe` in `C:\game`).

### The three execution contexts

A plugin has up to three parts, each in a different sandbox:

| Part         | Runs in                                  | Language   | Can do                                 |
| ------------ | ---------------------------------------- | ---------- | -------------------------------------- |
| **backend**  | Native process, LuaJIT                   | Lua        | Full filesystem, HTTP, OS access       |
| **frontend** | Steam's UI (CEF)                         | TS + React | Steam React, stores, DOM of the client |
| **webkit**   | Steam's browser views (store, community) | Plain TS   | DOM only, no React                     |

The frontend and webkit live in Chromium's sandbox, so **anything touching the disk
or the network must go through the backend**. That single constraint drives most of
the architecture: reading `screenshots.vdf`, scanning capture folders and calling the
RetroAchievements API are all backend jobs.

Our plugins use **backend + frontend**. No webkit — we modify the client's library
pages, not the Steam store website. Scaffolding, lifecycle and RPC code:
[plugins.md § 1–3](plugins.md#1-scaffold).

### `plugin.json`

Fields, from the [official schema](https://raw.githubusercontent.com/SteamClientHomebrew/Millennium/main/src/system/plugin-schema.json) (**✅ verified** — note the path is `src/system/`, not the `src/sys/` that published plugins reference in their `$schema` key; that URL 404s):

| Field          | Type     | Notes                                                             |
| -------------- | -------- | ----------------------------------------------------------------- |
| `name`         | string   | **Required.** Internal unique id. Must not shadow another plugin. |
| `common_name`  | string   | Display name in Settings → Plugins                                |
| `description`  | string   | —                                                                 |
| `version`      | string   | —                                                                 |
| `useBackend`   | boolean  | If true, a `backend` folder must exist                            |
| `backend`      | string   | Custom backend dir (default `backend`)                            |
| `frontend`     | string   | Custom frontend dir (default `frontend`)                          |
| `include`      | string[] | Extra relative paths to bundle into the distribution              |
| `thumbnail`    | string   | 16:9, min 512×288, absolute URL                                   |
| `splash_image` | string   | 16:9, min 1920×1080, absolute URL                                 |

`backendType: "lua"` is **not in the published schema** but is used by every current
plugin (**✅ verified** in the installed `achievement-groups` plugin and in the
reference plugin). Set it; the schema is simply behind.

Built-in Lua modules (**✅ verified** from an installed plugin's `backend/_lib/`):
`json`, `fs`, `http`, `logger`, `millennium`, `utils`, `datetime`. They are
vendored per-plugin as type stubs.

A plugin is "installed" by placing its folder in the plugins dir and listing it
in Millennium's `config.json` under `plugins.enabledPlugins` (**✅ verified**).

### Frontend SDK — `@steambrew/client` and `steambrew-utils`

`@steambrew/client` key exports:

- `Millennium.callServerMethod` — the only frontend → backend RPC channel.
- `findModuleExport(predicate)` — pull a function or class out of Steam's webpack
  bundle (by source text, or better by `prototype` method names).
- `findClassModule(predicate)` — get Steam's hashed CSS class map at runtime.
- `beforePatch(obj, method, fn)` / `afterPatch` / `replacePatch` — monkey-patch
  Steam methods; returns `{ unpatch }` and links wrappers via `__millenniumPatch`.
  They assign with a plain `obj[method] = fn`, then read `obj[method]` back to
  attach `__millenniumPatch`, so an accessor on the property works only if its
  getter returns exactly what was set (verified in `build/utils/patcher.js`).
  **⚠️ Millennium core overwrites `SP_JSX_FACTORY.jsx`/`jsxs` with a stale copy**
  whenever its FCTrampoline renders (every toast window does), dropping every
  plugin's jsx patch (verified live 2026-09-25). See
  [plugins.md § Sharing the jsx runtime](plugins.md#sharing-the-jsx-runtime-between-plugins).
- **A real component library** (**✅ verified**, `@steambrew/client@5.8.5`,
  `build/components/*.d.ts`) — easy to miss because the reference plugin barely
  uses it: `Button`, `ButtonItem`, `Carousel`, `ControlsList`, `Dialog`,
  `DialogCheckbox`, `Dropdown`, `ErrorBoundary`, `Field`, `FocusRing`,
  `Focusable`, `FooterLegend`, `IconsModule`, `Item`, `Marquee`, `Menu`,
  `Modal`, `Panel` (`PanelSection`, `PanelSectionRow`), `ProgressBar`, `Scroll`,
  `SidebarNavigation`, `SliderField`, `Spinner`, `SteamSpinner`, `Tabs`,
  `TextField`, `Toast`, `Toggle`, `ToggleField`; plus `custom-components`:
  `ColorPickerModal`, `ReorderableList`, `SuspensefulImage`.

Notes on the ones most likely to be reached for:

- **`Focusable` / `FocusRing`** are official, documented components
  ([Focusable](https://docs.steambrew.app/plugins/ts/components/Focusable):
  `flow-children`, `focusClassName`, `focusWithinClassName`, `noFocusRing`,
  `onActivate`, `onCancel`; [FocusRing](https://docs.steambrew.app/plugins/ts/components/FocusRing):
  "particularly useful in Big Picture Mode"). They are what make an element
  reachable by controller D-pad navigation. Steam's own feed/summary components
  already wrap themselves in them, which is why feeding stores gives Big Picture
  focus rings for free.
- **`Carousel`** is a windowed, index-based virtualizer (`fnItemRenderer`,
  `nNumItems`, `fnGetColumnWidth`) for long uniform lists. It is **not** the
  carousel the Post-Game Summary uses — that one is unexported
  ([steam-components.md § Pageable and Carousel](steam-components.md#pageable-and-carousel--the-real-summary-pager)).
- **`SuspensefulImage`** is Steam's loading placeholder for an `<img>`; use it
  instead of a hand-written skeleton.
- **`Panel`** is the titled-section container used in Settings and Quick Access.

`steambrew-utils` is a companion package: `Steam` (store accessors), `waitFor`,
`NON_STEAM_APP_APPID_MASK`, plus `steambrew-utils/dom` (`querySelectorAll`,
`renderComponent`), `/watchers` (`onAppLaunch`, `onPopupCreate`,
`onLocationChange`) and `/logger`. It is **third-party and undocumented
upstream** — its own source in `node_modules` and live checks are the only
ground truth. `onPopupCreate` sits on `g_PopupManager`, so it misses
BrowserView popups ([plugins.md guardrail 12](plugins.md#12-popup-hooks-do-not-see-every-window)).

### Plugin settings — the Configuration API

**✅ Verified** against installed Millennium + `@steambrew/client` 5.8.5.
Millennium stores per-plugin settings for you; a plugin does not need its own
settings file. Official docs: [advanced/config](https://docs.steambrew.app/plugins/advanced/config).
Those docs show the newer `millennium.toml` / `import … from 'millennium'` layout.
In this repo's `plugin.json` + `@steambrew/client` layout, the same API is exported
from `@steambrew/client`:

```ts
import { definePlugin, pluginConfig, usePluginConfig, subscribePluginConfig } from '@steambrew/client';

await pluginConfig.get<boolean>('banner.enabled');   // undefined when never set
await pluginConfig.set('banner.enabled', false);
await pluginConfig.getAll();                           // { key: value, ... }
const off = subscribePluginConfig((key, value) => {}); // live change events
const [v, setV] = usePluginConfig<boolean>('banner.enabled'); // reactive, in components
```

Lua side: `millennium.config.get(key)`, `.set(key, value)`, `.on_change(fn(key, value))`.
Our vendored `_lib/millennium.lua` stubs predate this and do not declare it.

Facts confirmed in the installed binaries and core bundle:

- **Settings panel & navigation resolution:** `export default definePlugin(() => ({ title, icon, content }))`.
  Millennium registers the plugin's return object into `window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName]`,
  where `pluginName` is the name baked into the JS bundle by `millennium-ttc` from `plugin.json` at build time.
  When the user opens Millennium Settings, the desktop sidebar (`MillenniumDesktopSidebar_Content`)
  queries `window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginFolderName]`. If `pluginName` (e.g. `steam-cartridges`)
  and `pluginFolderName` (e.g. `steam-cartridges-dev`) diverge due to a mismatch between build and deploy modes,
  the settings panel fails to open (`Cannot read properties of undefined (reading 'content')`).
  Plugins must dual-alias both keys in `window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS` and `window.PLUGIN_LIST`
  inside `definePlugin` to remain robust against build mode differences.
  Millennium renders `content` inside `MillenniumDesktopSidebar_EditorContent`, within an `ErrorBoundary`.
  A plugin with no `content` shows as "not configurable".
- **No default declaration.** An unset key reads `undefined`, so ship defaults in
  the plugin and read `stored ?? default`.
- **Limits:** at most 256 keys per plugin, 256 KB per value. Values are JSON.
- The `@steambrew/client` build exports **stubs** (`get` resolves `undefined`); the
  real implementation is injected by Millennium at runtime. Outside Steam
  (tests), the stubs are what you get.
- Each call is an IPC round trip. Cache values in memory; do not call `get` on a hot path.
- **The runtime also takes the plugin name first:** `pluginConfig.set(plugin, key, value)`,
  `get(plugin, key)`, `delete(plugin, key)`, `getAll(plugin)`. The one-argument
  forms send an empty plugin name. It is exposed as `window.MILLENNIUM_API.pluginConfig`.
- **A plugin's named exports appear on `window.PLUGIN_LIST[<plugin>]`.** That is
  how a CDP test can call into a plugin (e.g. `PLUGIN_LIST['x-dev'].setSetting(...)`).

> **⚠️ Bug in Millennium v3.4.1 (latest; commit `18b89e1`; also on `main`),
> verified live 2026-09-24, reported as
> [Millennium#903](https://github.com/SteamClientHomebrew/Millennium/issues/903).**
> Every `pluginConfig` call rejects with
> `[json.exception.type_error.302] type must be string, but is number`, although
> the operation itself runs. Root cause: in `src/engine/ffi_binder.cc`, *after*
> `process_message` succeeds, the FFI metrics recorder reads
> `data.value("methodName", std::string{})`. For `PLUGIN_CONFIG` calls
> `methodName` is the numeric op enum, so `value()` throws, and the catch
> replaces the successful result with the error. So:
>
> - `set` / `delete` **do persist**; only the reply fails.
> - `get` / `getAll` never return a value, so `usePluginConfig` stays `undefined`
>   and its setter throws before updating local state.
> - Reading works through Millennium's own FFI:
>   `MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(plugin)` (and
>   `PluginConfig_DeleteAll`), the calls its settings UI uses (string method names).
>
> **Separately, by design:** `plugin_config::notify_change` does not call
> `window.__millennium_plugin_config_changed__` for frontend-origin writes, so
> `subscribePluginConfig` only sees changes made by the Lua backend.
>
> Workaround in `enhanced-achievements/frontend/settings/settings.ts`: read via
> `getAll`, falling back to that FFI; write with `set`/`delete`, tolerating that
> exact error and confirming by reading back; keep an in-memory copy and notify
> listeners ourselves; do not use `usePluginConfig`. Re-test when #903 is fixed.
> (The `1.1.2` in `window.MILLENNIUM_FRONTEND_LIB_VERSION` is the bundled frontend
> library's version, not Millennium's; Millennium's is `PLUGIN_LIST.core.version`.)

### What the official docs do and do not cover (swept 2026-09-21)

Swept [docs.steambrew.app/plugins](https://docs.steambrew.app/plugins/) —
Introduction, Development Quirks, Basic, Advanced (Hooking API, Configuration
API), and the LuaJIT/TypeScript references — looking for anything multi-window
or Big Picture.

- **Multi-window model — confirmed.**
  [Development Quirks](https://docs.steambrew.app/plugins/introduction/environment)
  says each Steam window has its own Chromium instance and DOM, and
  **SharedJSContext** is a headless parent that holds all Steam UI code and
  spawns child windows via `window.open`: _"To hook UI in the main window, patch
  SharedJSContext — not the child window."_ Big Picture is one more such child
  window ([steam-components.md § Big Picture Mode](steam-components.md#big-picture-mode)).
- **Not documented upstream:** `onPopupCreate`, `PopupType`, `Steam.PopupManager`
  (all `steambrew-utils`), and `@steambrew/client`'s component exports. The
  official `Millennium` TS object documents only `AddWindowCreateHook`
  (deprecated as of the docs' June 2026 note), `findElement` (deprecated),
  `exposeObj` (deprecated) and `openQuickAccess`.
- **Nothing Big-Picture-specific exists upstream.** The Hooking API page covers only
  server-side JS patching (regex `find`/`file`/`transforms` against served
  chunks); the Configuration API page covers only config sync; Quick Start is the
  template clone. Don't re-check this ground.

---

### Backend runtime facts (steam-cartridges P0 T5)

Answered from code and docs, **no live probe** (an earlier probe plugin crashed Steam). All **unverified: P1 must add a startup self-check** logging `package.path`, cwd and a dotted `require` result.

- Dotted `require("web.igdb")`: no existing plugin uses it (all use flat `require("name")`). Decision: **flat backend files** (`web_igdb.lua`, `steam_store_*.lua`), keeping the existing `_lib` layout.
- Lua cwd: unknown. `config.lua` already scans `.env`, `../.env`, `../../.env`, `../../../.env` and `c:/game/millennium/.env`; the migration scans all of them.
- `MILLENNIUM_PLUGIN_SECRET_BACKEND_ABSOLUTE`: relied on by `research/game-data-linker`, so likely present; not needed (data lives in `<steam>/millennium/config/steam-cartridges/`).
- Lua `millennium.config.get/set`: whether #903 (frontend FFI metrics path) affects the Lua side is unverified. P1 avoids it.
- Use forward slashes in every Lua path string (an unescaped backslash crashed Steam).

### Lua backend HTTP quirks: User-Agent in libcurl

**✅ Verified.** In Millennium's Lua backend, `http.get(url, options)` and `http.post(url, options)` wrap native libcurl. Passing `headers = { ["User-Agent"] = "..." }` is **ignored** by Millennium's native binding unless `user_agent = "..."` is explicitly supplied as a top-level key in the `options` table:

```lua
local ok, res = pcall(http.get, url, {
    user_agent = "RetroArch/1.19.0", -- Required! Libcurl CURLOPT_USERAGENT
    headers = {
        ["User-Agent"] = "RetroArch/1.19.0",
        ["Accept"] = "application/json",
    },
    timeout = 10,
})
```

Omitting `user_agent` causes libcurl to fall back to an empty/default User-Agent, which is blocked by Cloudflare and WAFs with **HTTP 403 Forbidden** (e.g. on RetroAchievements API).

### Backend RPC crash trap: Unregistered methods & unhandled errors

**✅ Verified.** In Millennium v3.4–v3.5:
1. Calling a non-existent method name via `window.Millennium.callServerMethod(plugin, "NonExistentMethod", ...)` crashes the backend process with an Access Violation (`0xC0000005`) in Millennium's native DLL.
2. Unhandled Lua `error()` calls escaping across the C++ frame boundary terminate the child process.
3. Once crashed, all subsequent RPC calls to that plugin reject with `"Millennium Error: failed to send RPC to child: <plugin>"`.

All backend RPC endpoints must be wrapped with `rpc.method()` (using `pcall`), and errors must be returned as `{ error = "..." }` rather than thrown.

## Part 2 — Steam's own data & runtime

**✅ All verified on this machine.** This is what the **core** plugin runs on. All of it is local, already present, and
needs no configuration.

### The two identifiers

Steam uses **two different ids** for one non-Steam game, and mixing them up breaks
everything:

| Id         | Width  | Where it appears                                                         |
| ---------- | ------ | ------------------------------------------------------------------------ |
| **appid**  | 32-bit | `shortcuts.vdf`, library URL `/library/app/<appid>`, `AppOverview.appid` |
| **gameid** | 64-bit | screenshot folder names, `screenshots.vdf`, recordings                   |

The conversion is exact:

```
gameid = (appid << 32) | 0x02000000
appid  = gameid >> 32
```

`0x02000000` (= `33554432`) is a constant low word marking "this is a shortcut".

**✅ Verified** against all 9 non-Steam screenshot folders here — the low word was
`33554432` in every single case, and the high word matched a shortcut appid:

| Folder (gameid)        | appid      | Resolves to                             |
| ---------------------- | ---------- | --------------------------------------- |
| `18310622842007322624` | 4263274102 | AM2R - Another Metroid 2 Remake         |
| `18118536687461072896` | 4218550559 | Super Metroid Vitality                  |
| `13849926725288329216` | 3224687354 | Hyper Metroid                           |
| `13910469344501956608` | 3238783531 | Metroid Prime Trilogy                   |
| `13646487632148955136` | 3177320499 | The Legend of Zelda: Breath of the Wild |
| 4 others               | —          | removed from library since              |

Folders for removed shortcuts persist, so **always tolerate a gameid with no matching
shortcut** — show it, or skip it, but do not crash.

### Signed vs Unsigned 32-bit AppId in CEF

**✅ Verified.** Steam's web runtime and Chromium Embedded Framework (CEF) marshal 32-bit integers into JavaScript. When an appid exceeds `0x7FFFFFFF` (`2147483647`), Steam CEF exposes it in `overview.appid` as a **signed 32-bit integer** (`overview.appid | 0`).

Example live values:
- *Alundra*: unsigned uint32 `3858889198` ➔ CEF signed int32 `-436078098`.
- *Castlevania: Aria of Sorrow*: unsigned uint32 `3327111222` ➔ CEF signed int32 `-967856074`.
- *Animaniacs*: unsigned uint32 `3048673328` ➔ CEF signed int32 `-1246293968`.

This causes silent failure across several layers if not normalized:
1. `Map.get(appid)` / `Set.has(appid)` fails when indexed by unsigned but queried by signed.
2. `(appid >= NON_STEAM_APPID_MIN)` fails when `appid` is negative.
3. Lua backend tables indexed by unsigned string/integer miss negative integers passed from RPC payloads.

**Rules for AppId Normalization:**
- **In TypeScript / JavaScript:** Always normalize at entry: `const rawAppid = appid >>> 0;`. When storing in Maps or Sets that are accessed from multiple Steam call sites, store both signed and unsigned keys or normalize all getters and setters.
- **In Lua Backend:** Normalize negative integers to unsigned:
  ```lua
  local s_appid = tonumber(shortcut_appid) or 0
  if s_appid < 0 then s_appid = s_appid + 0x100000000 end
  ```

### Shortcut Icon Loading Mechanism (RequestIconDataForApp)

**✅ Verified.** Steam uses lazy loading for shortcut icons in its desktop library sidebar and grid:
1. `AppOverview.prototype.icon_data` is initially `undefined` for shortcuts until queried or scrolled into view.
2. In module `1776`, Steam's `GetIconURLForApp(e)` checks:
   ```javascript
   e.BIsModOrShortcut() && void 0 === e.icon_data ? (SteamClient.Apps.RequestIconDataForApp(e.appid), null) : ...
   ```
3. If `e.BIsModOrShortcut()` is true, Steam calls `SteamClient.Apps.RequestIconDataForApp(e.appid)`.
4. Asynchronously, Steam writes the base64-encoded icon data directly into `e.icon_data` and sets `e.icon_data_format` (e.g. `"png"`, `"ico"`, `"jpg"`).
5. Subsequent calls to `GetIconURLForApp(e)` return `data:image/${e.icon_data_format};base64,${e.icon_data}`.
6. **Critical Failure Mode:** If `AppOverview.prototype.BIsModOrShortcut` is hooked to return `false`, Steam treats the shortcut as a regular Steam game and searches for CDN asset `icon_hash`. Since shortcuts have no CDN hash, Steam returns `null` and displays the generic grey fallback icon for all non-Steam games across the library!

### Steam's own capture store

**✅ Verified.**

Screenshots live under the Steam user's `760` directory:

```
userdata/<userid>/760/
├─ screenshots.vdf                         # the index
└─ remote/<gameid>/screenshots/
   ├─ 20251024002134_1.jpg
   └─ thumbnails/20251024002134_1.jpg
```

`screenshots.vdf` is **text** VDF (unlike the binary `shortcuts.vdf`):

```
"screenshots"
{
	"18118536687461072896"
	{
		"0"
		{
			"type"		"1"
			"filename"		"18118536687461072896/screenshots/20251015100149_1.jpg"
			"thumbnail"		"18118536687461072896/screenshots/thumbnails/20251015100149_1.jpg"
			"imported"		"0"
			"width"		"3840"
			"height"		"2160"
			"gameid"		"18118536687461072896"
			"creation"		"1760533309"
			"Permissions"		"2"
			"hscreenshot"		"18446744073709551615"
		}
	}
}
```

`creation` is **unix seconds** — the activity timeline needs nothing else. `filename`
and `thumbnail` are relative to `userdata/<userid>/760/remote/`.

> **Parser trap (cost us a real bug).** What distinguishes a _game_ key from a
> _screenshot index_ key is **nesting depth**, not the key's appearance. A Steam
> appid (`"238960"`) is the same shape as a screenshot index (`"0"`), so any
> digit-length heuristic misclassifies it and silently merges one game's
> screenshots into the previously-open game. Track brace depth: game keys sit at
> depth 1, screenshot indices at depth 2, fields at depth 3. Caught by
> `tests/test_backend.lua`, which asserted AM2R has 2 screenshots and got 222.

Measured here:

| Metric                        | Value                          |
| ----------------------------- | ------------------------------ |
| Games in `screenshots.vdf`    | 33 (27 Steam, **6 non-Steam**) |
| Non-Steam screenshots indexed | **211**                        |
| Present on disk               | **211 / 211 (100%)**           |
| Date range                    | 2025-10-15 → 2026-06-24        |

Note: an index entry can outlive its file, so **stat before listing**. It happened to
be 100% here; that is not a guarantee.

### Recordings

**✅ Verified** — one real clip captured 2026-09-19.

Steam Game Recording stores per-user data in `userdata/<userid>/gamerecordings/`.
A saved clip is a **directory**, not a file:

```
gamerecordings/
├─ gamerecording.pb        # index of background-recording sessions
├─ timelines/
│  └─ timeline_<gameid><YYYYMMDD>_<HHMMSS>.json     # plain JSON
└─ clips/
   └─ clip_<gameid>_<YYYYMMDD>_<HHMMSS>/
      ├─ clip.pb           # metadata (protobuf)
      ├─ thumbnail.jpg     # ready-made poster frame
      ├─ timelines/…
      └─ video/fg_<gameid>_<YYYYMMDD>_<HHMMSS>/
         ├─ session.mpd                # MPEG-DASH manifest
         ├─ init-stream0.m4s          # video init segment
         ├─ init-stream1.m4s          # audio init segment
         └─ chunk-stream{0,1}-NNNNN.m4s
```

**The directory name embeds the gameid**, so recordings join to an app by the same
`(appid << 32) | 0x02000000` arithmetic as screenshots — no extra lookup needed.

Three things matter for the UI:

1. **Video is fragmented MPEG-DASH, not a single mp4.** `session.mpd` is the entry
   point; the `.m4s` chunks are useless individually. A `<video>` element cannot play
   this without an MSE player (dash.js/hls.js) — but `thumbnail.jpg` is a normal JPEG,
   so a poster-frame card that opens the clip in Steam's own player is the cheap path.
2. **`thumbnail.jpg` already exists.** No frame extraction needed.
3. The manifest carries the authoritative duration and resolution, e.g.
   `mediaPresentationDuration="PT14.144S"`, `maxWidth="2560" maxHeight="1440"`.

#### `clip.pb` field map

**✅ Decoded from a real clip.**

```
field 1  (message) session
  field 1  string  timeline name   "timeline_1831062284200732262420260919_163712"
  field 2  varint  gameid          18310622842007322624
  field 3  varint  recorded at     1789835832  (unix seconds)
  field 4  varint  session len ms  14826
  field 5  (message) video
    field 1  string  "fg_<gameid>_<date>_<time>"
    field 3  varint  duration ms   14144   <- matches PT14.144S in the manifest
field 2  varint  7678
field 3  varint  clip created at   1789835839  (unix seconds)
field 4  varint  gameid            18310622842007322624
field 12 varint  width             1920
field 13 varint  height            1080
```

Prefer `session.field 3` for "when this was played"; top-level `field 3` is when the
clip was _saved_, a few seconds later.

> **Protobuf parsing traps** (both hit during implementation):
>
> - A length-delimited field is a **string or a nested message** — the wire format
>   does not say which. Recursing into every one of them misreads a string's bytes as
>   field tags. Re-parse only fields you know are messages (here: 1, and 5 within it).
> - A varint must be **fully consumed even when its value overflows** a Lua double.
>   The gameid needs 64 bits; bailing out mid-varint desynchronises every following
>   field. Skip the bytes, return nil for the value.

`timeline_*.json` is plain JSON and needs no protobuf work. It holds `daterecorded`,
`starttime`, `endtime` (ms) and an `entries` array of markers:

```json
{
    "daterecorded": "1789835832",
    "starttime": "0",
    "endtime": "28064",
    "entries": [
        {
            "id": "1",
            "time": "19803",
            "type": "usermarker",
            "icon": "steam_marker",
            "possible_clip": 2
        }
    ]
}
```

Markers are a natural future timeline source (a user marker _is_ an activity event),
but v1 does not use them.

### Shortcuts (`shortcuts.vdf`)

**✅ Verified.**

Binary VDF at `userdata/<userid>/config/shortcuts.vdf`. Fields are type-tagged:
`0x00` nested map, `0x01` string, `0x02` int32, each followed by a NUL-terminated key.

Useful fields per entry: `appid` (int32, read as unsigned), `AppName`, `Exe`,
`StartDir`, `LaunchOptions`, `icon`, `tags`, `LastPlayTime`.

Parsed here: **223 entries — 210 RetroArch, 13 other** (AM2R among them). A full VDF
implementation is unnecessary; scanning for the type markers is enough.

> `appid` is stored as a **signed** int32 but used as unsigned. Mask with
> `& 0xFFFFFFFF` before the `<< 32` conversion, or ids above 2³¹ come out negative.

### Shortcut `tags` and collections

Collections live in cloud storage and `collectionStore` (`srm-*` static collections exist for shortcuts here). The `tags` block in `shortcuts.vdf` is not a trustworthy membership source: trust `collectionStore` only.

### Steam achievement schema sources

Verified 2026-09-24 (`p0-t4*.mjs`), owned `435150` vs unowned `2820820`.

- `appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)`: present for owned (`unlocked:4,total:97`), **absent for unowned**.
- `appDetailsStore.GetAchievements(appid)` after `RequestAppDetails`: for unowned, empty arrays (`nTotal` 0). Not a schema source.
- `SteamClient.Apps` achievement methods: `RegisterForAchievementChanges`, `GetFriendAchievementsForApp`, `GetMyAchievementsForApp`, `GetAchievementsInTimeRange`, `SaveAchievementProgressCache`. `GetMyAchievementsForApp` timed out for both apps.
- Keyless web: store `appdetails?filters=achievements` returns `total` and `highlighted[]` (name, icon; highlighted subset only) and works from the frontend. `GetGlobalAchievementPercentagesForApp` and the community stats page failed from the frontend (`Failed to fetch`); the former may work from the backend.
- Chosen source: **store `appdetails` `achievements`** (keyless) for total plus highlighted names/icons; full lists need an optional Steam Web API key.

### Identifying non-Steam apps

Steam assigns shortcuts very high app ids. The SDK exposes the boundary as
`NON_STEAM_APP_APPID_MASK` (`0x8000_0000`); the idiom is:

```ts
if (app.appid < NON_STEAM_APP_APPID_MASK) return; // a real Steam game — skip
```

### `appStore.GetAppOverviewByAppID` has multiple callers — patch the method carefully, or not at all

**✅ Verified live 2026-09-26**, fixing the Friends-section crash (see
CHANGELOG.md's 2026-09-26 entry for the full live-verification record).

`appStore.GetAppOverviewByAppID(appid)` returns `null` for **every unowned
app** — an app not in the local user's library, not owned, and not a small
set of already-loaded recently-viewed apps. That is completely normal Steam
behaviour, not a bug. The trap is that **several independent pieces of
Steam's own UI code call this method and each assumes something different
about a `null` result**:

- Steam's own Friends section (module 2326, function `ne(appid)`) calls
  `.GetAppOverviewByAppID(appid).BIsApplicationOrTool()` with **no null
  guard at all** — a real crash (`TypeError: Cannot read properties of null`)
  the instant any code path hands it an appid Steam has no overview for.
  Two other call sites of the identical pattern exist in the same build
  (modules 97561 and 56262), unconfirmed as reachable but present.
- Steam's own `Navigator.App(appid, …)` (module `874`) reads the **same**
  method and treats a `null`/missing result as "unowned, do nothing" — it
  returns early rather than navigating
  ([steam-components.md § Navigator.App](steam-components.md#navigatorapp-module-874)).
  This is a **deliberate, correct** use of the same null — not a bug to fix.

> **Consequence for any patch on this method (or any Steam store method with
> more than one caller):** a fix aimed at one caller can silently break
> another caller that relies on the *original* return value's truthiness for
> an unrelated purpose. `steam-cartridges`' own `native-sections.ts` has
> exactly this shape: it patches `GetAppOverviewByAppID` to return a
> non-null fallback object for a mapped native appid Steam has no data for
> (fixing the Friends crash above), but the **same file** already had a
> second, older consumer of the same method (`isKnownApp`, feeding its own
> `Navigator.App` redirect) that read the *old* null-vs-object distinction to
> mean "is this app really known to Steam". Once the fallback started
> returning truthy, `isKnownApp` started reporting a still-unowned app as
> "known", and stopped redirecting native news clicks back to the shortcut —
> a real, working feature silently regressed by a fix to something else
> entirely. Caught only by re-running the full parity gate
> (`scratch/check_parity.mjs`, 17→16 PASS) after the first deploy, not by
> code reading.
>
> **The fix:** never patch a shared store method to change its return value
> unconditionally for a whole class of appid. Tag the substitute value (e.g.
> a module-local `Symbol` property) so it is distinguishable from a real
> result, and make every consumer that cares about "is this a *real*
> AppOverview" (not just "is it truthy") check for the tag's absence. Before
> patching any Steam store method's return value, **grep the whole file (and
> ideally the whole plugin) for every other call site of that same method**
> — a method-level patch has a much smaller blast radius than a shared-map
> write (see `appStore.m_mapApps`, next), but it is not automatically safe to
> *every* caller, only to callers outside the module actually being fixed.

### `appStore.m_mapApps` is the global, enumerated backing store for the entire library — never write into it

**✅ Verified live 2026-09-26** (two reverted attempts before the fix above,
detailed inline below).

It is tempting to "fix" a missing `AppOverview` by inserting a synthetic
same-prototype stub directly into `appStore.m_mapApps` keyed by the missing
appid. **This breaks the entire library's rendering, not just the one app.**
`m_mapApps` is not a private, section-scoped cache the way
`StoreItemCache`/`workshopStore`/`appActivityStore` are (those three are
already safely hand-populated with fakes for the shortcut's own appid — see
[plugins.md guardrail 5](plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization)).
It is the MobX-observed backing store the **library grid, collections, and
per-app content loader all enumerate directly**, expecting every entry to be
a fully populated `AppOverview` (with `store_tag`/`m_setStoreCategories`
-derived getters and every other field real code reads). A
prototype-correct but data-sparse stub inserted there makes some other
consumer's `.find(...)` (on whatever list it expected to be fully shaped)
receive `undefined` where it expected an object with `.appid`, throwing
`Cannot read properties of undefined (reading 'find'/'appid')` across
**every page**, not the one being fixed. Confirmed live: user reported *"as a
new thing the entire steam library shows the rendering error"* within
seconds of this stub being deployed.

Also relevant: several `AppOverview` prototype fields are **getter-only**
(`store_tag`, `store_category`, `selected_per_client_data`,
`most_available_per_client_data`, `local_per_client_data`, `gameid`,
`display_status`, `status_percentage`, `installed`, `active_beta`,
`review_score`, `review_percentage`, several `*_compat_category` fields, and
more — verify with `Object.getOwnPropertyDescriptor(proto, key)` before
assigning any field on a same-prototype stub). Plain assignment on one of
these throws `TypeError: Cannot set property … which has only a getter`, and
a `try/catch` around a multi-field stub build silently drops the whole stub
after the first failing field, in source order.

**The safe pattern for "Steam's helper needs a non-null result for this
appid" is a scoped method patch on the read path** (`afterPatch`/`beforePatch`
on the accessor method itself, gated by appid, always falling through to the
real implementation otherwise) — never a durable entry in the shared,
globally-enumerated map. See the previous entry for the one remaining trap
even with a correctly-scoped method patch.

### Steam's embedded CEF: two silent no-ops

**✅ Verified.**

Found implementing a scrolling carousel. Both fail **silently** — no error, no
warning. Properties of the CEF build Steam embeds, not of Millennium; re-check if
Steam updates its CEF.

1. **`Element.scrollTo({ behavior: 'smooth' })` does nothing** — `scrollLeft`
   never changes; `behavior: 'auto'` works. Steam's own carousel animates
   `scrollLeft` by hand (500 ms, cubic-in-out); do the same with a
   `requestAnimationFrame` loop.
2. **Setting `scrollLeft` from JS never dispatches a `scroll` event.** A listener
   counted `0` across a full visible animation. Code reacting to a JS-driven
   scroll must hook whatever moves `scrollLeft` (e.g. call the "recompute pager
   state" function from the animation loop) instead of `onScroll`.

---

## Part 3 — RetroAchievements

_Source for the `retroachievements` provider._

### API basics

- Base URL: `https://retroachievements.org/API/`
- Endpoints are `.php` files: `API_<Name>.php`
- Auth: **`y` query param** = web API key. `u` = username or ULID.
- Get a key at <https://retroachievements.org/settings> (Web API Key section).

It is a free, donation-funded community service. Cache; do not hammer it.

### Endpoints the provider uses

| Endpoint                             | Params                  | Gives us                                                                       |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------ |
| `API_GetUserRecentlyPlayedGames.php` | `u`, `c` (≤50), `o`     | Recently played games + per-game `NumAchieved`, `LastPlayed`, box art          |
| `API_GetGameInfoAndUserProgress.php` | `u`, `g` (game id)      | Full achievement list with `DateEarned` / `DateEarnedHardcore` per achievement |
| `API_GetAchievementsEarnedOnDay.php` | `u`, `d` (`YYYY-MM-DD`) | Every unlock on one date, across all games                                     |

**`GetGameInfoAndUserProgress` is the workhorse.** Per-achievement fields:
`ID`, `Title`, `Description`, `Points`, `TrueRatio`, `BadgeName`, `type`
(e.g. `"progression"`), `NumAwarded`, `DisplayOrder`, and — only when the user has
earned it — `DateEarned` and `DateEarnedHardcore`.

Game-level user fields: `NumAwardedToUser`, `NumAwardedToUserHardcore`,
`UserCompletion`, `UserTotalPlaytime`, `HighestAwardKind`, `HighestAwardDate`.

> There is **no** `GetAchievementsEarnedBetween` endpoint. To build a date-ranged
> timeline, either call `GetAchievementsEarnedOnDay` per day (expensive) or derive it
> from `DateEarned` values in `GetGameInfoAndUserProgress` (cheap — one call per game).
> We do the latter. See [ADR-0006](decisions.md#adr-0006-build-the-timeline-from-dateearned-not-per-day-queries).

### Emulator API (`dorequest.php`)

In addition to the public web API (`/API/`), emulators (RetroArch, DuckStation, PCSX2) communicate via `https://retroachievements.org/dorequest.php`. **✅ Verified live.**

| Request Param | Purpose | Critical Requirements |
| --- | --- | --- |
| `r=gameid&m=<md5>` | Resolve `GameID` from ROM hash | Needs `user_agent = "RetroArch/1.19.0"` to avoid Cloudflare 403. |
| `r=gameslist&c=<console_id>` | Title lookup fallback | Returns a **JSON object map** (`{ "11336": "Alundra" }`), **not an array**. Iterating with `ipairs()` in Lua yields 0 entries. Must iterate with `pairs()` and extract `k` / `v`. |
| `r=patch&g=<gid>` | Full achievement schema, conditions, badges, points | **Requires authentication:** Must append `&u=<username>&t=<token>`. Without credentials, returns HTTP 401 `{"Success": false, "Error": "Invalid credentials"}`. |
| `r=unlocks&g=<gid>&h=<0\|1>` | User unlocks for game | Hardcore (`h=1`) vs softcore (`h=0`). Requires `&u=` and `&t=`. |

**Cloudflare / WAF Bypass:** RetroAchievements strictly gates `dorequest.php` behind Cloudflare bot protection. All Lua HTTP calls must supply `user_agent = "RetroArch/1.19.0"` in the options table.

### Badge images

`BadgeName` is an id; the image is at:

```
https://media.retroachievements.org/Badge/<BadgeName>.png        # unlocked
https://media.retroachievements.org/Badge/<BadgeName>_lock.png   # locked
```

Responses also carry absolute `BadgeURL` / `GameIcon` paths in some endpoints — prefer
those when present.

### Local credentials

`retroarch.cfg` already holds the user's RA identity (**✅ verified**):

```
cheevos_enable          = "true"
cheevos_username        = "gunCannoli"
cheevos_token           = "<REDACTED>"
cheevos_password        = "<REDACTED>"
cheevos_hardcore_mode_enable = "false"
cheevos_auto_screenshot = "true"
```

We read **`cheevos_username`** from here so the user never types it. The `token` is a
RetroArch session token, **not** a web API key — it cannot be used with the public API,
so the API key must still be supplied by the user. Never log, copy, or transmit the
token or password.

---

## Part 4 — RetroArch local data

**✅ All verified on this machine.**

_Source for the `retroarch` provider._

RetroArch install: `C:\emu\RetroArch`, portable mode. In `retroarch.cfg` the prefix
`:\` means "the RetroArch directory", so `":\screenshots"` → `C:\emu\RetroArch\screenshots`.

Relevant config:

```
screenshot_directory    = ":\screenshots"
playlist_directory      = ":\playlists"
content_history_path    = ":\playlists\builtin\content_history.lpl"
savestate_directory     = ":\states"
log_dir                 = ":\logs"
auto_screenshot_filename = "true"
content_runtime_log      = "true"
content_runtime_log_aggregate = "false"
```

### Screenshots — the killer feature

Because `cheevos_auto_screenshot = "true"`, RetroArch **automatically captures a
screenshot at the exact moment an achievement unlocks**, and names it with the
achievement id:

```
Chrono Trigger (USA)-cheevo-1989.png
Super Metroid (Japan, USA) (En,Ja)-cheevo-4620.png
Hyper Metroid (v1.00)-cheevo-124948.png
```

Pattern: `<ROM basename>-cheevo-<AchievementID>.png`

This gives a **direct join** between a local image and a RetroAchievements unlock —
which in turn carries a `DateEarned`. That is the entire activity timeline: a
screenshot, the achievement it commemorates, and the timestamp, with no guessing.

Manual screenshots use `<ROM basename>-<yymmdd-hhmmss>.png` instead
(`auto_screenshot_filename = true`). Handle both patterns; on this machine all 19
screenshots are currently the `-cheevo-` kind.

### Runtime logs — playtime

With `content_runtime_log = "true"`, RetroArch writes one file per game:

`playlists/logs/<Core Name>/<ROM basename>.lrtl`

```json
{
    "version": "1.0",
    "runtime": "0:02:44",
    "last_played": "2025-12-21 16:02:29",
    "play_count": "1",
    "state_slot": "0"
}
```

This is real playtime **and** last-played, straight from the emulator — no session
tracking needed. 22 such logs exist here across cores `Snes9x`, `mGBA`, `FinalBurn Neo`.

> Note `content_runtime_log_aggregate = "false"`: logs are per-core, so the same ROM
> played on two cores has two files. Sum `runtime` and take the max `last_played`.

### Playlists

`playlists/*.lpl` are JSON (v1.5+) with an `items` array:

```json
{
    "path": "C:\\emu\\roms\\snes\\ActRaiser (USA).zip",
    "label": "ActRaiser (USA)",
    "core_path": "DETECT",
    "core_name": "DETECT",
    "crc32": "00000000|crc",
    "db_name": "Nintendo - Super Nintendo Entertainment System.lpl"
}
```

`db_name` gives the console/platform — useful for grouping and for thumbnails.
`playlists/builtin/content_history.lpl` is recently-played, but its entries have empty
`label`/`crc32` — it is less useful than the runtime logs.

> **Parser warning:** RetroArch's `.lpl` writer is whitespace-sensitive and not strictly
> conformant JSON ([libretro#8439](https://github.com/libretro/RetroArch/issues/8439)).
> Parse defensively and tolerate an empty file.

---

## Part 5 — The ROM join key

**✅ Verified, measured.**

_Used by the `retroarch` and `retroachievements` providers. The core does not need this — it uses the exact appid↔gameid conversion in Part 2 instead._

This is the linchpin of the whole design. Steam knows a shortcut by its `AppName`;
RetroArch knows everything by ROM filename. They are joined through the shortcut's
launch command.

`shortcuts.vdf` (binary VDF at
`C:\game\steam\userdata\<id>\config\shortcuts.vdf`) stores an `Exe` per shortcut:

```
"C:\emu\RetroArch\retroarch.exe" -L cores\snes9x_libretro.dll "C:\emu\roms\snes\Zombies Ate My Neighbors (USA).zip"
```

Extracting the quoted ROM path and taking its basename without extension yields the
**ROM basename** — the same string RetroArch uses for screenshots, runtime logs, and
playlist labels.

Measured on this library:

| Check                                  | Result                                 |
| -------------------------------------- | -------------------------------------- |
| RetroArch shortcuts in `shortcuts.vdf` | 210                                    |
| Parsed a core + ROM path successfully  | **210 / 210 (100%)**                   |
| Cores in use                           | `snes9x` ×139, `mgba` ×36, `fbneo` ×35 |
| Screenshots joining to a shortcut      | **7 / 7 distinct names (100%)**        |
| Runtime logs joining to a shortcut     | 21 / 22                                |

The single unjoined runtime log is `The Legend of Zelda - A Link to the Past (USA)`,
a naming variant of the shortcut's `Legend of Zelda, The - A Link to the Past (USA)` —
a stale log from before a rename, not a parser failure.

Also note the Steam `AppName` ("Zombies Ate My Neighbors") is a _cleaned_ title and
does **not** equal the ROM basename ("Zombies Ate My Neighbors (USA)"). Join on the
parsed ROM path, never on the display name.

Remaining gap: ROM basename → RetroAchievements **GameID**. Arcade ROMs are terse
(`xmvsf`, `kof98`, `dmnfrnt`) and will not match by title. Resolution strategy is
[ADR-0008](decisions.md#adr-0008-resolve-romgameid-by-cached-history-first-manual-override-last).


---

## Part 6 — Prior art

Other Millennium plugins we read, and what they taught. Neither is a dependency.

### Reference plugin: `k0d13/steam-non-steam-playtimes`

Studied at commit [`f2c14ec`](https://github.com/k0d13/steam-non-steam-playtimes/tree/f2c14ecbc0cfcdff6bba5f1d703231ec6037588f)
(**✅ verified**, read directly). It shows three integration points:

1. **Library home / grid** — `beforePatch(Steam.CollectionStore, 'OnAppOverviewChange')`,
   then write onto the app overview objects before Steam renders them. Patching the
   _data_ is far more robust than patching the DOM.
2. **App detail page** — watch `/library/app/<appid>` via `onPopupCreate` +
   `onLocationChange`, then mount a clone of the play-bar stat. This is the
   legitimate rung-4 case: Steam models no per-shortcut playtime to feed
   ([plugins.md § Build nothing Steam already builds](plugins.md#build-nothing-steam-already-builds)).
   It writes **zero custom CSS** — only the one-line `<style>` that hides Steam's
   original — and imports `Button`/`TextField` from `@steambrew/client` rather
   than building form controls.
3. **App properties dialog** — adds a tab by patching `Array.prototype.map` and
   detecting the page-descriptor array (route `/app/:appid/properties/…`). Its own
   comment calls this "not ideal". Note its performance guard: wait for
   `Steam.MainWindowBrowserManager` first, because `Array#map` is called ~15,000
   times during startup.

Its `dev.ps1` hardcodes the default Steam path; ours takes it as a parameter.

### `sydhufen/game-data-linker` — a different product, not a better fix

[game-data-linker](https://github.com/sydhufen/game-data-linker) also gives
shortcuts rich Steam-native pages (artwork, activity, achievements, news), read
via the GitHub raw API. It **sidesteps** the store-record blocker instead of
clearing it: the user links a shortcut to a _real_ Steam (or Epic/Xbox) appid
(`mappings.json`), and the plugin reads **that** game's data —
`appActivityStore.GetAppActivity(linkedAppid)`,
`appAchievementProgressCache.m_achievementProgress.mapCache.get(linkedAppid)` —
which already has real backing records.

That shows another game's data under the shortcut, with no provenance. Our core
shows the shortcut's _own_ captures with no linking and no network
([ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)),
so it can't adopt this. It does validate a **linking-based enrichment provider**
as a proven, optional shape. It independently confirms
`SetCustomArtworkForApp(appid, base64, ext, type)` for shortcut artwork and
`findClassModule` with a hardcoded fallback. Nothing on Big Picture: it targets
desktop Properties dialogs only.

---

## Sources

- [Millennium plugin docs](https://docs.steambrew.app/plugins/) ·
  [file structure](https://docs.steambrew.app/plugins/structure/file-structure) ·
  [development quirks](https://docs.steambrew.app/plugins/introduction/environment) (multi-window
  model, SharedJSContext) ·
  [hooking API](https://docs.steambrew.app/plugins/advanced/hooking) ·
  [configuration API](https://docs.steambrew.app/plugins/advanced/config) ·
  [`Millennium` TS reference](https://docs.steambrew.app/plugins/ts/Millennium) ·
  [`Focusable`](https://docs.steambrew.app/plugins/ts/components/Focusable) ·
  [`FocusRing`](https://docs.steambrew.app/plugins/ts/components/FocusRing) components ·
  [Millennium repo](https://github.com/SteamClientHomebrew/Millennium)
- [Reference plugin: k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes) ·
  [commit f2c14ec](https://github.com/k0d13/steam-non-steam-playtimes/tree/f2c14ecbc0cfcdff6bba5f1d703231ec6037588f)
  studied specifically for the clone-and-hide UI pattern
- [`@steambrew/client@5.8.5`](https://www.npmjs.com/package/@steambrew/client) —
  read `build/*.d.ts` directly (locally in `node_modules/@steambrew/client/`) for its full
  component export list; not documented on steambrew.app at time of writing
- [RetroAchievements API docs](https://api-docs.retroachievements.org/) ·
  [GetUserRecentlyPlayedGames](https://api-docs.retroachievements.org/v1/get-user-recently-played-games.html) ·
  [GetGameInfoAndUserProgress](https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html) ·
  [GetAchievementsEarnedOnDay](https://api-docs.retroachievements.org/v1/get-achievements-earned-on-day.html)
- [Libretro: playlists & thumbnails](https://docs.libretro.com/guides/roms-playlists-thumbnails/) ·
  [directory config](https://docs.libretro.com/guides/change-directories/)
