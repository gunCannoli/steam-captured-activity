import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAchievementProgress,
    getAchievementsAction,
    buildSteamAchievements,
} from '../frontend/surfaces/achievements/core.ts';
import type { AchievementSchemaRecord } from '../frontend/rpc.ts';

const mockSchema: AchievementSchemaRecord = {
    native_appid: 2820820,
    total: 3,
    achievements: [
        {
            id: 'ACH_A',
            name: 'Achievement A',
            description: 'Description A',
            icon: 'https://example.com/a.jpg',
            global_pct: 15.5,
        },
        {
            id: 'ACH_B',
            name: 'Achievement B',
            description: 'Description B',
            icon: 'https://example.com/b.jpg',
            global_pct: 55.0,
        },
        {
            id: 'ACH_C',
            name: 'Achievement C',
            description: 'Description C',
            icon: 'https://example.com/c.jpg',
            global_pct: 5.2,
        },
    ],
};

test('buildSteamAchievements: returns null on missing or empty schema', () => {
    assert.equal(buildSteamAchievements(undefined), null);
    assert.equal(
        buildSteamAchievements({ native_appid: 1, total: 0, achievements: [] }),
        null,
    );
});

test('buildSteamAchievements: correctly splits achieved and unachieved', () => {
    const unlocks = {
        ACH_A: { unlocked_time: 1000 },
        ACH_C: { unlocked_time: 2000 },
    };

    const res = buildSteamAchievements(mockSchema, unlocks);
    assert.ok(res);
    assert.equal(res.nTotal, 3);
    assert.equal(res.nAchieved, 2);

    // Achieved should be sorted by rtUnlocked descending (ACH_C then ACH_A)
    assert.equal(res.vecAchieved.length, 2);
    assert.equal(res.vecAchieved[0].strID, 'ACH_C');
    assert.equal(res.vecAchieved[0].bAchieved, true);
    assert.equal(res.vecAchieved[0].rtUnlocked, 2000);
    assert.equal(res.vecAchieved[1].strID, 'ACH_A');
    assert.equal(res.vecAchieved[1].bAchieved, true);
    assert.equal(res.vecAchieved[1].rtUnlocked, 1000);

    // Unachieved should be sorted by global rarity % descending (ACH_B)
    assert.equal(res.vecUnachieved.length, 1);
    assert.equal(res.vecUnachieved[0].strID, 'ACH_B');
    assert.equal(res.vecUnachieved[0].bAchieved, false);

    // Highlights should reflect top achieved items (up to 5)
    assert.equal(res.vecHighlight.length, 2);
    assert.equal(res.vecHighlight[0].strID, 'ACH_C');
    assert.equal(res.vecHighlight[1].strID, 'ACH_A');
});

test('buildSteamAchievements: zero unlocks provides empty highlights without null', () => {
    const res = buildSteamAchievements(mockSchema, {});
    assert.ok(res);
    assert.equal(res.nTotal, 3);
    assert.equal(res.nAchieved, 0);
    assert.deepEqual(res.vecHighlight, []);
    assert.deepEqual(res.vecAchieved, []);
    assert.equal(res.vecUnachieved.length, 3);

    // Sorted by global rarity descending: ACH_B (55.0%), ACH_A (15.5%), ACH_C (5.2%)
    assert.equal(res.vecUnachieved[0].strID, 'ACH_B');
    assert.equal(res.vecUnachieved[1].strID, 'ACH_A');
    assert.equal(res.vecUnachieved[2].strID, 'ACH_C');
});

test('buildAchievementProgress: an entry in the shape of Steam\'s progress cache (ADR-0045)', () => {
    assert.equal(buildAchievementProgress(null, 4000000000, 1700000000), null);

    const partial = buildSteamAchievements(mockSchema, { ACH_A: { unlocked_time: 100 } });
    assert.deepEqual(buildAchievementProgress(partial, 4000000000, 1700000000), {
        appid: 4000000000,
        unlocked: 1,
        total: 3,
        percentage: (1 / 3) * 100,
        all_unlocked: false,
        cache_time: 1700000000,
        vetted: true,
    });

    const full = buildSteamAchievements(mockSchema, {
        ACH_A: { unlocked_time: 100 },
        ACH_B: { unlocked_time: 200 },
        ACH_C: { unlocked_time: 300 },
    });
    assert.deepEqual(buildAchievementProgress(full, -294967296, 1700000001), {
        appid: -294967296,
        unlocked: 3,
        total: 3,
        percentage: 100,
        all_unlocked: true,
        cache_time: 1700000001,
        vetted: true,
    });
});

test('GetAchievements: a Steam app always goes to Steam', () => {
    assert.equal(getAchievementsAction({ isShortcut: false, hasLocal: false, hasDetails: false }), 'original');
    assert.equal(getAchievementsAction({ isShortcut: false, hasLocal: true, hasDetails: true }), 'original');
});

test('GetAchievements: a shortcut with our achievements gets them', () => {
    assert.equal(getAchievementsAction({ isShortcut: true, hasLocal: true, hasDetails: false }), 'local');
});

test('GetAchievements: a shortcut with nothing (details null) is answered without calling Steam (K19)', () => {
    assert.equal(getAchievementsAction({ isShortcut: true, hasLocal: false, hasDetails: false }), 'undefined');
});

test('GetAchievements: a shortcut whose details Steam did set is left to Steam', () => {
    assert.equal(getAchievementsAction({ isShortcut: true, hasLocal: false, hasDetails: true }), 'original');
});

test('buildSteamAchievements: an empty achievements list that arrives as {} (K1) gives null, not a throw', () => {
    const empty = { ...mockSchema, total: 0, achievements: {} } as unknown as AchievementSchemaRecord;
    assert.equal(buildSteamAchievements(empty, {}), null);
    const asObject = { ...mockSchema, achievements: { 0: mockSchema.achievements[0] } } as unknown as AchievementSchemaRecord;
    assert.equal(buildSteamAchievements(asObject, {})?.nTotal, mockSchema.total || 1);
});
