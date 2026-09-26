# Plan: Mirror the native app's Steam achievements onto a mapped shortcut

**Status:** Not started. Written 2026-09-26 from existing repo knowledge only
— **no new live debugging was done for this plan, and no conclusions from
any live probe are recorded here.** The executing agent must complete § 1's
open investigation before writing any code; do not skip it.

**⚠️ Concurrent work, 2026-09-26: another agent is actively working in the
agnostic local-unlock detector module** (`docs/plans/steam-cartridges-achievements-plan.md`,
item 2 above) **at the same time this plan was written.** The `scratch/`
probe cluster below is very likely that agent's live-investigation output,
not a finished, reviewable result — do not treat it as settled fact, do not
edit it out from under them, and re-run/verify anything before relying on it.
Before starting execution on *this* plan, check `docs/plans/steam-cartridges-achievements-plan.md`'s
own status and `TASK.md`'s "Now" section for whether that parallel work has
since landed, changed scope, or left findings worth reading first — the two
plans touch adjacent but distinct surfaces (this plan: read-only mirror of
the native schema/progress; the other: an agnostic observer that will
eventually *write* new unlocks), so coordinate rather than assume isolation,
especially around any shared file (`frontend/steam/sections.ts`'s
`RESTORED_SECTIONS`, `AppDetailsStore` feed code, or the achievements
section's module signature) both pieces of work will likely need to touch.

**Head start (verify, don't assume):** `scratch/probe_ach_module.mjs`,
`probe_achievements.mjs`, `probe_achievements_details.mjs`,
`probe_achievements_shape.mjs`, `probe_dom_sections.mjs`,
`probe_sections_add.mjs`, `probe_shared_sections.mjs`,
`compare_schemas.mjs`, `test_hook_get_achievements.mjs`,
`test_live_achievements_render.mjs`, and `test_steam_request_ach.mjs`
already exist in `scratch/` (untracked, 2026-09-26) — likely written by the
concurrent agent above. **No results or findings from running them were
captured or recorded anywhere as of this plan being written.** Read each
script before writing a new one (steam-debug.md § 7 rule 2: reuse existing
scripts), but re-run and verify rather than assume they still work, reflect
the current build, or weren't superseded by that agent's later commits.

**Decision trail:** [ADR-0037](../decisions.md#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity)
(borrow native sections), [ADR-0038 § Addendum 2026-09-26](../decisions.md#addendum-2026-09-26-user-decision-achievements-on-steam-belong-to-the-steam-copy-never-narrowed-to-the-feature-badge-the-achievements-section-itself-is-in-scope)
(narrows "achievements belong to the Steam copy: never" to the feature badge
only; puts the achievements *section* in scope), [ADR-0034](../decisions.md#adr-0034-achievement-sourcing-per-bucket-locked-only-for-unowned-steam-games)
(the currently-accepted fetch-and-feed mechanism this plan may supersede for
the Steam Store bucket case — see § 2).

**Relationship to the agnostic local-achievements plan:** this is a
**separate, prerequisite** piece from
[docs/plans/steam-cartridges-achievements-plan.md](steam-cartridges-achievements-plan.md).
That plan is about an agnostic observer detecting an unlock in a non-Steam
game and eventually **triggering the real Steam achievement** (not ready,
still being designed). This plan is about **displaying the native app's
already-existing Steam achievement schema and progress** on the shortcut's
page — read-only, no network trigger, no new unlock state. Ship this first;
the agnostic system layers on top of it later.

---

## 1. Open investigation the executing agent must do first (not done yet)

This plan is written from existing docs (`steam-components.md`,
`steam-architecture.md`, `native-sections.ts`, `native-sections-core.ts`) and
deliberately stops short of picking an implementation, because the two
candidate mechanisms have real, unmeasured tradeoffs. Use
[steam-debug.md § 3 The inspection method](../steam-debug.md#3-the-inspection-method)
and § 7's cost-efficient-debugging ladder (cheapest probe first, screenshots
last).

### 1a. Decide the mechanism: redirect vs. fetch-and-feed

Two candidates, both grounded in code that already exists in this repo:

**Option A — redirect (ADR-0037's pattern, like Friends/Links/Community).**
`CAppDetailsSections`'s `"achievements"` section (module `57665` class `H` on
the build this was last read, 2026-09-24 — **re-verify the module id live,
it drifts across Steam client builds**) calls
`AppDetailsStore.GetAchievements(this.unAppID)`
([steam-components.md § Native achievement UI](../steam-components.md#native-achievement-ui--backing-store)).
If `this.unAppID` is read the same way Friends reads `props.details.unAppID`
(a prop, not an internal field set at construction time), the same
`redirectProps`/jsx-hook mechanism in
[native-sections.ts](../../steam-cartridges/frontend/features/steam-store/native-sections.ts)
and
[native-sections-core.ts](../../steam-cartridges/frontend/features/steam-store/native-sections-core.ts)
extends directly: add `"achievements"` to `RedirectKind`, a `SIGNATURES` entry,
and a case in `redirectProps`. Zero fetching; Steam's own transport and
caches answer it. **Unverified: whether `unAppID` here is actually a
prop-driven value the jsx hook can intercept, or a `this`-bound field set
some other way** (the doc note "Component `H.render()` calls
`AppDetailsStore.GetAchievements(this.unAppID)`" uses `this.unAppID`, not
`this.props.details.unAppID` like the Friends component — this may mean it
comes from a different prop shape, or from context, not necessarily the same
pattern). **First live step:** dump the component's prop shape the same way
this session's Friends-crash fix re-confirmed module 2326's call shape (see
[docs/plans/steam-cartridges-friends-boat-crash.md's method](../../CHANGELOG.md)
— that plan file was purged after the fix shipped, but the method is: scan
`req.m` for the module matching an achievements-section signature, dump
`Function.prototype.toString` around the `unAppID` read, confirm whether it
traces back to `props`).

**Option B — fetch-and-feed (ADR-0034's already-accepted mechanism).** The
backend fetches the native appid's achievement schema via the keyless store
`appdetails` `achievements` endpoint (P0 T4's chosen source, per ADR-0034),
and the frontend feeds it into `AppDetailsStore` under the **shortcut's own**
appid — the same pattern already used for Game Info's `descriptionsData`/
`associationData` (guardrail 8, plugins.md: never overwrite `appData.details`,
only feed the dedicated channels). This needs its own live trace of
`AppDetailsStore`'s write-side API (`GetAchievements` is confirmed as a
*read*; find the equivalent of `descriptionsData`/`associationData` for
achievements — likely a similarly-named dedicated field, not yet traced).
Unlock state: only from Steam's own per-user caches for an **owned** native
appid (ADR-0034); otherwise render locked-only. Works even when Steam hasn't
independently cached the native app's data (e.g. a native app the user has
never viewed this session) and works for an **unowned** native app too
(locked-only schema) — Option A's redirect only works when Steam's own
`appStore`/`AppDetailsStore` already have real data for that appid, which per
this session's Friends-crash fix is **not guaranteed** for an unowned native
app (`appStore.GetAppOverviewByAppID` returns `null` for exactly this case —
see [knowledgebase.md](../knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all)).
Confirm live whether `AppDetailsStore.GetAchievements`/`RequestAppDetails`
has the same "null/empty for unowned, no crash" behaviour already noted in
knowledgebase.md's achievement-schema-sources entry (`appDetailsStore.GetAchievements(appid)`
after `RequestAppDetails`: "for unowned, empty arrays (`nTotal` 0). Not a
schema source" — **this was recorded from a direct call in DevTools, not
from what the achievements section component itself does when rendered for
an unowned appid — confirm both**).

**Decision criteria to weigh (explicitly asked for by the user):**

1. **UI performance impact.** Option A adds one more `SIGNATURES` entry and
   one more `TYPES.set()` — the jsx hook is already O(1) per element
   (guardrail 2); this is a marginal, already-amortized cost, matching the
   existing Friends/Links/Community redirects exactly. Option B adds a
   backend fetch (network round trip, even if cached) and a frontend feed
   step per shortcut view — closer to Game Info's existing cost, which is
   already accepted for descriptions/credits. Measure both against a cold
   and a warm cache before deciding "acceptable."
2. **Coverage for an unowned native app.** Option A likely shows **nothing or
   crashes** (same shape as the Friends bug this session fixed) unless
   Steam's own achievements-section component already null-guards
   `GetAchievements`'s result the way `ne()` in module 2326 did not — **this
   must be checked live before assuming Option A is safe**, using the exact
   method from
   [knowledgebase.md's `appStore.GetAppOverviewByAppID` entry](../knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all):
   grep the achievements-section module's source for every call site and
   confirm null-safety, the same way this session confirmed module 2326's
   `ne(appid)` had none. Option B naturally supports unowned (locked-only,
   per ADR-0034) since it fetches independently of Steam's own cache state.
3. **Code reuse / consistency with ADR-0037's family.** Option A is one more
   line in an already-proven, already-guardrail-audited mechanism (same file,
   same pattern as Friends/Links/Community, all shipped and parity-gated).
   Option B is a new, mostly-unbuilt path (P5's Step 1/2 in
   `steam-cartridges-achievements-plan.md` were written for the agnostic
   local system, not this).

Record the decision as a short addendum to ADR-0038 (or a new ADR if the
choice is non-trivial) before writing implementation code, per this repo's
own ADR discipline (AGENTS.md: "Do not contradict an ADR without writing a
new one that supersedes it").

### 1b. Re-verify every module id and signature live

Every module id cited above (`57665`, `78057`) was last read 2026-09-24/25.
Module ids reshuffle between Steam client builds (steam-architecture.md § 3).
Before writing `SIGNATURES` or a fetch path, re-resolve by source-text
signature (the same method `resolveTypes()` in `native-sections.ts` already
uses), not by the cached module id.

### 1c. Confirm `appAchievementProgressCache` behaviour for the redirect case (if Option A is chosen)

`window.appAchievementProgressCache.m_achievementProgress.mapCache` is a
**`Map`**, exactly like `appStore.m_mapApps` — confirmed present for an owned
appid, **absent for unowned** (knowledgebase.md's achievement-schema-sources
entry, live-verified 2026-09-24). If Big Picture's play-bar progress is also
redirected to the native appid, the same class of trap from this session's
Friends-crash fix applies: **never write a stub into `mapCache`** (it may or
may not be globally enumerated elsewhere the way `appStore.m_mapApps` is —
confirm live before assuming it's safe to write into, and if a read-only
redirect is enough, prefer that over any write). If a consumer of
`mapCache.get(appid)` has no null guard the way Friends' `ne()` didn't,
apply the same fix pattern (a scoped method patch on the getter, tagged
fallback, checked against every other caller of the same method) —
see [knowledgebase.md's two `appStore` entries](../knowledgebase.md#appstoregetappoverviewbyappid-has-multiple-callers--patch-the-method-carefully-or-not-at-all)
for the full playbook and the pitfall (a second caller silently regressing)
to watch for.

---

## 2. What "done" looks like (exit criteria, mechanism-agnostic)

Whichever mechanism § 1a lands on:

1. Opening a mapped shortcut's Game Info page shows the **native app's**
   achievement list (titles, descriptions, icons, rarity) in the desktop
   right-column achievements section — not the shortcut's own (nonexistent)
   schema, not a blank/missing section.
2. If the native app is **owned**, the user's real unlock state (checkmarks,
   percentage bar, `AllAchieved`) shows — sourced from Steam's own per-user
   caches, never inferred (ADR-0034 §Decision, unchanged).
3. If the native app is **unowned**, the list renders **locked-only**,
   consistent with ADR-0034's existing policy for a direct Steam Store bucket
   game — no crash, no empty section where data should be, and — this is the
   part this session's Friends-crash fix makes newly important to check — no
   `TypeError` from an unguarded Steam helper reading a `null`/absent cache
   entry.
4. Post-Game Summary hero strip and Big Picture play-bar progress reflect the
   same native data (steam-components.md § Native achievement UI, points 2
   and 3) — confirm whether these need their own redirect/feed or ride along
   with whatever § 1a's mechanism does for the main section.
5. The Achievements **feature badge** (category id 22) stays off the
   shortcut's badge list — ADR-0038's original badge-never rule is
   unchanged; only the section itself is newly in scope (see the ADR-0038
   addendum this plan is written against).
6. `scratch/check_parity.mjs` gets a new check for this (append, do not
   renumber the existing 17 — guardrail 15: never weaken or silently
   renumber a check in a way that could hide a regression). Follow the same
   check pattern as check 9 (Friends) or check 7 (Links):
   `nativeSectionsDiagnostics()`-style counter if Option A, or a direct
   `AppDetailsStore.GetAchievements(shortcutAppid)` read if Option B.
7. Routine 1 (four-tab smoke) and Routine 2 (two-way nav lifecycle) both
   pass on the mapped shortcut used for the rest of the parity suite
   (Jotunnslayer, 2315502503 → 2820820) — AGENTS.md.

---

## 3. Guardrails this touches (re-read before writing code)

- **Guardrail 2** (O(1) strictly enforced) — if Option A, the new
  `SIGNATURES`/`redirectProps` case must stay O(1) per element, matching the
  existing three kinds exactly.
- **Guardrail 5** (Persistent In-Memory Stubs) / the `appStore.m_mapApps`
  lesson from this session — if any stub or cache-write touches
  `appAchievementProgressCache.m_achievementProgress.mapCache` or any other
  globally-enumerated map, read
  [knowledgebase.md's `appStore.m_mapApps` entry](../knowledgebase.md#appstorem_mapapps-is-the-global-enumerated-backing-store-for-the-entire-library--never-write-into-it)
  first. Prefer a read-only redirect over any write.
- **Guardrail 8** (Dedicated Metadata Association) — if Option B, never
  overwrite `appData.details`; feed achievements through whatever dedicated
  channel `AppDetailsStore` actually exposes (to be traced live — not yet
  confirmed to exist the way `descriptionsData`/`associationData` do for
  Game Info).
- **Guardrail 9** (Automated CDP Verification Suite) — run
  `scratch/test_nav_cycle.js` and `scratch/check_all_tabs.js` before
  declaring this done, not just the new parity check.
- **Guardrail 14 / 15** — the new parity check is additive; no existing check
  changes.
- **The `appStore.GetAppOverviewByAppID` multi-caller lesson** (this
  session, knowledgebase.md) — if Option A's redirect ever needs
  `appStore.GetAppOverviewByAppID` (e.g. to decide owned-vs-unowned before
  choosing a render path), grep every other caller of that method in the
  file before changing what a `null`/fallback result means to any of them.

---

## 4. Suggested ordered steps (fill in once § 1 is resolved)

Left deliberately unwritten — the plan-writing standard
([docs/plans/README.md](README.md)) requires exact file:line before/after
blocks and a dry run, which cannot be written honestly before § 1's mechanism
choice is made and its module signatures are re-verified live. The executing
agent should:

1. Complete § 1a/1b/1c live.
2. Record the mechanism decision as an ADR-0038 addendum (or new ADR).
3. Rewrite this plan's § 4 with the full mechanical steps, following
   [docs/plans/README.md](README.md)'s standard exactly (root cause/context →
   preconditions → ordered before/after blocks → a command after every step →
   do-not-touch list → guardrail checklist → commit instructions → live
   verification → dry run), the same shape as the (now-purged, shipped)
   Friends-crash fix plan.
4. Do not skip the dry run. Apply the before/after blocks to a scratch copy
   first, confirm `npm run check` and the new parity check pass, before
   touching the real file.

---

## 5. Do-not-touch / banned actions (standing, mechanism-agnostic)

- Do not write into `appStore.m_mapApps` or
  `appAchievementProgressCache.m_achievementProgress.mapCache` as a shared,
  globally-enumerated map — see § 1c and § 3.
- Do not add the Achievements feature badge (category id 22) back to the
  shortcut's badge allow-list — ADR-0038's badge-never rule is explicitly
  unchanged by this plan.
- Do not implement the agnostic local-unlock-detector-that-triggers-native-Steam
  system as part of this plan — that is
  [docs/plans/steam-cartridges-achievements-plan.md](steam-cartridges-achievements-plan.md),
  not ready, and explicitly out of scope here per the user's 2026-09-26
  decision ("first we need to mirror the existing achievements from the
  native game").
- Follow the plan-writing standard's own banned actions
  ([docs/plans/README.md](README.md)): no `git push --force`, no
  `--no-verify`, no changes to the user's library/collections/shortcuts, no
  Millennium `config.json` edits, no SharedJSContext reload
  ([steam-debug.md § 6](../steam-debug.md#6-picking-up-a-code-change)).
