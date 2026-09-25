# steam-cartridges P4: hardening

**Status:** plan, not started · 2026-09-25 · written to the
[plan writing standard](README.md#plan-writing-standard-for-the-weak-implementer).
Parent: [steam-cartridges.md § 8 Phase 4](../steam-cartridges.md#phase-4--hardening).
Network rules: [ADR-0036](../decisions.md#adr-0036-default-bucket-is-steam-store-with-a-web-fallback-per-collection-title-rules)
(it names this plan for the rate limit, timeout, circuit breaker and negative cache).

## 0. Order: P4 goes BEFORE the parity work

Run this plan first, then [steam-cartridges-parity.md](steam-cartridges-parity.md)
Part A (the ADR-0036 policy change), then its Parts B–E. Reasons:

- ADR-0036 makes every viewed shortcut look itself up on the Steam Store. Before
  that ships, the lookup path must survive being offline, rate limits and
  navigation races (H2, H3, H6), and the per-slot art record must refuse
  orphans (H5). Otherwise the default bucket multiplies today's failure modes by
  ~220 shortcuts.
- The parity plan's **before** blocks were cut from the tree *after* this plan.
  Applied in another order, its edits do not match and it stops at step 1.

All code below was dry-run on a copy of `HEAD` (`907f59c` for `steam-cartridges/`):
`tsc` clean, `test:ts` 28/28, Lua 71 + 86 PASS (§ 3, Step 11 and Step 16).

## 1. Findings (root causes with evidence)

Live captures were read-only, over CDP `127.0.0.1:8080`, desktop UI, 2026-09-24/25.

| Id | Finding | Evidence | Fix (step) |
| --- | --- | --- | --- |
| **H1** | `enrichGameDetails` throws `TypeError: (meta.franchises \|\| []).join is not a function` in its log line (`frontend/features/game-info/metadata.ts:231`). Millennium's Lua `json.encode` writes an empty table as `{}`, so list fields arrive as objects. The throw is caught, so the data is applied but the function returns `false` (callers then skip `storeEnrichedAppIds` / the preload count). | `webhelper_js.txt`: 1307 hits, latest `2026-09-25 01:51:34 … Could not enrich native Game Info for 4263274102`. `library_metadata.json`: 14 of 28 entries have `"franchises": {}`. Line 121 already uses `toArray`; the log line does not. | New pure `normalizeMetadata` at every entry point (local DB, IGDB reply, `appdetails` reply); the log line uses the normalised locals. Steps 1–4, 9. |
| **H2** | The store throttle measures `os.clock()` (CPU time). The gate busy-waits, so after any idle period the next request spins up to a full second of CPU, and the "1 request/s" limit is not on the wall clock ADR-0036 states. | `backend/steam_store_throttle.lua:11-15` (`M.now = os.clock`, busy-wait on `os.clock`). | Wall clock from Millennium's `datetime.now()` (ms), `os.time()` fallback. Step 12. |
| **H3** | Offline, every view costs a full HTTP timeout (15 s search, 20 s image download) on the single backend thread, and a failed search is never retried in the session (`processed` holds the appid). | `steam_store_throttle.lua:34` `timeout = 15`; `features/steam-store/index.ts:100` `processed.add` before the lookup, never removed on error. | Transport failure opens a 300 s circuit breaker (`"offline"`, no request); timeout 8 s (ADR-0036); the image-download fallback fails fast too; the frontend retries a failed lookup on a view after 5 min. Steps 9, 12, 14. |
| **H4** | `loadStoreItem` queues a `StoreItemCache` request and polls 8 s even when Steam has already marked the app missing (delisted / unknown). | `features/steam-store/store-item.ts:105-128`; `StoreItemCache.BIsAppMissing` exists (live: `typeof … === "function"`). Our own immunity hook only covers shortcut appids (`>= 0x8000_0000`), so native answers are Steam's. | Return `null` at once when `BIsAppMissing(steamAppid)`; the backend `appdetails` fallback runs. Step 8. |
| **H5** | **Orphan art record.** `applied_artwork` survives with no mapping: a view that finished after Clear re-recorded it. Also, the plugin writes all four slots once per mapping and never retries a slot that failed (404, size limit), and it cannot tell a slot the user removed from one it never wrote. | Live `steamStoreState()`: `applied_artwork["2315502503"] = { steam_appid: 2820820, slots: [0,1,2,3] }`, `mappings` empty, `rejected` none. Grid files `2315502503.jpg`, `_hero.jpg`, `_logo.png`, `p.jpg` present. `store.record_artwork` (`steam_store_store.lua:165`) writes unconditionally. | Backend refuses a record unless the shortcut is still mapped to that app, records `failed` slots, prunes recorded slots whose grid file is gone (the user removed them: never rewritten). Frontend `artworkPlan`: clear-and-rewrite on a new match, retry only failed slots once per session, clear what it just wrote if the record is refused. Steps 5–7, 9, 13–15. |
| **H6** | **Navigation race.** Desktop and Big Picture both fire `onSourceView`; a second view that arrives while the first is in flight is dropped (`inflight.has(appid) → return`). If the first run was for a stale bucket/state, the page keeps it until the next navigation. | `features/source-view.ts:22`. | Remember one re-run per appid and replay it when the in-flight run ends. Step 10. |

Already correct, kept (no step): 7-day negative cache for searches with no
result (`steam_store_store.lua:171-179`, `NEGATIVE_TTL = 7 * 24 * 3600`); one
lookup per game per session (`processed`); `appdetails` 7-day in-memory cache;
only an exact unique title match is applied.

**Ruled out:** the TypeError is not a data-loss bug in the store path
(`metadataFromStoreItem` always returns `franchises: []`); it hits local/IGDB
entries. The throttle is not bypassed: every store request goes through
`throttle.acquire()` (search, appdetails, image download).

## 2. Preconditions (run first; stop if any differs)

All commands use Git Bash.

```bash
cd /c/game/millennium && git status --porcelain -- steam-cartridges
```
Expected: no output. (Other folders may show user changes. Leave them alone.)

```bash
cd /c/game/millennium && git log -1 --format=%h -- steam-cartridges
```
Expected: `907f59c`.

```bash
cd /c/game/millennium/steam-cartridges && npm run check
```
Expected: the banner lines `> steam-cartridges@0.1.0 check` and `> tsc --noEmit`, then nothing, exit 0.

```bash
cd /c/game/millennium/steam-cartridges && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected exactly:
```
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

Lua has no system interpreter here; run it through `lupa` (Python). This is
the **Lua command** used below:

```bash
cd /c/game/millennium/steam-cartridges && for f in test_backend test_steam_store; do NSGA_STEAM_ROOT='C:\game\steam' python -c "import sys,lupa; L=lupa.LuaRuntime(unpack_returned_tuples=True); L.globals().dofile(sys.argv[1])" tests/$f.lua > /tmp/sc_$f.txt 2>&1; echo "$f exit=$? pass=$(grep -c '^  PASS' /tmp/sc_$f.txt) fail=$(grep -c '^  FAIL' /tmp/sc_$f.txt) last=$(tail -1 /tmp/sc_$f.txt)"; done
```
Expected exactly:
```
test_backend exit=0 pass=71 fail=0 last=ALL PASS
test_steam_store exit=0 pass=76 fail=0 last=ALL PASS
```

## 3. Steps (in this order)

Every **before** block is copied from the file. If `Edit` cannot find it
exactly, the plan is stale: stop (failure rule, § 6). A **Check** line after
each step compares the file with the dry-run result: `git hash-object` must
print exactly the hash shown (it normalises line endings, so CRLF files are
fine). A different hash means an edit is not exact: fix only that file against
the step's blocks, then re-check (this counts toward the failure rule).
`npm run check` is expected to fail between Step 5 and Step 9 (the
`steamStoreRecordArtwork` signature changes in Step 5, its caller in Step 9);
do not run it before Step 11.

### Step 1: `steam-cartridges/frontend/features/game-info/normalize.ts` (new file) — H1 metadata shape guard

Create with exactly:

```ts
/**
 * Metadata shape guard (P4 H1). Millennium's Lua `json.encode` writes an empty
 * table as `{}`, so list fields in library_metadata.json and in backend replies
 * can arrive as objects (14 `franchises: {}` entries on the dev machine). Code
 * that calls `.join` on them throws. Pure, `import type` only, so Node can run
 * the unit tests with type stripping.
 */
import type { ConsolidatedMetadata } from '../../rpc';

function strings(v: unknown): string[] {
    if (typeof v === 'string') return v ? [v] : [];
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>) : [];
    return list.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function seconds(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Every list field becomes a string array; dates become numbers (0 = unknown). */
export function normalizeMetadata(meta: ConsolidatedMetadata): ConsolidatedMetadata {
    return {
        ...meta,
        developers: strings(meta.developers),
        publishers: strings(meta.publishers),
        franchises: strings(meta.franchises),
        genres: strings(meta.genres),
        release_date: seconds(meta.release_date),
    };
}
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/normalize.ts` prints `e075f4d157479f839dcba20d1b2f3ab2a4bba4cd`.

### Step 2: `steam-cartridges/tests/metadata-normalize.test.ts` (new file) — H1 unit tests

Create with exactly:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetadata } from '../frontend/features/game-info/normalize.ts';

test('empty Lua tables ({}) become empty arrays (the metadata.ts TypeError)', () => {
    const m = normalizeMetadata({ appid: 1, title: 't', franchises: {} as unknown as string[], developers: ['A'] });
    assert.deepEqual(m.franchises, []);
    assert.deepEqual(m.developers, ['A']);
    assert.deepEqual(m.publishers, []);
    assert.equal(m.release_date, 0);
});

test('object-shaped lists keep their string values; junk is dropped', () => {
    const m = normalizeMetadata({
        appid: 1,
        title: 't',
        publishers: { 1: 'P', 2: 7, 3: '' } as unknown as string[],
        genres: 'Indie' as unknown as string[],
        release_date: '1505347200' as unknown as number,
    });
    assert.deepEqual(m.publishers, ['P']);
    assert.deepEqual(m.genres, ['Indie']);
    assert.equal(m.release_date, 1505347200);
});

test('other fields pass through unchanged', () => {
    const m = normalizeMetadata({ appid: 5, title: 'x', description: 'd', categories: { coop: true }, steam_appid: 9 });
    assert.equal(m.description, 'd');
    assert.deepEqual(m.categories, { coop: true });
    assert.equal(m.steam_appid, 9);
});
```

Check: `git hash-object steam-cartridges/tests/metadata-normalize.test.ts` prints `f6a8644542dbca9ed8c62f94f3762efa4c8a2a1f`.

### Step 3: `steam-cartridges/frontend/features/game-info/metadata.ts` — H1 the `.join` TypeError at line 231

**Edit 1 of 1.** Before:

```ts
            refreshGameInfoInstances();
            logger.info(
                `Enriched native Game Info & Categories for ${appid} ("${meta.title}"): ` +
                    `[Dev: ${(meta.developers || []).join(", ") || "none"}, ` +
                    `Franchise: ${(meta.franchises || []).join(", ") || "none"}, ` +
                    `Modes: ${meta.categories?.single_player ? "Single " : ""}${meta.categories?.multiplayer ? "Multi " : ""}${meta.categories?.coop ? "Co-op " : ""}]`,
            );
        }
```

After:

```ts
            refreshGameInfoInstances();
            logger.info(
                `Enriched native Game Info & Categories for ${appid} ("${meta.title}"): ` +
                    `[Dev: ${developers.join(", ") || "none"}, ` +
                    `Franchise: ${franchises.join(", ") || "none"}, ` +
                    `Modes: ${meta.categories?.single_player ? "Single " : ""}${meta.categories?.multiplayer ? "Multi " : ""}${meta.categories?.coop ? "Co-op " : ""}]`,
            );
        }
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/metadata.ts` prints `0d2790af15cdc3d3419ebbc22b82abd98a972d14`.

### Step 4: `steam-cartridges/frontend/features/game-info/index.ts` — H1 normalise local and fetched metadata

**Edit 1 of 3.** Before:

```ts
import { resolveShortcutTitle } from "../../steam/shortcut";
import { storeEnrichedAppIds } from "../steam-store/enriched";
import { enrichGameDetails, revertGameDetails } from "./metadata";
import { gameInfoPlan } from "./policy";
import {
    collectionsReady,
```

After:

```ts
import { resolveShortcutTitle } from "../../steam/shortcut";
import { storeEnrichedAppIds } from "../steam-store/enriched";
import { enrichGameDetails, revertGameDetails } from "./metadata";
import { normalizeMetadata } from "./normalize";
import { gameInfoPlan } from "./policy";
import {
    collectionsReady,
```

**Edit 2 of 3.** Before:

```ts
            return;
        }

        libraryCache.set(appid, res.metadata);
        const applied = enrichGameDetails(appid, res.metadata);
        if (applied) {
            logger.info(
                `Successfully enriched Game Info for ${appid} from ${res.source || "db"}.`,
```

After:

```ts
            return;
        }

        const clean = normalizeMetadata(res.metadata);
        libraryCache.set(appid, clean);
        const applied = enrichGameDetails(appid, clean);
        if (applied) {
            logger.info(
                `Successfully enriched Game Info for ${appid} from ${res.source || "db"}.`,
```

**Edit 3 of 3.** Before:

```ts
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    libraryCache.set(appid, meta);
                    const { bucket, via } = getBucket(appid);
                    if (
                        gameInfoPlan(bucket, via).applyLocal &&
                        enrichGameDetails(appid, meta)
                    ) {
                        count++;
                    }
```

After:

```ts
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    const clean = normalizeMetadata(meta);
                    libraryCache.set(appid, clean);
                    const { bucket, via } = getBucket(appid);
                    if (
                        gameInfoPlan(bucket, via).applyLocal &&
                        enrichGameDetails(appid, clean)
                    ) {
                        count++;
                    }
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/index.ts` prints `c4275982673c930b120eab1919c54eb04ef93ded`.

### Step 5: `steam-cartridges/frontend/rpc.ts` — H5 `StoreApplied.failed`, `steamStoreRecordArtwork(…, failed)`

**Edit 1 of 2.** Before:

```ts
export interface StoreApplied {
    steam_appid: number;
    slots: number[];
    at?: number;
}
export interface StoreState {
```

After:

```ts
export interface StoreApplied {
    steam_appid: number;
    slots: number[];
    /** Slots attempted but not written (retried once per session, P4 H5). */
    failed?: number[];
    at?: number;
}
export interface StoreState {
```

**Edit 2 of 2.** Before:

```ts
            appid,
            force,
        }),
    steamStoreRecordArtwork: (appid: number, steam_appid: number, slots: number[]) =>
        call<{ ok?: boolean; error?: string }>("SteamStoreRecordArtwork", { appid, steam_appid, slots }),
    steamStoreDownloadImage: (url: string) =>
        call<{ base64?: string; ext?: string; error?: string }>("SteamStoreDownloadImage", { url }),
};
```

After:

```ts
            appid,
            force,
        }),
    steamStoreRecordArtwork: (appid: number, steam_appid: number, slots: number[], failed: number[]) =>
        call<{ ok?: boolean; error?: string }>("SteamStoreRecordArtwork", { appid, steam_appid, slots, failed }),
    steamStoreDownloadImage: (url: string) =>
        call<{ base64?: string; ext?: string; error?: string }>("SteamStoreDownloadImage", { url }),
};
```

Check: `git hash-object steam-cartridges/frontend/rpc.ts` prints `24bb268203a95f95fa46cc322f17f5bf7dcc1eab`.

### Step 6: `steam-cartridges/frontend/features/steam-store/art-plan.ts` (new file) — H5 per-slot art plan (pure)

Create with exactly:

```ts
/**
 * Per-slot artwork bookkeeping for a steam-store game (P4 H5). Pure, `import
 * type` only, so Node can run the unit tests with type stripping.
 *
 *   nothing recorded                  -> write all four slots
 *   recorded for another native app   -> clear the slots we wrote, write all four
 *   recorded for this native app      -> retry only the slots that failed at write
 *                                        time, at most once per session
 *
 * A slot the user removed in Steam is pruned from `slots` by the backend and is
 * not in `failed`, so it is never written again (the user wins).
 */
import type { ArtworkUrls, StoreApplied } from '../../rpc';

export const ALL_SLOTS: readonly number[] = [0, 1, 2, 3];

/** Slot number -> ArtworkUrls key (SetCustomArtworkForApp image types). */
const SLOT_KEY: Record<number, keyof ArtworkUrls> = { 0: 'portrait', 1: 'hero', 2: 'logo', 3: 'wide' };

export interface ArtPlan {
    clear: number[];
    write: number[];
}

/** Lua's json.encode writes an empty list as `{}`; treat anything but an array as empty. */
export function slotList(v: unknown): number[] {
    return Array.isArray(v) ? v.filter((s): s is number => typeof s === 'number' && ALL_SLOTS.includes(s)) : [];
}

export function artworkPlan(applied: StoreApplied | null, steamAppid: number, retriedThisSession: boolean): ArtPlan {
    if (!applied) return { clear: [], write: [...ALL_SLOTS] };
    const slots = slotList(applied.slots);
    if (applied.steam_appid !== steamAppid) return { clear: slots, write: [...ALL_SLOTS] };
    if (retriedThisSession) return { clear: [], write: [] };
    return { clear: [], write: slotList(applied.failed).filter((s) => !slots.includes(s)) };
}

/** Only the URLs of the slots to write. */
export function pickUrls(urls: ArtworkUrls, slots: readonly number[]): ArtworkUrls {
    const out: ArtworkUrls = {};
    for (const slot of slots) {
        const key = SLOT_KEY[slot];
        if (key && urls[key]) out[key] = urls[key];
    }
    return out;
}

/** What to record after a write: kept + newly written slots, and the attempted slots that failed. */
export function mergeArtResult(
    applied: StoreApplied | null,
    steamAppid: number,
    plan: ArtPlan,
    written: readonly number[],
): { slots: number[]; failed: number[] } {
    const kept = applied && applied.steam_appid === steamAppid ? slotList(applied.slots) : [];
    const slots = [...new Set([...kept, ...written])].sort((a, b) => a - b);
    const failed = plan.write.filter((s) => !written.includes(s));
    return { slots, failed };
}
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/art-plan.ts` prints `0a43d301d6ec20196070e12c3030c4800502d88f`.

### Step 7: `steam-cartridges/tests/art-plan.test.ts` (new file) — H5 unit tests

Create with exactly:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkPlan, mergeArtResult, pickUrls, slotList } from '../frontend/features/steam-store/art-plan.ts';

test('nothing recorded: write all four', () => {
    assert.deepEqual(artworkPlan(null, 2820820, false), { clear: [], write: [0, 1, 2, 3] });
});

test('recorded for another app: clear ours, write all four', () => {
    assert.deepEqual(artworkPlan({ steam_appid: 1, slots: [0, 2] }, 2820820, false), { clear: [0, 2], write: [0, 1, 2, 3] });
});

test('same app: retry failed slots once per session; removed slots stay removed', () => {
    const applied = { steam_appid: 2820820, slots: [0, 1], failed: [2] };
    assert.deepEqual(artworkPlan(applied, 2820820, false), { clear: [], write: [2] });
    assert.deepEqual(artworkPlan(applied, 2820820, true), { clear: [], write: [] });
    assert.deepEqual(artworkPlan({ steam_appid: 2820820, slots: [0, 1] }, 2820820, false), { clear: [], write: [] });
});

test('Lua empty tables ({}) are empty lists', () => {
    assert.deepEqual(slotList({}), []);
    assert.deepEqual(artworkPlan({ steam_appid: 5, slots: {} as unknown as number[] }, 5, false), { clear: [], write: [] });
});

test('pickUrls keeps only the planned slots', () => {
    assert.deepEqual(pickUrls({ portrait: 'p', hero: 'h', logo: 'l', wide: 'w' }, [1, 2]), { hero: 'h', logo: 'l' });
});

test('mergeArtResult: kept + written, failed = attempted - written', () => {
    const plan = { clear: [], write: [2, 3] };
    assert.deepEqual(mergeArtResult({ steam_appid: 9, slots: [0, 1] }, 9, plan, [3]), { slots: [0, 1, 3], failed: [2] });
    assert.deepEqual(mergeArtResult({ steam_appid: 8, slots: [0, 1] }, 9, { clear: [0, 1], write: [0, 1, 2, 3] }, [0, 1, 2, 3]), {
        slots: [0, 1, 2, 3],
        failed: [],
    });
});
```

Check: `git hash-object steam-cartridges/tests/art-plan.test.ts` prints `dceeb088394786e00a0251067e678f461efdc53f`.

### Step 8: `steam-cartridges/frontend/features/steam-store/store-item.ts` — H4 skip apps Steam already failed to load

**Edit 1 of 1.** Before:

```ts
    const cache = (window as any).StoreItemCache;
    if (!cache?.QueueAppRequest) return null;
    try {
        if (!cache.BHasApp?.(steamAppid)) {
            cache.QueueAppRequest(steamAppid, {
                include_assets: true,
```

After:

```ts
    const cache = (window as any).StoreItemCache;
    if (!cache?.QueueAppRequest) return null;
    try {
        // Steam already failed to load it (delisted or unknown): go straight to the fallback (P4 H4).
        if (cache.BIsAppMissing?.(steamAppid)) return null;
        if (!cache.BHasApp?.(steamAppid)) {
            cache.QueueAppRequest(steamAppid, {
                include_assets: true,
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/store-item.ts` prints `7a96b8d081c228acdf9702f3d573f527812bea20`.

### Step 9: `steam-cartridges/frontend/features/steam-store/index.ts` — H1 + H3 retry after failure + H5 per-slot art

**Edit 1 of 8.** Before:

```ts
import { resolveShortcutTitle } from "../../steam/shortcut";
import { applyCustomArtworkFromUrls } from "../artwork/artwork";
import { enrichGameDetails, revertGameDetails } from "../game-info/metadata";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { storeEnrichedAppIds } from "./enriched";
import { knownAppName, matchKnownNative } from "./known-apps";
import { cdnArtworkUrls } from "./resolve";
```

After:

```ts
import { resolveShortcutTitle } from "../../steam/shortcut";
import { applyCustomArtworkFromUrls } from "../artwork/artwork";
import { enrichGameDetails, revertGameDetails } from "../game-info/metadata";
import { normalizeMetadata } from "../game-info/normalize";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { artworkPlan, mergeArtResult, pickUrls, slotList } from "./art-plan";
import { storeEnrichedAppIds } from "./enriched";
import { knownAppName, matchKnownNative } from "./known-apps";
import { cdnArtworkUrls } from "./resolve";
```

**Edit 2 of 8.** Before:

```ts
const processed = new Set<number>();
/** Metadata already fetched this session, re-applied on later views. */
const metaCache = new Map<number, ConsolidatedMetadata>();

async function resolveMapping(
    appid: number,
): Promise<{ mapping: StoreMapping | null; applied: StoreApplied | null; retry?: boolean }> {
    const state = await rpc.steamStoreGetMapping(appid);
    if (state.mapping) return { mapping: state.mapping, applied: state.applied };
```

After:

```ts
const processed = new Set<number>();
/** Metadata already fetched this session, re-applied on later views. */
const metaCache = new Map<number, ConsolidatedMetadata>();
/** A lookup that failed (offline, HTTP error) may run again on a view after this time (P4 H3). */
const RETRY_MS = 5 * 60_000;
const retryAt = new Map<number, number>();
/** Games whose failed art slots were already retried this session (P4 H5). */
const artRetried = new Set<number>();

async function resolveMapping(
    appid: number,
): Promise<{ mapping: StoreMapping | null; applied: StoreApplied | null; retry?: boolean; error?: boolean }> {
    const state = await rpc.steamStoreGetMapping(appid);
    if (state.mapping) return { mapping: state.mapping, applied: state.applied };
```

**Edit 3 of 8.** Before:

```ts
        logger.info(`Steam Store: ${found.suggestions.length} suggestion(s) for "${title}"; accept one in settings.`);
    } else if (found.error) {
        logger.warn(`Steam Store search failed for "${title}": ${found.error}`);
    }
    return { mapping: null, applied: null };
}
```

After:

```ts
        logger.info(`Steam Store: ${found.suggestions.length} suggestion(s) for "${title}"; accept one in settings.`);
    } else if (found.error) {
        logger.warn(`Steam Store search failed for "${title}": ${found.error}`);
        return { mapping: null, applied: null, error: true };
    }
    return { mapping: null, applied: null };
}
```

**Edit 4 of 8.** Before:

```ts
    }
    if (!metadata) {
        const res = await rpc.steamStoreGetAppDetails(steamAppid, appid).catch(() => null);
        metadata = res?.metadata ?? null;
    }
    return { metadata, urls };
}

async function applyArtwork(appid: number, mapping: StoreMapping, applied: StoreApplied | null, urls: Loaded["urls"]) {
    // A different game was mapped before: clear only the slots this plugin wrote.
    if (applied && applied.steam_appid !== mapping.steam_appid) {
        const apps = (window as any).SteamClient?.Apps;
        for (const slot of applied.slots) {
            try {
                await apps?.ClearCustomArtworkForApp?.(appid, slot);
            } catch {}
        }
    }
    const slots = await applyCustomArtworkFromUrls(appid, urls);
    // Record only what succeeded; a failed slot (404, size limit) stays unrecorded.
    await rpc.steamStoreRecordArtwork(appid, mapping.steam_appid, slots);
    logger.info(`Steam Store: applied ${slots.length} art slot(s) from ${mapping.steam_appid} to ${appid}.`);
}

/** Desktop and Big Picture entry point for a steam-store game. */
```

After:

```ts
    }
    if (!metadata) {
        const res = await rpc.steamStoreGetAppDetails(steamAppid, appid).catch(() => null);
        metadata = res?.metadata ? normalizeMetadata(res.metadata) : null;
    }
    return { metadata, urls };
}

async function applyArtwork(appid: number, mapping: StoreMapping, applied: StoreApplied | null, urls: Loaded["urls"]) {
    const plan = artworkPlan(applied, mapping.steam_appid, artRetried.has(appid));
    if (applied?.steam_appid === mapping.steam_appid) artRetried.add(appid);
    if (plan.write.length === 0) return;

    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    // A different game was mapped before: clear only the slots this plugin wrote.
    for (const slot of plan.clear) {
        try {
            await apps?.ClearCustomArtworkForApp?.(appid, slot);
        } catch {}
    }
    const written = await applyCustomArtworkFromUrls(appid, pickUrls(urls, plan.write));
    const { slots, failed } = mergeArtResult(applied, mapping.steam_appid, plan, written);
    const res = await rpc.steamStoreRecordArtwork(appid, mapping.steam_appid, slots, failed);
    if (res?.error) {
        // The mapping was cleared while we were writing: remove what we just wrote (P4 H5).
        for (const slot of written) {
            try {
                await apps?.ClearCustomArtworkForApp?.(appid, slot);
            } catch {}
        }
        logger.warn(`Steam Store: art for ${appid} discarded (${res.error}).`);
        return;
    }
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${mapping.steam_appid} to ${appid}; ${failed.length} failed.`);
}

/** Desktop and Big Picture entry point for a steam-store game. */
```

**Edit 5 of 8.** Before:

```ts
        enrichGameDetails(appid, cached);
        storeEnrichedAppIds.add(appid);
    }
    if (processed.has(appid)) return;
    processed.add(appid);

    try {
        const { mapping, applied, retry } = await resolveMapping(appid);
        if (retry) {
            processed.delete(appid);
            return;
        }
        if (!mapping) return;

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
```

After:

```ts
        enrichGameDetails(appid, cached);
        storeEnrichedAppIds.add(appid);
    }
    if (processed.has(appid)) {
        const at = retryAt.get(appid);
        if (at === undefined || Date.now() < at) return;
        retryAt.delete(appid);
    }
    processed.add(appid);

    try {
        const { mapping, applied, retry, error } = await resolveMapping(appid);
        if (retry) {
            processed.delete(appid);
            return;
        }
        if (error) retryAt.set(appid, Date.now() + RETRY_MS);
        if (!mapping) return;

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
```

**Edit 6 of 8.** Before:

```ts
            logger.warn(`Steam Store: no metadata for ${mapping.steam_appid}.`);
        }

        if (applied?.steam_appid !== mapping.steam_appid) {
            await applyArtwork(appid, mapping, applied, urls);
        }
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
    }
```

After:

```ts
            logger.warn(`Steam Store: no metadata for ${mapping.steam_appid}.`);
        }

        await applyArtwork(appid, mapping, applied, urls);
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
    }
```

**Edit 7 of 8.** Before:

```ts
    processed.delete(appid);
    metaCache.delete(appid);
    storeEnrichedAppIds.delete(appid);
}

/**
```

After:

```ts
    processed.delete(appid);
    metaCache.delete(appid);
    storeEnrichedAppIds.delete(appid);
    retryAt.delete(appid);
    artRetried.delete(appid);
}

/**
```

**Edit 8 of 8.** Before:

```ts
export async function clearSteamStore(appid: number, reject: boolean) {
    const res = await rpc.steamStoreClearMapping(appid, reject);
    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    for (const slot of res.slots ?? []) {
        try {
            await apps?.ClearCustomArtworkForApp?.(appid, slot);
        } catch (err) {
```

After:

```ts
export async function clearSteamStore(appid: number, reject: boolean) {
    const res = await rpc.steamStoreClearMapping(appid, reject);
    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    for (const slot of slotList(res.slots)) {
        try {
            await apps?.ClearCustomArtworkForApp?.(appid, slot);
        } catch (err) {
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/index.ts` prints `ebfa0878a3e6ea76bcef205c1a84382ed0aecb52`.

### Step 10: `steam-cartridges/frontend/features/source-view.ts` — H6 replay a view that arrived while in flight

**Edit 1 of 2.** Before:

```ts
const inflight = new Set<number>();
/** Views seen before collections were ready; replayed once they are. */
const deferred = new Set<number>();

/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN || inflight.has(appid)) return;
    inflight.add(appid);
    try {
        const { bucket, via } = getBucket(appid);
```

After:

```ts
const inflight = new Set<number>();
/** Views seen before collections were ready; replayed once they are. */
const deferred = new Set<number>();
/** A view that arrived while the same appid was in flight; replayed once afterwards (P4 H6). */
const rerun = new Set<number>();

/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;
    if (inflight.has(appid)) {
        rerun.add(appid);
        return;
    }
    inflight.add(appid);
    try {
        const { bucket, via } = getBucket(appid);
```

**Edit 2 of 2.** Before:

```ts
        }
    } finally {
        inflight.delete(appid);
    }
}
```

After:

```ts
        }
    } finally {
        inflight.delete(appid);
        if (rerun.delete(appid)) void onSourceView(appid);
    }
}
```

Check: `git hash-object steam-cartridges/frontend/features/source-view.ts` prints `d3b599731ede13ac5d147d1be2d1830c5568575e`.

### Step 11: frontend gate

```bash
cd /c/game/millennium/steam-cartridges && npm run check && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: the two `check` banner lines, nothing else from `tsc`, then exactly:
```
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

### Step 12: `steam-cartridges/backend/steam_store_throttle.lua` — H2 wall clock + H3 offline breaker and 8 s timeout

**Edit 1 of 2.** Before:

```lua
--- One global gate for store.steampowered.com: serial, at most one request per
--- second. The backend is single-threaded and requests are synchronous, so the
--- gate simply waits out the remainder of the interval.

local M = {}

M.INTERVAL = 1.0
M.USER_AGENT = "steam-cartridges (Millennium plugin)"

local last = nil
M.now = os.clock            -- injectable (tests)
M.sleep = function(seconds) -- busy wait; there is no sleep primitive in the sandbox
  local t = os.clock()
  while os.clock() - t < seconds do end
end

--- Block until a request may be made, then stamp it.
```

After:

```lua
--- One global gate for store.steampowered.com: serial, at most one request per
--- second, measured on the WALL clock (P4 H2: `os.clock` is CPU time, so the
--- old gate spun for a full second after any idle period).
---
--- Offline circuit breaker (P4 H3): a transport failure (no HTTP response at
--- all) makes every request fail fast with "offline" for OFFLINE_SECONDS, so a
--- disconnected machine never blocks the backend thread for a timeout per view.

local M = {}

M.INTERVAL = 1.0
M.OFFLINE_SECONDS = 300
M.TIMEOUT = 8
M.USER_AGENT = "steam-cartridges (Millennium plugin)"

local last = nil
local offline_until = nil

--- Wall-clock seconds. Millennium's `datetime.now()` returns milliseconds;
--- `os.time()` (whole seconds) is the fallback outside Millennium.
M.now = function()
  local ok, dt = pcall(require, "datetime")
  if ok and type(dt) == "table" and type(dt.now) == "function" then
    local ms = dt.now()
    if type(ms) == "number" then return ms / 1000 end
  end
  return os.time()
end

M.sleep = function(seconds) -- busy wait; there is no sleep primitive in the sandbox
  local t = M.now()
  while M.now() - t < seconds do end
end

--- Block until a request may be made, then stamp it.
```

**Edit 2 of 2.** Before:

```lua
  last = M.now()
end

function M._reset() last = nil end

--- Default `http_get(url) -> body | nil, err`: throttled, with our User-Agent.
function M.http_get(url)
  local http = require("http")
  M.acquire()
  local ok, res = pcall(http.get, url, {
    headers = { ["Accept"] = "application/json", ["User-Agent"] = M.USER_AGENT },
    timeout = 15,
  })
  if not ok then return nil, tostring(res) end
  if not res then return nil, "no response" end
  if res.status ~= 200 or not res.body then return nil, "HTTP " .. tostring(res.status) end
  return res.body
end
```

After:

```lua
  last = M.now()
end

function M.is_offline()
  return offline_until ~= nil and M.now() < offline_until
end

function M._reset()
  last = nil
  offline_until = nil
end

--- Default `http_get(url) -> body | nil, err`: throttled, with our User-Agent.
--- err is "offline" (transport failure or breaker open) or "HTTP <status>".
function M.http_get(url)
  if M.is_offline() then return nil, "offline" end
  local http = require("http")
  M.acquire()
  local ok, res = pcall(http.get, url, {
    headers = { ["Accept"] = "application/json", ["User-Agent"] = M.USER_AGENT },
    timeout = M.TIMEOUT,
  })
  if not ok or not res or not res.status or res.status == 0 then
    offline_until = M.now() + M.OFFLINE_SECONDS
    return nil, "offline"
  end
  if res.status ~= 200 or not res.body then return nil, "HTTP " .. tostring(res.status) end
  return res.body
end
```

Check: `git hash-object steam-cartridges/backend/steam_store_throttle.lua` prints `3e900de63d320a8c429718ec91c051e72ac09977`.

### Step 13: `steam-cartridges/backend/steam_store_store.lua` — H5 refuse orphan records, prune removed slots

**Edit 1 of 1.** Before:

```lua
  M.remove_suggestion(appid, steam_appid) -- saves
end

function M.record_artwork(appid, steam_appid, slots, now)
  local s, k = load(), key(appid)
  s.applied_artwork[k] = { steam_appid = tonumber(steam_appid), slots = slots or {}, at = now or os.time() }
  save()
end

function M.is_negative(norm_title, now)
```

After:

```lua
  M.remove_suggestion(appid, steam_appid) -- saves
end

--- Record the art slots this plugin wrote (and the attempted slots that failed).
--- Refused with (false, "no mapping") unless the shortcut is still mapped to that
--- same native app: a view that finishes after the user pressed Clear must not
--- resurrect applied_artwork (P4 H5; the orphan seen live on 2315502503).
function M.record_artwork(appid, steam_appid, slots, now, failed)
  local s, k = load(), key(appid)
  local mapping = s.mappings[k]
  if not mapping or tonumber(mapping.steam_appid) ~= tonumber(steam_appid) then
    return false, "no mapping"
  end
  s.applied_artwork[k] = { steam_appid = tonumber(steam_appid), slots = slots or {}, failed = failed or {}, at = now or os.time() }
  save()
  return true
end

--- Grid file names Steam writes for a custom art slot (SetCustomArtworkForApp).
local SLOT_SUFFIX = { [0] = "p", [1] = "_hero", [2] = "_logo", [3] = "" }

function M.slot_files(appid, slot)
  local suffix = SLOT_SUFFIX[tonumber(slot)]
  if suffix == nil then return {} end
  local base = key(appid) .. suffix
  return { base .. ".png", base .. ".jpg", base .. ".jpeg" }
end

--- Drop recorded slots whose grid file is gone: the user removed that art in
--- Steam, the user wins, and the slot is never written again (P4 H5).
--- `exists(name)` checks one grid file name. Returns the pruned entry or nil.
function M.prune_missing_slots(appid, exists)
  local s, k = load(), key(appid)
  local applied = s.applied_artwork[k]
  if not applied then return nil end
  local keep, changed = {}, false
  for _, slot in ipairs(applied.slots or {}) do
    local present = false
    for _, name in ipairs(M.slot_files(appid, slot)) do
      if exists(name) then present = true break end
    end
    if present then keep[#keep + 1] = slot else changed = true end
  end
  if changed then
    applied.slots = keep
    save()
  end
  return applied
end

function M.is_negative(norm_title, now)
```

Check: `git hash-object steam-cartridges/backend/steam_store_store.lua` prints `e8037bf495b1b262548692e77ad7a0b45e6e6e40`.

### Step 14: `steam-cartridges/backend/steam_store_rpc.lua` — H5 prune on read, refuse on record

**Edit 1 of 4.** Before:

```lua
--- Only calls for steam-store games reach here (the frontend gates on the
--- bucket, ADR-0032), so the network is never touched for anything else.

local utils       = require("utils")
local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")
```

After:

```lua
--- Only calls for steam-store games reach here (the frontend gates on the
--- bucket, ADR-0032), so the network is never touched for anything else.

local fs          = require("fs")
local utils       = require("utils")
local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")
```

**Edit 2 of 4.** Before:

```lua
  return store.get_state()
end)

RPC.SteamStoreGetMapping = method("SteamStoreGetMapping", function(data)
  local entry = store.get(need(data, "appid"))
  return { mapping = entry.mapping, rejected = entry.rejected, applied = entry.applied }
end)
```

After:

```lua
  return store.get_state()
end)

--- `exists(name)` for files in <user>/config/grid, or nil when paths are unknown.
local function grid_exists()
  local paths = steam_paths.resolve()
  if not paths or not paths.user_root then return nil end
  local grid = fs.join(paths.user_root, "config", "grid")
  return function(name) return fs.exists(fs.join(grid, name)) == true end
end

RPC.SteamStoreGetMapping = method("SteamStoreGetMapping", function(data)
  local appid = need(data, "appid")
  local exists = grid_exists()
  if exists then pcall(store.prune_missing_slots, appid, exists) end
  local entry = store.get(appid)
  return { mapping = entry.mapping, rejected = entry.rejected, applied = entry.applied }
end)
```

**Edit 3 of 4.** Before:

```lua
end)

RPC.SteamStoreRecordArtwork = method("SteamStoreRecordArtwork", function(data)
  store.record_artwork(need(data, "appid"), need(data, "steam_appid"), data.slots or {})
  return { ok = true }
end)
```

After:

```lua
end)

RPC.SteamStoreRecordArtwork = method("SteamStoreRecordArtwork", function(data)
  local ok, err = store.record_artwork(need(data, "appid"), need(data, "steam_appid"), data.slots or {}, nil, data.failed or {})
  if not ok then return { error = err } end
  return { ok = true }
end)
```

**Edit 4 of 4.** Before:

```lua
RPC.SteamStoreDownloadImage = method("SteamStoreDownloadImage", function(data)
  local url = tostring(need(data, "url"))
  if not url:match("^https://[%w%.%-]*steamstatic%.com/") then error("url not allowed") end
  local http = require("http")
  throttle.acquire()
  local res = http.get(url, { headers = { ["User-Agent"] = throttle.USER_AGENT }, timeout = 20 })
  if not res or res.status ~= 200 or not res.body then error("download failed") end
  local ext = url:match("%.(%w+)[%?]?[^/]*$") or "jpg"
  return { base64 = utils.base64_encode(res.body), ext = ext:lower() == "png" and "png" or "jpg" }
```

After:

```lua
RPC.SteamStoreDownloadImage = method("SteamStoreDownloadImage", function(data)
  local url = tostring(need(data, "url"))
  if not url:match("^https://[%w%.%-]*steamstatic%.com/") then error("url not allowed") end
  if throttle.is_offline() then error("offline") end -- P4 H3: no timeout per view while offline
  local http = require("http")
  throttle.acquire()
  local res = http.get(url, { headers = { ["User-Agent"] = throttle.USER_AGENT }, timeout = throttle.TIMEOUT })
  if not res or res.status ~= 200 or not res.body then error("download failed") end
  local ext = url:match("%.(%w+)[%?]?[^/]*$") or "jpg"
  return { base64 = utils.base64_encode(res.body), ext = ext:lower() == "png" and "png" or "jpg" }
```

Check: `git hash-object steam-cartridges/backend/steam_store_rpc.lua` prints `0df1c3ccbf29cf130fff56644fedede129568469`.

### Step 15: `steam-cartridges/tests/test_steam_store.lua` — H2/H3/H5 Lua tests

**Edit 1 of 3.** Before:

```lua
  throttle.now, throttle.sleep = saved_now, saved_sleep
end

-- ---------- store round trip ----------
print("store")
local path = TMP .. "/sc_steam_store_test_" .. os.time() .. ".json"
```

After:

```lua
  throttle.now, throttle.sleep = saved_now, saved_sleep
end

-- ---------- offline circuit breaker (P4 H3) ----------
print("offline breaker")
do
  local clock = 1000
  local saved_now, saved_sleep = throttle.now, throttle.sleep
  throttle.now = function() return clock end
  throttle.sleep = function(s) clock = clock + s end
  throttle._reset()
  local http = require("http")
  local saved_get = http.get
  local body, err = throttle.http_get("https://store.steampowered.com/x")
  check("transport failure -> offline", body == nil and err == "offline", err)
  local hits = 0
  http.get = function() hits = hits + 1; return { status = 200, body = "{}" } end
  body, err = throttle.http_get("https://store.steampowered.com/x")
  check("breaker open: fails fast without a request", body == nil and err == "offline" and hits == 0)
  clock = clock + throttle.OFFLINE_SECONDS + 1
  body = throttle.http_get("https://store.steampowered.com/x")
  check("breaker closes after OFFLINE_SECONDS", body == "{}" and hits == 1)
  http.get = function() return { status = 404 } end
  body, err = throttle.http_get("https://store.steampowered.com/x")
  check("HTTP error does not open the breaker", err == "HTTP 404" and not throttle.is_offline(), err)
  http.get = saved_get
  throttle.now, throttle.sleep = saved_now, saved_sleep
  throttle._reset()
end

-- ---------- store round trip ----------
print("store")
local path = TMP .. "/sc_steam_store_test_" .. os.time() .. ".json"
```

**Edit 2 of 3.** Before:

```lua
local e = store.get(SC)
check("mapping survives reload", e.mapping and e.mapping.steam_appid == 2820820)
check("applied slots survive reload", e.applied and #e.applied.slots == 3 and e.applied.slots[3] == 3)
local cleared = store.clear(SC, true)
check("clear returns steam_appid + recorded slots", cleared.steam_appid == 2820820 and #cleared.slots == 3)
e = store.get(SC)
```

After:

```lua
local e = store.get(SC)
check("mapping survives reload", e.mapping and e.mapping.steam_appid == 2820820)
check("applied slots survive reload", e.applied and #e.applied.slots == 3 and e.applied.slots[3] == 3)
check("record refused for another native app (P4 H5)", select(2, store.record_artwork(SC, 1, { 0 }, 102)) == "no mapping")
check("slot file names", table.concat(store.slot_files(SC, 1), ",") == "4263274102_hero.png,4263274102_hero.jpg,4263274102_hero.jpeg")
local pruned = store.prune_missing_slots(SC, function(name) return name ~= "4263274102_hero.png" and name ~= "4263274102_hero.jpg" and name ~= "4263274102_hero.jpeg" end)
check("prune drops a slot whose file is gone", #pruned.slots == 2 and pruned.slots[1] == 0 and pruned.slots[2] == 3)
store._reset()
check("pruning is persisted", #store.get(SC).applied.slots == 2)
store.record_artwork(SC, 2820820, { 0, 1, 3 }, 103, { 2 })
check("failed slots recorded", store.get(SC).applied.failed[1] == 2)
local cleared = store.clear(SC, true)
check("clear returns steam_appid + recorded slots", cleared.steam_appid == 2820820 and #cleared.slots == 3)
e = store.get(SC)
```

**Edit 3 of 3.** Before:

```lua
check("clear via RPC returns steam_appid", out.steam_appid == 99)
out = json.decode(RPC.SteamStoreGetMapping(json.encode({ appid = EMU })))
check("GetMapping reports the rejection", out.mapping == nil and out.rejected[1] == 99)
store.add_suggestions(EMU, { { steam_appid = 55, name = "S", reason = "near" } })
RPC.SteamStoreRejectSuggestion(json.encode({ appid = EMU, steam_appid = 55 }))
out = json.decode(RPC.SteamStoreGetMapping(json.encode({ appid = EMU })))
```

After:

```lua
check("clear via RPC returns steam_appid", out.steam_appid == 99)
out = json.decode(RPC.SteamStoreGetMapping(json.encode({ appid = EMU })))
check("GetMapping reports the rejection", out.mapping == nil and out.rejected[1] == 99)
out = json.decode(RPC.SteamStoreRecordArtwork(json.encode({ appid = EMU, steam_appid = 99, slots = { 0 } })))
check("RecordArtwork without a mapping is refused (P4 H5)", out.error == "no mapping")
store.add_suggestions(EMU, { { steam_appid = 55, name = "S", reason = "near" } })
RPC.SteamStoreRejectSuggestion(json.encode({ appid = EMU, steam_appid = 55 }))
out = json.decode(RPC.SteamStoreGetMapping(json.encode({ appid = EMU })))
```

Check: `git hash-object steam-cartridges/tests/test_steam_store.lua` prints `bde38e9e9b18312d4efe132223a3407e498a5f70`.

### Step 16: Lua gate

Run the **Lua command** from § 2.
Expected exactly:
```
test_backend exit=0 pass=71 fail=0 last=ALL PASS
test_steam_store exit=0 pass=86 fail=0 last=ALL PASS
```
Then run Step 11's command again; expect the same output as in Step 11.

### Step 17: docs

17a. `CHANGELOG.md`: Before:
```
## [Unreleased]

```
After:
```
## [Unreleased]

- **`steam-cartridges` P4 hardening (offline)**: metadata shape guard (fixes the `metadata.ts:231` `franchises.join` TypeError), wall-clock store throttle, offline circuit breaker with an 8 s timeout and a 5 min frontend retry, no wait on store items Steam already marked missing, per-slot art record (orphans refused, failed slots retried once, slots the user removed never rewritten), replay of racing views. Plan: [docs/plans/steam-cartridges-p4-hardening.md](docs/plans/steam-cartridges-p4-hardening.md). `tsc` clean, `test:ts` 28/28, Lua 71 + 86 PASS. Live verification pending.

```

17b. `TASK.md`: Before:
```
    - [ ] Offline gates: `tsc`, `test:ts` 28/28, Lua 71 + 86 PASS
```
After:
```
    - [x] Offline gates: `tsc`, `test:ts` 28/28, Lua 71 + 86 PASS
```

17c. `TASK.md`: Before:
```
    - [ ] H1 metadata shape guard (the `metadata.ts:231` TypeError) · H2 wall-clock throttle · H3 offline breaker, 8 s timeout, 5 min retry · H4 skip missing store items · H5 per-slot art record, no orphans · H6 replay racing views
```
After:
```
    - [x] H1 metadata shape guard (the `metadata.ts:231` TypeError) · H2 wall-clock throttle · H3 offline breaker, 8 s timeout, 5 min retry · H4 skip missing store items · H5 per-slot art record, no orphans · H6 replay racing views
```

Check: `cd /c/game/millennium && git diff --stat -- TASK.md CHANGELOG.md` lists both files. (CHANGELOG.md may already carry
unrelated user edits; leave them alone, they are not staged in Step 18.)

### Step 18: commit (do not push unless the caller said so)

`CHANGELOG.md` may hold unrelated uncommitted user edits, so stage only your
bullet: put the 17a text in a patch and apply it to the index.

```bash
cd /c/game/millennium && git add steam-cartridges/frontend/features/game-info/normalize.ts steam-cartridges/tests/metadata-normalize.test.ts steam-cartridges/frontend/features/game-info/metadata.ts steam-cartridges/frontend/features/game-info/index.ts steam-cartridges/frontend/rpc.ts steam-cartridges/frontend/features/steam-store/art-plan.ts steam-cartridges/tests/art-plan.test.ts steam-cartridges/frontend/features/steam-store/store-item.ts steam-cartridges/frontend/features/steam-store/index.ts steam-cartridges/frontend/features/source-view.ts steam-cartridges/backend/steam_store_throttle.lua steam-cartridges/backend/steam_store_store.lua steam-cartridges/backend/steam_store_rpc.lua steam-cartridges/tests/test_steam_store.lua TASK.md
git show HEAD:CHANGELOG.md > .git/cl_head.md
python - <<'EOF'
head = open('.git/cl_head.md', encoding='utf-8').read()
new = open('CHANGELOG.md', encoding='utf-8').read().replace('\r\n', '\n')
line = next(l for l in new.split('\n') if l.startswith('- **`steam-cartridges` P4 hardening (offline)**'))
marker = '## [Unreleased]\n\n'
assert head.count(marker) == 1
open('.git/cl_new.md', 'w', encoding='utf-8', newline='\n').write(head.replace(marker, marker + line + '\n\n'))
EOF
git diff --no-index .git/cl_head.md .git/cl_new.md | sed 's#a/.git/cl_head.md#a/CHANGELOG.md#; s#b/.git/cl_new.md#b/CHANGELOG.md#' | git apply --cached
rm -f .git/cl_head.md .git/cl_new.md
git diff --cached --stat
```
Expected: exactly 16 files: the 14 `steam-cartridges/` paths above, `TASK.md`
and `CHANGELOG.md` (`CHANGELOG.md | 2 ++`). Anything else: stop.

```bash
cd /c/game/millennium && git commit -m "fix(steam-cartridges): P4 hardening - metadata shape guard, wall-clock throttle, offline breaker, per-slot art record, view replay" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## 4. Do not touch

- `steam-cartridges/frontend/steam/**` (sections, activity, summary, stores, jsx-hook, gamepad-appid, headline/activity-cards patches)
- `steam-cartridges/frontend/renderers/**`, `frontend/index.tsx`, `frontend/settings/**`
- `steam-cartridges/frontend/features/buckets/**`, `features/game-info/policy.ts`, `game-info-patch.ts`, `features/artwork/**`, `features/steam-store/{known-apps,resolve,enriched}.ts`
- `steam-cartridges/backend/` except the three files in Steps 12–14; `backend/_lib/**`
- `plugin.json`, `dev.ps1`, `package.json`, `package-lock.json`, `tsconfig.json`
- `docs/decisions.md`, `docs/plugins.md`, every other test file, `scratch/**`
- Anything under `C:\game\steam\` (plugins, Millennium config, `library_metadata.json`, `steam_store.json`, userdata, grid)
- The unrelated uncommitted user changes in `enhanced-achievements/`, `enhanced-notifications/`, `scratch/check_toast_metrics.mjs`, `scratch/find_popup_module.mjs`, and any `CHANGELOG.md` hunk that is not yours

## 5. Banned actions

- No deploy or restart: no `dev.ps1`, `start-steam-dev.ps1`, `steam.exe`.
- No SharedJSContext reload, no CDP writes, no probe or throwaway plugins.
- No edits to Millennium `config.json` or plugin config (`setSetting`, `PluginConfig_*`).
- No changes to the user's library, collections, shortcuts or artwork.
- No `npm install`, `npm update` or version change (ignore the `@steambrew/ttc` update nag).
- No `git add -A` / `git add .`, `git push --force`, `--no-verify`, amend or rebase.
- Do not change any assertion, expected count or hash in this plan to make a step pass.

## 6. Failure rule

Run any failing command at most **twice**. After the second failure, stop. Do
not edit code to work around it and do not continue to later steps. Append to
`TASK.md` § Active Failures & Blockers:
```
- BLOCKED p4-hardening step <N>: `<command>` failed twice:
  <first 30 lines of output>
```
Then commit only `TASK.md` (message `docs(task): p4-hardening blocked at step <N>`,
with the attribution line) and exit.

## 7. Live verification (user or verifier, after the user deploys with `dev.ps1`)

Not for the implementer. After a graceful restart (desktop unless stated):

1. **H1:** in `C:\game\steam\logs\webhelper_js.txt`, no line containing
   `join is not a function` is newer than the restart
   (`grep "join is not a function" webhelper_js.txt | tail -1` shows an older timestamp).
   In SharedJSContext `Array.isArray(appDetailsStore.GetAppData(4263274102).associationData.rgFranchises)` is `true`.
2. **Routines 1–3 (regression):** `node scratch/test_nav_cycle.js` five times, every line `PASS`;
   Big Picture started with `start-steam-dev.ps1 -BigPicture`: `node scratch/check_all_tabs.js`, every line `PASS`.
3. **H5, read-only:** `await PLUGIN_LIST['steam-cartridges-dev'].steamStoreState()` still shows the
   orphan `applied_artwork["2315502503"]` (P4 does not delete records; Part A of the parity plan maps
   the game and adopts it). No new `applied_artwork` key appears for a game without a mapping.
4. **H2/H3/H6** need a steam-store game, which exists only after the parity plan's Part A; they are
   verified there (parity plan § 9 step 3: offline breaker and retry).

## 8. Guardrail checklist (re-read each in docs/plugins.md; tick with one line of proof)

- [ ] **1 ID coupling:** no prototype hook touched; `ensureAppOverviewHooked` unchanged.
- [ ] **2 O(1) hooks:** no prototype or jsx handler added; `normalizeMetadata` runs per metadata record, not per render.
- [ ] **3 single-pass:** no `req.m` scan added.
- [ ] **5 stubs / negative cache:** `activity.ts` untouched; `BIsAppMissing` is only *read* for native appids (our hook still owns shortcut appids).
- [ ] **6 two-way nav:** § 7 step 2; H6 makes a view that races another replay instead of being dropped.
- [ ] **7 categories:** category purge in `enrichGameDetails` unchanged.
- [ ] **8 details:** no `appData.details` write.
- [ ] **13 MobX computed:** no `collectionStore` read added.
- [ ] **14 gates:** nothing that showed before is hidden; a refused art record only affects a game whose mapping was cleared.
- [ ] **15 checks:** no existing assertion changed; the new Lua and TS tests only add checks.

## 9. Dry-run record

Applied Steps 1–15 to `git archive HEAD steam-cartridges` in a scratch folder
(2026-09-25): every before block matched exactly once, every Check hash
matched, `tsc` clean, `test:ts` 28/28, Lua `test_backend` 71 PASS and
`test_steam_store` 86 PASS (both `ALL PASS`), `npm run build` succeeded.
