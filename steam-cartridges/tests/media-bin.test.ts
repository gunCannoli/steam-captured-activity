import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaBin, MAX_MEDIA_APPIDS } from '../frontend/kernel/media-bin.ts';

test('media bin: put and get by shortcut and key', () => {
    const bin = createMediaBin(() => {});
    bin.put(1, 'ss(wor)', { url: 'blob:a', width: 640, height: 480 });
    assert.deepEqual(bin.get(1, 'ss(wor)'), { url: 'blob:a', width: 640, height: 480 });
    assert.equal(bin.get(1, 'fanart()'), undefined);
    assert.equal(bin.get(2, 'ss(wor)'), undefined);
});

test('media bin: a replaced image releases its old URL', () => {
    const released: string[] = [];
    const bin = createMediaBin((url) => released.push(url));
    bin.put(1, 'k', { url: 'blob:old' });
    bin.put(1, 'k', { url: 'blob:new' });
    assert.deepEqual(released, ['blob:old']);
});

test('media bin: past MAX_MEDIA_APPIDS shortcuts the least recent is evicted and its URLs released', () => {
    const released: string[] = [];
    const bin = createMediaBin((url) => released.push(url));
    for (let a = 1; a <= MAX_MEDIA_APPIDS; a++) bin.put(a, 'k', { url: `blob:${a}` });
    bin.put(1, 'k2', { url: 'blob:1b' }); // 1 is now the most recent
    bin.put(MAX_MEDIA_APPIDS + 1, 'k', { url: 'blob:new' });
    assert.deepEqual(released, ['blob:2']);
    assert.equal(bin.get(2, 'k'), undefined);
    assert.equal(bin.get(1, 'k')?.url, 'blob:1');
});
