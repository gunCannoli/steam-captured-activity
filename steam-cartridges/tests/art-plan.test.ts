import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkPlan, iconPlan, iconRestoreOf, mergeArtResult, pickUrls, sgdbPlan, slotList } from '../frontend/domain/art-plan.ts';

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

test('steamgriddb: only empty slots that have a url are written, nothing is cleared', () => {
    const urls = { portrait: 'p', hero: 'h', logo: 'l' };
    assert.deepEqual(sgdbPlan(urls, [0, 1, 2, 3]), { clear: [], write: [0, 1, 2] });
    assert.deepEqual(sgdbPlan(urls, [1, 3]), { clear: [], write: [1] });
    assert.deepEqual(sgdbPlan(urls, []), { clear: [], write: [] });
});

test('steamgriddb: Lua empty tables ({}) and junk mean no empty slot', () => {
    assert.deepEqual(sgdbPlan({ portrait: 'p' }, {}), { clear: [], write: [] });
    assert.deepEqual(sgdbPlan({ portrait: 'p' }, [0, 9, 'x']), { clear: [], write: [0] });
});

test('icon: written only when eligible is exactly true and there is a url', () => {
    assert.deepEqual(iconPlan({ icon: 'https://i/full.jpg' }, true), { url: 'https://i/full.jpg' });
    assert.equal(iconPlan({ icon: 'https://i/full.jpg' }, false), undefined);
    assert.equal(iconPlan({ icon: 'https://i/full.jpg' }, 'true'), undefined);
    assert.equal(iconPlan({ icon: 'https://i/full.jpg' }, undefined), undefined);
    assert.equal(iconPlan({ icon: '' }, true), undefined);
    assert.equal(iconPlan({ portrait: 'p' }, true), undefined);
});

test('icon: pickUrls never carries the icon (it is not a slot)', () => {
    assert.deepEqual(pickUrls({ portrait: 'p', icon: 'i' }, [0, 1, 2, 3]), { portrait: 'p' });
});

test('icon: Clear restore value is read defensively ("" = the exe is a real value)', () => {
    assert.equal(iconRestoreOf({ slots: [], icon_restore: 'D:\Game\game.exe' }), 'D:\Game\game.exe');
    assert.equal(iconRestoreOf({ slots: [], icon_restore: '' }), '');
    assert.equal(iconRestoreOf({ slots: [] }), undefined);
    assert.equal(iconRestoreOf({ icon_restore: 5 }), undefined);
    assert.equal(iconRestoreOf(null), undefined);
});
