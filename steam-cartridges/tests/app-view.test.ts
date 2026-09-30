import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createView } from '../frontend/app/view.ts';

const SC = 4263274102;

function setup(getBucket: () => { bucket: string; via: string }, opts: { collections?: Promise<boolean> } = {}) {
    const log: string[] = [];
    const view = createView({
        routing: { getBucket: getBucket as any, waitForCollections: async () => opts.collections ?? true },
        identity: { async ensure() { log.push('identity'); return { status: 'ok', data: { native: { appid: 77, source: 'search' } } } as any; } },
        metadata: { async ensure(_a: any, _r: any, id: any) { log.push('metadata:' + (id ? 'identity' : 'none')); return { status: 'ok' } as any; } },
        artwork: { async ensure() { log.push('artwork'); return { status: 'ok' } as any; } },
        achievements: { async ensure() { log.push('achievements'); } },
        media: { async ensure(_a: any, _r: any, id: any) { log.push('media:' + (id ? 'identity' : 'none')); return { status: 'ok' } as any; } },
    });
    return { view, log };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('a steam-store shortcut runs identity, metadata, artwork, media, achievements in order', async () => {
    const s = setup(() => ({ bucket: 'steam-store', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['identity', 'metadata:identity', 'artwork', 'media:identity', 'achievements']);
});

test('a web-scraping shortcut skips identity and the store', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['metadata:none', 'artwork', 'media:none', 'achievements']);
});

test('a native appid is not a shortcut view', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    await s.view.onSourceView(435150);
    assert.deepEqual(s.log, []);
});

test('a pending route is local metadata only, replayed once collections are ready', async () => {
    let via = 'pending';
    let release!: (v: boolean) => void;
    const ready = new Promise<boolean>((r) => (release = r));
    const s = setup(() => ({ bucket: 'web-scraping', via }), { collections: ready });
    s.view.init();
    await s.view.onSourceView(SC);
    assert.deepEqual(s.log, ['metadata:none']);
    via = 'default';
    release(true);
    await tick();
    await tick();
    assert.deepEqual(s.log, ['metadata:none', 'metadata:none', 'artwork', 'media:none', 'achievements']);
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
