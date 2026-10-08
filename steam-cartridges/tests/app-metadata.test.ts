import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetadata } from '../frontend/app/metadata.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';

const SC = 4263274102 as any;

function setup(part: any, controller: any = {}) {
    const records = createRecordStore(createEventBus());
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const metadata = createMetadata({
        backend: {
            async ensureFresh() { return { appid: SC, parts: { metadata: part } }; },
            async getAllRecords() { return { records: { [String(SC)]: { metadata: part } } }; },
        } as any,
        records,
        titleOf: () => 'Game',
        ensureBase: () => records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' }),
        storeItemFor: async () => null,
        allowWeb: () => true,
        allowScreenscraper: () => true,
        controller: () => controller,
    });
    return { metadata, records };
}

test('the metadata part carries the badges the game-info surface writes (decided here, not in the surface)', async () => {
    const { metadata, records } = setup({ status: 'ok', data: { appid: SC, title: 'Game', source: 'igdb', categories: { single_player: true } } }, { inferred: true });
    await metadata.ensure(SC, { bucket: 'web-scraping', via: 'default' }, undefined);
    assert.deepEqual(records.get(SC)?.metadata?.data?.badge_category_ids, [2, 28]);
});

test('preload gives the disk records their badges too; a part without data is left alone', async () => {
    const a = setup({ status: 'ok', data: { appid: SC, title: 'Game', store_category_ids: [2, 22, 28] } });
    await a.metadata.preload();
    // 22 (Achievements) is now in PORTABLE_CATEGORY_IDS: it passes through from store_category_ids.
    assert.deepEqual(a.records.get(SC)?.metadata?.data?.badge_category_ids, [2, 22, 28]);

    const b = setup({ status: 'error', message: 'x' });
    await b.metadata.ensure(SC, { bucket: 'web-scraping', via: 'default' }, undefined);
    assert.equal(b.records.get(SC)?.metadata?.data, undefined);
});
