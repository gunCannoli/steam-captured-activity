# steam-captured-activity — plugin architecture

**This doc's job:** how `steam-captured-activity` is built: what it shows, its layers, how it shares Steam's activity
store with Steam and with `steam-cartridges`, how deleted captures leave the feed, its settings, and how to verify
it. It does not repeat Steam's internals ([steam-components.md](steam-components.md#activity-feed)) or the rules
for writing plugin code ([plugins.md](plugins.md)).

---

## 1. What the plugin is

Steam's Activity feed shows a game's news, friends' activity and community uploads. The screenshots and recordings
the player captured stay out of it unless they are uploaded to the Steam Community (and then the headline reads
"shared 2 screenshots"). This plugin puts them in, for **Steam games and non-Steam shortcuts alike**:

- one "captured" event per local day with captures, in Steam's own feed, next to everything else on that day;
- the headline reads **"{Username} captured"** (Steam's action phrasing, like "achieved");
- each event shows a row of Steam's own Post-Game Summary cards at 16:9, clips playable inline;
- Big Picture gets the same feed, with its thumbnails sized 16:9.

It reads only what Steam already has: `SteamClient.Apps.GetScreenshotsInTimeRange` (keyed by the 32-bit appid) and
`CGameRecordingService.GetClips` (a shortcut's 64-bit gameid, a Steam game's plain appid: [AGENTS.md, the two
identifiers](../AGENTS.md#the-two-identifiers)). `GetScreenshotsInTimeRange` answers at most 100, the newest first
(measured 2026-10-07: 100 of 152); the plugin pages by time range (the next page ends just before the oldest one), at
most 20 pages. No network, no backend calls, no files of its own. The Lua backend only
calls `millennium.ready()`.

It was split out of `steam-cartridges` on 2026-10-07 ([ADR-0062](decisions.md)). It **needs nothing from
`steam-cartridges`** and works without it. Next to it, each plugin keeps its own events in the same feed (§ 4).

## 2. Layers

The shape of `steam-cartridges` in miniature ([steam-cartridges.md § 2](steam-cartridges.md#2-the-hexagon)): data
flows one way, and only surfaces write to Steam. `tests/architecture.test.ts` enforces the import rule.

```
  Steam UI ─► sensors ─► app/publisher ─► surfaces ─► Steam stores and jsx
              (view,       (when)          (feed, store-stub, sections,
               lifecycle)                   headline, cards, bpm-style)
                  domain/captures (what) · kernel (appid, safety)
```

| Layer | Files | What it does |
| --- | --- | --- |
| kernel | `kernel/appid.ts`, `kernel/safety.ts` | Appid normalization (signed CEF ids, the clip game id); per-part kill switches with an error budget |
| domain | `domain/captures.ts` | Captures to days (`captureDays`), the feed signature, the settings scope, the recently-viewed list. Pure |
| sensors | `sensors/view-core.ts`, `sensors/view.ts`, `sensors/lifecycle.ts`, `sensors/captures.ts` | Which app page is open (desktop route; Big Picture's app-details element through the jsx runtime), which Steam windows exist, which game quit, and Steam's own "screenshot written / deleted" and "clip created / deleted" notifications. Never write to Steam |
| app | `app/publisher.ts` | When an app's feed is (re)built: on a view, on a quit, on the sweep, on a settings change. Injected dependencies; tested with fakes |
| surfaces | `surfaces/*.ts` | The only code that writes to Steam, one file per target (§ 3) |
| settings | `settings/settings.ts`, `settings/panel.tsx` | The two toggles (§ 6) |
| root | `index.tsx` | Composition root; CDP exports (`diagnostics`, `sweepNow`, `setSetting`, `resetSettings`, the jsx diagnostics) |

`steam/` holds the Steam bindings, copied from `steam-cartridges` (plugins never import each other): `jsx-hook.ts`
(identical copy, [plugins.md, sharing the jsx runtime](plugins.md#sharing-the-jsx-runtime-between-plugins)),
`modules.ts`, `gamepad-appid.ts`, `route.ts`, and a trimmed `stores.ts`.

## 3. Surfaces

| Surface (kill switch) | Steam target | What it writes |
| --- | --- | --- |
| `feed` | `appActivityStore.m_mapAppActivity` (and its `set`), `workshopStore.m_mapPublishedFiles` | One type-13 screenshot event per day (`m_mediaItems` carries the cards' items); the workshop records its screenshot ids resolve to |
| `store-stub` | `StoreItemCache.m_mapApps`, `m_setUnavailableApps`, `BIsAppMissing` | A shortcut's in-memory store item, so Steam's event renderers pass their visibility guard ([ADR-0030](decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing), guardrail 5). Shortcuts only; kept for the session |
| `sections` | `CAppDetailsSections.GetSections` | Adds `activity` for a shortcut whose feed shows captures (Steam's shortcut list has no Activity section). Steam games keep Steam's list |
| `headline` | jsx (`EventHeadline` props) | `children: " captured"` for a type-13 event carrying `m_mediaItems`. Steam's own screenshot events keep Steam's words |
| `cards` | jsx (`replaceType`) | The carousel of an event with `m_mediaItems` becomes Steam's `PostGameSummaryClip` / `SummaryScreenshot` cards, 224×126 |
| `bpm-style` | a `<style>` in each Big Picture window | 16:9 thumbnails (320×180) in Big Picture's `CarouselThumbs` |

Every hook is O(1) and fail-open: an error is counted against its part, and a part over its budget (20) is off until
Steam restarts, leaving Steam's own behaviour (`diagnostics().safety`).

## 4. Sharing the feed with Steam and steam-cartridges

One entry per app in `appActivityStore.m_mapAppActivity`, several writers, none depending on another:

- **Steam** fills a Steam game's entry in place from its server fetch (`GetAppActivity` starts it).
- **steam-cartridges** sets a brand-new entry for a shortcut on each change (achievements per day, "Added to
  library", "Played for the first time", a mapped game's native news), and deletes it when the page is left.
- **This plugin** adds its capture events.

So captures are not stored in an entry. The `feed` surface keeps what each app should show (`desired`) and merges it
into whatever entry exists, and **wraps the map's `set`**: an entry another writer sets for an app with captures gets
the captures merged in before Steam sees it. Every event and day it adds carries a marker (`__capturedActivity`), so a
later publish or a clear takes back exactly its own events, and only removes a day it created once that day is empty.

Steam's feed re-renders when the map changes, not when an entry is mutated (found in `steam-cartridges`, verified
live 2026-10-02). After changing an entry it does not own, the surface deletes and re-sets the same entry
(`nudge`), so Steam's object (and its fetch state) stays. An entry the plugin built itself (no one else had one) is
replaced with a fresh object instead.

Steam can also rebuild a Steam game's entry **in place** when its server fetch lands, after the captures were merged
(found live 2026-10-07: the first view after a start-up lost them, without any `set`). So after publishing to a Steam
game the surface watches the fetch (`m_setAppsLoading` / `m_setAppFetchRequested`, every 500 ms, at most 10 s) and
merges again once it is done, and `needsRepair` counts the marked events actually in the entry rather than trusting
what it last wrote. A shortcut entry the plugin builds has `m_bNoMoreHistoryAvailable` and is put in
`m_setAppFetchRequested`, so Steam never asks its servers for an appid they do not know.

The workshop ids are `capture_<appid>_<screenshot handle>` and `capture_<appid>_clip_<clip id>`: never a real
published-file id.

## 5. When the feed is built, and the clean-up of deleted captures

Captures are Steam's own data, read live each time. Cleaning up is therefore the same act as publishing: a
screenshot or recording the user deleted is not in Steam's list any more, so it is not in the next publish, and the
surface takes its event (and its workshop record) out. `app/publisher.ts`:

| Trigger | What happens |
| --- | --- |
| A page view (desktop or Big Picture) | Read the app's captures; publish if the signature changed. **The clean-up on the next game page visit** |
| Steam says a screenshot was written or deleted, or a clip created or deleted | Re-read that app 1.5 s after the last such event (`CHANGE_DEBOUNCE_MS`), if it was viewed this session: the feed follows within seconds, wherever the capture was made or deleted (in game, Steam's media view, the screenshot manager) |
| A game quits | Re-read it, if it was viewed this session |
| Every 15 minutes (`SWEEP_MS`; 5 min, `SWEEP_NO_EVENTS_MS`, when Steam lacks the events) | The fallback: re-read the 20 most recently viewed apps (`MAX_TRACKED`). An app whose entry lost the captures to another writer is repaired then |
| A settings toggle | Apps leaving the scope lose their captures at once; apps entering it get them |
| The 21st app viewed | The oldest tracked app's captures leave its feed (the sweep stays bounded) |

An unchanged signature writes nothing (guardrail 17.2). An ask while a read of the same app runs waits for one
fresh read after it, so a sweep's promise settles only once the captures it saw are in the feed. A publish that finds Steam's stores missing (the first
seconds after start-up) retries every 2 s, five times. Leaving a page clears nothing: Steam's store is global, and the
sweep keeps it true.

**Steam's events** (`steam/stores.ts captureEvents`, verified in Steam's source 2026-10-07):
`SteamClient.GameSessions.RegisterForScreenshotNotification` (`strOperation` `written` / `deleted`, `unAppID`; Steam's
spotlight store registers it too), and the recording service's `RegisterForNotifyClipCreated` (`{ summary }`, the clip
as `GetClips` lists it) and `RegisterForNotifyClipDeleted` (`{ clip_id, game_id }`), which Steam's clip manager and
media view also register. A handler answers EResult 1 and never throws. `diagnostics().captureEvents` shows how many of
the three are live and the last 20 events.

## 6. Settings

Millennium's plugin config, kept in memory (the [Millennium#903 workaround](knowledgebase.md#plugin-settings--the-configuration-api)).
One panel, one block, guardrail 18:

| Key | Label | Default | Effect |
| --- | --- | --- | --- |
| `steamGames` | Steam games support | on | Captures in the Activity feed of Steam games |
| `nonSteamGames` | Non-Steam games support | on | Captures in the Activity feed of non-Steam shortcuts |

## 7. Verify

- Offline: `npm run check`, `npm test` (domain, view tracker, safety net, the publisher's clean-up flow, the
  architecture rule).
- Live, with the Steam lock ([AGENTS.md Routine 0](../AGENTS.md#routine-0-sharing-the-live-steam-client--take-the-steam-lock)):
  deploy with `dev.ps1`, then `node steam-health.mjs`. Routine 1 view 2 and `steam-cartridges/tests/live/check_all_tabs.js`
  ("{Username} captured" cards) and `test_nav_cycle.js` (A ➔ B ➔ A) need this plugin enabled. For a Steam game, open
  one with local captures and check the "captured" cards, then the same A ➔ B ➔ A.
- `node tests/live/check_feed.mjs [steamAppid] [shortcutAppid]` (Steam lock held): both pages show "captured" cards and
  our events are in Steam's store; A ➔ B ➔ A; Steam's own events untouched; the clean-up, by making Steam's list omit
  one screenshot in memory (nothing on disk is touched), sweeping, and restoring. Desktop or Big Picture.
- CDP: `PLUGIN_LIST['steam-captured-activity-dev'].diagnostics()` lists the apps whose feed shows captures, the tracked
  apps and any tripped part; `.sweepNow()` runs the clean-up at once.
- Clean-up by hand: delete a screenshot in Steam's screenshot manager, then reopen the game's page (or wait 5 min, or
  call `sweepNow()`): its card leaves the feed; deleting a day's last capture removes that day's "captured" event.
