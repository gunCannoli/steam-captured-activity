# Sensors

**This doc's job:** detecting page views, launches and quits, and reading
collection membership; nothing else detects these. Part of the
steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

- Desktop and Big Picture page views: `frontend/sensors/view/` is the only
  code that watches the main window's route or the gamepad app-details
  element. It emits `shortcut.viewed` / `shortcut.left`, one per real
  navigation, replacing the three detectors that used to react to the same
  trigger separately (migration plan § 1.4).
- Shortcut launches and quits: `frontend/sensors/lifecycle/` is the only code
  that wraps `onAppLaunch`/`onQuit` for shortcuts. It emits
  `shortcut.launched` / `shortcut.quit`.
- Collection membership reads: `frontend/sensors/collections/` is the only
  code that reads `window.collectionStore`. It exposes `collectionsSource`,
  passed directly into `app/routing.ts`'s `createRouting({ collections, ... })`
  in `index.tsx` (M4a moved the consumer off `features/buckets/collections.ts`,
  which no longer exists, onto this same sensor with no change to the sensor
  itself).
- Native games Steam already knows: `frontend/sensors/owned-apps/` is the only
  code that reads `appStore.allApps` for native (non-shortcut) games. It
  exposes `ownedCandidates()`, passed to `app/identity.ts`'s
  `createIdentity({ owned, ... })` and from there to the backend resolver's
  `EnsureFresh` context (M4c; moved verbatim from
  `features/steam-store/known-apps.ts` `readNativeGames`, which is deleted).
- A native app's own store data: `frontend/sensors/store-item/` is the only
  code that queues and polls Steam's `StoreItemCache` for one app. It exposes
  `loadStoreItem(steamAppid)`, passed to `app/metadata.ts`'s `storeItemFor`
  and, through a D3 setter (`setStoreItemSource`), to
  `features/steam-store/index.ts`'s artwork asset-URL lookup (M5b; moved
  verbatim from `features/steam-store/store-item.ts`, which is deleted — its
  pure mapping half moved to `domain/store-item.ts`).
- Shortcut titles and the shortcut list: `frontend/sensors/shortcuts/` is the only code that reads
  them (`shortcutTitle(appid)`, `listShortcuts()`; M10, was two copies in `index.tsx` and `steam/shortcut.ts`).
- Store installs: `frontend/sensors/installs/` is a 60 s tick (`watchInstalls`) that asks `app/store-sync` to look again, so an
  Epic or Xbox game installed while Steam runs is added without a restart. It reads nothing itself, and costs nothing while both
  auto-add toggles are off (`run()` returns before any backend call). Verified live: the backend was called every 60.0 s.
- The plugin's one event bus: `frontend/app/bus.ts` wraps
  `kernel/events.createEventBus`. Sensors emit into it; `index.tsx`
  subscribes the handlers.

## Contract

```ts
// frontend/app/bus.ts
export const bus: EventBus;
```

```ts
// frontend/sensors/view/core.ts
export type ViewMode = "desktop" | "gamepad";
export interface ViewPayload { appid: ShortcutId; mode: ViewMode; }
export const GAMEPAD_QUIET_MS = 2000;
export interface ViewTrackerOptions {
    toShortcutId: (raw: unknown) => ShortcutId | undefined;
    viewed: (p: ViewPayload) => void;
    left: (p: ViewPayload) => void;
    now: () => number;
    quietMs?: number;
}
export interface ViewTracker {
    route(raw: number | undefined): void;
    sighting(raw: number): void;
    close(mode: ViewMode): void;
    current(mode: ViewMode): ShortcutId | undefined;
}
export function createViewTracker(opts: ViewTrackerOptions): ViewTracker;
```

```ts
// frontend/sensors/view/index.ts
export function installViewSensor(bus: EventBus): void;
```

```ts
// frontend/sensors/lifecycle/index.ts
export function installLifecycleSensor(bus: EventBus): void;
```

```ts
// frontend/sensors/collections/index.ts
export function isCollectionStoreReady(store: any): boolean;
export function readUserCollections(store: any): any[] | undefined;
export const collectionsSource: { ready(): boolean; list(): any[] | undefined };
```

```ts
// frontend/sensors/owned-apps/index.ts (M4c)
export interface OwnedCandidate { appid: number; name: string }
export function ownedCandidates(): OwnedCandidate[];
```

```ts
// frontend/sensors/store-item/index.ts (M5b)
export function loadStoreItem(steamAppid: number, timeoutMs?: number): Promise<any | null>;
```

## Files

| File | Role |
| --- | --- |
| `frontend/app/bus.ts` | The plugin's one `EventBus` instance |
| `frontend/sensors/view/core.ts` | Pure view tracker: one `viewed`/`left` per real navigation, Big Picture re-render dedupe (D2, tested with node) |
| `frontend/sensors/view/index.ts` | Wires `onLocationChange` (desktop) and `watchGamepadAppid` (Big Picture) into the tracker; emits on `setTimeout(0)` (D5) |
| `frontend/sensors/lifecycle/index.ts` | Wires `onAppLaunch`/`onQuit` to `shortcut.launched`/`shortcut.quit` |
| `frontend/sensors/collections/index.ts` | `isCollectionStoreReady`, `readUserCollections`, `collectionsSource` (moved verbatim from `features/buckets/ready.ts` in M2) |
| `frontend/sensors/owned-apps/index.ts` | `ownedCandidates()` (moved verbatim from `features/steam-store/known-apps.ts` `readNativeGames` in M4c) |
| `frontend/sensors/store-item/index.ts` | `loadStoreItem()` (moved verbatim from `features/steam-store/store-item.ts` in M5b) |
| `frontend/sensors/shortcuts/index.ts` | `shortcutTitle()`, `listShortcuts()` (M10) |
| `frontend/sensors/installs/index.ts` | `watchInstalls()`: the 60 s tick of auto-add (ADR-0056) |
| `tests/sensors.test.ts` | Unit tests for the view tracker |

## Steam targets touched

None. Sensors only read (`steam/gamepad-appid.ts`, `steam/jsx-hook.ts`,
`window.collectionStore`, `onLocationChange`, `onAppLaunch`/`onQuit`); they
never write a Steam store or DOM.

## May import / must never import

Per migration plan § 4.1:
`sensors/` may import `kernel/` and `steam/` (read-only resolution), and must
never import `surfaces/`, `app/`, `ports/`, or another sensor. Sensors never import
each other: D1 makes each sensor folder (`sensors/view`, `sensors/lifecycle`,
`sensors/collections`, `sensors/owned-apps`, `sensors/store-item`) its own area, so a sensor
importing another sensor fails the architecture test. `sensors/owned-apps`
defines its own structural `OwnedCandidate` (no import of `ports/backend`,
which declares the same shape) for the same reason. A `features/` file needing
a sensor (e.g. `features/steam-store/index.ts`'s artwork asset-URL lookup)
reaches it only through a D3 setter from `index.tsx` — `features -> sensors`
is not a `LAYER_RULES` edge either. Rule-allowed edges are
listed in `LAYER_RULES` in `tests/architecture.test.ts` and never appear in
the allowlist.

## Tests

- `tests/sensors.test.ts`: one view per desktop navigation, A → B order,
  signed appids, Big Picture re-render dedupe plus re-open after
  `GAMEPAD_QUIET_MS` of silence, independent modes, and `close`.
- `tests/buckets-ready.test.ts`: `isCollectionStoreReady` / `readUserCollections`
  (import path updated to `frontend/domain/routing/pending.ts` in M4a — D11).
- `tests/architecture.test.ts`: the sensor area-isolation rule.
- Live: migration plan § 0.5 baseline, plus the M2 `Viewed shortcut …` /
  `Left shortcut …` log-line count (`steam-cartridges/tests/live/count_cycle.mjs`).

## How to add a sensor

1. Create `frontend/sensors/<name>/index.ts` with `install<Name>Sensor(bus: EventBus)`
   that emits kernel events only.
2. Put pure logic in `core.ts` (D2) and test it with node.
3. If it needs a new event, add it to `kernel/events.ts` `Events` (additive
   only).
4. Call the install function in `index.tsx` **after** every subscriber of its
   events — `installViewSensor`/`installLifecycleSensor` replay the current
   page and already-open windows immediately on install.
5. The handlers go in `index.tsx` (M2–M3) or in `app/` (M4+).

## History

- M2 (2026-09-28): created. `view`, `lifecycle` and `collections` sensors,
  plus `app/bus.ts`. Replaces the three view detectors of migration plan
  § 1.4 with one bus-emitting sensor per concern. Deltas: migration plan § 7
  M2 "Behaviour deltas".
- M4c (2026-09-29): `owned-apps` sensor added (moved verbatim from
  `features/steam-store/known-apps.ts` `readNativeGames`, which is deleted
  along with the TS matching helpers only it used). `collectionsSource`'s
  consumer moves from `features/buckets/collections.ts` (deleted in M4a) to
  `app/routing.ts`, with no change to the sensor itself.
- M5b (2026-09-29): `store-item` sensor added (moved verbatim from
  `features/steam-store/store-item.ts`, which is deleted; its pure mapping
  half — `metadataFromStoreItem`, `categoryIds`, `gameCategoryIds`,
  `assetUrlsFromItem` — moved to `domain/store-item.ts`, D12). Used by
  `app/metadata.ts` directly and by `features/steam-store/index.ts` through a
  new D3 setter (`setStoreItemSource`), since `features/` may not import
  `sensors/` directly.
- M10 (2026-09-30): `shortcuts` sensor added; the view sensor emits `window.opened`/`window.closed`; the lifecycle
  sensor's `shortcut.quit` carries the game's name (index.tsx no longer keeps a running map).
