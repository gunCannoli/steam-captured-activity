// Sensor unit tests (migration plan M2). Real appids from this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShortcutId } from '../frontend/kernel/appid.ts';
import { createViewTracker, GAMEPAD_QUIET_MS } from '../frontend/sensors/view/core.ts';
import type { ViewPayload } from '../frontend/sensors/view/core.ts';

const AM2R = 4263274102, WUCHANG = 3135033888, NATIVE = 2277560;

function tracker() {
    const log: string[] = [];
    let now = 0;
    const t = createViewTracker({
        toShortcutId,
        now: () => now,
        viewed: (p: ViewPayload) => log.push(`viewed ${p.appid} ${p.mode}`),
        left: (p: ViewPayload) => log.push(`left ${p.appid} ${p.mode}`),
    });
    return { t, log, advance: (ms: number) => (now += ms) };
}

test('view: desktop route emits one view per navigation, left on leaving', () => {
    const { t, log } = tracker();
    t.route(AM2R);
    t.route(AM2R); // same page, e.g. a search/hash change
    t.route(undefined); // library home
    assert.deepEqual(log, [`viewed ${AM2R} desktop`, `left ${AM2R} desktop`]);
});

test('view: desktop A -> B leaves A before viewing B; native pages are not views', () => {
    const { t, log } = tracker();
    t.route(AM2R);
    t.route(WUCHANG);
    t.route(NATIVE);
    assert.deepEqual(log, [`viewed ${AM2R} desktop`, `left ${AM2R} desktop`, `viewed ${WUCHANG} desktop`, `left ${WUCHANG} desktop`]);
});

test('view: signed CEF appids are normalized (same page, one view)', () => {
    const { t, log } = tracker();
    t.route(-31693194); // AM2R as signed int32
    t.route(AM2R);
    assert.deepEqual(log, [`viewed ${AM2R} desktop`]);
    assert.equal(t.current('desktop'), AM2R);
});

test('view: gamepad re-renders are one view; a sighting after silence is a new view', () => {
    const { t, log, advance } = tracker();
    for (let i = 0; i < 50; i++) {
        t.sighting(AM2R);
        advance(100);
    }
    assert.deepEqual(log, [`viewed ${AM2R} gamepad`]);
    advance(GAMEPAD_QUIET_MS);
    t.sighting(AM2R);
    assert.deepEqual(log, [`viewed ${AM2R} gamepad`, `viewed ${AM2R} gamepad`]);
});

test('view: gamepad switch and close emit left; modes are independent', () => {
    const { t, log } = tracker();
    t.route(WUCHANG);
    t.sighting(AM2R);
    t.sighting(NATIVE);
    t.close('gamepad');
    t.close('desktop');
    assert.deepEqual(log, [
        `viewed ${WUCHANG} desktop`,
        `viewed ${AM2R} gamepad`,
        `left ${AM2R} gamepad`,
        `left ${WUCHANG} desktop`,
    ]);
});

import { watchIdentity } from '../frontend/sensors/progress-cache/index.ts';
import { watchInstalls } from '../frontend/sensors/installs/index.ts';

function fakeTimers() {
    let fn: (() => void) | undefined;
    const log = { cleared: 0 };
    return {
        timers: { setInterval: (f: () => void) => { fn = f; return 1; }, clearInterval: () => { log.cleared++; } },
        tick: () => fn?.(),
        log,
    };
}

test('progress-cache: onChange fires for the first map and again for each replacement, never for the same map', () => {
    const t = fakeTimers();
    let map: unknown;
    let calls = 0;
    watchIdentity(() => map, () => { calls++; }, { timers: t.timers, intervalMs: 1000, maxMs: 100000 });
    assert.equal(calls, 0, 'nothing while Steam has no map');
    const first = new Map(); map = first; t.tick();
    assert.equal(calls, 1);
    t.tick(); t.tick();
    assert.equal(calls, 1, 'the same map is not reported twice');
    map = new Map(); t.tick();
    assert.equal(calls, 2, "Steam's LoadCacheFile replaced it");
});

test('progress-cache: a map that is already there is reported at once, and the watch stops after maxMs', () => {
    const t = fakeTimers();
    let calls = 0;
    watchIdentity(() => new Map(), () => { calls++; }, { timers: t.timers, intervalMs: 1000, maxMs: 3000 });
    assert.equal(calls, 1, 'reported by the first look (Steam loaded before us)');
    t.tick(); t.tick();
    assert.equal(t.log.cleared, 1, 'stopped after 3 ticks (bounded)');
});

test('installs: ticks on its interval, never at once, and stops when told', () => {
    const calls: number[] = [];
    let tick: (() => void) | undefined;
    let cleared: unknown;
    const stop = watchInstalls(() => calls.push(1), {
        intervalMs: 5000,
        timers: { setInterval: (fn, ms) => ((tick = fn), ms), clearInterval: (h) => (cleared = h) },
    });
    assert.equal(calls.length, 0, 'the caller runs its own first check');
    tick!();
    tick!();
    assert.equal(calls.length, 2);
    stop();
    assert.equal(cleared, 5000, 'the interval handle is cleared');
});
