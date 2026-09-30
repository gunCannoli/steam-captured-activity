# Kernel

**This doc's job:** the small, stable types every other layer is built on —
`ShortcutId`, the event bus, the `GameRecord` read model and the `Surface`
contract. Part of the steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

- The one appid brand (`ShortcutId`) and the only functions allowed to create
  it, so triple-key lookups (`map.get(a) || map.get(a >>> 0) || map.get(a | 0)`)
  are no longer possible.
- The gameid conversion (`toGameId` / `fromGameId`), so the `appid << 32 |
  0x02000000` rule lives in one place.
- The typed in-process event bus: `shortcut.viewed`/`left`/`launched`/`quit`,
  `record.updated`, `achievements.unlocked`, `settings.changed`. A handler
  that throws is logged and skipped; it never stops other handlers.
- The `GameRecord` read model: one record per shortcut, `Part<T>` status
  envelopes, and the `RecordStore` that emits `record.updated` only for parts
  whose value actually changed.
- The `Surface` contract and its isolation runner: fail-open installation, an
  error budget per surface, and the disjoint-`touches` check (no two surfaces
  may write the same Steam target).

Nothing else may create a `ShortcutId`, construct an `EventBus`/`RecordStore`
directly, or define a competing surface contract.

## Contract

```ts
// frontend/kernel/appid.ts
export type ShortcutId = number & { readonly __brand: "ShortcutId" };
export const NON_STEAM_APPID_MIN = 0x8000_0000;
export function toUnsigned(raw: unknown): number | undefined;
export function toShortcutId(raw: unknown): ShortcutId | undefined;
export function isShortcutAppId(raw: unknown): boolean;
export function toSignedKey(id: ShortcutId): number;
export function toGameId(id: ShortcutId): string;
export function fromGameId(gameid: string): ShortcutId | undefined;
```

```ts
// frontend/kernel/events.ts
export interface Events {
    "shortcut.viewed": { appid: ShortcutId; mode: "desktop" | "gamepad" };
    "shortcut.left": { appid: ShortcutId; mode: "desktop" | "gamepad" };
    "shortcut.launched": { appid: ShortcutId; name: string };
    "shortcut.quit": { appid: ShortcutId };
    "record.updated": { appid: ShortcutId; parts: RecordPart[] };
    "achievements.unlocked": { appid: ShortcutId; ids: string[] };
    "settings.changed": { key: string };
}
export type EventName = keyof Events;
export interface EventBus {
    on<K extends EventName>(event: K, handler: (payload: Events[K]) => void): () => void;
    emit<K extends EventName>(event: K, payload: Events[K]): void;
    count(event: EventName): number;
}
export function createEventBus(onError?: (event: EventName, err: unknown) => void): EventBus;
```

```ts
// frontend/kernel/record.ts
export type PartStatus = "ok" | "partial" | "unsupported" | "needs-setup" | "error" | "pending";
export interface Part<T> {
    status: PartStatus; data?: T; source?: string; fetchedAt?: number; checkedAt?: number; message?: string;
}
export interface Identity {
    native?: { appid: number; source: "manual" | "owned" | "search" };
    web?: { igdb?: number; ra?: number; ss?: number; romHash?: string };
}
export interface GameCategories {
    single_player?: boolean; multiplayer?: boolean; coop?: boolean; split_screen?: boolean;
    full_controller?: boolean; partial_controller?: boolean; achievements?: boolean;
    remote_play_together?: boolean;
}
export interface GameMetadata {
    appid: number; title: string; igdb_id?: number; matched_title?: string;
    short_description?: string; summary?: string; description?: string;
    developers?: string[]; publishers?: string[]; franchises?: string[];
    release_date?: number; original_release_date?: number; genres?: string[];
    categories?: GameCategories; store_category_ids?: number[]; custom_override?: boolean;
    source?: string; steam_appid?: number;
}
export interface AchievementSchemaItem {
    id: string; name: string; description: string; icon: string; global_pct: number;
}
export interface AchievementSchemaRecord {
    native_appid: number; total: number; achievements: AchievementSchemaItem[]; fetched_at?: number;
}
export interface AchievementUnlockRecord { unlocked_time: number; }
export interface ArtworkUrls { portrait?: string; hero?: string; logo?: string; wide?: string; icon?: string; }
export type IconPlan = { url: string } | { restore: string };   // ArtworkPlan.icon (icon plan)
export type AchievementSet = Record<string, unknown>;
export type CommunityMedia = Record<string, unknown>;
export type ArtworkPlan = Record<string, unknown>;
export interface GameRecord {
    appid: ShortcutId; gameid: string; title: string; exe: string;
    route?: { bucket: "steam-store" | "web-scraping" | "none"; via: string };
    identity?: Part<Identity>;
    metadata?: Part<GameMetadata>;
    achievements?: Part<AchievementSet>;
    media?: Part<CommunityMedia>;
    artwork?: Part<ArtworkPlan>;
}
export type RecordPart = "route" | "identity" | "metadata" | "achievements" | "media" | "artwork";
export interface RecordStore {
    get(appid: ShortcutId): GameRecord | undefined;
    upsert(base: Pick<GameRecord, "appid" | "gameid" | "title" | "exe">): GameRecord;
    update(appid: ShortcutId, parts: Partial<Pick<GameRecord, RecordPart>>): RecordPart[];
    all(): GameRecord[];
}
export function createRecordStore(bus: EventBus): RecordStore;
```

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
| `frontend/kernel/appid.ts` | `ShortcutId` brand, `toShortcutId`, gameid conversion |
| `frontend/kernel/events.ts` | `Events` map, `EventBus`, `createEventBus` |
| `frontend/kernel/record.ts` | `GameRecord`, `Part<T>`, `RecordStore`, `createRecordStore` |
| `frontend/kernel/surface.ts` | `Surface` contract, `SurfaceRunner`, `createSurfaceRunner`, `assertDisjointTouches` |
| `tests/kernel.test.ts` | Unit tests for all four files |

## Steam targets touched

None. The kernel never imports Steam or `@steambrew/*`; it is pure data types
and in-memory state (migration plan § 4.1 import rule).

## May import / must never import

Per [migration plan § 4.1](../plans/steam-cartridges-architecture-migration-plan.md#41-layers-and-the-dependency-rule):
`kernel/` may import nothing of ours, and must never import Steam,
`@steambrew/*`, RPC, or any other folder. Every other layer (`domain/`,
`sensors/`, `app/`, `ports/backend/`, `surfaces/<name>/`) may import `kernel/`.

## Tests

- `tests/kernel.test.ts`: `toShortcutId`/`toUnsigned` signed/unsigned and range
  edge cases, gameid round-trip (`toGameId`/`fromGameId`), `createEventBus`
  (handler isolation — one throwing handler never stops others), `createRecordStore`
  (`update` emits `record.updated` only for parts that actually changed),
  `createSurfaceRunner` (error budget trips a surface off, `assertDisjointTouches`
  throws on a shared target).
- Live: none — nothing uses the kernel yet (M2/M3 adopt it). The § 0.5 baseline
  is unaffected because no runtime code path changed.

## How to add a record part

1. Add the field to `RecordPart` and `GameRecord` in `frontend/kernel/record.ts`
   (additive only — per migration plan § 4.2, removing or changing a field needs
   an ADR).
2. The producing service writes it through `RecordStore.update`; any surface
   that should re-render when it changes adds the part name to its `reads` list.
3. No other file changes: `kernel/` has no knowledge of which service produces
   or which surface consumes a part.

## History

- M1 (2026-09-28): created. `ShortcutId`, the event bus, `GameRecord` and the
  `Surface` contract/runner. Not yet adopted by any runtime code path.
- M3.1: `SurfaceDeps` (additive) — the kill switches and error counter every
  surface is given by the composition root.
- M3.3: `GameMetadata`, `GameCategories` (D12) — moved from `rpc.ts`'s
  `ConsolidatedMetadata`/`GameCategories`; `rpc.ts` keeps both names as type
  aliases so no other importer changes.
- M3.5: `AchievementSchemaItem`, `AchievementSchemaRecord`,
  `AchievementUnlockRecord` (D12) — moved from `rpc.ts`; `rpc.ts` keeps the names.
- M3.9: `ArtworkUrls` (D12) — moved from `rpc.ts`; `rpc.ts` keeps the name.
- Icon plan (2026-09-29): `ArtworkUrls.icon`, `IconPlan`, `ArtworkPlan.icon` (the library icon, not a slot).
