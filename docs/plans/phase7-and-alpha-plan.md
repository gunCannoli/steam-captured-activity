# Phase 7 (auto-captures on unlock) + alpha readiness

> Spec for the implementer. Part A adds screenshots, clips and timeline markers
> on achievement unlock to `enhanced-achievements`. Part B gets
> `enhanced-achievements` (EA) and `enhanced-notifications` (EN) to an **alpha**
> the user can install and test themselves.
>
> Written 2026-09-24 from live CDP introspection of the running client (Big
> Picture session, no game running) plus source reading. Every API below was
> resolved live; **no real capture, clip or marker was created**. The only
> RPCs sent used a bogus game id and timeline, and all failed cleanly (see § A1.6).
>
> Module ids and minified names (`80026`, `xM`, `Bw.jL`, …) are **breadcrumbs from
> this build**. Code resolves by the signatures in § A1.1 only
> ([plugins.md § Rules that apply on every rung](../plugins.md#rules-that-apply-on-every-rung)).

---

## Part A: Phase 7, native auto-captures on unlock

### A1. Verified API findings

#### A1.1 Resolution signatures

| Target | Stable signature | Found on this build | Confidence |
| --- | --- | --- | --- |
| Game Recording service | Export object of the module whose source contains `"GameRecording.TakeScreenshot#1"`, with `v.TakeScreenshotHandler?.name === "GameRecording.TakeScreenshot#1"` and functions `TakeScreenshot`, `SaveClip`, `UserAddTimelineEntry` | Exactly **1** match (module `80026`, export `xM`) | High |
| Recording store (live timelines) | `window.g_GRS`, an instance of the named export `CGameRecordingStore` | Present. Created by the client's own store init (`["GRS", () => Z9(transport, …)]`), which appears in **both** startup paths (desktop and gamepad) | High (presence in desktop mode is inferred from source, not probed live) |
| Timeline loader (per game) | `g_GRS.m_mapActiveTimelines: Map<timelineId, { loader, release }>`; the loader has `BIsTimelineRunning(tid)`, `GetRunningTimelineDurationMS(tid)`, `GetGameID()`, `GetTimelineStartBeforeGlobalZeroMS(tid)`, and `m_mapRunningTimelines: Map<tid, { m_metadata, m_runningRecording }>` | Methods present by name (unminified) | High |
| Timeline entry type | Protobuf **wire** enum `ETimelineEntryType` (a network contract, not a webpack id): `GameMode=1, Event=2, StateDescription=3, Achievement=4, UserMarker=5, Screenshot=6, Error=7` | Read from Steam's proto→UI converter (`case X.Bw.jL: type="usermarker"` …) | High |
| Live "take screenshot now" trigger | **None in JS.** `SteamClient.Screenshots.*` is read/manage only (`GetLastScreenshotTaken`, `GetLocalScreenshotPath`, …). No `SteamClient.*` method triggers a capture | — | High |

`SteamClient.GameRecording` has only `RegisterForAudioSessionsChanged` and
`SetAudioSessionCaptureState`. It is **not** the RPC service.

#### A1.2 How to call the RPCs

Steam's own callers (in `CGameRecordingStore`) pass **plain objects**. The
service converts them to protobuf messages itself:

```ts
const res = await svc.TakeScreenshot({ game_id, timeline_id, timeline_offset_ms: String(ms) });
res.GetEResult();         // 1 = OK
res.BSuccess();
res.Body().toObject();     // response fields
```

The optional second argument is the transport. Omit it and the service uses the
default transport, `ePrivilege: 1` and `eClientExecutionSite: 1` (local client).
It never throws on a bad request. It resolves with a failing EResult. It can
reject only when there is no transport ("Transport Error"), so still wrap each
call in try/catch.

#### A1.3 Request and response shapes (field numbers from `Class.M().fields`)

**`GameRecording.TakeScreenshot#1`**
- Request: `game_id` (1, uint64 string), `timeline_id` (2, string),
  `timeline_offset_ms` (3, uint64 string), `source_clip_id` (4, string, omit for live).
- Response: `screenshot_id` (1). Steam does `parseInt(screenshot_id)` to get a screenshot handle.
- **Semantics: it extracts a frame from recorded video at that timeline offset.**
  It backs the timeline menu's "Take Screenshot at Current Playback" (`#Playback_UserSelectionControls_TakeScreenshot`),
  not the F12 hotkey. It therefore needs video at that offset, which means
  background recording, or a manual recording in progress, when the unlock happens.

**`GameRecording.SaveClip#1`**
- Request: `game_id` (1), `start` (2, `{ timeline_id, offset_ms }`), `end`
  (3, `{ timeline_id, offset_ms }`), `name` (4), `src_clip_id` (5, omit),
  `temporary` (6, **must be `false`**), `force_thumbnail` (7).
- Response: `summary` (1) `{ clip_id, game_id, duration_ms, date_recorded, start_timeline_id, start_offset_ms, name, thumbnail_url, … }`.
- Steam's store wrapper is `SaveClip(game_id, src_clip_id, name, start, end, temporary, force_thumbnail)`.
  Use the service instead: its fields are named. Steam's own `NotifyClipCreated`
  handler (`g_GRS.OnClipCreated`) keeps Steam's clip list in sync.

**`GameRecording.UserAddTimelineEntry#1`**
- Request: `game_id` (1), `entry` (2), `clip_id` (3, omit for live).
- `entry` fields: `timeline_id` (1), `entry_id` (2, `""` on create), `time` (3,
  uint64 string, ms), `type` (4, enum above), `game_mode` (5), `range_title` (7),
  `range_duration` (8), `range_possible_clip` (9), `timestamp_title` (10),
  `marker_icon` (11), `marker_description` (13), `marker_priority` (14),
  `screenshot_handle` (15), **`achievement_name` (16)**, `tag[]` (17), `phase_id` (18), `attributes[]` (19).
- Response: `entry_id` (1).
- Steam's own "Add Marker" button sends:
  `{ timeline_id, entry_id: "", time: String(floor(offsetMs + loader.GetTimelineStartBeforeGlobalZeroMS(tid))), type: 5, marker_icon: "steam_marker", marker_priority: 0 }`.
- **Rendering (from Steam's converter):**
  - `UserMarker` (5) is always drawn as `steam_marker`, and `marker_icon` and title are dropped on reload.
  - `Event` (2) keeps `marker_icon`, `range_title` and `marker_description`.
  - `Achievement` (4) keeps only `achievement_name`. The UI looks it up with
    `GetAchievementInfo(appid, achievement_name)` and draws it with the
    `steam_achievement` icon. That lookup only resolves for apps with a Steam
    achievement schema.

**Steam already puts achievements on its own timeline.** The timeline UI has a
dedicated `"achievement"` entry type with the `steam_achievement` icon. So for
**native Steam games** a marker from us would be a duplicate. Confidence: high
that the type exists and renders. That Steam writes one for every unlock is
medium, and the user must confirm it (User test checklist, U3).

#### A1.4 game_id, timeline id and offset

- **game_id:** the timeline's own `loader.GetGameID()` (a uint64 string). The
  unlock only tells us a 32-bit `appid` (`n.data.appid()`). Match both id forms
  against the running timelines (the rule from AGENTS.md):
  - native: `String(appid)`
  - shortcut: `((BigInt(appid >>> 0) << 32n) | 0x02000000n).toString()`

  The form that matches tells us whether this is a shortcut. No `AppOverview`
  read is needed, which keeps plan § 5 scope boundary 6.
- **Running timeline:** iterate `g_GRS.m_mapActiveTimelines`. Keep entries where
  `loader.BIsTimelineRunning(tid)` and `loader.GetGameID()` is one of the two
  candidates. Stale entries stay in the map after a timeline stops (Steam calls
  `release()` but never deletes them), so the `BIsTimelineRunning` check is mandatory.
- **Offset now:** `loader.GetRunningTimelineDurationMS(tid)`. This is
  `performance.now()` based, measured from the timeline's `date_recorded`.
- **Recording active:** `loader.m_mapRunningTimelines.get(tid)?.m_runningRecording`,
  which is `{ recording_id, start_offset_ms, duration_ms, recording_type }` while
  video is being written, and `null` otherwise. Steam updates `start_offset_ms`
  in place (`E6` value 4) as the background buffer rolls, so read it at send time.
- **Unlock moment:** `n.rtCreated` (unix **seconds**, set in `OnNotification`
  on arrival). Our hook fires when the toast is **displayed**, which can be
  seconds later if other toasts are queued. So
  `unlockOffset = nowOffset - (ageMs < 1500 ? 0 : ageMs)`, where
  `ageMs = max(0, Date.now() - rtCreated * 1000)`.

#### A1.5 Behaviour by situation

| Situation | What exists | Result |
| --- | --- | --- |
| No game running (e.g. `TestAchievement` from the client) | No running timeline | Skip everything, reason `no-running-timeline` |
| Game running, Game Recording **off** | Expect no timeline, so same as above (unverified: U2) | Skip, `no-running-timeline` |
| Game running, manual mode, **not** recording | Timeline running, `m_runningRecording === null` | Screenshot and clip skipped (`recording-not-active`). Marker allowed |
| Game running, background recording or manual recording on | Timeline and recording | All enabled captures run |
| Native Steam game | `game_id === String(appid)` | Marker skipped (`steam-marks-achievements`). Screenshot and clip run |
| Non-Steam shortcut | `game_id` is the composed 64-bit id | Everything runs. Marker is `Event` + `steam_achievement` (A2.4) |
| Toasts disabled in game (`disable_toasts_in_game`) or all toasts disabled | `ProcessNotification` returns early, so our hook never fires | **No captures.** Known limitation (open question Q5) |
| Achievement toasts off in notification prefs, sound on | `ProcessNotification` calls `PlayNotificationSound` directly | Captures run (the hook still fires) |

Shortcut note: real achievement notifications for shortcuts only exist once
Phase 5 dispatches synthetic ones. In this alpha, the shortcut path runs only
through the **Test captures** button (A3.4). It is forward-compatible.

#### A1.6 Live dry probes (nothing created)

With `game_id: "1"` and `timeline_id: "timeline_0_nonexistent"`:

| Call | EResult |
| --- | --- |
| `GetState({})` | 1 (OK), `{ is_h265_enabled: true }` |
| `GetTimelinesForApp({ game_id: "480" })` | 1, `{ timelines: [] }` |
| `TakeScreenshot` | **8** (InvalidParam) |
| `SaveClip` (`temporary: true`) | **79** (InvalidState) |
| `UserAddTimelineEntry` (type 5) | **42** (NoMatch) |

`g_GRS.m_mapActiveTimelines.size === 0`, and `g_GRS.m_recordingState === null` (no game running).

#### A1.7 Hook point (no new hooks, no polling)

Reuse EA's existing `PlayNotificationSound` prototype wrap
(`frontend/steam/notifications.ts`, `installSoundHook`). Verified callers:

- Desktop and in-game overlay: the toast manager calls
  `ShowWindow(); NotificationStore.PlayNotificationSound(n)` once per toast shown.
- Big Picture: the gamepad toast component runs `useEffect(() => PlayNotificationSound(n), [n])`.
- Toast suppressed but sound wanted: `ProcessNotification` calls it directly.

Inside the existing `if (this === owner)` branch, and **before** the
`sound.enabled` check (captures must not depend on the sound toggle):

```ts
if (isAchievementUnlock(n)) onUnlock(n, tierFor(n)); // O(1): dedupe + snapshot + setTimeout
```

`onUnlock` does the following:
- deduplicates with a `WeakSet` of `n`;
- returns early when no capture is enabled after the tier merge;
- takes a snapshot (a map walk over at most a few running timelines);
- schedules timers.

Every RPC runs later, in a timer callback, never in the hook. This is the one
scoped exception to guardrail 5 ("no per-toast RPC"): the RPCs are the feature,
they are opt-in, and they are deferred. Record this in the guardrail table (A5).

Rejected alternatives:
- Wrapping `OnNotification`, which would catch unlocks even with in-game toasts
  off. That is a new hook, so it is left to Q5.
- The jsx toast patch, because render can repeat.
- Synthesising the F12 hotkey from the backend: it depends on focus and on the
  user's configured hotkey, and it would need LuaJIT FFI.

### A2. Capture semantics

Settings keys already exist in `settings.json` and `settings.ts`. A tier's
`screenshot` / `recording` object in the theme overrides them for that tier
(themes.md § Capture overrides).

| Key | Meaning in Phase 7 | Default |
| --- | --- | --- |
| `screenshot.enabled` | Frame grab from the recording | **false** |
| `screenshot.delay_ms` (0–5000) | Grab the frame at `unlockOffset + delay_ms` | 500 |
| `recording.enabled` | Save a clip | **false** |
| `recording.duration_s` (5–60) | Clip length | 15 |
| `recording.delay_ms` (0–5000) | Post-roll: the clip ends `delay_ms` after the unlock | 0 |
| `recording.add_timeline_marker` | Marker at the unlock (shortcuts only, see below) | **false** |

**Defaults off (change `settings.json`).** Captures write files into the user's
library and use disk space. They are opt-in for an alpha. The marker is also a
duplicate of Steam's own entry for native games. No stored value exists for
users who never changed these settings, so the new defaults reach everyone.

#### A2.1 Screenshot
- Needs a running recording. Otherwise skip with `recording-not-active`.
- Target offset `T = unlockOffset + delay_ms`. Send at wall-clock
  `delay_ms + SETTLE_MS` after the hook. `SETTLE_MS = 1500` gives the encoder time
  to flush. Treat this constant as provisional (U1).
- At send time, clamp `T` to `min(T, loader.GetRunningTimelineDurationMS(tid))`.
- Request: `{ game_id, timeline_id, timeline_offset_ms: String(floor(T)) }`.

#### A2.2 Clip
- Needs a running recording.
- `end = unlockOffset + delay_ms`, `start = max(end - duration_s*1000, recording.start_offset_ms, 0)`.
  Read `start_offset_ms` at send time.
- Send at `delay_ms + SETTLE_MS`. Clamp `end` to the live duration.
- Request: `{ game_id, start: { timeline_id, offset_ms }, end: { timeline_id, offset_ms }, name, temporary: false, force_thumbnail: true }`.
- `name`: the achievement's display name (`n.data.name()`), trimmed to 100 characters.
- **Coalescing:** keep at most one *pending* (unsent) clip per timeline. Another
  unlock before it is sent extends that clip's `end` to the new unlock's end,
  capped at `start + 120_000` ms, and becomes `"<first> (+N)"`. Its timer is
  rescheduled. This stops a burst of unlocks producing overlapping clips.

#### A2.3 Timeline marker
- Needs only a running timeline, not a recording.
- **Native Steam game:** skip, reason `steam-marks-achievements`.
- **Shortcut:** send immediately (no delay). The entry is:
  `{ timeline_id, entry_id: "", time: String(floor(unlockOffset + loader.GetTimelineStartBeforeGlobalZeroMS(tid))), type: 2 /*Event*/, marker_icon: "steam_achievement", range_title: name, marker_description: description, marker_priority: 0, range_duration: "0" }`.
- If the EResult is not 1, retry once with `type: 5` (UserMarker, `marker_icon: "steam_marker"`) and log both.
  Whether the server accepts a user-originated `Event` is unverified (U5).

#### A2.4 Previews and the test button
- The per-tier **Preview** buttons (`previewTier`) must **not** capture. Before
  `TestAchievement`, set `suppressCapturesUntil = Date.now() + 10_000`, consumed
  by the next unlock (same pattern as `forced`).
- **Test captures** (new button, A3.4) runs the full pipeline for real, on the running game.

### A3. File-by-file changes (`enhanced-achievements/`)

#### A3.1 `frontend/capture/plan.ts` (new, pure)

No Steam, SDK or settings imports, because `npm test` runs it under plain Node,
like `theme/theme.ts`. Exports:

```ts
export const CAPTURE_RANGES = { 'screenshot.delay_ms': {min:0,max:5000,step:100}, 'recording.duration_s': {min:5,max:60,step:5}, 'recording.delay_ms': {min:0,max:5000,step:100} } as const;
export const SETTLE_MS = 1500, MAX_CLIP_MS = 120_000, FRESH_MS = 1500;
export const ENTRY_TYPE = { Event: 2, UserMarker: 5 } as const; // ETimelineEntryType wire values

export interface CaptureSettings { screenshot: { enabled: boolean; delayMs: number }; clip: { enabled: boolean; durationS: number; delayMs: number }; marker: { enabled: boolean } }
export function resolveCaptureSettings(base: CaptureSettings, tier?: { screenshot?: Record<string, unknown>; recording?: Record<string, unknown> }): { settings: CaptureSettings; warnings: string[] };
export function anyEnabled(s: CaptureSettings): boolean;
export function gameIdCandidates(appid: number): { native: string; shortcut: string };
export function unlockOffsetMs(nowOffsetMs: number, nowMs: number, rtCreatedS: number | undefined): number;

export interface TimelineSnapshot { timelineId: string; gameId: string; nowOffsetMs: number; startBeforeZeroMs: number; recording: { startOffsetMs: number } | null }
export interface UnlockInfo { appid: number; name: string; description: string; nowMs: number; rtCreatedS?: number }
export type Action =
  | { kind: 'screenshot'; sendAfterMs: number; targetOffsetMs: number }
  | { kind: 'clip'; sendAfterMs: number; startOffsetMs: number; endOffsetMs: number; name: string }
  | { kind: 'marker'; sendAfterMs: 0; time: number; name: string; description: string };
export interface Plan { actions: Action[]; skipped: { kind: 'screenshot' | 'clip' | 'marker' | 'all'; reason: string }[]; shortcut: boolean | null }
export function planCaptures(s: CaptureSettings, unlock: UnlockInfo, timeline: TimelineSnapshot | null): Plan;
export function mergeClip(pending: Extract<Action,{kind:'clip'}>, next: Extract<Action,{kind:'clip'}>, count: number): Extract<Action,{kind:'clip'}>;
```

Override validation: same types and `CAPTURE_RANGES` as the settings. A bad
field is ignored and a warning returned. Never throw. `recording.add_timeline_marker`
is not overridable per tier; themes.md does not document it.

#### A3.2 `frontend/steam/recording.ts` (new, the only file that touches Steam's recording objects)
- `initRecording(): boolean`. One `findExports` scan at startup (guardrail 3),
  using the signature in A1.1. Must resolve to exactly one export, otherwise
  `warn` and return false: captures inactive, the rest of the plugin unaffected.
- `snapshotTimeline(appid): { snap: TimelineSnapshot | null; reason?: string }`.
  Reads `window.g_GRS` at call time; it must never be cached, because Steam
  could recreate it. Reasons: `recording-store-unavailable`, `no-running-timeline`.
- `liveOffset(tid)` and `recordingStart(tid)`, read at send time for the clamps.
- `takeScreenshot(req)`, `saveClip(req)` and `addTimelineEntry(req)` each return
  `{ ok: boolean; eresult: number; body?: unknown; error?: string }`. They never throw.
- `runningGameAppid(): number | null`, for the test button. It takes the first
  running timeline's game id and applies `appid = (gid & 0xFFFFFFFFn) === 0x02000000n ? gid >> 32n : gid`.
- `recordingDiagnostics()`: `{ service: boolean; grs: boolean; activeTimelines: number; running: {gameId, recording: boolean}[] }`.

#### A3.3 `frontend/capture/captures.ts` (new)
- `onUnlock(n, tier)`: checks dedupe and suppression, `resolveCaptureSettings`
  (base from `setting(...)`, overrides from `activeTheme()?.theme.tiers[tier]`),
  `anyEnabled`, `snapshotTimeline`, `planCaptures`, then schedules each action
  with `setTimeout`. Applies the clip clamps at send time.
- Dry-run: `setCaptureDryRun(on)` is in-memory only (not a setting). In dry-run,
  actions are logged with their would-be requests and no RPC is sent.
- Log: a ring buffer of the last 20 decisions.
  `{ at, appid, tier, gameId?, shortcut?, dryRun, actions: [{kind, request, eresult?}], skipped }`.
  Exported as `captureLog()`.
- `logger.info` one line per unlock (planned or skipped with reason).
  `logger.warn` per failed RPC with its EResult. No toasts, no UI errors.
- `suppressNextCaptures(ms)` for previews. `disposeCaptures()` clears timers.

#### A3.4 `frontend/steam/notifications.ts`
- Add `rtCreated?: number` and `notificationID?: number` to `SteamNotification`.
  Add `achievement_id(): string` to `AchievementData`.
- In `installSoundHook`, add the one line from A1.7, wrapped in its own `try/catch` (log and continue).
- `previewTier`: call `suppressNextCaptures(10_000)` before `TestAchievement`.
- New `fireTestUnlock(appid: number, name: string): boolean`. It builds the payload with
  `achievementConfig.proto.fromObject({ appid, achievement_id: 'EA_TEST', name, description: 'Enhanced Achievements capture test', achieved: true, global_achieved_pct: 50, rtime_unlocked: nowS })`.
  It dispatches with `store.OnNotification(id, achievementType, bytes)`
  (steam-components § Resolution signatures, "Test toast"), where
  `id = store.m_nNextTestNotificationID++` if that is a number, otherwise
  `Date.now() & 0x7fffffff`. It does not use `TestAchievement`: that awaits
  `RequestAppDetails(appid)`, which is unverified for shortcut appids.

#### A3.5 `frontend/settings/settings.ts`
- `RANGES`: take the three capture ranges from `CAPTURE_RANGES` (single source).
- No new keys. The Millennium#903 workaround is unchanged: reads, writes and
  listeners go through the existing `apply` / `write` / `sync`.

#### A3.6 `settings.json`
- Set `screenshot.enabled`, `recording.enabled` and `recording.add_timeline_marker` to `false`. Keep the other values.

#### A3.7 `frontend/settings/settings-panel.tsx`
- Remove `phase7` and the `disabled` flags. Put the captures in a
  `DialogControlsSection` with header **"Captures on unlock"**.
- Each slider is `disabled` while its parent toggle is off (read with `useSetting`).
- Descriptions:
  - Screenshot: "A frame from Steam's game recording, `delay` after the unlock. Needs Game Recording on."
  - Clip: "Saves the last `length` seconds, ending `delay` after the unlock."
  - Marker: "Adds an achievement marker for non-Steam games (Steam already marks its own games)."
- A section description shows `recordingDiagnostics()` once per render (no timer):
  - "Game Recording API not found on this Steam build: captures are off.", or
  - "No game is being recorded right now."
- **Test captures** `ButtonItem`: "Fire a test unlock for the game that is being
  recorded now. Creates a real screenshot/clip with your current settings."
  - Calls `runningGameAppid()`, then `fireTestUnlock`.
  - With no running timeline it shows "Start a game with Game Recording on first."
    in the description and does nothing.
- Only SDK components, no CSS (plan § 5 Step 2).

#### A3.8 `frontend/index.tsx`
- `init()`: call `initRecording()` after `initNotifications()` succeeds (its failure only disables captures).
- New named exports for tests, on `PLUGIN_LIST`: `captureLog`, `setCaptureDryRun`, `recordingDiagnostics`, `fireTestUnlock`.

#### A3.9 `themes.md`
- § Capture overrides: document the A2 semantics. The screenshot is a recording frame at unlock + delay. The clip ends at unlock + delay. Both need Game Recording.
- § Plugin settings: show the new defaults (off). Replace "(Phase 7)".

### A4. Tests

**`tests/capture.test.ts`** (pure, `npm test`):
1. `gameIdCandidates(4271448594).shortcut === "18345732017808736256"`, and
   `gameIdCandidates(435150).native === "435150"`.
2. `resolveCaptureSettings`: a tier override wins; out-of-range or wrong-type fields are ignored with a warning; `add_timeline_marker` is not overridable.
3. `unlockOffsetMs`: fresh (<1500 ms) gives `nowOffset`; a queued toast 6 s old gives `nowOffset - 6000`; never negative.
4. `planCaptures`:
   - `null` timeline: all skipped, `no-running-timeline`.
   - `recording: null`: screenshot and clip skipped, marker kept (shortcut).
   - Native game: marker skipped, `steam-marks-achievements`.
   - Clip start clamped to `recording.startOffsetMs` and to 0.
   - `sendAfterMs = delay + SETTLE_MS`.
   - All disabled: empty actions and no skip noise.
5. `mergeClip`: end extended, capped at `start + MAX_CLIP_MS`, name `"A (+1)"`.

**`tests/captures.mjs`** (live CDP, no game needed, creates nothing):
1. `recordingDiagnostics()` returns `service: true`, `grs: true`.
2. Save current settings. Then `setSetting` screenshot/recording/marker to `true`, and `setCaptureDryRun(true)`.
3. `NotificationStore.TestAchievement(480)`. Wait for the toast (the same loop as `smoke.mjs`).
4. Assert the newest `captureLog()` entry: `appid 480`, `skipped[0].reason === 'no-running-timeline'`, no `eresult` on any action.
5. `previewTier('normal')`: assert **no** new log entry (suppressed).
6. Optional, `RUNNING=1` (user starts a recorded game first):
   - call `fireTestUnlock(runningGameAppid)` in dry-run;
   - assert a planned screenshot and clip with a `timeline_id`, and the right `game_id` form;
   - assert no RPC was sent.
7. Restore settings (delete the keys it set) and `setCaptureDryRun(false)`.

Then run the existing `tests/smoke.mjs`, `tests/tiers.mjs`, `tests/settings-sound.mjs`,
and core Routines 1–3 (`scratch/test_nav_cycle.js`, `scratch/check_all_tabs.js`).
All must still PASS.

### A5. Docs to update (Part A)
- `docs/steam-components.md` § "Game Recording RPCs & timeline markers": replace it with A1.1–A1.6. Include the signatures, the request shapes, TakeScreenshot = frame from recording, the entry-type enum, Steam's native achievement entries, `g_GRS`, and the EResults.
- `docs/steam-architecture.md`: in the Game Recording rows, add `window.g_GRS` (`CGameRecordingStore`) and the loader methods. State that `SteamClient.Screenshots` cannot trigger a capture.
- `docs/plans/enhanced-achievements-plan.md` § 2D and § 6: point to this plan. Fix "SteamClient.Screenshots" and "golden marker".
- `docs/plans/enhanced-achievements-plan.md` § 5 guardrail table: add row 9, "Capture RPCs only in timer callbacks, only when enabled; the hook does O(1) scheduling".

---

## Part B: alpha readiness

### B0. Current state (measured 2026-09-24)

| | EA | EN |
| --- | --- | --- |
| `npm run check` | green | green |
| `npm test` | 10/10 | 9/9 |
| `npm run build` | green | green |
| Lint | **no lint setup** (only `tsc --noEmit`, strict) | same |
| Version | `0.1.0` in plugin.json and package.json. CHANGELOG only `[Unreleased]` | same |
| LICENSE | **none anywhere in the repo** | none |
| Bundled theme | Default `steam_ps_exemple` points at `C:/auto/res/...` (this machine only). `theme_exemple.json` points at `res/...` files that do not exist | `steam_midnight` has **no assets** (fine) |
| README | No "how to test". Says captures are "planned". Claims the in-game overlay works (unverified). Install is one line | No Install section. "Big Picture … not yet verified" is **stale** (verified 2026-09-24) |
| CHANGELOG | OK | **Missing** the Big Picture toast-window fix (only in the root CHANGELOG) |
| Tests | Live tests default to the `-dev` plugin name | Same, and `sound-duration.mjs` defaults to `C:/auto/res/sfx/ps5_trophy.mp3` |
| Install path | `dev.ps1` deploys only a `-dev` copy. Nothing installs the release name or makes a zip | same |

### B1. Version (both plugins)
- `0.1.0-alpha.1`, valid semver prerelease. The repo convention is SemVer plus
  Keep a Changelog, and there is no schema check on `version` in `@steambrew/ttc`.
- Run `npm version 0.1.0-alpha.1 --no-git-tag-version` (updates package.json and package-lock.json). Edit `plugin.json` by hand.
- CHANGELOG: move `[Unreleased]` into `## [0.1.0-alpha.1] - <date>` and leave an empty `[Unreleased]`.
  - EA adds the Phase 7 entries.
  - EN adds a "Fixed: Big Picture toasts now styled" entry (from the root CHANGELOG).

### B2. Default theme without local assets (EA)
- New `themes/steam_tiers.json`, asset-free except its own SVGs:
  - Tier look from colours: normal bronze `#cd7f32`, magic silver `#c0c0c0`,
    rare gold `#e5a93c`, exceptional platinum/cyan `#40c4ff`, as border and glow.
    Backgrounds come from `theme_exemple.json`.
  - `icons.achievement: true` (Steam's image).
  - `icons.rarity`: new **original** SVGs written by the implementer (plain trophy
    silhouettes, one fill per tier) in `themes/assets/trophy_{bronze,silver,gold,platinum}.svg`.
    They are license-clean because we author them.
  - `icons.system: false`, unless themes.md says `true` maps to a Steam-owned asset.
  - **No `sound`**, so Steam's chime. Do not bundle PS/Xbox sounds: they are copyrighted.
- `settings.json`: `"theme": "steam_tiers"`. Update the themes.md example.
- Move `themes/steam_ps_exemple.json` and `themes/theme_exemple.json` to
  `examples/`, which `dev.ps1` does not deploy and the backend does not list.
  - Rewrite their absolute paths as relative `assets/...`.
  - Add `examples/README.md`: "bring your own assets; copy into your user themes folder".
  - Remove the `C:/auto` paths from the repo.
- `tests/theme.test.ts`:
  - load examples from `examples/`;
  - add **"every bundled theme's assets exist, relative to `themes/`"**, which fails on any absolute or missing path.
- EN `tests/theme.test.ts`: the same asset-existence test for `themes/`.

### B3. Install and packaging (both `dev.ps1`)
- `-Release`: build with the real `name` (no `-dev` rewrite), deploy to
  `plugins/<name>`, enable it, and disable `<name>-dev` in `config.json`.
  It uses the same file set (`plugin.json`, `.millennium/`, `backend/` minus `_lib`, `themes/`).
- `-Package`: build and zip that file set into `dist/<name>-<version>.zip`
  (`dist/` is already gitignored). The zip's top folder is `<name>/`. Never include `research/`, `examples/` or `tests/`.
- Keep `-SteamPath` discovery. Never hardcode (ADR-0011).

### B4. Tests portability
- Every live `tests/*.mjs` resolves the plugin name like `settings.ts`: env
  override, else `-dev` if it is in `PLUGIN_LIST`, else the release name.
- EN `sound-duration.mjs`: when `EN_TEST_SOUND` is unset, write a generated
  0.3 s 440 Hz WAV into `os.tmpdir()` and use it (absolute paths are allowed). Delete it afterwards.
- Add `"verify": "npm run check && npm test && npm run build"` to both package.json files.
  Do **not** add ESLint for the alpha, because none exists in the repo. `tsc` strict is the lint gate.

### B5. READMEs (user-facing; plugins.md § 6)

**EA and EN** each get these sections, in order:
1. What it does.
2. **Install (alpha)**, from a zip (B3 `-Package`) or from source (`npm install`, then `powershell -ExecutionPolicy Bypass -File dev.ps1 -Release`).
3. Settings table.
4. **How to test**: numbered, doable in five minutes without a game.
   - EA: Preview each tier; toggle banner and sound; Reload after editing a theme; Test captures with a recorded game.
   - EN: Preview each category; toggle style, sound and duration; switch Desktop and Big Picture.
5. Themes.
6. **Known limitations**:
   - The in-game overlay is unverified.
   - Friend and message toasts depend on Steam's Friends notification settings (EN).
   - Millennium#903: settings save but Millennium may log an error. Handled.
   - Desktop toast frame is 284×71.
   - Captures need Game Recording, and none happen when in-game toasts are disabled (EA).
   - Steam already marks achievements on its own games' timelines (EA).
7. Uninstall.

EA: replace "Screenshots and clips … planned". EN: drop the stale "Big Picture not yet verified".

### B6. LICENSE
The user's intent is **not stated anywhere** in the repo. The only mention is the
plugins.md § 6 checklist item, so this is **question Q1**. On an answer, add
`LICENSE` to each plugin folder and to the repo root, and add `"license"` to each package.json.

### B7. Workspace docs
- Root `README.md` plugin table:
  - EN "desktop verified" becomes "desktop + Big Picture verified, alpha".
  - EA "auto-captures ahead" becomes "captures (alpha)".
- `TASK.md`: Phase 7 becomes implemented, with the remaining items only in the User test checklist. Publish prep is done except the license.
- Root `CHANGELOG.md`: add a milestone entry.

### B8. Order of work
A3.1, then A4 (unit tests), A3.2 to A3.9, B2, B1, B3, B4, B5, B7, A5, then run the
full suite: `npm run verify` in both plugins, then deploy with `dev.ps1`
(graceful restart, **no SharedJSContext reload**), then all live `tests/*.mjs`
for EA and EN, then `scratch/test_nav_cycle.js` and `scratch/check_all_tabs.js`.
B6 waits on Q1.

---

## User test checklist (only the user can verify)

Each item says what to record if it fails. The log is the Millennium log,
"Enhanced Achievements" lines; `captureLog()` is readable over CDP.

- **U1. Real unlock, native Steam game, background recording on**, with all three captures enabled:
  - a screenshot appears under that game in Steam's screenshots;
  - a clip named after the achievement appears in Recordings, about 15 s ending at the unlock;
  - is the toast visible in the screenshot? If yes, report it; the default `screenshot.delay_ms` or `SETTLE_MS` will change;
  - if a capture failed with EResult 79 or 8, report it: the capture is being sent before the recording has written that moment, so `SETTLE_MS` (1.5 s) must go up.
- **U2. Recording off**, same game: nothing is created. The log says `no-running-timeline` (or `recording-not-active`).
- **U3. Steam's own marker:** after U1, open the game's timeline. Is there an achievement marker from Steam at the unlock, and none from us?
- **U4. Several unlocks within about 10 s:** one clip (coalesced), with a name like "A (+2)".
- **U5. Non-Steam shortcut** with recording on: press **Test captures**.
  - Screenshot and clip land in the shortcut's folders and show up in `non-steam-games-activity` (Your Stuff, Activity).
  - A marker appears. Is it the trophy icon (Event accepted) or a plain marker (fallback)?
- **U6. In-game toasts disabled:** confirm no captures (known limitation; see Q5).
- **U7. In-game overlay (both plugins):** themed achievement banner and sound during a real game. EN-styled toasts in the overlay.
- **U8. EN friends/messages:** enable Steam's Friends notifications, then check a friend-online and a message toast are styled.
- **U9. Fresh install** from the `-Package` zip on the release name: defaults load, `steam_tiers` shows, Preview works, no absolute-path warnings in the log.
- **U10. Cleanup:** delete the U1, U4 and U5 test captures through Steam's UI.

---

## Open questions for the user

1. **Q1 License:** which one? MIT is the common choice for Millennium plugins. The LICENSE file waits on your answer.
2. **Q2 Version string:** `0.1.0-alpha.1` OK?
3. **Q3 Capture defaults off**, and the marker only for non-Steam games (Steam already marks its own games' achievements). OK?
4. **Q4 Your PS5 theme** (`C:/auto/res/...`) leaves the bundled set. Should the implementer copy your current version into `<Steam>/millennium/config/enhanced-achievements/themes/` on this machine so it keeps working, and select it?
5. **Q5 Captures with in-game toasts disabled** need one more O(1) prototype wrap (`NotificationStore.OnNotification`). Is that wanted now, or later?
