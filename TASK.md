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
| Big Picture | 🧪 Implemented, **awaiting smoke test**. Own renderer, clone-and-hide (ADR-0024). |
| Provider contract | ⬜ Not started (Phase 8). |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Next up

### 1. Big Picture — smoke test needed

Implemented, not yet user-verified. ADR-0023 concluded this was blocked on a
Millennium engine change (its plugin loader only ever attaches to
`SharedJSContext`). That conclusion was **too strong** — it conflated "our
bundle never loads there" (true) with "that window is unreachable" (false).
The user pointed at
[k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes)
(its playtime feature already shows up in Big Picture); reading it showed
`Steam.PopupManager` gives a direct `Window`/`document` reference to the Big
Picture popup from `SharedJSContext`, no Millennium injection needed —
verified live before writing any code (a test element appended from
`SharedJSContext` rendered on screen inside the popup).

Shipped as `renderers/gamepad-app.tsx`: a small clone-and-hide summary strip
(rung 4 of the reuse ladder — the only rung reachable here, since Big
Picture's `CAppDetailsSections`/`CAppSpotlightStore` genuinely are unreachable
objects in a separate module cache; that part of ADR-0023 still holds).
`index.tsx` now handles `PopupType.Gamepad` alongside desktop.

- Full corrected finding: [ADR-0024](docs/decisions.md#adr-0024-reach-big-picture-by-cloning-dom-across-windows-not-by-feeding-its-store)
- What's still true from the original investigation: [ADR-0023](docs/decisions.md#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one)
- **Needs a real smoke test**: open a non-Steam game in Big Picture, check the
  ACTIVITY tab shows recent screenshots/clips, check nothing broke on desktop.

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
