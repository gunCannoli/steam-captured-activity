import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAchievements } from '../frontend/app/achievements.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';

const SC = 4263274102 as any;
const SCHEMA = {
    native_appid: 77,
    total: 2,
    achievements: [
        { id: 'A', name: 'Alpha', description: 'da', icon: 'ia', global_pct: 10 },
        { id: 'B', name: 'Beta', description: 'db', icon: 'ib', global_pct: 20 },
    ],
};

function setup(over: { checkUnlocks?: (...a: any[]) => any; observer?: boolean; withSchema?: boolean; bucket?: string } = {}) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    if (over.withSchema !== false) records.update(SC, { achievements: { status: 'ok', data: { schema: SCHEMA, unlocks: {} } } });
    const calls = { ensure: 0, check: [] as any[], toast: 0, reset: [] as any[], unlock: [] as any[] };
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const emitted: any[] = [];
    bus.on('achievements.unlocked', (e) => emitted.push(e));
    bus.on('achievements.launch-toast', () => { calls.toast++; });
    const ach = createAchievements({
        backend: {
            async ensureFresh() {
                calls.ensure++;
                return { appid: SC, parts: { achievements: { status: 'ok', data: { schema: SCHEMA, unlocks: {} } } } };
            },
            async checkUnlocks(appid: number, native: number, title?: string) {
                calls.check.push({ appid, native, title });
                return over.checkUnlocks ? over.checkUnlocks() : { new_unlocks: [] };
            },
            async unlockAchievement(appid: number, id: string, time?: number) {
                calls.unlock.push({ appid, id, time });
                return { ok: true, unlocks: { A: { unlocked_time: 9 } } };
            },
            async resetAchievements(appid: number, opts: any) {
                calls.reset.push({ appid, ...opts });
                return { ok: true, sources: opts?.sources?.length ? [{ id: 'rpcs3', ok: true, cleared: 2 }] : {} };
            },
            async resetAchievementSources(appid: number, native: number) {
                calls.reset.push({ sourcesFor: appid, native });
                return { sources: [{ id: 'rpcs3', label: 'RPCS3 achievements', resettable: true, unlocked: 2 }] };
            },
            async steamStoreGetMapping() { return { mapping: { steam_appid: 77 } }; },
        } as any,
        records,
        bus,
        ensureBase: () => {},
        titleOf: () => 'Game',
        routeOf: () => ({ bucket: (over.bucket ?? 'web-scraping') as any, via: 'default' }),
        hardcore: () => true,
        observerEnabled: () => over.observer !== false,
        timers: {
            setTimeout: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
            clearTimeout: (h: any) => { h.cleared = true; },
        },
        now: () => 1000,
    });
    ach.install();
    return { ach, bus, records, calls, timers, emitted };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('poll result object is normalized to an array (K1)', async () => {
    const { ach, calls, emitted } = setup({ checkUnlocks: () => ({ new_unlocks: {} }) });
    assert.equal(await ach.checkNow(SC, { native: 77 }), 0);
    assert.equal(calls.check.length, 1);
    assert.equal(emitted.length, 0);
    const keyed = setup({ checkUnlocks: () => ({ new_unlocks: { 1: { id: 'A', rtime_unlocked: 5 } } }) });
    assert.equal(await keyed.ach.checkNow(SC, { native: 77 }), 1);
});

test('a launch shows no "Achievements Enabled" toast (removed, ADR-0066)', async () => {
    const { bus, calls } = setup();
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(calls.toast, 0);
});

test('unlock emits achievements.unlocked with the new ids and merges them into the record', async () => {
    const { ach, records, emitted } = setup({ checkUnlocks: () => ({ new_unlocks: [{ id: 'B', rtime_unlocked: 42 }] }) });
    assert.equal(await ach.checkNow(SC, { native: 77 }), 1);
    assert.deepEqual(emitted, [{ appid: SC, ids: ['B'], items: [{ id: 'B', name: 'Beta', description: 'db', icon: 'ib', global_pct: 20, unlockedAt: 42 }] }]);
    assert.deepEqual(records.get(SC)?.achievements?.data?.unlocks, { B: { unlocked_time: 42 } });
});

test('quit stops polling and runs one final check', async () => {
    const { bus, calls, timers } = setup();
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(timers.length, 1);
    assert.equal(timers[0]!.ms, 2000);
    const before = calls.check.length;
    bus.emit('shortcut.quit', { appid: SC });
    await tick();
    assert.equal(timers[0]!.cleared, true);
    assert.equal(calls.check.length, before + 1);
});

test('the poll re-arms only after its check settles: a busy backend never has two checks queued (ADR-0060)', async () => {
    let answer!: () => void;
    const { bus, calls, timers } = setup({ checkUnlocks: () => new Promise((r) => (answer = () => r({ new_unlocks: [] }))) });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(timers.length, 1);
    timers[0]!.fn(); // the first check starts and does not answer
    await tick();
    assert.equal(calls.check.length, 1);
    assert.equal(timers.length, 1, 'no second poll while the first is outstanding');
    answer();
    await tick();
    assert.equal(timers.length, 2, 'the next poll is armed once the check answered');
    assert.equal(timers[1]!.ms, 2000);
});

test('the observer kill switch keeps a launch from starting a session or a toast', async () => {
    const { bus, calls, timers } = setup({ observer: false });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(timers.length, 0);
    assert.equal(calls.toast, 0);
});

test('route none makes no achievements call', async () => {
    const { ach, calls } = setup();
    const part = await ach.ensure(SC, { bucket: 'none', via: 'default' });
    assert.equal(part.status, 'unsupported');
    assert.equal(calls.ensure, 0);
});

test('ensure asks the backend once while a call is in flight', async () => {
    const { ach, calls } = setup();
    const route = { bucket: 'web-scraping', via: 'default' } as const;
    await Promise.all([ach.ensure(SC, route), ach.ensure(SC, route)]);
    assert.equal(calls.ensure, 1);
});

test('trigger unlocks the next locked achievement and emits it; reset clears the unlocks', async () => {
    const { ach, records, emitted } = setup();
    assert.equal(await ach.trigger(SC), true);
    assert.deepEqual(emitted[0], { appid: SC, ids: ['A'], items: [{ id: 'A', name: 'Alpha', description: 'da', icon: 'ia', global_pct: 10, unlockedAt: 9 }] });
    assert.deepEqual(Object.keys(records.get(SC)?.achievements?.data?.unlocks ?? {}), ['A']);
    assert.deepEqual(await ach.reset(SC), { ok: true, sources: [] });
    assert.deepEqual(records.get(SC)?.achievements?.data?.unlocks, {});
});

test('reset sends the chosen sources, the native app and the title; resetSources lists them (ADR-0054)', async () => {
    const { ach, calls } = setup();
    assert.deepEqual((await ach.resetSources(SC)).map((s) => s.id), ['rpcs3']);
    assert.deepEqual(calls.reset[0], { sourcesFor: SC, native: 77 });
    assert.deepEqual(await ach.reset(SC, ['rpcs3']), { ok: true, sources: [{ id: 'rpcs3', ok: true, cleared: 2 }] });
    assert.deepEqual(calls.reset[1], { appid: SC, native: 77, sources: ['rpcs3'], title: 'Game' });
});

test('the native app comes from the record, else from the saved mapping', async () => {
    const { ach, calls } = setup();
    await ach.checkNow(SC);
    assert.equal(calls.check[0].native, 77);
});

test('summary counts the unlocked and total achievements of the record', async () => {
    const { ach } = setup();
    assert.deepEqual(ach.summary(SC), { nAchieved: 0, nTotal: 2 });
    await ach.trigger(SC);
    assert.deepEqual(ach.summary(SC), { nAchieved: 1, nTotal: 2 });
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
        observerEnabled: () => false,
        now: () => 1000,
    });
    return { ach, records, updated, calls };
}

test('preload: every stored ok part of a shortcut goes into its record, with no request and no library needed (ADR-0045)', async () => {
    const other = 4263274103;
    const unnamed = 4263274104;
    const { ach, records, updated, calls } = preloadSetup({
        [String(SC)]: { achievements: STORED, metadata: { status: 'ok', data: {} }, identity: { status: 'ok', data: { native: { appid: 77, source: 'owned' } } } },
        [String(other)]: { achievements: { status: 'error', message: 'x' } },
        [String(unnamed)]: { achievements: STORED },
        '440': { achievements: STORED },
    }, { [SC]: 'Game', [other]: 'Other' });
    assert.equal(await ach.preload(), 2);
    assert.deepEqual(records.get(SC)?.achievements, STORED);
    assert.equal(records.get(SC)?.metadata, undefined, 'metadata is app/metadata\'s preload');
    assert.equal(records.get(SC)?.identity, undefined, 'identity is never preloaded (knowledgebase Part 7)');
    assert.equal(records.get(other as any), undefined, 'a part that is not ok is left out');
    assert.deepEqual(records.get(unnamed as any)?.achievements, STORED, 'a shortcut Steam cannot name yet (start-up) is preloaded too');
    assert.equal(records.get(440 as any), undefined, 'a native appid is left out');
    assert.deepEqual(updated, [SC, unnamed]);
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

test('rerenderAll: emits record.updated(achievements) for every record with an ok part, and only those', async () => {
    const other = 4263274103;
    const { ach, records, updated } = preloadSetup({}, {});
    records.upsert({ appid: SC, gameid: 'g', title: 'A', exe: '' });
    records.upsert({ appid: other as any, gameid: 'g', title: 'B', exe: '' });
    records.update(SC, { achievements: STORED as any });
    records.update(other as any, { achievements: { status: 'error', message: 'x' } as any });
    updated.length = 0;
    assert.equal(ach.rerenderAll(), 1);
    assert.deepEqual(updated, [SC]);
});

// ---------- pushed games: synced by their extension, not observed (ADR-0067; ADR-0056 decision 4) ----------

/** A record an extension reported (an Epic copy); its backend answers a push with the stored part and the new ids. */
function storeSetup(pushAnswer: { part?: any; new?: string[]; error?: string } = {}) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    records.update(SC, { provided: { status: 'ok', source: 'epic', data: { source: 'epic', title: 'Game' } } as any });
    records.update(SC, { achievements: { status: 'ok', source: 'epic', data: { schema: SCHEMA, unlocks: { A: { unlocked_time: 5 } } } } });
    const contexts: any[] = [];
    const pushes: any[] = [];
    const synced: any[] = [];
    const unlocked: any[] = [];
    const timers: any[] = [];
    bus.on('achievements.synced', (e) => synced.push(e));
    bus.on('achievements.unlocked', (e) => unlocked.push(e));
    const ach = createAchievements({
        backend: {
            async ensureFresh(_a: number, _p: string[], ctx: any) {
                contexts.push(ctx);
                return { appid: SC, parts: {} };
            },
            async checkUnlocks() { throw new Error('a pushed game is never polled'); },
            async steamStoreGetMapping() { return { mapping: null }; },
            async provideAchievements(_a: number, set: any) {
                pushes.push(set);
                return pushAnswer;
            },
        } as any,
        records,
        bus,
        ensureBase: () => {},
        titleOf: () => 'Game',
        routeOf: () => ({ bucket: 'steam-store', via: 'default' }),
        hardcore: () => true,
        observerEnabled: () => true,
        timers: { setTimeout: (fn: () => void, ms: number) => { timers.push(ms); return 1; }, clearTimeout: () => {} },
        now: () => 1000,
    });
    ach.install();
    return { ach, bus, records, contexts, pushes, synced, unlocked, timers };
}

test('a pushed game gets no in-game polling (its extension notifies)', async () => {
    const s = storeSetup();
    s.bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.deepEqual(s.timers, []);
});

test('after a pushed game quits the core asks nothing: the extension pushes', async () => {
    const s = storeSetup();
    s.bus.emit('shortcut.quit', { appid: SC, name: 'Game' });
    await tick();
    await tick();
    assert.equal(s.contexts.length, 0);
    assert.equal(s.synced.length, 0);
});

test('a pushed set is stored and its new unlocks are announced as synced, never as a toast', async () => {
    const part = { status: 'ok', source: 'epic', data: { schema: SCHEMA, unlocks: { A: { unlocked_time: 5 }, B: { unlocked_time: 900 } } } };
    const s = storeSetup({ part, new: ['B'] });
    const res = await s.ach.ingestProvidedSet(SC, { source: 'epic', key: 'ns', title: 'Game', achievements: [{ id: 'A', name: 'Alpha', description: '', icon: '' }, { id: 'B', name: 'Beta', description: '', icon: '' }], unlocks: { A: 5, B: 900 } }, { providerId: 'steam-cartridges-third-party' });
    assert.deepEqual(res, { ok: true, new: ['B'] });
    assert.equal(s.pushes.length, 1);
    assert.equal(s.pushes[0].provider, 'steam-cartridges-third-party');
    assert.equal(s.pushes[0].key, 'ns');
    assert.equal(s.records.get(SC)?.achievements?.data?.unlocks.B?.unlocked_time, 900);
    assert.equal(s.synced.length, 1);
    assert.deepEqual(s.synced[0].items.map((i: any) => [i.id, i.name, i.unlockedAt]), [['B', 'Beta', 900]]);
    assert.equal(s.unlocked.length, 0, 'achievements.unlocked (which toasts) is never emitted for a push');
});

test('a push with nothing new announces nothing; a refused push changes nothing', async () => {
    const part = { status: 'ok', source: 'epic', data: { schema: SCHEMA, unlocks: { A: { unlocked_time: 5 } } } };
    const s = storeSetup({ part, new: [] });
    const set = { source: 'epic', key: 'ns', achievements: [{ id: 'A', name: 'Alpha', description: '', icon: '' }], unlocks: { A: 5 } };
    assert.deepEqual(await s.ach.ingestProvidedSet(SC, set, { providerId: 'x' }), { ok: true, new: [] });
    assert.equal(s.synced.length, 0);
    const bad = storeSetup({ error: 'no' });
    assert.deepEqual(await bad.ach.ingestProvidedSet(SC, set, { providerId: 'x' }), { ok: false, new: [] });
    assert.deepEqual(await bad.ach.ingestProvidedSet(SC, { ...set, achievements: [] }, { providerId: 'x' }), { ok: false, new: [] });
});

test('a pushed game is not resettable; any other shortcut is', () => {
    const s = storeSetup();
    assert.equal(s.ach.resettable(SC), false);
    const other = setup();
    assert.equal(other.ach.resettable(SC), true);
});

test('the paint (noNetwork) asks the disk only, in the view lane, and an answer without data leaves the record alone (ADR-0060)', async () => {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const held = { status: 'ok', data: { schema: SCHEMA, unlocks: {} } } as any;
    records.update(SC, { achievements: held });
    const seen: any[] = [];
    let answer: any = { status: 'pending', stale: true };
    const ach = createAchievements({
        backend: {
            async ensureFresh(_a: number, _p: string[], ctx: any, opts: any) {
                seen.push({ noNetwork: ctx.noNetwork, lane: opts?.lane });
                return { appid: SC, parts: { achievements: answer } };
            },
        } as any,
        records,
        bus,
        ensureBase: () => {},
        titleOf: () => 'Game',
        routeOf: () => ({ bucket: 'web-scraping', via: 'default' }),
        hardcore: () => true,
        observerEnabled: () => true,
        now: () => 1000,
    });
    const part = await ach.ensure(SC, { bucket: 'web-scraping', via: 'default' }, { noNetwork: true });
    assert.deepEqual(seen, [{ noNetwork: true, lane: 'view' }]);
    assert.equal(part.stale, true);
    assert.equal(records.get(SC)?.achievements, held, 'nothing stored: the record keeps its part');
    answer = { status: 'ok', data: { schema: SCHEMA, unlocks: { A: { unlocked_time: 3 } } }, stale: true };
    await ach.ensure(SC, { bucket: 'web-scraping', via: 'default' }, { noNetwork: true });
    assert.deepEqual(records.get(SC)?.achievements?.data?.unlocks, { A: { unlocked_time: 3 } }, 'stored data paints the record');
});

test('extension provider: never polled for unlocks, pushes them, and handles reset (ADR-0063)', async () => {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: 'game.exe' });

    let providerResetCalled = false;
    let unlockCalls = 0;
    let resetCtx: any;
    const mockProvider = {
        id: 'steam-cartridges-local',
        name: 'Local achievements (Example)',
        match: (ctx: any) => ctx.appid === SC,
        getUnlocks: async (): Promise<any[]> => {
            unlockCalls++;
            return [{ id: 'A', unlockedAt: 12345 }];
        },
        reset: async (ctx: any) => {
            providerResetCalled = true;
            resetCtx = ctx;
            return { ok: true, cleared: 1, backupPath: 'backup.bak' };
        },
    };

    const unlockedEvents: any[] = [];
    bus.on('achievements.unlocked', (e) => unlockedEvents.push(e));

    const ach = createAchievements({
        backend: {
            async ensureFresh() {
                return { appid: SC, parts: { achievements: { status: 'ok', data: { schema: SCHEMA, unlocks: {} } } } };
            },
            async checkUnlocks() {
                return { new_unlocks: [] };
            },
            async resetAchievements(_appid: number, _opts: any) {
                return { ok: true, sources: [] };
            },
            async resetAchievementSources() {
                return { sources: [] };
            },
            async unlockAchievement() {
                return { ok: true };
            },
            async steamStoreGetMapping() {
                return { mapping: { steam_appid: 77 } };
            },
        } as any,
        records,
        bus,
        ensureBase: () => {},
        titleOf: () => 'Game',
        routeOf: () => ({ bucket: 'web-scraping', via: 'default' }),
        hardcore: () => true,
        observerEnabled: () => true,
        providers: () => [mockProvider],
        shortcutData: () => ({ strAppName: 'Game', szExe: 'D:/game/game.exe' }),
        now: () => 1000,
    });

    // 1. ensure never asks the provider for unlocks (ADR-0063: extensions push)
    const part = await ach.ensure(SC, { bucket: 'web-scraping', via: 'default' });
    assert.equal(part.status, 'ok');
    assert.deepEqual(part.data?.unlocks, {});
    assert.equal(unlockCalls, 0);

    // 2. checkNow does not either; a pushed unlock is recorded and announced
    assert.equal(await ach.checkNow(SC), 0);
    assert.equal(unlockCalls, 0);
    await ach.ingestExternal(SC, [{ id: 'B', unlockedAt: 67890 }], { providerId: 'steam-cartridges-local' });
    assert.equal(unlockedEvents.length, 1);
    assert.deepEqual(unlockedEvents[0].ids, ['B']);
    assert.equal(records.get(SC)?.achievements?.data?.unlocks['B']?.unlocked_time, 67890);

    // 3. resetSources lists the extension under its own id and label
    const sources = await ach.resetSources(SC);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].id, 'steam-cartridges-local');
    assert.equal(sources[0].label, 'Local achievements (Example)');
    assert.equal(sources[0].unlocked, 1);

    // 4. reset triggers provider reset
    const res = await ach.reset(SC, ['steam-cartridges-local']);
    assert.equal(res.ok, true);
    assert.equal(providerResetCalled, true);
    assert.equal(resetCtx?.nativeAppid, 77, 'the provider is told the mapped app');
    assert.deepEqual(records.get(SC)?.achievements?.data?.unlocks, {});
});

test('ingestExternal: a reported unlock is persisted, recorded and announced (ADR-0063)', async () => {
    const { ach, records, emitted, calls } = setup();
    assert.deepEqual(await ach.ingestExternal(SC, [{ id: 'A', unlockedAt: 50 }], { providerId: 'x' }), { accepted: ['A'] });
    assert.deepEqual(calls.unlock, [{ appid: SC, id: 'A', time: 50 }]);
    assert.deepEqual(records.get(SC)?.achievements?.data?.unlocks, { A: { unlocked_time: 50 } });
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0].ids, ['A']);
});

test('ingestExternal silent: recorded and synced, never announced as an unlock (ADR-0063)', async () => {
    const { ach, bus, emitted } = setup();
    const synced: any[] = [];
    bus.on('achievements.synced', (e) => synced.push(e));
    await ach.ingestExternal(SC, [{ id: 'B', unlockedAt: 60 }], { providerId: 'x', silent: true });
    assert.equal(emitted.length, 0);
    assert.equal(synced.length, 1);
    assert.deepEqual(synced[0].items.map((i: any) => i.id), ['B']);
});

test('ingestExternal drops an id the schema lacks and one already unlocked', async () => {
    const { ach, records, calls } = setup();
    records.update(SC, { achievements: { status: 'ok', data: { schema: SCHEMA, unlocks: { A: { unlocked_time: 1 } } } } });
    assert.deepEqual(await ach.ingestExternal(SC, [{ id: 'A', unlockedAt: 5 }, { id: 'ZZZ', unlockedAt: 5 }], { providerId: 'x' }), { accepted: [] });
    assert.equal(calls.unlock.length, 0);
});

test('ingestExternal: an unknown time (0) is recorded as now', async () => {
    const { ach, calls } = setup();
    await ach.ingestExternal(SC, [{ id: 'Alpha', unlockedAt: 0 }], { providerId: 'x' });
    assert.deepEqual(calls.unlock, [{ appid: SC, id: 'A', time: 1 }]);
});

test('ingestExternal: two concurrent reports of one id persist it once', async () => {
    const { ach, calls } = setup();
    await Promise.all([
        ach.ingestExternal(SC, [{ id: 'B', unlockedAt: 7 }], { providerId: 'x' }),
        ach.ingestExternal(SC, [{ id: 'B', unlockedAt: 7 }], { providerId: 'y' }),
    ]);
    assert.equal(calls.unlock.length, 1);
});
