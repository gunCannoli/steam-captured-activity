import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMedia, IMAGE_CONCURRENCY } from '../frontend/app/media.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createMediaBin } from '../frontend/kernel/media-bin.ts';

const SC = 4263274102 as any;
const ROUTE = { bucket: 'web-scraping', via: 'default' } as any;
const VIDEO = { kind: 'video', source: 'igdb', youtube: 'yt1' };
const SHOT = { kind: 'screenshot', source: 'igdb', url: 'https://i/1.jpg', width: 1280, height: 720 };
const FANART = { kind: 'artwork', source: 'screenscraper', key: 'fanart()', width: 1920, height: 1080 };

function setup(over: Partial<Record<string, any>> = {}) {
    const records = createRecordStore(createEventBus());
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    records.update(SC, { metadata: { status: 'ok', data: { appid: SC, title: 'Game', igdb_id: 1234 } } });
    const calls: any[] = [];
    const images: any[] = [];
    const bin = createMediaBin(() => {});
    const media = createMedia({
        backend: {
            async ensureFresh(appid: number, parts: any, ctx: any) {
                calls.push({ appid, parts, ctx });
                return over.response ?? { appid, parts: { media: { status: 'ok', source: 'igdb+screenscraper', data: { items: [VIDEO, SHOT, FANART] } } } };
            },
            async getMediaImage(appid: number, key: string, title?: string) {
                images.push({ appid, key, title });
                if (over.imageThrows) throw new Error('transport');
                return over.image ?? { base64: 'QUJD', ext: 'jpg', width: 800, height: 450 };
            },
        } as any,
        records,
        bin,
        titleOf: () => 'Game',
        allowWeb: () => over.allowWeb ?? true,
        allowScreenscraper: () => true,
        toggles: () => over.toggles ?? { trailers: true, artworks: true },
        objectUrl: (b64: string, ext: string) => (over.noUrl ? null : `blob:${b64}.${ext}`),
    });
    return { media, records, calls, images, bin };
}

test('app/media: one EnsureFresh for the media part with the metadata\'s igdb_id and the service checks', async () => {
    const s = setup();
    await s.media.ensure(SC, ROUTE, undefined);
    assert.equal(s.calls.length, 1);
    assert.deepEqual(s.calls[0].parts, ['media']);
    assert.equal(s.calls[0].ctx.igdb_id, 1234);
    assert.equal(s.calls[0].ctx.allowWeb, true);
    assert.equal(s.calls[0].ctx.allowScreenscraper, true);
    assert.equal(s.calls[0].ctx.title, 'Game');
});

test('app/media: a Steam match costs no call and records unsupported', async () => {
    const s = setup();
    const part = await s.media.ensure(SC, ROUTE, { status: 'ok', data: { native: { appid: 435150, source: 'owned' } } });
    assert.equal(s.calls.length, 0);
    assert.equal(part.status, 'unsupported');
    assert.equal(s.records.get(SC)!.media!.status, 'unsupported');
});

test('app/media: ScreenScraper images are fetched into the bin before the record update, with their real size', async () => {
    const s = setup();
    const part = await s.media.ensure(SC, ROUTE, undefined);
    assert.deepEqual(s.images, [{ appid: SC, key: 'fanart()', title: 'Game' }]);
    assert.deepEqual(s.bin.get(SC, 'fanart()'), { url: 'blob:QUJD.jpg', width: 800, height: 450 });
    const items = s.records.get(SC)!.media!.data!.items;
    assert.equal(items.length, 3);
    assert.deepEqual([items[1]!.width, items[1]!.height], [800, 450]);
    assert.equal(part, s.records.get(SC)!.media);
});

test('app/media: an image already in the bin is not fetched again', async () => {
    const s = setup();
    await s.media.ensure(SC, ROUTE, undefined);
    await s.media.ensure(SC, ROUTE, undefined);
    assert.equal(s.images.length, 1);
});

test('app/media: a failed ScreenScraper image drops that card only', async () => {
    for (const over of [{ image: { error: 'not an image' } }, { imageThrows: true }, { noUrl: true }]) {
        const s = setup(over);
        const part = await s.media.ensure(SC, ROUTE, undefined);
        assert.equal(part.status, 'ok');
        assert.deepEqual(part.data!.items.map((i) => i.kind), ['video', 'screenshot'], JSON.stringify(over));
    }
});

test('app/media: the toggles decide what the record keeps (and what is fetched)', async () => {
    const s = setup({ toggles: { trailers: false, artworks: true } });
    await s.media.ensure(SC, ROUTE, undefined);
    assert.deepEqual(s.records.get(SC)!.media!.data!.items.map((i) => i.kind), ['artwork', 'screenshot']);
    const t = setup({ toggles: { trailers: true, artworks: false } });
    await t.media.ensure(SC, ROUTE, undefined);
    assert.deepEqual(t.records.get(SC)!.media!.data!.items.map((i) => i.kind), ['video']);
    assert.equal(t.images.length, 0, 'no image fetched for a hidden kind');
});

test('app/media: a backend error is recorded as an error part', async () => {
    const s = setup({ response: { appid: SC, parts: {}, error: 'boom' } });
    const part = await s.media.ensure(SC, ROUTE, undefined);
    assert.equal(part.status, 'error');
    assert.equal(s.records.get(SC)!.media!.status, 'error');
});

test('app/media: ScreenScraper images download IMAGE_CONCURRENCY at a time, the cards keep the record order, and prefetch sees the visible items first', async () => {
    const keys = ['a()', 'b()', 'c()', 'd()', 'e()'];
    const items = keys.map((key) => ({ kind: 'artwork', source: 'screenscraper', key, width: 100, height: 100 }));
    let active = 0;
    let peak = 0;
    const events: string[] = [];
    const records = createRecordStore(createEventBus());
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const media = createMedia({
        backend: {
            async ensureFresh(appid: number) {
                events.push('ensure');
                return { appid, parts: { media: { status: 'ok', data: { items } } } };
            },
            async getMediaImage(_a: number, key: string) {
                active++;
                peak = Math.max(peak, active);
                await new Promise((r) => setTimeout(r, key === 'a()' ? 20 : 1)); // the first finishes last
                active--;
                return { base64: key, ext: 'jpg', width: 1, height: 1 };
            },
        } as any,
        records,
        bin: createMediaBin(() => {}),
        titleOf: () => 'Game',
        allowWeb: () => true,
        allowScreenscraper: () => true,
        toggles: () => ({ trailers: true, artworks: true }),
        objectUrl: (b64: string) => `blob:${b64}`,
        prefetch: (_appid: number, visible: readonly any[]) => events.push(`prefetch ${visible.length}`),
    });
    const part = await media.ensure(SC, ROUTE, undefined);
    assert.equal(peak, IMAGE_CONCURRENCY);
    assert.deepEqual(events, ['ensure', 'prefetch 5']);
    assert.deepEqual(part.data!.items.map((i: any) => i.key), keys);
});
