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
| Big Picture | 🔶 Blocked on plugin code reachability; see below. |
| Provider contract | ⬜ Not started (Phase 8). |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Next up

### 1. Big Picture — verify the summary reaches it, before anything else

Big Picture already renders the identical `Ge.T` Post-Game Summary component,
gated by the identical `setSections.has("postgamesummary")` — same code path as
desktop. Nothing to build there. The blocker: Millennium never runs this
plugin's frontend inside the Big Picture window at all (`window.Millennium` is
`undefined` there — a separate bundle, not a separate renderer).

**Next step:** find a way to get `steam/sections.ts` + `steam/summary.ts`'s
setup to execute inside that window's own JS context.

- Procedure to re-enter Big Picture for testing, and the full finding:
  [steam-components.md § Inspecting Big Picture](docs/steam-components.md#inspecting-big-picture-phase-6-answered)
- Decision record: [ADR-0023](docs/decisions.md#adr-0023-big-picture-is-a-separate-bundle-not-a-separate-renderer-within-the-same-one)

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

### Later

- **Phase 7 — Refresh & caching.** `onAppLaunch`→`onQuit` invalidation exists
  for the summary; extend mtime-keyed caching to `shortcuts.vdf`.
- **Phase 8 — Provider contract.** Deferred until a real provider needs it —
  shape the contract from an actual consumer, not a guess. See
  [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it),
  [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).
- **Smoke test before v1.** Checklist lives in
  [CHANGELOG.md](non-steam-games-activity/CHANGELOG.md); run it fully once
  Big Picture and the activity feed land.

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[AGENTS.md](AGENTS.md#working-agreements). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-components.md § Reproducing this](docs/steam-components.md#reproducing-this-the-inspection-method).
