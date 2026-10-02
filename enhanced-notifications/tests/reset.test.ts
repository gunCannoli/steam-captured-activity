// Reset Achievements decisions (pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, createReset, type AppFacts } from '../frontend/surfaces/reset/reset.ts';
import { filterCandidates, isResetPage, resetWarning, type ResetCandidate, type ResetSource } from '../frontend/kernel/reset.ts';

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
        resetShortcut: async () => ({ ok: true, sources: [] }),
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
    const seen: [number, string[]][] = [];
    const { r, commands } = rig({
        resetShortcut: async (id, sources) => {
            seen.push([id, sources]);
            return { ok: true, sources: [{ id: 'local', ok: true, cleared: 2 }] };
        },
    });
    const res = await r.reset({ appid: 4271101655, name: 'S', unlocked: 4, total: 9, kind: 'shortcut' }, ['local']);
    assert.deepEqual(seen, [[4271101655, ['local']]]);
    assert.deepEqual(commands, []);
    assert.equal(res.ok, true);
    assert.deepEqual(res.ok && res.sources, [{ id: 'local', ok: true, cleared: 2 }]);
    const bad = rig({ resetShortcut: async () => ({ ok: false, sources: [] }) });
    assert.equal((await bad.r.reset({ appid: 1, name: 'S', unlocked: 1, total: 1, kind: 'shortcut' })).ok, false);
});

// ---------- the confirm dialog's warning (ADR-0054) ----------
const shortcut: ResetCandidate = { appid: 3135033888, name: 'WUCHANG', unlocked: 2, total: 40, kind: 'shortcut' };
const local: ResetSource = { id: 'local', label: 'local achievements (RUNE)', resettable: true, unlocked: 2 };
const ra: ResetSource = { id: 'retroachievements', label: 'RetroAchievements', resettable: false, unlocked: 5, note: 'Reset them on retroachievements.org.' };
const ps4: ResetSource = { id: 'shadps4', label: 'shadPS4 achievements', resettable: true, unlocked: 1, note: 'shadNet may sync them back.' };

test('reset warning: a Steam game is cleared on the Steam account', () => {
    const w = resetWarning({ appid: 730, name: 'G', unlocked: 3, total: 4, kind: 'steam' }, [], new Set());
    assert.match(w, /cleared on your Steam account/);
    assert.match(w, /cannot be undone/);
});

test('reset warning: a shortcut with no source files says only the list in Steam is reset', () => {
    const w = resetWarning(shortcut, [], new Set());
    assert.match(w, /Only the list in Steam can be reset/);
});

test('reset warning: a local source not chosen comes back; chosen, it is backed up and the game must be closed', () => {
    assert.match(resetWarning(shortcut, [local], new Set()), /local achievements \(RUNE\) are kept and will come back/);
    const chosen = resetWarning(shortcut, [local], new Set(['local']));
    assert.match(chosen, /cleared too, each file backed up first/);
    assert.match(chosen, /Close the game/);
    assert.doesNotMatch(chosen, /come back/);
});

test('reset warning: RetroAchievements is out of reach and says where to reset; a chosen source keeps its note', () => {
    const w = resetWarning(shortcut, [ra], new Set(['retroachievements']));
    assert.match(w, /Only the list in Steam can be reset here/);
    assert.match(w, /RetroAchievements: Reset them on retroachievements.org/);
    assert.doesNotMatch(w, /cleared too/);
    assert.match(resetWarning(shortcut, [ps4], new Set(['shadps4'])), /shadPS4 achievements: shadNet may sync them back/);
});

test('reset page: only a retroachievements.org game page is opened', () => {
    assert.equal(isResetPage('https://retroachievements.org/game/228'), true);
    for (const bad of ['http://retroachievements.org/game/228', 'https://retroachievements.org/game/228/x', 'https://evil.example/game/1', 'https://retroachievements.org.evil/game/1', 'javascript:alert(1)']) {
        assert.equal(isResetPage(bad), false, bad);
    }
});

test('reset warning: with its switch on, RetroAchievements says its page opens after the reset', () => {
    const withUrl: ResetSource = { ...ra, url: 'https://retroachievements.org/game/228' };
    assert.match(resetWarning(shortcut, [withUrl], new Set(['retroachievements'])), /game page opens after the reset; press Manage progress/);
    assert.match(resetWarning(shortcut, [withUrl], new Set()), /RetroAchievements: Reset them on retroachievements.org/);
});
