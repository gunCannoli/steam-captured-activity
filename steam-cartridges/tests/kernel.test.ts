// Kernel unit tests (migration plan M1). Real appids from this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGameId, isShortcutAppId, toGameId, toShortcutId, toSignedKey, toUnsigned } from '../frontend/kernel/appid.ts';
import type { ShortcutId } from '../frontend/kernel/appid.ts';
import { createEventBus } from '../frontend/kernel/events.ts';
import { createRecordStore } from '../frontend/kernel/record.ts';
import { assertDisjointTouches, createSurfaceRunner } from '../frontend/kernel/surface.ts';
import type { Surface } from '../frontend/kernel/surface.ts';

const AM2R = 4263274102, ALUNDRA = 3858889198, WUCHANG = 3135033888;

test('appid: signed CEF values normalize to the unsigned shortcut id', () => {
    assert.equal(toShortcutId(-436078098), ALUNDRA);
    assert.equal(toShortcutId(ALUNDRA), ALUNDRA);
    assert.equal(toShortcutId('3858889198'), ALUNDRA);
    assert.equal(toShortcutId(-31693194), AM2R);
    assert.equal(toUnsigned(-1159933408), WUCHANG);
});

test('appid: native apps and junk are not shortcuts', () => {
    assert.equal(toShortcutId(435150), undefined);
    assert.equal(toShortcutId(0x7fff_ffff), undefined);
    assert.equal(toShortcutId(0x8000_0000), 0x8000_0000);
    for (const bad of [NaN, 1.5, 'x', null, undefined, {}, 2 ** 32, -(2 ** 31) - 1]) {
        assert.equal(toShortcutId(bad), undefined, String(bad));
    }
    assert.equal(isShortcutAppId(-436078098), true);
    assert.equal(isShortcutAppId(435150), false);
});

test('appid: gameid round-trips (values verified against capture folders)', () => {
    assert.equal(toGameId(AM2R as ShortcutId), '18310622842007322624');
    assert.equal(toGameId(WUCHANG as ShortcutId), '13464868020845281280');
    assert.equal(fromGameId('18310622842007322624'), AM2R);
    assert.equal(fromGameId('435150'), undefined);
    assert.equal(fromGameId('abc'), undefined);
    assert.equal(toSignedKey(ALUNDRA as ShortcutId), -436078098);
});

test('events: a throwing handler does not stop the others', () => {
    const errors: string[] = [];
    const bus = createEventBus((ev) => errors.push(ev));
    const seen: number[] = [];
    bus.on('shortcut.quit', () => {
        throw new Error('boom');
    });
    const off = bus.on('shortcut.quit', ({ appid }) => seen.push(appid));
    bus.emit('shortcut.quit', { appid: AM2R as ShortcutId });
    assert.deepEqual(seen, [AM2R]);
    assert.deepEqual(errors, ['shortcut.quit']);
    off();
    assert.equal(bus.count('shortcut.quit'), 1);
});

test('record: update emits only for parts that changed (guardrail 17)', () => {
    const bus = createEventBus();
    const events: string[][] = [];
    bus.on('record.updated', ({ parts }) => events.push(parts));
    const store = createRecordStore(bus);
    const id = AM2R as ShortcutId;
    store.upsert({ appid: id, gameid: toGameId(id), title: 'AM2R', exe: 'AM2R.exe' });
    assert.deepEqual(store.update(id, { metadata: { status: 'ok', data: { d: 1 } } }), ['metadata']);
    assert.deepEqual(store.update(id, { metadata: { status: 'ok', data: { d: 1 } } }), []);
    assert.deepEqual(events, [['metadata']]);
    assert.equal(store.get(id)?.metadata?.status, 'ok');
    assert.deepEqual(store.update(123 as ShortcutId, { metadata: { status: 'ok' } }), []);
});

function fakeSurface(id: string, touches: string[], behaviour: { failInstall?: boolean; failRender?: boolean } = {}) {
    const calls: string[] = [];
    const s: Surface = {
        id,
        touches,
        reads: ['metadata'],
        install: () => {
            calls.push('install');
            if (behaviour.failInstall) throw new Error('install');
        },
        render: () => {
            calls.push('render');
            if (behaviour.failRender) throw new Error('render');
        },
        clear: () => calls.push('clear'),
        uninstall: () => calls.push('uninstall'),
    };
    return { s, calls };
}

test('surface: two surfaces may not touch the same Steam target', () => {
    assert.throws(() => assertDisjointTouches([{ id: 'a', touches: ['X.y'] }, { id: 'b', touches: ['X.y'] }]), /touched by both/);
    const runner = createSurfaceRunner({ isEnabled: () => true });
    runner.register(fakeSurface('a', ['X.y']).s);
    assert.throws(() => runner.register(fakeSurface('b', ['X.y']).s), /touched by both/);
});

test('surface: a failing surface is isolated and switched off after its budget', () => {
    const good = fakeSurface('good', ['A']);
    const bad = fakeSurface('bad', ['B'], { failRender: true });
    const off = fakeSurface('off', ['C']);
    const runner = createSurfaceRunner({ isEnabled: (id) => id !== 'off', errorBudget: 2 });
    [good, bad, off].forEach((x) => runner.register(x.s));
    runner.installAll();
    const id = AM2R as ShortcutId;
    runner.render(id, undefined);
    runner.render(id, undefined);
    runner.render(id, undefined);
    assert.deepEqual(good.calls, ['install', 'render', 'render', 'render']);
    assert.deepEqual(bad.calls, ['install', 'render', 'render', 'uninstall']);
    assert.deepEqual(off.calls, []);
    const st = Object.fromEntries(runner.status().map((x) => [x.id, x]));
    assert.equal(st.bad.disabled, true);
    assert.equal(st.off.disabled, true);
    assert.equal(st.good.errors, 0);
});

test('surface: render is skipped when none of its parts changed', () => {
    const a = fakeSurface('a', ['A']);
    const runner = createSurfaceRunner({ isEnabled: () => true });
    runner.register(a.s);
    runner.installAll();
    runner.render(AM2R as ShortcutId, undefined, ['achievements']);
    runner.render(AM2R as ShortcutId, undefined, ['metadata']);
    assert.deepEqual(a.calls, ['install', 'render']);
});
