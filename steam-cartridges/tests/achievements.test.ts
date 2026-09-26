import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAchievementProgress,
    buildSteamAchievements,
} from '../frontend/features/achievements/achievements-core.ts';
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

test('buildAchievementProgress: computes Big Picture completion payload', () => {
    assert.equal(buildAchievementProgress(null), null);

    const partial = buildSteamAchievements(mockSchema, { ACH_A: { unlocked_time: 100 } });
    assert.deepEqual(buildAchievementProgress(partial), {
        unlocked: 1,
        total: 3,
        all_unlocked: false,
    });

    const full = buildSteamAchievements(mockSchema, {
        ACH_A: { unlocked_time: 100 },
        ACH_B: { unlocked_time: 200 },
        ACH_C: { unlocked_time: 300 },
    });
    assert.deepEqual(buildAchievementProgress(full), {
        unlocked: 3,
        total: 3,
        all_unlocked: true,
    });
});
