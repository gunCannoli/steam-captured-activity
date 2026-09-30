# Plan: F1 Game Data editor (manual Game Info and manual Steam link)

**Status:** **Code done and committed 2026-09-30, on top of M10; live verification (§ 7) pending.** The original patches
(2026-09-29) no longer applied after M10, so they were re-applied with `git apply --reject` and the rejected hunks merged by hand: the RPC
registrations in `main.lua`, `steam_store_rpc.lua`, `web_rpc.lua`, `StoreCandidate` in `ports/backend.ts`, `index.tsx` and
`settings/context.ts` (the `Route` type now comes from the kernel; `SteamStore` is a factory). One real difference: the capability ratchet
(ADR-0044) forbids `new Date(` in `domain/`, so `metadata-edit.ts` formats dates with pure arithmetic. `SaveGameMetadata` is also removed from
`tests/architecture-unwired-rpcs.json`. Counts now: `test:ts` 202/202, `test_metadata_service` and `test_steam_store` green. The patch
folder was deleted: the commits are the record (`git log --grep "F1"`). Steps 1-6 below describe what was done; do not re-run them.
**Kind:** Feature plan, written for the weak implementer ([the plan writing standard](README.md)). The literal before/after
blocks are the five patch files in [steam-cartridges-f1-game-data-editor/](steam-cartridges-f1-game-data-editor/); each step
applies one and checks it.
**Parent:** [steam-cartridges-features-plan.md § F1](steam-cartridges-features-plan.md) (the decisions and the user-facing scope).
**Layer rules:** [steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs), [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam).

## 1. What ships, and what the research found

Settings gets a **Game Data** section with **Edit game data…**. It opens a popup: filter box + dropdown of every non-Steam
shortcut; for the chosen game a form of every field Steam's Game Info shows, **Save** and **Revert to fetched data**; a
**Steam link** block with the current link, **Unlink** / **Unlink and never suggest it again**, and a search box over Steam's
games with **Link** buttons. No new surface and no new Steam write: the `game-info` surface (already there) re-renders from
`record.metadata`, and linking reuses `app/steam-store.ts`.

Facts the parent plan left open, answered from the code (each one shaped a step):

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| 1 | `SaveGameMetadata` accepts a **native** appid, does no validation, returns the metadata (not a record part) and is registered but has no caller. | `backend/web_rpc.lua:134` | Replaced by `SaveCustomMetadata` / `ClearCustomMetadata` (`record_rpc.lua`, logic in `metadata_service.lua`, tested). `SaveGameMetadata` is deleted (dead-code rule D13). |
| 2 | The save response can update the record directly; no `EnsureFresh` is needed. A **revert** does need one (nothing is stored any more). | `metadata_service.ensure` returns `source = "custom"` first thing, no network | `SaveCustomMetadata` returns the `part`; `app/game-editor.ts` puts it in the record. `revert` calls `metadata.ensure`. |
| 3 | A manual edit beats **everything**, also for a game linked to a Steam app. | `metadata_service.lua` `ensure`: the `custom_override` check is above the `steam-store` branch | Link/Unlink do not change what Game Info shows for an edited game. The popup says so; **Revert** is the way back to Steam's data. |
| 4 | Game Info reads player badges from `store_category_ids` when present, and only then from `categories.*`. | `surfaces/game-info/category-policy.ts` `badgeCategoryIds` | Editing a badge flag without touching the id list would do nothing on a mapped game. `applyDraft` edits both (changed flags only). |
| 5 | The controller badge of a non-Steam record ignores the record's controller flags (emulator inference / setting wins). | same function, `source !== 'steam-store'` branch | Controller is **not** a form field; the popup says where it lives (Settings → Metadata, Library Audit). |
| 6 | The backend writes an empty list as `{}`, not `[]`. | `web_metadata_db.lua` `format_json` | The frontend never trusts a list field: `listOf()` returns `[]` for anything that is not an array. |
| 7 | `metadata_db.set` drops `short_description` and `summary` on every write. | `web_metadata_db.lua` `set` | Only `description` is a form field. |
| 8 | `steam_store_store.set_mapping` already clears the game's pending suggestions; `clear(appid, true)` remembers a rejection. | `steam_store_store.lua` | A manual link (or "never suggest again") replaces the parent plan's dropped reject-suggestion button. No store change needed. |
| 9 | A plain **Unlink** re-runs identity resolution, which can match the same game by title again. | `app/steam-store.ts` `clearSteamStore` | Two buttons: Unlink, and Unlink and never suggest it again. |
| 10 | `SteamStoreSearch` (deleted in M9a) auto-mapped, and `classify_items` drops results that are not close to the title. | `steam_store_search.lua` | New read-only `SteamStoreSearchCandidates` returns the raw store hits (apps only, max 10). Nothing is mapped, suggested or cached. |
| 11 | `metadata.ensure(..., { noNetwork: true })` still reaches Steam's appdetails for a mapped game (the backend ignores the flag there). | `metadata_service.lua` `ensure` | The popup's `load()` reads the record only. A game never opened this session shows an empty form with a note. |
| 12 | The Library Audit panel already has a numeric "Link Steam AppID" box. | `settings/panels/audit.tsx` | Untouched. The editor adds search; both call the same `setSteamStoreMapping`. |
| 13 | Some working-tree files are CRLF while git stores LF (`git ls-files --eol`: `settings/context.ts`, `tests/live/run.mjs`, mixed `tests/test_steam_store.lua`). | `.gitattributes` `text=auto` | Multi-line edits with the Edit tool can fail on them. Use `git apply` (it handles this) and nothing else. |

No kill switch: the editor writes only our own files; the Steam-side writes stay in `game-info` (already switchable).

## 2. Preconditions

Run from `c:\game\millennium\steam-cartridges` in PowerShell unless noted. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- .` | prints nothing (unrelated changes under `docs/` are allowed) |
| P2 | `git log -1 --format=%h` | `c20c654` or a descendant (`git merge-base --is-ancestor c20c654 HEAD; $LASTEXITCODE` prints `0`) |
| P3 | `npm run check` | after the npm banner and `> tsc --noEmit`: nothing; exit 0 |
| P4 | `npm run test:ts` | ends `ℹ pass 147` and `ℹ fail 0` |
| P5 | the Lua block below | `test_metadata_service: 49 PASS ... ALL PASS`, `test_steam_store: 84`, `test_backend: 78`, `test_freshness: 43` |
| P6 | `npm run build` | contains `build Succeeded passing all tests`; note whether it also prints `TS5096` (a known warning, not caused by this plan) |
| P7 | `git apply --check ..\docs\plans\steam-cartridges-f1-game-data-editor\s1-backend.patch` | prints nothing, exit 0 |

The Lua block (also used after step 1):

```powershell
$env:NSGA_STEAM_ROOT = 'C:/game/steam'
foreach ($t in 'test_metadata_service','test_steam_store','test_backend','test_freshness') {
  $o = lua "tests/$t.lua" 2>&1
  '{0}: {1} PASS, last line: {2}' -f $t, ($o | Select-String '  PASS').Count, ($o | Select-Object -Last 1)
}
```

If P1–P7 do not hold, stop (failure rule, § 8).

## 3. Do-not-touch list

- `settings/defaults.ts`, `tests/fixtures/settings-defaults.json` (no new setting, do-not-touch 1 of the settings doc).
- Everything under `frontend/surfaces/`, `frontend/sensors/`, `frontend/safety/`, `frontend/kernel/`.
- `frontend/app/steam-store.ts`, `frontend/app/metadata.ts`, `frontend/app/view.ts` (the editor only calls their public functions).
- `settings/panels/audit.tsx` (its "Link Steam AppID" box stays), `settings/components.tsx`.
- `backend/resolve_identity.lua`, `backend/fresh_policy.lua`, `backend/steam_store_store.lua`, `backend/web_rpc.lua` beyond deleting `SaveGameMetadata`.
- `tests/architecture-allowlist.json` (it must not change; a new cross-area edge means the patch is wrong).
- `SteamStoreRejectSuggestion` and its tests stay for now (§ 10, follow-ups).
- Any existing check in `tests/live/` except the two one-line additions in step 5 (guardrail 15).

## 4. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no probe or throwaway plugins; no edits to
Millennium's `config.json` or the plugin's config; no changes to the user's library, collections or shortcuts; no
`npm install` / upgrade (ignore the `@steambrew/ttc` update nag); no `git push --force`; no `--no-verify`; no editing a patch
file or the files it creates "to make it fit" (a patch that does not apply means the plan is stale, so stop). No use of the Edit
tool on the files the patches touch (finding 13).

## 5. Steps

Each step: apply the patch, run the commands, compare with the expected output. The patch files are the literal before/after
blocks; open one to review it, do not retype it.

### Step 1: backend (Lua)

```powershell
git apply --check ..\docs\plans\steam-cartridges-f1-game-data-editor\s1-backend.patch   # expected: no output
git apply ..\docs\plans\steam-cartridges-f1-game-data-editor\s1-backend.patch
git status --short -- .
```

Expected `git status`: 9 lines, all `M` (`backend/main.lua`, `metadata_service.lua`, `record_rpc.lua`, `steam_store_rpc.lua`,
`steam_store_search.lua`, `web_metadata_db.lua`, `web_rpc.lua`, `tests/test_metadata_service.lua`, `tests/test_steam_store.lua`).

What it does:

| File | Change |
| --- | --- |
| `web_metadata_db.lua` | `delete(appid) -> boolean`. |
| `metadata_service.lua` | `save_custom(appid, meta)`: shortcut appids only, non-empty string `title`, forces `appid` and `custom_override = true`, stores with force, returns a `custom` part. `clear_custom(appid)`: removes the record **only if** it is a manual edit. |
| `record_rpc.lua` | `SaveCustomMetadata { appid, metadata } -> { part } \| { error }`; `ClearCustomMetadata { appid } -> { removed } \| { error }`. |
| `steam_store_search.lua` | `candidates(term, http_get?)`: read-only, terms shorter than 2 characters make no request, apps only, max 10, `{ candidates, error? }`. |
| `steam_store_rpc.lua` | `SteamStoreSearchCandidates { term }`. |
| `main.lua` | registers the three new methods; drops `SaveGameMetadata`. |
| `web_rpc.lua` | deletes `SaveGameMetadata`. |

Then run the Lua block from § 2. Expected: `test_metadata_service: 64 PASS`, `test_steam_store: 91 PASS`, `test_backend: 78 PASS`,
`test_freshness: 43 PASS`, each with last line `ALL PASS`. Then `npm run check` (nothing) and `npm run test:ts` (`ℹ pass 147`, `ℹ fail 0`;
no TypeScript changed yet).

Commit: `git add backend tests/test_metadata_service.lua tests/test_steam_store.lua` then
`git commit -m "feat(steam-cartridges): F1 backend, SaveCustomMetadata, ClearCustomMetadata, SteamStoreSearchCandidates"` + attribution line.

### Step 2: domain (pure rules)

```powershell
git apply --check ..\docs\plans\steam-cartridges-f1-game-data-editor\s2-domain.patch
git apply ..\docs\plans\steam-cartridges-f1-game-data-editor\s2-domain.patch
```

Creates `frontend/domain/metadata-edit.ts` and `tests/metadata-edit.test.ts` (both new, `??` in `git status`). The module imports
`import type` from `../kernel/record` only. It holds: `EDITABLE_FIELDS` (8 text/list/date fields in form order), `PLAYER_FLAGS`
(single-player 2, multi-player 1, co-op 9, shared/split screen 24), `MetadataDraft` (strings only; lists separated by `;`, dates
`YYYY-MM-DD`), `listOf`, `splitList`, `formatDate`/`parseDate` (UTC), `playerFlagsOf` (ids win, like Game Info), `draftOf`,
`validate` (title required; dates valid), `diff` (drives the Save button), `applyDraft` (keeps every field the form does not show;
edits `store_category_ids` only for a changed flag; throws on an invalid draft).

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 156` and `ℹ fail 0` (147 + 9).

Commit: `git add frontend/domain/metadata-edit.ts tests/metadata-edit.test.ts`,
`git commit -m "feat(steam-cartridges): F1 domain, metadata-edit rules"` + attribution line.

### Step 3: ports and app

```powershell
git apply --check ..\docs\plans\steam-cartridges-f1-game-data-editor\s3-app.patch
git apply ..\docs\plans\steam-cartridges-f1-game-data-editor\s3-app.patch
```

Modifies `frontend/ports/backend.ts` (`saveCustomMetadata`, `clearCustomMetadata`, `steamStoreSearchCandidates`, type
`StoreCandidate`); creates `frontend/app/game-editor.ts` and `tests/game-editor.test.ts`.

`createGameEditor(deps)` returns `load`, `save`, `revert`, `search`, `link`, `unlink`:

| Method | Behaviour |
| --- | --- |
| `load(appid)` | Record read only (finding 11) plus `steamStoreGetMapping`. Returns `{ metadata, hasMetadata, custom, link, rejected, title }`. |
| `save(appid, draft)` | `applyDraft` on the current record (throws before any call when invalid), `saveCustomMetadata`, then `records.update(appid, { metadata: part })`. The record event drives the `game-info` surface through the render queue. |
| `revert(appid)` | `clearCustomMetadata`, then `metadata.ensure(appid, routeOf(appid), record.identity)`. |
| `search(term)` | `steamStoreSearchCandidates`, read only. |
| `link` / `unlink(appid, reject)` | Delegate to `setSteamStoreMapping` / `clearSteamStore` (they re-run identity, metadata, artwork). |

A native (non-shortcut) appid is refused everywhere. Runtime imports in `app/` use the `.ts` extension (`../kernel/appid.ts`,
`../domain/metadata-edit.ts`), like the other `app/` files, so Node can run the tests.

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 164` and `ℹ fail 0`
(the architecture test also confirms `ports/backend.ts` only calls methods `main.lua` registers).

Commit: `git add frontend/ports/backend.ts frontend/app/game-editor.ts tests/game-editor.test.ts`,
`git commit -m "feat(steam-cartridges): F1 app, game editor use cases and ports"` + attribution line.

### Step 4: settings UI and composition

```powershell
git apply --check ..\docs\plans\steam-cartridges-f1-game-data-editor\s4-settings-and-wiring.patch
git apply ..\docs\plans\steam-cartridges-f1-game-data-editor\s4-settings-and-wiring.patch
```

| File | Change |
| --- | --- |
| `settings/context.ts` | `EditorSnapshot` (structural copy of the app's), `PanelContext.editor`, an inert default. |
| `settings/panel.tsx` | renders `<GameDataSection />` right after `<MetadataSection />`. |
| `settings/panels/game-data.tsx` | new: the section and the **Edit game data…** button. |
| `settings/game-editor/` | new: `modal.tsx` (state, load/save/revert flow, stale-load guard), `game-picker.tsx`, `metadata-form.tsx`, `steam-link.tsx`, `styles.ts`. Reads the app only through `usePanelContext().editor`. |
| `index.tsx` | builds `gameEditor = createGameEditor({...})` after `metadata`, passes it as `editor` to `setPanelContext`, exports `gameData` (the CDP hook the live probe uses). |

Expected: `npm run check` prints nothing (this is the step that type-checks the UI against `@steambrew/client`);
`npm run test:ts` ends `ℹ pass 164` and `ℹ fail 0` (the import-ratchet test passes without touching the allowlist);
`npm run build` contains `build Succeeded passing all tests`.

Commit: `git add frontend/settings frontend/index.tsx`,
`git commit -m "feat(steam-cartridges): F1 settings, Game Data popup and wiring"` + attribution line.

### Step 5: live checks (files only; the implementer does not run them)

```powershell
git apply --check ..\docs\plans\steam-cartridges-f1-game-data-editor\s5-live.patch
git apply ..\docs\plans\steam-cartridges-f1-game-data-editor\s5-live.patch
node --check tests/live/probes/game_editor.mjs
```

`node --check` prints nothing. The patch adds `tests/live/probes/game_editor.mjs`, the run.mjs entry `F1: Game Data editor (save, revert, search)`
(must match `^PASS F1 revert`), and `"Game Data"` in `check_settings_panel.mjs` (the title list grows from 8 to 9; this is a
new section, not a weakened check).

Commit: `git add tests/live`, `git commit -m "test(steam-cartridges): F1 live probe and settings title"` + attribution line.

### Step 6: docs (from the parent repo root, `c:\game\millennium`)

Make exactly these edits with the Edit tool (all files are LF):

1. `docs/steam-cartridges/rpc.md`: replace the whole `SaveGameMetadata` table row with the first two rows below, and add the third
   right after the `SteamStoreClearMapping` row:
   ```
   | `SaveCustomMetadata` | `record_rpc.lua` (→ `metadata_service.save_custom`) | live | F1: `app/game-editor.ts` `save()`; replaced the unwired `SaveGameMetadata` |
   | `ClearCustomMetadata` | `record_rpc.lua` (→ `metadata_service.clear_custom`) | live | F1: `app/game-editor.ts` `revert()`; only removes a `custom_override` record |
   | `SteamStoreSearchCandidates` | `steam_store_rpc.lua` (→ `steam_store_search.candidates`) | live | F1: read-only store search for the manual link picker; never maps or caches |
   ```
   Then add to the `**Result:**` paragraph one sentence: "F1 (2026-09-29) added 3 live methods and deleted the unwired `SaveGameMetadata`."
2. `docs/steam-cartridges/settings.md`: in the `settings/context.ts` bullet add `editor` to the list; in the Panels bullet insert
   "Game Data" after "Metadata"; in Tests add `tests/metadata-edit.test.ts` (9) and `tests/game-editor.test.ts` (8) and change
   "the 8 titles" to "the 9 titles".
3. `docs/steam-cartridges/service-metadata.md`: under "What it owns" add: "`save_custom` / `clear_custom` store and drop a manual edit
   (the Game Data editor, F1). A manual edit wins over every route, including a Steam link."
4. `docs/plans/steam-cartridges-features-plan.md`: change the F1 row of the Order table to `Done (2026-09-29)` only after the user's live verification
   (§ 7). Until then leave it.
5. [CHANGELOG.md](../../CHANGELOG.md): one bullet at the top of the entries, dated 2026-09-29: **steam-cartridges: F1 Game Data editor
   (code done, live verification pending)**; facts: the popup, the three RPCs, `SaveGameMetadata` deleted, findings 3, 4, 5, 9 of § 1
   of this plan, test counts (TS 164, Lua 64/91).
6. [TASK.md](../../TASK.md): add "F1 Game Data editor: code committed, waiting for the live verification in the plan § 7" under Now.

Commit: `git add docs CHANGELOG.md TASK.md .gitattributes`, `git commit -m "docs: F1 Game Data editor"` + attribution line.
Do not push (Routine 5 pushes at the end of the session, after the user has run § 7).

## 6. Guardrail checklist

Re-read each guardrail in [plugins.md](../plugins.md) and tick it with the one-line proof.

- [ ] **2 (no expensive work in hot hooks):** no prototype method or hook is touched; the editor runs from a settings click. Proof: `git diff --stat` shows nothing under `frontend/surfaces/`.
- [ ] **5 (negative cache):** `SteamStoreSearchCandidates` never calls `store.set_negative`. Proof: `steam_store_search.lua` `candidates` has no `store` parameter.
- [ ] **7 (category cache):** category purging stays in the `game-info` surface; the editor only changes the record. Proof: no edit under `surfaces/game-info/`.
- [ ] **8 (metadata channels):** nothing writes `appData.details`. Proof: `git grep -n "\.details" -- frontend/app/game-editor.ts frontend/settings` prints nothing.
- [ ] **11 (re-render every window):** the record event goes through `render-queue`, which drives the existing surface. Proof: `app/game-editor.ts` calls only `records.update`.
- [ ] **15 (never weaken a check):** no assertion in `tests/live/` is relaxed; `"Game Data"` is added, not swapped. Proof: `git diff tests/live` shows only added lines.
- [ ] **17 (a render never starts work):** every editor call starts from a click handler. Proof: `grep -n "editor\." frontend/settings/game-editor/*.tsx` shows calls only inside `onClick`, `onKeyDown` handlers and the `pick` / `run` functions they call, never at render level.
- [ ] **Architecture rules (ADR-0039):** `settings/` imports no `app/`; `index.tsx` only composes. Proof: `npm run test:ts` passes with `tests/architecture-allowlist.json` unchanged (`git status --short -- tests/architecture-allowlist.json` prints nothing).

## 7. Live verification (the user, or a verifier the user names)

The implementer stops after step 6. After `powershell -ExecutionPolicy Bypass -File dev.ps1` (deploy and restart Steam), from
`steam-cartridges`:

1. `node tests/live/check_settings_panel.mjs`: 9 lines `PASS <title>`, including `PASS Game Data`.
2. `node tests/live/probes/game_editor.mjs 4263274102`: prints, in this order,
   `PASS F1 save: the new description reaches Steam's Game Info and the game is custom`,
   `PASS F1 revert: the marker is gone and the game is no longer custom`,
   `PASS F1 search: Steam's games are found without linking anything`. Exit 0. (It aborts with `FAIL` if the game already has a manual edit.)
3. `npm run test:live`: every line `PASS` (or the existing parity `SKIP` in Big Picture), including the new `F1: Game Data editor` line and
   `render loop` (`PASS render loop:`).
4. By hand (Routines 1 and 2 of AGENTS.md, one game A and one native game B): open Settings → Game Data → **Edit game data…**;
   filter the list by typing part of a name; pick AM2R; change the description and untick Single-player; **Save** (message `Saved.`);
   open the game's page: Game Info shows the new text and no single-player badge on desktop **and** in Big Picture; go to game B and back to A: still there.
   **Revert to fetched data**: the original text and badge return. Search "Jotunnslayer", **Link** it to a shortcut: art and
   Steam's data appear; **Unlink and never suggest it again**: art clears and the game is not suggested again.

Only after 1–4 pass: mark F1 done in the parent plan's Order table, and add the live results to the CHANGELOG entry.

## 8. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines) and the step
number to [TASK.md](../../TASK.md) § Active Failures & Blockers, then exit. Do not retry, edit a patch, edit around the failure or skip ahead.
A `git apply --check` that fails is a failure of that step (the plan is stale), not something to work around.

## 9. Dry-run record (2026-09-29)

The five patches were generated from a scratch copy of `HEAD` (`c20c654`) in which the code was written and run:

- `git apply --cached` of the five patches in order to a temporary index of `HEAD`: exit 0 each (11 files added, 15 modified).
- `git apply --check` of the combined patch against the working tree: exit 0.
- Scratch tree: `tsc --noEmit` exit 0, `node --experimental-strip-types --test tests/*.test.ts` 164 pass / 0 fail (147 + 9 + 8),
  `npm run build` `build Succeeded passing all tests`.
- Lua (`NSGA_STEAM_ROOT=C:/game/steam`): `test_metadata_service` 49 → 64 PASS, `test_steam_store` 84 → 91, `test_backend` 78, `test_freshness` 43,
  `test_identity` 18, `test_art_service` 25, `test_ach_service` 19, `test_migrate` 7; all `ALL PASS`.
- **Not dry-run** (needs the deployed client): the live probe and the popup's behaviour in Steam. The probe passes `node --check`; § 7 is where they are first exercised.

## 10. Not in this plan (follow-ups)

- Deleting `SteamStoreRejectSuggestion` + `store.reject` (no feature is left behind them, dead-code rule D13): a small cleanup step after § 7 passes.
- Editing the controller badge per game (lives in Settings → Metadata and the Library Audit).
- Hiding shortcuts already mapped from the picker, or bulk edit.
