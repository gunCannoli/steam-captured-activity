# Plan: port enhanced-achievements' architecture to enhanced-notifications

**Status:** planned and dry-run (2026-09-30), not executed. **Base:** `f6eb8d8`. **Decision:** ADR-0047 (written by step 4).
**Implementer:** apply four patches, run the checks, commit. No code is written by hand. **Verifier:** the user (§ 9).

This file is the plan; the code is in [enhanced-notifications-architecture-port/](enhanced-notifications-architecture-port/)
as four patches, one per step.

## 1. Why, and what the evaluation found

`enhanced-notifications` (EN) was copied from `enhanced-achievements` (EA) before EA's migration (E0a-E3,
[ADR-0043](../decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net)). The two
must run together without conflict: EA owns achievement toasts, EN restyles every other type. EN still has EA's old
shape.

### 1.1 The gap (evidence on `f6eb8d8`)

| ADR-0043 improvement | EA today | EN today |
| --- | --- | --- |
| Safety net: kill switches, error budget, safe mode | `frontend/safety/{boot,features,runtime}.ts` | none. `init()` hooks everything or nothing (`enhanced-notifications/frontend/index.tsx:26-34`) |
| One `PlayNotificationSound` wrapper that decides nothing | `frontend/steam/notification-hook.ts` | `steam/notifications.ts:127-167`: discovery, the wrapper, the sound decision, durations and previews in one 260-line file |
| Surfaces with `touches`, installed in isolation, uninstalled on trip | `frontend/kernel/surface.ts`, `frontend/surfaces/*` | styling is `style/injector.ts`, wired straight from `init()`; nothing can be switched off |
| Settings panel never imports a feature (D7) | previews injected as a prop | `settings-panel.tsx:5` imports `previewCategory` from `steam/notifications` |
| Layering: the Steam layer never imports the theme | enforced | `steam/selectors.ts:2` imports `ToastSelectors` from `theme/theme` |
| Architecture test (ratchet, pure files, one owner per Steam write, RPCs, drift) | `tests/architecture.test.ts` | none |
| `npm run test:live` runner with settings snapshot and restore | `tests/run-live.mjs` | none |

### 1.2 The coexistence risk this fixes

Both plugins wrap `NotificationStore.prototype.PlayNotificationSound`, in whichever order Millennium loads them, each
with **its own** code. Nothing tests that they compose. And EA's architecture test reads a path inside EN
(`enhanced-achievements/tests/architecture.test.ts`, test "pristineDuration is identical to the enhanced-notifications
copy", reads `enhanced-notifications/frontend/steam/notifications.ts`), so any EN refactor that moves that file makes
EA's check skip silently (it only checks `existsSync`).

The port makes EN use **the same hook file** as EA (byte-identical, checked by a test in both plugins) and adds a unit
test that drives two copies of the hook on one fake store in both load orders: every plugin's listeners see every toast
once, achievement toasts get EA's sound only, other types get EN's, unthemed types get Steam's chime exactly once, and
no instance `ChooseSound` is left behind.

### 1.3 Size: small enough to do in one sitting

EN's frontend is about 1.5k lines. Most of the new code is a verbatim copy of EA's (safety, `kernel/surface.ts`,
`steam/notification-hook.ts`); the rest is `steam/notifications.ts` cut into a discovery module and three surfaces. The
patches total about 1.9k lines, 60 % of them tests and docs. The code is already written and dry-run (§ 11), so the
implementer only applies and checks.

### 1.4 Ported, and not ported

- **Ported:** safety net (ids `style`, `sound`, `duration`, `preview`; boot key `enhanced-notifications.boot`; the same
  `disabledFeatures` setting); kernel `Surface` contract; the shared hook; surfaces; the D7 panel rule; the architecture
  test; the live runner; a live `safety.mjs`.
- **Not ported, on purpose:** the event bus and sensors (nothing in EN acts after a toast), the banner scheduler (Steam
  draws EN's toasts), the jsx runtime hook (ruled out live 2026-09-24: for these toasts the wrapped element was not the
  one React committed, see the header of `style/injector.ts`).
- **Not in scope** (EA features, not architecture): § 12.

## 2. The design

### 2.1 File map

| Before (EN) | After (EN) | Step |
| --- | --- | --- |
| — | `frontend/safety/{boot,features,runtime}.ts` (EA copies; ids, key, doc path changed) | 1 |
| — | `frontend/kernel/surface.ts` (identical to EA), `kernel/notification.ts` (`{ eType }` only) | 1 |
| `steam/notifications.ts` wrapper (`installSoundHook`) | `frontend/steam/notification-hook.ts` (identical to EA) | 1 |
| `steam/notifications.ts` discovery, `typeName`, `knownTypeNames`, `pristineDuration` | `frontend/steam/notification-store.ts` (read-only) | 2 |
| `steam/notifications.ts` `achievementsClaims`, `handles` | `frontend/steam/coexistence.ts` (read-only) | 2 |
| `steam/notifications.ts` sound decision | `surfaces/sound/sound.ts` (pure) + `surfaces/sound/index.ts` | 2 |
| `steam/notifications.ts` `applyDurations` | `surfaces/duration/duration.ts` (pure) + `surfaces/duration/index.ts` | 2 |
| `steam/notifications.ts` `previewCategory` | `surfaces/preview/index.ts` | 2 |
| `style/injector.ts` | `surfaces/style/injector.ts` (moved; `installInjector`/`uninstallInjector`) + `surfaces/style/index.ts` | 2 |
| `theme/theme.ts` `ToastSelectors` | `kernel/toast-selectors.ts`, re-exported by `theme.ts` | 2 |
| `index.tsx` | composition root like EA's: safety, boot, store, hook, surfaces, `surfaceStatus()`, `safetyDiagnostics()`, `SettingsPanelView` | 2 |
| — | `tests/safety.test.ts` (11), `tests/notifications.test.ts` (10), `tests/architecture.test.ts` (10) | 1-3 |
| — | `tests/run-live.mjs`, `tests/safety.mjs`, `npm run test:live` | 3 |

### 2.2 Behaviour that must not change

Everything a user sees stays as it is: same themes, same settings (plus the hidden `disabledFeatures`, default empty),
same styling mechanism, same sound rules (a clip plays only if Steam wants a sound; `false` mutes; a suspended audio
context gives Steam's chime once), same durations, same achievement hand-over to EA through `claims()`. Start-up order
is the same: settings, store, hook, toasts-off detection, selectors, theme, then the surfaces (the old code wrote
durations before the theme loaded and again on load; the new one writes once after, with the same result).

What is new: a failing path switches itself off (5 errors) and gives Steam's behaviour back for that path only; two
unclean starts start in safe mode; a tripped `duration` restores only the types EN wrote, never EA's.

### 2.3 Shared-file rule

`steam/notification-hook.ts` and `kernel/surface.ts` are identical in EA and EN; `pristineDuration` is identical too.
Each plugin's `tests/architecture.test.ts` fails when a copy differs. Change them in both plugins in one commit. Step 2
updates EA's test to read EN's whole `frontend/` for `pristineDuration` (it moves to `steam/notification-store.ts`) and
adds the two new drift checks on EA's side.

## 3. Preconditions

Run from `c:\game\millennium` in PowerShell unless a line says otherwise. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- enhanced-notifications enhanced-achievements docs AGENTS.md` | prints nothing |
| P2 | `git merge-base --is-ancestor f6eb8d8 HEAD; $LASTEXITCODE` | `0` |
| P3 | `cd enhanced-notifications; npm run check; cd ..` | after the npm banner and `> tsc --noEmit`: nothing; exit 0 |
| P4 | `cd enhanced-notifications; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 10`, `ℹ fail 0` |
| P5 | `cd enhanced-achievements; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 116`, `ℹ fail 0` |
| P6 | `git apply --check docs/plans/enhanced-notifications-architecture-port/s1-safety-kernel-hook.patch` | prints nothing, exit 0 (else § 6 rule R) |

If P4 or P5 shows another count, stop (§ 10): something changed since the dry run.

## 4. Do-not-touch list

- `enhanced-notifications/backend/**`, `dev.ps1`, `themes/**`, `themes.md`, `README.md`, `plugin.json`,
  `frontend/rpc.ts`, `frontend/logger.ts`, `frontend/steam/webpack.ts`, `frontend/steam/notification-settings.ts`,
  `frontend/theme/active-theme.ts`, `tests/theme.test.ts`, `tests/categories.mjs`, `tests/sound-duration.mjs`,
  `tests/cdp.mjs`, `tests/reload.mjs`, `tests/console.mjs`, `tests/probes/**`.
- Every file under `enhanced-achievements/` except `tests/architecture.test.ts` (step 2 only). In particular EA's
  `steam/notification-hook.ts` and `kernel/surface.ts`: EN copies them, EA does not change.
- `enhanced-notifications/tests/architecture-allowlist.json` after step 3: it is `[]` and stays `[]`.
- `steam-cartridges/**`.
- The patch files themselves. Never edit a patch or a file it creates "to make it fit".

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no probe or throwaway
plugins; no edits to Millennium's `config.json` or any plugin config; no changes to the user's library, collections or
shortcuts; no `npm install`/upgrade (ignore the `@steambrew/ttc` update nag); no `git push` at all (the user pushes
after § 9); no `git push --force`; no `--no-verify`; no `ARCH_WRITE_ALLOWLIST=1`. **No AI attribution** in any commit
(AGENTS.md Routine 6): no `Co-Authored-By` line, no "Generated with" footer, whatever a tool suggests.

## 6. Steps

Each step: check the patch, apply it, compare `git status` and the checks with the expected output, commit. All `git`
commands run from `c:\game\millennium`; `npm` commands from the plugin folder named.

**Rule R (a patch that does not apply).** If `git apply --check <patch>` fails, run `git apply -3 <patch>` once. If it
applies every file cleanly, go on to the step's checks. If it reports a conflict, run `git checkout -- .` and
`git clean -fd enhanced-notifications docs/enhanced-notifications`, then stop (§ 10): the plan is stale.

### Step 1: safety net, kernel contract, shared hook (nothing wired yet)

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s1-safety-kernel-hook.patch   # no output
git apply docs/plans/enhanced-notifications-architecture-port/s1-safety-kernel-hook.patch
git status --short
```

Expected `git status` (5 lines):

```
 M enhanced-notifications/tsconfig.json
?? enhanced-notifications/frontend/kernel/
?? enhanced-notifications/frontend/safety/
?? enhanced-notifications/frontend/steam/notification-hook.ts
?? enhanced-notifications/tests/safety.test.ts
```

Checks:
- `cd enhanced-notifications; npm run check` → nothing after the banner, exit 0.
- `npm test 2>&1 | Select-String '^ℹ (pass|fail)'` → `ℹ pass 21`, `ℹ fail 0`.
- `cd ..\enhanced-achievements; npm test 2>&1 | Select-String '^ℹ (pass|fail)'` → `ℹ pass 116`, `ℹ fail 0`. `cd ..`
- `git diff --no-index --stat enhanced-achievements/frontend/steam/notification-hook.ts enhanced-notifications/frontend/steam/notification-hook.ts`
  → prints nothing (identical). Same for `frontend/kernel/surface.ts`.

Commit:
```powershell
git add enhanced-notifications/tsconfig.json enhanced-notifications/frontend/kernel enhanced-notifications/frontend/safety enhanced-notifications/frontend/steam/notification-hook.ts enhanced-notifications/tests/safety.test.ts
git commit -m "refactor(enhanced-notifications): safety net, Surface contract and the notification hook shared with enhanced-achievements"
```

### Step 2: split `steam/notifications.ts` into the store, coexistence and four surfaces; wire them

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s2-steam-surfaces.patch
git apply docs/plans/enhanced-notifications-architecture-port/s2-steam-surfaces.patch
git status --short
```

Expected `git status` (14 lines):

```
 M enhanced-achievements/tests/architecture.test.ts
 M enhanced-notifications/frontend/index.tsx
 M enhanced-notifications/frontend/settings/settings-panel.tsx
 M enhanced-notifications/frontend/settings/settings.ts
 D enhanced-notifications/frontend/steam/notifications.ts
 M enhanced-notifications/frontend/steam/selectors.ts
 D enhanced-notifications/frontend/style/injector.ts
 M enhanced-notifications/frontend/theme/theme.ts
 M enhanced-notifications/settings.json
?? enhanced-notifications/frontend/kernel/toast-selectors.ts
?? enhanced-notifications/frontend/steam/coexistence.ts
?? enhanced-notifications/frontend/steam/notification-store.ts
?? enhanced-notifications/frontend/surfaces/
?? enhanced-notifications/tests/notifications.test.ts
```

(`style/injector.ts` shows as deleted and `surfaces/` as new until `git add`; git records it as a rename.)

Checks:
- `cd enhanced-notifications; npm run check` → nothing, exit 0.
- `npm test 2>&1 | Select-String '^ℹ (pass|fail)'` → `ℹ pass 31`, `ℹ fail 0`. The output lists
  `✔ hook composition (enhanced-achievements first): ...` and `✔ hook composition (enhanced-notifications first): ...`.
- `npm run build 2>&1 | Select-String 'Succeeded|TS[0-9]+'` → a `TS5096` line (the known warning; EA's build prints the
  same) and `build Succeeded passing all tests in … ms elapsed.`
- `cd ..\enhanced-achievements; npm test 2>&1 | Select-String '^ℹ (pass|fail|skipped)'` → `ℹ pass 118`, `ℹ fail 0`,
  `ℹ skipped 0` (two new drift checks). `cd ..`
- `git grep -n "steam/notifications'" -- enhanced-notifications/frontend` → prints nothing.

Commit:
```powershell
git add -A enhanced-notifications/frontend enhanced-notifications/settings.json enhanced-notifications/tests/notifications.test.ts enhanced-achievements/tests/architecture.test.ts
git commit -m "refactor(enhanced-notifications): one surface per Steam write (style, sound, duration, preview), kill switches wired"
```

### Step 3: architecture test and the live runner

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s3-architecture-live.patch
git apply docs/plans/enhanced-notifications-architecture-port/s3-architecture-live.patch
git status --short
```

Expected `git status` (5 lines):

```
 M enhanced-notifications/package.json
?? enhanced-notifications/tests/architecture-allowlist.json
?? enhanced-notifications/tests/architecture.test.ts
?? enhanced-notifications/tests/run-live.mjs
?? enhanced-notifications/tests/safety.mjs
```

Checks (from `enhanced-notifications`):
- `npm run check` → nothing, exit 0.
- `npm test 2>&1 | Select-String '^ℹ (pass|fail|skipped)'` → `ℹ pass 41`, `ℹ fail 0`, `ℹ skipped 0`.
- `node --check tests/safety.mjs; node --check tests/run-live.mjs; $LASTEXITCODE` → `0`, nothing else.
- `Get-Content tests/architecture-allowlist.json` → `[]`.

Commit:
```powershell
git add enhanced-notifications/package.json enhanced-notifications/tests/architecture-allowlist.json enhanced-notifications/tests/architecture.test.ts enhanced-notifications/tests/run-live.mjs enhanced-notifications/tests/safety.mjs
git commit -m "test(enhanced-notifications): architecture test, npm run test:live, live kill-switch check"
```

### Step 4: docs (the new architecture doc, ADR-0047, indexes, changelog)

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s4-docs.patch
git apply docs/plans/enhanced-notifications-architecture-port/s4-docs.patch
git status --short
```

Expected `git status` (7 lines):

```
 M AGENTS.md
 M docs/README.md
 M docs/decisions.md
 M docs/enhanced-achievements/architecture.md
 M docs/plugins.md
 M enhanced-notifications/CHANGELOG.md
?? docs/enhanced-notifications/
```

Creates `docs/enhanced-notifications/architecture.md`; appends ADR-0047 to `decisions.md`; one row each in
`docs/README.md` and `AGENTS.md`; EA's architecture doc gets the new drift checks in its Tests row and a History line;
guardrail 12's reference path in `plugins.md` follows the moved injector; EN's CHANGELOG gets `[Unreleased]` entries.

Then, by hand with the Edit tool (all files are LF):

1. [TASK.md](../../TASK.md): delete the § Next bullet that starts `**enhanced-notifications architecture port (ADR-0047): planned` (4 lines), and add at the top of § Now:

   ```markdown
   **enhanced-notifications architecture port (ADR-0047): code committed (<date>), waiting for the live verification in
   [its plan § 9](docs/plans/enhanced-notifications-architecture-port-plan.md).** Deploy EN with `dev.ps1`, then `npm run test:live`
   in both toast plugins, then the by-hand checks.
   ```

2. [CHANGELOG.md](../../CHANGELOG.md), a new first bullet after the intro paragraph:

   ```markdown
   - **enhanced-notifications: enhanced-achievements' architecture (ADR-0047, code done, live verification pending) (<date>)**: safety net (kill switches `style`, `sound`, `duration`, `preview`; error budget; safe mode), one surface per Steam write, the same `steam/notification-hook.ts` and `kernel/surface.ts` as enhanced-achievements (drift-checked in both plugins, composition unit-tested in both load orders), architecture test, `npm run test:live`. EN `npm test` 10 → 41, EA 116 → 118. Plan: [enhanced-notifications-architecture-port-plan.md](docs/plans/enhanced-notifications-architecture-port-plan.md).
   ```

Check: `git diff --stat -- TASK.md CHANGELOG.md` → `2 files changed`; `Select-String -Path TASK.md -Pattern 'planned and dry-run'` prints nothing.

Commit:
```powershell
git add AGENTS.md docs/README.md docs/decisions.md docs/enhanced-achievements/architecture.md docs/plugins.md docs/enhanced-notifications enhanced-notifications/CHANGELOG.md TASK.md CHANGELOG.md
git commit -m "docs: enhanced-notifications architecture (ADR-0047)"
```

Then stop. Do not push.

## 7. Guardrail checklist

After step 4's commit, re-read each guardrail in [plugins.md](../plugins.md) and tick it with the one-line proof (the
`HEAD~n` refs assume the four step commits are the last four).

- [ ] **2 (O(1) hot paths):** the hook's listeners and sound handler run inside `PlayNotificationSound`. The sound
  handler is map lookups (`typeName`, `soundFor`, `claims()`, all O(1)); the style listener is the pre-existing
  `onCurrentToast` (unchanged work). Proof: `git show -M HEAD~2 -- enhanced-notifications/frontend/style/injector.ts enhanced-notifications/frontend/surfaces/style/injector.ts`
  (a rename, about +65/−15) adds only `installed` checks, `isEnabled('style')` and `reportError` to the per-toast path.
- [ ] **12 (popup hooks):** the Big Picture window is still found through the `GamepadToastPlaceholder` fiber; the
  window hook is added once. Proof: in the same `git show`, `viewWindowFromFiber` has no changed line and
  `scanBigPictureToastWindows` changes only its catch (`logger.warn` → `reportError('style', error)`).
- [ ] **14 (a gate never removes working behaviour):** `disabledFeatures` defaults to `""`, so every feature is on as
  before. Proof: `enhanced-notifications/settings.json` ends with `"disabledFeatures": ""`.
- [ ] **15 (never weaken a check):** `tests/theme.test.ts`, `categories.mjs` and `sound-duration.mjs` are unchanged;
  EA's drift test got stricter (reads the whole sibling `frontend/`, two more files). Proof:
  `git diff HEAD~4 --stat -- enhanced-notifications/tests/theme.test.ts enhanced-notifications/tests/categories.mjs enhanced-notifications/tests/sound-duration.mjs` prints nothing.
- [ ] **17 (a render never starts work):** no component starts work; the panel only receives `onPreview` as a prop and
  calls it from a click. Proof: `settings-panel.tsx` diff is the prop and the import.
- [ ] **ADR-0043 / ADR-0047:** `tests/architecture-allowlist.json` is `[]`; both plugins' drift checks pass.

## 8. What each step proves

| After | EN `npm test` | EA `npm test` | Also |
| --- | --- | --- | --- |
| P | 10 | 116 | |
| 1 | 21 (+11 safety) | 116 | hook and surface files identical to EA's |
| 2 | 31 (+10 hook composition, sound, duration, surfaces) | 118 (+2 drift) | build Succeeded |
| 3 | 41 (+10 architecture) | 118 | allowlist `[]` |
| 4 | — | — | docs only |

## 9. Live verification (the user, or a verifier the user names)

The implementer stops after step 4. EA's code does not change (only its test), so only EN is redeployed.

Note: on 2026-09-30 the client log had no Enhanced Notifications lines at all (only Enhanced Achievements), so EN was not
loaded; `dev.ps1` deploys and enables the `-dev` copy.

1. From `enhanced-notifications`: `powershell -ExecutionPolicy Bypass -File dev.ps1` (deploys `enhanced-notifications-dev`
   and restarts Steam). Wait for the library.
2. Right after the restart, before opening anything: `Select-String -Path C:\game\steam\logs\webhelper_js.txt -Pattern 'Enhanced Notifications' | Select-Object -Last 10`
   shows `Notification hook installed (<n> types).` and `Toast styling installed.`, and no `exceeded its error budget`
   or `Safe mode:` line. (`safety.mjs` in step 3 also checks `safetyDiagnostics()` and `surfaceStatus()`.)
3. `npm run test:live` in `enhanced-notifications` (desktop mode). Expected, in this order:
   ```
   PASS  safety.mjs
   PASS  categories.mjs
   PASS  sound-duration.mjs
   PASS  settings restored  (…)
   ```
   `categories.mjs` prints `PASS  achievement: left to Enhanced Achievements` when EA is loaded with a theme.
4. `npm run test:live` in `enhanced-achievements`: every line `PASS` (bigpicture may `SKIP`), as before the port. This is
   the live proof that EA's sound, banner and duration still work with EN's new hook in the chain.
5. By hand, desktop then Big Picture: EN settings panel → **Preview** Downloads (restyled, EN sound if the theme sets
   one) and Achievements (EA's banner and EA's sound, heard once, not twice). Toggle **Themed style / sounds / display
   time** off and on: Steam's own look, sound and timing come back when off.
6. Kill switch by hand: in the SharedJSContext console,
   `PLUGIN_LIST['enhanced-notifications-dev'].setSetting('disabledFeatures', 'style')`, preview Downloads (Steam's own
   look), then `setSetting('disabledFeatures', '')` (restyled again).

If step 3 or 4 fails, set `disabledFeatures` to the failing id to get Steam's behaviour back, record the output in
TASK.md, and roll back with `git revert` of the four commits (newest first) and `dev.ps1` again.

Only after 1 to 6: move the TASK.md entry to CHANGELOG as verified, and push (AGENTS.md Routine 5).

## 10. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines)
and the step number to [TASK.md](../../TASK.md) § Active failures & blockers (replace its `None.`), then exit. Do not retry, edit a patch, edit around the failure or skip ahead. A `git apply` that
fails after Rule R is a failure of that step.

## 11. Dry-run record (2026-09-30)

- The code was written in a scratch worktree of `0dcde42`, cut into four step commits, then rebased onto `f6eb8d8`
  (one conflict, `docs/decisions.md`: ADR-0046 had gained three lines; ADR-0047 now appends after them). The patches
  are `git diff -M` of those commits.
- A clean worktree of `f6eb8d8`: each patch `git apply --check` exit 0, applied and committed in order:

  | After | `git status` lines | EN check | EN `npm test` | EA `npm test` |
  | --- | --- | --- | --- | --- |
  | s1 | 5 | exit 0 | 21/0 | 116/0 |
  | s2 | 14 | exit 0 | 31/0 | 118/0 |
  | s3 | 5 | exit 0 | 41/0 | 118/0 |
  | s4 | 7 | — | — | — |

  Then `node --check` of both new `.mjs` files exit 0, EN `npm run build` Succeeded (TS5096 only, which EA's build also
  prints), EA `npm run check` exit 0, and the result is identical to the scratch tree (`git diff --stat` empty).
- **Not dry-run** (needs the deployed client): § 9. The hook composition is proven by unit test only until § 9 steps 3-5.

## 12. Not in this plan (follow-ups)

- EA features that are not architecture: JSONC themes (`.jsonc` lookup in `backend/main.lua` + `theme/jsonc.ts`),
  absolute asset paths in `LoadAssets`, the settings panel spacing system (`Blocks`, [guardrail 18](../plugins.md#18-settings-panel-layout-reference-enhanced-achievements)).
  Each is a small plan of its own; the backend `_lib/` folders are already identical.
- EN README: a Troubleshooting line for `disabledFeatures` and safe mode (EA's README has the equivalent).
- If EN ever needs to act after a toast (captures, logging), port EA's event bus and a sensor rather than adding work
  to the hook.
