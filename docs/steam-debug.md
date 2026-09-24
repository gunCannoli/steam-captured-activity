# Steam Debugging & Inspection Guide

**This doc's job:** how to inspect, probe and debug the live Steam client over
the Chrome DevTools Protocol (CDP) — attaching, picking the right target,
finding Steam's code, the Big Picture traps, and doing all of it cheaply.

Not here: what you will find ([steam-architecture.md](steam-architecture.md) →
[steam-components.md](steam-components.md)); build/deploy/restart and the
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
[steam-architecture.md](steam-architecture.md).

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

---

## 5. Automated CDP Inspection via PowerShell / Node.js

You can inspect the client programmatically without opening Chrome. Plugins keep
a reusable helper in `tests/cdp.mjs` (`enhanced-achievements`,
`enhanced-notifications`); prefer it over a new one-off.

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
2. **Reuse existing scripts before writing new ones.** `scratch/test_nav_cycle.js`
   and `scratch/check_all_tabs.js` (Routine 3 in [AGENTS.md](../AGENTS.md)), plus
   plugin `tests/`, e.g. `enhanced-notifications/tests/categories.mjs`,
   `enhanced-achievements/tests/smoke.mjs`. Run them and report only PASS/FAIL,
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
