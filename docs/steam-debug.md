# Steam Debugging & Inspection Guide

A practical guide to inspecting, debugging, and probing the live Steam client via
the Chrome DevTools Protocol (CDP).

---

## 1. Quick Start

Steam provides a built-in Chromium Embedded Framework (CEF) debugging server,
exposing a standard Chrome DevTools Protocol endpoint on `http://localhost:8080`.

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

When querying `http://localhost:8080/json`, Steam lists multiple active targets.
Knowing which target to inspect is crucial:

| Target Title                 | URL / Pattern                    | Role                       | What lives here                                                                                                                                                                        |
| ---------------------------- | -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SharedJSContext`**        | `https://steamloopback.host/...` | **Primary Runtime Engine** | **All stores** (`appSpotlightStore`, `appActivityStore`, `StoreItemCache`, `workshopStore`, `collectionStore`), Millennium plugin instances, webpack module caches, and React Portals. |
| **`Steam`**                  | `...createflags=274...`          | **Main Desktop Window**    | Desktop client UI frame, `#root` container, and visible DOM.                                                                                                                           |
| **`Steam Root Menu`**        | `...createflags=...`             | Context / popup menus      | Small auxiliary window. **Do not confuse with the main client window.**                                                                                                                |
| **`Steam Big Picture Mode`** | `about:blank` (`#popup_target`)  | **Gamepad UI Window**      | Display container for Big Picture. Mounted from `SharedJSContext` via React Portal.                                                                                                    |

---

## 3. Desktop Mode Inspection

### Webpack Module Probe

Steam does not expose a global `require()`. In any window running Steam UI
(`SharedJSContext` or the Desktop Client), grab webpack's internal require function
via a probe chunk:

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

// req.m  -> Map of all module factory functions (inspectable via .toString())
// req(id) -> Evaluated module exports
```

### Locating Modules by Signature (Never by Numeric ID)

Numeric module IDs reshuffle across Steam builds. Always resolve by prototype
methods or class keys:

```javascript
function findModuleByMethod(methodName) {
    for (const id in req.m) {
        try {
            const exp = req(id);
            for (const key of ["", "default", ...Object.keys(exp || {})]) {
                const target = key ? exp[key] : exp;
                if (
                    target &&
                    target.prototype &&
                    typeof target.prototype[methodName] === "function"
                ) {
                    return { id, target };
                }
            }
        } catch (_) {}
    }
}

// Example: find CAppSpotlightStore
const spotlightMod = findModuleByMethod("GetPostGameSummary");
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

---

## 5. Automated CDP Inspection via PowerShell / Node.js

You can inspect the client programmatically without opening Chrome:

### Quick HTTP Target Query

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/json" | Format-Table id, title, type, url
```

### Evaluating JavaScript in a Target (Node.js one-liner)

```bash
node -e "
const WebSocket = require('ws');
(async () => {
  const targets = await (await fetch('http://localhost:8080/json')).json();
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

## 6. Development Workflow (Reload vs. Restart)

| Change Type                   | What changed                   | Action Required                                                                                                                     |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend TypeScript / CSS** | `frontend/*.ts`, `*.tsx`       | Build with `pnpm build:dev`, then press **`Ctrl+R`** in CEF DevTools or switch library pages in Steam. **No Steam restart needed.** |
| **Backend Lua**               | `backend/*.lua`, `plugin.json` | Requires restarting Steam: `.\start-steam-dev.ps1 -Restart` or `pnpm dev`.                                                          |
| **Section Registry Patches**  | `sections.ts`                  | Navigating away from and back to the app page re-evaluates `GetSections()`.                                                         |

---

## 7. Cost-Efficient Debugging

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
   actually look right). Even then, use CDP `Page.captureScreenshot` with a `clip`
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
