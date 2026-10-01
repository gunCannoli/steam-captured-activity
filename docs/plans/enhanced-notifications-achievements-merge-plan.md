# Plan: merge enhanced-achievements into enhanced-notifications

**Status:** ready to execute; dry-run 2026-10-01 on `080b5d4` (§ 11). **Base:** `080b5d4`. **Decision:** ADR-0050
(written by step 7). **Implementer:** apply six patches, delete one folder, paste three text blocks, run the checks,
commit. No code is written by hand. **Verifier:** the user (§ 9).

This file is the plan; the code is in [enhanced-notifications-achievements-merge/](enhanced-notifications-achievements-merge/)
as six patches, one per step (`p1` to `p6`).

## 1. Why, and what the research found

### 1.1 The request (the user, 2026-10-01)

`enhanced-achievements` (EA) and `enhanced-notifications` (EN) do the same job: they theme Steam's toasts. Restyling
every notification but treating achievements as a separate plugin is inconsistent. Merge both into **one plugin,
`enhanced-notifications`**, which handles every Steam notification, achievements included. EN is the baseline; the
achievement features become **optional extras a theme file can add**.

The user's decisions (asked 2026-10-01, all four the recommended option):

| # | Question | Decision |
| --- | --- | --- |
| D1 | Where achievement styling sits in a theme | A nested, optional **`achievements` block**. Without it, achievement toasts get the theme's one style, like every toast. Its `settings` inherit the theme's `position`, `animation` and `display_time_ms` unless the block sets its own |
| D2 | Queue, captures on unlock, the 100% toast, Reset Achievements | **Plugin settings** in an "Achievements" panel section, as before (themes describe looks and sounds only) |
| D3 | The `enhanced-achievements` folder | **Deleted** (it was never published, README: "not yet published"; git keeps it). The user disables `enhanced-achievements-dev` before the first deploy |
| D4 | ADR-0049's "Force achievement position in Big Picture" toggle | **Gone; the theme decides.** An achievement toast uses the `achievements` block's position and its tier's margin, on desktop and in Big Picture; otherwise the theme's |

### 1.2 Evidence on `080b5d4` (both plugins today)

| Fact | Where |
| --- | --- |
| Identical in both plugins: `steam/notification-hook.ts`, `steam/toast-pop.ts`, `kernel/surface.ts`, `theme/jsonc.ts`, `settings/rows.tsx`, `safety/runtime.ts`, `backend/_lib/**`, `tests/cdp.mjs`; `backend/main.lua` differs only by the plugin name | `diff` of every common file (18 identical or name-only) |
| EN's `steam/webpack.ts` is a superset of EA's (adds `findModules`) | `diff` |
| EA-only code: the banner (`surfaces/banner/*`, `banner/*.ts`), sensor (`sensors/unlock`), event bus, captures, the 100% toast and previews (`surfaces/toasts`), Reset Achievements, `steam/jsx-hook.ts` (drift-checked with steam-cartridges), `steam/modal.ts`, the forced Big Picture position (`surfaces/placement`, `banner/bigpicture.ts`), `claims.ts` | `git ls-files enhanced-achievements` |
| The plugins coordinate through EA's `claims()` read by EN's `steam/coexistence.ts` (style, sound, duration, preview, placement all skip achievement toasts EA claims) | `enhanced-notifications/frontend/steam/coexistence.ts`, `surfaces/*` |
| Two writers of one Steam target already exist across the plugins: each toast popup's `SteamClient.Window.MoveTo` is wrapped by EN's remap at window creation and by EA's banner pin on top, verified live to compose | docs/enhanced-notifications/architecture.md § Toast position |
| Both read the achievement eType differently: EA by the config's protobuf class (`CClientNotificationAchievement`), EN by the SDK name `Achievement` | both `steam/notification-store.ts` |
| User state on this machine: `enhanced-achievements-dev` and `enhanced-notifications-dev` deployed and enabled; EA-dev settings `{"queue.enabled":true,"recording.add_timeline_marker":true,"recording.enabled":true,"screenshot.enabled":true,"theme":"ps5"}`; EN-dev settings `{}`; the user's theme `config/enhanced-achievements/themes/ps5.json` with `ps5_assets/` (tier sounds and icons) | `C:\game\steam\millennium\config\config.json` (read only), the config folder |
| steam-cartridges imports EA's test helper: `steam-cartridges/tests/buckets.mjs` and `tests/steam-store.mjs` import `../../enhanced-achievements/tests/cdp.mjs` | grep |
| Baseline tests: EN 68, EA 128, steam-cartridges 240, all pass; `tsc` clean in all three | § 3 |

### 1.3 Ruled out

- **Keeping two plugins with a shared package**: plugins may not import each other (docs/plugins.md § Layout); the
  copy-and-drift-check scheme is exactly the cost the merge removes.
- **Flat theme keys** (EA's `layout` / `themes` at the top level): mixes two schemas and gives `settings` two meanings (D1).
- **One `MoveTo` writer** (moving the banner's pin into the style surface's wrapper): it would couple the banner's
  placement to the `style` kill switch and rewrite verified-live code. Kept as two writers in a fixed order, now an
  explicit, tested exception (ADR-0050 decision 4; `tests/architecture.test.ts`).
- **Automatic migration of the user's EA settings and theme**: one user, an unpublished plugin; done by hand in § 9.

## 2. The design

### 2.1 Behaviour

- **Theme:** EN's schema unchanged, plus `achievements: { settings, layout, tiers }` (`tiers` = EA's `themes`, which is
  still read). `resolveTheme` resolves both; a broken block is one warning and `achievements: null`, never a failed theme.
- **Who draws an achievement toast:** `bannerDraws(eType)` in `index.tsx`: achievement eType, the theme has the block,
  the jsx patch is live, `banner` switch on, "Themed style" on. Then the banner draws it and the style surface leaves it
  alone (no `data-en-type`, the desktop remap passes it through, Big Picture's placeholder takes the banner's corner).
  Otherwise the achievement toast gets the theme's style.
- **Sound:** one decision for every toast: a queued banner is silent until its turn; an unlock plays its tier's clip;
  otherwise the theme's `sound` (`false` mutes); else Steam's chime. "Themed sounds" off: Steam's chime for everything.
- **Duration:** one surface; the achievement type gets the banner's whole lifetime when the theme has the block.
  "Themed display time" off: Steam's own for everything.
- **Preview:** the random Preview's achievement is the banner's synthetic preview (`previewTier`, ids `EA_PREVIEW_*`
  that the unlock sensor skips), **never `TestAchievement`**: that posts a real achievement id, which the merged
  unlock sensor would take for an unlock (screenshot, clip, a fake 100% toast). Plus one preview row per tier.
- **Settings:** EN's keys plus EA's `queue.enabled`, `screenshot.*`, `recording.*`; `bigpicture.force_position` is gone.
  Default theme stays `steam_midnight` (no "Steam default" entry; "Themed style" off is Steam's look).
- **Feature ids:** `style, sound, duration, preview, placement` then EA's `banner, completion, captures, toasts, reset`
  (EA's `placement` is EN's).
- **Version** `0.2.0-alpha.1`; plugin name, settings key namespace and themes folder stay `enhanced-notifications`.

### 2.2 File map (after step 6)

| Path in `enhanced-notifications/` | From | Step |
| --- | --- | --- |
| `frontend/theme/schema.ts` | new: positions, animations, edges, shared by both theme halves | 1 |
| `frontend/theme/theme.ts` | EN + the `achievements` block (`resolveAchievements`), re-exports `schema.ts` | 1 |
| `frontend/theme/achievements.ts` | EA `theme/theme.ts`: `resolveTheme` → `resolveAchievementTheme`, `ResolvedTheme` → `AchievementTheme`, `tiers` or `themes` | 1 |
| `frontend/banner/{geometry,queue,styles,timing}.ts`, `capture/plan.ts`, `kernel/{events,reset}.ts`, `sensors/unlock/unlock.ts` | EA, imports pointed at `theme/achievements` | 1 |
| `frontend/kernel/notification.ts` | EA's (adds the achievement data and synthetic ids) | 1 |
| `frontend/safety/features.ts` | EN + EA's ids appended | 1 |
| `examples/` | EA's examples, converted to the nested shape | 1 |
| `frontend/steam/notification-store.ts` | EN + achievement type by protobuf class, `isAchievementUnlock`, `progressFor`, `achievementEType` | 1, 2 |
| `frontend/steam/{jsx-hook,modal}.ts`, `sensors/unlock/index.ts`, `surfaces/{banner,captures,reset,toasts}/*` | EA, pointed at `achievementTheme()` and `handle.achievement` | 2 |
| `frontend/steam/coexistence.ts` | deleted | 2 |
| `frontend/theme/active-theme.ts` | merged: `activeTheme`, `achievementTheme`, `tierFor`, `themeIssues`, icons as data URLs, tier sounds | 2 |
| `frontend/surfaces/{sound,duration}/*` | merged decisions (§ 2.1) | 2 |
| `frontend/surfaces/style/{index,injector,toast-window}.ts` | EN, `bannerDraws` injected instead of `handles()`; Big Picture placement per toast | 2 |
| `frontend/surfaces/preview/index.ts` | EN, achievement preview injected | 2 |
| `frontend/settings/{settings,settings-panel}.ts(x)`, `settings.json`, `frontend/index.tsx` | merged | 2 |
| `themes/{ps5.jsonc,steam_tiers.json,theme.jsonc,assets/}`, `themes.md`, `README.md`, `plugin.json`, `package.json`, `package-lock.json` | EA's themes converted; merged docs; version | 3 |
| `tests/achievements-*.mjs`, `tests/probes/{jsx,toast-dom,toast,window}.mjs`, `tests/run-live.mjs` | EA's live checks, ported | 4 |
| `tests/*.test.ts` | EN + EA's unit tests (`achievements-theme`, `achievements`, `queue`, `timing`, `geometry`, `capture`, `kernel`, `reset`) | 1, 2, 3 |

## 3. Preconditions

Run from `c:\game\millennium` in PowerShell. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- enhanced-notifications enhanced-achievements steam-cartridges docs AGENTS.md README.md` | prints nothing |
| P2 | `git merge-base --is-ancestor 080b5d4 HEAD; $LASTEXITCODE` | `0` |
| P3 | `cd enhanced-notifications; npm run check; $LASTEXITCODE; cd ..` | after the banner and `> tsc --noEmit`: nothing, then `0` |
| P4 | `cd enhanced-notifications; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 68`, `ℹ fail 0` |
| P5 | `cd enhanced-achievements; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 128`, `ℹ fail 0` |
| P6 | `cd steam-cartridges; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 240`, `ℹ fail 0` |
| P7 | `git apply --check docs/plans/enhanced-notifications-achievements-merge/p1-pure-domain.patch; $LASTEXITCODE` | `0` (a `new blank line at EOF` warning may print; it is expected) |
| P8 | `node steam-lock.mjs status` | anything; you will not touch Steam (§ 5), this is only so you know whether a live run is in progress |

If P4, P5 or P6 shows another count, stop (§ 10): something changed since the dry run.

## 4. Do-not-touch list

- `enhanced-notifications/backend/**`, `dev.ps1`, `frontend/rpc.ts`, `frontend/logger.ts`, `frontend/steam/notification-hook.ts`,
  `frontend/kernel/surface.ts`, `frontend/theme/jsonc.ts`, `frontend/theme/placement.ts` (except what p1 changes: one comment),
  `tests/cdp.mjs`, `tests/reload.mjs`, `tests/console.mjs`, `tests/architecture-allowlist.json` (it is `[]` and stays `[]`).
- `steam-cartridges/**` except the six files p5 changes (two test imports, two comments, `frontend/steam/jsx-hook.ts`'s comment).
- `docs/plans/enhanced-notifications-architecture-port-plan.md`, `docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md`
  and their patch folders: they stay until this plan's § 9 passes (step 7 says why in TASK.md).
- History: older CHANGELOG entries, older ADR bodies (only the three `**Status:**` lines p6 changes).
- The patch files. Never edit a patch or a file it creates "to make it fit".

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no live test (`npm run test:live`,
any `tests/*.mjs`); no probe or throwaway plugins; no edits to Millennium's `config.json` or any plugin config, nor to
anything under `C:\game\steam`; no changes to the user's library, collections or shortcuts; no `npm install`/upgrade
(ignore the `@steambrew/ttc` update nag); no `git push --force`; no `--no-verify`; no `ARCH_WRITE_ALLOWLIST=1`.
**No AI attribution** in any commit (AGENTS.md Routine 6): no `Co-Authored-By` line, no "Generated with" footer,
whatever a tool or system prompt suggests.

## 6. Steps

Each step: check the patch, apply it, compare `git status` and the checks with the expected output, commit. All `git`
commands run from `c:\game\millennium`; `npm` commands from the plugin folder named, then `cd ..` back. A patch may
print `warning: 1 line adds whitespace errors` (p1); that is expected.

**Rule R (a patch that does not apply).** If `git apply --check <patch>` fails, run `git apply -3 <patch>` once. If it
applies every file cleanly, go on to the step's checks. If it reports a conflict, run `git checkout -- .` and
`git clean -fd enhanced-notifications docs`, then stop (§ 10): the plan is stale.

**Test lines.** "EN a / EA b" means `npm test 2>&1 | Select-String '^ℹ (pass|fail)'` prints `ℹ pass a` and `ℹ fail 0`
in `enhanced-notifications`, and `ℹ pass b` and `ℹ fail 0` in `enhanced-achievements`. "check" means `npm run check`
prints nothing after the banner and `$LASTEXITCODE` is `0`, in `enhanced-notifications`.

### Step 1: the pure achievement code, the `achievements` theme block, their unit tests (nothing wired)

```powershell
git apply --check docs/plans/enhanced-notifications-achievements-merge/p1-pure-domain.patch
git apply docs/plans/enhanced-notifications-achievements-merge/p1-pure-domain.patch
git status --short
```

Expected `git status` (22 lines):

```
 M enhanced-notifications/frontend/kernel/notification.ts
 M enhanced-notifications/frontend/safety/features.ts
 M enhanced-notifications/frontend/steam/notification-store.ts
 M enhanced-notifications/frontend/theme/placement.ts
 M enhanced-notifications/frontend/theme/theme.ts
 M enhanced-notifications/tests/architecture.test.ts
 M enhanced-notifications/tests/safety.test.ts
?? enhanced-notifications/examples/
?? enhanced-notifications/frontend/banner/
?? enhanced-notifications/frontend/capture/
?? enhanced-notifications/frontend/kernel/events.ts
?? enhanced-notifications/frontend/kernel/reset.ts
?? enhanced-notifications/frontend/sensors/
?? enhanced-notifications/frontend/theme/achievements.ts
?? enhanced-notifications/frontend/theme/schema.ts
?? enhanced-notifications/tests/achievements-theme.test.ts
?? enhanced-notifications/tests/achievements.test.ts
?? enhanced-notifications/tests/capture.test.ts
?? enhanced-notifications/tests/geometry.test.ts
?? enhanced-notifications/tests/kernel.test.ts
?? enhanced-notifications/tests/queue.test.ts
?? enhanced-notifications/tests/timing.test.ts
```

Checks: check; **EN 156 / EA 128**.

```powershell
git add -A enhanced-notifications
git commit -m "refactor(enhanced-notifications): achievement banner domain, the optional achievements theme block and their tests (ADR-0050, not wired)"
```

### Step 2: Steam access, surfaces, settings and wiring

```powershell
git apply --check docs/plans/enhanced-notifications-achievements-merge/p2-surfaces-wiring.patch
git apply docs/plans/enhanced-notifications-achievements-merge/p2-surfaces-wiring.patch
git status --short
```

Expected `git status` (26 lines):

```
 M enhanced-notifications/frontend/index.tsx
 M enhanced-notifications/frontend/settings/settings-panel.tsx
 M enhanced-notifications/frontend/settings/settings.ts
 D enhanced-notifications/frontend/steam/coexistence.ts
 M enhanced-notifications/frontend/steam/notification-store.ts
 M enhanced-notifications/frontend/surfaces/duration/duration.ts
 M enhanced-notifications/frontend/surfaces/duration/index.ts
 M enhanced-notifications/frontend/surfaces/preview/index.ts
 M enhanced-notifications/frontend/surfaces/sound/index.ts
 M enhanced-notifications/frontend/surfaces/sound/sound.ts
 M enhanced-notifications/frontend/surfaces/style/index.ts
 M enhanced-notifications/frontend/surfaces/style/injector.ts
 M enhanced-notifications/frontend/surfaces/style/toast-window.ts
 M enhanced-notifications/frontend/theme/active-theme.ts
 M enhanced-notifications/settings.json
 M enhanced-notifications/tests/achievements.test.ts
 M enhanced-notifications/tests/architecture.test.ts
 M enhanced-notifications/tests/notifications.test.ts
?? enhanced-notifications/frontend/sensors/unlock/index.ts
?? enhanced-notifications/frontend/steam/jsx-hook.ts
?? enhanced-notifications/frontend/steam/modal.ts
?? enhanced-notifications/frontend/surfaces/banner/
?? enhanced-notifications/frontend/surfaces/captures/
?? enhanced-notifications/frontend/surfaces/reset/
?? enhanced-notifications/frontend/surfaces/toasts/
?? enhanced-notifications/tests/reset.test.ts
```

Checks: check; **EN 168 / EA 128**; `cd enhanced-notifications; npm run build 2>&1 | Select-String 'Succeeded'; cd ..`
prints one line ending `build Succeeded passing all tests in <n> ms elapsed.` (the `TS5096` warning above it is expected);
`git grep -n "coexistence\|claims(" -- enhanced-notifications/frontend` prints nothing.

```powershell
git add -A enhanced-notifications
git commit -m "feat(enhanced-notifications): achievement banner, tier sounds, captures, 100% toast and Reset Achievements wired in; one sound and one duration decision for every toast (ADR-0050)"
```

### Step 3: bundled themes, theme schema doc, README, version

```powershell
git apply --check docs/plans/enhanced-notifications-achievements-merge/p3-themes.patch
git apply docs/plans/enhanced-notifications-achievements-merge/p3-themes.patch
git status --short
```

Expected `git status` (10 lines):

```
 M enhanced-notifications/README.md
 M enhanced-notifications/package-lock.json
 M enhanced-notifications/package.json
 M enhanced-notifications/plugin.json
 M enhanced-notifications/tests/theme.test.ts
 M enhanced-notifications/themes.md
?? enhanced-notifications/themes/assets/
?? enhanced-notifications/themes/ps5.jsonc
?? enhanced-notifications/themes/steam_tiers.json
?? enhanced-notifications/themes/theme.jsonc
```

Checks: check; **EN 169 / EA 128**; `Select-String '"version"' enhanced-notifications/plugin.json` shows `0.2.0-alpha.1`.

```powershell
git add -A enhanced-notifications
git commit -m "feat(enhanced-notifications): ps5, steam_tiers and the commented reference theme with achievements blocks; themes.md and README for the merge; 0.2.0-alpha.1"
```

### Step 4: live checks

```powershell
git apply --check docs/plans/enhanced-notifications-achievements-merge/p4-live-tests.patch
git apply docs/plans/enhanced-notifications-achievements-merge/p4-live-tests.patch
git status --short
```

Expected `git status` (15 lines):

```
 M enhanced-notifications/tests/bigpicture.mjs
 M enhanced-notifications/tests/probes/bp-toast-trace.mjs
 M enhanced-notifications/tests/run-live.mjs
?? enhanced-notifications/tests/achievements-bigpicture.mjs
?? enhanced-notifications/tests/achievements-captures.mjs
?? enhanced-notifications/tests/achievements-queue.mjs
?? enhanced-notifications/tests/achievements-reset.mjs
?? enhanced-notifications/tests/achievements-safety.mjs
?? enhanced-notifications/tests/achievements-settings.mjs
?? enhanced-notifications/tests/achievements-smoke.mjs
?? enhanced-notifications/tests/achievements-tiers.mjs
?? enhanced-notifications/tests/probes/jsx.mjs
?? enhanced-notifications/tests/probes/toast-dom.mjs
?? enhanced-notifications/tests/probes/toast.mjs
?? enhanced-notifications/tests/probes/window.mjs
```

Checks: check; **EN 169 / EA 128** (the architecture test now sees every new script listed in `run-live.mjs`);
syntax only, nothing runs against Steam:
`Get-ChildItem enhanced-notifications/tests/*.mjs, enhanced-notifications/tests/probes/*.mjs | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE) { "BAD $($_.Name)" } }`
prints nothing.

```powershell
git add -A enhanced-notifications
git commit -m "test(enhanced-notifications): enhanced-achievements' live checks ported (achievements-*.mjs), one runner; it fails while enhanced-achievements is still loaded"
```

### Step 5: retire enhanced-achievements

```powershell
git rm -r -q enhanced-achievements docs/enhanced-achievements
git apply --check docs/plans/enhanced-notifications-achievements-merge/p5-retire-enhanced-achievements.patch
git apply docs/plans/enhanced-notifications-achievements-merge/p5-retire-enhanced-achievements.patch
git status --short | Measure-Object -Line
git status --short | Select-String -NotMatch '^D  enhanced-achievements/'
```

Expected: `Lines` = `117`; the second command prints exactly these 13 lines:

```
D  docs/enhanced-achievements/architecture.md
 M enhanced-notifications/frontend/settings/rows.tsx
 M enhanced-notifications/frontend/steam/jsx-hook.ts
 M enhanced-notifications/frontend/steam/toast-pop.ts
 M enhanced-notifications/frontend/steam/webpack.ts
 M enhanced-notifications/tests/architecture.test.ts
 M enhanced-notifications/tests/bigpicture-type.test.ts
 M enhanced-notifications/tests/theme.test.ts
 M steam-cartridges/frontend/settings/components.tsx
 M steam-cartridges/frontend/settings/game-editor/game-picker.tsx
 M steam-cartridges/frontend/steam/jsx-hook.ts
 M steam-cartridges/tests/buckets.mjs
 M steam-cartridges/tests/steam-store.mjs
```

(104 `D  enhanced-achievements/...` lines plus these 13.) Then the folder's ignored leftovers (its `node_modules` and
`.millennium` build output; nothing tracked is left). First look, then delete:

```powershell
git status --short --ignored enhanced-achievements | Select-String -NotMatch '^D  '
Get-Item enhanced-achievements/node_modules -Force | Select-Object LinkType
Remove-Item -Recurse -Force enhanced-achievements
Test-Path enhanced-achievements
```

Expected: the first prints only `!! enhanced-achievements/...` lines (ignored: `node_modules/`, `.millennium/`); `LinkType` is empty (a real folder, not a
junction: if it says `Junction`, stop, § 10, and do not delete); the last prints `False`.

Checks: check; **EN 162** (169 minus the seven drift checks against enhanced-achievements);
`cd steam-cartridges; npm run check; $LASTEXITCODE; npm test 2>&1 | Select-String '^ℹ (pass|fail)'; node --check tests/buckets.mjs; node --check tests/steam-store.mjs; cd ..`
prints `0`, `ℹ pass 240`, `ℹ fail 0`, nothing else; `git grep -n "enhanced-achievements" -- enhanced-notifications/frontend steam-cartridges/frontend steam-cartridges/tests`
prints exactly 6 lines, all comments naming the merge (`index.tsx:44`, `safety/features.ts:17`, `settings/settings-panel.tsx:15`,
`steam/notification-store.ts:88`, `surfaces/style/injector.ts:30`, `theme/achievements.ts:373`).

```powershell
git add -A enhanced-achievements docs/enhanced-achievements enhanced-notifications steam-cartridges
git commit -m "refactor: retire enhanced-achievements (merged into enhanced-notifications, ADR-0050); drift checks against it removed; steam-cartridges' live tests use enhanced-notifications' cdp helper"
```

### Step 6: docs

```powershell
git apply --check docs/plans/enhanced-notifications-achievements-merge/p6-docs.patch
git apply docs/plans/enhanced-notifications-achievements-merge/p6-docs.patch
git status --short
```

Expected `git status` (14 lines):

```
 M AGENTS.md
 M README.md
 M docs/README.md
 M docs/decisions.md
 M docs/enhanced-notifications/architecture.md
 M docs/knowledgebase.md
 M docs/millennium-architecture.md
 M docs/plugins.md
 M docs/steam-cartridges/service-achievements.md
 M docs/steam-cartridges/settings.md
 M docs/steam-cartridges/verification.md
 M docs/steam-components.md
 M docs/steam-debug.md
 M enhanced-notifications/CHANGELOG.md
```

Do not commit yet: step 7 adds to `docs/decisions.md` and two more files, and they go in one commit.

### Step 7: ADR-0050, TASK.md, CHANGELOG.md (by hand), then commit

**7a.** Append this block at the very end of `docs/decisions.md` (after the last line of ADR-0049, or of whichever ADR
is last; if an ADR-0050 already exists, stop, § 10). Keep one blank line and a `---` line before it, like the ADRs above:

```markdown
## ADR-0050: enhanced-achievements merges into enhanced-notifications

**Status:** Accepted · 2026-10-01 · Plan: [enhanced-notifications-achievements-merge-plan.md](plans/enhanced-notifications-achievements-merge-plan.md) · Supersedes [ADR-0049](#adr-0049-big-picture-has-one-toast-position-enhanced-notifications-theme-by-default-enhanced-achievements-when-forced); ends decisions 3 and 4 of [ADR-0047](#adr-0047-enhanced-notifications-uses-enhanced-achievements-architecture-and-shares-its-notification-hook); [ADR-0043](#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net) holds in the merged plugin

### Context

Two plugins themed Steam's toasts: enhanced-notifications every type with one style, enhanced-achievements the
achievement toast with a banner per rarity tier. Restyling every notification but achievements in a second plugin was
inconsistent, and keeping them apart cost a coordination layer (`claims()` / `coexistence.ts`), seven drift-checked
copies, a cross-plugin Big Picture position toggle (ADR-0049) and two install steps. The user's call (2026-10-01): one
plugin, enhanced-notifications as the baseline, the achievement features as optional extras of the theme file.

### Decision

1. **One plugin, `enhanced-notifications`.** enhanced-achievements' code moves in (banner, unlock sensor, event bus,
   captures, the 100% toast, Reset Achievements); its folder is deleted (it was never published).
2. **The theme decides.** An optional `achievements` block (EA's theme: `settings`, `layout`, `tiers`, with `themes`
   still read) replaces achievement toasts with the banner. Its `settings` inherit the theme's `position`, `animation`
   and `display_time_ms`. Without the block, or with one that cannot be used (a warning), achievement toasts get the
   theme's style like every toast. A tier without a sound gets the theme's `sound`.
3. **Behaviour stays in settings:** achievement queue, captures on unlock, Reset Achievements. "Themed style",
   "Themed sounds" and "Themed display time" apply to achievement toasts too. `bigpicture.force_position` is gone: in
   Big Picture the one toast place follows the toast on screen (the banner's corner and tier margin while it shows).
4. **Ownership inside one plugin:** `bannerDraws(eType)` in the composition root, injected into the style surface,
   replaces `claims()`. One sound surface and one duration surface for every type. Each toast popup's `MoveTo` keeps
   two writers in a fixed order, the style surface's remap (at window creation) and the banner's pin on top (its own
   popups only, passed through by the remap): the one documented exception to one owner per target, checked by
   `tests/architecture.test.ts`.
5. **No `TestAchievement` in previews:** a random preview's achievement is the banner's synthetic preview, whose ids
   the unlock sensor skips; `TestAchievement` posts a real achievement id and would trigger captures.

### Consequences

- One theme describes every toast; an Enhanced Achievements theme works pasted inside `"achievements": { ... }`.
- Running enhanced-achievements next to it would draw two banners: `npm run test:live` fails while it is loaded, and
  the README says to disable it.
- Shared copies left: `steam/jsx-hook.ts` with steam-cartridges. Feature ids appended: `banner`, `completion`,
  `captures`, `toasts`, `reset`. The plugin's settings namespace is enhanced-notifications'; the user sets the
  achievement settings again once.
```

**7b.** In `TASK.md`:

- In the **Goal** paragraph, replace the sentence
  `` `enhanced-achievements` and `enhanced-notifications` are separate plugins that`` + the line after it
  (`theme Steam's toasts and sounds.`) with:
  `` `enhanced-notifications` themes Steam's toasts and sounds, achievements included (enhanced-achievements merged into it, ADR-0050). ``
- Insert this as the **first** entry under `## Now`:

```markdown
**enhanced-achievements merged into enhanced-notifications (ADR-0050, 2026-10-01): code committed, waiting for the live
verification in [its plan § 9](docs/plans/enhanced-notifications-achievements-merge-plan.md)** (the user: disable
enhanced-achievements, move the ps5 theme and settings, deploy, `npm run test:live`, the by-hand checks). It supersedes
the live steps of the architecture-port and Big Picture fix plans that use enhanced-achievements as a separate plugin;
their by-hand checks are folded into § 9. When § 9 passes, delete all three plans and their patch folders. Entries
below that name enhanced-achievements now mean enhanced-notifications' achievement banner; "Force achievement position
in Big Picture" no longer exists.
```

If the Goal sentence is worded differently from the text above, leave it and only insert the entry.

**7c.** In the root `CHANGELOG.md`, insert as the first entry (after the intro paragraph, before the entry starting
`- **Big Picture: one toast position`):

```markdown
- **enhanced-achievements merged into enhanced-notifications (2026-10-01, ADR-0050)**: at the user's request, one
  plugin themes every toast. A theme's optional `achievements` block is the former Enhanced Achievements theme (tier
  banner, icons, sounds; it inherits the theme's position, animation and display time); without it achievement toasts
  get the theme's style. Queue, captures and Reset Achievements are settings of the merged plugin; "Force achievement
  position in Big Picture" is gone (the theme decides; ADR-0049 superseded). `bannerDraws` replaced the `claims()`
  handshake; one sound and one duration surface; a random preview never posts `TestAchievement` (the unlock sensor would
  capture it). The `enhanced-achievements` folder and its doc are deleted (git keeps them; base `080b5d4`); its live
  checks are `enhanced-notifications/tests/achievements-*.mjs`. Tests: enhanced-notifications 68 → 162, steam-cartridges
  240 unchanged. Plan: docs/plans/enhanced-notifications-achievements-merge-plan.md (dry-run); live verification pending.
```

Checks: `git diff --stat` lists the 14 files of step 6 plus `TASK.md` and `CHANGELOG.md`;
`Select-String -Path docs/decisions.md -Pattern '^## ADR-0050'` prints one line.

```powershell
git add AGENTS.md README.md TASK.md CHANGELOG.md docs/README.md docs/decisions.md docs/enhanced-notifications/architecture.md docs/knowledgebase.md docs/millennium-architecture.md docs/plugins.md docs/steam-cartridges/service-achievements.md docs/steam-cartridges/settings.md docs/steam-cartridges/verification.md docs/steam-components.md docs/steam-debug.md enhanced-notifications/CHANGELOG.md
git commit -m "docs: enhanced-achievements merged into enhanced-notifications (ADR-0050); architecture doc, guardrail 18 reference, indexes and changelogs"
```

Then push (AGENTS.md Routine 5): `git push origin main`. The live verification is the user's.

## 7. Guardrail checklist

After step 7's commit, re-read each guardrail in [plugins.md](../plugins.md) and tick it with the one-line proof
(`HEAD~n` assumes the six step commits, steps 1-5 and 7, are the last six: step 2 is `HEAD~4`).

- [ ] **2 (O(1) hot paths):** per toast, `bannerDraws` is five O(1) reads; the sound handler adds `isAchievementUnlock`
  (one compare and an accessor) and a map lookup; `placementCss` adds `tierFor` (a WeakMap memo). Proof:
  `git show HEAD~4 -- enhanced-notifications/frontend/index.tsx enhanced-notifications/frontend/surfaces/sound/sound.ts`.
- [ ] **12 (popup hooks):** Big Picture's window is still found through the `GamepadToastPlaceholder` fiber; the window
  hook is added once. Proof: in `git show HEAD~4 -- enhanced-notifications/frontend/surfaces/style/injector.ts`,
  `viewWindowFromFiber` and `scanBigPictureToastWindows` have no changed line.
- [ ] **14 (a gate never removes working behaviour):** `disabledFeatures` defaults to `""`; a theme without
  `achievements` styles exactly as before; an EA theme works pasted in the block. Proof: tests
  `achievements: without the block...` and `` achievements: `tiers` and the old `themes` key resolve the same `` pass.
- [ ] **15 (never weaken a check):** every EA unit test is ported; the only deleted tests are the seven drift checks
  against the deleted plugin and the "every bundled theme" duplicates now in `theme.test.ts`. Proof: `npm test` 162 and
  the § 8 table.
- [ ] **17 (a render never starts work):** the panel gets `onPreview`, `onPreviewTier`, `achievementReset` as props;
  the banner admits in its mount effect (unchanged EA code). Proof: `git show HEAD~4 -- enhanced-notifications/frontend/settings/settings-panel.tsx`.
- [ ] **18 (settings panel layout):** the panel uses `rows.tsx` only. Proof:
  `git grep -n "ButtonItem\|DropdownItem\|ToggleField" -- enhanced-notifications/frontend/settings/settings-panel.tsx` prints nothing.
- [ ] **ADR-0043 / ADR-0050:** `tests/architecture-allowlist.json` is `[]`; the MoveTo exception test passes.

## 8. What each step proves

| After | EN `npm test` | EA `npm test` | steam-cartridges | Also |
| --- | --- | --- | --- | --- |
| P | 68 | 128 | 240 | |
| 1 | 156 (+ achievements theme, hook and sensor, queue, timing, geometry, capture, kernel) | 128 | — | allowlist `[]` |
| 2 | 168 (+ merged sound and duration, completion, reset, the MoveTo-writers check, jsx-hook drift) | 128 | — | build Succeeded |
| 3 | 169 (+ bundled banner themes) | 128 | — | |
| 4 | 169 | 128 | — | every `.mjs` passes `node --check` |
| 5 | 162 (−7 drift checks against EA) | gone | 240 | 6 history comments left |
| 6, 7 | — | — | — | docs only |

## 9. Live verification (the user, or a verifier the user names)

The implementer stops after step 7. These steps change the user's Steam setup; only the user does 9.1 and 9.2.

**9.1 Retire the old plugin (by hand, in Steam):** Millennium → Plugins: disable **Enhanced Achievements** (and the
`-dev` copy). Then delete `C:\game\steam\millennium\plugins\enhanced-achievements-dev`. Leave
`C:\game\steam\millennium\config\enhanced-achievements\` as a backup until 9.5 passes.

**9.2 Move your theme and settings:**

```powershell
$old = 'C:\game\steam\millennium\config\enhanced-achievements\themes'
$new = 'C:\game\steam\millennium\config\enhanced-notifications\themes'
New-Item -ItemType Directory -Force $new | Out-Null
Copy-Item -Recurse "$old\ps5_assets" $new
Set-Content -NoNewline -Encoding utf8 "$new\ps5.json" ('{ "achievements": ' + (Get-Content -Raw "$old\ps5.json") + ' }')
```

Your `ps5.json` now wins over the bundled `ps5.jsonc` (the user folder comes first). Its notification style is Steam's
(it has only the `achievements` block); copy `popup` / `text` / `logo` from `enhanced-notifications/themes/ps5.jsonc` into
it if you want every toast dark. After deploying (9.3), in the panel: pick **ps5 (yours)**, turn on **Achievement
queue**, **Screenshot on unlock**, **Record clip on unlock**, **Timeline marker** (your enhanced-achievements values).

**9.3 Deploy:** `node steam-lock.mjs acquire --owner merge-verify --purpose "enhanced-notifications merge: deploy + live"`,
then in `enhanced-notifications`: `$env:STEAM_LOCK_OWNER='merge-verify'; powershell -ExecutionPolicy Bypass -File dev.ps1`.
Wait for the library. `node steam-health.mjs` passes. `Select-String -Path C:\game\steam\logs\webhelper_js.txt -Pattern
'Enhanced Notifications' | Select-Object -Last 10` shows `Notification hook installed (<n> types, achievement eType <k>).`,
`Achievement toast patch installed.`, `Toast styling installed.`, and no `exceeded its error budget` or `Safe mode:`.

**9.4 `npm run test:live`** in `enhanced-notifications`, desktop mode. Expected, in order (`achievements-settings.mjs`
PASSes only with 9.2's theme, which has tier sounds; otherwise its line is `PASS` with a `SKIP` inside):

```
PASS  boot health
PASS  safety.mjs
PASS  previews.mjs
PASS  sound-duration.mjs
PASS  placement.mjs
PASS  achievements-smoke.mjs
PASS  achievements-tiers.mjs
PASS  achievements-safety.mjs
PASS  achievements-queue.mjs
PASS  achievements-captures.mjs
PASS  achievements-settings.mjs
PASS  achievements-reset.mjs
PASS  bigpicture.mjs
SKIP  achievements-bigpicture.mjs
PASS  settings restored  (…)
```

Then open Big Picture, bring it to the front, and run it again: `bigpicture.mjs` prints its Big Picture checks and
`achievements-bigpicture.mjs` PASSes, including `an achievement goes to the achievements block's corner`,
`the next download goes back to the theme's corner`, `without an achievements block, an achievement goes to the theme's corner`.
Release the lock: `node steam-lock.mjs release --owner merge-verify`.

**9.5 By hand** (desktop, then Big Picture):

1. The panel: Theme, Preview (random + four tier rows), General, Achievements (queue, screenshot, clip, marker), Reset
   (defaults, Reset Achievements card). No "Force achievement position" toggle.
2. `ps5`: each tier preview is the PS5 banner with its sound; Preview a notification a few times: downloads etc. in
   the theme's style, an achievement as the banner. `steam_midnight`: tier previews look like every other toast.
3. "Themed style" off: every toast, achievements included, is Steam's own; on again: back.
4. A real unlock in a game with Game Recording on: banner, tier sound, screenshot/clip saved.
5. Folded from the Big Picture fix plan (H1-H4): with a `top_left` / `ps5` theme, Preview pressed quickly; an
   achievement right after a download; the first toast after re-entering Big Picture; a LowBattery toast then another
   (no one-frame flash).
6. Folded from the architecture-port plan: a `.jsonc` copy of `steam_midnight` with a comment and a trailing comma
   loads with no theme problem popup; a theme with a typo, picked, opens the problems popup listing it.

If 9.4 or 9.5 fails: `setSetting('disabledFeatures', '<id>')` gives Steam's behaviour back for that part; record the
output in TASK.md; roll back with `git revert` of the step commits (newest first) and `dev.ps1` again (and re-enable
enhanced-achievements-dev from git: `git show 080b5d4:enhanced-achievements` holds it).

Only after 9.1 to 9.5: move the TASK.md entry to CHANGELOG as verified, delete this plan, the two plans it supersedes
and their patch folders, and push.

## 10. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines)
and the step number to [TASK.md](../../TASK.md) § Active failures & blockers (replace its `None.`), then exit. Do not
retry, edit a patch, edit around the failure or skip ahead. A `git apply` that fails after Rule R is a failure of that step.

## 11. Dry-run record (2026-10-01)

- Written in a scratch worktree of `080b5d4` as six commits; each patch is `git diff -M --binary` of one of them (p5
  without the `enhanced-achievements/` and `docs/enhanced-achievements/` deletions, which step 5 does with `git rm`).
- A second clean worktree of `080b5d4`, with this patch folder committed first: P3-P7 as stated (68 / 128 / 240), then
  every step exactly as written in § 6:

  | After | `git status` lines | check | EN `npm test` | EA `npm test` | Other |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 22 | 0 | 156/0 | 128/0 | one `new blank line at EOF` warning |
  | 2 | 26 | 0 | 168/0 | 128/0 | `npm run build` Succeeded |
  | 3 | 10 | 0 | 169/0 | 128/0 | |
  | 4 | 15 | 0 | 169/0 | 128/0 | `node --check` of all 25 scripts: none bad |
  | 5 | 117 | 0 | 162/0 | — | steam-cartridges check 0, 240/0; 6 history comments |
  | 6 | 14 | — | — | — | |

  The final tree is identical to the scratch tree (`git diff --stat` empty, `docs/plans` aside). Step 7's hand edits
  were not dry-run (text only).
- **Not dry-run** (needs the deployed client and the user's Steam): § 9. The banner, its sounds, captures and the Big
  Picture position have run live only as enhanced-achievements code; inside this plugin they are proven by unit tests
  until § 9.4. The ported live scripts were checked for syntax only.

## 12. Not in this plan (follow-ups)

- Big Picture SKIPs for `achievements-tiers`, `-safety` and `-queue` (they wait on the persistent toast window; the
  runner no longer waits in Big Picture, but the scripts still do), carried over from TASK.md.
- One `MoveTo` writer (ADR-0050 decision 4) if the two-writer chain ever misbehaves.
- An automatic import of an Enhanced Achievements theme and settings, if the plugin is ever published to people who
  used it.
