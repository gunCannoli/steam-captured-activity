# Plan: enhanced-notifications, Big Picture in-game bugs and a consistency pass

**Status:** investigation written 2026-10-08, nothing changed. **Baseline commit:** `f6b1cdb`.
**Shape:** this is a big task, so it is a two-stage plan, as for the Theme Creator. Stage A (§ 5) is evidence: spikes with
exact commands and what each result means. Stage B (§ 6) is the fix phases. Each gets its own mechanical plan, with
before/after blocks, written only once its spike has run, because the root causes below are hypotheses until then.
Writing before/after blocks now would mean fixing guesses (plans/README rule 1: "root cause with evidence").

**User report (2026-10-08):** in-game, Big Picture, theme `ps5`:
1. **Flicker:** a toast shows top-right, and just before it fades out it also shows **top-left for a split second**.
2. **The fade-out does not look right.**
3. **With a custom achievement sound, the sounds of other notifications (screenshot, recording) seem blocked** when several
   notifications fire together. Check how the queue handles the sounds that come with notifications.
4. Make enhanced-notifications **less erratic and inconsistent** overall.

---

## 1. Context that changes how to read the report

- **The user's settings were wiped.** Millennium's config for `enhanced-notifications-dev` holds only
  `recording.duration_s: 5`, `recording.enabled: true`, `screenshot.enabled: true` (read 2026-10-08). No `theme` key means
  "Steam default", and no `queue.enabled` key means the queue is off (the default, `settings.json`). The user picked `ps5`.
  TASK.md already records that `placement.mjs` and `sound-duration.mjs` end with `resetSettings()`, so running either
  alone wipes the user's settings. That is erratic behaviour in itself (C1 below), and it means the queue state during
  the user's test is unknown.
- **Captures on unlock create the burst.** With screenshot and a 5 s clip on, every unlock makes the plugin start a
  manual recording if none runs (ADR-0061), then save a screenshot and a clip. Each can raise its own Steam
  notification, with its sound, while the achievement banner is on screen. So "several notifications at once" is, at
  least in part, our own doing.
- **In game, Steam routes toasts differently.** `AddAppOverlayNotification(appid, …)` pushes onto a per-game list
  (`m_mapAppOverlayToasts`), and `PopNextToastNotification(appid)` shifts from it without `DispatchNextToast`. Some types
  are rate-limited (`BIsToastRateLimited`, `m_mapToastLastShown`). Read from Steam's source live 2026-10-08. Our Big
  Picture work (ADR-0049, the 2026-10-01 flicker fix, `bp-toast-trace.mjs`) was verified on the **Big Picture main
  window** only; steam-components.md calls the in-game path "code-verified; not yet verified with a real in-game unlock".

## 2. Verified facts this plan builds on

| Fact | Source |
| --- | --- |
| Big Picture has one toast view (a BrowserView) that follows the `position: fixed` `GamepadToastPlaceholder`. Per toast: `SetBounds(rect)`, then `SetVisible(true)`. On hide: `SetVisible(false)` and `SetBounds(0, 0, 0, 0)`. `window.screenX/Y` lags `SetBounds` by about 25 ms. Hidden `nToastDurationMS + 600` ms after showing | steam-components.md § Big Picture toast view (live 2026-10-01) |
| Steam animates `.GamepadToastPopup > *`: `toastEnter` (translateX 300 px → 0, 300 ms), `toastExit` (opacity → 0, 300 ms, delay `var(--toast-duration)`), both `forwards`. **Swapping that element's animation mid-toast restarts it**: a jump of 300 px, then a slide back | same |
| A styled toast (theme with `animation`) replaces both animations, but only while `body[data-en-type]` is set (`buildAnimationCss`, `theme/theme.ts:449`). For ps5 the exit starts at `--toast-duration − 100 ms`, lasts 400 ms and ends at duration + 300 ms, before Steam's hide at + 600 | code |
| An achievement drawn by the banner gets **no** `data-en-type`, so Steam's stock `toastEnter` still slides the wrapper 300 px **while** the banner runs its own ps5 entrance (two entrances at once). The banner's lifetime (ps5: 450 + 4000 + 400 + 100 = 4950 ms) is written as the achievement type's `toastDurationMS`. The banner exits at 4450–4850 and hides itself (`.ea-done { visibility: hidden }`) at 4950; Steam's own fade runs 4950–5250 on what is left (the wrapper); the view hides at 5550 | `surfaces/banner/themed-toast.tsx`, `banner/styles.ts:57`, `surfaces/duration/duration.ts` |
| In Big Picture the banner is neither pinned nor held: Steam times the view, the banner times its CSS, and nothing ties the two clocks together. The 2026-09-30 frozen-clock fix (`restartFrozenAnimations`) can reset the banner's animations about two frames after mount | `themed-toast.tsx:131-158, 205` |
| `ChooseSound` keeps no state (no throttle): `playSound` / `sound` from the type config, gated by `play_sound_on_toast` or `bCritical` | Steam source, live 2026-10-08 |
| The **screenshot shutter** is not a toast sound: `OnScreenshotStarted` plays `PlayNavSound(Screenshot)` natively when `enable_screenshot_sound` is on. Our hook never sees it | Steam source, live 2026-10-08 |
| Our clips play through WebAudio in SharedJSContext (`surfaces/sound/index.ts`); Steam's chimes go to a native player (`PlayNavSound`). Two outputs, no mixing rule between them | code; steam-components.md |
| An unlock whose banner is `waiting` is silent until its turn (`surfaces/sound/sound.ts`). Other types are never deferred, deduplicated or ordered by us | code |
| Steam's own corner here is bottom-right (`ActiveWindowInstance.NotificationPosition` = `{ position: 3 }`), `play_sound_on_toast`, `achievement_notification_sound` and `enable_screenshot_notification` are on | live 2026-10-08 |

## 3. Hypotheses, per symptom

Each one names the spike (§ 5) that confirms or refutes it. None is proven.

### S1. A toast flashes top-left before it leaves

- **H1a. Our styling stops matching while Steam's element is still mounted, so Steam's stock animations restart.** If
  `data-en-type` changes or is removed before Steam hides the view, our animation rule stops matching on
  `.GamepadToastPopup > *`. Steam's `toastEnter`/`toastExit` then apply again and restart: the content is opaque and
  sliding at the moment Steam calls `SetBounds(0, 0, 0, 0)`. A window corner at (0, 0) is top-left. Possible triggers:
  the next toast's pop (to a type without styling, or an achievement drawn by the banner) arriving before the hide; a
  theme `refresh` mid-toast; `scanBigPictureToastWindows` re-applying during an overlay toast. Also explains S2.
  Spike A1.
- **H1b. Steam's hide order or bounds lag.** Steam may call `SetBounds(0, 0, 0, 0)` a frame **before**
  `SetVisible(false)`; or, at the next toast, `SetVisible(true)` lands before the new bounds (25 ms lag), so the view is
  drawn for a frame at its last bounds, (0, 0). Stock Steam would have the same flash but hide it: its content is at
  opacity 0 by then (`toastExit` ended at duration + 300). Ours may not be (ps5 timing, the banner's wrapper, a
  `refresh`). Spike A1, plus the control run A3.
- **H1c. The in-game overlay is a second toast surface we do not style or place the same way.** If an in-game toast is
  drawn by the game overlay's own view and **also** by the Big Picture view (or our placement `<style>` reaches one but not
  the other), the user sees two places. Spike A2.
- Ruled out (for now): Steam's own corner setting. It is bottom-right, not top-left (live 2026-10-08).

### S2. The fade-out looks wrong

- **H2a.** Same as H1a: Steam's restarted animations replace ours at the end.
- **H2b. Two clocks for the banner in Big Picture.** The banner's CSS exit (4450–4850) and Steam's view lifetime
  (`toastDurationMS` + 600) are timed separately. The frozen-clock restart (`currentTime = 0` about two frames in) shifts the
  banner's exit later by however long the window took to paint, and `visibility: hidden` at `done` can then cut the exit
  mid-way. The stock wrapper still runs `toastEnter` / `toastExit` around the banner (a 300 px slide in, a second fade out).
  Spike A1 (animation timeline per frame).
- **H2c. ps5's keyframes leave content visible after the exit.** `en-out-ps5-*` ends at opacity 0 with
  `fill-mode: forwards`, but the in-game overlay may reuse the element differently (H1c). Spike A2.

### S3. Other notifications' sounds are lost while a custom achievement sound plays

- **H3a. Our capture burst is queued or rate-limited, so its sounds play late or never.** The recording-started, screenshot
  and clip-saved notifications we cause arrive while the banner shows. In game they go to the per-game overlay list. With
  the queue on (`displayToastAlone` on every type) they wait for the banner; with it off, Big Picture still shows one at a
  time. Some types are rate-limited (`BIsToastRateLimited`), and a dropped or merged toast never calls
  `PlayNotificationSound`, so its sound never plays. Spike A4.
- **H3b. WebAudio and Steam's native player do not mix as expected in game.** A long tier clip (`trophy_ps5.mp3`, 80 %)
  from SharedJSContext may duck, or be ducked by, Steam's native toast and shutter sounds. Or the in-game overlay's
  audio routing differs: the game holds focus, and SharedJSContext's audio may not be the device the game uses. Spike A4
  (compare with sound off: `disabledFeatures: 'sound'`).
- **H3c. A queued unlock takes the next toast's sound turn.** `whenShowing` defers only achievement unlocks. A burst with
  two unlocks plus a screenshot can play two clips back to back while Steam's chime for the screenshot toast fires in
  between, or is masked. Spike A4 (timeline of every `PlayNotificationSound` and every clip start).
- Ruled out: Steam throttling sounds in `ChooseSound` (no state, read live). The screenshot shutter itself is native and
  never passes through our hook.

## 4. The consistency list (C): what makes it feel erratic

From the code, TASK.md and this investigation. Each item gets a fix or an explicit "won't fix" in stage B.

| # | Inconsistency | Where |
| --- | --- | --- |
| C1 | Live scripts wipe the user's settings (`placement.mjs`, `sound-duration.mjs` end with `resetSettings()`); the user's theme and queue were found reset today | `tests/*.mjs` (TASK.md, 2026-10-07) |
| C2 | Desktop holds a banner popup until our scheduler says done; Big Picture does not: two lifetimes, two exits | `themed-toast.tsx` `holdPopup` (desktop only) |
| C3 | In Big Picture the banner runs its own entrance under Steam's 300 px slide (two entrances), and Steam's fade after its own exit (two exits) | `banner/styles.ts` has no `.GamepadToastPopup > *` rule for banner toasts |
| C4 | Achievements last 4950 ms (banner lifetime), other toasts `display_time_ms` 4000 ms plus Steam's 600 ms: different visible lengths for one theme | `surfaces/duration/duration.ts` |
| C5 | Toasts sometimes vanish with the queue on (open since ADR-0055: 0 of 3 test toasts, or 1 of 5 banners, in full runs only) | TASK.md, `notifications-queue.mjs` |
| C6 | Sounds: clips (WebAudio, per-clip volume) and Steam's chimes (native, Steam volume) have no common level or ordering; a burst can stack several clips | `surfaces/sound` |
| C7 | The in-game overlay path is unverified for type, placement, animation and sound | steam-components.md |
| C8 | Big Picture visuals can only be live-checked with Big Picture in front (hidden windows do not animate), so regressions there are found by the user | steam-debug.md Trap 13, `run-live.mjs` SKIPs |
| C9 | steam-cartridges' "Achievements Enabled" launch toast calls `ProcessNotification` wrongly and never shows (open, TASK.md) | steam-cartridges `surfaces/toasts/launch.ts` |
| C10 | Placement CSS is rewritten at each pop; a Warning-class toast (smaller placeholder) moves a right- or bottom-anchored toast between toasts | `injector.ts` `applyPlacement`, steam-components.md |

## 5. Stage A: evidence spikes

Rules for every spike: hold the Steam lock for the whole session (AGENTS.md Routine 0); snapshot the plugin settings first
and restore them at the end. That is the fix C1 asks for, so A0 comes first. Never reload SharedJSContext. Big Picture
must be in front (Trap 13). Write each spike's raw output to `scratch/en-spikes/<spike>-<time>.json`, and its finding to
§ 7 of this plan.

### A0. Make the live scripts safe first (prerequisite, small)

`placement.mjs` and `sound-duration.mjs` snapshot the settings at start and restore exactly that snapshot at the end, in a
`finally`, the way `achievements-captures.mjs` does. Keep their checks unchanged (guardrail 15). Done means: run each one
alone, and `PluginConfig_GetAll` reads the same before and after. This needs its own short mechanical plan; it changes no
plugin code.

### A1. Frame trace of one styled toast and one banner in Big Picture (main window)

Command (Big Picture in front, theme ps5):
```
node enhanced-notifications/tests/probes/bp-toast-trace.mjs --theme top_right:ps5 --pattern mixed --ms 25000
node enhanced-notifications/tests/probes/bp-toast-trace.mjs --theme top_right:ps5 --pattern queue --ms 25000
```
Read in the output, per toast: the time of `SetBounds(0,0,0,0)` versus `SetVisible(false)` (H1b); every `data-en-type`
change and its time relative to the hide (H1a); the `.GamepadToastPopup > *` animation names and opacity in the last
600 ms (H1a, H2a); the banner's `ea-in`/`ea-out` start times versus the view's show (H2b).
**H1a confirmed** if `data-en-type` changes before the hide while the opacity is above 0. **H1b confirmed** if
`SetBounds(0,0,0,0)` precedes `SetVisible(false)` by a frame or more, or the next `SetVisible(true)` precedes the new rect.

### A2. The in-game path (new probe mode)

Extend `bp-toast-trace.mjs` with `--ingame <appid>`. Launch a light game from Big Picture (a shortcut that starts fast,
e.g. AM2R; record which), then trace the same as A1 plus:
- which CDP targets exist for the overlay, and whether a `GamepadToastPlaceholder` lives in the overlay window, the Big
  Picture window, or both (H1c);
- `PopNextToastNotification` calls with their context argument (0 or the appid);
- whether our placement `<style>` and theme `<style>` are present in each window that draws a toast.
Trigger toasts with `NotificationStore.TestAchievement(appid)` and a download test toast while the game runs.
**H1c confirmed** if one toast is drawn in two views, or the view that draws it lacks our `<style>` at its first frame.

### A3. Control run with the plugin off

Repeat A1 and A2 with `disabledFeatures: 'style,placement,banner,sound,duration,queue'` (Steam's own behaviour), and once
with only `style,placement` on. If the top-left frame appears in the stock run too, it is Steam's (H1b), and our job is
to make sure nothing of ours is visible at that frame. If it appears only with ours, the cause is ours (H1a, H1c).

### A4. Sound ledger in a real burst

New probe `tests/probes/sound-ledger.mjs`. For 30 s it records, with timestamps: every `PlayNotificationSound` call
(eType, the decision our handler took: chime, clip, muted, deferred); every clip start and its length (wrap `playClip`
through a debug hook on the plugin, not a new owner); every `PlayNavSound` dispatch (find the native sound dispatcher by
signature: the function behind `OnScreenshotStarted`'s `PlayNavSound`, read only, wrapped on its instance for the
trace); every toast arrival, pop and show (per context); every `BIsToastRateLimited` answer. Run four ways, in game in
Big Picture:
1. a real unlock (or `TestAchievement`) with screenshot and clip on, queue off;
2. the same with the queue on;
3. the same with `disabledFeatures: 'sound'` (Steam's chimes only);
4. F12 during a banner (the native shutter).
**H3a confirmed** if a capture notification never shows or shows after the banner without a `PlayNotificationSound`.
**H3b confirmed** if every `PlayNavSound` fires but the user (asked during the run) does not hear it while a clip plays.
**H3c confirmed** if two clips overlap or a chime fires inside a clip.

### A5. Desktop and the overlay on desktop (for C2, C3, C4)

`node enhanced-notifications/tests/probes/toast-placement.mjs` with ps5, one banner and one styled toast. Record the visible
lifetime of each (first and last frame with opacity above 0) to compare with Big Picture's. This gives the numbers stage
B makes consistent.

**Exit criteria of stage A:** every hypothesis in § 3 marked confirmed, refuted or unknown, with its trace file named in
§ 7; the user has watched A2 and A4 once (S1 and S3 are perceptual).

## 6. Stage B: fix phases (each gets its own mechanical plan after stage A)

The likely shape, depending on stage A. The ADR is written in B1.

- **B1. One lifetime per toast, owned by Steam's clock in Big Picture** (S1, S2, C2, C3, C4). If H1a/H2a/H2b hold: in Big
  Picture, time the banner from Steam's view (`--toast-duration`, the same CSS variable Steam uses) instead of its own
  timer. Give banner toasts a `.GamepadToastPopup > *` rule that cancels Steam's stock animations, as styled toasts
  already do. Keep the styling decision for the toast on screen fixed until Steam hides it: never change
  `data-en-type` on a pop for another context or before the hide. Make sure nothing of ours is visible from duration +
  300 ms on, so Steam's `SetBounds(0, 0, 0, 0)` (H1b) can never show it. One visible length per theme for every toast type
  (C4), and the desktop hold capped to the same number. ADR: "a toast's look and lifetime are fixed at show and end
  before Steam hides its view".
- **B2. The in-game path** (H1c, C7). Place and style the overlay's view the same way as the Big Picture view, or, if
  Steam draws in-game toasts twice, name the one we style. Document it in steam-components.md with the traces.
- **B3. Sounds as a schedule** (S3, C6). Depending on A4: (a) captures on unlock stop raising extra toasts during the
  banner, or are delayed until it ends, and their sounds are never dropped; (b) one sound at a time across WebAudio and
  Steam's chimes. A clip and a chime that would overlap are spaced, or the later one is skipped when the setting says
  so. Never block the shutter; (c) a common loudness: clip volumes normalised against Steam's chime, with the theme's
  volume relative to it. Pure decision module plus unit tests, like `sound.ts`.
- **B4. Queue reliability** (C5). Use A4's ledger to explain the vanished toasts (suspects in TASK.md:
  `ClearAllToastNotifications` while the fullscreen check answers true, an early return in `ProcessNotification`). Fix
  or document; the queue stays opt-in until the full live suite passes three times in a row.
- **B5. Verification that does not depend on the user's eyes** (C8, C1). `run-live.mjs` gains an "in-game Big Picture"
  group built from A2/A4 (SKIP when no game runs). Every live script snapshots and restores settings. A frame check
  fails if anything of ours has opacity above 0 at Steam's hide.
- **B6. Small items.** C9 (steam-cartridges' launch toast: post it through `OnNotification` or remove it, the user
  decides), C10 (re-measure order with a Warning-class toast; document or fix).

## 7. Findings (filled in by stage A)

| Hypothesis | Result | Trace file | Notes |
| --- | --- | --- | --- |
| H1a | | | |
| H1b | | | |
| H1c | | | |
| H2a / H2b / H2c | | | |
| H3a / H3b / H3c | | | |

## 8. Guardrails and rules that apply

- plugins.md guardrail 12 (popup hooks do not see every window: the in-game overlay view), 15 (never weaken a check),
  17 (a render never starts work), 19 (boot health after every restart), 2 (O(1) in hooks: the probes' wrappers are
  debug-only and off by default).
- enhanced-notifications.md: one owner per Steam target. A probe's wrapper is not an owner and is removed at the end of
  the probe. Any new target in stage B gets a row in "Steam targets and their one owner" and in `OWNERS`.
- Banned in stage A: no plugin code change except A0's test scripts; no deploy beyond what a spike needs; no edits to
  the user's themes; no reset of the user's settings (snapshot and restore); no `git push --force`, no `--no-verify`.
  Commits without AI attribution (AGENTS.md Routine 6).
- Failure rule (plans/README): a spike that fails twice is recorded in TASK.md § Active failures and blockers, and the
  next spike starts; stage B starts only on confirmed findings.
