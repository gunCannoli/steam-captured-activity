# Debug Plan: Friends-section `BIsApplicationOrTool` crash on mapped shortcuts

**Status:** Root cause found & reproduced live. Two fix attempts tried and
reverted (see § 4). Not yet fixed. Baseline (commit `13dad17`) is currently
deployed and stable — this bug is a pre-existing, uncommitted-fix issue, not a
regression from the last commit.

## 1. Root cause with evidence

**Symptom (user report, live desktop client):** opening a mapped non-Steam
shortcut's Game Info page (verified with Jotunnslayer: Hordes of Hel, shortcut
`2315502503` → native `2820820`) shows a red "An error occurred while
rendering this content" boundary in the right sidebar, in the area that
otherwise shows Notes / Achievements / Manual / game-stats. Screenshot from
the user shows the stock Millennium `ErrorBoundaryHook` fallback with:

```
TypeError: Cannot read properties of null (reading 'BIsApplicationOrTool')
```

**Reproduced live, twice, deterministically**, every time the shortcut's page
is opened (fresh Steam boot each time, DevTools on `127.0.0.1:8080`):

```
webhelper_js.txt (steam-cartridges-dev build 13dad17):
...
[…] Enriched native Game Info & Categories for 2315502503 ("Jotunnslayer: Hordes of Hel"): [...]
[…] Published 0 summary event(s) for 2315502503 (0 screenshot(s), 0 clip(s)).
[…] ERROR: TypeError: Cannot read properties of null (reading 'BIsApplicationOrTool')
[…] Caught an error [object Object] [object Object]
```

Confirmed live via CDP (`SharedJSContext` target):

```js
appStore.GetAppOverviewByAppID(2820820)   // -> null  (native app is unowned)
appStore.GetAppOverviewByAppID(2315502503) // -> real AppOverview (the shortcut itself)
```

**Exact call site**, found by scanning webpack module source for
`BIsApplicationOrTool` (12 modules matched; narrowed by cross-referencing
against `frontend/features/steam-store/native-sections.ts`'s own `SIGNATURES`
for the `friends` kind, which independently matches module id `2326`):

```js
// module 2326 (the Friends section — same module native-sections.ts's
// "friends" signature ['"CommunityFriendsThatPlay"', '"#AppDetails_SectionTitle_Friends"'] matches):
function ne(e){return p.tw.GetAppOverviewByAppID(e).BIsApplicationOrTool()}
// called as (unminified names differ per build, but call sites are stable):
//   ... const u = ne(r) ? (0,N.we)("#AppDetails_SectionTitle...") ...
//   function le(e){ const t = ne(e.appid) ? (0,N.we)("#AppDetails_Section... }
```

`ne(appid)` has **no null guard** on Steam's own side. `p.tw` is `appStore`.
For a normal (stock) Friends section, `r`/`e.appid` is always either the
current user's own app (always has an AppOverview) or a native appid the
Friends list already filtered to apps that exist in `appStore.m_mapApps`. Our
redirect breaks that invariant.

**Why our redirect exposes it:** `steam-cartridges` intentionally redirects
the Friends section to the *native* appid so it shows friends who own/play
the real game (ADR-0037, parity plan Part C/D). The redirect is
`redirectProps('friends', ...)` in
[frontend/features/steam-store/native-sections-core.ts:82-89](../../steam-cartridges/frontend/features/steam-store/native-sections-core.ts#L82-L89),
which swaps `props.details.unAppID` to the native appid via a `Proxy`
(`nativeDetails()`, same file, lines 52-62). That `details` object is read by
module 2326's `render()` as `this.props.details.unAppID`, which flows into
`ne(details.unAppID)` — and for an **unowned** native app (the common case: a
mapped native title the local user doesn't own, only Steam's public
partner-event/store metadata for it exists), `appStore.GetAppOverviewByAppID`
returns `null`. Confirmed live (see above): `2820820` (Jotunnslayer's real
Steam listing) is unowned by this account, so `GetAppOverviewByAppID` returns
`null` unconditionally — Steam only populates `appStore.m_mapApps` for apps
the account owns, apps in its library, or a small set of already-loaded
recently-viewed apps. Ruled out: this is **not** a `steam-cartridges` bug in
the sense of writing bad data — the shortcut's own overview (`2315502503`) is
fine; it is exactly the mapped **native** appid, once redirected into
Steam's own Friends module, that Steam's own ungarded helper cannot handle.

Two other call sites of the same pattern exist elsewhere in the bundle
(**not** yet confirmed to be reachable from our redirect, but worth checking
if this fix surfaces a second crash after the primary one is fixed):

```
module 97561: C.tw.GetAppOverviewByAppID(e).BIsApplicationOrTool()
module 56262: p.tw.GetAppOverviewByAppID(this.props.details.unAppID).BIsApplicationOrTool()
```

Module 56262 was initially suspected (also reads `props.details.unAppID`,
same shape as our Friends redirect) but **ruled out**: its source does not
contain either `friends` signature string, so it is a different, unrelated
module (a `GameStatsSection`-style component, class name `Qe` in that build,
rendering playtime/trial/claim UI) that happens to call the same Steam
`appStore` API elsewhere in the bundle on the same prop shape. It was not
reproduced as a second, independent crash in this session — flagged only in
case a future fix to module 2326's path exposes it too (same `details`
object, shared across sibling sub-sections in some renders).

## 2. Attempted fixes this session — both reverted, do not repeat verbatim

### Attempt 1: `stub.selected_per_client_data = {}` on a same-prototype AppOverview stub

Added `ensureNativeOverview(nativeAppid)` in `native-sections.ts`, called from
`setNativeAppid()`, which did:

```ts
const stub = Object.create(Object.getPrototypeOf(sample));
stub.appid = nativeAppid;
stub.app_type = 1;
stub.display_name = "";
stub.visible_in_game_list = false;
stub.per_client_data = [];
stub.selected_per_client_data = {};   // <-- throws
map.set(nativeAppid, stub);
```

**Failed immediately**: `selected_per_client_data` is a **getter-only**
accessor on the real `AppOverview` prototype (verified live:
`Object.getOwnPropertyDescriptor(proto, 'selected_per_client_data').get` is a
function, no `set`). Plain assignment throws
`TypeError: Cannot set property selected_per_client_data of #<E> which has only a getter`,
caught by our own `try/catch` (logged as a `logger.warn`, not visible to the
user, but the stub was never inserted — the whole function no-opped after the
first failed field write, since `Object.create` writes are simple property
assignments in source order and the exception aborts the function before
`map.set(...)` runs).

Other getter-only own-`class` fields discovered live on the AppOverview
prototype (do not assign any of these on a stub the same way — use
`Object.create` and only ever set genuine **own data properties**, verified
first with `Object.getOwnPropertyDescriptor(proto, key)`):

```
store_tag, store_category, ps4_controller_support, ps5_controller_support,
gamepad_preferred, gameid, BHasStoreTag, display_status, status_percentage,
installed, active_beta, is_available_on_current_platform, is_invalid_os_type,
selected_per_client_data, most_available_per_client_data,
local_per_client_data, steam_deck_compat_category, steam_os_compat_category,
steam_machine_compat_category, steam_frame_compat_category, review_score,
review_percentage
```

Confirmed-safe own-data-properties on a real `AppOverview` (own, not
prototype, not getter-only): `appid`, `shortcut_override_appid`,
`display_name`, `app_type`, and many more listed via
`Object.keys(appStore.GetAppOverviewByAppID(<any real appid>))` — see the
live dump captured this session for the full list (~60 fields) if a future
attempt needs it.

### Attempt 2: same stub, trimmed to only `appid` + `app_type`

Removed every field beyond the two genuinely-safe own-data ones:

```ts
const stub = Object.create(Object.getPrototypeOf(sample));
stub.appid = nativeAppid;
stub.app_type = 1;
map.set(nativeAppid, stub);
```

**This one *did* fix the `BIsApplicationOrTool` crash** (confirmed live: no
recurrence of that specific error after this build, across a fresh Steam
restart) — but **caused a new, worse, library-wide regression**, reported by
the user live: *"as a new thing the entire steam library shows the rendering
error"*. Log evidence, same session, right at the point Steam renders the
mapped app's page (`Loading content 2820820`):

```
[…] INFO: Loading content 2820820
[…] ERROR: TypeError: Cannot read properties of undefined (reading 'find')
[…] ERROR: Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'appid')
[…] Caught an error [object Object] [object Object]  (x3)
[…] Reporting disabled for 30s due to a non-steam error.
```

**Why:** `appStore.m_mapApps` is not a private, section-scoped cache the way
`storeItemCache`/`workshopStore`/`appActivityStore` are (those three are
already safely hand-populated with fakes in `frontend/steam/activity.ts` for
the *shortcut's own* appid, which is a pattern that works well there). It is
the **global, MobX-observed backing store for the entire library** — grid
rendering, collections, "Loading content \<appid\>" (the per-app content
loader that appeared in the log right when the crash fired), and other
code that enumerates `m_mapApps` values expecting every entry to be a fully
populated `AppOverview` (e.g. with `store_tag`/`m_setStoreCategories`-derived
getters intact, which our minimal stub lacks). Inserting even a
prototype-correct but data-sparse stub keyed by the **native** appid — a real
Steam appid, not our `>= 0x8000_0000` shortcut range — makes some other
consumer's `.find(...)` (on whatever list it expected to be fully shaped)
receive `undefined` where it expected an object with `.appid`, breaking
collection/library rendering **globally**, not just for the mapped shortcut.
This is a materially bigger blast radius than the bug it fixes, and was
reverted in full (both attempts) before this plan was written. Verified back
to clean via `git diff` (empty for `native-sections.ts`) and a live re-run of
`node scratch/check_parity.mjs` (17 PASS / 0 FAIL, matching the pre-existing
`13dad17` baseline) plus a manual log check confirming no `Loading content`
crash on the redeploy.

**Lesson for the next attempt:** whatever fix is chosen, it must **never**
write into `appStore.m_mapApps` (or any other store the stock library/grid
renderer enumerates globally). Any stub must be reachable *only* from the
Friends section's own redirected props, or from a wrapped/patched **method**
(e.g. `beforePatch`/monkeypatch on `GetAppOverviewByAppID` itself, scoped by
appid, always falling through to the real implementation for every other
appid) — never a durable entry in the shared data map.

## 3. Ideas not yet tried (starting points for the next attempt)

1. **Patch the method, not the map.** Wrap `appStore.GetAppOverviewByAppID`
   (SDK's `beforePatch`, same style already used for `Navigator.App` in this
   same file) so that a call for our specific mapped *native* appid, when the
   real call would return `null`, returns a lightweight throwaway object with
   just `BIsApplicationOrTool: () => false` (and whatever other methods the
   Friends module's other call sites need — grep the module source first).
   This never touches `m_mapApps`, so nothing that enumerates the map is
   affected — only code that calls the method for that one appid sees the
   fallback, and only when the real result is `null`.
2. **Only redirect Friends when native data will render safely**, i.e. keep
   `redirectProps('friends', ...)` gated on
   `!!appStore.GetAppOverviewByAppID(native)` already being non-null (mirrors
   the existing `isKnownApp` helper in this file, used today only for the
   `Navigator.App` redirect). This is the cheap, purely-defensive option: for
   an unowned native app it leaves the Friends section on the shortcut's own
   (empty/stock) data instead of crashing — a real parity loss (check 9 in
   `scratch/check_parity.mjs` would need to tolerate "no friends section for
   an unowned native app" rather than expect it to always redirect), but zero
   risk of the library-wide blast radius from Attempt 2. This may already be
   an acceptable trade-off given ADR-0037/ADR-0038's "only true-of-the-copy"
   framing (an unowned game genuinely has no friends data to show) — see
   [docs/decisions.md](../decisions.md) for both ADRs.
3. Check whether Steam already has an **owned-vs-unowned aware** path for
   this exact case elsewhere (e.g. a "View Store Page" fallback UI Steam uses
   for wishlist/unowned apps might reuse a safe stub Steam itself
   constructs) — grep the same module (2326) for how it already handles an
   app with `visible_in_game_list: false` before concluding a hand-rolled stub
   is required at all.

## 4. Preconditions before resuming

```
cd C:/game/millennium/steam-cartridges
git status --short        # expect: clean (or only unrelated untracked files)
git diff --stat            # expect: empty for frontend/features/steam-store/native-sections.ts
npm run check               # expect: only the npm banner, exit 0
node ../scratch/check_parity.mjs   # expect: 17 PASS / 0 FAIL (run from repo root: node scratch/check_parity.mjs)
```

Steam must already be running with DevTools on `127.0.0.1:8080` (see
`start-steam-dev.ps1` in AGENTS.md) and signed in (it auto-signs-in; wait, do
not prompt). `steam-cartridges-dev` must be the loaded build
(`PLUGIN_LIST['steam-cartridges-dev']` should exist in `SharedJSContext`).

## 5. Do-not-touch / banned actions

- Do not write to `appStore.m_mapApps` (or any store enumerated by the
  library grid/collections) under any circumstances — see § 2 Attempt 2.
- Do not assign any of the getter-only `AppOverview` prototype fields listed
  in § 2 Attempt 1 on any stub object.
- Follow the plan-writing standard's banned actions
  ([docs/plans/README.md](README.md)): no `git push --force`, no `--no-verify`,
  no changes to the user's library/collections/shortcuts, no Millennium
  `config.json` edits.
- Any fix must keep `scratch/check_parity.mjs` at 17 PASS / 0 FAIL (or update
  check 9's expectation deliberately and explain why, if idea 2 in § 3 is
  chosen instead of idea 1).

## 6. Live verification for the next fix

After deploying, from repo root:

```
node scratch/check_parity.mjs
```

Expected: `17 PASS / 0 FAIL`, same as baseline. Then, live via CDP
(`SharedJSContext` target), immediately after navigating to the mapped
shortcut's page (appid `2315502503`):

```js
appStore.GetAppOverviewByAppID(2820820)   // must not throw when read; may be null or a safe fallback, caller's choice
```

Then tail `C:/game/steam/logs/webhelper_js.txt` for lines timestamped after
the fresh restart and confirm **both**:
- No `TypeError: Cannot read properties of null (reading 'BIsApplicationOrTool')`.
- No new errors at the `Loading content <appid>` log line (this is the
  canary for the library-wide regression from Attempt 2 — if it reappears,
  revert immediately, the same way this session did).

Finally, run Routine 2/3 from AGENTS.md (`node scratch/test_nav_cycle.js`,
`node scratch/check_all_tabs.js`) to confirm no regression elsewhere in the
client, not just on this one shortcut.
