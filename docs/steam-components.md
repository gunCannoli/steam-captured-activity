# Steam components — how Steam's UI is really built

**This doc's job:** the deep reference for what Steam's client actually does —
the app detail page's section registry, the Post-Game Summary and Activity
stores, Big Picture's portal architecture, and the achievement, notification,
recording and artwork subsystems. It answers one question: _what does Steam
already do, so that we can call it instead of imitating it?_

Everything here was **read out of the live Steam client** over CEF devtools
(from 2026-09-20): module factories pulled from `webpackChunksteamui`, stores
poked with real appids, DOM verified on screen. No inference from screenshots.

Not here: the one-page map and every stable resolution signature
([steam-architecture.md](steam-architecture.md) — start there); how to inspect
the client yourself ([steam-debug.md](steam-debug.md)); the rules for plugin
code that touches any of this ([plugins.md](plugins.md)).

> **Numeric module ids and minified names in this doc are one build's
> breadcrumbs** — how the code was read, not how to resolve it. Production code
> resolves by signature ([steam-architecture.md § 3](steam-architecture.md#3-stable-resolution-signatures)).

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


### Reading captures through Steam's own APIs

Steam already indexes non-Steam captures. Both calls work unmodified for a
shortcut and return absolute `steamloopback.host` URLs Steam serves itself, so no
image crosses the RPC boundary:

```js
await SteamClient.Apps.GetScreenshotsInTimeRange(appid, since, 0); // 32-bit appid
await service.GetClips({ game_id: gameid, created_after: since }); // 64-bit gameid
```

**Steam's own gameid helper truncates to 32 bits.** `bY(4263274102)` returns
`1861238`, not `18310622842007322624`. That single bug is why non-Steam clips
never appear natively — the service is willing, Steam just asks about the wrong
game. Compose the gameid yourself
([knowledgebase.md § The two identifiers](knowledgebase.md#the-two-identifiers)).

The core feeds `m_session` via `BAddScreenshotNotification` / `AddClip`, oldest
first, then sets `m_postGameSummary`; Steam renders the rest.

### Rendered DOM and CSS modules

Captured with `outerHTML` on native pages (Divinity: Original Sin 2, `435150`;
Fields of Mistria for the pager). Readable halves of the class pairs only —
Steam ships e.g. `KniunRMLsSnzOWTG-tq81 PostGameSummaryClip Panel`.

```
PageableContainer.Panel
├─ HeaderPageControls
│  ├─ GamePlaySummaryHeader              -- "Post-Game Summary" (CSS uppercases it)
│  └─ PageClickContainer
│     ├─ PageLeft.Small [.Disabled]      -- arrow SVG, scaleX(-1)
│     ├─ PageRight.Small [.Disabled]
│     └─ PageableCloseButton.Small       -- the "X"
└─ BoxCarousel.SummaryCarouselContainer
   └─ BoxCarouselContents.SummaryCarouselScrollingContainer   -- display:flex, row
      └─ [role=list] (display:contents)
         ├─ [role=listitem].SummaryContainer        -- ONE per tile, not per day
         │  ├─ EventHeaderBlock                     -- "Today" on a day's first tile only
         │  └─ SummaryContainerChildren             -- exactly one tile
         │     └─ [role=button].PostGameSummaryClip.Panel  style="aspect-ratio: 1.77778 / 1"
         │        ├─ img.ClipThumbnail
         │        └─ CornerContent > DurationText.Clip  (Steam's clip SVG + "0:06")
         ├─ div.TypeSeparator.SpaceOnly [data-carousel="ignore"]
         ├─ [role=listitem].SummaryContainer
         │  └─ … [role=button].SummaryScreenshot.ClickableScreenshot.Panel
         │        ├─ img.ClickableScreenshotImg.UseHeight
         │        └─ ScreenshotShareIcon (hover)
         └─ … ForcedCarouselPadding [data-carousel="ignore"]
```

- Header, pager arrows and close button share one `HeaderPageControls` row,
  sibling of the carousel inside one `PageableContainer`.
- Tiles size fluidly by inline `aspect-ratio` (16:9), not fixed pixels.
- `.Disabled` on the arrows is a class Steam toggles from scroll position.

The page's classes come from **four separate CSS modules** — found by searching
the module cache for each class name, not guessed:

| Probe key                  | Also exports                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SummaryCarouselContainer` | `SummaryCarouselScrollingContainer`, `GamePlaySummaryHeader`, `SummaryContainer`, `SummaryContainerChildren`, `SummaryScreenshot`, `EventHeaderBlock`, `TypeSeparator`, `ForcedCarouselPadding` |
| `PageableContainer`        | `HeaderPageControls`, `PageClickContainer`, `PageLeft`, `PageRight`, `PageableCloseButton`, `Disabled`, `Small`                                                                                 |
| `PostGameSummaryClip`      | `ClipThumbnail`, `CornerContent`, `DurationText`                                                                                                                                                |
| `ClickableScreenshotImg`   | `ClickableScreenshot`, `ScreenshotShareIcon`, `UseWidth`, `UseHeight`                                                                                                                           |

Several values are already two-token strings (`PageableContainer.Small ===
"_3qlJ0L41KQFqUTzVQKFERC Small"`). Why both facts matter for plugin code:
[plugins.md § Rules that apply on every rung](plugins.md#rules-that-apply-on-every-rung).

### Pageable and Carousel — the real summary pager

`@steambrew/client`'s exported `Carousel` is a virtualizer and is **not** what the
summary uses. The real pair is unexported:

- **`Pageable`** (module `4584`, export `C`) renders `PageableContainer` →
  `HeaderPageControls` → `PageableContent`. Its `children` is a **render-prop**,
  `(ref, fnUpdateArrows) => ReactNode`. It owns `bLeftArrowEnabled` /
  `bRightArrowEnabled` and renders the arrows **only when at least one is true** —
  which is why a one-row summary shows no arrows at all.
- **`Carousel`** (module `26271`, export `Q`) — a `ResizeObserver` re-checks
  overflow; `UpdateScrollArrows` computes left (`scrollLeft >= 1`) and right
  (`scrollLeft + clientWidth < scrollWidth`) and reports via `fnUpdateArrows`;
  `ScrollLeft`/`ScrollRight` scroll to the next tile not fully visible (not a
  fixed amount); children with `data-carousel="ignore"` are skipped; it animates
  `scrollLeft` by hand ([knowledgebase.md § CEF no-ops](knowledgebase.md#steams-embedded-cef-two-silent-no-ops)).

Two easy misreadings of `Pageable`'s props:

- `name` alone (no `customheader`) renders Pageable's own generic `Name`+`Rule`
  header, not the summary's `GamePlaySummaryHeader` div. Native always passes
  `customheader`.
- `bNoHeader` gates the **entire** header div, `customheader` included. Native
  sets it only for an achievements-only ("short") summary. Media-tile content
  always wants `bNoHeader={false}`.

The pager chevron (module `50376`) takes `singlearrow` (skips the second
`<polyline>` of its default double chevron) and `angle={0|180}`.

The usage is the [element tree](#element-tree) above.

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

**Mount order and progressive reveal (verified live 2026-09-24, desktop, 4 A→B→A cycles).**
`GetAppActivity(appid)` with no map entry calls `RequestRestoreActivity` → `RestoreActivity`:
`await RestoreCachedActivity` (a MobX flow; it only `set`s when the local cache has events, which a
shortcut never has), then `m_mapAppActivity.set(appid, new CAppActivity(appid))` plus a server fetch. The core's
`clearActivity` deletes the entry on navigation away, so on every return Steam creates the empty
entry first (`0` days, fetch requested). `publishActivity` then fills **that same object**, about 0.3 to 1.2 s
later. On every visit the store ended at 3 days for AM2R. The component renders
`appActivityByDay.slice(0, nDaysToDisplay)`. `ShowMoreContent()` raises `nDaysToDisplay` **one day
at a time**, so the DOM shows 1 day, then 2, several hundred ms after the store is full. Compare the
store, not DOM day counts ([plugins.md guardrail 15](plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour)).

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

### The store-record blocker

**✅ Verified live.** Every event needs a store record.

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

### How the store-record blocker was cleared

**✅ Verified live & shipped.**

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
- Teardown: `clearActivity(appid)` clears the day records on navigation away but **keeps** the `StoreItemCache` stub — deleting it poisons Steam's negative cache ([plugins.md guardrail 5](plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization)).

Achievement data for non-Steam games comes from providers
([ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)); where Steam renders it is
[§ Achievements, notifications, recording & artwork](#achievements-notifications-recording--artwork).

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

## Big Picture Mode

The earlier assumption (ADR-0023, ADR-0024) that Big Picture runs as a separate JavaScript bundle with an unreachable module cache and store was **proven false** (ADR-0029). Big Picture runs in the **exact same JavaScript runtime as Desktop (`SharedJSContext`)**, rendering through a multi-window React Portal. As a result, **the exact same store-feeding and section-restoration technique used on Desktop (ADR-0022) works out of the box in Big Picture Mode** — no hand-built clone markup or DOM injection needed.

How to switch modes and inspect the Big Picture target: [steam-debug.md](steam-debug.md#4-big-picture-mode-gamepad-ui-quirks--traps).

### The multi-window React portal architecture

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

#### The fiber proof

**✅ Verified live.**

Comparing the React Fiber root in `SharedJSContext` with the rendered elements inside the Big Picture popup proved they are the **same React tree**:

- `SharedJSContext` `#root`: `__reactContainer$2x6thximn4h`, `_reactListeningwb7s4ax711`
- `Steam Big Picture Mode` `#popup_target`: `__reactFiber$2x6thximn4h`, `_reactListeningwb7s4ax711`

The Fiber suffix (`2x6thximn4h`) is generated once per React instance at startup. Because both windows share the identical suffix, **all Big Picture React components run in `SharedJSContext`**.

Webpack chunk `3714` (`sp.js`, the Big Picture entry point) pushes directly into `self.webpackChunksteamui` in `SharedJSContext`. Every store (`appSpotlightStore`, `appActivityStore`, `appDetailsStore`, `appStore`) is a live singleton in `SharedJSContext`.

---

### How Big Picture builds the app detail page

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

### Why non-Steam games were blank in Big Picture

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

### Native Post-Game Summary in Big Picture

**✅ Verified live.**

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

### Navigation & lifecycle signals

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

### Gamepad navigation system

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

### Native dialogs and modals

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

### Tab construction & custom tab injection

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

### Media playback & fullscreen viewers

When a user selects a screenshot or clip in the native Post-Game Summary in Big Picture Mode:

- Steam activates `ClickableScreenshot` (`_3JNo1hUKCpMJiJSM2dD5Kq`).
- It transitions Big Picture to the native media viewer page (`GamepadPage PadForHeader PadForFooter`).
- Fullscreen zoom, pan via thumbsticks, slideshow navigation (LB / RB), and (B) back-navigation to app details are handled entirely by Steam's native runtime.

---

## Achievements, notifications, recording & artwork

Everything here was verified directly against Steam's live client runtime (`SharedJSContext`) and module definitions via CEF DevTools.

### Native achievement UI & backing store

Steam does not require custom HTML to show achievements. It already possesses a complete native achievements UI for both Desktop and Big Picture Mode:

1. **Desktop Right-Column Section (`achievements`):**
    - In `CAppDetailsSections.GetSections()`, the `"achievements"` key maps to `I.tm` (module `57665`, class `H`).
    - Component `H.render()` calls `AppDetailsStore.GetAchievements(this.unAppID)` (module `78057`, export `H`).
    - If `achievements.vecHighlight` and `achievements.nTotal > 0` are present, Steam renders the native achievement panel with percentage bar (`HighlightDiv`, `AllAchieved`), featured unlocked badges, and collapsible locked list.
2. **Post-Game Summary Strip:**
    - `CGamePlaySession.prototype.AddAchievement(achievement, unlockTimestamp)` in `CAppSpotlightStore` (module `74827`) pushes achievements directly into the session card strip alongside screenshots and clips.
3. **Big Picture Play Bar Progress:**
    - Big Picture reads `{ unlocked, total }` directly from `window.appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)` to populate the quick stats bar under the Play button.

### Achievement notifications (`NotificationStore`)

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

#### Resolution signatures & toast windows

**✅ Verified live 2026-09-24** (`enhanced-achievements` Step 0; toast-window rows updated by the Big Picture toast fix).

Module ids and minified names are one build's breadcrumbs; these are the stable
handles `enhanced-achievements` resolves by. Probes: `enhanced-achievements/tests/probes/`.

| Target | Stable signature | Verified facts |
| --- | --- | --- |
| `NotificationStore` | `window.NotificationStore` | `PlayNotificationSound(n)` is a plain prototype method: `const r = Q[n.eType]; const i = this.ChooseSound(r, n); i && PlayNavSound(i)`. `ProcessNotification` is a **bound, non-writable, non-configurable own property**, so it cannot be wrapped. |
| Achievement type | `n.data.getClassName() === "CClientNotificationAchievement"` | `eType` is `5` on this build. Discover it by calling the original `PlayNotificationSound` on a stand-in `{ ChooseSound(cfg) { … } }` for each eType: it hands back each type's config `Q[eType]` (with `.proto`, `.toastDurationMS`) without playing anything. |
| Sound mute | `ChooseSound(config, n)` | Already honours Steam's `play_sound_on_toast` setting (and `bCritical`). Steam's chime goes `PlayNavSound(id)` → `m_fnCallbackOnPlaySound.Dispatch` to a native player (id `5` = toast achievement), not WebAudio in SharedJSContext. |
| Toast duration | `Q[achievementType].toastDurationMS` | Read by both `ProcessNotification` (`t.nToastDurationMS = e.toastDurationMS \|\| 5e3`) and the in-game overlay path (`AddAppOverlayNotification`). Setting it on the config applies to every later toast. |
| Toast dispatcher | Exported function whose source has `switch(e){case` and `group`, in the module containing `global_achieved_pct()` and `"Missing activate function"` | The achievement renderer (`ht`) is **not exported**; its dispatcher (`Tm`/`Ke`) is. Created as `jsx(dispatcher, { location, group: { eType, notifications: [n] }, onDismiss })` inside the toast container. `react/jsx-runtime`'s `jsx` is a writable export (ADR-0027). |
| Toast windows | CDP titles `notificationtoasts_<n>_desktop`, `notificationtoasts_uid<n>` (Big Picture) | All `about:blank` portals rendered from SharedJSContext. Desktop frame: fixed **284×71** (DPR 1.25). Big Picture frame: **300×80**. In-game overlay toasts use the same dispatcher via `ge("notificationtoasts", …, appid)` (code-verified; not yet verified with a real in-game unlock). **How each is created** (docs/plans/enhanced-notifications-toast-window-bugfix.md): desktop and the in-game overlay get **one popup per toast**, opened through Steam's popup manager (`g_PopupManager`), so `Millennium.AddWindowCreateHook` sees it. Big Picture gets **one persistent popup**, created once via `SteamClient.BrowserView.CreatePopup` + `window.open` and reused for every toast (`SetVisible`); it is **not** registered with `g_PopupManager`, so it is reachable only via the `GamepadToastPlaceholder` div Steam renders into the (tracked) Big Picture main window — walk that div's React fiber to a hook holding the popup object, then call `GetViewWindow()`. Gamescope/Steam Deck underlay mode renders the toast **embedded** in the main window (`ToastContainerEmbedded`), no separate window at all. |
| Completion | `window.appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)` → `{ unlocked, total, all_unlocked }` | On an achievement notification Steam only **queues** a refresh (`OnAchievementNotification → QueueCacheUpdate`), so at toast time the entry is the pre-unlock state: `!all_unlocked && unlocked + 1 >= total` means this unlock completes the game. |
| Test toast | `NotificationStore.TestAchievement(appid)` | Async (awaits `RequestAppDetails`). Always sends `global_achieved_pct: 10`. For other rarities, build the payload with `Q[type].proto.fromObject({...}).serializeBinary()` and call `OnNotification(id, type, bytes)`. |

### Game Recording RPCs & timeline markers

Steam's 2024 Game Recording system exposes structured RPCs through Steam's CM
transport, verified live 2026-09-24 (docs/plans/phase7-and-alpha-plan.md § A1;
no real capture, clip or marker was created — only dry probes with a bogus
game id, all failing cleanly). Module ids below are build breadcrumbs, not
stable — resolve by signature only.

**Resolution.** The service: the export object of the module whose source
contains `"GameRecording.TakeScreenshot#1"`, with
`v.TakeScreenshotHandler?.name === "GameRecording.TakeScreenshot#1"` and
functions `TakeScreenshot`, `SaveClip`, `UserAddTimelineEntry` (this build:
module `80026`, export `xM`). `SteamClient.GameRecording` is **not** the RPC
service — it only has `RegisterForAudioSessionsChanged` /
`SetAudioSessionCaptureState`. There is **no `SteamClient.*` trigger for a live
capture**; `SteamClient.Screenshots.*` is read/manage only.

**Calling convention.** Steam's own callers (`CGameRecordingStore`) pass plain
objects; the service converts them to protobuf itself:
`const res = await svc.TakeScreenshot({...}); res.GetEResult(); res.BSuccess(); res.Body().toObject();`.
It never throws on a bad request (it resolves with a failing `EResult`); it can
reject only with no transport ("Transport Error").

1. **`GameRecording.TakeScreenshot#1`** — request `{ game_id, timeline_id,
   timeline_offset_ms, source_clip_id? }`; response `{ screenshot_id }`.
   **It extracts a frame from already-recorded video at that timeline offset**
   (backs the timeline menu's "Take Screenshot at Current Playback"), not a
   F12-style live grab — it needs background or manual recording already
   running at that moment.
2. **`GameRecording.SaveClip#1`** — request `{ game_id, start: {timeline_id,
   offset_ms}, end: {timeline_id, offset_ms}, name, src_clip_id?, temporary
   (must be `false` to keep it), force_thumbnail }`; response `{ summary:
   {clip_id, game_id, duration_ms, date_recorded, thumbnail_url, …} }`.
3. **`GameRecording.UserAddTimelineEntry#1`** — request `{ game_id, entry:
   {timeline_id, entry_id: "" on create, time (ms, uint64 string), type,
   game_mode, range_title, range_duration, range_possible_clip,
   timestamp_title, marker_icon, marker_description, marker_priority,
   screenshot_handle, achievement_name, tag[], phase_id, attributes[]},
   clip_id? }`; response `{ entry_id }`.

**`ETimelineEntryType`** (protobuf wire enum, a network contract, not a
webpack id): `GameMode=1, Event=2, StateDescription=3, Achievement=4,
UserMarker=5, Screenshot=6, Error=7`. Rendering, from Steam's proto→UI
converter: `UserMarker` (5) always draws as `steam_marker` (icon and title
dropped on reload); `Event` (2) keeps `marker_icon`, `range_title`,
`marker_description`; `Achievement` (4) keeps only `achievement_name` and is
looked up via `GetAchievementInfo(appid, achievement_name)` — only resolves
for apps with a Steam achievement schema. **Steam already writes an
`Achievement`-type entry on its own games' unlocks**, so a plugin-added marker
for a native Steam game would duplicate it; only add one for non-Steam
shortcuts (whose achievements have no Steam schema entry).

**Live recording state:** `window.g_GRS`, an instance of `CGameRecordingStore`
(created by the client's own store init on both desktop and gamepad startup
paths). `g_GRS.m_mapActiveTimelines: Map<timelineId, {loader, release}>`; the
loader has `BIsTimelineRunning(tid)`, `GetRunningTimelineDurationMS(tid)`
(a `performance.now()`-based live offset), `GetGameID()` (uint64 string —
native games use the plain appid, shortcuts the composed 64-bit gameid, per
AGENTS.md § two identifiers), `GetTimelineStartBeforeGlobalZeroMS(tid)`, and
`m_mapRunningTimelines: Map<tid, {m_metadata, m_runningRecording}>`, where
`m_runningRecording` is `{recording_id, start_offset_ms, duration_ms,
recording_type}` while video is being written, `null` otherwise. **Stale
entries stay in `m_mapActiveTimelines`** after a timeline stops (Steam calls
`release()` but never deletes the map entry), so `BIsTimelineRunning` is
mandatory before trusting an entry. `g_GRS` must be read fresh on every use,
never cached — Steam can recreate it.

**Dry-probe EResults** (bogus `game_id: "1"`, `timeline_id:
"timeline_0_nonexistent"`): `GetState({})` → 1 OK; `GetTimelinesForApp` → 1,
empty; `TakeScreenshot` → 8 (InvalidParam); `SaveClip` (`temporary: true`) →
79 (InvalidState); `UserAddTimelineEntry` (type 5) → 42 (NoMatch).

Implementation: `enhanced-achievements/frontend/steam/recording.ts` (the only
file touching these objects) and `frontend/capture/{plan,captures}.ts` (pure
planning + scheduling). Full spec:
[docs/plans/phase7-and-alpha-plan.md](plans/phase7-and-alpha-plan.md) § A1–A2.

### Custom artwork API

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

**P0 findings (2026-09-24).** Both methods exist (plus `SetCustomLogoPositionForApp`). The run was read-only, so the 3-5 MB base64 limit, the `grid/` file and clear behaviour are **unverified: P3 must add a self-check on a test shortcut**. `AppOverview` exposes only hash fields (`icon_hash`, `library_capsule_filename`, `header_filename`, `rt_store_asset_mtime`), so **user-set art in a slot is not detectable** from it: P3 records only slots it wrote and clears only those. `appDetailsStore.RequestCustomImageInfo` exists and is a candidate to check.

### Collections (`collectionStore`)

Verified live 2026-09-24 (`scratch/cartridges/p0-t1-collections.mjs`, `p0-t1b.mjs`).

- `window.collectionStore` is a class instance (`OnAppOverviewChange` is an own field). `userCollections` is an **Array** (22 here, including `favorite`, `uncategorized`, `type-music`). Also `GetCollection(id)`, `GetCollectionListForAppID(appid)` (collections holding the app, shortcuts included), `AddOrRemoveApp`, `SaveCollection`, `DeleteCollection`.
- Per collection: `id` (also `m_strId`; `uc-...` user, `srm-<base64 name>` static, `favorite`), `displayName`, `bIsDynamic`, `bIsEditable`, `allApps` (AppOverview[]), `apps` (a Map keyed by numeric appid, so `apps.has(appid)` is O(1)), `m_filter` (set for dynamic), `m_setAddedManually`, `m_setRemovedManually`. Methods: `AddApps`, `RemoveApps`, `Save`, `Delete`, `FreezeToStatic`.
- Shortcuts appear in membership for **both** static (`Fav`, `SNES`) and dynamic (`Installed`, `Not Played`) collections. Use `apps.has` / `GetCollectionListForAppID`.
- Readiness: populated once the client UI has loaded. Wait on `collectionStore.m_mapCollectionsFromStorage` (a plain field, created in the first `OnCloudStorageChanged`). Never read `userCollections` or any other collectionStore computed before then. They are MobX keepAlive computeds, and a throw before they track anything poisons them for the session, which breaks Steam's `CollectionsHeader` for every app.
- Change signal: not observed. `AddApps`/`RemoveApps`/`Save` are the mutators; P2 re-resolves on view per ADR-0033. Nothing was hooked.

### Store item data for arbitrary apps

Verified 2026-09-24 (`p0-t3-sic*.mjs`, `p0-t2-cdn.mjs`).

- `appStore.allApps`: 690 entries here: native by `app_type` (1: 309, 2: 5, 4: 151, 8: 1, 8192: 2, 65536: 2) plus 220 shortcuts (`1073741824`). 470 have `appid < 0x80000000`. Usable fields: `display_name`, `sort_as`, `app_type`. Owned and known apps, not the whole store.
- `window.StoreItemCache` (Steam's CM transport) **loads unowned apps**: `QueueAppRequest(appid, {include_assets:true, include_basic_info:true, include_release:true, include_full_description:true})`, wait ~4 s, then `BHasApp`/`GetApp`. Verified with 2820820 (absent from `appStore`). Item fields: `m_strName`, `m_BasicInfo` (short_description, developers[], publishers[]), `m_ReleaseInfo` (`steam_release_date`), `m_StoreCategories` (id lists), `m_rgStoreTags`, `m_strFullDescriptionBBCode`, and `GetAssets()` with `GetLibraryHeroURL`, `GetLibraryCapsuleURL(_2x)`, `GetHeaderURL`, `GetMainCapsuleURL`. Steam's own data, no scraping.
- Asset URLs are hashed paths under `shared.steamstatic.com/store_item_assets/steam/apps/<id>/<hash>/...`: take them from `GetAssets()`, do not hand-build.
- No client-side title to appid search exists; `storesearch` stays step 3. A frontend `fetch` to store search failed (`Failed to fetch`), so search stays in the backend.
- Frontend `fetch()` of `cdn.akamai.steamstatic.com/steam/apps/435150/` succeeds (200) for `library_hero.jpg` (354759 B), `library_600x900.jpg` (61149 B), `logo.png` (262681 B), `header.jpg` (52895 B): no backend download needed for unhashed paths of an existing app.

### Game Info tab & metadata

The Big Picture `GameInfo` tab (`/library/app/<appid>/tab/GameInfo`) and desktop metadata panels query `CAppDetailsStore`:

- `GetDescriptions(appid)`: Provides `strFullDescription`, `strSnippet`.
- `GetAssociations(appid)`: Provides `rgDevelopers`, `rgPublishers`, `rgFranchises`.
- `strManualURL`: Provides community guides / digital manual links.
  Feeding these in-memory stubs satisfies the native Game Info tab without modifying Steam's tab layout components.

## Links, navigation and native content for a mapped shortcut

Verified live 2026-09-25, desktop, read-only CDP (module ids are this build's
breadcrumbs; resolve by the signatures at the end). Subjects: shortcut
2315502503 (Jotunnslayer, Epic copy, Game Info enriched), native 2820820 (not
owned), 435150 (owned). Used by
[parity plan § 5b](plans/steam-cartridges-parity.md#5b-parts-fh-only-true-badges-links-news-and-community-content-open-the-native-app)
and [ADR-0038](decisions.md#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app).

### Store categories and feature badges

- Game Info's inner component (module `15448`) draws 15 `FeaturesList` badges with
  `n$({ overview, feature })` (module `28346`, feature table `w`). Each asks module
  `14629` `Xr(overview)(feature)`, which calls `overview.BHasStoreCategory(id)`:

  | Badge (`#AppDetails_Feature_*`) | Store category ids | Other source |
  | --- | --- | --- |
  | SinglePlayer | 2 | — |
  | MultiPlayer | 1, 36, 37, 27, 20, 24 | — |
  | CoOp | 9, 38, 39 | — |
  | FullController | 28 | `xbox_controller_support == 2` |
  | PartialController (only when not full) | 18, 28 | `xbox_controller_support` 1 or 2 |
  | PS4 / PS5 controller | 55, 56 / 57, 58 | — |
  | VRSupport | 31 | `vr_supported` |
  | HDR | 61 | — |
  | SteamAchievements | 22 | — |
  | SteamCloud | 23 | — |
  | SteamWorkshop | 30 | — |
  | RemotePlayTogether | 44 | — |
  | SteamInputAPI | 59 | — |
  | FamilySharing | 62 | — |

  There is **no Shared/Split Screen badge**: 24 only feeds MultiPlayer. 29 (Trading
  Cards) and 60 exist only as library filters.
- `StoreItemCache` items split categories into three groups,
  `m_StoreCategories = { supported_player_categoryids, feature_categoryids, controller_categoryids }`,
  with accessors `GetStoreCategories_SupportedPlayers / _Features / _Controller()`.
  2820820: `[2, 1, 9, 39, 24]` / `[22, 29, 23, 44, 62]` / `[28]`; 435150:
  `[2, 1, 49, 36, 37, 9, 38, 39, 24]` / `[22, 29, 13, 30, 23, 17, 42, 43, 44, 62]` / `[28]`.
  The feature group is Steam services (plus 13 captions and 17 level editor). Items
  also expose `GetTagIDs()` (20 ids), `GetAllLanguagesWithSomeSupport()`,
  `GetFilteredReviewSummary()`, `GetPlatforms()`.
- `AppOverview` of an owned app also carries `m_setStoreTags`, `metacritic_score`,
  `bitfield_supported_languages`, `review_score_*` / `review_percentage_*` and
  `steam_hw_compat_category_packed` (all zero on a shortcut). They feed library
  sorting and dynamic-collection filters, not the app page.

### The links bar (module `52470`, export `Qd`)

- Built in a computed only when `!overview.BIsModOrShortcut()`, from
  `i = overview.appid` (a demo's parent for `app_type` demo): Store Page
  `urlStore.BuildStoreAppURL(appid, "primarylinks")`; DLC `BuildStoreAppDlcURL` when
  `details.bAvailableContentOnStore`; Community Hub `link: "GameHub"`; Points Shop
  `BuildAppPointsShopURL` when the app has points-shop cards; Discussions
  `"GameHubDiscussions"`; Guides `"GameHubGuides"`; Workshop `"SteamWorkshopPage"`
  when the `workshopVisible` prop is true; Market `"CommunityMarketApp"` when
  `marketPresence`; Support `"HelpAppPage"` unless kiosk mode.
- Each entry renders `P` (export `aX`): `url ?? urlStore.ResolveURL(link, appid)`,
  opened with `Navigator.SteamWeb` (module `18057` `Qt`, Steam's in-client browser).
  Desktop row `O`, Big Picture carousel `z`.
- Rendered with jsx by the desktop page (module `59856`,
  `jsx(k.Qd, { overview, details, workshopVisible, marketPresence })`) and by Big
  Picture's Game Info (module `3375`, inside `GameInfoQuickLinks`).
- **For a shortcut:** no links until Game Info is enriched; then our prototype hook
  (`game-info-patch.ts` `ensureAppOverviewHooked`, `BIsModOrShortcut` false for
  `enrichedAppIds`) makes Steam build them from the shortcut appid. Live props:
  `https://store.steampowered.com/app/2315502503?snr=5000_5100__`, `GameHub` /
  `GameHubDiscussions` / `GameHubGuides` / `HelpAppPage` with `appid: 2315502503`.
- `window.urlStore` (CURLStore, module `87935` `B7`) resolves Steam's URL ids from
  `SteamClient.URL.GetSteamURLList`. For 2820820: `GameHub` →
  `https://steamcommunity.com/app/2820820/`, `GameHubDiscussions` → `…/discussions/`,
  `GameHubGuides` → `…/guides/`, `SteamWorkshopPage` → `…/workshop/`, `HelpAppPage` →
  `https://help.steampowered.com/en/wizard/HelpWithGame/?appid=2820820`, `StoreAppPage` →
  `https://store.steampowered.com/app/2820820/`, `GameHubNews` / `AppNewsPage` → the
  store news hub.

### Header buttons: Manage and Properties

- The desktop header (module `56262`) has the gear "Manage" button, which opens the
  app context menu (module `5808`, class `Fe`), the ⓘ Game Info toggle (shown when
  `!BIsModOrShortcut()`) and the favourite star.
- `Fe` builds its items from `app_type` and local install state, not from
  `BIsModOrShortcut`: "Properties…" is `navigator.AppProperties(appid)` (the
  shortcut's own dialog), and the Manage submenu holds desktop shortcut, custom
  artwork, browse local files, hide and "Remove non-Steam game from your library".
- Only "Mark as Private" (`Ge`) keys on `BIsModOrShortcut()`. Our prototype hook
  makes it enabled for an enriched shortcut, where it would send the shortcut appid
  to the private-apps service. Recorded risk; not in any plan.

### `Navigator.App` (module `874`)

- Each Steam UI window has a plain `Navigator` object
  (`SteamUIStore.WindowStore.SteamUIWindows[i].Navigator`, the same object as
  `SteamUIStore.ActiveWindowInstance.Navigator`). Components get it from React
  context or from that global (module `79112` `br()`). Keys: `Home`, `App`,
  `MyAchievements`, `FriendAchievements`, `GlobalAchievements`, `AllCollections`,
  `Collection`, `Downloads`, `AppProperties`, `Console`, `Chat`, `Settings`,
  `SteamWeb`, `SteamWebTab`, `ExternalWeb`, `Media`, … The properties are writable
  (`configurable: true`).
- `App(appid, { strCollectionId, gidPartnerEvent }, extra)` returns at once when
  `appStore.GetAppOverviewByAppID(appid)` is missing, i.e. for every unowned app.
  With `gidPartnerEvent` it pushes `/library/app/<appid>` with route state
  `event_to_show: { appid, eventid, clanSteamID, additionalParams }` (module `58437`
  `KV`).
- Live: `Navigator.App(2820820, { gidPartnerEvent })` from the shortcut page left the
  route unchanged.

### Partner event overlay (module `46776`, export `z`)

- Drawn at library level over any page: desktop (module `53822`, `ca()`) and Big
  Picture (module `3375`, `RA()`) read `event_to_show` from the current route
  state and render `z({ onClose, showAppIcon, appid, initialEventID, clanSteamID, additionalParams })`.
- Class `dr`: `GetClanEventModel(initialEventID)` (cached by GID), otherwise
  `LoadAdjacentPartnerEvents(gid, clan, appid, 0, 3, …)`. `BHasValidEvent()` is false
  when `props.appid && event.appid != props.appid`, and then it renders nothing. The
  app icon calls `navigator.App(props.appid)`.
- Live, on `/library/app/2315502503`: `event_to_show: { appid: 2315502503, eventid: "692016318956700209" }`
  drew nothing; `{ appid: 2820820, … }` drew the Jotunnslayer news with its adjacent
  events. Closed with `MainWindowBrowserManager.m_history.replace(path, {})`.

### Activity news cards (module `80478`)

- `dt` sends `PostedAnnouncement` (1002) straight to `Be`, before the store-item
  visibility check that other event types need (for `event.appid`).
- A news card click is `fe(navigator, eventModel)`, i.e.
  `navigator.App(eventModel.appid, { gidPartnerEvent: eventModel.GID })`. Comments open
  `COMMUNITY_BASE_URL + "app/<event.appid>/eventcomments/<forumTopicGID>"`.
- 2820820's entry holds one event: class `J`, `eEventType` 1002, `appid` 2820820 (a
  getter from `gameid`), `announcementGID` "692016318956700210", `unUniqueID` 1 (a
  per-store counter, not an identity). Its model: `GID` "692016318956700209", clan
  103582791474423883, type 28.

### Community Content (module `77163`, export `wb`) and Friends (module `2326`)

- `wb({ appid })` → class `oe` → loader `ae(appid)` (`m_unAppID`); it loads pages when
  on screen (unless `library_disable_community_content` is set, which shows a Load
  button). Cards open `CommunityFilePage` by `published_file_id`: no appid involved.
  Rendered by the desktop page (section `community`, `{ appid: overview.appid }`) and
  Big Picture (`lt`, when `setSections.has("community")`).
- Live: the loader under `[class*="CommunityContentContainer"]` had
  `m_unAppID` 2315502503. The section shows at all only because the prototype hook
  makes `GetSections` return the native list for an enriched shortcut.
- Friends: desktop `yj({ details })`, Big Picture `w4({ details })`, both read
  `details.unAppID`.

### Resolution signatures (one module each on this build)

| Component | Factory-source needles | Module here |
| --- | --- | --- |
| Links bar | `"#AppDetails_Links_Store"` + `"primarylinks"` | `52470` (`Qd`, `aX`) |
| Friends section | `"CommunityFriendsThatPlay"` + `"#AppDetails_SectionTitle_Friends"` | `2326` |
| Community Content | `"#AppDetails_SectionTitle_Community"` + `LoadAdditionalContent` | `77163` (`wb`, `kB`) |
| Partner event overlay | `"LibraryAppPartnerEventsPage unmounting"` + `LoadAdjacentPartnerEvents` | `46776` (`z`) |
| Navigator | `SteamUIStore.WindowStore.SteamUIWindows[i].Navigator` (global, no scan) | `874` |
| URL ids | `window.urlStore.ResolveURL(id, appid)` (global) | `87935` |
