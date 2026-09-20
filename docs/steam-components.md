# Steam components — how the app detail page is really built

Everything here was **read out of the live Steam client** over CEF devtools on
2026-09-20: module factories pulled from `webpackChunksteamui`, stores poked
with real appids, DOM verified on screen. No guessing, no inference from
screenshots.

This document exists to answer one question: *what does Steam actually do, so
that we can call it instead of imitating it?*

> **Read this before touching the renderer.** The plugin currently hand-builds
> markup that Steam already builds better. The finding in
> [§ The real problem](#the-real-problem) changes the approach.

---

## TL;DR — the finding that matters

Steam's Post-Game Summary and Activity sections **are not missing for non-Steam
games. They are switched off by a one-line app-type filter.**

```js
// module 59856, CAppDetailsSections.GetSections()
e.BIsModOrShortcut() && (s = n)   // n = ["nonsteam", "notes", "screenshots"]
```

For a shortcut, Steam replaces the full 18-section list with a 3-section list.
`postgamesummary` and `activity` are dropped before rendering — not because the
data is absent, but because the section registry filters on app type.

Both backing stores work **perfectly well** with a non-Steam appid. Probed live:

| Store call, appid `4263274102` (AM2R) | Result |
| --- | --- |
| `GetOrCreateAppData(appid)` | ✅ real `CAppData`, real `m_session` |
| `m_session.PushSessionEvent({...})` | ✅ accepted |
| `GetPostGameSummary(appid)` | ✅ returns the session once it has events |
| `yX.GetAppActivity(appid)` | ✅ real object, `appActivityByDay: []` |

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

## The real problem

The current renderer reimplements Steam's summary and day list by hand. That is
why it keeps not looking right: every spacing value, separator rule, date label
and hover behaviour has to be rediscovered and will drift on the next Steam
build. [AGENTS.md](../AGENTS.md) already calls this out —
*"reuse Steam's real components over recreating them"* — and
[ADR-0009](decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)
says prefer patching data over DOM. The section filter is the missing piece that
makes both achievable here.

---

## How to get at any of this

Steam exposes its webpack require by pushing a probe chunk:

```js
let req = null;
window.webpackChunksteamui.push([
  ['probe_' + Date.now()],
  { probe_mod: (m, e, r) => { req = r; } },
  (r) => { r(r.s = 'probe_mod'); },
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
s = ["info", "spotlightdlc", "spotlightreview", "postgamesummary", "friends",
     "achievements", "notes", "cards", "dlc", "screenshots", "review",
     "activity", "activityrollup", "community", "additionalcontent",
     "mastersubincluded", "timedtrialbanner", "playtestinvites"]

// app_type == E6 || P_ (application / tool)
i = ["info", "spotlightdemo", "friends", "achievements", "notes", "cards",
     "dlc", "screenshots", "review", "activity", "activityrollup",
     "playtestinvites"]

// BIsModOrShortcut()  ← non-Steam games land here
n = ["nonsteam", "notes", "screenshots"]
```

Then conditionally added: `workshop`, `offline` (offline mode), `controller`
(when controllers are connected). Big Picture (`LAUNCHER_TYPE`) filters out
`community`.

Results are memoised in `this.m_setSectionsMemo`, compared **by size only** —
so a patch that swaps members without changing the count can be ignored. Set the
memo explicitly when patching.

### Column layout

`render()` places each section into one of three columns:

| Column | Sections, in render order |
| --- | --- |
| `Spotlights` (top, spans; moves to left column when `rightPanelWidth >= SpotlightBreakToLeftColumn`) | `timedtrialbanner`, `spotlightdlc`, `playtestinvites`, `spotlightreview`, **`postgamesummary`**, `spotlightdemo` |
| `RightColumn` | `controller`, `mastersubincluded`, `friends`, **`additionalcontent`**, `achievements`, `notes`, `cards`, `dlc`, `workshop`, `screenshots`, `review` |
| `LeftColumn` | `nonsteam`, `offline`, `activityrollup`, **`activity`**, `community` |

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
from the one [Phase 2](../TASK.md) rejected — worth re-testing whether a
shortcut's own capture paths resolve through it, since that would remove the
base64-over-RPC cost entirely.

### Render algorithm

The builder walks `GetSessionEvents()` **backwards** (newest first) and emits a
flat list into a carousel. Per event it derives four things: a `Date`, a React
key, the child element, and a *type token* (`l.vu5` screenshot, `l.DJE` clip,
`l.qhh` highlights, `l.ocM` achievement, `l.UkI` trading card).

Separator rules, exactly:

- `bSameDay = isSameDay(prevDate, thisDate)` (`41180.JD`)
- **New day** → push `EventDaySeparator` (a vertical rule), and the next item
  renders its date header.
- **Same day** → push `TypeSeparator`; it gets the `SpaceOnly` modifier when the
  two adjacent types are "compatible", where compatible means *same type, or
  both are media* (screenshot / clip / highlights). So media items sit in one
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

| Event | Component | Module |
| --- | --- | --- |
| screenshot | `u.R` with `screenshot={3499.Bo(raw)}`, `sizeAxis="height"` | `21597` |
| clip | `$d` — `PostGameSummaryClip`, opens `Media.Clip({state:{id}})` | `17110` |
| highlights | `$B` | `17110` |
| achievement | `57665.hs` — `featured showStats` | `57665` |
| trading card | `22165.dI` — `cardScale={1.1}` | `22165` |

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
useEffect(() => { hasSteamConnection && setTimeout(() => yX.FetchLatestActivity(appid), 500) });
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

### Why we cannot feed the *stock* screenshot/video events

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
return (t.vecMusicAlbums.length || t.strManualURL)
  ? <Section label="#AppDetails_SectionTitle_AdditionalContent">
      {t.strManualURL && <Manual overview={r} details={t} />}
      ...
    </Section>
  : null;
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

| Target | Stable signature |
| --- | --- |
| Post-Game Summary styles | class-map probe key `GamePlaySummaryContainer` |
| Activity feed styles | class-map probe key `AppActivityDay` / `AppActivityDate` |
| `CAppSpotlightStore` | export whose object has prototype method `GetPostGameSummary` **and** `StopShowingGamePlaySpotlight` |
| `CAppActivityStore` | export with prototype `GetAppActivity` + `FetchLatestActivity` |
| Sections component | export whose `prototype` has `GetSections` + `SeekToSection` + `RegisterSection` |
| Carousel | `prototype` has `ScrollToElement` + `UpdateScrollArrows` + `BindScrollingContainer` |
| Collapsible section | `prototype` has `OnHeaderClick` + `onCloseButtonClicked` + `ScrollToFirstChild` |

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

## What this implies for the plugin

Stated as findings, not as a committed plan — the call on how far to go is
yours.

1. **Patch `GetSections`** to re-add `postgamesummary` (and `activity`, if we
   feed it) for `BIsModOrShortcut()` apps. Remember to refresh
   `m_setSectionsMemo`, which compares by size only.
2. **Feed `m_session` via `PushSessionEvent`**, mapping our backend's
   screenshots and clips onto the documented payload shapes, then set
   `m_postGameSummary`. Steam renders the rest — pager, separators, date
   headers, hover, the media viewer.
3. **The Activity feed needs a custom event class** implementing the small
   `BIsValid` / `GetParentalFeature` / `rtEventTime` contract, pushed through
   `AddEvent`. The stock screenshot/video adders are unusable (they need
   `publishedfileid`).
4. **Retest `steamloopback.host` for capture URLs.** Steam serves its own
   screenshots and clip thumbnails over that host; if a shortcut's paths resolve
   too, the base64-over-RPC pipeline becomes unnecessary.
5. Much of `components/` and `renderers/` becomes deletable — that is the point.
   A resolved Steam component cannot drift; our copy will.

Each of 1–3 needs a graceful fallback so a Steam update degrades the page
instead of crashing it.

---

## Reproducing this

The probe harness is in the session scratchpad (`cdp.py` + `p*.js`). The method:

1. `curl http://localhost:8080/json/list` → find `SharedJSContext` (JS/stores)
   and `Steam` (the rendered DOM — **separate JS contexts**, navigate from the
   former, read the DOM from the latter).
2. `Runtime.evaluate` with `awaitPromise` + `returnByValue`.
3. Capture `req` via the probe-chunk push; read factories with
   `Function.prototype.toString`; run the result through `prettier` to read it.
4. Poke stores with real appids: `692850` Bloodstained (14 events),
   `435150` Divinity 2 (screenshots + a clip), `2142790` Fields of Mistria,
   `4263274102` AM2R (non-Steam).

Always revert patches and `ClearSessionEvents()` when done — these mutate the
running client.
