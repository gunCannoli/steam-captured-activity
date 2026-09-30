import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryStats } from '../frontend/app/library-stats.ts';

test('load keys the stats by the unsigned appid; signed and unsigned reads find them', async () => {
    const stats = createLibraryStats({ backend: { getLibraryStats: async () => ({ '4263274102': { newest: 5, screenshots: 4 } }) } as any });
    await stats.load();
    assert.deepEqual(stats.get(4263274102), { newest: 5, screenshots: 4 });
    assert.deepEqual(stats.get(4263274102 | 0), { newest: 5, screenshots: 4 });
    assert.equal(stats.size(), 1);
});

test('a failed load keeps the previous stats', async () => {
    let fail = false;
    const stats = createLibraryStats({
        backend: {
            getLibraryStats: async () => {
                if (fail) throw new Error('rpc');
                return { '4263274102': { newest: 5 } };
            },
        } as any,
    });
    await stats.load();
    fail = true;
    await stats.load();
    assert.deepEqual(stats.get(4263274102), { newest: 5, screenshots: 0 });
});
