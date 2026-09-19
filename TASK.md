# TASK — `non-steam-games-activity`

Working log and plan through to a shipped first plugin. Newest status at the top
of each phase; check items off as they land.

**Goal:** a non-Steam game's app detail page looks like a native one — a
session-scoped **post-game summary** on top, then **activity broken down by day**
(screenshots, recordings, and later achievements), instead of Steam's grey
"information is unavailable" box.

Reference: [docs/architecture.md](docs/architecture.md) ·
[docs/decisions.md](docs/decisions.md) ·
[docs/knowledgebase.md](docs/knowledgebase.md)

---

## Target layout (from Steam's own native pages)

Steam's native page, which we are reproducing:

```
┌─────────────────────────────────────────────────────────────┐
│ PLAY   CLOUD STATUS   LAST PLAYED   PLAY TIME   ACHIEVEMENTS│  <- stat bar
├─────────────────────────────────────────────────────────────┤
│ POST-GAME SUMMARY                                     < > x │
│   Today                                                     │
│   [clip 0:06] [screenshot] [screenshot]   + achievements    │  <- LAST SESSION
├─────────────────────────────────────────────────────────────┤
│ ACTIVITY                                                    │
│   SEPTEMBER 17                                              │
│     cannoliGun achieved  [badge] [badge]                    │  <- per DAY
│   SEPTEMBER 15                                              │
│     played Fields of Mistria for the first time             │
└─────────────────────────────────────────────────────────────┘
```

Two distinct scopes, and they are **not** the same thing:

- **Post-game summary** = the most recent **play session** (Steam labels it
  "Today"/"Sep 17"). Source: `gamerecording.pb` session window.
- **Activity** = the full history grouped by **calendar day**.

Achievements per day come from a provider later; the core supplies screenshots
and recordings.

**Big Picture** shows the same two scopes but as **tab sub-routes**
(`/library/app/<appid>/tab/GameInfo`) rather than one scrolling page, and needs
controller focus. Same backend, separate renderer — see
[ADR-0016](docs/decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer)
and Phase 6.

---

## Phase 1 — Backend data layer ✅ DONE

Parses real data on this machine. 68 assertions, all passing.

- [x] `steam_paths.lua` — discover Steam root + active user (no hardcoded paths)
- [x] `gameid.lua` — appid ↔ 64-bit gameid via decimal-limb arithmetic
- [x] `shortcuts.lua` — binary `shortcuts.vdf` parser (223/223 entries)
- [x] `captures.lua` — `screenshots.vdf` (211 screenshots, 6 games)
- [x] `captures.lua` — recordings: `clip.pb` protobuf, thumbnail, DASH manifest
- [x] `captures.lua` — `sessions_for()` from `gamerecording.pb`
- [x] `timeline.lua` — group by day + `post_game_summary()` session scoping
- [x] `rpc.lua` — `GetActivity` / `GetLibraryStats` / `GetDiagnostics`
- [x] `tests/` — harness stubbing Millennium's modules; runs real code on real data

**Verified end to end** for AM2R: summary window `13:37:12 → 13:37:40`
(source `session`, 1 recording), timeline `2026-09-19` (1) + `2025-10-24` (2).

---

## Phase 2 — Image spike ✅ DONE

**Answer: `steamloopback.host` cannot serve our images.** Millennium intercepts
that host, but `local_path_from_lb_url` resolves every path against
`<Steam>/steamui/` and rejects `..`, absolute paths and UNC — its own tests
assert this. Our captures live in `<Steam>/userdata/`, outside that jail.

So base64 over RPC, which the measurements make comfortable:

| | count | median |
| --- | --- | --- |
| Steam thumbnails | 615 | **11 KB** |
| Full screenshots | 616 | **931 KB** |

A 20-thumbnail page is ~0.4 MB of JSON; the same page of full images would be
~25 MB. Hence thumbnails in bulk, full images on demand.

- [x] Determine whether `steamloopback.host` can reach capture files — **no**
- [x] Measure base64 cost against Steam's own thumbnails
- [x] Resolve [ADR-0015](docs/decisions.md#adr-0015-serve-capture-images-by-reference-with-a-base64-fallback)
      → superseded by [ADR-0017](docs/decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)
- [x] `assets.lua` — data URIs, path allowlist, size budgets
- [x] `GetAsset` / `GetAssets` RPC methods
- [x] Tests, including attempted traversal and absolute-path reads (82 assertions total)

---

## Phase 3 — Plugin scaffold & first load ✅ DONE

**Milestone met.** The live Steam client logs:

```
Non-Steam Games Activity  Ready. 223 shortcuts, 211 screenshots across 6 non-Steam games.
```

Exactly the values the test suite asserts, so the whole backend — VDF parsing,
protobuf, 64-bit id arithmetic, path discovery — is proven inside Steam.

- [x] `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`
- [x] `dev.ps1` — discovers Steam via `-SteamPath` → `$env:STEAM_PATH` → registry
      → default; `-Pnpm`, `-NoRestart`, `-SkipBuild`
- [x] `frontend/rpc.ts` — typed client mirroring `backend/rpc.lua`
- [x] `frontend/assets.ts` — in-memory thumbnail/full-image cache
- [x] `frontend/index.tsx` — calls `GetDiagnostics`, logs it, never throws
- [x] Builds clean (`tsc --noEmit` + `millennium-ttc`)
- [x] Deploys and loads in Steam

Two bugs found by doing it for real rather than assuming:

1. **`-Encoding UTF8` writes a BOM** in Windows PowerShell, which broke
   Millennium's own `config.json` for strict JSON parsers. `dev.ps1` now writes
   UTF-8 without a BOM via `System.IO.File`.
2. **The plugin name is baked into the bundle at build time**, and Millennium
   routes RPC by that name. Renaming the manifest *after* building made the
   frontend call `<name>` while the backend registered as `<name>-dev`, so every
   call failed with "plugin not running". `dev.ps1` now renames before the build
   and restores the source manifest in a `finally`.

---

## Phase 4 — App detail page ✅ DONE

**Steam's grey "information is unavailable" box is gone**, replaced by a real
activity page. Verified in the live client for AM2R: `POST-GAME SUMMARY` with
the Sep 19 clip (`0:14` badge), then `ACTIVITY` showing `TODAY` and
`OCTOBER 24, 2025`. Four media cards, all four thumbnails decoded and drawn.

- [x] `library-app.tsx` — watches `/library/app/<appid>`, guards on
      `appid >= NON_STEAM_APPID_MIN`, fetches `GetActivity`
- [x] `components/classes.ts` — resolves Steam's hashed classes at runtime
- [x] `components/activity.tsx` — summary + day-grouped feed
- [x] `components/media-card.tsx` — thumbnails, duration badges
- [x] `styles.ts` — scoped CSS using Steam's own theme variables
- [x] Hides Steam's placeholder, and restores it on teardown
- [x] `data-nsga` markers so re-renders replace rather than duplicate
- [x] Unpatch on navigation away and popup close
- [x] Batch thumbnails via `GetAssets`; full images on demand via `GetAsset`

Found by screenshotting rather than trusting the DOM probe: the first render
anchored to `.GameStatsSection`, whose parent is a **46px flex row inside the
play bar**, so the content existed in the DOM and reported sane numbers while
being clipped to invisibility. The anchor is now the details page's
`LeftColumn`, where Steam puts the placeholder we are replacing.

Also of note: the placeholder is hidden with a scoped stylesheet rather than by
removing the node, because Steam owns that element and re-renders it — deleting
a React-managed node invites reconciliation errors.

## Phase 5 — Library grid ✅ DONE

Non-Steam games with captures now carry a real recent-activity timestamp, so
Steam's own sorting and date labels reflect play it has no record of. Verified
live: zeroing the fields and firing `OnAppOverviewChange` restored them to the
exact capture timestamps.

- [x] `library-home.tsx` — patches `CollectionStore.OnAppOverviewChange`
- [x] Batched `GetLibraryStats`, now returning `newest` per app
- [x] `captures.library_stats()` + tests (88 assertions)
- [x] Early-out on non-Steam appids so startup is not slowed
- [x] Re-enriches after a game quits

Two silent-failure traps, both recorded in
[ADR-0018](docs/decisions.md#adr-0018-write-only-observable-appoverview-fields-and-patch-the-prototype):

1. **`rt_last_time_played` has a custom setter** (`fnCustomSetter: SetLastTimePlayed`)
   backed by protobuf state. A plain assignment writes a shadow property that
   reads back correctly and is then discarded. We write only plain observables —
   so "Last Played" itself stays blank for these games, by design.
2. **`collectionStore` is a class instance**, so `OnAppOverviewChange` lives on
   the prototype. `afterPatch` on the instance reported success and never fired.

Both were caught only because the code logs how many records it actually
changed. "Patch registered" with zero effect looks identical to success.

---

## Phase 5b — Use Steam's own media surface ✅ DONE ⬅ from user testing

User testing found: clicks did nothing, and the layout diverged from Steam's
(one row with arrows, animated clip previews, a golden scissors glyph).
Investigating turned up capability we had wrongly assumed absent
([ADR-0019](docs/decisions.md#adr-0019-use-steams-own-media-apis-routes-and-components)).

- [x] **Images load by URL, not base64.** Steam serves captures at
      `steamloopback.host/screenshots/<gameid>/screenshots/<file>.jpg`.
      Verified: full image 3840×2160, thumbnail 200×112. This **supersedes
      ADR-0017** — the earlier spike only tested routes mapping to
      `<Steam>/steamui/` and never tried the `screenshots/` route.
- [x] **Clicks open Steam's own viewer** via `/media?item={type,id}`, using the
      `hHandle` from `SteamClient.Screenshots.GetAllLocalScreenshots()`.
      Verified live: clicking a card navigates to `/media?item=…`.
- [x] Post-game summary is a **carousel** (4 per page, arrows), matching Steam.
- [x] Clip badge is a **golden scissors** glyph with duration.
- [x] Reuses Steam's `SummaryCarouselContainer` / `PostGameSummaryClip` classes.
- [x] `assets.lua` retained as a fallback for captures Steam has not indexed.

Second testing round (side-by-side with a native page) fixed:

- [x] **Blank viewer on click** — `/media/item/...` needs navigator state we
      cannot pass; screenshots now open via `ShowScreenshotInSystemViewer`
- [x] **Double background** — Steam's summary containers are all transparent;
      our extra panel is gone
- [x] **Typography** — matched Steam's measured 14px/400/1px/rgb(148,161,166)

Third round, after measuring the live client
([docs/steam-styles.md](docs/steam-styles.md), [ADR-0021](docs/decisions.md#adr-0021-measure-steams-styles-from-the-live-client-and-keep-a-style-bible)):

- [x] **Carousel panel restored** — it is a `radial-gradient`, not a background
      colour, which is why checking `backgroundColor` reported transparent and
      it was wrongly removed
- [x] **Tile size** 200×112 → **224×126**, Steam's actual dimensions
- [x] **Drop shadows** on tiles: `rgb(0,0,0) 2px 2px 8px 0px`, square corners
- [x] **Day heading colour** corrected to `rgb(138,138,138)` (differs from the
      summary header's `rgb(148,161,166)`)

Still open from that testing round:

- [ ] **Recordings** do not play in-client. DASH needs an MSE player; clicking
      reveals the clip folder instead ([ADR-0020](docs/decisions.md#adr-0020-match-steams-measured-styles-open-media-through-client-apis)).
- [ ] **Screenshots open in the OS viewer**, not Steam's in-client overlay,
      which needs a navigator state object `Navigate(url)` cannot express.
- [ ] **Animated hover previews** for clips: Steam shows motion on hover.
      Mechanism not yet identified (likely a short video or sprite sheet).
- [ ] **Big Picture** shows nothing — expected, that is Phase 6.

---

## Phase 6 — Big Picture (Gamepad UI) ⬅ NEXT

**Investigated 2026-09-19** — no separate backend work is needed. Findings and
rationale in [ADR-0016](docs/decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer).

What is already settled:

- Big Picture is a **separate popup window** (`SP BPM_`), not a separate sandbox.
  `onPopupCreate` already fires for it, including one already open at startup.
- `PopupType.Gamepad` is first-class in `steambrew-utils`.
- Route is the same `/library/app/<appid>`; BPM adds `/tab/<Name>` sub-routes.
- The backend and `GetActivity` payload are **unchanged** — they never learn which
  UI is asking.

Tasks:

- [ ] **First: confirm JS reaches the gamepad window.** Log from inside an
      `SP BPM_` popup. Millennium [#754](https://github.com/SteamClientHomebrew/Millennium/issues/754)
      (closed) reports injected *CSS* not reaching BPM's inner DOM; if that
      isolation applies to JS too, this phase is blocked — find out before
      building.
- [ ] Read location per popup type: `Steam.MainWindowBrowserManager.m_lastLocation`
      on desktop, `popup.window.opener.location` on gamepad
- [ ] Resolve gamepad class modules **against the gamepad window** — never reuse
      desktop class names
- [ ] `renderers/gamepad-app.tsx` — tab-aware injection
- [ ] Controller focus: focusable media cards using Steam's focus primitives
      (a mouse-oriented grid is unusable with a gamepad)
- [ ] No reliance on injected CSS for structure (see #754)

Unverified: Big Picture has **not been opened** during this work, so the class
modules and tab structure come from logs and SDK source, not observation.

---

## Phase 7 — Refresh & caching

- [ ] `onAppLaunch` → `onQuit` invalidates that app's cache (new media exists
      exactly then)
- [ ] Re-render an open page after a game quits
- [ ] mtime-keyed caches for `shortcuts.vdf` / `screenshots.vdf` (already in
      `captures.lua`; extend to shortcuts)
- [ ] No polling anywhere

---

## Phase 8 — Provider contract

Deferred until the core is visibly working — the contract should be shaped by a
real consumer, not guessed.

- [ ] `providers.lua` — discover from `enabledPlugins`, call `Describe`/`Collect`
- [ ] `pcall` + timeout isolation ([ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently))
- [ ] Merge provider timeline entries by timestamp
- [ ] `provider-section.tsx` renders returned data ([ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it))
- [ ] Validate contributions; discard malformed

---

## Phase 9 — Smoke test

Run against the live Steam client with the plugin installed. Every row must pass
before the plugin is considered done.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Open **AM2R** (has 2 screenshots + 1 clip) | Summary shows the clip; activity shows 2026-09-19 and 2025-10-24 |
| 2 | Open **Super Metroid Vitality** (3 screenshots, no clip) | Activity renders; no empty summary box |
| 3 | Open a non-Steam game with **no media** | Friendly empty state, **not** Steam's grey box |
| 4 | Open a **native Steam game** (e.g. 435150) | Plugin does not touch the page at all |
| 5 | Open a RetroArch shortcut (e.g. Chrono Trigger) | Core page renders; no provider errors |
| 6 | Click a screenshot | Opens at full size |
| 7 | Click a clip | Plays, or hands off to Steam's player |
| 8 | Play a game, quit, reopen its page | New media appears without restarting Steam |
| 9 | Library grid | Screenshot counts visible; sorting still works |
| 10 | Restart Steam | Plugin loads clean; no console errors |
| 11 | Disable the plugin | Steam returns to its stock page with no leftovers |
| 12 | Startup timing | No perceptible delay vs plugin disabled |
| 13 | **Big Picture** — open AM2R's page | Same media as desktop, in BPM's layout |
| 14 | **Big Picture** — navigate with a controller only | Every media card reachable and activatable |
| 15 | Switch desktop → BPM → desktop | Both render; no duplicate or orphaned nodes |

Also confirm: no secrets in logs, and `GetDiagnostics` still reports
223 shortcuts / 211 screenshots / 6 games with media.

---

## Definition of done (v1)

- All Phase 9 rows pass on the live client
- README documents install, RPC surface and the traps
- ADR-0015 resolved (no longer "Proposed")
- Status markers in `docs/architecture.md` match reality
- Recordings degrade gracefully where DASH cannot play inline
- Big Picture either works (rows 13–15) or is explicitly documented as out of
  scope for v1 with the reason — not left silently broken

---

## Open questions

| Question | Blocks | Plan |
| --- | --- | --- |
| ~~Can `steamloopback.host` serve local files?~~ | — | **Answered: no** — jailed to `<Steam>/steamui/`. Base64 instead ([ADR-0017](docs/decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)) |
| Does Millennium #754's BPM isolation affect JS, or only CSS? | Phase 6 | Log from an `SP BPM_` popup before building |
| Do BPM tabs need separate injection per tab? | Phase 6 | Observe live; route is `/tab/<Name>` |
| Can we play DASH inline, or must we hand off? | Phase 4 polish | Poster + handoff in v1 |
| Are `timeline_*.json` user markers worth showing? | — | Deferred; data is parsed and available |
| Recording `video/` (background) vs `clips/` | Phase 4 | Only `clips/` seen so far; `video/` stays empty here |

---

## Log

**2026-09-19**

- Docs restructured to core + providers after finding Steam's own capture store
  (211 screenshots, 100% on disk). Rewrote the plugin around it.
- Phase 1 built and tested. Bugs the suite caught, all now regression-guarded:
  - `screenshots.vdf` block detection used digit-length, so Steam appid
    `238960` was read as a screenshot index — AM2R returned **222** screenshots
    instead of 2. Fixed by tracking brace depth.
  - Protobuf reader recursed into every length-delimited field, misreading the
    timeline *string* as a nested message → duration/dimensions came back 0.
  - Varint reader bailed out mid-value on the 64-bit gameid, desynchronising
    every later field.
- User recorded a clip on AM2R → recordings verified end to end (14144 ms from
  `clip.pb` matches `PT14.144S` in the DASH manifest).
- User recorded a clip on a **native** game (435150) → found that native games
  key recordings on the **raw appid**, while non-Steam games use the composed
  gameid. `recordings_for` now picks the right form and anchors the match
  between underscores; regression test added.
- Added `sessions_for()` + `post_game_summary()` so the page mirrors Steam's
  two-scope layout (session summary above, per-day activity below).
- **User testing round.** Four reports: clicks dead, no Big Picture, layout
  divergence, animated clip previews. Chasing them found `SteamClient.Screenshots`
  and Steam's `/media` routes, and that captures load by plain URL — overturning
  ADR-0017's base64 design. Lesson recorded in ADR-0019: when a spike says "not
  possible", check whether the question was too narrow before building around it.
- **Phase 5 done.** The library grid reflects capture dates. Cost several
  iterations to find that `rt_last_time_played` is not a plain property and that
  `afterPatch` was targeting an instance rather than a prototype — both failed
  silently. The fix that made it tractable was logging the number of records
  actually changed.
- **Phase 4 done.** The activity page renders in the live client. A DOM probe
  reported 4 cards and 4 loaded images while the page was in fact invisible —
  only a screenshot revealed the content was clipped inside the play bar. Worth
  remembering: for UI, verify visually, not just structurally.
- **Phase 3 done.** Scaffold built, deployed and loaded in the live client;
  diagnostics report 223/211/6, matching the suite. Two real bugs found in
  `dev.ps1`: PowerShell's `-Encoding UTF8` BOM corrupted Millennium's
  `config.json`, and the plugin name is baked into the bundle at build time so
  the dev rename has to happen *before* building, not after.
- **Phase 2 resolved.** Read Millennium's loopback source rather than guessing:
  `steamloopback.host` is jailed to `<Steam>/steamui/` and explicitly rejects
  traversal, so it cannot serve anything from `userdata/`. Measured the
  alternative — Steam's thumbnails are 11 KB median, so base64 over RPC costs
  ~0.4 MB for a 20-image page. Built `assets.lua` with a path allowlist and
  size budgets; ADR-0015 superseded by ADR-0017.
- Investigated **Big Picture**: it is a separate popup window (`SP BPM_`), not a
  separate sandbox, and `steambrew-utils` already exposes `PopupType.Gamepad`.
  The backend needs **no** Big Picture work; only a second renderer. Recorded as
  [ADR-0016](docs/decisions.md#adr-0016-support-big-picture-through-the-same-backend-with-a-separate-renderer),
  slotted in as Phase 6, smoke rows 13–15.
