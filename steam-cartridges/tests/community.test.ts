import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkshopMediaItems } from '../frontend/steam/community-core.ts';

test('buildWorkshopMediaItems: creates correctly shaped workshop items', () => {
    const items = buildWorkshopMediaItems(
        12345,
        ['https://example.com/ss1.jpg'],
        [{ url: 'https://example.com/art1.jpg' }],
        'https://example.com/title.jpg',
        'https://example.com/fanart.jpg'
    );

    assert.equal(items.length, 4);
    assert.equal(items[0].id, 'cartridges_12345_0');
    assert.equal(items[0].url, 'https://example.com/ss1.jpg');
    assert.equal(items[1].id, 'cartridges_12345_1');
    assert.equal(items[1].url, 'https://example.com/art1.jpg');
    assert.equal(items[2].url, 'https://example.com/title.jpg');
    assert.equal(items[3].url, 'https://example.com/fanart.jpg');
});
