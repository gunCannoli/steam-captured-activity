# TASK — current status & what's next

Lean tracker: **what we're doing and what's next, nothing else.** Shipped
work (with verification logs and rationale) lives in
[CHANGELOG.md](CHANGELOG.md) (workspace) and each plugin's own
`CHANGELOG.md`. Detailed root cause, ordered steps and execution records
live in per-feature plans under [docs/plans/](docs/plans/) — link to them,
don't duplicate them here. ADRs are in [docs/decisions.md](docs/decisions.md).

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-notifications` themes Steam's toasts and sounds, achievements included (enhanced-achievements merged into it, ADR-0050).

---

## Now

**Release fixes done 2026-10-14 (release plan § 0; ADR-0065-0067). Parity green and § 3c machine paths done (2026-10-14). Open: D1, D9, § 3b deletions, hand checks.** Release of enhanced-notifications 0.2.0 and steam-cartridges 0.1.0: [the release plan](docs/plans/release-plan.md)
(triage 2026-10-13).** Every pending item was sorted there into cleared, blocker, hand-check, decision and after. Next:
the user answers D1-D9 (§ 2), runs the two Big Picture spikes (§ 3, enhanced-notifications 1-2) and the hand-check session
(§ 4); offline, one mechanical plan per code blocker (D2 store code move, ROM hashing in Lua, D3, D5, D6).

**Xbox: overlay dropped, notification mute added (ADR-0065, 2026-10-13): coded, offline-tested, not deployed.** The
`uwp_presenter` wrapper and every trace of it are gone; a shortcut still on it (Pool Blitz, 3436498948) is repointed by
the Xbox repair in both steam-cartridges and third-party (exe, start folder, launch options; appid kept). New setting
Third-party → Xbox → "Mute Steam notifications while playing" (off by default). Next, agent with the Steam lock: deploy
steam-cartridges and steam-cartridges-third-party (`dev.ps1`, restart), then over CDP: `window.NotificationStore` has
own `BShouldSupressToasts` / `SendPendingServerToasts` once a mute ran; Pool Blitz's shortcut runs Explorer with
`shell:AppsFolder\...` within a minute of start-up. The user: H15 of the release plan.

**enhanced-notifications B3 / B5 (consistency plan):** waiting on the user's two Big Picture runs, listed as release
blockers (release plan § 3).

**Owed by a human:** the release plan's hand-check session (§ 4) replaces every earlier "left for the user" note.

## Considerations (decided later, not scheduled)

- **Auto-add next to shortcuts the user added by hand, or had before the plugin (found 2026-10-03, decide with the item below).**
  Today a game counts as "in the library" when a shortcut matches it: an Epic launcher link naming its AppName, an exe inside its
  install folder, or for Xbox a `shell:AppsFolder\<package>` target or an exe inside the package folder (`match` in
  `store_epic_local.lua` / `store_xbox_local.lua`, applied to every shortcut by `store_service.installed_games`). So the usual manual
  shapes are not duplicated; verified on this PC only for the six shortcuts the plugin made (the other 219 are not store games).
  Not covered: a shortcut that runs a wrapper (a .bat, Playnite, Heroic/Legendary), a renamed or different exe, an Xbox
  `ms-xbl-<id>://` or `xboxliveapp-` URI, or a copy of the same game on both stores. Proposal: (1) keep the matching and add a
  **title fallback**, a shortcut whose name equals the game's (case and punctuation ignored) counts as the same game and the panel
  says "In library as <name>"; (2) **re-check the live shortcut list just before AddShortcut** (a shortcut added by hand between two
  checks); (3) never edit or replace an existing shortcut, even a poor one; (4) **first enable asks first**: Settings lists the games
  it would add (checkboxes, "already in your library" greyed) so turning the toggle on with 40 Epic games installed adds only what
  the user ticked; (5) a button "Add existing store shortcuts to the Epic Games / Xbox collection" (routing rules use the
  collections, ADR-0036), never done silently; (6) skip, or ask about, a game the user already owns on Steam (the Steam match is
  only known after adding, so this needs the catalog title lookup first). Note for the persistent list: re-adding a deleted game
  gave a different appid (Minesweeper 2811889182, then 2663546656), so a re-add loses that shortcut's playtime and activity.
- **Auto-add and a shortcut the user deleted (needs a decision before auto-add is called finished, found 2026-10-03).** Today it is
  inconsistent: a game is requested once per session (`requested` in `app/store-sync.ts`), so a shortcut the user deletes stays gone
  until Steam restarts, then comes back at every restart while the toggle is on; and nothing restores one deleted by mistake.
  Options: **A.** a persistent list of games auto-added (backend data file), never added again even after a restart; an entry is
  dropped when the game is no longer installed, so uninstall then reinstall counts as new and is added again. **B.** restore controls
  in Settings → Third-party: each installed game shows "In library" / "Not in library" with an **Add** button, plus "Add all
  missing" (the panel already lists installed games and their library state). **C.** re-add on every 60 s check: rejected, it fights a
  deliberate deletion. **D.** keep today's behaviour. Recommended: **A and B together** (A makes a deletion stick, B is the easy
  undo; without B, A makes a mistaken deletion permanent). Questions: should a reinstall bring the shortcut back by itself (leaning
  yes), and should Add also appear on the game's own page (leaning no, settings only). Plan and an ADR amendment first.
- **Achievement timeline markers for non-Steam games, in steam-cartridges** (removed from enhanced-notifications
  2026-10-02 as a Steam-native feature for shortcuts). Steam marks achievements on its own games' timelines but not on
  shortcuts'. steam-cartridges already knows each unlock (its `achievements.unlocked` event, with name and description),
  so a `timeline` surface (with a kill switch and a `touches` entry) could add the marker. What is known: the RPC is
  `GameRecording.UserAddTimelineEntry#1` on `CGameRecordingService`, resolved by signature (steam-components.md § Game
  Recording RPCs); the running timeline is in `window.g_GRS.m_mapActiveTimelines` (loader `BIsTimelineRunning`,
  `GetGameID`, `GetRunningTimelineDurationMS`, `GetTimelineStartBeforeGlobalZeroMS`); the entry time is the unlock's
  offset plus `GetTimelineStartBeforeGlobalZeroMS`. enhanced-notifications sent an `Event` entry (`type: 2`,
  `marker_icon: 'steam_achievement'`, `range_title`, `marker_description`, `range_duration: '0'`) and fell back to a
  `UserMarker` (`type: 5`, `steam_marker`); its code is in git before this change (`frontend/surfaces/captures/captures.ts`
  `sendMarker`, `frontend/capture/plan.ts`). Open: on Wuchang (2026-10-02 11:47, unlocks 2 s after launch) both forms
  were rejected with EResult 42, likely because the timeline was not running yet; probe live with a game that has been
  running for a while before designing.
- **Wrap `LoadCacheFile` instead of watching (ADR-0045 decision 5, option 2).** steam-cartridges re-applies its
  achievements when Steam replaces its progress cache after login, detected by polling the map's identity
  (`sensors/progress-cache`, 1 s, at most 10 min). If the poll ever proves too slow, too costly, or misses a user who logs
  in after 10 minutes, hook Steam's own load instead. Tips: the target is
  `window.appAchievementProgressCache.LoadCacheFile` (async; on the store's prototype, read it with
  `Object.getPrototypeOf(window.appAchievementProgressCache)` first, the class name is minified); call the original, then
  `achievements.rerenderAll()` (app layer, already exists); install it in a surface, never in a sensor (guardrail: only
  surfaces patch Steam), so it needs a `touches` entry (`appAchievementProgressCache.LoadCacheFile`), a kill switch and a
  line in `surfaces.md`; it runs once per login, so guardrail 2 (hot paths) is no concern. Other plugins may wrap the same
  method: always call the original and return its value so the wraps compose. Verify live with
  `tests/live/probes/ach_preload.mjs` right after a restart, and read
  `window.appAchievementProgressCache.m_achievementProgress.mapCache` identity before and after login (steam-components.md,
  "When Steam fills each achievement store"). Amend ADR-0045 (or supersede it) when done.
- **Surface `deps` singletons (F30).** Each `surfaces/*/deps.ts` is a module-level object that `create*Surface` overwrites. Rewriting the
  six surfaces as real factories would touch every Steam hook (the highest-risk code) for a benefit that has not occurred. Instead add one
  capability-ratchet rule in `tests/architecture.test.ts`: `index.tsx` calls each `create*Surface` at most once, and nothing outside a
  surface's folder imports its `deps`. Revisit the factory rewrite only if a surface ever needs a second instance.

## Next

After the release: [release plan § 5](docs/plans/release-plan.md#5-after-this-release-moved-out-of-now) (third-party
and the Epic/Xbox handoff, enhanced-notifications B4/B6/B7 and the Theme Creator, steam-cartridges data flow phase 5,
local phases 6-7, Phase 9 provider contract and the provider extraction).

## Later

- Optional SteamGridDB artwork filter rules (`g{Author:maxKB}` per artwork type, off by
  default), from the removed `docs/steam-cartridges.md` § 6
  (`git show 0d599cf:docs/steam-cartridges.md`). After the migration, as a source adapter.

## Blocked upstream

- **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
  (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
  Re-test and drop the workaround in both plugins' `settings.ts` once fixed.

## Active failures & blockers

None.

---

## Before writing any code

Building a plugin or a feature? Follow the playbook in
[docs/plugins.md § Playbook](docs/plugins.md#playbook-creating-a-plugin-or-a-feature).
Every other doc, by situation: [docs/README.md](docs/README.md).
