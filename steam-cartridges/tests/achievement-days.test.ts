// surfaces/captures/achievement-days (ADR-0056): unlocks as activity days, for every source with an unlock time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievementDays } from '../frontend/surfaces/captures/achievement-days.ts';

const DAY = 86400;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY; // UTC days are enough for the test
const schema = (ids: string[]) => ({
    native_appid: 0,
    total: ids.length,
    achievements: ids.map((id) => ({ id, name: `N${id}`, description: `D${id}`, icon: `I${id}`, global_pct: 12.5 })),
});

test('activity achievements: unlocks grouped by day, newest day first, newest unlock first', () => {
    const set = {
        schema: schema(['a', 'b', 'c']),
        unlocks: { a: { unlocked_time: 10 * DAY + 100 }, b: { unlocked_time: 10 * DAY + 500 }, c: { unlocked_time: 12 * DAY + 1 } },
    };
    const days = achievementDays(set as any, dayOf);
    assert.deepEqual(days.map((d) => d.day), [12 * DAY, 10 * DAY]);
    assert.deepEqual(days[1]!.items.map((i) => i.id), ['b', 'a']);
    assert.equal(days[1]!.latest, 10 * DAY + 500);
    assert.equal(days[1]!.oldest, 10 * DAY + 100);
    assert.deepEqual(days[0]!.items[0], { id: 'c', name: 'Nc', description: 'Dc', icon: 'Ic', globalPct: 12.5, unlockedAt: 12 * DAY + 1 });
});

test('activity achievements: an unlock with no time, or not in the schema, is left out', () => {
    const set = { schema: schema(['a']), unlocks: { a: { unlocked_time: 0 }, ghost: { unlocked_time: 5 * DAY } } };
    assert.deepEqual(achievementDays(set as any, dayOf), []);
});

test('activity achievements: no set, no schema or an empty unlock map gives no days', () => {
    assert.deepEqual(achievementDays(undefined, dayOf), []);
    assert.deepEqual(achievementDays({ schema: schema(['a']), unlocks: {} } as any, dayOf), []);
    assert.deepEqual(achievementDays({ unlocks: { a: { unlocked_time: 1 } } } as any, dayOf), []);
});

test('activity achievements: a schema id stored as a number still matches its unlock key', () => {
    const set = { schema: { native_appid: 0, total: 1, achievements: [{ id: 2304, name: 'All Exits', description: '', icon: '', global_pct: 0 }] }, unlocks: { '2304': { unlocked_time: 1790471689 } } };
    const days = achievementDays(set as any, dayOf);
    assert.equal(days.length, 1);
    assert.equal(days[0]!.items[0]!.id, '2304');
});
