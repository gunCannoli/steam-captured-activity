# Plan: make enhanced-notifications a sibling of enhanced-achievements

**Status:** planned and dry-run (2026-09-30), not executed. **Base:** `feb2cef`. **Decision:** ADR-0047 (written by step 6).
**Implementer:** apply six patches, run the checks, commit. No code is written by hand except two short TASK/CHANGELOG
entries in step 6. **Verifier:** the user (§ 9).

This file is the plan; the code is in [enhanced-notifications-architecture-port/](enhanced-notifications-architecture-port/)
as six patches, one per step.

## 1. Why, and what the evaluation found

`enhanced-notifications` (EN) was copied from `enhanced-achievements` (EA) before EA's migration (E0a-E3,
[ADR-0043](../decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net)) and before
EA 1.0.0 (JSONC themes, the settings spacing system). The two must run together without conflict (EA owns achievement
toasts, EN restyles every other type) and should read as siblings: same architecture, same theme format, same panel.

### 1.1 The gap (evidence on `feb2cef`)

| EA has | EA where | EN today |
| --- | --- | --- |
| Safety net: kill switches, error budget, safe mode | `frontend/safety/{boot,features,runtime}.ts` | none. `init()` hooks everything or nothing (`enhanced-notifications/frontend/index.tsx:26-34`) |
| One `PlayNotificationSound` wrapper that decides nothing | `frontend/steam/notification-hook.ts` | `steam/notifications.ts:127-167`: discovery, the wrapper, the sound decision, durations and previews in one 260-line file |
| Surfaces with `touches`, installed in isolation, uninstalled on trip | `frontend/kernel/surface.ts`, `frontend/surfaces/*` | styling is `style/injector.ts`, wired straight from `init()`; nothing can be switched off |
| Settings panel never imports a feature (D7) | previews injected as a prop | `settings-panel.tsx:5` imports `previewCategory` from `steam/notifications` |
| The Steam layer never imports the theme | enforced | `steam/selectors.ts:2` imports `ToastSelectors` from `theme/theme` |
| Architecture test (ratchet, pure files, one owner per Steam write, RPCs, drift) | `tests/architecture.test.ts` | none |
| `npm run test:live` with settings snapshot and restore | `tests/run-live.mjs` | none |
| JSONC themes (`.jsonc` before `.json`, comments, trailing commas) | `backend/main.lua` `THEME_EXTENSIONS`, `frontend/theme/jsonc.ts` | `.json` only, `JSON.parse` (`theme/active-theme.ts:82`) |
| Absolute asset paths | `backend/main.lua` `LoadAssets`, `themes.md` § File paths | the backend already allows them (`is_absolute(rel) and rel`), but `themes.md` says "paths relative to the theme folder" |
| Settings rows and spacing system ([guardrail 18](../plugins.md#18-settings-panel-layout-reference-enhanced-achievements)) | `settings/settings-panel.tsx` (`Blocks`, `ItemRow`, `ButtonRow`, …) | bare `ButtonItem`/`DropdownItem`/`ToggleField`, a status line, a loose `<div>` warning |

### 1.2 The coexistence risk this fixes

Both plugins wrap `NotificationStore.prototype.PlayNotificationSound`, in whichever order Millennium loads them, each
with **its own** code. Nothing tests that they compose. And EA's architecture test reads a path inside EN (test
"pristineDuration is identical to the enhanced-notifications copy" reads `enhanced-notifications/frontend/steam/notifications.ts`),
so any EN refactor that moves that file makes EA's check skip silently (it only checks `existsSync`).

The port makes EN use **the same hook file** as EA (byte-identical, checked by a test in both plugins) and adds a unit
test that drives two copies of the hook on one fake store in both load orders: every plugin's listeners see every toast
once, achievement toasts get EA's sound only, other types get EN's, unthemed types get Steam's chime exactly once, and
no instance `ChooseSound` is left behind.

### 1.3 Shared copies (the sibling rule)

Plugins may not import each other, so everything the two do the same way becomes an identical copy, and **each** plugin's
architecture test fails when a copy drifts:

| Shared | Step |
| --- | --- |
| `frontend/steam/notification-hook.ts`, `frontend/kernel/surface.ts` | 1 (checks from step 2/3) |
| `pristineDuration` (EN: `steam/notification-store.ts`; EA: `steam/notification-store.ts`) | 2 |
| `frontend/theme/jsonc.ts`; `backend/main.lua` (identical but for the plugin name) | 4 |
| `frontend/settings/rows.tsx` (moved out of EA's `settings-panel.tsx`, no visible change in EA) | 5 |

### 1.4 Size

EN's frontend is about 1.5k lines. Most new code is a verbatim copy of EA's; the rest is `steam/notifications.ts` cut
into a discovery module and four surfaces, and EN's panel rebuilt on EA's rows. The six patches total about 3.8k lines,
about 60 % tests and docs. The code is written and dry-run (§ 11); the implementer only applies and checks.

### 1.5 Ported, and not ported

- **Ported:** safety net (ids `style`, `sound`, `duration`, `preview`; boot key `enhanced-notifications.boot`; the same
  `disabledFeatures` setting); kernel `Surface` contract; the shared hook; surfaces; the D7 panel rule; the architecture
  test; the live runner and a live `safety.mjs`; JSONC themes; absolute sound paths (documented); the settings rows and
  spacing; a README Troubleshooting section.
- **Not ported, on purpose:** the event bus and sensors (nothing in EN acts after a toast), the banner scheduler (Steam
  draws EN's toasts), the jsx runtime hook (ruled out live 2026-09-24: for these toasts the wrapped element was not the
  one React committed, see the header of `style/injector.ts`).
- **Not in scope:** § 12.

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
| `backend/main.lua` (`.json` only) | EA's `backend/main.lua` with the plugin name swapped (`.jsonc` then `.json`) | 4 |
| `theme/active-theme.ts` `JSON.parse` | `parseJsonc` from the new `theme/jsonc.ts` (identical to EA) | 4 |
| `tests/theme.test.ts` | loads bundled themes as JSONC; EA's 5 JSONC tests appended | 4 |
| `settings/settings-panel.tsx` | rebuilt on `settings/rows.tsx` (identical to EA's new file): Theme, Preview notifications, General, Reset | 5 |
| `steam/notification-settings.ts` `toastWarning()` | deleted (unused; EA deleted its copy as EA-K7) | 5 |

EA files changed: `tests/architecture.test.ts` (steps 2, 4, 5), `frontend/settings/settings-panel.tsx` (step 5: its
rows and constants move, verbatim, to the new `frontend/settings/rows.tsx`), `CHANGELOG.md` (step 6). No EA behaviour
changes.

### 2.2 Behaviour that must not change

EN: same themes (every `.json` theme still loads; JSONC is a superset), same settings keys (plus the hidden
`disabledFeatures`, default empty), same styling mechanism, same sound rules (a clip plays only if Steam wants a sound;
`false` mutes; a suspended audio context gives Steam's chime once), same durations, same achievement hand-over to EA
through `claims()`. Start-up order is the same: settings, store, hook, toasts-off detection, selectors, theme, surfaces.

EN panel, visible changes (the point of step 5): EA's layout. The theme dropdown takes the full row under its label; a
theme problem shows under it (no "Loaded …" status line); sections Theme / Preview notifications / General / Reset;
controls are disabled while Steam's toasts are off (as in EA). Same options and actions as before.

EA: no visible change. `rows.tsx` is EA's own code, moved; the only edit to it is two type-only casts in `SliderRow`
(`as unknown as number`) so the same file also compiles in EN, which has no numeric setting.

New: a failing path switches itself off (5 errors) and gives Steam's behaviour back for that path only; two unclean
starts start in safe mode; a tripped `duration` restores only the types EN wrote, never EA's.

## 3. Preconditions

Run from `c:\game\millennium` in PowerShell unless a line says otherwise. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- enhanced-notifications enhanced-achievements docs AGENTS.md` | prints nothing |
| P2 | `git merge-base --is-ancestor feb2cef HEAD; $LASTEXITCODE` | `0` |
| P3 | `cd enhanced-notifications; npm run check; cd ..` | after the npm banner and `> tsc --noEmit`: nothing; exit 0 |
| P4 | `cd enhanced-notifications; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 10`, `ℹ fail 0` |
| P5 | `cd enhanced-achievements; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 116`, `ℹ fail 0` |
| P6 | `git apply --check docs/plans/enhanced-notifications-architecture-port/s1-safety-kernel-hook.patch` | prints nothing, exit 0 (else § 6 rule R) |

If P4 or P5 shows another count, stop (§ 10): something changed since the dry run.

## 4. Do-not-touch list

- `enhanced-notifications/dev.ps1`, `backend/_lib/**`, `themes/**`, `plugin.json`, `frontend/rpc.ts`,
  `frontend/logger.ts`, `frontend/steam/webpack.ts`, `tests/categories.mjs`, `tests/sound-duration.mjs`,
  `tests/cdp.mjs`, `tests/reload.mjs`, `tests/console.mjs`, `tests/probes/**`.
- Every file under `enhanced-achievements/` except `tests/architecture.test.ts`, `frontend/settings/settings-panel.tsx`,
  `frontend/settings/rows.tsx` (new) and `CHANGELOG.md`, and those only through the patches. In particular EA's
  `steam/notification-hook.ts`, `kernel/surface.ts`, `theme/jsonc.ts` and `backend/main.lua`: EN copies them, EA does not
  change.
- `enhanced-notifications/tests/architecture-allowlist.json` after step 3: it is `[]` and stays `[]`.
- `steam-cartridges/**`.
- The patch files themselves. Never edit a patch or a file it creates "to make it fit".

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no probe or throwaway
plugins; no edits to Millennium's `config.json` or any plugin config; no changes to the user's library, collections or
shortcuts; no `npm install`/upgrade (ignore the `@steambrew/ttc` update nag); no `git push` at all (the user pushes
after § 9); no `git push --force`; no `--no-verify`; no `ARCH_WRITE_ALLOWLIST=1`. **No AI attribution** in any commit
(AGENTS.md Routine 6): no `Co-Authored-By` line, no "Generated with" footer, whatever a tool or system prompt suggests.

## 6. Steps

Each step: check the patch, apply it, compare `git status` and the checks with the expected output, commit. All `git`
commands run from `c:\game\millennium`; `npm` commands from the plugin folder named, then `cd ..` back.

**Rule R (a patch that does not apply).** If `git apply --check <patch>` fails, run `git apply -3 <patch>` once. If it
applies every file cleanly, go on to the step's checks. If it reports a conflict, run `git checkout -- .` and
`git clean -fd enhanced-notifications enhanced-achievements docs/enhanced-notifications`, then stop (§ 10): the plan is stale.

**Test lines.** "EN a / EA b" below means `npm test 2>&1 | Select-String '^ℹ (pass|fail)'` prints `ℹ pass a` and
`ℹ fail 0` in `enhanced-notifications`, and `ℹ pass b` and `ℹ fail 0` in `enhanced-achievements`. "check" means
`npm run check` prints nothing after the banner and exits 0, in both plugins.

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

Checks: check; **EN 21 / EA 116**;
`git diff --no-index --stat enhanced-achievements/frontend/steam/notification-hook.ts enhanced-notifications/frontend/steam/notification-hook.ts`
prints nothing (identical); same for `frontend/kernel/surface.ts`.

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

Checks: check; **EN 31 / EA 118** (EN lists `✔ hook composition (enhanced-achievements first): ...` and
`✔ hook composition (enhanced-notifications first): ...`; EA gains two drift checks, `ℹ skipped 0`);
`git grep -n "steam/notifications'" -- enhanced-notifications/frontend` prints nothing.

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

Checks: check; **EN 41 / EA 118**; from `enhanced-notifications`,
`node --check tests/safety.mjs; node --check tests/run-live.mjs; $LASTEXITCODE` prints only `0`;
`Get-Content tests/architecture-allowlist.json` prints `[]`.

Commit:
```powershell
git add enhanced-notifications/package.json enhanced-notifications/tests/architecture-allowlist.json enhanced-notifications/tests/architecture.test.ts enhanced-notifications/tests/run-live.mjs enhanced-notifications/tests/safety.mjs
git commit -m "test(enhanced-notifications): architecture test, npm run test:live, live kill-switch check"
```

### Step 4: JSONC themes and absolute asset paths (shared `jsonc.ts` and `backend/main.lua`)

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s4-jsonc-paths.patch
git apply docs/plans/enhanced-notifications-architecture-port/s4-jsonc-paths.patch
git status --short
```

Expected `git status` (6 lines):

```
 M enhanced-achievements/tests/architecture.test.ts
 M enhanced-notifications/backend/main.lua
 M enhanced-notifications/frontend/theme/active-theme.ts
 M enhanced-notifications/tests/architecture.test.ts
 M enhanced-notifications/tests/theme.test.ts
?? enhanced-notifications/frontend/theme/jsonc.ts
```

Checks: check; **EN 48 / EA 120** (EN: 5 JSONC tests, `theme/jsonc.ts` drift, backend drift; EA: the same two drift
checks from its side); from `c:\game\millennium`:
`(Get-Content enhanced-achievements/backend/main.lua -Raw).Replace('enhanced-achievements','enhanced-notifications') -ceq (Get-Content enhanced-notifications/backend/main.lua -Raw)`
prints `True`.

Commit:
```powershell
git add enhanced-achievements/tests/architecture.test.ts enhanced-notifications/backend/main.lua enhanced-notifications/frontend/theme/active-theme.ts enhanced-notifications/frontend/theme/jsonc.ts enhanced-notifications/tests/architecture.test.ts enhanced-notifications/tests/theme.test.ts
git commit -m "feat(enhanced-notifications): JSONC themes and the backend shared with enhanced-achievements"
```

### Step 5: settings panel on enhanced-achievements' rows and spacing (shared `settings/rows.tsx`)

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s5-settings-panel.patch
git apply docs/plans/enhanced-notifications-architecture-port/s5-settings-panel.patch
git status --short
```

Expected `git status` (7 lines):

```
 M enhanced-achievements/frontend/settings/settings-panel.tsx
 M enhanced-achievements/tests/architecture.test.ts
 M enhanced-notifications/frontend/settings/settings-panel.tsx
 M enhanced-notifications/frontend/steam/notification-settings.ts
 M enhanced-notifications/tests/architecture.test.ts
?? enhanced-achievements/frontend/settings/rows.tsx
?? enhanced-notifications/frontend/settings/rows.tsx
```

Checks: check (both: the shared `SliderRow` must compile in each); **EN 49 / EA 121**;
`git diff --no-index --stat enhanced-achievements/frontend/settings/rows.tsx enhanced-notifications/frontend/settings/rows.tsx`
prints nothing; in each plugin `npm run build 2>&1 | Select-String 'Succeeded|TS[0-9]+'` prints a `TS5096` line (the
known warning, both plugins print it) and `build Succeeded passing all tests in … ms elapsed.`

Commit:
```powershell
git add enhanced-achievements/frontend/settings enhanced-achievements/tests/architecture.test.ts enhanced-notifications/frontend/settings enhanced-notifications/frontend/steam/notification-settings.ts enhanced-notifications/tests/architecture.test.ts
git commit -m "feat(enhanced-notifications): settings panel on the rows and spacing shared with enhanced-achievements"
```

### Step 6: docs (architecture doc, ADR-0047, themes.md, README, changelogs)

```powershell
git apply --check docs/plans/enhanced-notifications-architecture-port/s6-docs.patch
git apply docs/plans/enhanced-notifications-architecture-port/s6-docs.patch
git status --short
```

Expected `git status` (10 lines):

```
 M AGENTS.md
 M docs/README.md
 M docs/decisions.md
 M docs/enhanced-achievements/architecture.md
 M docs/plugins.md
 M enhanced-achievements/CHANGELOG.md
 M enhanced-notifications/CHANGELOG.md
 M enhanced-notifications/README.md
 M enhanced-notifications/themes.md
?? docs/enhanced-notifications/
```

Creates `docs/enhanced-notifications/architecture.md`; appends ADR-0047 to `decisions.md`; one row each in
`docs/README.md` and `AGENTS.md`; EA's architecture doc gets the shared files; guardrail 12 and 18 references in
`plugins.md` follow the moved files; EN's `themes.md` gets File format and File paths; EN's README gets JSONC and
Troubleshooting; both CHANGELOGs get `[Unreleased]` entries.

Then, by hand with the Edit tool (all files are LF):

1. [TASK.md](../../TASK.md): delete the § Next bullet that starts `**enhanced-notifications architecture port (ADR-0047): planned`
   (4 lines), and add at the top of § Now:

   ```markdown
   **enhanced-notifications sibling port (ADR-0047): code committed (<date>), waiting for the live verification in
   [its plan § 9](docs/plans/enhanced-notifications-architecture-port-plan.md).** Deploy both toast plugins with `dev.ps1`, then
   `npm run test:live` in both, then the by-hand checks.
   ```

2. [CHANGELOG.md](../../CHANGELOG.md), a new first bullet after the intro paragraph:

   ```markdown
   - **enhanced-notifications: sibling of enhanced-achievements (ADR-0047, code done, live verification pending) (<date>)**: safety net (kill switches `style`, `sound`, `duration`, `preview`; error budget; safe mode), one surface per Steam write, JSONC themes, absolute sound paths documented, the settings panel on enhanced-achievements' rows and spacing. Shared identical copies, drift-checked in both plugins: `steam/notification-hook.ts` (composition unit-tested in both load orders), `kernel/surface.ts`, `theme/jsonc.ts`, `settings/rows.tsx` (moved out of EA's panel, no visible change), `pristineDuration`, `backend/main.lua`. EN `npm test` 10 → 49, EA 116 → 121. Plan: [enhanced-notifications-architecture-port-plan.md](docs/plans/enhanced-notifications-architecture-port-plan.md).
   ```

Check: `git diff --stat -- TASK.md CHANGELOG.md` → `2 files changed`; `Select-String -Path TASK.md -Pattern 'planned and dry-run'` prints nothing.

Commit:
```powershell
git add AGENTS.md docs/README.md docs/decisions.md docs/enhanced-achievements/architecture.md docs/plugins.md docs/enhanced-notifications enhanced-achievements/CHANGELOG.md enhanced-notifications/CHANGELOG.md enhanced-notifications/README.md enhanced-notifications/themes.md TASK.md CHANGELOG.md
git commit -m "docs: enhanced-notifications as a sibling of enhanced-achievements (ADR-0047)"
```

Then stop. Do not push.

## 7. Guardrail checklist

After step 6's commit, re-read each guardrail in [plugins.md](../plugins.md) and tick it with the one-line proof (the
`HEAD~n` refs assume the six step commits are the last six: step 2 is `HEAD~4`).

- [ ] **2 (O(1) hot paths):** the hook's listeners and sound handler run inside `PlayNotificationSound`. The sound
  handler is map lookups (`typeName`, `soundFor`, `claims()`, all O(1)); the style listener is the pre-existing
  `onCurrentToast` (unchanged work). Proof: `git show -M HEAD~4 -- enhanced-notifications/frontend/style/injector.ts enhanced-notifications/frontend/surfaces/style/injector.ts`
  (a rename, about +65/−15) adds only `installed` checks, `isEnabled('style')` and `reportError` to the per-toast path.
- [ ] **12 (popup hooks):** the Big Picture window is still found through the `GamepadToastPlaceholder` fiber; the
  window hook is added once. Proof: in the same `git show`, `viewWindowFromFiber` has no changed line and
  `scanBigPictureToastWindows` changes only its catch (`logger.warn` → `reportError('style', error)`).
- [ ] **14 (a gate never removes working behaviour):** `disabledFeatures` defaults to `""`, so every feature is on as
  before; every `.json` theme still loads (JSONC is a superset; `every bundled theme resolves for every category` passes).
  Proof: `enhanced-notifications/settings.json` ends with `"disabledFeatures": ""`.
- [ ] **15 (never weaken a check):** `categories.mjs` and `sound-duration.mjs` are unchanged; `theme.test.ts` only
  gains tests and reads `.jsonc` too; EA's drift tests got stricter. Proof:
  `git diff HEAD~6 --stat -- enhanced-notifications/tests/categories.mjs enhanced-notifications/tests/sound-duration.mjs` prints nothing, and
  `git diff HEAD~6 -- enhanced-notifications/tests/theme.test.ts | Select-String '^-[^-]'` shows only the old `load` line and the two `.endsWith('.json')` filters.
- [ ] **17 (a render never starts work):** the panels start no work in a render: EN's panel receives `onPreview` as a
  prop and calls it from a click; `usePanelDisabled` polls from an effect (EA's code). Proof: the `settings-panel.tsx`
  diffs of `HEAD~1`.
- [ ] **18 (settings panel layout):** EN's panel uses `rows.tsx` only (no `ButtonItem`, `DropdownItem`, `ToggleField`,
  no loose `<div>`); the dropdown is three rows. Proof: `git grep -n "ButtonItem\|DropdownItem\|ToggleField\|<div" -- enhanced-notifications/frontend/settings/settings-panel.tsx` prints nothing.
- [ ] **ADR-0043 / ADR-0047:** `tests/architecture-allowlist.json` is `[]`; both plugins' drift checks pass.

## 8. What each step proves

| After | EN `npm test` | EA `npm test` | Also |
| --- | --- | --- | --- |
| P | 10 | 116 | |
| 1 | 21 (+11 safety) | 116 | hook and surface files identical to EA's |
| 2 | 31 (+10 hook composition, sound, duration, surfaces) | 118 (+2 drift) | |
| 3 | 41 (+10 architecture) | 118 | allowlist `[]` |
| 4 | 48 (+5 JSONC, +2 drift) | 120 (+2 drift) | backend identical but for the name |
| 5 | 49 (+1 drift) | 121 (+1 drift) | both builds Succeeded |
| 6 | — | — | docs only |

## 9. Live verification (the user, or a verifier the user names)

The implementer stops after step 6. **Both plugins are redeployed:** EN changed throughout, and EA's settings panel
file changed (a verbatim move into `rows.tsx`).

Note: on 2026-09-30 the client log had no Enhanced Notifications lines at all (only Enhanced Achievements), so EN was not
loaded; `dev.ps1` deploys and enables the `-dev` copy.

1. `powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart` in `enhanced-achievements`, then
   `powershell -ExecutionPolicy Bypass -File dev.ps1` in `enhanced-notifications` (deploys and restarts Steam once).
   Wait for the library.
2. Right after the restart, before opening anything:
   `Select-String -Path C:\game\steam\logs\webhelper_js.txt -Pattern 'Enhanced Notifications' | Select-Object -Last 10`
   shows `Notification hook installed (<n> types).` and `Toast styling installed.`, and no `exceeded its error budget`
   or `Safe mode:` line from either plugin.
3. `npm run test:live` in `enhanced-notifications` (desktop mode). Expected, in this order:
   ```
   PASS  safety.mjs
   PASS  categories.mjs
   PASS  sound-duration.mjs
   PASS  settings restored  (…)
   ```
   `categories.mjs` prints `PASS  achievement: left to Enhanced Achievements` when EA is loaded with a theme.
4. `npm run test:live` in `enhanced-achievements`: every line `PASS` (bigpicture may `SKIP`), as before the port.
   `settings-sound.mjs` and `reset.mjs` mount EA's panel, so this also covers the `rows.tsx` move.
5. JSONC, by hand: copy `enhanced-notifications/themes/steam_midnight.json` to
   `C:\game\steam\millennium\config\enhanced-notifications\themes\midnight_c.jsonc`, add a `// comment` line and a trailing
   comma after the last key, pick **midnight_c (yours)** in the panel, preview Downloads: restyled, no theme problem
   under the dropdown. Delete the file afterwards and pick `steam_midnight` again.
6. Panels, by hand, desktop then Big Picture: EN's panel reads like EA's (Theme with the full-width dropdown and two
   button rows 22 px below it, Preview notifications, General with the three toggles touching, Reset). EA's panel looks
   exactly as before. Preview Downloads (restyled, EN sound if the theme sets one) and Achievements (EA's banner and EA's
   sound, heard once). Toggle **Themed style / sounds / display time** off and on: Steam's own look, sound and timing
   come back when off.
7. Kill switch by hand: in the SharedJSContext console,
   `PLUGIN_LIST['enhanced-notifications-dev'].setSetting('disabledFeatures', 'style')`, preview Downloads (Steam's own
   look), then `setSetting('disabledFeatures', '')` (restyled again).

If step 3 or 4 fails, set `disabledFeatures` to the failing id to get Steam's behaviour back, record the output in
TASK.md, and roll back with `git revert` of the six commits (newest first) and `dev.ps1` again in both plugins.

Only after 1 to 7: move the TASK.md entry to CHANGELOG as verified, and push (AGENTS.md Routine 5).

## 10. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines)
and the step number to [TASK.md](../../TASK.md) § Active failures & blockers (replace its `None.`), then exit. Do not
retry, edit a patch, edit around the failure or skip ahead. A `git apply` that fails after Rule R is a failure of that step.

## 11. Dry-run record (2026-09-30)

- Steps 1-3 were written in a scratch worktree of `0dcde42` and rebased onto `f6eb8d8` (one conflict at the end of
  `docs/decisions.md`). Steps 4-6 were then written in a scratch worktree of `feb2cef` on top of steps 1-3; the docs
  patch of the first version became step 6 and was extended. The patches are `git diff -M` of those step commits.
- A clean worktree of `feb2cef`: each patch `git apply --check` exit 0, applied and committed in order:

  | After | `git status` lines | check (EN, EA) | EN `npm test` | EA `npm test` |
  | --- | --- | --- | --- | --- |
  | s1 | 5 | 0, 0 | 21/0 | 116/0 |
  | s2 | 14 | 0, 0 | 31/0 | 118/0 |
  | s3 | 5 | 0, 0 | 41/0 | 118/0 |
  | s4 | 6 | 0, 0 | 48/0 | 120/0 |
  | s5 | 7 | 0, 0 | 49/0 | 121/0 |
  | s6 | 10 | — | — | — |

  Then `npm run build` Succeeded in both plugins (TS5096 only), `node --check` of both new `.mjs` files exit 0, and the
  result is identical to the scratch tree (`git diff --stat` empty).
- **Not dry-run** (needs the deployed client): § 9. The hook composition is proven by unit test only until § 9 steps 3-6;
  the panel layout has never been rendered.

## 12. Not in this plan (follow-ups)

- A commented reference theme for EN (EA ships `themes/theme.jsonc` with every option explained); EN's bundled
  `steam_midnight.json` stays as it is.
- If EN ever needs to act after a toast (captures, logging), port EA's event bus and a sensor rather than adding work
  to the hook.
- `backend/_lib/**` is identical in both plugins but not drift-checked (it is Millennium's stub set, shared by all
  plugins here).
