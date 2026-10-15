// kernel/record.ts normalizePart: K1 handled once, where every part enters the record store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordStore, normalizePart } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';

test('an empty achievement list written as {} by the backend becomes an array (RetroAchievements 0/0, 2026-10-15)', () => {
    const part = { status: 'ok', data: { schema: { native_appid: 0, total: 0, achievements: {} }, unlocks: {} } } as any;
    const out = normalizePart('achievements', part) as any;
    assert.deepEqual(out.data.schema.achievements, []);
    assert.deepEqual(out.data.unlocks, {}, 'the unlock map stays a map');
    assert.equal(part.data.schema.achievements.constructor, Object, 'the input is untouched');
});

test('media items written as {} become an array; arrays and other parts pass through unchanged', () => {
    assert.deepEqual((normalizePart('media', { status: 'ok', data: { items: {} } } as any) as any).data.items, []);
    const ok = { status: 'ok', data: { schema: { achievements: [{ id: 'a' }] } } } as any;
    assert.equal(normalizePart('achievements', ok), ok);
    const id = { status: 'ok', data: { title: 'x' } } as any;
    assert.equal(normalizePart('identity', id), id);
    assert.equal(normalizePart('achievements', undefined as any), undefined);
});

test('the record store applies it on every update', () => {
    const store = createRecordStore(createEventBus(() => {}) as any);
    store.upsert({ appid: 1 as any, gameid: '1', title: 't', exe: '' });
    store.update(1 as any, { achievements: { status: 'ok', data: { schema: { native_appid: 0, total: 0, achievements: {} }, unlocks: {} } } as any });
    assert.ok(Array.isArray((store.get(1 as any)!.achievements as any).data.schema.achievements));
});
