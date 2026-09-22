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
| Big Picture | 🟡 Smoke-tested; location bug fixed (ADR-0025). A better appid-signal is verified live (ADR-0027) but **not yet built into the plugin**. |
| Provider contract | ⬜ Not started (Phase 8). |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Next up

### 1. Big Picture — a working signal is verified, not yet wired in

The smoke test happened this session (2026-09-21, live CEF devtools) and went through
three rounds:

1. **Fixed ([ADR-0025](docs/decisions.md#adr-0025-watch-the-big-picture-popups-own-location-not-its-openers)):**
   the Gamepad branch watched `popup.window.opener.location` — proven live to be
   `SharedJSContext`'s own window, whose `location` never changes. Now watches
   `popup.window.location` instead. Verified working mechanically.
2. **Found a deeper problem ([ADR-0026](docs/decisions.md#adr-0026-big-pictures-real-navigation-does-not-touch-location-at-all)):**
   driving Big Picture through its *real* UI (gamepad-style key input, not synthetic
   navigation) showed opening a game's app-details page never changes `location` at all
   (`history.length` stays `0`) — it's an in-place view swap, not routing. No `Location`
   object, from any window, can reflect which game is showing. This also retracts
   ADR-0016 item 4's "routes are shared between desktop and gamepad" claim.
3. **Resolved with a better mechanism ([ADR-0027](docs/decisions.md#adr-0027-patch-react-jsx-runtime-to-reach-big-pictures-real-render-pipeline),
   Proposed):** the user pointed at
   [BossSloth/SteamHunter-plugin](https://github.com/BossSloth/SteamHunter-plugin), which
   reaches Big Picture with no separate renderer at all — it patches `react/jsx-runtime`'s
   `jsx`/`jsxs` globally (`beforePatch` + `findModuleByExport`, both already in our
   `@steambrew/client@5.8.5` dependency) and reads/rewrites every element's
   `(type, props)` as React creates them. Verified live against our own Steam instance,
   not taken on faith: patching from `SharedJSContext` measurably intercepts Big
   Picture's own rendering (9,500+ calls from Big-Picture-only key input), and the real
   `appid` came straight off intercepted `props` the instant a game's detail page
   rendered — no DOM presence, class resolution, or fiber walk needed. This **does not**
   overturn ADR-0023: `webpackChunksteamui` (Steam's own app code) is still confirmed
   bundle-local; `react/jsx-runtime` just turns out to be a shared vendor module instead.

**Next action:** build this into `gamepad-app.tsx` — replace the `onLocationChange`
watcher with a `jsx`-patch that filters for the app-details component carrying a
non-Steam `appid` (needs a live probe for a stable filter signature, not `'appid' in
props` alone — see ADR-0027's Decision section) and drives the existing `patch()`/
`unpatch()` unchanged. The render side (clone-and-hide, ADR-0024) is not affected by
this and needs no rework; only the signal that triggers it changes.

Earlier history (ADR-0023's wrong "not fixable from this repo" conclusion, ADR-0024's
correction reaching the popup via `Steam.PopupManager`, `gamepad-app.tsx`'s clone-and-hide
summary strip) is unaffected by this — that part of the stack is sound; the
`CAppDetailsSections`/`CAppSpotlightStore` unreachability finding still holds, and the
strip itself has never actually been exercised end-to-end yet (nothing has reached
`patch()`'s anchor-search step against a *real* rendered ACTIVITY tab), so it remains
unverified in its own right once a real appid signal exists.

### 2. Per-day Activity feed

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
