# Fix plan: `enhanced-notifications` never reaches Big Picture's toast window

Status: **implemented and verified live 2026-09-24** (Steam build of that date, desktop and
Big Picture, `enhanced-notifications-dev` + `enhanced-achievements-dev` loaded).
`node tests/categories.mjs` PASSes downloads/recording/system/achievement on both modes
(friends/messages SKIP, gated on Steam's Friends notification settings), including across
a Big Picture exit/re-entry cycle. See [CHANGELOG.md](../../CHANGELOG.md) and
[TASK.md](../../TASK.md) for the summary.

Supersedes the diagnosis in [TASK.md](../../TASK.md) ("toast window invisible to both
popup-tracking APIs") and the matching CHANGELOG entry. Those are **half wrong**, see (a).

---

## (a) Root cause

### 1. The TASK diagnosis mixed up the two UI modes

The earlier live check that "proved" the hooks never fire was run **in Big Picture**, not
on desktop. The CDP target it cites, `notificationtoasts_uid32`, is Big Picture's toast window
(`url: about:blank?browserviewpopup=1&requestid=5&parentpopup=32&createflags=512`, where
`32` is the Big Picture window's browser id). Desktop toast windows are named
`notificationtoasts_<notificationID>_desktop`.

**Desktop works today.** `tests/categories.mjs` on desktop, unchanged code:

```
SKIP  friends: Steam showed no toast (Friends notification settings)
SKIP  messages: Steam showed no toast (Friends notification settings)
PASS  downloads: restyled in place  ({"type":"DownloadComplete",...,"background":"linear-gradient(135deg, rgb(14, 20, 27), rgb(27, 40, 56))",...})
PASS  recording: restyled in place  ({"type":"GameRecordingInstantClip",...})
PASS  system: restyled in place  ({"type":"CloudSyncFailure",...})
PASS  achievement: left to Enhanced Achievements  ({"type":null,"ea":true,...})
```

**Big Picture fails for every category** (same code, after `SteamClient.UI.SetUIMode(4)`):

```
FAIL  downloads: restyled in place  ({"type":null,...,"background":"none",...,"text":"Download Complete\nDivinity: Original Sin 2"})
FAIL  recording / system / friends / messages / achievement  (same: type null, no theme)
```

### 2. Steam creates the two toast windows in two different ways

Steam's toast container module (`48197` this build; locate it by the string
`notificationtoasts` in webpack sources) has one component per mode:

| Mode | Component | How the window is made | Seen by `g_PopupManager`? |
| --- | --- | --- | --- |
| Desktop (and in-game overlay) | `Z` | `useSteamPopup`-style hook (`L.OJ`, module `63439`) named `` `notificationtoasts_${id}_desktop` `` (or `` `notificationtoasts_uid${appid}-${id}` `` for an overlay), one popup **per notification** | **Yes.** Registered through the popup manager, so `Millennium.AddWindowCreateHook` fires. |
| Big Picture | `pe` | `c.Jo({ name: "notificationtoasts", eCreationFlags: NotFocusable })` (module `73375`): **one persistent BrowserView popup**, created when the Big Picture window mounts, and reused for every toast (`GetBrowserView().SetVisible(bool)`), with the toast portaled into `GetRenderElement()` | **No.** |
| Gamescope / Steam Deck (underlay supported, not overlay) | `me` | No window: toast is rendered **embedded** in the main window (`ToastContainerEmbedded`) | n/a (out of scope on Windows) |

The Big Picture path, verbatim from module `73375` (class `c`, not exported; `Jo` is the hook
that owns an instance of it in React state):

```js
CreateView(e,t,r){ ...
  let o=r?.ownerWindow?.SteamClient.Browser.GetBrowserID(), d="BrowserViewPopup";
  i?.length>0&&(d=i), o&&(d+="_uid"+o), d=c.GetUniqueBrowserViewName(d);
  let {strCreateURL:m,browserView:p}=SteamClient.BrowserView.CreatePopup({parentPopupBrowserID:o,strVROverlayKey:n,strName:d});
  s&&(m+="&createflags="+s);
  let A=window.open(m,d,"top=0,left=0,width=540,height=700,...");
  A.document.write('...<div id="browserview_target"></div>...'); ...
  this.m_viewWindow=A, this.m_rootElement=g, this.m_browserView=p, ...
}
GetBrowserView(){return this.m_browserView}
GetRenderElement(){return this.m_rootElement}
GetViewWindow(){return this.m_viewWindow}
```

It calls `window.open` directly and never registers with the popup manager (module `11131`,
`g_PopupManager`). `Millennium.AddWindowCreateHook` is just a wrapper around that manager:

```
> String(Millennium.AddWindowCreateHook)
"e=>{Array.from(g_PopupManager.GetPopups()).forEach(e),g_PopupManager.AddPopupCreatedCallback(e)}"
```

So in Big Picture **both** `onPopup` (create hook) and `scanPopups` (`GetPopups()`) are blind to
the toast window. `scanPopups`'s doc comment ("Big Picture's toast popup is created ... before it
has a `window`") is wrong: that popup is never in `GetPopups()` at all.

`window.__TOASTER_INSTANCE` (lead 1 in the brief) is **not Steam's**. It is Millennium's own
toaster: a logger (`log/debug/warn/error`) plus `toastPatch`, a patch on the toast dispatcher's
`component` property that renders Millennium's own notifications. It holds no window reference.
(Side note for [enhanced-notifications-plan.md § 3](enhanced-notifications-plan.md): this
Millennium patch on the dispatcher could explain why wrapping the dispatcher via `jsx` "committed
a different element". Not investigated further.)

### 3. The window *is* reachable from SharedJSContext

The Big Picture toast window was opened by SharedJSContext's `window.open`, so it is a
same-origin popup with full script access. The only missing piece is a reference to it.
The persistent `BrowserViewPopup` instance lives in `pe`'s `useState`. `pe` also renders
a placeholder `<div class="GamepadToastPlaceholder">` into the Big Picture main window, which
**is** in `g_PopupManager` (`SP BPM_uid0`). From that div's React fiber, two `.return` steps reach
`pe`, whose hook 0 holds the instance.

### Evidence (exact CDP expressions, run in `SharedJSContext` unless noted)

Helper scripts (throwaway, in `scratch/`): `en_eval.mjs "<expr>" [target]`,
`en_src.mjs <moduleId> [needle] [before] [after]`, `en_bp_probe.mjs`.

1. **Big Picture: the toast window is not in the popup manager.**
   `[...g_PopupManager.GetPopups()].map(p=>p.m_strName)` → `["SP BPM_uid0","contextmenu_14_uid0"]`,
   while `/json` lists `notificationtoasts_uid32`. Still the same after
   `PLUGIN_LIST['enhanced-notifications-dev'].previewCategory('downloads')`. In the toast target:
   `document.body.getAttribute('data-en-type')` → `null`, `#enhanced-notifications-theme` → absent.
2. **It is a same-origin child of SharedJSContext.** In target `notificationtoasts_uid32`:
   `window.opener.document.title` → `"SharedJSContext"`, `document.getElementById('browserview_target')` → present.
3. **Both hooks, both modes, one run.** Installed
   `Millennium.AddWindowCreateHook(p => __probe.hook.push(p?.m_strName))`,
   `g_PopupManager.AddPopupCreatedCallback(p => __probe.pm.push(p?.m_strName))` and a logging
   `window.open` wrapper, then `SteamClient.UI.ExitBigPictureMode()`, previewed `downloads`,
   then `SteamClient.UI.SetUIMode(4)` (back to Big Picture). Result (context menus filtered):
   ```
   hook: ["SP Desktop_uid0","notificationtoasts_10025_desktop", ...10028..10031_desktop, "SP BPM_uid0"]
   pm:   ["notificationtoasts_10025_desktop", ...10028..10031_desktop, "SP BPM_uid0"]
   open: [{"n":"notificationtoasts_10025_desktop","u":"about:blank?createflags=22311690&browserType=4"}]
   ```
   Every desktop toast window fired both hooks. Re-entering Big Picture created the new toast
   window `notificationtoasts_uid56` (listed in `/json`), and neither hook fired for it.
4. **Desktop styling works.** In target `notificationtoasts_10025_desktop`: `data-en-type` =
   `"DownloadComplete"`, `#enhanced-notifications-theme` length `94833`, popup background
   `linear-gradient(135deg, rgb(14, 20, 27), rgb(27, 40, 56))`.
5. **The fiber route finds the Big Picture window** (`scratch/en_bp_probe.mjs`):
   ```js
   for (const p of g_PopupManager.GetPopups())
     for (const el of p.window.document.querySelectorAll('[class*=GamepadToastPlaceholder]')) {
       let f = el[Object.keys(el).find(k => k.startsWith('__reactFiber$'))];
       for (let d = 0; f && d < 4; d++, f = f.return)
         for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++)
           if (typeof h.memoizedState?.GetViewWindow === 'function') /* found */;
     }
   ```
   → `[{"popup":"SP BPM_uid0","depth":2,"hook":0,"name":"notificationtoasts_uid56","closed":false,"same":true}]`
   (`same` = `win.opener === window`). Also found the window again after a Big Picture exit and re-entry.
6. **Styling works once the window is reached.** From SharedJSContext, appended a `<style>` with
   `PLUGIN_LIST['enhanced-notifications-dev'].cssFor('DownloadComplete')` to that window's head,
   set `body[data-en-type=DownloadComplete]`, previewed `downloads`. In the toast target:
   `GamepadToastPopup` background → `linear-gradient(135deg, rgb(14, 20, 27), rgb(27, 40, 56))`,
   text kept (`"Download Complete\nDivinity: Original Sin 2"`). Probe style/attribute removed afterwards.

### Leads ruled out

| Lead | Result |
| --- | --- |
| `window.__TOASTER_INSTANCE` | Millennium's toaster/logger, not Steam's. No window. |
| A second popup manager / other map | None. `SteamUIStore.WindowStore` tracks main/overlay windows only. `NavigationManager` input sources hold no window refs. `c.m_setActiveBrowserViewNames` holds names only. |
| Wrap SharedJSContext `window.open` | Catches **new** Big Picture toast windows, but not one created before the plugin loaded (Steam started in Big Picture). It is also a global patch on every popup Steam opens. Keep it only as a fallback if the fiber route ever breaks. |
| `window.open('', 'notificationtoasts_uid<n>')` to look up by name | If the name is wrong or stale, it **creates** a stray Steam popup. Rejected. |
| Patch the `BrowserViewPopup` class | Not exported. Patching its prototype through a found instance would touch every BrowserView popup (QuickAccess, MainMenu, ...). Rejected. |
| Polling | Not needed. The existing per-toast scan (driven by `onToastShown` / `CurrentToastSubscribableValue`) is the right cadence. It just has to look in the right place. No new timer. |

---

## (b) Fix plan (file by file)

Design: keep the desktop path (`AddWindowCreateHook`, which works) unchanged. Replace the
useless `GetPopups()` scan with a **per-toast scan that follows Big Picture's placeholder to
its BrowserView popup**. It runs at the cadence the scan already has, once per toast shown,
with no new timers and no global patches.

### 1. `enhanced-notifications/frontend/steam/selectors.ts`

- Resolve `GamepadToastPlaceholder` in the **same single startup scan** (guardrail 3). It lives
  in the same CSS module as `GamepadToastPopup` (module `26711` this build, value
  `"_3sjShm2vhP7aWXeim3vaHq GamepadToastPlaceholder"`).
- Keep it **out of** `PARTS`/`ToastSelectors`, which feed theme CSS. Return it separately, e.g.
  change the return type to `{ theme: ToastSelectors; placeholder?: string }` or add
  `export function toastPlaceholderSelector(): string | undefined` filled by the same pass.
  Build it the same way (`:is(.hash1, .hash2)` from every module that has the key, never a
  hardcoded hash).
- Log if unresolved: "Big Picture toast window unreachable; Big Picture toasts stay stock."

### 2. `enhanced-notifications/frontend/index.tsx`

- Pass the placeholder selector through: `const sel = resolveToastSelectors(); setSelectors(sel.theme); ... initInjector(sel.placeholder);`

### 3. `enhanced-notifications/frontend/style/injector.ts`

1. Factor a `track(win: Window)` out of `onPopup`: add to `toastWindows` + `applyStyle` if new,
   then `applyType`. `onPopup` keeps its `m_strName` regex check and calls `track(popup.window)`.
2. Replace `scanPopups()` with `scanBigPictureToastWindows()`:
   ```ts
   interface BrowserViewPopup { GetViewWindow(): Window | undefined; GetRenderElement(): Element | undefined }

   /** Big Picture's toast window is a BrowserView popup Steam opens with window.open and never
    *  registers with g_PopupManager (docs/plans/enhanced-notifications-toast-window-bugfix.md).
    *  Its owner renders a GamepadToastPlaceholder div into the Big Picture window. From that div's
    *  fiber, a few `.return` steps up, a hook holds the popup object. Runs once per toast shown. */
   function scanBigPictureToastWindows(): void {
       if (!placeholderSelector) return;
       const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<Popup> } | undefined;
       try {
           for (const popup of manager?.GetPopups?.() ?? []) {
               const doc = popup.window?.document;
               if (!doc) continue;
               for (const el of doc.querySelectorAll(placeholderSelector)) {
                   const win = viewWindowFromFiber(el);
                   if (win && !win.closed && /^notificationtoasts/i.test(win.name)) track(win);
               }
           }
       } catch (error) {
           logger.warn('Could not scan for Big Picture toast windows:', error);
       }
   }

   function viewWindowFromFiber(el: Element): Window | null {
       const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
       let fiber = key ? (el as any)[key] : null;
       for (let depth = 0; fiber && depth < 4; depth++, fiber = fiber.return) {       // verified depth: 2
           for (let hook = fiber.memoizedState, i = 0; hook && i < 16; hook = hook.next, i++) {  // verified hook: 0
               const v = hook.memoizedState as Partial<BrowserViewPopup> | null;
               if (v && typeof v.GetViewWindow === 'function' && typeof v.GetRenderElement === 'function') return v.GetViewWindow() ?? null;
           }
       }
       return null;
   }
   ```
   - Type fiber access narrowly (a small `Fiber` interface) instead of `any`, to satisfy `tsc`.
   - Bounded walk (≤ 4 fibers × ≤ 16 hooks); duck-typed on Steam's method names, not
     minified identifiers; name-checked, so nothing but a `notificationtoasts*` window is
     ever touched.
   - Note: `forEachToastWindow` already drops `closed` windows. The old window from before a
     Big Picture exit/re-entry is pruned if CEF reports it closed (verify, see (c) step 5).
3. Call `scanBigPictureToastWindows()` where `scanPopups()` was called (`onCurrentToast`,
   before `forEachToastWindow(applyType)`). Also call it once at the end of `initInjector()`
   (and in `refresh()`), so the style is already in the window before the first Big Picture toast.
4. `initInjector(placeholder?: string)` stores the selector in a module-level `placeholderSelector`.
5. Rewrite the file's doc comment and the removed `scanPopups` comment: desktop and overlay
   popups come from `AddWindowCreateHook`, and Big Picture's single persistent BrowserView popup
   comes from the placeholder-fiber scan. Remove the incorrect "created before it has a `window`" claim.

### 4. `enhanced-notifications/tests/categories.mjs`

The Big Picture toast window is **persistent**, so `toastWindow()` (wait until a
`notificationtoasts*` target exists) returns it even when Steam showed no toast. In the
baseline Big Picture run, friends/messages FAILed with `text:""` where they should SKIP.
- In `toastWindow()`, once the target is found, connect and wait (≤ 6 s) until the toast has
  content: `document.body.innerText.trim() !== ''` (the empty popup div exists with no children
  when idle). Treat "window exists but no content" the same as "no window" (SKIP for
  friends/messages, FAIL otherwise).
- Print the UI mode in the header (`SteamClient.UI.GetUIMode()`), so a log shows which mode was
  tested. That mix-up is how this bug was misdiagnosed.

### 5. Docs (end of session, Routine 5)

- `docs/steam-components.md`, "Toast windows" row (§ 11B table): add *how* each is created. Desktop/overlay:
  per-toast popup via the popup manager (`AddWindowCreateHook` sees it). Big Picture: one
  persistent `SteamClient.BrowserView.CreatePopup` + `window.open` popup, **not** in
  `g_PopupManager`, reachable via the `GamepadToastPlaceholder` fiber → hook `GetViewWindow()`.
  Gamescope: embedded, no window.
- `docs/knowledgebase.md` § Critical Traps: "BrowserView popups (`?browserviewpopup=1`,
  QuickAccess, MainMenu, notificationtoasts in Big Picture) are invisible to `g_PopupManager` /
  `Millennium.AddWindowCreateHook`." Also: "Check the UI mode before trusting a live toast test.
  `_uid<n>` = Big Picture, `_desktop` = desktop."
- `TASK.md`: correct the status row (desktop works; **Big Picture** broken → fixed), replace the
  section with the fix outcome, drop "needs discovery".
- `CHANGELOG.md`: add an entry that corrects the earlier one (it said "desktop"; it was Big Picture).
- `docs/plans/enhanced-notifications-plan.md` § 3 step 2: describe the two window sources.

### Constraints

- No new timers/polls, no `window.open` or prototype patch, no hardcoded hashes or minified names.
- Per-toast cost: one `querySelectorAll` per popup document plus a bounded fiber walk. Toasts are
  rare, so this is nowhere near a hot path (guardrail 2 concerns prototype hooks, which are untouched).
- Every failure path logs and leaves the toast stock (current fallback contract).

---

## (c) Verification

1. `cd enhanced-notifications && npm run check && npm test && npm run build`
2. `powershell -ExecutionPolicy Bypass -File dev.ps1` (deploys `enhanced-notifications-dev`, restarts Steam).
3. **Desktop:** `node tests/categories.mjs`. Expect downloads/recording/system PASS,
   achievement "left to Enhanced Achievements" PASS, friends/messages PASS or SKIP (a regression check: this passes today).
4. **Big Picture:** in SharedJSContext `SteamClient.UI.SetUIMode(4)` (or
   `.\start-steam-dev.ps1 -BigPicture`), wait ~8 s, then `node tests/categories.mjs`. Expect the same
   results. Check in target `notificationtoasts_uid<n>` that `#enhanced-notifications-theme` exists
   **before** the first toast (from the init scan).
5. **Recreation:** `SteamClient.UI.ExitBigPictureMode()`, then `SetUIMode(4)` again (new window
   `notificationtoasts_uid<m>`), then run `categories.mjs` again. Must still PASS. Then check the old
   window was pruned: expose a debug count or check `toastWindows` has no `closed` entries via a
   temporary log.
6. **Started in Big Picture:** `.\start-steam-dev.ps1 -Restart -BigPicture`, then run `categories.mjs`.
   This covers the window being created before the plugin loaded.
7. **Achievement in Big Picture:** in the baseline Big Picture run, the achievement case read
   `ea:false` with Steam's stock text, but a manual preview a moment later showed `.ea-banner`
   rendered. This is probably test timing: the check ran 1.2 s after the preview, on the
   persistent window. It should go away with the step-4 content wait in (b)4. If it doesn't,
   open a separate `enhanced-achievements` issue.
8. Core regression (Routines 1–3): `node scratch/test_nav_cycle.js`, `node scratch/check_all_tabs.js`.
9. Not covered here (leave in TASK): in-game overlay toasts (desktop overlay popups are
   `notificationtoasts_uid<appid>-<id>` via the popup manager, so they should be caught by the create
   hook; the Big Picture overlay uses `pe` inside the overlay window, so the scan should reach it
   only if that overlay window is in `g_PopupManager`). Gamescope's embedded mode is also not covered.
