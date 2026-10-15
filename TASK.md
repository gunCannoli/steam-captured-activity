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

**Release (enhanced-notifications 0.2.0, steam-cartridges 0.1.0, with steam-captured-activity and steam-cartridges-local,
D1): every agent-side blocker is done (2026-10-14; [the release plan § 0](docs/plans/release-plan.md#0-progress-2026-10-14)).**
D1-D9 decided, § 3b third-party material deleted, publish checklist's agent part done, community crash check (H10) done,
Steam updated to 1791918634 with both live suites green. Left: the user's two Big Picture spikes (§ 3, EN 1-2) and
hand-check session (§ 4); steam-cartridges-local § 11 items 4-7 need a game with Steam API emulator files in the library;
release-day steps (versions, dated changelog entries, user READMEs, `git subtree split`, plugin database).

**Xbox notification mute (ADR-0065): deployed and live** (Pool Blitz repointed 2026-10-14 00:51, appid kept). Left: the
user's H15 (release plan § 4), after this release.

**enhanced-notifications Theme Creator (ADR-0069) and Big Picture look per theme (ADR-0068): built and live-checked
2026-10-14** (plan § 14, removed once built: `git show ee3e9a0:docs/plans/enhanced-notifications-theme-creator-plan.md`). Every plan
item built (second pass the same day: hover preview, Go per warning, Import through Steam's file dialog, Steam's chime;
the ConfigContext error per dialog fixed). Waiting on the user's look (settings panel → Theme → Theme Creator, H16).

**enhanced-notifications B3 / B5 (consistency plan):** waiting on the user's two Big Picture runs, listed as release
blockers (release plan § 3).

**Owed by a human:** the release plan's hand-check session (§ 4) replaces every earlier "left for the user" note.

## Considerations (decided later, not scheduled)

- **Auto-add, what is left of the 2026-10-03 considerations** (the rest is ADR-0070, done 2026-10-15): skip or ask
  about a game the user already owns on Steam (needs the catalog title lookup first). Also not covered by the
  title match: `ms-xbl-<id>://` / `xboxliveapp-` URIs and a game on both stores.
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
  `sendMarker`, `frontend/capture/plan.ts`). **Probed 2026-10-15** (Metroid Fusion, steam-components.md
  § Game Recording RPCs): still EResult 42 with the timeline running for minutes, with Steam's own user-marker shape, and
  while recording, so it was not a late timeline. Next, two checks before designing anything: (1) the user, in game on a
  shortcut, adds a marker with Steam's own overlay timeline button: if Steam refuses it too, markers on non-Steam games are
  Steam's limit and this item is dropped; (2) the same call on a native Steam game from SharedJSContext, to tell "shortcuts
  refused" from "this context refused".
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

## Next

After the release: [release plan § 5](docs/plans/release-plan.md#5-after-this-release-moved-out-of-now) (third-party
store-unlock feature, enhanced-notifications B4/B6/B7, steam-cartridges data flow phase 5, local phases 6-7, Phase 9
provider contract and the provider extraction).

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
