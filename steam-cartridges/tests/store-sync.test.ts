// Auto-add (ADR-0056): app/store-sync decides, the library-shortcuts surface writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStoreSync, STORE_COLLECTIONS } from '../frontend/app/store-sync.ts';
import { createEventBus } from '../frontend/kernel/events.ts';

const LAUNCH = { exe: '"C:\L\EpicGamesLauncher.exe"', start_dir: '"C:\L\\"', launch_options: 'com.epicgames.launcher://apps/ns%3Ait%3Aapp?action=launch&silent=true' };

function setup(autoAdd = { epic: true, xbox: true }) {
    const bus = createEventBus();
    const asked: any[] = [];
    bus.on('store.add-requested', (e) => asked.push(e));
    let calls = 0;
    const sync = createStoreSync({
        backend: {
            async storeInstalledGames() {
                calls++;
                return {
                    epic: [
                        { key: 'app', title: 'Jotunnslayer: Hordes of Hel', launch: LAUNCH },
                        { key: 'owned', title: 'In Library', inLibrary: 4000000001, launch: LAUNCH },
                        { key: 'nolaunch', title: 'No Launcher' },
                    ],
                    xbox: [{ key: 'Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe', title: 'Microsoft Jigsaw', launch: { exe: '"C:\Windows\explorer.exe"', start_dir: '"C:\Windows\\"', launch_options: 'shell:AppsFolder\Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe!App' } }],
                    epicLauncher: true,
                };
            },
        } as any,
        bus,
        autoAdd: () => autoAdd,
        allowXbox: () => true,
    });
    return { sync, asked, calls: () => calls };
}

test('auto-add: each installed game without a shortcut is requested once, in its store\'s collection', async () => {
    const s = setup();
    assert.equal(await s.sync.run(), 2);
    assert.deepEqual(s.asked.map((e) => [e.kind, e.key, e.collection]), [
        ['epic', 'app', STORE_COLLECTIONS.epic],
        ['xbox', 'Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe', STORE_COLLECTIONS.xbox],
    ]);
    assert.equal(s.asked[0].title, 'Jotunnslayer: Hordes of Hel');
    assert.deepEqual(s.asked[0].launch, LAUNCH);
    assert.equal(await s.sync.run(), 0, 'a game already requested this session is not asked again');
});

test('auto-add: a store whose toggle is off adds nothing; both off asks the backend nothing', async () => {
    const epicOnly = setup({ epic: true, xbox: false });
    await epicOnly.sync.run();
    assert.deepEqual(epicOnly.asked.map((e) => e.kind), ['epic']);
    const none = setup({ epic: false, xbox: false });
    assert.equal(await none.sync.run(), 0);
    assert.equal(none.calls(), 0);
});

test('auto-add: two runs at the same time share one backend call', async () => {
    const s = setup();
    await Promise.all([s.sync.run(), s.sync.run()]);
    assert.equal(s.calls(), 1);
    assert.equal(s.asked.length, 2);
});

// U0 repair (ADR-0058): the backend's list of outdated Xbox shortcuts becomes repair requests, once each, only with Xbox on.
function repairRig(allowXbox = true) {
    const bus = createEventBus();
    const asked: any[] = [];
    bus.on('store.repair-requested', (e) => asked.push(e));
    const REPAIR = { appid: 2663546656, title: 'Microsoft Minesweeper', exe: '"C:\Program Files\WindowsApps\M_4.8.0.0_x64__p\Minesweeper.exe"', start_dir: '"C:\Program Files\WindowsApps\M_4.8.0.0_x64__p\\"' };
    let calls = 0;
    const sync = createStoreSync({
        backend: { async storeInstalledGames() { return {}; }, async storeXboxRepairs() { calls++; return { repairs: [REPAIR] }; } } as any,
        bus,
        autoAdd: () => ({ epic: false, xbox: false }),
        allowXbox: () => allowXbox,
    });
    return { sync, asked, calls: () => calls, REPAIR };
}

test('U0 repair: an outdated Xbox shortcut is requested once with the current exe, also with auto-add off', async () => {
    const r = repairRig();
    assert.equal(await r.sync.repair(), 1);
    assert.equal(await r.sync.repair(), 0, 'the same repair is not asked again this session');
    assert.deepEqual(r.asked, [r.REPAIR]);
});

test('U0 repair: nothing while the Xbox store is off', async () => {
    const r = repairRig(false);
    assert.equal(await r.sync.repair(), 0);
    assert.equal(r.calls(), 0);
});
