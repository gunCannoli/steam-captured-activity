# Plan: shortcut library icon (mirror the Steam icon onto a non-Steam game)

**Status:** Ready to execute (2026-09-29). Dry-run done: the six patches apply in order to `cdc656d` and to `987ae8c`
(docs-only descendant), both alone and before or after the F1 plan's patches; every step's expected output below
was observed (§ 9).
**Kind:** Feature plan, written for the weak implementer ([the plan writing standard](README.md)). The literal
before/after blocks are the six patch files in [steam-cartridges-icon-plan/](steam-cartridges-icon-plan/); each step
applies one and checks it.
**Asked for by:** the user, 2026-09-29: "the library icon of the non-Steam game is based on the exe file and not
Steam metadata … very pixelated … since we are already mirroring all metadata and art, also the library game icon."
**Layer rules:** [steam-architecture.md § 3](../steam-architecture.md), [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)
(only surfaces write to Steam). **Facts:** [knowledgebase § Where a shortcut's icon comes from](../knowledgebase.md#where-a-shortcuts-icon-comes-from-and-how-to-change-it-setshortcuticon).

## 1. What ships, and what the research found

A non-Steam shortcut that `steam-cartridges` matched to a Steam app (WUCHANG: Fallen Feathers → `2277560`,
Jotunnslayer → `2820820` on this machine) gets that app's **184 px** community icon as its library icon instead of
the 32 px icon Steam pulls out of the exe. A shortcut with no Steam match gets SteamGridDB's icon, but only as part
of a slot lookup SteamGridDB already makes. Unlinking a game puts its old icon back. An icon the user or Steam ROM
Manager chose is never replaced, restored or touched. The `artwork` kill switch turns it off; no new setting.

Root cause and facts (live captures on 2026-09-29, Steam at `127.0.0.1:8080`, shortcut `3135033888`):

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| 1 | **Root cause.** WUCHANG's `shortcuts.vdf` `icon` field is `D:\Games\Local\Wuchang - Fallen Feathers\Project_Plague.exe`; Steam extracts the exe's icon as a **32×32 BMP** (`icon_data_format: "bmp"`, header width/height `0x20`) and scales it up. Jotunnslayer's field is `""` (same BMP). | `appStore.GetAppOverviewByAppID(3135033888).icon_data`; `shortcuts.vdf` read with node | The fix changes the `icon` field, nothing else. |
| 2 | `SteamClient.Apps.SetShortcutIcon(appid, path)` takes a **local file path**, returns `undefined`, rewrites `shortcuts.vdf` at once and, within 500 ms, replaces the overview with one whose `icon_data` is the new file (`jpg:20512`, the 184 px file). `SetShortcutIcon(appid, "")` goes back to the exe icon. Restoring the original value left `shortcuts.vdf` byte-identical (`cmp` against a backup). | live test, reverted | One supported Steam call; restore is the same call with the old value. |
| 3 | Steam's own "Choose icon" (Properties, module `73291`) calls exactly `SetShortcutIcon(t, e)`. | `find_module_src.mjs SetShortcutIcon` | Not a private hack; the same write the user makes by hand. |
| 4 | The frontend cannot read the field (`appDetailsStore.GetAppDetails` has `strShortcutExe`, `strShortcutStartDir`, `strShortcutLaunchOptions`, `bShortcutIsVR`, no icon). `backend/shortcuts.lua` already parses `icon`. | live read; `shortcuts.lua` `WANTED.icon` | Eligibility is decided in the backend (`art_service.icon_eligible`). |
| 5 | Source: `StoreItemCache.GetApp(id).GetAssets().GetCommunityIconURL_Full()` = the same art as Steam's own 32 px sidebar icon (`GetCommunityIconURL`, identical to `appStore.GetIconURLForApp` for owned native games) at **184×184** (`…/2277560/06a62ea3…_full.jpg`, 15 384 bytes). Jotunnslayer has one too. No unhashed CDN path exists. | live; downloaded and measured | `domain/store-item.ts` adds `icon`; `cdnArtworkUrls` has none (its type is narrowed). |
| 6 | Ruled out: the `.ico` clienticon (`<Steam>/steam/games/<hash>.ico`) needs PICS appinfo; `2277560` is not in `appcache/appinfo.vdf` (not owned). | node scan of `appinfo.vdf` | Not used. |
| 7 | Most emulator shortcuts already use Steam ROM Manager icons, `<user>/config/grid/<appid>_icon.<png\|jpg\|ico>`, served full size. Steam never reads that name by itself; only the field counts. | `shortcuts.vdf` scan: 218 of 220 name an image file, 2 are exe/empty (WUCHANG, Jotunnslayer) | Eligible only when the field is `""` or an `.exe`: those shortcuts are untouched. The file goes in **our** folder, `<Steam>/millennium/config/steam-cartridges/icons/<appid>.<ext>`: the backend writes only its own files (ADR-0039) and never collides with a Steam ROM Manager file. |
| 8 | SteamGridDB: 218 of 220 shortcuts have all four slots, so no SteamGridDB request is made for them today. An icon-only lookup would add one request per shortcut. | [service-artwork.md](../steam-cartridges/service-artwork.md) M5c live note | The icon rides along inside a slot lookup (`fetch(id, key, want_icon)`, the `icons` endpoint, PNG or ICO). No new request pattern. |
| 9 | `SetShortcutIcon` replaces the shortcut's `AppOverview` object, which Steam also does on any shortcut edit (rename). The K6 overview-rebuild repair (ADR-0042) re-applies Game Info then. | finding 2 (`(new)` object each poll); `gameInfoRepairDiagnostics` | Live verification runs Routine 1 and 2 after the icon is set (§ 7). |
| 10 | `web_sgdb.download_image_base64` had no caller. | `grep -rn download_image_base64` | Replaced by `download_image` (raw bytes), which the icon file needs (dead-code rule D13, no duplicate downloader). |
| 11 | The F1 plan's `s3-app.patch` edits the lines around `steamStoreClearMapping` in `ports/backend.ts`. | `steam-cartridges-f1-game-data-editor/s3-app.patch` hunk `@@ -173,6 +186,10 @@` | That port's type is left alone; `app/steam-store.ts` reads the new `icon_restore` with `iconRestoreOf(res)` (defensive, like `slotList`). All six patches apply before or after F1 (§ 9). |
| 12 | Line endings: every file the patches touch is LF in git (`git ls-files --eol`). The patch files need `*.patch text eol=lf`, which is in the working tree's `.gitattributes` (uncommitted F1 work at the time of writing). | `git check-attr eol` | Apply with `git apply` only; P7 catches a CRLF checkout. |

Ownership rules (backend `art_service.icon_eligible`, tested one row each):

| `shortcuts.vdf` `icon` now | `applied_icon` entry | Result |
| --- | --- | --- |
| unknown (no vdf entry) | any | not eligible |
| `""` or `*.exe` (any quotes/case) | none | eligible; `previous` = that value |
| a user's file | none | not eligible |
| our `path` (any slash/case) | ours | eligible only for another source or native app (a Steam match replaces SteamGridDB); `previous` kept |
| our `previous` | ours | our write never landed: as "none" |
| anything else | ours | the user chose: `released = true`, never eligible again (Clear forgets it) |
| any | `released` | not eligible; Clear gives no `icon_restore` |

Data flow (no new layer, no hook):

```
app/artwork.ts ── EnsureFresh(["artwork"], artUrls.icon) ──► art_service: data.iconEligible, urls.icon
      │ buildPlan: iconPlan() → record.artwork.data.icon = { url }
      ▼
surfaces/artwork (render) → icon.ts applyIcon:
      SteamStoreSaveIcon (re-checks eligibility; shortcut_icon.lua writes <data dir>/icons/<appid>.<ext>)
      → SteamClient.Apps.SetShortcutIcon(appid, path)
      → SteamStoreRecordIcon (refused if the match changed → SetShortcutIcon(appid, previous))
Clear: SteamStoreClearMapping → icon_restore → app clearSlots(…, iconRestore) → { restore } → SetShortcutIcon(appid, previous)
```

## 2. Preconditions

Run from `c:\game\millennium\steam-cartridges` in PowerShell unless noted. Every line must hold before step 1.
"With F1" means the F1 plan's steps are already committed (`Test-Path frontend/app/game-editor.ts` prints `True`).

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- .` | prints nothing (unrelated changes outside `steam-cartridges/` are allowed) |
| P2 | `git merge-base --is-ancestor cdc656d HEAD; $LASTEXITCODE` | `0` |
| P3 | `npm run check` | after the npm banner and `> tsc --noEmit`: nothing; exit 0 |
| P4 | `npm run test:ts` | ends `ℹ pass 147` and `ℹ fail 0` (with F1: `ℹ pass 164`) |
| P5 | the Lua block below | `test_art_service: 25 PASS`, `test_steam_store: 84` (with F1: 91), `test_metadata_service: 49` (with F1: 64), `test_backend: 78`, `test_freshness: 43`; each last line `ALL PASS` |
| P6 | `npm run build` | contains `build Succeeded passing all tests` (a `TS5096` warning is known and not caused by this plan) |
| P7 | `foreach ($s in 's1-backend','s2-domain','s3-app','s4-surface-and-wiring','s5-live','s6-docs') { git apply --check "..\docs\plans\steam-cartridges-icon-plan\$s.patch"; "$s $LASTEXITCODE" }` | six lines, each ending ` 0` |

The Lua block (also used after step 1):

```powershell
$env:NSGA_STEAM_ROOT = 'C:/game/steam'
foreach ($t in 'test_art_service','test_steam_store','test_metadata_service','test_backend','test_freshness') {
  $o = lua "tests/$t.lua" 2>&1
  '{0}: {1} PASS, last line: {2}' -f $t, ($o | Select-String '  PASS').Count, ($o | Select-Object -Last 1)
}
```

If P1–P7 do not hold, stop (failure rule, § 8).

## 3. Do-not-touch list

- `frontend/ports/backend.ts` `steamStoreClearMapping` (finding 11): its type stays `{ steam_appid?; slots; error? }`.
- `frontend/settings/**`, `settings/defaults.ts`, `tests/fixtures/settings-defaults.json`: no new setting.
- `frontend/surfaces/` other than `surfaces/artwork/`; `frontend/sensors/`, `frontend/safety/`, `frontend/steam/`.
- `AppOverview.prototype` and `BIsModOrShortcut` (guardrail 1): the icon goes through `SetShortcutIcon`, never a hook.
- `backend/shortcuts.lua` (it already keeps `icon`), `backend/resolve_identity.lua`, `backend/record_rpc.lua`, `backend/steam_store_search.lua`.
- `tests/test_steam_store.lua` (the F1 plan edits it); every icon test lives in `tests/test_art_service.lua`.
- `tests/architecture-allowlist.json` (it must not change; a new cross-area edge means the patch is wrong).
- Every existing check in `tests/live/` (guardrail 15); step 5 only adds a file.
- `<user>/config/grid/` and `shortcuts.vdf` from any code path except `SteamClient.Apps.SetShortcutIcon` in `surfaces/artwork/icon.ts`.

## 4. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no probe or throwaway plugins; no running
anything under `tests/live/` (it writes to the user's library now: it can set an icon); no edits to Millennium's `config.json` or
the plugin's config; no changes to the user's library, collections or shortcuts; no `npm install` / upgrade (ignore the
`@steambrew/ttc` update nag); no `git push --force`; no `--no-verify`; no editing a patch file or the files it creates "to make
it fit" (a patch that does not apply means the plan is stale: stop). No use of the Edit tool on the files the patches touch.

## 5. Steps

Each step: apply the patch, run the commands, compare with the expected output. The patch files are the literal
before/after blocks; open one to review it, do not retype it. Commit after each step.

### Step 1: backend (Lua)

```powershell
git apply --check ..\docs\plans\steam-cartridges-icon-plan\s1-backend.patch   # expected: no output
git apply ..\docs\plans\steam-cartridges-icon-plan\s1-backend.patch
git status --short -- .
```

Expected `git status`: 7 lines. `M` for `backend/art_service.lua`, `backend/main.lua`, `backend/steam_store_rpc.lua`,
`backend/steam_store_store.lua`, `backend/web_sgdb.lua`, `tests/test_art_service.lua`; `??` for `backend/shortcut_icon.lua`.

| File | Change |
| --- | --- |
| `steam_store_store.lua` | `applied_icon` table (a new key of `steam_store.json`; old files load with it empty). `get()` returns `icon`. `record_icon(appid, {path, previous, source, steam_appid})`: steam-cdn needs the same mapping (`"no mapping"`), SteamGridDB refused when mapped (`"mapped"`). `release_icon(appid)`. `clear()` returns `icon` and forgets it. |
| `art_service.lua` | `current_icon`, `same_path`, `is_exe_icon`, `icon_eligible` (the § 1 ownership table). `data.iconEligible` on both branches; SteamGridDB `fetch(id, key, icon_ok)`, still only inside a slot lookup. `has_urls` counts `icon`. `deps.shortcut_icon`. |
| `web_sgdb.lua` | `fetch_artwork_urls(game_id, key, want_icon)` adds the `icons` endpoint; `download_image_base64` (no caller) becomes `download_image` → `{ body, ext }`; unused `utils` require dropped. |
| `shortcut_icon.lua` | new: `host_kind` (Steam CDN / SteamGridDB CDN over https only), `sniff` (PNG/JPEG/ICO, ≥ 100 bytes), `save(appid, url)` → `<data dir>/icons/<appid>.<ext>`, returned with backslashes when it starts with a drive letter. |
| `steam_store_rpc.lua` | `SteamStoreClearMapping` adds `icon_restore` only while the vdf still shows ours; new `SteamStoreSaveIcon` (re-checks eligibility first, no download when refused), `SteamStoreRecordIcon`. `art_service` and `shortcut_icon` load lazily. |
| `main.lua` | registers `SteamStoreSaveIcon`, `SteamStoreRecordIcon` after `SteamStoreDownloadImage`. |
| `tests/test_art_service.lua` | 30 new checks (sections `icon`, `icon rpc`, `icon sgdb`); the credential grep also covers `shortcut_icon.lua`. |

Then run the Lua block from § 2. Expected: `test_art_service: 55 PASS`; the others unchanged from P5; every last line `ALL PASS`.
Then `npm run check` (nothing) and `npm run test:ts` (`ℹ pass 147`, with F1 `ℹ pass 164`; `ℹ fail 0`; no TypeScript changed yet).

Commit: `git add backend tests/test_art_service.lua`, then
`git commit -m "feat(steam-cartridges): icon plan backend, icon eligibility, SaveIcon, RecordIcon, Clear restore"` + attribution line.

### Step 2: kernel and domain (pure rules)

```powershell
git apply --check ..\docs\plans\steam-cartridges-icon-plan\s2-domain.patch
git apply ..\docs\plans\steam-cartridges-icon-plan\s2-domain.patch
```

Modifies (5 × `M`): `frontend/kernel/record.ts` (`ArtworkUrls.icon`, `IconPlan`, `ArtworkPlan.icon`), `frontend/domain/art-plan.ts`
(`iconPlan(urls, eligible)`: only `eligible === true` with a non-empty url; `iconRestoreOf(res)`), `frontend/domain/store-item.ts`
(`icon = GetCommunityIconURL_Full()`), `frontend/domain/steam-cdn.ts` (return type `Required<Omit<ArtworkUrls, 'icon'>>`),
`tests/art-plan.test.ts` (+3). `pickUrls` is unchanged: the icon is never a slot.

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 150` (with F1 `ℹ pass 167`) and `ℹ fail 0`.

Commit: `git add frontend/kernel/record.ts frontend/domain tests/art-plan.test.ts`,
`git commit -m "feat(steam-cartridges): icon plan kernel and domain rules"` + attribution line.

### Step 3: ports and app

```powershell
git apply --check ..\docs\plans\steam-cartridges-icon-plan\s3-app.patch
git apply ..\docs\plans\steam-cartridges-icon-plan\s3-app.patch
```

Modifies (4 × `M`): `frontend/app/artwork.ts` (`RawArtwork.iconEligible`; `buildPlan` adds `icon` on both sources only when
`iconPlan` gives one; `clearSlots(appid, slots, iconRestore?)` also writes a plan for a restore alone), `frontend/app/steam-store.ts`
(`clearSteamStore` passes `iconRestoreOf(res)`), `frontend/ports/backend.ts` (`steamStoreSaveIcon`, `steamStoreRecordIcon`, added after
`steamStoreDownloadImage`), `tests/app-artwork.test.ts` (+2).

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 152` (with F1 `ℹ pass 169`) and `ℹ fail 0`
(the architecture test also confirms `ports/backend.ts` only calls methods `main.lua` registers).

Commit: `git add frontend/app frontend/ports tests/app-artwork.test.ts`,
`git commit -m "feat(steam-cartridges): icon plan app and ports"` + attribution line.

### Step 4: surface and composition

```powershell
git apply --check ..\docs\plans\steam-cartridges-icon-plan\s4-surface-and-wiring.patch
git apply ..\docs\plans\steam-cartridges-icon-plan\s4-surface-and-wiring.patch
```

| File | Change |
| --- | --- |
| `surfaces/artwork/icon.ts` | new: `applyIcon(appid, plan, source, steamAppid?)`. Kill switch first. `restore` → `SetShortcutIcon(appid, restore)`. `url` → `deps.saveIcon`; on a path, `SetShortcutIcon(appid, path)`, then `deps.recordIcon`; its `{ error }` → `SetShortcutIcon(appid, previous)`. No `SetShortcutIcon` in this Steam → nothing recorded. Runtime imports carry `.ts` (node tests). |
| `surfaces/artwork/deps.ts` | `RecordIconInfo`; `saveIcon`, `recordIcon` with inert defaults. |
| `surfaces/artwork/index.ts` | `touches` + `SteamClient.Apps.SetShortcutIcon`; `execute` runs `applyIcon` last, after slots and logo; `createArtworkSurface` takes `saveIcon`, `recordIcon`. |
| `index.tsx` | passes `saveIcon`/`recordIcon` (the two new ports) to `createArtworkSurface`. |
| `tests/artwork-icon.test.ts` | new, 6 tests: write, restore, kill switch, backend refusal, undo, missing API. |

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 158` (with F1 `ℹ pass 175`) and `ℹ fail 0` (the touches
test proves no other surface lists `SetShortcutIcon`; the import-ratchet test passes without touching the allowlist);
`npm run build` contains `build Succeeded passing all tests`.

Commit: `git add frontend/surfaces/artwork frontend/index.tsx tests/artwork-icon.test.ts`,
`git commit -m "feat(steam-cartridges): icon plan artwork surface writes the library icon"` + attribution line.

### Step 5: live probe (file only; the implementer does not run it)

```powershell
git apply --check ..\docs\plans\steam-cartridges-icon-plan\s5-live.patch
git apply ..\docs\plans\steam-cartridges-icon-plan\s5-live.patch
node --check tests/live/probes/shortcut_icon.mjs
```

`node --check` prints nothing. Adds `tests/live/probes/shortcut_icon.mjs <appid> [sharp|exe]`: `sharp` opens the page, waits 8 s and
passes when `icon_data` is not a BMP and at least 128 px each side; `exe` reads only and passes on the exe's BMP. It is not added to
`run.mjs` (the F1 plan edits that file).

Commit: `git add tests/live/probes/shortcut_icon.mjs`,
`git commit -m "test(steam-cartridges): icon plan live probe"` + attribution line.

### Step 6: docs (from the parent repo root, `c:\game\millennium`)

```powershell
git apply --check docs/plans/steam-cartridges-icon-plan/s6-docs.patch
git apply docs/plans/steam-cartridges-icon-plan/s6-docs.patch
git status --short -- docs/steam-cartridges
```

Expected: 4 lines `M` (`kernel.md`, `rpc.md`, `service-artwork.md`, `surfaces.md`). The patch avoids the lines the F1 plan's
step 6 edits in `rpc.md` (the `SaveGameMetadata` row, the rows after `SteamStoreClearMapping`, the `**Result:**` paragraph).

Then, with the Edit tool (both files are LF):

1. [CHANGELOG.md](../../CHANGELOG.md): insert this bullet as the first entry (right above the first line that starts with `- **`),
   followed by a blank line (one line in the file):

   ```markdown
   - **steam-cartridges: shortcut library icon (icon plan; code done, live verification pending, 2026-09-29)**: a shortcut Steam draws with its exe's 32 px BMP gets the mapped native app's 184 px community icon (`GetCommunityIconURL_Full`), or SteamGridDB's icon inside a slot lookup; written with `SteamClient.Apps.SetShortcutIcon` by the `artwork` surface from our own copy in `<data dir>/icons/`; `steam_store.json` `applied_icon`; Unlink puts the old icon back; an icon the user chose is never touched. New RPCs `SteamStoreSaveIcon`, `SteamStoreRecordIcon`; `web_sgdb.download_image_base64` (no caller) became `download_image`. Tests: TS 158 (175 with F1), `test_art_service` 55. [Plan](docs/plans/steam-cartridges-icon-plan.md).
   ```
2. [TASK.md](../../TASK.md): replace the line that starts with `**Shortcut library icon (planned 2026-09-29).**` and the lines of
   that paragraph with: `**Shortcut library icon: code committed (2026-09-29)**, waiting for the live verification in [the plan § 7](docs/plans/steam-cartridges-icon-plan.md#7-live-verification-the-user-or-a-verifier-the-user-names).`

Commit: `git add docs/steam-cartridges CHANGELOG.md TASK.md`, `git commit -m "docs: icon plan (shortcut library icon)"` + attribution line.
Do not push (Routine 5 pushes at the end of the session, after the user has run § 7).

## 6. Guardrail checklist

Re-read each guardrail in [plugins.md](../plugins.md) and tick it with the one-line proof. `BASE` is the commit before step 1.

- [ ] **1 (BIsModOrShortcut / shortcut icons):** the icon goes through Steam's own `SetShortcutIcon`; nothing hooks `AppOverview.prototype`. Proof: `git diff BASE -- frontend | Select-String "BIsModOrShortcut|prototype"` prints nothing.
- [ ] **2 (no expensive work in hot hooks):** no hook added. Proof: `git diff BASE --stat -- frontend/steam frontend/surfaces/game-info frontend/surfaces/playbar frontend/sensors` prints nothing.
- [ ] **5 (negative cache):** the icon never adds a SteamGridDB request and a miss is cached as before. Proof: `test_art_service` checks "steamgriddb: an eligible icon alone never makes a request" and "search miss is negative-cached" pass.
- [ ] **14 (a new gate never removes working behaviour):** slot writes are unchanged. Proof: the 25 checks `test_art_service` had before still pass, and `tests/app-artwork.test.ts`'s old 8 tests pass unedited (`git diff BASE -- tests/app-artwork.test.ts` shows only added lines).
- [ ] **15 (never weaken a check):** Proof: `git diff BASE --stat -- tests/live` lists only `tests/live/probes/shortcut_icon.mjs`, and `git diff BASE -- tests/*.test.ts tests/*.lua | Select-String "^-[^-]"` shows exactly two lines, both widened rather than weakened: the `art-plan.ts` import of `tests/art-plan.test.ts` (two names added) and the credential-grep file list of `test_art_service.lua` (`shortcut_icon.lua` added).
- [ ] **17 (a render never starts work):** the icon is written only by executing a `record.artwork` plan, which `app/artwork.ts` resolves once per shortcut per session; once written it is not eligible again. Proof: "one backend call per shortcut per session" (`app-artwork.test.ts`) and "ours still in the vdf …: not offered again" (`test_art_service`) pass.
- [ ] **Disjoint touches:** Proof: `git grep -n "SetShortcutIcon(" -- frontend` prints one line, `frontend/surfaces/artwork/icon.ts` (the only call); `git grep -n '"SteamClient.Apps.SetShortcutIcon"' -- frontend` prints one line, `frontend/surfaces/artwork/index.ts` (`touches`); the architecture touches test passes (a duplicate aborts start-up, see knowledgebase).
- [ ] **ADR-0039 (only surfaces write to Steam):** the backend writes only `<data dir>/icons/`. Proof: `git grep -n "io.open" -- backend/shortcut_icon.lua` shows the one write, into `icons_dir()`; `git status --short -- tests/architecture-allowlist.json` prints nothing.

## 7. Live verification (the user, or a verifier the user names)

The implementer stops after step 6. After `powershell -ExecutionPolicy Bypass -File dev.ps1` (deploy and restart Steam), from
`steam-cartridges`:

1. `node tests/live/probes/shortcut_icon.mjs 3135033888`: prints `PASS icon sharp: WUCHANG: Fallen Feathers shows a 184x184 jpg`.
   Before this plan the same command printed `FAIL icon sharp: WUCHANG: Fallen Feathers (bmp 32x32)` (captured 2026-09-29).
2. `node tests/live/probes/shortcut_icon.mjs 2315502503`: `PASS icon sharp: Jotunnslayer: Hordes of Hel shows a 184x184 jpg`.
3. The library sidebar and grid show both icons sharp, desktop and Big Picture. `C:\game\steam\millennium\config\steam-cartridges\icons\`
   holds `3135033888.jpg` and `2315502503.jpg` (15 KB-ish each). Nothing new in `C:\game\steam\userdata\83513586\config\grid\`.
4. Ownership: `node -e "const j=require('C:/game/steam/millennium/config/steam-cartridges/steam_store.json');console.log(JSON.stringify(j.applied_icon))"`
   shows `3135033888` (previous = the WUCHANG exe path) and `2315502503` (previous = `""`). Any other key must have a `previous` that is `""` or
   ends in `.exe`; else FAIL. Spot-check two emulator shortcuts in the sidebar (e.g. Super Metroid, AM2R): unchanged.
5. Routines 1 and 2 of AGENTS.md on WUCHANG (the overview was replaced by `SetShortcutIcon`, finding 9): `node tests/live/check_all_tabs.js`
   all PASS, `node tests/live/test_nav_cycle.js` `hasEvent: true`, `npm run test:live` every line `PASS` (or the known parity `SKIP` in
   Big Picture), including `PASS render loop:`.
6. Restore (this clears WUCHANG's four art slots too, and step 7 brings them back):
   `node tests/live/probes/eval_js.mjs "PLUGIN_LIST['steam-cartridges-dev'].clearSteamStore(3135033888, true).then(r => JSON.stringify(r))"`
   (`true` = reject, so identity does not re-match it at once), wait 3 s, then `node tests/live/probes/shortcut_icon.mjs 3135033888 exe`:
   `PASS icon exe: WUCHANG: Fallen Feathers shows a 32x32 bmp`; the `shortcuts.vdf` `icon` field is the exe path again.
7. Re-link: `node tests/live/probes/eval_js.mjs "PLUGIN_LIST['steam-cartridges-dev'].setSteamStoreMapping(3135033888, 2277560, 'WUCHANG: Fallen Feathers').then(r => JSON.stringify(r))"`
   (a manual link removes the rejection), then `node tests/live/probes/shortcut_icon.mjs 3135033888`: `PASS icon sharp …` again.
8. User wins (optional, changes an icon by hand): Properties of Jotunnslayer → click the icon → pick any PNG. Restart Steam, open the
   game: the chosen icon stays, and `applied_icon["2315502503"].released` is `true` (the command of item 4). Put the icon back by hand
   if wanted (Properties → pick the game's exe).

Only after 1–7 pass: add the live results to the CHANGELOG entry and replace "live verification pending" with "live-verified".

## 8. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines) and the step
number to [TASK.md](../../TASK.md) § Active Failures & Blockers, then exit. Do not retry, edit a patch, edit around the failure or skip ahead.
A `git apply --check` that fails is a failure of that step (the plan is stale), not something to work around.

## 9. Dry-run record (2026-09-29)

The code was written and run in a scratch worktree of `cdc656d`; the patches are `git diff` of it (new files via `git add -N`).

- **Alone, on a fresh worktree of `cdc656d`:** each patch applied in order with `git apply --check` then `git apply`, and after each:
  `tsc --noEmit` exit 0; `test:ts` 147 → 150 → 152 → 158 → 158, fail 0; Lua `test_art_service` 55 from step 1, `test_backend` 78,
  `test_steam_store` 84, `test_metadata_service` 49, `test_freshness` 43, `test_identity` 18, `test_ach_service` 19, `test_migrate` 7,
  all `ALL PASS`; `npm run build` `build Succeeded passing all tests` (plus the known `TS5096`). 22 files changed.
- **Icon plan, then F1's five patches:** all apply; `test:ts` 158 → 175, fail 0; build succeeds.
- **F1's five patches, then the icon plan (on `987ae8c`):** all apply; `test:ts` 164 → 164 → 167 → 169 → 175 → 175, fail 0; Lua
  `test_steam_store` 91, `test_metadata_service` 64, `test_art_service` 55, all `ALL PASS`; build succeeds.
- `s6-docs.patch` was written after the others and checked with `git apply --check` against the working tree (exit 0), like all six (P7).
- **Live, read-only, before any code change:** `shortcut_icon.mjs 3135033888` printed `FAIL icon sharp: WUCHANG: Fallen Feathers (bmp 32x32)`;
  `shortcut_icon.mjs 3135033888 exe` and `… 2315502503 exe` printed `PASS icon exe … 32x32 bmp`. So the probe tells the two states apart.
- **Not dry-run** (needs the deployed plugin): the surface calling `SetShortcutIcon` in Steam, and § 7. The Steam call itself was
  exercised by hand (findings 2 and 3, reverted byte-identically).

## 10. Not in this plan (follow-ups)

- SteamGridDB icon for an unmatched shortcut whose four slots are already set (an icon-only lookup: one more request per game, finding 8).
- Deleting `<data dir>/icons/<appid>.*` on Clear (kept: a few KB each, and overwritten by the next write).
- A per-game "keep the exe icon" switch: today the opt-out is to pick any icon in Properties (the user-wins rule) or the `artwork` kill switch.
- Adding the probe to `tests/live/run.mjs` once the F1 plan's edit of that file has landed.
