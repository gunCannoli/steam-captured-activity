# Safety

**This doc's job:** kill switches, error budget and the boot sentinel / safe mode
that stop one crashing feature from taking down the whole plugin. Part of the
steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

- The set of independently switchable feature ids (`FeatureId`) and which ones
  survive safe mode (the capture tier: `sections`, `store-cache`, `captures`).
- The `disabledFeatures` setting: parsing it, and gating feature start-up on it.
- Counting errors per feature and tripping a feature off after its error budget
  (default 5) is exceeded in a session.
- The boot sentinel: detecting that the previous start did not shut down cleanly,
  and switching safe mode on after two bad boots in a row.

## Contract

```ts
// frontend/safety/features.ts
export const FEATURE_IDS = [
    "sections", "store-cache", "captures", "headline", "activity-cards",
    "native-links", "achievements", "achievements-observer", "game-info",
    "library-home", "background-sync", "playbar", "toasts", "artwork", "community", "library-shortcuts",
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export const SAFE_MODE_FEATURES: ReadonlySet<FeatureId>;

export interface FeatureSwitches {
    isEnabled(id: FeatureId): boolean;
    run<T>(id: FeatureId, fn: () => T): T | undefined;
    reportError(id: FeatureId, err: unknown): void;
    setSafeMode(on: boolean): void;
    reload(): void;
    errorCount(): number;
    diagnostics(): { safeMode: boolean; disabled: string[]; tripped: string[]; errors: Record<string, number> };
}

export interface FeatureSwitchOptions {
    readDisabled: () => string;
    errorBudget?: number;
    log?: (level: "warn" | "error", message: string, err?: unknown) => void;
}

export function parseDisabled(raw: string): Set<string>;
export function createFeatureSwitches(opts: FeatureSwitchOptions): FeatureSwitches;
```

```ts
// frontend/safety/boot.ts
export const BOOT_KEY = "steam-cartridges.boot";
export const UNCLEAN_LIMIT = 2;
export const HEALTHY_AFTER_MS = 60_000;

export interface BootState { pending: boolean; unclean: number; at: number }
export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function beginBoot(store: KeyValue, now?: number): { safeMode: boolean; unclean: number };
export function markHealthy(store: KeyValue, now?: number): void;
export function watchBoot(
    store: KeyValue,
    errorCount: () => number,
    win: { addEventListener(type: string, fn: () => void): void; setTimeout(fn: () => void, ms: number): unknown },
): void;
```

```ts
// frontend/index.tsx (M9a: safety/switches.ts was folded into the composition root)
const features: FeatureSwitches; // the plugin's one instance: readDisabled reads the `disabledFeatures` setting, onSettingChange reloads it
```

```ts
// frontend/index.tsx
export const safetyDiagnostics: () => ReturnType<FeatureSwitches["diagnostics"]>;
```

## Files

| File | Role |
| --- | --- |
| `frontend/safety/features.ts` | `FeatureId`s, `createFeatureSwitches` (enable/disable, error budget, safe mode) |
| `frontend/safety/boot.ts` | Boot sentinel: `beginBoot`, `markHealthy`, `watchBoot` |
| `frontend/settings/settings.ts` | `disabledFeatures` setting: type, default, validator |
| `frontend/index.tsx` | Creates the plugin's one `features` instance (M9a) and wires `features.run`/`features.isEnabled` around every feature's start-up; boot sentinel init; `safetyDiagnostics()` export |
| `tests/safety.test.ts` | Unit tests for `createFeatureSwitches` and the boot sentinel |

## Provider credentials (M5c)

How a provider key (SteamGridDB, ScreenScraper, IGDB/Twitch, RetroAchievements) is kept. The plugin's
users enter it in the settings panel; nothing else stores it.

- **Where:** `SaveServiceCredentials` → `web_config.save_credentials` writes `key=value` lines to
  `<Steam>/millennium/config/steam-cartridges/.env`. The SteamGridDB key is `steamgriddb_api`
  (`web_config.get_api_key` also still reads a legacy `sgdb_key.txt`). Saving an empty field removes the
  key. Saving invalidates the cached key, so a changed key applies immediately.
- **Never shown back:** the panel's credential fields start empty and use `bIsPassword`; `GetStatus`
  returns booleans only (`has_sgdb`, `has_twitch`, `has_screenscraper`, `has_retroachievements`); no RPC
  returns a stored secret.
- **Never leaves the machine except to its provider:** a key is sent only to its own provider's HTTPS
  endpoint, never logged (`tests/test_art_service.lua` greps `art_service.lua` and `web_sgdb.lua` for a
  `logger:` call that mentions the key), never written to `library_metadata.json`, `steam_store.json`
  or the repo (AGENTS.md).
- **At rest:** the Lua sandbox has no OS credential store (no DPAPI), so the file is plain text. The
  protection is the user's own profile folder. This is a stated limit, not a bug.

## Steam targets touched

None. Safety only gates start-up calls into other modules; it never writes to a
Steam store or hook itself.

## May import / must never import

Not yet a listed row in migration plan § 4.1 (safety is cross-cutting, used from
`index.tsx`). In practice: `frontend/safety/` imports nothing of ours except
`logger` and `settings/settings` (for the `disabledFeatures` setting); nothing
else may import `frontend/safety/` except `index.tsx`.

## Tests

- `tests/safety.test.ts`: `createFeatureSwitches` (enable/disable via
  `disabledFeatures`, error budget tripping a feature off, safe mode restricting
  to the capture tier, `diagnostics()` shape) and the boot sentinel (`beginBoot`
  bad-boot counting, `UNCLEAN_LIMIT` triggering safe mode, `markHealthy` clearing
  `pending`).
- Live (migration plan § 0.5, plus M0b-1's own checks): all five baseline PASS
  lines; `safetyDiagnostics()` reports `{"safeMode": false, "disabled": [],
  "tripped": [], "errors": {}}` after a clean start; `localStorage`'s
  `steam-cartridges.boot` shows `"pending":false` 60 s after start with no
  feature errors.

## How to add a feature id

1. Append the new id to `FEATURE_IDS` in `frontend/safety/features.ts` (never
   rename or remove an existing id — users may reference it in `disabledFeatures`).
2. Wrap the feature's start-up call in `frontend/index.tsx` with
   `features.run("<id>", () => ...)` (or `features.isEnabled("<id>")` for a
   conditional block), and call `features.reportError("<id>", err)` from any
   catch block that should count against its error budget.
3. If the feature should survive safe mode (rare — reserved for the capture
   tier), add it to `SAFE_MODE_FEATURES`.
4. List the new id in this doc's Files/Contract sections if it changes the
   public surface.

## History

- M0b-1 (2026-09-28): created. Kill switches, error budget, boot sentinel / safe
  mode wired around every feature's start-up in `index.tsx`.
- M3.1: fixed K16 (in `settings.ts`, not this file) — `disabledFeatures` was
  silently discarded on every load because `apply()` unconditionally
  `JSON.parse`d a stored string value; every kill switch was inert until then.
- M3.4: `playbar` appended to `FEATURE_IDS` (new surface, split out of
  `game-info`; on only while both `playbar` and `game-info` are enabled).
- M3.6: `toasts` appended to `FEATURE_IDS` (new surface: `NotificationStore`
  writes for achievement and launch toasts, split out of
  `features/achievements/dispatcher.ts`).
- M3.9: `artwork` appended to `FEATURE_IDS` (new surface: custom artwork
  slot and logo position writes, moved from `features/artwork/artwork.ts`
  and `features/steam-store/logo.ts`).
- F2: `community` appended to `FEATURE_IDS` (new surface: the Community Content loader, features plan F2).
- M5c: provider credentials section added (SteamGridDB key entered in the settings panel, stored in `.env`).
- M8d: Troubleshooting panel in the settings panel: a toggle per feature id, written to `disabledFeatures` by `toggleFeature`. Removed 2026-09-30 (the panel showed diagnostics to users); `disabledFeatures` still works from the config.
