// Surface launch-hold (ADR-0057): holds Steam's RunGame only for the shortcuts `launch.hold-mode` lists, lets a held launch
// go on `launch.release` or after the cap, passes every other launch through, and restores Steam's original on uninstall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../frontend/kernel/events.ts';

const g = globalThis as any;
g.window = g;

const { createLaunchHoldSurface, onHoldMode, onRelease } = await import('../frontend/surfaces/launch-hold/index.ts');

const EPIC = 4202674849 as any;
const gameid = (appid: number) => ((BigInt(appid) << 32n) | 0x02000000n).toString();
const EPIC_GAMEID = gameid(EPIC);
const OTHER_GAMEID = gameid(3715400865);

function rig(maxHoldMs = 50) {
    const bus = createEventBus();
    const held: number[] = [];
    bus.on('launch.held', (e) => held.push(e.appid));
    const runs: any[][] = [];
    const original = (...a: any[]) => runs.push(a);
    g.SteamClient = { Apps: { RunGame: original } };
    const errors: unknown[] = [];
    const surface = createLaunchHoldSurface({ isEnabled: () => true, reportError: (_id, e) => errors.push(e), bus, maxHoldMs });
    surface.install();
    return { surface, held, runs, original, errors };
}

test('launch-hold: with an empty hold list, Steam launches at once', () => {
    const r = rig();
    onHoldMode({ appids: [] });
    g.SteamClient.Apps.RunGame(EPIC_GAMEID, '', -1, 100);
    assert.deepEqual(r.runs, [[EPIC_GAMEID, '', -1, 100]]);
    assert.deepEqual(r.held, []);
    r.surface.uninstall();
});

test('launch-hold: a listed shortcut waits for launch.release, then Steam runs it once with the same arguments', () => {
    const r = rig(10_000);
    onHoldMode({ appids: [EPIC] });
    g.SteamClient.Apps.RunGame(EPIC_GAMEID, '', -1, 100);
    g.SteamClient.Apps.RunGame(EPIC_GAMEID, '', -1, 100); // Play pressed twice while held
    assert.deepEqual(r.runs, []);
    assert.deepEqual(r.held, [EPIC]);
    onRelease({ appid: EPIC });
    onRelease({ appid: EPIC });
    assert.deepEqual(r.runs, [[EPIC_GAMEID, '', -1, 100]]);
    r.surface.uninstall();
});

test('launch-hold: a shortcut that is not listed, and a Steam game, are never held', () => {
    const r = rig();
    onHoldMode({ appids: [EPIC] });
    g.SteamClient.Apps.RunGame(OTHER_GAMEID, '', -1, 100);
    g.SteamClient.Apps.RunGame('435150', '', -1, 100);
    assert.deepEqual(r.runs, [[OTHER_GAMEID, '', -1, 100], ['435150', '', -1, 100]]);
    assert.deepEqual(r.held, []);
    r.surface.uninstall();
});

test('launch-hold: fail-open, a held launch goes on after the cap without an answer', async () => {
    const r = rig(20);
    onHoldMode({ appids: [EPIC] });
    g.SteamClient.Apps.RunGame(EPIC_GAMEID, '', -1, 100);
    await new Promise((res) => setTimeout(res, 60));
    assert.equal(r.runs.length, 1);
    r.surface.uninstall();
});

test('launch-hold: a list without the held shortcut releases it; uninstall restores Steam\'s RunGame', () => {
    const r = rig(10_000);
    onHoldMode({ appids: [EPIC] });
    g.SteamClient.Apps.RunGame(EPIC_GAMEID, '', -1, 100);
    onHoldMode({ appids: [] });
    assert.equal(r.runs.length, 1);
    r.surface.uninstall();
    assert.equal(g.SteamClient.Apps.RunGame, r.original);
    assert.deepEqual(r.errors, []);
});

test('launch-hold: declares RunGame as its one Steam target', () => {
    const r = rig();
    assert.deepEqual(r.surface.touches, ['SteamClient.Apps.RunGame']);
    r.surface.uninstall();
});
