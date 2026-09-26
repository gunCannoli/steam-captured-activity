import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameInfoPlan } from '../frontend/features/game-info/policy.ts';

test('none: local Game Info, no fetch (ADR-0035)', () => {
    assert.deepEqual(gameInfoPlan('none', 'default'), { applyLocal: true, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('none', 'collection'), { applyLocal: true, fetchWeb: false });
});

test('pending: local Game Info, no fetch', () => {
    assert.deepEqual(gameInfoPlan('none', 'pending'), { applyLocal: true, fetchWeb: false });
});

test('web-scraping: local Game Info and web fetch', () => {
    assert.deepEqual(gameInfoPlan('web-scraping', 'collection'), { applyLocal: true, fetchWeb: true });
    assert.deepEqual(gameInfoPlan('web-scraping', 'override'), { applyLocal: true, fetchWeb: true });
});

test('steam-store with a match: neither tier (the store handler owns Game Info)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'default', true), { applyLocal: false, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('steam-store', 'override', true), { applyLocal: false, fetchWeb: false });
});

test('steam-store before the store answered: local only (ADR-0036)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'default'), { applyLocal: true, fetchWeb: false });
});

test('steam-store with no Steam match: web scraping fallback (ADR-0036)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'default', false), { applyLocal: true, fetchWeb: true });
    assert.deepEqual(gameInfoPlan('steam-store', 'collection', false), { applyLocal: true, fetchWeb: true });
});
