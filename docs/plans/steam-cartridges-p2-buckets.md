# steam-cartridges P2: exclusive bucket engine

> Spec for the implementer. Every shortcut resolves to exactly one bucket
> (`steam-store` | `web-scraping` | `none`) from Steam collections. Existing IGDB
> metadata and the Game Info patch then run **only** for `web-scraping` games.
> Decisions:
> [ADR-0033](../decisions.md#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)
> (config shape, precedence, frontend resolution) and
> [steam-cartridges.md § 9](../steam-cartridges.md#9-risks-and-open-questions)
> decision 1 (`none` for everything unassigned).
> Prerequisites: P1 merged; P0 **T1** recorded in steam-components.md §
> "Collections (`collectionStore`)". Every collection accessor below is
> **P0-gated**: use the names T1 recorded, not the expected ones written here.

Out of scope: Steam Store behaviour (P3). In P2 a `steam-store` game just gets
no web enrichment. The capture features (sections, summary, activity, library
grid) **ignore buckets** and keep serving every shortcut.

---

## 1. Config schema

One Millennium config key, `buckets`, holding a JSON value (limit 256 KB per
value; knowledgebase.md § Configuration API):

```ts
type Bucket = 'steam-store' | 'web-scraping' | 'none';

interface BucketAssignment {
    id: string;          // Steam collection id (P0 T1 field)
    name: string;        // display name at assignment time; used to re-find a re-created collection
    bucket: Exclude<Bucket, 'none'>;
}

interface BucketsConfig {
    version: 1;
    default: 'none';                          // fixed (decision 1); validation forces it
    assignments: BucketAssignment[];          // ORDER = precedence; a collection id appears once
    overrides: Record<string, Bucket>;        // shortcut appid (string) -> bucket; 'none' = force-ignore
}

const DEFAULT_BUCKETS: BucketsConfig = { version: 1, default: 'none', assignments: [], overrides: {} };
```

`validateConfig(raw)` never throws. It drops malformed entries and duplicate ids
(the first wins), drops unknown bucket strings, drops override keys that are not
numeric or are `< 0x8000_0000`, and forces `default: 'none'`.

## 2. Resolution (pure)

```ts
interface Resolution {
    bucket: Bucket;
    via: 'override' | 'collection' | 'default' | 'not-a-shortcut';
    collectionId?: string;
    conflict?: { collectionIds: string[]; buckets: Bucket[] };   // member of >1 assigned collection with different buckets
}
resolveBucket(appid: number, cfg: BucketsConfig, membersOf: (collectionId: string) => ReadonlySet<number> | undefined): Resolution
```

1. `appid < 0x8000_0000` → `none` / `not-a-shortcut`.
2. `cfg.overrides[appid]` → that bucket / `override`.
3. Walk `cfg.assignments` in order. The first whose `membersOf(id)` has the appid
   wins. Keep scanning only to fill `conflict` (O(#assignments), not a hot path).
4. Else `none` / `default`.

`membersOf` returning `undefined` (collection deleted) skips that assignment.
`collectionReport()` (§ 3) lists it as missing. If a missing id has a live
collection with the same `name`, the report offers "re-link" (it does not do it
silently).

## 3. Files

| File | Change |
| --- | --- |
| `frontend/features/buckets/resolve.ts` | **NEW.** Types above + `DEFAULT_BUCKETS`, `validateConfig`, `resolveBucket`, `findConflicts(cfg, membersOf, appids)`. **Only `import type`**, no runtime imports, so Node can test it with type stripping. |
| `frontend/features/buckets/collections.ts` | **NEW.** The only file touching `collectionStore`. `waitForCollections(timeoutMs = 10_000): Promise<boolean>`, `listCollections(): { id, name, dynamic, shortcutCount }[]`, `membersOf(id): ReadonlySet<number> \| undefined` (O(1) `has`; if T1 shows membership is an array, build a `Set` per call, cached per collection and invalidated by the T1 change signal or by a 2 s TTL). Resolve `collectionStore` by the signature T1 recorded. A failed resolve returns empty results and logs once (fallback: everything is `none`). |
| `frontend/features/buckets/index.ts` | **NEW.** `getBucket(appid): Resolution` (current settings + live collections), `bucketReport()` for the panel: per collection the bucket and shortcut count; conflicts with game names; missing collections; `unbucketedWithMetadata` (count of `libraryCache` appids resolving to `none`, read via a new `cachedMetadataAppids()` export from `features/game-info/index.ts`). `onBucketsChanged(fn)` wraps `onSettingChange('buckets')`. |
| `frontend/settings/settings.ts` | **NEW.** Port `enhanced-achievements/frontend/settings/settings.ts` (the #903 workaround: `getAll` with a fallback to `MILLENNIUM_API.ffi('core','PluginConfig_GetAll')`, write-then-read-back, in-memory copy, own listeners, no `usePluginConfig`). One key: `buckets`, validated with `validateConfig`. Exports `initSettings`, `setting`, `setSetting`, `onSettingChange`, `useSetting`, `resetSettings`. This is the **only** file that talks to `pluginConfig` (steam-cartridges.md § 9). |
| `frontend/settings/settings-panel.tsx` | **NEW.** Use `@steambrew/client` components only (`DialogControlsSection`, `DialogControlsSectionHeader`, `DropdownItem`, `ButtonItem`, `ToggleField`, as in enhanced-achievements); no custom CSS (steam-styles.md). Sections: **Buckets**, a row per user collection with a `DropdownItem` (Steam Store / Web Scraping / Neither) and the shortcut count. Assigned rows get Up/Down `ButtonItem`s for precedence. A collection is assigned by one dropdown, so "both buckets" cannot be expressed. **Overrides**: a list with remove, and an add row (shortcut picker built from `appStore` shortcuts, bucket dropdown). **Warnings**: conflicts ("X is in *Retro* (Web Scraping) and *My Epic* (Steam Store); using Web Scraping"), missing collections with re-link, and "N games have cached metadata but no bucket". |
| `frontend/index.tsx` | Default export becomes `definePlugin(() => { init().catch(...); return { title: 'Steam Cartridges', icon: <IconsModule.Settings />, content: <SettingsPanel /> }; })` (the enhanced-achievements pattern). `init()` = `await initSettings()`, then the existing `OnPluginLoaded` body, unchanged. Keep every named export and add `setSetting`, `resetSettings` and `bucketReport` for CDP tests. |
| `frontend/features/game-info/index.ts` | Gate: at the top of `handleAppView`, `if (getBucket(appid).bucket !== 'web-scraping') { if (enrichedAppIds.has(appid)) revertGameDetails(appid); return; }`. This runs **before** the `libraryCache` re-apply and the `processedApps` guard. Preload: `await waitForCollections()`; on timeout, skip the preload and log (views still enrich lazily). Enrich only appids that resolve to `web-scraping`. Subscribe `onBucketsChanged`: revert every `enrichedAppIds` member that no longer resolves to `web-scraping`, and enrich cached `libraryCache` members that now do. |
| `frontend/features/game-info/metadata.ts` | `enrichGameDetails` records originals the **first** time per appid: `appData.descriptionsData`, `appData.associationData`, `overview.rt_original_release_date`, `rt_steam_release_date`, `xbox_controller_support`. **NEW `revertGameDetails(appid)`**: restores them, purges the managed `STEAM_CATEGORIES` from `m_setStoreCategories` (guardrail 7), calls `clearAppCategories(appid)`, `enrichedAppIds.delete(appid)` and `AppDetailsChanged(appid)`, then `refreshGameInfoInstances()` (guardrail 11). It never touches `appData.details` (guardrail 8). |
| `frontend/features/game-info/game-info-patch.ts` | Add `export function clearAppCategories(appid)` (deletes from `appCategoriesCache`). Leave the prototype hooks as they are: they already defer to Steam when `enrichedAppIds` lacks the appid (O(1), guardrail 2), and keep `GetGameID` coupling (guardrail 1). |
| backend | **No change.** Buckets are frontend-only (ADR-0033). |

## 4. Steps

1. `resolve.ts` + `tests/buckets.test.ts` first (TDD; § 5).
2. `settings.ts` (port), then `collections.ts` using the P0 T1 accessors.
3. `buckets/index.ts`; wire `definePlugin` + `initSettings` in `index.tsx`.
4. `metadata.ts` originals + `revertGameDetails`; `clearAppCategories`.
5. Gate `features/game-info/index.ts` (view, preload, change subscription).
6. `settings-panel.tsx`.
7. `package.json` scripts: `"test:ts": "node --experimental-strip-types --test tests/*.test.ts"`,
   `"test:lua": "lua tests/test_backend.lua"`, `"test": "npm run test:ts && npm run test:lua"`.
8. Docs: `steam-cartridges/README.md` "Buckets" section (an upgrade note:
   games need a bucket to keep Game Info); CHANGELOGs.

## 5. Tests

**`tests/buckets.test.ts`** (Node, no Steam). Fixture of **two collections**:
`steam = {A, C}` assigned `steam-store`, `retro = {B, C}` assigned
`web-scraping`, `steam` listed first. `D` is in neither. `N = 435150` is native.

- A → steam-store/collection; B → web-scraping/collection; D → none/default; N → none/not-a-shortcut.
- C → steam-store (first in order) **with** `conflict` naming both. Swap the order → web-scraping.
- Override `{ C: 'none' }` → none/override; override beats collections for A.
- Deleted collection (`membersOf` → undefined) is skipped, and B falls to none.
- `validateConfig`: duplicate id (the first is kept), `default: 'web-scraping'` →
  forced `none`, bad bucket string dropped, non-numeric or native override key
  dropped, garbage input → `DEFAULT_BUCKETS`.
- Exclusivity: after `validateConfig` no id appears twice (property over random inputs).

**`tests/buckets.mjs`** (CDP, live; connect helper as in `enhanced-achievements/tests/cdp.mjs`;
plugin name resolved `-dev` first). Uses the P0 T6 fixtures:

1. `setSetting('buckets', { assignments: [steam, retro] })` →
   `bucketReport()` shows SC_RETRO_A as web-scraping, SC_STEAM_OWNED as steam-store,
   AM2R as none, SC_RETRO_BOTH as a conflict.
2. Open SC_RETRO_A Game Info: description + developer present (web enrichment ran).
   Open AM2R Game Info: the grey `#AppDetails_Shortcut_Explanation` is present (not enriched).
3. **Without restart**, move `retro` to Neither → SC_RETRO_A's next view is not
   enriched (`descriptionsData` restored, grey note back). Move it back → enriched again.
4. Restore the user's original `buckets` value at the end (read it first).

**Regression** (AGENTS.md Routines 1–3): `node scratch/test_nav_cycle.js`,
`node scratch/check_all_tabs.js <SC_RETRO_A>` with `retro` assigned (Game Info must
pass). Captures and activity on AM2R (bucket `none`) must still pass: buckets
gate sources, not captures. Lua `tests/test_backend.lua` unchanged and green.

## 6. Exit criteria

- [ ] With the two-collection fixture, each game gets exactly one bucket (unit + CDP step 1).
- [ ] Changing a collection's bucket reflects **without restart** (CDP step 3).
- [ ] IGDB `GetGameMetadata` is called only for web-scraping games (log check: no
      "Querying IGDB metadata" line for AM2R or SC_STEAM_* during the run).
- [ ] Conflicts and missing collections show in the panel. No settings path writes anything but `buckets`.
- [ ] Routines 1–3 PASS on desktop and Big Picture; `npm run check`, `build` and `test` are green.

## 7. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| #903: `pluginConfig` replies fail | Ported workaround; `tests/buckets.mjs` step 1 reads back through `bucketReport()` |
| Collections not loaded at startup; preload enriches nothing | `waitForCollections` + lazy per-view resolution; the preload is an optimisation only |
| Revert leaves stale badges | Originals recorded at first enrich; guardrail-7 purge; forceUpdate every window (guardrail 11) |
| Users lose Game Info on upgrade (everything `none`) | Panel count + README upgrade note; this is decision 1, not a bug |
| Settings panel UI crash | Millennium renders `content` inside an ErrorBoundary; the panel reads only the in-memory settings copy |

**Rollback:** revert the P2 commits. Nothing persistent changes except the
`buckets` config key, which a P1 build ignores.
