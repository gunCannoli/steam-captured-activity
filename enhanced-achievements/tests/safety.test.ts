// Safety unit tests (migration plan § E0a): kill switches, error budget, safe mode, boot sentinel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureSwitches, FEATURE_IDS, parseDisabled, SAFE_MODE_FEATURES } from '../frontend/safety/features.ts';
import { beginBoot, BOOT_KEY, HEALTHY_AFTER_MS, markHealthy, watchBoot } from '../frontend/safety/boot.ts';
import { errorCount, initSafety, isEnabled, reloadSafety, reportError, safetyDiagnostics } from '../frontend/safety/runtime.ts';

function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test('features: the ids users type never change (append only)', () => {
    assert.deepEqual([...FEATURE_IDS], ['banner', 'sound', 'duration', 'completion', 'captures', 'toasts', 'reset', 'placement']);
});

test('features: parseDisabled trims and ignores empties', () => {
    assert.deepEqual([...parseDisabled(' banner, ,sound ')], ['banner', 'sound']);
    assert.deepEqual([...parseDisabled('')], []);
});

test('features: disabled by setting, reload picks up changes', () => {
    let raw = 'banner';
    const f = createFeatureSwitches({ readDisabled: () => raw });
    assert.equal(f.isEnabled('banner'), false);
    assert.equal(f.isEnabled('sound'), true);
    assert.equal(f.run('banner', () => 1), undefined);
    raw = '';
    f.reload();
    assert.equal(f.run('banner', () => 1), 1);
});

test('features: run never throws and trips after the budget', () => {
    const f = createFeatureSwitches({ readDisabled: () => '', errorBudget: 2 });
    const boom = () => {
        throw new Error('x');
    };
    assert.equal(f.run('sound', boom), undefined);
    assert.equal(f.isEnabled('sound'), true);
    assert.equal(f.run('sound', boom), undefined);
    assert.equal(f.isEnabled('sound'), false);
    assert.deepEqual(f.diagnostics().tripped, ['sound']);
    assert.equal(f.errorCount(), 2);
});

test('features: safe mode switches every feature off', () => {
    const f = createFeatureSwitches({ readDisabled: () => '' });
    f.setSafeMode(true);
    for (const id of FEATURE_IDS) assert.equal(f.isEnabled(id), false, id);
    assert.equal(SAFE_MODE_FEATURES.size, 0);
});

test('boot: two bad boots in a row start safe mode; a healthy boot resets', () => {
    const s = memory();
    assert.deepEqual(beginBoot(s, 1), { safeMode: false, unclean: 0 });
    assert.deepEqual(beginBoot(s, 2), { safeMode: false, unclean: 1 }); // previous never cleared
    assert.deepEqual(beginBoot(s, 3), { safeMode: true, unclean: 2 });
    markHealthy(s, 4);
    assert.deepEqual(beginBoot(s, 5), { safeMode: false, unclean: 0 });
});

test('boot: corrupt storage is treated as a first boot', () => {
    const s = memory();
    s.setItem(BOOT_KEY, '{nope');
    assert.deepEqual(beginBoot(s), { safeMode: false, unclean: 0 });
});

test('boot: watchBoot clears on pagehide, and after the delay only without errors', () => {
    const s = memory();
    const listeners: Record<string, () => void> = {};
    let timer: (() => void) | undefined;
    let delay = 0;
    const win = { addEventListener: (t: string, fn: () => void) => void (listeners[t] = fn), setTimeout: (fn: () => void, ms: number) => ((timer = fn), (delay = ms)) };
    beginBoot(s);
    let errors = 1;
    watchBoot(s, () => errors, win);
    assert.equal(delay, HEALTHY_AFTER_MS);
    timer!();
    assert.equal(JSON.parse(s.getItem(BOOT_KEY)!).pending, true);
    listeners.pagehide!();
    assert.equal(JSON.parse(s.getItem(BOOT_KEY)!).pending, false);
    beginBoot(s);
    errors = 0;
    timer!();
    assert.equal(JSON.parse(s.getItem(BOOT_KEY)!).pending, false);
});

test('runtime: before initSafety every feature is on', () => {
    for (const id of FEATURE_IDS) assert.equal(isEnabled(id), true, id);
});

test('runtime: initSafety wires the setting, safe mode and the budget', () => {
    let raw = 'duration';
    initSafety({ readDisabled: () => raw, safeMode: false, errorBudget: 1 });
    assert.equal(isEnabled('duration'), false);
    raw = '';
    reloadSafety();
    assert.equal(isEnabled('duration'), true);
    reportError('captures', new Error('x'));
    assert.equal(isEnabled('captures'), false);
    assert.equal(errorCount(), 1);
    assert.deepEqual(safetyDiagnostics(), { safeMode: false, disabled: [], tripped: ['captures'], errors: { captures: 1 } });
    initSafety({ readDisabled: () => '', safeMode: true });
    assert.equal(isEnabled('banner'), false);
    assert.equal(safetyDiagnostics().safeMode, true);
});

test('features: onTrip is called once when a feature trips', () => {
    const tripped: string[] = [];
    const f = createFeatureSwitches({ readDisabled: () => '', errorBudget: 3, onTrip: (id) => tripped.push(id) });
    for (let i = 0; i < 6; i++) f.reportError('sound', new Error('x'));
    f.reportError('banner', new Error('y'));
    assert.deepEqual(tripped, ['sound']);
    assert.equal(f.isEnabled('sound'), false);
});
