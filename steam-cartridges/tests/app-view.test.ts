import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createView } from '../frontend/app/view.ts';

const SC = 4263274102;

function setup(getBucket: () => { bucket: string; via: string }, opts: { collections?: Promise<boolean> } = {}) {
    const log: string[] = [];
    let onView: (id: number) => Promise<boolean | undefined> = async () => true;
    const view = createView({
        routing: { getBucket: getBucket as any, waitForCollections: async () => opts.collections ?? true },
        identity: { async ensure() { log.push('identity'); return { status: 'ok', data: { native: { appid: 77, source: 'search' } } } as any; } },
        metadata: { async ensure(_a: any, _r: any, id: any) { log.push('metadata:' + (id ? 'identity' : 'none')); return { status: 'ok' } as any; } },
        artwork: { async ensure() { log.push('artwork'); return { status: 'ok' } as any; } },
        achievements: { async ensure() { log.push('achievements'); } },
        steamStore: { onView: (id: any) => { log.push('steamStore.onView'); return onView(id); }, leave: () => { log.push('steamStore.leave'); } },
    });
    return { view, log, setOnView: (f: typeof onView) => { onView = f; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('a steam-store shortcut runs identity, the store side effects, metadata, artwork, achievements in order', async () => {
    const s = setup(() => ({ bucket: 'steam-store', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['identity', 'steamStore.onView', 'metadata:identity', 'artwork', 'achievements']);
});

test('a web-scraping shortcut skips identity and the store', async () => {
    const s = setup(() => ({ bucket: 'web-scraping', via: 'default' }));
    await s.view.onSourceView(SC);
    await tick();
    assert.deepEqual(s.log, ['metadata:none', 'artwork', 'achievements']);
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
    assert.deepEqual(s.log, ['metadata:none', 'metadata:none', 'artwork', 'achievements']);
});

test('leaving the steam-store bucket calls leave once', async () => {
    let bucket = 'steam-store';
    const s = setup(() => ({ bucket, via: 'default' }));
    await s.view.onSourceView(SC);
    bucket = 'web-scraping';
    await s.view.onSourceView(SC);
    await s.view.onSourceView(SC);
    await tick();
    assert.equal(s.log.filter((l) => l === 'steamStore.leave').length, 1);
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
