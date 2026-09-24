import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUCKETS, findConflicts, resolveBucket, validateConfig } from '../frontend/features/buckets/resolve.ts';
import type { BucketsConfig } from '../frontend/features/buckets/resolve.ts';

const A = 0x8000_0001, B = 0x8000_0002, C = 0x8000_0003, D = 0x8000_0004, N = 435150;
const sets: Record<string, Set<number>> = { steam: new Set([A, C, N]), retro: new Set([B, C]) };
const membersOf = (id: string) => sets[id];
const cfg = (over: Partial<BucketsConfig> = {}): BucketsConfig => ({
    ...DEFAULT_BUCKETS,
    assignments: [
        { id: 'steam', name: 'Steam', bucket: 'steam-store' },
        { id: 'retro', name: 'Retro', bucket: 'web-scraping' },
    ],
    ...over,
});

test('basic resolution', () => {
    assert.deepEqual(resolveBucket(A, cfg(), membersOf), { bucket: 'steam-store', via: 'collection', collectionId: 'steam' });
    assert.equal(resolveBucket(B, cfg(), membersOf).bucket, 'web-scraping');
    assert.deepEqual(resolveBucket(D, cfg(), membersOf), { bucket: 'none', via: 'default' });
    assert.deepEqual(resolveBucket(N, cfg(), membersOf), { bucket: 'none', via: 'not-a-shortcut' });
});

test('conflict follows list order', () => {
    const r = resolveBucket(C, cfg(), membersOf);
    assert.equal(r.bucket, 'steam-store');
    assert.deepEqual(r.conflict, { collectionIds: ['steam', 'retro'], buckets: ['steam-store', 'web-scraping'] });
    const swapped = cfg({ assignments: [...cfg().assignments].reverse() });
    assert.equal(resolveBucket(C, swapped, membersOf).bucket, 'web-scraping');
    assert.deepEqual(findConflicts(cfg(), membersOf, [A, B, C, D]).map((c) => c.appid), [C]);
});

test('overrides', () => {
    const c = cfg({ overrides: { [C]: 'none', [A]: 'web-scraping' } });
    assert.deepEqual(resolveBucket(C, c, membersOf), { bucket: 'none', via: 'override' });
    assert.equal(resolveBucket(A, c, membersOf).bucket, 'web-scraping');
});

test('deleted collection is skipped', () => {
    const m = (id: string) => (id === 'retro' ? undefined : sets[id]);
    assert.equal(resolveBucket(B, cfg(), m).bucket, 'none');
});

test('validateConfig', () => {
    const v = validateConfig({
        default: 'web-scraping',
        assignments: [
            { id: 'x', name: 'X', bucket: 'steam-store' },
            { id: 'x', name: 'X2', bucket: 'web-scraping' },
            { id: 'y', name: 'Y', bucket: 'bogus' },
            { id: 'z', bucket: 'none' },
            null,
        ],
        overrides: { [A]: 'web-scraping', abc: 'none', '435150': 'steam-store', [B]: 'nope' },
    });
    assert.equal(v.default, 'none');
    assert.deepEqual(v.assignments, [{ id: 'x', name: 'X', bucket: 'steam-store' }]);
    assert.deepEqual(v.overrides, { [A]: 'web-scraping' });
    for (const g of [null, 5, 'x', [], undefined]) assert.deepEqual(validateConfig(g), DEFAULT_BUCKETS);
});

test('exclusivity property', () => {
    const ids = ['a', 'b', 'c'];
    const bs = ['steam-store', 'web-scraping', 'none', 'x'];
    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    for (let i = 0; i < 300; i++) {
        const assignments = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({
            id: pick(ids),
            name: 'n',
            bucket: pick(bs),
        }));
        const seen = validateConfig({ assignments }).assignments.map((a) => a.id);
        assert.equal(new Set(seen).size, seen.length);
    }
});
