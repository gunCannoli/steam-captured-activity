import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDraft, diff, draftOf, formatDate, listOf, parseDate, playerFlagsOf, splitList, validate } from '../frontend/domain/metadata-edit.ts';

const BASE: any = {
    appid: 4263274102,
    title: 'AM2R',
    description: 'A remake.',
    developers: ['DoctorM64'],
    publishers: {},
    genres: ['Action'],
    release_date: 1630454400, // 2021-09-01
    categories: { single_player: true, multiplayer: false, full_controller: true },
    source: 'igdb',
    igdb_id: 99,
    custom_override: false,
};

test('listOf: arrays pass, the backend empty-list object and junk become []', () => {
    assert.deepEqual(listOf(['a', 'b']), ['a', 'b']);
    assert.deepEqual(listOf({}), []);
    assert.deepEqual(listOf(undefined), []);
    assert.deepEqual(listOf(['a', 3]), ['a']);
});

test('splitList: trims, drops empties and duplicates, splits on ; and newline', () => {
    assert.deepEqual(splitList(' Nintendo Co., Ltd. ;; Sega\nSega '), ['Nintendo Co., Ltd.', 'Sega']);
    assert.deepEqual(splitList(''), []);
});

test('dates: round trip, empty is 0, bad and impossible dates are undefined', () => {
    assert.equal(formatDate(1630454400), '2021-09-01');
    assert.equal(formatDate(0), '');
    assert.equal(formatDate(undefined), '');
    assert.equal(parseDate('2021-09-01'), 1630454400);
    assert.equal(parseDate(''), 0);
    assert.equal(parseDate('2021-02-30'), undefined);
    assert.equal(parseDate('09/01/2021'), undefined);
});

test('draftOf shows the flags Game Info will show: category ids win over the flags', () => {
    assert.deepEqual(playerFlagsOf({ categories: { single_player: true } }), { single_player: true, multiplayer: false, coop: false, split_screen: false });
    assert.deepEqual(playerFlagsOf({ categories: { single_player: true }, store_category_ids: [1, 28] }), { single_player: false, multiplayer: true, coop: false, split_screen: false });
    const d = draftOf(BASE);
    assert.equal(d.developers, 'DoctorM64');
    assert.equal(d.publishers, '');
    assert.equal(d.release_date, '2021-09-01');
});

test('validate: title and dates', () => {
    const d = draftOf(BASE);
    assert.deepEqual(validate(d), []);
    assert.equal(validate({ ...d, title: '  ' }).length, 1);
    assert.equal(validate({ ...d, release_date: 'soon', original_release_date: 'x' }).length, 2);
});

test('diff: empty for an untouched draft, names each changed field', () => {
    const d = draftOf(BASE);
    assert.deepEqual(diff(BASE, d), []);
    assert.deepEqual(diff(BASE, { ...d, description: 'x', players: { ...d.players, coop: true } }), ['description', 'coop']);
});

test('applyDraft keeps fields the form does not show and replaces the edited ones', () => {
    const d = { ...draftOf(BASE), description: '  New text ', publishers: 'A; B', original_release_date: '' };
    const out = applyDraft(BASE, d);
    assert.equal(out.description, 'New text');
    assert.deepEqual(out.publishers, ['A', 'B']);
    assert.equal(out.igdb_id, 99);
    assert.equal(out.source, 'igdb');
    assert.equal(out.categories?.full_controller, true);
    assert.equal('original_release_date' in out, false);
    assert.equal('store_category_ids' in out, false);
    assert.equal(out.release_date, 1630454400);
    assert.deepEqual(BASE.publishers, {}); // the input is not mutated
});

test('applyDraft edits store_category_ids for a changed flag only', () => {
    const steam = { ...BASE, source: 'steam-store', store_category_ids: [2, 28, 38] };
    const d = draftOf(steam);
    const out = applyDraft(steam, { ...d, players: { ...d.players, single_player: false, multiplayer: true } });
    assert.deepEqual(out.store_category_ids, [1, 28, 38]); // 2 removed, 1 added; controller 28 and unmanaged 38 stay
    assert.equal(out.categories?.single_player, false);
    const same = applyDraft(steam, d);
    assert.deepEqual(same.store_category_ids, [2, 28, 38]);
});

test('applyDraft throws on an invalid draft', () => {
    assert.throws(() => applyDraft(BASE, { ...draftOf(BASE), title: '' }), /Title is required/);
});
