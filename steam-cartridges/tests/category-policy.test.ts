import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MANAGED_CATEGORY_IDS,
    PORTABLE_CATEGORY_IDS,
    STEAM_ONLY_CATEGORY_IDS,
    badgeCategoryIds,
    inferredControllerIds,
    portableCategoryIds,
} from '../frontend/surfaces/game-info/category-policy.ts';

test('allow and deny lists are disjoint; managed covers both', () => {
    for (const id of STEAM_ONLY_CATEGORY_IDS) assert.equal(PORTABLE_CATEGORY_IDS.includes(id), false, `${id} is Steam-only`);
    for (const id of [...PORTABLE_CATEGORY_IDS, ...STEAM_ONLY_CATEGORY_IDS]) assert.ok(MANAGED_CATEGORY_IDS.includes(id));
});

test('Jotunnslayer (2820820): player + controller ids port, Steam features do not', () => {
    // StoreItemCache groups, live 2026-09-25.
    const supported = [2, 1, 9, 39, 24];
    const features = [22, 29, 23, 44, 62];
    const controller = [28];
    assert.deepEqual(badgeCategoryIds({ store_category_ids: [...supported, ...controller] }), [1, 2, 9, 24, 28, 39]);
    assert.deepEqual(portableCategoryIds(features), [], 'the whole feature group is dropped');
    assert.deepEqual(portableCategoryIds([...STEAM_ONLY_CATEGORY_IDS, 28, 28, '2', null]), [28]);
});

test('Steam ids win over flags; flags never map achievements or Remote Play Together', () => {
    const categories = { single_player: true, achievements: true, remote_play_together: true, full_controller: false };
    assert.deepEqual(badgeCategoryIds({ categories }), [2]);
    assert.deepEqual(badgeCategoryIds({ categories, store_category_ids: [1, 59, 22] }), [1], 'store ids replace the flags');
    assert.deepEqual(badgeCategoryIds({ categories, store_category_ids: [] }), [], 'an empty Steam answer is an answer');
});

test('local flags keep the player mapping (split-screen co-op is 39); their controller flags are not data', () => {
    assert.deepEqual(badgeCategoryIds({ categories: { coop: true, split_screen: true } }), [9, 24, 39]);
    assert.deepEqual(badgeCategoryIds({ categories: { full_controller: true, partial_controller: true } }), []);
    assert.deepEqual(badgeCategoryIds({}), []);
});

test('controller precedence: Steam Store data > emulator inference > default setting > no badge (ADR-0038 addendum)', () => {
    // IGDB and the fallback record always write full_controller: true.
    const local = { categories: { single_player: true, full_controller: true } };
    // 1. Steam Store data wins over the inference and the setting, both ways.
    assert.deepEqual(badgeCategoryIds({ ...local, store_category_ids: [2] }, { inferred: true, defaultFull: true }), [2]);
    assert.deepEqual(badgeCategoryIds({ ...local, store_category_ids: [2, 28] }, { inferred: false, defaultFull: false }), [2, 28]);
    const appdetails = { source: 'steam-store', categories: { single_player: true, full_controller: false, partial_controller: true } };
    assert.deepEqual(badgeCategoryIds(appdetails, { inferred: true, defaultFull: true }), [2, 18]);
    assert.deepEqual(badgeCategoryIds({ ...appdetails, categories: { full_controller: true } }, { inferred: false }), [28]);
    // 2. The emulator decides before the setting, both ways.
    assert.deepEqual(badgeCategoryIds(local, { inferred: true, defaultFull: false }), [2, 28]);
    assert.deepEqual(badgeCategoryIds(local, { inferred: false, defaultFull: true }), [2]);
    // 3. The setting, only when nothing was inferred.
    assert.deepEqual(badgeCategoryIds(local, { defaultFull: true }), [2, 28]);
    // 4. Otherwise no badge.
    assert.deepEqual(badgeCategoryIds(local, { defaultFull: false }), [2]);
    assert.deepEqual(badgeCategoryIds(local), [2]);
    assert.deepEqual(inferredControllerIds(), []);
});
