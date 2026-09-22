# TASK — `non-steam-games-activity`

Lean tracker: **current status + what's next.** Detailed history, verification
logs and rationale live in
[non-steam-games-activity/CHANGELOG.md](non-steam-games-activity/CHANGELOG.md),
[docs/decisions.md](docs/decisions.md) (ADRs) and
[docs/steam-components.md](docs/steam-components.md) (Steam internals). Don't
duplicate that detail here — link to it.

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

---

## Status

| Area | State |
| --- | --- |
| Post-Game Summary (desktop) | ✅ Shipped. Real Steam component, fed via `steam/summary.ts`. |
| Library grid | ✅ Shipped. |
| Per-day Activity feed | 🔶 Blocked on a fakeable Steam store record; see below. |
| Big Picture | 🟡 Renders (ADR-0025/0026/0027), but **visually broken** — wrong anchor, no native spacing (ADR-0028, not started). |
| Provider contract | ⬜ Not started (Phase 8). |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Next up

### 1. Big Picture — the appid-detection mechanism is done and verified live

The smoke test (2026-09-21, live CEF devtools) found and fixed three real bugs, in
order, each one only surfacing once the previous was fixed:

1. **Wrong location source ([ADR-0025](docs/decisions.md#adr-0025-watch-the-big-picture-popups-own-location-not-its-openers)):**
   the Gamepad branch watched `popup.window.opener.location`, proven live to be
   `SharedJSContext`'s own window, whose `location` never changes.
2. **`location` itself is the wrong signal, even fixed ([ADR-0026](docs/decisions.md#adr-0026-big-pictures-real-navigation-does-not-touch-location-at-all)):**
   real gamepad-style navigation (not synthetic) never changes *any* window's `location`
   — Big Picture's app-details view is an in-place state swap, not routing.
3. **Resolved with a better mechanism ([ADR-0027](docs/decisions.md#adr-0027-patch-react-jsx-runtime-to-reach-big-pictures-real-render-pipeline)):**
   the user pointed at
   [BossSloth/SteamHunter-plugin](https://github.com/BossSloth/SteamHunter-plugin), which
   patches `react/jsx-runtime`'s `jsx`/`jsxs` globally to intercept every element Big
   Picture's own React creates — including ones carrying the live appid as a prop.
   Implemented as `steam/gamepad-appid.ts`, filtered on `{appid, rgSections}` (verified
   live: narrower `'appid' in props` alone false-positives on a carousel, a
   friends-playing widget, and a page pager). Confirms `react/jsx-runtime` is a shared
   vendor module even though Steam's own app code (`webpackChunksteamui`) genuinely is
   not — ADR-0023's bundle-separation finding still holds, just not for every module.

Getting the *signal* right didn't make the strip render on its own — two more,
independent bugs in `gamepad-app.tsx` surfaced immediately after, both pre-existing and
never caught before because nothing had ever driven `patch()` against real rendered
content until this test:

4. **Case-sensitive text match against the wrong case** — the real DOM text is
   `"Activity"` (title case); the visible "ACTIVITY" is CSS `text-transform: uppercase`.
   Fixed to match case-insensitively.
5. **A render-timing race** — the appid signal fires *during* React's element creation,
   before React commits to the real DOM, and Big Picture's own page-transition animation
   adds more delay on top. `findAnchor()` now polls (~8s budget, retrying through
   transient query errors, not just DOM-absence) instead of looking once.

**Verified live, reproduced twice from a clean Steam restart**: browsed Big Picture's
real Library → Non-Steam → a real non-Steam game (AM2R, appid `4263274102`) via genuine
`Input.dispatchKeyEvent` input. The real summary strip rendered in the real ACTIVITY tab
— real clip/screenshot URLs, real durations. Full account, including the false leads
this session ran into (stale `window` references from repeated UI-mode toggling, and
CDP console-log replay producing misleading timestamps) in ADR-0027's "Verification"
section.

Desktop is unaffected — none of this touched `steam/summary.ts` or the Desktop branch of
`index.tsx`.

### 2. Big Picture — renders, but looks broken; fix the anchor, then go looking for real components

The user's own screenshot of the live render (next to desktop's native summary for
comparison) shows the strip is functional but visually wrong: no "Post-Game Summary"
header visible, no day grouping, tiles with no spacing/rounding, and a stray native
Steam icon (an Xbox-controller glyph) colliding with our tiles in the same row.

**Root cause, diagnosed but not yet fixed or re-verified live**
([ADR-0028](docs/decisions.md#adr-0028-big-pictures-clone-is-visually-broken-and-the-fix-is-to-go-looking-for-real-components-not-to-keep-patching-the-clone)):
`patch()`'s anchor search does `tabStrip.closest('[class]')` — but `tabStrip` (the
`Activity` label span) already has a class, so `closest()` matches itself, and
`.parentElement` of that is the **tab button** in the tab strip, not the content panel
below it. The whole multi-tile strip is being injected inside a small tab-button-sized
element, which explains every symptom in the screenshot.

That's a one-line-scale fix, but it's not really the point. `gamepad-app.tsx` is a
hand-built clone (rung 4 of AGENTS.md's reuse ladder) — the same pattern the desktop
Post-Game Summary tried once and abandoned for a resolved-real-component approach
(ADR-0022), because a clone's spacing/grouping has to be hand-matched and will drift on
the next Big Picture UI change. **ADR-0027 changes what's worth trying first**: it found
`react/jsx-runtime` is a *shared* module between `SharedJSContext` and Big Picture's
bundle, even though Steam's own app code (`webpackChunksteamui`) genuinely is not. That
was never checked for anything except React itself.

**Next action, two steps, in order:**
1. Fix the anchor bug (small, needs a fresh live DOM probe to find the real content-panel
   landmark — don't guess it from this description).
2. Before writing more clone styling: check, live, whether `@steambrew/client`'s own
   exported components (`Panel`, `Tabs`, `Focusable`, `Carousel`) also resolve to shared
   module instances reachable from Big Picture, the same way `react/jsx-runtime` did. If
   so, rebuild `gamepad-app.tsx` on rung 3 (real components) instead of rung 4 (clone) —
   closes this gap durably instead of hand-tuning CSS to chase native. See ADR-0028's
   Decision section for the full investigation plan; it is Proposed, not started.

### 3. Per-day Activity feed

Every event needs a Steam *store* record the game doesn't have — but that
record is fakeable with no network call (verified live). What's left: wire it
through the plugin's existing publish/re-render path, decide on the injection
risk, then feed real day/event objects from our captures.

- Working snippet, step-by-step, and the risk note:
  [steam-components.md § The store record can be faked](docs/steam-components.md#the-store-record-can-be-faked-verified-not-yet-wired-up)
- Also decided: drop the social chrome (post box, comments, ratings) for
  non-Steam games — keep only the dated groups. Achievements are out of scope
  for now; the achievement renderer needs no store record, so it'll work
  whenever a provider supplies them.
- Researched [sydhufen/game-data-linker](https://github.com/sydhufen/game-data-linker)
  (does something that looks similar) — it avoids this blocker entirely by
  linking a shortcut to a *real* Steam/Epic/Xbox appid and reading that real
  game's `appActivityStore`/`appAchievementProgressCache`, no faking needed.
  Different product (borrowed metadata overlay vs. our own-capture-only
  core); doesn't change our plan, but is a validated shape for a future
  *optional* linking provider. Full comparison:
  [steam-components.md § Comparison: game-data-linker's different way around this same blocker](docs/steam-components.md#comparison-game-data-linkers-different-way-around-this-same-blocker).

### Later

- **Phase 7 — Refresh & caching.** `onAppLaunch`→`onQuit` invalidation exists
  for the summary; extend mtime-keyed caching to `shortcuts.vdf`.
- **Phase 8 — Provider contract.** Deferred until a real provider needs it —
  shape the contract from an actual consumer, not a guess. See
  [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it),
  [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).
- **Smoke test before v1.** Checklist lives in
  [CHANGELOG.md](non-steam-games-activity/CHANGELOG.md); run it fully once
  Big Picture is user-verified and the activity feed lands.

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[AGENTS.md](AGENTS.md#working-agreements). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-components.md § Reproducing this](docs/steam-components.md#reproducing-this-the-inspection-method).
