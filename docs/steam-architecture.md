# Steam architecture — the client we build on

**This doc's job:** a short orientation to Steam's own client: how it is put
together, the handful of facts every plugin developer must know, and which doc holds
the detail. It describes Steam, not our code. For our plugin's architecture see
[steam-cartridges.md](steam-cartridges.md).

Everything in the linked docs was read out of the live client over CEF devtools, not
inferred.

---

## 1. Runtime topology

Steam's UI is a multi-target Chromium Embedded Framework (CEF) application.

```
SharedJSContext (single runtime truth)
  ├── global stores: appSpotlightStore, appActivityStore, StoreItemCache, NotificationStore…
  ├── React portals, section registry, background services
  │
  ├──► Desktop window  (SP Desktop_…)  standard desktop UI
  ├──► Big Picture     (SP BPM_…)      gamepad UI, rendered from SharedJSContext
  └──► Toast / menu popups             about:blank portals, also from SharedJSContext
```

- Every store, MobX observable and service lives in **`SharedJSContext`**. Read and
  write data there.
- Desktop and Big Picture share one JavaScript runtime; Big Picture is a fullscreen
  popup rendering gamepad components.
- Not every popup is tracked by `g_PopupManager`; BrowserView popups are not.
- Millennium injects plugin frontends into this runtime and runs plugin backends
  (LuaJIT) beside it. The SDK, config API and CEF quirks are in
  [knowledgebase.md](knowledgebase.md).

## 2. How Steam treats a non-Steam game

Steam already has the pieces of a rich app page for a shortcut (screenshots,
recordings, the Post-Game Summary and Activity stores, the native achievements UI).
It hides them with **app-type filters and a few store guards**, not because the data
is missing. The section registry drops the Post-Game Summary, Activity and
Achievements sections for shortcuts, and stores such as `StoreItemCache` and
`AppDetailsStore` have no entry for a shortcut until something supplies one.

This is why a plugin can *call* Steam's UI instead of imitating it. The verified
trace is in [steam-components.md](steam-components.md).

## 3. Identifiers

A shortcut has two ids. Confusing them is the most common source of empty results.

| Id | Width | Used by |
| --- | --- | --- |
| **appid** | 32-bit | `shortcuts.vdf`, library URLs, `AppOverview.appid` |
| **gameid** | 64-bit | screenshot folders, `screenshots.vdf`, recordings of shortcuts |

`gameid = (appid << 32) | 0x02000000`, and `appid = gameid >> 32`. Recordings of
native Steam games are keyed by the raw appid. In the CEF runtime, shortcut appids
above `0x7FFFFFFF` appear as **signed** 32-bit values: normalise with `>>> 0` before
any map lookup or comparison. Details: [AGENTS.md](../AGENTS.md) and
[knowledgebase.md § The two identifiers](knowledgebase.md#the-two-identifiers).

## 4. Resolving Steam's code

Webpack module ids change between Steam builds; prototype method names and CSS
class-map keys survive minification. Plugins resolve a class or singleton by
**signature** once at startup and cache it, and prefer a `window` global where Steam
exposes one. The signature table is at the top of
[steam-components.md](steam-components.md) (§ Map: stable resolution signatures); the
rule is [plugins.md guardrail 3](plugins.md#3-single-pass-webpack-module-pre-caching).

## 5. Where the detail lives

| You want to know… | Read |
| --- | --- |
| What Steam does, which store owns what, every resolution signature, deep traces (app-detail sections, Post-Game Summary, Activity, Big Picture, achievements, notifications, recording, artwork) | [steam-components.md](steam-components.md) |
| How to inspect the live client (CDP targets, the inspection method, Big Picture traps, hung-UI diagnosis, cheap probes) | [steam-debug.md](steam-debug.md) |
| Facts outside Steam's UI code: Millennium SDK and config API, CEF quirks, Steam file formats, provider sources, prior art | [knowledgebase.md](knowledgebase.md) |
| The rules for plugin code that touches any of this | [plugins.md](plugins.md) |

Start with the *map* at the top of steam-components.md, then the deep trace for the
feature you are touching. Debug with the cheapest probe first
([steam-debug.md § 7](steam-debug.md#7-cost-efficient-debugging)).
