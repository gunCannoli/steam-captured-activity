import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, type IdentityDeps } from '../frontend/app/identity.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { toGameId, toShortcutId } from '../frontend/kernel/appid.ts';
import type { ShortcutId } from '../frontend/kernel/appid.ts';

const A = toShortcutId(0x8000_0001)!;

function setup(ensureFresh: IdentityDeps['backend']['ensureFresh']) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: A, gameid: toGameId(A), title: 'Some Game', exe: '' });
    const identity = createIdentity({
        backend: { ensureFresh },
        records,
        owned: () => [],
        titleOf: () => 'Some Game',
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

test('an error is not memoised: the next view asks the backend, whose error TTL decides (M10)', async () => {
    let calls = 0;
    const { identity } = setup(async () => {
        calls++;
        return { appid: A, parts: { identity: { status: 'error', message: 'boom' } } };
    });
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    await identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    assert.equal(calls, 2);
});

test('a second view while the lookup is in flight joins it', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { identity } = setup(async () => {
        calls++;
        await gate;
        return { appid: A, parts: { identity: { status: 'ok', data: {} } } };
    });
    const a = identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    const b = identity.ensure(A, { bucket: 'steam-store', via: 'default' });
    release();
    await Promise.all([a, b]);
    assert.equal(calls, 1);
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
