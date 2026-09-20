# Steam components — how the app detail page is really built

Everything here was **read out of the live Steam client** over CEF devtools on
2026-09-20: module factories pulled from `webpackChunksteamui`, stores poked
with real appids, DOM verified on screen. No guessing, no inference from
screenshots.

This document exists to answer one question: *what does Steam actually do, so
that we can call it instead of imitating it?*

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

## The problem this solved

The renderer used to reimplement Steam's summary and day list by hand. That is
why it kept not looking right: every spacing value, separator rule, date label
and hover behaviour had to be rediscovered, and would drift on the next Steam
build. [AGENTS.md](../AGENTS.md) already said *"reuse Steam's real components
over recreating them"*, and
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
from the one an earlier base64-over-RPC design avoided
([ADR-0017](decisions.md#adr-0017-serve-capture-images-as-base64-data-uris-thumbnails-first)):
that ADR found *this plugin's own* paths unservable through
`steamloopback.host`, but these are *Steam's own* objects with *Steam's own*
URLs, already resolved this way — no base64, confirmed shipped in
`steam/stores.ts`.

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

| `GetApp(appid)` | Result |
| --- | --- |
| `692850` (Bloodstained) | record, `BIsVisible() === true` |
| `4263274102` (AM2R) | **nothing** |

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
  `event.achievements`, needing no store data, so it *would* work if the outer
  guard let it through. It does not.

### The store record can be faked (**✅ verified**, not yet wired up)

The guard is real but it is **not** the dead end an earlier pass of this
document called it. Every piece it checks is plain data with no network path:

```js
GetStoreItem(id, type) { ... return map.get(id) }   // pure map read, no fetch
BIsVisible()           { return this.m_bVisible }   // plain boolean field
BHasStoreItem(id,t,r)  { return map.has(id) && map.get(id).BContainDataRequest(r) }
```

And the React hook only calls `QueueStoreItemRequest` when `BHasStoreItem` is
false — so a record that satisfies it means **no request is ever made**.

The class constructor takes a protobuf message, so build the record with
`Object.create` on its prototype and set the fields directly:

```js
const fake = Object.create(Object.getPrototypeOf(templateApp));
fake.m_unID = fake.m_unAppID = appid;
fake.m_bVisible = true;
fake.m_strName  = '<shortcut name>';
fake.m_eItemType = tmpl.m_eItemType;  fake.m_eAppType = tmpl.m_eAppType;
fake.m_rgStoreTags = []; fake.m_rgStoreTagIDs = [];
fake.m_DataRequested = { include_assets: true, include_platforms: true,
                         include_release: true, include_tag_count: 0 };
storeItemStore.m_mapApps.set(appid, fake);
```

Verified live for AM2R: `BIsVisible() === true`, `BHasStoreItem(…) === true`,
`BIsAppMissing() === false`, and no network request.

**Where it stopped.** With the record in place and a real `CActivityDay` holding
a valid event, the DOM still showed 0 days while the store reported
`appActivityByDay.length === 1`. That is very likely the same stale-render
problem already solved for the summary — the probe injected everything *after*
the page rendered and did not force the re-render that `setHasContent()` does.
Not retested with that wiring; it is the next step, not a new blocker.

**Weigh the risk before shipping this.** Injecting into Steam's *store* cache is
more invasive than anything else the plugin does: that cache is shared with the
store UI, so a bogus entry could surface somewhere unintended. Scope it to
non-Steam appids, only while an app page is open, remove on teardown, and check
the library and store pages are unaffected. If it leaks, prefer patching the
guard's hook for shortcut appids over poisoning the cache.

**Meanwhile `activity` stays off**, because enabling it without this renders day
headings with empty bodies. The Post-Game Summary already groups by day
(`Today` / `Yesterday` / `Oct 24, 2025`), which covers much of the intent.

Next steps: [TASK.md](../TASK.md).

Achievements for non-Steam games are out of scope regardless; if they ever
arrive (custom sets, RetroAchievements), they are a provider concern
([ADR-0012](decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)).

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
4. **`steamloopback.host` question answered:** Steam serves its *own* captures
   over that origin and hands back absolute URLs, so no image crosses the RPC
   boundary for this page. ADR-0017's jail still applies to files Steam does
   not index.
5. **`components/` deleted**, along with `assets.ts`, `steam-media.ts`,
   `timeline.lua`, `assets.lua` and the recording parsers.

**Left:**

- **The Activity feed is partially solved.** Every event renderer requires a
  *store* record the game does not have — but that record can be faked with no
  network call, and was, successfully. What remains is wiring it through the
  plugin's existing re-render path. See
  [§ The hard blocker](#the-hard-blocker-every-event-needs-a-store-record-verified-live)
  and [TASK.md](../TASK.md) for the step-by-step.
- **Big Picture is answered, not blocked on unknowns any more** — see
  [§ Inspecting Big Picture](#inspecting-big-picture-phase-6-answered) and
  [ADR-0023](decisions.md#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one).
  It reuses the same components; the open problem is getting this plugin's
  code to run inside that window at all.

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

| Target | What it is | Use it for |
| --- | --- | --- |
| `SharedJSContext` | the JS context: stores, modules, `SteamUIStore` | evaluating code, navigating, poking stores |
| `Steam` (`minwidth=1010` in its URL) | the rendered desktop window | reading the DOM, screenshots |
| `SP BPM_…` / Gamepad popup | Big Picture's window | the same, for Big Picture |
| `… Supernav`, `… Menu` | chrome fragments | nothing — they match naive title filters |

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
  ['probe_' + Date.now()],
  { probe_mod: (m, e, r) => { req = r; } },
  (r) => { r(r.s = 'probe_mod'); },
]);
window.__wreq = req;   // req.m = ~2600 factories; req(id) = evaluated exports
```

`__wreq` does not survive a Steam restart — re-run this after each one.

### 3. Find the thing

Search factory **source text** for a distinctive string, then read it:

```js
for (const id of Object.keys(req.m)) {
  const src = Function.prototype.toString.call(req.m[id]);
  if (src.includes('PostGameSummary')) console.log(id, src.length);
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

| appid | Game | Why it is useful |
| --- | --- | --- |
| `692850` | Bloodstained | biggest summary — 14 events |
| `435150` | Divinity: Original Sin 2 | screenshots **and** a clip |
| `2142790` | Fields of Mistria | small, ordinary case |
| `4263274102` | AM2R | **non-Steam** — the case under test |
| `2788628389` | ActRaiser | non-Steam with **no captures** — the empty case |

Always test a native game and a non-Steam one side by side. The whole ADR-0022
finding came from noticing the store behaved *identically* for both and only
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

## Inspecting Big Picture (Phase 6) — answered

The five questions this section used to pose are now answered. Summary: **the
UI reuses the same components, but Millennium never loads our plugin into that
window**, so nothing is missing on Steam's side — the patch simply never runs
there yet. Decision recorded in
[ADR-0023](decisions.md#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one),
which supersedes ADR-0016's "second renderer" plan.

### How to get into Big Picture for testing

```js
// in SharedJSContext
window.SteamClient.UI.SetUIMode(4);   // → Big Picture. GetUIMode() confirms: 7 = desktop.
window.SteamClient.UI.SetUIMode(7);   // ← back to desktop when done
```

A new devtools target appears: **`Steam Big Picture Mode`**. That window *is*
the whole gamepad UI — there is no separate shared-context equivalent for it.

### 1. Is it the same JS context? — **No.**

```js
// evaluated inside the "Steam Big Picture Mode" target
typeof window.webpackChunksteamui   // "undefined"
typeof window.appStore              // "undefined"
typeof window.Millennium            // "undefined"  ← the whole plugin loader
typeof window.SteamClient           // "object"     ← only the native bridge
```

Big Picture is a **separate bundle with its own module cache**, not a popup
sharing `SharedJSContext`'s modules. `onPopupCreate` (which the entry point
already uses to reach desktop popup windows) reports it as `PopupType.Gamepad`,
but that mechanism patches *into* a popup's DOM from outside — it does not run
`OnPluginLoaded()` inside that window's own JS context, and nothing here does.
**This is the actual reason the Activity tab was empty**, not a Big-Picture
section-registry difference: our `steam/sections.ts` patch lives only in
`SharedJSContext`, so Big Picture's own unpatched `GetSections()` returns the
stock 3-item shortcut list.

### 2. Does it use the same section registry? — **Yes**, verified from source.

Module `3375` (the same module desktop's page composition lives in) defines
Big Picture's tabs. The `WhatsNew` tab (labelled `#AppDetails_Tab_Activity`,
i.e. the on-screen "ACTIVITY" tab) renders:

```js
function at(e) {
  return <>
    {e.setSections.has("friends") && <FriendsSpotlight ... />}
    {e.setSections.has("postgamesummary") && <Ge.T details={e.details} />}  {/* ← same component as desktop */}
    ...
    {e.setSections.has("activity") && <ae.W appid={e.details.unAppID} />}
    ...
  </>;
}
```

`Ge.T` is the **exact same Post-Game Summary component** (`53074`'s export `T`)
the desktop page renders. `setSections` is passed down from the same
`GetSections()` call desktop uses. So restoring `postgamesummary` for a
shortcut in Big Picture's own `GetSections()` instance renders the real
summary — no new component, no new styling, nothing to clone.

### 3. Which sections does it list for a shortcut? — not yet dumped live.

Expected to be the same three (`nonsteam`, `notes`, `screenshots`) since it is
the same class and the same `BIsModOrShortcut()` filter — confirm once the
patch actually reaches this window (see below), by dumping
`GetSections(overview, details)` the same way as desktop.

### 4. Are the class modules the same? — not applicable.

No cloning needed; `Ge.T` renders unchanged, using its own already-resolved
class modules (`68854`, etc.) from module `3375`'s own closure over the same
component tree.

### 5. Does controller focus work without help? — not yet tested.

Blocked on (1): nothing to focus until the summary renders. Revisit once the
patch reaches the window.

### What Phase 6 actually needs

Not a new renderer, not new class-module work — **get the existing patch to
run inside the Big Picture window's own JS context.** Concretely:

- Find how Millennium (or `@steambrew/client`) exposes a hook into a Gamepad
  popup's *own* `window`/module scope, if one exists — separate from
  `onPopupCreate`, which only reaches the DOM from outside.
- If no such hook exists, the patch needs to run some setup code inside that
  window directly (e.g. via `popup.window.eval`-equivalent, or by having
  Millennium load the frontend bundle a second time in that context).
- Once the patch's `GetSections`/`CGamePlaySession` calls are reachable there,
  no further UI work should be needed — `Ge.T` and `ae.W` (activity) already
  read from the same `setSections` and `appid` this plugin already publishes
  to in `SharedJSContext`. Confirm `CAppSpotlightStore` (`Ri`) is also a
  *process-wide* singleton rather than one instantiated per bundle before
  assuming this — check `Ri.GetOrCreateAppData` returns the same object
  instance across both windows for the same appid.
- Big Picture's own `ACTIVITY` tab includes the daily activity feed
  (`ae.W`/`activity` section) in the *same* tab as the summary, not a
  separate one — so the store-record blocker documented above
  ([§ The store record can be faked](#the-store-record-can-be-faked-verified-not-yet-wired-up))
  applies here too, once reachable.

Record findings from step 3 onward here once the reachability question is
solved.
