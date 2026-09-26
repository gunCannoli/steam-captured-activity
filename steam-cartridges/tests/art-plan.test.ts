import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkPlan, mergeArtResult, pickUrls, slotList } from '../frontend/features/steam-store/art-plan.ts';

test('nothing recorded: write all four', () => {
    assert.deepEqual(artworkPlan(null, 2820820, false), { clear: [], write: [0, 1, 2, 3] });
});

test('recorded for another app: clear ours, write all four', () => {
    assert.deepEqual(artworkPlan({ steam_appid: 1, slots: [0, 2] }, 2820820, false), { clear: [0, 2], write: [0, 1, 2, 3] });
});

test('same app: retry failed slots once per session; removed slots stay removed', () => {
    const applied = { steam_appid: 2820820, slots: [0, 1], failed: [2] };
    assert.deepEqual(artworkPlan(applied, 2820820, false), { clear: [], write: [2] });
    assert.deepEqual(artworkPlan(applied, 2820820, true), { clear: [], write: [] });
    assert.deepEqual(artworkPlan({ steam_appid: 2820820, slots: [0, 1] }, 2820820, false), { clear: [], write: [] });
});

test('Lua empty tables ({}) are empty lists', () => {
    assert.deepEqual(slotList({}), []);
    assert.deepEqual(artworkPlan({ steam_appid: 5, slots: {} as unknown as number[] }, 5, false), { clear: [], write: [] });
});

test('pickUrls keeps only the planned slots', () => {
    assert.deepEqual(pickUrls({ portrait: 'p', hero: 'h', logo: 'l', wide: 'w' }, [1, 2]), { hero: 'h', logo: 'l' });
});

test('mergeArtResult: kept + written, failed = attempted - written', () => {
    const plan = { clear: [], write: [2, 3] };
    assert.deepEqual(mergeArtResult({ steam_appid: 9, slots: [0, 1] }, 9, plan, [3]), { slots: [0, 1, 3], failed: [2] });
    assert.deepEqual(mergeArtResult({ steam_appid: 8, slots: [0, 1] }, 9, { clear: [0, 1], write: [0, 1, 2, 3] }, [0, 1, 2, 3]), {
        slots: [0, 1, 2, 3],
        failed: [],
    });
});
