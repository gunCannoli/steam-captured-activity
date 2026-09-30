// Reset Achievements decisions (pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, createReset, type AppFacts } from '../frontend/surfaces/reset/reset.ts';
import { filterCandidates, type ResetCandidate } from '../frontend/kernel/reset.ts';

const apps: AppFacts[] = [
    { appid: 2, name: 'Zed', isShortcut: false },
    { appid: 1, name: 'alpha', isShortcut: false },
    { appid: 3, name: 'Beta Shortcut', isShortcut: true },
    { appid: 4, name: 'Nothing', isShortcut: false },
];

test('reset: candidates are games with unlocks, sorted by name, kind by app type', () => {
    const facts: Record<number, { unlocked: number; total: number }> = {
        1: { unlocked: 2, total: 5 },
        2: { unlocked: 1, total: 1 },
        3: { unlocked: 4, total: 9 },
        4: { unlocked: 0, total: 3 },
    };
    const list = buildCandidates(apps, (a) => facts[a.appid]);
    assert.deepEqual(
        list.map((c) => [c.name, c.kind]),
        [['alpha', 'steam'], ['Beta Shortcut', 'shortcut'], ['Zed', 'steam']],
    );
});

test('reset: the filter is a case-insensitive substring; empty keeps all', () => {
    const list: ResetCandidate[] = [
        { appid: 1, name: 'Dark Souls', unlocked: 1, total: 2, kind: 'steam' },
        { appid: 2, name: 'Grim Dawn', unlocked: 1, total: 2, kind: 'steam' },
    ];
    assert.deepEqual(filterCandidates(list, ' SOUL ').map((c) => c.appid), [1]);
    assert.equal(filterCandidates(list, '').length, 2);
    assert.equal(filterCandidates(list, 'zzz').length, 0);
});

function rig(over: Partial<Parameters<typeof createReset>[0]> = {}) {
    const commands: string[] = [];
    let cleared = false;
    const r = createReset({
        achievements: async () => [
            { id: 'A_ONE', achieved: !cleared },
            { id: 'B.TWO-x', achieved: !cleared },
            { id: 'locked', achieved: false },
            { id: 'bad id; quit', achieved: true },
        ],
        exec: (c) => {
            commands.push(c);
            cleared = true;
        },
        settle: async () => {},
        resetShortcut: async () => true,
        ...over,
    });
    return { r, commands };
}
const steamGame: ResetCandidate = { appid: 730, name: 'G', unlocked: 3, total: 4, kind: 'steam' };

test('reset: a Steam game gets one achievement_clear per unlocked safe id; unsafe ids are skipped, never sent', async () => {
    const { r, commands } = rig();
    const res = await r.reset(steamGame);
    assert.deepEqual(commands, ['achievement_clear 730 A_ONE', 'achievement_clear 730 B.TWO-x']);
    assert.deepEqual(res, { ok: true, cleared: 2, remaining: 1, skipped: 1 });
});

test('reset: a Steam game whose list Steam did not return fails and sends nothing', async () => {
    const { r, commands } = rig({ achievements: async () => null });
    const res = await r.reset(steamGame);
    assert.equal(res.ok, false);
    assert.deepEqual(commands, []);
});

test('reset: a non-Steam game goes through steam-cartridges, not the console', async () => {
    const seen: number[] = [];
    const { r, commands } = rig({
        resetShortcut: async (id) => {
            seen.push(id);
            return true;
        },
    });
    const res = await r.reset({ appid: 4271101655, name: 'S', unlocked: 4, total: 9, kind: 'shortcut' });
    assert.deepEqual(seen, [4271101655]);
    assert.deepEqual(commands, []);
    assert.equal(res.ok, true);
    const bad = rig({ resetShortcut: async () => false });
    assert.equal((await bad.r.reset({ appid: 1, name: 'S', unlocked: 1, total: 1, kind: 'shortcut' })).ok, false);
});
