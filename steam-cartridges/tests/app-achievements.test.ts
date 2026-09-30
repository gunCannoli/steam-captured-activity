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

function setup(over: { checkUnlocks?: (...a: any[]) => any; policy?: 'off' | 'first_run' | 'all_runs'; observer?: boolean; withSchema?: boolean; bucket?: string } = {}) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    if (over.withSchema !== false) records.update(SC, { achievements: { status: 'ok', data: { schema: SCHEMA, unlocks: {} } } });
    const calls = { ensure: 0, check: [] as any[], toast: 0 };
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
            async unlockAchievement() { return { ok: true, unlocks: { A: { unlocked_time: 9 } } }; },
            async resetAchievements() { return { ok: true, unlocks: {} }; },
            async steamStoreGetMapping() { return { mapping: { steam_appid: 77 } }; },
        } as any,
        records,
        bus,
        ensureBase: () => {},
        titleOf: () => 'Game',
        routeOf: () => ({ bucket: (over.bucket ?? 'web-scraping') as any, via: 'default' }),
        hardcore: () => true,
        launchPolicy: () => over.policy ?? 'all_runs',
        observerEnabled: () => over.observer !== false,
        timers: {
            setInterval: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
            clearInterval: (h: any) => { h.cleared = true; },
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

test('launch toast off', async () => {
    const { bus, calls } = setup({ policy: 'off' });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(calls.toast, 0);
});

test('launch toast first_run: once per game per session', async () => {
    const { bus, calls } = setup({ policy: 'first_run' });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(calls.toast, 1);
});

test('launch toast all_runs: every launch, only when the record has achievements', async () => {
    const { bus, calls } = setup({ policy: 'all_runs' });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(calls.toast, 2);
    const none = setup({ policy: 'all_runs', withSchema: false });
    none.bus.emit('shortcut.launched', { appid: SC, name: 'Game' });
    await tick();
    assert.equal(none.calls.toast, 0);
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
    assert.equal(await ach.reset(SC), true);
    assert.deepEqual(records.get(SC)?.achievements?.data?.unlocks, {});
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
        launchPolicy: () => 'off',
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
