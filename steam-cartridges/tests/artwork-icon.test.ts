import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIcon } from '../frontend/surfaces/artwork/icon.ts';
import { deps } from '../frontend/surfaces/artwork/deps.ts';

const SC = 3135033888;
const OURS = 'C:\\game\\steam\\millennium\\config\\steam-cartridges\\icons\\3135033888.jpg';
const EXE = 'D:\\Games\\Local\\Wuchang - Fallen Feathers\\Project_Plague.exe';

/** A SteamClient stub that records every SetShortcutIcon call. */
function setup(over: { enabled?: boolean; noApi?: boolean } = {}) {
    const set: [number, string][] = [];
    (globalThis as any).SteamClient = over.noApi
        ? { Apps: {} }
        : { Apps: { SetShortcutIcon: async (appid: number, path: string) => void set.push([appid, path]) } };
    deps.isEnabled = () => over.enabled ?? true;
    return { set };
}

test('write: point the shortcut at the stored icon and report it set', async () => {
    const { set } = setup();
    assert.equal(await applyIcon(SC, { path: OURS, previous: EXE }), true);
    assert.deepEqual(set, [[SC, OURS]]);
});

test('restore: put the replaced value back; nothing to record', async () => {
    const { set } = setup();
    assert.equal(await applyIcon(SC, { restore: '' }), false);
    assert.deepEqual(set, [[SC, '']]);
});

test('kill switch off: nothing at all', async () => {
    const { set } = setup({ enabled: false });
    assert.equal(await applyIcon(SC, { path: OURS, previous: EXE }), false);
    await applyIcon(SC, { restore: EXE });
    assert.equal(set.length, 0);
});

test('no SetShortcutIcon in this Steam: not set, so nothing is recorded', async () => {
    setup({ noApi: true });
    assert.equal(await applyIcon(SC, { path: OURS, previous: EXE }), false);
});
