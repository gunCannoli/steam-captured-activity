# Steam Debugging & Inspection Guide

**This doc's job:** how to inspect, probe and debug the live Steam client over
the Chrome DevTools Protocol (CDP) — attaching, picking the right target,
finding Steam's code, the Big Picture traps, and doing all of it cheaply.

Not here: what you will find ([steam-components.md](steam-components.md), which
opens with the map); build/deploy/restart and the
guardrails ([plugins.md](plugins.md)).

---

## 1. Quick Start

Steam provides a built-in Chromium Embedded Framework (CEF) debugging server,
exposing a standard Chrome DevTools Protocol endpoint on **`http://127.0.0.1:8080`**.
Use the IPv4 address: Node 24 resolves `localhost` to IPv6 and fails to connect.

### Starting Steam with Debugging

Use the root helper script:

```powershell
# Check if Steam is running with debugging, or start it
.\start-steam-dev.ps1

# Force restart Steam in dev mode and open the browser inspector
.\start-steam-dev.ps1 -Restart -OpenBrowser

# Launch directly into Big Picture Mode with debugging enabled
.\start-steam-dev.ps1 -BigPicture
```

Or manually:

```powershell
& "C:\game\steam\steam.exe" -dev -cef-enable-debugging
```

> [!NOTE]
>
> - `-dev`: Enables Steam developer menus, client consoles, and debug logs.
> - `-cef-enable-debugging`: Opens the remote WebSocket debugging server on port `8080`.

---

## 2. The Target Topology

When querying `http://127.0.0.1:8080/json`, Steam lists multiple active targets.
They are not interchangeable:

| Target Title                         | URL / Pattern                                  | Role                       | Use it for                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SharedJSContext`**                | `https://steamloopback.host/index.html`        | **Primary Runtime Engine** | Evaluating code, poking **all stores**, webpack module caches, Millennium plugin instances (`PLUGIN_LIST`), navigating.                                   |
| **`Steam`**                          | URL contains `minwidth=1010` / `createflags=274` | **Main Desktop Window**  | Reading the desktop DOM (`#root`).                                                                                                                          |
| **`Steam Big Picture Mode`**         | `about:blank` (`#popup_target`)                | **Gamepad UI Window**      | Reading Big Picture's DOM. No scripts of its own (Trap 1).                                                                                                  |
| `notificationtoasts_<id>_desktop`    | `about:blank`                                  | Desktop toast (one per toast) | Toast DOM on desktop.                                                                                                                                    |
| `notificationtoasts_uid<n>`          | `about:blank?browserviewpopup=1`               | Big Picture toast (persistent) | Toast DOM in Big Picture (Trap 7).                                                                                                                     |
| `Steam Root Menu`, `… Supernav`, `… Menu` | `...createflags=...`                      | Chrome fragments           | Nothing — but they match naive title filters.                                                                                                               |

- **Match the main window by URL, not title.** Several targets are titled
  `Steam`; filtering on the title alone picks a menu popup and you read an empty DOM.
- **Navigate from `SharedJSContext`, read the DOM from the window.** They are
  separate JS contexts: `window.SteamUIStore` exists only in the former; the
  `document` you care about lives in the latter.

---

## 3. The Inspection Method

Run this **before building any component** — it has repeatedly turned "we need to
build X" into "Steam already has X". What is already mapped:
[steam-components.md § Map](steam-components.md#map-core-stores--modules).

### 3.1 Capture Steam's module require

Steam does not expose a global `require()`. In `SharedJSContext`, grab webpack's
internal require via a probe chunk:

```javascript
let req = null;
window.webpackChunksteamui.push([
    ["probe_" + Date.now()],
    {
        probe_mod: (m, e, r) => {
            req = r;
        },
    },
    (r) => {
        r((r.s = "probe_mod"));
    },
]);
window.__wreq = req; // req.m = ~2600 factories (.toString() readable); req(id) = exports
```

`__wreq` does not survive a Steam restart — re-run this after each one.

### 3.2 Find the thing

Search factory **source text** for a distinctive string, then read it:

```javascript
for (const id of Object.keys(req.m)) {
    const src = Function.prototype.toString.call(req.m[id]);
    if (src.includes("PostGameSummary")) console.log(id, src.length);
}
```

Best search terms, in order of usefulness:

1. **Localization tokens** (`#AppDetails_SectionTitle_`, `#AppActivity_`) —
   these name features exactly and are not minified.
2. **Store / prototype method names** (`GetPostGameSummary`) — property names survive.
3. **Class-map keys** (`GamePlaySummaryContainer`) — also how to check which CSS
   module a class really lives in (`req(id)` → `Object.keys(exports.default ?? exports)`).

Pipe a factory through `prettier --parser babel` before reading it; minified
Steam code is unreadable otherwise and perfectly clear after.

To resolve an export by method name in the console (numeric ids are throwaway —
never commit one):

```javascript
function findModuleByMethod(methodName) {
    for (const id in req.m) {
        try {
            const exp = req(id);
            for (const key of ["", "default", ...Object.keys(exp || {})]) {
                const target = key ? exp[key] : exp;
                if (target?.prototype && typeof target.prototype[methodName] === "function") {
                    return { id, target };
                }
            }
        } catch (_) {}
    }
}
```

### 3.3 Confirm against the live client

Never conclude from source alone. Poke the real stores with real appids:

| appid        | Game                     | Why it is useful                                |
| ------------ | ------------------------ | ----------------------------------------------- |
| `692850`     | Bloodstained             | biggest summary — 14 events                     |
| `435150`     | Divinity: Original Sin 2 | screenshots **and** a clip                      |
| `2142790`    | Fields of Mistria        | small, ordinary case                            |
| `4263274102` | AM2R                     | **non-Steam** — the case under test             |
| `2788628389` | ActRaiser                | non-Steam with **no captures** — the empty case |

Always test a native game and a non-Steam one side by side. The whole ADR-0022
finding came from noticing the store behaved _identically_ for both and only the
section list differed. `CAppSpotlightStore`'s simulate hooks exercise edge cases
without waiting ([steam-components.md § The simulate hooks](steam-components.md#the-simulate-hooks)).

Switch modes from `SharedJSContext` (prefer a clean restart if state gets odd — Trap 6):

```javascript
SteamClient.UI.GetUIMode(); // 7 = Desktop, 4 = Big Picture
SteamClient.UI.SetUIMode(4); // opens the "Steam Big Picture Mode" target
SteamClient.UI.SetUIMode(7);
```

### 3.4 Clean up

Patches and injected events mutate the running client. Revert them, or restart:

```javascript
window.__unpatchSections?.();
appSpotlightStore.GetOrCreateAppData(appid).m_session.ClearSessionEvents();
```

---

## 4. Big Picture Mode (Gamepad UI) Quirks & Traps

Debugging Big Picture has several counter-intuitive traps that caused days of
debugging during earlier investigations (see ADR-0023 through ADR-0030):

### Trap 1: The "Isolated Module Cache" Illusion (ADR-0029)

- **Symptom:** Evaluating `window.webpackChunksteamui` in the `Steam Big Picture Mode`
  popup DevTools console returns `undefined`.
- **Reality:** Big Picture's popup window has **no bundle or scripts of its own**.
  It is a bare `about:blank` window with `<div id="popup_target"></div>`.
- **Rule:** Big Picture is rendered from `SharedJSContext` via `ReactDOM.createPortal`.
  All React components, MobX stores, and section registries execute in **`SharedJSContext`**.
  Always run store inspections and data mutations in `SharedJSContext`, not in the popup.

### Trap 2: Big Picture Navigation Does Not Touch `window.location` (ADR-0026, ADR-0027)

- **Symptom:** In Big Picture, browsing between games in the library leaves
  `popup.window.location.href` as `about:blank`.
- **Reality:** Big Picture navigation is purely client-side React Router / component
  state; it never updates the browser window's URL.
- **Rule:** To track appid changes in Big Picture:
    - In code: Intercept `react/jsx-runtime` element creation filtered by
      `{ appid, rgSections }` (see `steam/gamepad-appid.ts`).
    - In DevTools: Watch DOM text inside `.TabTitle` or inspect React Fiber props.

### Trap 3: Case Sensitivity in DOM Text vs CSS

- **Symptom:** Searching the DOM for text like `ACTIVITY` or `POST-GAME SUMMARY` yields
  null.
- **Reality:** Steam's JSX sets title-case text (`Activity`, `Post-game summary`), and
  applies `text-transform: uppercase` via CSS. `element.textContent` reflects the DOM,
  not the rendered text.
- **Rule:** Always use case-insensitive matching (`.toLowerCase() === 'activity'`) when
  locating elements by text.

### Trap 4: Anchor Injection Collisions (ADR-0028)

- **Symptom:** Injected HTML elements collapse into tiny boxes with missing headers or
  collide with controller button icons.
- **Reality:** `tab.closest('[class]')` matches the element itself if it has a class.
  Appending to that puts the content inside the tab bar button instead of the content
  container below it.
- **Rule:** Don't inject custom DOM. Use Steam's own section registry (`CAppDetailsSections`)
  and let Steam mount its own components (`Ge.T`, `ae.W`) into its own containers.

### Trap 5: CDP Replay of Stale Console Logs

- **Symptom:** Attaching a fresh CDP WebSocket and calling `Runtime.enable` prints logs
  from hours ago, making it look like an old bug is still happening.
- **Reality:** CEF buffers console messages and replays them when DevTools connects.
- **Rule:** Rely on live DOM and store queries rather than console log timestamps.

### Trap 6: UI Mode Toggle State Desynchronization

- **Symptom:** Repeatedly toggling between Desktop and Big Picture via `SteamClient.UI.SetUIMode`
  leaves zombie windows or disconnected popup references.
- **Rule:** When state becomes erratic, restart Steam cleanly using:
    ```powershell
    .\start-steam-dev.ps1 -Restart
    ```

### Trap 7: Check the UI Mode Before Trusting a Live Test

- **Symptom:** A popup/toast hook "never fires at all" in a live check.
- **Reality:** Desktop and Big Picture create some windows differently. Big Picture's
  single toast window (`notificationtoasts_uid<n>`) is never registered with
  `g_PopupManager`; desktop's per-toast windows (`notificationtoasts_<id>_desktop`)
  are. A check run in Big Picture reads as "broken everywhere".
- **Rule:** Log `SteamClient.UI.GetUIMode()` with every live result, and test each
  mode separately ([plugins.md guardrail 12](plugins.md#12-popup-hooks-do-not-see-every-window)).

### Trap 8: Negative / Signed AppId in CEF Evaluations

- **Symptom:** Evaluating `store.GetAppData(3858889198)` returns undefined or querying `overview.appid` shows `-436078098`.
- **Reality:** Chromium's V8 engine and CEF marshal 32-bit unsigned integers $> \text{0x7FFFFFFF}$ as signed int32 in certain internal structures (`overview.appid | 0`).
- **Rule:** In CDP probe expressions and scripts, always coerce appids with `(appid >>> 0)` or check both signed and unsigned keys when testing store contents.

### Trap 9: Unregistered Millennium RPC Calls Crash the Backend Process

- **Symptom:** `callServerMethod` suddenly begins failing for all methods with `"failed to send RPC to child: <plugin>"`.
- **Reality:** In Millennium v3.4–v3.5, calling a non-existent RPC method name or letting an unhandled Lua `error()` escape into the C++ frame triggers `EXCEPTION_ACCESS_VIOLATION (0xC0000005)` in the Millennium host DLL, terminating the child Lua process.
- **Rule:** Only call methods explicitly exposed in `backend/main.lua`. Always wrap payloads with `{ payload: JSON.stringify(params) }`. If the backend crashes, restart Steam via `start-steam-dev.ps1 -Restart`.

### Trap 10: Diagnosing a Hung SharedJSContext ("restart the UI" dialog)

- **Symptom:** Steam's UI freezes and Steam offers to restart it. CDP
  `Runtime.evaluate` in every target times out, and `Debugger.pause` sent from a
  fresh connection never answers.
- **Reality:** all windows share one renderer main thread
  ([knowledgebase.md](knowledgebase.md#one-renderer-for-every-steam-window-a-busy-sharedjscontext-freezes-them-all)).
  CDP commands, including `Debugger.enable`, run on that thread, so a debugger
  attached after the hang is never enabled. A browser-level trace records nothing
  from the wedged renderer. The cause is often a feedback loop of async work plus
  re-renders, not a single infinite function.
- **Rule: attach first, reproduce second.** With Steam healthy:
  1. Connect to `SharedJSContext`, send `Debugger.enable`, and keep the socket open.
  2. Trigger the repro from that same socket (e.g. `Navigator.AppProperties(appid)`
     in a `setTimeout`, so the evaluate call returns first).
  3. Send `Debugger.pause` several times, 0.5 s apart, and print each `callFrames`
     stack with script URLs (from `Debugger.scriptParsed`). V8 answers because the
     inspector session is already enabled. Samples from **different** places
     (React commit, MobX, our plugin) mean a feedback loop; the same frames every
     time mean one hot loop.
  4. Measure the loop's rate without the debugger: count plugin log lines per
     second over a fixed window (e.g. 1,521 "Enriched native Game Info" lines in
     10 s gave the 2026-09-28 loop away).
  5. Restart Steam (`start-steam-dev.ps1 -Restart`). A hung renderer never recovers.
- **Tools:** `steam-cartridges/tests/live/` (`catch_hang.mjs` does steps 1–3,
  `count_cycle.mjs` step 4, `test_props.mjs` gives a one-line OK/HUNG verdict).
  Each hung repro costs a Steam restart (~1 min), so form a hypothesis from the
  first stack sample before running another.

### Trap 11: A DOM probe passes on a banner nobody can see (first toast in Big Picture)

- **Symptom:** the live check says the themed banner rendered, the user sees no banner. Only
  the **first** toast after Big Picture opens is affected; the second and later ones show.
- **Reality:** Big Picture's toast window is created hidden, and its **document timeline stays at 0
  until the window first paints**. CSS animations created while it reads 0 get `startTime = 0`; on
  the first frame the timeline jumps to the window's age (~14 s), so the entrance **and** the delayed
  exit are already `finished` and the element sits at the exit's end state (`opacity: 0`). The
  window itself paints fine (`requestAnimationFrame` runs at 60 fps, `visibilityState: visible`), and
  `getBoundingClientRect` reports a normal box, so presence checks all pass.
- **Rule:** check what the eye sees, not that the element exists: sample `getComputedStyle(el).opacity`
  and the transform over the toast's life and require the **maximum** to reach ~1. To find this kind of
  bug read `document.getAnimations()` (`playState`, `startTime`, `currentTime`) next to
  `document.timeline.currentTime` and `performance.now()`; `startTime: 0` with `timeline ≫ 0` is the
  signature. Reproduce with a **fresh** Big Picture session (exit and re-enter), since only the first
  toast fails. `enhanced-notifications/tests/achievements-bigpicture.mjs` asserts the maximum opacity for this reason.
  Fix pattern: restart animations that started on the frozen clock after two real frames
  (`restartFrozenAnimations` in `banner/themed-toast.tsx`).

### Trap 12: "Steam's UI is not loading" is often not a plugin

- **Symptom:** the Steam window opens blank or does not come up from the tray; it looks like the
  last deploy broke Steam's start.
- **Reality (2026-10-01):** Steam had started at 04:26 offline, the PC slept, and at 09:25 it
  resumed (`SuspendResume: Received resume request` in `webhelper_js.txt`). The window was shown and
  hidden several times from 09:43 with nothing else logged: it never painted. Steam was also running
  **without** `-cef-enable-debugging`, so there was no CDP to look with. A clean restart brought the
  UI back with the same deployed plugins, and Routine 3 passed. Everything here runs in an RDP
  session, and CEF's GPU process falls back to `--use-gl=disabled` about 2 minutes after **every**
  start on this machine (`webhelper.txt`), so that fallback alone is not a cause.
- **Rule:** run `node steam-health.mjs` (§ 8) **before** suspecting code. It reads the logs even
  without CDP and names the cause it can see (resume from sleep, no CDP, a hung SharedJSContext, a
  plugin that did not load, an error budget). If it reports a resume or a window that does not paint,
  restart with `start-steam-dev.ps1 -Restart` and run it again; only a FAIL that survives a clean
  restart points at the code. Check `git log` too: the suspected change may not even be deployed.

### Trap 13: A Big Picture toast flickers or jumps, but every DOM read looks right

- **Symptom:** in Big Picture a themed toast flickers, slides in twice, or shows at one place and then Steam's,
  while a one-off read of the placeholder and the toast view finds the theme's place and look.
- **Reality (2026-10-01):** three clocks are involved and a single read sees none of them. Steam moves the toast
  view only when its placeholder component re-renders (`SetBounds`), not when CSS moves the placeholder; the view
  reports its new place about 25 ms after `SetBounds`; and the store's current-toast value changes when a toast
  **arrives**, not when it shows, so anything keyed on it restyles the toast already on screen when the next one
  is queued ([steam-components.md § Big Picture toast view](steam-components.md#big-picture-toast-view-how-steam-places-and-shows-it)).
- **Rule:** trace over time, with Big Picture **in front** (a hidden window paints nothing and its animations
  never start), holding the Steam lock (Routine 0):
  `node enhanced-notifications/tests/probes/bp-toast-trace.mjs --theme top_left:ps5 --pattern queue`. It logs every
  `SetBounds` / `SetVisible`, the placeholder rect, our placement `<style>`, the toast template and its animation,
  merged with the plugin's own trace (`debugBigPicture()` / `bigPictureTrace()`). Patterns: `one`, `burst`, `queue`,
  `mixed` (a Warning-size toast), `first`, `fresh`, `theme-switch`; `--source` switches where the plugin takes the
  Big Picture toast type from, to compare alternatives without a rebuild.

---

## 5. Automated CDP Inspection via PowerShell / Node.js

You can inspect the client programmatically without opening Chrome. Plugins keep
a reusable helper in `tests/cdp.mjs` (`enhanced-notifications`); prefer it over a new one-off.

### Quick HTTP Target Query

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/json" | Format-Table id, title, type, url
```

### Evaluating JavaScript in a Target (Node.js one-liner)

```bash
node -e "
const WebSocket = require('ws');
(async () => {
  const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
  const target = targets.find(t => t.title === 'SharedJSContext');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'Object.keys(window).filter(k => k.includes(\"Store\"))', returnByValue: true }
    }));
  });
  ws.on('message', data => {
    console.log(JSON.parse(data).result.result.value);
    process.exit(0);
  });
})();
"
```

---

## 6. Picking Up a Code Change

Always redeploy with a graceful restart (`dev.ps1`) — for frontend changes too.
**Never reload SharedJSContext** (`Ctrl+R`, `location.reload()`, `Page.reload`):
it can open a blocking "Save as" dialog and tears down the render window. Details
and the full workflow: [plugins.md § 4 Develop](plugins.md#4-develop).

---

## 7. Cost-Efficient Debugging

> **Poisoned MobX computed:** read `obj[Symbol(mobx administration)].values_.get(name)` and check `value_.cause`, `observing_`, `dependenciesState_`. A keepAlive computed that threw with `observing_ = []` is cached forever; only a Steam restart recovers.

Screenshots and full DOM/console dumps burn a lot of tokens. Answer the question
with the cheapest method that actually answers it, in this order:

1. **Targeted `Runtime.evaluate`, `returnByValue: true`.** Ask for the smallest
   value that settles the question: a selector's existence (`!!document.querySelector(...)`),
   a `data-*` attribute, 1–3 `getComputedStyle` properties, an element count, or a
   single store field (see § 5 for the WebSocket one-liner pattern). Trim or
   `.slice()` any string before returning it.
2. **Reuse existing scripts before writing new ones.** `steam-cartridges/tests/live/test_nav_cycle.js`
   and `steam-cartridges/tests/live/check_all_tabs.js` (Routine 3 in [AGENTS.md](../AGENTS.md)), plus
   plugin `tests/`, e.g. `enhanced-notifications/tests/previews.mjs`,
   `enhanced-notifications/tests/achievements-smoke.mjs`. Run them and report only PASS/FAIL,
   not their raw output.
3. **Structural checks over pixels.** `getBoundingClientRect()` for sizes/position,
   a short `textContent` snippet, a `classList.contains(...)` check — these answer
   layout and state questions without a screenshot.
4. **Filtered reads over full dumps.** Grep or `.slice()` console output client-side
   in the `Runtime.evaluate` expression itself (e.g. filter `console` messages or a
   store's keys before returning them) rather than pulling the whole object or log
   across the wire.
5. **Screenshots last, and only for genuinely visual questions** (does the theme
   actually look right; did React actually re-render — a DOM probe can pass while
   the screen is stale). Even then, use CDP `Page.captureScreenshot` with a `clip`
   region, `format: 'jpeg'`, and a low `quality`, save it to a file, and only view
   it if the structural checks above couldn't settle the question. Never capture
   full-window PNGs, and never loop screenshots.

**Reuse the target.** Resolve the right CDP target (`SharedJSContext` vs. the
Big Picture GamepadUI target, per § 2) once per session and keep using it, instead
of re-querying `/json` per probe.

Anti-patterns:

- Dumping `document.body.outerHTML` — always query a specific element.
- Uncapped probe output — cap string/array length in the expression before it
  returns, not after.
- Re-deriving a fact already on this page (target topology, Big Picture traps in
  § 4) by re-probing instead of reading it.
- Screenshotting to check something `getComputedStyle` or a class check already
  answers.
- Writing a new one-off script when a `scratch/` or plugin `tests/` script already
  covers the same check.

---

## 8. Boot Health Check (`steam-health.mjs`)

One command for "is Steam up, and did our plugins load?", at the workspace root:

```powershell
node steam-health.mjs              # now
node steam-health.mjs --wait 120   # right after a restart: poll until healthy or 120 s
```

| Line | Meaning |
| ---- | ------- |
| `FAIL` (exit 1) | `steam.exe` not running; running without CDP; SharedJSContext does not answer in 5 s (Trap 10); an enabled plugin (`config.json` `enabledPlugins`) missing from `PLUGIN_LIST`; the desktop / Big Picture window empty, or visible but not painting; a surface that `exceeded its error budget` since this start |
| `WARN` | plugin `ERROR` lines and Millennium `ErrorBoundaryHook` catches since this start (Steam's own `Uncaught (in promise) Error: Assertion failed` is old noise: 200+ lines since 2026-09-30) |
| `INFO` | resume from sleep, the GPU software fallback, the start time and the last JS log line |

"Since this start" means after the last `Client version:` line of `webhelper_js.txt`.
It runs on its own after `start-steam-dev.ps1` (skip with `-NoHealthCheck`), at the end of every
plugin's `dev.ps1` (the deploy fails if it fails), and as the first step of each plugin's
`npm run test:live`. In a plugin's public repo the script is absent and those steps are skipped.
