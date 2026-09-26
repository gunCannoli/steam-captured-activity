import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_BUCKETS,
    findConflicts,
    matchesPattern,
    resolveBucket,
    splitPatterns,
    validateConfig,
} from '../frontend/features/buckets/resolve.ts';
import type { BucketsConfig, CollectionRule } from '../frontend/features/buckets/resolve.ts';

const A = 0x8000_0001, B = 0x8000_0002, C = 0x8000_0003, D = 0x8000_0004, N = 435150;
const sets: Record<string, Set<number>> = { steam: new Set([A, C, N]), retro: new Set([B, C]) };
const membersOf = (id: string) => sets[id];
const titles: Record<number, string> = { [A]: 'Alan Wake 2', [B]: 'Super Metroid (USA)', [C]: 'Castlevania', [D]: 'AM2R' };
const titleOf = (appid: number) => titles[appid];
const rule = (id: string, bucket: CollectionRule['bucket'], over: Partial<CollectionRule> = {}): CollectionRule => ({
    id,
    name: id,
    bucket,
    include: [],
    exclude: [],
    ...over,
});
const cfg = (over: Partial<BucketsConfig> = {}): BucketsConfig => ({
    ...DEFAULT_BUCKETS,
    rules: [rule('steam', 'steam-store'), rule('retro', 'web-scraping')],
    ...over,
});

test('basic resolution; no rule -> steam-store default (ADR-0036)', () => {
    assert.deepEqual(resolveBucket(A, cfg(), membersOf, titleOf), { bucket: 'steam-store', via: 'collection', collectionId: 'steam' });
    assert.equal(resolveBucket(B, cfg(), membersOf, titleOf).bucket, 'web-scraping');
    assert.deepEqual(resolveBucket(D, cfg(), membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
    assert.deepEqual(resolveBucket(D, DEFAULT_BUCKETS, membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
    assert.deepEqual(resolveBucket(N, cfg(), membersOf, titleOf), { bucket: 'none', via: 'not-a-shortcut' });
});

test('conflict follows list order', () => {
    const r = resolveBucket(C, cfg(), membersOf, titleOf);
    assert.equal(r.bucket, 'steam-store');
    assert.deepEqual(r.conflict, { collectionIds: ['steam', 'retro'], buckets: ['steam-store', 'web-scraping'] });
    const swapped = cfg({ rules: [...cfg().rules].reverse() });
    assert.equal(resolveBucket(C, swapped, membersOf, titleOf).bucket, 'web-scraping');
    assert.deepEqual(findConflicts(cfg(), membersOf, [A, B, C, D], titleOf).map((c) => c.appid), [C]);
});

test('overrides beat rules and the default', () => {
    const c = cfg({ overrides: { [C]: 'none', [A]: 'web-scraping', [D]: 'none' } });
    assert.deepEqual(resolveBucket(C, c, membersOf, titleOf), { bucket: 'none', via: 'override' });
    assert.equal(resolveBucket(A, c, membersOf, titleOf).bucket, 'web-scraping');
    assert.equal(resolveBucket(D, c, membersOf, titleOf).bucket, 'none');
});

test('a none rule stops fetching for its collection', () => {
    const c = cfg({ rules: [rule('retro', 'none')] });
    assert.deepEqual(resolveBucket(B, c, membersOf, titleOf), { bucket: 'none', via: 'collection', collectionId: 'retro' });
});

test('deleted collection is skipped -> default', () => {
    const m = (id: string) => (id === 'retro' ? undefined : sets[id]);
    assert.deepEqual(resolveBucket(B, cfg(), m, titleOf), { bucket: 'steam-store', via: 'default' });
});

test('exclude patterns make a game fall through to later rules / default', () => {
    const c = cfg({ rules: [rule('steam', 'steam-store', { exclude: ['castle'] }), rule('retro', 'web-scraping')] });
    const r = resolveBucket(C, c, membersOf, titleOf);
    assert.equal(r.bucket, 'web-scraping');
    assert.equal(r.conflict, undefined, 'an excluded rule is not a conflict');
    const onlyExcluded = cfg({ rules: [rule('steam', 'web-scraping', { exclude: ['alan*'] })] });
    assert.deepEqual(resolveBucket(A, onlyExcluded, membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
});

test('include patterns restrict a rule to matching titles', () => {
    const c = cfg({ rules: [rule('retro', 'web-scraping', { include: ['(usa)'] })] });
    assert.equal(resolveBucket(B, c, membersOf, titleOf).bucket, 'web-scraping');
    assert.deepEqual(resolveBucket(C, c, membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
    const unknownTitle = resolveBucket(C, c, membersOf, () => undefined);
    assert.equal(unknownTitle.via, 'default', 'an include rule never claims a game whose title is unknown');
});

test('matchesPattern: substring without wildcards, whole-title glob with them', () => {
    assert.ok(matchesPattern('Super Metroid (USA)', 'metroid'));
    assert.ok(matchesPattern('Super Metroid (USA)', '*(usa)'));
    assert.ok(!matchesPattern('Super Metroid (USA)', 'metroid*'), 'a glob is anchored to the whole title');
    assert.ok(matchesPattern('Doom 2', 'doom ?'));
    assert.ok(!matchesPattern('Doom 64', 'doom ?'));
    assert.ok(matchesPattern('anything', '*'));
    assert.ok(!matchesPattern('anything', ''));
    assert.ok(matchesPattern('a+b(c)[d]', 'a+b(c)[d]'), 'regex characters are literal');
});

test('splitPatterns trims, dedupes and caps', () => {
    assert.deepEqual(splitPatterns(' a, b ,,a, c '), ['a', 'b', 'c']);
    assert.equal(splitPatterns(Array.from({ length: 40 }, (_, i) => `p${i}`).join(',')).length, 32);
    assert.deepEqual(splitPatterns('x'.repeat(101)), []);
});

test('validateConfig: v1 migration, forced default, junk dropped', () => {
    const v1 = validateConfig({
        default: 'none',
        assignments: [
            { id: 'x', name: 'X', bucket: 'steam-store' },
            { id: 'x', name: 'X2', bucket: 'web-scraping' },
            { id: 'y', name: 'Y', bucket: 'bogus' },
            null,
        ],
        overrides: { [A]: 'web-scraping', abc: 'none', '435150': 'steam-store', [B]: 'nope' },
    });
    assert.equal(v1.version, 2);
    assert.equal(v1.default, 'steam-store');
    assert.deepEqual(v1.rules, [{ id: 'x', name: 'X', bucket: 'steam-store', include: [], exclude: [] }]);
    assert.deepEqual(v1.overrides, { [A]: 'web-scraping' });
    const v2 = validateConfig({ rules: [{ id: 'r', bucket: 'none', include: ['a', 5, ' '], exclude: 'x' }] });
    assert.deepEqual(v2.rules, [{ id: 'r', name: 'r', bucket: 'none', include: ['a'], exclude: [] }]);
    for (const g of [null, 5, 'x', [], undefined]) assert.deepEqual(validateConfig(g), DEFAULT_BUCKETS);
});

test('exclusivity property', () => {
    const ids = ['a', 'b', 'c'];
    const bs = ['steam-store', 'web-scraping', 'none', 'x'];
    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    for (let i = 0; i < 300; i++) {
        const rules = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({ id: pick(ids), name: 'n', bucket: pick(bs) }));
        const seen = validateConfig({ rules }).rules.map((a) => a.id);
        assert.equal(new Set(seen).size, seen.length);
    }
});
