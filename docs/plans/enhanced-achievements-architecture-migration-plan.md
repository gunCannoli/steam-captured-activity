# Plan: enhanced-achievements Architecture Migration (one owner per Steam target, safety net)

**Status:** Accepted 2026-09-29. **E0a and E0b are `Ready`** (packaged as patches and dry-run, § 6).
**E1a–E3 are `Build`** (detailed specs with binding contracts and named tests, § 0.9).
**Kind:** Umbrella plan plus execution manual, modelled on the
[steam-cartridges migration](steam-cartridges-architecture-migration-plan.md) but deliberately smaller: no
`GameRecord`, no backend services, one architecture doc instead of one per layer.
**ADR:** [ADR-0043](../decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net) (accepted).
**Architecture doc (created by E0a):** [docs/enhanced-achievements/architecture.md](../enhanced-achievements/architecture.md).
**Tracking:** [TASK.md](../../TASK.md) · **Docs index:** [steam-architecture.md](../steam-architecture.md)

**Written for:** the agent that executes the steps (assume it follows instructions literally and must not
improvise), and the verifier who runs the live checks after each step.

---

## 0. Execution manual (read all of § 0 before touching anything)

### 0.1 How to execute a step

You execute **one step per session**: the first row in § 0.2 whose status is `Ready` or `Build`.
A `Ready` step is a patch: follow this section. A `Build` step is a spec you implement yourself: follow
§ 0.9 instead of actions 3 and 4 below. A `Spec` or `Blocked` step is not for you: stop and report it.

1. Read § 0 completely, then that step's section in § 7 completely, then § 7.0 if the step is `Build`.
2. Run § 0.4 (preconditions). Every expected output must match **exactly**. If one does not, apply § 0.7
   (failure rule) and stop.
3. Do the step's numbered actions in order. After **each** action, run the command it gives and compare
   the output with the expected output **exactly**.
4. Never do anything the step does not say:
   - Do not fix other bugs you notice. Add them to § 11 (known issues) instead.
   - Do not rename, reformat or "clean up" code. Do not add logging.
   - Do not change a test to make it pass. Do not touch files outside the step's file list.
5. Update the docs the step lists (always: `enhanced-achievements/CHANGELOG.md` under `## [Unreleased]`,
   the root `CHANGELOG.md`, `TASK.md`, `docs/enhanced-achievements/architecture.md`, and the step's row in § 0.2).
6. Commit exactly as § 0.6 says. Push. Stop. Report the step id and every expected output you saw.
7. Do **not** run the live verification (§ 0.5) unless the step says "implementer runs live verification".
   Write in your report: `Live verification pending: § 0.5 for step <id>`.

If an instruction here conflicts with anything you remember from elsewhere, this plan wins. If it
conflicts with an ADR or a [plugins.md](../plugins.md) guardrail, stop and report the conflict. Do not choose.

### 0.2 Status board

| Status | Meaning | Who acts |
| --- | --- | --- |
| `Ready` | a patch, dry-run: check it, apply it, check every expected output | implementer, § 0.1 |
| `Build` | detailed spec with binding contracts and named tests; the code is not written yet | implementer, § 0.9 |
| `Done` | executed and live-verified | — |
| `Blocked (<why>)` | waiting on the named thing | whoever it names |

| Step | What | Status |
| --- | --- | --- |
| E0a | Safety net: kill switches, error budget, safe mode, fail-open hooks; `claims()` O(1) | `Done (live pending)` |
| E0b | Test harness: architecture test (ratchet, pure files, one owner per target, RPC, drift), `npm run test:live` | `Ready` |
| E1a | Kernel (notification types and ids, event bus, `Surface` contract) and the pure tier and timing functions | `Build` |
| E1b | Split `steam/notifications.ts`: store discovery, the one notification hook, the unlock sensor, surfaces `sound`, `duration`, `toasts` | `Build` |
| E1c | Surfaces `banner` and `captures` (moves), surface runner complete, allowlist empty | `Build` |
| E2 | The scheduler owns banner lifetime: nothing admitted from a render, one `whenShowing` API for sounds | `Build` |
| E3 | Close: docs, known issues, plan complete | `Build` |

Order is fixed: never start a row while an earlier row is not `Done`. A row becomes `Done` only after the
verifier's live PASS (§ 0.5).

### 0.3 Environment and commands (this machine)

| Thing | Value |
| --- | --- |
| Repo | `C:\game\millennium` (git, branch `main`) |
| Plugin source | `C:\game\millennium\enhanced-achievements` |
| Steam | `C:\game\steam` (DevTools `http://127.0.0.1:8080`; use `127.0.0.1`, never `localhost`) |
| Deployed dev plugin | `C:\game\steam\millennium\plugins\enhanced-achievements-dev` (created by `dev.ps1`) |
| Node | v24 (built-in `WebSocket`; the live scripts need no npm packages) |
| Sibling plugins | `C:\game\millennium\steam-cartridges`, `C:\game\millennium\enhanced-notifications` (the drift tests read them) |

Commands, run from `C:\game\millennium\enhanced-achievements` unless stated otherwise:

| Command | Expected output (exact) |
| --- | --- |
| `npm run check` | the two npm banner lines `> enhanced-achievements@1.0.0 check` and `> tsc --noEmit`, then nothing; exit code 0 |
| `npm test` | ends with `ℹ tests N` / `ℹ pass N` / `ℹ fail 0` / `ℹ skipped 0`, N from the table below. One `MODULE_TYPELESS_PACKAGE_JSON` warning per test file is normal; ignore them |
| `npm run build` | contains `build Succeeded`; ignore the `@steambrew/ttc@2.8.7 requires update` nag |
| `git status --short` (repo root) | empty before you start |

Unit test count `N` after each step (dry-run for E0a/E0b; exact for the `Build` steps if you add exactly the
named tests): **baseline 65 · E0a 75 · E0b 82 · E1a 93 · E1b 106 · E1c 107 · E2 111 · E3 111**.

PowerShell note: run scripts as `powershell -ExecutionPolicy Bypass -File <script>`.

### 0.4 Preconditions for every step

Run from `C:\game\millennium`:

1. `git status --short` → no output.
2. `git log -1 --format=%s` → the subject of the last commit on `main`. Write it in your report.
3. `cd enhanced-achievements; npm run check` → as in § 0.3.
4. `npm test` → as in § 0.3, with N for the **previous** step.
5. For a `Ready` step: its patch hash and `git apply --check`, as the step's action 1 gives them. Any error
   from `git apply --check` means the tree changed since the dry-run: the step is stale. Stop (§ 0.7).

### 0.5 Live verification (the verifier runs this after every step)

It deploys the dev plugin and restarts Steam. The implementer runs it only when a step says so.

1. From `C:\game\millennium\enhanced-achievements`: `powershell -ExecutionPolicy Bypass -File dev.ps1`
   → ends with `Deployed enhanced-achievements-dev.` and `Devtools: http://localhost:8080`.
2. Wait until `curl -s http://127.0.0.1:8080/json` lists a target titled `SharedJSContext`, then 20 s more for
   the plugin to load. For E0a only (before `npm run test:live` exists): write down the user's settings with
   `node tests/cdp.mjs "PLUGIN_LIST['enhanced-achievements-dev'].allSettings()"`, select a theme with
   `node tests/cdp.mjs "PLUGIN_LIST['enhanced-achievements-dev'].setSetting('theme','ps5').then(() => true)"` → `true`,
   and after the checks set every noted value back with `setSetting`. From E0b on, `npm run test:live` snapshots and
   restores the settings itself.
3. Run the checks for the step, from `C:\game\millennium\enhanced-achievements`:

| From step | Command | PASS criterion |
| --- | --- | --- |
| E0a only | `node tests/smoke.mjs` | 3 lines `PASS`, no `FAIL` |
| E0a only | `node tests/tiers.mjs` | 6 lines `PASS`, no `FAIL` |
| E0a only | `node tests/queue-stress.mjs` | 16 lines `PASS`, no `FAIL` (it leaves theme `""` and queue off: set the user's theme back) |
| E0a only | `node tests/safety.mjs` | 13 lines `PASS`, no `FAIL` |
| E0a only | `node tests/captures.mjs` | 8 lines `PASS`, 1 line `SKIP  RUNNING=1 scenario …`, no `FAIL` |
| E0b on | `npm run test:live` | `PASS  smoke.mjs`, `PASS  tiers.mjs`, `PASS  safety.mjs`, `PASS  queue-stress.mjs`, `PASS  captures.mjs`, `PASS  settings-sound.mjs`, `SKIP  bigpicture.mjs` (desktop), `PASS  settings restored  (…)`; exit 0 |
| E0b on, Big Picture | select the theme as in step 2, open Big Picture with `node tests/cdp.mjs "(SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture'), true)"`, wait 10 s, then `node tests/bigpicture.mjs` | 2 lines `PASS`, no `FAIL`. Then leave Big Picture with `node tests/cdp.mjs "(SteamClient.UI.ExitBigPictureMode(), true)"` (Steam restarts its UI; wait for the `Steam` target) and restore the theme |
| every step | `node tests/cdp.mjs "PLUGIN_LIST['enhanced-achievements-dev'].safetyDiagnostics()"` (from E0a on) | `safeMode: false`, `tripped: []`, `errors: {}` |

4. If any check FAILs, or Steam shows its "restart the UI" dialog: stop. Put Steam back as the user runs it,
   then report: `powershell -ExecutionPolicy Bypass -File ..\start-steam-dev.ps1 -KillOnly`, then remove
   `"enhanced-achievements-dev"` from `plugins.enabledPlugins` in `C:\game\steam\millennium\config\config.json`
   and add `"enhanced-achievements"` back if `dev.ps1` removed it (change nothing else), delete
   `C:\game\steam\millennium\plugins\enhanced-achievements-dev`, and start Steam with
   `powershell -ExecutionPolicy Bypass -File ..\start-steam-dev.ps1`. This is the only config edit this plan allows.

### 0.6 Commit procedure

1. `git add` **only** the paths the step lists (never `git add -A` or `git add .`).
2. `git status --short` → only those paths are staged (`M `, `A `, `D `, `R `), nothing else is listed.
3. `git commit -F -` with the message the step gives, ending with a blank line and
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (this repo is exempt from AGENTS.md Routine 6;
   nothing here goes upstream).
4. `git push origin main` → ends with `main -> main`.

### 0.7 Failure rule

- Run a failing command at most **twice**. On the second failure, stop.
- Append to `TASK.md` § "Active failures & blockers": the step id, the command, its output trimmed to 30 lines,
  and the time.
- Revert your uncommitted edits: `git checkout -- enhanced-achievements docs/enhanced-achievements` and delete any
  file the step created (`git status --short` lists them as `??`). If you deployed, restore Steam as § 0.5 step 4.
- Do not retry with changes, edit around the failure, weaken a test, or skip ahead.

### 0.8 Banned actions (all steps)

- No deploy or Steam restart unless the step or § 0.5 says so. No SharedJSContext reload (`location.reload()`, Ctrl+R).
- No probe or throwaway plugins. No changes to the user's library, collections or shortcuts.
- No edits to Millennium's `config.json` or plugin config, except § 0.5 step 4.
- No `npm install`, upgrade or new dependency. No `git push --force`, no `--no-verify`, no history rewriting.
- No edits to `steam-cartridges/` or `enhanced-notifications/` (the drift tests compare against them).
- From E0b on: no new cross-area import outside `tests/architecture-allowlist.json`; the allowlist never grows.
  Regenerate it (`ARCH_WRITE_ALLOWLIST=1 npm test`) only in a step that says so, and paste its before/after.
- From E0b on: no new Steam write outside the file `OWNERS` names for it (tests/architecture.test.ts).
- Nothing called from a Steam render, getter, prototype hook or jsx handler may start work, emit an event or
  write a Steam store ([guardrail 17](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components)).
  The one exception is D4 in § 7.0 (the notification hook defers one event per unlock).
- No mixing a file move and a behaviour change in one action. No editing the PASS criteria in § 0.5.

### 0.9 How to execute a `Build` step

1. Read § 0, § 4 (target architecture), § 7.0 (decisions D1–D10) and the step's section. Run § 0.4.
2. **Files:** create, change, move or delete only the files the step's **Files** line names, plus the docs of
   § 0.1 action 5. Any other file: stop and report.
3. **Contracts are binding.** Names, signatures, payload shapes, `touches` strings and feature ids in § 4 and
   the step are not yours to change. You may add private helpers. If a contract cannot be met, stop (§ 0.7)
   and write why in `TASK.md` § Active failures; never adapt the contract.
4. **Tests first.** Write the step's named tests with the exact names given, run them and see them fail, then
   implement until they pass. Never edit or weaken an existing test, except the edits the step names.
5. Implement the step's numbered items in order. After each item: `npm run check` (exit 0) and `npm test`
   (`ℹ fail 0`). The architecture test must pass after every item: a new cross-area import means the design was
   misread; fix the import, never the allowlist.
6. **Moves:** use `git mv` so history follows the file, and move in an item of its own (no behaviour change in it).
7. Exit: run every command in the step's **Exit** line and paste the outputs in your report, with the test count
   and the allowlist before and after.
8. Docs per § 0.1 action 5, then commit per § 0.6 with the step's message. Push.
9. Ambiguity: if the spec allows two readings, stop and ask. Do not pick one.

---

## 1. Why: root cause of the regression pattern

Evidence from the tree at `cdc656d` (2026-09-29). Line numbers are for that commit.

### 1.1 One hook does six jobs

`frontend/steam/notifications.ts` (482 lines) holds module-level mutable state (`store`, `proto`,
`achievementType`, `achievementConfig`, `originalDurationMs`, three WeakMaps/WeakSets) and, inside the single
`PlayNotificationSound` wrapper at lines 163–210, it:

1. decides whether the call is Steam's own (line 166);
2. computes and memoises the rarity tier (`tierFor`, lines 119–144);
3. schedules captures (`onUnlock`, line 173) — the phase-7 A1.7 exception to guardrail 5;
4. checks game completion and schedules the synthetic 100% toast with `setTimeout` (lines 178–189);
5. defers a queued banner's sound by subscribing to the banner scheduler (lines 196–208);
6. replaces Steam's chime by overriding `ChooseSound` on the store instance for one call (lines 212–240).

The same file also discovers the achievement eType (250–281), writes the toast duration (308–312), and posts
synthetic toasts for previews, the 100% toast and test unlocks (330–450). Every fix to one of these jobs is an
edit inside the other five.

### 1.2 Every recorded bug is "two owners of one thing" or "state changed from the wrong place"

From `enhanced-achievements/CHANGELOG.md` § [1.0.0] "Fixed":

| Bug | Class | What would have prevented it (this plan) |
| --- | --- | --- |
| `Banner` returned before its hooks; React threw "rendered more hooks" when a queued toast got its turn, and the error boundary showed Steam's unpinned toast | state changed from the wrong place (render) | E2: nothing admitted from a render; E0a: the boundary counts errors, so a repeating failure switches the banner off instead of flashing Steam's toast every time |
| Our `MoveTo` timer raced Steam's per-frame `MoveTo`; whichever wrote last won | two owners of one target | E0b `OWNERS`: one writer per target, enforced by a test |
| Rapid previews swapped tiers (a shared time-window `forced` flag) | state from the wrong place | E1a: the tier is a pure function of the notification's own id and rarity, unit-tested |
| Queued toasts' sounds all played on arrival | two owners of "when does this toast start" | E2: the scheduler is the only owner; the sound asks `whenShowing` |
| The synthetic 100% toast was scheduled twice (Steam calls `PlayNotificationSound` more than once per toast) | the same event handled in two places | E1b: the sensor emits `achievement.unlocked` once per notification; unit-tested |
| Millennium core restored a stale `jsx` and dropped our patch | Steam-side, not ours | stays: the self-healing `jsx-hook.ts`; E0b adds a drift test so the copy shared with steam-cartridges cannot diverge |

### 1.3 No safety net

`frontend/index.tsx:30–38`: `init()` returns early only if `initNotifications()` fails. There is no kill switch,
no error budget and no safe mode. Errors are caught and logged where they happen (the jsx handler at
`toast-patch.ts:89` has no catch at all: a throw there would propagate into Steam's `jsx` call for the toast
dispatcher), but nothing counts them, so a feature that fails on every toast keeps failing on every toast until
the user uninstalls the plugin.

### 1.4 Import cycles

`steam/notifications.ts` → `capture/captures.ts` → `steam/notifications.ts` (types), and `steam/toast-patch.ts` →
`banner/themed-toast.tsx` → `steam/notifications.ts`. The banner renderer depends on the file that owns the sound
hook; the capture scheduler is called from inside it. There are 15 cross-area imports; nothing stops a 16th.

### 1.5 A render starts work

`frontend/banner/themed-toast.tsx:148–150`: `useState(() => admit(key, timing.totalMs, queued, …))` registers
the toast with the scheduler and starts its timer **during a render** in Steam's toast window. React may render a
component more than once, or discard a render, so a discarded render can leave a scheduler entry whose banner
never mounts. It is a direct instance of the rule in
[guardrail 17](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components).

### 1.6 `claims()` is documented O(1) but is not

`frontend/claims.ts:21` says "O(1)". It calls `toastPatchInstalled()` (`steam/toast-patch.ts:68–70`), which
calls `hook.diagnostics()`, which walks up to 64 wrappers of the jsx chain and, when a foreign wrapper is on top,
calls `runtime.jsx(SENTINEL, {})`. enhanced-notifications calls `claims()` from its own sound hook on every toast
(`enhanced-notifications/frontend/steam/notifications.ts:79`). Fixed in E0a.

### 1.7 Nothing can switch a patch off

`disposeNotifications()` (`notifications.ts:479`), `disposeToastPatch()` (`toast-patch.ts:95`) and
`disposeCaptures()` (`capture/captures.ts:188`) exist but have no caller. E1b/E1c wire them as `Surface.uninstall`.

### 1.8 Tests

`npm test` (65 tests, 4 files) covers the pure modules only. Eight live scripts are run by hand; `smoke.mjs`,
`tiers.mjs` and `bigpicture.mjs` need a theme selected but do not select one, so they FAIL on the shipped default
("Steam default"); `queue-stress.mjs` resets the user's theme to `""` when it ends; `settings-sound.mjs` resets
every setting. There is no architecture test and no single command for the live set.

**Ruled out:** a rewrite (the pure modules — themes, queue, timing, geometry, capture plan — are sound and
tested); a shared npm package for the files the plugins copy (it changes how Millennium builds plugins; the drift
test gives the same safety for much less); porting steam-cartridges' `GameRecord`, backend services and per-layer
docs (this plugin has no per-game data model and a 170-line backend that only reads theme files).

## 2. What this will not fix

Steam-side changes stay unpredictable: Millennium restoring `jsx`, a Steam update that changes the toast stack,
the protobuf classes or `NotificationStore`. After this migration those failures are **contained** (one feature
trips, Steam's stock toast returns), **visible** (`safetyDiagnostics()`, `npm run test:live`) and **local to fix**
(one surface's files). Banners, sounds and captures still never trigger when Steam's own toasts are off (by
design, phase-7 Q5).

## 3. Options considered

| Option | Verdict |
| --- | --- |
| Leave the structure, add tests only | Rejected: tests catch regressions late; the six jobs in one hook stay coupled |
| Port the full steam-cartridges architecture (record, services, per-layer docs) | Rejected: no per-game data model here; cost far above the benefit |
| **Safety net first, then split one hook into one sensor and five surfaces, then give the scheduler sole ownership of lifetime** | **Chosen** (ADR-0043) |

## 4. Target architecture

### 4.1 Layers and the dependency rule

```
                     ┌──────────────────────── SharedJSContext ────────────────────────┐
Steam shows a toast ─┼─► steam/notification-hook (the one PlayNotificationSound wrapper)  │
                     │        │ onShown(n)                        │ sound slot           │
                     │        ▼                                   ▼                      │
                     │   sensors/unlock ──achievement.unlocked──► surfaces/sound          │
                     │   (once per toast,     │                   (asks banner/queue      │
                     │    one macrotask later)├──► surfaces/toasts (100% toast)          │
                     │                        └──► surfaces/captures                     │
Steam renders a      │                                                                    │
toast (any mode) ────┼─► surfaces/banner (jsx replacement; pin + hold on desktop only)    │
                     │         └─► banner/queue (the only owner of banner lifetime)       │
theme change ────────┼─► surfaces/duration                                               │
                     └────────────────────────────────────────────────────────────────────┘
```

One event stream, two renderers: Big Picture and desktop share every module above; the only mode difference is
inside `surfaces/banner/window-pin.ts` (`isPerToastPopup`: desktop and in-game overlay popups are pinned and held,
Big Picture's single popup is not).

**Areas** (what `tests/architecture.test.ts` calls an area): each top-level folder of `frontend/`, each child of
`sensors/` and `surfaces/`, and each root file. **Import rule** (the final `LAYER_RULES`, added in E1a):

| Area | May import | Must never import |
| --- | --- | --- |
| `kernel` | nothing of ours | everything |
| `safety` | nothing of ours | everything |
| `banner`, `capture` (pure domain) | `kernel`, `theme` (types and pure functions) | `steam`, `sensors/*`, `surfaces/*`, `settings`, React, SDK, `logger` |
| `theme` | `kernel`, `rpc`, `settings` (`active-theme.ts` loads through RPC and follows the theme setting) | `steam`, `sensors/*`, `surfaces/*` |
| `steam` | `kernel`, `safety`, `logger` | `theme`, `banner`, `capture`, `settings`, `sensors/*`, `surfaces/*` |
| `sensors/<name>` | `kernel`, `safety`, `steam`, `theme` | `surfaces/*`, `settings`, another sensor |
| `surfaces/<name>` | `kernel`, `safety`, `steam`, `theme`, `banner`, `capture`, `settings`, its own folder | **another surface**, `sensors/*` |
| `settings` | `kernel`, `safety`, `rpc`, `theme`, `capture` (ranges), `steam` (the read-only toasts-off flag) | `sensors/*`, `surfaces/*` (previews are injected as a prop, D7) |
| `index`, `claims` | everything (composition root; the public `claims()` API) | — |

`logger` may be imported by any area except the pure files (§ 4.2).

### 4.2 Pure files

Pure files import, at runtime, only other pure files: no Steam globals, no `@steambrew/*`, no React, no `logger`.
`npm test` runs them under node, and the architecture test enforces the list (`PURE` in
`tests/architecture.test.ts`). Target list after E2:

`kernel/notification.ts`, `kernel/events.ts`, `kernel/surface.ts`, `safety/features.ts`, `safety/boot.ts`,
`safety/runtime.ts`, `theme/theme.ts`, `theme/jsonc.ts`, `banner/geometry.ts`, `banner/timing.ts`,
`banner/queue.ts`, `banner/styles.ts`, `capture/plan.ts`, `steam/notification-hook.ts`, `sensors/unlock/unlock.ts`,
`surfaces/sound/sound.ts`, `surfaces/duration/duration.ts`, `surfaces/toasts/completion.ts`.

A pure file that needs a Steam object or a setting takes it as a parameter (a `deps` object). The thin `index.ts`
of each sensor or surface wires the real objects in; it is not pure and has no logic worth a unit test.

### 4.3 Steam targets and their one owner

`OWNERS` in `tests/architecture.test.ts` holds one row per pattern; the owner column changes as files move.

| Steam target | Owner after E0b | Owner after E1c | `touches` string (E1b/E1c) |
| --- | --- | --- | --- |
| `NotificationStore.prototype.PlayNotificationSound` (wrapper) | `steam/notifications.ts` | `steam/notification-hook.ts` | — (infrastructure, D3) |
| Store instance `ChooseSound` (for one call) | `steam/notifications.ts` | `steam/notification-hook.ts` | — (infrastructure, D3) |
| The hook's sound slot | — | `surfaces/sound/index.ts` | `NotificationStore.PlayNotificationSound#sound` |
| Achievement type config `toastDurationMS` | `steam/notifications.ts` | `surfaces/duration/index.ts` | `achievementTypeConfig.toastDurationMS` |
| `NotificationStore.OnNotification` + `m_nNextTestNotificationID` (synthetic toasts) | `steam/notifications.ts` | `surfaces/toasts/post.ts` | `NotificationStore.OnNotification`, `NotificationStore.m_nNextTestNotificationID` |
| `react/jsx-runtime` `jsx`/`jsxs` (`keepJsxPatched`) | `steam/toast-patch.ts` | `surfaces/banner/toast-patch.ts` | `jsx-runtime:toast-dispatcher` |
| Notification `fnNotificationResolved` (popup hold) | `banner/themed-toast.tsx` | `surfaces/banner/themed-toast.tsx` | `notification.fnNotificationResolved` |
| Toast popup `SteamClient.Window.MoveTo` (pin) | `banner/window-pin.ts` | `surfaces/banner/window-pin.ts` | `toastPopup.SteamClient.Window.MoveTo` |
| Game Recording RPCs | `steam/recording.ts` | `surfaces/captures/recording.ts` | `GameRecording.TakeScreenshot`, `GameRecording.SaveClip`, `GameRecording.UserAddTimelineEntry` |

### 4.4 Kernel contracts (binding; created in E1a)

`frontend/kernel/notification.ts` (pure; the two interfaces move here verbatim from `steam/notifications.ts`):

```ts
export interface AchievementData { appid(): number; name(): string; description(): string; image_url(): string;
    achieved(): boolean; global_achieved_pct(): number; achievement_id(): string; }
export interface SteamNotification { eType: number; data: AchievementData; nToastDurationMS?: number;
    rtCreated?: number; notificationID?: number; fnNotificationResolved?: () => boolean; }

/** Synthetic achievement ids this plugin posts. Never real Steam ids. */
export const PREVIEW_ID_PREFIX = 'EA_PREVIEW_';
export const COMPLETION_ID = 'EA_100_PERCENT';
export const TEST_UNLOCK_ID = 'EA_TEST';

export type SyntheticKind = 'preview' | 'completion' | 'test';
/** Which synthetic toast an achievement id is; null for a real unlock. `EA_PREVIEW_` with any suffix is 'preview'. */
export function syntheticKind(id: string | undefined): SyntheticKind | null;
/** The notification's achievement id; undefined when the accessor is missing or throws. O(1). */
export function achievementIdOf(n: SteamNotification): string | undefined;
```

`frontend/kernel/events.ts` (pure; same shape as `steam-cartridges/frontend/kernel/events.ts`):

```ts
export interface Events {
    /** A real or test unlock was shown for the first time: once per notification data object, never for a
     *  preview or the synthetic 100% toast. Emitted one macrotask after Steam's call (D4). */
    'achievement.unlocked': { n: SteamNotification; atMs: number; completesGame: boolean };
}
export type EventName = keyof Events;
export interface EventBus {
    on<K extends EventName>(event: K, handler: (payload: Events[K]) => void): () => void;
    emit<K extends EventName>(event: K, payload: Events[K]): void;
    count(event: EventName): number;
}
/** Handlers run in registration order; one that throws is passed to onError and the rest still run. */
export function createEventBus(onError?: (event: EventName, err: unknown) => void): EventBus;
```

`frontend/kernel/surface.ts` (pure):

```ts
export interface Surface {
    /** Stable id; also its kill switch (a FeatureId in safety/features.ts). */
    id: string;
    /** Steam targets this surface writes (§ 4.3). No two surfaces share one. */
    touches: readonly string[];
    /** Resolve and patch once. false = Steam lacks what it needs: the surface stays off, not an error. */
    install(): boolean;
    /** Undo every patch. Idempotent. Called when the feature trips its error budget. */
    uninstall(): void;
}
export interface SurfaceStatus { id: string; installed: boolean; skipped: 'disabled' | 'unavailable' | 'failed' | null }
/** Throws `Steam target "<t>" is touched by both "<a>" and "<b>"` on a shared target. */
export function assertDisjointTouches(surfaces: readonly Pick<Surface, 'id' | 'touches'>[]): void;
/** assertDisjointTouches first (throws before installing anything), then each surface in order, each in its own
 *  try/catch: disabled → skipped 'disabled'; install() false → 'unavailable'; throws → reportError(id) and 'failed'. */
export function installSurfaces(
    surfaces: readonly Surface[],
    deps: { isEnabled(id: string): boolean; reportError(id: string, err: unknown): void },
): SurfaceStatus[];
```

### 4.5 The notification hook (binding; created in E1b)

`frontend/steam/notification-hook.ts` (pure: it mutates only the `proto` it is given):

```ts
export interface SoundCall {
    readonly n: SteamNotification;
    /** Steam's own PlayNotificationSound on the store: its chime, if Steam's settings want one. */
    playSteam(): void;
    /** Steam's own PlayNotificationSound with its sound choice intercepted: returns whether Steam wanted a sound. Plays nothing. */
    askSteam(): boolean;
}
/** Decides the sound of one shown toast. Calls playSteam() or askSteam() at most once, now or later. */
export type SoundHandler = (call: SoundCall) => void;
export interface NotificationHook {
    /** Observers of every toast Steam shows; run first, in order, each isolated; must be O(1). */
    onShown(listener: (n: SteamNotification) => void): () => void;
    /** The one sound handler; null restores Steam's sound. */
    setSoundHandler(handler: SoundHandler | null): void;
    /** Restores Steam's PlayNotificationSound if it is still ours. Idempotent. */
    uninstall(): void;
}
export function installNotificationHook(
    proto: { PlayNotificationSound(this: unknown, n: SteamNotification): void; ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown },
    owner: object,
    deps: { reportError(id: 'sound', err: unknown): void; warn(message: string, err: unknown): void },
): NotificationHook;
```

Wrapper semantics (each is a named test in E1b):

1. `this !== owner` → `return original.call(this, n)` and nothing else (other plugins' and our own stand-in
   calls read a type's config this way).
2. Each `onShown` listener runs in its own try/catch; a throw goes to `deps.warn` and the next listener runs.
3. No sound handler → `original.call(this, n)`.
4. With a handler: build one `SoundCall` whose `playSteam`/`askSteam` share a used flag (the second call of either
   is ignored, so a toast can never chime twice). `askSteam` sets an own `ChooseSound` on the store that records
   `!!originalChoose.call(this, config, n)` and returns `null`, calls the original, and deletes the own property
   in a `finally` (today's code, `notifications.ts:220–229`). If the handler throws: `deps.reportError('sound', err)`,
   and if neither function ran yet, `original.call(this, n)`.

### 4.6 The unlock sensor (binding; created in E1b)

`frontend/sensors/unlock/unlock.ts` (pure) exports
`createUnlockSensor(deps): (n: SteamNotification) => void`, the listener given to `hook.onShown`:

```ts
deps: {
    isAchievementUnlock(n: SteamNotification): boolean;
    progressFor(appid: number): { unlocked?: unknown; total?: unknown; all_unlocked?: unknown } | undefined;
    emit(payload: Events['achievement.unlocked']): void;
    defer(fn: () => void): void;   // production: (fn) => setTimeout(fn, 0)
    now(): number;                 // production: Date.now
}
```

Rules: ignore anything `isAchievementUnlock` rejects; ignore `syntheticKind(id)` of `'preview'` or `'completion'`
(`'test'` counts as a real unlock, as today); handle each `n.data` object once (a module-level `WeakSet` inside the
factory closure); read `atMs = now()` and `completesGame = completesGame(progressFor(appid))` **synchronously**
(Steam refreshes its progress cache after the toast arrives, `theme/theme.ts:476–483`); then `defer(() => emit(…))`.
`frontend/sensors/unlock/index.ts` wires the real deps.

### 4.7 Surfaces

| Surface (feature id) | Files (after E1c) | Install | Uninstall | Created |
| --- | --- | --- | --- | --- |
| `sound` | `surfaces/sound/{index,sound}.ts` | `hook.setSoundHandler(createSoundHandler(deps))` | `hook.setSoundHandler(null)` | E1b |
| `duration` | `surfaces/duration/{index,duration}.ts` | apply now + `onThemeChange(apply)` | unsubscribe; write the pristine value back | E1b |
| `toasts` | `surfaces/toasts/{index,post,completion}.ts` | nothing to patch (returns `true` when the achievement config has its protobuf class, `config.proto`) | cancel pending completion timers | E1b |
| `banner` | `surfaces/banner/{index,toast-patch,themed-toast,window-pin}.ts[x]` | `initToastPatch()` | `disposeToastPatch()` | E1c |
| `captures` | `surfaces/captures/{index,captures,recording}.ts` | `initRecording()` | `disposeCaptures()` | E1c |

`completion` stays a feature id but is not a surface: it is the rule in `surfaces/toasts/completion.ts` that
subscribes to `achievement.unlocked` and posts through the `toasts` surface. It is gated by both `completion` and
`toasts`.

### 4.8 What "a new feature touches only its part" means here

| New feature | Files touched | Files not touched |
| --- | --- | --- |
| Something new on unlock (e.g. an unlock history, a stats counter) | a new subscriber of `achievement.unlocked` (its own surface folder if it writes to Steam), `index.tsx` one line | the hook, the sensor, every other surface |
| A new theme option | `theme/theme.ts` + `tests/theme.test.ts`, the consuming surface (usually `banner`) | the hook, the sensor, sound, captures |
| A new banner layout | `surfaces/banner/themed-toast.tsx`, `banner/styles.ts` | everything else |
| A new sound behaviour | `surfaces/sound/sound.ts` + its tests | banner, hook |
| A new Steam target | a row in § 4.3, `OWNERS`, the owning surface's `touches` | other surfaces |

A plan whose diff crosses more boundaries than its row must say why in its root-cause section.

### 4.9 Code shared with other plugins

Plugins may not import each other (docs/plugins.md § Layout). The copies and their guards:

| Copy | Kept identical with | Guard |
| --- | --- | --- |
| `frontend/steam/jsx-hook.ts` | `steam-cartridges/frontend/steam/jsx-hook.ts` | E0b drift test (byte-identical) |
| `pristineDuration()` | `enhanced-notifications/frontend/steam/notifications.ts` | E0b drift test (function text identical) |
| `safety/features.ts`, `safety/boot.ts` | `steam-cartridges/frontend/safety/` (same design, different ids and key) | none: they are adapted, not identical |
| `claims()` contract | enhanced-notifications reads it through `window.PLUGIN_LIST` | its signature and meaning do not change in this plan |

A change to a guarded copy is made in both plugins in the same commit, in a plan that owns both.

## 5. Migration strategy

**Strangler, one owner at a time.** Each step moves one concern behind its contract, deletes the old path in the
same step and leaves the rest byte-identical. No parallel implementations.

**Light feature freeze.** No new features merge into `enhanced-achievements` until E1c is `Done`. Bug fixes go
into the new structure if their module has moved, the old one otherwise. The public exports stay (D8).

**The baseline is the contract.** § 0.5 lists the live PASS lines. Every step reproduces them exactly
([guardrail 15](../plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour)).

## 6. Verified baseline and dry-run (2026-09-29, tree at `cdc656d`)

| Fact | Value |
| --- | --- |
| `npm run check` | exit 0, no output |
| `npm test` | `ℹ tests 65` · `ℹ pass 65` · `ℹ fail 0` (4 files: capture 14, geometry 5, queue 12, theme 34) |
| `npm run build` | `build Succeeded` |
| Cross-area imports | 15 (the E0b allowlist, listed in § 7 E0b) |
| `steam/jsx-hook.ts` vs steam-cartridges | byte-identical |
| `pristineDuration` vs enhanced-notifications | identical text |
| **E0a dry-run** | `e0a.patch` applied to a copy of the tracked files: `git apply --check` clean against the real repo; `npm run check` exit 0; `npm test` 75/75; `npm run build` Succeeded |
| **E0b dry-run** | `e0b.patch` applied after E0a in the same copy, with the two sibling files in place: `npm run check` exit 0; `npm test` 82/82, 0 skipped; `npm run build` Succeeded. Guard check: adding a `logger` import to `theme/theme.ts` and a second `MoveTo` writer made the pure-files and one-owner tests fail as intended |
| Live | **not measured by the architect** (no deploy from the planning session). The verifier's E0a run is the first live baseline; record the outputs in the E0a CHANGELOG entry |

**Found while dry-running:** the working tree had an unrelated uncommitted deletion,
` D docs/plans/phase7-and-alpha-plan.md`, which is still cited by code comments (`steam/recording.ts`,
`capture/captures.ts`, `steam/notification-settings.ts`) and by `docs/steam-architecture.md`. § 0.4 requires a clean
tree: the user decides whether that deletion is committed or restored before E0a starts.

---

## 7. The steps

### E0a — Safety net (Ready)

**Why:** § 1.3, § 1.6. The highest stability return for the least change: nothing moves; every Steam write gets a
switch, a budget and a fail-open path.

**What the patch does** (`docs/plans/enhanced-achievements-migration/e0a.patch`, 815 lines):

| File | Change |
| --- | --- |
| `frontend/safety/features.ts` (new) | Kill switches and error budget: `FEATURE_IDS = ['banner','sound','duration','completion','captures']`, `SAFE_MODE_FEATURES` empty, `createFeatureSwitches` (copy of the steam-cartridges design) |
| `frontend/safety/boot.ts` (new) | Boot sentinel, key `enhanced-achievements.boot`; two unclean starts → safe mode |
| `frontend/safety/runtime.ts` (new) | The one switch set: `initSafety`, `isEnabled`, `reportError`, `reloadSafety`, `errorCount`, `safetyDiagnostics`; O(1) |
| `frontend/index.tsx` | `beginBoot` + `initSafety` after `initSettings()`; safe mode returns before any hook (stock Steam); `disabledFeatures` changes reload the switches; exports `safetyDiagnostics` |
| `settings.json`, `frontend/settings/settings.ts` | New setting `disabledFeatures` (default `""`, no panel control) |
| `frontend/steam/toast-patch.ts` | `replaceType` compares the type first, then, inside try/catch, `isEnabled('banner') && shouldTheme(…)`; a throw reports `banner` and leaves Steam's toast. `toastPatchInstalled()` is `hook !== null` (O(1)) |
| `frontend/banner/themed-toast.tsx` | The error boundary also calls `reportError('banner', error)` |
| `frontend/steam/notifications.ts` | Captures gated by `isEnabled('captures')`, the 100% toast by `isEnabled('completion')`, the sound and its queue deferral by `isEnabled('sound')`; `applyDuration` writes nothing when `duration` is off and reports its errors; the catch blocks report instead of only logging |
| `frontend/capture/captures.ts` | `onUnlock`'s catch reports `captures` |
| `frontend/claims.ts` | A switched-off feature is handed back: `banner` → `activeTheme() === null \|\| (toastPatchInstalled() && isEnabled('banner'))`; `sound`/`duration` → `isEnabled(feature)` |
| `tsconfig.json` | `"noEmit": true`, `"allowImportingTsExtensions": true` (as steam-cartridges), so pure files can import each other at runtime under both `tsc` and node |
| `tests/safety.test.ts` (new) | 10 unit tests |
| `tests/safety.mjs` (new) | Live: clean start, banner switched off and back on (13 checks) |
| `docs/enhanced-achievements/architecture.md` (new) | The architecture doc (layers, safety net, target owners, tests, how to add a feature) |

Behaviour with no switch off and no error: identical to today, except `toastPatchInstalled()` no longer walks the
jsx chain (it reports "installed and maintained", not "live this instant"; the self-healing write guard makes the
difference at most one microtask).

**Files:** exactly the 15 files above (13 entries in `git status`, action 3), plus the docs of § 0.1 action 5
and this plan's § 0.2 row.

**Actions** (from `C:\game\millennium` unless stated):

1. `Get-FileHash -Algorithm SHA256 docs\plans\enhanced-achievements-migration\e0a.patch | Select-Object -ExpandProperty Hash`
   → `E3879897826D016F9C671D92A3360050FDED30070F65ECBD4EBA417C18AD7BCE`.
   Then `git apply --check docs/plans/enhanced-achievements-migration/e0a.patch` → no output, exit 0.
   Any other output: the plan is stale; stop (§ 0.7).
2. `git apply docs/plans/enhanced-achievements-migration/e0a.patch` → no output, exit 0.
3. `git status --short` → exactly these 13 lines:
   ```
    M enhanced-achievements/frontend/banner/themed-toast.tsx
    M enhanced-achievements/frontend/capture/captures.ts
    M enhanced-achievements/frontend/claims.ts
    M enhanced-achievements/frontend/index.tsx
    M enhanced-achievements/frontend/settings/settings.ts
    M enhanced-achievements/frontend/steam/notifications.ts
    M enhanced-achievements/frontend/steam/toast-patch.ts
    M enhanced-achievements/settings.json
    M enhanced-achievements/tsconfig.json
   ?? docs/enhanced-achievements/
   ?? enhanced-achievements/frontend/safety/
   ?? enhanced-achievements/tests/safety.mjs
   ?? enhanced-achievements/tests/safety.test.ts
   ```
4. `cd enhanced-achievements; npm run check` → as § 0.3 (exit 0, no output after the banner).
5. `npm test` → ends `ℹ tests 75` / `ℹ pass 75` / `ℹ fail 0` / `ℹ skipped 0`.
6. `npm run build` → contains `build Succeeded`.
7. `node --check tests/safety.mjs` → no output, exit 0.

**Docs:**
- `enhanced-achievements/CHANGELOG.md`, under `## [Unreleased]`, add:
  ```markdown
  ### Added

  - **Kill switches, error budget and safe mode** (migration E0a, ADR-0043). Each part that writes into
    Steam (`banner`, `sound`, `duration`, `completion`, `captures`) can be switched off with the
    `disabledFeatures` setting and switches itself off after 5 errors in a session; Steam's own toast,
    chime or duration returns for it, and `claims()` hands it to enhanced-notifications. Two starts in a
    row that do not end cleanly start the next one in safe mode (nothing hooked). `safetyDiagnostics()`
    shows the state. See docs/enhanced-achievements/architecture.md.

  ### Fixed

  - `claims()` is O(1) again: it no longer walks the jsx wrapper chain (and could call the jsx runtime)
    on every call, which enhanced-notifications makes on every toast.
  ```
- Root `CHANGELOG.md`: add at the top of the list:
  `- **enhanced-achievements: safety net (migration E0a, 2026-MM-DD)**: kill switches, error budget, safe mode, fail-open jsx handler; \`claims()\` O(1). \`npm test\` 75/75. Plan: [enhanced-achievements-architecture-migration-plan.md](docs/plans/enhanced-achievements-architecture-migration-plan.md).`
  (use the date you commit).
- `TASK.md` § Now: one line — `enhanced-achievements migration: E0a done (live verification pending); next E0b.`
- This plan § 0.2: E0a → `Done (live pending)`; the verifier sets `Done` after § 0.5.
- `docs/steam-architecture.md` § 2 "Our plugins": in the row for `enhanced-achievements/architecture.md`, change
  `planned (E0a)` to `current`.

**Commit:** paths — the 13 entries of action 3 (`enhanced-achievements/frontend/safety` and
`docs/enhanced-achievements` as folders), `enhanced-achievements/CHANGELOG.md`, `CHANGELOG.md`, `TASK.md`,
`docs/plans/enhanced-achievements-architecture-migration-plan.md`, `docs/steam-architecture.md`. Message:
`feat(enhanced-achievements): kill switches, error budget, safe mode (E0a)`.

**Live:** § 0.5 rows "E0a only" and "every step". Also, once: set `disabledFeatures` to `sound`
(`node tests/cdp.mjs "PLUGIN_LIST['enhanced-achievements-dev'].setSetting('disabledFeatures','sound').then(() => true)"`),
click **Preview Achievements → Rare** in the settings panel with a theme that has a sound (e.g. the user theme
`steam_ps_exemple`): Steam's chime plays, not the theme's. Set it back to `''`.

**Guardrails re-read:** 2 (every added check is `isEnabled`, a few Set lookups; the jsx handler still compares the
type first), 14 (no gate removes working behaviour: with nothing switched off, behaviour is unchanged), 15 (no check
weakened), 17 (nothing new runs from a render; the error boundary only counts).

### E0b — Test harness (Ready)

**Why:** § 1.4, § 1.8. Makes the one-owner rule and the layer rule executable before anything moves, and gives
one command for the live set.

**What the patch does** (`docs/plans/enhanced-achievements-migration/e0b.patch`, 375 lines):

| File | Change |
| --- | --- |
| `tests/architecture.test.ts` (new) | 7 tests: import ratchet; pure files; one owner per Steam write (`OWNERS`, § 4.3 "after E0b" column); RPC registration (4 names); `jsx-hook.ts` drift; `pristineDuration` drift; every live script is in `run-live.mjs` |
| `tests/architecture-allowlist.json` (new) | The 15 legacy edges: `banner -> settings`, `banner -> steam`, `banner -> theme`, `capture -> settings`, `capture -> steam`, `capture -> theme`, `settings -> capture`, `settings -> rpc`, `settings -> steam`, `settings -> theme`, `steam -> banner`, `steam -> capture`, `steam -> theme`, `theme -> rpc`, `theme -> settings` |
| `tests/run-live.mjs` (new) | `npm run test:live`: snapshots the stored settings, runs `smoke`, `tiers`, `safety`, `queue-stress`, `captures`, `settings-sound`, `bigpicture` (SKIP outside Big Picture), selecting theme `ps5` for the checks that need one, and restores the snapshot |
| `tests/queue-stress.mjs` | Restores the settings stored before it ran instead of resetting theme and queue (EA-K4) |
| `package.json` | `"test:live": "node tests/run-live.mjs"` |
| `docs/enhanced-achievements/architecture.md` | Tests table and History |

**Files:** the 6 paths above, plus the docs of § 0.1 action 5 and this plan's § 0.2 row.

**Actions** (from `C:\game\millennium` unless stated):

1. `Get-FileHash -Algorithm SHA256 docs\plans\enhanced-achievements-migration\e0b.patch | Select-Object -ExpandProperty Hash`
   → `FC4750A3680CCAB053AC0ADADC49106CFC67EEAC1E40F865EEDC1367A90B2EAE`.
   Then `git apply --check docs/plans/enhanced-achievements-migration/e0b.patch` → no output, exit 0.
2. `git apply docs/plans/enhanced-achievements-migration/e0b.patch` → no output, exit 0.
3. `git status --short` → exactly:
   ```
    M docs/enhanced-achievements/architecture.md
    M enhanced-achievements/package.json
    M enhanced-achievements/tests/queue-stress.mjs
   ?? enhanced-achievements/tests/architecture-allowlist.json
   ?? enhanced-achievements/tests/architecture.test.ts
   ?? enhanced-achievements/tests/run-live.mjs
   ```
4. `cd enhanced-achievements; npm run check` → as § 0.3.
5. `npm test` → contains these seven lines (timings differ):
   ```
   ✔ architecture: no new cross-area import (ratchet)
   ✔ architecture: pure files import only other pure files at runtime
   ✔ architecture: one owner per Steam write
   ✔ architecture: every RPC the frontend calls is registered in backend/main.lua
   ✔ architecture: steam/jsx-hook.ts is identical to the steam-cartridges copy
   ✔ architecture: pristineDuration is identical to the enhanced-notifications copy
   ✔ architecture: every live check is run by tests/run-live.mjs
   ```
   and ends `ℹ tests 82` / `ℹ pass 82` / `ℹ fail 0` / `ℹ skipped 0`. (A `﹣` skip on a drift test means a sibling
   plugin is missing: stop.)
6. `npm run build` → contains `build Succeeded`.
7. `node --check tests/run-live.mjs; node --check tests/queue-stress.mjs` → no output, exit 0.

**Docs:** `enhanced-achievements/CHANGELOG.md` `### Added` (append):
`- \`npm run test:live\` runs every live check with the stored settings snapshotted and restored; \`tests/architecture.test.ts\` enforces one owner per Steam target, the import ratchet, pure files, RPC registration and the copies shared with steam-cartridges and enhanced-notifications (migration E0b).`
and `### Fixed` (append): `- \`tests/queue-stress.mjs\` no longer resets your theme to "Steam default" when it ends.`
Root `CHANGELOG.md`, `TASK.md` (E0b done; next E1a), § 0.2 row as in E0a.

**Commit:** the 6 paths of action 3, `enhanced-achievements/CHANGELOG.md`, `CHANGELOG.md`, `TASK.md`,
`docs/plans/enhanced-achievements-architecture-migration-plan.md`. Message:
`test(enhanced-achievements): architecture test and npm run test:live (E0b)`.

**Live:** § 0.5 rows "E0b on" and "every step". This run also sets the live baseline for every later step.

**Guardrails re-read:** 9 (automated CDP suite: `test:live`), 15 (no existing check changed; `queue-stress.mjs`
changes only its clean-up).

---

### 7.0 Architect decisions for E1–E3 (binding)

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Files do not move to a `domain/` folder.** The pure files stay where they are (`theme/`, `banner/`, `capture/`) and the `PURE` list enforces them. | Moves cost doc churn and history; the list gives the same guarantee. |
| D2 | **Tier logic is pure and in `theme/theme.ts`:** `previewTierOfId(id)` and `tierOfNotification({ id, globalPct }, theme)`. The memo `tierFor(n)` (a `WeakMap` on `n.data`, first answer wins) moves to `theme/active-theme.ts`, because it reads the active theme. Sound, banner and captures all call that one `tierFor`. | One tier per toast, whoever asks first (today's behaviour), computed by tested code. |
| D3 | **The `PlayNotificationSound` wrapper is infrastructure, not a surface** (`steam/notification-hook.ts`, like `jsx-hook.ts`). It owns the prototype and the transient `ChooseSound`; the `sound` surface owns only the decision, through the one slot. | The sensor must keep working when `sound` is switched off (captures and the 100% toast depend on it). |
| D4 | **The hook's one hand-off:** the sensor may call `defer` once per unlock to emit `achievement.unlocked` one macrotask later; facts that change after Steam's call (`completesGame`, `atMs`) are read before deferring. Nothing else in the hook schedules work. This replaces the phase-7 A1.7 exception (captures scheduled inline). | Handlers run outside Steam's effect; an error in one cannot reach Steam's call. |
| D5 | **Captures read the timeline when the event is handled**, not in the hook. `unlockOffsetMs` anchors on `rtCreated`, so the one-macrotask delay changes offsets by under 5 ms. | Keeps `recording.ts` out of the hook. |
| D6 | **`FEATURE_IDS` gains `'toasts'` in E1a** (appended; the E0a test "the ids users type never change" is edited to the new list in the same item, the only permitted edit to it). | The synthetic-toast surface needs its own switch; previews must not depend on `completion`. |
| D7 | **The settings panel gets previews injected:** `SettingsPanel({ onPreview }: { onPreview(tier: Tier): void })`, and `index.tsx` passes `previewTier`. | `settings` must not import a surface. |
| D8 | **`index.tsx`'s named exports are a public API** (live tests and the console use them): `allSettings`, `resetSettings`, `setSetting`, `previewTier`, `fireTestUnlock`, `fireExceptionalCompletionToast`, `activeTheme`, `claims`, `jsxDiagnostics`, `captureLog`, `setCaptureDryRun`, `recordingDiagnostics`, `runningGameAppid`, `toastsEnabled`, `safetyDiagnostics`. Names and behaviour stay. E1c adds `surfaceStatus`. | Live scripts and enhanced-notifications call them. |
| D9 | **Error budget trips uninstall the surface:** `safety/features.ts` gets an `onTrip?: (id: FeatureId) => void` option (E1a); `index.tsx` maps it to that surface's `uninstall()`. | Today a tripped feature is only gated; uninstalling also removes the patch. |
| D10 | **The allowlist ends empty at E1c.** E1a regenerates it once with the final `LAYER_RULES`; E1b and E1c only delete entries. | The ratchet then protects the finished structure. |

### E1a — Kernel and pure tier and timing functions (Build)

**Why:** § 1.2 (tier swap), § 4.4. Creates the contracts E1b/E1c build on; no behaviour change.

**Files:** new `frontend/kernel/notification.ts`, `frontend/kernel/events.ts`, `frontend/kernel/surface.ts`,
`tests/kernel.test.ts`, `tests/timing.test.ts`; changed `frontend/theme/theme.ts`, `frontend/theme/active-theme.ts`,
`frontend/banner/timing.ts`, `frontend/steam/notifications.ts`, `frontend/banner/themed-toast.tsx`,
`frontend/safety/features.ts`, `frontend/index.tsx` (only the `initSafety` call, D9 wiring comes in E1b),
`tests/theme.test.ts`, `tests/safety.test.ts` (D6 only), `tests/architecture.test.ts`, `tests/architecture-allowlist.json`.

**Design (in order):**

1. `kernel/notification.ts`, `kernel/events.ts`, `kernel/surface.ts` exactly as § 4.4. `events.ts` and the
   `installSurfaces`/`assertDisjointTouches` pair follow `steam-cartridges/frontend/kernel/{events,surface}.ts`.
2. `steam/notifications.ts` imports `AchievementData`, `SteamNotification`, `PREVIEW_ID_PREFIX`, `COMPLETION_ID`,
   `TEST_UNLOCK_ID` from `../kernel/notification` and re-exports them (`export type { … }`, `export { … }`), so every
   current importer compiles unchanged. Its own `previewTierOf(n)` becomes `previewTierOfId(achievementIdOf(n))`.
3. `theme/theme.ts` adds (pure, importing `../kernel/notification.ts`):
   ```ts
   /** The tier a settings-panel preview was posted for (`EA_PREVIEW_<tier>`), or null. */
   export function previewTierOfId(id: string | undefined): Tier | null;
   /** Preview → its own tier; COMPLETION_ID → 'exceptional'; else selectTier by rarity under `theme`, 'normal' without one. Never throws. */
   export function tierOfNotification(facts: { id: string | undefined; globalPct: number | null | undefined }, theme: Pick<ResolvedTheme, 'tiers'> | null): Tier;
   ```
4. `tierFor(n)` moves from `steam/notifications.ts` to `theme/active-theme.ts` (D2): same `WeakMap`, now
   `tierOfNotification({ id: achievementIdOf(n), globalPct: n.data.global_achieved_pct() }, activeTheme()?.theme ?? null)`
   inside the existing try/catch. `steam/notifications.ts` and `banner/themed-toast.tsx` import it from there.
5. `banner/timing.ts` adds `export function themedDisplayMs(displayTimeMs: number | null | undefined, steamDurationMs: number | undefined): number`
   (`displayTimeMs ?? (steamDurationMs || 5000)`). The old `themedDisplayMs(theme)` in `steam/notifications.ts`
   delegates to it with `originalDurationMs`.
6. `safety/features.ts`: append `'toasts'` to `FEATURE_IDS` (D6); add the `onTrip` option (D9), called once, after
   the "exceeded its error budget" log.
7. `tests/architecture.test.ts`: replace `LAYER_RULES` with the final rules of § 4.1:
   ```ts
   [/^(index|claims)$/, /./],
   [/^(?!safety$)/, /^safety$/],
   [/^(?!kernel$)/, /^kernel$/],
   [/^(banner|capture)$/, /^theme$/],
   [/^theme$/, /^(rpc|settings)$/],
   [/^settings$/, /^(rpc|theme|capture|steam)$/],
   [/^sensors\//, /^(steam|theme)$/],
   [/^surfaces\//, /^(steam|theme|banner|capture|settings)$/],
   ```
   add `kernel/notification.ts`, `kernel/events.ts`, `kernel/surface.ts` to `PURE`, and add the test
   `architecture: layer rules allow the § 4.1 edges and nothing it forbids` with
   allowed `['index -> surfaces/banner', 'claims -> steam', 'surfaces/sound -> banner', 'sensors/unlock -> steam', 'settings -> capture', 'theme -> rpc', 'steam -> kernel']`
   and forbidden `['surfaces/banner -> surfaces/sound', 'surfaces/sound -> sensors/unlock', 'sensors/unlock -> surfaces/sound', 'steam -> surfaces/banner', 'steam -> theme', 'kernel -> steam', 'safety -> kernel', 'settings -> surfaces/toasts', 'theme -> steam', 'banner -> steam', 'capture -> steam', 'sensors/unlock -> settings']`.
   Then regenerate the allowlist once: `ARCH_WRITE_ALLOWLIST=1 npm test`. Expected result, 7 entries:
   `banner -> settings`, `banner -> steam`, `capture -> settings`, `capture -> steam`, `steam -> banner`,
   `steam -> capture`, `steam -> theme`. Any other list: stop.

**Named tests** (+11 → 93):
- `tests/kernel.test.ts`: `events: handlers run in order; a throwing handler does not stop the others` ·
  `events: off() unsubscribes and count() reports handlers` · `surface: assertDisjointTouches names both surfaces of a shared target` ·
  `surface: installSurfaces skips disabled and unavailable surfaces and reports a throwing install without stopping the rest` ·
  `notification: syntheticKind classifies preview, completion and test ids; real ids are null`.
- `tests/theme.test.ts`: `tier: a preview id carries its own tier, whatever the thresholds` ·
  `tier: the completion id is exceptional; an unknown preview suffix falls back to rarity` ·
  `tier: a real unlock uses the theme thresholds; no theme means normal`.
- `tests/timing.test.ts`: `timing: themedDisplayMs prefers display_time_ms, then Steam's duration, then 5000`.
- `tests/safety.test.ts`: `features: onTrip is called once when a feature trips`.
- `tests/architecture.test.ts`: `architecture: layer rules allow the § 4.1 edges and nothing it forbids`.

**Exit:** `npm run check`; `npm test` (93/93); `npm run build`; `git diff --stat`; the allowlist before (15) and after (7).
**Docs:** architecture.md Layers row Kernel → `current (E1a)`; History line. **Commit message:**
`refactor(enhanced-achievements): kernel contracts, pure tier and timing (E1a)`. **Live:** § 0.5 "E0b on" + "every step".

### E1b — One hook, one sensor, three surfaces (Build)

**Why:** § 1.1, § 1.2 (100% toast twice, sounds at once), § 1.4, § 1.7. `steam/notifications.ts` is deleted.

**Files:** new `frontend/steam/notification-store.ts`, `frontend/steam/notification-hook.ts`,
`frontend/sensors/unlock/{index,unlock}.ts`, `frontend/surfaces/sound/{index,sound}.ts`,
`frontend/surfaces/duration/{index,duration}.ts`, `frontend/surfaces/toasts/{index,post,completion}.ts`,
`tests/notifications.test.ts`; changed `frontend/index.tsx`, `frontend/claims.ts`, `frontend/steam/toast-patch.ts`,
`frontend/banner/themed-toast.tsx`, `frontend/capture/captures.ts`, `frontend/settings/settings-panel.tsx` (D7),
`frontend/theme/active-theme.ts` (only if an import path changes), `tests/architecture.test.ts`
(`OWNERS` rows and `PURE` entries of this step), `tests/architecture-allowlist.json` (deletions only);
deleted `frontend/steam/notifications.ts`.

**Design (in order):**

1. `steam/notification-store.ts` — discovery, read-only, moved from `notifications.ts` lines 25, 68–104,
   250–295: `resolveNotificationStore(): NotificationStoreHandle | null` (once, at start-up; same stand-in
   discovery), `notificationStore()`, `achievementEType()`, `isAchievementUnlock(n)`,
   `progressFor(appid)` (O(1) read of `appAchievementProgressCache`), and `pristineDuration` **moved verbatim**
   (the drift test must still pass).
   ```ts
   export interface NotificationStoreHandle {
       store: { OnNotification(id: number, eType: number, bytes: Uint8Array): void; m_nNextTestNotificationID?: number };
       proto: { PlayNotificationSound(this: unknown, n: SteamNotification): void; ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown };
       achievementType: number;
       config: { toastDurationMS?: number; proto?: unknown };
       pristineDurationMs: number | undefined;
   }
   ```
2. `steam/notification-hook.ts` exactly as § 4.5.
3. `sensors/unlock/unlock.ts` exactly as § 4.6; `sensors/unlock/index.ts` wires `isAchievementUnlock`,
   `progressFor`, `setTimeout(fn, 0)`, `Date.now`.
4. `surfaces/sound/sound.ts`: `createSoundHandler(deps): SoundHandler`, the logic of `notifications.ts:194–240`:
   not an unlock or `!isEnabled('sound')` → `playSteam()`; banner `waiting` → subscribe once per `n.data`, on
   `showing` play, on `done` stay silent; else clip and audio `running` → `if (askSteam()) playClip(clip)`; else
   resume a suspended context and `playSteam()`. `deps`: `isEnabled`, `isAchievementUnlock`, `clipFor(n)`,
   `audioState()`, `resumeAudio()`, `playClip(clip)`, `phaseOf`, `subscribe` (E2 replaces the last two).
   `surfaces/sound/index.ts`: `createSoundSurface(hook): Surface` with id `sound`, touches
   `['NotificationStore.PlayNotificationSound#sound']`.
5. `surfaces/duration/duration.ts`: `durationFor(theme: { animation: AnimationPair; displayTimeMs: number | null } | null, pristineMs: number | undefined): number | undefined`
   = theme ? `bannerTiming(theme.animation, themedDisplayMs(theme.displayTimeMs, pristineMs)).totalMs` : `pristineMs`.
   `index.ts`: id `duration`, touches `['achievementTypeConfig.toastDurationMS']`; `apply` writes only when
   `isEnabled('duration')` (E0a semantics), reports errors; `uninstall` writes the pristine value back.
6. `surfaces/toasts/post.ts`: `postAchievement`, `sampleAchievements`, `previewTier`,
   `fireExceptionalCompletionToast`, `fireTestUnlock` moved verbatim from `notifications.ts:316–450`; each does
   nothing when `!isEnabled('toasts')` (the two that return a boolean return `false`). `completion.ts`: `createCompletion({ isEnabled, post, schedule })` → the
   `achievement.unlocked` handler: `if (e.completesGame && isEnabled('completion')) schedule(() => post(appid), 1500)`
   (`appid` read synchronously). `index.ts`: id `toasts`, touches
   `['NotificationStore.OnNotification', 'NotificationStore.m_nNextTestNotificationID']`.
7. `index.tsx` start-up order (binding): `initSettings` → safety (E0a) → safe mode returns →
   `resolveNotificationStore()` (null → return, stock) → `createEventBus` → `installNotificationHook` →
   `hook.onShown(unlock sensor)` → `initRecording()` → `initNotificationSettingsDetection()` → `await initActiveTheme()`
   → `installSurfaces([sound, duration, toasts])` → `bus.on('achievement.unlocked', completion)` →
   `bus.on('achievement.unlocked', (e) => { if (isEnabled('captures')) onUnlock(e.n, tierFor(e.n)) })` →
   `initToastPatch()`. `onTrip` (D9) maps `sound`/`duration`/`toasts` to their `uninstall`.
   The settings panel gets `onPreview={previewTier}` (D7).
8. `claims.ts` imports `achievementEType` from `steam/notification-store`.
9. Delete `steam/notifications.ts`. Update `OWNERS` (§ 4.3 middle rows: hook, `surfaces/duration/index.ts`,
   `surfaces/toasts/post.ts`), add the new pure files to `PURE`, delete the allowlist entries that no longer exist.

**Named tests** (`tests/notifications.test.ts`, with fake `proto`/`owner` objects; +13 → 106):
`hook: calls on a stand-in object pass straight through` ·
`hook: with no sound handler Steam's original runs once` ·
`hook: a throwing sound handler falls back to Steam's original once and reports a sound error` ·
`hook: askSteam returns Steam's decision, plays nothing and removes the own ChooseSound` ·
`hook: playSteam and askSteam together still reach Steam only once` ·
`hook: a throwing onShown listener does not stop the sound` ·
`sensor: one achievement.unlocked per notification, however often Steam asks for its sound` ·
`sensor: previews and the 100% toast never emit; EA_TEST does` ·
`sensor: completesGame and atMs are read at show time, the event is emitted only after defer runs` ·
`sound: a queued banner's sound plays once when its turn comes and never if it is dismissed first` ·
`sound: switched off, Steam's chime plays at once and nothing is deferred` ·
`completion: one 100% toast 1.5 s after a completing unlock; none when completion is off` ·
`duration: the banner lifetime with a theme, Steam's pristine value without, nothing when switched off`.

**Exit:** `npm run check`; `npm test` (106/106); `npm run build`; `git diff --stat`; allowlist before/after
(expected to lose `steam -> capture`; `steam -> banner` and `steam -> theme` remain until E1c because
`steam/toast-patch.ts` still imports them). **Docs:** architecture.md (Layers: Sensor and Surfaces rows; the owners
table; History). `enhanced-achievements/CHANGELOG.md` `### Changed`: the 100% toast and captures now run one
macrotask after the toast is shown, never inside Steam's call. **Commit message:**
`refactor(enhanced-achievements): one notification hook, unlock sensor, sound/duration/toasts surfaces (E1b)`.
**Live:** § 0.5 "E0b on" + "every step", and in Big Picture (§ 0.5 row "E0b on, Big Picture"). The
`queue-stress.mjs` lines `one sound per toast` and `sounds follow the banners` are the E1b acceptance.

### E1c — Surfaces `banner` and `captures`; allowlist empty (Build)

**Why:** § 1.4, § 1.7, D10.

**Files:** `git mv` `frontend/steam/toast-patch.ts` → `frontend/surfaces/banner/toast-patch.ts`,
`frontend/banner/themed-toast.tsx` → `frontend/surfaces/banner/themed-toast.tsx`,
`frontend/banner/window-pin.ts` → `frontend/surfaces/banner/window-pin.ts`,
`frontend/capture/captures.ts` → `frontend/surfaces/captures/captures.ts`,
`frontend/steam/recording.ts` → `frontend/surfaces/captures/recording.ts`; new `frontend/surfaces/banner/index.ts`,
`frontend/surfaces/captures/index.ts`; changed `frontend/index.tsx`, `frontend/claims.ts`,
`tests/architecture.test.ts`, `tests/architecture-allowlist.json`, `docs/steam-components.md` (the two path
citations at lines 1478–1479).

**Design (in order):**

1. The five `git mv` moves, then only the import-path edits they need (one item, no behaviour change).
2. `surfaces/banner/index.ts`: id `banner`, touches
   `['jsx-runtime:toast-dispatcher', 'notification.fnNotificationResolved', 'toastPopup.SteamClient.Window.MoveTo']`,
   install `initToastPatch()`, uninstall `disposeToastPatch()`.
3. `surfaces/captures/index.ts`: id `captures`, touches
   `['GameRecording.TakeScreenshot', 'GameRecording.SaveClip', 'GameRecording.UserAddTimelineEntry']`,
   install `initRecording()`, uninstall `disposeCaptures()`; exports the `achievement.unlocked` handler that
   `index.tsx` registers (moved from the inline lambda of E1b item 7).
4. `index.tsx`: `installSurfaces([sound, duration, toasts, banner, captures])` in that order; `onTrip` covers all five;
   add the export `surfaceStatus()` (D8); `initRecording()` and `initToastPatch()` leave the start-up list.
5. `tests/architecture.test.ts`: `OWNERS` to the "after E1c" column; `PURE` adds `banner/styles.ts`; add the test
   `architecture: no two surfaces declare the same Steam target` (reads every `touches: [...]` in
   `frontend/surfaces/*/index.ts`, as `steam-cartridges/tests/architecture.test.ts` does). Delete every remaining
   allowlist entry: the file is `[]`.

**Named tests** (+1 → 107): `architecture: no two surfaces declare the same Steam target`.

**Exit:** `npm run check`; `npm test` (107/107); `npm run build`; `cat tests/architecture-allowlist.json` → `[]`.
**Docs:** architecture.md (all layers `current`; owners table to the final column); `docs/steam-components.md`
paths. **Commit message:** `refactor(enhanced-achievements): banner and captures surfaces; allowlist empty (E1c)`.
**Live:** § 0.5 "E0b on" + "every step" + Big Picture; also `node tests/cdp.mjs "PLUGIN_LIST['enhanced-achievements-dev'].surfaceStatus()"`
→ five entries, each `installed: true, skipped: null`. The feature freeze (§ 5) ends when E1c is `Done`.

### E2 — The scheduler owns banner lifetime (Build)

**Why:** § 1.5, § 1.2 (sounds at once).

**Files:** `frontend/banner/queue.ts`, `frontend/surfaces/banner/themed-toast.tsx`, `frontend/surfaces/sound/sound.ts`,
`frontend/surfaces/sound/index.ts`, `tests/queue.test.ts`, `tests/notifications.test.ts` (only the sound tests' deps).

**Design (in order):**

1. `banner/queue.ts` adds (pure):
   ```ts
   /** The toast's phase, or undefined if it was never admitted. */
   export function peek(key: object): Phase | undefined;
   /** 'now' if showing; 'never' if done or unknown; else calls `onShow` once when it starts showing (never if it is
    *  finished first) and returns 'later' plus an unsubscribe. */
   export function whenShowing(key: object, onShow: () => void): { at: 'now' | 'never' } | { at: 'later'; cancel(): void };
   ```
2. `surfaces/banner/themed-toast.tsx` `ThemedBanner`: the phase starts as `peek(key) ?? 'waiting'` (the invisible
   shell, never a painted banner); `admit(…)` runs in the existing mount `useLayoutEffect`, **before** the pin, and
   sets the phase from its return value; the subscribe effect stays. Nothing else in the render changes; every hook
   still runs on every render (§ 1.2 row 1).
3. `surfaces/sound/sound.ts` uses `whenShowing` instead of `phaseOf` + `subscribe` (deps change accordingly).
4. Keep: `finish` on click and on unmount, `holdPopup` in the mount effect, the 1×1 waiting pin.

**Named tests** (+4 → 111), in `tests/queue.test.ts`: `queue: peek is undefined for a toast never admitted` ·
`queue: whenShowing fires once when a waiting toast gets its turn` · `queue: whenShowing never fires for a toast finished before its turn` ·
`queue: whenShowing answers now for a toast already showing`.

**Exit:** `npm run check`; `npm test` (111/111); `npm run build`; `grep -n "admit(" frontend/surfaces/banner/themed-toast.tsx`
→ one line, inside `useLayoutEffect`. **Docs:** architecture.md (a "Banner lifetime" section: the scheduler owns
start, turn, sound and end; what runs where); CHANGELOG `### Changed`. **Commit message:**
`fix(enhanced-achievements): banner admitted from an effect, sounds wait on the scheduler (E2)`.
**Live:** § 0.5 "E0b on" + "every step" + Big Picture, and `queue-stress.mjs` three times in a row (all PASS each time).

**Risk to watch:** Steam's toast container calls `PlayNotificationSound` from an effect. Child layout effects run
before parent effects, so `admit` still precedes the sound request; if `queue-stress.mjs` shows a sound on arrival
(`gaps` under 1000 ms), stop (§ 0.7) and report the gaps: do not reorder effects by guesswork.

### E3 — Close the migration (Build)

**Files:** docs only: `docs/enhanced-achievements/architecture.md`, `docs/plugins.md` (one row in § Layout or a
pointer where plugin structure is described, linking the architecture doc), `docs/steam-architecture.md`,
`enhanced-achievements/README.md` (a "Troubleshooting" paragraph: `disabledFeatures`, `safetyDiagnostics()`,
safe mode), this plan (status `Complete`, § 11 triaged), `TASK.md`, both CHANGELOGs.

**Exit:** `npm run check`, `npm test` (111/111), `npm run build`, `npm run test:live` all as § 0.3/§ 0.5.
**Commit message:** `docs(enhanced-achievements): close the architecture migration (E3)`.

---

## 8. Do-not-touch (whole migration)

- `backend/` (the Lua backend; its four RPCs keep their names and shapes).
- `themes/`, `themes.md`, `examples/`, `research/`, `dev.ps1`, `plugin.json`, `frontend/steam/jsx-hook.ts`
  (only its path may appear in imports; its content is guarded by the drift test), `pristineDuration`'s body.
- The theme schema and `theme/theme.ts` behaviour (E1a only adds two functions), `capture/plan.ts`,
  `banner/geometry.ts`, `banner/styles.ts` content.
- Settings keys and defaults other than the new `disabledFeatures`.
- `steam-cartridges/`, `enhanced-notifications/`.

## 9. Guardrail checklist this migration touches

Each step's implementer re-reads these in [plugins.md](../plugins.md) and ticks each "not violated" with one line
of proof: **2** (every hot-path addition is O(1): `isEnabled`, identity compares, `WeakSet` checks), **3** (webpack
scans still run once at start-up: `resolveDispatcher`, `initRecording`, notification-settings), **9** (live suite),
**14** (no gate removes working behaviour; with nothing switched off, behaviour is today's), **15** (no check
weakened), **17** (nothing starts work from a render; the one hand-off is D4).

## 10. Commit instructions (updates to this plan itself)

`git add docs/plans/enhanced-achievements-architecture-migration-plan.md` (and the patch folder when a patch
changes), message `docs(plan): enhanced-achievements migration <what>`, attribution line per § 0.6.

## 11. Known issues (found while planning, 2026-09-29)

| Id | Issue | Evidence | Fixed by |
| --- | --- | --- | --- |
| EA-K1 | `claims()` walks the jsx chain and can call the jsx runtime on every call | `steam/toast-patch.ts:68–70`, § 1.6 | E0a |
| EA-K2 | `admit()` starts the scheduler timer from a render | `banner/themed-toast.tsx:148–150` | E2 |
| EA-K3 | `dispose*` functions have no caller; nothing can remove a patch at runtime | § 1.7 | E1b, E1c (`Surface.uninstall`) |
| EA-K4 | `tests/queue-stress.mjs` resets theme and queue to their defaults instead of restoring the user's values | `tests/queue-stress.mjs:151–154` | E0b |
| EA-K5 | `smoke.mjs`, `tiers.mjs`, `bigpicture.mjs` assume a theme is selected; they FAIL on the shipped default | § 1.8 | E0b (`run-live.mjs` selects `ps5` for them) |
| EA-K6 | `tests/settings-sound.mjs` calls `resetSettings()` and asserts nothing is stored, wiping the user's settings when run alone | its lines 107–113 | not fixed (a check, § 0.8); `run-live.mjs` restores the snapshot afterwards |
| EA-K7 | `toastWarning()` in `steam/notification-settings.ts` has no caller | `grep -rn toastWarning frontend` | not in scope; E3 lists it for removal by a later plan |
| EA-K8 | The working tree deletes `docs/plans/phase7-and-alpha-plan.md` without a commit, but code comments and the docs index still cite it | `git status` 2026-09-29 | the user decides before E0a (§ 6) |

## 12. Open question for the user (does not block E0a)

The earlier review asked which failures are seen in practice: banners falling back to Steam's toast, a wrong
position, missed or doubled sounds, a Big Picture problem, or something else. The plan's order (safety net first)
is right in every case. If the answer is "a wrong position" or "sounds", E2 can be pulled forward to run right
after E1b; the architect updates § 0.2 if so.
