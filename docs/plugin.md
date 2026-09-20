# Creating a plugin

How to add a plugin to this workspace, develop it, and publish it as a
standalone public repo.

For *what* the plugins do and why, see [docs/architecture.md](docs/architecture.md)
and [docs/decisions.md](docs/decisions.md). For Millennium's SDK mechanics in
detail, see [docs/knowledgebase.md](docs/knowledgebase.md) — this file is the
procedure, not the reference.

---

## Layout

Each plugin is a self-contained subfolder. Nothing outside its own folder may be
imported, because that folder is what gets published:

```
millennium-plugins/                 <- this repo (private)
├─ README.md · CHANGELOG.md · plugin.md · AGENTS.md · TASK.md
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
> ([ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it)),
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
  ([ADR-0002](docs/decisions.md#adr-0002-luajit-backend-not-python)).

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
export default async function OnPluginLoaded() { /* register watchers */ }
```

**Never hardcode Steam's CSS classes** — they are build-hashed and change between
client versions. Resolve them at runtime, and borrow Steam's own formatters and
translations so the UI looks native
([ADR-0005](docs/decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)):

```ts
const PlayBar = findClassModule((m) => m.GameStat) as Record<string, string>;
const formatDuration = findModuleExport((e) => e?.toString?.()?.includes('"#Played_"'));
Steam.LocalizationManager.LocalizeString('#AppDetails_SectionTitle_PlayTime');
```

**Do not write custom CSS to approximate Steam's look.** Copy it instead. See
[knowledgebase.md § Reusing Steam's native UI](knowledgebase.md#reusing-steams-native-ui-verified-reading-k0d13steam-non-steam-playtimes-at-commit-f2c14ec)
for the full pattern; the one-paragraph version:

1. **Clone Steam's exact DOM shape** for the element you're replacing — same
   nesting, same classes (resolved via `findClassModule`, never hardcoded),
   same `Panel` utility class. Not a lookalike; the literal same tree.
2. **Hide Steam's original in that slot** with one scoped rule, and reveal only
   your clone via a marker attribute:
   ```tsx
   <div data-mine="playtime" className={`${C.GameStat} ${C.Playtime} Panel`}>
     <style>{`.${C.GameStat}.${C.Playtime}:not([data-mine]){display:none!important}`}</style>
     {/* ...clone the rest of Steam's tree here... */}
   </div>
   ```
   `:not([data-mine])` hides only Steam's unmarked original, never your clone,
   and the rule is scoped by the same two classes so it cannot leak elsewhere.
3. **Only render a clone when you have the data**, matching how Steam's own
   container (usually a `flex` row) only shows populated stats. An unconditional
   clone can show an empty box Steam itself would never render.
4. **Before building any custom widget** (carousel, image placeholder,
   button, text field, dialog, tabs, focus/hover wrapper), check whether
   `@steambrew/client` already exports it — `Carousel`, `SuspensefulImage`,
   `Focusable`/`FocusRing`, `Button`, `TextField`, `Panel`, `Tabs`, `Modal`,
   `Dropdown`, `SliderField`, `ToggleField`, and more are all real, shipped
   components. Reusing them means their focus, keyboard and (for `Focusable`)
   gamepad behavior comes for free — reimplementing them with plain
   `<div>`/CSS does not. Full list in the knowledgebase.
5. **Resolve ONE `findClassModule` probe per CSS module, never per feature.**
   Classes seen together in one captured `outerHTML` do **not** imply they
   live in the same webpack module — a real UI element (Steam's own
   Post-Game Summary) was split across **four** separate modules. Reusing one
   probe for all of them made `findClassModule` silently return `undefined`
   for the other three modules' keys, and React rendered those elements with
   **no class at all** — no error, just a tile with `className="Panel"` and
   none of its sizing/positioning CSS. If in doubt, verify co-membership by
   walking Steam's module cache directly (snippet and full writeup in
   [knowledgebase.md § Classes seen together are not necessarily one module](knowledgebase.md#classes-seen-together-in-one-element-are-not-necessarily-one-css-module-verified-the-hard-way-building-non-steam-games-activity)),
   and always sanity-check a resolved class map by dumping it whole
   (`console.log(SomeClasses)`) rather than trusting a name "sounds right".

If a project ends up with a dedicated stylesheet of hand-tuned colors/shadows/
spacing meant to *look like* Steam, that is the signal something should have
been cloned or reused instead.

Prefer patching Steam's **data** over its DOM where Steam already models the field
([ADR-0009](docs/decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).

Both the desktop client and Big Picture arrive through `onPopupCreate`; Big
Picture is a separate popup window (`SP BPM_`), not a separate sandbox
([ADR-0016](docs/decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)).

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
([ADR-0011](docs/decisions.md#adr-0011-do-not-hardcode-steam-or-retroarch-paths)).

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

- [ ] `README.md` written for *users* — what it does, install, configure. Not a
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
- [ ] No hardcoded Steam CSS classes
- [ ] `README.md` + `CHANGELOG.md` present
- [ ] Added to the plugin table in the workspace [README](README.md)
- [ ] Tests run outside Steam
