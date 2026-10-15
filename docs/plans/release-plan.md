# Plan: first public release of enhanced-notifications and steam-cartridges

**Status (2026-10-14, evening):** triage done 2026-10-13; every agent-side blocker fixed 2026-10-14 (§ 0); D1-D9 decided; nothing released. Every item that was pending in TASK.md and in `docs/plans/` is sorted
below into **cleared** (done, or folded into one check), **blocker** (before the release), **check** (one hand-check session
by the user), **decision** (the user's call) and **after** (not in this release). TASK.md keeps only what is open.
**Kind:** an umbrella plan. Each blocker that needs code gets its own mechanical plan
([the standard](README.md)) before anyone writes code. **Owner of the decisions:** the user.

**State at triage (offline):** steam-cartridges `npm run test:ts` 347 pass / 0 fail, all 13 Lua suites pass (with
`NSGA_STEAM_ROOT=C:/game/steam`; without it `test_backend.lua` falls back to the default Steam path and stops);
enhanced-notifications `npm test` 185 pass / 0 fail (the two theme failures noted on 2026-10-08 are gone);
steam-cartridges-third-party Lua suites pass. Live suites not run (Steam was up without DevTools).

---

## 0. Progress (2026-10-14)

Done by the agent, offline-tested, deployed (`-dev`) and live-checked where noted ([ADR-0066](../decisions.md),
[ADR-0067](../decisions.md)):

| Item | State |
| --- | --- |
| D2 Epic/Xbox code | **Moved out (the user: "move it all out", ADR-0067).** The core has no Epic/Xbox code; third-party pushes each copy through extension API 1.2.0. Live: Pool Blitz pushed as an Xbox game (Game Info, 10 screenshots) |
| D3 Millennium hot-patch | **Removed.** Stress run of ADR-0059 still to do (live suite, § 4 H9) |
| D4 ScreenScraper | **Done (the user: ship the developer id).** `screenscraper_dev.lua`; each player adds their own account. This PC's account was saved to the data folder's `.env` |
| D5 RPCS3 / shadPS4 reset | **Read-only** (`TROPHY_RESET = false`) until checked on real files |
| D6 launch toast | **Deleted** with its setting and the Notifications section |
| D7 Sony assets | **Logged for removal (the user)**: nothing bundled uses them; exact list in § 3b. New original themes ship instead (SteamStation rebuilt, Neon Tiers, Midnight Glass) |
| D8 `ps5.jsonc` | **The user: local only.** `ps5.jsonc` and `retrogames.jsonc` moved to `<Steam>/millennium/config/enhanced-notifications/themes/` (the repo's newer `ps5.jsonc` there, the older local one kept as `ps5.jsonc.bak-20261014`) and out of the repo |
| SC 2 ROM hashing | **In Lua** (`rom_hash.lua`, ADR-0066), Node hasher deleted; 20/20 of this PC's ROMs identical to Node's |
| LICENSE | Added to steam-cartridges, -local and -third-party |
| Xbox overlay | **Dropped** (ADR-0065); opt-in Steam notification mute instead; Pool Blitz repointed live (appid kept) |
| Parity check | **Green** (live suite 12/12, 2026-10-14). The 14 failures were a deleted test shortcut: Jotunnslayer's Epic copy was uninstalled and auto-remove took its shortcut, so `open(S)` went nowhere and every check read B's page. The test now stops when its shortcut is missing, defaults to Pool Blitz (3436498948 -> 3942580, 16 PASS + check 8 expecting no logo, which Steam has none of for that app); `test_props.mjs` also passed on missing appids, now FAILs |
| § 3c machine paths | **Done.** No `C:/emu`, `C:/game` or user id in steam-cartridges' backend (`test_globals.lua` checks every file). Emulator folders come only from the shortcuts (`retroachievements.emulator_dirs()`, now reading the program out of a full command line) and the %APPDATA% / Documents defaults; fixed on the way: a nil first entry in each candidate list made `ipairs` skip every default folder. Live: RetroArch (signed in) and Dolphin/Primehack read as before; DuckStation, installed but run by no shortcut, is no longer listed as detected |
| D1 companions | **Recommended option taken (the user: "fix what we can using recommended options"):** steam-captured-activity and steam-cartridges-local ship in the same wave as steam-cartridges; third-party after. Both already have `LICENSE` and a dated `CHANGELOG` (`[0.1.0] - 2026-10-07`, `[0.2.0] - 2026-10-08`) |
| D9 small calls | **Recommended options taken.** Our cards' author avatar no longer opens `SteamIDPage` for a made-up account (`cardElement` → `strip-click`, matched by our inline avatar URL; unit-tested). Live: 23 of 23 author rows on Chrono Trigger's cards have no click, a native game's (435150) keep theirs. The manual's position and the 7-day manual heal are left as they are |
| § 3b deletions | **Done.** `themes/PlayStation/`, `themes/assets/`, everything in `themes/SteamStation/` but `assets/`, and `examples/steam_ps_exemple.json` (its tests now read `tests/fixtures/tiered_theme.json`, same values, neutral file names). Restore any of it from `6ece444` (the Theme Creator's sound packs: `git checkout 6ece444 -- enhanced-notifications/themes/SteamStation/custom/sfx`). enhanced-notifications `npm test` 186/186 |
| Publish checklist (agent part) | **Done.** steam-cartridges' `pnpm-lock.yaml` / `pnpm-workspace.yaml` removed; the four `dev.ps1` examples and the steam-cartridges README use `D:GamesSteam` instead of this PC's path; no `83513586`, `C:/game`, `C:game`, `C:/emu` left outside `tests/` in the four release plugins. Left for release day: versions, dated `[0.2.0]` / `[0.1.0]` entries, user READMEs |
| H10 community crash | **Done by the agent** (desktop, Steam 1791918634): Chrono Trigger opened four times after a restart, AM2R in between; no `real-time crash` line, no new crash folder, 27 cards ready, 23 shown, 2 videos. The investigation plan is deleted (`git show 6ece444:docs/plans/steam-cartridges-community-crash-and-speed-investigation.md`); the features plan too (F1 and F2 built and in the live suite; their looks are H7, H8, H11) |
| Steam update | Steam updated past the rollback to build 1791918634 (the user's call: Millennium refused `Steam.cfg`); all plugins load. It broke two enhanced-notifications lookups, fixed the same day: the toast dispatcher (banner off) and Steam's sized `showModal`. Every live suite green after that, Big Picture checks included |
| Theme Creator | **Built** (ADR-0069) with a Big Picture look per theme (ADR-0068); in enhanced-notifications 0.2.0. Its look is the user's (H16) |
| Local § 11 | **Blocked on a test game:** items 4-7 need a shortcut with Steam API emulator files (Goldberg, CODEX, RUNE, SOVEREIGN...). Wuchang's shortcut is gone and the only PC-game shortcut left is AM2R, so nothing in the library has such files |
| Captured-activity clips | **Not a plugin bug as far as the code shows**: no code path deletes clip files (enhanced-notifications deletes only one clip it can name as its own; four went in one second, 75 s after a Steam restart, with nothing in Steam's logs). Most likely Steam's own clean-up of clips its index lost in the GetClips-burst session (fixed `ce32f01`), or a delete in Steam's media view. Watch item, not a blocker |

Still open: the user's Big Picture spikes (§ 3, EN 1-2), the hand checks (§ 4), local § 11 (a test game), release-day publish steps (§ 7.4).

## 3b. Third-party material to delete before publishing (logged 2026-10-14, the user)

Nothing bundled refers to these any more (a theme test fails if a bundled theme names a file outside
`themes/SteamStation/assets/`), and `dev.ps1` no longer deploys them. Delete them from `enhanced-notifications/` before the
first `git subtree split` (or the public repo's history carries them):

- `themes/PlayStation/` (Sony trophy art and sounds: `trophy_ps4.mp3`, `trophy_ps5.mp3`, `platinum_trophy_ps5.mp3`,
  bronze/silver/gold/platinum images).
- `themes/SteamStation/` **except** `themes/SteamStation/assets/`: Sony samples and derived files (`ps4_trophy.mp3`,
  `ps5_trophy.mp3`, `ps5_trophy_platinum.mp3`, `*_playstation.png`, `top/hybrid_*_ps5_trophy_platinum.mp3`, the `sfx/`
  packs built from them), Valve sounds (`deck_ui_*.wav`, `steam_os_startup.wav`), Steam logos, Vecteezy stock art (the
  `vecteezy_*` folder and zip; its free licence forbids redistribution), svgrepo icons, and the generator scripts with
  machine paths (`sfx/bronze_sound_designer.py`, `sfx/preview.html`, `generate_baseline_progressions.py`,
  `hybrid_designer.py`).
- `themes/assets/` (Sony samples `ps*_trophy*.mp3`, `trophies/` with PS and Steam images, `sfx/`; the trophy SVGs of
  unknown origin were replaced by the SteamStation ones in `theme_example.jsonc`).
- `examples/steam_ps_exemple.json` (a PS5 example; keep `theme_exemple.json` only if its assets are the plugin's own).
- The repo history keeps them (private workspace); the public repo must be split after the deletion, or from a fresh
  history.

## 3c. Machine paths in steam-cartridges (found and done 2026-10-14)

Done, see § 0. `tests/test_globals.lua` fails if any backend file names `C:/emu`, `C:/game` or the user id again.

---

## 1. What ships

| Plugin | Version now | Ships as | Note |
| --- | --- | --- | --- |
| enhanced-notifications | `0.2.0-alpha.1` | `0.2.0` | Its own public repo ([plugins.md § 6](../plugins.md#6-publish-as-a-public-repo)) |
| steam-cartridges | `0.1.0` | `0.1.0` | Its own public repo |
| steam-captured-activity | `0.1.0` | **D1** | Split out of steam-cartridges (ADR-0062): without it the Activity feed has no "{Username} captured" cards |
| steam-cartridges-local | `0.2.0` | **D1** | Since ADR-0063 steam-cartridges reads no emulator save files itself; without it Goldberg/CODEX/RUNE games show no unlocks |
| steam-cartridges-third-party | `0.1.0` | **after** (or with the core: since ADR-0067 Epic/Xbox games need it) | Epic/Xbox: the least verified part, many open items (§ 5) |

---

## 2. Decisions (the user)

- **D1. Companions.** Recommended: release steam-captured-activity and steam-cartridges-local in the same wave as
  steam-cartridges (each is small and live-verified by the agent), third-party later. Alternative: steam-cartridges alone,
  with its README naming the companions as "coming".
- **D2. Where the Epic/Xbox code lives.** Found at triage: the extraction (2026-10-06) **copied** the store stack, it did not
  move it. steam-cartridges still has `store_service`, `store_epic_local`, `store_xbox_local`, `xbox_live`, `epic_graphql`,
  `store_launch`, `store_rpc`, and runs `app/store-sync.ts` (auto-add, Xbox repairs) and `app/epic-launcher.ts` (Epic
  overlay workaround) itself; third-party has a second copy of the backend. Recommended: finish the move before 0.1.0
  (steam-cartridges keeps no Epic/Xbox code; third-party owns it and runs its own sync), one plan. Alternative: ship the
  core with the store code inside, switched off, and delete third-party's duplicate backend.
- **D3. The Millennium hot-patch** (`steam-cartridges/backend/millennium_patch.lua`, run from `main.lua`): it rewrites a
  `jbe` in `millennium.luavm64.exe` in memory (signature-checked, refuses on another build). ADR-0059 then removed the
  cause (no dynamic `ffi.cdef` / `ffi.typeof`). A published plugin that patches Millennium's own binary is hard to defend
  in Millennium's plugin review and may hide a regression. Recommended: remove it, then repeat ADR-0059's stress run
  (10 RA games in one pass, `check_all_tabs.js`). Alternative: keep it behind a setting, off by default.
- **D4. ScreenScraper developer account.** It comes from `screenscraper_dev_*` in this machine's `.env`
  (`backend/web_config.lua` `get_screenscraper_credentials`); a public build has none, so ScreenScraper media and manuals
  stop. Options: ship the developer id in the plugin (common for emulator front ends, visible in the source), ask
  ScreenScraper for a separate id for this plugin, or release without ScreenScraper (IGDB and SteamGridDB stay).
- **D5. RPCS3 and shadPS4 reset** (ADR-0054): writing trophy files was never run on real files (none on this PC).
  Recommended: for this release, list those sources read-only (no reset toggle) until someone with a game tests it.
- **D6. The "Achievements Enabled" launch toast** (C9): it calls `ProcessNotification` wrongly and has never shown.
  Recommended: delete it (`surfaces/toasts/launch.ts` and its event). Alternative: post it through `OnNotification`.
- **D7. PlayStation art and sounds** in `enhanced-notifications/themes/PlayStation/` and parts of `SteamStation/`
  (Sony's trophy images and sounds). Recommended: ship `ps5` and `SteamStation` with original assets (the 17 AI sound packs
  of the Theme Creator plan are candidates), or ship without those two themes.
- **D8. `themes/ps5.jsonc`** (uncommitted, yours): `"popup_icon": [true, 8]` is read as scale 8 % (clamped to 25 %);
  `[true, 100, 8]` is probably what you meant. Fix and commit, or revert.
- **D9. Small calls:** the community image viewer's author row opens a Steam profile for a made-up account (recommended:
  not clickable on our cards); the manual is not always the top-left card (Steam's `Math.random` shuffle; recommended:
  leave it); games whose media was cached before manuals existed get none for 7 days (recommended: leave it, it heals).

---

## 3. Blockers (before the release)

### enhanced-notifications

1. **B3 in-game check with the game focused** (user at the screen, ~5 min): Big Picture, AM2R in front, then
   `$env:DELAY_MS=8000; node tests/probes/ingame-views.mjs 22000` and switch to the game within 8 s. PASS: both toasts in
   the `OV` view, the game's appid as `focused` at each mark ([consistency plan § 6b](enhanced-notifications-consistency-plan.md)).
2. **B5 stuck toast** (user runs the spike once): `node tests/probes/toast-watchdog.mjs` in Big Picture with a demanding
   game, switch to it within 10 s. "No toast got stuck" closes B5 for this release (C5 stays a known issue); "cleared by
   onDismiss" = build the watchdog (own kill switch) before release; "did not clear" = known issue in the README.
3. **D7, D8.**
4. **Publish checklist** (plugins.md § 6): `CHANGELOG.md` `[0.2.0]` with a date; `plugin.json` 0.2.0; remove machine paths
   from `themes/SteamStation/sfx/bronze_sound_designer.py` and `preview.html` (or drop those two files: they are tools,
   not theme content); README for users (install, themes, Big Picture notes, known issues).

### steam-cartridges

1. ~~`check_parity.mjs` 3 / 14~~ **Explained and green** (§ 0: the test shortcut had been removed).
2. **ROM hashing needs Node.js** (`backend/retroachievements.lua` ~line 673): it runs `node ra_hasher.js` and looks for the
   script at `C:/game/millennium/...` and a `C:/game/steam` fallback. A user without Node gets no hash, so no exact
   RetroAchievements match and no "unsupported ROM" guard. Plan: hash in Lua (the RA rules per system: plain MD5 for most
   cartridges, header stripping for NES/SNES/Lynx/7800, the disc rules for CD systems later), drop the Node call and the
   hard-coded paths. Minimum if the port waits: no hard-coded paths, and a clear log line when Node is missing.
3. **D2, D3, D4, D5, D6.**
4. **Publish checklist:** no `LICENSE` in `steam-cartridges/` (copy the workspace one); `CHANGELOG.md` `[0.1.0]` with a
   date; `pnpm-lock.yaml` / `pnpm-workspace.yaml` next to `package-lock.json` (npm is the package manager: drop the pnpm
   files); README for users; grep for this machine (`83513586`, `C:/game`, `C:\game`) outside `tests/`.
5. **Routines 1-3 of AGENTS.md** on the release build, desktop and Big Picture, after all of the above.

### Companions (if D1 = same wave)

- **steam-captured-activity:** four AM2R clips left the disk at 10:25:56 on 2026-10-07 during the user's test session, with
  no capture action logged. Find out what deleted them before shipping a plugin that deletes cards on capture events.
  Also missing: `LICENSE`, `CHANGELOG [0.1.0]`.
- **steam-cartridges-local:** plan § 11 items 4, 5, 7 by the agent (Steam lock); item 6 (a real unlock) by the user.
  The Wuchang crash ~11 s after start is the game or its emulator, not the plugin (the plugin reads `SOVEREIGN.ini` only):
  out of scope; keep the key-less `=1` line as a parser test case.

---

## 4. The user's hand-check session (one sitting, desktop then Big Picture)

Everything that waited on "a look by the user", merged. Tick each; a failure becomes a blocker.

| # | Plugin | Check | From |
| --- | --- | --- | --- |
| H1 | EN | Settings panel: Steam default first, Select Notification card, Achievements Preview only with ps5 | ADR-0053 |
| H2 | EN | ps5 theme toasts and Preview: `text_align`, `game_icon`, padding, `"gap": [10, 2]`, ps5 fade, ripple | ADR-0052, queue entry |
| H3 | EN | A themed toast leaving in game: no card left behind, no top-left flash | B1 |
| H4 | EN | Reset dialog: one dialog (Resetting..., outcome, Close), 480 x 250 not clipped; a theme typo opens the problems popup | 2026-09-30 entry |
| H5 | EN | Big Picture: Preview pressed quickly with a `top_left` theme; an achievement right after a download; first toast after re-entering Big Picture | ADR-0049 H1-H3 |
| H6 | EN | Use the queue for a day: did a notification ever go missing? | ADR-0055 |
| H7 | SC | Settings panel and its popups (Add service/source, Emulator status, Add Rule, Review, Manual Edit) | tidy-up, F1 |
| H8 | SC | Manual Edit: set Multi-player, Co-op and a controller on a wrong game; its Game Info shows them | F1 |
| H9 | SC | Open a few RetroAchievements games and one never opened: achievements show with the page | ADR-0060 |
| H10 | SC | ~~Chrono Trigger crash check~~ done by the agent (§ 0); left: the "Cache downloaded media" slider moves and saves | community investigation § 7 |
| H11 | SC | Big Picture COMMUNITY tab: viewer layout (tall image, Close), trailers, a 20+ item feed (Super Mario World), several shortcuts in a row each show their own cards | F2 1, 5, 6 |
| H12 | SC | Reset Achievements for WUCHANG: warning, the local toggle, popup size; Super Mario World's "Open RetroAchievements" | ADR-0054 |
| H13 | SC | The five visual checks of [verification.md](../steam-cartridges/verification.md); choose a shortcut icon by hand and confirm it is kept | owed since M10 |
| H14 | SCA | Its settings panel (two toggles); delete a real screenshot, its card leaves the feed on the next visit | ADR-0062 |
| H16 | EN | Theme Creator: open it from Theme, start from a template, change a few things in Desktop and in Big Picture, listen to a sound pack, Save as, Test on screen; then the saved theme in Big Picture | ADR-0068, ADR-0069 |
| H15 | 3P | (after this release) Xbox game with "Mute Steam notifications while playing" on: no toast over the game, toasts back after quitting | ADR-0065 |



---

## 5. After this release (moved out of "Now")

- **steam-cartridges-third-party:** the store-unlock work ([the research](steam-cartridges-store-unlock-detection-research.md),
  "To test, and to finish": Epic captures on a real unlock, the unlock feature with its ADR, Epic overlay mute, the live
  checks), a registered Microsoft app id, skipping a game the user owns on Steam (ADR-0070's leftover), and H15. The
  auto-add policy is done (ADR-0070); Xbox overlay work is dropped for good (ADR-0065).
- **enhanced-notifications:** B4 (sounds as a schedule), B6's in-game group in `run-live.mjs`, B7's C10 (Warning-size
  re-measure), ADR-0061's "no recording available" tile after a capture (compare with a manual Ctrl+F11 first), Steam's own
  toasts honouring `popup.scale` / `popup.layout`, the Theme Creator's "not built" items (plan § 14).
- **steam-cartridges:** `achievements.json` split (schemas vs unlocks) and dataflow phase 5; local split phases 6-7;
  achievement timeline markers for shortcuts; wrapping `LoadCacheFile`; the F30 ratchet rule; ScreenScraper videos and
  IGDB links; Phase 9 provider contract and the provider extraction; SteamGridDB filter rules.
- **Chores for the user, not release work:** the three malformed probe clips in
  `userdata/83513586/gamerecordings_quarantine_20261007/` (delete or put back).

## 6. Cleared at triage (no further action; history is in CHANGELOG.md)

SOVEREIGN.ini support; the logger and module-isolation fixes; the Review / Manual Edit card spacing; uninstalled-game
auto-removal; the extension system (its leftover is D2); artwork ingestion; the ROM hash guard and media cache; IGDB linking
and the R15 patch (its leftover is D3); controller inference at start-up (verification.md K20 is fixed); RA global % and
Library Analytics; the recordings-missing fix; the live scripts that reset settings (`placement.mjs` and
`sound-duration.mjs` now restore the user's settings); the enhanced-achievements merge, sibling port and Big Picture
flicker entries (their remaining looks are H1-H5); the theme test failures (B6, passing); the Xbox overlay workaround
(removed, ADR-0065); the alpha checklist U1-U9 (replaced by § 4); the ADR-0045 start-up lesson (kept in the ADR).
Plans deleted at triage: the UWP overlay research (abandoned, ADR-0065) and the performance and stability plan
(implemented, ADR-0059; readable at `6c19f5f`).

## 7. Order

1. The user answers D1-D9 and runs the blocker checks that need the screen (EN 1, 2) and the hand-check session (§ 4).
2. In parallel, offline: one mechanical plan each for D2 (store code move), SC 2 (ROM hashing in Lua), D3, D5, D6, then build.
3. Agent with the Steam lock: deploy, `check_parity.mjs`, local § 11, Routines 1-3 on both plugins, desktop and Big Picture.
4. Publish checklist per plugin, version bump, `git subtree split`, plugin database entry.
