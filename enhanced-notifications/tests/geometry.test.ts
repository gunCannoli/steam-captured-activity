import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerSize, placeBanner } from '../frontend/banner/geometry.ts';

const e = (top: number, bottom: number, left: number, right: number) => ({ top, bottom, left, right });

const avail = { left: 0, top: 0, width: 2048, height: 1104 };
const size = { width: 400, height: 70 };
const banner = (scale: [number, number]) => ({
    scale,
    background: ['#000'],
    gradientAngle: 90,
    border: { width: 0, color: '#fff', radius: 0 },
    glow: { color: '#000', spread: 0, pulseMs: 0 },
    margin: e(5, 5, 5, 5),
    padding: e(8, 8, 8, 8),
    gap: [5, 5] as [number, number],
});

test('placeBanner: every anchor with margin 5 is 5 px in from its corner', () => {
    assert.deepEqual(placeBanner('top_right', e(5, 5, 5, 5), size, avail), { x: 1643, y: 5 });
    assert.deepEqual(placeBanner('top_left', e(5, 5, 5, 5), size, avail), { x: 5, y: 5 });
    assert.deepEqual(placeBanner('bottom_right', e(5, 5, 5, 5), size, avail), { x: 1643, y: 1029 });
    assert.deepEqual(placeBanner('bottom_left', e(5, 5, 5, 5), size, avail), { x: 5, y: 1029 });
    assert.deepEqual(placeBanner('top_center', e(5, 5, 5, 5), size, avail), { x: 824, y: 5 });
    assert.deepEqual(placeBanner('bottom_center', e(5, 5, 5, 5), size, avail), { x: 824, y: 1029 });
});

test('placeBanner: a scaled banner stays anchored and on screen', () => {
    assert.deepEqual(placeBanner('bottom_right', e(5, 5, 5, 5), { width: 800, height: 140 }, avail), { x: 1243, y: 959 });
    assert.deepEqual(placeBanner('top_right', e(0, 0, 0, 0), { width: 3000, height: 70 }, avail), { x: 0, y: 0 });
});

test('placeBanner: negative margins are clamped to the screen edge', () => {
    assert.deepEqual(placeBanner('top_left', e(-50, -50, -50, -50), size, avail), { x: 0, y: 0 });
    assert.deepEqual(placeBanner('bottom_right', e(-50, -50, -50, -50), size, avail), { x: 1648, y: 1034 });
});

test('placeBanner: stack slots move away from the anchor edge', () => {
    assert.deepEqual(placeBanner('top_right', e(5, 5, 5, 5), size, avail, 1), { x: 1643, y: 83 });
    assert.deepEqual(placeBanner('bottom_right', e(5, 5, 5, 5), size, avail, 1), { x: 1643, y: 951 });
});

test('bannerSize: scale changes the box, never the content height', () => {
    const a = bannerSize('ps5', banner([100, 100]));
    const b = bannerSize('ps5', banner([200, 150]));
    assert.deepEqual([a.width, a.height, a.innerH], [400, 70, 54]);
    assert.deepEqual([b.width, b.height, b.innerH], [800, 105, 54]);
    assert.equal(bannerSize('compact_pill', banner([100, 100])).height, 48);
    assert.equal(bannerSize('default_steam', banner([100, 100])).width, 283);
});

test('placeBanner: only the margins of the anchored sides count', () => {
    const m = e(10, 5, 4, 7);
    assert.deepEqual(placeBanner('top_right', m, size, avail), { x: 1648 - 7, y: 10 });
    assert.deepEqual(placeBanner('bottom_left', m, size, avail), { x: 4, y: 1034 - 5 });
});

test('bannerSize: content height subtracts top and bottom padding', () => {
    assert.equal(bannerSize('ps5', { ...banner([100, 100]), padding: e(10, 5, 4, 7) }).innerH, 70 - 15 - 2 * banner([100, 100]).border.width);
});
