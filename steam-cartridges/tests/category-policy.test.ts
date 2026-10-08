import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MANAGED_CATEGORY_IDS,
    PORTABLE_CATEGORY_IDS,
    STEAM_ONLY_CATEGORY_IDS,
    badgeCategoryIds,
    inferredControllerIds,
    portableCategoryIds,
} from '../frontend/domain/category-policy.ts';

test('allow and deny lists are disjoint; managed covers both; 22 is portable (written when the record has achievements)', () => {
    for (const id of STEAM_ONLY_CATEGORY_IDS) assert.equal(PORTABLE_CATEGORY_IDS.includes(id), false, `${id} is Steam-only`);
    for (const id of [...PORTABLE_CATEGORY_IDS, ...STEAM_ONLY_CATEGORY_IDS]) assert.ok(MANAGED_CATEGORY_IDS.includes(id));
    // 22 (Achievements) is now portable: the plugin writes it when the record has real achievements.
    assert.ok(PORTABLE_CATEGORY_IDS.includes(22), '22 must be in PORTABLE_CATEGORY_IDS');
    assert.ok(!STEAM_ONLY_CATEGORY_IDS.includes(22), '22 must not be in STEAM_ONLY_CATEGORY_IDS');
});

test('Jotunnslayer (2820820): player + controller ids port, Steam-licence services do not', () => {
    // StoreItemCache groups, live 2026-09-25.
    const supported = [2, 1, 9, 39, 24];
    const licenceServices = [29, 23, 44, 62]; // Trading Cards, Cloud, Remote Play Together, Family Sharing (no longer includes 22)
    const controller = [28];
    assert.deepEqual(badgeCategoryIds({ store_category_ids: [...supported, ...controller] }), [1, 2, 9, 24, 28, 39]);
    assert.deepEqual(portableCategoryIds(licenceServices), [], 'the licence-service group is dropped');
    assert.deepEqual(portableCategoryIds([...STEAM_ONLY_CATEGORY_IDS, 28, 28, '2', null]), [28]);
});

test('Steam ids win over flags; flags never map remote_play_together', () => {
    const categories = { single_player: true, remote_play_together: true, full_controller: false };
    assert.deepEqual(badgeCategoryIds({ categories }), [2]);
    assert.deepEqual(badgeCategoryIds({ categories, store_category_ids: [1, 59, 22] }), [1, 22], 'store ids replace the flags; 22 passes through verbatim');
    assert.deepEqual(badgeCategoryIds({ categories, store_category_ids: [] }), [], 'an empty Steam answer is an answer');
});

test('achievements tag (22): injected via opts.hasAchievements for non-store sources; not re-injected on top of store_category_ids', () => {
    // Non-store: hasAchievements=true adds 22.
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }, {}, { hasAchievements: true }), [2, 22]);
    // No achievements: 22 is not added.
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }, {}, { hasAchievements: false }), [2]);
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }), [2]);
    // Steam Store source: hasAchievements does not add 22 on top (store ids are used verbatim).
    assert.deepEqual(badgeCategoryIds({ store_category_ids: [2] }, {}, { hasAchievements: true }), [2], 'store ids bypass hasAchievements');
    // 22 portableCategoryIds-passes through when the store included it.
    assert.deepEqual(badgeCategoryIds({ store_category_ids: [2, 22] }, {}, { hasAchievements: false }), [2, 22]);
});

test('split-screen (24) and co-op (9) are independent; Shared/Split Screen Co-op (39) only when both', () => {
    // split_screen alone → 24 only (e.g. Super Mario Kart: competitive split-screen racing).
    assert.deepEqual(badgeCategoryIds({ categories: { split_screen: true } }), [24]);
    // coop alone → 9 only.
    assert.deepEqual(badgeCategoryIds({ categories: { coop: true } }), [9]);
    // both → 9, 24, and 39 (Shared/Split Screen Co-op).
    assert.deepEqual(badgeCategoryIds({ categories: { coop: true, split_screen: true } }), [9, 24, 39]);
    // split_screen + achievements, no coop → 22 and 24 only.
    assert.deepEqual(badgeCategoryIds({ categories: { split_screen: true } }, {}, { hasAchievements: true }), [22, 24]);
});

test('Super Mario Kart scenario: split_screen+multiplayer+achievements → [1, 2, 22, 24, 28] (no coop tag — racing, not co-op)', () => {
    // Actual stored metadata: single_player, multiplayer, split_screen=true, coop=false.
    // Achievements: 47 total (RetroAchievements ra_232). No Steam Store mapping (emulated SNES).
    const meta = { categories: { single_player: true, multiplayer: true, split_screen: true, coop: false, full_controller: true } };
    assert.deepEqual(
        badgeCategoryIds(meta, { inferred: true }, { hasAchievements: true }),
        [1, 2, 22, 24, 28],
        'Super Mario Kart: Single-player, Multiplayer, Achievements, Shared/Split Screen, Full Controller — no Co-op (competitive racing)',
    );
});

test('local flags keep the player mapping; their controller flags are not data', () => {
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

test('a manual controller override beats every source, Steam Store data included, and leaves the other badges alone', () => {
    const mapped = { source: 'steam-store', store_category_ids: [2, 28] };
    assert.deepEqual(badgeCategoryIds(mapped, { override: 'none' }), [2]);
    assert.deepEqual(badgeCategoryIds(mapped, { override: 'partial' }), [2, 18]);
    assert.deepEqual(badgeCategoryIds({ store_category_ids: [1, 2, 9] }, { override: 'full', inferred: false }), [1, 2, 9, 28]);
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }, { override: 'full' }), [2, 28]);
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }, { override: 'none', inferred: true }), [2]);
    // auto and unset fall back to the usual order.
    assert.deepEqual(badgeCategoryIds(mapped, { override: 'auto' }), [2, 28]);
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }, { override: 'auto', inferred: true }), [2, 28]);
    // Override does not remove the achievements tag.
    assert.deepEqual(badgeCategoryIds({ categories: { single_player: true } }, { override: 'none' }, { hasAchievements: true }), [2, 22]);
});
