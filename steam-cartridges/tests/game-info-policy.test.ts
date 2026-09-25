import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameInfoPlan } from '../frontend/features/game-info/policy.ts';

test('none: local Game Info, no fetch (ADR-0035)', () => {
    assert.deepEqual(gameInfoPlan('none', 'default'), { applyLocal: true, fetchWeb: false });
});

test('pending: local Game Info, no fetch', () => {
    assert.deepEqual(gameInfoPlan('none', 'pending'), { applyLocal: true, fetchWeb: false });
});

test('web-scraping: local Game Info and web fetch', () => {
    assert.deepEqual(gameInfoPlan('web-scraping', 'collection'), { applyLocal: true, fetchWeb: true });
    assert.deepEqual(gameInfoPlan('web-scraping', 'override'), { applyLocal: true, fetchWeb: true });
});

test('steam-store: neither tier (the store handler owns Game Info)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'collection'), { applyLocal: false, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('steam-store', 'override'), { applyLocal: false, fetchWeb: false });
});
