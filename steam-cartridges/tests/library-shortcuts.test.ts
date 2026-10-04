// Surface library-shortcuts (ADR-0056): AddShortcut, then the name and launch options it ignores (verified live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../frontend/kernel/events.ts';

const g = globalThis as any;
g.window = g;

const { createLibraryShortcutsSurface, onAddRequested } = await import('../frontend/surfaces/library-shortcuts/index.ts');

const REQUEST = {
    kind: 'epic' as const,
    key: 'app',
    title: 'Jotunnslayer: Hordes of Hel',
    launch: { exe: '"C:\L\EpicGamesLauncher.exe"', start_dir: '"C:\L\\"', launch_options: 'com.epicgames.launcher://apps/x?action=launch&silent=true' },
    collection: 'Epic Games',
};

function rig(addShortcut: (...a: any[]) => any) {
    const bus = createEventBus();
    const results: any[] = [];
    bus.on('store.shortcut-added', (e) => results.push(e));
    const calls: any[] = [];
    g.SteamClient = {
        Apps: {
            AddShortcut: async (...a: any[]) => { calls.push(['add', ...a]); return addShortcut(...a); },
            SetShortcutName: (...a: any[]) => calls.push(['name', ...a]),
            SetShortcutLaunchOptions: (...a: any[]) => calls.push(['opts', ...a]),
        },
    };
    const added: any[] = [];
    const overview = { appid: 3235712508 };
    g.appStore = { GetAppOverviewByAppID: (id: number) => (id === 3235712508 ? overview : undefined) };
    g.collectionStore = {
        m_mapCollectionsFromStorage: new Map(),
        userCollections: [{ displayName: 'Favorites' }],
        NewUnsavedCollection: (name: string) => ({ displayName: name, Save: async () => {}, AsDragDropCollection: () => ({ AddApps: (list: any[]) => added.push([name, list]) }) }),
    };
    const surface = createLibraryShortcutsSurface({ isEnabled: () => true, reportError: () => {}, bus, retryMs: 1 });
    return { surface, results, calls, added };
}

test('library-shortcuts: adds, then sets the name and launch options AddShortcut ignores, then files it', async () => {
    const r = rig(() => 3235712508);
    await onAddRequested(REQUEST);
    assert.deepEqual(r.calls[0], ['add', REQUEST.title, REQUEST.launch.exe, REQUEST.launch.start_dir, REQUEST.launch.launch_options]);
    assert.deepEqual(r.calls[1], ['name', 3235712508, REQUEST.title]);
    assert.deepEqual(r.calls[2], ['opts', 3235712508, REQUEST.launch.launch_options]);
    assert.equal(r.added[0][0], 'Epic Games');
    assert.deepEqual(r.results, [{ kind: 'epic', key: 'app', appid: 3235712508, collection: 'Epic Games' }]);
    assert.ok(r.surface.touches.includes('SteamClient.Apps.AddShortcut'));
});

test('library-shortcuts: an answer that is not an appid is reported, nothing else is written', async () => {
    const r = rig(() => ({ result: 2, message: '' }));
    await onAddRequested(REQUEST);
    assert.equal(r.calls.length, 1);
    assert.match(r.results[0].error, /AddShortcut answered/);
});

test('library-shortcuts: without a ready collection store the shortcut is still added (fail-open)', async () => {
    const r = rig(() => 3235712508);
    g.collectionStore = {};
    await onAddRequested(REQUEST);
    assert.equal(r.results[0].appid, 3235712508);
    assert.equal(r.results[0].collection, undefined);
});

test('library-shortcuts: a collection store that is not loaded yet is waited for, and the shortcut is filed once', async () => {
    const r = rig(() => 3235712508);
    const store = g.collectionStore;
    let reads = 0;
    // The storage map is there but the user's collections load a moment later (the first add after a restart).
    Object.defineProperty(store, 'userCollections', { get: () => (reads++ < 3 ? [] : [{ displayName: 'Favorites' }]) });
    await onAddRequested(REQUEST);
    assert.equal(r.added.length, 1, 'filed exactly once, not once per attempt');
    assert.equal(r.results[0].collection, 'Epic Games');
});

test('library-shortcuts: collections that never load leave the shortcut added, unfiled, after a bounded wait', async () => {
    const r = rig(() => 3235712508);
    g.collectionStore = { m_mapCollectionsFromStorage: new Map(), userCollections: [] };
    await onAddRequested(REQUEST);
    assert.equal(r.results[0].appid, 3235712508);
    assert.equal(r.results[0].collection, undefined);
    assert.equal(r.added.length, 0);
});

test('library-shortcuts: a repair request repoints the shortcut (exe and start dir) and reports it', async () => {
    const { onRepairRequested } = await import('../frontend/surfaces/library-shortcuts/index.ts');
    const r = rig(() => 3235712508);
    const set: any[] = [];
    g.SteamClient.Apps.SetShortcutExe = (...a: any[]) => set.push(['exe', ...a]);
    g.SteamClient.Apps.SetShortcutStartDir = (...a: any[]) => set.push(['dir', ...a]);
    const bus = createEventBus();
    const results: any[] = [];
    bus.on('store.shortcut-repaired', (e) => results.push(e));
    createLibraryShortcutsSurface({ isEnabled: () => true, reportError: () => {}, bus, retryMs: 1 });
    onRepairRequested({ appid: 2663546656, title: 'Microsoft Minesweeper', exe: '"X\Minesweeper.exe"', start_dir: '"X\\"' });
    assert.deepEqual(set, [['exe', 2663546656, '"X\Minesweeper.exe"'], ['dir', 2663546656, '"X\\"']]);
    assert.deepEqual(results, [{ appid: 2663546656, title: 'Microsoft Minesweeper' }]);
    assert.ok(r.surface.touches.includes('SteamClient.Apps.SetShortcutExe') && r.surface.touches.includes('SteamClient.Apps.SetShortcutStartDir'));
});
