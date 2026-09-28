// Safety unit tests (migration plan M0b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureSwitches, parseDisabled, SAFE_MODE_FEATURES } from '../frontend/safety/features.ts';
import { beginBoot, BOOT_KEY, markHealthy, watchBoot, HEALTHY_AFTER_MS } from '../frontend/safety/boot.ts';

function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test('features: parseDisabled trims and ignores empties', () => {
    assert.deepEqual([...parseDisabled(' game-info, ,achievements ')], ['game-info', 'achievements']);
    assert.deepEqual([...parseDisabled('')], []);
});

test('features: disabled by setting, reload picks up changes', () => {
    let raw = 'game-info';
    const f = createFeatureSwitches({ readDisabled: () => raw });
    assert.equal(f.isEnabled('game-info'), false);
    assert.equal(f.isEnabled('sections'), true);
    assert.equal(f.run('game-info', () => 1), undefined);
    raw = '';
    f.reload();
    assert.equal(f.run('game-info', () => 1), 1);
});

test('features: run never throws and trips after the budget', () => {
    const f = createFeatureSwitches({ readDisabled: () => '', errorBudget: 2 });
    const boom = () => {
        throw new Error('x');
    };
    assert.equal(f.run('achievements', boom), undefined);
    assert.equal(f.isEnabled('achievements'), true);
    assert.equal(f.run('achievements', boom), undefined);
    assert.equal(f.isEnabled('achievements'), false);
    assert.deepEqual(f.diagnostics().tripped, ['achievements']);
    assert.equal(f.errorCount(), 2);
});

test('features: safe mode keeps only the capture tier', () => {
    const f = createFeatureSwitches({ readDisabled: () => '' });
    f.setSafeMode(true);
    for (const id of ['sections', 'store-cache', 'captures'] as const) assert.equal(f.isEnabled(id), true, id);
    for (const id of ['game-info', 'achievements', 'native-links', 'background-sync'] as const) assert.equal(f.isEnabled(id), false, id);
    assert.equal(SAFE_MODE_FEATURES.size, 3);
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
    listeners.pagehide();
    assert.equal(JSON.parse(s.getItem(BOOT_KEY)!).pending, false);
    beginBoot(s);
    errors = 0;
    timer!();
    assert.equal(JSON.parse(s.getItem(BOOT_KEY)!).pending, false);
});
