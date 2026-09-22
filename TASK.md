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
| Big Picture | 🔴 Smoke-tested; **blocked**. Location-watcher bug fixed (ADR-0025), but real navigation doesn't touch `location` at all (ADR-0026) — strip still can't render. |
| Provider contract | ⬜ Not started (Phase 8). |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Next up

### 1. Big Picture — blocked on a real navigation signal (was: smoke test needed)

The smoke test happened this session (2026-09-21, live CEF devtools) and found two bugs,
one fixed and one still open:

1. **Fixed ([ADR-0025](docs/decisions.md#adr-0025-watch-the-big-picture-popups-own-location-not-its-openers)):**
   the Gamepad branch watched `popup.window.opener.location` — proven live to be
   `SharedJSContext`'s own window, whose `location` never changes. Now watches
   `popup.window.location` instead. Verified working mechanically (a location change
   correctly triggers `patch()`).
2. **Still open ([ADR-0026](docs/decisions.md#adr-0026-big-pictures-real-navigation-does-not-touch-location-at-all),
   Proposed, needs a direction chosen):** driving Big Picture through its *real* UI
   (gamepad-style key input, not synthetic navigation) showed that opening a game's
   app-details page — via "Recent Games" **or** the real Library grid, tested both, two
   different games — never changes `location` at all (`history.length` stays `0`
   throughout). No `Location` object, from any window, can reflect which game Big
   Picture is currently showing. This also retracts ADR-0016 item 4's "routes are shared
   between desktop and gamepad" claim — it was sourced from a UI-mode-agnostic log grep,
   never independently verified for gamepad, and today's direct testing contradicts it
   for at least the app-details view.
   - A working alternative signal is already confirmed reachable: Big Picture's DOM
     nodes carry React fiber pointers even though the module cache is separate
     (ADR-0023/24's finding); walking a fiber anchored on a stable text landmark (e.g.
     "Play") surfaced the real `appid` in `memoizedProps`, verified on two different
     non-Steam games. Building this into `gamepad-app.tsx`'s watcher is unstarted —
     ADR-0026 lays out the trade-off (more code, reads a private React internal, vs.
     leaving Big Picture shipped-but-inert) but doesn't pick a side.
   - **Next action: decide between ADR-0026's two options**, then either build the
     fiber-based watcher or explicitly downgrade Big Picture to "not supported yet" in
     release-facing docs rather than implying it works.

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
