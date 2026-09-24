# Knowledgebase

Reference material for building Millennium plugins, and the facts the
`non-steam-games-activity` core and its providers depend on. Everything marked
**✅ verified** was read off this machine on 2026-09-19; everything else is from
upstream docs.

- **Part 1 — Millennium**: the framework, SDK and plugin mechanics
- **Part 2 — Steam's own data**: what the _core_ plugin runs on
- **Parts 3–5 — Provider sources**: RetroAchievements, RetroArch, and the join key

---

## The problem we are solving

Steam's app detail page for an owned game is rich: a post-game summary, an activity
feed by date, achievement progress with icons, screenshots, playtime, "friends who play".

For a **non-Steam shortcut**, Steam shows a single grey box:

> Some detailed information on AM2R - Another Metroid 2 Remake is unavailable because
> it is a non-Steam game or mod. Steam will still manage launching the game for you and
> in most cases the in-game overlay will be available.

The claim is misleading. Steam _does_ have data for these apps — the same sidebar on
that very page lists "3 recordings and screenshots". Steam captured them, filed them
under a per-game id, and then declined to build a page around them.

So the core plugin needs no emulator, no API and no network: it renders what Steam
already has. Providers then enrich particular games on top of that.

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

Both the core and the providers use **backend + frontend**. No webkit — we modify the
client's library pages, not the Steam store website.

### Plugin file structure

```
my-plugin/
├─ plugin.json          # manifest — the only required file
├─ package.json
├─ tsconfig.json
├─ backend/
│  └─ main.lua          # entry point; must return lifecycle table
├─ frontend/
│  └─ index.tsx         # entry point; default export = OnPluginLoaded
└─ .millennium/Dist/    # build output (gitignored)
   └─ index.js
```

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

### Backend lifecycle (Lua)

`backend/main.lua` returns a table of hooks. Anything assigned to a **global** becomes
callable from the frontend by name.

```lua
local millennium = require("millennium")

-- Globals = the RPC surface the frontend can call
GetActivity = RPC.GetActivity

local function on_load()
  -- set up state here
  millennium.ready()          -- REQUIRED: signals the backend is up
end

local function on_frontend_loaded() end
local function on_unload() end

return {
  on_load = on_load,
  on_frontend_loaded = on_frontend_loaded,
  on_unload = on_unload,
}
```

`millennium.ready()` must be called or the frontend will hang waiting for the backend.

Built-in Lua modules available to the backend (**✅ verified** from the installed
plugin's `backend/_lib/`): `json`, `fs`, `http`, `logger`, `millennium`, `utils`,
`datetime`. These are vendored per-plugin, so copy the ones you need.

### Frontend ↔ backend RPC

One channel: `Millennium.callServerMethod(name, argsObject)`. Arguments and the return
value are **strings**, so everything is JSON-encoded on both sides.

The reference plugin's wrapper (**✅ verified**, `frontend/rpc.ts`):

```ts
async function call<R>(route: `RPC.${string}`, payload: object): Promise<R> {
    return Millennium.callServerMethod(route.slice(4), {
        payload: JSON.stringify(payload),
    }).then((r) => JSON.parse(r));
}
```

And the Lua side (**✅ verified**, `backend/rpc.lua`):

```lua
local function rpcmethod(func)
  return function(payload)
    local data = json.decode(payload)
    local result = func(data)
    if result then return json.encode(result)
    else return 'null' end   -- must not return nil; Millennium tries to stoi it
  end
end
```

> **Gotcha:** returning bare `nil` from a Lua RPC method crashes Millennium — it tries
> to parse the result as an integer. Always return the string `'null'`.

### Frontend SDK — `@steambrew/client`

Key exports used by this plugin:

- `Millennium.callServerMethod` — the RPC channel above.
- `findModuleExport(predicate)` — pull a function out of Steam's webpack bundle by
  matching its source text. Used to borrow Steam's own formatters.
- `findClassModule(predicate)` — get Steam's hashed CSS class names at runtime.
- `beforePatch(obj, method, fn)` / `afterPatch` — monkey-patch Steam methods; returns
  `{ unpatch }`.
- **A full component library** — see [Steam's own React components](#steams-own-react-components-not-just-its-classes-verified-steambrewclient585) below.
  This is easy to miss because the reference plugin only uses `findClassModule` and
  `findModuleExport`, but the package exports far more.

`steambrew-utils` is a companion package providing `Steam` (store accessors),
`waitFor`, `NON_STEAM_APP_APPID_MASK`, plus `steambrew-utils/dom`
(`querySelectorAll`, `renderComponent`), `/watchers` (`onAppLaunch`, `onPopupCreate`,
`onLocationChange`), and `/logger`.

### Plugin settings — the Configuration API (**✅ verified**, installed Millennium + `@steambrew/client` 5.8.5)

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

- **Settings panel:** `export default definePlugin(() => ({ icon, content }))`. Millennium
  renders `content` in its desktop sidebar (`MillenniumDesktopSidebar_EditorContent`),
  inside an `ErrorBoundary`. A plugin with no `content` shows as "not configurable".
- **No default declaration.** An unset key reads `undefined`, so ship defaults in
  the plugin and read `stored ?? default`.
- **Limits:** at most 256 keys per plugin, 256 KB per value. Values are JSON.
- The `@steambrew/client` build exports **stubs** (`get` resolves `undefined`); the
  real implementation is injected by Millennium at runtime. Outside Steam
  (tests), the stubs are what you get.
- Each call is an IPC round trip. Cache values in memory and update them from
  `subscribePluginConfig`; do not call `get` on a hot path.

### Reusing Steam's native UI (**✅ verified**, reading `k0d13/steam-non-steam-playtimes` at commit `f2c14ec`)

> **Read this second, not first.** Cloning Steam's DOM is the **last resort**,
> valid only when no real component is reachable and Steam models no data you
> can write to. Try, in order: restore a section Steam already renders but
> filters out by app type → feed Steam's own store → render Steam's real
> component from its module cache → _then_ clone.
>
> That ordering is not theoretical. The Post-Game Summary was built with the
> technique below, cloned faithfully, passed testing — and was still deleted,
> because Steam had been rendering it all along and merely filtering it out for
> non-Steam games. ~1200 lines went away
> ([ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
> method in [steam-components.md](steam-components.md)).
>
> The play-bar case below **is** a legitimate use: Steam models no per-shortcut
> playtime stat to write to, so there is nothing to feed and no hidden
> component to restore.

This is the technique for that last resort, and it is broader than "look up a
class name". The reference plugin's
`frontend/components/play-bar.tsx` and `frontend/renderers/app-properties.tsx`
demonstrate it end to end, and **write zero custom CSS anywhere in the project.**

There is no dedicated stylesheet, no `styled-components`, no `<style>` block with
hand-written rules — only the one-line `<style>` tag shown below, whose entire
job is to hide Steam's original element.

#### The pattern: clone the DOM shape, then hide the original

Steam's own markup for a UI element (say, the play bar's playtime stat) is a
fixed tree of elements with hashed classes:

```
<div class="{GameStat} {Playtime} Panel">
  <div class="{GameStatIcon} {PlaytimeIcon}"> ...icon svg... </div>
  <div class="{GameStatRight}">
    <div class="{PlayBarLabel}">Play Time</div>
    <div class="{PlayBarDetailLabel}">12 hrs</div>
  </div>
</div>
```

To make a non-Steam game show the same thing, the plugin does **not** invent new
markup or new CSS. It **reproduces this exact tree**, with the exact same classes
(resolved at runtime via `findClassModule`, never hardcoded — see
[ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)),
and mounts its own copy as a sibling of Steam's real element. Then it hides
Steam's original with one scoped CSS rule and reveals its own copy via a marker
attribute:

```tsx
const PlayBar = findClassModule((m) => m.GameStat) as Record<string, string>;

export function Playtime({ minutesForever }: { minutesForever: number }) {
    return (
        <div
            data-nsp="playtime"
            className={`${PlayBar.GameStat} ${PlayBar.Playtime} Panel`}
        >
            {/* Hide Steam's REAL element (the one without data-nsp) in this exact
          slot; our clone (which HAS data-nsp) stays visible. */}
            <style>{`.${PlayBar.GameStat}.${PlayBar.Playtime}:not([data-nsp]){display:none!important}`}</style>
            <div className={`${PlayBar.GameStatIcon} ${PlayBar.PlaytimeIcon}`}>
                <PlayTimeIcon />
            </div>
            <div className={PlayBar.GameStatRight}>
                <div className={PlayBar.PlayBarLabel}>
                    {Steam.LocalizationManager.LocalizeString(
                        "#AppDetails_SectionTitle_PlayTime",
                    )}
                </div>
                <div className={PlayBar.PlayBarDetailLabel}>
                    {formatDuration(minutesForever)}
                </div>
            </div>
        </div>
    );
}
```

The `:not([data-nsp])` selector is precise: it hides only the _unmarked_
element sharing the same two classes — Steam's real (and, for a non-Steam game,
empty/hidden-by-Steam) node — never our own clone. Because the injected
`<style>` is scoped by that same class pair, it cannot leak into unrelated parts
of the page.

This is also why `Playtime`/`LastPlayed` are only rendered conditionally
(`if (minutesForever > 0)`, `if (lastPlayedAt)` in the renderer): Steam's game-stat
row is a `flex` container that Steam itself only populates with the stats it has
data for, so omitting a clone when there is no data lets the row lay out exactly
as it would natively, with no empty box.

Icons are copied too, not restyled — `PlayTimeIcon` in `play-bar.tsx` is a literal
inline SVG with Steam's own path data and `SVGIcon_Button SVGIcon_PlayTime`
classes, not a custom icon.

#### Borrow formatters and strings, never hand-format

```ts
// Steam's own relative-date and duration formatters, found by source text
const formatRelativeDate = findModuleExport((e) =>
    e?.toString?.()?.includes('"#Time_Today"'),
);
const formatDuration = findModuleExport((e) =>
    e?.toString?.()?.includes('"#Played_"'),
);
```

```ts
Steam.LocalizationManager.LocalizeString("#AppDetails_SectionTitle_LastPlayed");
```

Using these means the plugin inherits Steam's fonts, spacing, colors, date formats,
and translations for free — and automatically follows any restyle **because there
is no separate style to fall out of sync.**

#### Steam's own React components, not just its classes (**✅ verified**, `@steambrew/client@5.8.5`)

`@steambrew/client`'s `index.d.ts` re-exports `./components` and
`./custom-components` — a real component library, not just the class-lookup and
patch helpers the reference plugin happens to use for its play-bar work. It is
easy to miss because that plugin's play-bar case doesn't need them, but its
**own `app-properties.tsx` / `playtime-input.tsx` renderer does**, importing
`Button` and `TextField` directly from `@steambrew/client` rather than building
custom form controls.

Full list of exported components (`build/components/*.d.ts`): `Button`,
`ButtonItem`, `Carousel`, `ControlsList`, `Dialog`, `DialogCheckbox`, `Dropdown`,
`ErrorBoundary`, `Field`, `FocusRing`, `Focusable`, `FooterLegend`, `IconsModule`,
`Item`, `Marquee`, `Menu`, `Modal`, `Panel` (`PanelSection`, `PanelSectionRow`),
`ProgressBar`, `Scroll`, `SidebarNavigation`, `SliderField`, `Spinner`,
`SteamSpinner`, `Tabs`, `TextField`, `Toast`, `Toggle`, `ToggleField`. Plus
`custom-components`: `ColorPickerModal`, `ReorderableList`, `SuspensefulImage`.

Three of these are directly relevant to this plugin and should be used instead
of anything hand-built:

- **`Carousel`** — a real carousel component (`fnItemRenderer`, `nNumItems`,
  `nItemHeight`, `nItemMarginX`, `scrollToAlignment`, arrow paging, keyboard
  support) — this is what Steam's own post-game summary carousel is built from.
  Hand-rolling arrow buttons and a scrolling flex row with custom CSS
  reimplements something already shipped, and does not get its focus/keyboard
  behavior for free.
- **`SuspensefulImage`** — `suspenseWidth`/`suspenseHeight` loading placeholder
  for an `<img>`. This is Steam's own answer to "what shows while an image
  loads", replacing a hand-written shimmer/skeleton placeholder.
- **`Focusable`** / **`FocusRing`** — gamepad- and keyboard-navigable focus
  wrapper (`onActivate`, `onCancel`, `focusClassName`). Steam's own Focusable
  is what makes an element reachable by controller D-pad navigation, which a
  plain `<div>` is not. Because the plugin feeds Steam's stores and lets Steam
  render its native components (`Ge.T`, `ae.W`), Big Picture automatically receives
  these native focus rings and controller navigation without custom wrapping (ADR-0029).

`Panel` (`PanelSection`, `PanelSectionRow`) is the generic titled-section
container used throughout Settings and Quick Access; useful for any future
settings UI this plugin adds, again without writing container CSS by hand.

**Rule of thumb going forward:** before writing a custom component (carousel,
image placeholder, focus/hover wrapper, button, text input, dialog, tab strip),
check `build/components` and `build/custom-components` first — Steam very
likely already ships it, and the reference plugin's own `app-properties.tsx`
demonstrates importing `Button`/`TextField` directly rather than building them.

#### The real Post-Game Summary DOM, verbatim (**✅ verified**, live CEF devtools session)

Captured with `outerHTML` on a native game's app page (Divinity: Original Sin 2,
`appid` 435150, one clip + several screenshots) and on Fields of Mistria (enough
items to show the pager arrows). This is the exact tree to reproduce — every
class name below is the real hashed-plus-readable pair Steam ships, e.g.
`KniunRMLsSnzOWTG-tq81 PostGameSummaryClip Panel` (only the readable half is
shown here for brevity; always resolve the pair at runtime via
`findClassModule`, never hardcode the hash).

```
PageableContainer.Panel
├─ HeaderPageControls
│  ├─ GamePlaySummaryHeader              -- text is literally "Post-Game Summary";
│  │                                        CSS applies text-transform: uppercase
│  └─ PageClickContainer
│     ├─ PageLeft.Small [.Disabled when at start]   -- arrow SVG, scaleX(-1)
│     ├─ PageRight.Small [.Disabled when at end]    -- same arrow SVG, not flipped
│     └─ PageableCloseButton.Small       -- the "X" dismiss button
└─ BoxCarousel.SummaryCarouselContainer
   └─ BoxCarouselContents.SummaryCarouselScrollingContainer   -- display:flex, row
      └─ [role=list].ListElement (style="display:contents")
         │
         │  ONE ITEM PER TILE, NOT PER DAY — verified against a page with
         │  a clip + screenshots: each was its OWN SummaryContainer, sitting
         │  as flex siblings and visually joined into rows by CSS, not by
         │  nesting multiple tiles inside one SummaryContainerChildren.
         │
         ├─ [role=listitem].SummaryContainer.NoAnimation      -- tile 1 of a day
         │  ├─ EventHeaderBlock          -- "Today" ONLY on the day's first tile;
         │  │                               empty string on the rest of that day
         │  └─ SummaryContainerChildren  -- wraps exactly ONE tile (verified: every
         │     │                            observed instance had children.length === 1)
         │     └─ [role=button].PostGameSummaryClip.Panel
         │          style="aspect-ratio: 1.77778 / 1"
         │        ├─ img.ClipThumbnail  [src = .../gamerecordings/clips/<id>/thumbnail.jpg]
         │        └─ CornerContent
         │           └─ DurationText.Clip
         │              ├─ <svg>Steam's own clip icon, real path data</svg>
         │              └─ "0:06"  (mm:ss, plain text node after the icon)
         ├─ div.TypeSeparator.SpaceOnly [data-carousel="ignore"]   -- empty spacer
         ├─ [role=listitem].SummaryContainer.NoAnimation      -- tile 2, same day
         │  ├─ EventHeaderBlock          -- empty (already shown on tile 1)
         │  └─ SummaryContainerChildren
         │     └─ [role=button].SummaryScreenshot.ClickableScreenshot.Panel
         │          style="aspect-ratio: 1.77778 / 1"
         │        ├─ img.ClickableScreenshotImg.UseHeight  [src = full-size screenshot URL]
         │        └─ ScreenshotShareIcon (share/upload glyph, shown on hover)
         ├─ div.TypeSeparator.SpaceOnly [data-carousel="ignore"]
         └─ … (repeats per tile) …
      (a trailing div.ForcedCarouselPadding[data-carousel="ignore"] closes the row)
```

Things this corrects versus a from-scratch guess:

- **There is no separate "POST-GAME SUMMARY" section header outside the
  carousel** — the header (`GamePlaySummaryHeader`) and the pager arrows
  (`PageLeft`/`PageRight`) and the **dismiss button** (`PageableCloseButton`,
  the "X" seen in the top-right of the summary box) all live together in one
  `HeaderPageControls` row, itself a sibling of the carousel, both inside one
  `PageableContainer`. A plugin that renders its own `<h2>` title beside a
  separately-built carousel has already diverged from the real tree.
- **`SummaryContainer` is one tile, not one day.** This was wrong in an earlier
  pass of this doc: a day with multiple captures is multiple sibling
  `SummaryContainer`s (each wrapping exactly one tile in its own
  `SummaryContainerChildren`), joined by empty `TypeSeparator` spacer `div`s,
  not one container holding several tiles. Only the **first** tile of a run
  gets a non-empty `EventHeaderBlock` ("Today", a date, …); the rest have an
  empty one. `BoxCarouselContents` is `display: flex; flex-direction: row`,
  and that flex row is what actually lines the tiles up — `SummaryContainer`
  and `SummaryContainerChildren` are themselves `display: block`.
- **The pager arrows are plain siblings of the header text**, not flanking the
  carousel left/right. They share one `PageClickContainer` with the close
  button. `.Disabled` is added/removed by Steam depending on scroll position —
  there is no separate `disabled` attribute logic to hand-write; it is a class.
- **The clip's icon is a specific Steam SVG** with real path data (not a
  generic "scissors" glyph) — copy the path verbatim from a live capture if
  redrawing is unavoidable, or better, find it via `findModuleExport` the same
  way `formatDuration` is found.
- **Screenshot tiles get a `ScreenshotShareIcon` on hover** (a share/upload
  glyph), which a plugin does not need to implement for non-Steam games (there
  is no Steam Community to share to) — but its presence explains part of the
  "why does hovering a native tile look different" gap.
- Both tile types set `aspect-ratio: 1.77778 / 1` (16:9) as an inline style
  rather than fixed pixel `width`/`height` — sizing is fluid, not a hardcoded
  `224×126` box. (The `224×126` figure recorded elsewhere in this doc is one
  observed _rendered_ size at one window width, not the authored size.)
- `TypeSeparator` and `ForcedCarouselPadding` are empty, presentation-only
  `div`s carrying `data-carousel="ignore"` (almost certainly a hint to Steam's
  own carousel/paging math to skip them when measuring item positions) — they
  exist purely for the gap/edge-padding CSS gives them, there is no content or
  behavior to replicate beyond rendering an empty spacer between tiles.

#### Classes seen together in one element are NOT necessarily one CSS module (**✅ verified the hard way**, building `non-steam-games-activity`)

Building against the tree above, every class name was resolved with **one**
`findClassModule('SummaryCarouselContainer')` call, on the assumption that
because `PostGameSummaryClip`, `PageableContainer`, `GamePlaySummaryHeader`,
etc. all appear in the _same captured `outerHTML`_, they live in the same
webpack CSS module and one probe key would resolve all of them.

**That assumption is false, and it fails silently.** `findClassModule` returns
`undefined` for a key not present in the module it found, React then renders
that element with **no class attribute at all**, and the element loses every
rule that class carried — `position`, sizing, everything. The _symptom_ was a
clip tile rendering at the full width of its flex row instead of a contained
16:9 thumbnail; `tile.className` in the live DOM was just `"Panel"`.

The Post-Game Summary alone is split across **four** separate modules. Found
by walking Steam's own webpack module cache directly rather than guessing:

```js
// From a CEF devtools console on SharedJSContext:
let req;
window.webpackChunksteamui.push([
    [Symbol()],
    {},
    (r) => {
        req = r;
    },
]);

// Find every module factory whose SOURCE mentions a class name:
const hits = [];
for (const id in req.m) {
    if (req.m[id].toString().includes("PostGameSummaryClip")) hits.push(id);
}

// Execute one and inspect its real exports:
const exports = req(Number(hits[0]));
Object.keys(exports.default ?? exports); // the module's actual key set
```

Result for this page:

| Module (probe key that finds it) | Also exports                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SummaryCarouselContainer`       | `SummaryCarouselScrollingContainer`, `GamePlaySummaryHeader`, `SummaryContainer`, `SummaryContainerChildren`, `SummaryScreenshot`, `EventHeaderBlock`, `TypeSeparator`, `ForcedCarouselPadding` |
| `PageableContainer`              | `HeaderPageControls`, `PageClickContainer`, `PageLeft`, `PageRight`, `PageableCloseButton`, `Disabled`, `Small`                                                                                 |
| `PostGameSummaryClip`            | `ClipThumbnail`, `CornerContent`, `DurationText`                                                                                                                                                |
| `ClickableScreenshotImg`         | `ClickableScreenshot`, `ScreenshotShareIcon`, `UseWidth`, `UseHeight`                                                                                                                           |

Note in particular: `GamePlaySummaryHeader` is **only** in the first module —
a second bug in the same session came from reading it off the _second_ map
(`PageableContainer`'s), which has no such key, silently rendering the header
with an empty class. `HeaderPageControls` (the real parent, which DID resolve)
absorbed the blame at first because a `textContent`-based debugging query
matched the nearest _classed_ ancestor of the now-classless header text.

**The rule going forward:** resolve one `findClassModule` probe per module,
never assume co-occurrence in a DOM capture implies co-membership, and when a
resolved class's effect looks wrong, dump the _whole_ object
(`console.log(SomeClasses)` or the CDP snippet above) and check every name
against it by exact match — do not trust that a name "sounds like" it belongs.

#### A literal string in `cx()` can silently drop a real hash (**✅ verified twice**, building `non-steam-games-activity`)

Two separate bugs, same root cause: `cx(SomeClasses.Foo, 'Bar')` was written
with the **literal string** `'Bar'` where `SomeClasses.Bar` (a lookup) was
meant. TypeScript cannot catch this — a literal string is a perfectly valid
`string` argument — so it compiles clean and only fails visually, at runtime,
in the live client.

The reason it fails at all: not every class value in these modules is a bare
hash. Several are **two-token strings already**, e.g. (from `PageableClasses`,
probe `PageableContainer`):

```js
PageableClasses.Small; // "_3qlJ0L41KQFqUTzVQKFERC Small"
PageableClasses.PageableCloseButton; // "_2dB1oJFsqNThak1cFya2-q PageableCloseButton"
```

Passing the literal string `'Small'` instead of `PageableClasses.Small` drops
the hash `_3qlJ0L41KQFqUTzVQKFERC` entirely — the element keeps whatever rules
`PageableCloseButton`'s own hash carries, but loses every rule scoped to
`.Small` specifically (in this case, the close button's actual sizing).
Native's real rendered class is 4 tokens
(`<hash1> PageableCloseButton <hash2> Small`); the bug rendered only 2.

The second instance was identical in shape: `cx(ClipClasses.DurationText,
'Clip')` instead of `cx(ClipClasses.DurationText, ClipClasses.Clip)` dropped
`.Clip`'s amber colour rule (`rgb(255,213,95)`), leaving the clip duration
badge in `DurationText`'s own default blue
(`rgb(26,159,255)`, Steam's default highlight colour) — a bug that looks like
"wrong color" rather than "missing class," which is what made it non-obvious
from the rendered result alone.

**The rule going forward:** never write a class-modifier as a literal string
next to a resolved lookup in the same `cx()` call. If a modifier needs adding,
resolve it from the same class map (`SomeClasses.Modifier`), even if it looks
like a plain, unhashed word — check its actual value first
(`console.log(SomeClasses)`), because it may already be a multi-token string
in disguise.

#### Two runtime APIs are silent no-ops in this Steam/CEF build (**✅ verified**, building the Post-Game Summary's real carousel)

Found implementing real pager/scroll behaviour (see "Reusing Steam's native
UI" above for the component this belongs to). Both fail **silently** — no
thrown error, no console warning — which is what makes them worth recording
rather than re-discovering:

1. **`Element.scrollTo({ behavior: 'smooth' })` does nothing.** `scrollLeft`
   never changes. Confirmed by monkeypatching `scrollTo` on the live element
   to trace every call: the correct target value was computed and passed
   every time; only the `smooth` variant failed to apply. The exact same call
   with `behavior: 'auto'` works instantly. Native's own scrolling-carousel
   component (module `26271`, see below) never actually relies on the
   browser's smooth-scroll for this reason — it animates `scrollLeft` by hand
   via its own small animation helper
   (`new SomeAnimator(el, {scrollLeft}, {msDuration:500,
timing:"cubic-in-out"})`). `non-steam-games-activity` now does the same
   (`animateScrollLeft` in `frontend/components/carousel.tsx`): a plain
   `requestAnimationFrame` loop easing `scrollLeft` from its current value to
   the target over 500ms.
2. **Setting `scrollLeft` from JS never dispatches a native `scroll`
   event**, in this build, at all. Confirmed by attaching a `scroll`
   listener that incremented a counter, then running a full visible
   scroll-left-to-right animation (via the manual animator above) and polling
   the counter for a full second afterward — it stayed at `0` throughout, even
   though `scrollLeft` visibly moved from `0` to `308`. Any code relying on
   `element.addEventListener('scroll', ...)` to react to a JS-driven scroll
   (as opposed to a real wheel/trackpad/touch scroll, which may still dispatch
   normally) needs its own explicit hook into whatever moves `scrollLeft` —
   for the carousel, that means the scroll-animation loop itself calls the
   "recompute pager state" function on every frame, rather than leaning on
   `onScroll`.

Neither of these is Millennium- or plugin-specific; they are properties of
the specific CEF build Steam embeds. Worth re-checking if Steam ever updates
its embedded CEF version.

#### Steam's real Post-Game Summary carousel is not `@steambrew/client`'s `Carousel` — and the fix is to render the real one, not reimplement it (**✅ verified**, walking the live module cache)

`@steambrew/client` exports a `Carousel` component
(`build/components/Carousel.d.ts`), but it is the wrong shape for this UI: it
is a **windowed, index-based virtualizer** (`fnItemRenderer(id)`,
`nNumItems`, `fnGetColumnWidth`) built for long uniform lists — a friends
list, a store shelf — where rendering every item at once would be wasteful.
The Post-Game Summary has a handful of variable-size tiles (screenshots,
clips, achievement stacks, trading cards) and does not need virtualization at
all.

Steam's own client does **not** use its exported `Carousel` for this either.
Walking the live module cache (same technique as above, searching factory
source text for `PageLeft`/`PageRight` co-occurrence, then for
`fnUpdateArrows`) found the real, unexported pair:

- **Module `4584`** (`Pageable`, exported as `C`) — renders `PageableContainer`
  → `HeaderPageControls` (title, then `PageClickContainer` holding
  `PageLeft`/`PageRight`/`PageableCloseButton`) → `PageableContent`. Its
  `children` prop is a **render-prop function**, `(ref, fnUpdateArrows) =>
ReactNode`, not plain JSX children — it owns `bLeftArrowEnabled`/
  `bRightArrowEnabled` as internal state, computed from whatever calls the
  `fnUpdateArrows` it hands its render-prop, and **only renders the
  `PageLeft`/`PageRight` fragment in the tree at all when at least one is
  true** — this is why native shows no arrows whatsoever on a summary small
  enough to fit one row, not a disabled pair.
- **Module `26271`** (the real `Carousel`, exported as `Q`) — the plain-DOM
  scrolling primitive itself: a `ResizeObserver` on the scrolling div
  re-checks overflow on any size change, `UpdateScrollArrows` computes
  `bLeftEnabled`/`bRightEnabled` from `scrollLeft`/`clientWidth`/
  `scrollWidth` (`scrollLeft >= 1` for left; `scrollLeft + clientWidth <
scrollWidth` for right) and reports them via `fnUpdateArrows`,
  `ScrollLeft`/`ScrollRight` walk the DOM children to find the next/previous
  tile not already fully visible and scroll to its leading edge (not a fixed
  pixel amount, not a full page), and `componentDidUpdate` re-runs the
  overflow check unconditionally on every render. Children carrying
  `data-carousel="ignore"` (Steam's own `TypeSeparator`/
  `ForcedCarouselPadding` spacers) are skipped by this visibility math.

Real usage, decompiled from the actual Post-Game Summary component (module
`53074`):

```jsx
<Pageable
    name="Post-Game Summary"
    bNoHeader={isShortSummary} // false whenever any real tile exists
    customheader={
        <div className={SummaryClasses.GamePlaySummaryHeader}>
            Post-Game Summary
        </div>
    }
    bShowCloseButton={true}
    onCloseButtonClicked={dismiss}
    buttonSize="small"
    headerPadding="0px 8px 0px 0px"
>
    {(ref, fnUpdateArrows) => (
        <Carousel
            className={SummaryClasses.SummaryCarouselContainer}
            leftMargin={32}
            ref={ref}
            fnUpdateArrows={fnUpdateArrows}
            edgeMask="none"
        >
            {tiles}
        </Carousel>
    )}
</Pageable>
```

Two easy misreadings of `Pageable`'s prop contract, both hit while building
this, both worth flagging for the next thing that renders it:

- Passing `name` alone (no `customheader`) renders `Pageable`'s OWN generic
  `Name`+`Rule` header — not what native's Post-Game Summary actually shows
  (its header carries the `GamePlaySummaryHeader` class, never `Name`).
  Native computes its own header div once and passes it in as
  `customheader` regardless of anything else.
- `bNoHeader` is not a "hide `Pageable`'s default header, still show my
  `customheader`" flag — reading `Pageable`'s own source
  (`!this.props.bNoHeader && <div className={HeaderPageControls}>{customheader
? customheader : <defaultHeader/>}</div>`) shows it gates the **entire**
  header div, `customheader` included. The real caller only ever sets it
  `true` for a "short" summary made up entirely of multi-achievement groups
  (rendering that same header as a plain sibling above `Pageable` instead) —
  never for screenshots/recordings. A consumer whose content is always
  media tiles should always pass `bNoHeader={false}`.

**First built as a from-scratch reimplementation, then replaced with the
real components once resolvable** — worth recording as a full worked example
of "Reuse Steam's real components" (see AGENTS.md): `26271`'s scrolling
behaviour was fully reimplemented and verified working
(`frontend/components/carousel.tsx`, then called `ItemCarousel`) before this
project's owner explicitly said to prefer rendering the real components
wherever reachable, even over an already-working hand-built copy — the
principle being that a resolved Steam component cannot drift from native,
where a hand-built approximation can and does (see the header-prop mistakes
above, discovered only once a real diff against native was actually
performed).

Both `Pageable` and this real `Carousel` are resolved via
`@steambrew/client`'s own `findModuleExport` (an official, documented API —
not a hand-rolled webpack walk), filtered by a **stable signature over each
component's real `prototype` method names**:

```js
const RealPageable = findModuleExport(
    (m) =>
        typeof m === "function" &&
        typeof m.prototype?.OnUpdateArrows === "function" &&
        typeof m.prototype?.ScrollToFirstChild === "function" &&
        typeof m.prototype?.onCloseButtonClicked === "function",
);

const RealCarousel = findModuleExport(
    (m) =>
        typeof m === "function" &&
        typeof m.prototype?.BindScrollingContainer === "function" &&
        typeof m.prototype?.UpdateScrollArrows === "function" &&
        typeof m.prototype?.ScheduleUpdateScrollArrows === "function",
);
```

Real class method names are **not** mangled by Steam's minifier — only
variable and module bindings are — so this kind of filter survives a Steam
update reshuffling module ids the same way `findClassModule`'s name-based
class probing already does elsewhere in this codebase. A raw numeric module
id (`req(4584)`) would not survive that and should be treated as a
throwaway value for one-off live investigation, never something to commit to
source. `hasRealCarousel` (both resolved) gates a fallback path
(`PlainFallbackCarousel` + a hand-built header) for the case a future Steam
update renames every method this filter checks — degraded, not crashed.

The pager chevron itself (`PageLeft`/`PageRight`'s icon) was identified the
same source-reading way — module `50376`, the function Steam calls with
`singlearrow={true}`: passing that prop skips rendering the icon's second
`<polyline>` (a double-chevron by default; Steam's _other_ uses of the same
icon component, e.g. a "skip to end" control, presumably want both).
`angle={0}` / `angle={180}` rotate the same left-pointing path via an inline
`transform: rotate(...)`, rather than two different paths for left vs right

- moot for `non-steam-games-activity` now that the real `Pageable` supplies
  this icon itself, but worth recording for whatever eventually needs this
  same icon component directly (e.g. a "skip to end" control elsewhere).

`CarouselClasses` (probe `BoxCarousel`) was the fifth resolved class module
found while building that reimplementation. **All five are now gone**, along
with `classes.ts` itself: Steam renders the summary, so nothing needs
resolving. The finding is kept here because the _method_ — verifying
co-membership by walking the module cache — remains correct, and because the
count itself is the argument: five modules of fragile lookups to reproduce
something Steam was already willing to draw.

### Feeding Steam's own stores (**✅ verified live on this machine**)

The technique that replaced cloning for the app detail page. Full trace in
[steam-components.md](steam-components.md); the reusable facts:

**Steam's stores are MobX singletons with ordinary public methods.** They are
not sealed, and they do not validate app type. `CGamePlaySession` exposes
`AddClip`, `BAddScreenshotNotification`, `GetSessionEvents`,
`ClearSessionEvents`, `HasSessionEvents` — all of which accept a non-Steam
game's data without complaint.

**Features are hidden by app type, not capability.** Steam's app-details
section registry:

```js
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
```

Three sections instead of eighteen. Nothing behind the filter objects to a
shortcut's appid — the components and stores work, they are simply never asked.
**Check for this before concluding a feature is missing.**

**Steam already indexes non-Steam captures.** Both of these work unmodified for
a shortcut and return absolute `steamloopback.host` URLs Steam serves itself:

```js
await SteamClient.Apps.GetScreenshotsInTimeRange(appid, since, 0); // 32-bit appid
await service.GetClips({ game_id: gameid, created_after: since }); // 64-bit gameid
```

**Steam's own gameid helper truncates to 32 bits.** `bY(4263274102)` returns
`1861238`, not `18310622842007322624`. That single bug is why non-Steam clips
never appear natively — the service is willing, Steam just asks about the wrong
game. Compose the gameid yourself.

### Critical Traps & Cross-Tab Ripple Effects (Learned from Regressions)

Every one of these traps caused a real regression during development across the Activity,
Game Info, or Your Stuff tabs. Review them before modifying any store or prototype hook.

#### Trap 1: The `AppOverview` ID Coupling Trap (`BIsModOrShortcut` vs `GetGameID`)

Steam's native `AppOverview.prototype.GetGameID()` is implemented as:

```javascript
GetGameID() { return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString(); }
```

- **The Breakdown Chain:**
    1. Steam hides rich metadata (descriptions, developers, publishers, release dates, categories) from the Game Info tab (inner component `k` in module `15448`) with `r = this.props.overview.BIsModOrShortcut()`. If `r === true`, Steam drops the metadata and renders `#AppDetails_Shortcut_Explanation`.
    2. To allow Game Info to render, `BIsModOrShortcut()` is hooked to return `false` for enriched shortcuts.
    3. But `GetGameID()` calls `this.BIsModOrShortcut()`. When that returns `false`, `GetGameID()` evaluates to `this.appid.toString()` (`"4263274102"`).
    4. The "YOUR STUFF" tab's Media section (module `57150`, component `Ae.E`) queries captures:
       `(0, B.MZ)({ listSource: { type: "app", gameid: e.overview.gameid } })`
       where `overview.gameid` is a getter calling `GetGameID()`.
    5. Shortcut screenshots (`screenshots.vdf`) and clips (`window.g_GRS`) are keyed by the composed 64-bit ID (`"18310622842007322624"`).
    6. Querying by `appid.toString()` returns 0 items (`S.length === 0`), collapsing the entire "YOUR STUFF" tab into the empty placeholder _"You can take a screenshot..."_!
- **The Mandated Architecture:**
    - In `ensureAppOverviewHooked`, `GetGameID` MUST be hooked on `AppOverview.prototype`:
        ```typescript
        curr.GetGameID = function () {
            if (this.m_gameid) return this.m_gameid;
            return origGetGameID.apply(this, arguments);
        };
        ```
        This completely decouples 64-bit shortcut identification from the shortcut flag.
    - In `non-steam-games-activity/frontend/steam/sections.ts`, `isShortcut` must check `overview.appid >= 0x8000_0000 || overview.BIsModOrShortcut()` so shortcut sections (`postgamesummary`, `activity`) are never suppressed when `BIsModOrShortcut` is bypassed.

#### Trap 2: The $O(1)$ Performance Choke in Prototype Hooks

- **What happened:** Inspecting the call stack (`new Error().stack`) inside `AppOverview.prototype.BIsModOrShortcut` froze Big Picture navigation for 30+ seconds.
- **Why:** `BIsModOrShortcut()` is a hot method called hundreds of times per second by React render cycles, MobX reactions, and controller focus updates. Generating stack traces in V8 is extraordinarily slow.
- **The Rule:** Prototype hooks must run in $O(1)$ time using clean set lookups (`enrichedAppIds.has(this.appid)`). Never evaluate error stacks, regexes, or DOM selectors in prototype hooks.

#### Trap 3: The Single-Pass Webpack Cache Choke

- **What happened:** Re-scanning Webpack's module registry (`req.m`) inside card render paths created an $O(N^2)$ execution choke, causing the activity feed to stutter and freeze.
- **The Rule:** Scan Webpack modules **once** during plugin initialization (`initCardComponents()`) and store resolved components in module-scoped variables. Never iterate `req.m` inside component render functions or callbacks.

#### Trap 4: Section Registry Memo Mutation

- Steam's `CAppDetailsSections.prototype.GetSections` returns its memoized set (`this.m_setSectionsMemo`), not a new set, and compares it by size alone.
- Mutate the set in-place, and clear `instance.m_setSectionsMemo = undefined` before calling `instance.forceUpdate()`.

#### Trap 5: Asynchronous Data Arrival & Multi-Window Reactivity

- MobX observers in Steam only react to changes in Steam's native stores, not plugin-internal state or caches.
- When metadata or activity loads asynchronously, the page has already rendered.
- You must discover all active documents (Desktop + Big Picture popup via `window.g_PopupManager.GetExistingPopup("SP BPM_uid0")`), locate mounted component fibers (`__reactFiber$`), and invoke `forceUpdate()`.

#### Trap 6: Activity Feed StoreItemCache Stubbing & CSS Scoping

- Steam's activity cards check `storeApp.BIsVisible()`. For non-Steam games, `StoreItemCache` has no record, causing cards to render blank.
- ADR-0030 stubs `StoreItemCache.m_mapApps.set(appid, stubApp)` with `{ BIsVisible: () => true }`.
- Scoping card thumbnail CSS requires `[class*="CarouselThumb"]:not([class*="CarouselThumbs"])` with `width: 100% !important` to prevent parent flex rows from squashing cards into ~80px cutouts.

#### Trap 7: A DOM probe can report success while the page looks wrong

- Always verify with a real CEF screenshot across both Desktop and Big Picture Mode before declaring a feature complete. Stale rendered DOM or z-index/portal clipping can hide defects from plain querySelector checks.

#### Trap 8: Negative Cache Poisoning & Stub Lifetime in `StoreItemCache`

- **The Problem:** Deleting stubs from `StoreItemCache.m_mapApps` inside unmount / unpatch hooks (`clearActivity`) triggers asynchronous 404 store requests from unmounting React hooks (`useStoreItemCache` in module `82594`).
- **The Breakdown Chain:** Steam permanently blacklists the shortcut appid in `StoreItemCache.m_setUnavailableApps`. On returning to the game, `BIsStoreItemMissing(appid)` evaluates to `true`, returning `undefined` to event renderer `dt` (module `80478`), which returns `null` and wipes out all daily activity events into an empty `<div></div>`.
- **The Defense:**
    1. Never delete shortcut stubs from `StoreItemCache.m_mapApps` on view unmount (they cost negligible memory: ~150 bytes).
    2. Always purge `storeCache.m_setUnavailableApps?.delete(appid)` in `publishActivity`.
    3. Hook `StoreItemCache.prototype.BIsAppMissing` to return `false` whenever `appid >= 0x8000_0000`.

#### Trap 9: Synthetic `appData.details` Overwrite Mutating Store Objects

- **The Problem:** Setting `appData.details = {}` to feed descriptions or developer credits crashes native `GameStatsSection` components because internal arrays (`vecChildConfigApps`, `unEntitledContentApp`) are missing.
- **The Defense:** Never overwrite `appData.details`. Exclusively feed Steam's dedicated channels: `appData.descriptionsData` (`strSnippet`, `strFullDescription`) and `appData.associationData` (`rgDevelopers`, `rgPublishers`, `rgFranchises`).

### Identifying non-Steam apps

Steam assigns shortcuts very high app ids. The SDK exposes the boundary as
`NON_STEAM_APP_APPID_MASK`; the idiom is:

```ts
if (app.appid < NON_STEAM_APP_APPID_MASK) return; // a real Steam game — skip
```

### Three integration points (all proven by the reference plugin)

1. **Library home / grid** — `beforePatch(Steam.CollectionStore, 'OnAppOverviewChange')`,
   then write onto the app overview objects before Steam renders them. This is how the
   reference plugin makes non-Steam playtime appear in the library list. Patching the
   _data_ is far more robust than patching the DOM.

2. **App detail page** — watch `/library/app/<appid>` via `onPopupCreate` +
   `onLocationChange`. **What you do next depends on whether Steam already has
   the UI.** For the post-game summary it does, so
   `non-steam-games-activity` restores the section and feeds Steam's store and
   renders nothing itself (see [§ Feeding Steam's own
   stores](#feeding-steams-own-stores-verified-live-on-this-machine) below).
   Only when no component and no store exist does the
   [clone-and-hide technique](#reusing-steams-native-ui-verified-reading-k0d13steam-non-steam-playtimes-at-commit-f2c14ec)
   apply — as it does for the reference plugin's play bar. Its mount idiom:
   render the clone, then `parent.querySelector(':has([data-nsp="..."])')` — if
   a previous clone is mounted, `existing.replaceWith(element)`; otherwise
   `parent.appendChild(element)`, so a refresh updates rather than duplicates.

3. **App properties dialog** — the reference plugin adds a tab by patching
   `Array.prototype.map` and detecting the page-descriptor array
   (route `/app/:appid/properties/…`). Its own comment calls this "not ideal"; it is a
   last resort. Note its performance guard: wait for `Steam.MainWindowBrowserManager`
   first, because `Array#map` is called ~15,000 times during startup.

### Deploying a plugin

A plugin is "installed" by placing a folder in the plugins dir and enabling it in
Millennium's `config.json` under `plugins.enabledPlugins` (**✅ verified** — the live
config here lists `achievement-groups`).

A deployed plugin folder contains only: `plugin.json`, `.millennium/Dist/`, `backend/`
(**✅ verified** from the installed plugin and from `dev.ps1`'s copy list). Source
`frontend/` is not deployed.

The reference `dev.ps1` flow: stop Steam → rename plugin to `<name>-dev` → build →
copy → disable the release plugin and enable the dev one → start Steam with `-dev`.

### The official docs, read section by section (2026-09-21)

Swept [docs.steambrew.app/plugins](https://docs.steambrew.app/plugins/) — Introduction,
Development Quirks, Basic, Advanced (Hooking API, Configuration API), and the LuaJIT/TypeScript
references — specifically checking each for anything about multi-window / Big Picture, since
that's our open smoke-test item (see [TASK.md](../TASK.md#1-big-picture--smoke-test-needed)).
Net result: **the official docs confirm the window model our ADRs already derived independently,
but do not document the mechanism we actually use to reach Big Picture at all** — that part is
entirely `steambrew-utils` territory, upstream of Millennium's own API surface.

#### Multi-window model (confirms ADR-0016/ADR-0023/ADR-0024)

[Development Quirks](https://docs.steambrew.app/plugins/introduction/environment) states the
window architecture plainly, independent of our own reverse-engineering:

> Opening developer tools reveals multiple devtool windows — one per Steam window (Main,
> Settings, Properties, etc). Each has its own Chromium instance with separate DOM and devtools.
>
> **SharedJSContext** is a headless parent instance: contains all Steam UI/logic code, spawns
> child windows (Main, Settings, Properties, etc) via `window.open`, passing its execution
> context. Has no visual DOM of its own.
>
> To hook UI in the main window, patch SharedJSContext — not the child window — since that's
> where the code actually lives.

This is exactly the shape ADR-0024 found by testing (`Steam.PopupManager` from
`SharedJSContext` gives a live `Window`/`document` for the Big Picture popup, no Millennium
injection needed) — Big Picture is just another one of these spawned child windows ("SP BPM\_"),
with its DOM separate but no independent code of its own. Confirms this isn't a Big-Picture-
specific quirk; it's how _every_ Steam window relates to `SharedJSContext`, Big Picture included.

#### `onPopupCreate` / `PopupType` / `Steam.PopupManager` are undocumented upstream

Checked deliberately, because this is the exact API surface `index.tsx` and `gamepad-app.tsx`
depend on: **none of `onPopupCreate`, `PopupType`, or `Steam.PopupManager` appear anywhere in
the official plugin docs** (Hooking API, Configuration API, or the TypeScript `Millennium`
reference). The official `Millennium` TS object exports only `AddWindowCreateHook` (deprecated
as of the docs' June 2026 note, in favor of the Configuration API), `findElement` (deprecated),
`exposeObj` (deprecated), and `openQuickAccess`.

So the watcher API this plugin is built on (`import { onPopupCreate, PopupType } from
'steambrew-utils/watchers'`, `Steam.PopupManager` from the same package) is a **third-party
convenience layer on top of Millennium**, not part of Millennium's own documented surface. That
matches what `steam-non-steam-playtimes` (our reference plugin) already showed by example, but
it's worth stating explicitly: if `steambrew-utils` ever stops matching Millennium's internals,
there is no upstream doc page to diff against — the only ground truth is
`node_modules/steambrew-utils`'s own source and live verification, same as we've already been
doing for `@steambrew/client`'s undocumented component exports (see above).

#### `Focusable` and `FocusRing` are official, documented components — not something we invented

[`Focusable`](https://docs.steambrew.app/plugins/ts/components/Focusable) is described as "the
base building block for anything that should be navigable" by gamepad or keyboard, with props
`children`, `flow-children`, `focusClassName`, `focusWithinClassName`, `noFocusRing`,
`onActivate`, `onCancel`, plus standard `div` attributes.

[`FocusRing`](https://docs.steambrew.app/plugins/ts/components/FocusRing) is the paired component
— it draws the focus outline around content, and its docs page is the one place upstream that
names Big Picture explicitly: **"particularly useful in Big Picture Mode."**

While early hand-built prototypes (`gamepad-app.tsx`, ADR-0024) struggled with gamepad navigation
and focus outlines, moving to Steam's native components (`Ge.T` and `ae.W` via ADR-0029) resolved
this completely: Steam's native components already wrap their carousels, buttons, and tiles in
`FocusRingRoot` and `Focusable` internally. Any new custom UI components added by future plugins
should reuse these primitives.

#### Nothing else Big-Picture-specific exists upstream

Checked and came up empty, so future sessions don't re-check the same ground: the Hooking API
page covers only server-side JS patching (regex `find`/`file`/`transforms` against served
chunks) with no popup/window lifecycle content; the Configuration API page covers only the
reactive config-sync system (`millennium.config.get/set/on_change` ↔ `usePluginConfig`), also
with no window-targeting content; Quick Start is just the template-clone bootstrap. There is no
official "Big Picture" or "gamepad mode" guide — everything usable for this plugin's Big Picture
work is either in `@steambrew/client`'s component exports (`Focusable`, `FocusRing`) or in
`steambrew-utils` (`onPopupCreate`, `PopupType`, `Steam.PopupManager`), both already in use, both
already known to be undocumented upstream.

---

## Part 2 — Steam's own data (**✅ all verified on this machine**)

This is what the **core** plugin runs on. All of it is local, already present, and
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

### Steam's own capture store (**✅ verified**)

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

### Recordings (**✅ verified** — one real clip captured 2026-09-19)

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

#### `clip.pb` field map (**✅ decoded from a real clip**)

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

### Shortcuts (`shortcuts.vdf`) (**✅ verified**)

Binary VDF at `userdata/<userid>/config/shortcuts.vdf`. Fields are type-tagged:
`0x00` nested map, `0x01` string, `0x02` int32, each followed by a NUL-terminated key.

Useful fields per entry: `appid` (int32, read as unsigned), `AppName`, `Exe`,
`StartDir`, `LaunchOptions`, `icon`, `tags`, `LastPlayTime`.

Parsed here: **223 entries — 210 RetroArch, 13 other** (AM2R among them). A full VDF
implementation is unnecessary; scanning for the type markers is enough.

> `appid` is stored as a **signed** int32 but used as unsigned. Mask with
> `& 0xFFFFFFFF` before the `<< 32` conversion, or ids above 2³¹ come out negative.

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

## Part 4 — RetroArch local data (**✅ all verified on this machine**)

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

## Part 5 — The ROM join key (**✅ verified, measured**)

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
  read `build/*.d.ts` directly (locally in `node_modules/.pnpm/`) for its full
  component export list; not documented on steambrew.app at time of writing
- [RetroAchievements API docs](https://api-docs.retroachievements.org/) ·
  [GetUserRecentlyPlayedGames](https://api-docs.retroachievements.org/v1/get-user-recently-played-games.html) ·
  [GetGameInfoAndUserProgress](https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html) ·
  [GetAchievementsEarnedOnDay](https://api-docs.retroachievements.org/v1/get-achievements-earned-on-day.html)
- [Libretro: playlists & thumbnails](https://docs.libretro.com/guides/roms-playlists-thumbnails/) ·
  [directory config](https://docs.libretro.com/guides/change-directories/)
