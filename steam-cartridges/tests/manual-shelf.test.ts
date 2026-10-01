import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManualShelf, MAX_MANUALS } from '../frontend/kernel/manual-shelf.ts';

const page = (url?: string) => ({ url, width: 420, height: 595 });

test('manual shelf: set, get and tell the listeners', () => {
    const shelf = createManualShelf(() => {});
    let told = 0;
    const off = shelf.subscribe(() => told++);
    shelf.set(1, 'manuel(us)', { status: 'loading', pages: [] });
    assert.deepEqual(shelf.get(1, 'manuel(us)'), { status: 'loading', pages: [] });
    assert.equal(shelf.get(1, 'manuel(eu)'), undefined);
    assert.equal(told, 1);
    off();
    shelf.set(1, 'manuel(us)', { status: 'ready', pages: [] });
    assert.equal(told, 1, 'an unsubscribed listener is not told');
});

test('manual shelf: a page URL dropped by an update is released, a kept one is not', () => {
    const released: string[] = [];
    const shelf = createManualShelf((url) => released.push(url));
    shelf.set(1, 'm', { status: 'loading', pages: [page('blob:a'), page()] });
    shelf.set(1, 'm', { status: 'loading', pages: [page('blob:a'), page('blob:b')] });
    assert.deepEqual(released, []);
    shelf.set(1, 'm', { status: 'failed', pages: [] });
    assert.deepEqual(released.sort(), ['blob:a', 'blob:b']);
});

test('manual shelf: at most MAX_MANUALS manuals; the oldest is evicted and its pages released', () => {
    const released: string[] = [];
    const shelf = createManualShelf((url) => released.push(url));
    for (let i = 0; i <= MAX_MANUALS; i++) shelf.set(i, 'm', { status: 'ready', pages: [page(`blob:${i}`)] });
    assert.equal(shelf.get(0, 'm'), undefined);
    assert.deepEqual(released, ['blob:0']);
    assert.ok(shelf.get(MAX_MANUALS, 'm'));
});

test('manual shelf: a listener that throws does not stop the others', () => {
    const shelf = createManualShelf(() => {});
    let told = 0;
    shelf.subscribe(() => {
        throw new Error('boom');
    });
    shelf.subscribe(() => told++);
    shelf.set(1, 'm', { status: 'loading', pages: [] });
    assert.equal(told, 1);
});
