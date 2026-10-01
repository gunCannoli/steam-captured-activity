// Kernel contract tests (migration plan § E1a): event bus, Surface runner, notification ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../frontend/kernel/events.ts';
import { assertDisjointTouches, installSurfaces, type Surface } from '../frontend/kernel/surface.ts';
import { achievementIdOf, COMPLETION_ID, PREVIEW_ID_PREFIX, syntheticKind, TEST_UNLOCK_ID, type SteamNotification } from '../frontend/kernel/notification.ts';

const unlocked = (id: string) => ({ n: { eType: 1, data: { achievement_id: () => id } } as unknown as SteamNotification, atMs: 1, completesGame: false });

test('events: handlers run in order; a throwing handler does not stop the others', () => {
    const errors: string[] = [];
    const bus = createEventBus((event, err) => errors.push(`${event}:${(err as Error).message}`));
    const seen: string[] = [];
    bus.on('achievement.unlocked', () => seen.push('a'));
    bus.on('achievement.unlocked', () => {
        throw new Error('boom');
    });
    bus.on('achievement.unlocked', () => seen.push('c'));
    bus.emit('achievement.unlocked', unlocked('X'));
    assert.deepEqual(seen, ['a', 'c']);
    assert.deepEqual(errors, ['achievement.unlocked:boom']);
});

test('events: off() unsubscribes and count() reports handlers', () => {
    const bus = createEventBus();
    let calls = 0;
    const off = bus.on('achievement.unlocked', () => calls++);
    assert.equal(bus.count('achievement.unlocked'), 1);
    bus.emit('achievement.unlocked', unlocked('X'));
    off();
    off();
    assert.equal(bus.count('achievement.unlocked'), 0);
    bus.emit('achievement.unlocked', unlocked('X'));
    assert.equal(calls, 1);
});

const surface = (id: string, touches: string[], install: () => boolean = () => true): Surface => ({ id, touches, install, uninstall() {} });

test('surface: assertDisjointTouches names both surfaces of a shared target', () => {
    assert.doesNotThrow(() => assertDisjointTouches([surface('a', ['x']), surface('b', ['y'])]));
    assert.throws(() => assertDisjointTouches([surface('a', ['x']), surface('b', ['x'])]), /Steam target "x" is touched by both "a" and "b"/);
});

test('surface: installSurfaces skips disabled and unavailable surfaces and reports a throwing install without stopping the rest', () => {
    const reported: string[] = [];
    const order: string[] = [];
    const status = installSurfaces(
        [
            surface('off', ['t1'], () => (order.push('off'), true)),
            surface('missing', ['t2'], () => (order.push('missing'), false)),
            surface('bad', ['t3'], () => {
                order.push('bad');
                throw new Error('nope');
            }),
            surface('ok', ['t4'], () => (order.push('ok'), true)),
        ],
        { isEnabled: (id) => id !== 'off', reportError: (id) => reported.push(id) },
    );
    assert.deepEqual(order, ['missing', 'bad', 'ok']);
    assert.deepEqual(reported, ['bad']);
    assert.deepEqual(status, [
        { id: 'off', installed: false, skipped: 'disabled' },
        { id: 'missing', installed: false, skipped: 'unavailable' },
        { id: 'bad', installed: false, skipped: 'failed' },
        { id: 'ok', installed: true, skipped: null },
    ]);
    let installed = false;
    assert.throws(
        () => installSurfaces([surface('a', ['x'], () => (installed = true)), surface('b', ['x'])], { isEnabled: () => true, reportError() {} }),
        /touched by both/,
    );
    assert.equal(installed, false, 'a shared target throws before anything is installed');
});

test('notification: syntheticKind classifies preview, completion and test ids; real ids are null', () => {
    assert.equal(syntheticKind(`${PREVIEW_ID_PREFIX}rare`), 'preview');
    assert.equal(syntheticKind(`${PREVIEW_ID_PREFIX}anything`), 'preview');
    assert.equal(syntheticKind(COMPLETION_ID), 'completion');
    assert.equal(syntheticKind(TEST_UNLOCK_ID), 'test');
    assert.equal(syntheticKind('ACH_WIN_ONE_GAME'), null);
    assert.equal(syntheticKind(undefined), null);
    assert.equal(achievementIdOf(unlocked('Q').n), 'Q');
    assert.equal(achievementIdOf({ eType: 1, data: {} } as unknown as SteamNotification), undefined);
    const throwing = { eType: 1, data: { achievement_id: () => { throw new Error('x'); } } } as unknown as SteamNotification;
    assert.equal(achievementIdOf(throwing), undefined);
});
