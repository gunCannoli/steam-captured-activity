# steam-cartridges: community tab crash on Chrono Trigger (SNES) and slow population — investigation

**Status:** Q1 root-caused and fixed, Q2 measured (§ 6, 2026-10-01). Written by the agent that shipped `df6326d` and `9a174b6`; findings by a second agent. S1 done (ADR-0051). Open: § 7 by the user.
**Kind:** an investigation, not a mechanical patch plan: the deliverable is a *finding* (cause, evidence, recommended
fix) the user approves, then a normal fix plan under [the plan standard](README.md). Do not skip to a fix.

Two questions, in this order:

1. **Why does the plugin's Lua backend crash when the COMMUNITY tab of a shortcut that has a manual loads?** (blocking: it
   takes every RPC of the plugin down until Steam restarts)
2. **What can safely speed up populating the community tabs?** (a first visit takes about a minute for a game with ~27
   cards; the user's wish: parallel loading). Question 2 depends on question 1: the backend may not take concurrent calls.

Read first: [AGENTS.md](../../AGENTS.md) (Routine 0, the Steam lock, applies to everything below that touches Steam),
[TASK.md](../../TASK.md), [steam-cartridges-f2c-manuals-plan.md](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/steam-cartridges-f2c-manuals-plan.md),
[ADR-0046 / ADR-0048](../decisions.md), [steam-cartridges/service-media.md](../steam-cartridges/service-media.md),
[knowledgebase.md § Backend RPC crash trap](../knowledgebase.md) (an unregistered method name, or an `error()` that escapes,
crashes the backend with an access violation).

---

## 1. What happened (evidence, all from this machine, 2026-10-01)

The plugin under test is `steam-cartridges-dev` (`C:\game\steam\millennium\plugins\steam-cartridges-dev`). The test game is
**Chrono Trigger (SNES), a non-Steam shortcut, appid `2710585679`**, which has a ScreenScraper manual (7.5 MiB PDF,
80 pages; it worked in desktop and Big Picture before today's changes: CHANGELOG / TASK F2c item 7). AM2R
(`4263274102`, 15 cards, no manual) never crashed.

### The changes made today (all in `git log`, newest first)

| Commit | Change that matters here |
| --- | --- |
| `9a174b6` | Parallel images reverted to one at a time (`IMAGE_CONCURRENCY = 1`, `frontend/app/media.ts`). The early manual start (`prefetch`) removed. The disk-cover read goes through the manuals queue (`frontend/app/manuals.ts`, `cover()`). |
| `df6326d` | **New backend code:** `backend/manual_cover_store.lua` (new file), `media_service.manual_cover` / `save_manual_cover`, RPCs `GetManualCover` / `SaveManualCover` in `backend/record_rpc.lua`, registered in `backend/main.lua` (lines 63-64). Frontend: `ports/backend.ts`, `ports/image.ts` (`objectUrlToBase64`), `app/manuals.ts` (`coverFromDisk`, `saveCover`). Also images 3 at a time + manual cover started early, and `ports/pdf.ts` `renderCover` changed (bare first page, JPEG). |
| (uncommitted before) | `ports/pdf.ts` first change: transparent WebP cover. |

### Crash 1 (deployed `df6326d`: parallel images, early manual, disk cover)

`webhelper_js.txt` (Steam logs, `C:\game\steam\logs\`):

```
21:27:17  Viewed shortcut 2710585679 (desktop).
21:27:19  Millennium Frontend: Received real-time crash event for plugin: steam-cartridges-dev
21:27:47  Community media 2710585679: 16/27 cards, images in 30025 ms
```

16 of 27 cards and exactly ~30 s: the backend died about 2 s after the page opened and the RPCs still in flight ran into the
30 s `callServerMethod` limit. **No crash folder was written for this one** (see below).

### Crash 2 (deployed `9a174b6`: images serial, no early manual, disk cover through the queue)

```
21:31:23  Loading content 2710585679
21:31:32  Community media 2710585679: 26/27 cards, images in 10131 ms      <- images done, record updated
21:31:33  Millennium Frontend: Received real-time crash event for plugin: steam-cartridges-dev   <- ~1 s later
21:31:37  Millennium Error: failed to send RPC to child: steam-cartridges-dev   (the backend is dead)
```

A crash report **was** written: `C:\game\steam\millennium\crashes\steam-cartridges-dev-20261001-212855\` (`crash.log` +
`crash.dmp`, 1 MB). `crash.log`: `EXCEPTION_ACCESS_VIOLATION (0xC0000005)`, `Backend File: ...\backend\main.lua`, Millennium
v3.5.0, commit `6ab9724a`. **Nobody has opened the `.dmp`.** (Older crash folders from 2026-09-26..28 exist too: ten in
total: the access violation is a known failure mode of this plugin, not new.)

### The backend's own log for crash 2 (pasted by the user)

```
21:28:56 [backend] Backend loaded.            21:29:06 [backend] Frontend loaded.
21:29:59 ScreenScraper name search for "AM2R ...": matched game 273188
21:31:02..03 Searching IGDB for 'AM2R ...' ... Matched IGDB game 'AM2R: Return of Samus' (ID 27238)
=== Millennium Plugin Crash Report ===  EXCEPTION_ACCESS_VIOLATION (0xC0000005), Faulting Thread 26840, PID 27180
Crash dump: ...\crashes\steam-cartridges-dev-20261001-212855
```

Read it carefully:
- **Not one backend line mentions Chrono Trigger** (`2710585679`) between the last AM2R line (21:31:03) and the crash (~21:31:33).
  Nothing is logged by `EnsureFresh` for it (its ScreenScraper id was cached), by `GetMediaImage`, or by the manual calls: the
  backend writes **no breadcrumb for any of the calls that matter**, so the log cannot say which RPC died. That is why step 2
  below (breadcrumbs) is cheap and decisive.
- The crash folder's **name is the backend's start time** (`212855` = 21:28:55, the line before "Steam root"), not the crash time.
  The crash itself was ~21:31:33. Do not read the folder name as when it died.
- The crash report names `backend\main.lua` as the backend file: that is the entry script of the Lua state, not the faulting
  module. The faulting frame is only in `crash.dmp`.
- The backend ran **2.5 minutes without incident** (AM2R lookups, IGDB OAuth, many other shortcuts' calls) before the first
  Chrono Trigger call: it is not a start-up or a general instability crash; it is specific to what Chrono Trigger asks for
  (a manual).

### What the two crashes share

- Both happen **within 1-2 s of the images being in and the record being updated**, i.e. the moment the manual's cover job
  starts (`record.updated` for `media` -> `manuals.cover()` -> first backend call for that manual).
- Serial images (crash 2) ruled out **parallel image downloads as the only cause**: the crash is still there with
  `IMAGE_CONCURRENCY = 1`. Crash 1 cannot be separated from it (three variables changed at once).
- **`<data dir>/manual_covers/` does not exist** (`C:\game\steam\millennium\config\steam-cartridges\`). `manual_cover_store.dir()`
  creates it on first use, so **the first call into `manual_cover_store` never got as far as creating the folder**. That points
  at the new code path (`GetManualCover`, the first backend call of the cover job), not at the chunk download. It is the
  single best lead, but it is circumstantial.
- Not seen with AM2R (no manual), nor when manuals were last live-checked (before `df6326d`).

## 2. Question 1: hypotheses to test, most likely first

For each: how to confirm or kill it. **Change one thing at a time** and say which build you tested.

**H1. `GetManualCover` / `manual_cover_store.lua` itself crashes the backend.** Suspects, all in
`backend/manual_cover_store.lua` and `media_service.manual_cover`:
- the module uses the global `fs` (`fs.is_directory`, `fs.create_directories`) **without `local fs = require("fs")`**, unlike
  `backend/data_dir.lua:10` and `backend/shortcut_icon.lua:9`. The calls sit inside a `pcall`, so it should only be a nil
  index error, but check it: this is the one real defect found by reading;
- `io.open` of a `.jpg` name built from a key containing `(` `)` (`manuel(us)`, sanitised by `gsub("[^%w]", "_")`);
- `utils.base64_encode` of a large string, `shortcut_icon.decode_base64` (pure Lua, `string.char` per byte) on a ~100-300 KB
  cover: a slow loop is not a crash, but check the cost.
Test: deploy a build where **only** `GetManualCover` / `SaveManualCover` are removed from `record_rpc.lua` and `main.lua`, and
`frontend/app/manuals.ts` is told there is no disk cache (do not pass `coverCache`; `cover()` then skips the disk path). If
Chrono Trigger no longer crashes, H1 is the cause.

**H2. An RPC that Millennium does not know.** knowledgebase: a method name with no registered global crashes with this exact
exception. Check that `GetManualCover` and `SaveManualCover` are globals in the **running** backend (`main.lua:63-64` is deployed;
verify at runtime, e.g. from the Steam console `callServerMethod("steam-cartridges-dev", "GetManualCover", ...)` on a
non-shortcut appid, which must answer `{ error = "not a shortcut" }`, not crash). Also check `rpc.method()` wraps both.

**H3. The manual chunk path (`GetManualChunk`, `media_service.manual_chunk`).** It worked before today for the same game, but
is exercised right after the disk lookup now. Look at: a 7.5 MiB PDF held in a Lua string (`manual_doc`), `body:sub` + base64
of 1 MiB pieces, the memory this needs, and **two manuals or a manual plus an image call overlapping** (the queue in
`app/manuals.ts` serialises manual work only; `app/media.ts` image downloads and `EnsureFresh` for other shortcuts are not in
that queue, so a manual download can still overlap another backend call, for example the 15 `Enriched ... Game Info` lines the
log prints around each page open).

**H4. Concurrency inside the single Lua state.** Crash 1 had parallel image downloads beside a manual download. The backend
is one LuaJIT state; `net.get_binary` and `ss_jeu` run blocking. If any two RPCs can execute at once, shared module state
(`manual_doc`, `media_store`'s cache, throttles) is unsafe. Find out **how Millennium dispatches `callServerMethod`**
(one thread per call? one worker?) before assuming either: read Millennium's source or a dump, do not guess. This also
decides question 3 below.

**H5. The crash is old and unrelated to today's code** (ten crash folders exist back to 09-26) and Chrono Trigger just
reproduces it. Kill it by loading the commit before `df6326d` (`git stash` is not needed: `git worktree` it, see
[the worktree junction trap](../../README.md) in the user's memory: delete the `node_modules` junction before
`git worktree remove`) and opening Chrono Trigger there 3 times.

### How to get the real answer instead of bisecting blind

1. **Read the minidump.** `crash.dmp` is a normal Windows minidump. Open it with WinDbg / `cdb` (`cdb -z crash.dmp -c "!analyze -v; k; q"`) or Visual Studio, with Millennium's symbols if available (the matching `millennium.dll` commit is `6ab9724a`). The faulting stack names the native function (Lua C API, the RPC dispatcher, `fs`, ...). **Start here; it may make the bisect unnecessary.** Report the top 15 frames.
2. **Backend breadcrumbs.** Add `logger:info` lines at the entry and exit of `GetManualCover`, `SaveManualCover`, `GetManualChunk`
   (index, byte counts) and `GetMediaImage`, then reproduce and read the **backend** log (find where the Lua `logger` writes: the
   Millennium log folder, `C:\game\steam\millennium\logs` or the plugin's console; `steam-debug.md` § 8 and
   `knowledgebase.md` list it). The last line before the crash names the call. Remove them afterwards (or keep them, behind
   the existing debug setting, if one exists).
3. **Reproduce without the UI.** A script that calls the RPCs directly through CDP (`127.0.0.1:8080`, SharedJSContext target)
   in the order the frontend does (`EnsureFresh` media -> 27x `GetMediaImage` -> `GetManualCover` -> `GetManualChunk` 0..7),
   so a bisect run is one command, not a manual click-through. Existing helpers: `steam-cartridges/tests/live/cdp` (see
   `tests/live/probes/community_media.mjs` for the pattern). The Steam lock is needed for it, and **a crash needs a Steam
   restart to bring the backend back**: budget for it.

### Expected output of question 1

A short written finding appended to this file (§ 6): the faulting frame or the confirmed cause, the commit or line, how it
was proven (which build crashed, which did not), and the **smallest fix**. If it is H1, the fix is probably one `require("fs")`
plus whatever the dump says; if it is H4, see question 3.

## 3. Question 2: speeding up population of the community tabs

Where the time goes is **not measured**. The timing lines the agent added (shipped in `df6326d`, in the Steam log):

```
Community media <appid>: N/M cards, images in X ms          (frontend/app/media.ts)
Manual cover <appid>: from disk in X ms | rendered from the PDF in X ms     (frontend/app/manuals.ts)
```

Known data points: AM2R, 15 images, first visit after a restart: 30.6 s with 3 in parallel (`IMAGE_CONCURRENCY` was 3 then);
Chrono Trigger, 26 images, serial: 10.1 s. These two disagree (more images, less time), so **the per-image cost varies a lot
(ScreenScraper CDN, image size, the `maxwidth=1280` scaling on their side)**: measure per image before tuning anything.

### What runs today, in order, for a shortcut's first visit

1. `EnsureFresh(media)` in the backend (IGDB query + ScreenScraper `jeu` lookup, `media_service`).
2. One `GetMediaImage` RPC per ScreenScraper image, **one at a time** (`app/media.ts`), each a blocking download in the backend.
   ScreenScraper images are held as object URLs in `kernel/media-bin` (memory only: a Steam restart repeats all of it).
3. `record.updated` -> the community surface re-renders the feed. If the shortcut has a manual and its cover is not shelved,
   the feed is **held up to `COVER_WAIT_MS` = 8 s** (`surfaces/community/core.ts:246`) for it, then served with the placeholder.
4. The manual cover job (serial queue in `app/manuals.ts`): disk lookup (`GetManualCover`), else `GetManualChunk` 0..n (the PDF in
   1 MiB base64 pieces), pdf.js opens it in the page, renders page 1, stores it (`SaveManualCover`).
5. Steam keeps the feed it was first served: a cover that arrives after step 3 does not replace the placeholder until the page is
   reopened (observed; ADR-0048 notes it).

### Options to evaluate (rank them by measured gain and risk; do not implement before the crash is understood)

| # | Option | Gain | Risk / open question |
| --- | --- | --- | --- |
| S1 | **Persist the ScreenScraper images on disk** (like the new manual covers) so a Steam restart does not download them again. Today the bin is memory only. | Every visit after the first, across restarts: ~0 s. Likely the biggest win for repeat use. | Disk use (1280 px images x 27 per game, give a cap and an eviction); the ADR-0046 rule "no image bytes on disk, no ScreenScraper URL on disk" must be amended by a **new ADR** (bytes are fine, URLs are not). |
| S2 | **Backend parallelism** (images N at a time, or the manual during the images). | Up to Nx on the image phase. | **Crashed the backend, or is suspected to (H4).** Only after question 1 says how Millennium dispatches calls; if calls are already serialised by Millennium, parallel frontend calls only queue behind each other and hit the 30 s timeout. Prove with a controlled test before any retry. |
| S3 | **Do the downloads in the frontend** (`fetch` of the image URL in the page) instead of the backend. | Truly parallel (browser), no Lua state involved. | The ScreenScraper URL carries the account (`devid/devpassword/ssid`): it must not reach Steam's DOM or logs (ADR-0046). Would need a signed/redirect URL or a local proxy. Probably a no-go; document why. Note the shortcut-icon code already learned that the backend cannot download binary (NUL byte) via `http.get` but `net.get_binary` works. |
| S4 | **Show the feed before the images are in** (progressive: cards appear as each image lands). | Perceived time: the first card in ~1 s. | Steam serves page 1 once; it keeps what it was given (step 5). Needs the loader wrap (`AddCommunityContent`) or re-serving; check `surfaces/community/index.ts` and the ADR-0046 notes before assuming. |
| S5 | **Smaller images**: lower `maxwidth` for cards (the card is 960x540 at most; viewer needs more) or JPEG only. | Fewer bytes per image. | Viewer quality; ScreenScraper may ignore the param for some media. |
| S6 | **Warm the cache in the background** after Steam starts or when a library page is idle, so the first visit is already warm. | First visit fast. | ScreenScraper rate limits and the user's account threads (free accounts: 1-2); ADR on "never a storm" (the first `GetNewShortcuts` call seeds without fetching for the same reason). |
| S7 | **Cover without the whole PDF**: ScreenScraper may serve a page-1 thumbnail, or fetch only the first N KB with an HTTP `Range` request (a PDF's first page is not always in the first bytes: linearised PDFs are). | Cover in seconds instead of downloading 7.5-48 MiB. | Check `Accept-Ranges` on the real URL **without logging the URL**; pdf.js can range-load, but the backend sends chunks through RPC. |
| S8 | **The 8 s cover wait** (`COVER_WAIT_MS`). Lower it, or raise it, based on the measured first-visit cover time. | Tunes the trade-off between a delayed feed and a placeholder card. | Depends on S1/S7. |

Also measure, because the user reported "a couple of minutes": the **whole** path from clicking the game to the last card,
including Steam's own work (the `Enriched native Game Info ...` lines the plugin logs for every shortcut on each page open: ~15
lines in the same second, see the log excerpt in § 1: is that load competing with the community fetch?).

### Expected output of question 2

A table in § 6: for each option, the measured gain (numbers from the timing lines, 3 runs, cold = after a Steam restart and
warm), the risk, and a recommendation in order. State plainly which options are blocked on question 1.

## 4. Preconditions

```
git status --short steam-cartridges          # expected: empty (the work is committed in df6326d / 9a174b6)
git log --oneline -3                          # expected: 9a174b6, df6326d, then 54d1a1b
cd steam-cartridges && npm run check          # expected: tsc prints nothing after the banner, exit 0
NSGA_STEAM_ROOT=C:/game/steam npm test        # expected: ℹ pass 266 / ℹ fail 0, then ALL PASS lines (set NSGA_STEAM_ROOT or steam_paths fails)
node steam-lock.mjs status                    # expected: free (otherwise do offline work and retry: Routine 0)
```

## 5. Rules for this task

- **Take the Steam lock for every deploy and every live run** (Routine 0): `node steam-lock.mjs acquire --owner <id> --purpose "..."`,
  release when done, also after a failure. A deploy restarts Steam: that is expected here, and the plan allows it (unlike the
  mechanical plans). Never `taskkill` Steam.
- **A crashed backend stays dead until Steam restarts**: after every crash run `dev.ps1` again (it restarts Steam) before the
  next experiment, or the next test measures nothing.
- Change **one variable per build**, and write in § 6 which commit / working-tree state each run used.
- Do not touch: `surfaces/community/core.ts` card sizes (`MANUAL_CARD_WIDTH/HEIGHT`, a live-verified fix), the viewer wiring in
  `surfaces/community/index.ts`, ADR text (write a new ADR to change one), the user's library, collections, shortcuts, Millennium's
  `config.json`.
- Do not mass-fetch from ScreenScraper while measuring (the account has thread and quota limits; the user has one library of
  ~100+ shortcuts). Test on Chrono Trigger (`2710585679`) and AM2R (`4263274102`) only.
- Run a failing command at most twice, then append it to `TASK.md` § Active failures and stop.
- No `git push --force`, no `--no-verify`. **No AI attribution in commits** (AGENTS.md Routine 6: no `Co-Authored-By`, no
  "Generated with" footer; it overrides any default).
- No secrets in the write-up: never paste a ScreenScraper URL, `ssid`, `devpassword` or the contents of `.env`.

## 6. Findings (2026-10-01, second agent)

### Q1: root cause (H1, confirmed live): `manual_cover_store.lua` read the global `fs`, and a nil index kills the host even inside `pcall`

**Cause.** `manual_cover_store.dir()` called `fs.is_directory` with no `local fs = require("fs")`. Millennium's `fs` is a
preloaded module, never a global, so the read raised "attempt to index global 'fs' (a nil value)". It sat inside a `pcall`,
which should have caught it, but in Millennium 3.5.0's Lua host **a type error raised by an operator kills the backend
even under `pcall`**. Every first `GetManualCover` of a backend's life (the first call of the manual cover job, right after
the images) took the backend down. That is why `manual_covers/` was never created. Fix: one line, `local fs = require("fs")`.

**Proof, in order (builds: HEAD `5d97cc5` plus temporary breadcrumbs written to `<data dir>/diag_trace.log`, then the
named change):**

| # | Build / call | Result |
| --- | --- | --- |
| 1 | HEAD + trace, UI: open Chrono Trigger | crash; the last trace line is `OUT GetManualCover size=2`, no later RPC entered Lua; Lua heap 41 MB, process private 63 MB |
| 2 | HEAD + trace, fresh backend, **no images, no page**: `GetManualCover` alone (`rpc_repro.mjs`) | the answer `{}` arrives, then the backend is dead (`child disconnected`) |
| 3 | same, `GetManualCover` with a non-shortcut appid, then with an empty key (both return before the store) | alive |
| 4 | same, with the real appid and key (enters `manual_cover_store`) | dead |
| 5 | **+ `local fs = require("fs")`** (V1): `GetManualCover` twice | alive, `manual_covers/` created |
| 6 | V1 + a temporary probe RPC raising one error kind inside `pcall` per call | `error("x")`, `error({})`, calling nil: caught; **nil index and `{} + 1`: backend dead** |
| 7 | final build (fix, no trace), UI: Chrono Trigger 3 times, then once after a restart | no crash event, no crash folder; cover rendered once (3.2 s), then **from disk in 14 ms** |

**The minidump** (`steam-cartridges-dev-20261001-212855`, read with Python `minidump` + `pefile` + `capstone`, Millennium
source at `6ab9724a`): access violation at `millennium.luavm64.exe+0x2b117`, a NULL read in nlohmann::json's
`json_value::destroy` (object case), reached from a C++ exception unwind. The exception being unwound is
`std::bad_alloc` (ThrowInfo `.?AVbad_alloc@std@@`), thrown while `rpc_client::run` -> `respond(id, result)` copied the
result into the reply (`std::map` node copy). Nothing else was running (one busy thread; the other five wait), the machine had
47 GB of commit free and Millennium sets no job memory limit: the allocation size was garbage, memory damaged by the error,
not a shortage. Crash 1 and the build-1 crash wrote no crash folder at all. The ten older dumps (09-26..09-28) are a
different crash (`+0x1087c`, a write in `handle_evaluate`, the RPC dispatcher: the known unregistered-method trap) and
predate `bin_http.lua`, so **H5 is killed**.

**The other hypotheses.** H2 killed: both methods are registered and answer. H3 killed: the PDF download (`GetManualChunk`
0..7) runs cleanly on the fixed build (chunk 0 4.0 s, the other seven 0.6 s together). H4: the Lua host is **single-threaded**
(`rpc_client::run` handles one request at a time; downloads are blocking WinINet FFI calls), so two RPCs never run at once.
It is re-entrant only while a Lua call waits on the parent (`http.*`, `config.*`, `millennium.*` go through
`rpc_client::call`, which serves incoming requests while it waits); the image and manual downloads do not (WinINet), so
they cannot be interleaved.

**Guards added:** `tests/test_globals.lua` (in `npm test`) reads every backend file's LuaJIT bytecode and fails on a global
read that is not standard Lua: it reports `manual_cover_store.lua ... fs (line 15)` on HEAD's file. The trap is in
[knowledgebase.md](../knowledgebase.md#backend-rpc-crash-trap-unregistered-methods--unhandled-errors) (item 4),
[plugins.md guardrail 20](../plugins.md#20-pcall-is-not-a-safety-net-for-a-nil-index-lua-backend) and
[steam-debug.md Trap 9](../steam-debug.md#trap-9-unregistered-millennium-rpc-calls-crash-the-backend-process) (how to bisect
an RPC crash and read a dump without WinDbg). Probes kept: `tests/live/probes/rpc_raw.mjs`, `rpc_repro.mjs`.

### Q2: where the time goes (Chrono Trigger, 11 ScreenScraper images + IGDB, a 7.5 MiB manual)

Measured with the backend trace (wall clock) and the plugin's timing lines; "cold" = first visit after a Steam restart.

| Step | Cold | Warm (same session) | Notes |
| --- | --- | --- | --- |
| ROM MD5 (`node ra_hasher.js`) | 0.1 s | 0 (memory cache) | not a cost |
| ScreenScraper `jeuInfos` (first image call) | 3.2 s .. ~15 s | 0 (memory cache) | the biggest and most variable cost; network |
| ScreenScraper images, serial | 0.4-0.6 s each, fanart 1.8 s (2.3 MB); ~7 s for 11 | 0 (memory bin) | ScreenScraper's server time per image |
| HyperSpin theme (`themehs`, a **zip**) | 0.5 s + 2.4 MB, then dropped as "not an image" | 0 | **fixed:** skipped by its `format` before any download |
| Images phase as logged (`Community media ... images in`) | 10.9-22.6 s | 2-7 ms | |
| Manual cover, first time ever | 3.2-4.2 s after the images (PDF download 4 s + render) | 0 | |
| Manual cover, after a restart | **14 ms from disk** (was a full PDF download + render every start: the disk cache never worked before the fix) | 0 | **fixed by Q1** |

| # | Option | Verdict |
| --- | --- | --- |
| S1 | Images on disk | **Biggest remaining win** (cold ~11-23 s -> ~0 after the first visit ever, and no `jeuInfos` call is needed to show stored images). Needs a new ADR amending ADR-0046 ("no image bytes on disk"); bytes only, never a URL. **The user's decision.** |
| S2 | Parallel backend calls | **No gain, do not retry.** The host serves one request at a time and the downloads block it; frontend parallelism only queues calls behind each other (the 3-at-a-time build measured 30.6 s for AM2R's 15 images). It did not cause the crash. |
| S3 | Frontend downloads | No-go (ADR-0046: the URL carries the account; no CORS). |
| S4 | Progressive feed | Possible, but Steam serves page 1 once; needs the loader wrap. Lower value than S1. |
| S5 | Smaller images | Saves bytes, not ScreenScraper's per-image server time (the dominant part). Low value. |
| S6 | Warm the cache in the background | Conflicts with "never a storm" and the account's threads; only worth it with S1. |
| S7 | Range request for the cover | No longer needed: the cover is downloaded once per manual ever (disk cache works now). |
| S8 | `COVER_WAIT_MS` (8 s) | Keep: the first-ever cover arrives 3-4 s after the images, inside the wait; a stored cover is 14 ms. |

### Fix shipped with this finding

`local fs = require("fs")` in `manual_cover_store.lua`; `screenscraper_media.media_items` skips a media whose `format` is
not png/jpg (seen live: `themehs` is `zip`, every image `png`/`jpg`), and `media_service.image` refuses such a key before
downloading (records cached before the filter still name it for up to 7 days); tests for both and `test_globals.lua`.

**S1 done (2026-10-01, the user's decision):** everything fetched stays on disk for the "Keep downloaded media" days
(default 7, 0-30), per game, deleted when the game has not been opened within them:
[ADR-0051](../decisions.md#adr-0051-downloaded-media-stays-on-disk-while-its-game-is-opened-the-user-sets-the-days),
[service-media.md § Disk cache](../steam-cartridges/service-media.md#disk-cache-adr-0051). Chrono Trigger after a restart:
images 479 ms (was 11-23 s), cover 11 ms, PDF chunk 0 87 ms (was 4 s).

## 7. Verification of the finding

The user, in desktop Steam: open Chrono Trigger (SNES) three times in a row, then once after a Steam restart: no `Received
real-time crash event` line in `C:\game\steam\logs\webhelper_js.txt`, no new folder under
`C:\game\steam\millennium\crashes\`, the COMMUNITY tab shows all cards and the manual card, and `npm run test:live` ends with no
FAIL line (13 PASS; the `render loop` and `F2` checks have each failed once for timing, re-run before judging).
