import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCollectionStoreReady, pendingOr, readUserCollections } from '../frontend/features/buckets/ready.ts';

function fakeStore(getter?: () => unknown) {
    const store: any = { reads: 0, m_mapCollectionsFromStorage: undefined };
    Object.defineProperty(store, 'userCollections', {
        get() {
            store.reads++;
            if (getter) return getter();
            if (!store.m_mapCollectionsFromStorage) throw new TypeError("Cannot read properties of undefined (reading 'values')");
            return [{ id: 'a' }];
        },
    });
    return store;
}

test('not ready: no getter reads', () => {
    const s = fakeStore();
    assert.equal(isCollectionStoreReady(s), false);
    assert.equal(readUserCollections(s), undefined);
    assert.equal(s.reads, 0);
    assert.equal(isCollectionStoreReady(undefined), false);
});

test('ready: list returned', () => {
    const s = fakeStore();
    s.m_mapCollectionsFromStorage = new Map();
    assert.equal(isCollectionStoreReady(s), true);
    assert.deepEqual(readUserCollections(s), [{ id: 'a' }]);
});

test('ready but getter throws: undefined, no throw', () => {
    const s = fakeStore(() => {
        throw new Error('boom');
    });
    s.m_mapCollectionsFromStorage = new Map();
    assert.equal(readUserCollections(s), undefined);
});

test('pendingOr', () => {
    assert.deepEqual(pendingOr(true, false, () => 'x'), { bucket: 'none', via: 'pending' });
    assert.equal(pendingOr(true, true, () => 'x'), 'x');
    assert.equal(pendingOr(false, false, () => 'x'), 'x');
});
