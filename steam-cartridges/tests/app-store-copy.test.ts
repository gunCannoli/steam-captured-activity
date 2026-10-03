// app/store-copy (ADR-0056): one EnsureFresh(["store"]) per shortcut per session, with the store switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStoreCopy } from '../frontend/app/store-copy.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';

const SC = 4263274102 as any;
const ROUTE = { bucket: 'steam-store', via: 'default' } as const;

function setup(answer: any, stores = { epic: true, xbox: true }) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const calls: any[] = [];
    const copy = createStoreCopy({
        backend: { async ensureFresh(appid: number, parts: string[], ctx: any) { calls.push({ appid, parts, ctx }); return { appid, parts: { store: answer } }; } } as any,
        records,
        ensureBase: () => {},
        titleOf: () => 'Game',
        stores: () => stores,
    });
    return { copy, records, calls };
}

test('store copy: asks for the store part with the store switches and puts it in the record', async () => {
    const s = setup({ status: 'ok', source: 'epic', data: { kind: 'epic', namespace: 'ns', via: 'manifest' } }, { epic: true, xbox: false });
    const part = await s.copy.ensure(SC, ROUTE);
    assert.equal(part.data?.kind, 'epic');
    assert.deepEqual(s.calls[0].parts, ['store']);
    assert.equal(s.calls[0].ctx.allowEpic, true);
    assert.equal(s.calls[0].ctx.allowXbox, false);
    assert.equal(s.records.get(SC)?.store?.data?.namespace, 'ns');
    assert.equal(s.copy.isCopy(SC), true);
});

test('store copy: a final answer is asked once per session', async () => {
    const s = setup({ status: 'unsupported' });
    await s.copy.ensure(SC, ROUTE);
    await s.copy.ensure(SC, ROUTE);
    assert.equal(s.calls.length, 1);
    assert.equal(s.copy.isCopy(SC), false);
});

test('store copy: a backend error is an error part, asked again next time', async () => {
    const s = setup(undefined);
    const part = await s.copy.ensure(SC, ROUTE);
    assert.equal(part.status, 'error');
    await s.copy.ensure(SC, ROUTE);
    assert.equal(s.calls.length, 2);
});
