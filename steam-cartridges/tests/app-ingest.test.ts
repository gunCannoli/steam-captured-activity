import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIngest } from '../frontend/app/ingest.ts';

interface Item { appid: number; name: string }
const A = { appid: 4000000001, name: 'Alpha' };
const B = { appid: 4000000002, name: 'Beta' };
const C = { appid: 4000000003, name: 'Gamma' };

function setup(over: {
    newOnes?: Item[];
    library?: Item[];
    routes?: Record<number, { bucket: string; via: string }>;
    respond?: (appid: number, parts: string[], ctx: any) => any;
    schedule?: (fn: () => void) => void;
    needsFetch?: (appid: number) => boolean;
    artwork?: { ensure: (appid: any, route: any, identity: any, opts: any) => Promise<any> };
} = {}) {
    const calls: { appid: number; parts: string[]; ctx: any }[] = [];
    const known: number[][] = [];
    const sleeps: number[] = [];
    const artCalls: any[] = [];
    let active = 0;
    let maxActive = 0;
    let newCalls = 0;
    const ingest = createIngest({
        backend: {
            async getNewShortcuts() { newCalls++; return { shortcuts: over.newOnes ?? [] }; },
            async markKnown(ids: number[]) { known.push(ids); return { ok: true }; },
            async ensureFresh(appid: number, parts: string[], ctx: any) {
                active++; maxActive = Math.max(maxActive, active);
                calls.push({ appid, parts, ctx });
                await new Promise((r) => setTimeout(r, 1));
                active--;
                return over.respond ? over.respond(appid, parts, ctx) : { appid, parts: {} };
            },
        } as any,
        shortcuts: () => over.library ?? [],
        ready: async () => {},
        routeOf: (appid: number) => (over.routes?.[appid] ?? { bucket: 'web-scraping', via: 'default' }) as any,
        isAllowed: () => true,
        owned: () => [],
        allowWeb: () => true,
        allowScreenscraper: () => true,
        hardcore: () => true,
        sleep: async (ms: number) => { sleeps.push(ms); },
        schedule: over.schedule ?? (() => {}),
        needsFetch: over.needsFetch ? (id) => over.needsFetch!(id as number) : undefined,
        artwork: over.artwork ?? {
            async ensure(appid, route, identity, opts) {
                artCalls.push({ appid, route, identity, opts });
                return { status: 'ok' };
            },
        },
    });
    return { ingest, calls, known, sleeps, artCalls, get maxActive() { return maxActive; }, get newCalls() { return newCalls; } };
}

test('startup ingests only new shortcuts', async () => {
    const s = setup({ newOnes: [A], library: [A, B, C] });
    await s.ingest.startSync();
    assert.equal(s.newCalls, 1);
    assert.deepEqual([...new Set(s.calls.map((c) => c.appid))], [A.appid]);
    assert.deepEqual(s.known, [[A.appid]]);
});

test('nothing new: no fetch, no progress run', async () => {
    const s = setup({ newOnes: [] });
    await s.ingest.startSync();
    assert.equal(s.calls.length, 0);
    assert.equal(s.ingest.getSyncProgress().isSyncing, false);
});

test('pacing is sequential, 300 ms apart', async () => {
    const s = setup({ newOnes: [A, B, C] });
    await s.ingest.startSync();
    assert.equal(s.maxActive, 1);
    assert.deepEqual([...new Set(s.calls.map((c) => c.appid))], [A.appid, B.appid, C.appid]);
    assert.deepEqual(s.sleeps, [300, 300, 300]);
});

test('a paused result stops the run and leaves that shortcut unknown', async () => {
    const s = setup({
        newOnes: [A, B, C],
        respond: (appid) => (appid === B.appid ? { appid, parts: {}, paused: { igdb: 123 } } : { appid, parts: {} }),
    });
    await s.ingest.startSync();
    const fetched = [...new Set(s.calls.map((c) => c.appid))];
    assert.deepEqual(fetched, [A.appid, B.appid]);
    assert.deepEqual(s.known, [[A.appid]], 'B was not finished, C never started');
    assert.equal(s.ingest.getSyncProgress().isSyncing, false);
});

test('a paused source the ingest does not use (sgdb) does not stop it', async () => {
    const s = setup({ newOnes: [A, B], respond: (appid) => ({ appid, parts: {}, paused: { sgdb: 1 } }) });
    await s.ingest.startSync();
    assert.deepEqual([...new Set(s.calls.map((c) => c.appid))], [A.appid, B.appid]);
});

test('force sets ctx.force and walks the whole library, not the registry', async () => {
    const s = setup({ newOnes: [C], library: [A, B] });
    await s.ingest.startSync({ forceAll: true });
    assert.equal(s.newCalls, 0);
    assert.deepEqual([...new Set(s.calls.map((c) => c.appid))], [A.appid, B.appid]);
    assert.ok(s.calls.every((c) => c.ctx.force === true));
    const plain = setup({ newOnes: [A] });
    await plain.ingest.startSync();
    assert.ok(plain.calls.every((c) => c.ctx.force === false));
});

test('onlyAppids limits a run to those shortcuts', async () => {
    const s = setup({ library: [A, B, C] });
    await s.ingest.startSync({ onlyAppids: [B.appid] });
    assert.deepEqual([...new Set(s.calls.map((c) => c.appid))], [B.appid]);
});

test('routes decide the parts: none fetches nothing, web-scraping asks metadata and achievements', async () => {
    const s = setup({
        newOnes: [A, B],
        routes: { [A.appid]: { bucket: 'none', via: 'default' }, [B.appid]: { bucket: 'web-scraping', via: 'default' } },
    });
    await s.ingest.startSync();
    assert.deepEqual(s.calls.map((c) => c.appid), [B.appid, B.appid]);
    assert.deepEqual(s.calls.map((c) => c.parts), [['metadata'], ['achievements']], 'one part per call (ADR-0060)');
    assert.deepEqual(s.known, [[A.appid], [B.appid]], 'a route-none shortcut is still marked known');
});

test('steam-store: identity first; a native match skips metadata', async () => {
    const s = setup({
        newOnes: [A],
        routes: { [A.appid]: { bucket: 'steam-store', via: 'default' } },
        respond: (appid, parts) => (parts[0] === 'identity' ? { appid, parts: { identity: { status: 'ok', data: { native: { appid: 77, source: 'search' } } } } } : { appid, parts: {} }),
    });
    await s.ingest.startSync();
    assert.deepEqual(s.calls.map((c) => c.parts), [['identity'], ['achievements']]);
    assert.equal(s.calls[1]!.ctx.identity.data.native.appid, 77);
});

test('steam-store without a native match asks metadata (the IGDB / ScreenScraper fallback)', async () => {
    const s = setup({
        newOnes: [A],
        routes: { [A.appid]: { bucket: 'steam-store', via: 'default' } },
        respond: (appid, parts) => (parts[0] === 'identity' ? { appid, parts: { identity: { status: 'ok', data: {} } } } : { appid, parts: {} }),
    });
    await s.ingest.startSync();
    assert.deepEqual(s.calls.map((c) => c.parts), [['identity'], ['metadata'], ['achievements']]);
});

test('progress events keep the SyncProgress shape', async () => {
    const s = setup({ newOnes: [A, B] });
    const seen: any[] = [];
    s.ingest.onSyncProgress((p) => seen.push({ ...p }));
    await s.ingest.startSync();
    for (const p of seen) assert.deepEqual(Object.keys(p).sort(), ['currentGame', 'current', 'isSyncing', 'phase', 'total'].sort());
    assert.equal(seen[0].phase, 'scraping');
    assert.equal(seen[0].total, 2);
    assert.equal(seen.at(-1).phase, 'complete');
    assert.equal(seen.at(-1).isSyncing, false);
    assert.equal(seen.some((p) => p.currentGame === 'Beta'), true);
});

test('a second startSync while one runs is queued, not run in parallel', async () => {
    const s = setup({ newOnes: [A, B] });
    const first = s.ingest.startSync();
    await s.ingest.startSync();
    await first;
    assert.equal(s.maxActive, 1);
});

test('a per-game scan requested during a run keeps its scope and resolves after it ran', async () => {
    const later: (() => void)[] = [];
    const s = setup({ newOnes: [A, B], library: [A, B], schedule: (fn) => { later.push(fn); } });
    const first = s.ingest.startSync();
    let done = false;
    const scan = s.ingest.startSync({ forceAll: true, onlyAppids: [B.appid] }).then(() => void (done = true));
    await first;
    assert.equal(done, false);
    later.shift()!();
    await scan;
    assert.equal(done, true);
});

test('startup ingests existing shortcuts needing fetch when nothing is new', async () => {
    const s = setup({ newOnes: [], library: [A, B, C], needsFetch: (id) => id === B.appid });
    await s.ingest.startSync();
    assert.deepEqual([...new Set(s.calls.map((c) => c.appid))], [B.appid]);
    assert.deepEqual(s.known, [[B.appid]]);
});

test('startup ingests artwork and icons when artwork resolver is provided', async () => {
    const s = setup({ newOnes: [A], library: [A] });
    await s.ingest.startSync();
    assert.equal(s.artCalls.length, 1);
    assert.equal(s.artCalls[0].appid, A.appid);
    assert.deepEqual(s.artCalls[0].opts, { lane: 'background' });
});
