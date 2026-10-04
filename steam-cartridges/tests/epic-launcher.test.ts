// app/epic-launcher (ADR-0057): the hold list is the backend's Epic launcher-link copies while the setting is on (empty
// when off); a held launch is always released (at once for a shortcut not on the list, after the prelaunch otherwise, also
// when it fails); the reaper ticks only for an Epic launcher-link copy and stops when the backend says done, on quit, and
// when the setting goes off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createEpicLauncher } from '../frontend/app/epic-launcher.ts';

const APPID = 4202674849 as any;
const OTHER = 3715400865 as any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rig(opts: { enabled?: boolean; list?: number[]; prelaunch?: () => Promise<any>; reap?: (appid: number, act: string) => Promise<any> } = {}) {
    const bus = createEventBus();
    let enabled = opts.enabled ?? true;
    const modes: number[][] = [];
    const released: number[] = [];
    const calls: string[] = [];
    bus.on('launch.hold-mode', (e) => modes.push([...e.appids]));
    bus.on('launch.release', (e) => released.push(e.appid));
    const backend = {
        storeEpicLaunchShortcuts: async () => { calls.push('list'); return { appids: opts.list ?? [APPID] }; },
        storeEpicPrelaunch: async (appid: number, heldAt: number) => { calls.push(`pre:${appid}@${heldAt}`); return (opts.prelaunch ?? (async () => ({ epic: true, closed: true })))(); },
        storeEpicReap: async (appid: number, act: string) => { calls.push(act); return (opts.reap ?? (async () => ({ active: false })))(appid, act); },
    };
    const app = createEpicLauncher({ backend: backend as any, bus, enabled: () => enabled, now: () => 1234, tickMs: 5 });
    app.install();
    return { bus, app, modes, released, calls, setEnabled: (v: boolean) => { enabled = v; app.settingChanged(); } };
}

test('epic-launcher: sends the Epic list while the setting is on, an empty list when off', async () => {
    const r = rig({ enabled: false });
    await wait(1);
    r.setEnabled(true);
    await wait(1);
    r.setEnabled(false);
    await wait(1);
    assert.deepEqual(r.modes, [[], [APPID], []]);
    assert.deepEqual(r.calls, ['list'], 'the backend is asked only while the setting is on');
});

test('epic-launcher: a held Epic launch is released after the prelaunch answer, with the time Play was held', async () => {
    const r = rig();
    await wait(1);
    r.bus.emit('launch.held', { appid: APPID });
    await wait(5);
    assert.ok(r.calls.includes(`pre:${APPID}@1234`));
    assert.deepEqual(r.released, [APPID]);
});

test('epic-launcher: a held launch not on the Epic list is released at once, without the backend', async () => {
    const r = rig();
    await wait(1);
    r.bus.emit('launch.held', { appid: OTHER });
    assert.deepEqual(r.released, [OTHER]);
    assert.ok(!r.calls.some((c) => c.startsWith('pre:')));
});

test('epic-launcher: a failed prelaunch still releases the launch (fail-open)', async () => {
    const r = rig({ prelaunch: async () => { throw new Error('backend down'); } });
    await wait(1);
    r.bus.emit('launch.held', { appid: APPID });
    await wait(5);
    assert.deepEqual(r.released, [APPID]);
});

test('epic-launcher: the reaper ticks while the backend says active and stops when it says done', async () => {
    let ticks = 0;
    const r = rig({ reap: async (_a, act) => (act === 'start' ? { active: true } : ++ticks < 3 ? { active: true, phase: 'running' } : { active: false, phase: 'done', reason: 'synced' }) });
    await wait(1);
    r.bus.emit('shortcut.launched', { appid: APPID, name: 'Jotunnslayer' });
    await wait(80);
    assert.deepEqual(r.calls.filter((c) => c !== 'list'), ['start', 'tick', 'tick', 'tick']);
});

test('epic-launcher: a launch reads the list again (a converted shortcut is held from its next launch)', async () => {
    const r = rig({ reap: async () => ({ active: false }) });
    await wait(1);
    r.bus.emit('shortcut.launched', { appid: OTHER, name: 'AM2R' });
    await wait(20);
    assert.deepEqual(r.calls, ['list', 'start', 'list']);
});

test('epic-launcher: quit stops the watch and tells the backend', async () => {
    const r = rig({ reap: async () => ({ active: true, phase: 'running' }) });
    await wait(1);
    r.bus.emit('shortcut.launched', { appid: APPID, name: 'Jotunnslayer' });
    await wait(12);
    r.bus.emit('shortcut.quit', { appid: APPID, name: 'Jotunnslayer' });
    const n = r.calls.length; // the stub records 'stop' synchronously
    await wait(30);
    assert.equal(r.calls.at(-1), 'stop');
    assert.equal(r.calls.length, n, 'no tick after quit');
});

test('epic-launcher: the setting turned off mid-game stops the watch at the next tick', async () => {
    const r = rig({ reap: async () => ({ active: true, phase: 'running' }) });
    await wait(1);
    r.bus.emit('shortcut.launched', { appid: APPID, name: 'Jotunnslayer' });
    await wait(3);
    r.setEnabled(false);
    await wait(30);
    assert.equal(r.calls.at(-1), 'stop');
    assert.equal(r.calls.filter((c) => c === 'stop').length, 1);
});

test('epic-launcher: nothing at all while the setting is off', async () => {
    const r = rig({ enabled: false, reap: async () => ({ active: true }) });
    r.bus.emit('shortcut.launched', { appid: APPID, name: 'Jotunnslayer' });
    r.bus.emit('launch.held', { appid: APPID });
    await wait(20);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.released, [APPID]);
});

test('epic-launcher: auto-add of an Epic game reads the list again', async () => {
    const r = rig();
    await wait(1);
    r.bus.emit('store.shortcut-added', { kind: 'epic', key: 'x', appid: 1 });
    r.bus.emit('store.shortcut-added', { kind: 'xbox', key: 'y', appid: 2 });
    await wait(1);
    assert.deepEqual(r.calls, ['list', 'list']);
});
