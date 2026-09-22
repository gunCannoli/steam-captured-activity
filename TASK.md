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

| Area                            | State                                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post-Game Summary (desktop)     | ✅ Shipped. Real Steam component, fed via `steam/summary.ts`.                                                                                                                                                                       |
| Library grid                    | ✅ Shipped. Last-played dates populated from captures.                                                                                                                                                                              |
| Post-Game Summary (Big Picture) | ✅ Shipped. Real Steam component via React Portal & store feeding ([ADR-0029](docs/decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning)). |
| Per-day Activity feed           | ✅ Shipped. Real Steam component, fed via `steam/activity.ts` on Desktop and Big Picture ([ADR-0030](docs/decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing)).         |
| Provider contract               | ⬜ Not started (Phase 8).                                                                                                                                                                                                           |

Full module-by-module state: [non-steam-games-activity/README.md](non-steam-games-activity/README.md#status).

---

## Next up

### 1. Refresh & caching (Phase 7)

`onAppLaunch`→`onQuit` invalidation exists for the summary; extend mtime-keyed
caching to `shortcuts.vdf` and captures index.

### 2. Provider contract (Phase 8)

Deferred until a real provider needs it — shape the contract from an actual
consumer, not a guess. See
[ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it),
[ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).

### 3. Smoke test before v1

Checklist lives in [CHANGELOG.md](non-steam-games-activity/CHANGELOG.md); run
it fully once ready for release.

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[AGENTS.md](AGENTS.md#working-agreements). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-components.md § Reproducing this](docs/steam-components.md#reproducing-this-the-inspection-method).
