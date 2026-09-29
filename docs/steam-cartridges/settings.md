# settings

**One job:** the settings store (`settings/settings.ts`, `defaults.ts`) and the panels that edit it. Panels never import `app/`,
`surfaces/` or `features/`; they reach the app through one context and the backend through `ports/backend.ts`.

## Contract

- **Defaults are pinned.** `settings/defaults.ts` (type-only imports) holds `DEFAULTS`, `DEFAULT_SERVICES` and the types;
  `tests/fixtures/settings-defaults.json` is checked against it. No key is renamed, no default changed (do-not-touch 1).
- **`settings/context.ts`** (`PanelContext`, `setPanelContext`, `usePanelContext`): `routing`, `ingest`, `records`, `controller`,
  `steamStore`, `safety`. `index.tsx` calls `setPanelContext` at the top of `init()`; before that the context is inert.
- **Panels** (`settings/panels/*.tsx`), in the order `panel.tsx` renders them: Metadata, Achievements, Notifications, Activity Feed,
  Community & Media, Routing Rules, Library Audit, Troubleshooting; then the sticky `sync-progress.tsx` bar.
  Shared rows are in `components.tsx`.
- **Troubleshooting** (`panels/troubleshooting.tsx`): one toggle per `FEATURE_IDS` entry (on = not in `disabledFeatures`), written with
  the pure `toggleFeature` (`troubleshooting-core.ts`); a read-only block with safe mode and each feature's state
  (`on`, `off`, `tripped (n errors)`) and one line per surface from `ctx.safety.surfaces()` (the surface runner's status:
  `installed`, `not installed`, `off`, with error counts). Changes take effect after Steam restarts.
- The audit's per-game scan calls `ctx.ingest.start({ forceAll: true, onlyAppids: [appid] })`. If a sync is already running, the
  request is queued with its scope (merged with other queued ones) and the returned promise resolves after the follow-up run.

## Tests

`tests/settings-defaults.test.ts` (2), `tests/troubleshooting-core.test.ts` (3). Live: `node scratch/check_settings_panel.mjs`
mounts `PLUGIN_LIST['steam-cartridges-dev'].SettingsPanel` in a detached div and prints `PASS <title>` for the 8 titles.

## How to add a panel

1. New `settings/panels/<name>.tsx` exporting `<Name>Section`; read settings with `useSetting`, the app with `usePanelContext()`.
2. Anything it needs from the app: add it to `PanelContext` and wire it in `index.tsx`. Never import `app/`.
3. Add it to `panel.tsx` and its title to `scratch/check_settings_panel.mjs`.
