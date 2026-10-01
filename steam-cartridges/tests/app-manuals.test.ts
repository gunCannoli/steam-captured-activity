import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_HEIGHT, COVER_WIDTH, createManuals, MAX_MANUAL_CHUNKS, MAX_MANUAL_PAGES, PAGE_WIDTH } from '../frontend/app/manuals.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createManualShelf } from '../frontend/kernel/manual-shelf.ts';

const SC = 3858120657 as any;
const KEY = 'manuel(us)';

function setup(over: Partial<Record<string, any>> = {}) {
    const bus = createEventBus();
    const shelf = createManualShelf(() => {});
    const asked: any[] = [];
    const rendered: any[] = [];
    let destroyed = 0;
    const covers: any[] = [];
    const chunks = over.chunks ?? 2;
    const manuals = createManuals({
        backend: {
            async getManualChunk(appid: number, key: string, index: number, title?: string) {
                asked.push({ appid, key, index, title });
                if (over.chunkThrows) throw new Error('transport');
                if (over.chunkError) return { error: 'unknown key' };
                return { base64: `c${index}`, index, chunks, size: chunks * 10 };
            },
        } as any,
        bus,
        shelf,
        renderer: {
            async open(parts: readonly string[]) {
                if (over.noDoc) return null;
                rendered.push({ parts: [...parts] });
                return {
                    pageCount: over.pages ?? 3,
                    pageWidth: 420,
                    pageHeight: 595,
                    async renderCover(width: number, height: number) {
                        covers.push([width, height]);
                        return over.noCover ? null : 'blob:cover';
                    },
                    async renderPage(n: number, width: number) {
                        rendered.push({ n, width });
                        return over.blankPage === n ? null : `blob:p${n}`;
                    },
                    destroy: () => void destroyed++,
                };
            },
        },
        titleOf: () => 'Captain Commando',
        manualKeyOf: (appid: number) => (over.noManual || appid !== SC ? undefined : KEY),
    });
    return { bus, shelf, manuals, asked, rendered, covers, destroyed: () => destroyed };
}

test('app/manuals: reads every chunk in order, renders every page at PAGE_WIDTH, ends ready', async () => {
    const s = setup();
    await s.manuals.open(SC, KEY);
    assert.deepEqual(s.asked.map((a) => a.index), [0, 1]);
    assert.equal(s.asked[0].title, 'Captain Commando');
    assert.deepEqual(s.rendered[0].parts, ['c0', 'c1']);
    assert.deepEqual(s.rendered.slice(1).map((r) => [r.n, r.width]), [[1, PAGE_WIDTH], [2, PAGE_WIDTH], [3, PAGE_WIDTH]]);
    const view = s.shelf.get(SC, KEY)!;
    assert.equal(view.status, 'ready');
    assert.deepEqual(view.pages.map((p) => p.url), ['blob:p1', 'blob:p2', 'blob:p3']);
    assert.deepEqual([view.pages[0]!.width, view.pages[0]!.height], [420, 595]);
    assert.equal(s.destroyed(), 1, 'the document is freed once its pages are images');
});

test('app/manuals: the shelf shows sized placeholders first, then each page as it is rendered', async () => {
    const s = setup();
    const seen: string[] = [];
    s.shelf.subscribe(() => {
        const v = s.shelf.get(SC, KEY)!;
        seen.push(`${v.status}:${v.pages.filter((p) => p.url).length}/${v.pages.length}`);
    });
    await s.manuals.open(SC, KEY);
    assert.deepEqual(seen, ['loading:0/0', 'loading:0/3', 'loading:1/3', 'loading:2/3', 'loading:3/3', 'ready:3/3']);
});

test('app/manuals: the community.manual-opened event opens the manual once; a ready manual is not read again', async () => {
    const s = setup();
    s.manuals.install();
    s.bus.emit('community.manual-opened', { appid: SC, key: KEY });
    s.bus.emit('community.manual-opened', { appid: SC, key: KEY }); // the viewer re-mounted while it was rendering
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(s.asked.filter((a) => a.index === 0).length, 1);
    await s.manuals.open(SC, KEY);
    assert.equal(s.asked.filter((a) => a.index === 0).length, 1);
});

test('app/manuals: a failed download, a refused answer or a PDF that does not parse marks it failed (ADR-0014)', async () => {
    for (const over of [{ chunkThrows: true }, { chunkError: true }, { noDoc: true }, { chunks: MAX_MANUAL_CHUNKS + 1 }, { pages: 0 }]) {
        const s = setup(over);
        await s.manuals.open(SC, KEY);
        assert.deepEqual(s.shelf.get(SC, KEY), { status: 'failed', pages: [] }, JSON.stringify(over));
    }
});

test('app/manuals: a failed manual is tried again the next time it opens', async () => {
    const s = setup({ chunkError: true });
    await s.manuals.open(SC, KEY);
    await s.manuals.open(SC, KEY);
    assert.equal(s.asked.length, 2);
});

test('app/manuals: a page that does not render stays a placeholder; at most MAX_MANUAL_PAGES pages', async () => {
    const s = setup({ blankPage: 2 });
    await s.manuals.open(SC, KEY);
    assert.deepEqual(s.shelf.get(SC, KEY)!.pages.map((p) => p.url), ['blob:p1', undefined, 'blob:p3']);
    const big = setup({ pages: MAX_MANUAL_PAGES + 50 });
    await big.manuals.open(SC, KEY);
    assert.equal(big.shelf.get(SC, KEY)!.pages.length, MAX_MANUAL_PAGES);
});

test('app/manuals: a shortcut whose media names a manual gets its first page as a cover, once, and the record is announced', async () => {
    const s = setup();
    const updates: any[] = [];
    s.bus.on('record.updated', (e) => updates.push(e));
    s.manuals.install();
    s.bus.emit('record.updated', { appid: SC, parts: ['media'] });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(s.shelf.cover(SC, KEY), 'blob:cover');
    assert.deepEqual(s.covers, [[COVER_WIDTH, COVER_HEIGHT]]);
    assert.equal(s.destroyed(), 1, 'the document is freed after the cover');
    assert.ok(updates.length >= 2, 'the surface is told to re-read the media part');
    s.bus.emit('record.updated', { appid: SC, parts: ['media'] }); // the announcement itself, and every later update
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(s.asked.filter((a) => a.index === 0).length, 1, 'read once');
});

test('app/manuals: no cover for another part, another shortcut, a hidden manual, or a PDF that does not render; a failure is not retried', async () => {
    for (const [over, part, appid] of [[{}, 'metadata', SC], [{}, 'media', 1], [{ noManual: true }, 'media', SC]] as const) {
        const s = setup(over);
        s.manuals.install();
        s.bus.emit('record.updated', { appid: appid as any, parts: [part] as any });
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(s.asked.length, 0, JSON.stringify([over, part, appid]));
    }
    for (const over of [{ noCover: true }, { noDoc: true }, { chunkError: true }]) {
        const s = setup(over);
        s.manuals.install();
        s.bus.emit('record.updated', { appid: SC, parts: ['media'] });
        for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
        assert.equal(s.shelf.cover(SC, KEY), undefined, JSON.stringify(over));
        const reads = s.asked.length;
        s.bus.emit('record.updated', { appid: SC, parts: ['media'] });
        for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
        assert.equal(s.asked.length, reads, 'not tried again: ' + JSON.stringify(over));
    }
});

test('app/manuals: the pages and the cover are never read at the same time', async () => {
    const s = setup();
    const order: string[] = [];
    const real = s.manuals;
    const a = real.cover(SC, KEY).then(() => order.push('cover'));
    const b = real.open(SC, KEY).then(() => order.push('open'));
    await Promise.all([a, b]);
    assert.deepEqual(order, ['cover', 'open']);
    assert.deepEqual(s.asked.map((x) => x.index), [0, 1, 0, 1], 'two reads, one after the other');
});
