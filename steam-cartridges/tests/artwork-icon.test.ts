import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIcon } from '../frontend/surfaces/artwork/icon.ts';
import { deps } from '../frontend/surfaces/artwork/deps.ts';

const SC = 3135033888;
const OURS = 'C:\\game\\steam\\millennium\\config\\steam-cartridges\\icons\\3135033888.jpg';
const EXE = 'D:\\Games\\Local\\Wuchang - Fallen Feathers\\Project_Plague.exe';

/** Fresh deps and a SteamClient stub that records every SetShortcutIcon call. */
function setup(over: { enabled?: boolean; saved?: any; recorded?: any; noApi?: boolean } = {}) {
    const set: [number, string][] = [];
    const saves: any[] = [];
    const records: any[] = [];
    (globalThis as any).SteamClient = over.noApi
        ? { Apps: {} }
        : { Apps: { SetShortcutIcon: async (appid: number, path: string) => void set.push([appid, path]) } };
    deps.isEnabled = () => over.enabled ?? true;
    deps.saveIcon = async (...args: any[]) => (saves.push(args), 'saved' in over ? over.saved : { path: OURS, previous: EXE });
    deps.recordIcon = async (appid: number, info: any) => (records.push({ appid, ...info }), over.recorded ?? { ok: true });
    return { set, saves, records };
}

test('write: store the image, point the shortcut at it, record path and previous', async () => {
    const { set, saves, records } = setup();
    await applyIcon(SC, { url: 'https://shared.steamstatic.com/i_full.jpg' }, 'steam-cdn', 2277560);
    assert.deepEqual(saves, [[SC, 'https://shared.steamstatic.com/i_full.jpg', 'steam-cdn', 2277560]]);
    assert.deepEqual(set, [[SC, OURS]]);
    assert.deepEqual(records, [{ appid: SC, path: OURS, previous: EXE, source: 'steam-cdn', steamAppid: 2277560 }]);
});

test('restore: put the replaced value back, no backend call', async () => {
    const { set, saves, records } = setup();
    await applyIcon(SC, { restore: '' }, 'steam-cdn');
    assert.deepEqual(set, [[SC, '']]);
    assert.equal(saves.length + records.length, 0);
});

test('kill switch off: nothing at all', async () => {
    const { set, saves } = setup({ enabled: false });
    await applyIcon(SC, { url: 'https://shared.steamstatic.com/i_full.jpg' }, 'steam-cdn', 2277560);
    await applyIcon(SC, { restore: EXE }, 'steam-cdn');
    assert.equal(set.length + saves.length, 0);
});

test('the backend refused (not eligible, download failed): Steam is not touched', async () => {
    const { set, records } = setup({ saved: { error: 'not eligible' } });
    await applyIcon(SC, { url: 'https://shared.steamstatic.com/i_full.jpg' }, 'steam-cdn', 2277560);
    assert.equal(set.length + records.length, 0);
});

test('the match changed meanwhile: the write is undone with the previous value', async () => {
    const { set } = setup({ recorded: { error: 'no mapping' } });
    await applyIcon(SC, { url: 'https://shared.steamstatic.com/i_full.jpg' }, 'steam-cdn', 2277560);
    assert.deepEqual(set, [[SC, OURS], [SC, EXE]]);
});

test('no SetShortcutIcon in this Steam: nothing is recorded', async () => {
    const { records } = setup({ noApi: true });
    await applyIcon(SC, { url: 'https://shared.steamstatic.com/i_full.jpg' }, 'steamgriddb');
    assert.equal(records.length, 0);
});
