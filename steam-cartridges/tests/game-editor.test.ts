import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameEditor } from '../frontend/app/game-editor.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { draftOf } from '../frontend/domain/metadata-edit.ts';

const SC = 4263274102 as any;
const ROUTE = { bucket: 'web-scraping', via: 'default' } as const;

function setup(over: { metadata?: any; mapping?: any; saveResponse?: any } = {}) {
    const bus = createEventBus();
    const records = createRecordStore(bus);
    const ensureBase = () => records.upsert({ appid: SC, gameid: 'g', title: 'AM2R', exe: '' });
    ensureBase();
    if (over.metadata) records.update(SC, { metadata: { status: 'ok', data: over.metadata, source: 'igdb' } });
    const events: any[] = [];
    bus.on('record.updated', (e: any) => events.push(e));
    const calls: any[] = [];
    const editor = createGameEditor({
        backend: {
            async saveCustomMetadata(appid: number, metadata: any) {
                calls.push(['save', appid, metadata]);
                return over.saveResponse ?? { part: { status: 'ok', source: 'custom', data: { ...metadata, custom_override: true } } };
            },
            async clearCustomMetadata(appid: number) {
                calls.push(['clear', appid]);
                return { removed: true };
            },
            async steamStoreSearchCandidates(term: string) {
                calls.push(['search', term]);
                return { candidates: [{ steam_appid: 1, name: 'A' }] };
            },
            async steamStoreGetMapping() {
                return { mapping: over.mapping ?? null, rejected: [7], applied: null };
            },
            async igdbSearch(query: string) {
                calls.push(['igdbSearch', query]);
                return { candidates: [{ id: 38387, name: 'Super Bomberman 5' }] };
            },
            async igdbLink(appid: number, igdb_id: number, title?: string) {
                calls.push(['igdbLink', appid, igdb_id, title]);
                return { ok: true, metadata: { appid, title: title ?? 'Linked', igdb_id } };
            },
        } as any,
        records,
        ensureBase,
        titleOf: () => 'AM2R',
        routeOf: () => ROUTE,
        metadata: {
            async ensure(appid: any, route: any, identity: any) {
                calls.push(['ensure', appid, route, identity]);
                const part = { status: 'ok', source: 'igdb', data: { appid, title: 'Fetched' } } as any;
                records.update(SC, { metadata: part });
                return part;
            },
        },
        steamStore: {
            async setMapping(appid: number, steamAppid: number, name?: string) {
                calls.push(['link', appid, steamAppid, name]);
                return { mapping: {} };
            },
            async clear(appid: number, reject: boolean) {
                calls.push(['unlink', appid, reject]);
                return {};
            },
        },
    });
    return { editor, records, calls, events };
}

test('load: current metadata, custom flag, link and rejections', async () => {
    const { editor } = setup({ metadata: { appid: SC, title: 'AM2R', custom_override: true }, mapping: { steam_appid: 5, name: 'X', source: 'manual' } });
    const snap = await editor.load(SC);
    assert.equal(snap.hasMetadata, true);
    assert.equal(snap.custom, true);
    assert.equal(snap.link?.steam_appid, 5);
    assert.deepEqual(snap.rejected, [7]);
});

test('load without metadata gives a bare record to edit from scratch', async () => {
    const { editor } = setup();
    const snap = await editor.load(SC);
    assert.equal(snap.hasMetadata, false);
    assert.deepEqual(snap.metadata, { appid: SC, title: 'AM2R' });
    assert.equal(snap.link, null);
});

test('save: applies the draft to the current record, sends it, puts the custom part in the record', async () => {
    const orig = { appid: SC, title: 'AM2R', description: 'old', igdb_id: 9, source: 'igdb' };
    const { editor, records, calls, events } = setup({ metadata: orig });
    await editor.save(SC, { ...draftOf(orig), description: 'new' });
    const sent = calls.find((c) => c[0] === 'save')!;
    assert.equal(sent[2].description, 'new');
    assert.equal(sent[2].igdb_id, 9);
    assert.equal(records.get(SC)?.metadata?.source, 'custom');
    assert.equal(records.get(SC)?.metadata?.data?.description, 'new');
    assert.deepEqual(events.at(-1).parts, ['metadata']);
});

test('save: an invalid draft throws before any backend call', async () => {
    const { editor, calls } = setup({ metadata: { appid: SC, title: 'AM2R' } });
    await assert.rejects(editor.save(SC, { ...draftOf({ title: 'AM2R' }), title: '' }), /Title is required/);
    assert.equal(calls.length, 0);
});

test('save: a backend error throws and leaves the record alone', async () => {
    const orig = { appid: SC, title: 'AM2R' };
    const { editor, records } = setup({ metadata: orig, saveResponse: { error: 'not a shortcut' } });
    await assert.rejects(editor.save(SC, { ...draftOf(orig), description: 'x' }), /not a shortcut/);
    assert.equal(records.get(SC)?.metadata?.source, 'igdb');
});

test('revert: clears the override, then re-resolves with the current route and identity', async () => {
    const { editor, records, calls } = setup({ metadata: { appid: SC, title: 'Mine', custom_override: true } });
    await editor.revert(SC);
    assert.deepEqual(calls.map((c) => c[0]), ['clear', 'ensure']);
    assert.deepEqual(calls[1][2], ROUTE);
    assert.equal(records.get(SC)?.metadata?.data?.title, 'Fetched');
});

test('link / unlink go through app/steam-store; search is read-only', async () => {
    const { editor, calls } = setup();
    assert.deepEqual(await editor.link(SC, 2820820, 'Jotunnslayer'), { error: undefined });
    await editor.unlink(SC, true);
    const found = await editor.search('doom');
    assert.equal(found.candidates.length, 1);
    assert.deepEqual(calls, [['link', SC, 2820820, 'Jotunnslayer'], ['unlink', SC, true], ['search', 'doom']]);
});

test('a native appid is refused', async () => {
    const { editor } = setup();
    await assert.rejects(editor.load(12345), /Not a non-Steam shortcut/);
});

test('searchIgdb and linkIgdb go through backend and update record', async () => {
    const { editor, records, calls } = setup();
    const found = await editor.searchIgdb('Super Bomberman');
    assert.equal(found.candidates.length, 1);
    assert.equal(found.candidates[0]!.id, 38387);
    const linkRes = await editor.linkIgdb(SC, 38387, 'Super Bomberman 5');
    assert.deepEqual(linkRes, {});
    assert.equal(records.get(SC)?.metadata?.data?.igdb_id, 38387);
    assert.deepEqual(calls.filter((c) => c[0] === 'igdbSearch' || c[0] === 'igdbLink'), [
        ['igdbSearch', 'Super Bomberman'],
        ['igdbLink', SC, 38387, 'Super Bomberman 5'],
    ]);
});

