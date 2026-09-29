import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouting, type RoutingInputs } from '../frontend/app/routing.ts';
import { DEFAULT_BUCKETS, type BucketsConfig } from '../frontend/domain/routing/policy.ts';
import { ruleAllows } from './architecture.test.ts';

const A = 0x8000_0001, B = 0x8000_0002;

function makeInputs(over: Partial<RoutingInputs> = {}): RoutingInputs {
    const cfg: BucketsConfig = { ...DEFAULT_BUCKETS, rules: [{ id: 'steam', name: 'steam', bucket: 'steam-store', include: [], exclude: [] }] };
    let ready = true;
    const collections = [{ id: 'steam', displayName: 'steam', bIsDynamic: false, apps: new Map([[A, {}]]) }];
    return {
        buckets: () => cfg,
        autoMode: () => false,
        collections: { ready: () => ready, list: () => (ready ? collections : undefined) },
        titleOf: () => undefined,
        shortcuts: () => [{ appid: A, name: 'A' }, { appid: B, name: 'B' }],
        loadProfiles: async () => ({}),
        metadataAppids: () => [],
        ...over,
        // allow the test to toggle `ready` through the returned inputs object
    };
}

test('a resolved bucket is memoised and survives a membership change', () => {
    let members: number[] = [A];
    const collections = [{ id: 'steam', displayName: 'steam', bIsDynamic: false, get apps() { return new Map(members.map((m) => [m, {}])); } }];
    const routing = createRouting(makeInputs({ collections: { ready: () => true, list: () => collections } }));
    const first = routing.getBucket(A);
    assert.equal(first.bucket, 'steam-store');
    members = [];
    assert.deepEqual(routing.getBucket(A), first, 'memoised: membership change alone does not re-resolve');
});

test("'pending' (collections not ready, rules present) is not memoised", () => {
    let ready = false;
    const routing = createRouting(makeInputs({ collections: { ready: () => ready, list: () => (ready ? [] : undefined) } }));
    assert.deepEqual(routing.getBucket(A), { bucket: 'none', via: 'pending' });
    ready = true;
    const resolved = routing.getBucket(A);
    assert.notEqual(resolved.via, 'pending', 'once ready, the same appid resolves for real (was never memoised as pending)');
});

test('onBucketsChanged() clears the memo', () => {
    const routing = createRouting(makeInputs());
    const before = routing.getBucket(A);
    let calledBack = false;
    routing.onBucketsChanged(() => {
        calledBack = true;
    });
    assert.ok(calledBack);
    const after = routing.getBucket(A);
    assert.deepEqual(after, before, 'same inputs still resolve the same way after the memo clears');
});

test("bucketReport() returns ready: false and only games before collections are ready", () => {
    const routing = createRouting(makeInputs({ collections: { ready: () => false, list: () => undefined } }));
    const report = routing.bucketReport();
    assert.equal(report.ready, false);
    assert.deepEqual(report.collections, []);
    assert.deepEqual(report.conflicts, []);
    assert.deepEqual(report.missing, []);
    assert.equal(report.unbucketedWithMetadata, 0);
    assert.deepEqual(Object.keys(report.games).map(Number).sort(), [A, B].sort());
});

test('layer rule: app may import domain, not steam', () => {
    assert.ok(ruleAllows('app -> domain'));
    assert.ok(!ruleAllows('app -> steam'));
});
