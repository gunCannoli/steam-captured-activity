# Plan: Big Picture toast flicker (enhanced-notifications, with enhanced-achievements)

**Status:** ready to execute; dry-run done 2026-10-01 (§ 12). **Base:** `e74dee9` (the investigation commit: debug trace,
probe, Steam facts in the docs). **Decision:** none needed for phases 1 to 3 (a bug fix inside ADR-0047's
architecture); § 13 asks the user one question for a later phase.
**Implementer:** apply three patches, run the checks after each, commit. No code is written by hand. Delete this plan
and its patch folder once § 11 passes.

## 1. What the user wants

Big Picture support in both toast plugins, without the flicker seen after the Big Picture position and animation
work (2026-10-01): "flickering, and sometimes the position starts in one place and returns to the default place".
A deep investigation first, with debug pointers so alternatives can be tested easily (done in `e74dee9`), then a
fix that fits both plugins' architecture and adds tests to each so it cannot come back.

## 2. Findings (root cause and evidence)

All verified live on 2026-10-01 against the running client (Steam build of Sep 5 2026), with Big Picture in front,
using `enhanced-notifications/tests/probes/bp-toast-trace.mjs` and the plugin's own trace (`debugBigPicture()`).
Steam's side is recorded in [steam-components.md § Big Picture toast view](../steam-components.md#big-picture-toast-view-how-steam-places-and-shows-it)
and the method in [steam-debug.md Trap 13](../steam-debug.md); not repeated here.

### 2.1 Root cause: the Big Picture toast type follows the toast that ARRIVED, not the one on screen

`enhanced-notifications/frontend/surfaces/style/injector.ts` (at `e74dee9`) sets `body[data-en-type]` on Big Picture's
one toast window from `NotificationStore.CurrentToastSubscribableValue`. That value changes when a toast arrives,
also while another toast is still on screen: Big Picture shows one at a time and queues the rest (its container pops
the next one with `PopNextToastNotification` only when the current one is gone). So a queued toast restyles the one
showing. Trace (`--pattern queue --source arrival`, times in ms from the first toast):

```
   2  plugin:arrival eType 1 (download)            -> attr DownloadComplete, toast shows at (30,20) with en-in-ps5-left
2013  plugin:arrival eType 5 (achievement, QUEUED) -> attr DownloadComplete -> null   (download still on screen)
2017  download template animation: en-in-ps5-left -> Steam's toastEnter/toastExit       <- the flicker
17039 plugin:arrival eType 1 (download, QUEUED)    -> attr null -> DownloadComplete   (achievement banner on screen)
17043 enhanced-achievements' banner: ea-in-ps5-right -> en-in-ps5-left, opacity 0 -> 1 again   <- the flicker
```

What the user sees:

- **A themed toast with an achievement queued behind it:** the attribute goes, the toast loses the theme for the rest
  of its time, and Steam's own `toastEnter` (`translateX(300px)` → `0`) restarts: the toast jumps 300 px sideways,
  out of its 320 px frame, and slides back in. That is the "starts in one place and returns" (it is the content
  moving inside the frame; the frame itself never moved in any trace).
- **An achievement banner (drawn by enhanced-achievements) with a toast queued behind it:** our type and animation are
  put on the banner mid-display; it fades in again from 0 with this plugin's direction.
- The same applies to any pair of types where one is styled and the other is not.

### 2.2 Placement: Steam re-measures only when its component re-renders

Steam's placeholder sends `SetBounds` from a dependency-less `useLayoutEffect`, i.e. only when it re-renders, not when
CSS moves the div. The placement `<style>` is applied in the same handler as the type. Today that works only because
our current-toast subscriber happens to run before React renders the container (trace `--pattern fresh`: style
re-added at 313 ms, Steam's `SetBounds(30, 20)` at 317 ms). Taking the type at the pop moves the style write inside
Steam's own state update, before the render, so the order is guaranteed instead of lucky. A theme change while a toast
shows moves the placeholder but not the view (trace `--pattern theme-switch`); the next toast is placed right. That
is accepted (it only happens while editing themes).

### 2.3 Alternatives compared live (same queue pattern, Big Picture in front)

| Type source | Achievement queued behind a download | Download queued behind a banner | First frame of the next toast |
| --- | --- | --- | --- |
| `arrival` (today) | **restyled mid-display** | **banner restyled** | right only by chance |
| `shown` (`onShown`, Steam's effect after commit) | unchanged | unchanged | type lands 1 ms after `SetVisible(true)`: can miss the first frame |
| `pop` (`PopNextToastNotification`) | unchanged | unchanged | type and placement set **before** `SetBounds`, so before the render |

### 2.4 Ruled out

- **Our placement `<style>` being removed by Steam.** The popup manager's head sync (`lc` in module `54644`) only adds
  and removes `<link rel=stylesheet>`; a `<style>` is never touched.
- **The frame moving mid-toast.** Every `SetBounds` in every trace (one, burst, queue, mixed, fresh, theme-switch) was
  the theme's place, except after a deliberate theme switch.
- **The error budget or a tripped feature.** `safetyDiagnostics()` showed no errors, nothing tripped.
- **Stale first frame at the old place** (the view reports its new place about 25 ms after `SetBounds`). Not seen by
  any DOM read, and Steam has the same race between a Warning-size toast and the next one. Left as a by-hand check
  (§ 11 H4); no code unless it is seen.
- **enhanced-achievements' banner invisible in Big Picture** (animations with no start time). Only while the Big
  Picture window is hidden (not in front); with it in front the banner animates normally (`max opacity 1`).

### 2.5 A live test that encoded the bug

`enhanced-notifications/tests/previews.mjs` fires a preview every 6.5 s and expects the window's type to be the one
just fired. In Big Picture a Warning toast (LowBattery) stays about 15 s, so the queue grows and the screen lags
behind the last preview. It passed before only because the type followed arrivals (the bug). With the fix it fails
at `DownloadComplete: restyled in place` with the clip toast still on screen and correctly typed
(`{"type":"GameRecordingInstantClip", "text":"Clip Saved ..."}`). Patch 2 makes it wait, by polling Steam's queue and
the placeholder (bounded, 30 s), until nothing shows before each preview. Every assertion stays as strict
(guardrail 15: a timing fix by polling the data signal).

## 3. Design

### 3.1 The signal

`surfaces/style/toast-pop.ts` (new, pure, no imports) wraps `PopNextToastNotification` as an **own property of the
NotificationStore instance**. The prototype is never written. The wrapper calls what was there before it (an own
property someone else set, else the prototype's method looked up at call time, so a later prototype wrapper still runs),
returns Steam's value unchanged, and calls `onPop` only for a real toast. A listener error goes to `reportError('style')`
and never breaks Steam's pop. Uninstall restores the previous state only if the wrapper is still on top; otherwise
it stays in the chain as a pass-through (same rule as `steam/notification-hook.ts`).

`surfaces/style/type-source.ts` (new, pure) holds the decision `takesSignal(source, signal, popAvailable)`:
the default source `pop` takes only pops; without the method it falls back to `shown`; `arrival` is never taken by
default. The debug switch keeps `arrival` (reproduces the old behaviour, also taking `shown` like the old code),
`shown` and `manual`, so `bp-toast-trace.mjs --source ...` can compare them.

`injector.ts` installs the wrapper, routes pops, shows and arrivals through `takesSignal`, and still subscribes to
arrivals but only for the trace and the `arrival` debug source. Install no longer requires the current-toast value.

### 3.2 Ownership and both plugins

- New Steam target, one owner: `NotificationStore` instance `PopNextToastNotification` → `surfaces/style/toast-pop.ts`
  (architecture test `OWNERS` row, surface `touches`, the owners table in the architecture doc).
- enhanced-achievements does not change code: the fix is where the bug is (enhanced-notifications marked
  enhanced-achievements' banner window). Its Big Picture live test gains the check that guards it, because the
  symptom shows in its banner.
- No shared file changes, so the drift checks in both architecture tests are untouched.

### 3.3 Tests added

| Plugin | Test | Proves | Fails on the old code? |
| --- | --- | --- | --- |
| enhanced-notifications | `tests/bigpicture-type.test.ts` (9 tests) | an arrival never sets the type by default; pop and its `shown` fallback; the wrapper returns Steam's value, survives a listener error, writes only the instance, composes with a later prototype wrapper and with one on top of it | n/a (new modules) |
| enhanced-notifications | `tests/architecture.test.ts` | the new owner row; the two new files are pure | n/a |
| enhanced-notifications | `tests/bigpicture.mjs` (+13 checks) | a toast queued behind the one on screen never restyles it, both orders; the banner never gets our type or animation; every `SetBounds` goes to the theme's place; placement is in place before Steam measures a window that lacked it | **yes**: 4 FAILs with `debugBigPicture({ typeSource: 'arrival' })` (§ 12) |
| enhanced-notifications | `tests/previews.mjs` | each preview is restyled in place, now also in Big Picture with queued toasts | it passed on the bug; fixed per § 2.5 |
| enhanced-achievements | `tests/bigpicture.mjs` (+1 check) | a download queued behind the banner never restyles it | **yes**: FAIL with `arrival` (§ 12) |

### 3.4 Rejected options

- **Take the type from `onShown` only.** One line, but it lands in Steam's passive effect, after `SetVisible(true)`,
  so the first frame of a toast can still carry the previous type (and the placement style would again be written
  after Steam measured a fresh window). Kept as the fallback when the pop method is missing.
- **Mark the body permanently and exclude the banner in CSS** (`:not(.ea-banner)`). No timing at all, but it couples this
  plugin's CSS to enhanced-achievements' class names, and still styles a type that should stay stock.
- **Wrap `PopNextToastNotification` on the prototype.** Global for every window and every plugin; the instance property
  is scoped and composes the same way.
- **Re-measure the view when the placement style changes** (to move a showing toast after a theme change): would mean
  forcing Steam's component to re-render; not worth it for a theme-editing edge case.

## 4. Preconditions

| # | Command (from the repo root unless noted) | Expected |
| --- | --- | --- |
| P1 | `git log --oneline -1 -- enhanced-notifications/frontend/surfaces/style/injector.ts` | starts `e74dee9` |
| P2 | `git status --short -- enhanced-notifications enhanced-achievements docs/steam-components.md docs/enhanced-notifications docs/enhanced-achievements` | prints nothing |
| P3 | `cd enhanced-notifications && npm run check` | nothing after the npm banner, exit 0 |
| P4 | `cd enhanced-notifications && npm test` | ends `ℹ pass 57` / `ℹ fail 0` |
| P5 | `cd enhanced-achievements && npm test` | ends `ℹ pass 124` / `ℹ fail 0` |
| P6 | `git apply --check docs/plans/enhanced-notifications-bigpicture-toast-fix/p1-pop-signal.patch` | prints nothing, exit 0 |

If any row differs, stop (§ 7).

## 5. Do-not-touch list

- Every shared file (`steam/notification-hook.ts`, `kernel/surface.ts`, `theme/jsonc.ts`, `settings/rows.tsx`,
  `backend/main.lua`, `pristineDuration`) in both plugins.
- `enhanced-notifications/frontend/theme/**` (the CSS is right; the bug is when it is switched on).
- `enhanced-notifications/frontend/surfaces/style/toast-window.ts` (desktop placement is not affected).
- All of `enhanced-achievements/frontend/**`.
- The patch files. Never edit a patch, or a file it creates, "to make it fit".

## 6. Banned actions

No deploy or Steam restart (`dev.ps1`), no SharedJSContext reload, no probes or live tests (they are § 11, for the
user or a verifier holding the Steam lock), no throwaway plugins, no edits to Millennium's `config.json` or plugin
config, no changes to the user's library, collections or shortcuts, no `npm install`/upgrade (ignore the
`@steambrew/ttc` nag), no `git push --force`, no `--no-verify`, no `git add -A`.

## 7. Failure rule

Run a failing command at most twice. On the second failure stop, append the command, its output (trimmed to 30
lines) and the step number to `TASK.md` § Active failures & blockers, and exit. If `git apply --check` fails, run
`git apply -3 <patch>` once; if that conflicts, stop the same way. Do not edit around a failure or skip ahead.

## 8. Guardrail checklist (tick each after step 3, one line of proof)

- [ ] **2 (O(1) hot paths).** `PopNextToastNotification` runs once per container effect, not per frame; an empty pop
      costs one comparison in the wrapper (`n && typeof n === 'object'`). The scan behind a real pop is unchanged
      from today's per-toast scan.
- [ ] **12 (popup hooks).** The Big Picture toast window is still reached through the placeholder fiber walk; nothing
      new relies on `g_PopupManager` seeing it.
- [ ] **14 (a new gate never removes working behaviour).** Desktop: per-popup types still come from `toast-window.ts`;
      `currentType` is only the fallback before that, now from the pop. Without the pop method, `onShown` still styles.
- [ ] **15 (never weaken a check).** No assertion was loosened; `previews.mjs` gained a bounded poll of Steam's queue
      and placeholder (§ 2.5).
- [ ] **17 (a render never starts work).** The pop runs inside Steam's state updater; `onPop` only sets a body
      attribute and a `<style>` in toast windows. It emits no event, starts no RPC, schedules nothing, and changes
      nothing React reads, so it cannot loop.

## 9. Ordered steps

Each step: check the patch, apply it, compare `git status` and the checks with the expected output, commit.
Commit messages carry **no** AI attribution (AGENTS.md Routine 6).

### Step 1: the pop signal (enhanced-notifications code and unit tests)

```bash
git apply --check docs/plans/enhanced-notifications-bigpicture-toast-fix/p1-pop-signal.patch   # no output
git apply docs/plans/enhanced-notifications-bigpicture-toast-fix/p1-pop-signal.patch
git status --short
```

Expected `git status --short` (order may differ):

```
 M enhanced-notifications/frontend/surfaces/style/bp-debug.ts
 M enhanced-notifications/frontend/surfaces/style/index.ts
 M enhanced-notifications/frontend/surfaces/style/injector.ts
 M enhanced-notifications/tests/architecture.test.ts
?? enhanced-notifications/frontend/surfaces/style/toast-pop.ts
?? enhanced-notifications/frontend/surfaces/style/type-source.ts
?? enhanced-notifications/tests/bigpicture-type.test.ts
```

Checks: `cd enhanced-notifications && npm run check` prints nothing after the banner and exits 0;
`npm test` ends `ℹ pass 66` / `ℹ fail 0`.

```bash
git add enhanced-notifications/frontend/surfaces/style/bp-debug.ts enhanced-notifications/frontend/surfaces/style/index.ts \
  enhanced-notifications/frontend/surfaces/style/injector.ts enhanced-notifications/tests/architecture.test.ts \
  enhanced-notifications/frontend/surfaces/style/toast-pop.ts enhanced-notifications/frontend/surfaces/style/type-source.ts \
  enhanced-notifications/tests/bigpicture-type.test.ts
git commit -m "fix(enhanced-notifications): Big Picture toast type follows the toast on screen (PopNextToastNotification), not the one that arrived"
```

### Step 2: live regression checks (both plugins) and the probe

```bash
git apply --check docs/plans/enhanced-notifications-bigpicture-toast-fix/p2-live-tests.patch   # no output
git apply docs/plans/enhanced-notifications-bigpicture-toast-fix/p2-live-tests.patch
git status --short
```

Expected:

```
 M enhanced-achievements/tests/bigpicture.mjs
 M enhanced-notifications/tests/bigpicture.mjs
 M enhanced-notifications/tests/previews.mjs
 M enhanced-notifications/tests/probes/bp-toast-trace.mjs
```

Checks: `node --check` on each of the four files prints nothing; `cd enhanced-notifications && npm test` still ends
`ℹ pass 66` / `ℹ fail 0` (the architecture test checks the live script list); `cd enhanced-achievements && npm test`
ends `ℹ pass 124` / `ℹ fail 0`.

```bash
git add enhanced-achievements/tests/bigpicture.mjs enhanced-notifications/tests/bigpicture.mjs \
  enhanced-notifications/tests/previews.mjs enhanced-notifications/tests/probes/bp-toast-trace.mjs
git commit -m "test(enhanced-notifications, enhanced-achievements): Big Picture checks that a queued toast never restyles the one on screen; previews wait for Big Picture's queue"
```

### Step 3: docs and changelogs

```bash
git apply --check docs/plans/enhanced-notifications-bigpicture-toast-fix/p3-docs.patch   # no output
git apply docs/plans/enhanced-notifications-bigpicture-toast-fix/p3-docs.patch
git status --short
```

Expected:

```
 M docs/enhanced-achievements/architecture.md
 M docs/enhanced-notifications/architecture.md
 M docs/steam-components.md
 M enhanced-achievements/CHANGELOG.md
 M enhanced-notifications/CHANGELOG.md
```

```bash
git add docs/enhanced-achievements/architecture.md docs/enhanced-notifications/architecture.md docs/steam-components.md \
  enhanced-achievements/CHANGELOG.md enhanced-notifications/CHANGELOG.md
git commit -m "docs: Big Picture toast type from PopNextToastNotification; owners, tests and changelogs"
```

Then tick § 8, add a line to `TASK.md` § Now ("Big Picture toast flicker: fix committed, live verification in
[its plan § 11](docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md)") and a workspace `CHANGELOG.md`
entry, commit both (`git add TASK.md CHANGELOG.md`), and push (`git push origin main`).

## 10. After the last commit

`git status --short` prints nothing for the files above; `git log --oneline -4` shows the three commits plus the
TASK/CHANGELOG one.

## 11. Live verification (the user, or a verifier with the user's go-ahead)

Hold the Steam lock for the whole sequence (AGENTS.md Routine 0) and keep **Big Picture in front** (a hidden window
does not paint, so animations never start and the checks read nonsense).

```bash
node steam-lock.mjs acquire --owner en-bp-verify --purpose "enhanced-notifications: Big Picture flicker fix verification"
cd enhanced-notifications && STEAM_LOCK_OWNER=en-bp-verify powershell -ExecutionPolicy Bypass -File dev.ps1
node tests/cdp.mjs "(SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture'), true)"   # wait until GetUIMode() is 4
node tests/bigpicture.mjs            # 20 lines, every one PASS, the last "PASS  Big Picture: settings reset, temp theme removed"
cd ../enhanced-achievements && node tests/bigpicture.mjs   # 3 PASS, the last "PASS  a queued toast does not restyle the banner on screen ..."
cd ../enhanced-notifications && STEAM_LOCK_OWNER=en-bp-verify npm run test:live   # every line PASS (in Big Picture too)
node tests/cdp.mjs "(SteamClient.UI.SetUIMode(7), true)"   # back to desktop: see the note below
STEAM_LOCK_OWNER=en-bp-verify npm run test:live                                      # every line PASS, bigpicture SKIP
cd ../enhanced-achievements && STEAM_LOCK_OWNER=en-bp-verify npm run test:live    # every line PASS, on desktop
node ../steam-lock.mjs release --owner en-bp-verify
```

Note: run enhanced-achievements' `test:live` on **desktop**. In Big Picture its `tiers`, `safety` and `queue-stress`
fail whatever the code: they wait for every `notificationtoasts` CDP target to go away, and Big Picture's toast window
is persistent (seen in the dry run, § 12). Giving them a Big Picture SKIP is a separate small task (TASK.md).

By hand, in Big Picture (the user):

- **H1.** A theme with `"settings": { "position": "top_left", "animation": "ps5" }`: press Preview five times quickly.
  Each toast enters once, with the theme's look, at the theme's corner, and keeps that look until it leaves.
- **H2.** Fire an achievement right after a download (or the reverse): the first toast never changes look or jumps when
  the second arrives; the achievement banner keeps enhanced-achievements' look.
- **H3.** Exit and re-enter Big Picture, then a first toast: at the theme's corner from its first frame.
- **H4.** Position `bottom_right`: a LowBattery preview, then a download preview. Watch the second one's first frame
  (a phone video at 60 fps is enough): it should not flash at the LowBattery toast's place. If it does, note it in
  TASK.md; it is Steam's own race (§ 2.4) and needs its own plan.

## 12. Dry-run record (2026-10-01)

The three patches were produced from a working tree on top of `e74dee9` and verified there, then the tree was reset
to `e74dee9` and `git apply --check` passed for all three in order.

- Offline: enhanced-notifications `npm run check` clean, `npm test` `ℹ pass 66` / `ℹ fail 0`; enhanced-achievements
  `npm test` `ℹ pass 124` / `ℹ fail 0`.
- Live, deployed with `dev.ps1` under the Steam lock, Big Picture in front: enhanced-notifications `tests/bigpicture.mjs`
  20/20 PASS (queued both orders, `SetBounds` always `[30,20]`, fresh window first `SetBounds` `[30,20]`).
- The new checks fail on the bug: with `debugBigPicture({ typeSource: 'arrival' })` the same run printed
  `FAIL  achievement queued behind a download: toast 1 keeps one style while on screen  (["DownloadComplete | en-in-fade, en-out-fade","- | _16D0EqPO8d_SJqKa2pdzHC, L-BuCYlSu3dkAqqyvysgx"])`
  and three more FAILs; enhanced-achievements' new check printed
  `FAIL  a queued toast does not restyle the banner on screen  ["DownloadComplete | ea-in-ps5-right, ea-out-ps5-right"]`.
  With `pop` both pass.
- `npm run test:live`, Big Picture: enhanced-notifications 6/6 PASS, but only after § 2.5 (`previews.mjs` failed before
  its queue wait; with it, 10/10). enhanced-achievements `smoke`, `captures`, `settings-sound`, `reset`, `bigpicture`
  PASS; `tiers`, `safety`, `queue-stress` FAIL on their desktop-only wait (§ 11 note).
- `npm run test:live`, desktop: enhanced-notifications 6/6 PASS (`bigpicture` SKIP); enhanced-achievements 8/8 PASS
  (`bigpicture` SKIP).

## 13. Out of scope, and one question for the user

**Where should achievement toasts go in Big Picture?** Big Picture has one toast place, so today enhanced-notifications'
`position` / `margin` moves achievement toasts too, and enhanced-achievements' own `position` does nothing there
(its banner even slides in from its own corner's side, `ea-pos-top_right`, while the frame sits at the other plugin's
corner). Options, for a later plan once the user picks:

1. **Keep it** (documented today): one place for every toast in Big Picture.
2. **enhanced-notifications places achievement toasts at enhanced-achievements' position** (recommended if achievement
   placement matters): at the pop, when the toast is an achievement enhanced-achievements claims, the placeholder style
   uses that plugin's theme `position` / `margin`, read through a new read-only export next to `claims()`. One writer
   stays (enhanced-notifications); without enhanced-notifications installed, achievement toasts stay at Steam's corner.
3. **A shared placement file in both plugins** (like `notification-hook.ts`) so either plugin alone can place its own
   toasts in Big Picture. Most capable, most work, and two plugins would share one `<style>` writer.

This would need an ADR whichever is picked.
