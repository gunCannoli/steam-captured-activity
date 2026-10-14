import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createView, needsRefresh } from '../frontend/app/view.ts';

const SC = 4263274102;

interface Paint {
    metadata?: any;
    achievements?: any;
}

function setup(
    getBucket: () => { bucket: string; via: string },
    opts: { collections?: Promise<boolean>; paint?: Paint; native?: boolean } = {},
) {
    const log: string[] = [];
    const paint: Paint = opts.paint ?? { metadata: { status: 'ok', data: {} }, achievements: { status: 'ok', data: {} } };
    const view = createView({
        routing: { getBucket: getBucket as any, waitForCollections: async () => opts.collections ?? true },
        identity: {
            async ensure() {
                log.push('identity');
                return { status: 'ok', data: opts.native === false ? {} : { native: { appid: 77, source: 'search' } } } as any;
            },
        },
        metadata: {
            async ensure(_a: any, _r: any, id: any, o?: { noNetwork?: boolean }) {
                if (o?.noNetwork) {
                    log.push('metadata:paint');
                    return paint.metadata;
                }
                log.push('metadata:' + (id ? 'identity' : 'none'));
                return { status: 'ok' } as any;
            },
        },
        artwork: { async ensure() { log.push('artwork'); return { status: 'ok' } as any; } },
        achievements: {
            async ensure(_a: any, _r: any, o?: { noNetwork?: boolean }) {
                if (o?.noNetwork) {
                    log.push('achievements:paint');
                    return paint.achievements;
                }
                log.push('achievements');
                return { status: 'ok' } as any;
            },
        },
        media: { async ensure(_a: any, _r: any, id: any) { log.push('media:' + (id ? 'identity' : 'none')); return { status: 'ok' } as any; } },
    });
    return { view, log };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('paint first: stored Game Info and achievements are read from disk before any lookup (ADR-0060)', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log.slice(0, 2), ['metadata:paint', 'achievements:paint']);
});

test('a web-scraping shortcut with fresh stored data asks no source for it, only artwork and media', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['metadata:paint', 'achievements:paint', 'artwork', 'media:none']);
});

test('stale or missing parts are refreshed: Game Info, then achievements, both before artwork and media', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }), {
        paint: { metadata: { status: 'ok', data: {}, stale: true }, achievements: { status: 'pending', stale: true } },
    });
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['metadata:paint', 'achievements:paint', 'metadata:none', 'achievements', 'artwork', 'media:none']);
});

test('a steam-store match always asks for its Game Info (Steam store item, never stored); fresh achievements are not asked', async () => {
    const s = setup(() => ({ bucket: 'steam-store', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['metadata:paint', 'achievements:paint', 'identity', 'metadata:identity', 'artwork', 'media:identity']);
});

test('a steam-store shortcut without a match and with fresh Game Info asks no metadata source', async () => {
    const s = setup(() => ({ bucket: 'steam-store', via: 'default' }), { native: false });
    await s.view.onSourceView(SC);
    await tick();
    assert.ok(!s.log.includes('metadata:identity'));
    assert.ok(!s.log.includes('metadata:none'));
});

test('needsRefresh: nothing answered, stale, or a failed call; a fresh or remembered answer is not asked again', () => {
    assert.equal(needsRefresh(undefined), true);
    assert.equal(needsRefresh({ status: 'pending', stale: true }), true);
    assert.equal(needsRefresh({ status: 'ok', data: {}, stale: true }), true);
    assert.equal(needsRefresh({ status: 'error', message: 'call failed' }), true);
    assert.equal(needsRefresh({ status: 'ok', data: {} }), false);
    assert.equal(needsRefresh({ status: 'unsupported' }), false);
    assert.equal(needsRefresh({ status: 'error', data: {} }), false);
});

test('a shortcut routed to none paints nothing from disk', async () => {
    const s = setup(() => ({ bucket: 'none', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.ok(!s.log.includes('metadata:paint'));
});

test('a native appid is not a shortcut view', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    await s.view.onSourceView(435150);
    assert.deepEqual(s.log, []);
});

test('a pending route is local metadata and stored achievements only, replayed once collections are ready', async () => {
    let via = 'pending';
    let release!: (v: boolean) => void;
    const ready = new Promise<boolean>((r) => (release = r));
    const s = setup(() => ({ bucket: 'web-scraping', via }), { collections: ready });
    s.view.init();
    await s.view.onSourceView(SC);
    assert.deepEqual(s.log, ['metadata:none', 'achievements:paint']);
    via = 'default';
    release(true);
    await tick();
    await tick();
    assert.deepEqual(s.log, ['metadata:none', 'achievements:paint', 'metadata:paint', 'achievements:paint', 'artwork', 'media:none']);
});

test('leaving the steam-store bucket stops resolving identity', async () => {
    let bucket = 'steam-store';
    const s = setup(() => ({ bucket, via: 'default' }));
    await s.view.onSourceView(SC);
    bucket = 'web-scraping';
    await s.view.onSourceView(SC);
    await tick();
    assert.equal(s.log.filter((l) => l === 'identity').length, 1);
});

test('a view that arrives while the same shortcut is in flight is replayed once, not run in parallel', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    const first = s.view.onSourceView(SC);
    void s.view.onSourceView(SC);
    void s.view.onSourceView(SC);
    await first;
    await tick();
    await tick();
    assert.equal(s.log.filter((l) => l === 'artwork').length, 2);
});
