import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, createArtwork } from '../frontend/app/artwork.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';

const URLS = { portrait: 'p', hero: 'h', logo: 'l', wide: 'w' };
const SC = 4263274102 as any;

function setup(over: Partial<Record<string, any>> = {}) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const calls: any[] = [];
    let clock = 1000;
    const art = createArtwork({
        backend: {
            async ensureFresh(appid: number, parts: any, ctx: any) {
                calls.push({ appid, parts, ctx });
                return over.response ?? { appid, parts: { artwork: { status: 'ok', data: { urls: URLS, source: 'steamgriddb', emptySlots: [0, 1, 2, 3] } } } };
            },
        } as any,
        records,
        ensureBase: () => records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' }),
        titleOf: () => 'Game',
        storeItemFor: async () => null,
        fetchImage: async () => over.image === undefined ? { base64: 'QUJD', ext: 'jpg' } : over.image,
        allowSgdb: () => true,
        now: () => clock,
    });
    return { art, records, calls, tick: (ms: number) => (clock += ms) };
}

test('steamgriddb plan: only empty slots with a url, our earlier slots kept', () => {
    const plan = buildPlan({ urls: { portrait: 'p', hero: 'h' }, source: 'steamgriddb', emptySlots: [1, 2, 3], applied: { source: 'steamgriddb', slots: [0], tried: [0] } }, 5);
    assert.deepEqual(plan.write, [1]);
    assert.deepEqual(plan.urls, { hero: 'h' });
    assert.deepEqual(plan.kept, [0]);
    assert.deepEqual(plan.tried, [0, 1]);
    assert.deepEqual(plan.clear, []);
});

test('steam-cdn plan: a different native app clears ours and writes all four', () => {
    const plan = buildPlan({ urls: URLS, source: 'steam-cdn', steamAppid: 2, applied: { steam_appid: 1, slots: [0, 2] } }, 5);
    assert.deepEqual(plan.clear, [0, 2]);
    assert.deepEqual(plan.write, [0, 1, 2, 3]);
    assert.deepEqual(plan.kept, []);
});

test('icon: an eligible icon url rides on either plan; not eligible means no icon', () => {
    const cdn = buildPlan({ urls: { ...URLS, icon: 'i' }, source: 'steam-cdn', steamAppid: 2, iconEligible: true }, 5);
    assert.deepEqual(cdn.icon, { url: 'i' });
    assert.equal(cdn.urls.icon, undefined);
    const sgdb = buildPlan({ urls: { icon: 'i' }, source: 'steamgriddb', emptySlots: {}, iconEligible: true }, 5);
    assert.deepEqual(sgdb.icon, { url: 'i' });
    assert.deepEqual(sgdb.write, []);
    const no = buildPlan({ urls: { ...URLS, icon: 'i' }, source: 'steam-cdn', steamAppid: 2, iconEligible: false }, 5);
    assert.equal('icon' in no, false);
});

test('icon: clearSlots with only a restore still writes a plan; without either it does nothing', () => {
    const { art, records } = setup();
    art.clearSlots(SC, [], '');
    assert.deepEqual(records.get(SC)?.artwork?.data?.icon, { restore: '' });
    assert.deepEqual(records.get(SC)?.artwork?.data?.clear, []);
    art.clearSlots(SC, [1], 'D:\Game\game.exe');
    assert.deepEqual(records.get(SC)?.artwork?.data?.icon, { restore: 'D:\Game\game.exe' });
    const before = records.get(SC)?.artwork;
    art.clearSlots(SC, []);
    assert.equal(records.get(SC)?.artwork, before);
});

test('route none: unsupported without a backend call', async () => {
    const { art, calls, records } = setup();
    const part = await art.ensure(SC, { bucket: 'none', via: 'default' }, undefined);
    assert.equal(part.status, 'unsupported');
    assert.equal(calls.length, 0);
    assert.equal(records.get(SC)?.artwork?.status, 'unsupported');
});

test('steam-store with identity pending waits, no backend call, not memoised', async () => {
    const { art, calls } = setup();
    const route = { bucket: 'steam-store', via: 'default' } as const;
    assert.equal((await art.ensure(SC, route, { status: 'pending' })).status, 'pending');
    assert.equal(calls.length, 0);
});

test('one backend call per shortcut per session; the plan lands in the record', async () => {
    const { art, calls, records } = setup();
    const route = { bucket: 'web-scraping', via: 'default' } as const;
    await art.ensure(SC, route, { status: 'ok', data: {} });
    await art.ensure(SC, route, { status: 'ok', data: {} });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].parts, ['artwork']);
    assert.equal(calls[0].ctx.allowSgdb, true);
    assert.deepEqual(records.get(SC)?.artwork?.data?.write, [0, 1, 2, 3]);
    art.invalidate(SC);
    await art.ensure(SC, route, { status: 'ok', data: {} });
    assert.equal(calls.length, 2);
});

test('needs-setup is not memoised (the key may be entered later)', async () => {
    const { art, calls } = setup({ response: { appid: SC, parts: { artwork: { status: 'needs-setup' } } } });
    const route = { bucket: 'web-scraping', via: 'default' } as const;
    await art.ensure(SC, route, { status: 'ok', data: {} });
    await art.ensure(SC, route, { status: 'ok', data: {} });
    assert.equal(calls.length, 2);
});

test('an error is retried only after 5 minutes', async () => {
    const { art, calls, tick } = setup({ response: { appid: SC, parts: {}, error: 'boom' } });
    const route = { bucket: 'web-scraping', via: 'default' } as const;
    await art.ensure(SC, route, { status: 'ok', data: {} });
    tick(60_000);
    await art.ensure(SC, route, { status: 'ok', data: {} });
    assert.equal(calls.length, 1);
    tick(5 * 60_000);
    await art.ensure(SC, route, { status: 'ok', data: {} });
    assert.equal(calls.length, 2);
});

test('clearSlots writes a clear-only plan, and a repeated clear re-renders', () => {
    const { art, records, tick } = setup();
    let changed = 0;
    const update = records.update.bind(records);
    records.update = (a, p) => { const c = update(a, p); changed += c.length; return c; };
    art.clearSlots(SC, [0, 2]);
    tick(1);
    art.clearSlots(SC, [0, 2]);
    assert.equal(changed, 2);
    assert.deepEqual(records.get(SC)?.artwork?.data?.clear, [0, 2]);
    art.clearSlots(SC, []);
    assert.equal(changed, 2);
});

test('icon: app fetches the icon bytes into the plan; a failed fetch drops the icon, slots stay', async () => {
    const ok = { appid: SC, parts: { artwork: { status: 'ok', data: { urls: { ...URLS, icon: 'i' }, source: 'steamgriddb', emptySlots: [0], iconEligible: true } } } };
    const a = setup({ response: ok });
    const part: any = await a.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.deepEqual(part.data.icon, { url: 'i', base64: 'QUJD' });
    const b = setup({ response: ok, image: null });
    const bad: any = await b.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.equal('icon' in bad.data, false);
    assert.deepEqual(bad.data.write, [0]);
});