import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetadata } from '../frontend/features/game-info/normalize.ts';

test('empty Lua tables ({}) become empty arrays (the metadata.ts TypeError)', () => {
    const m = normalizeMetadata({ appid: 1, title: 't', franchises: {} as unknown as string[], developers: ['A'] });
    assert.deepEqual(m.franchises, []);
    assert.deepEqual(m.developers, ['A']);
    assert.deepEqual(m.publishers, []);
    assert.equal(m.release_date, 0);
});

test('object-shaped lists keep their string values; junk is dropped', () => {
    const m = normalizeMetadata({
        appid: 1,
        title: 't',
        publishers: { 1: 'P', 2: 7, 3: '' } as unknown as string[],
        genres: 'Indie' as unknown as string[],
        release_date: '1505347200' as unknown as number,
    });
    assert.deepEqual(m.publishers, ['P']);
    assert.deepEqual(m.genres, ['Indie']);
    assert.equal(m.release_date, 1505347200);
});

test('other fields pass through unchanged', () => {
    const m = normalizeMetadata({ appid: 5, title: 'x', description: 'd', categories: { coop: true }, steam_appid: 9 });
    assert.equal(m.description, 'd');
    assert.deepEqual(m.categories, { coop: true });
    assert.equal(m.steam_appid, 9);
});
