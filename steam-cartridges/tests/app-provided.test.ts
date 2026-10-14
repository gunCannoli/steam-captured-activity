// app/provided and the extension API's pushes (ADR-0067): a pushed game reaches the backend and the record, a changed
// push refreshes Game Info and media, forgetGame drops it, and a push never throws into the extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createProvided } from '../frontend/app/provided.ts';
import { createExtensionRegistry } from '../frontend/kernel/extensions.ts';

const SC = 4263274102;

function setup(answer: { ok?: boolean; changed?: boolean; error?: string } = { ok: true, changed: true }) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    records.upsert({ appid: SC, gameid: 'g', title: 'Game', exe: '' });
    const calls: any[] = [];
    const refreshed: number[] = [];
    const provided = createProvided({
        backend: {
            async provideGame(appid: number, game: any) { calls.push(['provide', appid, game]); return answer; },
            async forgetProvidedGame(appid: number) { calls.push(['forget', appid]); return { ok: true }; },
            async getAllRecords() {
                return { records: { [String(SC)]: { provided: { status: 'ok', source: 'xbox', data: { source: 'xbox', title: 'Jigsaw' } } }, '7': {} } };
            },
        } as any,
        records,
        ensureBase: () => {},
        refresh: (appid) => refreshed.push(appid),
    });
    return { provided, records, calls, refreshed };
}

test('reportGame keeps the game in the backend and the record, and refreshes Game Info and media when it changed', async () => {
    const s = setup();
    const res = await s.provided.reportGame(SC, { source: 'epic', title: 'Jotunnslayer', metadata: { title: 'Jotunnslayer' } }, { providerId: 'steam-cartridges-third-party' });
    assert.deepEqual(res, { ok: true, changed: true });
    assert.equal(s.calls[0][2].provider, 'steam-cartridges-third-party');
    assert.equal(s.calls[0][2].source, 'epic');
    assert.equal(s.records.get(SC)?.provided?.status, 'ok');
    assert.equal(s.records.get(SC)?.provided?.data?.source, 'epic');
    assert.deepEqual(s.refreshed, [SC]);
});

test('an unchanged push refreshes nothing', async () => {
    const s = setup({ ok: true, changed: false });
    await s.provided.reportGame(SC, { source: 'epic' }, { providerId: 'x' });
    assert.deepEqual(s.refreshed, []);
});

test('a push needs a shortcut and a source; a refused push leaves the record alone', async () => {
    const s = setup({ error: 'no' });
    assert.deepEqual(await s.provided.reportGame(440, { source: 'epic' }, { providerId: 'x' }), { ok: false });
    assert.deepEqual(await s.provided.reportGame(SC, { source: '' } as any, { providerId: 'x' }), { ok: false });
    assert.deepEqual(await s.provided.reportGame(SC, { source: 'epic' }, { providerId: 'x' }), { ok: false });
    assert.equal(s.records.get(SC)?.provided, undefined);
});

test('forgetGame drops what was pushed', async () => {
    const s = setup();
    await s.provided.reportGame(SC, { source: 'epic' }, { providerId: 'x' });
    assert.deepEqual(await s.provided.forgetGame(SC, { providerId: 'x' }), { ok: true });
    assert.equal(s.records.get(SC)?.provided?.status, 'unsupported');
});

test('preload puts every pushed part into its record (disk only)', async () => {
    const s = setup();
    assert.equal(await s.provided.preload(), 1);
    assert.equal(s.records.get(SC)?.provided?.data?.title, 'Jigsaw');
});

test('the extension API forwards pushes to its sink, and a failing sink never throws into the extension', async () => {
    const seen: string[] = [];
    const api = createExtensionRegistry({
        reportGame: async () => { seen.push('game'); return { ok: true, changed: true }; },
        reportAchievementSet: async () => { throw new Error('boom'); },
        forgetGame: () => { throw new Error('sync boom'); },
    });
    assert.equal(api.version, '1.2.0');
    assert.deepEqual(await api.reportGame(SC, { source: 'epic' }, { providerId: 'x' }), { ok: true, changed: true });
    assert.deepEqual(await api.reportAchievementSet(SC, { source: 'epic', key: 'k', achievements: [], unlocks: {} }, { providerId: 'x' }), { ok: false, new: [] });
    assert.deepEqual(await api.forgetGame(SC, { providerId: 'x' }), { ok: false });
    assert.deepEqual(await createExtensionRegistry().reportGame(SC, { source: 'epic' }, { providerId: 'x' }), { ok: false });
    assert.deepEqual(seen, ['game']);
});
