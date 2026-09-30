import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArtwork } from '../frontend/app/artwork.ts';
import { buildPlan } from '../frontend/domain/art-plan.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createImageBin } from '../frontend/kernel/image-bin.ts';

const URLS = { portrait: 'p', hero: 'h', logo: 'l', wide: 'w' };
const SC = 4263274102 as any;

function setup(over: Partial<Record<string, any>> = {}) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const calls: any[] = [];
    const saved: any[] = [];
    const recorded: any[] = [];
    const icons: any[] = [];
    const fetched: [string, boolean | undefined][] = [];
    const images = createImageBin();
    let clock = 1000;
    const art = createArtwork({
        backend: {
            async ensureFresh(appid: number, parts: any, ctx: any) {
                calls.push({ appid, parts, ctx });
                return over.response ?? { appid, parts: { artwork: { status: 'ok', data: { urls: URLS, source: 'steamgriddb', emptySlots: [0, 1, 2, 3] } } } };
            },
            async steamStoreSaveIcon(...args: any[]) {
                saved.push(args);
                return over.saveIcon ?? { path: 'C:/icons/1.jpg', previous: 'game.exe' };
            },
            async steamStoreRecordArtwork(...args: any[]) {
                recorded.push(args);
                return over.recordArtwork ?? { ok: true };
            },
            async steamStoreRecordIcon(...args: any[]) {
                icons.push(args);
                return over.recordIcon ?? { ok: true };
            },
        } as any,
        records,
        bus,
        images,
        ensureBase: () => records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' }),
        titleOf: () => 'Game',
        storeItemFor: async () => null,
        fetchImage: async (url: string, forcePng?: boolean) => {
            fetched.push([url, forcePng]);
            if (over.failUrl === url) return null;
            return over.image === undefined ? { base64: 'QUJD', ext: forcePng ? 'png' : 'jpg' } : over.image;
        },
        allowSgdb: () => true,
        now: () => clock,
    });
    art.install();
    return { art, bus, records, images, calls, saved, recorded, icons, fetched, tick: (ms: number) => (clock += ms) };
}

test('steamgriddb plan: only empty slots with a url, our earlier slots kept', () => {
    const { plan } = buildPlan({ urls: { portrait: 'p', hero: 'h' }, source: 'steamgriddb', emptySlots: [1, 2, 3], applied: { source: 'steamgriddb', slots: [0], tried: [0] } }, 5);
    assert.deepEqual(plan.write, [1]);
    assert.deepEqual(plan.urls, { hero: 'h' });
    assert.deepEqual(plan.kept, [0]);
    assert.deepEqual(plan.tried, [0, 1]);
    assert.deepEqual(plan.clear, []);
});

test('steam-cdn plan: a different native app clears ours and writes all four', () => {
    const { plan } = buildPlan({ urls: URLS, source: 'steam-cdn', steamAppid: 2, applied: { steam_appid: 1, slots: [0, 2] } }, 5);
    assert.deepEqual(plan.clear, [0, 2]);
    assert.deepEqual(plan.write, [0, 1, 2, 3]);
    assert.deepEqual(plan.kept, []);
});

test('icon: an eligible icon url comes with either plan; not eligible means no icon', () => {
    const cdn = buildPlan({ urls: { ...URLS, icon: 'i' }, source: 'steam-cdn', steamAppid: 2, iconEligible: true }, 5);
    assert.equal(cdn.iconUrl, 'i');
    assert.equal(cdn.plan.urls.icon, undefined);
    const sgdb = buildPlan({ urls: { icon: 'i' }, source: 'steamgriddb', emptySlots: {}, iconEligible: true }, 5);
    assert.equal(sgdb.iconUrl, 'i');
    assert.deepEqual(sgdb.plan.write, []);
    const no = buildPlan({ urls: { ...URLS, icon: 'i' }, source: 'steam-cdn', steamAppid: 2, iconEligible: false }, 5);
    assert.equal(no.iconUrl, undefined);
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

test('an error is not memoised: the next view asks the backend, whose error TTL decides (M10)', async () => {
    const { art, calls } = setup({ response: { appid: SC, parts: {}, error: 'boom' } });
    const route = { bucket: 'web-scraping', via: 'default' } as const;
    await art.ensure(SC, route, { status: 'ok', data: {} });
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

test('icon: app stores the icon file and the plan carries its path; a failed fetch or a refusal drops the icon, slots stay', async () => {
    const ok = { appid: SC, parts: { artwork: { status: 'ok', data: { urls: { ...URLS, icon: 'i' }, source: 'steamgriddb', emptySlots: [0], iconEligible: true } } } };
    const a = setup({ response: ok });
    const part: any = await a.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.deepEqual(part.data.icon, { path: 'C:/icons/1.jpg', previous: 'game.exe' });
    assert.deepEqual(a.saved, [[SC, 'i', 'steamgriddb', undefined, 'QUJD']]);
    const b = setup({ response: ok, failUrl: 'i' });
    const bad: any = await b.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.equal('icon' in bad.data, false);
    assert.deepEqual(bad.data.write, [0]);
    assert.equal(b.saved.length, 0);
    const c = setup({ response: ok, saveIcon: { error: 'not eligible' } });
    const refused: any = await c.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.equal('icon' in refused.data, false);
});

test('the slot bytes wait in the image bin before the plan reaches the record; the logo is fetched as png', async () => {
    const a = setup();
    await a.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.deepEqual(Object.keys(a.images.get(SC)).sort(), ['hero', 'logo', 'portrait', 'wide']);
    assert.deepEqual(a.images.get(SC).logo, { base64: 'QUJD', ext: 'png' });
    assert.deepEqual(a.fetched.filter(([, png]) => png), [['l', true]]);
});

test('a slot whose fetch fails is left out of the bin but stays in the plan (the surface reports it failed)', async () => {
    const a = setup({ failUrl: 'h' });
    const part: any = await a.art.ensure(SC, { bucket: 'web-scraping', via: 'x' } as any, undefined);
    assert.equal(a.images.get(SC).hero, undefined);
    assert.deepEqual(part.data.write, [0, 1, 2, 3]);
});

test('artwork.applied is recorded through the port (SteamGridDB: written; failed = attempted - written)', async () => {
    const a = setup();
    a.bus.emit('artwork.applied', { appid: SC, source: 'steamgriddb', attempted: [0, 1], kept: [3], tried: [0, 1], written: [0] });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(a.recorded, [[SC, undefined, [0], [1], { source: 'steamgriddb', tried: [0, 1] }]]);
});

test('a refused record (the match changed meanwhile) puts a clear plan for the written slots and the icon in the record', async () => {
    const a = setup({ recordArtwork: { error: 'no mapping' } });
    a.bus.emit('artwork.applied', { appid: SC, source: 'steam-cdn', steamAppid: 2, attempted: [0, 2], kept: [], tried: [], written: [0, 2], icon: { path: 'p', previous: 'game.exe' } });
    await new Promise((r) => setTimeout(r, 0));
    const plan: any = a.records.get(SC)?.artwork?.data;
    assert.deepEqual(plan.clear, [0, 2]);
    assert.deepEqual(plan.icon, { restore: 'game.exe' });
    assert.equal(a.icons.length, 0);
});

test('the icon is recorded after the slots; a refused icon record restores the previous icon', async () => {
    const a = setup({ recordIcon: { error: 'mapped' } });
    a.bus.emit('artwork.applied', { appid: SC, source: 'steam-cdn', steamAppid: 2, attempted: [], kept: [], tried: [], written: [], icon: { path: 'p', previous: 'game.exe' } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(a.recorded.length, 0);
    assert.deepEqual(a.icons, [[SC, { path: 'p', previous: 'game.exe', source: 'steam-cdn', steamAppid: 2 }]]);
    assert.deepEqual((a.records.get(SC)?.artwork?.data as any).icon, { restore: 'game.exe' });
});
