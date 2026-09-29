# Surfaces

**This doc's job:** the only code allowed to write into Steam. Part of the
steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

Every Steam mutation (patched method, store write, DOM/CSS injection) lives
under `frontend/surfaces/<id>/`, one folder per surface. Each surface
declares its `touches` (the exact Steam targets it writes), its own kill
switch (checked at call time, D6), and fail-open hooks (a throw returns
Steam's own result and counts against the surface's error budget, never
propagates). `assertDisjointTouches` (kernel) fails the architecture test if
two surfaces claim the same target. No other layer may patch a Steam
prototype, write a Steam store, or inject DOM/CSS.

## Contract

```ts
// frontend/kernel/surface.ts
export interface Surface {
    id: string;
    touches: string[];
    reads: RecordPart[];
    install(): void;
    render(appid: ShortcutId, record: GameRecord | undefined): void;
    clear(appid: ShortcutId): void;
    uninstall(): void;
}
export interface SurfaceDeps {
    isEnabled(id: string): boolean;
    reportError(id: string, err: unknown): void;
}
export interface SurfaceStatus { id: string; installed: boolean; disabled: boolean; errors: number; lastError?: string }
export interface SurfaceRunnerOptions {
    isEnabled: (id: string) => boolean;
    errorBudget?: number;
    log?: (level: "warn" | "error", message: string, err?: unknown) => void;
}
export interface SurfaceRunner {
    register(surface: Surface): void;
    installAll(): void;
    render(appid: ShortcutId, record: GameRecord | undefined, changed?: RecordPart[]): void;
    clear(appid: ShortcutId): void;
    reportError(id: string, err: unknown): void;
    status(): SurfaceStatus[];
}
export function assertDisjointTouches(surfaces: Pick<Surface, "id" | "touches">[]): void;
export function createSurfaceRunner(opts: SurfaceRunnerOptions): SurfaceRunner;
```

## Files

| File | Role |
| --- | --- |
| `frontend/kernel/surface.ts` | `Surface`, `SurfaceDeps`, `SurfaceRunner` contract (kernel, not a surface itself) |
| `frontend/surfaces/sections/index.ts` | `sections` surface (§ sections below) |

## Steam targets touched

Per surface — see each surface's `## <id>` section below for its `touches`
list and the guardrail that governs each target.

## May import / must never import

Per [migration plan § 4.1](../plans/steam-cartridges-architecture-migration-plan.md#41-layers-and-the-dependency-rule):
`surfaces/<name>/` may import `kernel/`, `steam/`, and its own folder, and
must never import another surface, `app/`, `ports/`, or `sensors/`.

## Tests

Surfaces are exercised through the migration plan § 0.5 live baseline
(render loop, Properties ×2, nav cycle, `check_all_tabs.js`), plus each
step's switch-off check (`disabledFeatures` set to the surface's id; the
view it owns falls back to Steam's stock behaviour, every other § 0.5 check
still passes). No unit tests yet — surfaces have no pure logic to extract
until the service steps (M4+) feed them through `render()`.

## How to add a surface

1. Create `frontend/surfaces/<id>/index.ts` (plus any helper files in the
   same folder) exporting `create<Id>Surface(deps: SurfaceDeps): Surface`.
2. List every Steam target it writes in `touches`, one entry per target
   (`assertDisjointTouches` fails the build if another surface already
   claims one).
3. Wrap every hook in a fail-open try/catch: on error, return Steam's own
   result and call `deps.reportError(id, err)`. Check `deps.isEnabled(id)`
   at the top of each hook, not only at install (D6).
4. `render(appid, record)` stays a no-op until the service step that
   produces the record parts it reads exists (D4) — list the parts it will
   read in `reads` regardless.
5. Callers reach the surface's API only through a D3 setter wired in
   `index.tsx`'s `init()`, never through a direct import.
6. Register and install it where its old start-up call was:
   `runner.register(create<Id>Surface(surfaceDeps))`, then
   `runner.installAll()` covers every registered surface in one call.

## History

- M3.1 (2026-09-28): created. `sections` is the first surface (moved from
  `steam/sections.ts`); `SurfaceDeps` added to `kernel/surface.ts`.

## sections

Restores the app-detail sections Steam hides from shortcuts
(`postgamesummary`, `activity`, `achievements`, `info`), and drops the grey
"information is unavailable" placeholder once something better is showing.

**touches:**

| Target | Guardrail |
| --- | --- |
| `CAppDetailsSections.GetSections` | 1 (one patch owns this prototype method) |
| `CAppDetailsSections.m_setSectionsMemo` | 1 |

**reads:** `identity`, `metadata`, `achievements` (record-driven from M4; `render()` is a no-op until then, D4).

**Kill switch:** `sections` (`disabledFeatures`). Checked inside `patchedGetSections` on every call (D6).

**Injected deps:**
- `SurfaceDeps` (`isEnabled`, `reportError`), passed to `createSectionsSurface`.
- `setGameInfoProbe(fn)` — wired to game-info's `isAppEnriched` in `index.tsx` (D3); tells `sections` whether to drop the placeholder even without captures.

**API (reached only through these setters):**
- `setHasContent(appid, hasContent)` — wired from `library-app`'s content listener via `setContentListener`.
- `setExtraSections(appid, names)` — wired from `steam-store` via `setExtraSectionsSink`.
- `refreshSections()` — wired from the achievements store via `setSectionsRefresher`.

**Hooks:** `patchedGetSections` (fail-open: Steam's `base.call` runs first; a throw in our part returns Steam's own result and counts against `sections`).

**Record-driven in:** M4 (the resolver/RPC facade is the first `record.updated` producer).
