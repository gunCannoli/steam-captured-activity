import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageBin, MAX_APPIDS } from '../frontend/kernel/image-bin.ts';

const IMG = { base64: 'QUJD', ext: 'jpg' };

test('put then get returns the image, and get does not remove it', () => {
    const bin = createImageBin();
    bin.put(1, 'hero', IMG);
    assert.deepEqual(bin.get(1), { hero: IMG });
    assert.deepEqual(bin.get(1), { hero: IMG });
});

test('discard empties one shortcut and leaves the others', () => {
    const bin = createImageBin();
    bin.put(1, 'hero', IMG);
    bin.put(2, 'logo', IMG);
    bin.discard(1);
    assert.deepEqual(bin.get(1), {});
    assert.deepEqual(bin.get(2), { logo: IMG });
});

test('more than MAX_APPIDS shortcuts evicts the oldest only', () => {
    const bin = createImageBin();
    for (let i = 1; i <= MAX_APPIDS + 1; i++) bin.put(i, 'wide', IMG);
    assert.deepEqual(bin.get(1), {});
    assert.deepEqual(bin.get(2), { wide: IMG });
    assert.deepEqual(bin.get(MAX_APPIDS + 1), { wide: IMG });
});
