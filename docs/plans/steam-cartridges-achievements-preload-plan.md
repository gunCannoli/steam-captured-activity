# Plan: achievements in Steam's stores from start-up (option B)

**Status:** Ready to execute. Written and **dry-run 2026-09-30 on `c4f0978`**: the code steps 1–10 were applied with the
Edit tool to the working tree and every expected output of § 3 and steps 1–10 was observed (Lua 23 / 77+3, `test:ts`
204/204, enhanced 116/116, `tsc` clean, both builds `Succeeded`), then the tree was restored with `git checkout`. The
doc steps 11–12 were checked for their anchors only. Live verification (§ 10) is for the user or a verifier after deploy.
**Kind:** Feature plan for the weak implementer ([the plan writing standard](README.md)).
**Decision:** ADR-0045 (written by step 12 of this plan; its text is in § 7.12). The user chose option B on 2026-09-30.
**Layer rules:** [steam-cartridges.md § 4](../steam-cartridges.md#4-adding-a-feature), [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam),
[ADR-0044](../decisions.md#adr-0044-steam-cartridges-layers-stay-dumb-and-a-test-checks-what-each-layer-does),
[enhanced-achievements architecture](../enhanced-achievements/architecture.md).

## 1. What ships

Today `steam-cartridges` puts a non-Steam game's achievements into Steam's stores only when that game's page is opened.
After this plan it does it at start-up for every shortcut with stored achievements, the way Steam fills its
achievement progress cache for every owned game. Then any plugin can read a non-Steam game's achievement
progress from Steam's own store, `appAchievementProgressCache`, exactly as for a Steam game.

- `steam-cartridges` preloads every stored achievements part into its records at start-up (disk only, no request).
  The existing `achievements` surface renders them into Steam's stores, so Steam's progress cache holds every shortcut.
- The progress cache entry gets Steam's own shape (`appid`, `percentage`, `cache_time`, `vetted` are added).
- `enhanced-achievements` Reset Achievements lists **every** game from Steam's progress cache (one code path) and
  stops calling `storedAchievementSummaries()`, which is deleted. Resetting a non-Steam game still calls
  `steam-cartridges`' public `resetAchievements` (option C, Steam's `achievement_clear` for shortcuts, is **not** in
  this plan).

No new Steam target, no new RPC, no new setting, no new kill switch (the preload runs under the existing
`achievements` switch).

## 2. Root cause and evidence

| # | Finding | Evidence | Consequence for this plan |
| --- | --- | --- | --- |
| 1 | The achievements surface writes Steam's stores only from `render()`, which runs when the record's `achievements` part changes. That part is loaded only by the view pipeline (`EnsureFresh` on page open) and on `shortcut.quit`. | `steam-cartridges/frontend/surfaces/achievements/index.ts` `render`; `frontend/app/achievements.ts` `ensure` | Anything outside the page (a settings panel, another plugin) sees nothing for a shortcut whose page was not opened this session. |
| 2 | That is why `aef1dd2` added the export `storedAchievementSummaries()` for enhanced-achievements (a plugin-to-plugin read, and logic in `index.tsx`, which must only wire, ADR-0044). | `git show aef1dd2 -- steam-cartridges/frontend/index.tsx` | The export is deleted (step 8); enhanced-achievements reads Steam's cache instead (step 9). |
| 3 | Steam fills `appAchievementProgressCache` at start-up for every owned game from `userdata/<id>/config/librarycache/achievement_progress.json` (`Init` → `LoadCacheFile`). | Live, read-only (2026-09-30): `LoadCacheFile` source reads `${Library.AppDetails}/achievement_progress.json`; the file holds 32 entries, none a shortcut | Matching Steam's timing means filling this cache at start-up. |
| 4 | Steam's entry shape is `{ appid, unlocked, total, percentage, all_unlocked, cache_time, vetted }`. Ours is `{ unlocked, total, all_unlocked }`. | Live sample: `{"appid":435150,"unlocked":4,"total":97,"percentage":4.12…,"all_unlocked":false,"cache_time":1761528585,"vetted":true}`; `surfaces/achievements/core.ts` `buildAchievementProgress` | Step 4 adds the missing fields. |
| 5 | `GetAchievementProgress(appid)` returns `entry.percentage` and **queues a server request** (`QueueCacheUpdate` → `GetAchievementsProgress`) when the entry's `cache_time` is older than the game's `rt_last_time_played`. | Live source: `GetAchievementProgress(e){…t=r.percentage,o.tw.GetAppOverviewByAppID(e).rt_last_time_played<=r.cache_time)return t}return this.QueueCacheUpdate(e),t}` | Without `percentage` Steam reads `undefined`; without `cache_time` it asks the server about a shortcut. `cache_time` = now at render. |
| 6 | `SaveCacheFile` writes the **whole** map to Steam's file (`SteamClient.Apps.SaveAchievementProgressCache`) after every server refresh. | Live source of `RequestCacheUpdate` (ends `this.SaveCacheFile()`) and `SaveCacheFile` | Our shortcut entries will be persisted into Steam's file, like an owned game's. Accepted in ADR-0045 (§ 7.12); § 10 checks it. |
| 7 | `appDetailsStore.GetAppData(id)` **creates** an entry for an id it does not know. The surface calls it for the unsigned and the signed id. | Live source: `GetAppData(e){return this.m_mapAppData.has(e)\|\|this.m_mapAppData.set(e,new w),this.m_mapAppData.get(e)}`; `m_mapAppData` has 220 shortcut keys, 0 signed keys | At start-up that would add one junk entry (negative key) per preloaded shortcut. Step 5 reads `m_mapAppData.get(id)` instead (the write happens only where `details` exists, as today). |
| 8 | `GetAllRecords` adds achievements only for keys that already have metadata or a saved mapping. | `backend/record_rpc.lua` `GetAllRecords`; on disk: 136 stored shortcuts with a schema, 1 (`4034579314`) has neither | Step 3 also adds every shortcut the achievements store holds. |
| 9 | The sections surface schedules one `setTimeout(refreshInstances, 0)` per appid whose achievements changed. The preload changes ~130 in one render pass. | `surfaces/sections/index.ts` `render`; `app/render-queue.ts` flushes every pending appid in one pass | Step 6 coalesces them into one refresh per tick. |
| 10 | Preloading `identity` at start-up made `captures` start native activity fetches before Steam was ready. | [knowledgebase Part 7](../knowledgebase.md#part-7--steams-activity-store-for-unowned-native-apps-verified-live-2026-09-29-m5) | The preload writes the `achievements` part **only**. Surfaces reading `achievements`: `achievements`, `sections`, `toasts` (renders nothing). |
| 11 | Every shortcut `AppOverview.appid` is unsigned on this build (220/220). The surface still writes both keys (allowlist entry "Steam's achievement caches and AppDetailsStore key a shortcut by its unsigned and its signed id"). | Live probe 2026-09-30 | Both keys are kept (no behaviour removed, guardrail 14). |

Ruled out: writing Steam's `achievement_progress.json` ourselves (Steam owns and rewrites it); keeping a plugin-to-plugin
read API (every future plugin would need a second code path); routing reset through Steam's console (option C, later).

## 3. Preconditions

Run in Git Bash from `c:\game\millennium` unless a row says otherwise. Every row must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short` | prints nothing |
| P2 | `git merge-base --is-ancestor c4f0978 HEAD; echo $?` | `0` |
| P3 | `cd steam-cartridges && npm run check` | after `> tsc --noEmit` nothing; exit 0 |
| P4 | `cd steam-cartridges && npm run test:ts 2>&1 \| grep -E "^ℹ (pass\|fail)"` | `ℹ pass 202` and `ℹ fail 0` |
| P5 | the Lua block below | `test_ach_service: 21 PASS, last: ALL PASS` and `test_backend: 77 PASS, last: 3 FAILURE(S)` |
| P6 | `cd enhanced-achievements && npm run check` | after `> tsc --noEmit` nothing; exit 0 |
| P7 | `cd enhanced-achievements && npm test 2>&1 \| grep -E "^ℹ (pass\|fail)"` | `ℹ pass 116` and `ℹ fail 0` |

The 3 `test_backend` failures are the `captures` fixture counts (`non-steam games with media -> 7`, `screenshots
indexed -> 214`, `library_stats covers every media game -> 7`): they track the live library (AGENTS.md Routine 4) and
are not caused by this plan. They must stay exactly these three.

The Lua block (from `c:\game\millennium\steam-cartridges`):

```bash
export NSGA_STEAM_ROOT=C:/game/steam
for t in test_ach_service test_backend; do o=$(timeout 90 lua tests/$t.lua 2>&1); echo "$t: $(echo "$o" | grep -c '  PASS') PASS, last: $(echo "$o" | tail -1)"; done
```

If P1–P7 do not hold, stop (failure rule, § 8).

## 4. Do-not-touch list

- Every file not named in a step. In particular:
- `steam-cartridges/frontend/app/metadata.ts` (its own `preload()` stays as is; do not merge the two preloads).
- `steam-cartridges/frontend/kernel/**`, `frontend/sensors/**`, `frontend/safety/**`, `frontend/ports/**` (`getAllRecords` already exists).
- `steam-cartridges/frontend/surfaces/achievements/index.ts` (the surface's `touches` list does not change: no new Steam target).
- The hooks in `surfaces/achievements/store.ts` (`ensureAchievementsFullStoreHooked`, `ensureAchievementsStoreHooked`) and
  the other `refreshInstances()` call in `surfaces/sections/index.ts` (the `hasInfo` one).
- `steam-cartridges/tests/architecture*.json`, `enhanced-achievements/tests/architecture-allowlist.json` (must not change).
- `enhanced-achievements/frontend/surfaces/reset/reset.ts`, `frontend/kernel/reset.ts`, `frontend/settings/**`.
- Public exports of `steam-cartridges/frontend/index.tsx` other than `storedAchievementSummaries` (D8).
- `backend/achievements_store.lua` functions other than the one added.

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no CDP script, probe or
throwaway plugin; no edits to Millennium's `config.json` or any plugin config; no changes to the user's library,
collections, shortcuts, or files under `C:\game\steam`; no `npm install` or upgrade (ignore the `@steambrew/ttc` update
nag); no `git push --force`; no `--no-verify`; no `git add -A`; no `Co-Authored-By` or "Generated with" line in any
commit (AGENTS.md Routine 6); do not rewrite existing history.

**Line endings:** every file in steps 1–10 is LF, except `enhanced-achievements/tests/reset.mjs`, which is CRLF in the
working tree. Step 10 edits two **single** lines there; do not make multi-line edits to that file.

## 6. How to apply a step

Use the Edit tool: `old_string` = the **before** block, `new_string` = the **after** block, exactly as printed (the
blocks keep the file's indentation). Read the file first. If the before block is not found exactly once, the plan
is stale: stop (§ 8). Never edit around a mismatch.

## 7. Steps

### Step 1: `steam-cartridges/backend/achievements_store.lua`: list the stored shortcut keys

Before (end of file):

```lua
  return { ok = true, unlocks = {} }
end

return M
```

After:

```lua
  return { ok = true, unlocks = {} }
end

--- Every shortcut key (a string) the store holds an entry for, in no order. Disk only (ADR-0045).
function M.shortcut_keys()
  local keys = {}
  for key in pairs(load().shortcuts) do keys[#keys + 1] = key end
  return keys
end

return M
```

Check: nothing (checked with step 3).

### Step 2: `steam-cartridges/backend/ach_service.lua`: `stored_appids`

Before (end of file):

```lua
  return { status = "ok", data = { schema = st.schema, unlocks = st.unlocks or {} }, checkedAt = now_ms() }
end

return M
```

After:

```lua
  return { status = "ok", data = { schema = st.schema, unlocks = st.unlocks or {} }, checkedAt = now_ms() }
end

--- Every shortcut appid (a number) the store holds an entry for, with or without a schema. Disk only;
--- GetAllRecords uses it so a shortcut with no metadata and no mapping still gets its part (ADR-0045).
function M.stored_appids()
  local ids = {}
  for _, key in ipairs(store.shortcut_keys()) do
    local n = tonumber(key)
    if n then ids[#ids + 1] = n end
  end
  return ids
end

return M
```

Check: nothing (checked with step 3).

### Step 3: `steam-cartridges/backend/record_rpc.lua` `GetAllRecords` and its test

3a. `backend/record_rpc.lua`, inside `RPC.GetAllRecords`. Before:

```lua
  for key in pairs(records) do
    local achievements = ach().local_part(tonumber(key))
    if achievements then records[key].achievements = achievements end
  end
  return { records = records }
```

After:

```lua
  for key in pairs(records) do
    local achievements = ach().local_part(tonumber(key))
    if achievements then records[key].achievements = achievements end
  end
  -- A shortcut with stored achievements but no metadata and no mapping (ADR-0045: the frontend preloads
  -- every stored part into Steam's progress cache at start-up).
  for _, appid in ipairs(ach().stored_appids()) do
    local key = tostring(appid)
    if not records[key] then
      local achievements = ach().local_part(appid)
      if achievements then records[key] = { achievements = achievements } end
    end
  end
  return { records = records }
```

3b. `tests/test_ach_service.lua`, section `GetAllRecords`. Before (one line):

```lua
check("GetAllRecords adds stored achievements (disk only)", all.records[tostring(SC)] and all.records[tostring(SC)].achievements and all.records[tostring(SC)].achievements.data.schema.total == 2)
```

After:

```lua
check("GetAllRecords adds stored achievements (disk only)", all.records[tostring(SC)] and all.records[tostring(SC)].achievements and all.records[tostring(SC)].achievements.data.schema.total == 2)
local LONE, NOSCHEMA = 4000000077, 4000000078
store.save_schema(78, SCHEMA); store.bind_schema(LONE, 78)
store.bind_schema(NOSCHEMA, 999)
all = json.decode(record_rpc.GetAllRecords(json.encode({})))
local lone = all.records[tostring(LONE)]
check("GetAllRecords adds a shortcut with stored achievements and no metadata or mapping (ADR-0045)", lone and lone.achievements and lone.achievements.data.schema.total == 2 and lone.metadata == nil and lone.identity == nil)
check("GetAllRecords leaves out a stored shortcut with no schema", all.records[tostring(NOSCHEMA)] == nil)
```

Check: the Lua block (§ 3) → `test_ach_service: 23 PASS, last: ALL PASS` and `test_backend: 77 PASS, last: 3 FAILURE(S)`.

### Step 4: Steam's entry shape: `frontend/steam/achievement-types.ts`, `frontend/surfaces/achievements/core.ts`, `tests/achievements.test.ts`

4a. `frontend/steam/achievement-types.ts`. Before:

```ts
export interface AchievementProgress {
    unlocked: number;
    total: number;
    all_unlocked: boolean;
}
```

After:

```ts
/** One entry of Steam's `appAchievementProgressCache.m_achievementProgress.mapCache`, in Steam's own shape (ADR-0045). */
export interface AchievementProgress {
    appid: number;
    unlocked: number;
    total: number;
    /** 0-100: what Steam's GetAchievementProgress(appid) returns. */
    percentage: number;
    all_unlocked: boolean;
    /** Unix seconds. Steam asks its server again for an entry older than the game's rt_last_time_played. */
    cache_time: number;
    vetted: boolean;
}
```

4b. `frontend/surfaces/achievements/core.ts`. Before:

```ts
/**
 * Computes Big Picture progress cache payload.
 */
export function buildAchievementProgress(
    achievements: SteamAppAchievements | null,
): AchievementProgress | null {
    if (!achievements) return null;
    return {
        unlocked: achievements.nAchieved,
        total: achievements.nTotal,
        all_unlocked: achievements.nTotal > 0 && achievements.nAchieved === achievements.nTotal,
    };
}
```

After:

```ts
/**
 * An entry of Steam's achievement progress cache (the Big Picture play bar; what other plugins read for any
 * game), in the shape Steam writes for an owned game (ADR-0045).
 */
export function buildAchievementProgress(
    achievements: SteamAppAchievements | null,
    appid: number,
    nowSeconds: number,
): AchievementProgress | null {
    if (!achievements) return null;
    const unlocked = achievements.nAchieved;
    const total = achievements.nTotal;
    return {
        appid,
        unlocked,
        total,
        percentage: total > 0 ? (unlocked / total) * 100 : 0,
        all_unlocked: total > 0 && unlocked === total,
        cache_time: nowSeconds,
        vetted: true,
    };
}
```

4c. `tests/achievements.test.ts`. Before:

```ts
test('buildAchievementProgress: computes Big Picture completion payload', () => {
    assert.equal(buildAchievementProgress(null), null);

    const partial = buildSteamAchievements(mockSchema, { ACH_A: { unlocked_time: 100 } });
    assert.deepEqual(buildAchievementProgress(partial), {
        unlocked: 1,
        total: 3,
        all_unlocked: false,
    });

    const full = buildSteamAchievements(mockSchema, {
        ACH_A: { unlocked_time: 100 },
        ACH_B: { unlocked_time: 200 },
        ACH_C: { unlocked_time: 300 },
    });
    assert.deepEqual(buildAchievementProgress(full), {
        unlocked: 3,
        total: 3,
        all_unlocked: true,
    });
});
```

After:

```ts
test('buildAchievementProgress: an entry in the shape of Steam\'s progress cache (ADR-0045)', () => {
    assert.equal(buildAchievementProgress(null, 4000000000, 1700000000), null);

    const partial = buildSteamAchievements(mockSchema, { ACH_A: { unlocked_time: 100 } });
    assert.deepEqual(buildAchievementProgress(partial, 4000000000, 1700000000), {
        appid: 4000000000,
        unlocked: 1,
        total: 3,
        percentage: (1 / 3) * 100,
        all_unlocked: false,
        cache_time: 1700000000,
        vetted: true,
    });

    const full = buildSteamAchievements(mockSchema, {
        ACH_A: { unlocked_time: 100 },
        ACH_B: { unlocked_time: 200 },
        ACH_C: { unlocked_time: 300 },
    });
    assert.deepEqual(buildAchievementProgress(full, -294967296, 1700000001), {
        appid: -294967296,
        unlocked: 3,
        total: 3,
        percentage: 100,
        all_unlocked: true,
        cache_time: 1700000001,
        vetted: true,
    });
});
```

Check: none yet. `npm run check` fails here (the caller in `store.ts` still passes one argument) until step 5. That is
expected; do not fix it any other way.

### Step 5: `frontend/surfaces/achievements/store.ts` `setShortcutAchievements`: the new entry, and no entry creation

Before:

```ts
    // Synchronize Big Picture Mode play bar cache
    try {
        const progress = buildAchievementProgress(achievements);
        if (progress) {
            const cache = (window as any).appAchievementProgressCache?.m_achievementProgress?.mapCache;
            if (cache && typeof cache.set === "function") {
                cache.set(rawId, progress);
                cache.set(signedId, progress);
            }
        }
    } catch (e) {
        logger.warn("Could not update Big Picture achievement progress cache:", e);
    }

    // Synchronize appDetailsStore appData.details.achievements for MobX reactivity, only where Steam
    // created `details` itself: guardrail 8 (never create or overwrite appData.details; M10 fix).
    try {
        const store = (window as any).appDetailsStore;
        if (store?.GetAppData) {
            for (const id of [rawId, signedId, shortcutAppId]) {
                const appData = store.GetAppData(id);
                if (appData?.details) appData.details.achievements = achievements;
            }
        }
    } catch (e) {
```

After:

```ts
    // Steam's progress cache (Big Picture play bar; what other plugins read for any game), one entry in Steam's
    // own shape per key. cache_time = now: Steam's GetAchievementProgress asks its server again for an entry
    // older than the game's rt_last_time_played (ADR-0045).
    try {
        const cache = (window as any).appAchievementProgressCache?.m_achievementProgress?.mapCache;
        if (cache && typeof cache.set === "function") {
            const now = Math.floor(Date.now() / 1000);
            const unsignedEntry = buildAchievementProgress(achievements, rawId, now);
            const signedEntry = buildAchievementProgress(achievements, signedId, now);
            if (unsignedEntry && signedEntry) {
                cache.set(rawId, unsignedEntry);
                cache.set(signedId, signedEntry);
            }
        }
    } catch (e) {
        logger.warn("Could not update Big Picture achievement progress cache:", e);
    }

    // Synchronize appDetailsStore appData.details.achievements for MobX reactivity, only where Steam
    // created `details` itself: guardrail 8 (never create or overwrite appData.details; M10 fix).
    // m_mapAppData.get, not GetAppData: GetAppData creates an entry for an id it does not know (verified live
    // 2026-09-30), and the start-up preload renders every shortcut with stored achievements (ADR-0045).
    try {
        const appDataMap = (window as any).appDetailsStore?.m_mapAppData;
        if (appDataMap && typeof appDataMap.get === "function") {
            for (const id of [rawId, signedId, shortcutAppId]) {
                const appData = appDataMap.get(id);
                if (appData?.details) appData.details.achievements = achievements;
            }
        }
    } catch (e) {
```

Check (from `steam-cartridges`): `npm run check` → nothing after `> tsc --noEmit`, exit 0. `npm run test:ts 2>&1 | grep -E "^ℹ (pass|fail)"` → `ℹ pass 202`, `ℹ fail 0`.

### Step 6: `frontend/surfaces/sections/index.ts`: one refresh per tick

6a. Before (the end of `refreshInstances`):

```ts
            instances.delete(instance);
        }
    }
}
```

After:

```ts
            instances.delete(instance);
        }
    }
}

let refreshScheduled = false;

/** One refreshInstances on the next tick however many records changed before it: the start-up achievements
 *  preload renders every shortcut with stored achievements in one pass (ADR-0045). */
function scheduleRefresh(): void {
    if (refreshScheduled) return;
    refreshScheduled = true;
    setTimeout(() => {
        refreshScheduled = false;
        refreshInstances();
    }, 0);
}
```

If the 6a before block is found more than once, stop (§ 8).

6b. In `createSectionsSurface` → `render`. Before (one line):

```ts
                if (record?.achievements) setTimeout(refreshInstances, 0);
```

After:

```ts
                if (record?.achievements) scheduleRefresh();
```

Check: `npm run check` → exit 0. `npm run test:ts` → `ℹ pass 202`, `ℹ fail 0`.

### Step 7: `frontend/app/achievements.ts`: `preload()`, and its tests

7a. Before:

```ts
    backend: Pick<typeof Backend, "ensureFresh" | "checkUnlocks" | "unlockAchievement" | "resetAchievements" | "steamStoreGetMapping">;
```

After:

```ts
    backend: Pick<typeof Backend, "ensureFresh" | "checkUnlocks" | "unlockAchievement" | "resetAchievements" | "steamStoreGetMapping" | "getAllRecords">;
```

7b. Before:

```ts
    /** Unlocked and total count from the record, for the settings panel's audit. */
    summary(appid: number): { nAchieved: number; nTotal: number } | undefined;
}
```

After:

```ts
    /** Unlocked and total count from the record, for the settings panel's audit. */
    summary(appid: number): { nAchieved: number; nTotal: number } | undefined;
    /**
     * Start-up: every stored achievements part of a shortcut in the library into its record (disk only, no
     * request), so the achievements surface fills Steam's stores for every shortcut, as Steam does for an owned
     * game (ADR-0045). A part already in the record (a view that ran first) is kept. Resolves to how many it added.
     */
    preload(): Promise<number>;
}
```

7c. Before:

```ts
        summary(appid) {
            const id = toShortcutId(appid); // the panel hands Steam's appids, signed or not
```

After:

```ts
        async preload() {
            const res = await deps.backend.getAllRecords();
            let added = 0;
            for (const [key, parts] of Object.entries(res.records ?? {})) {
                const appid = toShortcutId(Number(key));
                const part = parts.achievements as Part<AchievementSet> | undefined;
                if (appid === undefined || part?.status !== "ok" || !part.data) continue;
                // A shortcut no longer in the library: nothing of Steam's should hold it.
                if (deps.titleOf(appid) === undefined) continue;
                if (current(appid)) continue;
                deps.ensureBase(appid);
                // Achievements only: preloading `identity` would make other surfaces fetch at start-up (knowledgebase Part 7).
                deps.records.update(appid, { achievements: part });
                added++;
            }
            logger.info(`Preloaded stored achievements for ${added} shortcut(s).`);
            return added;
        },
        summary(appid) {
            const id = toShortcutId(appid); // the panel hands Steam's appids, signed or not
```

7d. `tests/app-achievements.test.ts`. Before (the end of the file):

```ts
    assert.deepEqual(ach.summary(SC | 0), { nAchieved: 1, nTotal: 2 }, 'a signed appid finds the same record');
});
```

After:

```ts
    assert.deepEqual(ach.summary(SC | 0), { nAchieved: 1, nTotal: 2 }, 'a signed appid finds the same record');
});

const STORED = { status: 'ok', data: { schema: SCHEMA, unlocks: { A: { unlocked_time: 5 } } } };

function preloadSetup(stored: Record<string, any>, titles: Record<number, string>) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    const updated: number[] = [];
    bus.on('record.updated', (e) => updated.push(e.appid));
    const calls = { ensure: 0 };
    const ach = createAchievements({
        backend: {
            async ensureFresh() { calls.ensure++; return { appid: 0, parts: {} }; },
            async getAllRecords() { return { records: stored }; },
        } as any,
        records,
        bus,
        ensureBase: (appid) => { records.upsert({ appid, gameid: 'g', title: titles[appid] ?? '', exe: '' }); },
        titleOf: (appid) => titles[appid],
        routeOf: () => ({ bucket: 'web-scraping' as any, via: 'default' }),
        hardcore: () => false,
        launchPolicy: () => 'off',
        observerEnabled: () => false,
        now: () => 1000,
    });
    return { ach, records, updated, calls };
}

test('preload: every stored ok part of a shortcut in the library goes into its record, with no request (ADR-0045)', async () => {
    const other = 4263274103;
    const gone = 4263274104;
    const { ach, records, updated, calls } = preloadSetup({
        [String(SC)]: { achievements: STORED, metadata: { status: 'ok', data: {} }, identity: { status: 'ok', data: { native: { appid: 77, source: 'owned' } } } },
        [String(other)]: { achievements: { status: 'error', message: 'x' } },
        [String(gone)]: { achievements: STORED },
        '440': { achievements: STORED },
    }, { [SC]: 'Game', [other]: 'Other' });
    assert.equal(await ach.preload(), 1);
    assert.deepEqual(records.get(SC)?.achievements, STORED);
    assert.equal(records.get(SC)?.metadata, undefined, 'metadata is app/metadata\'s preload');
    assert.equal(records.get(SC)?.identity, undefined, 'identity is never preloaded (knowledgebase Part 7)');
    assert.equal(records.get(other as any), undefined, 'a part that is not ok is left out');
    assert.equal(records.get(gone as any), undefined, 'a shortcut no longer in the library is left out');
    assert.deepEqual(updated, [SC]);
    assert.equal(calls.ensure, 0);
    assert.deepEqual(ach.summary(SC), { nAchieved: 1, nTotal: 2 });
});

test('preload: a part the view already loaded this session is kept', async () => {
    const { ach, records } = preloadSetup({ [String(SC)]: { achievements: STORED } }, { [SC]: 'Game' });
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const viewed = { status: 'ok', data: { schema: SCHEMA, unlocks: {} } } as any;
    records.update(SC, { achievements: viewed });
    assert.equal(await ach.preload(), 0);
    assert.deepEqual(records.get(SC)?.achievements, viewed);
});
```

Check: `npm run check` → exit 0. `npm run test:ts 2>&1 | grep -E "^ℹ (pass|fail)"` → `ℹ pass 204`, `ℹ fail 0`.

### Step 8: `frontend/index.tsx`: call the preload at start-up; delete `storedAchievementSummaries`

8a. Before:

```ts
export const resetAchievements = (shortcutAppId: number) => achievements.reset(shortcutAppId as ShortcutId);

/**
 * Unlocked and total counts for every shortcut with stored achievements (disk only, one backend read), keyed by
 * appid: read by enhanced-achievements' Reset Achievements, which cannot import this plugin.
 */
export async function storedAchievementSummaries(): Promise<Record<string, { nAchieved: number; nTotal: number }>> {
    const out: Record<string, { nAchieved: number; nTotal: number }> = {};
    const res = await backend.getAllRecords();
    for (const [key, parts] of Object.entries(res.records ?? {})) {
        const set = (parts.achievements as { data?: { schema?: { total?: number }; unlocks?: Record<string, unknown> } } | undefined)?.data;
        const nAchieved = Object.keys(set?.unlocks ?? {}).length;
        if (nAchieved > 0) out[key] = { nAchieved, nTotal: set?.schema?.total ?? 0 };
    }
    return out;
}
```

After:

```ts
export const resetAchievements = (shortcutAppId: number) => achievements.reset(shortcutAppId as ShortcutId);
```

8b. In `init()`, section `===== Library grid =====`. Before:

```ts
    runner.register(createLibraryHomeSurface({ ...surfaceDeps, stats: libraryStats }));
    runner.installAll();
    await libraryHomeReady();
```

After:

```ts
    runner.register(createLibraryHomeSurface({ ...surfaceDeps, stats: libraryStats }));
    runner.installAll();
    await libraryHomeReady();

    // ===== Achievements in Steam's stores from start-up (ADR-0045) =====
    // After the library is ready (the preload skips shortcuts it cannot name). Disk only; not awaited.
    features.run("achievements", () => {
        void achievements.preload().catch((e) => {
            features.reportError("achievements", e);
            logger.error("Achievements preload failed; a game's page still loads them.", e);
        });
    });
```

Check (from `steam-cartridges`):
- `npm run check` → exit 0.
- `npm run test:ts 2>&1 | grep -E "^ℹ (pass|fail)"` → `ℹ pass 204`, `ℹ fail 0` (this includes the architecture tests).
- `grep -rn "storedAchievementSummaries" frontend tests` → prints nothing.
- `npm run build 2>&1 | grep -E "Succeeded|TS[0-9]+"` → `build Succeeded passing all tests in …` (a `TS5096` warning line is known and not caused by this plan).
- The Lua block (§ 3) → `test_ach_service: 23 PASS, last: ALL PASS`, `test_backend: 77 PASS, last: 3 FAILURE(S)`.

**Commit 1** (from `c:\game\millennium`):

```bash
git add steam-cartridges/backend/achievements_store.lua steam-cartridges/backend/ach_service.lua steam-cartridges/backend/record_rpc.lua steam-cartridges/tests/test_ach_service.lua steam-cartridges/frontend/steam/achievement-types.ts steam-cartridges/frontend/surfaces/achievements/core.ts steam-cartridges/frontend/surfaces/achievements/store.ts steam-cartridges/frontend/surfaces/sections/index.ts steam-cartridges/frontend/app/achievements.ts steam-cartridges/frontend/index.tsx steam-cartridges/tests/achievements.test.ts steam-cartridges/tests/app-achievements.test.ts
git commit -m "feat(steam-cartridges): preload stored achievements into Steam's stores at start-up (ADR-0045)"
```

Then `git status --short` shows only files under `enhanced-achievements/` or nothing.

### Step 9: `enhanced-achievements/frontend/surfaces/reset/index.ts`: read Steam's cache for every game

9a. Before:

```ts
interface Cartridges {
    resetAchievements(appid: number): Promise<boolean>;
    storedAchievementSummaries(): Promise<Record<string, { nAchieved: number; nTotal: number }>>;
}
```

After:

```ts
interface Cartridges {
    resetAchievements(appid: number): Promise<boolean>;
}
```

9b. Before (one line):

```ts
        if (typeof p?.resetAchievements === 'function' && typeof p.storedAchievementSummaries === 'function') return p as Cartridges;
```

After:

```ts
        if (typeof p?.resetAchievements === 'function') return p as Cartridges;
```

9c. Before:

```ts
        try {
            // Non-Steam games: steam-cartridges' stored unlocks, read from disk once per call.
            const stored = (await cartridges()?.storedAchievementSummaries().catch(() => undefined)) ?? {};
            return buildCandidates(libraryApps(), (app) => {
                if (!app.isShortcut) {
                    const p = progressFor(app.appid);
                    return typeof p?.unlocked === 'number' ? { unlocked: p.unlocked, total: Number(p.total) || 0 } : undefined;
                }
                const local = stored[String(app.appid >>> 0)];
                return local ? { unlocked: local.nAchieved, total: local.nTotal } : undefined;
            });
```

After:

```ts
        try {
            // Every game from Steam's own progress cache: steam-cartridges fills it for its shortcuts at start-up, as
            // Steam does for an owned game (ADR-0045). A shortcut is offered only when steam-cartridges can reset it.
            const shortcutsResettable = cartridges() !== null;
            return buildCandidates(libraryApps(), (app) => {
                if (app.isShortcut && !shortcutsResettable) return undefined;
                const p = progressFor(app.appid);
                return typeof p?.unlocked === 'number' ? { unlocked: p.unlocked, total: Number(p.total) || 0 } : undefined;
            });
```

Check: nothing yet (with step 10).

### Step 10: `enhanced-achievements/tests/reset.mjs` (CRLF file: two single-line edits)

The check keeps its expected result (non-Steam games are listed when steam-cartridges is loaded); only the way it
detects steam-cartridges changes, because the function it looked for is deleted (guardrail 15: not a weakened check).

10a. Before (one line):

```js
    // With steam-cartridges loaded, its stored unlocks list its games too (non-Steam games have the `shortcut` kind).
```

After:

```js
    // With steam-cartridges loaded, Steam's progress cache lists its games too (ADR-0045; non-Steam games have the `shortcut` kind).
```

10b. Before (the end of the next line; the Edit tool matches it inside the line):

```js
typeof window.PLUGIN_LIST[n].storedAchievementSummaries === 'function')");
```

After:

```js
typeof window.PLUGIN_LIST[n].resetAchievements === 'function')");
```

Check (from `enhanced-achievements`):
- `npm run check` → exit 0.
- `npm test 2>&1 | grep -E "^ℹ (pass|fail)"` → `ℹ pass 116`, `ℹ fail 0`.
- `grep -rn "storedAchievementSummaries" frontend tests` → prints nothing.
- `npm run build 2>&1 | grep -E "Succeeded|TS[0-9]+"` → `build Succeeded …` (the `TS5096` line is known).
- From `c:\game\millennium`: `git diff --stat -- enhanced-achievements/tests/reset.mjs` → `1 file changed, 2 insertions(+), 2 deletions(-)` (if it shows every line changed, the line endings were rewritten: stop, § 8).

**Commit 2:**

```bash
git add enhanced-achievements/frontend/surfaces/reset/index.ts enhanced-achievements/tests/reset.mjs
git commit -m "feat(enhanced-achievements): Reset Achievements lists every game from Steam's progress cache (ADR-0045)"
```

### Step 11: layer and reference docs

Insert each block exactly; "after line X" means as the next line(s) after the line that starts with X.

11a. `docs/steam-cartridges/service-achievements.md`, section `## Frontend (M6b)`: after the bullet that starts
``- `trigger` / `reset` / `checkNow` / `startSession` back the public API`` and its continuation line (the line that ends
`D8).`), insert:

```md
- `preload()` (ADR-0045): at start-up, after the library is ready, every stored `ok` part from `GetAllRecords` goes into
  the record of a shortcut still in the library, unless the record already has one. Only the `achievements` part (never
  `identity`, knowledgebase Part 7). The `achievements` surface then fills Steam's progress cache for every shortcut, so
  other plugins read a shortcut's progress from Steam as for an owned game. `GetAllRecords` also returns a shortcut that
  has stored achievements but no metadata and no mapping (`ach_service.stored_appids`).
```

11b. Same file, `## History`: after the line `## History` and its blank line, insert:

```md
- 2026-09-30 (ADR-0045): `preload()`; `GetAllRecords` covers every stored shortcut (`achievements_store.shortcut_keys`,
  `ach_service.stored_appids`); `storedAchievementSummaries()` deleted from the public API.
```

11c. `docs/steam-cartridges/surfaces.md`, section `## achievements`: after the line `**Record-driven in:** M6b (`achievements`).`, insert a blank line and:

```md
**ADR-0045 (2026-09-30):** the start-up preload renders every shortcut with stored achievements. The progress cache
entry has Steam's own shape (`appid`, `unlocked`, `total`, `percentage`, `all_unlocked`, `cache_time` = now, `vetted`),
written under the unsigned and the signed id; Steam persists it to its `achievement_progress.json` like an owned
game's. The `details.achievements` write reads `appDetailsStore.m_mapAppData.get(id)`, never `GetAppData(id)`, which
creates an entry for an unknown id. The `sections` surface coalesces its achievements refresh to one per tick.
```

11d. `docs/steam-cartridges/rpc.md`, the `GetAllRecords` row of the RPC table. Before (one line):

```md
| `GetAllRecords` | `record_rpc.lua` | live | M5a: disk-only bulk read (every DB record + every saved mapping); M5b's `app/metadata.ts` `preload()` calls it once at start-up, replacing the frontend's old `getAllMetadata`/`initGameInfo` preload |
```

After:

```md
| `GetAllRecords` | `record_rpc.lua` | live | M5a: disk-only bulk read (every DB record + every saved mapping + every shortcut with stored achievements, ADR-0045); `app/metadata.ts` `preload()` (M5b) and `app/achievements.ts` `preload()` (ADR-0045) each call it once at start-up |
```

11e. `docs/steam-components.md`: after the table row that starts `| **Your Stuff Media**` (the last row of
`## Map: core stores & modules`), insert a blank line and:

```md
### When Steam fills each achievement store for an owned game

A plugin that feeds a store for a shortcut fills it at the same moment Steam fills it for an owned game (ADR-0045).
Verified live 2026-09-30.

| Store | Filled for an owned game | steam-cartridges for a shortcut |
| --- | --- | --- |
| `appAchievementProgressCache` | At start-up, from `librarycache/achievement_progress.json` (`Init` → `LoadCacheFile`); refreshed from the server when an entry's `cache_time` is older than `rt_last_time_played`; the whole map is saved back (`SaveCacheFile`) after each refresh | At start-up (the preload), and on every record change |
| `AppDetailsStore.GetAchievements` | On request (`RequestAchievements`) | On request (the hook answers from the surface's map) |
| `AchievementsFullStore` | On request (`LoadMyAchievements`) | On request (the hooks answer from the surface's map) |
```

11f. `docs/knowledgebase.md`, `## Part 8`: after the bullet that starts `- **Noise:**` and its continuation line (ends
`not the plugin's.`), insert:

```md
- **`appAchievementProgressCache`** (verified live 2026-09-30): `Init` awaits `LoadCacheFile` (reads
  `librarycache/achievement_progress.json`, version 3, into `m_achievementProgress.mapCache`) and then registers for
  achievement notifications. An entry is `{ appid, unlocked, total, percentage, all_unlocked, cache_time, vetted }`.
  `GetAchievementProgress(appid)` returns `percentage` and calls `QueueCacheUpdate(appid)` (a server
  `GetAchievementsProgress` request 100 ms later) when the entry is missing or `cache_time` is older than the
  overview's `rt_last_time_played`. `BGameHasAchievements(appid)` is `entry.total > 0`, and **true** when there is no
  entry. `RequestCacheUpdate` ends with `SaveCacheFile`, which writes the whole map through
  `SteamClient.Apps.SaveAchievementProgressCache`.
- **`appDetailsStore.GetAppData(appid)` creates** an empty entry in `m_mapAppData` for an unknown id
  (`m_mapAppData.has(e) || m_mapAppData.set(e, new w)`). To look without creating, read `m_mapAppData.get(appid)`.
  Every shortcut already has an entry under its unsigned appid; signed keys: none.
```

Check: `git diff --stat -- docs` lists exactly these 5 files: `docs/knowledgebase.md`, `docs/steam-cartridges/rpc.md`,
`docs/steam-cartridges/service-achievements.md`, `docs/steam-cartridges/surfaces.md`, `docs/steam-components.md`.

### Step 12: ADR-0045, the enhanced-achievements doc, changelogs, TASK

12a. `docs/decisions.md`: append at the end of the file (after the last line of ADR-0044, one blank line first):

```md

## ADR-0045: steam-cartridges fills Steam's stores when Steam would; other plugins read Steam, not us

**Status:** Accepted · 2026-09-30 (the user chose option B: "consider steam-cartridges store data just as steam does it
so we dont just feed the fake data when the game is opened") · Implemented by
[the achievements preload plan](plans/steam-cartridges-achievements-preload-plan.md) ·
**Extends [ADR-0009](#adr-0009-prefer-patching-steams-data-over-patching-its-dom),
[ADR-0022](#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
[ADR-0039](#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)**

### Context

steam-cartridges fed a shortcut's achievements into Steam's stores only when its page opened. enhanced-achievements'
Reset Achievements, which reads Steam's `appAchievementProgressCache` for Steam games, saw no shortcut, so a
plugin-to-plugin read (`storedAchievementSummaries()`) was added. Every future plugin would need the same second path.
Steam fills that cache at start-up for every owned game, from its own file.

### Decision

1. steam-cartridges fills each Steam store for a shortcut **at the moment Steam fills it for an owned game**: eager
   stores at start-up (the achievement progress cache), lazy stores on request (their hooks answer at any time, with no
   page visit needed). The timing table is in steam-components.md, "When Steam fills each achievement store".
2. What it writes has **Steam's own shape** (the progress entry carries `appid`, `percentage`, `cache_time`, `vetted`).
3. **Other plugins read a shortcut's data from Steam's stores**, never from a steam-cartridges read API. A write Steam
   has no command for (resetting a shortcut's achievements) stays a steam-cartridges public API for now; routing it
   through Steam's own `achievement_clear` is a separate, later decision (option C).
4. The start-up preload writes only the parts whose surfaces are safe to apply at boot (`achievements`, `metadata`),
   never `identity` (knowledgebase Part 7).

### Consequences

- enhanced-achievements lists Steam and non-Steam games with one code path; `storedAchievementSummaries()` is deleted.
- Steam saves our progress entries into its own `achievement_progress.json` (`SaveCacheFile` writes the whole map), so
  they survive a restart like an owned game's, and outlive the plugin if it is removed (Steam then shows the last
  counts; harmless, the entries are only read for those shortcuts).
- Start-up renders one pass over every shortcut with stored achievements (~130 here); the sections refresh is
  coalesced to one per tick.
- A new store fed for shortcuts must say, in its layer doc, when Steam fills it for an owned game.
```

12b. `docs/enhanced-achievements/architecture.md`, `## History`: after the line `## History` and its blank line, insert:

```md
- 2026-09-30 ADR-0045: Reset Achievements lists every game, Steam's or not, from Steam's `appAchievementProgressCache`
  (steam-cartridges fills it for its shortcuts at start-up); a shortcut is offered only when steam-cartridges'
  `resetAchievements` is present. The call to `storedAchievementSummaries()` is gone.
```

12c. `CHANGELOG.md` (workspace): insert as the first entry (after the line `This repo is private and unversioned; entries are grouped by date.` and its blank line):

```md
- **steam-cartridges + enhanced-achievements: achievements in Steam's stores from start-up (ADR-0045, 2026-09-30)**: steam-cartridges preloads every stored achievements part at start-up (disk only) so Steam's progress cache holds every shortcut, in Steam's own entry shape; `GetAllRecords` covers every stored shortcut; the surface no longer creates `m_mapAppData` entries; the sections refresh is coalesced. enhanced-achievements' Reset Achievements reads Steam's cache for every game; `storedAchievementSummaries()` is deleted. `test:ts` 204/204, `test_ach_service` 23, enhanced `npm test` 116/116. Live verification pending ([plan § 10](docs/plans/steam-cartridges-achievements-preload-plan.md#10-live-verification)).

```

12d. `steam-cartridges/CHANGELOG.md`: after the line `## [Unreleased]` and its blank line, insert:

```md
- **Changed: a non-Steam game's achievement progress is in Steam from start-up (ADR-0045, 2026-09-30)**: Big Picture's play bar and other plugins see it without opening the game's page first. Removed the public `storedAchievementSummaries()` (enhanced-achievements no longer needs it).
```

12e. `enhanced-achievements/CHANGELOG.md`: after the line `## [Unreleased]` and its blank line, insert:

```md
### Changed

- Reset Achievements lists non-Steam games from Steam's own achievement progress, like Steam games (needs steam-cartridges with ADR-0045).

```

12f. `TASK.md`, section `## Now`: replace the paragraph that starts `**Achievements preload (ADR-0045): plan ready**`
(added by the architect) with:

```md
**Achievements preload (ADR-0045): code committed 2026-09-30, waiting for live verification.** Deploy both plugins, then
follow [the plan § 10](docs/plans/steam-cartridges-achievements-preload-plan.md#10-live-verification).
```

Check: `git status --short` lists exactly 11 files: these 6 (`CHANGELOG.md`, `TASK.md`, `docs/decisions.md`,
`docs/enhanced-achievements/architecture.md`, `enhanced-achievements/CHANGELOG.md`, `steam-cartridges/CHANGELOG.md`)
plus the 5 docs of step 11.

**Commit 3:**

```bash
git add CHANGELOG.md TASK.md docs/decisions.md docs/enhanced-achievements/architecture.md docs/knowledgebase.md docs/steam-components.md docs/steam-cartridges/rpc.md docs/steam-cartridges/service-achievements.md docs/steam-cartridges/surfaces.md enhanced-achievements/CHANGELOG.md steam-cartridges/CHANGELOG.md
git commit -m "docs: ADR-0045 achievements in Steam's stores from start-up; layer docs, changelogs"
git push origin main
```

`git status --short` then prints nothing, and `git log -3 --format=%B | grep -ci "co-authored\|generated with"` prints `0`.

## 8. Failure rule

Run a failing command at most twice. On the second failure, stop. Append the command, its output (trimmed to 30 lines)
and the step number to `TASK.md` § Active failures & blockers, then exit. Do not retry, edit around the failure,
skip ahead, or change a test to make it pass. A before block that does not match exactly once is a failure of that step.

## 9. Guardrail checklist ([plugins.md § 3](../plugins.md))

Re-read each and tick "not violated" with one line of proof.

- [ ] **1 Signed int32 trap:** the progress cache is still written under the unsigned and the signed id; our maps still key by `toUnsigned`.
- [ ] **2 O(1) hot paths:** no prototype hook or jsx handler changed (the store hooks in `store.ts` are untouched).
- [ ] **5 Shared maps:** nothing new is written into a shared Steam map; `m_mapAppData` is now only read (`get`), so no entry is created.
- [ ] **8 appData.details:** `details` is never created or replaced; `details.achievements` is set only where `details` exists (unchanged).
- [ ] **11 Re-render every window:** the sections refresh still runs after new achievements, once per tick.
- [ ] **13 MobX computed:** no Steam computed is read at start-up.
- [ ] **14 No gate removes behaviour:** the preload only adds; if it fails, a page still loads its achievements on view as before.
- [ ] **15 Checks not weakened:** `reset.mjs` keeps its expected result; only the detection of steam-cartridges changes.
- [ ] **17 A render never starts work:** the preload runs from `init()` after `libraryHomeReady()`, not from a render; surface writes run only when a record part changed; the refresh touches only patched section instances.

## 10. Live verification

For the user or a verifier, **not** the implementer. Deploy both plugins and restart Steam:

```powershell
cd c:\game\millennium\enhanced-achievements; powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart
cd c:\game\millennium\steam-cartridges; powershell -ExecutionPolicy Bypass -File dev.ps1
```

Wait about 30 s after the library appears. **Do not open any game page before L1–L3.** Run from `c:\game\millennium\steam-cartridges`.

| # | Command | PASS when |
| --- | --- | --- |
| L1 | `node tests/live/probes/eval_js.mjs "JSON.stringify((()=>{const m=appAchievementProgressCache.m_achievementProgress.mapCache;const s=[...m.entries()].filter(([k])=>k>=0x80000000);return {n:s.length,bad:s.filter(([k,v])=>!(v.appid===k&&typeof v.percentage==='number'&&v.cache_time>0&&v.vetted===true)).length}})())"` | `n` > 100 and `bad` = 0 (before the change `n` was 0 until a page opened) |
| L2 | `node tests/live/probes/eval_js.mjs "[...appDetailsStore.m_mapAppData.keys()].filter(k=>k<0).length"` | `0` |
| L3 | `node tests/live/probes/eval_js.mjs "(()=>{appAchievementProgressCache.GetAchievementProgress(2315502503);return appAchievementProgressCache.m_mapQueuedCacheMisses.has(2315502503)})()"` | `false` (no server request queued for a shortcut) |
| L4 | `node ../enhanced-achievements/tests/reset.mjs` | every line starts `PASS`, including `non-Steam games with unlocks are listed when steam-cartridges is loaded  (3 shortcuts)` (the number is the non-Steam games with at least one unlock) |
| L5 | `npm run test:live` | the same result as the baseline in [verification.md](../steam-cartridges/verification.md); `count_cycle` prints `PASS render loop` |
| L6 | `node tests/live/test_props.mjs 2315502503 --page` | `OK` |
| L7 | Routines 1 and 2 by hand (AGENTS.md), on a shortcut with unlocks (Jotunnslayer `2315502503`), desktop and Big Picture | all four views render; Big Picture's play bar shows `2 / 38` as soon as the page opens; A → B → A keeps everything |
| L8 | Settings → Enhanced Achievements → Reset Achievements dropdown | lists Steam games and the non-Steam games with unlocks, as before |

Informational, not PASS/FAIL: after opening any **Steam** game (which makes Steam refresh and save its cache),
`userdata/83513586/config/librarycache/achievement_progress.json` contains shortcut appids. That is expected (ADR-0045).

**Rollback:** `git revert` the three commits (newest first), redeploy both plugins with the commands above. The
shortcut entries Steam saved in its file stay until they are overwritten; they are only read for those shortcuts.
