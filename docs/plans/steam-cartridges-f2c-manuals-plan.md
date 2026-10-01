# Plan: F2c ScreenScraper manuals as the first card of the Community section

**Status:** Executed (phases 0-5 committed); live verification (§ 11) pending.

Written 2026-09-30 as a skeleton, made executable 2026-10-01. Every before/after block, command and expected output
below was applied and run in order on a scratch copy of `steam-cartridges` at workspace commit `a283037`, and the open
questions were answered on the live client (§ 2, § 12). Follows [the plan writing standard](README.md).
**Parent:** F2 plan § 12 (removed once done: `git show 585cc5c:docs/plans/steam-cartridges-f2-community-media-plan.md`),
[ADR-0046](../decisions.md). **Writes:** ADR-0048 (step 5.1). **Layer rules:**
[steam-cartridges.md § 4](../steam-cartridges.md#4-adding-a-feature), ADR-0039, ADR-0041, ADR-0044.

**Who does what.** The implementer runs § 4 to § 9 (phases 0 to 5), commits after each phase and pushes at the end. The
implementer does **not** deploy, restart Steam or run § 11; that is the user's (or a verifier's, with the user's go-ahead).

**Decisions by the user (2026-09-30), binding:**
1. The manual card is **one ordinary cell**, not a full-width row (roughly one card of five across in Big Picture), and it
   is the **first** card of the grid (top left).
2. Render with **pdf.js**; adding the dependency is approved. This plan fixes the version and the commands (§ 3.4, step 2.1).
3. Test game: **Captain Commando (SNES)**, shortcut appid `3858120657` (found by name in `appStore.allApps`, 2026-10-01).

---

## 1. What the user wants

A game's ScreenScraper manual (a PDF) shows as the first card of the Community section (Big Picture COMMUNITY tab, desktop
section), at the size of an ordinary card. Opening it shows the pages, scrolled with the controller's D-pad or the mouse
wheel. Same rules as the rest of F2: Steam's own cards and viewer, nothing written to disk, the ScreenScraper URL (it
carries the accounts) never leaves the backend, a failure drops the manual and nothing else (ADR-0014).

## 2. Findings (root cause and evidence)

### 2.1 The test game never matches ScreenScraper: wrong system id (a bug in F2 / M5d, fixed by phase 0)

Probe, 2026-10-01, SharedJSContext, existing RPC `GetMediaImage` on `steam-cartridges-dev`, appid `3858120657`: every key
(`manuel(us|eu|wor|jp|fr)`, `manuel()`, and even `ss(us)`, `ss(wor)`) answered `not-found`, about 1.6 to 2.2 s each (a real
ScreenScraper request each time). `media_service.image` turns *any* failed game lookup into `not-found`, so the reason was
hidden (step 0.2 fixes that).

Cause, `backend/screenscraper_media.lua` `jeu_for` (before phase 0): `console_id` comes from
`retroachievements.detect_console_id` and is passed unchanged as ScreenScraper's `systemeid`. Those are
**RetroAchievements** console ids; ScreenScraper numbers its systems differently:

| Console | RetroAchievements id (`detect_console_id`) | ScreenScraper `systemeid` |
| --- | --- | --- |
| Sega Genesis / Mega Drive | 1 | 1 |
| Nintendo 64 | 2 | 14 |
| **SNES** | **3** | **4** (ScreenScraper's 3 is the **NES**) |
| Game Boy Advance | 5 | 12 |
| NES | 7 | 3 |
| PlayStation | 12 | 57 |
| GameCube | 16 | 13 |
| Arcade | 27 | 75 (MAME) |
| PSP | 41 | 61 |

Captain Commando's shortcut runs `snes9x_libretro.dll` on `C:\emu\roms\snes\Captain Commando (USA).zip`, so it was looked up
as an NES game. A ROM lookup that fails also never tried the title (the title search ran only when there was no ROM file).
Its record has `metadata` from `local_db` and **no `media` part** (`GetAllRecords`, 2026-10-01), so nothing cached hides the
fix. Phase 0 maps the ids (`SS_SYSTEM`) and falls back to the title search on that system. Ruled out: a missing manual
(the screenshots failed too), credentials (AM2R matches by name with the same account), the circuit breaker (no pause in
`GetDiagnostics`).

The ScreenScraper ids in the table are from ScreenScraper's system list as known to the author; the unit test pins the
mapping, and § 11 check 2 is the live proof for the SNES. If § 11 check 2 fails, the SNES id is the first suspect.

### 2.2 The manual's media type

The plan uses ScreenScraper's media type `manuel` with the same `type(region)` keys as F2 (`manuel(us)`), the best region
first. It cannot be confirmed before phase 0 is live (2.1). § 11 check 3 confirms it; its failure branch says what to do.

### 2.3 pdf.js in Steam's client (verified live, 2026-10-01)

Steam's CEF is **Chromium 126.0.6478.183** (`/json/version`). In SharedJSContext (`https://steamloopback.host`, no CSP meta,
`devicePixelRatio` 2): a **module worker from a `blob:` URL** works and can use `OffscreenCanvas` + `convertToBlob('image/jpeg')`;
`OffscreenCanvas` works on the main thread; `navigator.mimeTypes['application/pdf']` exists (only relevant to the rejected
option B).

Each candidate's `build/pdf.min.mjs` was loaded with `import(blobUrl)`, its `build/pdf.worker.min.mjs` given as
`GlobalWorkerOptions.workerPort = new Worker(blobUrl, { type: "module" })`, and a hand-made two-page PDF rendered:

| pdfjs-dist | Result |
| --- | --- |
| **4.10.38** | **2 pages, page 2 rendered at 800 px in 136 ms, correct pixels; chosen and pinned** |
| 5.4.624 | hangs in `getDocument` (never resolves) |
| 6.3.289 (latest) | hangs in `getDocument` |

Fonts: with `disableFontFace: true` text in a non-embedded font is **not drawn** (0 dark pixels); with the default (`false`)
it is (4249 dark pixels), and pdf.js adds one `FontFace` to `document.fonts` (14 → 15) which `destroy()` removes again
(back to 14). So the default is kept and every document is destroyed after its pages are rendered.

Two stuck workers from the 5.x and 6.x attempts stay in SharedJSContext until the next Steam restart (harmless).

### 2.4 Bundling (verified on the scratch build)

`millennium-ttc` bundles the frontend as one IIFE (rollup). pdf.js is not imported as a module: `ports/pdf.ts` embeds both
files as text with `constSysfsExpr` (from `@steambrew/client`, resolved at build time) and evaluates them from `blob:` URLs on
the first manual, so Steam's start-up only parses two string literals. Rollup leaves `import(<variable>)` untouched (checked
in the built `index.js`). No local path ends up in the bundle (the embedded `filePath` is dropped by the minifier; 0
occurrences of the user name).

**Trap found:** `constSysfsExpr("../../node_modules/pdfjs-dist/build/pdf.min.mjs", ...)` embeds **nothing** (ttc resolves the
relative part twice and falls into its pattern mode: `Embedded 0 file(s)`) and the build still prints `Succeeded`. The
working form is `constSysfsExpr("pdf.min.mjs", { basePath: "../../node_modules/pdfjs-dist/build", encoding: "utf8" })`,
which prints `Embedded 1 specific file`. Step 4.7 checks for that line.

`node_modules` is managed by **pnpm** (`node_modules/.pnpm`, `.modules.yaml`; pnpm 11.28.2), while `package-lock.json` is
also kept in sync. So step 2.1 uses `pnpm add` (updates `node_modules`, `package.json`, `pnpm-lock.yaml`) and then
`npm install --package-lock-only --ignore-scripts` (updates `package-lock.json` only). Both were run on the scratch copy:
they only **add** lines (pdfjs-dist and the Node-only optional `@napi-rs/canvas` packages); nothing else changes. Never run
plain `npm install`: it would rebuild the pnpm `node_modules`.

### 2.5 What the skeleton had wrong, and why the design below differs

| Skeleton | Problem | This plan |
| --- | --- | --- |
| The surface's page component calls `app/manuals.open` from an effect | ADR-0044 / README "what a surface may be given": never a function that reaches the backend; the architecture test checks the `createCommunitySurface` block | The surface emits its **own result event** `community.manual-opened` (as `artwork.applied`); `app/manuals.install()` subscribes (as `app/artwork`) |
| `ports/pdf.ts` gets a capability-allowlist exception "as for `ports/image.ts` and `URL.createObjectURL`" | No such exception exists, and none is needed: no capability rule forbids `URL`, `Worker` or `OffscreenCanvas` in `ports/` | No allowlist file changes (the dry run passes the architecture test untouched) |
| Lazy page rendering with an `IntersectionObserver` per page | Watching the scroll is detection inside a surface, and more moving parts for no gain at manual sizes | All pages are rendered in reading order in the background; sized placeholders keep the scroll height right |
| `GetMediaPdf` returns the whole PDF as one base64 string | 30 MB of PDF is a 40 MB string through `callServerMethod`, never measured | `GetManualChunk`: 1 MiB per answer, the size of answers F2 already sends |
| A page cache in `kernel/media-bin` | Pages need a status (loading, ready, failed) and change notifications | `kernel/manual-shelf.ts`, a pure container like `media-bin` plus listeners |
| Q6: prefer Steam's UI language | ScreenScraper keys manuals by region; the language is not in the key | Region rank as for images (wor, us, eu, ss, jp); a language choice is out of scope |
| Q3: try three cover sizes live | One size is already known to lay out as an ordinary cell | 1280 x 720, the size of IGDB screenshot cards (F2, live) |
| `app/media` untouched | It sends every ScreenScraper item to `GetMediaImage`, so the manual would be downloaded as an "image", rejected and **dropped** | Step 3.5: `app/media` passes the manual item through untouched |
| ADR-0047 | Taken by enhanced-notifications | ADR-0048 |

## 3. Design

### 3.1 Data flow

```
EnsureFresh(["media"])  ── media_service.ensure ── screenscraper_media.manual_item ──► record.media.items[…, { kind: "manual", key: "manuel(us)" }]
                                                                                         │
domain/community-media.visibleMedia (manual first, toggle communityShowManuals)  ◄──────┘
app/media (passes the manual through) ──► record ──► surfaces/community render: toFeedItems → Artwork card, cover = manualCoverUrl(appid, key)
                                                                         │ user opens the card: Steam's viewer, artworkURL = cover URL
surfaces/community viewer branch: children = <ManualPages appid manualKey>  ── useEffect ──► bus.emit("community.manual-opened")
                                                                                                   │
app/manuals (install(): bus.on) ── ports/backend.getManualChunk(0..n) ── GetManualChunk ── media_service.manual_chunk (download once, 1 MiB chunks)
            └── ports/pdf.pdfRenderer.open(chunks) → renderPage(n, 1400) → blob: URL ──► kernel/manual-shelf.set(...)
                                                                                                   │ subscribe
ManualPages re-renders: placeholders → pages, Steam's viewer scrolls them (D-pad, wheel) ◄────────┘
```

### 3.2 Where each piece lives (ADR-0039 / ADR-0044)

| Layer | File | Change |
| --- | --- | --- |
| backend source | `backend/screenscraper_media.lua` | `SS_SYSTEM`, `jeu_for` fallback (phase 0); `manual_item`, `download_document` |
| backend service | `backend/media_service.lua` | manual item in `ensure`; `manual_chunk` (one document in memory); `image` reports the real lookup error |
| backend RPC | `backend/record_rpc.lua`, `backend/main.lua` | `GetManualChunk` |
| kernel | `frontend/kernel/record.ts`, `events.ts`, **`manual-shelf.ts`** | `kind: "manual"`; `community.manual-opened`; the shelf |
| domain | `frontend/domain/community-media.ts` | manual first, `toggles.manuals` |
| app | `frontend/app/media.ts`, **`app/manuals.ts`** | pass the manual through; the use case |
| ports | `frontend/ports/backend.ts`, **`ports/pdf.ts`** | `getManualChunk`; the only pdf.js user |
| surface | `frontend/surfaces/community/core.ts`, **`manual.ts`**, `index.ts` | cover card; page column; viewer branch, new deps |
| composition root | `frontend/index.tsx` | shelf, `createManuals`, surface deps, `manuals.install()`, the toggle value |
| settings | `frontend/settings/panels/community.tsx` | "Game Manuals" row (`communityShowManuals`, default true already) |

No new Steam target (`touches` unchanged), no new `keepJsxPatched` site, no new kill switch (the `community` switch covers
it: off, the viewer wrapper is not applied), no allowlist entry.

### 3.3 Fixed numbers

| Constant | Value | Where | Why |
| --- | --- | --- | --- |
| Cover size | 1280 x 720 | `screenscraper_media.MANUAL_COVER` | an ordinary cell, as IGDB screenshots |
| Download cap | 48 MiB | `screenscraper_media.MAX_MANUAL_BYTES` | held in memory by the WinINet reader |
| Chunk | 1 MiB | `media_service.MANUAL_CHUNK_BYTES` | per-answer size like F2's images |
| Chunks read at most | 48 | `app/manuals.MAX_MANUAL_CHUNKS` | the same cap, checked on the frontend |
| Pages rendered at most | 200 | `app/manuals.MAX_MANUAL_PAGES` | bounds memory |
| Page width | 1400 px, JPEG 0.85 | `app/manuals.PAGE_WIDTH`, `ports/pdf` | Big Picture viewer width x DPR 2 |
| Manuals kept | 2 | `kernel/manual-shelf.MAX_MANUALS` | page URLs released on eviction |

### 3.4 Rejected options

Chromium's PDF viewer in an `<embed>` (the embed takes the D-pad: no controller scrolling); opening the PDF outside Steam
(the URL carries the account, a temp file breaks the no-disk rule); a Guide card (opens a Valve page); downloading the PDF
with the media part (ScreenScraper quota and memory on every page view); pdf.js's legacy build (larger, not needed on
Chromium 126); pdf.js 5.x / 6.x (hang, § 2.3).

## 4. Preconditions

Run inside `steam-cartridges/` unless stated. Every line must hold before step 0.1; if one does not, stop (§ 7).

```bash
git -C .. status --short
npm run check
npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail) "
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
pnpm --version
node -e "require.resolve('pdfjs-dist/package.json')"
```

Expected, in order:

1. `git -C .. status --short` prints nothing (clean workspace).
2. `npm run check` prints only `> steam-cartridges@0.1.0 check` and `> tsc --noEmit`, exit 0.
3. `ℹ tests 240`, `ℹ pass 240`, `ℹ fail 0`.
4. `ALL PASS`, then `64`.
5. `11.` followed by digits (pnpm 11).
6. An error containing `Cannot find module 'pdfjs-dist/package.json'` (not installed yet).

Do not use `npm test` or `npm run test:lua` as a check: `tests/test_backend.lua` already has 3 failures that track the live
library (`non-steam games with media -> 7`, `library_stats covers every media game -> 7`, `counted appid has screenshots
(3135033888)`); this plan does not touch them.

If a "find this block" text in a step is not in the file exactly once, the plan is stale: stop (§ 7), do not adapt it.

## 5. Do-not-touch list

- `tests/architecture*.json` (all three allowlists): the design needs no entry. Never run `ARCH_WRITE_ALLOWLIST` or
  `ARCH_WRITE_CAPABILITIES`.
- `tests/architecture.test.ts`, `frontend/steam/**`, every other surface, every `touches` array.
- `backend/bin_http.lua`, `backend/net.lua` (the per-call `max_bytes` already exists), `backend/retroachievements.lua`
  (its console ids stay RetroAchievements ids; only `screenscraper_media` maps them).
- `frontend/settings/defaults.ts` and `tests/fixtures/settings-defaults.json` (`communityShowManuals` already defaults to true).
- `frontend/ports/image.ts`, `frontend/kernel/media-bin.ts`.
- `dev.ps1`, `plugin.json`, `tsconfig.json`, `.millennium/` (build output, git-ignored).
- Any file not named in a step.

## 6. Banned actions

- No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`), no SharedJSContext reload, no CDP calls, no probe or
  throwaway plugin.
- No edits to Millennium's `config.json`, the plugin config or `.env`; never read or print the ScreenScraper or Twitch
  credentials.
- No change to the user's library, collections or shortcuts.
- No dependency other than `pdfjs-dist@4.10.38` (the update nag for 6.3.289 and `@steambrew/ttc` 3.x: ignore both); no plain
  `npm install`, no `npm update`, no `pnpm update`.
- No PDF or page image written to disk; no manual opened in a browser.
- No `git push --force`, no `--no-verify`, no `git add -A` / `git add .`.
- No AI attribution in any commit (AGENTS.md Routine 6).

## 7. Failure rule

Run a failing command at most twice. On the second failure, stop. Append the command, its output (trimmed to 30 lines) and
the step number to `TASK.md` § Active failures & blockers (replace its `None.` line), commit only `TASK.md` with the message
`docs: TASK records an F2c step failure`, and exit. Do not retry, edit around the failure or skip ahead. A block that is not
found exactly once counts as a failure of its step.

## 8. Guardrail checklist (tick each with one line of proof after phase 4)

| Guardrail | Proof to write |
| --- | --- |
| 1 Prototype hook coupling / ids | the manual card's file id comes from `feedId(appid, index)` (9e14 range); no account id added |
| 2 O(1) in hot paths | the jsx `replaceType` gains one property read (`meta.manual`); `manualOfUrl` runs in `render`, not per element |
| 3 One webpack scan | no `findModule` added (the architecture test `webpack` rule passed) |
| 8 Never write `appData.details` | no `details` write (the `details` rule passed) |
| 11 / 12 Every window | `ManualPages` renders in whichever window shows the viewer; nothing is installed per window |
| 14 No gate removes working behaviour | phase 0 adds a fallback; an item that showed before still shows (`test_media_service` and `test:ts` unchanged until the new tests) |
| 15 No check weakened | no test or allowlist edited except the additions in steps 0.3, 1.4, 3.9, 4.6 |
| 17 A render never starts work | `community.manual-opened` is emitted from `useEffect`; the work runs in the bus handler |
| ADR-0014 | every failure ends as `{ status: "failed" }` on the shelf (app-manuals tests) |
| ADR-0041 | no new `keepJsxPatched` call (its architecture test passed) |
| ADR-0044 | `createCommunitySurface` gets reads and `bus` only (surface-injection test passed) |
| F2 rules | no URL in any answer (`res.url == nil` checks), nothing on disk |

## 9. Ordered steps

Every command runs inside `steam-cartridges/` (phases 0 to 4) or the workspace root (phase 5). Apply each block exactly;
keep the file's indentation and line endings.

### Phase 0 — fix the ScreenScraper system ids (prerequisite: without it the test game never matches)

#### Step 0.1 — Map RetroAchievements console ids to ScreenScraper system ids, and fall back to the title when a ROM is not found

In `steam-cartridges/backend/screenscraper_media.lua`, find this block (it occurs exactly once):

```lua
--- The `jeu` for a shortcut: the ROM file name, console and MD5 read from its shortcuts.vdf entry (the
--- RetroAchievements readers), else the title. Returns what fetch_jeu returns.
---@param appid number
---@param title string|nil
---@param info table|nil  the registry.shortcut entry
function M.jeu_for(appid, title, info)
  local ra = require("retroachievements")
  local rom_path = info and ra.extract_rom_path(info.exe, info.launch_options) or nil
  local md5 = rom_path and ra.compute_rom_md5(rom_path) or nil
  local console_id = info and ra.detect_console_id(info.exe, info.launch_options) or nil
  local by_name = not rom_path and type(title) == "string" and title ~= ""
  -- No ROM and no console (a PC game, a fan game): jeuInfos has nothing to match on, so look the game up by name.
  if by_name and not console_id then return M.search_jeu(appid, title, nil) end
  local jeu, err = M.fetch_jeu(appid, rom_path, console_id, nil, md5, title)
  -- A console but no ROM file: the title may not be a ROM name; look it up by name on that console.
  if not jeu and by_name and err ~= "no-credentials" then return M.search_jeu(appid, title, console_id) end
  return jeu, err
end
```

Replace it with:

```lua
--- ScreenScraper's `systemeid` for a RetroAchievements console id (retroachievements.detect_console_id). The two
--- numberings differ: RetroAchievements' 3 is the SNES, ScreenScraper's 3 is the NES (features plan F2c, phase 0).
M.SS_SYSTEM = {
  [1] = 1,    -- Sega Genesis / Mega Drive
  [2] = 14,   -- Nintendo 64
  [3] = 4,    -- SNES
  [5] = 12,   -- Game Boy Advance
  [7] = 3,    -- NES
  [12] = 57,  -- PlayStation
  [16] = 13,  -- GameCube
  [27] = 75,  -- Arcade (MAME)
  [41] = 61,  -- PSP
}

--- The `jeu` for a shortcut: the ROM file name, console and MD5 read from its shortcuts.vdf entry (the
--- RetroAchievements readers), else the title. Returns what fetch_jeu returns.
---@param appid number
---@param title string|nil
---@param info table|nil  the registry.shortcut entry
function M.jeu_for(appid, title, info)
  local ra = require("retroachievements")
  local rom_path = info and ra.extract_rom_path(info.exe, info.launch_options) or nil
  local md5 = rom_path and ra.compute_rom_md5(rom_path) or nil
  local console_id = info and ra.detect_console_id(info.exe, info.launch_options) or nil
  local system_id = console_id and M.SS_SYSTEM[console_id] or nil
  local has_title = type(title) == "string" and title ~= ""
  -- No ROM and no console (a PC game, a fan game): jeuInfos has nothing to match on, so look the game up by name.
  if not rom_path and has_title and not system_id then return M.search_jeu(appid, title, nil) end
  local jeu, err = M.fetch_jeu(appid, rom_path, system_id, nil, md5, title)
  -- No ROM match (a ROM name or dump ScreenScraper does not know), or no ROM file: look the title up on that console.
  if not jeu and has_title and err ~= "no-credentials" then return M.search_jeu(appid, title, system_id) end
  return jeu, err
end
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
```

Expected output (exit code 0):

```
ALL PASS
64
```

#### Step 0.2 — GetMediaImage reports why the game record was not found (request-failed, no-credentials, not-found)

In `steam-cartridges/backend/media_service.lua`, find this block (it occurs exactly once):

```lua
  local ok, jeu = pcall(ss_jeu, appid, title or "", shortcut_info(appid))
  if not ok or type(jeu) ~= "table" then return nil, "not-found" end
  local url = media.media_url(jeu, key)
  if not url then return nil, "unknown key" end
  local body, ext, width, height
```

Replace it with:

```lua
  local ok, jeu, err = pcall(ss_jeu, appid, title or "", shortcut_info(appid))
  if not ok or type(jeu) ~= "table" then return nil, ok and tostring(err or "not-found") or "not-found" end
  local url = media.media_url(jeu, key)
  if not url then return nil, "unknown key" end
  local body, ext, width, height
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
```

Expected output (exit code 0):

```
ALL PASS
64
```

#### Step 0.3 — Tests for the system ids and the fallback

In `steam-cartridges/tests/test_media_service.lua`, insert this block on new lines directly **above** the line that starts `print("\n" .. (failures == 0` (the second-to-last line of the file; leave that line and `os.exit(...)` after it unchanged):

```lua
-- ---------- ScreenScraper system ids (features plan F2c, phase 0) ----------
print("system ids")
local real_fetch, real_search = ss.fetch_jeu, ss.search_jeu
local asked = {}
ss.fetch_jeu = function(_, _, system_id) asked[#asked + 1] = { "fetch", system_id }; return nil, "request-failed" end
ss.search_jeu = function(_, _, system_id) asked[#asked + 1] = { "search", system_id }; return { id = "9" } end
package.loaded["retroachievements"] = {
  extract_rom_path = function() return "C:/roms/snes/Captain Commando (USA).zip" end,
  compute_rom_md5 = function() return "md5" end,
  detect_console_id = function() return 3 end, -- RetroAchievements' SNES
}
local found = ss.jeu_for(SC, "Captain Commando", { exe = "retroarch.exe", launch_options = "" })
check("an SNES ROM asks ScreenScraper for system 4 (its SNES), not 3 (its NES)", asked[1] and asked[1][2] == 4, asked[1] and asked[1][2])
check("a ROM ScreenScraper does not know falls back to the title on that system",
  asked[2] and asked[2][1] == "search" and asked[2][2] == 4 and found and found.id == "9")
check("the console ids map to ScreenScraper's", ss.SS_SYSTEM[1] == 1 and ss.SS_SYSTEM[3] == 4 and ss.SS_SYSTEM[7] == 3 and ss.SS_SYSTEM[12] == 57)
ss.fetch_jeu, ss.search_jeu = real_fetch, real_search
package.loaded["retroachievements"] = nil
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "; npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail) "
```

Expected output (exit code 0):

```
ALL PASS
67
ℹ tests 240
ℹ pass 240
ℹ fail 0
```

#### Commit phase 0

Run `git status --short` inside `steam-cartridges/`: it must list exactly these paths (`M` or `??`) and nothing else; if anything else is listed, stop (failure rule).

```bash
git add backend/screenscraper_media.lua \
  backend/media_service.lua \
  tests/test_media_service.lua
git commit -m "fix(steam-cartridges): ScreenScraper lookups send its own system ids; an unknown ROM falls back to the title"
```

The message has no `Co-Authored-By` or "Generated with" line (AGENTS.md Routine 6). Expected: `git status --short` prints nothing afterwards.

### Phase 1 — backend: the manual item and the chunked PDF read

#### Step 1.1 — The manual item and the PDF download (screenscraper_media)

In `steam-cartridges/backend/screenscraper_media.lua`, find this block (it occurs exactly once):

```lua
--- The URL of the media item `key` in `jeu`, or nil. Stays in the backend (it carries the accounts).
```

Replace it with:

```lua
-- ---------- Manuals (features plan F2c) ----------

--- ScreenScraper's media type for a game manual (a PDF), one per region.
M.MANUAL_TYPE = "manuel"
--- The cover card's layout size: 16:9, the size IGDB screenshots already lay out as one ordinary cell.
M.MANUAL_COVER = { 1280, 720 }
--- A manual larger than this is not downloaded (the WinINet reader holds it in memory).
M.MAX_MANUAL_BYTES = 48 * 1024 * 1024

--- The manual card of a `jeu`, best region first (REGION_RANK), or nil: { kind = "manual", source, key, title,
--- width, height }. Never a URL.
function M.manual_item(jeu)
  local best
  for _, m in ipairs(type(jeu) == "table" and type(jeu.medias) == "table" and jeu.medias or {}) do
    if type(m) == "table" and m.type == M.MANUAL_TYPE and type(m.url) == "string" and m.url ~= "" then
      local rank = REGION_RANK[m.region or "wor"] or 9
      local key = key_of(m)
      if not best or rank < best.rank or (rank == best.rank and key < best.key) then best = { rank = rank, key = key } end
    end
  end
  if not best then return nil end
  return { kind = "manual", source = "screenscraper", key = best.key, title = "Manual",
    width = M.MANUAL_COVER[1], height = M.MANUAL_COVER[2] }
end

--- The bytes of one manual URL, in memory (net.get_binary, no `maxwidth`: a PDF is not scaled). Never logs the URL.
---@return string|nil body, string|nil err
function M.download_document(url)
  local res, err = net.get_binary(url, {
    source = "screenscraper",
    user_agent = "steam-cartridges/1.0",
    max_bytes = M.MAX_MANUAL_BYTES,
  })
  if not res then return nil, tostring(err) end
  if res.status ~= 200 then return nil, "status " .. tostring(res.status) end
  if type(res.body) ~= "string" or res.body:sub(1, 5) ~= "%PDF-" then return nil, "not a pdf" end
  return res.body
end

--- The URL of the media item `key` in `jeu`, or nil. Stays in the backend (it carries the accounts).
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
```

Expected output (exit code 0):

```
ALL PASS
67
```

#### Step 1.2 — media_service: the injectable document download, the manual item in the media part, the chunked read

In `steam-cartridges/backend/media_service.lua`, find this block (it occurs exactly once):

```lua
  download = nil,      -- nil = screenscraper_media.download(url) -> body, ext, width, height
```

Replace it with:

```lua
  download = nil,      -- nil = screenscraper_media.download(url) -> body, ext, width, height
  download_document = nil, -- nil = screenscraper_media.download_document(url) -> body | nil, err
```

In `steam-cartridges/backend/media_service.lua`, find this block (it occurs exactly once):

```lua
      for _, it in ipairs(require("screenscraper_media").media_items(jeu)) do items[#items + 1] = it end
```

Replace it with:

```lua
      local media = require("screenscraper_media")
      for _, it in ipairs(media.media_items(jeu)) do items[#items + 1] = it end
      local manual = media.manual_item(jeu)
      if manual then items[#items + 1] = manual end
```

In `steam-cartridges/backend/media_service.lua`, find this block (it occurs exactly once):

```lua
  return { base64 = require("utils").base64_encode(body), ext = ext, width = width, height = height }
end
```

Replace it with:

```lua
  return { base64 = require("utils").base64_encode(body), ext = ext, width = width, height = height }
end

--- One downloaded manual, kept while the frontend reads it in chunks: { appid, key, body }. One at a time.
local manual_doc = nil
--- Bytes per GetManualChunk answer (base64 makes it 4/3 larger on the RPC).
M.MANUAL_CHUNK_BYTES = 1024 * 1024

--- Chunk `index` (0-based) of a ScreenScraper manual as base64 (GetManualChunk): { base64, index, chunks, size }, or nil
--- and an error. Chunk 0 downloads the PDF into memory; the other chunks read that copy. The URL never leaves here.
function M.manual_chunk(appid, key, title, index)
  if type(key) ~= "string" or key == "" then return nil, "missing key" end
  index = math.floor(tonumber(index) or 0)
  if index < 0 then return nil, "bad index" end
  if index == 0 or not (manual_doc and manual_doc.appid == appid and manual_doc.key == key) then
    manual_doc = nil
    local media = require("screenscraper_media")
    local ok, jeu, err = pcall(ss_jeu, appid, title or "", shortcut_info(appid))
    if not ok or type(jeu) ~= "table" then return nil, ok and tostring(err or "not-found") or "not-found" end
    local url = media.media_url(jeu, key)
    if not url then return nil, "unknown key" end
    local body, derr = (M.deps.download_document or media.download_document)(url)
    if not body then return nil, derr end
    manual_doc = { appid = appid, key = key, body = body }
  end
  local body = manual_doc.body
  local chunks = math.max(1, math.ceil(#body / M.MANUAL_CHUNK_BYTES))
  if index >= chunks then return nil, "bad index" end
  local from = index * M.MANUAL_CHUNK_BYTES + 1
  local piece = body:sub(from, from + M.MANUAL_CHUNK_BYTES - 1)
  if index == chunks - 1 then manual_doc = nil end -- the last chunk read: free the copy
  return { base64 = require("utils").base64_encode(piece), index = index, chunks = chunks, size = #body }
end
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
```

Expected output (exit code 0):

```
ALL PASS
67
```

#### Step 1.3 — The GetManualChunk RPC function (registered in main.lua in step 3.8, with its frontend caller)

In `steam-cartridges/backend/record_rpc.lua`, find this block (it occurs exactly once):

```lua
  if not image then return { error = err } end
  return image
end)
```

Replace it with:

```lua
  if not image then return { error = err } end
  return image
end)

RPC.GetManualChunk = method("GetManualChunk", function(data)
  local appid = need(data, "appid")
  if not is_shortcut(appid) then return { error = "not a shortcut" } end
  local chunk, err = media_service.manual_chunk(tonumber(appid), need(data, "key"), data.title, data.index)
  if not chunk then return { error = err } end
  return chunk
end)
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
```

Expected output (exit code 0):

```
ALL PASS
67
```

#### Step 1.4 — Tests for the manual item, the download and the chunks

In `steam-cartridges/tests/test_media_service.lua`, insert this block on new lines directly **above** the line that starts `print("\n" .. (failures == 0` (the second-to-last line of the file; leave that line and `os.exit(...)` after it unchanged):

```lua
-- ---------- manuals (features plan F2c) ----------
print("manuals")
local MAN = { id = "5", medias = {
  { type = "manuel", region = "jp", url = SS_URL .. "&media=manuel(jp)" },
  { type = "manuel", region = "us", url = SS_URL .. "&media=manuel(us)" },
  { type = "ss", region = "wor", url = SS_URL .. "&media=ss(wor)" },
} }
local man = ss.manual_item(MAN)
check("manual_item: the US manual beats the Japanese one", man and man.key == "manuel(us)" and man.kind == "manual" and man.source == "screenscraper")
check("the manual card is laid out 16:9 and carries no URL", man.width == 1280 and man.height == 720 and man.url == nil and man.thumb == nil)
check("no manual: nil", ss.manual_item(JEU) == nil and ss.manual_item(nil) == nil)
check("media_items still leaves the manual out", #ss.media_items(MAN) == 1)

wipe()
jeu_answer = MAN
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowScreenscraper = true })
check("ensure: the manual is one more ScreenScraper item, after the images", r.status == "ok" and #r.data.items == 2 and r.data.items[2].kind == "manual",
  r.data and #r.data.items)

local PDF = "%PDF-1.4\n" .. string.rep("x", 2 * media.MANUAL_CHUNK_BYTES + 10)
local doc_calls = {}
net.deps.binary = { get = function(url, opts) doc_calls[#doc_calls + 1] = { url = url, opts = opts }; return { status = 200, body = PDF } end }
local pdf_body = ss.download_document(SS_URL)
check("download_document: the PDF body, no maxwidth, the manual size cap", pdf_body == PDF and not doc_calls[1].url:find("maxwidth", 1, true)
  and doc_calls[1].opts.max_bytes == ss.MAX_MANUAL_BYTES)
net.deps.binary = { get = function() return { status = 200, body = "Erreur de login" } end }
local nb, nerr = ss.download_document(SS_URL)
check("an answer that is not a PDF is an error", nb == nil and nerr == "not a pdf")
net.deps.binary = nil
net._reset()

local downloads = 0
media.deps.download_document = function() downloads = downloads + 1; return PDF end
local c0 = media.manual_chunk(SC, "manuel(us)", "G", 0)
check("chunk 0: downloads once, 3 chunks of 1 MiB, the size", downloads == 1 and c0.chunks == 3 and c0.size == #PDF and c0.index == 0)
local c1 = media.manual_chunk(SC, "manuel(us)", "G", 1)
local c2 = media.manual_chunk(SC, "manuel(us)", "G", 2)
check("chunks 1 and 2 read the same copy", downloads == 1 and c1.index == 1 and c2.index == 2)
check("the chunks are the PDF's bytes in order", c0.base64 == utils.base64_encode(PDF:sub(1, media.MANUAL_CHUNK_BYTES))
  and c2.base64 == utils.base64_encode(PDF:sub(2 * media.MANUAL_CHUNK_BYTES + 1)))
media.manual_chunk(SC, "manuel(us)", "G", 1)
check("after the last chunk the copy is freed: a later chunk downloads again", downloads == 2)
local _, bad = media.manual_chunk(SC, "manuel(us)", "G", 9)
check("an index past the end is an error", bad == "bad index")
local _, unk = media.manual_chunk(SC, "manuel(fr)", "G", 0)
check("an unknown key is an error", unk == "unknown key")
res = json.decode(record_rpc.GetManualChunk(json.encode({ appid = SC, key = "manuel(us)", title = "G", index = 0 })))
check("GetManualChunk returns base64 and the chunk count, and no url field", type(res.base64) == "string" and res.chunks == 3 and res.url == nil)
res = json.decode(record_rpc.GetManualChunk(json.encode({ appid = 435150, key = "manuel(us)", index = 0 })))
check("GetManualChunk refuses a native appid", res.error == "not a shortcut")
media.deps.download_document = nil
jeu_answer = JEU
wipe()
os.remove(media_store._path); os.remove(fresh_policy._path)
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "; npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail) "
```

Expected output (exit code 0):

```
ALL PASS
82
ℹ tests 240
ℹ pass 240
ℹ fail 0
```

#### Commit phase 1

Run `git status --short` inside `steam-cartridges/`: it must list exactly these paths (`M` or `??`) and nothing else; if anything else is listed, stop (failure rule).

```bash
git add backend/screenscraper_media.lua \
  backend/media_service.lua \
  backend/record_rpc.lua \
  tests/test_media_service.lua
git commit -m "feat(steam-cartridges): F2c backend: ScreenScraper manual item and chunked PDF read"
```

The message has no `Co-Authored-By` or "Generated with" line (AGENTS.md Routine 6). Expected: `git status --short` prints nothing afterwards.

### Phase 2 — the pdf.js dependency and the pdf port

#### Step 2.1 — Add pdfjs-dist 4.10.38 (exact) to both lockfiles

Run (inside `steam-cartridges/`):

```bash
pnpm add pdfjs-dist@4.10.38 --save-exact
```

Run (inside `steam-cartridges/`):

```bash
npm install --package-lock-only --ignore-scripts
```

Check:

```bash
git diff --stat -- package.json pnpm-lock.yaml package-lock.json; git diff -U0 package.json | grep "^+ "
```

Expected output (exit code 0):

```
package-lock.json | 278 ++++++++++++++++++++++++++++++++++++++++++++++++++++++
 package.json      |   1 +
 pnpm-lock.yaml    | 134 ++++++++++++++++++++++++++
 3 files changed, 413 insertions(+)
+    "pdfjs-dist": "4.10.38",
```

#### Step 2.2 — The pdf port (the only file that uses pdf.js)

Create `steam-cartridges/frontend/ports/pdf.ts` (a new file; it must not exist yet) with exactly this content:

```ts
// Port: a PDF's pages as images, for app/manuals (features plan F2c, ADR-0048). The only file that uses pdf.js
// (pdfjs-dist 4.10.38, pinned: 5.4 and 6.3 hang in getDocument in Steam's Chromium 126, verified live 2026-10-01).
// pdf.js and its worker are embedded as text at build time (constSysfsExpr) and loaded from blob: URLs the first time a
// manual opens, so Steam's start-up never evaluates them. Pages are drawn on an OffscreenCanvas and handed out as JPEG
// object URLs. While a document is open pdf.js adds its fonts to the document's FontFaceSet; destroy() removes them
// (verified live 2026-10-01). It never touches Steam.
import { constSysfsExpr } from "@steambrew/client";
import type * as PdfJs from "pdfjs-dist";

const PDFJS_SOURCE = constSysfsExpr("pdf.min.mjs", { basePath: "../../node_modules/pdfjs-dist/build", encoding: "utf8" }).content;
const WORKER_SOURCE = constSysfsExpr("pdf.worker.min.mjs", { basePath: "../../node_modules/pdfjs-dist/build", encoding: "utf8" }).content;

/** JPEG quality of a rendered page. */
const PAGE_QUALITY = 0.85;

/** One open PDF. */
export interface PdfDocument {
    pageCount: number;
    /** Page 1's size in PDF points: the viewer reserves every page's space with it. */
    pageWidth: number;
    pageHeight: number;
    /** Page `n` (1-based) drawn `width` pixels wide, as an object URL (blob:), or null. */
    renderPage(n: number, width: number): Promise<string | null>;
    /** Frees the document, its worker-side data and its fonts. */
    destroy(): void;
}

export interface PdfRenderer {
    /** The PDF whose bytes are the base64 `chunks` in order, or null when it does not parse. */
    open(chunks: readonly string[]): Promise<PdfDocument | null>;
}

let library: Promise<typeof PdfJs> | undefined;

function blobUrl(source: string): string {
    return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

/** pdf.js, evaluated once, with one module worker for every document. */
function load(): Promise<typeof PdfJs> {
    if (!library) {
        library = (async () => {
            const pdfjs = (await import(blobUrl(PDFJS_SOURCE))) as typeof PdfJs;
            pdfjs.GlobalWorkerOptions.workerPort = new Worker(blobUrl(WORKER_SOURCE), { type: "module" });
            return pdfjs;
        })();
        library.catch(() => (library = undefined));
    }
    return library;
}

function bytesOf(chunks: readonly string[]): Uint8Array {
    const parts = chunks.map((chunk) => {
        const binary = atob(chunk);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    });
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

export const pdfRenderer: PdfRenderer = {
    async open(chunks) {
        try {
            const pdfjs = await load();
            const doc = await pdfjs.getDocument({ data: bytesOf(chunks), isEvalSupported: false }).promise;
            const first = (await doc.getPage(1)).getViewport({ scale: 1 });
            return {
                pageCount: doc.numPages,
                pageWidth: first.width,
                pageHeight: first.height,
                async renderPage(n, width) {
                    try {
                        const page = await doc.getPage(n);
                        const natural = page.getViewport({ scale: 1 });
                        const viewport = page.getViewport({ scale: width / natural.width });
                        const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
                        const context = canvas.getContext("2d");
                        if (!context) return null;
                        await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
                        page.cleanup();
                        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: PAGE_QUALITY });
                        return URL.createObjectURL(blob);
                    } catch {
                        return null;
                    }
                },
                destroy() {
                    void doc.destroy().catch(() => {});
                },
            };
        } catch {
            return null;
        }
    },
};
```

Check:

```bash
npm run check; npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail) "
```

Expected output (exit code 0):

```
> steam-cartridges@0.1.0 check
> tsc --noEmit

ℹ tests 240
ℹ pass 240
ℹ fail 0
```

#### Commit phase 2

Run `git status --short` inside `steam-cartridges/`: it must list exactly these paths (`M` or `??`) and nothing else; if anything else is listed, stop (failure rule).

```bash
git add package.json \
  pnpm-lock.yaml \
  package-lock.json \
  frontend/ports/pdf.ts
git commit -m "build(steam-cartridges): pdfjs-dist 4.10.38 behind ports/pdf"
```

The message has no `Co-Authored-By` or "Generated with" line (AGENTS.md Routine 6). Expected: `git status --short` prints nothing afterwards.

### Phase 3 — kernel, domain, app and the RPC registration

#### Step 3.1 — A media item may be a manual

In `steam-cartridges/frontend/kernel/record.ts`, find this block (it occurs exactly once):

```ts
export interface MediaItem {
    kind: "video" | "screenshot" | "artwork";
```

Replace it with:

```ts
export interface MediaItem {
    /** "manual": a ScreenScraper PDF (features plan F2c), shown as a cover card and opened page by page. */
    kind: "video" | "screenshot" | "artwork" | "manual";
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.2 — The community surface's result event

In `steam-cartridges/frontend/kernel/events.ts`, find this block (it occurs exactly once):

```ts
    "settings.changed": { key: string };
```

Replace it with:

```ts
    "settings.changed": { key: string };
    /** The community surface showed Steam's viewer for a manual card (features plan F2c): app/manuals renders its pages. */
    "community.manual-opened": { appid: ShortcutId; key: string };
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.3 — The manual shelf (kernel)

Create `steam-cartridges/frontend/kernel/manual-shelf.ts` (a new file; it must not exist yet) with exactly this content:

```ts
// Kernel: the manuals app/manuals opened (features plan F2c, ADR-0048), as page images waiting for the community
// surface's viewer. Kept out of GameRecord like the media bin (kernel/media-bin.ts): the pages live only in memory,
// behind blob URLs, and nothing is written to disk. Bounded to the last MAX_MANUALS manuals; an evicted or replaced
// page URL is given to `release` (ports/image releaseObjectUrl). Listeners are told of every change, so the viewer
// shows each page as soon as it is rendered.

export interface ManualPage {
    /** An object URL (blob:) of the rendered page, or undefined while it is not rendered yet. */
    url?: string;
    /** The page's size in PDF points: the viewer reserves its space before the image exists. */
    width: number;
    height: number;
}

export interface ManualView {
    status: "loading" | "ready" | "failed";
    pages: ManualPage[];
}

export interface ManualShelf {
    get(appid: number, key: string): ManualView | undefined;
    set(appid: number, key: string, view: ManualView): void;
    /** Called after every set; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void;
}

export const MAX_MANUALS = 2;

export function createManualShelf(release: (url: string) => void): ManualShelf {
    const map = new Map<string, ManualView>();
    const listeners = new Set<() => void>();
    const id = (appid: number, key: string) => `${appid}:${key}`;
    const urls = (view: ManualView | undefined) => new Set((view?.pages ?? []).map((p) => p.url).filter((u): u is string => !!u));
    return {
        get: (appid, key) => map.get(id(appid, key)),
        set(appid, key, view) {
            const k = id(appid, key);
            const kept = urls(view);
            urls(map.get(k)).forEach((url) => kept.has(url) || release(url));
            map.delete(k); // re-insert: the map's order is the recency order
            map.set(k, view);
            while (map.size > MAX_MANUALS) {
                const oldest = map.keys().next().value as string;
                urls(map.get(oldest)).forEach(release);
                map.delete(oldest);
            }
            for (const listener of [...listeners]) {
                try {
                    listener();
                } catch {
                    /* a listener must never break the shelf */
                }
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
    };
}
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.4 — The manual is the first card, behind communityShowManuals (domain, and its value in index.tsx)

In `steam-cartridges/frontend/domain/community-media.ts`, find this block (it occurs exactly once):

```ts
/** Settings communityShowTrailers and communityShowArtworks. */
export interface MediaToggles {
    trailers: boolean;
    artworks: boolean;
}
```

Replace it with:

```ts
/** Settings communityShowTrailers, communityShowArtworks and communityShowManuals. */
export interface MediaToggles {
    trailers: boolean;
    artworks: boolean;
    manuals: boolean;
}
```

In `steam-cartridges/frontend/domain/community-media.ts`, find this block (it occurs exactly once):

```ts
    if (item.kind === "video") return typeof item.youtube === "string" && item.youtube !== "";
    if (item.kind !== "screenshot" && item.kind !== "artwork") return false;
```

Replace it with:

```ts
    if (item.kind === "video") return typeof item.youtube === "string" && item.youtube !== "";
    if (item.kind === "manual") return item.source === "screenscraper" && typeof item.key === "string" && item.key !== "";
    if (item.kind !== "screenshot" && item.kind !== "artwork") return false;
```

In `steam-cartridges/frontend/domain/community-media.ts`, find this block (it occurs exactly once):

```ts
/**
 * The items to show: allowed by the toggles, complete, at most MAX_PER_KIND per kind. Order: trailers, then the images
```

Replace it with:

```ts
/**
 * The items to show: allowed by the toggles, complete, at most MAX_PER_KIND per kind. Order: the manual first (the user
 * wants it as the top-left card, features plan F2c), then trailers, then the images
```

In `steam-cartridges/frontend/domain/community-media.ts`, find this block (it occurs exactly once):

```ts
    const rank = (item: MediaItem) => (item.kind === "video" ? 0 : item.source === "screenscraper" ? 1 : 2);
    const wanted = asList<MediaItem>(media?.items)
        .filter(isShowable)
        .filter((item) => (item.kind === "video" ? toggles.trailers : toggles.artworks))
```

Replace it with:

```ts
    const rank = (item: MediaItem) => (item.kind === "manual" ? -1 : item.kind === "video" ? 0 : item.source === "screenscraper" ? 1 : 2);
    const wanted = asList<MediaItem>(media?.items)
        .filter(isShowable)
        .filter((item) => (item.kind === "video" ? toggles.trailers : item.kind === "manual" ? toggles.manuals : toggles.artworks))
```

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
    toggles: () => ({ trailers: setting("communityShowTrailers") !== false, artworks: setting("communityShowArtworks") !== false }),
    objectUrl,
});
```

Replace it with:

```tsx
    toggles: () => ({
        trailers: setting("communityShowTrailers") !== false,
        artworks: setting("communityShowArtworks") !== false,
        manuals: setting("communityShowManuals") !== false,
    }),
    objectUrl,
});
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.5 — app/media leaves the manual to app/manuals (it must not download the PDF as an image)

In `steam-cartridges/frontend/app/media.ts`, find this block (it occurs exactly once):

```ts
        if (item.source !== "screenscraper") return item;
```

Replace it with:

```ts
        if (item.source !== "screenscraper" || item.kind === "manual") return item; // a manual is fetched when opened (app/manuals)
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.6 — The backend port method

In `steam-cartridges/frontend/ports/backend.ts`, find this block (it occurs exactly once):

```ts
export interface RecordResponse {
```

Replace it with:

```ts
/** One chunk of a ScreenScraper manual (features plan F2c): 1 MiB of the PDF as base64, never the URL. */
export interface ManualChunkResponse {
    base64?: string;
    index?: number;
    chunks?: number;
    size?: number;
    error?: string;
}

export interface RecordResponse {
```

In `steam-cartridges/frontend/ports/backend.ts`, find this block (it occurs exactly once):

```ts
    /** Disk only: every DB record and every saved mapping (M5a). */
```

Replace it with:

```ts
    /** Manuals (features plan F2c): chunk `index` (0-based) of a ScreenScraper PDF; chunk 0 downloads it in the backend. */
    getManualChunk(appid: number, key: string, index: number, title?: string): Promise<ManualChunkResponse> {
        return call<ManualChunkResponse>("GetManualChunk", { appid, key, index, title });
    },
    /** Disk only: every DB record and every saved mapping (M5a). */
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.7 — The use case (app/manuals)

Create `steam-cartridges/frontend/app/manuals.ts` (a new file; it must not exist yet) with exactly this content:

```ts
// app/manuals: a ScreenScraper manual's pages for Steam's image viewer (features plan F2c, ADR-0048). The community
// surface reports that it showed a manual's viewer (`community.manual-opened`); this reads the PDF from the backend in
// chunks (ports/backend GetManualChunk), renders its pages one by one through the injected renderer (ports/pdf) and puts
// them on the manual shelf (kernel/manual-shelf), which the viewer reads. Nothing is written to disk and no URL of
// ScreenScraper reaches the frontend. A failure marks the manual failed and nothing else (ADR-0014).
import type { ShortcutId } from "../kernel/appid";
import type { EventBus } from "../kernel/events";
import type { ManualPage, ManualShelf } from "../kernel/manual-shelf";
import type { backend as Backend } from "../ports/backend";
import type { PdfDocument, PdfRenderer } from "../ports/pdf";

/** Pages rendered at most (a longer PDF shows its first pages only). */
export const MAX_MANUAL_PAGES = 200;
/** Chunks read at most: 48 x 1 MiB, the backend's own size cap (screenscraper_media.MAX_MANUAL_BYTES). */
export const MAX_MANUAL_CHUNKS = 48;
/** A page's rendered width in pixels: the Big Picture viewer's width at its device pixel ratio, rounded up. */
export const PAGE_WIDTH = 1400;

export interface ManualsDeps {
    backend: Pick<typeof Backend, "getManualChunk">;
    bus: Pick<EventBus, "on">;
    shelf: ManualShelf;
    renderer: PdfRenderer;
    titleOf(appid: number): string | undefined;
}

export interface Manuals {
    /** Subscribe to `community.manual-opened`. */
    install(): void;
    /** Read, render and shelve one manual. A manual already rendered or rendering is not read again. */
    open(appid: ShortcutId, key: string): Promise<void>;
}

export function createManuals(deps: ManualsDeps): Manuals {
    const busy = new Set<string>();

    /** The PDF as base64 chunks in order, or null (an error answer, a gap, or more than MAX_MANUAL_CHUNKS). */
    async function download(appid: ShortcutId, key: string): Promise<string[] | null> {
        const chunks: string[] = [];
        let total = 1;
        for (let index = 0; index < total; index++) {
            const res = await deps.backend.getManualChunk(appid, key, index, deps.titleOf(appid));
            if (!res.base64 || res.index !== index || typeof res.chunks !== "number" || res.chunks > MAX_MANUAL_CHUNKS) return null;
            total = res.chunks;
            chunks.push(res.base64);
        }
        return chunks;
    }

    async function open(appid: ShortcutId, key: string): Promise<void> {
        const id = `${appid}:${key}`;
        if (busy.has(id) || deps.shelf.get(appid, key)?.status === "ready") return;
        busy.add(id);
        let doc: PdfDocument | null = null;
        try {
            deps.shelf.set(appid, key, { status: "loading", pages: [] });
            const chunks = await download(appid, key);
            doc = chunks ? await deps.renderer.open(chunks) : null;
            if (!doc || doc.pageCount < 1) {
                deps.shelf.set(appid, key, { status: "failed", pages: [] });
                return;
            }
            const count = Math.min(doc.pageCount, MAX_MANUAL_PAGES);
            let pages: ManualPage[] = Array.from({ length: count }, () => ({ width: doc!.pageWidth, height: doc!.pageHeight }));
            deps.shelf.set(appid, key, { status: "loading", pages });
            // One page at a time, in reading order: the viewer shows each as soon as it is ready.
            for (let n = 1; n <= count; n++) {
                const url = await doc.renderPage(n, PAGE_WIDTH);
                if (!url) continue;
                pages = pages.slice();
                pages[n - 1] = { ...pages[n - 1]!, url };
                deps.shelf.set(appid, key, { status: "loading", pages });
            }
            deps.shelf.set(appid, key, { status: "ready", pages });
        } catch {
            deps.shelf.set(appid, key, { status: "failed", pages: [] }); // ADR-0014: the viewer says so, nothing else
        } finally {
            doc?.destroy();
            busy.delete(id);
        }
    }

    return {
        install() {
            deps.bus.on("community.manual-opened", ({ appid, key }) => void open(appid, key));
        },
        open,
    };
}
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 3.8 — Register GetManualChunk

In `steam-cartridges/backend/main.lua`, find this block (it occurs exactly once):

```lua
GetMediaImage  = RECORD_RPC.GetMediaImage
```

Replace it with:

```lua
GetMediaImage  = RECORD_RPC.GetMediaImage
-- Manuals (features plan F2c): a ScreenScraper PDF, read in 1 MiB chunks.
GetManualChunk = RECORD_RPC.GetManualChunk
```

Check:

```bash
lua tests/test_media_service.lua | tail -1; lua tests/test_media_service.lua | grep -c "  PASS  "
```

Expected output (exit code 0):

```
ALL PASS
82
```

#### Step 3.9 — Tests: the shelf, the use case, the ordering

Create `steam-cartridges/tests/manual-shelf.test.ts` (a new file; it must not exist yet) with exactly this content:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManualShelf, MAX_MANUALS } from '../frontend/kernel/manual-shelf.ts';

const page = (url?: string) => ({ url, width: 420, height: 595 });

test('manual shelf: set, get and tell the listeners', () => {
    const shelf = createManualShelf(() => {});
    let told = 0;
    const off = shelf.subscribe(() => told++);
    shelf.set(1, 'manuel(us)', { status: 'loading', pages: [] });
    assert.deepEqual(shelf.get(1, 'manuel(us)'), { status: 'loading', pages: [] });
    assert.equal(shelf.get(1, 'manuel(eu)'), undefined);
    assert.equal(told, 1);
    off();
    shelf.set(1, 'manuel(us)', { status: 'ready', pages: [] });
    assert.equal(told, 1, 'an unsubscribed listener is not told');
});

test('manual shelf: a page URL dropped by an update is released, a kept one is not', () => {
    const released: string[] = [];
    const shelf = createManualShelf((url) => released.push(url));
    shelf.set(1, 'm', { status: 'loading', pages: [page('blob:a'), page()] });
    shelf.set(1, 'm', { status: 'loading', pages: [page('blob:a'), page('blob:b')] });
    assert.deepEqual(released, []);
    shelf.set(1, 'm', { status: 'failed', pages: [] });
    assert.deepEqual(released.sort(), ['blob:a', 'blob:b']);
});

test('manual shelf: at most MAX_MANUALS manuals; the oldest is evicted and its pages released', () => {
    const released: string[] = [];
    const shelf = createManualShelf((url) => released.push(url));
    for (let i = 0; i <= MAX_MANUALS; i++) shelf.set(i, 'm', { status: 'ready', pages: [page(`blob:${i}`)] });
    assert.equal(shelf.get(0, 'm'), undefined);
    assert.deepEqual(released, ['blob:0']);
    assert.ok(shelf.get(MAX_MANUALS, 'm'));
});

test('manual shelf: a listener that throws does not stop the others', () => {
    const shelf = createManualShelf(() => {});
    let told = 0;
    shelf.subscribe(() => {
        throw new Error('boom');
    });
    shelf.subscribe(() => told++);
    shelf.set(1, 'm', { status: 'loading', pages: [] });
    assert.equal(told, 1);
});
```

Create `steam-cartridges/tests/app-manuals.test.ts` (a new file; it must not exist yet) with exactly this content:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManuals, MAX_MANUAL_CHUNKS, MAX_MANUAL_PAGES, PAGE_WIDTH } from '../frontend/app/manuals.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createManualShelf } from '../frontend/kernel/manual-shelf.ts';

const SC = 3858120657 as any;
const KEY = 'manuel(us)';

function setup(over: Partial<Record<string, any>> = {}) {
    const bus = createEventBus();
    const shelf = createManualShelf(() => {});
    const asked: any[] = [];
    const rendered: any[] = [];
    let destroyed = 0;
    const chunks = over.chunks ?? 2;
    const manuals = createManuals({
        backend: {
            async getManualChunk(appid: number, key: string, index: number, title?: string) {
                asked.push({ appid, key, index, title });
                if (over.chunkThrows) throw new Error('transport');
                if (over.chunkError) return { error: 'unknown key' };
                return { base64: `c${index}`, index, chunks, size: chunks * 10 };
            },
        } as any,
        bus,
        shelf,
        renderer: {
            async open(parts: readonly string[]) {
                if (over.noDoc) return null;
                rendered.push({ parts: [...parts] });
                return {
                    pageCount: over.pages ?? 3,
                    pageWidth: 420,
                    pageHeight: 595,
                    async renderPage(n: number, width: number) {
                        rendered.push({ n, width });
                        return over.blankPage === n ? null : `blob:p${n}`;
                    },
                    destroy: () => void destroyed++,
                };
            },
        },
        titleOf: () => 'Captain Commando',
    });
    return { bus, shelf, manuals, asked, rendered, destroyed: () => destroyed };
}

test('app/manuals: reads every chunk in order, renders every page at PAGE_WIDTH, ends ready', async () => {
    const s = setup();
    await s.manuals.open(SC, KEY);
    assert.deepEqual(s.asked.map((a) => a.index), [0, 1]);
    assert.equal(s.asked[0].title, 'Captain Commando');
    assert.deepEqual(s.rendered[0].parts, ['c0', 'c1']);
    assert.deepEqual(s.rendered.slice(1).map((r) => [r.n, r.width]), [[1, PAGE_WIDTH], [2, PAGE_WIDTH], [3, PAGE_WIDTH]]);
    const view = s.shelf.get(SC, KEY)!;
    assert.equal(view.status, 'ready');
    assert.deepEqual(view.pages.map((p) => p.url), ['blob:p1', 'blob:p2', 'blob:p3']);
    assert.deepEqual([view.pages[0]!.width, view.pages[0]!.height], [420, 595]);
    assert.equal(s.destroyed(), 1, 'the document is freed once its pages are images');
});

test('app/manuals: the shelf shows sized placeholders first, then each page as it is rendered', async () => {
    const s = setup();
    const seen: string[] = [];
    s.shelf.subscribe(() => {
        const v = s.shelf.get(SC, KEY)!;
        seen.push(`${v.status}:${v.pages.filter((p) => p.url).length}/${v.pages.length}`);
    });
    await s.manuals.open(SC, KEY);
    assert.deepEqual(seen, ['loading:0/0', 'loading:0/3', 'loading:1/3', 'loading:2/3', 'loading:3/3', 'ready:3/3']);
});

test('app/manuals: the community.manual-opened event opens the manual once; a ready manual is not read again', async () => {
    const s = setup();
    s.manuals.install();
    s.bus.emit('community.manual-opened', { appid: SC, key: KEY });
    s.bus.emit('community.manual-opened', { appid: SC, key: KEY }); // the viewer re-mounted while it was rendering
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(s.asked.filter((a) => a.index === 0).length, 1);
    await s.manuals.open(SC, KEY);
    assert.equal(s.asked.filter((a) => a.index === 0).length, 1);
});

test('app/manuals: a failed download, a refused answer or a PDF that does not parse marks it failed (ADR-0014)', async () => {
    for (const over of [{ chunkThrows: true }, { chunkError: true }, { noDoc: true }, { chunks: MAX_MANUAL_CHUNKS + 1 }, { pages: 0 }]) {
        const s = setup(over);
        await s.manuals.open(SC, KEY);
        assert.deepEqual(s.shelf.get(SC, KEY), { status: 'failed', pages: [] }, JSON.stringify(over));
    }
});

test('app/manuals: a failed manual is tried again the next time it opens', async () => {
    const s = setup({ chunkError: true });
    await s.manuals.open(SC, KEY);
    await s.manuals.open(SC, KEY);
    assert.equal(s.asked.length, 2);
});

test('app/manuals: a page that does not render stays a placeholder; at most MAX_MANUAL_PAGES pages', async () => {
    const s = setup({ blankPage: 2 });
    await s.manuals.open(SC, KEY);
    assert.deepEqual(s.shelf.get(SC, KEY)!.pages.map((p) => p.url), ['blob:p1', undefined, 'blob:p3']);
    const big = setup({ pages: MAX_MANUAL_PAGES + 50 });
    await big.manuals.open(SC, KEY);
    assert.equal(big.shelf.get(SC, KEY)!.pages.length, MAX_MANUAL_PAGES);
});
```

Append to the end of `steam-cartridges/tests/community-media.test.ts` (after its last line; keep one blank line before the new block):

```ts

test('community media: a ScreenScraper manual is the first card, behind its own toggle (features plan F2c)', () => {
    const manual = { kind: 'manual', source: 'screenscraper', key: 'manuel(us)', width: 1280, height: 720 } as any;
    assert.ok(isShowable(manual));
    assert.ok(!isShowable({ kind: 'manual', source: 'screenscraper' } as any), 'a manual needs its key');
    const media = { items: [video(), shot(1), ssArt, manual] };
    assert.deepEqual(visibleMedia(media, { ...ON, manuals: true }), [manual, video(), ssArt, shot(1)]);
    assert.deepEqual(visibleMedia(media, { ...ON, manuals: false }), [video(), ssArt, shot(1)]);
    assert.deepEqual(visibleMedia(media, { trailers: false, artworks: false, manuals: true }), [manual]);
});
```

Check:

```bash
npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail) "
```

Expected output (exit code 0):

```
ℹ tests 251
ℹ pass 251
ℹ fail 0
```

#### Commit phase 3

Run `git status --short` inside `steam-cartridges/`: it must list exactly these paths (`M` or `??`) and nothing else; if anything else is listed, stop (failure rule).

```bash
git add frontend/kernel/record.ts \
  frontend/kernel/events.ts \
  frontend/kernel/manual-shelf.ts \
  frontend/domain/community-media.ts \
  frontend/index.tsx \
  frontend/app/media.ts \
  frontend/ports/backend.ts \
  frontend/app/manuals.ts \
  backend/main.lua \
  tests/manual-shelf.test.ts \
  tests/app-manuals.test.ts \
  tests/community-media.test.ts
git commit -m "feat(steam-cartridges): F2c manuals use case, manual shelf and GetManualChunk"
```

The message has no `Co-Authored-By` or "Generated with" line (AGENTS.md Routine 6). Expected: `git status --short` prints nothing afterwards.

### Phase 4 — the surface, the composition root and the settings row

#### Step 4.1 — The manual cover and its URL (community core)

In `steam-cartridges/frontend/surfaces/community/core.ts`, find this block (it occurs exactly once):

```ts
const youtubeThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
```

Replace it with:

```ts
const youtubeThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

const MANUAL_COVER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a475e"/><stop offset="1" stop-color="#171a21"/></linearGradient></defs>' +
    '<rect width="1280" height="720" fill="url(#g)"/>' +
    '<g fill="none" stroke="#c7d5e0" stroke-width="14" stroke-linejoin="round">' +
    '<path d="M640 250 C580 215 500 205 430 215 V455 C500 445 580 455 640 490 C700 455 780 445 850 455 V215 C780 205 700 215 640 250 Z"/>' +
    '<path d="M640 250 V490"/></g>' +
    '<text x="640" y="590" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" letter-spacing="8" fill="#c7d5e0">MANUAL</text>' +
    "</svg>";

/** The manual card's cover (features plan F2c): inline, so showing it makes no request; 16:9 like the card's size. */
export const MANUAL_COVER = `data:image/svg+xml;utf8,${encodeURIComponent(MANUAL_COVER_SVG)}`;
const MANUAL_MARK = "#manual-";

/**
 * The cover URL of one shortcut's manual: the same image, told apart by a fragment, because the image viewer is matched to
 * its card by this URL (viewerMeta) and each shortcut's manual must open its own pages.
 */
export function manualCoverUrl(appid: number, key: string): string {
    return `${MANUAL_COVER}${MANUAL_MARK}${appid}-${encodeURIComponent(key)}`;
}

/** The manual a cover URL names, or undefined for any other URL. O(1) for a URL that is not a cover. */
export function manualOfUrl(url: unknown): { appid: number; key: string } | undefined {
    if (typeof url !== "string" || !url.startsWith(MANUAL_COVER)) return undefined;
    const match = /^(\d+)-(.+)$/.exec(url.slice(MANUAL_COVER.length + MANUAL_MARK.length));
    if (!match || url.slice(MANUAL_COVER.length, MANUAL_COVER.length + MANUAL_MARK.length) !== MANUAL_MARK) return undefined;
    return { appid: Number(match[1]), key: decodeURIComponent(match[2]!) };
}
```

In `steam-cartridges/frontend/surfaces/community/core.ts`, find this block (it occurs exactly once):

```ts
        if (item.kind === "video") {
            if (!item.youtube) return;
```

Replace it with:

```ts
        if (item.kind === "manual") {
            if (!item.key) return;
            type = FILE_TYPE.artwork;
            preview = full = manualCoverUrl(appid, item.key);
            width = item.width ?? 1280;
            height = item.height ?? 720;
        } else if (item.kind === "video") {
            if (!item.youtube) return;
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 4.2 — The page column shown inside Steam's viewer

Create `steam-cartridges/frontend/surfaces/community/manual.ts` (a new file; it must not exist yet) with exactly this content:

```ts
// The manual's pages inside Steam's image viewer (features plan F2c, ADR-0048). Steam's viewer renders its `children`
// in a scrolling area under the Close button and scrolls it on the D-pad (module 94715, ArtworkModalContainer), so the
// pages are a plain column of images: controller and mouse-wheel scrolling come from Steam. The pages come from the
// manual shelf (kernel/manual-shelf), a pure read; the component re-renders when the shelf changes. When it mounts it
// reports that the viewer showed this manual (`community.manual-opened`, the surface's own result event); app/manuals
// does the rest. A render never starts work (guardrail 17): the report is sent from an effect.
import type { ManualView } from "../../kernel/manual-shelf";

type Jsx = (type: unknown, props: Record<string, unknown>, key?: string) => unknown;

export interface ManualPagesDeps {
    manualOf(appid: number, key: string): ManualView | undefined;
    subscribe(listener: () => void): () => void;
    /** Emit `community.manual-opened`. */
    opened(appid: number, key: string): void;
}

interface ReactHooks {
    useState<T>(initial: T): [T, (update: (previous: T) => T) => void];
    useEffect(effect: () => void | (() => void), deps: unknown[]): void;
}

const MESSAGE = { padding: "24px 0", textAlign: "center", opacity: 0.8, fontSize: 16 };
const COLUMN = { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0 24px" };
const PAGE = { width: "100%", maxWidth: 1000, display: "block", borderRadius: 2 };

/** The page column component. `manualKey`, not `key`: React keeps `key` for itself. */
export function createManualPages(jsx: Jsx, deps: ManualPagesDeps): (props: { appid: number; manualKey: string }) => unknown {
    return function ManualPages(props) {
        const R = Reflect.get(globalThis, "SP_REACT") as ReactHooks | undefined;
        if (!R?.useState || !R.useEffect) return null;
        const [, setTick] = R.useState(0);
        R.useEffect(() => deps.subscribe(() => setTick((n) => n + 1)), []);
        R.useEffect(() => deps.opened(props.appid, props.manualKey), [props.appid, props.manualKey]);
        const view = deps.manualOf(props.appid, props.manualKey);
        if (view?.status === "failed") return jsx("div", { style: MESSAGE, children: "This manual could not be opened." });
        if (!view || view.pages.length === 0) return jsx("div", { style: MESSAGE, children: "Loading the manual..." });
        return jsx("div", {
            style: COLUMN,
            children: view.pages.map((page, i) =>
                page.url
                    ? jsx("img", { src: page.url, alt: `Page ${i + 1}`, style: { ...PAGE, aspectRatio: `${page.width} / ${page.height}` } }, String(i))
                    : jsx("div", { style: { ...PAGE, aspectRatio: `${page.width} / ${page.height}`, background: "rgba(255, 255, 255, 0.06)" } }, String(i)),
            ),
        });
    };
}
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 4.3 — The community surface: its new reads, the viewer branch for a manual

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
import type { ShortcutId } from "../../kernel/appid";
import type { MediaImage } from "../../kernel/media-bin";
```

Replace it with:

```ts
import type { ShortcutId } from "../../kernel/appid";
import type { EventBus } from "../../kernel/events";
import type { ManualView } from "../../kernel/manual-shelf";
import type { MediaImage } from "../../kernel/media-bin";
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
    loaderAnswer,
    shouldLoadFirstPage,
```

Replace it with:

```ts
    loaderAnswer,
    manualOfUrl,
    shouldLoadFirstPage,
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
} from "./core";
```

Replace it with:

```ts
} from "./core";
import { createManualPages } from "./manual";
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
    imageOf(appid: number, key: string): MediaImage | undefined;
}

/** Set by createCommunitySurface; open defaults until then. */
let deps: CommunityDeps = { isEnabled: () => true, reportError: () => {}, imageOf: () => undefined };
```

Replace it with:

```ts
    imageOf(appid: number, key: string): MediaImage | undefined;
    /** The pages app/manuals rendered for a manual (kernel/manual-shelf; a pure read). */
    manualOf(appid: number, key: string): ManualView | undefined;
    /** Be told when the manual shelf changes. */
    onManuals(listener: () => void): () => void;
    /** To emit this surface's own result event, `community.manual-opened`. */
    bus: Pick<EventBus, "emit">;
}

/** Set by createCommunitySurface; open defaults until then. */
let deps: CommunityDeps = {
    isEnabled: () => true,
    reportError: () => {},
    imageOf: () => undefined,
    manualOf: () => undefined,
    onManuals: () => () => {},
    bus: { emit: () => {} },
};
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
interface ViewerMeta {
    source: MediaItem["source"];
    seconds: number;
}
```

Replace it with:

```ts
interface ViewerMeta {
    source: MediaItem["source"];
    seconds: number;
    /** Set for a manual's cover: the viewer shows its pages under the cover (features plan F2c). */
    manual?: { appid: number; key: string };
}
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
let cardsHidden = 0;
```

Replace it with:

```ts
let cardsHidden = 0;
/** The manual page column (surfaces/community/manual.ts), made once the jsx runtime is found. */
let ManualPages: ((props: { appid: number; manualKey: string }) => unknown) | undefined;
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
    const jsx = (type: unknown, props: Record<string, unknown>) => (runtime.jsx as (t: unknown, p: unknown) => unknown)(type, props);
```

Replace it with:

```ts
    const jsx = (type: unknown, props: Record<string, unknown>, key?: string) => (runtime.jsx as (t: unknown, p: unknown, k?: string) => unknown)(type, props, key);
    ManualPages = createManualPages(jsx, {
        manualOf: (appid, key) => deps.manualOf(appid, key),
        subscribe: (listener) => deps.onManuals(listener),
        opened: (appid, key) => deps.bus.emit("community.manual-opened", { appid: appid as ShortcutId, key }),
    });
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
                        return jsx(T, {
                            ...q,
                            children: undefined,
```

Replace it with:

```ts
                        return jsx(T, {
                            ...q,
                            // A manual's pages scroll under its cover; anything else gets no comment thread.
                            children: meta.manual && ManualPages ? jsx(ManualPages, { appid: meta.manual.appid, manualKey: meta.manual.key }) : undefined,
```

In `steam-cartridges/frontend/surfaces/community/index.ts`, find this block (it occurs exactly once):

```ts
        viewerMeta.set(card.full_image_url, { source, seconds });
```

Replace it with:

```ts
        viewerMeta.set(card.full_image_url, { source, seconds, manual: manualOfUrl(card.full_image_url) });
```

Check:

```bash
git diff --stat -- frontend/surfaces/community/index.ts
```

Expected output (exit code 0):

```
frontend/surfaces/community/index.ts | 35 +++++++++++++++++++++++++++++++----
 1 file changed, 31 insertions(+), 4 deletions(-)
```

#### Step 4.4 — Wire the shelf, the use case and the surface's new reads (composition root)

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
import { createMedia } from "./app/media";
```

Replace it with:

```tsx
import { createMedia } from "./app/media";
import { createManuals } from "./app/manuals";
```

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
import { fetchImage, objectUrl, releaseObjectUrl } from "./ports/image";
```

Replace it with:

```tsx
import { fetchImage, objectUrl, releaseObjectUrl } from "./ports/image";
import { pdfRenderer } from "./ports/pdf";
```

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
import { createMediaBin } from "./kernel/media-bin";
```

Replace it with:

```tsx
import { createMediaBin } from "./kernel/media-bin";
import { createManualShelf } from "./kernel/manual-shelf";
```

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
        manuals: setting("communityShowManuals") !== false,
    }),
    objectUrl,
});
```

Replace it with:

```tsx
        manuals: setting("communityShowManuals") !== false,
    }),
    objectUrl,
});

/** Manual pages as object URLs (kernel/manual-shelf, features plan F2c): app/manuals puts, surfaces/community reads. */
const manualShelf = createManualShelf(releaseObjectUrl);

/** Manuals (app/manuals.ts, features plan F2c): renders a ScreenScraper manual when the community viewer shows its cover. */
const manuals = createManuals({ backend, bus, shelf: manualShelf, renderer: pdfRenderer, titleOf: (appid) => shortcutTitle(appid) });
```

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
        createCommunitySurface({ ...surfaceDeps, imageOf: (appid, key) => mediaBin.get(appid, key) }),
```

Replace it with:

```tsx
        createCommunitySurface({
            ...surfaceDeps,
            imageOf: (appid, key) => mediaBin.get(appid, key),
            manualOf: (appid, key) => manualShelf.get(appid, key),
            onManuals: (listener) => manualShelf.subscribe(listener),
            bus,
        }),
```

In `steam-cartridges/frontend/index.tsx`, find this block (it occurs exactly once):

```tsx
    runner.installAll();
    artwork.install();
```

Replace it with:

```tsx
    runner.installAll();
    artwork.install();
    manuals.install();
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 4.5 — The settings row for communityShowManuals

In `steam-cartridges/frontend/settings/panels/community.tsx`, find this block (it occurs exactly once):

```tsx
// Settings: Community & Media (migration plan M8c; features plan F2 wires the first two toggles).
// communityShowManuals and communityShowExternalLinks stay in the settings (defaults unchanged) for F2c; they get
// a row when something reads them.
```

Replace it with:

```tsx
// Settings: Community & Media (migration plan M8c; features plan F2 wires the first two toggles, F2c the manuals).
// communityShowExternalLinks stays in the settings (default unchanged); it gets a row when something reads it.
```

In `steam-cartridges/frontend/settings/panels/community.tsx`, find this block (it occurs exactly once):

```tsx
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");
```

Replace it with:

```tsx
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");
    const [showManuals, setShowManuals] = useSetting("communityShowManuals");
```

In `steam-cartridges/frontend/settings/panels/community.tsx`, find this block (it occurs exactly once):

```tsx
                        value={showArtworks}
                        onChange={setShowArtworks}
                    />
```

Replace it with:

```tsx
                        value={showArtworks}
                        onChange={setShowArtworks}
                    />
                    <ToggleRow
                        label="Game Manuals"
                        description="Show the game's ScreenScraper manual as the first card; open it to read it page by page"
                        value={showManuals}
                        onChange={setShowManuals}
                    />
```

Check:

```bash
npm run check
```

Expected: Prints only the two `> steam-cartridges@0.1.0 check` / `> tsc --noEmit` banner lines and exits 0.

#### Step 4.6 — Tests: the cover card and its URL

In `steam-cartridges/tests/community-core.test.ts`, find this block (it occurs exactly once):

```ts
loaderAnswer, shouldLoadFirstPage,
```

Replace it with:

```ts
loaderAnswer, MANUAL_COVER, manualCoverUrl, manualOfUrl, shouldLoadFirstPage,
```

Append to the end of `steam-cartridges/tests/community-core.test.ts` (after its last line; keep one blank line before the new block):

```ts

test('community core: a manual becomes an artwork card with its inline cover, 16:9 (features plan F2c)', () => {
    const [card] = toFeedItems(SC, [{ kind: 'manual', source: 'screenscraper', key: 'manuel(us)', title: 'Manual', width: 1280, height: 720 }], none);
    assert.equal(card!.type, FILE_TYPE.artwork);
    assert.equal(card!.full_image_url, manualCoverUrl(SC, 'manuel(us)'));
    assert.equal(card!.preview_image_url, card!.full_image_url);
    assert.ok(card!.full_image_url.startsWith('data:image/svg+xml;utf8,'), 'no request, no file');
    assert.deepEqual([card!.image_width, card!.image_height], [1280, 720]);
    assert.equal(card!.title, 'Manual');
    assert.deepEqual(toFeedItems(SC, [{ kind: 'manual', source: 'screenscraper' } as any], none), [], 'no key, no card');
});

test('community core: a cover URL names its own shortcut and key; any other URL names none', () => {
    assert.deepEqual(manualOfUrl(manualCoverUrl(SC, 'manuel(us)')), { appid: SC, key: 'manuel(us)' });
    assert.notEqual(manualCoverUrl(SC, 'manuel(us)'), manualCoverUrl(SC + 1, 'manuel(us)'));
    assert.equal(manualOfUrl(MANUAL_COVER), undefined);
    assert.equal(manualOfUrl('blob:https://steamloopback.host/x'), undefined);
    assert.equal(manualOfUrl('https://images.igdb.com/a.jpg'), undefined);
    assert.equal(manualOfUrl(undefined), undefined);
});
```

Check:

```bash
npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail) "
```

Expected output (exit code 0):

```
ℹ tests 253
ℹ pass 253
ℹ fail 0
```

#### Step 4.7 — Production build: pdf.js and its worker are embedded

Check:

```bash
npm run build 2>&1 | grep -E "Embedded|Succeeded"; node -e "console.log(require('fs').statSync('.millennium/Dist/index.js').size)"
```

Expected: Two lines that read `constSysfsExpr Embedded 1 specific file for call at <...>\frontend\ports\pdf.ts:8:21` and `... pdf.ts:9:22`, a line that starts `build Succeeded passing all tests in`, then a number between 1850000 and 1980000 (the dry run gave 1912868; without pdf.js the production bundle is about 180000 bytes). **`Embedded 0 file(s)` is a failure** even though the build says Succeeded: pdf.js is then missing from the bundle; stop. The full build output also has an `@steambrew/ttc` update nag, a TS5096 `allowImportingTsExtensions` warning and `"constSysfsExpr" is imported ... but never used`: all expected, ignore them. The build writes only `.millennium/`, which git ignores.

#### Commit phase 4

Run `git status --short` inside `steam-cartridges/`: it must list exactly these paths (`M` or `??`) and nothing else; if anything else is listed, stop (failure rule).

```bash
git add frontend/surfaces/community/core.ts \
  frontend/surfaces/community/manual.ts \
  frontend/surfaces/community/index.ts \
  frontend/index.tsx \
  frontend/settings/panels/community.tsx \
  tests/community-core.test.ts
git commit -m "feat(steam-cartridges): F2c manual card and page viewer in the Community section"
```

The message has no `Co-Authored-By` or "Generated with" line (AGENTS.md Routine 6). Expected: `git status --short` prints nothing afterwards.

### Phase 5 — documentation (workspace root)

Paths in this phase are relative to the workspace root (`c:\game\millennium`), not `steam-cartridges/`. Run the commands from the workspace root.

#### Step 5.1 — ADR-0048

Append to the end of `docs/decisions.md`:

```markdown

---

## ADR-0048: A manual is a cover card that opens Steam's own viewer; pdf.js renders its pages on demand, behind a port

**Status:** Accepted · 2026-10-01 (user decisions 2026-09-30, features plan F2c) · Builds on [ADR-0046](#adr-0046-community-media-feeds-steams-own-community-content-loader-screenscraper-bytes-stay-in-memory)

### Context

The user wants a game's ScreenScraper manual (a PDF) as the first card of the Community section, at the size of an
ordinary card, opened and scrolled on a controller too. Steam's Community Content cards are Artwork (3), Video (4),
Screenshot (5) and Guide (9, 10); a Guide opens a Valve page. Steam's image viewer (module 94715) renders its `children`
in a scrolling area that the D-pad scrolls. ScreenScraper's URLs carry the user's account. Steam's CEF lists an
`application/pdf` plugin, but an embedded PDF takes the D-pad. Found while planning: ScreenScraper lookups sent
RetroAchievements console ids as ScreenScraper `systemeid` (RetroAchievements' 3 is the SNES, ScreenScraper's 3 the NES),
so a ROM shortcut never matched (the test game, Captain Commando, answered `not-found` for every key).

### Decision

- **Card:** an Artwork card with an inline SVG cover, 1280 x 720 (the size IGDB screenshot cards already lay out as one
  ordinary cell), first in `domain/community-media.visibleMedia`, behind the existing `communityShowManuals` setting.
- **Backend:** `screenscraper_media.manual_item` names the best-region `manuel(<region>)` key; `GetManualChunk` returns
  the PDF in 1 MiB base64 chunks: chunk 0 downloads it into memory (48 MiB cap, `net.get_binary`), the last chunk frees it,
  one document at a time. No URL leaves the backend; nothing is written to disk.
- **Placement (ADR-0039, ADR-0044):** the community surface emits its own result event `community.manual-opened` from an
  effect of the page column it renders as the viewer's `children`; `app/manuals` (subscribed by `install()`) reads the
  chunks through `ports/backend`, renders the pages through `ports/pdf` and puts them on `kernel/manual-shelf` (2 manuals,
  page URLs released on eviction); the surface reads the shelf. No surface is given a function that reaches the backend.
- **pdf.js 4.10.38, pinned:** 5.4.624 and 6.3.289 hang in `getDocument` in Steam's Chromium 126 (verified live
  2026-10-01; 4.10.38 rendered a test PDF in 136 ms). `ports/pdf.ts` is the only file that uses it: the library and its
  worker are embedded as text (`constSysfsExpr` with `basePath`) and evaluated from `blob:` URLs when the first manual
  opens; the worker is a module worker given as `workerPort`; pages are drawn on an `OffscreenCanvas` and kept as JPEG
  `blob:` URLs, 1400 px wide, at most 200 pages.
- **Phase 0:** `screenscraper_media.SS_SYSTEM` maps the console ids, and a ROM that ScreenScraper does not know falls back
  to the title search on that console.

### Consequences

- The production bundle grows from about 0.18 MB to about 1.9 MB, almost all of it two string literals that are not
  evaluated until a manual opens.
- While a manual renders, pdf.js adds its fonts to SharedJSContext's `document.fonts`; `destroy()` removes them (verified
  live). `disableFontFace` would leave the document alone but drops text set in non-embedded fonts (verified live), so it is
  not used.
- Reading a large manual blocks the Lua backend for the download, as an image download already does.
- `constSysfsExpr` with a `../..` path embeds nothing and the build still says Succeeded; the plan's build check looks for
  `Embedded 1 specific file`.
- Upgrading pdf.js needs a live render test in Steam's Chromium first.
- Phase 0 also changes which ScreenScraper record Game Info's ScreenScraper source gets for a ROM shortcut (it can now match).
- Rejected: Chromium's PDF embed (takes the D-pad), opening the PDF outside Steam (the URL carries the account; a temp
  file is against the no-disk rule), a Guide card (opens a Valve page), fetching the PDF with the media part (quota and
  memory on every page view), the surface calling `app/manuals` directly (ADR-0044), pdf.js's legacy build (larger, not needed).
```

#### Step 5.2 — kernel.md

In `docs/steam-cartridges/kernel.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
export interface MediaItem { kind: "video" | "screenshot" | "artwork"; source: "igdb" | "screenscraper"; youtube?; url?; thumb?; key?; width?; height?; title? }  // F2
```

Replace it with:

```markdown
export interface MediaItem { kind: "video" | "screenshot" | "artwork" | "manual"; source: "igdb" | "screenscraper"; youtube?; url?; thumb?; key?; width?; height?; title? }  // F2; "manual" F2c
```

In `docs/steam-cartridges/kernel.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
// kernel/media-bin.ts (F2): createMediaBin(release) -> { put(appid, key, { url, width?, height? }), get(appid, key) }; 8 shortcuts
```

Replace it with:

```markdown
// kernel/media-bin.ts (F2): createMediaBin(release) -> { put(appid, key, { url, width?, height? }), get(appid, key) }; 8 shortcuts
// kernel/manual-shelf.ts (F2c): createManualShelf(release) -> { get(appid, key), set(appid, key, { status, pages }), subscribe(listener) }; 2 manuals
// Events gains "community.manual-opened": { appid, key } (F2c: the community surface's result event; app/manuals renders the pages)
```

In `docs/steam-cartridges/kernel.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
| `tests/kernel.test.ts` | Unit tests for all four files |
```

Replace it with:

```markdown
| `frontend/kernel/manual-shelf.ts` | F2c: a manual's rendered pages (`blob:` URLs), waiting for the community viewer; 2 manuals, listeners told of every change (ADR-0048) |
| `tests/kernel.test.ts` | Unit tests for all four files |
```

#### Step 5.3 — service-media.md

In `docs/steam-cartridges/service-media.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
with a caption (`MEDIA_TITLES`). A video and a manual are not taken.
```

Replace it with:

```markdown
with a caption (`MEDIA_TITLES`). A video is not taken; a manual is its own item (§ Manuals).
```

In `docs/steam-cartridges/service-media.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
## Contract
```

Replace it with:

```markdown
## Manuals (features plan F2c, ADR-0048)

`screenscraper_media.manual_item(jeu)` gives one `{ kind = "manual", source = "screenscraper", key = "manuel(<region>)",
title = "Manual", width = 1280, height = 720 }` item, best region first (wor, us, eu, ss, jp); `media_service.ensure` adds it
after the images. Its bytes are not fetched with the part: `GetManualChunk(appid, key, index, title)` answers
`{ base64, index, chunks, size }` for 1 MiB of the PDF; chunk 0 downloads it (`download_document`: no `maxwidth`, the body
must start `%PDF-`, 48 MiB cap), the last chunk frees the copy, one document at a time. `app/manuals` reads the chunks in
order when the community viewer shows the manual's cover, renders the pages through `ports/pdf` (pdf.js 4.10.38) and puts
them on `kernel/manual-shelf`. The toggle is `communityShowManuals` ("Game Manuals").

ScreenScraper lookups send ScreenScraper's own system id (`SS_SYSTEM`, from the RetroAchievements console id), and a ROM
ScreenScraper does not know falls back to the title search on that console (F2c phase 0).

## Contract
```

In `docs/steam-cartridges/service-media.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
| `backend/record_rpc.lua` | `EnsureFresh` `media` branch; `GetMediaImage` |
```

Replace it with:

```markdown
| `backend/record_rpc.lua` | `EnsureFresh` `media` branch; `GetMediaImage`; `GetManualChunk` (F2c) |
| `frontend/app/manuals.ts` | F2c: reads a manual's chunks, renders its pages through `ports/pdf`, fills the manual shelf |
| `frontend/ports/pdf.ts` | F2c: the only pdf.js user (4.10.38, embedded, loaded on the first manual) |
| `frontend/kernel/manual-shelf.ts` | F2c: rendered manual pages as object URLs, 2 manuals |
```

In `docs/steam-cartridges/service-media.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
`tests/community-media.test.ts` (4), `tests/media-bin.test.ts` (3). Live: `tests/live/probes/community_media.mjs`.
```

Replace it with:

```markdown
`tests/community-media.test.ts` (4), `tests/media-bin.test.ts` (3). Live: `tests/live/probes/community_media.mjs`.
F2c: `test_media_service.lua` 64 → 82 checks (system ids, manual item, document download, chunks, `GetManualChunk`),
`tests/app-manuals.test.ts` (6), `tests/manual-shelf.test.ts` (4), one more in `community-media.test.ts`.
```

#### Step 5.4 — surfaces.md

In `docs/steam-cartridges/surfaces.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
**API:** `communityDiagnostics()` (`patched`, `feeds`, `served`, `firstPageLoads`, `cardsHidden`, `cardsHook`, `jsx`), exported by `index.tsx` for the live probe.
```

Replace it with:

```markdown
**Manuals (F2c, ADR-0048):** a `manual` item becomes an Artwork card whose image is an inline SVG cover
(`core.manualCoverUrl`: one image, a `#manual-<appid>-<key>` fragment per shortcut, so `viewerMeta` matches each cover to
its own manual). When Steam's viewer opens on a cover, the viewer wrapper passes `children` = the page column
(`manual.ts`, `createManualPages`) instead of `undefined`; Steam scrolls it on the D-pad and the mouse wheel. The column
reads `kernel/manual-shelf` (`manualOf`, `onManuals`) and, from an effect, emits the surface's own result event
`community.manual-opened` (`bus`), which `app/manuals` handles. No new Steam target: it is a branch of the existing
`jsx:community-cards` hook.

**API:** `communityDiagnostics()` (`patched`, `feeds`, `served`, `firstPageLoads`, `cardsHidden`, `cardsHook`, `jsx`), exported by `index.tsx` for the live probe.
```

#### Step 5.5 — rpc.md and the layer README

In `docs/steam-cartridges/rpc.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
| `GetMediaImage` | `record_rpc.lua` (→ `media_service.image`) | live |
```

Replace it with:

```markdown
| `GetManualChunk` | `record_rpc.lua` (→ `media_service.manual_chunk`) | live | F2c: `app/manuals.ts` reads a ScreenScraper manual in 1 MiB base64 chunks (never the URL) |
| `GetMediaImage` | `record_rpc.lua` (→ `media_service.image`) | live |
```

In `docs/steam-cartridges/rpc.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
- F2 (features plan): `GetMediaImage` added; `GetGameMedia`, `GetGameManual`, `GetGameTrailers`, `GetGameCommunityLinks` deleted with `igdb_community.lua`.
```

Replace it with:

```markdown
- F2 (features plan): `GetMediaImage` added; `GetGameMedia`, `GetGameManual`, `GetGameTrailers`, `GetGameCommunityLinks` deleted with `igdb_community.lua`.
- F2c (2026-10-01): `GetManualChunk` added (ADR-0048).
```

In `docs/steam-cartridges/README.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
| Ports: the backend RPC client (`transport.ts`, `backend.ts`) and the image fetch (`image.ts`, icon plan) | current (M4c, M5b) — [rpc.md](rpc.md) |
```

Replace it with:

```markdown
| Ports: the backend RPC client (`transport.ts`, `backend.ts`), the image fetch (`image.ts`, icon plan) and the PDF renderer (`pdf.ts`, the only pdf.js user, F2c) | current (M4c, M5b, F2c) — [rpc.md](rpc.md) |
```

#### Step 5.6 — Changelogs

In `CHANGELOG.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
This repo is private and unversioned; entries are grouped by date.
```

Replace it with:

```markdown
This repo is private and unversioned; entries are grouped by date.

- **steam-cartridges: F2c manuals: a ScreenScraper manual is the first Community card and opens page by page (2026-10-01, ADR-0048)**: the manual is an Artwork card with an inline cover (1280 x 720, an ordinary cell); opening it shows Steam's own image viewer with the pages under the cover, scrolled by the D-pad and the mouse wheel. The backend reads the PDF into memory and hands it over in 1 MiB chunks (`GetManualChunk`); `app/manuals` renders the pages with pdf.js 4.10.38 (`ports/pdf.ts`; 5.4 and 6.3 hang in Steam's Chromium 126, found live) and keeps them on `kernel/manual-shelf`. The community surface reports `community.manual-opened` from an effect, so no surface reaches the backend (ADR-0044). Found while planning: ScreenScraper lookups sent RetroAchievements console ids as `systemeid` (SNES 3 is NES on ScreenScraper), so ROM shortcuts never matched; fixed with `SS_SYSTEM` and a title fallback. Also found: `constSysfsExpr("../../...")` embeds nothing while the build still succeeds; the `basePath` form works. `test_media_service` 64 → 82, `test:ts` 240 → 253, production bundle about 0.18 → 1.9 MB. Live verification pending (plan § 11).
```

In `steam-cartridges/CHANGELOG.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
## [Unreleased]
```

Replace it with:

```markdown
## [Unreleased]

- **Added: game manuals in the Community section (F2c, 2026-10-01)**: with a ScreenScraper account, a game's manual is the first card of its Community section; open it to read every page, on a controller too. Setting: Community & Media → Game Manuals.
- **Fixed: ScreenScraper could not find ROM games (F2c, 2026-10-01)**: lookups asked for the wrong console (for example NES for an SNES game). Screenshots, artwork and Game Info from ScreenScraper can now appear for those games.
```

#### Step 5.7 — TASK.md and this plan's status

In `TASK.md`, find this text (it occurs exactly once; it may be the start of a longer line, keep the rest of that line):

```markdown
7. **F2c manuals** (ScreenScraper manual as the first card of the Community section, opened and scrolled in Steam's own viewer):
   [steam-cartridges-f2c-manuals-plan.md](docs/plans/steam-cartridges-f2c-manuals-plan.md) is ready to execute (dry-run
   2026-10-01). Its phase 0 fixes the ScreenScraper system ids, without which no ROM game matches ScreenScraper. ScreenScraper
   videos and IGDB links are not started; ScreenScraper stays limited to its image types and the manual (title screen,
   screenshot, fanart, boxes, mixes, cartridge, flyer, HyperSpin theme) by the user's decisions (2026-09-30).
```

Replace it with:

```markdown
7. **F2c manuals** (ADR-0048): code committed (2026-10-01), waiting for the live verification in
   [its plan § 11](docs/plans/steam-cartridges-f2c-manuals-plan.md) (deploy, then Captain Commando in Big Picture).
   ScreenScraper videos and IGDB links are not started; ScreenScraper stays limited to its image types and the manual
   (title screen, screenshot, fanart, boxes, mixes, cartridge, flyer, HyperSpin theme) by the user's decisions (2026-09-30).
```

Run (workspace root; it rewrites line 3 of this plan, its status line):

```bash
sed -i '3s/^\*\*Status:\*\* Ready to execute\.$/**Status:** Executed (phases 0-5 committed); live verification (§ 11) pending./' docs/plans/steam-cartridges-f2c-manuals-plan.md
```

Then `sed -n 3p docs/plans/steam-cartridges-f2c-manuals-plan.md` must print exactly `**Status:** Executed (phases 0-5 committed); live verification (§ 11) pending.`

#### Check phase 5

From the workspace root:

```bash
grep -c "^## ADR-0048" docs/decisions.md
grep -c "manual-shelf" docs/steam-cartridges/kernel.md
grep -c "^## Manuals (features plan F2c" docs/steam-cartridges/service-media.md
grep -c "Manuals (F2c, ADR-0048)" docs/steam-cartridges/surfaces.md
grep -c "GetManualChunk" docs/steam-cartridges/rpc.md
grep -c "pdf.ts" docs/steam-cartridges/README.md
grep -c "F2c manuals" CHANGELOG.md
grep -c "F2c, 2026-10-01" steam-cartridges/CHANGELOG.md
```

Expected, one number per line: `1`, `2`, `1`, `1`, `2`, `1`, `2`, `2` (the seventh is the plan's own CHANGELOG entry of
2026-10-01 plus the new one).

#### Commit phase 5 and push

`git status --short` (workspace root) must list exactly these ten paths:

```bash
git add docs/decisions.md \
  docs/steam-cartridges/kernel.md \
  docs/steam-cartridges/service-media.md \
  docs/steam-cartridges/surfaces.md \
  docs/steam-cartridges/rpc.md \
  docs/steam-cartridges/README.md \
  CHANGELOG.md \
  steam-cartridges/CHANGELOG.md \
  TASK.md \
  docs/plans/steam-cartridges-f2c-manuals-plan.md
git commit -m "docs: F2c manuals (ADR-0048), layer docs, changelogs, TASK"
git push origin main
```

Expected: `git status --short` prints nothing; `git log --oneline -6` shows the six commits of phases 0 to 5 in order on
top of the commit that added this plan; the push ends with `main -> main`.

## 10. After the last commit

The implementer's work ends here. Do not deploy. Report: the six commit hashes, the outputs of steps 3.9, 4.6 and 4.7, and
the ticked guardrail table (§ 8).

## 11. Live verification (the user, or a verifier with the user's go-ahead)

Deploy and restart: `powershell -ExecutionPolicy Bypass -File dev.ps1` (inside `steam-cartridges/`). Wait for Steam, then
switch to Big Picture. The CDP snippets run from `steam-cartridges/` with this wrapper; `EXPR` is the expression in each check:

```bash
node --input-type=module <<'EOF'
import { evalIn } from "./tests/live/cdp.mjs";
console.log(await evalIn("SharedJSContext", `EXPR`));
EOF
```

| # | Check | PASS |
| --- | --- | --- |
| 1 | `C:\game\steam\logs\webhelper_js.txt` after the restart | no line with `exceeded its error budget` |
| 2 | Open Captain Commando in Big Picture, wait 10 s, then `EXPR` = `(async () => { const r = JSON.parse(await Millennium.callServerMethod("steam-cartridges-dev", "GetAllRecords", { payload: "{}" })); const m = r.records["3858120657"]?.media; return JSON.stringify({ status: m?.status, ss_id: m?.data?.ss_id, items: (m?.data?.items ?? []).map((i) => i.kind + ":" + (i.key ?? i.source)) }); })()` | `status` `ok`, `ss_id` a number, at least one `screenshot:` or `artwork:` item with a ScreenScraper key (phase 0 works) |
| 3 | Same output | exactly one `manual:manuel(<region>)` item. **If check 2 passes but there is no manual item:** run `EXPR` = `(async () => { const out = {}; for (const key of ["manuel(us)", "manuel(eu)", "manuel(wor)", "manuel(jp)", "manuel()"]) { const r = JSON.parse(await Millennium.callServerMethod("steam-cartridges-dev", "GetManualChunk", { payload: JSON.stringify({ appid: 3858120657, key, index: 0, title: "Captain Commando" }) })); out[key] = r.error ?? ("chunks " + r.chunks); } return JSON.stringify(out); })()`; all `unknown key` means the media type is not `manuel`: record it in TASK as a blocker (the next step is a credential-free trace of the `jeu.medias` types, as `GetDiagnostics.ss_search` does for names) |
| 4 | The COMMUNITY tab | the first card (top left) is the MANUAL cover, the size of one ordinary card; the other cards fill the rows after it |
| 5 | `EXPR` = `JSON.stringify(PLUGIN_LIST["steam-cartridges-dev"].communityDiagnostics().feeds)` | `3858120657` maps to the number of cards on the tab (no card dropped by Steam's row layout) |
| 6 | Note `document.fonts.size` (`EXPR` = `document.fonts.size`), then open the manual card | Steam's viewer: Close, "Added by ScreenScraper", the cover, then "Loading the manual..." replaced by grey page boxes that turn into pages, first page first |
| 7 | D-pad down, repeatedly | the viewer scrolls through every page to the last one; Close closes it |
| 8 | When all pages are shown, `EXPR` = `document.fonts.size` | the same number as noted in check 6 (pdf.js removed its fonts) |
| 9 | Open the manual again | the pages show at once (no "Loading") |
| 10 | AM2R and Super Mario World (Big Picture) | no manual card; their F2 cards unchanged |
| 11 | Settings → Community & Media → Game Manuals off; leave and reopen Captain Commando | no manual card. Turn it back on |
| 12 | Desktop mode: Captain Commando's Community section | the MANUAL card is first. Opening it may fail on this machine (`CVRPathHelpers not found`, native cards too, TASK F2 item 2): note it, not a failure of this plan |
| 13 | Routine 1 on Captain Commando (four views; Game Info may now show ScreenScraper data) and Routine 2 (Captain Commando → a native game → Captain Commando) | all sections render both times |
| 14 | `npm run test:live` | `12/12` |
| 15 | `find /c/game/steam -mmin -120 -iname "*.pdf"` (within two hours of check 6) | prints nothing (no manual on disk) |

Record the results in `TASK.md` (item 7) and the workspace `CHANGELOG.md` entry of phase 5; then F2c leaves TASK.

## 12. Dry-run record

- **Base:** workspace commit `a283037` (`steam-cartridges` copied with `git ls-files`, `pnpm install --frozen-lockfile`).
- **Applied in order:** every step of phases 0 to 4 by script, from the very blocks printed above (a block not found exactly
  once aborts the script); phase 5's edits on copies of the ten files, with the post-plan `TASK.md`.
- **Outputs:** each "Expected output" block above is the captured output of that step (paths shortened to `<plugin dir>`).
  Totals: `test_media_service` 64 → 67 → 82 checks; `test:ts` 240 → 251 → 253; `npm run check` clean after every TS step
  except inside step 4.3 (its check is a diff stat; `tsc` passes again after 4.4); production bundle 1,912,868 bytes, both
  files embedded. Every other Lua suite kept its count (`test_steam_store` 91, `test_migrate` 8, `test_identity` 18,
  `test_metadata_service` 64, `test_art_service` 60, `test_ach_service` 24, `test_freshness` 47; `test_backend` 77 passes and
  its 3 known failures).
- **Live facts used** (2026-10-01, read-only except the three pdf.js test renders, which wrote nothing to disk): § 2.1, § 2.3.
- **Not verified before execution:** the media type `manuel` (§ 2.2, § 11 check 3), the SNES id 4 against a live ScreenScraper
  answer (§ 11 check 2), the cover's place in Steam's grid with 20+ cards (§ 11 checks 4 and 5), a real scanned manual's size
  and render time.

## 13. Out of scope

ScreenScraper videos, IGDB links (`communityShowExternalLinks`), choosing a manual by Steam's UI language, a manual for a
mapped (Steam-matched) game, the desktop image viewer failure (`CVRPathHelpers`), and caching manuals across Steam restarts.
