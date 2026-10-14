# steam-cartridges: live verification, rollback and open issues

**This doc's one job:** how to prove a change to `steam-cartridges` works in the real client, how to undo a bad deploy, and what is
known-open. It replaces the execution manuals of the migration, M10 and icon plans (deleted 2026-09-30; their history is in
[CHANGELOG.md](../../CHANGELOG.md), their decisions in [ADR-0039 to ADR-0044](../decisions.md)).

## Environment (this machine)

| Thing | Value |
| --- | --- |
| Steam / DevTools | `C:\game\steam`, `http://127.0.0.1:8080` (use `127.0.0.1`, never `localhost`) |
| Deployed dev plugin | `C:\game\steam\millennium\plugins\steam-cartridges-dev` (created by `dev.ps1`; the released plugin is never touched) |
| Node / Lua | Node 24 (built-in `WebSocket`, live scripts need no npm packages); LuaJIT 2.1 at `C:\dev\tools\lua` on `PATH` |
| Test shortcuts | AM2R `4263274102` (unmapped, local metadata, captures) · WUCHANG: Fallen Feathers `3135033888` (mapped, native `2277560`) · Jotunnslayer `2315502503` (mapped, native `2820820`) |

## The baseline every change must reproduce

Deploy (`powershell -ExecutionPolicy Bypass -File dev.ps1` in `steam-cartridges`), wait for a `SharedJSContext` target in
`curl -s http://127.0.0.1:8080/json` plus 20 s, then `npm run test:live`: every line `PASS` (parity may `SKIP` in Big Picture), exit 0.
Its ten lines: `parity`, `K4: Mark as Private disabled`, `K6: overview repair via trigger`, `render loop`, `Properties (WUCHANG)`,
`Properties (Jotunnslayer)`, `navigation cycle`, `tabs`, `settings panel renders`, `audit: no missing metadata`. The same checks run alone:

| Command (from repo root) | PASS looks like |
| --- | --- |
| `node steam-cartridges/tests/live/count_cycle.mjs 4263274102` | last line `PASS render loop:` (all counts <= 3; warm start `enrich(page)=0`) |
| `node steam-cartridges/tests/live/test_props.mjs 3135033888 --page` | `appid 3135033888 page=true: OK; popup=["WUCHANG: Fallen Feathers"]` |
| `node steam-cartridges/tests/live/test_nav_cycle.js` | six `PASS`, no `FAIL` |
| `node steam-cartridges/tests/live/check_all_tabs.js` | eleven `PASS`, no `FAIL` |
| `node steam-cartridges/tests/live/check_settings_panel.mjs` | one `PASS <title>` per panel title |

Then AGENTS.md Routines 1 and 2 by hand (AM2R, WUCHANG, Jotunnslayer). Per-area extras that automation does not cover:

- Big Picture AM2R Activity feed: thumbnails 320x180 (`nsga-bpm-activity-thumbs` style).
- Guardrail 11: after a Steam restart, open Jotunnslayer first thing: Game Info shows the native description without navigating away.
- `node tests/live/probes/http_calls.mjs` before and after one nav cycle: no source's count grows.
- Launch and quit AM2R: no toast (no achievements) and the log line `AM2R closed; refreshing its activity.`; `probes/toast_live.mjs`.
- Artwork: clear and re-link WUCHANG; `probes/shortcut_icon.mjs 3135033888` prints `PASS icon sharp`; `steam_store.json`
  `applied_artwork["3135033888"].slots` is `[0,1,2,3]`.
- Library grid sorts AM2R by its newest screenshot (log line `Filled in last-played for …`).
- Desktop PlayBar info button on AM2R; `probes/exception_stack.mjs 4263274102` and `… 3135033888` print no `TypeError`; WUCHANG's
  Achievements tab shows its achievements; Troubleshooting lists 8 surfaces.
- Achievements in Steam from start-up (ADR-0045): right after a Steam restart, before opening any game page,
  `node tests/live/probes/ach_preload.mjs` prints no `FAIL` (progress cache holds > 100 shortcuts in Steam's shape, no
  signed `m_mapAppData` keys, no server request for a shortcut). Then `node ../enhanced-notifications/tests/achievements-reset.mjs`.

Any FAIL, or Steam's "restart the UI" dialog: stop and roll back (below). Diagnosing a hang: [steam-debug.md Trap 10](../steam-debug.md#trap-10-diagnosing-a-hung-sharedjscontext-restart-the-ui-dialog).

**Never run on this machine yet (M10 § 8.3, still owed by a human):** the five visual hand checks: BPM thumbnails, Jotunnslayer first-open
Game Info, launch/quit toast log line, library grid last-played order, PlayBar ⓘ.

## Rollback

- **Undo a commit range:** `git revert` newest first, each as its own commit; never reset pushed history. A step that changes no
  persisted file (`library_metadata.json`, `steam_store.json`, `achievements.json`, `freshness.json`, `known_shortcuts.json`, settings keys)
  needs no data migration. Reverting code that a ratchet guards makes the ratchet fail and name what came back: that is the ratchet working.
- **Live rollback of a deployed build:** `git worktree add <scratch>/rb <tag-or-commit> --detach`; link `node_modules` as a junction
  (`cmd //c mklink //J <scratch>\rb\steam-cartridges\node_modules C:\game\millennium\steam-cartridges\node_modules`); run `dev.ps1` there;
  afterwards **delete the junction first** (`(Get-Item <scratch>/rb/steam-cartridges/node_modules -Force).Delete()`), then
  `git worktree remove --force <scratch>/rb`. Otherwise git deletes the real `node_modules`.
- **Steam will not start the UI:** `powershell -ExecutionPolicy Bypass -File start-steam-dev.ps1 -KillOnly`, remove `"steam-cartridges-dev"` from
  `plugins.enabledPlugins` in `C:\game\steam\millennium\config\config.json` (change nothing else), delete
  `C:\game\steam\millennium\plugins\steam-cartridges-dev`, start Steam again.

## Open known issues

| Id | Issue | Next |
| --- | --- | --- |
| F30 | Six module-level `deps` objects mutated by `create*Surface` (`surfaces/*/deps.ts`): a hidden singleton per surface | **Decided not to refactor** (see TASK.md "Considerations"): add a ratchet rule instead |
| F32 | `test_backend.lua` expects 213 screenshots / 6 media games; the live library has more | library drift, refresh the fixture when convenient (AGENTS Routine 4) |
