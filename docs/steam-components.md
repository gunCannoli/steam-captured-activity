# Steam components — how the app detail page is really built

Everything here was **read out of the live Steam client** over CEF devtools
(2026-09-20, extended 2026-09-21 for Big Picture): module factories pulled
from `webpackChunksteamui`, stores poked with real appids, DOM verified on
screen, and — for Big Picture specifically — Millennium's own C++ source
cloned and read directly. No guessing, no inference from screenshots.

This document exists to answer one question: _what does Steam actually do, so
that we can call it instead of imitating it?_

> **Read this before building any UI.** It is the reference behind
> [ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
> which the plugin now implements. The inspection procedure at the end is
> reusable for anything not yet mapped — start there for Big Picture.

---

## TL;DR — the finding that matters

Steam's Post-Game Summary and Activity sections **are not missing for non-Steam
games. They are switched off by a one-line app-type filter.**

```js
// module 59856, CAppDetailsSections.GetSections()
e.BIsModOrShortcut() && (s = n); // n = ["nonsteam", "notes", "screenshots"]
```

For a shortcut, Steam replaces the full 18-section list with a 3-section list.
`postgamesummary` and `activity` are dropped before rendering — not because the
data is absent, but because the section registry filters on app type.

Both backing stores work **perfectly well** with a non-Steam appid. Probed live:

| Store call, appid `4263274102` (AM2R) | Result                                    |
| ------------------------------------- | ----------------------------------------- |
| `GetOrCreateAppData(appid)`           | ✅ real `CAppData`, real `m_session`      |
| `m_session.PushSessionEvent({...})`   | ✅ accepted                               |
| `GetPostGameSummary(appid)`           | ✅ returns the session once it has events |
| `yX.GetAppActivity(appid)`            | ✅ real object, `appActivityByDay: []`    |

**Verified end to end:** patching `GetSections` to re-add the two sections and
pushing one synthetic screenshot event made Steam render its own
`GamePlaySummaryContainer`, `GamePlaySummaryHeader`, `SummaryContainer` and
`SummaryContainerChildren` on AM2R's page — native pager, native close button,
native "Sep 20" date header, native card sizing and clip badge. Zero markup of
ours. Screenshot confirmed on screen, then reverted.

So the shape of the plugin should be:

```
our backend data  ─►  Steam's own stores  ─►  Steam's own components
```

not

```
our backend data  ─►  our components that look like Steam's
```

---

## The problem this solved

The renderer used to reimplement Steam's summary and day list by hand. That is
why it kept not looking right: every spacing value, separator rule, date label
and hover behaviour had to be rediscovered, and would drift on the next Steam
build. [AGENTS.md](../AGENTS.md) already said _"reuse Steam's real components
over recreating them"_, and
[ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)
already said prefer patching data over DOM. The section filter was the missing
piece that made both achievable.

**This is now implemented** — the hand-built components are deleted. The value
of this document from here on is (a) the reference below, for the parts not yet
wired up, and (b) the method at the end, for everything still unmapped.

---

## How to get at any of this

Steam exposes its webpack require by pushing a probe chunk:

```js
let req = null;
window.webpackChunksteamui.push([
    ["probe_" + Date.now()],
    {
        probe_mod: (m, e, r) => {
            req = r;
        },
    },
    (r) => {
        r((r.s = "probe_mod"));
    },
]);
// req.m  = 2573 module factories (source readable via Function.prototype.toString)
// req(id) = evaluated module exports
```

**Numeric module ids reshuffle between Steam builds.** They are used throughout
this document because they are how the code was read, but production code must
resolve by signature — see [§ Stable resolution](#stable-resolution).

---

## The app detail page skeleton

Module `59856` is the composition root. Exports: `N_` (the sections component,
holds `GetSections`), `AC`, `UL`.

### The section registry

`GetSections(overview, details)` returns a `Set<string>`. Three candidate lists:

```js
// full list — normal games
s = [
    "info",
    "spotlightdlc",
    "spotlightreview",
    "postgamesummary",
    "friends",
    "achievements",
    "notes",
    "cards",
    "dlc",
    "screenshots",
    "review",
    "activity",
    "activityrollup",
    "community",
    "additionalcontent",
    "mastersubincluded",
    "timedtrialbanner",
    "playtestinvites",
];

// app_type == E6 || P_ (application / tool)
i = [
    "info",
    "spotlightdemo",
    "friends",
    "achievements",
    "notes",
    "cards",
    "dlc",
    "screenshots",
    "review",
    "activity",
    "activityrollup",
    "playtestinvites",
];

// BIsModOrShortcut()  ← non-Steam games land here
n = ["nonsteam", "notes", "screenshots"];
```

Then conditionally added: `workshop`, `offline` (offline mode), `controller`
(when controllers are connected). Big Picture (`LAUNCHER_TYPE`) filters out
`community`.

Results are memoised in `this.m_setSectionsMemo`, compared **by size only** —
so a patch that swaps members without changing the count can be ignored. Set the
memo explicitly when patching.

### Column layout

`render()` places each section into one of three columns:

| Column                                                                                               | Sections, in render order                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Spotlights` (top, spans; moves to left column when `rightPanelWidth >= SpotlightBreakToLeftColumn`) | `timedtrialbanner`, `spotlightdlc`, `playtestinvites`, `spotlightreview`, **`postgamesummary`**, `spotlightdemo`                                    |
| `RightColumn`                                                                                        | `controller`, `mastersubincluded`, `friends`, **`additionalcontent`**, `achievements`, `notes`, `cards`, `dlc`, `workshop`, `screenshots`, `review` |
| `LeftColumn`                                                                                         | `nonsteam`, `offline`, `activityrollup`, **`activity`**, `community`                                                                                |

Every right/left-column section is wrapped in `ue` (exported as `UL`) which
registers it for scroll-seeking, inside an error boundary `c.tH`. The
`postgamesummary` spotlight is **not** wrapped — it renders bare.

This explains the on-screen geometry: the summary is a wide panel above, the
activity feed is the left column below it, and "Recordings and screenshots" /
"Notes" sit in the narrow right column.

---

## Post-Game Summary

Module `53074`, export `T`. Styles: module `68854`.

### Data flow

```
CAppSpotlightStore (module 74827, export Ri)   ← singleton, MobX
   └─ m_mapAppData : Map<appid, CAppData>
        └─ m_session          : CGamePlaySession
        └─ m_postGameSummary  : CGamePlaySession | null
```

The component is two functions deep:

```js
function v({ details }) {
    const summary = useMemo(() => Ri.GetPostGameSummary(details.unAppID));
    return summary ? <M details={details} summary={summary} /> : null;
}
```

`GetPostGameSummary` is trivial — the gate is entirely upstream:

```js
GetPostGameSummary(e) { return this.GetOrCreateAppData(e).m_postGameSummary }

async UpdatePostGameSummaryForApp_Internal(e) {
  e.m_bLoadedPreviousSessionData || await this.LoadPreviousSessionData(e);
  e.m_postGameSummary = e.m_session.HasSessionEvents() ? e.m_session : null;
}
```

So: **`m_postGameSummary` is just `m_session` when it has events.** For a
shortcut, `LoadPreviousSessionData` finds nothing, so it stays `null`.

### `CGamePlaySession` — the injection surface

Read verbatim off the live class:

```js
class CGamePlaySession {
  m_rgSessionEvents = [];                    // MobX observable
  PushSessionEvent(e)                        // keeps recordingHighlights last
  BAddScreenshotNotification(e)              // handles "written" / "deleted"
  AddAchievement(e)                          // only if e.achievement.bAchieved
  AddTradingCard(e)
  AddClip(e)                                 // dedupes on clip_id
  RemoveClip(clipId)
  SetRecordingHighlights(e)                  // [] removes the highlights event
  GetSessionEvents()  ClearSessionEvents()  HasSessionEvents()
}
```

`PushSessionEvent` has one ordering rule: it pulls any existing
`m_recordingHighlights` event out and re-appends it after the new event, so
highlights always sort last.

### The session event union

A session event is a **plain object with exactly one populated key**:

```ts
type SessionEvent =
    | { m_screenshot: Screenshot }
    | { m_clip: Clip }
    | { m_recordingHighlights: Highlight[] }
    | { m_achievement: { achievement: Achievement } }
    | { m_tradingCard: TradingCard };
```

Real payloads captured live:

```jsonc
// m_screenshot  (Bloodstained, appid 692850)
{
  "nAppID": 692850, "strGameID": "692850", "hHandle": 583,
  "nWidth": 3840, "nHeight": 2160, "nCreated": 1789773563,
  "ePrivacy": 2, "strCaption": "", "bSpoilers": false,
  "strUrl": "https://steamloopback.host/screenshots/692850/screenshots/20260918201923_1.jpg",
  "bUploaded": false, "ugcHandle": "18446744073709551615", "publishedFileID": "0"
}

// m_clip  (Divinity: Original Sin 2, appid 435150)
{
  "clip_id": "clip_435150_20260919_164525", "game_id": "435150",
  "duration_ms": "5562", "date_recorded": 1789836319,
  "start_timeline_id": "timeline_43515020260919_164501",
  "start_offset_ms": "18129", "file_size": "12359219",
  "date_clipped": 1789836325,
  "thumbnail_url": "https://steamloopback.host/gamerecordings/clips/clip_435150_20260919_164525/thumbnail.jpg",
  "thumbnail_width": 1920, "thumbnail_height": 1080, "temporary": false
}
```

Note `strUrl` and `thumbnail_url` are **`steamloopback.host` URLs that Steam
itself serves** from `userdata` and `gamerecordings`. This is a different route
from the one an earlier base64-over-RPC design avoided
([ADR-0017](decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)):
that ADR found _this plugin's own_ paths unservable through
`steamloopback.host`, but these are _Steam's own_ objects with _Steam's own_
URLs, already resolved this way — no base64, confirmed shipped in
`steam/stores.ts`.

### Render algorithm

The builder walks `GetSessionEvents()` **backwards** (newest first) and emits a
flat list into a carousel. Per event it derives four things: a `Date`, a React
key, the child element, and a _type token_ (`l.vu5` screenshot, `l.DJE` clip,
`l.qhh` highlights, `l.ocM` achievement, `l.UkI` trading card).

Separator rules, exactly:

- `bSameDay = isSameDay(prevDate, thisDate)` (`41180.JD`)
- **New day** → push `EventDaySeparator` (a vertical rule), and the next item
  renders its date header.
- **Same day** → push `TypeSeparator`; it gets the `SpaceOnly` modifier when the
  two adjacent types are "compatible", where compatible means _same type, or
  both are media_ (screenshot / clip / highlights). So media items sit in one
  run with only spacing between them, while a media→achievement boundary draws
  a visible divider.
- Consecutive same-day achievements are **paired**: two achievements collapse
  into one `SummaryAchievementStack` (max 2).
- `bShort` starts `true` and is cleared by any non-single-achievement event; it
  drives the `GamePlaySummaryShort` class (a shorter panel for an
  achievements-only summary).

Date header (`F` → `j`): `includeHeader` is `!bSameDay`, and the label is
`46108._l(unixSeconds)` — Steam's relative formatter, which yields
`#Time_Today`, `#Time_Yesterday`, a same-year date like `Sep 20`, or a full date
across years. **This is the answer to "Today / Yesterday / 24 October": one
shared helper, not per-call formatting.**

### Element tree

```jsx
<Focusable className={GamePlaySummaryContainer + (bShort && GamePlaySummaryShort)}>
  <SomeWrapper>                                  {/* 55116.q */}
    <Pageable.Zz>                                {/* 34461.Zz */}
      {bShort && <div className={GamePlaySummaryHeader}>#AppSpotlight_PostGameSummary</div>}
      <CollapsibleSection                        {/* 4584.C */}
        name="#AppSpotlight_PostGameSummary"
        bNoHeader={bShort} customheader={header}
        bShowCloseButton onCloseButtonClicked={() => Ri.StopShowingGamePlaySpotlight(appid)}
        buttonSize="small" headerPadding="0px 8px 0px 0px">
        {(ref, fnUpdateArrows) => (
          <Carousel                              {/* 26271.Q */}
            className={SummaryCarouselContainer}
            leftMargin={32} edgeMask="none"
            ref={ref} fnUpdateArrows={fnUpdateArrows}
            fnRenderScrollingDiv={...SummaryCarouselScrollingContainer}>
            {children}
            <div className={ForcedCarouselPadding} data-carousel="ignore" />
          </Carousel>
        )}
      </CollapsibleSection>
    </Pageable.Zz>
  </SomeWrapper>
</Focusable>
```

`data-carousel="ignore"` marks separators and padding so the carousel does not
treat them as pageable items — the plugin's own carousel work must honour this.

### Leaf renderers

| Event        | Component                                                      | Module  |
| ------------ | -------------------------------------------------------------- | ------- |
| screenshot   | `u.R` with `screenshot={3499.Bo(raw)}`, `sizeAxis="height"`    | `21597` |
| clip         | `$d` — `PostGameSummaryClip`, opens `Media.Clip({state:{id}})` | `17110` |
| highlights   | `$B`                                                           | `17110` |
| achievement  | `57665.hs` — `featured showStats`                              | `57665` |
| trading card | `22165.dI` — `cardScale={1.1}`                                 | `22165` |

`3499.Bo` is the adapter that turns a raw `m_screenshot` into the shape the
screenshot component wants — worth reusing rather than reconstructing.

### Class keys (module `68854`)

```
GamePlaySummaryContainer  GamePlaySummaryHeader  GamePlaySummaryEvents
GamePlaySummaryShort      SummaryContainer       SummaryContainerChildren
SummaryScreenshot         SummaryTradingCard     SummaryAchievementStack
SummaryAchievement        SummaryAchievementIcon EventCarousel
ForcedCarouselPadding     EventHeaderBlock       EventDaySeparator
SummaryCarouselContainer  SummaryCarouselScrollingContainer
```

---

## Activity feed

Module `80478`. Styles: module `17076`. Store: module `12750`, export `yX`.

**This one is network-backed, and that is the key difference from the summary.**

```js
useEffect(() => {
    hasSteamConnection && setTimeout(() => yX.FetchLatestActivity(appid), 500);
});
const activity = yX.GetAppActivity(appid);
const days = activity?.appActivityByDay;
```

`CAppActivityStore` prototype: `FetchLatestActivity`, `FetchLatestActivityFromServer`,
`FetchActivityHistory`, `GetAppActivity`, `RestoreActivity`, …

Confirmed live: Bloodstained returns **40 days**; AM2R returns a valid store
object with **0 days**. The server has nothing to say about a shortcut, and
never will.

### Structure

```
CAppActivity
  m_mapActivityByDay
  appActivityByDay : CActivityDay[]     // computed, newest first
  m_bNoMoreHistoryAvailable

CActivityDay
  m_rtDayBegin                          // unix seconds, midnight local
  m_rgEvents : CActivityEvent[]         // MobX observable array
  get events() { return this.m_rgEvents.filter(e => e.BIsValid() &&
                        !BIsFeatureBlocked(e.GetParentalFeature())) }
  get isValid()                         // true if ANY event BIsValid()
  AddEvent(e) { this.m_rgEvents.push(e) }     // ← plain push, no validation
  AddScreenshotEvent / AddVideoEvent / AddAchievementEvent / AddUserStatusEvent
  AddRecommendedGameEvent / AddReceivedGameEvent / AddWishlistedGameEvent
  AddPartnerEvent / AddSteamTradingCardEvent / RemoveEvent
  SortEvents() { sort by rtEventTime DESC }
```

### The event base class

All events extend one base (`E` in module `12750`):

```js
gameid  unUniqueID  rtEventTime  steamIDActor  steamIDTarget
eEventType  eEventSubType  eGameActivityType  bIsGameActivity
commentThreads  activeThread

InitFromUserNewsEvent(eType, gameid, rtTime, actor, target)
InitFromGameActivity(eActivityType, eSubType, gameid, rtTime, actor)
get appid() { return Number(this.gameid) }
BIsValid() { return true }             // overridden per subclass
GetParentalFeature() { ... }           // own content vs. others'
GetHeadline() { return "#AppActivity_..." }
```

Subclasses seen live: achievements (`eEventType: 2`), partner events
(`eEventType: 1002`), screenshots (`V`, valid iff `m_bIsValid`), videos (`H`),
trading cards, recommendations, received/wishlisted games, user status.

### The hard blocker: every event needs a store record (**✅ verified live**)

Feeding this feed is not merely hard, it is **closed** for a non-Steam game, and
the reason is upstream of the event data entirely.

Steam's per-event renderer (module `80478`) opens with:

```js
const [p] = lt(i, D.A.k_DataRequest_Assets);   // i = event.appid
...
if (i && (!p || !p.BIsVisible())) return null;
```

`lt` is a direct **store** lookup — no fallback, no local path. A non-Steam game
has no store record at all:

| `GetApp(appid)`         | Result                          |
| ----------------------- | ------------------------------- |
| `692850` (Bloodstained) | record, `BIsVisible() === true` |
| `4263274102` (AM2R)     | **nothing**                     |

So the guard fires for **every event type**, and no amount of correct event data
gets past it.

**Verified end to end.** Restoring `activity` and pushing a valid event into a
real `CActivityDay` produced Steam's real ACTIVITY section, with a correct
`Yesterday` heading, a `Rule` divider and `Load More Activity` — and an empty
`<div></div>` where the event body belongs. The event itself was fine:
`BIsValid() === true`, actor matching the current user, `day.events.length === 1`,
`day.isValid === true`. It is the store lookup that kills it.

Two event types were checked specifically, in case one avoided the guard:

- `PlayedGameFirstTime` — also renders a game capsule (`ot`) whose first line is
  `if (!r) return null` on the same store record. Doubly blocked.
- `AchievementUnlocked` — its achievement list renders purely from
  `event.achievements`, needing no store data, so it _would_ work if the outer
  guard let it through. It does not.

### How the blocker was cleared (**✅ verified live & shipped**)

The guard was cleared by satisfying Steam's store cache directly in memory, with no network path:

```js
GetStoreItem(id, type) { ... return map.get(id) }   // pure map read, no fetch
BIsVisible()           { return this.m_bVisible }   // plain boolean field
BHasStoreItem(id,t,r)  { return map.has(id) && map.get(id).BContainDataRequest(r) }
```

And because the React hook only calls `QueueStoreItemRequest` when `BHasStoreItem` is
false, an in-memory stub that satisfies it guarantees **no network request is ever made**.

The implementation in `frontend/steam/activity.ts` resolves four specific runtime traps:

1. **In-Memory Store Item Stubbing:**
   Constructed via `Object.create(Object.getPrototypeOf(templateApp))` (or fallback object),
   setting `m_unID = m_unAppID = appid`, `m_bVisible = true`, `m_strName = name`, and:

    ```js
    fake.m_DataRequested = {
        include_assets: true,
        include_platforms: true,
        include_release: true,
        include_tag_count: 0,
    };
    storeItemCache.m_mapApps.set(appid, fake);
    ```

2. **The AppID Bitwidth / IEEE 754 Precision Trap:**
   Event base class `E` (module `12750`) defines:

    ```js
    get appid() { return Number(this.gameid); }
    ```

    For a non-Steam game, `gameid` is 64-bit (`(appid << 32) | 0x02000000`). JavaScript `Number()`
    loses integer precision above $2^{53} - 1$, turning e.g. AM2R's `18310622842007322624` into
    `18310622842007323000`. When `lt()` queries `StoreItemCache` using that corrupted float, it
    misses the cache and returns `undefined`.
    **Fix:** Explicitly set `event.gameid = appid.toString()` and define an explicit property getter:

    ```js
    Object.defineProperty(event, "appid", {
        get: () => appid,
        configurable: true,
    });
    ```

3. **The `GetLatestEventTime` Contract on `CActivityDay`:**
   Module `80478` (`st` / `Sr`) calls `day.GetLatestEventTime()` to build the React component key
   and header timestamp (`V._l(day.GetLatestEventTime(), true)`). If missing from a custom day
   fallback, React crashes with `TypeError: e.GetLatestEventTime is not a function`.
   **Fix:** Custom day objects must implement `GetLatestEventTime()`, `GetEarliestEventTime()`,
   `SortEvents()`, and `BHasEvents()`.

4. **Workshop Store Preview Resolution:**
   The screenshot carousel component queries `workshopStore.GetPublishedFileRecord(publishedFileId)`.
   Injecting records into `workshopStore.m_mapPublishedFiles` with `m_strPreviewUrl = strUrl`
   supplies Steam's loopback screenshot URLs directly into the native viewer.

**Verified end to end (Desktop & Big Picture Mode):**

- AM2R (4 screenshots across 2 dates): Renders native cards `"cannoliGun shared 2 screenshots"` on
  Sep 20 and Oct 24, 2025, active loopback previews, carousel thumbnails, and "Load More Activity".
- Controller D-pad navigation functions seamlessly in Big Picture Mode's "ACTIVITY" tab.
- Empty case (ActRaiser, 0 captures): Keeps Steam's honest disclaimer box cleanly without errors.
- Clean teardown: `clearActivity(appid)` purges all temporary in-memory records upon navigation away.

Achievements for non-Steam games are out of scope regardless; if they ever
arrive (custom sets, RetroAchievements), they are a provider concern
([ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)).

### Comparison: `game-data-linker`'s different way around this same blocker

The user pointed at
[sydhufen/game-data-linker](https://github.com/sydhufen/game-data-linker), a
published Millennium plugin that also makes non-Steam shortcuts show rich
Steam-native detail pages (artwork, activity feed, achievements, news,
friends). Read its README and source (`backend/main.lua`,
`frontend/index.tsx`) via the GitHub raw API — not cloned locally. Worth
recording because it looks like it solved exactly what we're blocked on, but
on inspection it **sidesteps the blocker rather than clearing it**, by making
a different product choice:

**It links a shortcut to a _real_ Steam appid (or Epic/Xbox), not a fake
record for the shortcut's own non-existent one.** The user pastes a Steam
AppID or store URL into the shortcut's Properties dialog; the plugin saves
`{non_steam_id → steam_id}` in `mappings.json` and, from then on, reads and
renders **that other, real game's** data:

```ts
const store = (window as any).appActivityStore;
let activity = store.GetAppActivity(appid); // appid = the LINKED real Steam game
```

```ts
const cache = (window as any).appAchievementProgressCache;
const e = cache?.m_achievementProgress?.mapCache?.get?.(appid); // real game, real progress
```

No `Object.create`-on-prototype fabrication anywhere — it doesn't need our
[§ The store record can be faked](#the-store-record-can-be-faked-verified-not-yet-wired-up)
technique because `appid` here is never a shortcut's own id; it's Garry's Mod
or whatever the user linked. `GetAppActivity`/`appAchievementProgressCache`
already have a real backing record for a real appid — that's the whole reason
it works with zero network calls to fetch activity/achievements themselves.
Artwork is genuinely downloaded (Steam CDN / Epic / SteamGridDB) and applied
via `SteamClient.Apps.SetCustomArtworkForApp`, which is the same real,
documented API surface either plugin would use — nothing new there.

**This is a different product, not a better solution to ours.** Our goal
(AGENTS.md) is showing a shortcut's _own_ real captured screenshots/clips —
data Steam already has, for the actual thing the user ran, no linking step,
no network. `game-data-linker`'s goal is showing a _linked_ game's data
(borrowed from a real Steam/Epic/Xbox listing) under a shortcut that may not
even be that game (nothing stops linking `AM2R.exe` to Hollow Knight's
appid — it's an intentional cosmetic/metadata overlay, not provenance). Our
core plugin (`non-steam-games-activity`) could never adopt this approach
without abandoning ADR-0012's "core reaches no network, needs no linking"
premise; it does, however, validate that a **linking-based enrichment
provider** is a legitimate, already-proven shape other developers ship — worth
keeping in mind for the provider layer (Phase 8), completely optional and
orthogonal to the core.

**Two things it does confirm, both already known but now double-verified by
an independent implementation:**

- `SetCustomArtworkForApp(appid, base64, ext, imageType)` (types 0=portrait,
  1=hero, 2=logo, 3=wide capsule) is the real, working API for shortcut
  artwork — matches our own findings elsewhere in this doc.
- `findClassModule`-based CSS resolution with a hardcoded fallback (their
  `resolveClasses(predicate, fallback)`) is the same pattern
  [ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)
  already commits us to.

**Nothing new on Big Picture.** No `PopupManager`/gamepad-window handling in
its source at all — it targets desktop Properties/library dialogs only
(`tryInjectPropertiesField(doc, popupTitle)`, invoked per-document from a
caller not shown in the fetched excerpt, almost certainly Millennium's
per-popup CSS/webkit injection rather than anything like our
`g_PopupManager` cross-window trick). Its Properties-dialog injection is a
same-kind problem to Big Picture's (reach a document that isn't
`SharedJSContext`'s own) but a smaller one — Properties dialogs are ordinary
webkit-injectable popups ADR-0023/0024's `allows_webkit_injection` loopback
exclusion doesn't apply to, so it needed no `g_PopupManager`-style workaround
at all. Doesn't change anything in [§ Inspecting Big
Picture](#inspecting-big-picture-phase-6--answered) or ADR-0024.

### Why we cannot feed the _stock_ screenshot/video events

```js
async AddScreenshotEvent(e, t) {
  ...
  await n.AddScreenshot(e.publishedfileid())   // ← published UGC id
}
```

`AddScreenshotEvent` and `AddVideoEvent` resolve **`publishedfileid`** — a
Steam Workshop/UGC handle obtained by uploading. Local captures from a non-Steam
game have no such id (`publishedFileID: "0"`). These two entry points are
therefore closed to us.

`AddEvent(e)` is not. It is an unguarded `push`, and the only contract an event
must satisfy to survive the `events` getter is:

- `BIsValid()` → `true`
- `GetParentalFeature()` → a feature enum the parental filter accepts
- `rtEventTime` (number) for `SortEvents`
- `gameid`, `unUniqueID`, `eEventType` for rendering/keys

That is a small, stable contract we can implement.

### Day labels

Same helper as the summary: `46108._l`, giving `#Time_Today`, `#Time_Yesterday`,
`Sep 20`, or a full date. The heading element is `AppActivityDate` inside
`AppActivityDay` (class module `17076`).

### Localisation tokens

The activity feed's vocabulary is entirely `#AppActivity_*` — these are the
**social/community** feed strings (`PostedScreenshot`, `PostedVideo`, `Achieved`,
`Achieved_PlusMore`, `PlayedGameFirstTime`, `ReceivedNewGame`, `RecommendedGame`,
`AddedGameToWishlist`, `SteamTradingCards_*`, `NoActivity`, `EndofFeed`,
`FetchMore`, comment/rating strings, …). Full list in the scratchpad probe.

Notably `#AppActivity_PlayedGameFirstTime` is the "played X for the first time"
line, and `#AppActivity_NoActivity` is the empty state.

---

## Additional content

Module `59856`, renders when `vecMusicAlbums.length || strManualURL`:

```js
return t.vecMusicAlbums.length || t.strManualURL ? (
    <Section label="#AppDetails_SectionTitle_AdditionalContent">
        {t.strManualURL && <Manual overview={r} details={t} />}
        ...
    </Section>
) : null;
```

The manual item (the Divinity 2 case) uses class keys `AdditionalItem` +
`Manual`, label `#AppDetails_AdditionalContent_GameManual`, and resolves the
URL through `f.jb(details.strManualURL)`.

Both inputs come from `details` (`CAppDetails`). A non-Steam game has neither, so
this section is genuinely empty for us — **unless** we populate `strManualURL`
on the details object, which is the same data-patching trick as everything else
here. Lower priority than the two main sections.

---

## Section title inventory

Every section title Steam defines, from the loc tokens
(`#AppDetails_SectionTitle_*`):

```
Achievements  Activity  AdditionalContent  CloudStatus  Community  Controller
DLC  DiskSpaceRequired  Friends  Friends_Software  GameNotes  Hardware
IncludedWith  LastLaunched  LastPlayed  Links  Media  Media_BPM  OfflineMode
OpenFriends  PlayTime  PlayTimeLeft  Screenshots  SelectedBeta  SignIn
TradingCards  Updates  UsageTime  Workshop
```

And the tabs (`#AppDetails_Tab_*`), which are what Big Picture routes to:

```
Achievements  Activity  Community  Controller  DLC  Friends  GameInfo
Information  Reviews  Screenshots  Settings  TradingCards  WhatsNew
Workshop  YourStuff
```

---

## Stable resolution

Numeric ids in this document are **for reading only**. Resolve at runtime by
signature, per
[ADR-0005](decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules)
and the AGENTS.md reuse rule.

| Target                   | Stable signature                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Post-Game Summary styles | class-map probe key `GamePlaySummaryContainer`                                                       |
| Activity feed styles     | class-map probe key `AppActivityDay` / `AppActivityDate`                                             |
| `CAppSpotlightStore`     | export whose object has prototype method `GetPostGameSummary` **and** `StopShowingGamePlaySpotlight` |
| `CAppActivityStore`      | export with prototype `GetAppActivity` + `FetchLatestActivity`                                       |
| Sections component       | export whose `prototype` has `GetSections` + `SeekToSection` + `RegisterSection`                     |
| Carousel                 | `prototype` has `ScrollToElement` + `UpdateScrollArrows` + `BindScrollingContainer`                  |
| Collapsible section      | `prototype` has `OnHeaderClick` + `onCloseButtonClicked` + `ScrollToFirstChild`                      |

Prototype method names survive minification; module bindings and numeric ids do
not.

The store singletons are also reachable without webpack spelunking once found —
they are long-lived MobX singletons, so resolve once and cache.

---

## The simulate hooks

`CAppSpotlightStore` ships test affordances, useful for development:

```
BSimulateSummaryFakeAchievement   SimulatePressSummary
SimulateSummaryClear              SimulateSummaryForceNewDay
SimulateNewDLC
```

`SimulateSummaryForceNewDay` in particular exercises the day-separator path
without waiting for midnight.

---

## What was done, and what is left

**Done** (ADR-0022, verified in the live client):

1. **`GetSections` patched** to re-add `postgamesummary` for
   `BIsModOrShortcut()` apps, and to drop `nonsteam` once there is content to
   replace it with. The memo is refreshed explicitly — it compares by size
   only, and this change swaps one member for another.
2. **`m_session` fed** via `BAddScreenshotNotification` / `AddClip`, oldest
   first, then `m_postGameSummary` set. Steam renders the rest.
3. **Captures read from Steam's own APIs** —
   `SteamClient.Apps.GetScreenshotsInTimeRange` and the recording service's
   `GetClips`. Both work for a shortcut; the clips call needs the full 64-bit
   gameid, since Steam's own helper truncates it to 32 bits.
4. **`steamloopback.host` question answered:** Steam serves its _own_ captures
   over that origin and hands back absolute URLs, so no image crosses the RPC
   boundary for this page. ADR-0017's jail still applies to files Steam does
   not index.
5. **`components/` deleted**, along with `assets.ts`, `steam-media.ts`,
   `timeline.lua`, `assets.lua` and the recording parsers.
6. **Big Picture implemented** (ADR-0024) — not by feeding Steam's component
   (genuinely unreachable, confirmed from Millennium's source, ADR-0023), but
   by rendering a clone into the popup's DOM via a cross-window reference from
   `Steam.PopupManager`. Awaiting the user's smoke test. See
   [§ Inspecting Big Picture](#inspecting-big-picture-phase-6-answered).

**Left:**

- **The Activity feed is partially solved.** Every event renderer requires a
  _store_ record the game does not have — but that record can be faked with no
  network call, and was, successfully. What remains is wiring it through the
  plugin's existing re-render path. See
  [§ The hard blocker](#the-hard-blocker-every-event-needs-a-store-record-verified-live)
  and [TASK.md](../TASK.md) for the step-by-step. This applies equally to Big
  Picture's ACTIVITY tab, which shares the same blocker.

Everything that reaches into Steam keeps a graceful fallback, so a Steam update
degrades the page to stock instead of crashing it.

---

## Reproducing this — the inspection method

This is the procedure to run **before building any component**, and the one
Phase 6 (Big Picture) should start from. It takes minutes and has repeatedly
turned "we need to build X" into "Steam already has X".

### 1. Attach

Steam must run with `-dev` to expose CEF devtools on `http://localhost:8080`.

```bash
curl -s http://localhost:8080/json/list
```

**There are several targets and they are not interchangeable:**

| Target                               | What it is                                      | Use it for                                 |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------ |
| `SharedJSContext`                    | the JS context: stores, modules, `SteamUIStore` | evaluating code, navigating, poking stores |
| `Steam` (`minwidth=1010` in its URL) | the rendered desktop window                     | reading the DOM, screenshots               |
| `SP BPM_…` / Gamepad popup           | Big Picture's window                            | the same, for Big Picture                  |
| `… Supernav`, `… Menu`               | chrome fragments                                | nothing — they match naive title filters   |

Two traps, both hit this session:

- **Match the main window by URL, not title.** Several targets are titled
  `Steam`; filtering on the title alone picks a menu popup and you read an
  empty DOM. Filter on `'minwidth=1010' in url`.
- **Navigate from `SharedJSContext`, read the DOM from the window.** They are
  separate JS contexts. `window.SteamUIStore` exists only in the former;
  `document` for the page you care about lives in the latter.

Do not `location.reload()` the SharedJSContext to pick up a plugin change — it
tears down the render window and leaves you with no DOM target. Restart Steam.

### 2. Capture Steam's module require

```js
let req = null;
window.webpackChunksteamui.push([
    ["probe_" + Date.now()],
    {
        probe_mod: (m, e, r) => {
            req = r;
        },
    },
    (r) => {
        r((r.s = "probe_mod"));
    },
]);
window.__wreq = req; // req.m = ~2600 factories; req(id) = evaluated exports
```

`__wreq` does not survive a Steam restart — re-run this after each one.

### 3. Find the thing

Search factory **source text** for a distinctive string, then read it:

```js
for (const id of Object.keys(req.m)) {
    const src = Function.prototype.toString.call(req.m[id]);
    if (src.includes("PostGameSummary")) console.log(id, src.length);
}
```

Best search terms, in order of usefulness:

1. **Localization tokens** (`#AppDetails_SectionTitle_`, `#AppActivity_`) —
   these name features exactly and are not minified.
2. **Store method names** (`GetPostGameSummary`) — property names survive.
3. Class-map keys (`GamePlaySummaryContainer`).

Pipe the factory through `prettier --parser babel` before reading it; minified
Steam code is unreadable otherwise and perfectly clear after.

### 4. Confirm against the live client

Never conclude from source alone. Poke the real stores with real appids:

| appid        | Game                     | Why it is useful                                |
| ------------ | ------------------------ | ----------------------------------------------- |
| `692850`     | Bloodstained             | biggest summary — 14 events                     |
| `435150`     | Divinity: Original Sin 2 | screenshots **and** a clip                      |
| `2142790`    | Fields of Mistria        | small, ordinary case                            |
| `4263274102` | AM2R                     | **non-Steam** — the case under test             |
| `2788628389` | ActRaiser                | non-Steam with **no captures** — the empty case |

Always test a native game and a non-Steam one side by side. The whole ADR-0022
finding came from noticing the store behaved _identically_ for both and only
the section list differed.

### 5. Verify by screenshot, not by DOM query

**A DOM probe can report success while the page looks wrong.** This happened
here: `querySelector` found the summary and reported the placeholder gone,
while the visible page still showed the grey box — the section set was correct
but React had not re-rendered. Only the screenshot caught it.

```python
ws.send(json.dumps({"id":1,"method":"Page.captureScreenshot","params":{"format":"png"}}))
```

### 6. Clean up

Patches and injected events mutate the running client. Revert them:

```js
window.__unpatchSections?.();
Ri.GetOrCreateAppData(appid).m_session.ClearSessionEvents();
```

---

### Inspecting Big Picture Mode (BPM / GamepadUI) — The Complete Architecture

This section documents the ground truth of how Steam's Big Picture Mode (GamepadUI / Steam Deck UI) is constructed, verified live via CEF DevTools on 2026-09-22.

The earlier assumption (ADR-0023, ADR-0024) that Big Picture runs as a separate JavaScript bundle with an unreachable module cache and store was **proven false** (ADR-0029). Big Picture runs in the **exact same JavaScript runtime as Desktop (`SharedJSContext`)**, rendering through a multi-window React Portal. As a result, **the exact same store-feeding and section-restoration technique used on Desktop (ADR-0022) works out of the box in Big Picture Mode** — no hand-built clone markup or DOM injection needed.

### How to enter Big Picture for testing

```js
// In SharedJSContext via CEF DevTools:
window.SteamClient.UI.SetUIMode(4); // Switch to Big Picture Mode (GamepadUI)
window.SteamClient.UI.SetUIMode(7); // Switch back to Desktop mode
```

When switched to Big Picture, Steam opens a new popup target named **`Steam Big Picture Mode`**.

---

### 1. The Multi-Window React Portal Architecture

Steam's client uses a multi-window design centered around a single headless frame:

| Window / Target              | What it is                                                            | JavaScript Environment                                                                                    |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **`SharedJSContext`**        | The client's central engine (`https://steamloopback.host/index.html`) | Runs the full JavaScript bundle: `library.js`, `sp.js` (chunk `3714`), MobX stores, React tree            |
| **`Steam Big Picture Mode`** | The visible gamepad window (`about:blank?createflags=...`)            | An empty popup window containing only `<div id="popup_target"></div>`. **Loads zero scripts of its own.** |

#### The "Separate Bundle" Trap Explained

Inspecting the `Steam Big Picture Mode` target directly via DevTools initially showed:

```js
// Evaluated inside the "Steam Big Picture Mode" target:
typeof window.webpackChunksteamui; // "undefined"
typeof window.appStore; // "undefined"
typeof window.Millennium; // "undefined"
typeof window.SteamClient; // "object" (native Chromium bridge)
```

This led an earlier pass (ADR-0023) to infer that Big Picture was a separate bundle with an isolated module cache. **That was an artifact of where the query was run.** The popup window has no `<script>` tags and defines no globals.

Instead, Steam's main React application running inside `SharedJSContext` opens the popup window via `PopupManager` and renders the entire Gamepad UI into it using:

```jsx
ReactDOM.createPortal(
    <GamepadUIRoot />,
    popupWindow.document.getElementById("popup_target"),
);
```

#### The Fiber Proof (**✅ Verified Live**)

Comparing the React Fiber root in `SharedJSContext` with the rendered elements inside the Big Picture popup proved they are the **same React tree**:

- `SharedJSContext` `#root`: `__reactContainer$2x6thximn4h`, `_reactListeningwb7s4ax711`
- `Steam Big Picture Mode` `#popup_target`: `__reactFiber$2x6thximn4h`, `_reactListeningwb7s4ax711`

The Fiber suffix (`2x6thximn4h`) is generated once per React instance at startup. Because both windows share the identical suffix, **all Big Picture React components run in `SharedJSContext`**.

Webpack chunk `3714` (`sp.js`, the Big Picture entry point) pushes directly into `self.webpackChunksteamui` in `SharedJSContext`. Every store (`appSpotlightStore`, `appActivityStore`, `appDetailsStore`, `appStore`) is a live singleton in `SharedJSContext`.

---

### 2. How Big Picture Builds the App Detail Page

Big Picture's app detail page is composed of several layered components spanning modules `18057`, `40478`, `59856`, and `3375`:

```
x.BV.Library.App.Root()  (/library/app/:appid, module 18057)
 └─ Xd.xA (module 40478)
      └─ L (React.Component: calls p.H.RegisterForAppData, m.O.FetchDataForApp, Ri.EnterAppDetailsPage)
           └─ Hp (module 3375)
                └─ re.AC.Provider value={Xe}  (CAppDetailsSectionsContext, module 59856.AC)
                     └─ Xd.kg (module 40478, export E)
                          └─ T.N_ (CAppDetailsSections, module 59856 export N_)
                               ├─ GetSections(overview, details)  ← SHARED SECTION REGISTRY
                               └─ de (consumes useContext(re.AC) → renders Xe)
                                    └─ Xe (module 3375: AppDetailsRoot)
                                         └─ it (module 3375: Gamepad Tab Strip)
                                              ├─ WhatsNew ("ACTIVITY" tab)  → at()
                                              ├─ YourStuff ("YOUR STUFF" tab) → ot()
                                              ├─ Community ("COMMUNITY" tab)  → lt()
                                              └─ GameInfo ("GAME INFO" tab)   → ct()
```

#### Step-by-Step Breakdown

1. **Route & Data Loading (Module `40478`):**
   When navigating to `/library/app/:appid`, component `L` mounts. It registers for app data and invokes:

    ```js
    A.Ri.EnterAppDetailsPage(this.props.appid); // Ri = CAppSpotlightStore
    ```

    When unmounting, it invokes:

    ```js
    A.Ri.ExitAppDetailsPage(this.props.appid);
    ```

2. **Context Switching (`CAppDetailsSectionsContext`, Module `59856.AC`):**
   Module `3375` defines `Hp`:

    ```js
    function Hp(overview, details) {
        return (
            <re.AC.Provider value={Xe}>
                <Xd.kg
                    overview={overview}
                    details={details}
                    LaunchingDetails={Ju.rp}
                />
            </re.AC.Provider>
        );
    }
    ```

    `re.AC` is `CAppDetailsSectionsContext`.
    - On **Desktop**, `re.AC` takes its default value: a renderer that outputs the Desktop three-column layout (`Spotlights`, `RightColumn`, `LeftColumn`).
    - In **Big Picture**, `Hp` overrides `re.AC` with `value={Xe}` — the Big Picture Gamepad tab renderer!

3. **The Shared Section Registry (Module `59856.N_`):**
   `Xd.kg` renders `T.N_`, which is `CAppDetailsSections` (`le` in module `59856`).
   In its `render()` method:

    ```js
    render() {
      const sections = this.GetSections(this.props.overview, this.props.details);
      return (
        <div className={Container}>
          ...
          <de parentComponent={this} setSections={sections} ... />
        </div>
      );
    }
    ```

    `de` simply consumes the context:

    ```js
    function de(props) {
        const Renderer = useContext(ce); // ce = CAppDetailsSectionsContext
        return <Renderer {...props} />;
    }
    ```

    `GetSections()` is the **exact same method** that Desktop uses!

4. **Big Picture Tab Composition (Module `3375`):**
   `Xe` renders `AppDetailsRoot` and passes `setSections` into `it(props)`.
   `it` builds the 4 gamepad tabs:
    - **`WhatsNew` (Label: `#AppDetails_Tab_Activity`, on screen: "ACTIVITY"):**
      Calls `at({ setSections, details, overview })`.
        ```jsx
        function at(e) {
            return (
                <>
                    {e.setSections.has("friends") && (
                        <ce.gr details={e.details} />
                    )}
                    {e.setSections.has("postgamesummary") && (
                        <Ge.T details={e.details} />
                    )}{" "}
                    {/* Module 53074.T: Post-Game Summary */}
                    {e.setSections.has("playtestinvites") && (
                        <_e.aL overview={e.overview} />
                    )}
                    {e.setSections.has("spotlightdemo") && (
                        <_e.Be overview={e.overview} details={e.details} />
                    )}
                    {e.setSections.has("spotlightreview") && (
                        <_e.Cz parent={e.details} overview={e.overview} />
                    )}
                    {e.setSections.has("activity") && (
                        <ae.W appid={e.details.unAppID} />
                    )}{" "}
                    {/* Module 80478: Activity Feed */}
                    {e.setSections.has("timedtrialbanner") && (
                        <ge.P overview={e.overview} details={e.details} />
                    )}
                </>
            );
        }
        ```
    - **`YourStuff` (Label: `#AppDetails_Tab_YourStuff`, on screen: "YOUR STUFF"):**
      Calls `ot({ setSections, details, overview })`:
      Renders `achievements`, `cards`, `dlc`, `workshop`, `screenshots`, `review`, and `notes`.
    - **`Community` (Label: `#AppDetails_Tab_Community`, on screen: "COMMUNITY"):**
      Calls `lt({ setSections, details, overview })`:
      Renders `community`.
    - **`GameInfo` (Label: `#AppDetails_Tab_GameInfo`, on screen: "GAME INFO"):**
      Calls `ct({ setSections, details, overview })`:
      Renders `info` (`GameInfoContainer`, `CollectionsHeader`, `GameInfoQuickLinks`).

---

### 3. Why Non-Steam Games Were Blank in Big Picture

For a shortcut or non-Steam game, Steam's `GetSections()` filters:

```js
e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
```

`s` contains none of the sections checked by `at()` (`postgamesummary`, `activity`, `friends`, etc.).
Furthermore:

- `nonsteam` (the grey disclaimer box) is not rendered anywhere by Big Picture's tabs.
- `notes` and `screenshots` are rendered in the `YourStuff` tab.

Consequently, `at()` receives a set with zero matching entries and renders an empty Fragment `<></>`. The "ACTIVITY" tab was not broken — it simply had nothing enabled to display.

---

### 4. Native Post-Game Summary in Big Picture (**✅ Verified Live**)

Because Big Picture evaluates `e.setSections.has("postgamesummary") && <Ge.T details={e.details} />`, and `Ge.T` (module `53074`) reads from `window.appSpotlightStore.GetPostGameSummary(appid)`:

**Restoring `postgamesummary` in `GetSections` and populating `CAppSpotlightStore` makes Steam render its native Post-Game Summary in Big Picture Mode automatically.**

Verified live on AM2R (appid `4263274102`):

- Pushed capture events into `appSpotlightStore.GetOrCreateAppData(4263274102).m_session`.
- Restored `postgamesummary` in `GetSections`.
- Navigated Big Picture to AM2R.
- **Result:** Steam rendered its genuine, fully styled native component tree inside Big Picture's "ACTIVITY" tab:
    - `_1OMmVJHDgNwOt0Wqn0hrf9 GamePlaySummaryContainer Panel`
    - `_3FIjYetykQsFYR08l1v7Ls FocusRingRoot` (native controller focus highlight!)
    - `P_gQ8X-yCsgXeXpP68KS0 GamePlaySummaryHeader` ("Post-Game Summary")
    - `SMWMsB-gz3WbYRK2HOm7i PageableContainer Panel`
    - `_3fiHsLeD_6rtm6bM9lHlVL BoxCarousel SummaryCarouselContainer`
    - `_3CJctA7pLVdwHzNF5JmORE SummaryCarouselScrollingContainer`
    - Relative date headers ("Today", "Yesterday")
    - Individual capture cards with full controller D-pad/stick navigation and click-to-open media playback!
- Tested clean degradation on ActRaiser (`2788628389`, no captures): `hasSummary: false`, page renders stock without errors or empty boxes.

#### Comparison: Native Summary vs Clone

| Feature                      | Hand-built Clone (`gamepad-app.tsx`)     | Steam's Real Component (`Ge.T` via `stores.ts`) |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------- |
| **Lines of Plugin Code**     | ~280 lines of React/CSS                  | **0 lines of UI markup**                        |
| **Controller Focus & D-pad** | Broken (plain `div`s, no focus engine)   | **Native** (`FocusRingRoot`, `BoxCarousel`)     |
| **Paging & Carousels**       | None (overflow scroll)                   | **Native** (`PageableContainer`, auto-pagers)   |
| **Day Grouping & Headers**   | None                                     | **Native** ("Today", "Yesterday", date headers) |
| **Media Playback on Click**  | Custom hooks needed                      | **Native** (opens Steam's media viewer)         |
| **Visual Styling Drift**     | High (must re-measure per Steam build)   | **Zero** (updates automatically with Steam)     |
| **DOM Anchor Fragility**     | High (broke inside tab button, ADR-0028) | **Zero** (Steam places its own component)       |

---

### 5. Universal Navigation & Lifecycle Signals

In Big Picture Mode, routing does not update `window.location` (it uses React Router / in-place view state transitions). However, two robust signals exist to detect app detail navigation:

#### A. The Store Lifecycle Hook (`EnterAppDetailsPage` / `ExitAppDetailsPage`) — **Recommended**

Steam's own app details container (`L` in module `40478`) calls these methods on `appSpotlightStore` (module `74827` / `window.appSpotlightStore`) whenever entering or leaving an app detail page:

```ts
const store = spotlightStore();
const origEnter = store.EnterAppDetailsPage;
store.EnterAppDetailsPage = function (appid: number) {
    // User entered app detail page for appid (both Desktop and Big Picture!)
    return origEnter.apply(this, arguments);
};

const origExit = store.ExitAppDetailsPage;
store.ExitAppDetailsPage = function (appid: number) {
    // User left app detail page
    return origExit.apply(this, arguments);
};
```

This works identically across both Desktop and Big Picture Mode without relying on URL polling or DOM mutation observers.

#### B. React JSX Element Interception (`watchGamepadAppid`)

As discovered in ADR-0027, wrapping `react/jsx-runtime` (`jsx` / `jsxs`) from `SharedJSContext` intercepts element creation across all windows. Filtering for `typeof props.appid === 'number' && Array.isArray(props.rgSections)` reliably detects when Big Picture's tabbed page component mounts.

#### C. Programmatic Big Picture Navigation

To navigate Big Picture programmatically from `SharedJSContext`:

```js
const navigator = window.__wreq(49171).z.GetNavigator();
navigator.App(appid); // Navigate to app details page
navigator.Home(); // Navigate to library home
```

---

### 6. Steam's Gamepad Navigation System & Architecture

Big Picture Mode (GamepadUI) relies on a declarative spatial navigation system managed by `GamepadNavigationManager` (module `41433` / `SteamUIStore.m_GamepadNavigationManager`). Because Big Picture executes in `SharedJSContext`, all navigation components and trees live in the same runtime.

#### A. The `<Focusable>` Component (Module `12975`, Export `K`)

`<Focusable>` is the fundamental building block for all interactive elements in Big Picture Mode. It wraps DOM nodes into navigation nodes (`NavNode`) and automatically coordinates focus, spatial routing, CSS focus classes, and gamepad activation.

```tsx
interface FocusableProps extends React.HTMLAttributes<HTMLDivElement> {
    // Spatial layout of children
    "flow-children"?: "row" | "column" | "grid" | "none";

    // Gamepad actions (automatically mapped to keyboard equivalents)
    onActivate?: (e: Event) => void; // (A) button / Enter key (sets onClick & onOKButton)
    onCancel?: (e: Event) => void; // (B) button / Escape key (sets onCancelButton)
    onOKButton?: (e: Event) => void; // (A) button
    onCancelButton?: (e: Event) => void; // (B) button
    onSecondaryButton?: (e: Event) => void; // (X) button
    onOptionsButton?: (e: Event) => void; // (Y) button
    onMenuButton?: (e: Event) => void; // Start / Menu button

    // Directional navigation overrides
    onMoveUp?: (e: Event) => boolean;
    onMoveDown?: (e: Event) => boolean;
    onMoveLeft?: (e: Event) => boolean;
    onMoveRight?: (e: Event) => boolean;

    // Focus configuration
    focusable?: boolean; // Default: true if onOKButton / onActivate is provided
    focusableIfEmpty?: boolean;
    autoFocus?: boolean; // Take focus when tree mounts
    fnCanTakeFocus?: () => boolean; // Dynamic predicate
    navKey?: string; // Explicit node key for restoration
    navRef?: React.Ref<NavNode>; // Access to internal NavNode

    // Styling & classes
    focusClassName?: string; // Added when focused (merged with 'gpfocus')
    focusWithinClassName?: string; // Added when child has focus (merged with 'gpfocuswithin')
    noFocusRing?: boolean; // Suppress the animated focus highlight

    // Action Bar / Controller Legend integration
    actionDescriptionMap?: Record<number, string>;
    onOKActionDescription?: string;
    onCancelActionDescription?: string;
    onSecondaryActionDescription?: string;
    onOptionsActionDescription?: string;
    onMenuActionDescription?: string;
}
```

When rendered, `<Focusable>` automatically appends the base classes `Panel Focusable` to the DOM element. When receiving controller focus, it applies `gpfocus` (or custom `focusClassName`) and triggers focus ring measurement.

#### B. The `<FocusRingRoot>` Component

Interactive sections (such as `GamePlaySummaryContainer`) wrap their content in `<FocusRingRoot>`. It observes the active navigation target inside its subtree and draws Steam's native glowing, animated focus highlight over the focused `<Focusable>` element.

- Renders an overlay `<div className="FocusRingRoot"></div>`.
- When focus shifts between sibling elements, `<FocusRingRoot>` animates the outline's position and bounding box smoothly across the transition.
- Calling `OnForceMeasureFocusRing()` forces an immediate bounding-box recalculation if layout changes dynamically.

#### C. Gamepad Button Enums (Module `61657`, Export `pR`)

Steam defines all controller inputs in a standard numeric enum used throughout Big Picture navigation and action maps:

| Button Name                          | Enum Value | Standard Physical Mapping          |
| ------------------------------------ | ---------- | ---------------------------------- |
| `INVALID`                            | `0`        | None                               |
| `OK`                                 | `1`        | **(A)** / Cross / Enter            |
| `CANCEL`                             | `2`        | **(B)** / Circle / Escape          |
| `SECONDARY`                          | `3`        | **(X)** / Square                   |
| `OPTIONS`                            | `4`        | **(Y)** / Triangle                 |
| `BUMPER_LEFT`                        | `5`        | **LB** / L1                        |
| `BUMPER_RIGHT`                       | `6`        | **RB** / R1                        |
| `TRIGGER_LEFT`                       | `7`        | **LT** / L2                        |
| `TRIGGER_RIGHT`                      | `8`        | **RT** / R2                        |
| `DIR_UP` / `DOWN` / `LEFT` / `RIGHT` | `9`–`12`   | D-Pad / Directional Input          |
| `SELECT`                             | `13`       | View / Share / Back                |
| `START`                              | `14`       | Menu / Start / Options             |
| `LSTICK_CLICK` / `RSTICK_CLICK`      | `15`–`16`  | L3 / R3                            |
| `REAR_LEFT_UPPER` / `LOWER`          | `23`–`24`  | L4 / L5 (Steam Deck grip buttons)  |
| `REAR_RIGHT_UPPER` / `LOWER`         | `25`–`26`  | R4 / R5 (Steam Deck grip buttons)  |
| `STEAM_GUIDE`                        | `27`       | Steam / Guide / PS button          |
| `STEAM_QUICK_MENU`                   | `28`       | **(...)** Quick Access Menu button |

#### D. The Controller Footer Legend & `actionDescriptionMap`

At the bottom of Big Picture Mode, Steam displays the controller action legend (e.g. `(A) Select  (B) Back  (Y) Options`). This is not hardcoded into pages: it is driven dynamically by the currently focused `<Focusable>` or parent `<GamepadNavigationTreeRoot>`.

To show hints for your component:

```tsx
<Focusable
    onActivate={handleOpen}
    onSecondaryButton={handleDelete}
    actionDescriptionMap={{
        [GamepadButton.OK]: "Open Screenshot",
        [GamepadButton.SECONDARY]: "Delete Capture",
    }}
>
    ...
</Focusable>
```

When focus enters this element, Steam's footer automatically displays the controller glyphs and action labels, switching button icons automatically depending on whether an Xbox, PlayStation, Switch, or Steam Deck controller is connected.

---

### 7. Native Dialogs and Modals in Big Picture Mode

Plugins do not need custom modal overlays in Big Picture Mode. Steam provides a complete, controller-navigable dialog system in `SharedJSContext` that renders directly into the Big Picture window.

#### A. Opening a Native Modal (`showModal`)

Module `13869` exports `pg` (`showModal`):

```ts
import { showModal } from '@steambrew/client'; // Or req(13869).pg

// Locate the Big Picture popup window:
const bpmWindow = g_PopupManager.GetPopups().find(
  p => p.window?.name?.startsWith('SP BPM_') || p.strTitle === 'Steam Big Picture Mode'
)?.window;

// Spawn native modal:
await showModal(
  <ConfirmModal
    strTitle="Non-Steam Activity"
    strDescription="Native Big Picture dialogs work out of the box!"
    strOKButtonText="Awesome"
    bAlertDialog={true}
  />,
  bpmWindow,
  { strTitle: "Non-Steam Activity" }
);
```

#### B. Pre-Built Dialog Components (Module `10606`)

- **`ConfirmModal` (Module `10606.o0`):** Standard Steam confirmation / alert dialog. Supports `strTitle`, `strDescription`, `strOKButtonText`, `strCancelButtonText`, `bAlertDialog`, `bDestructiveWarning`, and `focusButton` (`'ok'` | `'cancel'`).
- **`GenericDialog` (Module `10606.NL`):** Base dialog container supporting custom children, custom button bars, and gamepad navigation entrapment.

Modals opened this way automatically receive:

- Focus trapping (controller navigation cannot leave the dialog).
- Blurred backdrop over the Gamepad UI.
- Native sound effects on open, close, and confirm.
- Proper (B) button dismissal.

---

### 8. Tab Construction & Custom Tab Injection in Big Picture Mode

#### A. How Steam Constructs Tabs (Module `3375`)

Big Picture's app detail page constructs its tabs inside function `it(props)` in module `3375`. It passes an array of tab descriptors to `GamepadTabbedPage` (`F` in module `3375`):

```tsx
const tabs: GamepadTabDescriptor[] = [
  {
    id: "WhatsNew",
    title: "#AppDetails_Tab_Activity",     // Screen: "ACTIVITY"
    content: <ActivityTabContent ... />
  },
  {
    id: "YourStuff",
    title: "#AppDetails_Tab_YourStuff",    // Screen: "YOUR STUFF"
    content: <YourStuffTabContent ... />,
    feature: Se.WJ
  },
  {
    id: "Community",
    title: "#AppDetails_Tab_Community",    // Screen: "COMMUNITY"
    content: <CommunityTabContent ... />,
    feature: Se.qR
  },
  {
    id: "GameInfo",
    title: "#AppDetails_Tab_GameInfo",     // Screen: "GAME INFO"
    renderTabAddon: () => <GameInfoIcon overview={overview} />,
    content: <GameInfoTabContent ... />
  }
];
```

#### B. Tab Descriptor Interface

Each entry in `props.tabs` supports:

- **`id`** (`string`): Unique identifier for state persistence and navigation.
- **`title`** (`string`): Localization token (`"#AppDetails_Tab_..."`) or literal text string.
- **`content`** (`React.ReactElement`): The panel content rendered when the tab is active.
- **`renderTabAddon`** (`() => React.ReactElement`, optional): Extra badge, controller glyph, or icon rendered inside the tab button header.
- **`feature`** (`number`, optional): Permission / feature flag required for the tab to display.

#### C. Injecting Custom Tabs (The SteamHunter Pattern)

Because `react/jsx-runtime` is shared between `SharedJSContext` and Big Picture, plugins can intercept the element creation of `GamepadTabbedPage` (`jsx`/`jsxs`) and append or prepend custom tabs directly into `props.tabs`:

```tsx
beforePatch(jsxRuntime, "jsx", (args) => {
    const [type, props] = args;
    if (
        props &&
        Array.isArray(props.tabs) &&
        typeof props.onShowTab === "function"
    ) {
        if (!props.tabs.some((t) => t.id === "CustomProviderTab")) {
            props.tabs.push({
                id: "CustomProviderTab",
                title: "RETROACHIEVEMENTS",
                content: <RetroAchievementsTab appid={props.appid} />,
            });
        }
    }
});
```

Steam's `GamepadTabbedPage` handles all tab button layout, controller bumper tab-switching (LB / RB), focus management, and transition animations automatically.

---

### 9. Media Playback & Native Fullscreen Viewers

When a user selects a screenshot or clip in the native Post-Game Summary in Big Picture Mode:

- Steam activates `ClickableScreenshot` (`_3JNo1hUKCpMJiJSM2dD5Kq`).
- It transitions Big Picture to the native media viewer page (`GamepadPage PadForHeader PadForFooter`).
- Fullscreen zoom, pan via thumbsticks, slideshow navigation (LB / RB), and (B) back-navigation to app details are handled entirely by Steam's native runtime.

---

### 10. The Homebrew Developer's Guide to Big Picture Mode

#### The Big Picture Reuse Ladder

Always work down this hierarchy when extending Big Picture Mode:

1. **Rung 1: Restore Sections & Feed Stores (Best)**
   If Steam already has the UI (Post-Game Summary, Activity feed, Screenshots):
    - Add the section name in `CAppDetailsSections.prototype.GetSections`.
    - Feed the store in `SharedJSContext` (`appSpotlightStore`, `appActivityStore`).
    - Steam renders its genuine native Big Picture components with zero custom UI code.
2. **Rung 2: Inject Custom Tabs**
   If you have a whole new feature set (e.g. RetroAchievements, Game Manuals):
    - Intercept `GamepadTabbedPage` via `jsx`/`jsxs` and append a tab to `props.tabs`.
    - Let Steam build the tab button, header, transitions, and focus rings.
3. **Rung 3: Render Real Steam Gamepad Components**
   When writing custom tab or panel content:
    - Use `<Focusable>` with `flow-children` and `actionDescriptionMap`.
    - Use Steam's native `DialogButton`, `Carousel`, and `showModal`.
    - Never hand-code controller event dispatchers when `<Focusable>` handles OK, Cancel, Secondary, and Options automatically.
4. **Rung 4: Cloned DOM / CSS Injection (Last Resort Only)**
   Only for trivial styling tweaks or elements Steam cannot represent natively. Hand-built clones in Gamepad UI break focus rings, fail controller navigation, and drift on every Steam client update.

---

### 11. Native Achievements, Notifications, Game Recording & Artwork Subsystems

Everything here was verified directly against Steam's live client runtime (`SharedJSContext`) and module definitions via CEF DevTools.

#### A. Native Achievement UI & Backing Store

Steam does not require custom HTML to show achievements. It already possesses a complete native achievements UI for both Desktop and Big Picture Mode:

1. **Desktop Right-Column Section (`achievements`):**
    - In `CAppDetailsSections.GetSections()`, the `"achievements"` key maps to `I.tm` (module `57665`, class `H`).
    - Component `H.render()` calls `AppDetailsStore.GetAchievements(this.unAppID)` (module `78057`, export `H`).
    - If `achievements.vecHighlight` and `achievements.nTotal > 0` are present, Steam renders the native achievement panel with percentage bar (`HighlightDiv`, `AllAchieved`), featured unlocked badges, and collapsible locked list.
2. **Post-Game Summary Strip:**
    - `CGamePlaySession.prototype.AddAchievement(achievement, unlockTimestamp)` in `CAppSpotlightStore` (module `74827`) pushes achievements directly into the session card strip alongside screenshots and clips.
3. **Big Picture Play Bar Progress:**
    - Big Picture reads `{ unlocked, total }` directly from `window.appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)` to populate the quick stats bar under the Play button.

#### B. Native Achievement Notifications (`NotificationStore`)

Steam's notification engine can be instructed to emit genuine achievement toasts complete with sound, animation, and overlay integration:

- **Dispatch Endpoint:** `window.NotificationStore.OnNotification(notificationId, NotificationType.Achievement, binaryPayload)`
    - Enum value: `NotificationType.Achievement` (`u.uM.ok`).
    - Payload Protobuf: `CAchievementNotification` (`u.R8.fromObject(...)`) with schema:
        ```ts
        interface AchievementPayload {
            achievement_id: string;
            appid: number;
            name: string;
            description: string;
            image_url: string;
            achieved: boolean;
            rtime_unlocked: number; // unix seconds
            current_progress?: number;
            max_progress?: number;
            global_achieved_pct?: number;
        }
        ```
- **Sound & Customization:**
    - `NotificationStore.ChooseSound(config, notification)` and `NotificationStore.PlayNotificationSound(notification)`.
    - Plugins can intercept the sound decision or play custom audio assets (e.g. PlayStation trophy chime, Xbox rare achievement chime, RetroAchievements chime) alongside the dispatch.

#### C. Native Game Recording RPCs & Timeline Markers

Steam's 2024 Game Recording system (`CGameRecordingService`, webpack module `80026` / export `xM`) exposes structured RPCs through Steam's CM transport:

1. **Golden Timeline Markers (`GameRecording.UserAddTimelineEntry#1`):**
    - Request: `CGameRecording_UserAddTimelineEntry_Request` (`{ game_id, entry, clip_id }`).
    - Inserts an icon marker directly onto Steam's active recording timeline at the exact timestamp.
2. **Instant Replay Clips (`GameRecording.SaveClip#1`):**
    - Request: `CGameRecording_SaveClip_Request` (`{ game_id, start, end, name, src_clip_id, temporary, force_thumbnail }`).
    - Automatically cuts a clip (e.g., previous 15–30 seconds around an achievement event) into `gamerecordings/clips/`.
3. **Capture Screenshot (`GameRecording.TakeScreenshot#1`):**
    - Request: `CGameRecording_TakeScreenshot_Request` (`{ game_id, timeline_id, timeline_offset_ms, source_clip_id }`).
    - Triggers native frame grab directly aligned with the recording timeline.

#### D. Custom Artwork Injection API

SteamClient provides a high-level API to assign custom artwork to any shortcut without manual file copying:

```ts
SteamClient.Apps.SetCustomArtworkForApp(
    appid,
    base64Data,
    extension,
    imageType,
);
```

- **`imageType 0`**: Tall portrait capsule (600 × 900)
- **`imageType 1`**: Wide hero background banner (1920 × 620)
- **`imageType 2`**: Transparent logo PNG
- **`imageType 3`**: Wide library capsule (920 × 430)

Clearing custom artwork: `SteamClient.Apps.ClearCustomArtworkForApp(appid, imageType)`.

#### E. Game Info Tab & Metadata Enrichment

The Big Picture `GameInfo` tab (`/library/app/<appid>/tab/GameInfo`) and desktop metadata panels query `CAppDetailsStore`:

- `GetDescriptions(appid)`: Provides `strFullDescription`, `strSnippet`.
- `GetAssociations(appid)`: Provides `rgDevelopers`, `rgPublishers`, `rgFranchises`.
- `strManualURL`: Provides community guides / digital manual links.
  Feeding these in-memory stubs satisfies the native Game Info tab without modifying Steam's tab layout components.
