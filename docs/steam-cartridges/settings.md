# settings

**One job:** the settings store (`settings/settings.ts`, `defaults.ts`) and the panels that edit it. Panels never import `app/`,
`surfaces/` or `features/`; they reach the app through one context and the backend through `ports/backend.ts`.

## Contract

- **Defaults are pinned.** `settings/defaults.ts` (type-only imports) holds `DEFAULTS`, `DEFAULT_SERVICES` and the types;
  `tests/fixtures/settings-defaults.json` is checked against it. No key is renamed, no default changed (do-not-touch 1).
- **`settings/context.ts`** (`PanelContext`, `setPanelContext`, `usePanelContext`): `routing` (with `serviceAllowed`, the
  one policy evaluation, M10), `ingest`, `records` (`achievementsOf` reads the record through `app/achievements`, M10),
  `controller` (with `refresh`, which re-derives a game's badges after its controller override changed), `steamStore`, `editor`. `index.tsx` calls `setPanelContext` at the top of `init()`; before that the
  context is inert. Panels may import `domain/` for types and validators, never to evaluate policy (ADR-0044).
- **Change notices** go through the settings store's own `onSettingChange` and `ingest.onProgress` (M10: the
  `steam-cartridges:rule-updated` window event is gone).
- **Third-party** (`panels/third-party.tsx`, ADR-0056): per store (Epic Games Store, Xbox) a block with the store's
  toggle (`services.epicEnabled` / `xboxEnabled`), its account (Epic: found on this PC, or "set Privacy > Achievements to
  Everyone"; Xbox: Sign in / Sign out, the sign-in popup shows the code and polls), and **Auto-add installed games**
  (`autoAddEpicGames` / `autoAddXboxGames`, off by default) with installed / in-library counts. It calls the backend
  port only; the auto-add itself runs in `app/store-sync` when a toggle changes. Activity Feed gains **Achievements**
  (`activityShowAchievements`). The Epic block also has **Epic Steam Overlay Workaround** (`epicOverlayWorkaround`, off by
  default, ADR-0057): `app/epic-launcher` closes a running Epic launcher when Play is pressed and ends it after the game.
- **Panels** (`settings/panels/*.tsx`), in the order `panel.tsx` renders them: Metadata, Achievements, Third-party, Notifications, Activity Feed,
  Community & Media, Routing Rules, Library Audit (which holds the Game Data block); then the sticky `sync-progress.tsx` bar.
  Shared rows and the spacing system (`Blocks`, `ItemRow`, `ButtonRow`, `ToggleRow`, `FullWidthRows`) are in `components.tsx`; the layout rules are [plugins.md guardrail 18](../plugins.md#18-settings-panel-layout-reference-enhanced-notifications).
- **Community & Media** (`panels/community.tsx`, F2): two toggles, `communityShowTrailers` and `communityShowArtworks`;
  `communityShowManuals` and `communityShowExternalLinks` keep their keys and defaults with no row until F2c.
- **Library Audit** (`panels/audit.tsx`): two blocks. The first is the counts and **Review**; the second is **Game Data**, three rows (label, description, a full-width **Manual Edit** button) that open the editor popup (`game-editor/`). The popup edits the description, credits and dates (saved as a manual edit), the player tags (toggle rows) and the **controller support**, which is stored in the `controllerOverrides` setting (the same one the audit modal writes) and applied at once: `ctx.controller.refresh` calls `metadata.rebadge`, and the override beats every badge source, Steam Store data included (`domain/category-policy.ts`).
- **Troubleshooting is gone** (2026-09-30): no kill-switch toggles or safety log in the panel. `disabledFeatures` still works from the config, the diagnostics stay in the log.
- The audit's per-game scan calls `ctx.ingest.start({ forceAll: true, onlyAppids: [appid] })`. If a sync is already running, the
  request is queued with its scope (merged with other queued ones) and the returned promise resolves after the follow-up run.

## Tests

`tests/settings-defaults.test.ts` (2). Live: `node steam-cartridges/tests/live/check_settings_panel.mjs`
mounts `PLUGIN_LIST['steam-cartridges-dev'].SettingsPanel` in a detached div and prints `PASS <title>` for the section titles and the Game Data block (`Manual Edit`). F1's `tests/metadata-edit.test.ts` (9) and `tests/game-editor.test.ts` (8) cover the Game Data editor; its popup is `settings/game-editor/`, reached only through `PanelContext.editor`.

## How to add a panel

1. New `settings/panels/<name>.tsx` exporting `<Name>Section`; read settings with `useSetting`, the app with `usePanelContext()`.
2. Anything it needs from the app: add it to `PanelContext` and wire it in `index.tsx`. Never import `app/`.
3. Add it to `panel.tsx` and its title to `steam-cartridges/tests/live/check_settings_panel.mjs`.
