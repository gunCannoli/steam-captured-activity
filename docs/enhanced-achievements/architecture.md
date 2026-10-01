# enhanced-achievements architecture

**This doc's job:** how `enhanced-achievements` is built today: its layers, who
owns each Steam target, its safety net, and how to add a feature without
breaking another. Decision: [ADR-0043](../decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net).
Migration: done (E0a-E3, ADR-0043); the plan was deleted, history is in the CHANGELOG.
Every migration step updates this doc; the **Status** column says what is built.

## Layers

| Layer | Folder | Job | Status |
| --- | --- | --- | --- |
| Safety | `frontend/safety/` | Kill switches, error budget, boot sentinel / safe mode | current (E0a) |
| Kernel | `frontend/kernel/` | Notification types and synthetic ids, the event bus, the `Surface` contract | current (E1a) |
| Pure domain | `theme/theme.ts`, `theme/jsonc.ts`, `banner/{geometry,timing,queue,styles}.ts`, `capture/plan.ts` | Themes, tiers, timing, geometry, the toast scheduler, capture planning. No Steam, SDK, React or logger | current (enforced from E0b) |
| Steam access | `frontend/steam/` | Finding Steam's objects (webpack, `NotificationStore`, Steam's own `showModal` in `modal.ts`), the one `PlayNotificationSound` hook (`notification-hook.ts`, infrastructure), the shared jsx-runtime hook | current (E1c) |
| Sensor | `frontend/sensors/unlock/` | Sees an achievement toast shown and emits `achievement.unlocked` once, one macrotask later | current (E1b) |
| Surfaces | `frontend/surfaces/` | The only code that writes into Steam: `sound`, `duration`, `toasts` (E1b); `banner`, `captures` (E1c). `surfaceStatus()` shows which installed | current (E1c) |
| Composition root | `frontend/index.tsx`, `frontend/claims.ts` | Start-up order, wiring, the public exports and `claims()` | current |

## Safety net (E0a)

Every part that writes into Steam has a **feature id** (`safety/features.ts`):

| Id | What it switches | Off means |
| --- | --- | --- |
| `banner` | The themed banner (jsx replacement of Steam's toast dispatcher) | Steam's own toast; `claims('banner')` handed back |
| `sound` | The themed sound per tier and its queue timing | Steam's chime on arrival; `claims('sound')` handed back |
| `duration` | Writing the achievement toast duration | Nothing written (a value already written stays until restart); `claims('duration')` handed back |
| `completion` | The synthetic 100% toast after a game-completing unlock | No 100% toast |
| `captures` | Screenshot, clip and marker on unlock | No captures |
| `reset` | The settings panel's Reset Achievements (clears a game's achievements) | The section is disabled and `reset()` refuses |

- **User switch:** `disabledFeatures` setting, comma-separated ids, no panel control. From the SharedJSContext console:
  `PLUGIN_LIST['enhanced-achievements-dev'].setSetting('disabledFeatures', 'banner,sound')`. Read live; `duration` takes effect at the next theme change or restart.
- **Error budget:** 5 errors in one session switch a feature off until Steam restarts. Errors are counted by the fail-open
  catch blocks (the jsx handler, the banner's error boundary, the sound hook, the completion check, `onUnlock`, `applyDuration`).
- **Safe mode:** the boot sentinel (`enhanced-achievements.boot` in SharedJSContext `localStorage`) counts starts that did not
  end cleanly (no `pagehide`, or errors in the first 60 s). Two in a row: the next start hooks nothing (Steam's own toasts), and
  60 error-free seconds clear it.
- **Diagnostics:** `PLUGIN_LIST['enhanced-achievements-dev'].safetyDiagnostics()` → `{ safeMode, disabled, tripped, errors }`.
- `claims()` stays O(1): enhanced-notifications calls it on every toast.

## Banner lifetime (E2)

`banner/queue.ts` (pure) is the only owner of when a banner starts, waits, shows and ends.

- **Start:** `ThemedBanner` renders an invisible shell (`peek(key) ?? 'waiting'`) and admits the toast in its mount
  `useLayoutEffect`, before the window pin reads the phase. A render never starts work
  ([guardrail 17](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components)), so a render React
  discards leaves no scheduler entry.
- **Turn:** with the queue on, one toast shows at a time; the next starts 100 ms after the previous ends.
- **Sound:** `surfaces/sound` asks the scheduler: `peek` (never admitted, e.g. banner off: Steam's chime plays at once), then
  `whenShowing(key, onShow)`. A waiting toast is silent until its turn and forever if dismissed first.
- **End:** the scheduler's own timer, a click, or the banner unmounting (`finish`/`forget`); the popup is held open until then
  (`holdPopup`, desktop only).

## Steam targets and their one owner

| Steam target | Owner (file) | Guardrail |
| --- | --- | --- |
| `NotificationStore.prototype.PlayNotificationSound` (wrapper) | `steam/notification-hook.ts` | [2](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced), [17](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components) |
| `NotificationStore` instance `ChooseSound` (for one call) | `steam/notification-hook.ts` | 2 |
| The hook's sound slot | `surfaces/sound/index.ts` | 2 |
| `NotificationStore.OnNotification` (synthetic toasts) | `surfaces/toasts/post.ts` | — |
| Achievement type config `toastDurationMS` | `surfaces/duration/index.ts` | — |
| `react/jsx-runtime` `jsx`/`jsxs` (toast dispatcher) | `surfaces/banner/toast-patch.ts` via `steam/jsx-hook.ts` | 2, [Sharing the jsx runtime](../plugins.md#sharing-the-jsx-runtime-between-plugins) |
| Notification `fnNotificationResolved` (popup hold) | `surfaces/banner/themed-toast.tsx` | 17 |
| Toast popup `SteamClient.Window.MoveTo` (pin) | `surfaces/banner/window-pin.ts` | — |
| Game Recording RPCs | `surfaces/captures/recording.ts` | — |
| `SteamClient.Console.ExecCommand` (`achievement_clear`) and steam-cartridges' `resetAchievements` | `surfaces/reset/index.ts` | — |

## Tests

| Command | What it proves |
| --- | --- |
| `npm test` | Pure modules: themes, tiers, queue, geometry, capture plan, safety (`tests/safety.test.ts`) |
| `npm test` → `tests/architecture.test.ts` | No new cross-area import (ratchet on `tests/architecture-allowlist.json`, now empty and staying empty); pure files stay pure; one owner per Steam target (the table above, as `OWNERS`); no two surfaces declare the same target; every RPC is registered in `backend/main.lua`; `steam/jsx-hook.ts` matches steam-cartridges' copy, and `pristineDuration`, `steam/notification-hook.ts`, `kernel/surface.ts`, `theme/jsonc.ts`, `settings/rows.tsx` and `backend/main.lua` (plugin name swapped) match enhanced-notifications' copies (both plugins wrap `PlayNotificationSound` with the same hook, ADR-0047); every live script is in `tests/run-live.mjs` |
| `npm run test:live` | Every live check against the running client, settings snapshotted and restored: `smoke`, `tiers`, `safety`, `queue-stress`, `captures`, `settings-sound`, `bigpicture` (SKIP unless Big Picture is open) |
| `node tests/safety.mjs` (live) | A clean start is not in safe mode; `disabledFeatures` hands the banner back and restores it |

## How to add a feature

1. If it writes into Steam, give it a feature id (append to `FEATURE_IDS`; never rename one) and check `isEnabled(id)` before
   every write and `reportError(id, err)` in its catch.
2. Put its decisions in a pure module with a unit test.
3. Add a row to "Steam targets and their one owner". A target already owned by another row is not yours: extend that owner.

## Settings panel spacing

One system, in `frontend/settings/rows.tsx` (identical copy in enhanced-notifications, drift-checked; the sections are in `settings-panel.tsx`): a **block** is a group of options that read as one card, and its rows touch (gap 0).
Blocks in a section are `BLOCK_GAP` (22 px) apart, set only by `<Blocks>`: pass each block as one child (a fragment of rows). Steam's
`SliderField` and `TextField` end with 22 px of blank space of their own, which `ItemRow trailing` cancels, so a block's spacing never
depends on its last control. The gap is padding, not margin: margins collapse into that trailing space. A new option goes inside an
existing block or becomes a new child of `<Blocks>`; never add spacing on a row.

## History

- 2026-09-30 ADR-0047: enhanced-notifications uses this plugin's architecture and the same `steam/notification-hook.ts`; the settings rows and spacing moved to `settings/rows.tsx` (no visible change); the drift tests now cover the hook, `kernel/surface.ts`, `theme/jsonc.ts`, `settings/rows.tsx` and `backend/main.lua` too, and read enhanced-notifications' whole `frontend/` for `pristineDuration` instead of one file path.
- 2026-09-30 ADR-0045: Reset Achievements lists every game, Steam's or not, from Steam's `appAchievementProgressCache`
  (steam-cartridges fills it for its shortcuts after Steam's own load at start-up); a shortcut is offered only when
  steam-cartridges' `resetAchievements` is present. The call to `storedAchievementSummaries()` is gone.
- 2026-09-30 Settings panel: one spacing system (`Blocks`, `BLOCK_GAP`); Record clip, Clip length and Clip delay are one block.
- 2026-09-30 Reset Achievements: new surface `reset` (feature id `reset`, pure logic in `surfaces/reset/reset.ts`, shared types and `filterCandidates` in `kernel/reset.ts`); the settings panel gets it injected as `achievementReset` (D7). A Steam game is cleared with Steam's console command `achievement_clear <appid> <id>` per unlocked achievement (only ids of plain identifier characters are ever sent) and read back after 1.5 s; a non-Steam game through steam-cartridges' public `resetAchievements`, found in `PLUGIN_LIST` (a soft link: plugins never import each other, and without it non-Steam games are simply not offered). (Its first version listed non-Steam games from a steam-cartridges export and made `candidates()` async; both are gone, see the ADR-0045 entry above. `candidates()` is synchronous.) The panel is one card: a single `PanelSectionRow` holds the label, description and controls. New exports `achievementReset` and `SettingsPanelView` (live tests). `tests/reset.mjs` is non-destructive.
- 2026-09-30 E2: `admit` moved from the render to the mount effect; `queue.peek` and `queue.whenShowing`; the sound surface uses them instead of `phaseOf` + `subscribe`. Fixes EA-K2 and EA-K9.
- 2026-09-30 E1c: `banner` and `captures` are surfaces (`git mv` of toast-patch, themed-toast, window-pin, captures, recording; both install and uninstall through `Surface`); `surfaceStatus()` export; the allowlist is empty; test `no two surfaces declare the same Steam target`.
- 2026-09-30 E1b: `steam/notifications.ts` split into `steam/notification-store.ts` (discovery), `steam/notification-hook.ts` (the one wrapper), `sensors/unlock` and surfaces `sound`, `duration`, `toasts`; captures and the 100% toast run from `achievement.unlocked` one macrotask after the toast; a tripped feature has its surface uninstalled; allowlist 7 → 6.
- 2026-09-30 E1a: kernel contracts (`kernel/notification|events|surface.ts`); the tier is a pure function (`tierOfNotification`, memo `tierFor` in `theme/active-theme.ts`); `themedDisplayMs` is pure; feature id `toasts` and `onTrip`; final layer rules, allowlist 15 → 7.
- 2026-09-29 E0a: safety net (kill switches, error budget, safe mode); `claims()` made O(1).
- 2026-09-29 E0b: architecture test, `npm run test:live`; `queue-stress.mjs` restores the stored settings.
