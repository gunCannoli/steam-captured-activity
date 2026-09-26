# Debug Plan: Friends-section `BIsApplicationOrTool` crash on mapped shortcuts

**Status: ✅ FIXED and live-verified 2026-09-26.** Deployed to
`steam-cartridges-dev`, `scratch/check_parity.mjs` at 17 PASS / 0 FAIL (check
9 and check 16 both pass with their original, unweakened assertions), no
crash on live navigation, no library-wide regression. **Read § 12 first if
you're picking this up** — it's the short version of everything below, plus
the one non-obvious pitfall (a second consumer of the same patched method)
that a naive read of § 3/§ 6 alone would walk straight into.

Two fix attempts were tried and reverted before this session (§ 2) — do not
repeat those verbatim. This session's fix (§ 3 Idea 1, made mechanical in § 6,
executed and corrected in § 12) patches `appStore.GetAppOverviewByAppID`
itself, scoped to mapped native appids, never touching the shared
`appStore.m_mapApps` map.

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
// "friends" signature ['"CommunityFriendsThatPlay"', '"#AppDetails_SectionTitle_Friends"']
// matches, at native-sections.ts:26):
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
the real game (ADR-0037, parity plan Part C/D — see
[docs/decisions.md § ADR-0037](../decisions.md#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity)
and [§ ADR-0038](../decisions.md#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app)).
The redirect is `redirectProps('friends', ...)` in
[frontend/features/steam-store/native-sections-core.ts:82-89](../../steam-cartridges/frontend/features/steam-store/native-sections-core.ts#L82-L89),
called from the jsx `observe` handler in
[frontend/features/steam-store/native-sections.ts:147-155](../../steam-cartridges/frontend/features/steam-store/native-sections.ts#L147-L155),
which swaps `props.details.unAppID` to the native appid via a `Proxy`
(`nativeDetails()`, same core file, lines 52-62). That `details` object is
read by module 2326's `render()` as `this.props.details.unAppID`, which flows
into `ne(details.unAppID)` — and for an **unowned** native app (the common
case: a mapped native title the local user doesn't own, only Steam's public
partner-event/store metadata for it exists), `appStore.GetAppOverviewByAppID`
returns `null`. Confirmed live (see above): `2820820` (Jotunnslayer's real
Steam listing) is unowned by this account, so `GetAppOverviewByAppID` returns
`null` unconditionally — Steam only populates `appStore.m_mapApps` for apps
the account owns, apps in its library, or a small set of already-loaded
recently-viewed apps. Ruled out: this is **not** a `steam-cartridges` bug in
the sense of writing bad data — the shortcut's own overview (`2315502503`) is
fine; it is exactly the mapped **native** appid, once redirected into
Steam's own Friends module, that Steam's own unguarded helper cannot handle.

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
object, shared across sibling sub-sections in some renders). **The fix below
(§ 6) resolves all three call sites at once**, since it patches the shared
`appStore.GetAppOverviewByAppID` method itself rather than module 2326's
caller — see § 3 for why this is a strict improvement over a module-2326-only
fix.

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
attempt needs it. **Not needed by the fix chosen in § 6**, which returns a
minimal duck-typed object instead of a same-prototype stub — see § 3 for why.

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
the *shortcut's own* appid, which is a pattern that works well there — see
also [docs/plugins.md guardrail 5](../plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization),
which is the same family of trap: never touch a store's *shared, globally
enumerated* map, only its narrow read path). `m_mapApps` is the **global,
MobX-observed backing store for the entire library** — grid rendering,
collections, "Loading content \<appid\>" (the per-app content loader that
appeared in the log right when the crash fired), and other code that
enumerates `m_mapApps` values expecting every entry to be a fully populated
`AppOverview` (e.g. with `store_tag`/`m_setStoreCategories`-derived getters
intact, which our minimal stub lacks). Inserting even a prototype-correct but
data-sparse stub keyed by the **native** appid — a real Steam appid, not our
`>= 0x8000_0000` shortcut range — makes some other consumer's `.find(...)`
(on whatever list it expected to be fully shaped) receive `undefined` where
it expected an object with `.appid`, breaking collection/library rendering
**globally**, not just for the mapped shortcut. This is a materially bigger
blast radius than the bug it fixes, and was reverted in full (both attempts)
before this plan was written. Verified back to clean via `git diff` (empty
for `native-sections.ts`) and a live re-run of `node scratch/check_parity.mjs`
(17 PASS / 0 FAIL, matching the pre-existing `13dad17` baseline) plus a
manual log check confirming no `Loading content` crash on the redeploy.

**Lesson for the next attempt:** whatever fix is chosen, it must **never**
write into `appStore.m_mapApps` (or any other store the stock library/grid
renderer enumerates globally). Any stub must be reachable *only* from the
Friends section's own redirected props, or from a wrapped/patched **method**
(e.g. `beforePatch`/monkeypatch on `GetAppOverviewByAppID` itself, scoped by
appid, always falling through to the real implementation for every other
appid) — never a durable entry in the shared data map.

## 3. Chosen approach: patch `appStore.GetAppOverviewByAppID`, not the map

This repo already has the exact precedent for this shape of fix, used twice:

1. **`wrapNavigators()`** in
   [native-sections.ts:68-86](../../steam-cartridges/frontend/features/steam-store/native-sections.ts#L68-L86)
   already does `beforePatch(nav, "App", ...)` on `Navigator.App`, scoped to
   one appid range, always falling through otherwise — same SDK function
   (`beforePatch`, from `@steambrew/client`, already imported in this file),
   same file, same module.
2. **Guardrail 5.3** ("Immunize via Prototype Hook") in
   [docs/plugins.md § 5](../plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization):
   *"Hook `StoreItemCache.prototype.BIsAppMissing` to return `false` whenever
   `appid >= 0x8000_0000`"* — the established, guardrail-documented way to make
   a Steam store's read path lenient for a specific appid range, without
   touching the store's shared, globally enumerated map. This bug is the same
   shape: `GetAppOverviewByAppID` is a **read method**; `m_mapApps` is the
   **shared map**. Attempt 2 patched the map; this plan patches the method.

Patching `appStore.GetAppOverviewByAppID` itself, scoped to native appids this
plugin has mapped (`nativeFor`'s value set — i.e. exactly the appids our own
Friends redirect can ever hand to Steam's code), and falling through to the
real implementation for every other appid (including the same native appid
once it becomes owned, or any appid nothing here has mapped) satisfies:

- **§ 2's lesson**: never touches `m_mapApps`; nothing that enumerates the map
  sees a change. Only code that *calls the method* for one of our mapped
  native appids, while the real call would return `null`, sees the fallback.
- **Guardrail 2 (O(1))**: the patch body is one `Set`/`Map` membership check
  plus one `null` check on the real result — O(1), no scan, no regex, no
  stack trace, matching `wrapNavigators`' own hot-path shape exactly.
- **Resolves all three `BIsApplicationOrTool` call sites** (module 2326, plus
  the two flagged in § 1) in one patch, since all three read through the same
  `appStore.GetAppOverviewByAppID`, unlike a module-2326-only jsx-level fix
  which would leave modules 97561/56262 exposed if they turn out to be
  reachable.
- **Idea 2 from the prior revision of this plan (gating the redirect on
  `isKnownApp`) is explicitly NOT chosen**: `isKnownApp` already exists at
  [native-sections.ts:59](../../steam-cartridges/frontend/features/steam-store/native-sections.ts#L59)
  and gating `redirectProps('friends', ...)` on it would silently drop the
  Friends redirect for every unowned native app — the common case. That
  regresses `scratch/check_parity.mjs` check 9 (`d?.lastNative?.friends === N
  && d.counts.friends > 0`, [scratch/check_parity.mjs:182](../../scratch/check_parity.mjs#L182)),
  which requires the redirect to actually fire and count for the native app.
  Weakening check 9 to tolerate "no friends section for an unowned native
  app" is banned by **guardrail 15** ("never weaken a verification check to
  match new behaviour") without the user's explicit ADR-level sign-off, and
  guardrail 14 ("a new gate must never remove behaviour that already
  worked") — the Friends redirect already works today for *owned* native
  apps and the goal is to make it work for unowned ones too, not to narrow
  it. The method-patch approach keeps the redirect firing unconditionally and
  fixes the crash instead, so no check needs to change.

## 4. What the stub must expose

Steam's `ne(appid)` call site (§ 1) does exactly one thing with the result:
`.BIsApplicationOrTool()`. Grep the same module (2326) for any other method
or field it reads off the same `GetAppOverviewByAppID(...)` result before
finalizing the shape — the plan's dry run (§ 6, step 2) must re-confirm this
against the currently-deployed build's module source, since minified module
ids and call shapes can drift release to release (the plan's own module id
2326 was "verified 2026-09-24", not guaranteed stable). At minimum the
fallback object must provide:

```ts
{ BIsApplicationOrTool: () => false }
```

`false` is correct, not just safe: a "tool" or "application" (as opposed to a
game) is a Steam-catalog classification our mapped native game is not:
[per ADR-0038](../decisions.md#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app),
we only show what's true of the copy, and a game we have no owned-app data
for is not knowably a tool — `false` matches what Steam's own code does for
every ordinary unowned game link elsewhere in the bundle. If step 2's re-grep
finds additional methods read off the same result in this build, add them to
the returned object with the same reasoning (duck-typed, minimal, no stack
traces) before writing the patch.

## 5. Preconditions before resuming

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

## 6. Ordered steps

### Step 1: Re-confirm module 2326's call shape against the live build (read-only)

Before writing any patch, re-verify § 1's `ne(appid)` shape and § 4's "only
`BIsApplicationOrTool()`" claim haven't drifted, using the cheapest method
([steam-debug.md § 7](../steam-debug.md#7-cost-efficient-debugging), rule 1 —
targeted `Runtime.evaluate`, no screenshot, no full dump). From
`SharedJSContext`:

```js
(() => {
  const req = PLUGIN_LIST['steam-cartridges-dev'] /* or however this build exposes getSteamRequire's req */;
  // If no exposed handle exists, reuse the same module-source-scan approach
  // native-sections.ts already uses (resolveTypes()); do not write a new
  // one-off scanner (steam-debug.md § 7 rule 2: reuse existing scripts/helpers).
})();
```

In practice: add a temporary one-line diagnostic call to
`nativeSectionsDiagnostics()` (already exported, § "For CDP checks" in
`native-sections.ts`) is not enough for this — it doesn't expose module
source. Instead, reuse `resolveTypes()`'s own scan pattern by evaluating
directly against `req.m` for module `2326` (or re-run the same
`Function.prototype.toString.call(req.m[id])` grep from § 1 if the module id
has moved) and confirm:

- The call is still `.GetAppOverviewByAppID(<appid>).BIsApplicationOrTool()`
  with no intervening null guard.
- No other method/field is read off the same result in the same function.

**Expected output:** a short string confirming the call shape (paste the
matched line, capped — steam-debug.md § 7's "cap before it returns" rule).
If the shape changed (different method chain, or a guard was added upstream
by a Steam client update), **stop and update § 1/§ 4 before proceeding** —
do not patch a call site that no longer matches what's live.

### Step 2: Add the scoped `GetAppOverviewByAppID` patch

File: [steam-cartridges/frontend/features/steam-store/native-sections.ts](../../steam-cartridges/frontend/features/steam-store/native-sections.ts)

**Before** (lines 54-59):

```ts
/** Navigators already patched (one per Steam UI window: desktop, Big Picture). */
const wrappedNavigators = new WeakSet<object>();
let navigatorPatches = 0;
let navRedirects = 0;

const isKnownApp = (appid: number): boolean => !!(window as any).appStore?.GetAppOverviewByAppID?.(appid);
```

**After:**

```ts
/** Navigators already patched (one per Steam UI window: desktop, Big Picture). */
const wrappedNavigators = new WeakSet<object>();
let navigatorPatches = 0;
let navRedirects = 0;

const isKnownApp = (appid: number): boolean => !!(window as any).appStore?.GetAppOverviewByAppID?.(appid);

/**
 * Duck-typed fallback for a mapped native app Steam has no AppOverview for
 * (unowned game). Only `BIsApplicationOrTool` is read off the null result by
 * Steam's own Friends module (module 2326, no null guard on Steam's side —
 * see steam-cartridges-friends-boat-crash.md § 1). `false` is correct, not
 * just safe: a mapped native app is a game, never a tool (ADR-0038).
 */
const UNOWNED_NATIVE_APP_FALLBACK = { BIsApplicationOrTool: () => false };

/** appStore.GetAppOverviewByAppID already patched (idempotent, one appStore). */
let appOverviewPatched = false;

/**
 * Patch `appStore.GetAppOverviewByAppID` once so a call for one of our own
 * mapped *native* appids never returns null — only for appids in
 * `shortcutFor` (i.e. appids our own Friends/links/community redirect can
 * ever hand to Steam's code), and only when the real result is already
 * null. Every other appid, including an unmapped one or the same native
 * appid once it becomes owned, falls through unchanged. Never writes into
 * appStore.m_mapApps (see § 2 Attempt 2) — this patches the read method,
 * not the shared map, mirroring wrapNavigators() above and
 * plugins.md guardrail 5.3.
 */
function wrapAppOverviewLookup(): void {
    if (appOverviewPatched) return;
    const store = (window as any).appStore;
    if (!store || typeof store.GetAppOverviewByAppID !== "function") return;
    try {
        beforePatch(store, "GetAppOverviewByAppID", (args: unknown[]) => {
            // beforePatch only inspects args; it cannot short-circuit the
            // call to substitute a return value (see callOriginal/replacePatch
            // usage in frontend/steam/jsx-hook.ts for that shape if the SDK's
            // beforePatch here turns out unable to observe the return value on
            // this build — verify with a live probe before assuming afterPatch
            // is unnecessary).
        });
        appOverviewPatched = true;
    } catch (err) {
        logger.warn("Could not patch appStore.GetAppOverviewByAppID; unowned native Friends sections may still crash.", err);
    }
}
```

**STOP — do not implement the above verbatim.** The `beforePatch` sketch
above is deliberately left incomplete: `beforePatch` (per its use in
`wrapNavigators`) mutates *arguments* before the real call runs; it does not
appear anywhere in this codebase being used to *replace a return value*. The
codebase's own precedent for replacing a return value is `afterPatch`
(`library-home.tsx:1,144`) or `replacePatch` (`jsx-hook.ts:1`). Step 2a below
is a required sub-step, not optional, before this step is considered done.

#### Step 2a: Confirm the correct SDK patch function for return-value substitution

Read `@steambrew/client`'s type definitions (or its usage in
`frontend/steam/jsx-hook.ts`, which already imports and uses all three:
`beforePatch`, `callOriginal`, `replacePatch`) to confirm which function can
return a **replacement value** rather than only observe/mutate arguments.
Expected shape based on `jsx-hook.ts`'s existing use of `replacePatch`
(args, then a handler that returns either `callOriginal` or a substitute) —
confirm the exact signature before writing the real patch body, then replace
the sketch in Step 2 with the confirmed pattern:

```ts
afterPatch(store, "GetAppOverviewByAppID", (args: unknown[], ret: unknown) => {
    if (ret !== null && ret !== undefined) return ret;
    const appid = args[0];
    if (typeof appid !== "number" || !shortcutFor.has(appid)) return ret;
    return UNOWNED_NATIVE_APP_FALLBACK;
});
```

(`afterPatch` is already imported project-wide via `library-home.tsx`'s
precedent and is confirmed to receive `(args, ret)` and have its return value
used as the final result — see `library-home.tsx:144-147`.) Use `afterPatch`
in the real Step 2 patch, not the incomplete `beforePatch` sketch above, once
this sub-step confirms the signature against the live `@steambrew/client`
types (`node_modules/@steambrew/client` inside `steam-cartridges/`).

### Step 3: Call `wrapAppOverviewLookup()` alongside `wrapNavigators()`

File: same file, `setNativeAppid()`.

**Before** (lines 40-50):

```ts
export function setNativeAppid(appid: number, nativeAppid: number | undefined): void {
    const previous = nativeFor.get(appid);
    if (previous !== undefined && shortcutFor.get(previous) === appid) shortcutFor.delete(previous);
    if (nativeAppid === undefined) {
        nativeFor.delete(appid);
        return;
    }
    nativeFor.set(appid, nativeAppid);
    shortcutFor.set(nativeAppid, appid);
    wrapNavigators();
}
```

**After:**

```ts
export function setNativeAppid(appid: number, nativeAppid: number | undefined): void {
    const previous = nativeFor.get(appid);
    if (previous !== undefined && shortcutFor.get(previous) === appid) shortcutFor.delete(previous);
    if (nativeAppid === undefined) {
        nativeFor.delete(appid);
        return;
    }
    nativeFor.set(appid, nativeAppid);
    shortcutFor.set(nativeAppid, appid);
    wrapNavigators();
    wrapAppOverviewLookup();
}
```

### Step 4: Command after every step

```
cd C:/game/millennium/steam-cartridges
npm run check
```

**Expected:** only the npm banner, exit 0. If `tsc` reports an error on the
`afterPatch` call signature, that means Step 2a's confirmed signature doesn't
match — stop and re-read the SDK types rather than casting around the error.

## 7. Do-not-touch / banned actions

- Do not write to `appStore.m_mapApps` (or any store enumerated by the
  library grid/collections) under any circumstances — see § 2 Attempt 2.
- Do not assign any of the getter-only `AppOverview` prototype fields listed
  in § 2 Attempt 1 on any stub object. (Not applicable to the chosen fix —
  the fallback object in § 6 is a fresh duck-typed object, not an
  `Object.create`d `AppOverview`-prototype stub — but keep the list as a
  standing warning for any future attempt that reconsiders a stub-on-map
  approach.)
- Do not gate `redirectProps('friends', ...)` on `isKnownApp` (§ 3's rejected
  Idea 2) without first getting the user's explicit sign-off to weaken check
  9 in `scratch/check_parity.mjs` and recording it as a new ADR amendment —
  see guardrails 14 and 15 in [docs/plugins.md](../plugins.md).
- Follow the plan-writing standard's banned actions
  ([docs/plans/README.md](README.md)): no `git push --force`, no `--no-verify`,
  no changes to the user's library/collections/shortcuts, no Millennium
  `config.json` edits, no deploy or Steam restart beyond what § 8 asks for,
  no SharedJSContext reload ([steam-debug.md § 6](../steam-debug.md#6-picking-up-a-code-change)).
- Any fix must keep `scratch/check_parity.mjs` at 17 PASS / 0 FAIL with check
  9's assertion **unchanged** (`d?.lastNative?.friends === N && d.counts.friends > 0`).

## 8. Guardrail checklist

The implementer re-reads each and ticks it as "not violated", with one line
of proof, before considering this plan done:

- [ ] **Guardrail 2** (O(1) strictly enforced): the `afterPatch` handler in
      § 6 Step 2a does one `typeof` check, one `Map.has()`, one `null`/`undefined`
      check — no loops, regex, or stack traces. Proof: paste the final handler
      body next to this checklist item.
- [ ] **Guardrail 5** (Persistent In-Memory Stubs & Negative Cache
      Immunization): confirm `git diff` for this change touches no
      `m_mapApps`/`m_setUnavailableApps`-shaped write. Proof: `git diff
      --stat` output.
- [ ] **Guardrail 9** (Automated CDP Verification Suite): `node
      scratch/test_nav_cycle.js` and `node scratch/check_all_tabs.js` both
      pass after deploy. Proof: paste PASS/FAIL summary line, not raw output.
- [ ] **Guardrail 14** (a new gate must never remove behaviour that already
      worked): the Friends redirect still fires unconditionally for every
      mapped native appid (owned or not) — nothing was gated off. Proof:
      `nativeSectionsDiagnostics().counts.friends > 0` after visiting the
      shortcut, same as baseline.
- [ ] **Guardrail 15** (never weaken a verification check to match new
      behaviour): `scratch/check_parity.mjs` check 9's assertion text is
      byte-identical to before this change. Proof: `git diff
      scratch/check_parity.mjs` is empty.

## 9. Commit instructions

```
cd C:/game/millennium
git add steam-cartridges/frontend/features/steam-store/native-sections.ts
git add docs/plans/steam-cartridges-friends-boat-crash.md
git add CHANGELOG.md TASK.md
git commit -m "fix(steam-cartridges): scoped appStore.GetAppOverviewByAppID patch fixes Friends-section null crash on unowned mapped native apps"
```

(No `-A` — this touches exactly these files; do not sweep up unrelated
untracked files.) Append the attribution line this session's system reminder
specifies (this repo is exempt from Routine 6's stripping rule — it is not
destined for `SteamClientHomebrew/Millennium`).

## 10. Live verification for the next fix

After deploying (`dev.ps1`, graceful restart — never SharedJSContext reload),
from repo root:

```
node scratch/check_parity.mjs
```

Expected: `17 PASS / 0 FAIL`, same as baseline, **and** check 9's line must
still read `9. Friends section reads the native app` = PASS (not skipped, not
reworded). Then, live via CDP (`SharedJSContext` target), immediately after
navigating to the mapped shortcut's page (appid `2315502503`):

```js
appStore.GetAppOverviewByAppID(2820820)   // must not throw when read; must return the fallback object (BIsApplicationOrTool() === false), not null
appStore.GetAppOverviewByAppID(2820820).BIsApplicationOrTool()  // must return false, must not throw
appStore.GetAppOverviewByAppID(83513586)  // sanity: an unrelated appid not in shortcutFor must still return whatever it returned before (null or real overview) — confirms the patch is scoped, not global
```

Then tail `C:/game/steam/logs/webhelper_js.txt` for lines timestamped after
the fresh restart and confirm **both**:
- No `TypeError: Cannot read properties of null (reading 'BIsApplicationOrTool')`.
- No new errors at the `Loading content <appid>` log line (this is the
  canary for the library-wide regression from Attempt 2 — if it reappears,
  revert immediately, the same way this session did).

Finally, run Routine 2/3 from AGENTS.md
(`node scratch/test_nav_cycle.js`, `node scratch/check_all_tabs.js`) to
confirm no regression elsewhere in the client, not just on this one
shortcut, and manually re-run Routine 1's four-tab smoke check
(AGENTS.md § Routine 1) on the same shortcut, since this patch sits on a
store read path shared by more than just the Friends section.

## 11. Dry run — executed 2026-09-26 (see § 12 for the fast summary)

Step 2a was completed for real (not a scratch copy — the fix was small and
mechanical enough, and every step was gated by `npm run check`, so this
session applied directly and treated each passing typecheck as the dry-run
gate, per the plan's own fallback: "apply to a scratch copy... only then
apply to the real file"). `@steambrew/client`'s own `.d.ts`
(`node_modules/@steambrew/client/build/utils/patcher.d.ts`) confirms:

```ts
export declare function afterPatch<...>(object, property,
  handler: (args: Parameters<Target>, ret: ReturnType<Target>) => ReturnType<Target>,
  options?: PatchOptions): Patch<...>;
```

i.e. `afterPatch`'s handler return value **replaces** the real return value —
exactly the § 6 Step 2a sketch assumed. `beforePatch` cannot do this (confirms
§ 6's "STOP" note was correct to block on this). Step 2 and Step 3's
before/after blocks were applied verbatim as written, **except** one
additional fix discovered only by live-testing (not by code reading) — see
§ 12.

## 12. Execution record — read this first

**Fixed. Deployed. 17/17 parity, zero regressions, verified against live
Steam logs going back to before this session started (to separate old noise
from anything new).** This section is the fast path: what was done, the one
mistake made and caught, and exactly how it was caught, so the next agent
doesn't have to re-derive any of it.

### What shipped

[frontend/features/steam-store/native-sections.ts](../../steam-cartridges/frontend/features/steam-store/native-sections.ts):
one new tagged fallback object, one new `wrapAppOverviewLookup()` function
(patches `appStore.GetAppOverviewByAppID` via `afterPatch`, scoped to
`shortcutFor`'s keys — i.e. only appids this plugin itself mapped), one new
call to it from `setNativeAppid()`, and a **one-line change to the
pre-existing `isKnownApp`** (see "The pitfall" below). Nothing else changed;
`appStore.m_mapApps` was never touched.

### The pitfall (not in § 6's original plan — found live, fixed live)

§ 6 Step 2's plan patched `GetAppOverviewByAppID` to return a fallback object
instead of `null`, and stopped there. That's correct for module 2326 (the
Friends crash), but this file has a **second consumer of the exact same
method** two lines above the new code: `isKnownApp` at (pre-existing)
`native-sections.ts:59`, used by `wrapNavigators()`'s `Navigator.App`
redirect (ADR/parity plan G2). `isKnownApp` treats *any truthy return* as
"Steam knows this app" and skips its own shortcut-redirect. Once
`GetAppOverviewByAppID` started returning a **truthy fallback object** for an
unowned mapped native appid, `isKnownApp` started reporting that appid as
"known" too — which is wrong for its purpose (it means "does Steam actually
have real data"). Net effect: `Navigator.App` stopped redirecting native news
clicks back to the shortcut. This was caught immediately by re-running
`scratch/check_parity.mjs` after the first deploy:

```
PASS  9. Friends section reads the native app  (friends 6)
FAIL  16. Native news click opens the event on the shortcut page  (path /library/app/2820820, event shown, overlay appid null)
```

(16 PASS / 1 FAIL — check 9, the crash's own check, was fine; check 16, an
unrelated consumer of the same patched method, broke.) **Lesson for future
patches on any Steam store method that already has more than one caller in
this file: grep every existing caller of the method you're about to patch
before assuming a "return a fallback instead of null" fix is caller-neutral.**
A method-level patch has a smaller blast radius than a map-level one (§ 3),
but it is not automatically zero blast radius to *every* caller — only to
callers outside the file/module you're patching.

**The fix:** tag the fallback object with a module-local `Symbol`
(`FALLBACK_TAG`) and make `isKnownApp` check for the tag's absence, not just
truthiness:

```ts
const isKnownApp = (appid: number): boolean => {
    const overview = (window as any).appStore?.GetAppOverviewByAppID?.(appid);
    return !!overview && (overview as any)[FALLBACK_TAG] !== true;
};
```

This keeps `isKnownApp`'s original semantic ("is there a *real* AppOverview")
intact while still letting `GetAppOverviewByAppID` return a non-null object
to module 2326. Still O(1) (guardrail 2) — one extra property read by a
`Symbol` key, same cost class as the existing `!!` check. After this second
fix: rebuild, redeploy, re-run `check_parity.mjs` → 17 PASS / 0 FAIL, checks
9 and 16 both passing with **unmodified** assertion text (guardrail 15
respected — nothing was weakened to get green).

### Live verification performed (all passed)

1. `npm run check` — clean, twice (once per fix iteration).
2. `npm run build` + `dev.ps1` (graceful restart) — twice.
3. `node scratch/check_parity.mjs` — 16/1 on the first deploy (caught the
   pitfall), **17/0 on the second** (after the `isKnownApp` fix). Check 9 and
   16 both PASS with original wording both times they passed.
4. Direct CDP read after navigating to the shortcut live:
   `appStore.GetAppOverviewByAppID(2820820)` → non-null fallback,
   `.BIsApplicationOrTool()` → `false`, no throw.
   `appStore.GetAppOverviewByAppID(2315502503)` (the shortcut itself) →
   unaffected, still the real overview.
   `appStore.GetAppOverviewByAppID(999999999)` (an unrelated, unmapped appid)
   → still `null` — confirms the patch is scoped, not global.
5. `webhelper_js.txt` log check, scoped strictly to timestamps *after* the
   final redeploy (14:54:52 onward) — **zero** `BIsApplicationOrTool`, zero
   `BIsAppBlocked`, zero `Cannot read properties of undefined (reading
   'appid')` (the Attempt-2-shaped canary). One unrelated `Cannot read
   properties of undefined (reading 'document')` error appeared, but a full
   log grep confirmed this exact message already existed on **2026-09-24**,
   two days before this session — pre-existing baseline noise, not caused by
   this fix. (Method: `Select-String -Pattern` over the whole log file, not
   just the tail, specifically to rule this in or out before reporting
   green — do this same check for any future log-based verification instead
   of assuming a leftover error is new.)
6. `node scratch/test_nav_cycle.js` — all PASS (two-way nav lifecycle,
   guardrail 6/Routine 2).
7. `node scratch/check_all_tabs.js` — all PASS (four-tab smoke, guardrail
   4/Routine 1), including the explicit `Native B Game Info: no error
   boundary` and `A -> B -> A: no error boundary` checks.
8. Direct DOM probe on the live shortcut page: `0` elements matching an
   error-boundary/fallback class selector.
9. `nativeSectionsDiagnostics()` on the live page: `friends: 8` redirects
   fired, `lastNative.friends: 2820820` (correct native appid), `navRedirects:
   1` (confirms `isKnownApp`'s redirect still fires correctly post-fix).
10. **A final clean-restart-and-rerun pass**, done specifically because check
    16 intermittently FAILed twice mid-session in ways that turned out to be
    self-inflicted, not code bugs — see the pitfall note below. After a
    graceful `start-steam-dev.ps1 -Restart` and *no* manual CDP navigation in
    between, `check_parity.mjs` (17/0), `test_nav_cycle.js` (all PASS), and
    `check_all_tabs.js` (all PASS) were each run exactly once, back to back,
    with clean results across the board. This final pass is the one to trust;
    the two mid-session check-16 FAILs before it are explained below, not
    swept under the rug. The deployed build's plugin-install log line for
    this final boot is timestamped `2026-09-26 15:04:08` (`Native sections
    redirect installed (12 component exports)`); every log line from that
    timestamp onward was checked (`Select-Object`-sliced from that exact line,
    not just `-Tail N`, to avoid missing anything) and contains **zero**
    `BIsApplicationOrTool`, **zero** `BIsAppBlocked`, **zero** `reading
    'appid'` — the only two entries are a `AppDetailsStore error - received
    app details when we aren't subscribed?` info line and one `Uncaught (in
    promise) #<Object>` with an unparseable stack, and a full-log grep shows
    that exact "Error reporter does not know how to parse generated stack"
    message recurring **109 times** across the log's whole history — clearly
    pre-existing baseline noise, unrelated to this fix.

### A second pitfall: this session's own manual CDP probing polluted later test runs

While live-verifying, this session called `MainWindowBrowserManager.m_history
.push/.replace(...)` directly and drove Steam through Big Picture Mode as a
side effect of running `test_nav_cycle.js`/`check_all_tabs.js` repeatedly.
Two symptoms followed, **neither caused by the code fix**:

1. `check_parity.mjs` check 16 (native news click → shortcut redirect)
   intermittently FAILed with a stale `path`/`overlay appid` combination that
   didn't match a fresh, unpolluted run — twice, at different points, with
   different failure shapes each time. Both times, a **graceful restart**
   (`start-steam-dev.ps1 -Restart`, or `dev.ps1`'s own restart) followed by a
   single clean run made check 16 pass again, with the exact same code
   deployed both times. This means: **check 16's own router-history-based
   probe (`MainWindowBrowserManager.m_history`, `Navigator.App` state) is
   sensitive to leftover navigation state from earlier manual CDP calls in
   the same boot.** It is not sensitive to anything this fix changed.
2. The CDP target list itself became unstable (`Steam` desktop window target
   intermittently missing from `GET /json`, replaced by `Steam Big Picture
   Mode`) after repeated `test_nav_cycle.js`/`check_all_tabs.js` runs and
   manual navigation in between. `SteamClient.UI.SetUIMode(7)` (documented in
   [steam-debug.md § 3.3](../steam-debug.md#3-the-inspection-method)) can
   recover the desktop target without a full restart, but a clean restart is
   more reliable once state is already this tangled (steam-debug.md Trap 6:
   "prefer a clean restart if state gets odd").

**Lesson for the next agent doing live verification on this or any other
fix:** run the verification suite (`check_parity.mjs`,
`test_nav_cycle.js`, `check_all_tabs.js`) **once, back to back, right after a
fresh graceful restart, with no manual CDP navigation calls interleaved
beforehand.** If you need to manually poke the store for a targeted question
first (as § 6 Step 1 and this session's own crash-confirmation probes did),
treat that as consuming the boot — restart before running the official
verification suite, don't try to reuse the same now-poked session. Chasing a
single flaky check by adding more manual probes on the same boot makes it
worse, not better (this session did that twice before recognizing the
pattern and restarting clean instead).

### Guardrail checklist (§ 8), filled in

- [x] **Guardrail 2** (O(1)): `wrapAppOverviewLookup`'s `afterPatch` handler —
      one `!==null&&!==undefined` check, one `typeof`, one `Set.has()`. The
      `isKnownApp` fix adds one `Symbol` property read. No loops/regex/stack
      traces. Proof: see the two code blocks above.
- [x] **Guardrail 5**: `git diff --stat` for this change touches only
      `native-sections.ts` — no `m_mapApps`/`m_setUnavailableApps` write
      anywhere in the diff.
- [x] **Guardrail 9**: `test_nav_cycle.js` and `check_all_tabs.js` both all-PASS
      after the final deploy (§ "Live verification performed" items 6-7).
- [x] **Guardrail 14**: Friends redirect count (`counts.friends`) is nonzero
      and fires unconditionally, same as baseline — nothing gated off.
- [x] **Guardrail 15**: `git diff scratch/check_parity.mjs` is empty; checks 9
      and 16 both pass with pre-existing assertion text, unmodified.

### What's still open (not blocking, but not this session's job)

- § 1 flagged two other `BIsApplicationOrTool` call sites (modules 97561 and
  56262) as "not yet confirmed reachable from our redirect." This fix
  resolves them too by construction (same patched method), but no live
  repro of a crash through those specific call sites was ever created or
  tested, since the primary bug never routed through them. If either ever
  surfaces a crash in the future, the same `appStore.GetAppOverviewByAppID`
  patch already covers it — no new work needed, just confirm via the same
  method-source grep from § 6 Step 1.
- The `Cannot read properties of undefined (reading 'document')` baseline
  error (pre-existing since 2026-09-24, unrelated to this fix) is still
  unexplained. Not investigated further here — out of scope for this bug,
  noted only so a future session doesn't mistake it for a new regression
  from this change.
