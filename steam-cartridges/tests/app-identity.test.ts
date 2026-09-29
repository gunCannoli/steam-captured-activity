import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, type IdentityDeps } from '../frontend/app/identity.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { toGameId, toShortcutId } from '../frontend/kernel/appid.ts';
import type { ShortcutId } from '../frontend/kernel/appid.ts';

const A = toShortcutId(0x8000_0001)!;

function setup(ensureFresh: IdentityDeps['backend']['ensureFresh'], now = () => 0) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: A, gameid: toGameId(A), title: 'Some Game', exe: '' });
    const identity = createIdentity({
        backend: { ensureFresh },
        records,
        owned: () => [],
        titleOf: () => 'Some Game',
        now,
    });
    return { identity, records };
}

test('not steam-store -> unsupported without a call', async () => {
    let calls = 0;
    const { identity, records } = setup(async () => { calls++; return { appid: A, parts: {} }; });
    const part = await identity.ensure(A, { bucket: 'web-scraping', via: 'default' });
    assert.equal(part.status, 'unsupported');
    assert.equal(calls, 0);
    assert.equal(records.get(A)?.identity?.status, 'unsupported');
});

test('memo per session: a second ensure for the same appid does not call the backend again', async () => {
    let calls = 0;
    const { identity } = setup(async () => {
        calls++;
        return { appid: A, parts: { identity: { status: 'ok', data: { native: { appid: 435150, source: 'search' } } } } };
    });
    const first = await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    const second = await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 1);
    assert.deepEqual(second, first);
});

test('pending is not memoised: a later ensure calls the backend again', async () => {
    let calls = 0;
    const { identity } = setup(async () => {
        calls++;
        return { appid: A, parts: { identity: { status: 'pending' } } };
    });
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 2);
});

test('error is retried only after 5 minutes', async () => {
    let calls = 0;
    let now = 0;
    const { identity } = setup(async () => {
        calls++;
        return { appid: A, parts: { identity: { status: 'error', message: 'boom' } } };
    }, () => now);
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 1);
    now = 60_000; // 1 minute later: still within the 5-minute retry window
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 1, 'not retried before 5 minutes');
    now = 5 * 60_000 + 1;
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 2, 'retried after 5 minutes');
});

test('invalidate re-resolves on the next ensure', async () => {
    let calls = 0;
    const { identity } = setup(async () => {
        calls++;
        return { appid: A, parts: { identity: { status: 'ok', data: { native: { appid: calls, source: 'manual' } } } } };
    });
    const first = await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    identity.invalidate(A);
    const second = await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 2);
    assert.notDeepEqual(second, first);
});
